import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { compareVariants, VariantStats } from "@/lib/stats";
import { proposeNextExperiment } from "@/lib/propose";

// ─── The autonomous evaluation loop ─────────────────────────────────────────
//
// This is the "agentic" core: for every running experiment it
//   1. PERCEIVES  — aggregates unique exposures/conversions per variant
//   2. DECIDES    — enforces min sample size, runs the significance test
//   3. ACTS       — promotes the winner (status=completed + winner_variant_id;
//                   the snippet then serves that variant to 100% of visitors),
//                   or keeps control, or waits for more data
//   4. REMEMBERS  — writes every decision + its reasoning to agent_actions,
//                   an audit trail the founder can read
//
// Trigger: Vercel Cron (weekly) or manually:
//   curl -X POST https://.../api/agent/evaluate -H "authorization: Bearer $AGENT_SECRET"
//
// Statistical honesty: decisions only happen when every arm has at least
// min_sample_size exposures, and this runs on a fixed cadence — not on every
// event — which keeps us clear of the peeking problem.

// Two entry points, same loop:
//   POST — manual trigger (curl with AGENT_SECRET) for testing
//   GET  — Vercel Cron, which sends GET and injects `Authorization: Bearer
//          ${CRON_SECRET}` automatically when that env var exists
export async function POST(request: Request) {
    return runEvaluation(request);
}

export async function GET(request: Request) {
    return runEvaluation(request);
}

async function runEvaluation(request: Request) {
    const auth = request.headers.get("authorization");
    const secrets = [process.env.AGENT_SECRET, process.env.CRON_SECRET].filter(Boolean);
    if (secrets.length === 0 || !secrets.some((s) => auth === `Bearer ${s}`)) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    const supabase = getSupabaseAdmin();

    const { data: experiments, error } = await supabase
        .from("experiments")
        .select("id, name, status, min_sample_size, auto_promote, winner_variant_id")
        .eq("status", "running");

    if (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }

    const results = [];

    for (const experiment of experiments ?? []) {
        try {
            results.push(await evaluateExperiment(supabase, experiment));
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            await log(supabase, experiment.id, "error", { message });
            results.push({ experiment_id: experiment.id, decision: "error", message });
        }
    }

    return Response.json({ evaluated: results.length, results });
}

type ExperimentRow = {
    id: string;
    name: string;
    min_sample_size: number;
    auto_promote: boolean;
};

