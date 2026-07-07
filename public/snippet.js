/**
 * Sitewide experiment runner.
 *
 * Install: <script defer src="https://YOUR-SITEWIDE-DOMAIN/snippet.js" data-site-id="YOUR_SITE_ID"></script>
 *
 * What it does on every page load:
 *   1. Reads/creates a first-party visitor id cookie (sw_vid).
 *   2. Fetches active experiments for this site (edge-cached, one request).
 *   3. Assigns the visitor to a variant DETERMINISTICALLY — hash(visitorId +
 *      experimentId) mapped onto variant weights. Same visitor, same variant,
 *      on every page and every visit, with zero server round-trips.
 *   4. Applies the variant's change (text / styles / image src / hide) and
 *      re-applies it via MutationObserver — React/Next sites wipe one-time DOM
 *      patches on hydration and client-side navigation.
 *   5. Reports exposure + conversion events. The server dedupes per visitor,
 *      so events are fire-and-forget.
 *
 * Anti-flicker: hides the page (<html> opacity) until changes are applied,
 * with a 400ms failsafe so a slow/failed config fetch never blanks the site.
 */
(function () {
  "use strict";

  var script = document.currentScript;
  if (!script) return;
  var SITE_ID = script.getAttribute("data-site-id");
  if (!SITE_ID) return;
  var API = new URL(script.src).origin;

  // ── Anti-flicker ──────────────────────────────────────────────────────────
  var afStyle = document.createElement("style");
  afStyle.id = "sw-af";
  afStyle.textContent = "html{opacity:0 !important}";
  document.documentElement.appendChild(afStyle);
  var unhidden = false;
  function unhide() {
    if (unhidden) return;
    unhidden = true;
    if (afStyle.parentNode) afStyle.parentNode.removeChild(afStyle);
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
    document.cookie =
      "sw_vid=" + vid + ";path=/;max-age=31536000;SameSite=Lax";
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

  // ── Event reporting (server dedupes per visitor — just fire) ─────────────
  function sendEvent(experimentId, variantId, eventType) {
    var body = JSON.stringify({
      experiment_id: experimentId,
      variant_id: variantId,
      visitor_id: VISITOR_ID,
      event_type: eventType,
      page_url: location.href,
    });
    var url = API + "/api/snippet/event";
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
    } else {
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body,
        keepalive: true,
      }).catch(function () {});
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

  // ── Main ─────────────────────────────────────────────────────────────────
  fetch(API + "/api/snippet/config?site_id=" + encodeURIComponent(SITE_ID))
    .then(function (res) {
      return res.json();
    })
    .then(function (config) {
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
    })
    .catch(unhide);
})();
