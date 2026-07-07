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
