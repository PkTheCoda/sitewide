// Email transport: a thin fetch wrapper around Resend's REST API — the
// official SDK is itself just this fetch, so we skip the dependency.
//
// Design rule (same as the proposal step): email must NEVER break the agent.
// Every failure — missing key, Resend outage, bad address — returns a value
// instead of throwing, and callers log it to agent_actions so a silent
// "emails quietly stopped" is impossible.
//
// Env:
//   RESEND_API_KEY — unset means every send returns {sent:false} (and gets
//                    logged), so the whole pipeline is testable before the
//                    founder creates the Resend account.
//   EMAIL_FROM     — verified sender. Defaults to Resend's shared onboarding
//                    address, which can only deliver to the Resend account
//                    owner — fine for solo testing, must be replaced with a
//                    verified domain before pilots.

export type SendResult = { sent: true; id: string } | { sent: false; reason: string };

export async function sendEmail(opts: {
    to: string;
    subject: string;
    html: string;
}): Promise<SendResult> {
    const key = process.env.RESEND_API_KEY;
    if (!key) return { sent: false, reason: "RESEND_API_KEY not set" };

    try {
        const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${key}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                from: process.env.EMAIL_FROM ?? "Sitewide Agent <onboarding@resend.dev>",
                to: opts.to,
                subject: opts.subject,
                html: opts.html,
            }),
        });
        const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
        if (!res.ok) return { sent: false, reason: body.message ?? `resend responded ${res.status}` };
        return { sent: true, id: body.id ?? "unknown" };
    } catch (err) {
        return { sent: false, reason: err instanceof Error ? err.message : String(err) };
    }
}
