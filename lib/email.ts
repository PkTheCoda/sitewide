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
//   EMAIL_FROM     — verified sender, REQUIRED. Unset means every send returns
//                    {sent:false} with a reason naming the fix. (It used to
//                    fall back to Resend's shared onboarding address, which
//                    only delivers to the Resend account owner — the founder's
//                    own inbox worked while every pilot's stayed empty.)

export type SendResult = { sent: true; id: string } | { sent: false; reason: string };

export async function sendEmail(opts: {
    to: string;
    subject: string;
    html: string;
}): Promise<SendResult> {
    const key = process.env.RESEND_API_KEY;
    if (!key) return { sent: false, reason: "RESEND_API_KEY not set" };

    // The shared onboarding sender is a trap: Resend accepts the request but
    // only delivers to the account owner, so the founder sees their own test
    // emails arrive and assumes pilots get them too. Refuse to send to anyone
    // else from it, with a reason that says exactly what to set.
    const from = process.env.EMAIL_FROM;
    if (!from) {
        return {
            sent: false,
            reason: "EMAIL_FROM not set — Resend's shared onboarding@resend.dev sender only delivers to the Resend account owner. Verify a domain in Resend and set EMAIL_FROM (e.g. \"Sitewide Agent <agent@yourdomain.com>\") in Vercel.",
        };
    }

    try {
        const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${key}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                from,
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
