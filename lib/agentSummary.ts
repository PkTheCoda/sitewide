import { AgentAction } from "@/lib/types";

// One-line human rendering of an agent_actions row. The detail blob's shape
// depends on the action (see /api/agent/evaluate) — read it defensively.
// Shared by the experiment card and the individual experiment page.
export function agentActionSummary(action: AgentAction): string {
    const d = (action.detail ?? {}) as Record<string, unknown>;
    const pct = (n: unknown) => (typeof n === "number" ? `${(n * 100).toFixed(1)}%` : "?");
    if (action.action === "promoted_winner") {
        const verb = d.auto_promoted === false ? "Found a winner (auto-promote is off)" : "Promoted winner";
        const p = typeof d.p_value === "number" ? d.p_value.toFixed(4) : "?";
        return `${verb}: ${d.winner_name ?? "variant"} — ${pct(d.winner_rate)} vs ${pct(d.control_rate)} control (p=${p})`;
    }
    if (action.action === "kept_control")
        return d.reason === "harm_gate"
            ? "Circuit breaker: ended the test early — every variant was significantly hurting conversions, the original is back for all visitors"
            : "Ended the test — every variant performed significantly worse than the original";
    if (action.action === "killed_variant") {
        const p = typeof d.p_value === "number" ? d.p_value.toFixed(4) : "?";
        return `Circuit breaker: killed "${d.variant_name ?? "a variant"}" — ${pct(d.variant_rate)} vs ${pct(d.control_rate)} control (p=${p}); its visitors now see the original, the test continues with the remaining variants`;
    }
    if (action.action === "paused_broken")
        return `Paused the experiment — ${d.miss_visitors ?? "several"} visitors couldn't be shown "${d.variant_name ?? "a variant"}" because its page element wasn't found (did the page change?). Fix the selector and resume`;
    if (action.action === "proposed_experiment")
        return `Proposed a follow-up test: "${d.name ?? "new experiment"}" — it's waiting in your experiments list as a draft`;
    if (action.action === "proposal_skipped")
        return `No follow-up test drafted — ${d.reason ?? "nothing worth proposing"}`;
    if (action.action === "proposal_failed")
        return `Couldn't draft a follow-up test (${d.message ?? "unknown error"}) — the evaluation itself was unaffected`;
    if (action.action === "error") return `Error during evaluation: ${d.message ?? "unknown"}`;
    if (d.reason === "insufficient_sample")
        return `Waiting for more data — every variant needs ${d.min_sample_size ?? "?"} visitors before the agent will decide`;
    return "Evaluated — no statistically significant difference between variants yet";
}