async function evaluateExperiment(
    supabase: ReturnType<typeof getSupabaseAdmin>,
    experiment: ExperimentRow
) {
    // ── 1. Perceive ──────────────────────────────────────────────────────────
    const [{ data: variants }, { data: events }] = await Promise.all([
        supabase
            .from("experiment_variants")
            .select("id, name, is_control, position")
            .eq("experiment_id", experiment.id)
            .order("position"),
        supabase
            .from("experiment_events")
            .select("variant_id, visitor_id, event_type")
            .eq("experiment_id", experiment.id),
    ]);

    if (!variants || variants.length < 2) {
        throw new Error("experiment has fewer than 2 variants");
    }

    // Unique visitors per variant. Exposures are the denominator; a conversion
    // only counts if that same visitor also has an exposure row (a conversion
    // without exposure means they hit the goal page without ever seeing the
    // experiment page — not evidence about the variant).
    const exposed = new Map<string, Set<string>>(); // variant_id -> visitor set
    const converted = new Map<string, Set<string>>();
    for (const v of variants) {
        exposed.set(v.id, new Set());
        converted.set(v.id, new Set());
    }
    for (const e of events ?? []) {
        if (e.event_type === "exposure") exposed.get(e.variant_id)?.add(e.visitor_id);
    }
    for (const e of events ?? []) {
        if (e.event_type === "conversion" && exposed.get(e.variant_id)?.has(e.visitor_id)) {
            converted.get(e.variant_id)?.add(e.visitor_id);
        }
    }

    const stats: VariantStats[] = variants.map((v) => {
        const n = exposed.get(v.id)!.size;
        const c = converted.get(v.id)!.size;
        return { variantId: v.id, exposures: n, conversions: c, rate: n > 0 ? c / n : 0 };
    });

    const control = stats[variants.findIndex((v) => v.is_control)];
    const challengers = stats.filter((s) => s !== control);

    // ── 2. Decide ────────────────────────────────────────────────────────────
    const minSample = experiment.min_sample_size ?? 1000;
    const underSampled = stats.some((s) => s.exposures < minSample);

    if (underSampled) {
        const detail = { reason: "insufficient_sample", min_sample_size: minSample, stats };
        await log(supabase, experiment.id, "evaluated", detail);
        return { experiment_id: experiment.id, name: experiment.name, decision: "continue", ...detail };
    }

    const comparisons = compareVariants(control, challengers);
    const significantWinners = comparisons
        .filter((c) => c.significant && c.variantRate > c.controlRate)
        .sort((a, b) => b.variantRate - a.variantRate);
    const allSignificantlyWorse =
        comparisons.length > 0 &&
        comparisons.every((c) => c.significant && c.variantRate < c.controlRate);

    // ── 3. Act ───────────────────────────────────────────────────────────────
    if (significantWinners.length > 0) {
        const winner = significantWinners[0];
        const winnerVariant = variants.find((v) => v.id === winner.variantId)!;

        if (experiment.auto_promote) {
            await supabase
                .from("experiments")
                .update({
                    status: "completed",
                    winner_variant_id: winner.variantId,
                    ended_at: new Date().toISOString(),
                })
                .eq("id", experiment.id);
        }

        const detail = {
            winner_variant_id: winner.variantId,
            winner_name: winnerVariant.name,
            control_rate: winner.controlRate,
            winner_rate: winner.variantRate,
            lift: winner.lift,
            p_value: winner.pValue,
            auto_promoted: experiment.auto_promote,
            stats,
        };
        await log(supabase, experiment.id, "promoted_winner", detail);

        // The experiment is settled — close the loop: draft the next test
        // from the report's unused findings (founder approves via Activate).
        const proposal = await propose(
            supabase,
            experiment.id,
            `"${winnerVariant.name}" WON: ${(winner.variantRate * 100).toFixed(1)}% conversion vs ` +
                `${(winner.controlRate * 100).toFixed(1)}% control (p=${winner.pValue.toFixed(4)}). ` +
                `The winning copy is now served to all visitors.`
        );
        return { experiment_id: experiment.id, name: experiment.name, decision: "promoted_winner", proposal, ...detail };
    }

    if (allSignificantlyWorse) {
        // Every challenger lost — end the test, keep the original.
        await supabase
            .from("experiments")
            .update({
                status: "completed",
                winner_variant_id: control.variantId,
                ended_at: new Date().toISOString(),
            })
            .eq("id", experiment.id);

        const detail = { reason: "all_variants_worse", comparisons, stats };
        await log(supabase, experiment.id, "kept_control", detail);

        // Settled the other way — every challenger lost. Still worth closing
        // the loop: the "what lost and why" is evidence for the next pick.
        const proposal = await propose(
            supabase,
            experiment.id,
            `Every variant performed significantly WORSE than the original — the test was ended ` +
                `and the original copy kept. Avoid proposing more of the same idea.`
        );
        return { experiment_id: experiment.id, name: experiment.name, decision: "kept_control", proposal, ...detail };
    }

    const detail = { reason: "no_significant_difference_yet", comparisons, stats };
    await log(supabase, experiment.id, "evaluated", detail);
    return { experiment_id: experiment.id, name: experiment.name, decision: "continue", ...detail };
}

async function log(
    supabase: ReturnType<typeof getSupabaseAdmin>,
    experiment_id: string,
    action: string,
    detail: Record<string, unknown>
) {
    await supabase.from("agent_actions").insert({ experiment_id, action, detail });
}

// Best-effort wrapper: a failed proposal (Claude down, key missing, bad
// output) must never fail the evaluation itself — the promotion already
// happened and is the thing that matters.
async function propose(
    supabase: ReturnType<typeof getSupabaseAdmin>,
    experiment_id: string,
    outcome_summary: string
) {
    try {
        return await proposeNextExperiment(supabase, experiment_id, outcome_summary);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("proposal failed:", message);
        return { proposed: false as const, reason: `error: ${message}` };
    }
}
