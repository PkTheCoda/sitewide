@AGENTS.md

# Sitewide — repo orientation

Agentic CRO / A/B testing tool for SaaS founders. Two ways to make a test: **AI analysis** (crawl a URL → Claude suggests CRO changes on a screenshot) and a **manual builder** (click an element, define a change + goal). A JS snippet serves variants to real visitors; a daily agent evaluates results and promotes winners. ICP: PLG SaaS with ~10k–20k+ monthly visitors. No heatmaps/funnels/general analytics — ever.

Deeper detail lives in `app_explanation.md` (how it works) and `progress.md` (live task checklist). Read those when you need specifics.

## Layout

- **`app/`** — Next.js App Router (v16). `dashboard/(shell)/*` = the app tabs (experiments, analyses, analytics, settings); `dashboard/report/[id]/builder` = experiment builder; `api/*` = route handlers (snippet serving/config/events, `agent/*` evaluate+propose+digest, account/report delete).
- **`lib/`** — all DB access + logic as pure async fns returning `data` or `{error}`. `types.ts` (central types), `experiments.ts`, `reports.ts`, `stats.ts` (z-test), `propose.ts`/`agentSummary.ts`/`agentEmails.ts` (agent), `snippetConfig.ts`, `supabaseClient.ts` (anon/RLS, client), `supabaseAdmin.ts` (service role, **server-only**).
- **`components/`** — `dashboard/`, `experiment-builder/`, `report/` (screenshot overlay + pins), `graph/`, `homepage/`.
- **`services/`** — `context/authContext.tsx` → `useAuth()`.
- **`supabase/functions/analyze-page/`** — the entire crawl+analysis pipeline (Deno edge fn, Browserless + Claude).
- **`public/`** — assets + the visitor snippet. **`scripts/`** — one-off/test scripts.

## Conventions

- DB code goes in `lib/*.ts`, never in components. Auth via `useAuth()`. Types in `lib/types.ts`.
- RLS is owner-only everywhere; the edge fn + admin routes use the service role to bypass it.
- Deletes: experiments cascade fully (client-side ok); reports need the admin route (comments + Storage screenshots don't cascade). See `app_explanation.md` → Deletion model.
- **Never commit** — the founder reviews every diff and commits himself.
