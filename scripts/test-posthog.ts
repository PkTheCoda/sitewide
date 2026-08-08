// Verification for the PostHog integration (lib/posthog.ts + lib/analytics.ts).
// Run: node scripts/test-posthog.ts   (Node 23.6+ strips types natively)
//
// Two layers:
//   1. Pure (always runs, no network): normalizeHost input mangling,
//      normalizePath equivalences, summarizeForPath lookup + math.
//   2. Live (only when env vars are set): testConnection + buildSnapshot
//      against a REAL PostHog project, printing the snapshot payload — this
//      is where the docs-unverified details (results array shape) get proven.
//      Set: POSTHOG_TEST_HOST (us|eu|full URL), POSTHOG_TEST_PROJECT_ID,
//           POSTHOG_TEST_API_KEY, and optionally POSTHOG_TEST_DOMAIN.

import { normalizeHost, testConnection, buildSnapshot } from "../lib/posthog.ts";
import { normalizePath, summarizeForPath } from "../lib/analytics.ts";
import type { AnalyticsPayload } from "../lib/types.ts";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
    if (!ok) failures++;
}

// ── 1a. normalizeHost ─────────────────────────────────────────────────────────

check("host: ingestion → private (us)", normalizeHost("https://us.i.posthog.com") === "https://us.posthog.com");
check("host: ingestion → private (eu)", normalizeHost("eu.i.posthog.com") === "https://eu.posthog.com");
check("host: bare hostname gets protocol", normalizeHost("us.posthog.com") === "https://us.posthog.com");
check("host: trailing slashes stripped", normalizeHost("https://us.posthog.com///") === "https://us.posthog.com");
check("host: self-hosted untouched", normalizeHost("https://posthog.acme.dev") === "https://posthog.acme.dev");
check("host: empty defaults to US", normalizeHost("  ") === "https://us.posthog.com");

// ── 1b. normalizePath ─────────────────────────────────────────────────────────

check("path: full URL → pathname", normalizePath("https://acme.com/pricing") === "/pricing");
check("path: query stripped", normalizePath("/pricing?utm_source=x") === "/pricing");
check("path: hash stripped", normalizePath("/pricing#faq") === "/pricing");
check("path: trailing slash stripped", normalizePath("/pricing/") === "/pricing");
check("path: root stays root", normalizePath("https://acme.com/") === "/");
check("path: bare root stays root", normalizePath("/") === "/");
check("path: missing leading slash added", normalizePath("pricing") === "/pricing");

// ── 1c. summarizeForPath ──────────────────────────────────────────────────────

const payload: AnalyticsPayload = {
    window_days: 30,
    pages: [
        { path: "/", pageviews: 8000, visitors: 5000 },
        { path: "/pricing/", pageviews: 2000, visitors: 1500 },
    ],
    devices: { Desktop: 0.61, Mobile: 0.37, Tablet: 0.02 },
    referrers: [{ domain: "google.com", visitors: 2100 }],
    utm_sources: [{ source: "producthunt", visitors: 340 }],
    top_events: [{ event: "signup", count: 412 }],
    total_pageviews: 10000,
    total_visitors: 6000,
};

const home = summarizeForPath(payload, "https://acme.com/");
check("summarize: finds the homepage", home !== null && home.page_visitors === 5000);
check("summarize: share of traffic", home !== null && home.share_of_traffic === 0.8);

// snapshot stores "/pricing/" (trailing slash), we ask with query params —
// both sides normalize, so they must meet in the middle
const pricing = summarizeForPath(payload, "https://acme.com/pricing?ref=nav");
check("summarize: path normalization on both sides", pricing !== null && pricing.page_pageviews === 2000);

check("summarize: unknown path → null", summarizeForPath(payload, "/never-visited") === null);
check(
    "summarize: devices pass through",
    home !== null && home.devices.Desktop === 0.61 && home.devices.Mobile === 0.37
);

// ── 2. Live queries (optional) ────────────────────────────────────────────────

const liveHostRaw = process.env.POSTHOG_TEST_HOST;
const liveProject = process.env.POSTHOG_TEST_PROJECT_ID;
const liveKey = process.env.POSTHOG_TEST_API_KEY;

async function live() {
    if (!liveHostRaw || !liveProject || !liveKey) {
        console.log("\n(skipping live PostHog checks — set POSTHOG_TEST_HOST / _PROJECT_ID / _API_KEY to run them)");
        return;
    }
    const conn = {
        host: normalizeHost(liveHostRaw === "us" ? "us.posthog.com" : liveHostRaw === "eu" ? "eu.posthog.com" : liveHostRaw),
        project_id: liveProject,
        api_key: liveKey,
    };

    const result = await testConnection(conn);
    check("live: connection valid", result.ok, result.ok ? "" : (result as { message: string }).message);
    if (!result.ok) return;

    const snapshot = await buildSnapshot(conn, process.env.POSTHOG_TEST_DOMAIN ?? "example.com");
    check("live: snapshot has totals", snapshot.total_pageviews >= 0 && snapshot.total_visitors >= 0);
    check("live: pages array well-formed", snapshot.pages.every((p) => typeof p.path === "string" && p.pageviews >= 0));
    check(
        "live: device fractions sum ≈ 1 (or empty)",
        Object.keys(snapshot.devices).length === 0 ||
            Math.abs(Object.values(snapshot.devices).reduce((a, b) => a + b, 0) - 1) < 0.05
    );
    console.log("\nSnapshot payload:\n" + JSON.stringify(snapshot, null, 2));
}

await live();

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
