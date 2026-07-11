import { buildSnippetConfig } from "@/lib/snippetConfig";

// Legacy config endpoint, still called by static-snippet installs
// (<script defer src="/snippet.js" data-site-id=…>) and by the snippet's
// background cache refresh. New installs use /api/snippet/js/[siteId], which
// bakes this same config into the script response — see lib/snippetConfig.ts.
// CORS-open by design; edge-cached so the origin (and Supabase) only sees
// ~1 request per site per minute regardless of traffic.
const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
};

export function OPTIONS() {
    return new Response(null, { status: 204, headers: CORS });
}

export async function GET(request: Request) {
    const siteId = new URL(request.url).searchParams.get("site_id");
    if (!siteId) {
        return Response.json({ error: "site_id required" }, { status: 400, headers: CORS });
    }

    try {
        const config = await buildSnippetConfig(siteId);
        return Response.json(config, {
            headers: {
                ...CORS,
                // Vercel edge cache: fresh for 60s, serve stale for 5min while
                // revalidating. Pausing an experiment takes effect within ~1min.
                "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
            },
        });
    } catch (err) {
        console.error(err);
        const message = err instanceof Error ? err.message : "config build failed";
        return Response.json({ error: message }, { status: 500, headers: CORS });
    }
}
