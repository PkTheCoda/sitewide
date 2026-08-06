// Statistics for experiment evaluation.
//
// The agent only ever calls `compareVariants` — everything else is plumbing.
// Inference is Bayesian (Beta–Binomial) on UNIQUE visitors (the DB's unique
// index guarantees one exposure + one conversion row max per visitor, so
// counting rows is counting visitors).
//
// Why Bayesian, and why it replaced the two-proportion z-test: the agent looks
// at every experiment once a day. A fixed-horizon z-test is only honest
// against a sample size committed to up front, which forced the founder to
// guess an "expected lift" in the builder and made every test wait for
// thousands of visitors no matter how decisive the data already was. This
// rule is built for repeated looks instead — the agent acts only when BOTH:
//   (a) the variant is ≥95% likely to beat control (DECISION_PROB), and
//   (b) the expected cost of acting when it's actually the wrong call is
//       under 0.05% of control's conversion rate (DECISION_MAX_RISK).
// The risk cap is what makes daily peeking safe: on early, noisy data the
// expected-loss bar effectively demands ~99.7% confidence, relaxing toward
// the plain 95% only once the posterior is tight (verified by the A/A
// simulation in scripts/test-bayes-stats.ts).
// Big lifts satisfy both on a few hundred visitors; small or imaginary lifts
// keep the risk high and the agent waiting. The same pair (mirrored) ends a
// test whose variants are confidently worse. A modest exposure floor
// (DECISION_FLOOR, enforced by the evaluator) keeps day-one flukes out.

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
    lift: number; // relative, e.g. 0.31 = +31% (observed)
    chanceToBeat: number; // P(variant's true rate > control's | data), 0..1
    riskOfChoosing: number; // expected conversion loss if we SHIP the variant
    //                         and control was actually better — relative to
    //                         control's rate (0.01 = we'd expect to give up 1%
    //                         of conversions)
    riskOfKeeping: number; // same, for KEEPING control when the variant was
    //                        actually better
    verdict: "variant" | "control" | null; // decision-ready call; null = wait
};

// The decision bar, shared by the agent and every UI readout so they can
// never disagree.
export const DECISION_PROB = 0.95;
export const DECISION_MAX_RISK = 0.0005;

// Exposures every arm must reach before the agent starts judging. This is a
// guardrail against tiny-n flukes, NOT a statistical commitment — the Bayesian
// rule stays valid at any n, so unlike the old power-analysis sample size this
// never needs founder input. Saved as the experiment's min_sample_size.
export const DECISION_FLOOR = 500;

// ─── Beta-distribution machinery ─────────────────────────────────────────────

// Lanczos ln Γ(z) (g=7, n=9) — |error| < 1e-13 over our domain.
const LANCZOS = [
    676.5203681218851, -1259.1392167224028, 771.3234287776531, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];
