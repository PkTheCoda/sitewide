import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

// Public event ingest, called by the snippet (sendBeacon/fetch) from the
// founder's domain. The unique index (experiment_id, visitor_id, event_type)
// makes inserts idempotent — the snippet fires naively, the DB keeps one
// exposure + one conversion per visitor per experiment, stats just count rows.
const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
};

export function OPTIONS() {
    return new Response(null, { status: 204, headers: CORS });
}

export async function POST(request: Request) {
    let body: {
        experiment_id?: string;
        variant_id?: string;
        visitor_id?: string;
        event_type?: string;
        page_url?: string;
    };
    try {
        body = await request.json();
    } catch {
        return Response.json({ error: "invalid JSON" }, { status: 400, headers: CORS });
    }

    const { experiment_id, variant_id, visitor_id, event_type, page_url } = body;

    if (!experiment_id || !variant_id || !visitor_id) {
        return Response.json({ error: "missing fields" }, { status: 400, headers: CORS });
    }
    // selector_miss = the snippet couldn't find the variant's target element
    // (selector + fallback both failed) — the agent pauses experiments where
    // this happens to a meaningful share of visitors.
    if (event_type !== "exposure" && event_type !== "conversion" && event_type !== "selector_miss") {
        return Response.json({ error: "bad event_type" }, { status: 400, headers: CORS });
    }
    if (visitor_id.length > 64) {
        return Response.json({ error: "bad visitor_id" }, { status: 400, headers: CORS });
    }

    const supabase = getSupabaseAdmin();

    // Only accept events for experiments that are actually running, and only
    // for variants that belong to them — a public endpoint must not be a way
    // to write arbitrary rows.
    // `!experiment_id` names which of the two FKs linking these tables to
    // follow (same ambiguity as in the config route).
    const { data: variant } = await supabase
        .from("experiment_variants")
        .select("id, experiments!experiment_id!inner ( id, status )")
        .eq("id", variant_id)
        .eq("experiment_id", experiment_id)
        .eq("experiments.status", "running")
        .maybeSingle();

    if (!variant) {
        return Response.json({ error: "unknown experiment/variant" }, { status: 404, headers: CORS });
    }

    const { error } = await supabase.from("experiment_events").upsert(
        {
            experiment_id,
            variant_id,
            visitor_id,
            event_type,
            page_url: page_url?.slice(0, 500) ?? null,
        },
        { onConflict: "experiment_id,visitor_id,event_type", ignoreDuplicates: true }
    );

    if (error) {
        console.error(error);
        return Response.json({ error: error.message }, { status: 500, headers: CORS });
    }

    // Raw daily page views: the snippet fires an exposure beacon on EVERY
    // load of the experiment page (the upsert above just ignores repeats), so
    // each exposure beacon = one page view. Counted per variant per UTC day
    // in experiment_daily_views — powers the dashboard's day-by-day charts.
    // Best-effort: a failed increment must not fail the beacon.
    if (event_type === "exposure") {
        const { error: viewsError } = await supabase.rpc("increment_daily_views", {
            p_experiment_id: experiment_id,
            p_variant_id: variant_id,
        });
        if (viewsError) console.error("daily views increment failed:", viewsError);
    }

    return Response.json({ ok: true }, { headers: CORS });
}
