import { AgentAction } from "@/lib/types";

// One-line human rendering of an agent_actions row. The detail blob's shape
// depends on the action (see /api/agent/evaluate) — read it defensively.
// Shared by the experiment card and the individual experiment page.
export function agentActionSummary(action: AgentAction): string {
    const d = (action.detail ?? {}) as Record<string, unknown>;
    const pct = (n: unknown) => (typeof n === "number" ? `${(n * 100).toFixed(1)}%` : "?");
    // New rows log chance_to_beat (Bayesian, 0..1); rows from before the
    // sequential-stats switch logged a z-test p_value instead.
    const confidence = (chance: unknown, p: unknown) =>
        typeof chance === "number"
            ? `${(chance * 100).toFixed(1)}% sure`
            : typeof p === "number"
              ? `p=${p.toFixed(4)}`
              : "?";
    if (action.action === "promoted_winner") {
        const verb = d.auto_promoted === false ? "Found a winner (auto-promote is off)" : "Promoted winner";
        return `${verb}: ${d.winner_name ?? "variant"} — ${pct(d.winner_rate)} vs ${pct(d.control_rate)} control (${confidence(d.chance_to_beat, d.p_value)} it's genuinely better)`;
    }
    if (action.action === "kept_control")
        return d.reason === "harm_gate"
            ? "Circuit breaker: ended the test early — every variant was confidently hurting conversions, the original is back for all visitors"
            : "Ended the test — every variant performed confidently worse than the original";
    if (action.action === "killed_variant") {
        const chance =
            typeof d.chance_to_beat === "number"
                ? `${((1 - (d.chance_to_beat as number)) * 100).toFixed(1)}% sure it was losing`
                : typeof d.p_value === "number"
                  ? `p=${(d.p_value as number).toFixed(4)}`
                  : "?";
        return `Circuit breaker: killed "${d.variant_name ?? "a variant"}" — ${pct(d.variant_rate)} vs ${pct(d.control_rate)} control (${chance}); its visitors now see the original, the test continues with the remaining variants`;
    }
    if (action.action === "paused_broken")
        return `Paused the experiment — ${d.miss_visitors ?? "several"} visitors couldn't be shown "${d.variant_name ?? "a variant"}" because its page element wasn't found (did the page change?). Fix the selector and resume`;
    if (action.action === "proposed_experiment")
        return `Proposed a follow-up test: "${d.name ?? "new experiment"}" — it's waiting in your experiments list as a draft`;
    if (action.action === "proposal_skipped")
        return `No follow-up test drafted — ${d.reason ?? "nothing worth proposing"}`;
    if (action.action === "proposal_failed")
        return `Couldn't draft a follow-up test (${d.message ?? "unknown error"}) — the evaluation itself was unaffected`;
    if (action.action === "analytics_sync_failed")
        return `Couldn't sync your PostHog data (${d.message ?? "unknown error"}) — the agent used the previous day's numbers instead. Check the connection in Settings`;
    if (action.action === "email_sent") return `Emailed you: "${d.subject ?? "notification"}"`;
    if (action.action === "email_failed")
        return `Couldn't send the email "${d.subject ?? "notification"}" (${d.reason ?? "unknown"})`;
    if (action.action === "error") return `Error during evaluation: ${d.message ?? "unknown"}`;
    if (d.reason === "insufficient_sample")
        return `Waiting for more data — every variant needs ${d.min_sample_size ?? "?"} visitors before the agent starts judging`;
    return "Evaluated — no version is confidently better yet, the test continues";
}
