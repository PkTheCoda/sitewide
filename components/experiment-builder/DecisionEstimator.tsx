"use client";

import { useState } from "react";
import { DECISION_FLOOR, estimateTimeToDecision } from "@/lib/stats";

// The "will this test ever finish?" reality check, shown as the last builder
// step (BuilderSidebar wraps it in the step card). A founder testing a
// 300-visitors/month page should SEE that answers take months to arrive — and
// reach for a higher-traffic page — instead of quietly waiting on data that
// can't arrive.
//
// Purely informational since the sequential-stats switch: the agent checks
// daily and ends the test the moment one version is confidently better, so
// there is no sample size to commit to (and no "expected impact" question the
// founder can't answer). We show an honest RANGE instead — a big lift
// resolves near the fast end, a moderate one near the slow end — bracketed by
// the same power math the old estimator used, as an ETA rather than a gate.

type Props = {
    groupCount: number; // control + variants (splitting traffic more ways = slower)
};

// The bracket: +50% relative lift ("a redesign that works") to +25% ("a
// clearly better offer"). Below ~+25% the honest answer on typical SaaS
// traffic is "months", which the slow end already communicates.
const MDE_FAST = 0.5;
const MDE_SLOW = 0.25;

function fmtDays(days: number): string {
    if (days <= 90) return `${days} day${days === 1 ? "" : "s"}`;
    const months = Math.round(days / 30);
    if (months <= 18) return `${months} months`;
    const years = days / 365;
    return years >= 2 ? `${Math.floor(years)}+ years` : "a year";
}

function verdict(fastDays: number, slowDays: number) {
    if (fastDays > 60)
        return {
            tone: "warn",
            line: "This page's traffic makes for a long test even for a big improvement — a higher-traffic page or fewer variants would get you a result much sooner.",
        };
    if (slowDays <= 21)
        return { tone: "calm", line: "You'll have a clear answer within a few weeks." };
    return {
        tone: "calm",
        line: "Your agent checks daily and ends the test as soon as one version is confidently better — big improvements land near the fast end.",
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

export default function DecisionEstimator({ groupCount }: Props) {
    const [monthlyVisitors, setMonthlyVisitors] = useState("");
    const [baselinePct, setBaselinePct] = useState("5");

    const baseline = parseFloat(baselinePct) / 100;
    const monthly = parseFloat(monthlyVisitors);
    const dailyVisitors = monthly / 30;

    const fast = monthly > 0
        ? estimateTimeToDecision({ baseline, mde: MDE_FAST, dailyVisitors, groupCount })
        : null;
    const slow = monthly > 0
        ? estimateTimeToDecision({ baseline, mde: MDE_SLOW, dailyVisitors, groupCount })
        : null;

    // Even a huge lift can't be called before every arm clears the floor.
    const floorDays =
        monthly > 0 ? Math.ceil(DECISION_FLOOR / (dailyVisitors / groupCount)) : null;
    const fastDays = fast && floorDays !== null ? Math.max(fast.days, floorDays) : null;
    const slowDays = slow && fastDays !== null ? Math.max(slow.days, fastDays) : null;

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

            {/* Live readout */}
            {fastDays !== null && slowDays !== null ? (
                (() => {
                    const v = verdict(fastDays, slowDays);
                    const t = TONE[v.tone];
                    const range =
                        fastDays === slowDays
                            ? `~${fmtDays(fastDays)}`
                            : `~${fmtDays(fastDays)} – ${fmtDays(slowDays)}`;
                    return (
                        <div
                            className={`mt-0.5 rounded-lg border ${t.panel} p-3 flex flex-col gap-1.5`}
                        >
                            <div className="flex items-baseline justify-between gap-2">
                                <span className={`font-robot text-lg font-semibold tabular-nums ${t.big}`}>
                                    {range}
                                </span>
                                <span className={`text-[11px] tabular-nums ${t.sub}`}>
                                    checked daily · {groupCount} arms
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
                        {!(baseline > 0 && baseline < 1)
                            ? "Enter a conversion rate between 0 and 100% to estimate."
                            : "Add your page's monthly traffic to see how long this test is likely to run."}
                    </p>
                </div>
            )}
        </div>
    );
}
