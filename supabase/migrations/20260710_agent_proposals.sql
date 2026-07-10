-- Agent-proposed experiments ("closing the loop").
--
-- When the weekly agent finishes an experiment (promotes a winner or keeps
-- control), it now asks Claude to pick the next test from the report's unused
-- AI findings and writes it as a REAL draft experiment. No new tables — a
-- proposal is just an experiments row with created_by = 'agent'. The founder's
-- existing Activate button is the approval; Dismiss (status -> archived) is
-- the rejection. Preview links work on these drafts like any other.
--
-- Run this in the Supabase SQL editor.

alter table experiments
  -- who created the row: 'user' (builder) or 'agent' (weekly evaluation loop)
  add column created_by text not null default 'user',
  -- the agent's one-paragraph "why this test, why now" — shown on the card
  add column agent_rationale text,
  -- which AI finding (comments row) this test came from. Doubles as the
  -- dedupe key: the agent never proposes the same finding twice.
  add column source_comment_id bigint references comments (id) on delete set null;

-- No agent_actions change needed: `action` is text, and the route now also
-- logs action = 'proposed_experiment' rows (detail carries the new
-- experiment's id, name, variants, and rationale).
