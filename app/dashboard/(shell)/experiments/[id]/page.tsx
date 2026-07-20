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
import { twoProportionZTest } from "@/lib/stats";
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
    LuBan,
    LuCalendarDays,
    LuCheck,
    LuChevronDown,
    LuExternalLink,
    LuFlag,
    LuGlobe,
    LuHourglass,
    LuLightbulb,
    LuMail,
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
import { ChartLegend, DailyActivityChart } from "@/components/graph/DailyActivityChart";

import { PiLinkDuotone } from "react-icons/pi";

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
        case "killed_variant":
            return { title: "Stopped a losing variant", icon: LuBan, tone: "bg-rose-100 text-rose-700" };
        case "paused_broken":
            return { title: "Paused the experiment", icon: LuCircleAlert, tone: "bg-amber-100 text-amber-700" };
        case "proposed_experiment":
            return { title: "Proposed a follow-up", icon: LuSparkles, tone: "bg-violet-100 text-violet-700" };
        case "proposal_skipped":
            return { title: "Skipped proposing", icon: LuSparkles, tone: "bg-stone-100 text-stone-600" };
        case "proposal_failed":
            return { title: "Proposal failed", icon: LuCircleAlert, tone: "bg-rose-100 text-rose-700" };
        case "email_sent":
            return { title: "Emailed you", icon: LuMail, tone: "bg-stone-100 text-stone-600" };
        case "email_failed":
            return { title: "Email failed", icon: LuMail, tone: "bg-rose-100 text-rose-700" };
        case "error":
            return { title: "Hit an error", icon: LuCircleAlert, tone: "bg-rose-100 text-rose-700" };
        default:
            return { title: "Checked results", icon: LuSearch, tone: "bg-stone-100 text-stone-600" };
    }
}

