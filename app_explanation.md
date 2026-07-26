# Sitewide — Full Project Reference

> Last full rewrite: 2026-07-04, after Experiment Builder v1 shipped.
> `progress.md` is the live task checklist; this file explains what exists and how it works.

## What This Is

Sitewide is an agentic CRO / A/B testing platform. Target ICP: **SaaS/PLG companies with ~10k–20k+ monthly visitors and no dedicated CRO person.** Not tiny pre-traffic startups (their tests never reach significance), not enterprise.

Two experiment creation paths:
1. **AI analysis** — crawl any URL, Claude generates specific CRO comments with ready-to-use variant copy, overlaid on a screenshot of the page. Works with zero historical traffic data (the cold-start advantage over reactive-AI competitors).
2. **Manual builder** — founder clicks any element on the screenshot, defines a change (text / style / image / hide) and a conversion goal, submits an experiment.

Both paths feed the same experiments database. A JS snippet (next build) serves variants to real visitors and tracks conversions; an evaluation loop later picks winners and promotes them.

## Strategy snapshot (July 2026)

- **Wedge:** A/B-testing-first, vs Humblytics (closest competitor) which is analytics-first and charges $19/mo for ONE test because their costs are event-metered. Sitewide's tracking is experiment-scoped (~1–2% of an analytics product's event volume) → "unlimited tests" is structurally cheap. Attack their pricing.
- **Anti-scope-creep rule:** NO heatmaps, NO funnels, NO general analytics dashboard. Copy competitors' mechanics (bucketing, anti-flicker, DOM mutation — solved problems), never their surface area.
- **"Agentic" must mean:** the loop actually closes — AI suggests → experiment runs → winner auto-promoted → next test queued → broken selectors self-heal. Human-in-the-loop tools own the rest of the market.
- **Positioning line:** "The first CRO tool that tells you what to test, not just how to run the test."

## Tech Stack (actual — trust this over any strategy doc)

| Tool | Purpose |
|------|---------|
| **Next.js 16 (App Router)** | Dashboard + landing page. Client components with plain Supabase calls — no TanStack Query, no /hooks dir |
| **Supabase** | Postgres + Auth + Storage (`screenshots` bucket) + Edge Functions (Deno) |
| **Browserless** (`/function` API) | Headless Chrome: screenshot + DOM extraction in one call. **Not Playwright** — it can't run on Vercel free tier |
| **Claude API** | `claude-haiku-4-5` inside the edge function generates the CRO analysis |
| **Vercel** | Deployment target + cron (later) |
| **Resend** | Weekly digest emails (later) |

Frontend conventions: DB access lives in `lib/*.ts` (pure async functions returning `data` or `{error}`), auth via `useAuth()` from `services/context/authContext`, types centralized in `lib/types.ts`.

## The Analysis Pipeline

Everything happens in **`supabase/functions/analyze-page/index.ts`** (invoked with `{url, user_id}` or `{url, report_id}`; uses the service role key, so RLS is bypassed — created rows must carry the real auth user's id or the dashboard can't see them):

