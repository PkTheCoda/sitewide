import { agentActionSummary } from "@/lib/agentSummary";
import { AgentAction } from "@/lib/types";
import {
    shell,
    variantTable,
    esc,
    DECISION_SUBJECTS,
    VariantRow,
    VariantNumbers,
} from "@/lib/agentEmails";

// ─── Email preview (dev tool) ───────────────────────────────────────────────
//
// Renders every agent email in the browser using the SAME template functions
// the real send path uses (shell / variantTable / agentActionSummary), so what
// you see here is byte-identical to what lands in the inbox — without sending
// anything or touching the database.
//
//   /api/agent/email-preview            → index of all types
//   /api/agent/email-preview?type=digest
//   ?type=promoted_winner | kept_control | killed_variant | paused_broken | digest
//
// Guarded: open in dev; in production it requires ?secret=$AGENT_SECRET. It
// renders only hardcoded sample data, so it never exposes founder data.

const html = (body: string) =>
    new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });

// ── Sample data (fake — no DB) ───────────────────────────────────────────────
function sampleVariants(withKill = false): { variants: VariantRow[]; numbers: Map<string, VariantNumbers> } {
    const variants: VariantRow[] = [
        { id: "c", name: "Control", is_control: true, killed_at: null },
        { id: "b", name: "Variant B", is_control: false, killed_at: null },
    ];
    const numbers = new Map<string, VariantNumbers>([
        ["c", { exposures: 1204, conversions: 60, rate: 60 / 1204 }],
        ["b", { exposures: 1198, conversions: 96, rate: 96 / 1198 }],
    ]);
    if (withKill) {
        variants.push({ id: "d", name: "Variant C", is_control: false, killed_at: new Date().toISOString() });
        numbers.set("d", { exposures: 1190, conversions: 18, rate: 18 / 1190 });
    }
    return { variants, numbers };
}

// A decision email, rendered exactly as sendDecisionEmail() builds it.
function decisionEmail(action: string, detail: Record<string, unknown>, withKill = false): string {
    const subject = DECISION_SUBJECTS[action]("Hero headline — outcome vs feature framing");
    const summary = agentActionSummary({ action, detail } as AgentAction);
    const { variants, numbers } = sampleVariants(withKill);
    return shell(subject, `<p style="font-size:15px;line-height:1.5;">${esc(summary)}.</p>${variantTable(variants, numbers)}`);
}

// The weekly digest, mirroring the section layout in sendWeeklyDigests().
function digestEmail(): string {
    const { variants, numbers } = sampleVariants();
    const running = `<h3 style="font-size:15px;margin:24px 0 8px;">Hero headline — outcome vs feature framing</h3>
        ${variantTable(variants, numbers)}
        <h3 style="font-size:15px;margin:24px 0 8px;">Pricing CTA copy <span style="color:#b45309;">(paused — needs your attention)</span></h3>
        ${variantTable(sampleVariants(true).variants, sampleVariants(true).numbers)}`;

    const weekItems = [
        { action: "promoted_winner", detail: { winner_name: "Variant B", winner_rate: 0.0801, control_rate: 0.0498, p_value: 0.0012, auto_promoted: true } },
        { action: "killed_variant", detail: { variant_name: "Variant C", variant_rate: 0.0151, control_rate: 0.0498, p_value: 0.004 } },
        { action: "paused_broken", detail: { variant_name: "Pricing CTA", miss_visitors: 7 } },
    ];
    const names = ["Hero headline", "Pricing CTA copy", "Pricing CTA copy"];
    const activity = `<h3 style="font-size:15px;margin:24px 0 8px;">What the agent did this week</h3>
        <ul style="font-size:14px;line-height:1.5;padding-left:18px;margin:0;">${weekItems
            .map(
                (a, i) =>
                    `<li style="margin:6px 0;">${esc(agentActionSummary(a as unknown as AgentAction))} <span style="color:#888;">(${esc(names[i])})</span></li>`
            )
            .join("")}</ul>`;

    const proposal = `<div style="border:1px solid #e5e5e5;border-radius:8px;padding:14px 16px;margin:24px 0 0;">
        <p style="font-size:13px;color:#888;margin:0 0 4px;">Proposed next test — waiting for your approval</p>
        <p style="font-size:15px;font-weight:600;margin:0 0 6px;">Social-proof subhead under the hero</p>
        <p style="font-size:14px;line-height:1.5;margin:0;">Your outcome-led headline beat the feature-led one by 61%. The same audience likely responds to concrete proof — testing a "trusted by 4,000 students" subhead is the natural next bet.</p>
    </div>`;

    return shell("Your week in experiments", running + activity + proposal);
}

const TYPES: Record<string, () => string> = {
    promoted_winner: () =>
        decisionEmail("promoted_winner", { winner_name: "Variant B", winner_rate: 0.0801, control_rate: 0.0498, p_value: 0.0012, auto_promoted: true }),
    kept_control: () => decisionEmail("kept_control", { reason: "all_variants_worse" }),
    killed_variant: () =>
        decisionEmail("killed_variant", { variant_name: "Variant C", variant_rate: 0.0151, control_rate: 0.0498, p_value: 0.004 }, true),
    paused_broken: () => decisionEmail("paused_broken", { variant_name: "Variant B", miss_visitors: 7 }),
    digest: () => digestEmail(),
};

function index(): string {
    const links = Object.keys(TYPES)
        .map((t) => `<li style="margin:8px 0;"><a href="?type=${t}">${t}</a></li>`)
        .join("");
    return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:40px auto;padding:0 16px;">
        <h1 style="font-size:20px;">Agent email previews</h1>
        <p style="color:#666;font-size:14px;">Rendered with the real templates. No email is sent.</p>
        <ul style="font-size:15px;">${links}</ul>
    </div>`;
}

export async function GET(request: Request) {
    if (process.env.NODE_ENV === "production") {
        const secret = new URL(request.url).searchParams.get("secret");
        if (!process.env.AGENT_SECRET || secret !== process.env.AGENT_SECRET) {
            return Response.json({ error: "unauthorized" }, { status: 401 });
        }
    }
    const type = new URL(request.url).searchParams.get("type");
    if (!type) return html(index());
    const render = TYPES[type];
    if (!render) return html(index());
    return html(render());
}
