// Verification for lib/stats.ts — the Bayesian sequential decision rule.
// Run: node scripts/test-bayes-stats.ts   (Node 23.6+ strips types natively)
//
// Three layers:
//   1. Math: probBetaGreater + compareVariants' chanceToBeat/risks against
//      brute-force Monte Carlo sampling of the same posteriors.
//   2. Behavior: obvious-winner / obvious-loser / no-data sanity checks.
//   3. The honesty test: simulate the agent's daily-check loop on A/A
//      experiments (false-call rate) and on a real +50% lift (power + speed).

import { compareVariants, probBetaGreater, DECISION_FLOOR } from "../lib/stats.ts";
import type { VariantStats } from "../lib/stats.ts";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
    if (!ok) failures++;
}

// ── Seeded RNG + samplers ─────────────────────────────────────────────────────

function mulberry32(seed: number) {
    return function () {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const rand = mulberry32(20260729);

function randNormal(): number {
    let u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Marsaglia–Tsang gamma sampler (shape >= 1 via boost for shape < 1).
function randGamma(shape: number): number {
    if (shape < 1) return randGamma(shape + 1) * Math.pow(rand(), 1 / shape);
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (;;) {
        let x: number, v: number;
        do {
            x = randNormal();
            v = 1 + c * x;
        } while (v <= 0);
        v = v * v * v;
        const u = rand();
        if (u < 1 - 0.0331 * x * x * x * x) return d * v;
        if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
}

function randBeta(a: number, b: number): number {
    const x = randGamma(a);
    return x / (x + randGamma(b));
}

// ── 1. Math vs Monte Carlo ────────────────────────────────────────────────────

const MC_N = 300_000;

function mcCompare(control: { c: number; n: number }, variant: { c: number; n: number }) {
    const aC = control.c + 1, bC = control.n - control.c + 1;
    const aV = variant.c + 1, bV = variant.n - variant.c + 1;
    const meanC = aC / (aC + bC);
    let beats = 0, lossChoose = 0, lossKeep = 0;
    for (let i = 0; i < MC_N; i++) {
        const pC = randBeta(aC, bC);
        const pV = randBeta(aV, bV);
        if (pV > pC) beats++;
        lossChoose += Math.max(pC - pV, 0);
        lossKeep += Math.max(pV - pC, 0);
    }
    return {
        chanceToBeat: beats / MC_N,
        riskOfChoosing: lossChoose / MC_N / meanC,
        riskOfKeeping: lossKeep / MC_N / meanC,
    };
}

function statsOf(id: string, c: number, n: number): VariantStats {
    return { variantId: id, exposures: n, conversions: c, rate: n > 0 ? c / n : 0 };
}

const mathCases: { name: string; control: { c: number; n: number }; variant: { c: number; n: number } }[] = [
    { name: "small early lead (8 vs 3 of 150)", control: { c: 3, n: 150 }, variant: { c: 8, n: 150 } },
    { name: "moderate sample (25 vs 18 of 400)", control: { c: 18, n: 400 }, variant: { c: 25, n: 400 } },
    { name: "high-baseline click goal (140 vs 110 of 500)", control: { c: 110, n: 500 }, variant: { c: 140, n: 500 } },
    { name: "near-tie large (251 vs 249 of 5000)", control: { c: 249, n: 5000 }, variant: { c: 251, n: 5000 } },
    { name: "zero-conversion arm (0 vs 5 of 300)", control: { c: 0, n: 300 }, variant: { c: 5, n: 300 } },
];

for (const tc of mathCases) {
    const exact = compareVariants(statsOf("c", tc.control.c, tc.control.n), [
        statsOf("v", tc.variant.c, tc.variant.n),
    ])[0];
    const mc = mcCompare(tc.control, tc.variant);
    const dProb = Math.abs(exact.chanceToBeat - mc.chanceToBeat);
    // MC SE at 300k samples is ~0.001 on probabilities; risks are ratios of
    // small numbers so allow 10% relative + a small absolute cushion.
    const riskOk = (got: number, want: number) =>
        Math.abs(got - want) <= Math.max(0.0005, 0.1 * want);
    check(
        `chanceToBeat matches MC — ${tc.name}`,
        dProb < 0.005,
        `exact=${exact.chanceToBeat.toFixed(4)} mc=${mc.chanceToBeat.toFixed(4)}`
    );
    check(
        `riskOfChoosing matches MC — ${tc.name}`,
        riskOk(exact.riskOfChoosing, mc.riskOfChoosing),
        `exact=${exact.riskOfChoosing.toFixed(5)} mc=${mc.riskOfChoosing.toFixed(5)}`
    );
    check(
        `riskOfKeeping matches MC — ${tc.name}`,
        riskOk(exact.riskOfKeeping, mc.riskOfKeeping),
        `exact=${exact.riskOfKeeping.toFixed(5)} mc=${mc.riskOfKeeping.toFixed(5)}`
    );
}

// The normal-approximation branch (alphas past the exact cutoff) must agree
// with MC too.
{
    const control = { c: 4000, n: 80000 };
    const variant = { c: 4300, n: 80000 };
    const exact = compareVariants(statsOf("c", control.c, control.n), [
        statsOf("v", variant.c, variant.n),
    ])[0];
    const mc = mcCompare(control, variant);
    check(
        "normal-approx branch matches MC (4300 vs 4000 of 80k)",
        Math.abs(exact.chanceToBeat - mc.chanceToBeat) < 0.005,
        `approx=${exact.chanceToBeat.toFixed(4)} mc=${mc.chanceToBeat.toFixed(4)}`
    );
}

// Identity + symmetry sanity on the raw inequality function.
check("P(Beta(1,1) > Beta(1,1)) = 0.5", Math.abs(probBetaGreater(1, 1, 1, 1) - 0.5) < 1e-9);
check(
    "P(Beta(2,1) > Beta(1,1)) = 2/3 (hand-computed)",
    Math.abs(probBetaGreater(2, 1, 1, 1) - 2 / 3) < 1e-9
);
check(
    "complement symmetry",
    Math.abs(probBetaGreater(10, 90, 14, 86) + probBetaGreater(14, 86, 10, 90) - 1) < 1e-9
);

// ── 2. Decision-rule sanity ───────────────────────────────────────────────────

{
    const clear = compareVariants(statsOf("c", 20, 400), [statsOf("v", 45, 400)])[0];
    check("obvious winner is decisive", clear.verdict === "variant", `chance=${clear.chanceToBeat.toFixed(3)} risk=${clear.riskOfChoosing.toFixed(4)}`);

    const loser = compareVariants(statsOf("c", 45, 400), [statsOf("v", 20, 400)])[0];
    check("obvious loser → control", loser.verdict === "control", `chance=${loser.chanceToBeat.toFixed(3)}`);

    const tie = compareVariants(statsOf("c", 20, 400), [statsOf("v", 21, 400)])[0];
    check("near-tie stays undecided", tie.verdict === null, `chance=${tie.chanceToBeat.toFixed(3)}`);

    const empty = compareVariants(statsOf("c", 0, 0), [statsOf("v", 0, 0)])[0];
    check("no data → undecided at 50/50", empty.verdict === null && Math.abs(empty.chanceToBeat - 0.5) < 1e-9);
}

// ── 3. The agent's daily loop, simulated ─────────────────────────────────────
//
// Mimics exactly what /api/agent/evaluate does now: every "day" add visitors,
// then call compareVariants; act on the first non-null verdict once every arm
// has DECISION_FLOOR exposures. Reports the numbers that define the product's
// honesty: how often an A/A test gets called (false calls), and how fast a
// real +50% lift resolves.

function simulateDailyLoop(params: {
    sims: number;
    days: number;
    dailyPerArm: number;
    pControl: number;
    pVariant: number;
}) {
    const { sims, days, dailyPerArm, pControl, pVariant } = params;
    let calledVariant = 0, calledControl = 0;
    const decisionDays: number[] = [];
    for (let s = 0; s < sims; s++) {
        let nC = 0, cC = 0, nV = 0, cV = 0;
        for (let d = 1; d <= days; d++) {
            for (let i = 0; i < dailyPerArm; i++) {
                nC++; if (rand() < pControl) cC++;
                nV++; if (rand() < pVariant) cV++;
            }
            if (Math.min(nC, nV) < DECISION_FLOOR) continue;
            const cmp = compareVariants(statsOf("c", cC, nC), [statsOf("v", cV, nV)])[0];
            if (cmp.verdict === "variant") { calledVariant++; decisionDays.push(d); break; }
            if (cmp.verdict === "control") { calledControl++; decisionDays.push(d); break; }
        }
    }
    decisionDays.sort((a, b) => a - b);
    const median = decisionDays.length ? decisionDays[Math.floor(decisionDays.length / 2)] : null;
    return { calledVariant, calledControl, median, decided: decisionDays.length };
}

console.log("\n— A/A test (no real difference, 5% baseline, 150 visitors/arm/day, 40 daily checks) —");
{
    const sims = 400;
    const r = simulateDailyLoop({ sims, days: 40, dailyPerArm: 150, pControl: 0.05, pVariant: 0.05 });
    const falseRate = (r.calledVariant + r.calledControl) / sims;
    console.log(
        `false calls: ${r.calledVariant + r.calledControl}/${sims} (${(falseRate * 100).toFixed(1)}%) — ` +
        `${r.calledVariant} "variant" (false promotion), ${r.calledControl} "control" (futility end)`
    );
    // The rule caps the COST of a wrong call (≤ DECISION_MAX_RISK of the
    // conversion rate), not the raw count — that's the Bayesian trade. What we
    // hold it to: false PROMOTIONS stay rare across 40 peeks, and total calls
    // on a genuine tie stay a minority ("kept the original" on a no-effect
    // test is a harmless futility stop, not a lie).
    check("A/A: false promotions under 8% across 40 daily peeks", r.calledVariant / sims < 0.08);
    check("A/A: total false-call rate under 20%", falseRate < 0.2);
}

console.log("\n— Real +50% lift (5% → 7.5%, 150 visitors/arm/day, up to 60 daily checks) —");
{
    const sims = 400;
    const r = simulateDailyLoop({ sims, days: 60, dailyPerArm: 150, pControl: 0.05, pVariant: 0.075 });
    console.log(
        `decided: ${r.decided}/${sims} (${((r.decided / sims) * 100).toFixed(1)}%), ` +
        `median day ${r.median}, wrong-direction calls: ${r.calledControl}`
    );
    check("+50% lift: >90% of tests conclude within 60 days", r.decided / sims > 0.9);
    check("+50% lift: median decision inside 3 weeks", r.median !== null && r.median <= 21);
    check("+50% lift: wrong-direction calls are rare (<2%)", r.calledControl / sims < 0.02);
}

console.log("\n— Moderate +25% lift (5% → 6.25%), same traffic, up to 60 daily checks —");
{
    const sims = 400;
    const r = simulateDailyLoop({ sims, days: 60, dailyPerArm: 150, pControl: 0.05, pVariant: 0.0625 });
    console.log(
        `decided: ${r.decided}/${sims} (${((r.decided / sims) * 100).toFixed(1)}%), ` +
        `median day ${r.median}, wrong-direction calls: ${r.calledControl}` +
        ` — old fixed-horizon rule sat until day 36 (5,330/arm) no matter what`
    );
    check("+25% lift: >70% of tests conclude within 60 days", r.decided / sims > 0.7);
    check("+25% lift: wrong-direction calls rare (<2%)", r.calledControl / sims < 0.02);
}

console.log("\n— Modest +15% lift (5% → 5.75%), same traffic, 60 daily checks —");
{
    const sims = 200;
    const r = simulateDailyLoop({ sims, days: 60, dailyPerArm: 150, pControl: 0.05, pVariant: 0.0575 });
    console.log(
        `decided: ${r.decided}/${sims}, median day ${r.median}, ` +
        `variant ${r.calledVariant} / control ${r.calledControl} — small lifts SHOULD mostly stay undecided here`
    );
    check("+15% lift: wrong-direction (control) calls rare (<5%)", r.calledControl / sims < 0.05);
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} CHECK(S) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
