# The Experiment Lifecycle & Agent Loop — Complete Reference

> Everything about how an experiment goes from "created in the builder" to
> "winner served to every visitor," with exact file names, exact decision
> rules, and exact timing. If tracking or the agent ever behaves confusingly,
> the answer is in here.

---

## The state machine (one experiment's whole life)

```
 draft ──Activate──▶ running ──agent finds winner──▶ completed (winner_variant_id set)
   ▲                  │  ▲                                │
   │                  │  └──Resume────┐                   │
 builder creates    Pause ──────▶ paused                  ▼
                                              snippet serves winner to 100%
                                              forever (row is NOT deleted)
```

- **draft** — exists in the DB, does nothing anywhere. The snippet never sees it
  (the config endpoint only returns `running` + `completed`-with-winner).
- **running** — the snippet splits traffic and tracks events for it.
- **paused** — invisible to the snippet again (takes ≤60s to take effect — see
  "cache timing" below). Events stop; existing data is kept.
- **completed** — terminal. `winner_variant_id` points at the winning variant.
  **The experiment is never deleted** — it stays in the table because:
  1. the snippet needs it to keep serving the winner,
  2. the events + agent_actions attached to it are the proof of the result,
  3. the dashboard shows it as a finished test with its numbers.

---

## Phase 1 — Creation (the builder)

Files: `components/experiment-builder/*`, `lib/experiments.ts → createExperiment`

The founder clicks an element on the report screenshot, defines the change and
the goal, submits. Two inserts happen:

1. **`experiments`** — one row: which element (`selector` + `selector_fallback`),
   which page (`page_url`), what kind of change (`change_type`), what counts as
   success (`goal_type` + `goal_selector`/`goal_page_path`), who owns it
   (`user_id`), where it came from (`report_id`). Status: **`draft`**.
   `site_id` is **null** at this point — no site row exists yet.
2. **`experiment_variants`** — one row per version:
   - position 0: `Control`, `is_control: true`, `payload: null` ("change nothing")
   - position 1+: `Variant B`, `Variant C`… with payloads like
     `{"text": "New headline"}` / `{"styles": {"color": "#fff"}}` /
     `{"src": "https://..."}` / `{"hide": true}`
   - `weight` = the % of visitors this version gets. Split evenly:
     2 versions → 50/50, 3 → 34/33/33 (remainder goes to control).

## Phase 2 — Activation (the dashboard)

Files: `components/dashboard/ExperimentCard.tsx`, `lib/experiments.ts → activateExperiment`

Yes — the founder must click **Activate** on the experiment card. That triggers:

1. Parse the domain out of `page_url` (e.g. `talem.org`).
2. Find-or-create the **`sites`** row for `(user_id, domain)`. First activation
   on a domain creates it; later activations reuse it.
3. Update the experiment: `site_id` set, `status = 'running'`, `started_at` stamped.
4. The UI shows the install snippet:
   `<script defer src="https://OUR-APP/snippet.js" data-site-id="SITE_ID"></script>`

**Critical nuance:** activating does *nothing on the founder's website by
itself*. A running experiment is just a row until the founder's site actually
loads our snippet. Activate = "make it available to the snippet." The
`sites.snippet_installed` flag (set by the config endpoint the first time the
snippet phones home) is how we know the tag is really live.

## Phase 3 — Serving & tracking (the snippet, every page load)

Files: `public/snippet.js`, `app/api/snippet/config/route.ts`, `app/api/snippet/event/route.ts`

Here is EXACTLY what happens when any visitor loads any page of the founder's
site:

1. **Anti-flicker:** snippet injects `html { opacity: 0 }` immediately, with a
   400ms failsafe timer so a slow config fetch can never blank the site.
2. **Visitor identity:** read the `sw_vid` cookie; if absent, generate a random
   id and set it (1-year, first-party, no PII). This id is the thread that
   connects every event this person ever fires.
3. **Config fetch:** `GET /api/snippet/config?site_id=X` returns **all** of the
   site's `running` experiments + `completed` ones that have a winner. This is
   one request per page load, but Vercel's edge cache serves it — our server
   and Supabase see roughly **one request per site per minute**, regardless of
   traffic. (Consequence: pausing/activating takes up to ~60s to propagate.)
