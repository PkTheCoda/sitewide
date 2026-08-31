// Pure checks for the public-endpoint guards (lib/snippetGuards.ts).
// Run: node scripts/test-snippet-guards.ts   (no server, no DB)
import {
    clientIp,
    hostMatchesDomain,
    isLocalHost,
    isUuid,
    rateLimit,
    requesterHost,
} from "../lib/snippetGuards.ts";

let pass = 0,
    fail = 0;
const check = (name: string, cond: boolean, extra = "") =>
    cond ? (pass++, console.log(`  PASS ${name}`)) : (fail++, console.log(`  FAIL ${name} ${extra}`));

// ── isUuid ──────────────────────────────────────────────────────────────────
check("uuid v4 accepted", isUuid("3f2a9c1e-8b4d-4c2a-9e1f-0a1b2c3d4e5f"));
check("uppercase uuid accepted", isUuid("3F2A9C1E-8B4D-4C2A-9E1F-0A1B2C3D4E5F"));
check("junk rejected", !isUuid("site-1"));
check("sql-ish rejected", !isUuid("' or 1=1 --"));
check("non-string rejected", !isUuid(123));
check("undefined rejected", !isUuid(undefined));

// ── hostMatchesDomain ───────────────────────────────────────────────────────
check("exact match", hostMatchesDomain("talem.org", "talem.org"));
check("www vs apex (host has www)", hostMatchesDomain("www.talem.org", "talem.org"));
check("www vs apex (domain has www)", hostMatchesDomain("talem.org", "www.talem.org"));
check("case-insensitive", hostMatchesDomain("Talem.ORG", "talem.org"));
check("trailing dot tolerated", hostMatchesDomain("talem.org.", "talem.org"));
check("subdomain is a different site", !hostMatchesDomain("app.talem.org", "talem.org"));
check("vercel preview rejected", !hostMatchesDomain("sitewide-git-feat-x.vercel.app", "talem.org"));
check("lookalike rejected", !hostMatchesDomain("talem.org.evil.com", "talem.org"));
check("no signal (null host) allowed", hostMatchesDomain(null, "talem.org"));
check("localhost allowed", hostMatchesDomain("localhost", "talem.org"));
check("127.0.0.1 allowed", hostMatchesDomain("127.0.0.1", "talem.org"));

// ── isLocalHost ─────────────────────────────────────────────────────────────
check("localhost is local", isLocalHost("localhost"));
check("foo.localhost is local", isLocalHost("foo.localhost"));
check("talem.org is not local", !isLocalHost("talem.org"));
check("null is not local", !isLocalHost(null));

// ── requesterHost ───────────────────────────────────────────────────────────
const req = (headers: Record<string, string>) => new Request("https://api.test/x", { headers });
check("origin wins", requesterHost(req({ origin: "https://www.talem.org", referer: "https://other.com/p" })) === "www.talem.org");
check("referer fallback", requesterHost(req({ referer: "https://talem.org/pricing?x=1" })) === "talem.org");
check("origin-only referer (strict-origin policy)", requesterHost(req({ referer: "https://talem.org/" })) === "talem.org");
check("no headers → null", requesterHost(req({})) === null);
check("malformed origin → referer", requesterHost(req({ origin: "null", referer: "https://talem.org/" })) === "talem.org");
check("malformed both → null", requesterHost(req({ origin: "null", referer: "garbage" })) === null);

// ── rateLimit ───────────────────────────────────────────────────────────────
{
    const key = "t:" + Math.random();
    let allowed = 0;
    for (let i = 0; i < 70; i++) if (rateLimit(key, 60, 60_000)) allowed++;
    check("60 allowed, 10 refused in one window", allowed === 60, String(allowed));
    check("different key unaffected", rateLimit("other:" + Math.random(), 60, 60_000));
}
{
    const key = "w:" + Math.random();
    for (let i = 0; i < 3; i++) rateLimit(key, 3, 30);
    check("4th refused", !rateLimit(key, 3, 30));
    await new Promise((r) => setTimeout(r, 40));
    check("window reset allows again", rateLimit(key, 3, 30));
}

// ── clientIp ────────────────────────────────────────────────────────────────
check("x-forwarded-for first hop", clientIp(req({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" })) === "1.2.3.4");
check("x-real-ip fallback", clientIp(req({ "x-real-ip": "5.6.7.8" })) === "5.6.7.8");
check("unknown when absent", clientIp(req({})) === "unknown");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
