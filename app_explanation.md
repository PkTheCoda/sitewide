# Sitewide — Full Project Reference

## What This Is

Sitewide is an agentic AI application that autonomously analyzes, tests, and optimizes the landing pages of early-stage startup founders (targeting $5K–$500K ARR). The core insight: founders at this stage are too busy (pitching VCs, talking to customers, shipping) to run CRO experiments themselves. Sitewide does it for them, automatically.

---

## The Value Chain

```
User's GA data          → tells us WHERE the problems are
Playwright crawl        → tells us WHAT is on the page
Claude API              → determines WHAT to change
Our JS snippet          → RUNS the experiment on real visitors
Our math               → picks the WINNER
```

Sitewide sits between the founder's analytics and their website — not replacing either, just acting as the brain that connects them.

---

## Product Tiers

| Tier | Requirement | What you get |
|------|------------|--------------|
| Free / Trial | URL only | AI suggestions based on page layout, copy, visual hierarchy, CTA placement — no analytics needed |
| Paid | URL + GA connected | Suggestions backed by real user data ("34% leave here", "users who scroll past pricing convert 2x more") |

---

## Tech Stack

| Tool | Purpose |
|------|---------|
| **Next.js 16 (App Router)** | Dashboard, API routes, landing page — all one repo |
| **Supabase** | Postgres database + Auth (Google OAuth) + Storage (screenshots) |
| **Playwright** | Headless browser: crawl founder's site, take screenshots, extract DOM |
| **Claude API** | The brain — analyzes page + analytics, returns structured suggestions |
| **Google Analytics Data API (GA4)** | Pull pageviews, bounce rate, session data via OAuth |
| **PostHog API** | Secondary analytics integration (v2) |
| **Vercel** | Deployment + Vercel Cron for scheduled jobs |
| **Resend** | Weekly digest emails to founders |

**No Redis, no queue system, no Kubernetes.** Deliberately simple stack.

---

## Database Schema (5 tables)

### `users`
Managed mostly by Supabase Auth.
- `id`, `email`, `created_at`

### `sites`
One row per founder's website.
- `id`, `user_id`, `url`
- `ga_property_id` — for GA4 OAuth connection
- `posthog_api_key`, `posthog_project_id` — for PostHog (v2)
- `snippet_installed` (boolean) — whether the founder has added the JS tag
- `created_at`

### `crawls`
One row per scan of a site.
- `id`, `site_id`, `page_url`
- `screenshot_url` — stored in Supabase Storage
- `dom_snapshot` (JSON) — extracted DOM structure (see below)
- `analytics_data` (JSON) — raw GA/PostHog data pulled at crawl time
- `crawled_at`

**DOM snapshot shape per element:**
```json
{
  "selector": "main > section:nth-child(2) > h1",
  "tag": "h1",
  "text": "Welcome to Our Platform",
  "boundingBox": { "x": 120, "y": 340, "width": 800, "height": 72 },
  "styles": { "fontSize": "48px", "color": "#111", "background": "transparent" }
}
```

### `suggestions`
One row per AI-generated suggestion, linked to a crawl.
- `id`, `crawl_id`, `site_id`, `page_url`
- `selector` — CSS selector of the target element
- `element_type` — heading | button | paragraph | image | section
- `suggestion_text` — the human-readable recommendation
- `variant_copy` — the suggested replacement text/content
- `estimated_impact` — high | medium | low
- `pin_x`, `pin_y` — coordinates on screenshot as **percentages** (0–100) for responsive overlay
- `status` — pending | testing | applied | dismissed
- `created_at`

### `experiments`
One row per A/B test derived from a suggestion.
- `id`, `suggestion_id`, `site_id`, `page_url`
- `selector`, `change_type` (text | style | classes)
- `original_value`, `variant_value`
- `traffic_percent` — % of visitors assigned to variant
- `status` — draft | preview | running | winner | loser | stopped
- `conversion_selector` — CSS selector for the element a conversion click targets
- `conversion_event_name`
- `started_at`, `ended_at`
- `results_json` — final stats: `{ controlConversions, variantConversions, controlVisitors, variantVisitors, significant: bool }`

