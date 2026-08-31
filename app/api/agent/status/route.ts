import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

// "Is the agent alive?" for the dashboard. The evaluate run writes
// run_started / run_finished heartbeat rows with experiment_id = null; those
// rows belong to no experiment, so the client's RLS-scoped feed query (which
// joins through experiments) can never see them. This route reads them with
// the service role and answers only the question the founder cares about:
// when did the agent last run, did it finish, and are its emails getting
// through. The caller's own access token gates it, same as report-delete.
//
// Silent cron death is the one failure this product has already had
// (2026-07-13: CRON_SECRET unset → 401 before any logging). The heartbeat
// was the fix, but nothing displayed it — so it was still silent.

export type AgentStatus = {
    last_started_at: string | null;
    last_finished_at: string | null;
    last_run_error: string | null;
    last_run_evaluated: number | null;
    email_failures_7d: number;
    last_email_failure: string | null;
};

export async function GET(request: Request) {
    const auth = request.headers.get("authorization");
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return Response.json({ error: "unauthorized" }, { status: 401 });

    const supabase = getSupabaseAdmin();
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user) return Response.json({ error: "unauthorized" }, { status: 401 });
    const userId = userData.user.id;

    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const [started, finished, emailFailures] = await Promise.all([
        supabase
            .from("agent_actions")
            .select("created_at")
            .eq("action", "run_started")
            .is("experiment_id", null)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        supabase
            .from("agent_actions")
            .select("created_at, detail")
            .eq("action", "run_finished")
            .is("experiment_id", null)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        // Only this founder's failures. Decision emails log `email_failed`
        // rows hanging off their experiment; the Monday digest logs one
        // `digest_sent` row per founder (experiment_id null) whose detail
        // carries user_id and sent:false when it didn't go out.
        supabase
            .from("agent_actions")
            .select("created_at, action, detail, experiments!left(user_id)")
            .in("action", ["email_failed", "digest_sent"])
            .gte("created_at", since)
            .order("created_at", { ascending: false })
            .limit(100),
    ]);

    const mine = (emailFailures.data ?? []).filter((row) => {
        const exp = row.experiments as unknown as { user_id: string } | null;
        const detail = row.detail as { user_id?: string; sent?: boolean } | null;
        if (row.action === "digest_sent") return detail?.user_id === userId && detail?.sent === false;
        return exp?.user_id === userId || detail?.user_id === userId;
    });
    const finishedDetail = (finished.data?.detail ?? null) as { error?: string; evaluated?: number } | null;

    const status: AgentStatus = {
        last_started_at: started.data?.created_at ?? null,
        last_finished_at: finished.data?.created_at ?? null,
        last_run_error: finishedDetail?.error ?? null,
        last_run_evaluated: finishedDetail?.evaluated ?? null,
        email_failures_7d: mine.length,
        last_email_failure: ((mine[0]?.detail as { reason?: string } | undefined)?.reason) ?? null,
    };
    return Response.json(status, { headers: { "Cache-Control": "private, no-store" } });
}
