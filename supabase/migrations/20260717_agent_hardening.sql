-- Agent hardening (Phase 1): heartbeats, selector-miss reporting, circuit breaker.
--
-- Applied via `supabase db push` (migration history repaired 2026-07-17; the
-- three older files were originally pasted into the SQL editor by hand).

-- 1. Heartbeats. The agent now writes run_started / run_finished rows so a
--    silent cron failure (like the 2026-07-13 CRON_SECRET 401) is detectable:
--    a missing heartbeat IS the alarm. These rows describe a whole run, not
--    one experiment, so experiment_id must be allowed to be null.
alter table agent_actions alter column experiment_id drop not null;

-- 2. Selector-miss reporting. The snippet reports when a variant's target
--    element can't be found (selector + fallback both miss) so the agent can
--    pause experiments that are silently collecting garbage data.
alter table experiment_events drop constraint experiment_events_event_type_check;
alter table experiment_events add constraint experiment_events_event_type_check
  check (event_type in ('exposure', 'conversion', 'selector_miss'));

-- 3. Circuit breaker. A killed (significantly losing) variant KEEPS its
--    bucket range — deterministic hash→weight assignment means removing or
--    reweighting a variant would silently reassign visitors across every
--    other arm and contaminate their data. Instead the snippet sees
--    killed=true, serves those visitors the control experience, and stops
--    sending events; evaluation excludes killed variants from all stats.
alter table experiment_variants add column killed_at timestamptz;
