import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { compareVariants, DECISION_FLOOR, VariantStats } from "@/lib/stats";
import { proposeNextExperiment } from "@/lib/propose";
import { sendDecisionEmail, sendWeeklyDigests } from "@/lib/agentEmails";

// Evaluations + a possible Claude call + Monday digests can pass the default
// 10s function budget.
export const maxDuration = 60;

// ─── The autonomous evaluation loop ─────────────────────────────────────────
//
// This is the "agentic" core: for every running experiment it
//   1. PERCEIVES  — aggregates unique exposures/conversions/selector-misses
//                   per variant
//   2. DECIDES    — health check (is the data trustworthy?), then the harm
//                   gate (is a variant hurting conversions?), then the
//                   sample floor and the Bayesian decision rule
//   3. ACTS       — pauses broken experiments, kills losing variants,
//                   promotes the winner (status=completed + winner_variant_id;
//                   the snippet then serves that variant to 100% of visitors),
//                   or keeps control, or waits for more data
//   4. REMEMBERS  — writes every decision + its reasoning to agent_actions,
//                   an audit trail the founder can read. Each run is also
//                   bracketed by run_started/run_finished heartbeat rows
//                   (experiment_id null): a MISSING heartbeat is how we detect
//                   the cron silently not running — which happened 2026-07-13.
//
// Trigger: Vercel Cron (daily) or manually:
//   curl -X POST https://.../api/agent/evaluate -H "authorization: Bearer $AGENT_SECRET"
//
// Statistical honesty: the decision rule (lib/stats.ts) is Bayesian and built
// for exactly this daily cadence — it acts only when a variant is ≥95% likely
// better AND the expected cost of a wrong call is capped at a fraction of the
// conversion rate, so checking every day doesn't inflate anything the way
// peeking at a fixed-horizon z-test did. min_sample_size is now just a floor
// (default DECISION_FLOOR) keeping tiny-n flukes out, not a power-analysis
// commitment.

// Circuit breaker: a challenger this confidently below control gets killed on
// any run, before the floor. HARM_MIN_EXPOSURES keeps tiny-n flukes out.
const HARM_CHANCE = 0.01; // P(variant beats control) at or below this = harmful
const HARM_MIN_EXPOSURES = 25;

// Health check: pause the experiment when this many unique visitors reported
// the target element missing AND they are a meaningful share of the variant's
// traffic (a redesigned page breaks selectors for everyone; a slow phone that
// hydrates after the 8s reporting timer is a one-off).
const MISS_MIN_VISITORS = 5;
const MISS_MIN_RATE = 0.2;

// Absolute floor for min_sample_size: below this even the risk-capped rule is
// judging mostly noise, whatever the experiment row says.
const SAMPLE_FLOOR = 100;

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
    const startedAt = Date.now();

    const { data: experiments, error } = await supabase
        .from("experiments")
        .select("id, name, status, user_id, min_sample_size, auto_promote, winner_variant_id")
        .eq("status", "running");

    if (error) {
        // Even a failed run leaves a heartbeat — silence is never ambiguous.
        await log(supabase, null, "run_finished", { error: error.message, duration_ms: Date.now() - startedAt });
        return Response.json({ error: error.message }, { status: 500 });
    }

    await log(supabase, null, "run_started", {
        method: request.method,
        running_experiments: experiments?.length ?? 0,
    });

    const results = [];

    for (const experiment of experiments ?? []) {
        try {
            const result = await evaluateExperiment(supabase, experiment);
            results.push(result);
            await emailDecision(supabase, experiment, result);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            await log(supabase, experiment.id, "error", { message });
            results.push({ experiment_id: experiment.id, decision: "error", message });
        }
    }

    // Mondays: the weekly digest rides the same cron run (Hobby allows only
    // two cron jobs — the spare slot stays spare). Guarded to once per day.
    let digest = null;
    if (new Date().getUTCDay() === 1) {
        digest = await sendWeeklyDigests(supabase);
    }

    await log(supabase, null, "run_finished", {
        evaluated: results.length,
        decisions: results.map((r) => ({ experiment_id: r.experiment_id, decision: r.decision })),
        errors: results.filter((r) => r.decision === "error").length,
        duration_ms: Date.now() - startedAt,
        ...(digest ? { digest } : {}),
    });

    return Response.json({ evaluated: results.length, results, digest });
}

type ExperimentRow = {
    id: string;
    name: string;
    user_id: string;
    min_sample_size: number;
    auto_promote: boolean;
};

