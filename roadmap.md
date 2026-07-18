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

## Phase 3 — Onboarding

- [ ] Post-signup flow: how they found us, their website URL → kick off a live analysis while they watch (reuse existing analyze pipeline) → land them on the report with findings + first experiment one click away. Goal: first experiment activated in the first session.

## Phase 4 — More experiment & goal types

Already supported: change types text / style / hide / image on one element; goals: element click, pageview of a path (so "did they reach page X" already works).

Easy, high-value adds, in order:
- [ ] **Form-submit goal** (submit listener; SaaS signups are forms).
- [ ] **Multi-element variants** — one variant changes several elements (headline + CTA together).
- [ ] **Funnel-step goals (experiment-scoped)** — ordered path list (`/pricing → /signup → /welcome`), snippet logs which step each exposed visitor reaches, report shows drop-off per variant. NOTE: this stays *experiment-scoped*. Full-site funnel analytics is deliberately out of scope — competitors meter every event sitewide, which is exactly the cost structure our wedge attacks. Copy the mechanic, not the surface area.
- [ ] **Split-URL / redirect test** — variant payload is a URL; snippet redirects. Classic feature, trivially cheap to add.

## Phase 5 — Pre-pilot cleanup

- [ ] Wipe test events from talem.org experiments before real traffic.
- [ ] Domain check on `/api/snippet/config` (currently any domain with the site id runs experiments, incl. Vercel previews).
- [ ] Event rate limiting on `/api/snippet/event`.
- [ ] UI redesign pass (founder-led).

## Standing constraints

- **Statistical honesty:** fixed-horizon win decisions, min-sample gate, no naive live p-value stopping. Harm-only early stops use stricter α.
- **Anti-scope-creep:** NO heatmaps, general funnels, or general analytics. Experiment-scoped tracking is the structural cost advantage vs Humblytics.
- **Claude proposes; it never activates.** Founder approves every agent-drafted experiment.
- **Vercel Hobby cron limits:** max 2 crons, max once daily, ±1h timing precision.
