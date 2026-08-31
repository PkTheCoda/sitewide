# Sitewide — Build Progress

## Status: Phase 1.3 — Overlay UI In Progress

---

## Phase 1 — Overlay Dashboard

### 1.1 Auth + Dashboard Shell
- [x] Supabase client configured
- [x] Login + signup pages with form validation
- [ ] Google OAuth
- [ ] Protected dashboard layout
- [ ] "Analyze your site" URL input form on dashboard

### 1.2 Crawl Pipeline
- [x] Supabase Storage bucket (`screenshots`)
- [x] `reports` + `comments` tables in Supabase (with RLS)
- [x] Supabase Edge Function `analyze-page`: Browserless screenshot + DOM extraction → Claude API → coordinates resolved → writes to DB
- [x] Full pipeline proven end-to-end (tested on stripe.com, talem.org)
- [x] Switched from Playwright to Browserless (avoids Vercel timeout/binary issues)
- [ ] `POST /api/analyze` Next.js route (thin wrapper — inserts report row, fires Edge Function)

### 1.3 Overlay UI
- [ ] `app/dashboard/report/[id]/page.tsx` — fetches report + comments
- [ ] `AnnotationViewer.tsx` — screenshot with absolute overlay layer
- [ ] `CommentPin.tsx` — bounding box + numbered circle at percentage coords
- [ ] `CommentSidebar.tsx` — right panel, comment cards with severity badges
- [ ] Bidirectional highlight: click sidebar card ↔ highlights pin
- [ ] URL input form → triggers pipeline → loading state → redirects to report page

---

## Phase 2 — Experiment Engine

