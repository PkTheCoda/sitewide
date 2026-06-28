# Phase 1: Overlay Pipeline

## Is this doable?

Yes. At its core this is:
- 1 API route that crawls a URL and calls Claude
- 2 DB tables + 1 storage bucket
- 3 React components (URL input, screenshot viewer, annotation pins)

Estimated build time: 3–5 focused sessions. The UI is the easy part — most of the complexity is in the crawl pipeline, and that's all addressed below.

---

## Services & Costs

| Service | Purpose | Cost |
|---|---|---|
| **Browserless** | Headless Chrome (screenshot + DOM) | Free tier: 1,000 sessions/month |
| **Claude API** | CRO analysis | ~$0.02–0.05 per analysis (Haiku 4.5) |
| **Supabase** | DB + Auth + Storage | Free tier covers MVP |
| **Vercel** | Hosting | Free tier won't work (10s timeout). Pro = $20/mo, OR use async job pattern (free) |

**No Firecrawl.** We extract page text in the same Browserless session — same Chrome instance already has the full rendered DOM. One less service, one less API key, zero extra cost.

**Async job pattern (free Vercel tier):** POST /api/analyze returns a job_id immediately. A Supabase Edge Function does the heavy work. Frontend polls for status. See "API Design" below.

**OR just use Vercel Pro ($20/mo)** and make it a single synchronous API route with `maxDuration = 60`. Much simpler code. Recommended for sanity.

---

## Data Flow (Complete, Production-Quality)

```
User submits URL
  ↓
POST /api/analyze
  ↓
Insert report row (status: "pending") → return report_id to frontend
  ↓ (background)
Step 1: Browserless — load page
  → autoScroll (triggers lazy-load content)
  → extract DOM elements (with stable numeric IDs)
  → capture full-page screenshot (webp)
  → extract page text (innerText of body, clean)
  ↓
Step 2: Upload screenshot → Supabase Storage → get public URL
  ↓
Step 3: Detect sections from class/id patterns (hero, features, pricing, etc.)
  ↓
Step 4: Build element summary for Claude
  → filter: visible, width > 50px, height > 20px, has text
  → skip: position fixed/sticky (navbars duplicate)
  → assign stable numeric id to each element
  → format: { id, tag, text, section, position_pct }
  ↓
Step 5: Claude API (Haiku 4.5 — cheapest, still great)
  → input: page_text + element_summary + section_map
  → output: { overall_score, comments: [{ element_id, ... }] }
  ↓
Step 6: Resolve comments → coordinates
  → elementMap[comment.element_id] → pixel coords
  → convert px → percentages (using stored viewport width)
  → add confidence score (tag match + section match)
  ↓
Step 7: Write to Supabase (reports + comments tables)
Update report row (status: "complete")
  ↓
Frontend polls → renders screenshot + annotation layer
```

---

## Crawl Implementation Details

### Viewport
```
width: 1440, height: 900
```
Store `viewport_width` with every report so old reports render correctly if we ever change it.

### autoScroll (must run BEFORE screenshot)
Scrolls the full page to trigger lazy-loaded images and content, then scrolls back to top before taking the screenshot. Order matters: scroll → screenshot → extract elements. All on the same page instance.

### Element Extraction Rules
- **Skip** if `width < 50` or `height < 20` (tiny invisible elements)
- **Skip** if no `innerText` and no `alt` (empty/icon-only elements)
- **Skip** if `position: fixed` or `position: sticky` (navbars float and misalign)
- **Dedup** by `(top, left)` position key — child elements often match multiple selectors
- **left adjustment**: `rect.left + window.scrollX` (not just `rect.left` — fixes horizontal scroll edge case)
- **top adjustment**: `rect.top + window.scrollY` (absolute position on full page)
- **Assign stable numeric `id`** at extraction time (0, 1, 2...) — Claude references these IDs, not text

### Selectors (in priority order)
```
h1, h2, h3, header, nav, footer, section, main,
button, a[href], form, img[alt],
[class*="hero"], [class*="cta"], [class*="feature"],
[class*="pricing"], [class*="testimonial"], [class*="trust"]
```

### Section Detection
Classify elements into sections by class/id pattern matching:
- `nav` / `navbar` / `header` → **nav**
- `hero` / `banner` / `jumbotron` → **hero**
- `feature` / `benefit` / `why` / `how` → **features**
- `testimonial` / `review` / `trust` / `logos` → **social_proof**
- `pric` / `plan` / `tier` → **pricing**
- `cta` / `signup` / `get-started` → **cta**
- `footer` → **footer**

Store section bounds (top/bottom px). Pass section map to Claude so it can say "your hero section is weak" — more useful than "this h1 is weak."

---

## What We Send Claude

```json
{
  "page_text": "...full innerText of the page, ~2000 chars...",
  "sections": {
    "hero": { "top_pct": "0%", "bottom_pct": "35%" },
    "features": { "top_pct": "35%", "bottom_pct": "65%" },
    "pricing": { "top_pct": "65%", "bottom_pct": "85%" }
  },
  "elements": [
    { "id": 0, "tag": "h1", "text": "Financial infrastructure for the internet", "section": "hero", "position": "18% from top" },
    { "id": 1, "tag": "button", "text": "Start now", "section": "hero", "position": "28% from top" },
    { "id": 2, "tag": "section", "text": "Payments...", "section": "features", "position": "40% from top" }
  ]
}
```

