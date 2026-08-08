-- PostHog integration: read-only analytics context for the agent.
--
-- Founders connect a PostHog project (personal API key scoped to query:read +
-- project id + region host). A daily cron distills their last 30 days of
-- traffic into one JSONB snapshot per site; the analysis prompt, the agent's
-- follow-up proposals, and the builder's time-to-decision estimator read it.
-- This is agent context ONLY — never a dashboard, never an experiment metric.
--
-- Applied via `supabase db push`.

-- 1. integrations: one PostHog connection per site. The api_key is the one
--    secret we hold on the founder's behalf: RLS is enabled with NO policies,
--    so the anon/authenticated clients can read and write NOTHING here. All
--    access goes through service-role API routes, and connection status is
--    exposed to the dashboard via a sanitized route that never selects the key.
create table integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  site_id uuid not null references sites (id) on delete cascade,
  provider text not null default 'posthog' check (provider = 'posthog'),
  host text not null,                        -- https://us.posthog.com | https://eu.posthog.com | custom
  project_id text not null,
  api_key text not null,                     -- personal API key, query:read scope. NEVER client-readable.
  status text not null default 'connected' check (status in ('connected', 'error')),
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (site_id, provider)
);
alter table integrations enable row level security;

-- 2. analytics_snapshots: one compact JSONB traffic summary per site per day
--    (top pages, device split, referrers, UTM sources, top custom events).
--    Read as one blob by every consumer — never queried row-wise, same
--    rationale as reports.elements. Clients may READ their own (the builder
--    prefills the estimator from it); only the sync cron writes.
create table analytics_snapshots (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites (id) on delete cascade,
  captured_at date not null default current_date,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (site_id, captured_at)
);
alter table analytics_snapshots enable row level security;

create policy "users read own snapshots" on analytics_snapshots
  for select using (
    site_id in (select id from sites where user_id = auth.uid())
  );