### 2.0 Experiment Builder (done)
- [x] Edge function: robust unique selectors (`nth-of-type` path walker) + text fallback per element
- [x] Edge function: expanded element capture (p, a, li, label, img) + persist `elements` JSONB to reports
- [x] `experiments` + `experiment_variants` tables (with RLS)
- [x] `lib/experiments.ts` — createExperiment (control + weighted variants), fetch helpers
- [x] Builder UI at `/dashboard/report/[id]/builder`: hover hit-test canvas (smallest-box-wins), change types (text/style/hide), click + pageview goals, draft submit
- [x] Image change type (URL swap, no storage) — img targets get Image/Hide tabs only
- [x] Rich-text warning: `hasMarkup` flag captured; heading spans selectable as their own elements
- [x] Time-to-decision estimator (builder step 5): traffic + baseline rate → an honest "~X days (big lift) – Y days (moderate lift)" range. Purely informational since the 2026-07-29 Bayesian switch — the "expected impact" preset is gone and `min_sample_size` is just the `DECISION_FLOOR` (500/arm) flake guard, not a commitment. Deliberately CALM (shown pre-commitment); rose warning + nudge only when even a big lift takes >60 days.
- [x] Live time-to-decision countdown on the running experiment page (`experiments/[id]/page.tsx → estimatePace` + `SignificanceBanner`), off REAL accrual (slowest arm's exposures ÷ days running) so it beats the builder's a-priori guess. TWO regimes: (1) collecting → time to reach the sample gate; (2) inconclusive → past the gate but no winner, projects the sample needed to make the OBSERVED lift significant (95%/80%) so a founder stuck on "test continues" gets a real keep-going-vs-give-up number. Gated to ≥3 days of runtime; rose + "end it / go bolder" nudge past 60 days.
- Later: compound variants (multi-element changes per variant), variant preview (Browserless render or snippet edit mode), selector self-healing when snippet reports a miss

### 2.1 Runner + Agent skeleton (done 2026-07-06)
- [x] `public/snippet.js` — visitor ID cookie, deterministic FNV-1a bucketing, DOM apply (text/style/src/hide) + MutationObserver re-apply (starts pre-parse on documentElement, disconnects after 10s post-apply grace), exposure+conversion via sendBeacon, winner serving at 100%
- [x] Zero-flash install (2026-07-11) — `GET /api/snippet/js/[siteId]` serves the snippet with the site's config baked in (edge-cached 30s), installed as one sync tag first in `<head>`: anti-flicker CSS exists before first paint → no whole-page hide, no flash, and config changes land in ~30s instead of one-page-load-later. Verified frame-by-frame in real Chrome (Browserless): 0 flash frames on sync install, textParts styling preserved, hydration rewrites re-patched, preview links + legacy `defer` installs still work. Element-scoped hide failsafe 2.5s; legacy whole-page hide still capped at 400ms
- [x] `GET /api/snippet/config` (CORS-open, edge cached 60s, snippet_installed heartbeat) — legacy path + background refresh; config building shared via `lib/snippetConfig.ts`
- [x] `POST /api/snippet/event` (validates experiment/variant, upsert w/ ignoreDuplicates — DB dedupes per visitor)
- [x] `POST /api/agent/evaluate` — the agent loop: perceive (unique exposures/conversions) → decide (sample floor + Bayesian sequential rule) → act (promote winner / keep control / continue) → log to `agent_actions`
- [x] `lib/stats.ts` (Bayesian sequential: `compareVariants` → chanceToBeat + expected-loss risks; verified by `scripts/test-bayes-stats.ts`), `lib/supabaseAdmin.ts` (service role, server-only)
- [x] **Bayesian sequential stats (2026-07-29)** replacing the fixed-horizon z-test: agent decides when a variant is ≥95% likely better AND cost-if-wrong ≤0.05% of the conversion rate — safe under daily checks, no pre-committed sample size, impact preset removed from the builder. Legacy experiments keep their stored `min_sample_size` until reset (SQL: `update experiments set min_sample_size = 500 where min_sample_size > 500;`)
- [x] Activation flow: `activateExperiment` upserts `sites` row by domain, links experiment, snippet install instructions UI
- [x] Dashboard sections (no routing): Overview (working analyze bar → edge fn → redirect to report), Analyses (report cards), Experiments (expandable cards w/ variants + live results + activate/pause)
- [x] Vercel cron for `/api/agent/evaluate` — DAILY (`0 9 * * *`) as of 2026-07-17; was weekly and silently 401'd on 2026-07-13 (CRON_SECRET missing in Vercel env — fixed 2026-07-14)
- [ ] Rate limiting on event ingest
- [ ] Resend email digest (`POST /api/cron/email`)
- [ ] AI comment → one-click experiment
- [ ] Selector self-healing loop (agent now DETECTS + pauses on misses; re-crawl/re-match still to do)

### 2.2 Agent hardening (done 2026-07-17) — see roadmap.md Phase 1
- [x] Circuit breaker: harm gate on every daily run — challenger losing at p<0.01 (≥25 exposures/arm) is stopped pre-min-sample; all-harmful → complete w/ control, some → `killed_at` (variant keeps bucket range, snippet serves control experience, no events). Win gate unchanged: fixed horizon, p<0.05
- [x] Heartbeats: `run_started`/`run_finished` agent_actions rows (null experiment_id) per run — a missing heartbeat is the cron alarm
- [x] Selector-miss: snippet beacons `selector_miss` at 8s unapplied; agent pauses (`paused_broken`) at ≥5 miss visitors AND ≥20% of variant exposures
- [x] Proposal failures/skips logged (`proposal_failed`/`proposal_skipped`)
- [x] min_sample_size floor 100 in the evaluator (agent drafts now get `DECISION_FLOOR` = 500)
- [x] `POST /api/agent/propose` dry-run health check for the proposal pipeline (verified live: Claude proposed against real report, wrote nothing)
- [x] Migration `20260717_agent_hardening.sql`; supabase migration history repaired — `db push` works from CLI now
- [x] Tests: 21 API/DB assertions (synthetic experiments through real routes) + 8 jsdom snippet assertions, all passing
- [ ] Playwright/Browserless variant preview render

### 2.3 Results UI + data management (in progress)
- [x] Per-experiment detail page (`/dashboard/experiments/[id]`): variant cards, per-variant + total daily-activity charts, agent activity timeline
- [x] Honest verdict surfacing on the detail page (2026-07-20; Bayesian wording 2026-07-29) — a verdict banner (gathering data / no clear winner yet / clear winner N% sure / original holding up) + a muted per-variant confidence chip (`+X% vs control · N% sure`, only green once the agent's decision rule fires AND the sample floor clears). Reuses `lib/stats.ts → compareVariants` and the same floors the agent uses, so the UI can never contradict the agent timeline. Kills the "two big rates side-by-side reads as a winner" credibility risk before pilots
- [x] Full account deletion — `POST /api/account/delete` (own-token auth; clears Storage screenshots → comments → reports by hand, then deletes the auth user which cascades experiments+sites); Settings danger-zone two-step delete button
- [x] Delete a single experiment — `deleteExperiment` (client, RLS-scoped; cascades variants/events/agent_actions/daily-views) + two-step delete button on each Experiments card
- [x] Delete a single analysis — `POST /api/report/delete` (own-token auth, verifies report ownership; clears screenshots → comments → report; experiments keep `report_id → null` by design) + two-step delete button on each Analyses card
- [x] Bot filtering (2026-07-26) — `lib/botFilter.ts` (~100 UA substrings) shipped in `__SW_EMBED__.bots` so the list is shared with the server and never lives in `snippet.js`; snippet also checks `navigator.webdriver` + automation globals + `?sw_optout=1` sticky opt-out for internal traffic; `/api/snippet/event` re-checks the real `User-Agent` header before any DB work. Bots still GET the variant (skipping it would be cloaking) and send zero events, `selector_miss` included. **No behavioural filtering** — engagement is what the variant changes, so filtering on it can invert a result. 18 new jsdom assertions incl. false-positive guards (Cubot phones, YaBrowser, in-app webviews)
- [ ] Bot filtering v2 (only if the data asks for it): `bot_reason` column for retroactive re-analysis, SRM guardrail in the agent, "X% of traffic filtered" on the experiment page, datacenter-IP ranges
- [ ] Playwright/Browserless variant preview render

### 2.4 PostHog integration (built 2026-08-06, pre-pilot)
Read-only analytics context for the agent — every pilot founder is on PostHog. Personal API key (`query:read` scope) + project ID + region, no OAuth. **Agent context only: never a dashboard, never an experiment metric** (self-tracked events stay the sole source of truth for results).
- [x] Migration `20260806_posthog_integration.sql`: `integrations` (RLS on, ZERO policies — the api_key is server-only by construction) + `analytics_snapshots` (one JSONB blob per site per day, owner-read RLS)
- [x] `lib/posthog.ts` — Query API client (HogQL, plain fetch): sequential queries (3-concurrent project cap), explicit LIMIT everywhere (default is a silent 100 rows), per-query try/catch → partial snapshots, ingestion-host normalization (`us.i.posthog.com` → `us.posthog.com`), 401/403/404 mapped to human messages (404 = wrong region, the predicted #1 support ticket)
- [x] `app/api/integrations/posthog` — connect (validate via `SELECT 1` + first snapshot inline) / sanitized status / disconnect; own-token auth like report-delete; key never returned
- [x] Settings → Integrations card (`IntegrationsCard.tsx`): region/project/key form with least-privilege instructions, connected row with sync status, two-click disconnect
- [x] `/api/agent/sync-analytics` daily cron 08:00 UTC (the spare Hobby slot; evaluate at 09:00 reads fresh data) — per-site best-effort, failures → `integrations.status='error'` + `analytics_sync_failed` agent_actions row
- [x] Consumers: `propose.ts` (`page_analytics` in context + prompt rule to cite real numbers), analyze-page edge fn (server-side lookup → ANALYTICS CONTEXT prompt block; never trusts the invoke body), DecisionEstimator (monthly-visitors prefill from real traffic + "Prefilled from your PostHog" chip)
- [x] `scripts/test-posthog.ts` — 18 pure checks (host/path normalization, summarize math) + optional live layer against a real project (`POSTHOG_TEST_*` env vars)
- [x] Frontend surfaces (2026-08-06, same day): `PostHogConnectForm` extracted and shared between Settings and a new OPTIONAL onboarding step (after snippet install, own progress dot, fully skippable — `?preview=posthog` works in dev); Analytics tab placeholder replaced with `AnalyticsSection` — a read-only "what your agent knows" view of the latest snapshot (totals, top pages, devices, sources, events). Deliberately NOT an analytics product: no charts, no date pickers, no filters — it exists so founders can see and trust the agent's context, with an explicit "want analytics? that's what PostHog is for" line
- [ ] Verify live against a real PostHog project (results array shape confirmed empirically)
- [ ] GA4 connector (later — PostHog covers the current ICP; GA4 skews enterprise)

### 2.5 Capture hardening (2026-08-07, found in pre-pilot QA — needs `supabase functions deploy analyze-page`)
Two site-dependent capture failures surfaced by QA (reports #47 slashy.com, #48 upahead.online); talem.org always fine. Root causes + fixes, all in `analyze-page`'s EXTRACT_SCRIPT + Deno post-processing, verified against live Browserless on all three sites:
- [x] **Viewport silently reverting** (#48: stored 1440 but screenshot was 800 = Puppeteer's default → "zoomed" display, misaligned pins). Fix: `deviceScaleFactor: 1` + re-assert `setViewport` after `goto`, and — the real defense — **store measured geometry, never constants**: `viewport_width` = `documentElement.clientWidth` at capture, `page_height` derived from the actual webp's dimensions (header parsed in Deno) converted into coordinate space. Warns to logs on mismatch.
- [x] **Scroll-hijacking pages captured as one blank viewport** (#47: html/body/wrappers pinned `position:fixed; overflow:hidden; height:900px`, real 10k-px content clipped inside, Framer-style absolute sections). Fix chain (each step was necessary): detect by symptom (window can't scroll but rendered content ≫ viewport) → unlock the ENTIRE ancestor chain of the tallest content element with explicit pixel heights (`auto` collapses to 0 with absolutely-positioned sections; one surviving clipper anywhere re-clips the paint) → scroll via `scrollingElement` with a live-read height + 16k cap → freeze `requestAnimationFrame` and force-reveal inline `opacity:0; translateY(≤120px)` scroll-animation staging (opacity only — `display:none`/`visibility:hidden`/fixed elements stay hidden; big transforms like carousel tracks untouched).
- [x] CSS zoom neutralized on html/body (Chrome 128+ zoom desyncs getBoundingClientRect from captured pixels).
- [x] Elements fully outside the horizontal viewport skipped at capture (carousel clones/marquee overflow — #48 had content to x=4300 polluting the element list and Claude's context).
- [x] Verified end-to-end via scratchpad Browserless runs: all three sites now geometry-consistent AND visually complete (slashy renders every section; upahead at true 1440).
- Old broken reports keep their bad stored data (fix is capture-time) — delete + re-analyze them.

### 2.6 Pilot-readiness fixes (2026-08-28, from a full-platform audit — needs `supabase functions deploy analyze-page` + Vercel env)
Six "actively wrong" findings fixed; cosmetic/dead-UI items from the same audit deliberately deferred.
- [x] **Snippet SPA navigation** (`public/snippet.js`): `pushState`/`replaceState`/`popstate` hooked; page evaluation (variant apply, exposure, pageview conversion) re-runs on every real path change; click-goal listener bound once per experiment and checks the path at click time; previous page's apply loop is stopped on navigation and `applyAll` re-checks the path per item so a same-shaped selector can't patch the next page; per-session event dedupe; `selector_miss` skipped if the visitor navigated away before 8s. 18 new jsdom cases (`scripts/test-snippet.mjs`, 44 total). Before this, Next/React sites lost every pageview conversion reached via the router.
- [x] **`analyze-page` auth**: `verify_jwt = true`; caller derived from the session JWT (`supabase.auth.getUser`), body `user_id` ignored, `report_id` re-runs require ownership, URL validated. Previously anyone with the anon key could run analyses on our bill and write reports into any dashboard.
- [x] **Stuck `processing` reports**: `AbortSignal.timeout` on Browserless (70s) and Claude (60s) calls with human error text; Analyses list treats `processing` older than 5 min as failed and offers Retry (`reanalyzeReport` → same row).
- [x] **Public endpoint guards** (`lib/snippetGuards.ts`): UUID validation on site/experiment/variant ids (junk → empty config / 400, never a 500); `/api/snippet/event` rate-limited per IP (60/min, per instance) and rejects events whose `Origin` host isn't the experiment's site domain (www/apex tolerant, localhost allowed) — preview deploys and copied tags show variants but never count; heartbeat awaited and only bumped by requests whose Referer is the site's own domain. Config served is NOT referer-dependent (edge cache keys on URL only).
- [x] **Agent liveness visible**: `GET /api/agent/status` (own-token auth, service role) reads the null-experiment heartbeat rows the RLS feed can't see; Overview "Agent health" card goes rose past 30h without a run and surfaces email failures with the reason.
- [x] **Harm gate floor 25 → 150 exposures/arm** (`HARM_MIN_EXPOSURES`, now in `lib/stats.ts`); new harm-gate A/A simulation in `scripts/test-bayes-stats.ts` (false kills 6.5% → 4.3% at 25 visitors/arm/day over 60 peeks; a −40% variant still killed 100% by median day 8).
- [x] **Email sender guard**: `EMAIL_FROM` unset → every send returns `{sent:false}` with a reason naming the fix (Resend's shared sender only delivers to the account owner — founder's inbox worked, pilots' would not).
- [x] `scripts/test-agent.mjs` extended (39 live checks): origin/UUID/heartbeat guards, harm-floor case D, EMAIL_FROM expectation.
- [ ] **Founder**: verify a sending domain in Resend; set `EMAIL_FROM` + `APP_URL` in Vercel; `supabase functions deploy analyze-page`.
- [ ] Safari ITP caps JS-set cookies at 7 days → long-consideration visitors re-bucket as new; consider a localStorage mirror for `sw_vid` (post first pilot data).

---

## Phase 3 — Polish + Launch

- [ ] GA4 connector (demoted — see 2.4; PostHog is primary now)
- [ ] Prompt engineering iteration
- [ ] Onboarding improvements
- [ ] Landing page
- [ ] Stripe billing

---

## Completed

- Auth UI (login + signup pages, form validation)
- Supabase client + DB tables (`reports`, `comments`) + Storage bucket
- Full crawl pipeline (Browserless + Claude + coordinate resolution) as Supabase Edge Function
- End-to-end test: URL in → screenshot + 8 CRO comments with pixel coords out → stored in DB

---

## Notes / Decisions Log

| Date | Decision | Reason |
|------|----------|--------|
| 2026-06-06 | Chose GA over PostHog as primary analytics source | Broader install base across all startup websites |
| 2026-06-06 | Self-tracking experiments (not GA) | Simpler, avoids OAuth scope creep, GA not designed for A/B tracking |
| 2026-06-06 | Playwright over Firecrawl/Browserless | Full control, no extra service dependency for MVP |
| 2026-06-28 | Switched to Browserless + Supabase Edge Function | Playwright can't run on Vercel free tier; Edge Functions have 150s timeout vs 10s |
| 2026-06-28 | Two parallel Browserless calls (/screenshot + /function) | Avoids Buffer/base64 encoding issues in sandboxed Deno environment |
| 2026-06-28 | reports.id is integer (not UUID) | Created table with Supabase default; migrate to UUID before launch |
| 2026-06-06 | Store pin coords as percentages | Pins stay accurate at any display size |
| 2026-07-11 | Analysis prompt overhaul: Haiku → Sonnet 5 (ANALYZE_MODEL env override), 8-10 comment quota → 3-8 quality-gated, structured outputs (json_schema) replacing JSON prompt hacks, gold/anti few-shot examples | Analysis is the founder's first impression; quota was forcing weak findings; structured outputs delete a whole class of parse failures |
| 2026-07-20 | Surface significance as a verdict banner + muted per-variant chip, never a bare green lift, gated on the agent's own z-test + `SAMPLE_FLOOR` | Two raw conversion rates side-by-side at ~50–80 visitors read as a result the sample can't back — single biggest pre-pilot credibility risk. Sharing the agent's math keeps UI and timeline consistent |
| 2026-07-20 | Single-report delete goes through a service-role API route (like account delete), not client SQL | Reports don't cascade comments and Storage screenshots aren't touched by SQL; the admin route is the only place that can clean all three. Experiments intentionally survive with `report_id → null` |
| 2026-07-29 | Bayesian sequential stats (chanceToBeat ≥95% + expected loss ≤0.05% of control's rate) replace the fixed-horizon z-test; impact preset deleted from builder; `min_sample_size` demoted to a 500/arm flake-guard floor | Founders couldn't answer "expected impact", and the power-analysis gate made every test wait ~5k+/arm regardless of how decisive the data was. The risk-capped sequential rule is honest under the agent's daily checks (Monte Carlo verified: A/A false promotions ~6%/40 peeks at ≤0.05% cost each; +50% lift resolves median day ~7, +25% median ~19 at 150/arm/day) |
| 2026-08-06 | PostHog first, GA4 later (reverses 2026-06-06 "GA over PostHog") | ICP evidence from pilot conversations: every pilot founder uses PostHog; GA4 skews enterprise. PostHog also needs no OAuth (personal API key + `query:read` scope), vs the GA OAuth flow that's been stuck in "later" since June |
| 2026-08-06 | Analytics = agent context only, synced daily into one JSONB snapshot per site | The anti-scope-creep rule holds: no charts, no analytics tab, never an experiment denominator (visitor-ID mismatch would corrupt the stats). Data feeds three prompts/prefills: analyze-page, propose, DecisionEstimator |
