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

- [ ] `public/snippet.js` — the installable JS tag
- [ ] `GET /api/snippet/config` (edge cached, 60s TTL)
- [ ] `POST /api/snippet/event` (conversion tracking)
- [ ] Experiment creation flow (from suggestion → experiment row)
- [ ] `POST /api/experiments` route
- [ ] Playwright preview render → screenshot of variant
- [ ] `POST /api/experiments/[id]/preview` route
- [ ] Experiment activation flow
- [ ] `POST /api/experiments/[id]/activate` route
- [ ] `POST /api/experiments/[id]/stop` route
- [ ] Weekly evaluation cron (significance math, declare winner)
- [ ] `POST /api/cron/evaluate` route
- [ ] Apply winner as new default (update site's live copy)
- [ ] Resend email integration
- [ ] `POST /api/cron/email` route

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
