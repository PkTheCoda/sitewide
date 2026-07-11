"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/services/context/authContext";
import {
    activateExperiment,
    dismissExperiment,
    getAgentActions,
    getExperiment,
    getExperimentDailySeries,
    getExperimentEvents,
    getExperimentVariants,
    pauseExperiment,
    renameExperiment,
} from "@/lib/experiments";
import { buildPreviewLink } from "@/lib/preview";
import { agentActionSummary } from "@/lib/agentSummary";
import {
    AgentAction,
    DailyStat,
    Experiment,
    ExperimentVariant,
    VariantPayload,
} from "@/lib/types";
import SnippetInstructions from "@/components/dashboard/SnippetInstructions";
import {
    LuCircleAlert,
    LuArrowLeft,
    LuCalendarDays,
    LuCheck,
    LuChevronDown,
    LuExternalLink,
    LuFlag,
    LuGlobe,
    LuHourglass,
    LuLightbulb,
    LuMousePointerClick,
    LuPencil,
    LuSearch,
    LuShield,
    LuSparkles,
    LuTarget,
    LuTrophy,
    LuTrendingUp,
    LuUsers,
    LuX,
} from "react-icons/lu";
import { IconType } from "react-icons";
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

import { PiLinkDuotone } from "react-icons/pi";

// Chart series colors — validated as a categorical palette (CVD-safe against
// each other, ≥3:1 on white). Views is context (soft area), exposures and
// conversions are the story (lines).
const COLOR_VIEWS = "#0369a1"; // sky-700
const COLOR_EXPOSURES = "#ea580c"; // orange-600
const COLOR_CONVERSIONS = "#059669"; // emerald-600

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const STATUS_CONTROL: Record<
    string,
    { label: string; button: string; chevron: string; shadow: string }
> = {
    running: {
        label: "Actively running",
        button: "bg-orange-500 hover:bg-orange-600 text-white",
        chevron: "border-orange-600/40",
        shadow: "drop-shadow-[0px_4px_0px_rgba(234,88,12,1)]",
    },
    paused: {
        label: "Experiment Paused",
        button: "bg-slate-400 hover:bg-slate-500 text-white",
        chevron: "border-slate-500/40",
        shadow: "drop-shadow-[0px_4px_0px_rgba(100,116,139,1)]",
    },
    draft: {
        label: "Draft Experiment",
        button: "bg-sky-500 hover:bg-sky-600 text-white",
        chevron: "border-sky-600/40",
        shadow: "drop-shadow-[0px_4px_0px_rgba(2,132,199,1)]",
    },
    completed: {
        label: "Completed Experiment",
        button: "bg-emerald-500 hover:bg-emerald-600 text-white",
        chevron: "border-emerald-600/40 ",
        shadow: "drop-shadow-[0px_4px_0px_rgba(5,150,105,1)]",
    },
    archived: {
        label: "Archived Experiment",
        button: "bg-stone-400 hover:bg-stone-500 text-white",
        chevron: "border-stone-500/40",
        shadow: "drop-shadow-[0px_4px_0px_rgba(120,113,108,1)]",
    },
};

// "2026-07-08" (UTC day key) → "Jul 8" without timezone drift
function fmtDay(day: string): string {
    const [, m, d] = day.split("-");
    return `${MONTHS[Number(m) - 1]} ${Number(d)}`;
}

function fmtDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
    });
}

function fmtRelative(iso: string): string {
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diffMs / 60_000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return "Yesterday";
    if (days < 14) return `${days}d ago`;
    return fmtDate(iso);
}

function agentActionMeta(action: AgentAction): {
    title: string;
    icon: IconType;
    tone: string;
} {
    const detail = (action.detail ?? {}) as Record<string, unknown>;
    if (action.action === "evaluated" && detail.reason === "insufficient_sample") {
        return {
            title: "Waiting on data",
            icon: LuHourglass,
            tone: "bg-amber-100 text-amber-700",
        };
    }
    switch (action.action) {
        case "promoted_winner":
            return { title: "Promoted a winner", icon: LuTrophy, tone: "bg-emerald-100 text-emerald-700" };
        case "kept_control":
            return { title: "Kept the original", icon: LuShield, tone: "bg-sky-100 text-sky-700" };
        case "proposed_experiment":
            return { title: "Proposed a follow-up", icon: LuSparkles, tone: "bg-violet-100 text-violet-700" };
        case "error":
            return { title: "Hit an error", icon: LuCircleAlert, tone: "bg-rose-100 text-rose-700" };
        default:
            return { title: "Checked results", icon: LuSearch, tone: "bg-stone-100 text-stone-600" };
    }
}

