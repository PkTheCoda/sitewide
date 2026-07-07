import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

// Public endpoint, called by the snippet from the founder's domain on every
// page load. CORS-open by design; edge-cached so the origin (and Supabase)
// only sees ~1 request per site per minute regardless of traffic.
const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
};

export function OPTIONS() {
    return new Response(null, { status: 204, headers: CORS });
}

// Returns the experiments the snippet needs to act on, in two groups:
//   - "running"   → snippet splits visitors between variants and tracks events
//   - "completed" WITH a winner_variant_id → snippet serves the winning
//     variant to 100% of visitors, no tracking (this IS "promoting the winner";
//     completed experiments where control won are filtered out below, because
//     serving control means changing nothing)
export async function GET(request: Request) {
    const siteId = new URL(request.url).searchParams.get("site_id");
    if (!siteId) {
        return Response.json({ error: "site_id required" }, { status: 400, headers: CORS });
    }

    const supabase = getSupabaseAdmin();

    // Running experiments (being tested) + completed ones with a winner
    // (served to everyone at 100% — that's what "promoted" means).
    const { data: experiments, error } = await supabase
        .from("experiments")
        .select(
            // `!experiment_id` disambiguates the join: experiments and
            // experiment_variants are linked by TWO foreign keys (variants'
            // experiment_id, and experiments' winner_variant_id), so we must
            // name which one to follow or PostgREST errors out.
            `id, page_url, selector, selector_fallback, change_type, status,
             goal_type, goal_selector, goal_fallback, goal_page_path, winner_variant_id,
             experiment_variants!experiment_id ( id, is_control, payload, weight, position )`
        )
        .eq("site_id", siteId)
        .in("status", ["running", "completed"]);

    if (error) {
        console.error(error);
        return Response.json({ error: error.message }, { status: 500, headers: CORS });
    }

    // Heartbeat: the config being fetched proves the snippet is installed.
    // Fire-and-forget; edge caching keeps this to ~once a minute per site.
    supabase
        .from("sites")
        .update({ snippet_installed: true, snippet_last_seen_at: new Date().toISOString() })
        .eq("id", siteId)
        .then(() => {});

    const payload = (experiments ?? [])
        .filter((exp) => exp.status === "running" || exp.winner_variant_id)
        .map((exp) => {
            let pagePath = "/";
            try {
                pagePath = new URL(exp.page_url).pathname;
            } catch {
                /* keep default */
            }
            return {
                id: exp.id,
                page_path: pagePath,
                selector: exp.selector,
                selector_fallback: exp.selector_fallback,
                status: exp.status,
                goal_type: exp.goal_type,
                goal_selector: exp.goal_selector,
                goal_page_path: exp.goal_page_path,
                winner_variant_id: exp.winner_variant_id,
                variants: (exp.experiment_variants ?? [])
                    .sort((a: { position: number }, b: { position: number }) => a.position - b.position)
                    .map((v: { id: string; is_control: boolean; payload: unknown; weight: number }) => ({
                        id: v.id,
                        is_control: v.is_control,
                        payload: v.payload,
                        weight: v.weight,
                    })),
            };
        });

    return Response.json(
        { experiments: payload },
        {
            headers: {
                ...CORS,
                // Vercel edge cache: fresh for 60s, serve stale for 5min while
                // revalidating. Pausing an experiment takes effect within ~1min.
                "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
            },
        }
    );
}
