import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { buildSnapshot, normalizeHost, testConnection } from "@/lib/posthog";

// PostHog connection management. Called from Settings with the caller's own
// access token (same pattern as /api/report/delete): the token proves who's
// asking, the service role does the work — required here because the
// integrations table has RLS enabled with NO policies, so the founder's API
// key is invisible to every client. Responses are always sanitized: the
// api_key goes into the database and never comes back out.
//
// POST   { site_id, host, project_id, api_key } → validate against PostHog,
//        pull the first snapshot immediately (data exists the moment they
//        connect), upsert the connection.
// GET    → sanitized connection rows for the caller's sites.
// DELETE { site_id } → disconnect. Snapshots are kept; they cascade with the
//        site and stay useful if the founder reconnects.

export const maxDuration = 60; // connect runs live PostHog queries

const SANITIZED_COLUMNS =
    "id, site_id, provider, host, project_id, status, last_synced_at, last_error, created_at";

async function authenticate(request: Request) {
    const auth = request.headers.get("authorization");
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return null;
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return null;
    return { supabase, userId: data.user.id };
}

export async function POST(request: Request) {
    const ctx = await authenticate(request);
    if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
    const { supabase, userId } = ctx;

    const body = await request.json().catch(() => null);
    const site_id = typeof body?.site_id === "string" ? body.site_id : null;
    const project_id = String(body?.project_id ?? "").trim();
    const api_key = String(body?.api_key ?? "").trim();
    const host = normalizeHost(String(body?.host ?? ""));
    if (!site_id || !project_id || !api_key) {
        return Response.json({ error: "site_id, project_id and api_key are required" }, { status: 400 });
    }

    const { data: site } = await supabase
        .from("sites")
        .select("id, user_id, domain")
        .eq("id", site_id)
        .single();
    if (!site) return Response.json({ error: "not found" }, { status: 404 });
    if (site.user_id !== userId) return Response.json({ error: "forbidden" }, { status: 403 });

    const conn = { host, project_id, api_key };
    const check = await testConnection(conn);
    if (!check.ok) return Response.json({ error: check.message }, { status: 400 });

    const { data: integration, error: upsertError } = await supabase
        .from("integrations")
        .upsert(
            {
                user_id: userId,
                site_id,
                provider: "posthog",
                host,
                project_id,
                api_key,
                status: "connected",
                last_error: null,
                last_synced_at: new Date().toISOString(),
            },
            { onConflict: "site_id, provider" }
        )
        .select(SANITIZED_COLUMNS)
        .single();
    if (upsertError || !integration) {
        return Response.json({ error: upsertError?.message ?? "insert failed" }, { status: 500 });
    }

    // First snapshot right now — best-effort; the nightly cron self-heals a
    // failure here, and the connection itself already validated.
    let snapshot_ready = false;
    try {
        const payload = await buildSnapshot(conn, site.domain);
        const { error } = await supabase
            .from("analytics_snapshots")
            .upsert({ site_id, payload }, { onConflict: "site_id, captured_at" });
        snapshot_ready = !error;
    } catch {
        // leave snapshot_ready false
    }

    return Response.json({ connected: true, integration, snapshot_ready });
}

export async function GET(request: Request) {
    const ctx = await authenticate(request);
    if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
    const { supabase, userId } = ctx;

    const { data, error } = await supabase
        .from("integrations")
        .select(SANITIZED_COLUMNS)
        .eq("user_id", userId);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ integrations: data ?? [] });
}

export async function DELETE(request: Request) {
    const ctx = await authenticate(request);
    if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
    const { supabase, userId } = ctx;

    const body = await request.json().catch(() => null);
    const site_id = typeof body?.site_id === "string" ? body.site_id : null;
    if (!site_id) return Response.json({ error: "site_id required" }, { status: 400 });

    const { error } = await supabase
        .from("integrations")
        .delete()
        .eq("site_id", site_id)
        .eq("user_id", userId)
        .eq("provider", "posthog");
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ disconnected: true });
}