function payloadText(payload: VariantPayload): string {
    if (!payload) return "The page exactly as it is today";
    if ("text" in payload) return `“${payload.text}”`;
    if ("textParts" in payload) return `“${payload.textParts.filter(Boolean).join(" ")}”`;
    if ("src" in payload) return "Swapped image";
    if ("hide" in payload) return "Element hidden for this group";
    if ("styles" in payload)
        return Object.entries(payload.styles)
            .map(([k, v]) => `${k}: ${v}`)
            .join(" · ");
    return "—";
}

type Counts = Record<string, { exposures: number; conversions: number }>;

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

// Shared daily activity chart — used for the experiment totals and each variant.
function DailyActivityChart({
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
            <div className={`${heightClass} flex flex-col items-center justify-center gap-1.5 bg-stone-50 border border-dashed border-stone-200 rounded-lg`}>
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

function ChartLegend() {
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

export default function IndividualExperimentPage() {
    const { id } = useParams<{ id: string }>();
    const { user } = useAuth();
    const router = useRouter();

    const [experiment, setExperiment] = useState<Experiment | null>(null);
    const [variants, setVariants] = useState<ExperimentVariant[]>([]);
    const [counts, setCounts] = useState<Counts>({});
    const [days, setDays] = useState<DailyStat[]>([]);
    const [byVariant, setByVariant] = useState<Record<string, DailyStat[]>>({});
    const [actions, setActions] = useState<AgentAction[]>([]);
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);

    const [editingName, setEditingName] = useState(false);
    const [nameDraft, setNameDraft] = useState("");
    const [siteId, setSiteId] = useState<string | null>(null);
    const [showSnippet, setShowSnippet] = useState(false);
    const [busy, setBusy] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    const [statusMenuOpen, setStatusMenuOpen] = useState(false);
    const statusMenuRef = useRef<HTMLDivElement>(null);

    const load = useCallback(async () => {
        const [exp, variantData, eventData, series, actionData] = await Promise.all([
            getExperiment(id),
            getExperimentVariants(id),
            getExperimentEvents(id),
            getExperimentDailySeries(id),
            getAgentActions(id),
        ]);

        if (!exp || "error" in exp) {
            setNotFound(true);
            setLoading(false);
            return;
        }
        setExperiment(exp as Experiment);
        setSiteId((exp as Experiment).site_id);

        if (Array.isArray(variantData)) setVariants(variantData as ExperimentVariant[]);
        if (Array.isArray(actionData)) setActions(actionData as AgentAction[]);
        if (!("error" in series)) {
            setDays(series.days);
            setByVariant(series.byVariant);
        }

        if (Array.isArray(eventData)) {
            const agg: Counts = {};
            for (const event of eventData) {
                agg[event.variant_id] ??= { exposures: 0, conversions: 0 };
                if (event.event_type === "exposure") agg[event.variant_id].exposures++;
                else agg[event.variant_id].conversions++;
            }
            setCounts(agg);
        }
        setLoading(false);
        console.log(experiment);
        console.log(variantData);
    }, [id]);

    useEffect(() => {
        if (!user) return;
        load();
    }, [user, load]);

    useEffect(() => {
        if (!statusMenuOpen) return;
        function onPointerDown(e: MouseEvent) {
            if (statusMenuRef.current && !statusMenuRef.current.contains(e.target as Node)) {
                setStatusMenuOpen(false);
            }
        }
        function onKeyDown(e: KeyboardEvent) {
            if (e.key === "Escape") setStatusMenuOpen(false);
        }
        document.addEventListener("mousedown", onPointerDown);
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("mousedown", onPointerDown);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [statusMenuOpen]);

    // ── Derived numbers ──────────────────────────────────────────────────────
    const totals = Object.values(counts).reduce(
        (acc, c) => ({
            exposures: acc.exposures + c.exposures,
            conversions: acc.conversions + c.conversions,
        }),
        { exposures: 0, conversions: 0 }
    );
    const overallRate = totals.exposures > 0 ? (totals.conversions / totals.exposures) * 100 : 0;
    const daysRunning = experiment?.started_at
        ? Math.max(
              1,
              Math.ceil(
                  ((experiment.ended_at ? new Date(experiment.ended_at).getTime() : Date.now()) -
                      new Date(experiment.started_at).getTime()) /
                      86_400_000
              )
          )
        : null;

    // ── Actions ──────────────────────────────────────────────────────────────
    async function saveName() {
        if (!experiment) return;
        const next = nameDraft.trim();
        setEditingName(false);
        if (!next || next === experiment.name) return;
        setExperiment({ ...experiment, name: next }); // optimistic
        const result = await renameExperiment(experiment.id, next);
        if ("error" in result && result.error) setActionError(result.error);
    }

    async function handleActivate() {
        if (!experiment) return;
        setBusy(true);
        setActionError(null);
        const result = await activateExperiment(experiment);
        setBusy(false);
        if ("error" in result && result.error) setActionError(result.error);
        else if ("site_id" in result && result.site_id) {
            setSiteId(result.site_id);
            setShowSnippet(true);
            load();
        }
    }

    async function handlePause() {
        if (!experiment) return;
        setBusy(true);
        setActionError(null);
        const result = await pauseExperiment(experiment.id);
        setBusy(false);
        if ("error" in result && result.error) setActionError(result.error);
        else load();
    }

    async function handleDismiss() {
        if (!experiment) return;
        setBusy(true);
        const result = await dismissExperiment(experiment.id);
        setBusy(false);
        if ("error" in result && result.error) setActionError(result.error);
        else router.push("/dashboard/experiments");
    }

    // ── Loading / not-found states ───────────────────────────────────────────
    if (loading) {
        return (
            <div className="flex flex-col gap-y-6 max-w-7xl w-full mx-auto animate-pulse">
                {/* Top nav */}
                <div className="flex items-center justify-between">
                    <div className="h-9 w-40 bg-stone-100 rounded-lg" />
                    <div className="flex flex-col items-end gap-1.5">
                        <div className="h-3 w-44 bg-stone-100 rounded" />
                        <div className="h-3 w-32 bg-stone-100 rounded" />
                    </div>
                </div>

                {/* Title + status */}
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex flex-col gap-2 min-w-0 flex-1">
                        <div className="h-3 w-36 bg-stone-100 rounded" />
                        <div className="h-8 w-72 max-w-full bg-stone-100 rounded" />
                        <div className="h-4 w-full max-w-xl bg-stone-100 rounded" />
                    </div>
                    <div className="h-10 w-44 bg-stone-100 rounded-lg" />
                </div>

                {/* Meta strip */}
                <div className="flex items-center justify-between flex-wrap gap-4 px-8 bg-stone-50 p-4 rounded-xl">
                    {[0, 1, 2].map((i) => (
                        <div key={i} className="flex flex-col gap-2 min-w-36">
                            <div className="h-3 w-24 bg-stone-200/80 rounded" />
                            <div className="h-5 w-40 bg-stone-200/80 rounded" />
                        </div>
                    ))}
                </div>

                {/* Variant cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 px-6 pt-2">
                    {[0, 1].map((i) => (
                        <div
                            key={i}
                            className="rounded-xl border border-stone-100 bg-white p-4 flex flex-col gap-3"
                        >
                            <div className="flex items-start justify-between gap-4">
                                <div className="flex flex-col gap-2 flex-1">
                                    <div className="h-5 w-28 bg-stone-100 rounded" />
                                    <div className="h-3 w-48 max-w-full bg-stone-100 rounded" />
                                </div>
                                <div className="flex flex-col items-end gap-1.5">
                                    <div className="h-5 w-28 bg-stone-100 rounded" />
                                    <div className="h-3 w-36 bg-stone-100 rounded" />
                                </div>
                            </div>
                            <div className="h-1.5 w-full bg-stone-100 rounded-full" />
                            <div className="flex items-center justify-between">
                                <div className="h-3 w-20 bg-stone-100 rounded" />
                                <div className="h-3 w-40 bg-stone-100 rounded" />
                            </div>
                            <div className="h-64 bg-stone-50 rounded-lg" />
                        </div>
                    ))}
                </div>

                {/* Overall analytics */}
                <div className="flex flex-col gap-4 px-6">
                    <div className="h-6 w-48 bg-stone-100 rounded" />
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {[0, 1, 2, 3].map((i) => (
                            <div key={i} className="h-12 bg-stone-100 rounded-xl" />
                        ))}
                    </div>
                    <div className="h-72 bg-stone-100 rounded-xl" />
                </div>

                {/* Agent activity */}
                <div className="flex flex-col gap-3">
                    <div className="h-6 w-56 bg-stone-100 rounded" />
                    <div className="h-28 bg-stone-100 rounded-2xl" />
                </div>
            </div>
        );
    }
    if (notFound || !experiment) {
        return (
            <div className="flex flex-col items-center gap-3 py-20 text-center">
                <p className="text-sm font-medium text-stone-700">Experiment not found</p>
                <p className="text-xs text-stone-500">It may have been deleted, or the link is wrong.</p>
                <Link
                    href="/dashboard/experiments"
                    className="text-xs font-medium text-orange-600 hover:text-orange-700 transition-colors"
                >
                    ← Back to experiments
                </Link>
            </div>
        );
    }

    let pageLabel = experiment.page_url;
    try {
        const u = new URL(experiment.page_url);
        pageLabel = u.hostname + (u.pathname === "/" ? "" : u.pathname);
    } catch {
        /* show raw url */
    }
    const targetLabel = experiment.selector_fallback?.text ?? experiment.original_value;

    const statusTone = STATUS_CONTROL[experiment.status] ?? STATUS_CONTROL.draft;

    const statusMenuItems: { label: string; onClick: () => void; danger?: boolean }[] = [];

    if (experiment.status === "running") {
        statusMenuItems.push({ label: "Pause experiment", onClick: handlePause });
    } else if (experiment.status === "paused") {
        statusMenuItems.push({ label: "Resume experiment", onClick: handleActivate });
    } else if (experiment.status === "draft") {
        statusMenuItems.push({ label: "Activate experiment", onClick: handleActivate });
        if (experiment.created_by === "agent") {
            statusMenuItems.push({
                label: "Dismiss proposal",
                onClick: handleDismiss,
                danger: true,
            });
        }
    }

    return (
        <div className="flex flex-col gap-y-6 max-w-300 mx-auto">
            {/* ── Header ─────────────────────────────────────────────────── */}
            <div className="flex flex-col gap-6">

                {/* All experiment + new experiment button combo */}
                <div className="flex items-center justify-between">
                    <Link 
                        href="/dashboard/experiments"
                        className="w-max h-max text-sm bg-stone-100 flex items-center gap-2 hover:bg-stone-200 transition-colors text-stone-600 font-semibold px-4 py-2 rounded-lg drop-shadow-[0px_4px_0px_rgba(231,229,228,1)]"
                    >
                        <LuArrowLeft className="size-3" strokeWidth={2} />
                        All Experiments
                    </Link>

                    <div className="flex flex-col gap-1 text-xs text-stone-400 text-right">
                        <h5 className="">
                            Experiment Id: {id}
                        </h5>
                        <h5>
                            Date Created: {fmtDate(experiment.created_at)}
                        </h5>
                    </div>
                </div>

                {/* Top line -- Experiment Main Info + control button */}
                <div className="flex flex-wrap items-center justify-between gap-3">

                    <div className="flex flex-col gap-2">

                        {/* Title edit button */}
                        <h4 className="text-xs text-stone-400">
                            https://{pageLabel}
                        </h4>
                        <div className="flex items-center gap-2.5 min-w-0">
                            {/* If editing is on */}
                            {editingName ? (
                                <form
                                    onSubmit={(e) => {
                                        e.preventDefault();
                                        saveName();
                                    }}
                                    className="flex items-center gap-1.5"
                                >
                                    <input
                                        autoFocus
                                        value={nameDraft}
                                        onChange={(e) => setNameDraft(e.target.value)}
                                        onBlur={saveName}
                                        onKeyDown={(e) => e.key === "Escape" && setEditingName(false)}
                                        className="text-xl font-semibold tracking-tight text-stone-800 bg-white border border-orange-300 rounded-md px-2 py-0.5 focus:outline-none focus:border-orange-600 min-w-0 w-104 max-w-full"
                                    />
                                    <button
                                        type="submit"
                                        aria-label="Save name"
                                        className="text-emerald-600 hover:text-emerald-700 p-1"
                                    >
                                        <LuCheck className="size-4" />
                                    </button>
                                    <button
                                        type="button"
                                        aria-label="Cancel"
                                        onMouseDown={(e) => e.preventDefault()}
                                        onClick={() => setEditingName(false)}
                                        className="text-stone-400 hover:text-red-500 p-1"
                                    >
                                        <LuX className="size-4" />
                                    </button>
                                </form>
                            ) : (
                                // Editing off, publicly shown
                                <>
                        
                                        <h1 className="three-title font-semibold tracking-tight text-stone-800 truncate">
                                            {experiment.name}
                                        </h1>
                                    <button
                                        onClick={() => {
                                            setNameDraft(experiment.name);
                                            setEditingName(true);
                                        }}
                                        aria-label="Rename experiment"
                                        className="text-stone-300 hover:text-orange-600 transition-colors shrink-0"
                                    >
                                        <LuPencil className="size-3.5" />
                                    </button>
                                </>
                            )}
                            {/* {experiment.created_by === "agent" && (
                                <span className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-violet-700 bg-violet-50 border border-violet-200 rounded-full px-2 py-0.5">
                                    Agent proposal
                                </span>
                            )} */}
                        </div>
                        <h3 className="text-stone-600">
                            {experiment?.hypothesis}
                        </h3>
                        
                    </div>

                    {/* Experiment Status Button */}
                    <div className="">
                        {statusMenuItems.length === 0 ? (
                            <div
                                className={`w-max h-max text-sm font-semibold px-6 py-2 rounded-lg  ${statusTone.button} ${statusTone.shadow}`}
                            >
                                {busy ? "Working…" : statusTone.label}
                            </div>
                        ) : (
                            <div ref={statusMenuRef} className="relative shrink-0">
                                <div
                                    className={`flex items-stretch text-sm font-semibold rounded-lg overflow-hidden ${statusTone.button} ${statusTone.shadow}`}
                                >
                                    <span className="px-5 py-2 select-none">
                                        {busy ? "Working…" : statusTone.label}
                                    </span>
                                    <button
                                        type="button"
                                        aria-label="Experiment status actions"
                                        aria-expanded={statusMenuOpen}
                                        disabled={busy}
                                        onClick={() => setStatusMenuOpen((open) => !open)}
                                        className={`px-2.5 border-l transition-colors disabled:opacity-50 cursor-pointer ${statusTone.chevron}`}
                                    >
                                        <LuChevronDown
                                            className={`size-4 transition-transform ${statusMenuOpen ? "rotate-180" : ""}`}
                                        />
                                    </button>
                                </div>
                                {statusMenuOpen && (
                                    <div className="absolute right-0 top-[calc(100%+0.5rem)] z-20 min-w-44 rounded-lg border border-stone-200 bg-white shadow-md py-1">
                                        {statusMenuItems.map((item) => (
                                            <button
                                                key={item.label}
                                                type="button"
                                                disabled={busy}
                                                onClick={() => {
                                                    setStatusMenuOpen(false);
                                                    item.onClick();
                                                }}
                                                className={`w-full text-left px-3 py-2 text-sm transition-colors disabled:opacity-50 cursor-pointer ${
                                                    item.danger
                                                        ? "text-red-600 hover:bg-red-50"
                                                        : "text-stone-700 hover:bg-stone-50"
                                                }`}
                                            >
                                                {item.label}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Meta Sections */}
                <div className="flex items-center justify-between flex-wrap px-8 bg-stone-100 p-4 rounded-xl">

                    {/* Target Element */}
                    <div className="flex flex-col font-medium">
                        <h4 className="opacity-50 uppercase tracking-wide text-xs mb-1">Target element</h4>
                        <div className="flex items-center gap-1.5 min-w-0">
                            <span className="max-w-88">
                                {targetLabel
                                    ? <div className="flex items-center gap-3">
                                        <span className="font-robot text-orange-600 font-bold one-title rounded-md">{experiment.selector_fallback?.tag ?? "element"}</span>{" "}
                                        {targetLabel.replace(/\s+/g, " ").slice(0, 60)}
                                      </div>
                                    : <span className="opacity-50">—</span>
                                }
                            </span>
                        </div>
                    </div>

                    {/* Goal Element */}
                    <div className="flex flex-col font-medium">
                        <h4 className="opacity-50 uppercase tracking-wide text-xs mb-1">Goal element</h4>
                        <div className="flex items-center gap-1.5 min-w-0">
                            <span className="max-w-88">
                                {targetLabel
                                    ? <div className="flex items-center gap-3">
                                        <span className="font-robot text-orange-600 font-bold one-title rounded-md">{experiment.goal_fallback?.tag ?? "element"}</span>{" "}
                                        <p>{experiment.goal_fallback?.text?.slice(0, 60)}</p>
                                      </div>
                                    : <span className="opacity-50">—</span>
                                }
                            </span>
                        </div>
                    </div>

                    {/* Goal Section */}
                    <div className="flex flex-col font-medium">
                        <h4 className="opacity-50 uppercase tracking-wide text-xs mb-1">Experiment Goal</h4>
                        <div className="flex items-center gap-1.5">
                            {experiment.goal_type === "click" ? (
                                <>
                                    <span className="">
                                        <span className="font-robot text-orange-600 font-bold one-title rounded-md">Click</span> “{experiment.goal_fallback?.text?.slice(0, 40) ?? "target element"}”
                                    </span>
                                </>
                            ) : (
                                <>
                                    <span>
                                        <span className="font-robot text-orange-600 font-bold one-title rounded-md">Visit</span> {experiment.goal_page_path}
                                    </span>
                                </>
                            )}
                        </div>
                    </div>
                    
                </div>
           

            </div>

            {/* ── Why this test exists ───────────────────────────────────── */}
            {experiment.agent_rationale && (
                <p className="text-xs text-violet-900 leading-relaxed bg-violet-50 border border-violet-200 rounded-xl p-4">
                    <span className="font-medium">Why your agent proposed this: </span>
                    {experiment.agent_rationale}
                </p>
            )}

            {/* {experiment.hypothesis && (
                <div className="flex items-start gap-3 bg-white border border-stone-200 rounded-xl p-4">
                    <LuLightbulb className="size-4 text-orange-600 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                        <p className="text-[10px] uppercase tracking-wider text-stone-400 font-medium mb-0.5">
                            Hypothesis
                        </p>
                        <p className="text-xs text-stone-600 leading-relaxed">{experiment.hypothesis}</p>
                    </div>
                </div>
            )} */}

            {/* ── Variants ───────────────────────────────────────────────── */}
            <div className="flex flex-col gap-2 px-6 bg-linear-to-t pt-4 from-white to-stone-100 from-60% rounded-xl">
                {/* <h2 className="one-title font-semibold tracking-tight text-stone-800 truncate">
                    Variant-By-Variant Analaytics
                </h2> */}
                <div className="grid grid-cols-2 gap-4">
                    {variants.map((variant) => {
                        const c = counts[variant.id] ?? { exposures: 0, conversions: 0 };
                        const rate = c.exposures > 0 ? (c.conversions / c.exposures) * 100 : 0;
                        const isWinner = experiment.winner_variant_id === variant.id;
                        const previewUrl = buildPreviewLink(
                            experiment.page_url,
                            experiment.selector,
                            experiment.selector_fallback,
                            variant.payload
                        );
                        // Fall back to zero-filled days matching the main chart range
                        // when this variant has no rows in experiment_daily_views yet.
                        const variantDays =
                            byVariant[variant.id] ??
                            days.map((d) => ({ day: d.day, views: 0, exposures: 0, conversions: 0 }));
                        return (
                            <div className="flex flex-col items-end w-full">
                                <div
                                    key={variant.id}
                                    className={`relative rounded-xl rounded-br-none border p-4 flex flex-col gap-3 w-full ${
                                        isWinner ? "border-emerald-300 bg-emerald-50/60" : "border-stone-200 bg-white"
                                    }`}
                                >
                                    <div className="flex items-center justify-between gap-4">
                                        <div className="min-w-0 ">
                                            <p className="text-xs font-medium text-stone-800 flex items-center gap-2">
                                                <div className="flex items-center gap-2">
                                                    <Link
                                                        href={previewUrl ? previewUrl : pageLabel}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="cursor-pointer"
                                                    >
                                                        <PiLinkDuotone className="size-4 text-stone-500 hover:text-blue-500 transition-colors" />
                                                    </Link>
                                               
                                                    <h3 className="font-medium tracking-tight text-stone-700 truncate text-lg">
                                                        {variant.name}
                                                    </h3>
                                                </div>
                                                
                                                {/* {variant.is_control && (
                                                    <span className="text-[10px] font-normal text-stone-400 uppercase tracking-wider">
                                                        original
                                                    </span>
                                                )} */}
                                                {isWinner && (
                                                    <span className="text-[10px] font-medium text-emerald-700 bg-emerald-100 rounded-full px-2 py-0.5">
                                                        Winner
                                                    </span>
                                                )}
                                            </p>
                                            <p className="text-xs text-stone-500 leading-relaxed mt-1 line-clamp-2">
                                                {payloadText(variant.payload)}
                                            </p>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <p className="text-lg font-semibold text-stone-800 tabular-nums font-robot">
                                                {rate.toFixed(1)}% <span className="font-inter">CONVERSION</span>
                                            </p>
                                            <p className="text-[11px] text-stone-400 tabular-nums">
                                                {c.conversions}/{c.exposures} visitors · {variant.weight}% of traffic
                                            </p>
                                        </div>
                                    </div>

                                    {/* rate bar, scaled to the best variant */}
                                    <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
                                        <div
                                            className={`h-full rounded-full ${isWinner ? "bg-emerald-500" : "bg-stone-300"}`}
                                            style={{
                                                width: `${Math.min(100, Math.max(rate === 0 ? 0 : 2, rate))}%`,
                                                opacity: rate === 0 ? 0.25 : 1,
                                            }}
                                        />
                                    </div>

                                    <div className="flex flex-col gap-2 pt-1">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <p className="text-[11px] font-medium text-stone-500">Daily activity</p>
                                            <ChartLegend />
                                        </div>
                                        <DailyActivityChart
                                            data={variantDays}
                                            gradientId={`viewsFill-${variant.id}`}
                                        />
                                    </div>
                                </div>
                                {/* <div className="bg-stone-200 w-max px-2 rounded-b-md transition-opacity absolute top-0 right-0">
                                    {previewUrl ? (
                                        <a
                                            href={previewUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="inline-flex items-center text-xs font-medium tracking-tight text-stone-500"
                                        >
                                            Preview Variant
                                        </a>
                                    ) : 
                                    <a
                                        href={pageLabel}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex items-center text-xs font-medium tracking-tight text-stone-500"
                                    >
                                        Preview Page
                                    </a>
                                    }
                                </div> */}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Overall Site Analytics */}
            <div className="flex flex-col from-stone-100 to-white to-65% bg-linear-to-t rounded-b-2xl rounded-t-lg gap-4 px-6">
                {/* ── Stat tiles ─────────────────────────────────────────────── */}
                <h2 className="one-title font-medium tracking-tight text-stone-800 truncate">
                    Total Page Analysis
                </h2>
                {/* ── Daily activity chart ───────────────────────────────────── */}
                <div className="bg-white border border-stone-200 rounded-xl p-5 flex flex-col gap-4 mb-2 shadow-xs border-b-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <h2 className="text-sm font-medium text-stone-800">Daily activity</h2>
                        <ChartLegend />
                    </div>
                    <DailyActivityChart data={days} gradientId="viewsFillMain" />
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-white border border-stone-200 rounded-t-xl border-b-0 shadow-[0_-4px_10px_0_rgba(0,0,0,0.05)] p-2 px-4 flex items-center justify-center">
               
                        <h3 className="font-medium tracking-tight">
                            <span className="font-robot pr-2 font-semibold">{totals.exposures.toLocaleString()}</span>
                            <span className="opacity-50">Unique Visitors</span>
                        </h3> 
                    </div>

                    <div className="bg-white border border-stone-200 rounded-t-xl border-b-0 shadow-[0_-4px_10px_0_rgba(0,0,0,0.05)] p-2 px-4 flex items-center justify-center">
                        <h3 className="font-medium tracking-tight">
                            <span className="font-robot pr-2 font-semibold">{totals.conversions.toLocaleString()}</span>
                            <span className="opacity-50">Overall Conversions</span>
                        </h3> 
                    </div>

                    <div className="bg-white border border-stone-200 rounded-t-xl border-b-0 shadow-[0_-4px_10px_0_rgba(0,0,0,0.05)] p-2 px-4 flex items-center justify-center">
                        <h3 className="font-medium tracking-tight">
                            <span className="font-robot pr-2 font-semibold">{`${overallRate.toFixed(0)}%`}</span>
                            <span className="opacity-50">Total Conversion Rate</span>
                        </h3> 
                    </div>

                    <div className="bg-white border border-stone-200 rounded-t-xl border-b-0 shadow-[0_-4px_10px_0_rgba(0,0,0,0.05)] p-2 px-4 flex items-center justify-center">
                        <h3 className="font-medium tracking-tight flex items-center">
                            <span className="font-robot pr-2 font-semibold flex items-center gap-1">{daysRunning}<span>days</span></span>
                            <span className="opacity-50">Runtime</span>
                        </h3> 
                    </div>
                </div>

            </div>

            {/* ── Snippet install (after activation) ─────────────────────── */}
            {showSnippet && siteId && <SnippetInstructions siteId={siteId} />}
            {actionError && <p className="text-xs text-red-600">{actionError}</p>}

            {/* ── Agent activity ─────────────────────────────────────────── */}
            <div className="flex flex-col gap-4">
                <h2 className="one-title font-medium tracking-tight text-stone-800 truncate">
                    Agent Activity & Timeline
                </h2>
                {actions.length === 0 ? (
                    <p className="text-xs text-stone-400 leading-relaxed bg-stone-50 border border-dashed border-stone-200 rounded-xl p-4">
                        No evaluations yet — your agent checks running experiments every Monday at 9:00 UTC
                        and its decisions will show up here.
                    </p>
                ) : (
                    <div className="bg-white">
                        <div className="flex flex-wrap items-start gap-y-6">
                            {[...actions].reverse().map((action, i, list) => {
                                const meta = agentActionMeta(action);
                                const Icon = meta.icon;
                                const summary = agentActionSummary(action);
                                const isLast = i === list.length - 1;
                                return (
                                    <div key={action.id} className="flex items-start">
                                        <div className="flex items-start gap-3 w-56 sm:w-64">
                                            <div className="relative flex flex-col items-center shrink-0">
                                                <div
                                                    className={`size-9 rounded-full flex items-center justify-center ${meta.tone}`}
                                                >
                                                    <Icon className="size-4" strokeWidth={2} />
                                                </div>
                                            </div>
                                            <div className="min-w-0 pt-0.5">
                                                <p className="text-sm text-stone-700 leading-snug">
                                                    <span className="font-semibold text-stone-900">
                                                        {meta.title}
                                                    </span>
                                                    <span className="text-stone-500">
                                                        {" — "}
                                                        {summary.includes(" — ")
                                                            ? summary.split(" — ").slice(1).join(" — ")
                                                            : summary}
                                                    </span>
                                                </p>
                                                <p className="text-xs text-stone-400 mt-1.5">
                                                    {fmtRelative(action.created_at)}
                                                </p>
                                            </div>
                                        </div>
                                        {!isLast && (
                                            <div className="hidden sm:flex items-center self-start h-9 w-10 shrink-0 px-1">
                                                <div className="h-px w-full bg-stone-200" />
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}