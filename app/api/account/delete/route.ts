import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

// Full account deletion. Called from Settings with the user's own access
// token — the service role does the work, the token proves who's asking.
//
// What cascades on its own vs. what we must delete by hand was verified
// empirically (2026-07-19, throwaway-user probe):
//   - deleting an EXPERIMENT cascades variants, events, agent_actions, and
//     daily views — nothing orphaned
//   - deleting the AUTH USER cascades experiments (and therefore all of the
//     above) and sites
//   - REPORTS do NOT cascade from the user, COMMENTS do not cascade from
//     reports, and Storage screenshots are never touched by SQL
// So the manual part is: screenshots → comments → reports, then the auth
// user takes everything else down with it.
export async function POST(request: Request) {
    const auth = request.headers.get("authorization");
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    const supabase = getSupabaseAdmin();

    // The token identifies the caller — a user can only delete themselves.
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    const userId = userData.user.id;

    const { data: reports } = await supabase
        .from("reports")
        .select("id")
        .eq("user_id", userId);

    let screenshotsDeleted = 0;
    for (const report of reports ?? []) {
        const { data: files } = await supabase.storage
            .from("screenshots")
            .list(String(report.id));
        if (files && files.length > 0) {
            const paths = files.map((f) => `${report.id}/${f.name}`);
            const { error } = await supabase.storage.from("screenshots").remove(paths);
            if (!error) screenshotsDeleted += paths.length;
        }
        await supabase.from("comments").delete().eq("report_id", report.id);
    }
    await supabase.from("reports").delete().eq("user_id", userId);

    // Cascades experiments (variants/events/agent_actions/daily views) + sites.
    const { error: deleteError } = await supabase.auth.admin.deleteUser(userId);
    if (deleteError) {
        return Response.json({ error: deleteError.message }, { status: 500 });
    }

    return Response.json({
        deleted: true,
        reports: reports?.length ?? 0,
        screenshots: screenshotsDeleted,
    });
}
