import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { sendWeeklyDigests } from "@/lib/agentEmails";

export const maxDuration = 60;

// Manual digest trigger. The scheduled path is the daily evaluate cron
// (Mondays); this exists for testing and for re-sending on demand:
//
//   curl -X POST https://.../api/agent/digest \
//     -H "authorization: Bearer $AGENT_SECRET" -H "content-type: application/json" \
//     -d '{"force": true}'
//
// force bypasses the once-per-day guard.
export async function POST(request: Request) {
    const auth = request.headers.get("authorization");
    const secrets = [process.env.AGENT_SECRET, process.env.CRON_SECRET].filter(Boolean);
    if (secrets.length === 0 || !secrets.some((s) => auth === `Bearer ${s}`)) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    let force = false;
    try {
        const body = await request.json();
        force = body?.force === true;
    } catch {
        /* empty body is fine */
    }

    const result = await sendWeeklyDigests(getSupabaseAdmin(), { force });
    return Response.json(result);
}
