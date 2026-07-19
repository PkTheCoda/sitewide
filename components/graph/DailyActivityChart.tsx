"use client";

import {
    Area,
    CartesianGrid,
    ComposedChart,
    Line,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";
import { DailyStat } from "@/lib/types";

// The one daily-activity chart, shared everywhere a day-by-day series shows up
// (experiment page totals, per-variant cards, dashboard overview). One file =
// one palette, one tooltip, one set of axis rules.
//
// Series colors — validated as a categorical palette (CVD-safe against each
// other, ≥3:1 on white). Views is context (soft area), exposures and
// conversions are the story (lines).
export const COLOR_VIEWS = "#0369a1"; // sky-700
export const COLOR_EXPOSURES = "#ea580c"; // orange-600
export const COLOR_CONVERSIONS = "#059669"; // emerald-600

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2026-07-08" (UTC day key) → "Jul 8" without timezone drift
export function fmtDay(day: string): string {
    const [, m, d] = day.split("-");
    return `${MONTHS[Number(m) - 1]} ${Number(d)}`;
}

// Custom tooltip — typed structurally on purpose so it survives recharts
// version changes; only reads name/value/color off each series entry.
function ChartTip({
    active,
    label,
    payload,
}: {
    active?: boolean;
    label?: string;
    payload?: { name?: string; value?: number; color?: string; stroke?: string }[];
}) {
    if (!active || !payload || payload.length === 0) return null;
    return (
        <div className="bg-white border border-stone-200 rounded-lg shadow-sm px-3 py-2">
            <p className="text-[11px] font-medium text-stone-700 mb-1">{label ? fmtDay(label) : ""}</p>
            {payload.map((entry, i) => (
                <div key={i} className="flex items-center gap-2 text-[11px] text-stone-600">
                    <span
                        className="size-2 rounded-full shrink-0"
                        style={{ background: entry.color ?? entry.stroke }}
                    />
                    <span className="flex-1">{entry.name}</span>
                    <span className="font-medium text-stone-800 tabular-nums">{entry.value}</span>
                </div>
            ))}
        </div>
    );
}

export function DailyActivityChart({
    data,
    heightClass = "h-64",
    gradientId = "viewsFill",
}: {
    data: DailyStat[];
    heightClass?: string;
    gradientId?: string;
}) {
    const hasTraffic = data.some((d) => d.views > 0 || d.exposures > 0 || d.conversions > 0);
    if (!hasTraffic) {
        return (
            <div
                className={`${heightClass} flex flex-col items-center justify-center gap-1.5 bg-stone-50 border border-dashed border-stone-200 rounded-lg`}
            >
                <p className="text-xs font-medium text-stone-500">No traffic yet</p>
                <p className="text-[11px] text-stone-400">
                    Data appears here once visitors start hitting the page.
                </p>
            </div>
        );
    }

    return (
        <div className={heightClass}>
            <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
                    <defs>
                        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={COLOR_VIEWS} stopOpacity={0.1} />
                            <stop offset="100%" stopColor={COLOR_VIEWS} stopOpacity={0} />
                        </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} stroke="#e7e5e4" />
                    <XAxis
                        dataKey="day"
                        tickFormatter={fmtDay}
                        tick={{ fontSize: 11, fill: "#a8a29e" }}
                        tickLine={false}
                        axisLine={false}
                        minTickGap={24}
                    />
                    <YAxis
                        allowDecimals={false}
                        tick={{ fontSize: 11, fill: "#a8a29e" }}
                        tickLine={false}
                        axisLine={false}
                    />
                    <Tooltip
                        content={<ChartTip />}
                        cursor={{ stroke: "#d6d3d1", strokeDasharray: "3 3" }}
                    />
                    <Area
                        type="linear"
                        dataKey="views"
                        name="Page views"
                        stroke={COLOR_VIEWS}
                        strokeWidth={2}
                        fill={`url(#${gradientId})`}
                        dot={false}
                        activeDot={{ r: 4 }}
                    />
                    <Line
                        type="linear"
                        dataKey="exposures"
                        name="New visitors"
                        stroke={COLOR_EXPOSURES}
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                    />
                    <Line
                        type="linear"
                        dataKey="conversions"
                        name="Conversions"
                        stroke={COLOR_CONVERSIONS}
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                    />
                </ComposedChart>
            </ResponsiveContainer>
        </div>
    );
}

export function ChartLegend() {
    return (
        <div className="flex items-center gap-4 text-[11px] text-stone-500">
            <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: COLOR_VIEWS }} />
                Page views
            </span>
            <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: COLOR_EXPOSURES }} />
                New visitors
            </span>
            <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: COLOR_CONVERSIONS }} />
                Conversions
            </span>
        </div>
    );
}
