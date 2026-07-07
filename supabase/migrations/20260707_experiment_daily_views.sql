-- Day-by-day RAW page view counter for experiments.
--
-- Why a separate table: experiment_events is deduped to one exposure + one
-- conversion per visitor per experiment (that's what makes stats trivially
-- correct), so it can never answer "how many page loads happened on Tuesday".
-- The snippet already fires an exposure beacon on EVERY page load — the DB
-- just ignores duplicates — so /api/snippet/event bumps this counter on every
-- beacon it receives. Raw views per variant per day, no snippet changes, no
-- extra requests from visitors' browsers.
--
-- Daily UNIQUE exposures/conversions need no storage at all: group
-- experiment_events rows by date(created_at) — each row is one visitor's
-- first event by construction. lib/experiments.ts does that client-side.
--
-- Days are UTC everywhere (counter writes and chart grouping must agree).
--
-- Run this in the Supabase SQL editor.

create table experiment_daily_views (
  experiment_id uuid not null references experiments (id) on delete cascade,
  variant_id    uuid not null references experiment_variants (id) on delete cascade,
  day           date not null, -- UTC
  views         int  not null default 0,
  primary key (experiment_id, variant_id, day)
);

-- Owners can read their own numbers from the browser (dashboard charts).
-- Nobody writes through RLS: only the event route's service role inserts,
-- and service role bypasses RLS entirely.
alter table experiment_daily_views enable row level security;

create policy "users read own daily views" on experiment_daily_views
  for select using (
    experiment_id in (select id from experiments where user_id = auth.uid())
  );

-- Atomic upsert-increment. A plain "select then update" from the API route
-- would lose counts under concurrent beacons; ON CONFLICT arithmetic is
-- race-free inside Postgres.
create or replace function increment_daily_views(
  p_experiment_id uuid,
  p_variant_id    uuid
) returns void
language sql
security definer
set search_path = public
as $$
  insert into experiment_daily_views (experiment_id, variant_id, day, views)
  values (p_experiment_id, p_variant_id, (now() at time zone 'utc')::date, 1)
  on conflict (experiment_id, variant_id, day)
  do update set views = experiment_daily_views.views + 1;
$$;

-- PostgREST exposes RPCs to anyone holding the (public) anon key by default —
-- without this, anyone could inflate view counts. Only the server may call it.
revoke execute on function increment_daily_views(uuid, uuid) from public, anon, authenticated;
grant execute on function increment_daily_views(uuid, uuid) to service_role;
