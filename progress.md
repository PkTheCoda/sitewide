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
- Later: compound variants (multi-element changes per variant), variant preview (Browserless render or snippet edit mode), selector self-healing when snippet reports a miss

### 2.1 Runner + Agent skeleton (done 2026-07-06)
- [x] `public/snippet.js` — visitor ID cookie, deterministic FNV-1a bucketing, DOM apply (text/style/src/hide) + MutationObserver re-apply (starts pre-parse on documentElement, disconnects after 10s post-apply grace), exposure+conversion via sendBeacon, winner serving at 100%
- [x] Zero-flash install (2026-07-11) — `GET /api/snippet/js/[siteId]` serves the snippet with the site's config baked in (edge-cached 30s), installed as one sync tag first in `<head>`: anti-flicker CSS exists before first paint → no whole-page hide, no flash, and config changes land in ~30s instead of one-page-load-later. Verified frame-by-frame in real Chrome (Browserless): 0 flash frames on sync install, textParts styling preserved, hydration rewrites re-patched, preview links + legacy `defer` installs still work. Element-scoped hide failsafe 2.5s; legacy whole-page hide still capped at 400ms
- [x] `GET /api/snippet/config` (CORS-open, edge cached 60s, snippet_installed heartbeat) — legacy path + background refresh; config building shared via `lib/snippetConfig.ts`
- [x] `POST /api/snippet/event` (validates experiment/variant, upsert w/ ignoreDuplicates — DB dedupes per visitor)
- [x] `POST /api/agent/evaluate` — the agent loop: perceive (unique exposures/conversions) → decide (min sample + two-proportion z-test) → act (promote winner / keep control / continue) → log to `agent_actions`
- [x] `lib/stats.ts` (z-test + normal CDF), `lib/supabaseAdmin.ts` (service role, server-only)
- [x] Activation flow: `activateExperiment` upserts `sites` row by domain, links experiment, snippet install instructions UI
- [x] Dashboard sections (no routing): Overview (working analyze bar → edge fn → redirect to report), Analyses (report cards), Experiments (expandable cards w/ variants + live results + activate/pause)
- [ ] Vercel cron config for weekly `/api/agent/evaluate`
- [ ] Rate limiting on event ingest
- [ ] Resend email digest (`POST /api/cron/email`)
- [ ] AI comment → one-click experiment
- [ ] Selector self-healing loop (snippet reports miss → re-crawl → re-match)
- [ ] Playwright/Browserless variant preview render

---

## Phase 3 — Polish + Launch

- [ ] Improved GA OAuth flow
- [ ] PostHog integration (secondary analytics)
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
