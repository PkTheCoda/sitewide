// Browser-side snippet behavior test in jsdom:
//   1. killed variant -> no change applied, ZERO events sent
//   2. missing target element -> exposure now, selector_miss at ~8s
//   3. present target element -> change applied, NO selector_miss
import { readFileSync } from "fs";
import { JSDOM } from "jsdom";

const snippetSource = readFileSync(new URL("../public/snippet.js", import.meta.url), "utf8");

function boot(config, html) {
  const dom = new JSDOM(html, { url: "http://site.test/page", runScripts: "outside-only" });
  const { window } = dom;
  const events = [];
  Object.defineProperty(window.navigator, "sendBeacon", {
    value: (_url, body) => {
      events.push(JSON.parse(body));
      return true;
    },
  });
  Object.defineProperty(window.document, "currentScript", {
    get: () => ({
      src: "http://api.test/api/snippet/js/site-1",
      getAttribute: () => null,
    }),
  });
  window.eval(`var __SW_EMBED__ = ${JSON.stringify({ siteId: "site-1", config })};`);
  window.eval(snippetSource);
  return { window, events };
}

let pass = 0,
  fail = 0;
const check = (name, cond, extra = "") =>
  cond ? (pass++, console.log(`  PASS ${name}`)) : (fail++, console.log(`  FAIL ${name} ${extra}`));

const baseExp = {
  id: "exp-1",
  page_path: "/page",
  selector: "#headline",
  selector_fallback: null,
  status: "running",
  goal_type: "click",
  goal_selector: "#cta",
  goal_page_path: null,
  winner_variant_id: null,
};

// ── 1. killed variant: bucket forced into it via weights ────────────────────
{
  const config = {
    experiments: [
      {
        ...baseExp,
        variants: [
          { id: "v-control", is_control: true, payload: null, weight: 0 },
          { id: "v-killed", is_control: false, payload: { text: "BAD" }, weight: 100, killed: true },
        ],
      },
    ],
  };
  const { window, events } = boot(config, `<h1 id="headline">Original</h1>`);
  await new Promise((r) => setTimeout(r, 200));
  check("killed: original text untouched", window.document.querySelector("#headline").textContent === "Original");
  check("killed: zero events sent", events.length === 0, JSON.stringify(events));
}

// ── 2. missing element: exposure immediately, selector_miss at ~8s ──────────
{
  const config = {
    experiments: [
      {
        ...baseExp,
        selector: "#does-not-exist",
        variants: [
          { id: "v-control", is_control: true, payload: null, weight: 0 },
          { id: "v-b", is_control: false, payload: { text: "NEW" }, weight: 100, killed: false },
        ],
      },
    ],
  };
  const { events } = boot(config, `<h1 id="headline">Original</h1>`);
  await new Promise((r) => setTimeout(r, 300));
  check(
    "missing: exposure sent immediately",
    events.some((e) => e.event_type === "exposure" && e.variant_id === "v-b")
  );
  check("missing: no selector_miss before 8s", !events.some((e) => e.event_type === "selector_miss"));
  await new Promise((r) => setTimeout(r, 8200));
  check(
    "missing: selector_miss sent after 8s",
    events.some((e) => e.event_type === "selector_miss" && e.variant_id === "v-b"),
    JSON.stringify(events)
  );
}

// ── 3. present element: applied, no miss ────────────────────────────────────
{
  const config = {
    experiments: [
      {
        ...baseExp,
        variants: [
          { id: "v-control", is_control: true, payload: null, weight: 0 },
          { id: "v-b", is_control: false, payload: { text: "NEW HEADLINE" }, weight: 100, killed: false },
        ],
      },
    ],
  };
  const { window, events } = boot(config, `<h1 id="headline">Original</h1>`);
  await new Promise((r) => setTimeout(r, 300));
  check("present: change applied", window.document.querySelector("#headline").textContent === "NEW HEADLINE");
  await new Promise((r) => setTimeout(r, 8200));
  check("present: no selector_miss", !events.some((e) => e.event_type === "selector_miss"));
  check(
    "present: exactly one exposure",
    events.filter((e) => e.event_type === "exposure").length === 1
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
