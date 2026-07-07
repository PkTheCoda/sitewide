/**
 * Sitewide experiment runner.
 *
 * Install: <script defer src="https://YOUR-SITEWIDE-DOMAIN/snippet.js" data-site-id="YOUR_SITE_ID"></script>
 *
 * Debug mode: add ?sw_debug=1 to any URL on the site (or run
 * `localStorage.sw_debug = "1"` in the console) and the snippet logs every
 * step — visitor id, config source (cache vs network), bucketing decisions,
 * element applies, events, and why/when the page was released from hiding.
 *
 * What it does on every page load:
 *   1. Reads/creates a first-party visitor id cookie (sw_vid).
 *   2. Loads the site's experiment config — from localStorage cache when
 *      available (instant), from the network on first visit. The cache is
 *      refreshed in the background on every load, so config changes take
 *      effect one page load later.
 *   3. Assigns the visitor to a variant DETERMINISTICALLY — hash(visitorId +
 *      experimentId) mapped onto variant weights. Same visitor, same variant,
 *      every page, every visit, no stored assignments.
 *   4. Applies the variant's change and re-applies via MutationObserver —
 *      client-rendered React/Next sites build the DOM late and rewrite it on
 *      hydration, so one-shot patching is not enough.
 *   5. Reports exposure + conversion events as text/plain beacons (CORS
 *      "simple requests" — no preflight). The server dedupes per visitor.
 *
 * Anti-flicker strategy (the important part):
 *   - Target elements stay hidden (visibility:hidden — layout preserved)
 *     until their change is ACTUALLY applied. On client-rendered apps the
 *     element may not exist for hundreds of ms; hiding is by CSS rule, so it
 *     covers the element from the instant the framework creates it — the
 *     visitor never sees the original text flash before the swap.
 *   - Whole-page hide is used only on a visitor's first-ever load (no cache
 *     yet), and only until the config arrives — then it downgrades to the
 *     element-scoped hide above.
 *   - A 400ms failsafe releases everything no matter what: a slow fetch or a
 *     missing element can never hold the page hostage.
 */
