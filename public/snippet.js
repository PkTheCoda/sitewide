/**
 * Sitewide experiment runner.
 *
 * Install: <script defer src="https://YOUR-SITEWIDE-DOMAIN/snippet.js" data-site-id="YOUR_SITE_ID"></script>
 *
 * What it does on every page load:
 *   1. Reads/creates a first-party visitor id cookie (sw_vid).
 *   2. Loads the site's experiment config — from localStorage cache when
 *      available (instant, no flicker), from the network on first visit.
 *      The cache is refreshed in the background on every load, so config
 *      changes (activate/pause/winner) take effect one page load later.
 *   3. Assigns the visitor to a variant DETERMINISTICALLY — hash(visitorId +
 *      experimentId) mapped onto variant weights. Same visitor, same variant,
 *      on every page and every visit, with zero stored assignments.
 *   4. Applies the variant's change (text / styles / image src / hide) and
 *      re-applies it via MutationObserver — React/Next sites wipe one-time
 *      DOM patches on hydration and client-side navigation.
 *   5. Reports exposure + conversion events as text/plain beacons ("simple
 *      requests": no CORS preflight, deliverable from any site). The server
 *      dedupes per visitor, so events are fire-and-forget.
 *
 * Anti-flicker strategy:
 *   - Cached config (every visit after the first): hide ONLY the elements the
 *     experiments target, apply instantly, unhide. No full-page blank.
 *   - No cache (first visit ever): hide the page until config arrives, with a
 *     400ms failsafe so a slow/failed fetch never blanks the site for long.
 */
(function () {
  "use strict";

  var script = document.currentScript;
  if (!script) return;
  var SITE_ID = script.getAttribute("data-site-id");
  if (!SITE_ID) return;
  var API = new URL(script.src).origin;
  var CACHE_KEY = "sw_cfg_" + SITE_ID;

  // ── Hiding / unhiding (anti-flicker) ──────────────────────────────────────
  var hideStyle = null;
  var unhidden = false;
  function hide(cssText) {
    if (unhidden || hideStyle) return;
    hideStyle = document.createElement("style");
    hideStyle.textContent = cssText;
    document.documentElement.appendChild(hideStyle);
  }
  function unhide() {
    unhidden = true;
    if (hideStyle && hideStyle.parentNode) hideStyle.parentNode.removeChild(hideStyle);
    hideStyle = null;
  }
  setTimeout(unhide, 400); // failsafe: never hold the page hostage

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

  // ── Deterministic bucketing ───────────────────────────────────────────────
  // FNV-1a hash → 0-99. Keyed per experiment so assignments are independent.
  function bucket(experimentId) {
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
  // (A Blob typed application/json would force a preflighted beacon — flaky.)
  // The server parses the body as JSON regardless of content type, and
  // dedupes per visitor — so this is fire-and-forget.
  function sendEvent(experimentId, variantId, eventType) {
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

  // ── Core: act on a config (apply changes, wire goals, fire events) ───────
  function run(config) {
    var experiments = (config && config.experiments) || [];
    var pending = []; // changes to apply/re-apply as the DOM settles

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
            pending.push({ exp: exp, payload: winner.payload });
          }
        }
        return;
      }

      if (exp.status !== "running") return;
      var variant = pickVariant(exp);

      // On the experiment page: apply the change, count the exposure.
      // (If this config came from a stale cache and the experiment was
      // paused meanwhile, the server rejects the events — data stays clean.)
      if (pathMatches(exp.page_path)) {
        if (variant.payload) pending.push({ exp: exp, payload: variant.payload });
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
      unhide();
      return;
    }

    // Apply now, re-apply as the framework hydrates/re-renders.
    function applyAll() {
      pending.forEach(function (item) {
        var el = findElement(item.exp.selector, item.exp.selector_fallback);
        if (el) applyPayload(el, item.payload);
      });
    }

    function start() {
      applyAll();
      unhide();
      var observer = new MutationObserver(function () {
        applyAll(); // idempotent — checks current values before touching DOM
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
    // Repeat visit: no full-page hide. Hide only the elements experiments on
    // THIS page will touch, apply from cache instantly, unhide. Then refresh
    // the cache in the background so the NEXT load sees config changes.
    var selectors = [];
    (cached.experiments || []).forEach(function (exp) {
      var active =
        exp.status === "running" || (exp.status === "completed" && exp.winner_variant_id);
      if (active && exp.selector && pathMatches(exp.page_path)) {
        selectors.push(exp.selector);
      }
    });
    if (selectors.length) {
      hide(selectors.join(",") + "{visibility:hidden !important}");
    }
    run(cached);
    fetchConfig().then(writeCache).catch(function () {});
  } else {
    // First visit ever: nothing to go on — hide the page until config
    // arrives (400ms cap). Every later visit takes the cached path above.
    hide("html{opacity:0 !important}");
    fetchConfig()
      .then(function (config) {
        writeCache(config);
        run(config);
      })
      .catch(unhide);
  }
})();
