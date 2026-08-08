import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { buildSnapshot, PostHogConnection } from "@/lib/posthog";

// Daily PostHog sync — runs at 08:00 UTC, an hour before /api/agent/evaluate,
// so the agent always reasons over fresh traffic data. For every connected
// site: pull 30 days of aggregates from PostHog and upsert today's
// analytics_snapshots row.
//
// Failure model mirrors the propose() wrapper in the evaluate route: a broken
// integration NEVER fails the run. The site keeps its previous snapshot
// (consumers just read the latest row), the integration row records the error
// for the Settings card, and an agent_actions row makes the failure visible
// in the activity feed.

export const maxDuration = 60;

export async function POST(request: Request) {
    return runSync(request);
}

// Vercel Cron sends GET
export async function GET(request: Request) {
    return runSync(request);
}

async function runSync(request: Request) {
    const auth = request.headers.get("authorization");
    const secrets = [process.env.AGENT_SECRET, process.env.CRON_SECRET].filter(Boolean);
    if (secrets.length === 0 || !secrets.some((s) => auth === `Bearer ${s}`)) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    const supabase = getSupabaseAdmin();
    const { data: integrations, error } = await supabase
        .from("integrations")
        .select("id, site_id, host, project_id, api_key, sites ( domain )")
        .eq("provider", "posthog");
    if (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }

    let synced = 0;
    const errors: { site_id: string; message: string }[] = [];

    for (const integration of integrations ?? []) {
        const conn: PostHogConnection = {
            host: integration.host,
            project_id: integration.project_id,
            api_key: integration.api_key,
        };
        // supabase-js types embedded to-one relations as an array; take either shape
        const siteRel = integration.sites as { domain: string } | { domain: string }[] | null;
        const domain = (Array.isArray(siteRel) ? siteRel[0]?.domain : siteRel?.domain) ?? "";
        try {
            const payload = await buildSnapshot(conn, domain);
            const { error: upsertError } = await supabase
                .from("analytics_snapshots")
                .upsert({ site_id: integration.site_id, payload }, { onConflict: "site_id, captured_at" });
            if (upsertError) throw new Error(upsertError.message);
            await supabase
                .from("integrations")
                .update({ status: "connected", last_error: null, last_synced_at: new Date().toISOString() })
                .eq("id", integration.id);
            synced++;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            errors.push({ site_id: integration.site_id, message });
            await supabase
                .from("integrations")
                .update({ status: "error", last_error: message.slice(0, 500) })
                .eq("id", integration.id);
            await supabase.from("agent_actions").insert({
                experiment_id: null,
                action: "analytics_sync_failed",
                detail: { site_id: integration.site_id, message: message.slice(0, 500) },
            });
        }
    }

    return Response.json({ synced, errors });
}