### Claude Prompt (condensed)
```
You are a CRO expert analyzing a landing page for conversion issues.

PAGE TEXT:
{page_text}

SECTIONS DETECTED:
{sections}

KEY ELEMENTS (reference by id):
{elements}

Return JSON:
{
  "overall_score": 1-10,
  "summary": "2-sentence overall assessment",
  "comments": [
    {
      "element_id": 1,
      "element_tag": "button",
      "section": "hero",
      "dimension": "CTA Clarity",
      "severity": "critical|warning|suggestion|positive",
      "comment": "what's wrong and why it hurts conversion",
      "suggestion": "specific fix",
      "rewrite": "improved copy if applicable"
    }
  ]
}

Rules:
- Reference elements ONLY by their numeric id
- Max 8 comments (most impactful only)
- Always include at least 1 "positive" comment
```

### Matching Comments → Coordinates
```
elementMap[comment.element_id] → { top, left, width, height }

confidence = 1.0
  - 0.3 if comment.element_tag !== element.tag
  - 0.2 if comment.section !== element's detected section

coords = {
  top_pct:    element.top    / pageHeight,
  left_pct:   element.left   / viewport_width,
  width_pct:  element.width  / viewport_width,
  height_pct: element.height / pageHeight
}
```
Low confidence (< 0.6): render with dashed border instead of solid.

---

## Database Schema

```sql
-- Reports: one per URL analysis
create table reports (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users not null,
  url         text not null,
  status      text default 'pending',  -- pending | processing | complete | error
  screenshot_url  text,
  page_height     int,
  viewport_width  int default 1440,
  overall_score   int,
  summary         text,
  error_message   text,
  created_at  timestamptz default now()
);

-- Comments: many per report
create table comments (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid references reports on delete cascade not null,
  element_id  int,     -- numeric id from extraction
  element_tag text,
  section     text,
  dimension   text,
  severity    text,    -- critical | warning | suggestion | positive
  comment     text,
  suggestion  text,
  rewrite     text,
  confidence  float,
  top_pct     float,
  left_pct    float,
  width_pct   float,
  height_pct  float,
  created_at  timestamptz default now()
);

-- RLS
alter table reports enable row level security;
alter table comments enable row level security;

create policy "users see own reports" on reports
  for all using (auth.uid() = user_id);

create policy "users see own comments" on comments
  for all using (
    report_id in (select id from reports where user_id = auth.uid())
  );
```

```
Supabase Storage bucket: "screenshots"
Policy: authenticated users can upload/read their own files
Path pattern: {user_id}/{report_id}.webp
```

---

## API Design

### Option A: Sync (Vercel Pro, $20/mo)
```
POST /api/analyze
  body: { url: string }
  returns: { report_id, screenshot_url, overall_score, comments[] }
  maxDuration: 60 (in route config)
```

### Option B: Async + Polling (Vercel free)
```
POST /api/analyze
  body: { url: string }
  returns: { report_id }     ← immediate, just creates the DB row
  
GET /api/analyze/[report_id]
  returns: { status, screenshot_url, overall_score, comments[] }
  
(background worker: Supabase Edge Function triggered by DB insert)
```

Recommend **Option A** for simplicity. $20/month is worth avoiding async complexity for phase 1.

---

## Frontend Components

### 1. URL Input Form
Simple: text input + "Analyze" button. Shows loading state while polling/waiting.

### 2. AnnotationViewer
```
<div style="position: relative">
  <img src={screenshot_url} style="width: 100%; height: auto" />
  <div style="position: absolute; inset: 0">
    {comments.map(c => <AnnotationPin key={c.id} comment={c} />)}
  </div>
</div>
```
The `position: relative` container + percentage-based pin positions = perfect alignment at any screen size. No JS math needed.

### 3. AnnotationPin
- Bounding box: `position: absolute`, sized/placed with `top/left/width/height` in `%`
- Numbered circle in top-left corner of the bounding box
- Color coded by severity: critical=red, warning=amber, suggestion=blue, positive=green
- Dashed border if `confidence < 0.6`
- Click → opens side drawer with full comment details

### 4. CommentDrawer
Slides in from the right. Shows: dimension, severity badge, comment text, suggestion, rewrite if present. "Close" button.

---

## Build Order

1. **DB migration** — create tables + storage bucket + RLS policies
2. **Browserless integration** — `POST /api/analyze`, crawl logic, upload screenshot
3. **Claude integration** — build prompt, parse response, resolve coordinates
4. **Save to Supabase** — write report + comments
5. **Dashboard URL input** — form + loading state + poll/wait
6. **AnnotationViewer** — screenshot + pin layer
7. **CommentDrawer** — side panel
8. **Report history** — list past analyses on dashboard

---

## What We're NOT Building Yet

- Firecrawl (not needed — we extract text from the same Chrome session)
- Raw HTML snapshot (add later for before/after diffing)
- Iframe live overlay (v2)
- Mobile viewport analysis (v2)
- Re-running analysis / version tracking (v2)
