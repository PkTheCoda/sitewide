# Roadmap — path to pilots

_Last updated: 2026-07-17. Read `agent_loop.md` for the agent lifecycle, `progress.md` for build state._

## Where we are

The core agentic loop is **real and shipped**: crawl → AI findings → experiments → snippet serves variants → weekly cron evaluates (z-test, min-sample gate) → auto-promotes winner → Claude drafts the next experiment for founder approval. Deployed at sitewide.vercel.app, verified end-to-end on talem.org.

Recent incident (2026-07-13): the weekly cron silently no-oped because `CRON_SECRET` was missing in Vercel env → 401 before any logging. Fixed 2026-07-14. Lesson baked into Phase 1: the agent must be observable — silent failure is the default failure mode.

## Phase 1 — Agent hardening — SHIPPED 2026-07-17

The agent is structurally sound but operationally thin. This phase is "make the agent strong."

- [x] **Daily cadence + circuit breaker.** Cron is daily (`0 9 * * *` — also the max Vercel Hobby allows). Decision logic split:
  - *Harm gate (every run):* a challenger losing at p < 0.01 (with ≥25 exposures per arm) is stopped on any run, before min-sample. If ALL challengers are harmful the experiment completes with control; if SOME are, just those get `killed_at` — a killed variant keeps its bucket range (reweighting would reshuffle every arm's visitors) but the snippet serves it the control experience and stops sending events.
  - *Win gate (unchanged honesty):* winners only at min-sample fixed horizon, p < 0.05.
- [x] **Run heartbeat.** Every run writes `run_started`/`run_finished` rows (experiment_id null) with counts, decisions, duration. A missing heartbeat is the alarm.
- [x] **Proposal failures logged** as `proposal_failed` / `proposal_skipped` actions, not just console.
- [x] **Selector-miss reporting + auto-pause.** Snippet reports `selector_miss` if a change is still unapplied 8s in; agent pauses the experiment (`paused_broken`) at ≥5 unique miss visitors AND ≥20% of that variant's exposures.
- [x] **min_sample_size floor** of 100, enforced in the evaluator and on agent-drafted experiments.
- [x] **Manual/dry-run propose trigger** — `POST /api/agent/propose` (`dry_run: true` by default) exercises the whole proposal pipeline (Claude call included) without writing anything; would have caught the missing ANTHROPIC_API_KEY on day one.

## Phase 2 — Weekly digest email (Resend)

The agent's work is invisible unless the founder opens the dashboard. The digest IS the product's presence.

- [ ] Weekly email per user: each running experiment's variants + rates + lift + agent's current read; decisions made this week (promoted / killed / paused); the proposed next experiment with one-click Activate link.
- [ ] Powered by `agent_actions` + live stats — mostly a rendering job. Cron on the same daily runner (send on Mondays) or separate route.

## Path to pilots (decided 2026-07-18) — founder owns design, Claude owns functionality

Beta MVP = invite-only: founder controls who joins and onboards; launch timing is free.

### Functionality track (Claude), in order

1. **Email via Resend** — the remaining 100%-needed feature.
   - Weekly Monday digest per founder: running experiments w/ per-variant numbers + the agent's read, decisions made that week, pending proposal w/ Activate deep-link.
   - Event-driven emails the moment they happen (rare by construction): winner promoted, all variants killed, experiment paused (broken selector). No second scheduled email — quiet weeks stay quiet.
   - Agent-error alert to the founder (heartbeat exists; now someone gets told).
   - Piggybacks on the daily evaluate cron (Mondays → digest) — preserves the spare Hobby cron slot. Sends logged to agent_actions (`digest_sent`/`email_failed`).
   - Founder manual steps: create Resend account, verify sending domain (2 DNS records), put `RESEND_API_KEY` in Vercel + .env.
2. **Beta access gate** — signup gated by invite code / email allowlist so the founder controls who gets in. Required by the MVP definition; doesn't exist yet.
3. **Onboarding plumbing** — post-signup funnel state + routing: how-found-us Q → website URL → live analysis runs while they watch (existing pipeline) → land on report with first experiment one click away. Goal: first experiment activated in session one. Founder designs the screens; Claude wires them.
4. **Data-integrity guards before real traffic:**
   - [ ] Wipe talem.org test events (one-time script in scripts/).
   - [ ] Domain check on snippet config (any domain with a site id currently runs experiments, incl. Vercel previews).
   - [ ] Rate limiting on `/api/snippet/event`.
   - [ ] Password reset / auth completeness check on the signin flow.
5. **Proposal context upgrade** (the pragmatic "experiment memory"): include the site's full completed-experiment history (name, hypothesis, outcome, lift) in the propose prompt so Claude stops re-learning per report. A real cross-page memory/learning system is post-pilot.

### Design track (founder)

- Landing page hero (simple), signin page, onboarding screens, experiment editor UI, dashboard + analyses polish, create-experiment entry points (builder from scratch, from an analysis finding, etc.).

### Fast-follow (post-first-pilots, not blocking)

- Form-submit goal (submit listener; SaaS signups are forms).
- Funnel-step goals — experiment-scoped ordered path list w/ per-variant drop-off. NEVER full-site funnel analytics (that's the competitors' cost structure, not ours).
- Multi-element variants (headline + CTA together), split-URL/redirect tests.
- Selector self-healing (agent detects+pauses today; auto re-crawl/re-match later).

### Explicitly NOT building now

- **Feature flags** — GrowthBook's turf; dilutes the A/B-first wedge (anti-scope-creep rule).
- **Stripe billing** — beta is invite-only and free.
- **Full agent memory system** — item 5 above captures 80% of the value in a prompt change.
- Heatmaps / general analytics (standing rule).

## Standing constraints

- **Statistical honesty:** fixed-horizon win decisions, min-sample gate, no naive live p-value stopping. Harm-only early stops use stricter α.
- **Anti-scope-creep:** NO heatmaps, general funnels, or general analytics. Experiment-scoped tracking is the structural cost advantage vs Humblytics.
- **Claude proposes; it never activates.** Founder approves every agent-drafted experiment.
- **Vercel Hobby cron limits:** max 2 crons, max once daily, ±1h timing precision.