4. **Per experiment in the config**, the snippet asks three questions:

   **(a) Which variant is this visitor in?** `hash(sw_vid + experiment_id) % 100`,
   mapped onto the variants' cumulative weights. Deterministic: no assignment
   is ever stored, because the same inputs always produce the same answer —
   this visitor gets Variant B today, tomorrow, and on every page. Hashing per
   experiment means being in B for one test says nothing about another test.
   **Control is an assignment too** — a control visitor is "in the experiment,
   shown the original."

   **(b) Am I on the experiment's page?** Compares `location.pathname` to the
   experiment's page path (exact match, trailing-slash tolerant). If yes:
   - Apply the variant's payload to the DOM (control's null payload = do
     nothing). A MutationObserver re-applies it whenever React/Next re-renders
     the element.
   - **Fire an exposure event** — yes, on *every* page load. The DB ignores
     all but the first (see dedupe below). So "always add an exposure" is
     right at the snippet level and wrong at the DB level: attempted always,
     stored once.
   - If the goal is a **click goal**: attach a click listener; a click landing
     on `goal_selector` fires a **conversion event**.

   **(c) Am I on the goal page?** (pageview goals only) If `location.pathname`
   matches `goal_page_path` — usually a *different* page, like `/thank-you` —
   fire a conversion. The variant is recomputed from the hash, so no state
   needed to know which arm this converter belonged to.

5. **Completed experiments** skip all tracking: if the current page matches and
   the winner has a payload, apply it to **every** visitor. That's promotion,
   mechanically.

### The event table rules (this is the part to internalize)

- `experiment_events` has a **unique index on (experiment_id, visitor_id,
  event_type)**. One visitor can contribute at most ONE exposure and ONE
  conversion per experiment, ever. Reloading 50 times = 1 exposure. Clicking
  the CTA 5 times = 1 conversion. Counting rows = counting unique people.
- The ingest endpoint (`/api/snippet/event`) validates that the variant really
  belongs to a really-running experiment before inserting (it's a public
  endpoint — it must not be a free "write rows" API), then upserts with
  ignore-duplicates so the index does the deduping.
- **Conversions only "count" when exposed:** the agent ignores conversion rows
  from visitors who have no exposure row. Someone who lands directly on
  /thank-you never saw your experiment page — their conversion is not evidence
  about your headline.

## Phase 4 — Evaluation (the agent)

Files: `app/api/agent/evaluate/route.ts`, `lib/stats.ts`

**When does it run?** Two triggers, same code:
- **Vercel Cron** — configured in `vercel.json`: every **Monday 9:00 UTC**
  (`0 9 * * 1`). So yes, roughly "every 7 days" — but that's a config choice,
  not an architectural one; change the cron expression and the cadence changes.
  Vercel sends GET with `Authorization: Bearer ${CRON_SECRET}` (set that env
  var in Vercel).
- **Manually** — `curl -X POST https://.../api/agent/evaluate -H "authorization: Bearer $AGENT_SECRET"`.
  Use this for testing; the JSON response shows every decision it made.

The fixed cadence is not laziness — it's statistical honesty. Checking
significance continuously ("peeking") and stopping at the first p < 0.05
produces false winners constantly. Fixed schedule + minimum sample size is the
crude-but-correct guard.

**What one evaluation does, per running experiment:**

```
1. PERCEIVE   Load variants + all events for the experiment.
              Count unique exposed visitors per variant.
              Count unique converted visitors per variant
                (only those who ALSO have an exposure row).

2. GATE       Is ANY variant below min_sample_size exposures (default 1000)?
              → decision: CONTINUE. Log "insufficient_sample" with the
                current numbers to agent_actions. Touch nothing. Done.

3. TEST       Two-proportion z-test: each challenger vs control
              (lib/stats.ts). significant = p < 0.05.

4. DECIDE + ACT — exactly one of three outcomes:

   a) ≥1 challenger significantly BETTER than control
      → pick the one with the highest conversion rate
      → if auto_promote (default true):
          UPDATE experiments SET status='completed',
                 winner_variant_id=<challenger>, ended_at=now()
      → log "promoted_winner" (rates, lift, p-value, samples)
      → from the next config-cache refresh, EVERY visitor gets the
        winning payload; tracking stops.

   b) ALL challengers significantly WORSE than control
      → UPDATE experiments SET status='completed',
             winner_variant_id=<control>, ended_at=now()
      → log "kept_control"
      → the config endpoint filters this out (winner=control means
        "serve the original" — i.e., serve nothing). Test over,
        site unchanged, founder learns the original was better.

   c) Neither → decision: CONTINUE. Log "no_significant_difference_yet"
      with the comparisons. The test keeps collecting data and gets
      re-examined at the next cron run.

5. REMEMBER   Every branch above wrote one agent_actions row: what it saw,
              what it decided, why. This is the audit trail — when the agent
              changes a live website, this table is the receipt.
```

