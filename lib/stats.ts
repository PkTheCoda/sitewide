// Statistics for experiment evaluation.
//
// The agent only ever calls `compareVariants` — everything else is plumbing.
// We use a two-proportion z-test on UNIQUE visitors (the DB's unique index
// guarantees one exposure + one conversion row max per visitor, so counting
// rows is counting visitors).
//
// IMPORTANT: this is only statistically honest when evaluated at a fixed
// cadence against a pre-committed minimum sample size (the peeking problem).
// The agent enforces min_sample_size before testing; never call this in a
// hot loop and stop at the first p < 0.05.

export type VariantStats = {
    variantId: string;
    exposures: number;
    conversions: number;
    rate: number;
};

export type Comparison = {
    variantId: string;
    controlRate: number;
    variantRate: number;
    lift: number; // relative, e.g. 0.31 = +31%
    zScore: number;
    pValue: number; // two-tailed
    significant: boolean; // p < 0.05
};

// Standard normal CDF via the Abramowitz & Stegun erf approximation
// (max error ~1.5e-7 — far below anything that changes a decision).
function normalCdf(z: number): number {
    const sign = z < 0 ? -1 : 1;
    const x = Math.abs(z) / Math.SQRT2;
    const t = 1 / (1 + 0.3275911 * x);
    const y =
        1 -
        (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t +
            0.254829592) *
            t *
            Math.exp(-x * x);
    return 0.5 * (1 + sign * y);
}

// Two-proportion z-test (pooled). Returns null when a variance of zero makes
// the test meaningless (no exposures, or both rates identical at 0 or 1).
export function twoProportionZTest(
    conversionsA: number,
    exposuresA: number,
    conversionsB: number,
    exposuresB: number
): { z: number; p: number } | null {
    if (exposuresA === 0 || exposuresB === 0) return null;

    const pA = conversionsA / exposuresA;
    const pB = conversionsB / exposuresB;
    const pooled = (conversionsA + conversionsB) / (exposuresA + exposuresB);
    const se = Math.sqrt(pooled * (1 - pooled) * (1 / exposuresA + 1 / exposuresB));
    if (se === 0) return null;

    const z = (pB - pA) / se;
    const p = 2 * (1 - normalCdf(Math.abs(z)));
    return { z, p };
}

// ─── Power analysis: how long will this test take? ───────────────────────────
//
// Shown at experiment creation so a founder doesn't start a test that can never
// reach a decision on their traffic. Answers "how many visitors per variant do
// we need to detect this size of change?" and turns that into days.
//
// Fixed at the same statistical bar the agent enforces: 95% confidence
// (two-tailed α = 0.05, matching `significant`) and 80% power — the standard
// A/B-testing floor for "we'd actually catch a real lift this size". These two
// z-values are constants for those settings; we hard-code them rather than
// invert the normal CDF, since the product never varies α or power.
const Z_ALPHA = 1.959964; // two-tailed 95% → P(|Z| < z) = 0.95
const Z_BETA = 0.841621; //  80% power       → P(Z < z)   = 0.80

// Visitors needed PER variant to detect a relative lift `mde` on a baseline
// conversion rate `baseline` (both as fractions: baseline 0.05 = 5%, mde 0.20 =
// +20% relative). Standard two-proportion sample-size formula. Returns null for
// nonsensical inputs (rate outside (0,1), non-positive lift).
export function requiredSampleSizePerVariant(baseline: number, mde: number): number | null {
    if (!(baseline > 0 && baseline < 1) || !(mde > 0)) return null;
    const p1 = baseline;
    const p2 = Math.min(p1 * (1 + mde), 0.999999); // expected variant rate
    const delta = p2 - p1;
    if (delta <= 0) return null;
    const n = ((Z_ALPHA + Z_BETA) ** 2 * (p1 * (1 - p1) + p2 * (1 - p2))) / (delta * delta);
    return Math.ceil(n);
}

export type DecisionEstimate = {
    perVariant: number; // visitors each arm must accumulate
    totalVisitors: number; // across all arms (control + variants)
    days: number; // calendar days to get there at the given daily traffic
};

// Turn traffic + baseline + expected lift into a time-to-decision estimate.
//   dailyVisitors — visitors to the experiment PAGE per day (all get bucketed)
//   groupCount    — total arms, i.e. control + variants (so more variants =
//                   more total sample = a longer wait, which is the honest
//                   signal we want the founder to feel)
// Returns null when the inputs can't yield a real answer.
export function estimateTimeToDecision(params: {
    baseline: number;
    mde: number;
    dailyVisitors: number;
    groupCount: number;
}): DecisionEstimate | null {
    const { baseline, mde, dailyVisitors, groupCount } = params;
    if (!(dailyVisitors > 0) || groupCount < 2) return null;
    const perVariant = requiredSampleSizePerVariant(baseline, mde);
    if (perVariant === null) return null;

    const totalVisitors = perVariant * groupCount;
    // Traffic is split evenly across arms, so every arm fills at
    // dailyVisitors / groupCount per day — they all cross the line together.
    const days = Math.ceil(perVariant / (dailyVisitors / groupCount));
    return { perVariant, totalVisitors, days };
}

// Compare every non-control variant against control.
export function compareVariants(
    control: VariantStats,
    variants: VariantStats[]
): Comparison[] {
    return variants.map((v) => {
        const test = twoProportionZTest(
            control.conversions,
            control.exposures,
            v.conversions,
            v.exposures
        );
        return {
            variantId: v.variantId,
            controlRate: control.rate,
            variantRate: v.rate,
            lift: control.rate > 0 ? (v.rate - control.rate) / control.rate : 0,
            zScore: test?.z ?? 0,
            pValue: test?.p ?? 1,
            significant: (test?.p ?? 1) < 0.05,
        };
    });
}
