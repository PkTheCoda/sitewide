# Sitewide — Build Progress

## Status: Phase 1.1 — Not Started

---

## Phase 1 — Overlay Dashboard

### 1.1 Auth + Dashboard Shell
- [ ] Install and configure Supabase client (`@supabase/supabase-js`, `@supabase/ssr`)
- [ ] Set up Google OAuth in Supabase dashboard
- [ ] Auth callback route (`/app/auth/callback/route.ts`)
- [ ] Middleware for session management
- [ ] Login page (Google sign-in button)
- [ ] Protected dashboard layout
- [ ] "Add your site" form (URL + GA property ID)
- [ ] `POST /api/sites` route — creates `sites` row in DB
- [ ] Dashboard home: list of sites as cards with status

### 1.2 Crawl + Analytics Pull
- [ ] Install Playwright (`npm install playwright`)
- [ ] Playwright crawl utility: headless browser → full-page screenshot + DOM extraction
- [ ] Supabase Storage bucket for screenshots
- [ ] GA4 Data API integration (OAuth + data pull)
- [ ] `POST /api/sites/[id]/crawl` route (orchestrates crawl + analytics + Claude)
- [ ] Claude API integration — prompt construction + response parsing
- [ ] Insert suggestions into DB from Claude response
- [ ] "Scan my site" button on dashboard → triggers crawl

### 1.3 Overlay UI
- [ ] Screenshot display component (full-width image container)
- [ ] Pin component — absolutely positioned, color-coded by impact
- [ ] Responsive pin math (percentages → `left/top` CSS)
- [ ] Suggestion card (tooltip on hover/click: issue, suggestion, variant copy)
- [ ] Sidebar list of all suggestions (cards)
- [ ] Bidirectional highlight: click sidebar card ↔ highlights pin
- [ ] "Run Experiment" button placeholder (disabled, Phase 2)
- [ ] `GET /api/sites/[id]/suggestions` route

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

_(nothing yet — project just initialized)_

---

## Notes / Decisions Log

| Date | Decision | Reason |
|------|----------|--------|
| 2026-06-06 | Chose GA over PostHog as primary analytics source | Broader install base across all startup websites |
| 2026-06-06 | Self-tracking experiments (not GA) | Simpler, avoids OAuth scope creep, GA not designed for A/B tracking |
| 2026-06-06 | Playwright over Firecrawl/Browserless | Full control, no extra service dependency for MVP |
| 2026-06-06 | Store pin coords as percentages | Pins stay accurate at any display size |
