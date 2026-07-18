import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { proposeNextExperiment } from "@/lib/propose";

// Manual trigger for the proposal pipeline — the step that normally only runs
// when the evaluator completes an experiment. Two uses:
//
//   Health check (dry_run: true, the default): exercises the whole pipeline —
//   context building, the Claude call, schema validation — against any
//   experiment, but writes NOTHING. This is how we verify the proposal leg
//   works in production without waiting weeks for a real completion. (It
//   would have caught the missing ANTHROPIC_API_KEY on day one.)
//
//   Real trigger (dry_run: false): writes an actual draft experiment, exactly
//   as the evaluator would. Respects the one-pending-proposal guardrail.
//
//   curl -X POST https://.../api/agent/propose \
//     -H "authorization: Bearer $AGENT_SECRET" -H "content-type: application/json" \
//     -d '{"experiment_id": "..."}'
export async function POST(request: Request) {
    const auth = request.headers.get("authorization");
    const secrets = [process.env.AGENT_SECRET, process.env.CRON_SECRET].filter(Boolean);
    if (secrets.length === 0 || !secrets.some((s) => auth === `Bearer ${s}`)) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    let body: { experiment_id?: string; dry_run?: boolean; outcome_summary?: string };
    try {
        body = await request.json();
    } catch {
        return Response.json({ error: "invalid JSON" }, { status: 400 });
    }
    if (!body.experiment_id) {
        return Response.json({ error: "experiment_id required" }, { status: 400 });
    }

    const dryRun = body.dry_run ?? true; // safe by default
    const outcome =
        body.outcome_summary ??
        "(manual trigger — the experiment may still be running; treat its current numbers as the outcome)";

    try {
        const result = await proposeNextExperiment(getSupabaseAdmin(), body.experiment_id, outcome, {
            dryRun,
        });
        return Response.json({ dry_run: dryRun, ...result });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return Response.json({ error: message }, { status: 500 });
    }
}
