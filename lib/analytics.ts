// Relative import (not @/) so scripts/test-posthog.ts can run this file under
// plain `node`, same as scripts/test-bayes-stats.ts does with lib/stats.
import type { AnalyticsPayload } from "./types.ts";

// ─── Analytics snapshot helpers (pure, client-safe) ─────────────────────────
//
// Pure helpers over the daily PostHog snapshot (analytics_snapshots.payload).
// Shared by every consumer — the proposal agent (lib/propose.ts), the builder
// (BuilderSidebar), and mirrored inline in the analyze-page edge function —
// so they can never disagree about a page's audience. No secrets, no DB: the
// snapshot fetch lives in lib/experiments.ts (client) and the server-only
// PostHog machinery in lib/posthog.ts.

// "/pricing/", "https://acme.com/pricing?x=1#y" → "/pricing". PostHog's
// $pathname is already path-only; this makes our page_url comparable to it.
export function normalizePath(urlOrPath: string): string {
    let path = urlOrPath.trim();
    try {
        if (/^https?:\/\//i.test(path)) path = new URL(path).pathname;
    } catch {
        // fall through with the raw string
    }
    path = path.split("?")[0].split("#")[0];
    if (!path.startsWith("/")) path = `/${path}`;
    if (path.length > 1) path = path.replace(/\/+$/, "");
    return path;
}

// The compact per-page context every consumer shares: the analysis prompt,
// the proposal agent, and the builder's estimator all describe a page's
// audience with this exact shape, so they can never disagree.
export type PageAnalyticsContext = {
    window_days: number;
    page_path: string;
    page_pageviews: number;
    page_visitors: number;
    // this page's share of the site's total pageviews, 0..1
    share_of_traffic: number | null;
    devices: Record<string, number>;
    top_referrers: { domain: string; visitors: number }[];
    top_utm_sources: { source: string; visitors: number }[];
    site_total_visitors: number;
};

// Snapshot + a page URL/path → that page's audience context, or null when the
// snapshot has no traffic for the page (consumers then behave exactly as if
// no analytics were connected).
export function summarizeForPath(
    payload: AnalyticsPayload,
    urlOrPath: string
): PageAnalyticsContext | null {
    const path = normalizePath(urlOrPath);
    const page = payload.pages?.find((p) => normalizePath(p.path) === path);
    if (!page || page.pageviews === 0) return null;
    return {
        window_days: payload.window_days,
        page_path: path,
        page_pageviews: page.pageviews,
        page_visitors: page.visitors,
        share_of_traffic:
            payload.total_pageviews > 0
                ? Math.round((page.pageviews / payload.total_pageviews) * 100) / 100
                : null,
        devices: payload.devices ?? {},
        top_referrers: (payload.referrers ?? []).slice(0, 5),
        top_utm_sources: (payload.utm_sources ?? []).slice(0, 5),
        site_total_visitors: payload.total_visitors,
    };
}
