// Browser-side snippet behavior test in jsdom:
//   1. killed variant -> no change applied, ZERO events sent
//   2. missing target element -> exposure now, selector_miss at ~8s
//   3. present target element -> change applied, NO selector_miss
//   4. bot filtering -> bots still GET the change, send ZERO events; humans unaffected
import { readFileSync } from "fs";
import { JSDOM } from "jsdom";

const snippetSource = readFileSync(new URL("../public/snippet.js", import.meta.url), "utf8");

// The real token list, read out of lib/botFilter.ts — testing against a copy
// would only prove the copy works. Cheaper than adding a TS build step here.
const BOT_PATTERN = (() => {
  const src = readFileSync(new URL("../lib/botFilter.ts", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("const BOT_UA_TOKENS = ["));
  return [...body.slice(0, body.indexOf("];")).matchAll(/"((?:[^"\\]|\\.)*)"/g)]
    .map((m) => m[1])
    .join("|");
})();

function boot(config, html, opts = {}) {
  const dom = new JSDOM(html, {
    url: opts.url || "http://site.test/page",
    runScripts: "outside-only",
  });
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
  if (opts.userAgent) {
    Object.defineProperty(window.navigator, "userAgent", { value: opts.userAgent });
  }
  if (opts.webdriver) {
    Object.defineProperty(window.navigator, "webdriver", { value: true });
  }
  if (opts.storage) {
    for (const [k, v] of Object.entries(opts.storage)) window.localStorage.setItem(k, v);
  }
  window.eval(
    `var __SW_EMBED__ = ${JSON.stringify({ siteId: "site-1", config, bots: BOT_PATTERN })};`
  );
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

// ── 4. bot filtering ────────────────────────────────────────────────────────
// The invariant that matters: detected traffic still SEES the variant (serving
// bots a different page than humans is cloaking) and simply stops being
// counted. Anything that sends an event here inflates a denominator.
{
  const botConfig = {
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
  const HTML = `<h1 id="headline">Original</h1>`;
  const CHROME =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

  const silenced = [
    ["googlebot UA", { userAgent: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" }],
    ["headless chrome UA", { userAgent: CHROME.replace("Chrome/", "HeadlessChrome/") }],
    ["lighthouse UA", { userAgent: `${CHROME} Chrome-Lighthouse` }],
    ["navigator.webdriver", { userAgent: CHROME, webdriver: true }],
    ["?sw_optout=1", { userAgent: CHROME, url: "http://site.test/page?sw_optout=1" }],
    ["sticky opt-out", { userAgent: CHROME, storage: { sw_optout: "1" } }],
  ];
  for (const [name, opts] of silenced) {
    const { window, events } = boot(botConfig, HTML, opts);
    await new Promise((r) => setTimeout(r, 300));
    check(`bot (${name}): zero events`, events.length === 0, JSON.stringify(events));
    // No cloaking: the change must still land.
    check(
      `bot (${name}): change still applied`,
      window.document.querySelector("#headline").textContent === "NEW HEADLINE"
    );
  }

  // False-positive guard. "Cubot" is a real Android phone brand containing
  // "bot"; YaBrowser is Yandex's consumer browser, not YandexBot; in-app
  // webviews are a large slice of genuine traffic. All must still be counted.
  const humans = [
    ["desktop chrome", CHROME],
    ["iphone safari", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1"],
    ["cubot android", "Mozilla/5.0 (Linux; Android 13; CUBOT KING KONG 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"],
    ["yandex browser", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 YaBrowser/25.6.0.0 Safari/537.36"],
    ["instagram webview", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22E240 Instagram 380.0.0.25.106"],
  ];
  for (const [name, userAgent] of humans) {
    const { events } = boot(botConfig, HTML, { userAgent });
    await new Promise((r) => setTimeout(r, 300));
    check(
      `human (${name}): exposure counted`,
      events.filter((e) => e.event_type === "exposure").length === 1,
      JSON.stringify(events)
    );
  }

  // Opting back out of the opt-out.
  const { events: cleared } = boot(botConfig, HTML, {
    userAgent: CHROME,
    url: "http://site.test/page?sw_optout=0",
    storage: { sw_optout: "1" },
  });
  await new Promise((r) => setTimeout(r, 300));
  check("?sw_optout=0 re-enables tracking", cleared.length === 1, JSON.stringify(cleared));
}

// ── 5. SPA navigation ────────────────────────────────────────────────────────
// PLG SaaS sites are Next/React routers: the document loads once and every
// link is a pushState. Exposure, variant apply, pageview conversions and
// click goals must all track the CURRENT path, not the one at load time.
{
  const variants = [
    { id: "v-control", is_control: true, payload: null, weight: 0 },
    { id: "v-b", is_control: false, payload: { text: "NEW HEADLINE" }, weight: 100, killed: false },
  ];
  const HTML = `<div id="app"><h1 id="headline">Original</h1><button id="cta">Go</button></div>`;
  const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

  // 5a. land on an unrelated page, route INTO the experiment page
  {
    const config = { experiments: [{ ...baseExp, variants }] };
    const { window, events } = boot(config, HTML, { url: "http://site.test/blog" });
    await tick();
    check("spa: no exposure off-page", events.length === 0, JSON.stringify(events));
    check("spa: original untouched off-page", window.document.querySelector("#headline").textContent === "Original");
    window.history.pushState({}, "", "/page");
    await tick();
    check("spa: exposure after pushState onto experiment page", events.filter((e) => e.event_type === "exposure").length === 1, JSON.stringify(events));
    check("spa: variant applied after pushState", window.document.querySelector("#headline").textContent === "NEW HEADLINE");
    // element re-rendered by the router after nav → observer re-applies
    window.document.querySelector("#headline").textContent = "Original";
    await tick();
    check("spa: re-applied after router rewrite", window.document.querySelector("#headline").textContent === "NEW HEADLINE");
    // same-path replaceState (Next does this on scroll) must not re-send
    window.history.replaceState({}, "", "/page?x=1");
    await tick();
    check("spa: same-path replaceState sends nothing new", events.length === 1, JSON.stringify(events));
  }

  // 5b. pageview goal reached via client-side navigation
  {
    const config = {
      experiments: [{ ...baseExp, goal_type: "pageview", goal_selector: null, goal_page_path: "/thanks", variants }],
    };
    const { window, events } = boot(config, HTML);
    await tick();
    check("spa pageview: exposure on load", events.filter((e) => e.event_type === "exposure").length === 1);
    window.history.pushState({}, "", "/thanks");
    await tick();
    const conv = events.filter((e) => e.event_type === "conversion");
    check("spa pageview: conversion after pushState to goal path", conv.length === 1 && conv[0].variant_id === "v-b", JSON.stringify(events));
    window.history.back();
    await tick(100);
    window.history.pushState({}, "", "/thanks/");
    await tick();
    check("spa pageview: conversion not re-sent on revisit (trailing slash)", events.filter((e) => e.event_type === "conversion").length === 1, JSON.stringify(events));
  }

  // 5c. click goal: listener bound once, checks page at click time
  {
    const config = { experiments: [{ ...baseExp, variants }] };
    const { window, events } = boot(config, HTML, { url: "http://site.test/blog" });
    await tick();
    const click = () => window.document.querySelector("#cta").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    click();
    await tick();
    check("spa click: no conversion off-page", events.filter((e) => e.event_type === "conversion").length === 0, JSON.stringify(events));
    window.history.pushState({}, "", "/page");
    await tick();
    window.history.pushState({}, "", "/blog");
    await tick();
    window.history.pushState({}, "", "/page");
    await tick();
    click();
    click();
    await tick();
    check("spa click: exactly one conversion after 3 navs + 2 clicks", events.filter((e) => e.event_type === "conversion").length === 1, JSON.stringify(events));
    check("spa click: exactly one exposure across repeated visits", events.filter((e) => e.event_type === "exposure").length === 1, JSON.stringify(events));
  }

  // 5d. stale apply loop must not patch a same-shaped element on the next page
  {
    const config = { experiments: [{ ...baseExp, selector: "#app > h1", variants }] };
    const { window, events } = boot(config, HTML);
    await tick();
    check("spa leak: applied on experiment page", window.document.querySelector("#app > h1").textContent === "NEW HEADLINE");
    window.history.pushState({}, "", "/pricing");
    await tick();
    // router swaps the content; the new page has its own h1 at the same selector
    window.document.querySelector("#app").innerHTML = `<h1>Pricing</h1>`;
    await tick(100);
    check("spa leak: other page's h1 untouched", window.document.querySelector("#app > h1").textContent === "Pricing");
    check("spa leak: still one exposure", events.filter((e) => e.event_type === "exposure").length === 1);
  }

  // 5e. navigating away before 8s is not a selector miss; arriving late is
  {
    const config = { experiments: [{ ...baseExp, selector: "#nope", variants }] };
    const { window, events } = boot(config, HTML);
    await tick();
    window.history.pushState({}, "", "/blog");
    await new Promise((r) => setTimeout(r, 8200));
    check("spa miss: no selector_miss after navigating away", !events.some((e) => e.event_type === "selector_miss"), JSON.stringify(events));
  }

  // 5f. popstate (back button) into the experiment page
  {
    const config = { experiments: [{ ...baseExp, variants }] };
    const { window, events } = boot(config, HTML, { url: "http://site.test/blog" });
    await tick();
    window.history.pushState({}, "", "/page");
    await tick();
    window.document.querySelector("#headline").textContent = "Original";
    window.history.pushState({}, "", "/blog");
    await tick();
    window.history.back();
    await tick(100);
    check("spa popstate: variant re-applied on back", window.document.querySelector("#headline").textContent === "NEW HEADLINE");
    check("spa popstate: still one exposure", events.filter((e) => e.event_type === "exposure").length === 1);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