**So to answer "is the experiment gone?" precisely:** never gone. It's marked
`completed` with a winner recorded. Its events stay (the evidence), its
agent_actions stay (the reasoning), the dashboard card shows it with a 🏆 on
the winning variant, and the snippet keeps serving that winner to 100% of
visitors indefinitely.

**One honest limitation to know:** "winner served forever" depends on the
snippet staying installed. The truly permanent fix is the founder pasting the
winning copy into their codebase — the weekly digest email (future) should say
exactly that: "B won (+34%). It's live for all visitors. Paste this into your
code whenever convenient: …"

---

## Timing summary (the delays that will confuse you if you don't know them)

| Action | Takes effect on the founder's site in… |
|---|---|
| Activate / Pause / Resume | ≤ ~60s (config edge-cache TTL) |
| Winner promoted by agent | ≤ ~60s after the cron run |
| Exposure/conversion visible in DB | immediately (sendBeacon → insert) |
| Agent decision | next cron run (Mon 9:00 UTC) or manual curl |

---

## Worked example, end to end

Mon: founder builds "Test: hero headline" (Control 50 / Variant B 50,
goal = click on `#signup-btn`), clicks Activate, installs the snippet.

Week 1: 2,400 visitors hit `/`. Each gets hashed → ~1,200 per arm, 1 exposure
row each. 96 control visitors click signup (1 conversion row each), 144 B
visitors do. DB now holds ~2,400 exposure rows + 240 conversion rows.

Mon 9:00 UTC: cron fires. Control: 96/1200 = 8.0%. B: 144/1200 = 12.0%.
Both arms ≥ 1000 exposures → gate passes. z-test → p ≈ 0.001 → significant.
B promoted: experiment → `completed`, `winner_variant_id` = B,
agent_actions gets `promoted_winner {lift: +50%, p: 0.001, …}`.

9:01 UTC: a visitor loads `/`. Config (fresh cache) says: completed, winner B.
Snippet applies B's headline. No events fire. Every visitor from now on sees
B. The founder gets the result card in the dashboard — and eventually an email.

---

## Testing the loop locally (10 minutes)

1. Build + activate an experiment on your own site; install the snippet with
   `http://localhost:3000` as the script origin.
2. Visit your site in 3–4 incognito windows (each = new visitor). Click the
   goal in some of them. Watch `experiment_events` fill up.
3. Lower the gate: `update experiments set min_sample_size = 2 where id='…';`
4. `curl -X POST http://localhost:3000/api/agent/evaluate -H "authorization: Bearer $AGENT_SECRET"`
5. Read the JSON response + `agent_actions`. If a variant won, reload your
   site: everyone sees the winner now.
6. Remember min_sample_size=2 makes the z-test statistically meaningless —
   it's for testing the plumbing, not the math.

---

## What makes this MORE agentic later (in build order)

1. **Queue the next test:** after promoting a winner, pick the highest-impact
   unused AI comment from the same report and auto-create the next draft (or
   auto-activate it — founder preference). This closes the full loop nobody
   else has.
2. **Selector self-healing:** snippet reports "element not found" → agent
   re-crawls the page → re-matches the element by `selector_fallback`
   {tag, text} → updates the selector → experiment keeps running. Today a
   double miss fails silently; this is the known gap.
3. **Narrative layer:** a Claude call inside the evaluate route that turns
   `agent_actions.detail` into the founder-facing story ("Your outcome-focused
   headline beat the feature-focused one — visitors respond to…").
4. **Sequential/Bayesian stats:** swap the internals of `lib/stats.ts` to
   allow earlier honest decisions on high-traffic sites. The agent's decision
   skeleton doesn't change.
