import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

// Delete a single report (one analysis) and everything that hangs off it.
// Called from the Analyses tab with the caller's own access token — the
// service role does the work, the token proves who's asking and that they own
// the report.
//
// Mirrors the report-scoped slice of app/api/account/delete/route.ts: reports
// do NOT cascade their comments, and Storage screenshots are never touched by
// SQL, so we clear those by hand — screenshots (bucket prefix = report id) →
// comments → the report row itself. Any experiments built from this report
// keep running with report_id → null (by design), so we leave them untouched.
export async function POST(request: Request) {
    const auth = request.headers.get("authorization");
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const reportId = body?.report_id;
    if (reportId === undefined || reportId === null) {
        return Response.json({ error: "report_id required" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // The token identifies the caller — verify they actually own this report
    // before the service role (which bypasses RLS) deletes anything.
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    const userId = userData.user.id;

    const { data: report, error: reportError } = await supabase
        .from("reports")
        .select("id, user_id")
        .eq("id", reportId)
        .single();
    if (reportError || !report) {
        return Response.json({ error: "not found" }, { status: 404 });
    }
    if (report.user_id !== userId) {
        return Response.json({ error: "forbidden" }, { status: 403 });
    }

    // Screenshots live under a `${report.id}/` prefix in the screenshots bucket.
    let screenshotsDeleted = 0;
    const { data: files } = await supabase.storage
        .from("screenshots")
        .list(String(report.id));
    if (files && files.length > 0) {
        const paths = files.map((f) => `${report.id}/${f.name}`);
        const { error } = await supabase.storage.from("screenshots").remove(paths);
        if (!error) screenshotsDeleted = paths.length;
    }

    await supabase.from("comments").delete().eq("report_id", report.id);

    const { error: deleteError } = await supabase
        .from("reports")
        .delete()
        .eq("id", report.id);
    if (deleteError) {
        return Response.json({ error: deleteError.message }, { status: 500 });
    }

    return Response.json({ deleted: true, screenshots: screenshotsDeleted });
}