---

## API Routes

### Onboarding
- `POST /api/sites` — register a site, save analytics credentials
- `POST /api/sites/[id]/crawl` — trigger Playwright crawl + analytics pull + Claude analysis → creates crawl record, stores screenshot, generates suggestions
- `GET /api/sites/[id]/suggestions` — fetch all suggestions for overlay dashboard

### Experiment Flow
- `POST /api/experiments` — create experiment from suggestion (status: draft)
- `POST /api/experiments/[id]/preview` — Playwright renders page with variant applied, returns screenshot for founder preview
- `POST /api/experiments/[id]/activate` — status → running; snippet starts serving it
- `POST /api/experiments/[id]/stop` — manual stop

### Snippet Endpoints (must be fast — called on every page load)
- `GET /api/snippet/config?site_id=X&page=Y` — returns active experiments for the page. **Aggressively cached (Vercel edge, 60s TTL)**
- `POST /api/snippet/event` — receives conversion events from the snippet (backup — primary tracking is our DB)

### Cron Jobs (Vercel Cron, run weekly)
- `POST /api/cron/evaluate` — checks all running experiments, runs significance math, declares winners/losers, applies winner as new default
- `POST /api/cron/analyze` — re-crawls sites, generates fresh suggestions
- `POST /api/cron/email` — sends weekly digest to founders via Resend

---

## The JS Snippet (what founders install)

~60–80 lines of vanilla JS. Placed in `<head>` of the founder's site.

**What it does on every page load:**
1. Fetch config from `/api/snippet/config?site_id=X&page=Y`
2. Assign visitor to control or variant (cookie-based for consistency across visits)
3. If variant: find element by selector, apply the change
4. Watch for click on `conversion_selector`, fire POST to `/api/snippet/event`

**Anti-flicker technique:** inject CSS hiding target elements → apply changes → unhide. Total time <50ms.

**What we track:** visitor ID, experiment ID, variant (A or B), converted (boolean), timestamp. That's it. Five columns. We are NOT building another analytics platform.

---

## The Claude Prompt (core IP)

This is where the most iteration will happen. Shape:

**System:** You are a senior conversion rate optimization analyst. You have deep expertise in landing page psychology, SaaS marketing, and A/B testing.

**User message includes:**
- Simplified DOM structure (tag, selector, text, bounding box position)
- Analytics data (pageviews, bounce rate, session duration, funnel data if available)
- Full-page screenshot (as image — Claude is multimodal)

**Output:** JSON array of suggestions:
```json
[
  {
    "selector": "main > section:nth-child(1) > h1",
    "element_type": "heading",
    "issue": "Hero headline is generic and doesn't communicate specific value",
    "suggestion_text": "Replace with outcome-focused headline that speaks to the ICP",
    "variant_copy": "Close Your First 10 Enterprise Deals in 90 Days",
    "estimated_impact": "high",
    "pin_x": 52.3,
    "pin_y": 18.7
  }
]
```

**The quality of suggestions = the quality of the product.** Everything else is plumbing.

---

## The Overlay UI (Phase 1.3)

The dashboard shows:
- Full-page screenshot as a large image
- Absolutely-positioned pin markers at `(pin_x%, pin_y%)` of the container
- Pin color = impact level: red (high), yellow (medium), green (low)
- Hover/click on pin → card showing issue, suggestion, variant copy, "Run Experiment" button
- Sidebar listing all suggestions as cards; clicking highlights corresponding pin

**Responsive pin math:** store coordinates as percentages of screenshot dimensions. Position pins with `left: pin_x%` and `top: pin_y%` on a relatively-positioned container. Stays accurate at any display size.