1. **One Browserless `/function` call** runs a script in Chrome: scrolls the full page (triggers lazy loading), takes a full-page webp screenshot, and extracts elements — all from the *same rendered DOM*, so element pixel positions align with the screenshot exactly.
2. **Element capture** (the builder's raw material): tags `h1 h2 h3 header nav footer section main button form img` + class-pattern sections (hero/cta/pricing/…) + builder additions `p a li label img` + `h1/h2/h3 span` (styled heading fragments, selectable on their own). Per element: tag, text (≤120 chars), a **unique CSS selector** (`buildSelector`: climbs to nearest unique `#id` or `body`, disambiguating with `:nth-of-type` — unique by construction, immune to Tailwind class churn), a `fallback {tag, text}` for re-finding the element after redeploys, `src` (imgs), `hasMarkup` (has child elements — a text variant would flatten them), pixel bounding box at 1440px viewport, wordCount, siblingCount. Capped at 300; skips tiny (<50×20), textless (except imgs), and fixed/sticky elements; dedupes by `tag+top+left`.
3. **Screenshot** → Supabase Storage → public URL.
4. **Claude analysis**: first 50 elements (simplified: id, tag, text, word_count, section, % from top) + page text + detected sections → prompt demands strict JSON: 8–10 comments, one element each, with dimension/severity/hypothesis/2 variants matching original word count. Truncation and markdown-fence handling included.
5. **Coordinate resolution**: Claude references elements by numeric id → looked up in the element map → pixel coords converted to percentages (`top_pct` etc.) so overlays work at any display size.
6. **Write**: `reports` updated (status, screenshot_url, page_height, viewport_width, score, summary, **elements JSONB**) + `comments` inserted. On any error: status `error` + message.

## Database Schema (current)

### `reports` — one per analysis run (integer id; migrate to UUID before launch)
`id, user_id, url, status (pending|processing|complete|error), screenshot_url, page_height, viewport_width, overall_score, summary, error_message, elements (jsonb — full element map), created_at`

### `comments` — one per AI suggestion
`id, report_id, element_id, element_tag, section, dimension, severity (critical|warning|suggestion), comment, why_it_matters, suggestion, hypothesis, variants (text[]), test_type, selector, original_value, meta {effort, impact}, confidence, top_pct, left_pct, width_pct, height_pct`

### `experiments` — one per A/B test
`id (uuid), user_id, report_id, page_url, name, hypothesis, selector, selector_fallback (jsonb), change_type (text|style|hide|image), original_value, goal_type (click|pageview), goal_selector, goal_fallback, goal_page_path, traffic_percent, status (draft|running|paused|completed|archived), started_at, ended_at, created_at`

### `experiment_variants` — control is a row too
`id (uuid), experiment_id, name (Control / Variant B…), is_control, payload (jsonb: {text} | {styles:{color,backgroundColor,fontSize}} | {src} | {hide:true} | null for control), weight (traffic %, split evenly, remainder to control), position`

RLS: owner-only policies everywhere (`user_id = auth.uid()`, variants via join to experiments). The edge function writes with the service role.

### Planned with the snippet phase (deliberately not created yet)
- `sites` — one per domain; snippet identity (`data-site-id`), `snippet_installed` heartbeat. Reports/experiments get `site_id`; multi-page support (/, /pricing, …) falls out of this since the snippet covers every page of a site.
- `experiment_events` — `experiment_id, variant_id, visitor_id, event_type (exposure|conversion), page_url`, with a **unique index on (experiment_id, visitor_id, event_type)** so inserts are naively fire-and-forget and stats just count rows.

## The Experiment Builder (shipped)

Route: `/dashboard/report/[id]/builder` (button on the report page). Works entirely off the screenshot + `reports.elements` — **no iframe**, so X-Frame-Options/CSP can never break it. Trade-off: static image (no dropdowns/hover states); the snippet-based live editor is the v2 answer.

Flow and files:
- **`app/dashboard/report/[id]/builder/page.tsx`** — thin route. Loads the report, owns only shared selection state: `target`, `goalElement`, `pickingGoal`.
- **`components/experiment-builder/BuilderCanvas.tsx`** — screenshot + Figma-style hover. No per-element divs: `onMouseMove` on the container converts cursor → crawl-time page pixels, scans element boxes, highlights the **smallest box containing the point** (innermost element wins). Click bubbles the element up. Orange = testing target, emerald = goal, dashed = hover.
- **`components/experiment-builder/BuilderSidebar.tsx`** — owns all form state. 4 steps: element → change (tabs switch by tag: img → Image/Hide, else Text/Style/Hide) → goal → details. Auto-names from element text, validates every step before enabling submit, success panel after insert.
- **`components/experiment-builder/VariantFields.tsx`** — per-change-type inputs: text (≤3 variants + amber warning when `hasMarkup` — plain-text replacement flattens styled children; tip: select the styled span directly), style (color/background/font-size; empty = keep original), image (URL to founder-hosted image + old/new preview; no uploads/storage in v1), hide (explainer).
- **`components/experiment-builder/GoalSection.tsx`** — click goal (pick element on canvas) or pageview goal (path like `/thank-you`).
- **`lib/experiments.ts`** — the only DB code: `createExperiment` inserts the experiment + Control/Variant rows (even weight split, orphan cleanup on failure), status `draft`. Selectors are lifted off the chosen `PageElement`s; the UI never handles them.

What we track per goal (deliberate limits — this is not analytics): **click goals** (visitor clicks a specific element) and **pageview goals** (visitor reaches a path — how form submits get tracked without touching the form). No bounce rate, scroll depth, or session metrics, ever.

## The JS Snippet (built, zero-flash as of 2026-07-11)

Vanilla JS installed as ONE synchronous tag first in the founder's `<head>`:
`<script src="…/api/snippet/js/SITE_ID"></script>` — that route serves the snippet
with the site's config baked in (edge-cached ~30s), so anti-flicker CSS and payloads
exist before first paint. No defer/async: a deferred script runs after paint is
possible, which is what causes the original→variant flash (the incumbents' trick is
sync-in-head too). Legacy `defer` + `data-site-id` installs still work via config fetch.
1. Anti-flicker: element-scoped `visibility:hidden` on targeted selectors only (2.5s failsafe); whole-page hide exists only on the legacy path's first visit (400ms cap).
2. Config ships inside the script (legacy: fetch, edge-cached per site).
3. Visitor ID: first-party cookie, random UUID. **Deterministic bucketing**: `hash(visitorId + experimentId) % 100` mapped onto variant weights — sticky across pages/visits with no server round-trip, independent across experiments.
4. Apply payload (text swap / styles / src swap / hide) + **MutationObserver re-apply** — React/Next sites wipe one-time DOM patches on hydration and client navigation.
5. Events: exposure (denominator!) + conversion, via `sendBeacon`, deduped by the DB unique index.
6. "Winner promotion" = snippet serves the winning variant at 100% forever (runtime mutation IS the implementation; founders can paste the winning copy into code at leisure).
7. **Bot filtering (2026-07-26).** Automated traffic still *gets* the variant and simply stops being counted — the gate is inside `sendEvent`, not around the apply loop, because serving bots a different page than humans is cloaking and a Google spam-policy violation. Detection is `lib/botFilter.ts`: ~100 lowercase UA substrings, matched client-side (list shipped in `__SW_EMBED__.bots`, so `snippet.js` carries the ~20 lines of matching logic but never the list — one source of truth, updatable on the config route's existing 30s edge TTL) and again server-side in `/api/snippet/event` against the real `User-Agent` header, which covers legacy installs and spoofed `navigator.userAgent`. Plus `navigator.webdriver`, PhantomJS/Nightmare/Cypress globals, and `?sw_optout=1` → sticky localStorage flag for the founder's own team. `selector_miss` is suppressed too, so a crawler that never finishes rendering can't trip the agent's health check and pause a healthy experiment.
   - **Deliberately not filtered on behaviour** (short sessions, no mouse movement, no interaction). Exposures are the denominator of every result and engagement is exactly what a variant changes, so an engagement-based filter drops more visitors from the winning arm — the documented way to invert an A/B result (Microsoft Research's SRM case study). Everything above is decidable before the visitor sees anything.
   - **Known ceiling:** stealth-plugin scrapers and agentic browsers (ChatGPT Atlas, Perplexity Comet, Claude-in-Chrome) send an ordinary Chrome UA and are undetectable this way by anyone. Left alone on purpose; revisit if they become a measurable share. Not built yet: datacenter-IP filtering, a `bot_reason` column for retroactive re-analysis, an SRM guardrail in the agent, and a "X% of traffic filtered" figure on the experiment page.

Known risks: strict CSP `connect-src` blocks the fetch (document it), selector staleness after redeploys (fallback text-match now, agentic re-crawl healing later), public event endpoint needs site-id validation + rate limiting.

## Statistics (the hard part of going agentic)

- Two-proportion z-test on unique visitors, but **never naive p-values on live-updating data** (peeking problem → false winners). Evaluate on a fixed schedule against a pre-committed sample size, or go sequential/Bayesian.
- Enforce minimum sample (~1k exposures/variant floor; detecting +10% lift at 95%: ~5–7k/variant on a 30% baseline, 10–15k/variant on a 2–3% baseline).
- Product implication: nudge founders toward high-baseline goals (CTA clicks, signup-page-reached) their traffic can actually resolve, and warn when it can't. Each extra variant splits traffic and stretches time-to-significance — recommend 2–3 arms max.
- **Surfaced honestly in the UI (2026-07-20):** the experiment detail page (`/dashboard/experiments/[id]`) never shows a bare lift. A verdict banner gives one status for the whole test — *gathering data* (progress toward the sample gate), *no significant difference yet*, *significant winner*, or *original holding up* — and each challenger card carries a muted `+X% vs control · not yet significant` chip that only turns green once `p<0.05` **and** every variant clears the sample floor. The client reuses `twoProportionZTest` from `lib/stats.ts` and the same `SAMPLE_FLOOR = 100` the agent evaluator uses, so the dashboard and the agent's own timeline can never disagree about whether a result exists.

## Deletion model (what cascades, what doesn't)

Verified empirically (2026-07-19 throwaway-user probe; see `app/api/account/delete/route.ts`):
- **Delete an experiment** → variants, events, agent_actions, and daily views all cascade off the `experiments` row. Clean, nothing orphaned. `deleteExperiment` (in `lib/experiments.ts`) is a single client-side delete, RLS-scoped to the owner — used by the two-step delete button on each Experiments card.
- **Delete a report/analysis** → comments do **not** cascade and Storage screenshots are never touched by SQL. So `POST /api/report/delete` (service role, verifies ownership from the caller's token) clears screenshots (`${report.id}/` bucket prefix) → comments → the report row. Experiments built from it keep running with `report_id → null` (by design). Fronted by `deleteReport` in `lib/reports.ts` and the two-step delete button on each Analyses card.
- **Delete the auth user** → cascades experiments (+ their children) and sites, but leaves reports/comments/screenshots orphaned — so `POST /api/account/delete` does the same manual screenshots → comments → reports cleanup before `auth.admin.deleteUser`. Fronted by the Settings danger-zone button.

## Build State & Order

**Done:** auth UI + Supabase client · analysis pipeline end-to-end (edge function) · report overlay UI (screenshot + comment pins + sidebar) · **Experiment Builder v1** (all of the above).

**In progress (founder):** dashboard UI — reports list, experiment cards, overview tab.

**Next (in order):**
1. **Runner snippet + endpoints** — `sites` + `experiment_events` tables, `public/snippet.js`, edge-cached config endpoint, event ingest, activate flow (draft → running). Closes the core loop; unblocks the Z Fellows demo.
2. **Results + honest stats** — per-experiment dashboard, fixed-horizon evaluation.
3. **Agentic layer** — AI comment → one-click experiment, winner auto-promotion + next-test queueing, selector self-healing (snippet reports miss → re-crawl → re-match by fallback text).
4. Later: compound variants (multi-element changes per variant), variant previews (Browserless render, then free via snippet edit mode), image uploads to Storage, Stripe revenue attribution, GA integration, billing.

## Key Decisions Log

| Decision | Rationale |
|----------|-----------|
| Browserless + Supabase Edge Function (not Playwright/Vercel) | Playwright can't run on Vercel free tier; edge functions get 150s vs 10s timeout |
| Screenshot + bounding-box builder (not iframe) | X-Frame-Options/CSP make iframes fail on exactly the sites we target; we already had aligned screenshot+DOM data |
| `nth-of-type` path selectors anchored at nearest `#id` | Unique by construction; tag+class selectors broke on Tailwind arbitrary values (`text-[22px]`) |
| Store `{tag, text}` fallback per element | Selector healing after founder redeploys |
| Experiment-scoped tracking (2 event types, experiment pages only) | ~1–2% of an analytics product's event volume → Supabase suffices, unlimited-tests pricing possible |
| Visitor-level event dedupe via DB unique index | Snippet fires naively; stats count rows; no dedup logic anywhere |
| Image tests = URL swap, no storage | No upload pipeline/moderation; standard industry approach |
| Elements as JSONB on reports (no separate table) | Read as one blob by the builder; never queried row-wise |
| Coordinates stored as percentages | Overlays stay accurate at any display size |
| reports.id is integer | Supabase default at creation; migrate to UUID before launch |

## Repo Structure (actual)

```
/app
  /dashboard
    page.tsx                    — dashboard shell (sidebar nav)
    /report/[id]
      page.tsx                  — report view (screenshot + pins + comment sidebar)
      /builder/page.tsx         — experiment builder
  /signin                       — auth UI
/components
  /report                       — ScreenshotOverlay, CommentPin, CommentSidebar
  /experiment-builder           — BuilderCanvas, BuilderSidebar, VariantFields, GoalSection
  /homepage                     — Hero, Navbar
  ProtectedRoute.tsx
/lib
  types.ts                      — Report, Comment, PageElement, Experiment, ExperimentVariant, payloads
  reports.ts                    — report/comment fetches
  experiments.ts                — createExperiment + fetches
  supabaseClient.ts
/services
  auth.ts, /context/authContext.tsx
/supabase/functions/analyze-page/index.ts   — the entire analysis pipeline
/public/assets                  — logos, graphics
```
