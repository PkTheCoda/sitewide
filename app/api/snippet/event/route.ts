import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isBotUserAgent } from "@/lib/botFilter";
import { clientIp, hostMatchesDomain, isUuid, rateLimit, requesterHost } from "@/lib/snippetGuards";

// Public event ingest, called by the snippet (sendBeacon/fetch) from the
// founder's domain. The unique index (experiment_id, visitor_id, event_type)
// makes inserts idempotent — the snippet fires naively, the DB keeps one
// exposure + one conversion per visitor per experiment, stats just count rows.
//
// Every rejection below returns 200 with a `filtered` reason rather than an
// error status: a beacon that errors is retried by some browsers, and a
// flooder learns nothing useful from the difference.
const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
};

// A real visitor produces at most a few events per page (one exposure per
// experiment on the page, a conversion, maybe a selector_miss). This is far
// above that and far below what it takes to move an experiment's numbers.
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

export function OPTIONS() {
    return new Response(null, { status: 204, headers: CORS });
}

const filtered = (reason: string) => Response.json({ ok: true, filtered: reason }, { headers: CORS });

export async function POST(request: Request) {
    // Backstop for the filtering the snippet already does client-side: this
    // reads the REAL User-Agent header, so it also covers legacy installs
    // (whose embedded list may be stale) and anything that lied about
    // navigator.userAgent. Free — the header is on the request either way —
    // and it runs before any database work.
    if (isBotUserAgent(request.headers.get("user-agent"))) return filtered("bot");

    if (!rateLimit(`event:${clientIp(request)}`, RATE_LIMIT, RATE_WINDOW_MS)) {
        return filtered("rate limit");
    }

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

    // UUID checks before any query: a malformed id would make PostgREST throw
    // (a 500 per hit) instead of simply matching nothing.
    if (!isUuid(experiment_id) || !isUuid(variant_id) || !visitor_id) {
        return Response.json({ error: "missing or malformed fields" }, { status: 400, headers: CORS });
    }
    // selector_miss = the snippet couldn't find the variant's target element
    // (selector + fallback both failed) — the agent pauses experiments where
    // this happens to a meaningful share of visitors.
    if (event_type !== "exposure" && event_type !== "conversion" && event_type !== "selector_miss") {
        return Response.json({ error: "bad event_type" }, { status: 400, headers: CORS });
    }
    if (typeof visitor_id !== "string" || visitor_id.length > 64 || !/^[\w-]+$/.test(visitor_id)) {
        return Response.json({ error: "bad visitor_id" }, { status: 400, headers: CORS });
    }

    const supabase = getSupabaseAdmin();

    // Only accept events for experiments that are actually running, and only
    // for variants that belong to them — a public endpoint must not be a way
    // to write arbitrary rows. The site's domain rides along for the origin
    // check below.
    // `!experiment_id` names which of the two FKs linking these tables to
    // follow (same ambiguity as in the config route).
    const { data: variant } = await supabase
        .from("experiment_variants")
        .select("id, experiments!experiment_id!inner ( id, status, sites ( domain ) )")
        .eq("id", variant_id)
        .eq("experiment_id", experiment_id)
        .eq("experiments.status", "running")
        .maybeSingle();

    if (!variant) {
        return Response.json({ error: "unknown experiment/variant" }, { status: 404, headers: CORS });
    }

    // Browsers attach Origin to every cross-origin POST and pages can't forge
    // it, so an event whose Origin isn't the experiment's own domain came from
    // somewhere else — a preview deploy, a copied tag, or a script. Experiment
    // and variant ids are visible in the served snippet, so this (plus the
    // rate limit) is what stops a stranger from fabricating a pilot's results.
    const experiment = variant.experiments as unknown as { sites: { domain: string } | null };
    const domain = experiment?.sites?.domain;
    if (domain && !hostMatchesDomain(requesterHost(request), domain)) {
        return filtered("origin mismatch");
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
