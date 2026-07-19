"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useAuth } from "@/services/context/authContext";
import { analyzeUrl, getReports } from "@/lib/reports";
import {
    dismissExperiment,
    getAgentFeed,
    getExperimentEvents,
    getExperimentVariants,
    getExperiments,
    getSites,
    getWeeklyEventCounts,
} from "@/lib/experiments";
import { agentActionSummary } from "@/lib/agentSummary";
import {
    AgentFeedItem,
    Experiment,
    ExperimentVariant,
    Report,
    Site,
} from "@/lib/types";
import {
    LuBan,
    LuChevronRight,
    LuCircleAlert,
    LuFlaskConical,
    LuHourglass,
    LuMousePointerClick,
    LuSearch,
    LuShield,
    LuSparkles,
    LuTrophy,
    LuUsers,
} from "react-icons/lu";
import { IconType } from "react-icons";

import dashboardCta1 from "@/public/assets/dashboard-cta-1-2.svg";
import dashboardCta2 from "@/public/assets/dashboard-cta-2.svg";

type Props = {
    displayName: string;
};

const FEED_PAGE = 6;

// ── Formatting helpers ───────────────────────────────────────────────────────

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
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// hours+minutes until the next daily agent run (9:00 UTC)
function untilNextRun(): string {
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(9, 0, 0, 0);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    const mins = Math.round((next.getTime() - now.getTime()) / 60_000);
    if (mins < 60) return `${mins}m`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

// icon + tone per agent action — the same visual language as the experiment
// page timeline, extended with the circuit-breaker / health actions
function actionMeta(item: AgentFeedItem): { title: string; icon: IconType; tone: string } {
    const detail = (item.detail ?? {}) as Record<string, unknown>;
    if (item.action === "evaluated" && detail.reason === "insufficient_sample") {
        return { title: "Waiting on data", icon: LuHourglass, tone: "bg-amber-100 text-amber-700" };
    }
    switch (item.action) {
        case "promoted_winner":
            return { title: "Promoted a winner", icon: LuTrophy, tone: "bg-emerald-100 text-emerald-700" };
        case "kept_control":
            return { title: "Kept the original", icon: LuShield, tone: "bg-sky-100 text-sky-700" };
        case "killed_variant":
            return { title: "Stopped a losing variant", icon: LuBan, tone: "bg-rose-100 text-rose-700" };
        case "paused_broken":
            return { title: "Paused — needs attention", icon: LuCircleAlert, tone: "bg-amber-100 text-amber-700" };
        case "proposed_experiment":
            return { title: "Proposed a follow-up", icon: LuSparkles, tone: "bg-violet-100 text-violet-700" };
        case "proposal_skipped":
            return { title: "Skipped proposing", icon: LuSparkles, tone: "bg-stone-100 text-stone-600" };
        case "proposal_failed":
            return { title: "Proposal failed", icon: LuCircleAlert, tone: "bg-rose-100 text-rose-700" };
        case "error":
            return { title: "Hit an error", icon: LuCircleAlert, tone: "bg-rose-100 text-rose-700" };
        default:
            return { title: "Checked results", icon: LuSearch, tone: "bg-stone-100 text-stone-600" };
    }
}

// snippet freshness → dot + label (config fetches bump snippet_last_seen_at,
// so any live traffic keeps this under a minute old)
function siteHealth(site: Site): { dot: string; label: string } {
    if (!site.snippet_last_seen_at) {
        return { dot: "bg-stone-300", label: "Waiting for install" };
    }
    const mins = (Date.now() - new Date(site.snippet_last_seen_at).getTime()) / 60_000;
    if (mins < 60) return { dot: "bg-emerald-500", label: `Live · seen ${fmtRelative(site.snippet_last_seen_at)}` };
    if (mins < 24 * 60) return { dot: "bg-amber-500", label: `Quiet · seen ${fmtRelative(site.snippet_last_seen_at)}` };
    return { dot: "bg-rose-500", label: `Not seen since ${fmtRelative(site.snippet_last_seen_at)}` };
}

type VariantCounts = Record<string, { exposures: number; conversions: number }>;
type RunningExperiment = {
    experiment: Experiment;
    variants: ExperimentVariant[];
    counts: VariantCounts;
};

// ── The dashboard home ───────────────────────────────────────────────────────

export default function OverviewSection({ displayName }: Props) {
    const { user } = useAuth();
    const router = useRouter();

    const urlInputRef = useRef<HTMLInputElement>(null);
    const [url, setUrl] = useState("");
    const [analyzing, setAnalyzing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [loading, setLoading] = useState(true);
    const [experiments, setExperiments] = useState<Experiment[]>([]);
    const [running, setRunning] = useState<RunningExperiment[]>([]);
    const [feed, setFeed] = useState<AgentFeedItem[]>([]);
    const [feedDone, setFeedDone] = useState(false);
    const [feedLoading, setFeedLoading] = useState(false);
    const [weekly, setWeekly] = useState({ exposures: 0, conversions: 0 });
    const [sites, setSites] = useState<Site[]>([]);
    const [reports, setReports] = useState<Report[]>([]);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        if (!user) return;
        const [expData, feedData, weeklyData, siteData, reportData] = await Promise.all([
            getExperiments(user.id),
            getAgentFeed(user.id, FEED_PAGE, 0),
            getWeeklyEventCounts(user.id),
            getSites(user.id),
            getReports(user.id),
        ]);

        const exps = Array.isArray(expData) ? (expData as Experiment[]) : [];
        setExperiments(exps);
        if (Array.isArray(feedData)) {
            setFeed(feedData as AgentFeedItem[]);
            setFeedDone(feedData.length < FEED_PAGE);
        }
        if (!("error" in weeklyData)) setWeekly(weeklyData);
        if (Array.isArray(siteData)) setSites(siteData as Site[]);
        if (Array.isArray(reportData)) {
            setReports(
                [...(reportData as Report[])]
                    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                    .slice(0, 2)
            );
        }

        // live numbers for the running/paused experiments (a handful of small
        // queries — fine at dashboard scale)
        const active = exps.filter((e) => e.status === "running" || e.status === "paused").slice(0, 4);
        const detailed = await Promise.all(
            active.map(async (experiment) => {
                const [variantData, eventData] = await Promise.all([
                    getExperimentVariants(experiment.id),
                    getExperimentEvents(experiment.id),
                ]);
                const counts: VariantCounts = {};
                if (Array.isArray(eventData)) {
                    for (const event of eventData) {
                        counts[event.variant_id] ??= { exposures: 0, conversions: 0 };
                        if (event.event_type === "exposure") counts[event.variant_id].exposures++;
                        else if (event.event_type === "conversion") counts[event.variant_id].conversions++;
                    }
                }
                return {
                    experiment,
                    variants: Array.isArray(variantData) ? (variantData as ExperimentVariant[]) : [],
                    counts,
                };
            })
        );
        setRunning(detailed);
        setLoading(false);
    }, [user]);

    useEffect(() => {
        load();
    }, [load]);

    async function handleAnalyze() {
        if (!user || !url.trim() || analyzing) return;
        setAnalyzing(true);
        setError(null);

        const result = await analyzeUrl(url.trim(), user.id);

        if ("error" in result && result.error) {
            setAnalyzing(false);
            setError(result.error);
        } else if ("report_id" in result) {
            router.push(`/dashboard/report/${result.report_id}`);
        }
    }

    async function loadMoreFeed() {
        if (!user || feedLoading) return;
        setFeedLoading(true);
        const more = await getAgentFeed(user.id, FEED_PAGE, feed.length);
        if (Array.isArray(more)) {
            setFeed((prev) => [...prev, ...(more as AgentFeedItem[])]);
            if (more.length < FEED_PAGE) setFeedDone(true);
        }
        setFeedLoading(false);
    }

    async function handleDismissProposal(id: string) {
        setBusy(true);
        await dismissExperiment(id);
        setBusy(false);
        load();
    }

    // ── Derived ──────────────────────────────────────────────────────────────
    const activeCount = experiments.filter((e) => e.status === "running").length;
    const completedCount = experiments.filter((e) => e.status === "completed").length;
    const proposal = experiments.find((e) => e.created_by === "agent" && e.status === "draft");

    return (
        <div className="flex flex-col gap-3">
            
            <div className="flex flex-col gap-y-2">
                <h1 className="three-title font-medium tracking-tight">
                    Let's Get Started, <span className="font-medium text-orange-600">{displayName}</span>
                </h1>
                <p className="text-stone-500">
                    Analyze a page, spin up an experiment, or check on your running tests.
                </p>
            </div>

            {/* Analyze bar — the front door of the whole product */}
            <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                    <input
                        ref={urlInputRef}
                        type="url"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleAnalyze()}
                        placeholder="https://yourstartup.com"
                        disabled={analyzing}
                        className="flex-1 text-sm text-stone-800 bg-stone-50 border border-stone-200 rounded-xl py-3 px-4 focus:outline-none focus:border-orange-600 placeholder:text-stone-400 disabled:opacity-60"
                    />
                    <button
                        onClick={handleAnalyze}
                        disabled={analyzing || !url.trim()}
                        className="text-sm font-medium text-white bg-orange-600 hover:bg-orange-700 disabled:bg-stone-300 disabled:cursor-not-allowed rounded-xl px-6 transition-colors"
                    >
                        {analyzing ? "Analyzing… ~30s" : "Analyze"}
                    </button>
                </div>
                {analyzing && (
                    <p className="text-xs text-stone-500">
                        Crawling the page, taking a screenshot, and running the CRO analysis.
                        You&apos;ll be redirected to the report when it&apos;s ready.
                    </p>
                )}
                {error && <p className="text-xs text-red-600">{error}</p>}
            </div>

            <div className="grid grid-cols-3 gap-3">
                {/* Analyze Page CTA Cards */}
                <button
                    onClick={() => urlInputRef.current?.focus()}
                    className="w-full bg-stone-50 rounded-2xl grid grid-cols-2 relative shadow-xs border border-stone-200 hover:bg-stone-200 hover:border-stone-400 cursor-pointer transition-colors text-left"
                >
                    <div className="p-4 flex flex-col justify-center gap-2 text-left">
                        <h1 className="one-title font-medium tracking-tight ">
                            Run new <br /> Site Analysis
                        </h1>
                        <p className="text-xs text-stone-500">
                            Analyze your page&apos;s funnel top to bottom.
                        </p>
                    </div>
                    <div className="flex justify-center items-end px-4 pt-4">
                        <Image src={dashboardCta1} alt="dashboard cta 1" className="w-full h-full shadow-xs" />
                    </div>
                </button>

                <Link
                    href="/dashboard/analyses"
                    className="w-full bg-stone-50 rounded-2xl grid grid-cols-2 relative shadow-xs border border-stone-200 hover:bg-stone-200 hover:border-stone-400 cursor-pointer transition-colors text-left"
                >
                    <div className="p-4 flex flex-col justify-center gap-2 text-left">
                        <h1 className="one-title font-medium tracking-tight ">
                            Create new <br /> Experiment
                        </h1>
                        <p className="text-xs text-stone-500">
                            Create a new A/B test on your pages.
                        </p>
                    </div>
                    <div className="flex justify-center items-end px-4 pt-4">
                        <Image src={dashboardCta2} alt="dashboard cta 2" className="w-full h-full shadow-xs" />
                    </div>
                </Link>

                <Link
                    href="/dashboard/experiments"
                    className="w-full bg-stone-50 rounded-2xl grid grid-cols-2 relative shadow-xs border border-stone-200 hover:bg-stone-200 hover:border-stone-400 cursor-pointer transition-colors text-left"
                >
                    <div className="p-4 flex flex-col justify-center gap-2 text-left">
                        <h1 className="one-title font-medium tracking-tight ">
                            View your <br /> Experiments
                        </h1>
                        <p className="text-xs text-stone-500">
                            View your experiment analytics and results.
                        </p>
                    </div>
                    <div className="flex justify-center items-end px-4 pt-4">
                        <Image src={dashboardCta1} alt="dashboard cta 3" className="w-full h-full shadow-xs" />
                    </div>
                </Link>
            </div>

            {loading ? (
                <div className="flex flex-col gap-3 animate-pulse mt-2">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {[0, 1, 2, 3].map((i) => (
                            <div key={i} className="h-20 bg-stone-100 rounded-xl" />
                        ))}
                    </div>
                    <div className="grid lg:grid-cols-3 gap-3">
                        <div className="lg:col-span-2 h-80 bg-stone-100 rounded-2xl" />
                        <div className="flex flex-col gap-3">
                            <div className="h-24 bg-stone-100 rounded-xl" />
                            <div className="h-52 bg-stone-100 rounded-xl" />
                        </div>
                    </div>
                </div>
            ) : (
                <>
                    {/* ── Stat tiles (last 7 days) ────────────────────────── */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">
                        <StatTile
                            icon={LuUsers}
                            value={weekly.exposures.toLocaleString()}
                            label="Visitors in tests"
                            sub="last 7 days"
                        />
                        <StatTile
                            icon={LuMousePointerClick}
                            value={weekly.conversions.toLocaleString()}
                            label="Conversions"
                            sub="last 7 days"
                        />
                        <StatTile
                            icon={LuFlaskConical}
                            value={String(activeCount)}
                            label="Active experiments"
                            sub="running right now"
                        />
                        <StatTile
                            icon={LuTrophy}
                            value={String(completedCount)}
                            label="Tests completed"
                            sub="all time"
                        />
                    </div>

                    <div className="grid lg:grid-cols-3 gap-3 items-start">
                        {/* ── Agent card ──────────────────────────────────── */}
                        <div className="lg:col-span-2 bg-white border border-stone-200 rounded-2xl shadow-xs flex flex-col">
                            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-stone-100">
                                <div className="flex items-center gap-2.5">
                                    <span className="relative flex size-2.5">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-60" />
                                        <span className="relative inline-flex rounded-full size-2.5 bg-orange-500" />
                                    </span>
                                    <h2 className="text-sm font-semibold tracking-tight text-stone-800">
                                        Your agent
                                    </h2>
                                </div>
                                <p className="text-[11px] text-stone-400">
                                    Next check in <span className="font-robot font-medium text-stone-600">{untilNextRun()}</span> · daily at 9:00 UTC
                                </p>
                            </div>

                            {/* Pending proposal — the most valuable click on the page */}
                            {proposal && (
                                <div className="mx-4 mt-4 border border-violet-200 bg-violet-50 rounded-xl p-4 flex flex-col gap-2">
                                    <p className="text-[10px] font-medium uppercase tracking-wider text-violet-600">
                                        Proposed next test — waiting on you
                                    </p>
                                    <p className="text-sm font-semibold text-stone-800">{proposal.name}</p>
                                    {proposal.agent_rationale && (
                                        <p className="text-xs text-violet-900/80 leading-relaxed line-clamp-3">
                                            {proposal.agent_rationale}
                                        </p>
                                    )}
                                    <div className="flex items-center gap-2 pt-1">
                                        <Link
                                            href={`/dashboard/experiments/${proposal.id}`}
                                            className="text-xs font-medium text-white bg-orange-600 hover:bg-orange-700 rounded-lg px-4 py-2 transition-colors"
                                        >
                                            Review &amp; activate
                                        </Link>
                                        <button
                                            onClick={() => handleDismissProposal(proposal.id)}
                                            disabled={busy}
                                            className="text-xs font-medium text-stone-500 hover:text-red-600 rounded-lg px-3 py-2 transition-colors disabled:opacity-50 cursor-pointer"
                                        >
                                            Dismiss
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Activity feed — every decision, all experiments */}
                            {feed.length === 0 ? (
                                <div className="m-4 flex flex-col items-center gap-1.5 bg-stone-50 border border-dashed border-stone-200 rounded-xl py-10 text-center">
                                    <p className="text-xs font-medium text-stone-500">No agent activity yet</p>
                                    <p className="text-[11px] text-stone-400 max-w-xs leading-relaxed">
                                        Activate an experiment and your agent starts checking it daily —
                                        every decision it makes shows up here.
                                    </p>
                                </div>
                            ) : (
                                <div className="flex flex-col px-2 py-2">
                                    {feed.map((item) => {
                                        const meta = actionMeta(item);
                                        const Icon = meta.icon;
                                        const summary = agentActionSummary(item);
                                        return (
                                            <Link
                                                key={item.id}
                                                href={`/dashboard/experiments/${item.experiments.id}`}
                                                className="group flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-stone-50 transition-colors"
                                            >
                                                <div className={`size-8 rounded-lg flex items-center justify-center shrink-0 ${meta.tone}`}>
                                                    <Icon className="size-4" strokeWidth={2} />
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <p className="text-sm text-stone-800 leading-snug truncate">
                                                        <span className="font-medium">{meta.title}</span>
                                                        <span className="text-stone-400"> · {item.experiments.name}</span>
                                                    </p>
                                                    <p className="text-xs text-stone-500 truncate">
                                                        {summary.includes(" — ")
                                                            ? summary.split(" — ").slice(1).join(" — ")
                                                            : summary}
                                                    </p>
                                                </div>
                                                <div className="flex items-center gap-1.5 shrink-0">
                                                    <span className="text-[11px] text-stone-400 tabular-nums">
                                                        {fmtRelative(item.created_at)}
                                                    </span>
                                                    <LuChevronRight className="size-3.5 text-stone-300 group-hover:text-stone-500 transition-colors" />
                                                </div>
                                            </Link>
                                        );
                                    })}
                                    {!feedDone && (
                                        <button
                                            onClick={loadMoreFeed}
                                            disabled={feedLoading}
                                            className="mx-3 my-2 text-xs font-medium text-stone-500 hover:text-stone-700 bg-stone-50 hover:bg-stone-100 border border-stone-200 rounded-lg py-2 transition-colors disabled:opacity-50 cursor-pointer"
                                        >
                                            {feedLoading ? "Loading…" : "Show older activity"}
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* ── Right column: snippet health + recent analyses ── */}
                        <div className="flex flex-col gap-3">
                            <div className="bg-white border border-stone-200 rounded-2xl shadow-xs p-4 flex flex-col gap-3">
                                <h2 className="text-sm font-semibold tracking-tight text-stone-800">
                                    Snippet health
                                </h2>
                                {sites.length === 0 ? (
                                    <p className="text-[11px] text-stone-400 leading-relaxed">
                                        No sites yet — activate an experiment to get your install snippet.
                                    </p>
                                ) : (
                                    <div className="flex flex-col gap-2.5">
                                        {sites.map((site) => {
                                            const health = siteHealth(site);
                                            return (
                                                <div key={site.id} className="flex items-center gap-2.5 min-w-0">
                                                    <span className={`size-2 rounded-full shrink-0 ${health.dot}`} />
                                                    <span className="text-xs font-medium text-stone-700 truncate">
                                                        {site.domain}
                                                    </span>
                                                    <span className="text-[11px] text-stone-400 ml-auto shrink-0">
                                                        {health.label}
                                                    </span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            <div className="bg-white border border-stone-200 rounded-2xl shadow-xs p-4 flex flex-col gap-3">
                                <div className="flex items-center justify-between">
                                    <h2 className="text-sm font-semibold tracking-tight text-stone-800">
                                        Recent analyses
                                    </h2>
                                    <Link
                                        href="/dashboard/analyses"
                                        className="text-[11px] font-medium text-orange-600 hover:text-orange-700 transition-colors"
                                    >
                                        View all
                                    </Link>
                                </div>
                                {reports.length === 0 ? (
                                    <p className="text-[11px] text-stone-400 leading-relaxed">
                                        Nothing analyzed yet — paste a URL up top and the agent takes it
                                        from there.
                                    </p>
                                ) : (
                                    <div className="flex flex-col gap-2">
                                        {reports.map((report) => (
                                            <Link
                                                key={report.id}
                                                href={`/dashboard/report/${report.id}`}
                                                className="group flex items-center gap-3 rounded-xl border border-stone-100 hover:border-stone-200 hover:bg-stone-50 p-2 transition-colors"
                                            >
                                                <div className="w-16 h-12 bg-stone-100 rounded-lg overflow-hidden shrink-0">
                                                    {report.screenshot_url && (
                                                        // eslint-disable-next-line @next/next/no-img-element
                                                        <img
                                                            src={report.screenshot_url}
                                                            alt={report.url}
                                                            className="w-full h-full object-cover object-top"
                                                        />
                                                    )}
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <p className="text-xs font-medium text-stone-700 truncate">
                                                        {report.url.replace(/^https?:\/\//, "")}
                                                    </p>
                                                    <p className="text-[11px] text-stone-400">
                                                        {report.overall_score !== null
                                                            ? `Score ${report.overall_score}/10 · `
                                                            : ""}
                                                        {fmtRelative(report.created_at)}
                                                    </p>
                                                </div>
                                                <LuChevronRight className="size-3.5 text-stone-300 group-hover:text-stone-500 transition-colors shrink-0" />
                                            </Link>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* ── Running experiments ─────────────────────────────── */}
                    <div className="flex flex-col gap-3 mt-1">
                        <div className="flex items-center justify-between">
                            <h2 className="one-title font-medium tracking-tight text-stone-800">
                                Running experiments
                            </h2>
                            <Link
                                href="/dashboard/experiments"
                                className="text-[11px] font-medium text-orange-600 hover:text-orange-700 transition-colors"
                            >
                                View all
                            </Link>
                        </div>
                        {running.length === 0 ? (
                            <div className="flex flex-col items-center gap-2 bg-stone-50 border border-dashed border-stone-300 rounded-2xl py-12 text-center">
                                <p className="text-sm font-medium text-stone-600">Nothing running yet</p>
                                <p className="text-xs text-stone-500 max-w-sm leading-relaxed">
                                    Activate a draft from your experiments list — or analyze a page and
                                    let the agent suggest what to test first.
                                </p>
                            </div>
                        ) : (
                            <div className="grid sm:grid-cols-2 gap-3">
                                {running.map((item) => (
                                    <RunningExperimentCard key={item.experiment.id} item={item} />
                                ))}
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function StatTile({
    icon: Icon,
    value,
    label,
    sub,
}: {
    icon: IconType;
    value: string;
    label: string;
    sub: string;
}) {
    return (
        <div className="bg-white border border-stone-200 rounded-xl shadow-xs p-4 flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-stone-400">
                <Icon className="size-3.5" strokeWidth={2} />
                <span className="text-[11px] font-medium">{label}</span>
            </div>
            <p className="font-robot font-semibold text-2xl text-stone-800 tabular-nums leading-tight">
                {value}
            </p>
            <p className="text-[11px] text-stone-400">{sub}</p>
        </div>
    );
}

function RunningExperimentCard({ item }: { item: RunningExperiment }) {
    const { experiment, variants, counts } = item;

    const rateOf = (id: string) => {
        const c = counts[id] ?? { exposures: 0, conversions: 0 };
        return c.exposures > 0 ? c.conversions / c.exposures : 0;
    };
    const control = variants.find((v) => v.is_control);
    const controlRate = control ? rateOf(control.id) : 0;
    const live = variants.filter((v) => !v.killed_at);
    const bestRate = Math.max(...live.map((v) => rateOf(v.id)), 0);

    // progress toward the agent's decision point: the slowest live arm vs the
    // (floored) min sample the evaluator enforces
    const minSample = Math.max(100, experiment.min_sample_size ?? 1000);
    const slowest = live.length
        ? Math.min(...live.map((v) => (counts[v.id] ?? { exposures: 0 }).exposures))
        : 0;
    const progress = Math.min(1, slowest / minSample);

    return (
        <Link
            href={`/dashboard/experiments/${experiment.id}`}
            className="group bg-white border border-stone-200 hover:border-stone-300 rounded-2xl shadow-xs p-4 flex flex-col gap-3 transition-colors"
        >
            <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold tracking-tight text-stone-800 truncate">
                    {experiment.name}
                </p>
                {experiment.status === "paused" ? (
                    <span className="text-[10px] font-medium text-amber-700 bg-amber-100 rounded-full px-2 py-0.5 shrink-0">
                        Paused
                    </span>
                ) : (
                    <span className="flex items-center gap-1.5 text-[10px] font-medium text-orange-700 bg-orange-100 rounded-full px-2 py-0.5 shrink-0">
                        <span className="size-1.5 rounded-full bg-orange-500" />
                        Running
                    </span>
                )}
            </div>

            <div className="flex flex-col gap-2">
                {variants.map((variant) => {
                    const rate = rateOf(variant.id);
                    const killed = !!variant.killed_at;
                    const leader = !killed && rate > 0 && rate === bestRate;
                    const lift =
                        !variant.is_control && controlRate > 0
                            ? (rate - controlRate) / controlRate
                            : null;
                    return (
                        <div key={variant.id} className="flex items-center gap-3">
                            <span
                                className={`text-xs w-20 shrink-0 truncate ${
                                    killed ? "text-stone-300 line-through" : "text-stone-500"
                                }`}
                            >
                                {variant.name}
                            </span>
                            <div className="flex-1 h-1.5 bg-stone-100 rounded-full overflow-hidden">
                                <div
                                    className={`h-full rounded-full ${
                                        killed ? "bg-stone-200" : leader ? "bg-orange-500" : "bg-stone-300"
                                    }`}
                                    style={{
                                        width: `${bestRate > 0 ? Math.max(rate === 0 ? 0 : 4, (rate / bestRate) * 100) : 0}%`,
                                    }}
                                />
                            </div>
                            {killed ? (
                                <span className="text-[10px] text-stone-400 w-24 text-right shrink-0">
                                    stopped by agent
                                </span>
                            ) : (
                                <span className="text-xs w-24 text-right shrink-0 tabular-nums">
                                    <span className="font-robot font-semibold text-stone-800">
                                        {(rate * 100).toFixed(1)}%
                                    </span>
                                    {lift !== null && (
                                        <span
                                            className={`ml-1 text-[10px] ${
                                                lift >= 0 ? "text-emerald-600" : "text-rose-500"
                                            }`}
                                        >
                                            {lift >= 0 ? "+" : ""}
                                            {(lift * 100).toFixed(0)}%
                                        </span>
                                    )}
                                </span>
                            )}
                        </div>
                    );
                })}
            </div>

            <div className="flex flex-col gap-1.5 pt-1 border-t border-stone-100">
                <div className="flex items-center justify-between text-[11px] text-stone-400">
                    <span>
                        {progress >= 1
                            ? "Decision-ready — agent checks daily at 9:00 UTC"
                            : `${slowest.toLocaleString()} of ${minSample.toLocaleString()} visitors to a decision`}
                    </span>
                    <span className="font-robot tabular-nums">{Math.round(progress * 100)}%</span>
                </div>
                <div className="h-1 bg-stone-100 rounded-full overflow-hidden">
                    <div
                        className={`h-full rounded-full ${progress >= 1 ? "bg-emerald-500" : "bg-stone-300"}`}
                        style={{ width: `${Math.max(2, progress * 100)}%` }}
                    />
                </div>
            </div>
        </Link>
    );
}
