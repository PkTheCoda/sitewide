import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { hostMatchesDomain, isLocalHost, isUuid } from "@/lib/snippetGuards";

// The config payload the snippet acts on. Shared by two delivery paths:
//   - GET /api/snippet/config?site_id=X   (legacy: fetched by the static snippet)
//   - GET /api/snippet/js/[siteId]        (current: baked into the snippet itself,
//     so the browser gets code + config in ONE request, before first paint)
export type SnippetConfig = { experiments: unknown[]; reason?: string };

const EMPTY: SnippetConfig = { experiments: [] };

// Returns the experiments the snippet needs to act on, in two groups:
//   - "running"   → snippet splits visitors between variants and tracks events
//   - "completed" WITH a winner_variant_id → snippet serves the winning
//     variant to 100% of visitors, no tracking (this IS "promoting the winner";
//     completed experiments where control won are filtered out below, because
//     serving control means changing nothing)
//
// `requesterHost` is the hostname of the page loading the snippet (from the
// Origin/Referer header; null when the browser sent neither). It decides only
// whether this request counts as the snippet being INSTALLED — a site id is
// public (it's in the founder's page source), so a curl must not be able to
// flip onboarding to "live". It deliberately does NOT change the config
// served: these routes sit behind Vercel's edge cache, which keys on the URL
// alone, so a Referer-dependent body would let a preview deploy's request
// poison the cache for the real site. Data integrity comes from the event
// route instead, which rejects events whose Origin isn't the site's domain —
// a preview deploy shows variants but never counts.
export async function buildSnippetConfig(
    siteId: string,
    requesterHost: string | null = null
): Promise<SnippetConfig> {
    // Non-UUIDs would make PostgREST throw on the query (a 500 per hit for any
    // curl with a junk id); an unknown-but-valid id just yields no experiments.
    if (!isUuid(siteId)) return { ...EMPTY, reason: "invalid site id" };

    const supabase = getSupabaseAdmin();

    const [{ data: site }, { data: experiments, error }] = await Promise.all([
        supabase.from("sites").select("id, domain").eq("id", siteId).maybeSingle(),
        supabase
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
            .in("status", ["running", "completed"]),
    ]);

    if (error) throw new Error(error.message);
    if (!site) return { ...EMPTY, reason: "unknown site" };

    // Heartbeat: a config request from the site's own domain proves the tag is
    // live. Awaited — serverless instances may freeze the moment the response
    // is sent, and a dropped write here is what makes onboarding's "listening
    // for your domain" poll never turn green. Edge caching keeps this to a
    // handful of writes per site per minute. Local dev loads and foreign
    // hosts (preview deploys, copied tags) don't count.
    if (!isLocalHost(requesterHost) && hostMatchesDomain(requesterHost, site.domain)) {
        await supabase
            .from("sites")
            .update({ snippet_installed: true, snippet_last_seen_at: new Date().toISOString() })
            .eq("id", siteId);
    }

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
