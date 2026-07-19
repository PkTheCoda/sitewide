import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { sendEmail } from "@/lib/email";
import { agentActionSummary } from "@/lib/agentSummary";
import { AgentAction } from "@/lib/types";

// ─── The agent's voice outside the dashboard ────────────────────────────────
//
// Two kinds of email, both best-effort and both logged to agent_actions
// (email_sent / email_failed / digest_sent):
//
//   Decision emails — sent the moment the daily run does something decisive
//   (winner promoted, test ended, variant killed, experiment paused). Rare by
//   construction: quiet days send nothing.
//
//   Weekly digest — Mondays, one per founder: running experiments with live
//   numbers, everything the agent did this week, and the pending proposal
//   with an approve link. Piggybacks on the daily evaluate cron rather than
//   using the second (and last) Hobby cron slot.

type Supabase = ReturnType<typeof getSupabaseAdmin>;

const APP_URL = () => process.env.APP_URL ?? "https://sitewide.vercel.app";

async function getUserEmail(supabase: Supabase, userId: string): Promise<string | null> {
    const { data, error } = await supabase.auth.admin.getUserById(userId);
    if (error || !data?.user?.email) return null;
    return data.user.email;
}

async function log(
    supabase: Supabase,
    experiment_id: string | null,
    action: string,
    detail: Record<string, unknown>
) {
    await supabase.from("agent_actions").insert({ experiment_id, action, detail });
}

// ── Shared rendering ─────────────────────────────────────────────────────────

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

type VariantRow = {
    id: string;
    name: string;
    is_control: boolean;
    killed_at: string | null;
};

type VariantNumbers = { exposures: number; conversions: number; rate: number };

// Unique visitors per variant — same counting rules as the evaluator.
async function variantNumbers(
    supabase: Supabase,
    experimentId: string,
    variants: VariantRow[]
): Promise<Map<string, VariantNumbers>> {
    const { data: events } = await supabase
        .from("experiment_events")
        .select("variant_id, visitor_id, event_type")
        .eq("experiment_id", experimentId);

    const exposed = new Map<string, Set<string>>();
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
    const out = new Map<string, VariantNumbers>();
    for (const v of variants) {
        const n = exposed.get(v.id)!.size;
        const c = converted.get(v.id)!.size;
        out.set(v.id, { exposures: n, conversions: c, rate: n > 0 ? c / n : 0 });
    }
    return out;
}

