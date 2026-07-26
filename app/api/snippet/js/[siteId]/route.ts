import { readFileSync } from "fs";
import path from "path";
import { buildSnippetConfig } from "@/lib/snippetConfig";
import { BOT_UA_PATTERN } from "@/lib/botFilter";

// The one-line install: <script src="https://…/api/snippet/js/SITE_ID"></script>
// placed synchronously in the <head>. Serves snippet.js with the site's config
// BAKED IN, so the anti-flicker CSS and the variant payloads exist before the
// browser paints anything — no config round-trip, no whole-page hide, no flash.
// (A deferred/async script runs after first paint is already possible, which
// is exactly what causes the flash the sync install eliminates.)
//
// Edge-cached per site: the origin sees ~2 requests per site per 30s; visitors
// get the cached copy in single-digit ms. Config changes propagate within ~30s
// on the SAME page load (the legacy fetch path only picked them up a load later).

// Read once per lambda instance. The literal path lets Next's file tracing
// bundle public/snippet.js with this route in serverless deploys.
let snippetSource: string | null = null;
function getSnippetSource(): string {
    if (snippetSource === null) {
        snippetSource = readFileSync(path.join(process.cwd(), "public", "snippet.js"), "utf8");
    }
    return snippetSource;
}

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ siteId: string }> }
) {
    // Tolerate a ".js" suffix so the install line can read naturally either way.
    const { siteId: raw } = await params;
    const siteId = raw.replace(/\.js$/, "");
    if (!siteId) {
        return new Response("// sitewide: missing site id", {
            status: 400,
            headers: { "Content-Type": "application/javascript; charset=utf-8" },
        });
    }

    try {
        const config = await buildSnippetConfig(siteId);
        // "</script" can never appear in this JSON (it's JSON.stringify output of
        // our own DB rows), but escape "<" anyway — this string is inert data, and
        // escaping makes injection through experiment copy structurally impossible.
        // `bots` ships the User-Agent list with the config so the snippet can
        // drop automated traffic before it sends anything, without carrying the
        // list in its own source (see lib/botFilter.ts).
        const embed = JSON.stringify({ siteId, config, bots: BOT_UA_PATTERN }).replace(
            /</g,
            "\\u003c"
        );
        const body = `var __SW_EMBED__ = ${embed};\n${getSnippetSource()}`;

        return new Response(body, {
            headers: {
                "Content-Type": "application/javascript; charset=utf-8",
                "Access-Control-Allow-Origin": "*",
                // Edge: fresh 30s, stale-while-revalidate 5min. Browser: no-cache
                // (max-age=0) so every page load asks the edge — that's what makes
                // config changes land in ~30s while staying fast for visitors.
                "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=300",
            },
        });
    } catch (err) {
        console.error(err);
        // Still valid JS: a broken response must never throw a SyntaxError into
        // the founder's page. The static snippet path stays usable regardless.
        return new Response("// sitewide: config unavailable, snippet disabled this load", {
            status: 500,
            headers: { "Content-Type": "application/javascript; charset=utf-8" },
        });
    }
}
