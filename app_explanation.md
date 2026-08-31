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

Everything happens in **`supabase/functions/analyze-page/index.ts`** (invoked with `{url}` for a new report or `{url, report_id}` to re-run one; `verify_jwt = true` and the caller is derived from the session JWT that supabase-js attaches — a body `user_id` is ignored, and `report_id` re-runs require ownership. Uses the service role key for writes, so RLS is bypassed. Browserless and Claude calls carry hard timeouts (70s / 60s) so a hung crawl marks the report `error` instead of leaving it `processing` forever):

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
- **`components/experiment-builder/BuilderSidebar.tsx`** — owns all form state. 5 steps: element → change (tabs switch by tag: img → Image/Hide, else Text/Style/Hide) → goal → details → time-to-decision. Auto-names from element text, validates every step before enabling submit, success panel after insert.
- **`components/experiment-builder/DecisionEstimator.tsx`** — step 5, the "will this test ever finish?" reality check. Founder enters monthly visitors + current conversion rate (the "expected impact" preset is GONE — founders couldn't answer it, and the sequential stats made it unnecessary); power math (`lib/stats.ts`) brackets an honest range, "~X days (big lift) – Y days (moderate lift)". Purely informational since the 2026-07-29 stats switch: the agent checks daily and stops the moment one version is confidently better, so there is no sample size to commit to — `createExperiment` just gets the flake-guard floor `DECISION_FLOOR` (500/arm) as `min_sample_size`. Framing is deliberately CALM; rose warning + nudge only when even a big lift would take >60 days. Advisory — never blocks submit.

The running-experiment page has the mirror of this: a **live time-to-decision countdown** (`app/dashboard/(shell)/experiments/[id]/page.tsx → estimatePace`), folded into the verdict banner. It uses the test's REAL accrual (slowest arm's exposures ÷ days running) instead of the builder's a-priori guess, so it's more accurate. Two regimes: while **collecting** it counts down to the sample floor; once **inconclusive** (past the floor, no call) it projects when the CURRENTLY OBSERVED lift would typically cross the agent's decision bar (classical power math as a rough ETA — nothing gates on it) — the case that matters most, since that's when a founder would otherwise wait forever on a gap that never resolves. Gated to ≥3 days of runtime (you can't read a reliable daily rate off ramp-up, and it keeps a wild number off day one); past 60 days it turns rose with an "end it or go bolder" nudge.
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

8. **Client-side navigation (2026-08-28).** `history.pushState`/`replaceState` are wrapped and `popstate` is listened to; on every real path change the snippet re-evaluates the page (applies the variant if it's now the experiment page, fires the pageview conversion if it's now the goal page, sends each event once per session). Click-goal listeners are bound once per experiment and check the path at click time. The previous page's MutationObserver loop is stopped on navigation, and applies re-check the path per experiment, so a path-style selector can't patch a same-shaped element on the next page. Without this, Next/React sites (the ICP) lost every conversion reached through the router.
9. **Endpoint guards (2026-08-28, `lib/snippetGuards.ts`).** Ids are validated as UUIDs before any query. `/api/snippet/event` is rate-limited per IP (60/min, per serverless instance — a speed bump, not a quota) and drops events whose `Origin` host isn't the experiment's site domain (apex/www equivalent; localhost allowed; no Origin = allowed). Experiment/variant ids are visible in the served script, so this is what stops a stranger — or a Vercel preview deploy — from writing into a pilot's results. The served config is deliberately NOT referer-dependent (edge cache keys on URL alone); the Referer only gates the `snippet_installed` heartbeat, which is now awaited.

Known risks: strict CSP `connect-src` blocks the fetch (document it), selector staleness after redeploys (fallback text-match now, agentic re-crawl healing later), Safari ITP's 7-day cap on JS-set cookies re-buckets long-consideration visitors.

## Statistics (the hard part of going agentic)

- **Bayesian sequential (2026-07-29, replaced the fixed-horizon z-test).** Beta–Binomial posteriors on unique visitors; `compareVariants` (`lib/stats.ts`) returns each challenger's `chanceToBeat` (P(variant > control | data), exact closed form, normal approximation past ~3k conversions) plus two expected-loss numbers. The agent acts only when a variant is ≥95% likely better (`DECISION_PROB`) **and** the expected cost of a wrong call is ≤0.05% of control's rate (`DECISION_MAX_RISK`) — the risk cap is what makes daily peeking safe (it effectively demands ~99.7% confidence on early data, relaxing toward 95% as posteriors tighten). Mirror-image rule ends tests whose variants are all confidently worse.
- **Harm gate (circuit breaker):** checked every run before the floor — a challenger with ≤1% chance of beating control is killed once both arms have `HARM_MIN_EXPOSURES` (150, raised from 25 on 2026-08-28; kills are irreversible and the A/A simulation showed the old floor false-killing 6.5% of identical variants under daily peeking at low traffic).
- **Why:** the old rule pre-committed a power-analysis sample size (founder had to guess an "expected lift" — 5,330/arm at the defaults) and could only look once that filled. Now big lifts conclude on a few hundred visitors and there's no founder-facing stats question at all. `min_sample_size` survives as a small flake-guard floor (`DECISION_FLOOR = 500/arm`; evaluator hard floor 100).
- **Verified by `scripts/test-bayes-stats.ts`** (`node scripts/test-bayes-stats.ts`, no server/DB): exact math vs Monte Carlo, plus daily-loop simulations — A/A false promotions ~6% over 40 daily peeks (each wrong call costing ≤0.05% of the conversion rate by construction), +50% lift resolves at median day ~7, +25% at median day ~19 at 150 visitors/arm/day.
- Product implication unchanged: nudge founders toward high-baseline goals (CTA clicks, signup-page-reached) their traffic can resolve. Each extra variant splits traffic and stretches time-to-decision — recommend 2–3 arms max.
- **Surfaced honestly in the UI (2026-07-20, reworded 2026-07-29):** the experiment detail page (`/dashboard/experiments/[id]`) never shows a bare lift. A verdict banner gives one status for the whole test — *gathering data* (progress toward the floor), *no clear winner yet*, *clear winner (N% sure)*, or *original holding up* — and each challenger card carries a muted `+X% vs control · N% sure` chip that only turns green once the agent's own decision rule fires. The client reuses `compareVariants` and the same floors the evaluator uses, so the dashboard and the agent's timeline can never disagree about whether a result exists.

## Analytics context — PostHog (2026-08-06)

Every pilot founder uses PostHog, so it's the first (and for now only) analytics connector; GA4 is deliberately later. **Hard boundary: this data is agent context only.** No charts, no analytics tab, and never an experiment goal or denominator — PostHog's visitor identity isn't ours, so mixing it into results would corrupt the stats. Self-tracked `experiment_events` remain the sole source of truth.

- **Connect** (Settings → Integrations, `IntegrationsCard.tsx`): personal API key (minimal `query:read` scope, single-project) + numeric project ID + region (US/EU cloud; custom host behind "advanced"). No OAuth. Validated with a `SELECT 1` against the Query API — 401/403/404 get distinct human messages (404 usually means wrong region). Ingestion hosts founders paste from their JS snippet (`us.i.posthog.com`) are auto-normalized to the private API hosts.
- **Storage**: `integrations` holds the connection — RLS enabled with ZERO policies, so the api_key is unreadable from any client by construction; all access is service-role through `app/api/integrations/posthog` (own-token auth, sanitized responses). `analytics_snapshots` holds one JSONB blob per site per day (top 25 pages, device split, top referrers/UTMs, top custom events, totals — 30-day window); founders can read their own via RLS.
- **Sync**: `/api/agent/sync-analytics`, daily Vercel cron at 08:00 UTC (the second Hobby slot; evaluate runs 09:00 so the agent reads fresh data). `lib/posthog.ts` runs 5 HogQL queries **sequentially** (PostHog caps 3 concurrent/project, shared with the founder's dashboards), explicit LIMIT on every query (the default is a silent 100-row cap), per-query try/catch so one timeout yields a partial snapshot. A failed site never fails the run: `integrations.status='error'` + an `analytics_sync_failed` agent_actions row, and consumers keep the previous snapshot.
- **Consumers** (all treat analytics as optional — no snapshot = pre-integration behavior, cold start intact): **analyze-page** looks the snapshot up server-side (never trusts the invoke body) and injects an ANALYTICS CONTEXT block into the prompt; **propose.ts** adds `page_analytics` to the context and the system prompt tells Claude to weight picks by real audience and cite numbers in the rationale; **DecisionEstimator** prefills "monthly visitors" from the page's real 30-day visitors (the question founders couldn't answer) with a "Prefilled from your PostHog" chip — typing over it always wins. The per-page summarization (`summarizeForPath` in `lib/analytics.ts`, mirrored inline in the edge fn) is shared so consumers can't disagree.
- **Known risk, accepted**: PostHog "strongly discourages" Query API use in production and pre-announced eventually charging for it (would land on the customer's PostHog bill, not ours). Our aggregate daily pull is far inside their limits (5 queries/day vs 2400/hr) and isn't the bulk-export pattern they prohibit; their blessed alternative (Endpoints) can't serve a paste-a-key integration. Revisit only if they start charging.
- **Frontend surfaces**: the connect form is one shared component (`PostHogConnectForm`) used in two places — the Settings Integrations card and an *optional* onboarding step (after snippet install; skippable, `?preview=posthog` in dev). The Analytics sidebar tab (`AnalyticsSection`) renders the latest snapshot read-only — totals, top pages, devices, sources, custom events — framed explicitly as "what your agent knows", with no charts/filters/date-pickers. Showing the agent's context builds trust; *being* an analytics product is still forbidden.
- Verified by `scripts/test-posthog.ts`: 18 pure checks (host/path normalization, per-page summarize math) plus an optional live layer against a real project via `POSTHOG_TEST_*` env vars.

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