function esc(s: unknown): string {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function variantTable(variants: VariantRow[], numbers: Map<string, VariantNumbers>): string {
    const control = variants.find((v) => v.is_control);
    const controlRate = control ? numbers.get(control.id)!.rate : 0;
    const rows = variants
        .map((v) => {
            const n = numbers.get(v.id)!;
            const lift =
                v.is_control || controlRate === 0
                    ? "—"
                    : `${n.rate >= controlRate ? "+" : ""}${(((n.rate - controlRate) / controlRate) * 100).toFixed(0)}%`;
            const name = v.killed_at ? `${esc(v.name)} (stopped)` : esc(v.name);
            return `<tr>
                <td style="padding:6px 12px 6px 0;">${name}${v.is_control ? " <span style='color:#888'>(control)</span>" : ""}</td>
                <td style="padding:6px 12px;text-align:right;">${n.exposures}</td>
                <td style="padding:6px 12px;text-align:right;">${n.conversions}</td>
                <td style="padding:6px 12px;text-align:right;">${pct(n.rate)}</td>
                <td style="padding:6px 0 6px 12px;text-align:right;">${lift}</td>
            </tr>`;
        })
        .join("");
    return `<table style="border-collapse:collapse;font-size:14px;width:100%;max-width:520px;">
        <tr style="color:#888;text-align:right;">
            <th style="text-align:left;padding:0 12px 4px 0;font-weight:600;">Variant</th>
            <th style="padding:0 12px 4px;font-weight:600;">Visitors</th>
            <th style="padding:0 12px 4px;font-weight:600;">Conversions</th>
            <th style="padding:0 12px 4px;font-weight:600;">Rate</th>
            <th style="padding:0 0 4px 12px;font-weight:600;">Lift</th>
        </tr>${rows}</table>`;
}

function shell(title: string, bodyHtml: string): string {
    return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;max-width:560px;margin:0 auto;padding:24px 16px;">
        <p style="font-size:13px;color:#888;margin:0 0 16px;">Sitewide — your optimization agent</p>
        <h2 style="font-size:19px;margin:0 0 16px;">${title}</h2>
        ${bodyHtml}
        <p style="margin:28px 0 0;">
            <a href="${APP_URL()}/dashboard/experiments" style="background:#1a1a1a;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-size:14px;">Open dashboard</a>
        </p>
    </div>`;
}

// ── Decision emails ──────────────────────────────────────────────────────────

const DECISION_SUBJECTS: Record<string, (name: string) => string> = {
    promoted_winner: (n) => `🎉 Winner promoted: ${n}`,
    kept_control: (n) => `Test ended, original kept: ${n}`,
    paused_broken: (n) => `⚠️ Needs your attention: ${n} was paused`,
    killed_variant: (n) => `Losing variant stopped: ${n}`,
};

// Called by the evaluator right after a decisive action. `action` is the
// agent_actions action name; `detail` its detail blob (already written).
export async function sendDecisionEmail(
    supabase: Supabase,
    experiment: { id: string; name: string; user_id: string },
    action: string,
    detail: Record<string, unknown>
) {
    const subjectFor = DECISION_SUBJECTS[action];
    if (!subjectFor) return;
    const subject = subjectFor(experiment.name);

    try {
        const email = await getUserEmail(supabase, experiment.user_id);
        if (!email) {
            await log(supabase, experiment.id, "email_failed", { subject, reason: "no email on account" });
            return;
        }

        const { data: variants } = await supabase
            .from("experiment_variants")
            .select("id, name, is_control, killed_at")
            .eq("experiment_id", experiment.id)
            .order("position");
        const numbers = await variantNumbers(supabase, experiment.id, (variants ?? []) as VariantRow[]);

        const summary = agentActionSummary({ action, detail } as AgentAction);
        const html = shell(
            subject,
            `<p style="font-size:15px;line-height:1.5;">${esc(summary)}.</p>
             ${variantTable((variants ?? []) as VariantRow[], numbers)}`
        );

        const result = await sendEmail({ to: email, subject, html });
        await log(supabase, experiment.id, result.sent ? "email_sent" : "email_failed", {
            subject,
            to: email,
            ...(result.sent ? { resend_id: result.id } : { reason: result.reason }),
        });
    } catch (err) {
        await log(supabase, experiment.id, "email_failed", {
            subject,
            reason: err instanceof Error ? err.message : String(err),
        });
    }
}

// ── Weekly digest ────────────────────────────────────────────────────────────

// Actions worth narrating to the founder (meta rows like heartbeats and email
// logs stay out of the digest).
const DIGEST_ACTIONS = new Set([
    "promoted_winner",
    "kept_control",
    "killed_variant",
    "paused_broken",
    "proposed_experiment",
    "evaluated",
]);

export type DigestOutcome = {
    user_id: string;
    email: string | null;
    sent: boolean;
    reason?: string;
};

// One digest per founder who has anything to say. `force` bypasses the
// once-per-day guard (manual testing).
export async function sendWeeklyDigests(
    supabase: Supabase,
    opts?: { force?: boolean }
): Promise<{ skipped?: string; outcomes: DigestOutcome[] }> {
    if (!opts?.force) {
        const today = new Date().toISOString().slice(0, 10);
        const { data: already } = await supabase
            .from("agent_actions")
            .select("id")
            .eq("action", "digest_sent")
            .gte("created_at", `${today}T00:00:00Z`)
            .limit(1);
        if (already && already.length > 0) return { skipped: "already sent today", outcomes: [] };
    }

    const { data: allExperiments } = await supabase
        .from("experiments")
        .select("id, user_id, name, status, created_by, agent_rationale")
        .neq("status", "archived");

    const byUser = new Map<string, NonNullable<typeof allExperiments>>();
    for (const exp of allExperiments ?? []) {
        if (!byUser.has(exp.user_id)) byUser.set(exp.user_id, []);
        byUser.get(exp.user_id)!.push(exp);
    }

    const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const outcomes: DigestOutcome[] = [];

    for (const [userId, experiments] of byUser) {
        const running = experiments.filter((e) => e.status === "running" || e.status === "paused");
        const drafts = experiments.filter((e) => e.created_by === "agent" && e.status === "draft");
        const expIds = experiments.map((e) => e.id);
        const nameById = new Map(experiments.map((e) => [e.id, e.name]));

        const { data: actions } = await supabase
            .from("agent_actions")
            .select("experiment_id, action, detail, created_at")
            .in("experiment_id", expIds)
            .gte("created_at", weekAgo)
            .order("created_at", { ascending: true });
        const weekActions = (actions ?? []).filter((a) => DIGEST_ACTIONS.has(a.action));

        if (running.length === 0 && drafts.length === 0 && weekActions.length === 0) continue;

        const email = await getUserEmail(supabase, userId);
        if (!email) {
            outcomes.push({ user_id: userId, email: null, sent: false, reason: "no email on account" });
            continue;
        }

        // Live numbers per running experiment
        const sections: string[] = [];
        for (const exp of running) {
            const { data: variants } = await supabase
                .from("experiment_variants")
                .select("id, name, is_control, killed_at")
                .eq("experiment_id", exp.id)
                .order("position");
            const numbers = await variantNumbers(supabase, exp.id, (variants ?? []) as VariantRow[]);
            const pausedNote =
                exp.status === "paused"
                    ? ` <span style="color:#b45309;">(paused — needs your attention)</span>`
                    : "";
            sections.push(
                `<h3 style="font-size:15px;margin:24px 0 8px;">${esc(exp.name)}${pausedNote}</h3>
                 ${variantTable((variants ?? []) as VariantRow[], numbers)}`
            );
        }

        if (weekActions.length > 0) {
            const items = weekActions
                .map(
                    (a) =>
                        `<li style="margin:6px 0;">${esc(agentActionSummary(a as AgentAction))}
                         <span style="color:#888;">(${esc(nameById.get(a.experiment_id!) ?? "experiment")})</span></li>`
                )
                .join("");
            sections.push(
                `<h3 style="font-size:15px;margin:24px 0 8px;">What the agent did this week</h3>
                 <ul style="font-size:14px;line-height:1.5;padding-left:18px;margin:0;">${items}</ul>`
            );
        }

        for (const draft of drafts) {
            sections.push(
                `<div style="border:1px solid #e5e5e5;border-radius:8px;padding:14px 16px;margin:24px 0 0;">
                    <p style="font-size:13px;color:#888;margin:0 0 4px;">Proposed next test — waiting for your approval</p>
                    <p style="font-size:15px;font-weight:600;margin:0 0 6px;">${esc(draft.name)}</p>
                    ${draft.agent_rationale ? `<p style="font-size:14px;line-height:1.5;margin:0;">${esc(draft.agent_rationale)}</p>` : ""}
                </div>`
            );
        }

        const subject = "Your week in experiments";
        const result = await sendEmail({
            to: email,
            subject,
            html: shell(subject, sections.join("")),
        });
        await log(supabase, null, "digest_sent", {
            user_id: userId,
            to: email,
            sent: result.sent,
            ...(result.sent ? { resend_id: result.id } : { reason: result.reason }),
        });
        outcomes.push({ user_id: userId, email, sent: result.sent, ...(result.sent ? {} : { reason: result.reason }) });
    }

    return { outcomes };
}