function lnGamma(z: number): number {
    if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
    z -= 1;
    let x = 0.99999999999980993;
    for (let i = 0; i < LANCZOS.length; i++) x += LANCZOS[i] / (z + i + 1);
    const t = z + 7.5;
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function lnBeta(a: number, b: number): number {
    return lnGamma(a) + lnGamma(b) - lnGamma(a + b);
}

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

// Above this many exact-sum terms, switch to the normal approximation of the
// posteriors — at that many conversions the approximation error is far below
// the decision thresholds, and the sum is just wasted work.
const EXACT_TERM_CUTOFF = 3000;

// P(X1 > X2) where Xi ~ Beta(ai, bi). Exact closed-form sum (John Cook's
// stochastic-inequality identity) when the shorter alpha is an integer of
// tractable size — which ours always are: alphas are conversion counts + 1.
// Exported for the Monte Carlo verification script, not for app code.
export function probBetaGreater(a1: number, b1: number, a2: number, b2: number): number {
    // Sum length is a1 — if the other side is shorter, compute the complement.
    if (a2 < a1) return 1 - probBetaGreater(a2, b2, a1, b1);

    if (a1 > EXACT_TERM_CUTOFF || !Number.isInteger(a1)) {
        const mean = (a: number, b: number) => a / (a + b);
        const variance = (a: number, b: number) => (a * b) / ((a + b) ** 2 * (a + b + 1));
        const d = mean(a1, b1) - mean(a2, b2);
        const sd = Math.sqrt(variance(a1, b1) + variance(a2, b2));
        return sd === 0 ? 0.5 : normalCdf(d / sd);
    }

    const lnBetaA2B2 = lnBeta(a2, b2);
    let total = 0;
    for (let i = 0; i < a1; i++) {
        total += Math.exp(
            lnBeta(a2 + i, b1 + b2) - Math.log(b1 + i) - lnBeta(1 + i, b1) - lnBetaA2B2
        );
    }
    return Math.min(1, Math.max(0, total));
}

// E[max(X2 − X1, 0)] where Xi ~ Beta(ai, bi): the expected shortfall of
// picking arm 1 when arm 2 was actually better (in absolute rate). Closed
// form via the "tilted" posteriors (Stucchio's Bayesian A/B loss).
function expectedLoss(a1: number, b1: number, a2: number, b2: number): number {
    const mean1 = a1 / (a1 + b1);
    const mean2 = a2 / (a2 + b2);
    const loss =
        mean2 * probBetaGreater(a2 + 1, b2, a1, b1) -
        mean1 * (1 - probBetaGreater(a1 + 1, b1, a2, b2));
    return Math.max(0, loss); // clamp float noise
}

// ─── The comparison the agent acts on ────────────────────────────────────────

// Compare every non-control variant against control. Posteriors use a flat
// Beta(1,1) prior, so alpha = conversions + 1 and beta = failures + 1.
export function compareVariants(
    control: VariantStats,
    variants: VariantStats[]
): Comparison[] {
    const aC = control.conversions + 1;
    const bC = control.exposures - control.conversions + 1;
    const meanC = aC / (aC + bC);

    return variants.map((v) => {
        const aV = v.conversions + 1;
        const bV = v.exposures - v.conversions + 1;

        const chanceToBeat = probBetaGreater(aV, bV, aC, bC);
        // Risks are stated relative to control's rate so "0.01" means the same
        // thing on a 2% funnel and a 20% one.
        const riskOfChoosing = expectedLoss(aV, bV, aC, bC) / meanC;
        const riskOfKeeping = expectedLoss(aC, bC, aV, bV) / meanC;

        const verdict: Comparison["verdict"] =
            chanceToBeat >= DECISION_PROB && riskOfChoosing <= DECISION_MAX_RISK
                ? "variant"
                : chanceToBeat <= 1 - DECISION_PROB && riskOfKeeping <= DECISION_MAX_RISK
                  ? "control"
                  : null;

        return {
            variantId: v.variantId,
            controlRate: control.rate,
            variantRate: v.rate,
            lift: control.rate > 0 ? (v.rate - control.rate) / control.rate : 0,
            chanceToBeat,
            riskOfChoosing,
            riskOfKeeping,
            verdict,
        };
    });
}

// ─── Time-to-decision estimation (informational ONLY) ────────────────────────
//
// With the sequential rule there is no pre-committed sample size any more —
// these helpers exist purely to show a founder a realistic ETA ("a big lift
// resolves in ~X days, a moderate one in ~Y") in the builder and on the
// experiment page. Nothing gates on their output. They use the classical
// 95%/80% power formula because it remains a decent central estimate of when
// a real lift of a given size crosses the decision bar.
const Z_ALPHA = 1.959964; // two-tailed 95%
const Z_BETA = 0.841621; //  80% power

// Visitors per variant at which a relative lift `mde` on baseline rate
// `baseline` typically becomes decisive (both as fractions). Returns null for
// nonsensical inputs (rate outside (0,1), non-positive lift).
export function requiredSampleSizePerVariant(baseline: number, mde: number): number | null {
    if (!(baseline > 0 && baseline < 1) || !(mde > 0)) return null;
    const p1 = baseline;
    const p2 = Math.min(p1 * (1 + mde), 0.999999);
    const delta = p2 - p1;
    if (delta <= 0) return null;
    const n = ((Z_ALPHA + Z_BETA) ** 2 * (p1 * (1 - p1) + p2 * (1 - p2))) / (delta * delta);
    return Math.ceil(n);
}

export type DecisionEstimate = {
    perVariant: number; // visitors each arm typically needs
    totalVisitors: number; // across all arms (control + variants)
    days: number; // calendar days to get there at the given daily traffic
};

// Turn traffic + baseline + a hypothetical lift into a time estimate.
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