// One extra per-row rendering: the Outcome cell — a status chip, or (while
// waiting on data) a progress bar toward the decision threshold. Reads the
// same detail blob the action was logged with.
function actionOutcome(action: AgentAction): React.ReactNode {
    const d = (action.detail ?? {}) as Record<string, unknown>;
    const stats = Array.isArray(d.stats)
        ? (d.stats as { exposures?: number; conversions?: number }[])
        : null;

    if (action.action === "evaluated" && d.reason === "insufficient_sample" && stats) {
        const minSample = typeof d.min_sample_size === "number" ? d.min_sample_size : 100;
        const slowest = Math.min(...stats.map((s) => s.exposures ?? 0));
        const progress = Math.min(1, slowest / minSample);
        return (
            <div className="flex items-center gap-2.5 min-w-32">
                <div className="flex-1 h-1.5 bg-stone-100 rounded-full overflow-hidden">
                    <div
                        className="h-full rounded-full bg-orange-500"
                        style={{ width: `${Math.max(3, progress * 100)}%` }}
                    />
                </div>
                <span className="text-[11px] text-stone-500 font-robot tabular-nums shrink-0">
                    {slowest}/{minSample}
                </span>
            </div>
        );
    }

    const chip = (text: string, tone: string) => (
        <span className={`inline-block text-[11px] font-medium rounded-full px-2.5 py-1 ${tone}`}>
            {text}
        </span>
    );
    switch (action.action) {
        case "promoted_winner": {
            const rate = typeof d.winner_rate === "number" ? ` · ${(d.winner_rate * 100).toFixed(1)}%` : "";
            return chip(`Winner${rate}`, "bg-emerald-100 text-emerald-700");
        }
        case "kept_control":
            return chip("Original kept", "bg-sky-100 text-sky-700");
        case "killed_variant":
            return chip(
                typeof d.variant_name === "string" ? `Stopped “${d.variant_name}”` : "Variant stopped",
                "bg-rose-100 text-rose-700"
            );
        case "paused_broken":
            return chip("Needs your attention", "bg-amber-100 text-amber-700");
        case "proposed_experiment":
            return chip("Draft ready", "bg-violet-100 text-violet-700");
        case "proposal_skipped":
            return chip("No proposal", "bg-stone-100 text-stone-500");
        case "proposal_failed":
        case "error":
            return chip("Error", "bg-rose-100 text-rose-700");
        case "evaluated":
            return chip("Test continues", "bg-stone-100 text-stone-500");
        default:
            return <span className="text-stone-300">—</span>;
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
type Count = { exposures: number; conversions: number };

// The agent won't even run its z-test until every variant clears this many
// unique visitors (mirrors SAMPLE_FLOOR in app/api/agent/evaluate/route.ts).
// We use the SAME gate here so the UI's verdict never contradicts the
// agent's timeline rows below.
const SAMPLE_FLOOR = 100;

type Verdict = {
    phase: "collecting" | "inconclusive" | "significant";
    slowest: number; // fewest unique visitors on any variant — the real gate
    minSample: number;
    leaderName: string;
    leaderId: string;
    lift: number; // relative %, leader vs control
    confidence: number; // (1 - p) * 100
    winnerIsControl: boolean; // significant, but the original is ahead
};

// Turn the raw counts into a single honest verdict about the whole test,
// using the control vs. its best-performing challenger. Returns null when
// there's nothing to compare yet (no control, or no live challenger).
function readVerdict(
    variants: ExperimentVariant[],
    counts: Counts,
    minSampleSize: number
): Verdict | null {
    const control = variants.find((v) => v.is_control);
    const challengers = variants.filter((v) => !v.is_control && !v.killed_at);
    if (!control || challengers.length === 0) return null;

    const rateOf = (id: string) => {
        const c = counts[id] ?? { exposures: 0, conversions: 0 };
        return c.exposures > 0 ? c.conversions / c.exposures : 0;
    };
    const expOf = (id: string) => counts[id]?.exposures ?? 0;

    const minSample = Math.max(SAMPLE_FLOOR, minSampleSize || 0);
    const slowest = Math.min(expOf(control.id), ...challengers.map((v) => expOf(v.id)));

    const leader = challengers.reduce((best, v) => (rateOf(v.id) > rateOf(best.id) ? v : best));
    const cCtl = counts[control.id] ?? { exposures: 0, conversions: 0 };
    const cLead = counts[leader.id] ?? { exposures: 0, conversions: 0 };
    const test = twoProportionZTest(
        cCtl.conversions,
        cCtl.exposures,
        cLead.conversions,
        cLead.exposures
    );
    const pValue = test?.p ?? 1;
    const controlRate = rateOf(control.id);
    const lift = controlRate > 0 ? ((rateOf(leader.id) - controlRate) / controlRate) * 100 : 0;

    let phase: Verdict["phase"];
    if (slowest < minSample) phase = "collecting";
    else if (pValue < 0.05) phase = "significant";
    else phase = "inconclusive";

    return {
        phase,
        slowest,
        minSample,
        leaderName: leader.name,
        leaderId: leader.id,
        lift,
        confidence: (1 - pValue) * 100,
        winnerIsControl: phase === "significant" && lift <= 0,
    };
}

// The one-line verdict strip above the variant cards. Its whole job is to stop
// a founder reading a 6-point gap on 80 visitors as "Variant B wins."
function SignificanceBanner({ verdict }: { verdict: Verdict }) {
    if (verdict.phase === "collecting") {
        const progress = Math.min(1, verdict.slowest / verdict.minSample);
        return (
            <div className="flex flex-col gap-2 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-stone-700 flex items-center gap-2">
                        <LuHourglass className="size-4 text-amber-500" strokeWidth={2} />
                        Too early to compare — still gathering data
                    </p>
                    <span className="text-[11px] text-stone-500 font-robot tabular-nums">
                        {verdict.slowest.toLocaleString()} / {verdict.minSample.toLocaleString()} visitors
                    </span>
                </div>
                <div className="h-1.5 bg-stone-200 rounded-full overflow-hidden">
                    <div
                        className="h-full rounded-full bg-amber-400"
                        style={{ width: `${Math.max(3, progress * 100)}%` }}
                    />
                </div>
                <p className="text-xs text-stone-500 leading-relaxed">
                    Conversion rates this early swing on a handful of visitors. Your agent won&apos;t
                    call a winner until every variant clears {verdict.minSample.toLocaleString()} visitors.
                </p>
            </div>
        );
    }

    if (verdict.phase === "significant" && !verdict.winnerIsControl) {
        return (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                <p className="text-sm font-medium text-emerald-800 flex items-center gap-2">
                    <LuTrophy className="size-4 text-emerald-600" strokeWidth={2} />
                    {verdict.leaderName} is a statistically significant winner
                    <span className="font-normal text-emerald-700">
                        ({verdict.lift > 0 ? "+" : ""}
                        {verdict.lift.toFixed(1)}% lift)
                    </span>
                </p>
                <span className="text-[11px] font-medium text-emerald-700 bg-emerald-100 rounded-full px-2.5 py-1 tabular-nums">
                    {verdict.confidence.toFixed(0)}% confidence
                </span>
            </div>
        );
    }

    if (verdict.phase === "significant" && verdict.winnerIsControl) {
        return (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3">
                <p className="text-sm font-medium text-sky-800 flex items-center gap-2">
                    <LuShield className="size-4 text-sky-600" strokeWidth={2} />
                    The original is holding up — no variant has significantly beaten it
                </p>
                <span className="text-[11px] font-medium text-sky-700 bg-sky-100 rounded-full px-2.5 py-1 tabular-nums">
                    {verdict.confidence.toFixed(0)}% confidence
                </span>
            </div>
        );
    }

    // inconclusive: enough data, but the gap isn't distinguishable from noise
    return (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-stone-200 bg-white px-4 py-3">
            <p className="text-sm font-medium text-stone-700 flex items-center gap-2">
                <LuSearch className="size-4 text-stone-400" strokeWidth={2} />
                No clear winner yet — the difference isn&apos;t statistically significant
            </p>
            <span className="text-[11px] font-medium text-stone-500 bg-stone-100 rounded-full px-2.5 py-1 tabular-nums">
                {verdict.confidence.toFixed(0)}% confidence · need 95%
            </span>
        </div>
    );
}

// The small confidence chip under a challenger's conversion rate. Muted gray
// until the lift is real — never a green number the sample can't back.
function variantSignal(
    variant: ExperimentVariant,
    c: Count,
    controlCounts: Count | null,
    minSample: number,
    slowest: number
): React.ReactNode {
    if (variant.is_control || !controlCounts) return null;
    if (c.exposures === 0 || controlCounts.exposures === 0) return null;

    const controlRate = controlCounts.conversions / controlCounts.exposures;
    const rate = c.conversions / c.exposures;
    const lift = controlRate > 0 ? ((rate - controlRate) / controlRate) * 100 : 0;
    const test = twoProportionZTest(
        controlCounts.conversions,
        controlCounts.exposures,
        c.conversions,
        c.exposures
    );
    const p = test?.p ?? 1;
    const enoughSample = slowest >= minSample;
    const significant = enoughSample && p < 0.05;
    const liftText = `${lift > 0 ? "+" : ""}${lift.toFixed(1)}% vs control`;

    if (significant) {
        const tone = lift > 0 ? "text-emerald-700 bg-emerald-100" : "text-rose-700 bg-rose-100";
        return (
            <span className={`inline-block text-[10px] font-medium rounded-full px-2 py-0.5 mt-1 ${tone}`}>
                {liftText} · significant
            </span>
        );
    }
    return (
        <span className="inline-block text-[10px] font-medium text-stone-400 bg-stone-100 rounded-full px-2 py-0.5 mt-1">
            {liftText} · not yet significant
        </span>
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

    // Significance readout, computed from the same z-test + sample gate the
    // agent uses, so the cards and the agent timeline can never disagree.
    const minSample = Math.max(SAMPLE_FLOOR, experiment.min_sample_size || 0);
    const verdict = readVerdict(variants, counts, experiment.min_sample_size);
    const controlVariant = variants.find((v) => v.is_control) ?? null;
    const controlCounts = controlVariant
        ? counts[controlVariant.id] ?? { exposures: 0, conversions: 0 }
        : null;

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
            <div className="flex flex-col gap-3 px-6 bg-linear-to-t pt-4 from-white to-stone-100 from-60% rounded-xl">
                {/* Single honest verdict on the whole test, so two big rates
                    side-by-side don't get read as a result before they are one. */}
                {verdict && <SignificanceBanner verdict={verdict} />}
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
                                    className={`relative rounded-xl border p-4 flex flex-col gap-3 w-full ${
                                        isWinner ? "border-emerald-300 bg-emerald-50/60" : "border-stone-200 bg-white"
                                    }`}
                                >
                                    <div className="flex items-center justify-between gap-4">
                                        <div className="min-w-0 ">
                                            <div className="text-xs font-medium text-stone-800 flex items-center gap-2">
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
                                            </div>
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
                                            {/* muted until the lift clears the z-test + sample gate */}
                                            {variantSignal(variant, c, controlCounts, minSample, verdict?.slowest ?? 0)}
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
                        No evaluations yet — your agent checks running experiments daily at 9:00 UTC
                        and its decisions will show up here.
                    </p>
                ) : (
                    <div className="bg-white border border-stone-200 rounded-2xl shadow-xs overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="bg-stone-50 border-b border-stone-200">
                                        <th className="text-[11px] font-medium uppercase tracking-wider text-stone-400 px-5 py-3">
                                            Action
                                        </th>
                                        <th className="text-[11px] font-medium uppercase tracking-wider text-stone-400 px-4 py-3">
                                            What happened
                                        </th>
                                        <th className="text-[11px] font-medium uppercase tracking-wider text-stone-400 px-4 py-3 text-right">
                                            Visitors
                                        </th>
                                        <th className="text-[11px] font-medium uppercase tracking-wider text-stone-400 px-4 py-3">
                                            Outcome
                                        </th>
                                        <th className="text-[11px] font-medium uppercase tracking-wider text-stone-400 px-5 py-3 text-right">
                                            When
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-stone-100">
                                    {actions.map((action) => {
                                        const meta = agentActionMeta(action);
                                        const Icon = meta.icon;
                                        const summary = agentActionSummary(action);
                                        const d = (action.detail ?? {}) as Record<string, unknown>;
                                        const stats = Array.isArray(d.stats)
                                            ? (d.stats as { exposures?: number }[])
                                            : null;
                                        const visitors = stats
                                            ? stats.reduce((sum, s) => sum + (s.exposures ?? 0), 0)
                                            : null;
                                        return (
                                            <tr
                                                key={action.id}
                                                className="hover:bg-stone-50/60 transition-colors"
                                            >
                                                {/* Action: icon chip + title */}
                                                <td className="px-5 py-3.5 whitespace-nowrap">
                                                    <div className="flex items-center gap-3">
                                                        <div
                                                            className={`size-8 rounded-lg flex items-center justify-center shrink-0 ${meta.tone}`}
                                                        >
                                                            <Icon className="size-4" strokeWidth={2} />
                                                        </div>
                                                        <span className="text-sm font-medium text-stone-800">
                                                            {meta.title}
                                                        </span>
                                                    </div>
                                                </td>
                                                {/* What happened: the plain-English summary */}
                                                <td className="px-4 py-3.5 min-w-64 max-w-md">
                                                    <p className="text-xs text-stone-500 leading-relaxed line-clamp-2">
                                                        {summary.includes(" — ")
                                                            ? summary.split(" — ").slice(1).join(" — ")
                                                            : summary}
                                                    </p>
                                                </td>
                                                {/* Visitors seen at evaluation time */}
                                                <td className="px-4 py-3.5 text-right whitespace-nowrap">
                                                    {visitors !== null ? (
                                                        <span className="text-sm font-robot font-medium text-stone-700 tabular-nums">
                                                            {visitors.toLocaleString()}
                                                        </span>
                                                    ) : (
                                                        <span className="text-stone-300">—</span>
                                                    )}
                                                </td>
                                                {/* Outcome chip / decision progress */}
                                                <td className="px-4 py-3.5 whitespace-nowrap">
                                                    {actionOutcome(action)}
                                                </td>
                                                {/* When (hover for the exact date) */}
                                                <td
                                                    className="px-5 py-3.5 text-right whitespace-nowrap text-xs text-stone-400"
                                                    title={new Date(action.created_at).toLocaleString()}
                                                >
                                                    {fmtRelative(action.created_at)}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}