---

## Experiment Tracking (How It Actually Works)

We track experiments ourselves. No GA dependency for experiment measurement.

**Flow:**
1. Founder approves a suggestion → experiment created (draft)
2. Founder previews the variant (Playwright renders it, returns screenshot)
3. Founder activates → status = running
4. Our snippet serves the variant to ~50% of visitors, watches for conversion click
5. Weekly cron counts conversions per variant, runs significance math
6. Winner declared → applied as new default → next experiment queued

**Statistical significance:** basic two-proportion z-test. Simple formula, no external library needed for MVP.

**What we show founders:** "We tested headline A vs headline B. B won: 6.3% vs 4.8% conversion, statistically significant after 2,000 visitors. B is now live. Here's your next experiment." A results card, not a dashboard.

---

## Build Order

### Phase 1 — The Overlay Dashboard (Weeks 1–3)
**1.1 — Auth + Dashboard Shell**
- Supabase Auth with Google OAuth
- Post-login dashboard with "Add your site" flow
- Two-field form: URL + GA property ID
- Creates `sites` row, shows site card with "Ready to scan" status

**1.2 — Crawl + Analytics Pull**
- Playwright headless crawl: full-page screenshot + DOM extraction
- GA4 Data API: pageviews, bounce rate, session duration, funnel data
- Store screenshot in Supabase Storage
- Store DOM snapshot + analytics as JSON in `crawls`
- Feed to Claude API (DOM as text + screenshot as image)
- Parse Claude's JSON response → insert into `suggestions`

**1.3 — Overlay UI**
- Dashboard shows screenshot with absolutely-positioned pins
- Hover/click pins → suggestion cards
- Sidebar list of all suggestions
- "Run Experiment" button (grayed out — Phase 2)
- Clicking a sidebar card highlights the pin and vice versa

**Demoable at end of Phase 1:** Founder signs in, enters URL, clicks scan, waits 15–30s, sees their site with colored pins showing specific, analytics-backed suggestions.

---

### Phase 2 — The Experiment Engine (Weeks 4–6)
- Build the JS snippet file
- Build `/api/snippet/config` endpoint (with edge caching)
- Build `/api/snippet/event` endpoint
- Experiment creation, preview (Playwright render), activation flow
- Weekly evaluation cron job (significance math)
- Email notifications via Resend

---

### Phase 3 — Polish + Launch (Weeks 7–8)
- GA OAuth flow improvement / PostHog integration
- Better prompt engineering
- Onboarding flow improvements
- Landing page
- Billing with Stripe

---

## Key Decisions & Rationale

| Decision | Rationale |
|----------|-----------|
| GA over PostHog as primary | GA's install base is massive; almost every website has it |
| Self-tracking experiments (not GA) | Simpler, no OAuth scope creep, GA not designed for this specific use case |
| Store pin coords as percentages | Responsive — pins stay accurate at any display size |
| Aggressively cache snippet config | Called on every page load; must be fast |
| No Redis/queues for MVP | Vercel serverless + Supabase is sufficient for the scale of MVP |
| Playwright over Firecrawl/Browserless | Full control, runs in Node.js, no extra service dependency for MVP |

---

## Repo Structure (Target)

```
/app
  /dashboard          — main founder dashboard (sites, suggestions, experiments)
  /api
    /sites            — site registration + crawl trigger
    /experiments      — experiment CRUD + activate/preview/stop
    /snippet          — config + event endpoints (edge cached)
    /cron             — evaluate + analyze + email
  /auth               — Supabase Auth callback routes
/components           — shared UI components
/lib
  /playwright.ts      — crawl + DOM extraction logic
  /claude.ts          — Claude API prompt + response parsing
  /ga.ts              — GA4 Data API integration
  /supabase.ts        — Supabase client
  /stats.ts           — significance math
/public
  /snippet.js         — the installable JS tag (served statically)
```
