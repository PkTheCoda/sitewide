"use client";

import { useEffect, useMemo, useState } from "react";
import { estimateTimeToDecision, requiredSampleSizePerVariant } from "@/lib/stats";
import { Segmented } from "./ui";

// The "will this test ever finish?" reality check, shown as the last builder
// step (BuilderSidebar wraps it in the step card). A founder testing a
// 300-visitors/month page should SEE that it takes years to decide — and reach
// for a higher-traffic page or a bolder change — instead of quietly waiting
// six weeks on data that can't arrive.
//
// The per-variant sample size we compute here is reported up (onSampleSize) and
// saved as the experiment's min_sample_size, so the date shown is the exact
// threshold the agent waits for — not a throwaway estimate.

type Props = {
    groupCount: number; // control + variants (drives total sample + the wait)
    onSampleSize: (perVariant: number | null) => void;
};

// Bigger expected change ⇒ fewer visitors needed ⇒ a faster answer. Framed by
// the kind of edit it usually takes, so the founder can pick honestly.
const IMPACT_PRESETS: { key: string; label: string; hint: string; mde: number }[] = [
    { key: "subtle", label: "Subtle", hint: "a copy tweak", mde: 0.1 },
    { key: "moderate", label: "Moderate", hint: "a clearer offer", mde: 0.25 },
    { key: "bold", label: "Bold", hint: "a redesign", mde: 0.5 },
];

function formatDuration(days: number): string {
    if (days <= 90) return `~${days} day${days === 1 ? "" : "s"}`;
    const months = Math.round(days / 30);
    if (months <= 18) return `~${months} months`;
    const years = days / 365;
    return years >= 2 ? `over ${Math.floor(years)} years` : "over a year";
}

// Deliberately calm: this shows BEFORE the founder has committed anything, so a
// red "2 years" wall just scares people off good products. Any reasonable wait
// reads as neutral, matter-of-fact guidance. We only escalate to a warning tone
// (and the nudge) when the test is genuinely unworkable — the same >60-day line
// the running-experiment countdown uses, so the two never disagree.
function verdict(days: number) {
    if (days > 60)
        return {
            tone: "warn",
            line: "This page's traffic makes for a long test — a bolder change, fewer variants, or a higher-traffic page would get you a result much sooner.",
        };
    if (days <= 21)
        return { tone: "calm", line: "You'll have a clear answer within a few weeks." };
    return {
        tone: "calm",
        line: "A steady run — leave it going and your agent calls it once the data's in.",
    };
}

const TONE: Record<string, { panel: string; big: string; sub: string; line: string }> = {
    calm: {
        panel: "bg-stone-50 border-stone-200",
        big: "text-stone-800",
        sub: "text-stone-400",
        line: "text-stone-500",
    },
    warn: {
        panel: "bg-rose-50 border-rose-200",
        big: "text-rose-700",
        sub: "text-rose-500/80",
        line: "text-rose-700",
    },
};

export default function DecisionEstimator({ groupCount, onSampleSize }: Props) {
    const [monthlyVisitors, setMonthlyVisitors] = useState("");
    const [baselinePct, setBaselinePct] = useState("5");
    const [impact, setImpact] = useState("moderate");

    const mde = IMPACT_PRESETS.find((p) => p.key === impact)!.mde;
    const baseline = parseFloat(baselinePct) / 100;
    const monthly = parseFloat(monthlyVisitors);
    const dailyVisitors = monthly / 30;

    // Sample size depends only on baseline + expected lift (not traffic), so we
    // can persist it even if the founder skips the traffic input.
    const perVariant = useMemo(
        () => requiredSampleSizePerVariant(baseline, mde),
        [baseline, mde]
    );
    useEffect(() => onSampleSize(perVariant), [perVariant, onSampleSize]);

    const estimate =
        monthly > 0
            ? estimateTimeToDecision({ baseline, mde, dailyVisitors, groupCount })
            : null;

    return (
        <div className="flex flex-col gap-2.5">
            <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-stone-500">Monthly visitors</span>
                    <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        value={monthlyVisitors}
                        onChange={(e) => setMonthlyVisitors(e.target.value)}
                        placeholder="e.g. 15,000"
                        className="text-xs text-stone-700 bg-stone-50 border border-stone-200 rounded-lg py-2 px-3 focus:outline-none focus:border-orange-600 placeholder:text-stone-400"
                    />
                </label>
                <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-stone-500">Conversion rate</span>
                    <div className="relative">
                        <input
                            type="number"
                            inputMode="decimal"
                            min={0}
                            max={100}
                            step="0.1"
                            value={baselinePct}
                            onChange={(e) => setBaselinePct(e.target.value)}
                            className="w-full text-xs text-stone-700 bg-stone-50 border border-stone-200 rounded-lg py-2 pl-3 pr-7 focus:outline-none focus:border-orange-600"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-stone-400">
                            %
                        </span>
                    </div>
                </label>
            </div>

            <div className="flex flex-col gap-1">
                <span className="text-[11px] text-stone-500">Expected impact</span>
                <Segmented
                    options={IMPACT_PRESETS.map(({ key, label, hint }) => ({
                        value: key,
                        label,
                        hint,
                    }))}
                    value={impact}
                    onChange={setImpact}
                />
            </div>

            {/* Live readout */}
            {estimate ? (
                (() => {
                    const v = verdict(estimate.days);
                    const t = TONE[v.tone];
                    return (
                        <div
                            className={`mt-0.5 rounded-lg border ${t.panel} p-3 flex flex-col gap-1.5`}
                        >
                            <div className="flex items-baseline justify-between gap-2">
                                <span className={`font-robot text-lg font-semibold tabular-nums ${t.big}`}>
                                    {formatDuration(estimate.days)}
                                </span>
                                <span className={`text-[11px] tabular-nums ${t.sub}`}>
                                    {estimate.perVariant.toLocaleString()} / variant ·{" "}
                                    {groupCount} arms
                                </span>
                            </div>
                            <p className={`text-[11px] leading-relaxed ${t.line}`}>
                                {v.line}
                            </p>
                        </div>
                    );
                })()
            ) : (
                <div className="mt-0.5 rounded-lg border border-dashed border-stone-200 p-3">
                    <p className="text-[11px] text-stone-400 leading-relaxed">
                        {perVariant === null
                            ? "Enter a conversion rate between 0 and 100% to estimate."
                            : "Add your page's monthly traffic to see how long this test needs to run."}
                    </p>
                </div>
            )}
        </div>
    );
}
