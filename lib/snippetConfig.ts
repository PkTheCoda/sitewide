import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

// The config payload the snippet acts on. Shared by two delivery paths:
//   - GET /api/snippet/config?site_id=X   (legacy: fetched by the static snippet)
//   - GET /api/snippet/js/[siteId]        (current: baked into the snippet itself,
//     so the browser gets code + config in ONE request, before first paint)
export type SnippetConfig = { experiments: unknown[] };

// Returns the experiments the snippet needs to act on, in two groups:
//   - "running"   → snippet splits visitors between variants and tracks events
//   - "completed" WITH a winner_variant_id → snippet serves the winning
//     variant to 100% of visitors, no tracking (this IS "promoting the winner";
//     completed experiments where control won are filtered out below, because
//     serving control means changing nothing)
export async function buildSnippetConfig(siteId: string): Promise<SnippetConfig> {
    const supabase = getSupabaseAdmin();

    const { data: experiments, error } = await supabase
        .from("experiments")
        .select(
            // `!experiment_id` disambiguates the join: experiments and
            // experiment_variants are linked by TWO foreign keys (variants'
            // experiment_id, and experiments' winner_variant_id), so we must
            // name which one to follow or PostgREST errors out.
            `id, page_url, selector, selector_fallback, change_type, status,
             goal_type, goal_selector, goal_fallback, goal_page_path, winner_variant_id,
             experiment_variants!experiment_id ( id, is_control, payload, weight, position, killed_at )`
        )
        .eq("site_id", siteId)
        .in("status", ["running", "completed"]);

    if (error) throw new Error(error.message);

    // Heartbeat: the config being requested proves the snippet is installed.
    // Fire-and-forget; edge caching keeps this to a handful of hits per minute.
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
                    .map((v: { id: string; is_control: boolean; payload: unknown; weight: number; killed_at: string | null }) => ({
                        id: v.id,
                        is_control: v.is_control,
                        payload: v.payload,
                        weight: v.weight,
                        // Killed by the agent's circuit breaker: the variant keeps
                        // its bucket range (so other arms' assignments are stable)
                        // but the snippet serves it the control experience and
                        // sends no events.
                        killed: !!v.killed_at,
                    })),
            };
        });

    return { experiments: payload };
}
