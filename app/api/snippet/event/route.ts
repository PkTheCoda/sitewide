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
    if (event_type !== "exposure" && event_type !== "conversion") {
        return Response.json({ error: "bad event_type" }, { status: 400, headers: CORS });
    }
    if (visitor_id.length > 64) {
        return Response.json({ error: "bad visitor_id" }, { status: 400, headers: CORS });
    }

    const supabase = getSupabaseAdmin();

    // Only accept events for experiments that are actually running, and only
    // for variants that belong to them — a public endpoint must not be a way
    // to write arbitrary rows.
    const { data: variant } = await supabase
        .from("experiment_variants")
        .select("id, experiments!inner ( id, status )")
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

    return Response.json({ ok: true }, { headers: CORS });
}
