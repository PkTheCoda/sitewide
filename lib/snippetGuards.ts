// Guards shared by the public snippet endpoints (/api/snippet/js, /config,
// /event). These routes are reachable by anyone on the internet by design —
// the snippet runs on founders' sites — so every one of them has to answer
// "is this request plausibly coming from the site it claims to be for?"
// without any secret (there is nowhere to hide one in a public script).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isUuid(value: unknown): value is string {
    return typeof value === "string" && UUID_RE.test(value);
}

// Hostname of the page that made the request, from the headers browsers
// attach on their own and scripts can't forge from a page:
//   - Origin: sent on every cross-origin POST (sendBeacon / fetch)
//   - Referer: sent on <script src> fetches under the default referrer policy
//     (strict-origin-when-cross-origin still carries the origin)
// Null when neither is present — a site with `Referrer-Policy: no-referrer`
// sends nothing, and we must not break those installs.
export function requesterHost(request: Request): string | null {
    for (const header of ["origin", "referer"]) {
        const value = request.headers.get(header);
        if (!value) continue;
        try {
            return new URL(value).hostname.toLowerCase();
        } catch {
            /* malformed header — try the next one */
        }
    }
    return null;
}

// Does the requesting host belong to the site's registered domain? The
// dashboard registers whatever hostname the founder typed (talem.org or
// www.talem.org), and visitors reach the site through either, so the two
// are treated as the same site. Subdomains are NOT — app.talem.org is a
// different property. Local dev hosts are allowed so a founder can see
// experiments on localhost before deploying; the heartbeat separately
// ignores them (see isLocalHost).
export function hostMatchesDomain(host: string | null, domain: string): boolean {
    if (!host) return true; // no signal (no-referrer policy) — can't judge, allow
    if (isLocalHost(host)) return true;
    const strip = (h: string) => h.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    return strip(host) === strip(domain);
}

export function isLocalHost(host: string | null): boolean {
    if (!host) return false;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost");
}

// Fixed-window rate limiter, per serverless instance. Vercel runs several
// instances, so the effective ceiling is (limit × instances) — this is a
// speed bump against script kiddies flooding one experiment's numbers, not a
// distributed quota. Good enough for pilot scale; a real launch wants an
// edge KV (Upstash) behind the same function signature.
const buckets = new Map<string, { count: number; resetAt: number }>();
let lastSweep = 0;
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    if (now - lastSweep > windowMs) {
        lastSweep = now;
        for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    }
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        return true;
    }
    bucket.count++;
    return bucket.count <= limit;
}

export function clientIp(request: Request): string {
    const fwd = request.headers.get("x-forwarded-for");
    if (fwd) return fwd.split(",")[0].trim();
    return request.headers.get("x-real-ip") ?? "unknown";
}
