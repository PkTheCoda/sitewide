// Relative import (not @/) so scripts/test-posthog.ts can run this file under
// plain `node`, same as scripts/test-bayes-stats.ts does with lib/stats.
import type { AnalyticsPayload } from "./types.ts";

// ─── PostHog Query API client (SERVER-ONLY) ─────────────────────────────────
//
// Talks to a founder's PostHog project with their personal API key (query:read
// scope). Used by the connect route and the daily sync cron — never import
// this from client code; the api_key must not reach the browser.
//
// Facts this code is built around (posthog.com/docs/api/queries, Aug 2026):
// - Endpoint: POST {host}/api/projects/{id}/query/ on the PRIVATE hosts
//   (us|eu).posthog.com — not the *.i.posthog.com ingestion hosts.
// - Responses are column-oriented: { columns: [...], results: [[row], ...] }.
// - Default row cap is a SILENT 100 — every query needs an explicit LIMIT.
// - 3 concurrent queries per project (shared with the founder's own
//   dashboards), 10s max execution each → run queries sequentially and treat
//   a single timeout as a partial result, not a failed sync.

export type PostHogConnection = {
    host: string;
    project_id: string;
    api_key: string;
};

const WINDOW_DAYS = 30;

export class PostHogError extends Error {
    status: number;
    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

// Founders will paste whatever host they can find — usually the ingestion
// host from their JS snippet (us.i.posthog.com), which serves ingestion only
// and 404s the Query API. Normalize to the private API hosts.
export function normalizeHost(input: string): string {
    let host = input.trim().replace(/\/+$/, "");
    if (!host) return "https://us.posthog.com";
    if (!/^https?:\/\//i.test(host)) host = `https://${host}`;
    return host.replace(
        /^https?:\/\/(us|eu)\.i\.posthog\.com$/i,
        (_, region: string) => `https://${region.toLowerCase()}.posthog.com`
    );
}

// One HogQL query → rows as objects keyed by the SELECT aliases. `name` shows
// up in the founder's PostHog query log, so make it identify us clearly.
async function posthogQuery(
    conn: PostHogConnection,
    name: string,
    hogql: string
): Promise<Record<string, unknown>[]> {
    const res = await fetch(`${conn.host}/api/projects/${conn.project_id}/query/`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${conn.api_key}`,
        },
        body: JSON.stringify({
            query: { kind: "HogQLQuery", query: hogql },
            name: `sitewide: ${name}`,
        }),
    });
    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new PostHogError(res.status, body.slice(0, 300));
    }
    const data = await res.json();
    const columns: string[] = Array.isArray(data.columns) ? data.columns : [];
    const results: unknown[][] = Array.isArray(data.results) ? data.results : [];
    return results.map((row) =>
        Object.fromEntries(columns.map((col, i) => [col, row[i]]))
    );
}

// Validate the exact triple the sync needs: key valid + query:read scope +
// access to this specific project. Distinct messages per failure mode —
// especially 404, which is what a US key pointed at the EU host looks like.
export async function testConnection(
    conn: PostHogConnection
): Promise<{ ok: true } | { ok: false; message: string }> {
    try {
        await posthogQuery(conn, "connection check", "SELECT 1");
        return { ok: true };
    } catch (err) {
        if (err instanceof PostHogError) {
            if (err.status === 401)
                return { ok: false, message: "PostHog rejected the API key — it may be invalid or revoked." };
            if (err.status === 403)
                return {
                    ok: false,
                    message: "The key works but can't run queries — make sure it has the query:read scope and covers this project.",
                };
            if (err.status === 404)
                return {
                    ok: false,
                    message: "Project not found. Double-check the project ID — and the region: a US Cloud key won't find its project on the EU host (and vice versa).",
                };
            return { ok: false, message: `PostHog returned an error (${err.status}).` };
        }
        return { ok: false, message: "Couldn't reach PostHog — check the host URL." };
    }
}

const asNum = (v: unknown): number => (typeof v === "number" && isFinite(v) ? v : 0);
const asStr = (v: unknown): string => (typeof v === "string" ? v : "");

// Pull 30 days of aggregate traffic and distill it into one snapshot payload.
// Queries run SEQUENTIALLY (3-concurrent project cap is shared with the
// founder's own usage) and each is individually best-effort: one timeout
// yields a partial snapshot. Throws only when every query failed — usually a
// dead key, which the caller records on the integration row.
export async function buildSnapshot(
    conn: PostHogConnection,
    siteDomain: string
): Promise<AnalyticsPayload> {
    const since = `timestamp >= now() - INTERVAL ${WINDOW_DAYS} DAY`;
    const ownDomain = siteDomain.replace(/^www\./i, "").toLowerCase();
    let failures = 0;
    let firstError: unknown = null;

    const run = async (name: string, hogql: string): Promise<Record<string, unknown>[]> => {
        try {
            return await posthogQuery(conn, name, hogql);
        } catch (err) {
            failures++;
            firstError = firstError ?? err;
            return [];
        }
    };

    const totals = await run(
        "site totals",
        `SELECT count() AS pageviews, uniq(person_id) AS visitors
         FROM events WHERE event = '$pageview' AND ${since} LIMIT 1`
    );
    const pages = await run(
        "top pages",
        `SELECT properties.$pathname AS path, count() AS pageviews, uniq(person_id) AS visitors
         FROM events WHERE event = '$pageview' AND ${since}
         GROUP BY path ORDER BY pageviews DESC LIMIT 25`
    );
    const devices = await run(
        "device split",
        `SELECT properties.$device_type AS device, count() AS pageviews
         FROM events WHERE event = '$pageview' AND ${since}
         GROUP BY device ORDER BY pageviews DESC LIMIT 10`
    );
    const sources = await run(
        "traffic sources",
        `SELECT properties.$referring_domain AS domain, properties.$utm_source AS source, uniq(person_id) AS visitors
         FROM events WHERE event = '$pageview' AND ${since}
         GROUP BY domain, source ORDER BY visitors DESC LIMIT 100`
    );
    const events = await run(
        "top custom events",
        `SELECT event, count() AS event_count
         FROM events WHERE ${since} AND event NOT LIKE '$%'
         GROUP BY event ORDER BY event_count DESC LIMIT 10`
    );

    if (failures === 5) throw firstError;

    // Device counts → fractions of pageviews.
    const deviceTotal = devices.reduce((sum, r) => sum + asNum(r.pageviews), 0);
    const deviceSplit: Record<string, number> = {};
    for (const r of devices) {
        const label = asStr(r.device) || "Unknown";
        if (deviceTotal > 0) deviceSplit[label] = Math.round((asNum(r.pageviews) / deviceTotal) * 100) / 100;
    }

    // Referrers and UTM sources come from one grouped query; fold each
    // dimension separately. Internal navigation shows the founder's own domain
    // as the referrer — drop it (www-insensitively).
    const referrerVisitors = new Map<string, number>();
    const utmVisitors = new Map<string, number>();
    for (const r of sources) {
        const visitors = asNum(r.visitors);
        const domain = asStr(r.domain);
        const source = asStr(r.source);
        if (domain && domain.replace(/^www\./i, "").toLowerCase() !== ownDomain) {
            referrerVisitors.set(domain, (referrerVisitors.get(domain) ?? 0) + visitors);
        }
        if (source) {
            utmVisitors.set(source, (utmVisitors.get(source) ?? 0) + visitors);
        }
    }
    const topN = (m: Map<string, number>, n: number) =>
        [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

    return {
        window_days: WINDOW_DAYS,
        pages: pages
            .filter((r) => asStr(r.path))
            .map((r) => ({ path: asStr(r.path), pageviews: asNum(r.pageviews), visitors: asNum(r.visitors) })),
        devices: deviceSplit,
        referrers: topN(referrerVisitors, 10).map(([domain, visitors]) => ({ domain, visitors })),
        utm_sources: topN(utmVisitors, 10).map(([source, visitors]) => ({ source, visitors })),
        top_events: events
            .filter((r) => asStr(r.event))
            .map((r) => ({ event: asStr(r.event), count: asNum(r.event_count) })),
        total_pageviews: asNum(totals[0]?.pageviews),
        total_visitors: asNum(totals[0]?.visitors),
    };
}