(function () {
  "use strict";

  var script = document.currentScript;
  if (!script) return;
  var SITE_ID = script.getAttribute("data-site-id");
  if (!SITE_ID) return;
  var API = new URL(script.src).origin;
  var CACHE_KEY = "sw_cfg_" + SITE_ID;

  // ── Debug logging (?sw_debug=1 or localStorage.sw_debug="1") ─────────────
  var DEBUG = false;
  try {
    DEBUG = /[?&]sw_debug=1/.test(location.search) || localStorage.getItem("sw_debug") === "1";
  } catch (e) {
    /* storage blocked — debug stays off */
  }
  function dbg() {
    if (!DEBUG) return;
    var args = ["[sitewide]"];
    for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
    console.log.apply(console, args);
  }

  // ── Hiding / releasing (anti-flicker) ─────────────────────────────────────
  // One <style> element whose contents we can swap: starts as a whole-page
  // hide on first visit, downgrades to element-only hiding once we know the
  // selectors, and is removed entirely on release.
  var hideEl = null;
  var released = false;
  function setHide(cssText) {
    if (released) return;
    if (!hideEl) {
      hideEl = document.createElement("style");
      document.documentElement.appendChild(hideEl);
    }
    hideEl.textContent = cssText;
  }
  function release(reason) {
    if (released) return;
    released = true;
    if (hideEl && hideEl.parentNode) hideEl.parentNode.removeChild(hideEl);
    hideEl = null;
    dbg("released page (" + reason + ")");
  }
  setTimeout(function () {
    release("400ms failsafe");
  }, 400);

  // ── Visitor identity ──────────────────────────────────────────────────────
  function getVisitorId() {
    var m = document.cookie.match(/(?:^|;\s*)sw_vid=([^;]+)/);
    if (m) return m[1];
    var vid =
      Date.now().toString(36) +
      "-" +
      Math.random().toString(36).slice(2, 10) +
      Math.random().toString(36).slice(2, 10);
    document.cookie = "sw_vid=" + vid + ";path=/;max-age=31536000;SameSite=Lax";
    return vid;
  }
  var VISITOR_ID = getVisitorId();
  dbg("visitor:", VISITOR_ID);

  // ── Preview override (?sw_bucket=N) ───────────────────────────────────────
  // Forces the bucket number for ALL experiments on this page load, so you can
  // see any arm on demand: ?sw_bucket=99 → last variant, ?sw_bucket=0 →
  // control. Preview visits record NO events — forced traffic isn't data.
  var FORCED_BUCKET = null;
  var forced = location.search.match(/[?&]sw_bucket=(\d+)/);
  if (forced) {
    FORCED_BUCKET = Math.min(99, parseInt(forced[1], 10));
    dbg("PREVIEW MODE: bucket forced to", FORCED_BUCKET, "— events suppressed");
  }

  // ── Deterministic bucketing ───────────────────────────────────────────────
  // FNV-1a hash → 0-99. Keyed per experiment so assignments are independent.
  function bucket(experimentId) {
    if (FORCED_BUCKET !== null) return FORCED_BUCKET;
    var str = VISITOR_ID + ":" + experimentId;
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    return h % 100;
  }

  // Walk cumulative weights in variant order; the bucket lands in one slot.
  function pickVariant(experiment) {
    var b = bucket(experiment.id);
    var cum = 0;
    for (var i = 0; i < experiment.variants.length; i++) {
      cum += experiment.variants[i].weight;
      if (b < cum) return experiment.variants[i];
    }
    return experiment.variants[0]; // weights didn't sum to 100 — fall back to control
  }

  // ── Element finding ───────────────────────────────────────────────────────
  // Try the stored selector, then the {tag, text} fallback (survives redeploys
  // that restructure the page but keep the copy).
  function findElement(selector, fallback) {
    if (selector) {
      try {
        var el = document.querySelector(selector);
        if (el) return el;
      } catch (e) {
        /* invalid selector — fall through to fallback */
      }
    }
    if (fallback && fallback.tag && fallback.text) {
      var candidates = document.getElementsByTagName(fallback.tag);
      for (var i = 0; i < candidates.length; i++) {
        var text = (candidates[i].innerText || "").trim();
        if (text && text.indexOf(fallback.text.slice(0, 40)) === 0) {
          return candidates[i];
        }
      }
    }
    return null;
  }

  // ── Applying changes (idempotent — safe to call on every mutation) ────────
  function applyPayload(el, payload) {
    if (!payload) return;
    if (payload.text !== undefined && el.textContent !== payload.text) {
      el.textContent = payload.text;
    }
    if (payload.src !== undefined && el.getAttribute("src") !== payload.src) {
      el.setAttribute("src", payload.src);
      el.removeAttribute("srcset"); // srcset would override our src
    }
    if (payload.hide) {
      if (el.style.getPropertyValue("display") !== "none") {
        el.style.setProperty("display", "none", "important");
      }
    }
    if (payload.styles) {
      var map = {
        color: "color",
        backgroundColor: "background-color",
        fontSize: "font-size",
      };
      for (var key in payload.styles) {
        var css = map[key];
        if (css && el.style.getPropertyValue(css) !== payload.styles[key]) {
          el.style.setProperty(css, payload.styles[key], "important");
        }
      }
    }
  }

  // ── Event reporting ───────────────────────────────────────────────────────
  // Body is a PLAIN STRING → the request is a CORS "simple request" (no
  // preflight), which sendBeacon can always deliver, even cross-origin.
  // The server parses the body as JSON regardless of content type and dedupes
  // per visitor — fire-and-forget.
  function sendEvent(experimentId, variantId, eventType) {
    if (FORCED_BUCKET !== null) {
      dbg("event suppressed (preview mode):", eventType);
      return;
    }
    var body = JSON.stringify({
      experiment_id: experimentId,
      variant_id: variantId,
      visitor_id: VISITOR_ID,
      event_type: eventType,
      page_url: location.href,
    });
    var url = API + "/api/snippet/event";
    var sent = false;
    if (navigator.sendBeacon) {
      try {
        sent = navigator.sendBeacon(url, body);
      } catch (e) {
        sent = false;
      }
    }
    if (!sent) {
      fetch(url, { method: "POST", body: body, keepalive: true }).catch(function () {});
    }
    dbg("event sent:", eventType, "(experiment " + experimentId.slice(0, 8) + "…)");
  }

  // ── Path matching (exact path, trailing-slash tolerant) ──────────────────
  function pathMatches(path) {
    if (!path) return false;
    var norm = function (p) {
      return p.length > 1 ? p.replace(/\/+$/, "") : p;
    };
    return norm(location.pathname) === norm(path);
  }

  // ── Config cache ──────────────────────────────────────────────────────────
  function readCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }
  function writeCache(config) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(config));
    } catch (e) {
      /* storage full/blocked — cache is an optimization, not a requirement */
    }
  }
  function fetchConfig() {
    return fetch(API + "/api/snippet/config?site_id=" + encodeURIComponent(SITE_ID)).then(
      function (res) {
        return res.json();
      }
    );
  }

  // CSS that hides exactly the elements the given pending changes target.
  function hideCssFor(pending) {
    var selectors = [];
    pending.forEach(function (item) {
      if (item.exp.selector) selectors.push(item.exp.selector);
    });
    return selectors.length ? selectors.join(",") + "{visibility:hidden !important}" : "";
  }

  // ── Core: act on a config (apply changes, wire goals, fire events) ───────
  function run(config) {
    var experiments = (config && config.experiments) || [];
    var pending = []; // { exp, payload, applied } — applied flips on first success

    experiments.forEach(function (exp) {
      // Completed experiment with a winner: serve the winner to everyone,
      // no tracking. This IS "promoting the winner to 100%".
      if (exp.status === "completed") {
        if (exp.winner_variant_id && pathMatches(exp.page_path)) {
          var winner = null;
          for (var i = 0; i < exp.variants.length; i++) {
            if (exp.variants[i].id === exp.winner_variant_id) winner = exp.variants[i];
          }
          if (winner && winner.payload) {
            pending.push({ exp: exp, payload: winner.payload, applied: false });
            dbg("serving promoted winner for", exp.id.slice(0, 8) + "…");
          }
        }
        return;
      }

      if (exp.status !== "running") return;
      var variant = pickVariant(exp);
      dbg(
        "experiment",
        exp.id.slice(0, 8) + "…",
        "bucket=" + bucket(exp.id),
        "→",
        variant.is_control ? "CONTROL" : "VARIANT",
        "(" + variant.id.slice(0, 8) + "…)"
      );

      // On the experiment page: apply the change, count the exposure.
      // (If this config came from a stale cache and the experiment was
      // paused meanwhile, the server rejects the events — data stays clean.)
      if (pathMatches(exp.page_path)) {
        if (variant.payload) {
          pending.push({ exp: exp, payload: variant.payload, applied: false });
        }
        sendEvent(exp.id, variant.id, "exposure");

        // Click goal: capture-phase listener, works on late-rendered elements.
        if (exp.goal_type === "click" && exp.goal_selector) {
          document.addEventListener(
            "click",
            function (e) {
              try {
                if (e.target && e.target.closest && e.target.closest(exp.goal_selector)) {
                  sendEvent(exp.id, variant.id, "conversion");
                }
              } catch (err) {
                /* bad selector — ignore */
              }
            },
            true
          );
        }
      }

      // Pageview goal: the conversion page is usually NOT the experiment
      // page. Deterministic bucketing recomputes the same variant here with
      // no stored state. The server only counts it if this visitor also has
      // an exposure row.
      if (exp.goal_type === "pageview" && pathMatches(exp.goal_page_path)) {
        sendEvent(exp.id, variant.id, "conversion");
      }
    });

    if (pending.length === 0) {
      release("no changes on this page");
      return;
    }

    // From here on, hide ONLY the elements we're about to change. On
    // client-rendered apps (React/Vite) these elements may not exist yet —
    // a CSS rule covers them from the instant the framework creates them.
    setHide(hideCssFor(pending));

    // Returns true when every pending change has been applied at least once.
    function applyAll() {
      var allApplied = true;
      pending.forEach(function (item) {
        var el = findElement(item.exp.selector, item.exp.selector_fallback);
        if (el) {
          applyPayload(el, item.payload);
          if (!item.applied) {
            item.applied = true;
            dbg("applied change to", item.exp.selector);
          }
        }
        if (!item.applied) allApplied = false;
      });
      return allApplied;
    }

    // Apply now; keep re-applying as the framework renders/hydrates/re-renders.
    // Only release the hide once everything is actually applied (or the 400ms
    // failsafe fires) — releasing earlier would flash the original content.
    function start() {
      if (applyAll()) release("all changes applied");
      var observer = new MutationObserver(function () {
        if (applyAll() && !released) release("all changes applied (late render)");
      });
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", start);
    } else {
      start();
    }
  }

  // ── Main ─────────────────────────────────────────────────────────────────
  var cached = readCache();

  if (cached) {
    dbg("config source: localStorage cache (refreshing in background)");
    run(cached);
    fetchConfig()
      .then(function (config) {
        writeCache(config);
        dbg("background config refresh done — takes effect next page load");
      })
      .catch(function () {});
  } else {
    dbg("config source: network (first visit on this device)");
    // Nothing to go on yet — hide the page until config arrives (400ms cap).
    // run() immediately downgrades this to element-only hiding.
    setHide("html{opacity:0 !important}");
    fetchConfig()
      .then(function (config) {
        writeCache(config);
        run(config);
      })
      .catch(function () {
        release("config fetch failed");
      });
  }
})();