// A decisive outcome deserves an email NOW, not next Monday. Quiet outcomes
// (continue / insufficient sample) send nothing. Kills that happen alongside
// a "continue" decision are surfaced as killed_variant.
async function emailDecision(
    supabase: ReturnType<typeof getSupabaseAdmin>,
    experiment: ExperimentRow,
    result: { decision: string } & Record<string, unknown>
) {
    const decisive = ["promoted_winner", "kept_control", "paused_broken", "killed_variant"];
    if (!decisive.includes(result.decision)) return;
    // killed_variant piggybacks on a "continue" evaluation — the kill's own
    // detail (names, rates, p) lives in the kills array, not at top level.
    const detail =
        result.decision === "killed_variant"
            ? ((result.kills as Record<string, unknown>[] | undefined)?.[0] ?? result)
            : result;
    await sendDecisionEmail(supabase, experiment, result.decision, detail);
}

async function evaluateExperiment(
    supabase: ReturnType<typeof getSupabaseAdmin>,
    experiment: ExperimentRow
) {
    // ── 1. Perceive ──────────────────────────────────────────────────────────
    const [{ data: variants }, { data: events }] = await Promise.all([
        supabase
            .from("experiment_variants")
            .select("id, name, is_control, position, killed_at")
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
    const missed = new Map<string, Set<string>>(); // selector_miss reporters
    for (const v of variants) {
        exposed.set(v.id, new Set());
        converted.set(v.id, new Set());
        missed.set(v.id, new Set());
    }
    for (const e of events ?? []) {
        if (e.event_type === "exposure") exposed.get(e.variant_id)?.add(e.visitor_id);
        if (e.event_type === "selector_miss") missed.get(e.variant_id)?.add(e.visitor_id);
    }
    for (const e of events ?? []) {
        if (e.event_type === "conversion" && exposed.get(e.variant_id)?.has(e.visitor_id)) {
            converted.get(e.variant_id)?.add(e.visitor_id);
        }
    }

    // Killed variants keep their bucket range but serve the control experience
    // and send no events (see snippet) — they are out of every decision below.
    const live = variants.filter((v) => !v.killed_at);
    const statFor = (v: { id: string }): VariantStats => {
        const n = exposed.get(v.id)!.size;
        const c = converted.get(v.id)!.size;
        return { variantId: v.id, exposures: n, conversions: c, rate: n > 0 ? c / n : 0 };
    };
    const stats: VariantStats[] = live.map(statFor);

    const controlIndex = live.findIndex((v) => v.is_control);
    if (controlIndex === -1) throw new Error("experiment has no live control variant");
    const control = stats[controlIndex];
    const challengers = stats.filter((s) => s !== control);

    // ── 2a. Health check — is this data even trustworthy? ────────────────────
    // Visitors bucketed into a variant whose element can't be found see the
    // ORIGINAL page while being counted as variant exposures. That's not an
    // experiment any more; pause it and tell the founder, don't keep testing.
    for (const v of live) {
        if (v.is_control) continue;
        const misses = missed.get(v.id)!.size;
        const exposures = exposed.get(v.id)!.size;
        if (misses >= MISS_MIN_VISITORS && misses / Math.max(exposures, 1) >= MISS_MIN_RATE) {
            await supabase.from("experiments").update({ status: "paused" }).eq("id", experiment.id);
            const detail = {
                reason: "selector_miss",
                variant_id: v.id,
                variant_name: v.name,
                miss_visitors: misses,
                exposure_visitors: exposures,
                stats,
            };
            await log(supabase, experiment.id, "paused_broken", detail);
            return { experiment_id: experiment.id, name: experiment.name, decision: "paused_broken", ...detail };
        }
    }

    // ── 2b. Harm gate — the circuit breaker ──────────────────────────────────
    const comparisons = compareVariants(control, challengers);
    const harmful = comparisons.filter(
        (c) =>
            c.chanceToBeat <= HARM_CHANCE &&
            control.exposures >= HARM_MIN_EXPOSURES &&
            challengers.find((s) => s.variantId === c.variantId)!.exposures >= HARM_MIN_EXPOSURES
    );

    if (harmful.length > 0 && harmful.length === challengers.length) {
        // Every live challenger is confidently hurting conversions — end the
        // test now, keep the original. Same outcome as the fixed-horizon
        // "all worse" path, it just refuses to wait for min-sample while
        // visitors are being lost.
        await supabase
            .from("experiments")
            .update({
                status: "completed",
                winner_variant_id: control.variantId,
                ended_at: new Date().toISOString(),
            })
            .eq("id", experiment.id);

        const detail = { reason: "harm_gate", comparisons, stats };
        await log(supabase, experiment.id, "kept_control", detail);

        const proposal = await propose(
            supabase,
            experiment.id,
            `Every variant performed significantly WORSE than the original — the agent's circuit ` +
                `breaker ended the test early and kept the original copy. Avoid proposing more of the same idea.`
        );
        return { experiment_id: experiment.id, name: experiment.name, decision: "kept_control", proposal, ...detail };
    }

    const kills = [];
    for (const h of harmful) {
        // Some (not all) challengers are losing badly: kill just those. Their
        // visitors get the control experience starting with the next config
        // refresh (~30s); the surviving arms' assignments are untouched.
        const variant = live.find((v) => v.id === h.variantId)!;
        await supabase
            .from("experiment_variants")
            .update({ killed_at: new Date().toISOString() })
            .eq("id", h.variantId);
        const detail = {
            variant_id: h.variantId,
            variant_name: variant.name,
            control_rate: h.controlRate,
            variant_rate: h.variantRate,
            chance_to_beat: h.chanceToBeat,
            stats,
        };
        await log(supabase, experiment.id, "killed_variant", detail);
        kills.push(detail);
    }
    // The experiment continues with the surviving arms.
    const liveChallengers = challengers.filter((s) => !harmful.some((h) => h.variantId === s.variantId));
    const liveComparisons = comparisons.filter((c) => !harmful.some((h) => h.variantId === c.variantId));

    // ── 2c. Sample floor, then the sequential decision rule ──────────────────
    const minSample = Math.max(SAMPLE_FLOOR, experiment.min_sample_size ?? DECISION_FLOOR);
    const liveStats = [control, ...liveChallengers];
    const underSampled = liveStats.some((s) => s.exposures < minSample);

    if (underSampled) {
        const detail = { reason: "insufficient_sample", min_sample_size: minSample, stats, kills };
        await log(supabase, experiment.id, "evaluated", detail);
        return { experiment_id: experiment.id, name: experiment.name, decision: "continue", ...detail };
    }

    const decisiveWinners = liveComparisons
        .filter((c) => c.verdict === "variant")
        .sort((a, b) => b.chanceToBeat - a.chanceToBeat);
    const allConfidentlyWorse =
        liveComparisons.length > 0 && liveComparisons.every((c) => c.verdict === "control");

    // ── 3. Act ───────────────────────────────────────────────────────────────
    if (decisiveWinners.length > 0) {
        const winner = decisiveWinners[0];
        const winnerVariant = live.find((v) => v.id === winner.variantId)!;

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
            chance_to_beat: winner.chanceToBeat,
            risk_if_wrong: winner.riskOfChoosing,
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
                `${(winner.controlRate * 100).toFixed(1)}% control ` +
                `(${(winner.chanceToBeat * 100).toFixed(1)}% chance it's genuinely better). ` +
                `The winning copy is now served to all visitors.`
        );
        return { experiment_id: experiment.id, name: experiment.name, decision: "promoted_winner", proposal, ...detail };
    }

    if (allConfidentlyWorse) {
        // Every challenger lost — end the test, keep the original.
        await supabase
            .from("experiments")
            .update({
                status: "completed",
                winner_variant_id: control.variantId,
                ended_at: new Date().toISOString(),
            })
            .eq("id", experiment.id);

        const detail = { reason: "all_variants_worse", comparisons: liveComparisons, stats };
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

    const detail = { reason: "no_clear_winner_yet", comparisons: liveComparisons, stats, kills };
    await log(supabase, experiment.id, "evaluated", detail);
    return { experiment_id: experiment.id, name: experiment.name, decision: kills.length > 0 ? "killed_variant" : "continue", ...detail };
}

async function log(
    supabase: ReturnType<typeof getSupabaseAdmin>,
    experiment_id: string | null,
    action: string,
    detail: Record<string, unknown>
) {
    await supabase.from("agent_actions").insert({ experiment_id, action, detail });
}

// Best-effort wrapper: a failed proposal (Claude down, key missing, bad
// output) must never fail the evaluation itself — the promotion already
// happened and is the thing that matters. But every non-proposal is LOGGED:
// "the agent quietly stopped closing the loop" must be visible on the
// dashboard, not buried in function logs.
async function propose(
    supabase: ReturnType<typeof getSupabaseAdmin>,
    experiment_id: string,
    outcome_summary: string
) {
    try {
        const result = await proposeNextExperiment(supabase, experiment_id, outcome_summary);
        if (!result.proposed) {
            await log(supabase, experiment_id, "proposal_skipped", { reason: result.reason });
        }
        return result;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await log(supabase, experiment_id, "proposal_failed", { message });
        return { proposed: false as const, reason: `error: ${message}` };
    }
}
