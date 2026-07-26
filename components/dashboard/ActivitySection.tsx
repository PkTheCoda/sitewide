"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/services/context/authContext";
import { getAgentFeed } from "@/lib/experiments";
import { agentActionSummary } from "@/lib/agentSummary";
import { AgentFeedItem } from "@/lib/types";
import {
    LuBan,
    LuChevronDown,
    LuChevronRight,
    LuCircleAlert,
    LuHourglass,
    LuSearch,
    LuShield,
    LuSparkles,
    LuTrophy,
} from "react-icons/lu";
import { IconType } from "react-icons";

const PAGE = 40;
// Consecutive identical events at or above this count collapse into one
// expandable node — keeps a wall of "Waiting on data" from burying real moves.
const COMPACT_MIN = 3;

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

function fmtTime(iso: string): string {
    return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

// Local-day bucket key + the human label shown on a divider.
function dayKey(iso: string): string {
    const d = new Date(iso);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
function dayLabel(iso: string): string {
    const d = new Date(iso);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    const nice = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    if (dayKey(iso) === dayKey(today.toISOString())) return `Today · ${nice}`;
    if (dayKey(iso) === dayKey(yesterday.toISOString())) return `Yesterday · ${nice}`;
    if (d.getFullYear() !== today.getFullYear()) {
        return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
    }
    return nice;
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

// icon + tone per agent action — the same visual language as the overview feed
// and the per-experiment timeline.
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

// The overview feed trims the leading title from the summary (it's already the
// row's headline). Same trick here so the description line reads cleanly.
function summaryTail(item: AgentFeedItem): string {
    const summary = agentActionSummary(item);
    return summary.includes(" — ") ? summary.split(" — ").slice(1).join(" — ") : summary;
}

// ── Filter categories ────────────────────────────────────────────────────────

type CatKey = "winners" | "decisions" | "checks" | "waiting" | "proposals" | "issues";
const CATEGORIES: { key: CatKey; label: string; match: (a: AgentFeedItem) => boolean }[] = [
    { key: "winners", label: "Winners", match: (a) => a.action === "promoted_winner" },
    {
        key: "decisions",
        label: "Decisions",
        match: (a) => a.action === "kept_control" || a.action === "killed_variant" || a.action === "paused_broken",
    },
    {
        key: "checks",
        label: "Checks",
        match: (a) => a.action === "evaluated" && (a.detail as Record<string, unknown> | null)?.reason !== "insufficient_sample",
    },
    {
        key: "waiting",
        label: "Waiting",
        match: (a) => a.action === "evaluated" && (a.detail as Record<string, unknown> | null)?.reason === "insufficient_sample",
    },
    {
        key: "proposals",
        label: "Proposals",
        match: (a) => a.action === "proposed_experiment" || a.action === "proposal_skipped" || a.action === "proposal_failed",
    },
    { key: "issues", label: "Issues", match: (a) => a.action === "error" || a.action === "proposal_failed" },
];

// Consecutive-run grouping key: everything of the same action folds together,
// and "waiting on data" is split out from ordinary checks (both are `evaluated`).
function groupKey(item: AgentFeedItem): string {
    const d = (item.detail ?? {}) as Record<string, unknown>;
    if (item.action === "evaluated" && d.reason === "insufficient_sample") return "waiting";
    return item.action;
}

type Unit =
    | { type: "single"; id: number; item: AgentFeedItem }
    | { type: "group"; id: number; items: AgentFeedItem[] };

// Collapse runs of COMPACT_MIN+ identical consecutive events into one unit.
function buildUnits(items: AgentFeedItem[]): Unit[] {
    const units: Unit[] = [];
    let i = 0;
    while (i < items.length) {
        const key = groupKey(items[i]);
        let j = i + 1;
        while (j < items.length && groupKey(items[j]) === key) j++;
        const run = items.slice(i, j);
        if (run.length >= COMPACT_MIN) {
            units.push({ type: "group", id: run[0].id, items: run });
        } else {
            for (const it of run) units.push({ type: "single", id: it.id, item: it });
        }
        i = j;
    }
    return units;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ActivitySection() {
    const { user } = useAuth();

    const [feed, setFeed] = useState<AgentFeedItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [done, setDone] = useState(false);
    const [filter, setFilter] = useState<"all" | CatKey>("all");
    const [expanded, setExpanded] = useState<Set<number>>(new Set());

    const load = useCallback(async () => {
        if (!user) return;
        const data = await getAgentFeed(user.id, PAGE, 0);
        if (Array.isArray(data)) {
            setFeed(data as AgentFeedItem[]);
            setDone(data.length < PAGE);
        }
        setLoading(false);
    }, [user]);

    useEffect(() => {
        load();
    }, [load]);

    async function loadMore() {
        if (!user || loadingMore) return;
        setLoadingMore(true);
        const more = await getAgentFeed(user.id, PAGE, feed.length);
        if (Array.isArray(more)) {
            setFeed((prev) => [...prev, ...(more as AgentFeedItem[])]);
            if (more.length < PAGE) setDone(true);
        }
        setLoadingMore(false);
    }

    function toggle(id: number) {
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }

    // counts drive the filter pills (from everything loaded)
    const counts = useMemo(() => {
        const map: Record<string, number> = {};
        for (const cat of CATEGORIES) map[cat.key] = 0;
        for (const item of feed) for (const cat of CATEGORIES) if (cat.match(item)) map[cat.key]++;
        return map;
    }, [feed]);

    const filtered = useMemo(() => {
        if (filter === "all") return feed;
        const cat = CATEGORIES.find((c) => c.key === filter);
        return cat ? feed.filter(cat.match) : feed;
    }, [feed, filter]);

    // group the filtered feed into local days, preserving newest-first order
    const days = useMemo(() => {
        const out: { key: string; label: string; items: AgentFeedItem[] }[] = [];
        for (const item of filtered) {
            const k = dayKey(item.created_at);
            const last = out[out.length - 1];
            if (last && last.key === k) last.items.push(item);
            else out.push({ key: k, label: dayLabel(item.created_at), items: [item] });
        }
        return out;
    }, [filtered]);

    return (
        <div className="flex flex-col gap-4">
            {/* Heading */}
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-col gap-y-1">
                    <h2 className="two-title tracking-tight font-medium">Agent activity</h2>
                    <p className="text-sm text-stone-500">
                        Every decision your agent has made, across all of your experiments.
                    </p>
                </div>
                <div className="flex items-center gap-2.5 bg-white border border-stone-200 rounded-full pl-3 pr-2 py-1.5 shadow-xs shrink-0">
                    <span className="relative flex size-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-60" />
                        <span className="relative inline-flex rounded-full size-2.5 bg-orange-500" />
                    </span>
                    <span className="text-xs text-stone-500">Next check in</span>
                    <span className="font-robot font-semibold text-xs text-stone-700 bg-stone-100 px-2 rounded-md py-0.5">
                        {untilNextRun()}
                    </span>
                </div>
            </div>

            {/* Filter pills */}
            <div className="flex flex-wrap items-center gap-2">
                <FilterPill label="All" count={feed.length} active={filter === "all"} onClick={() => setFilter("all")} />
                {CATEGORIES.filter((c) => counts[c.key] > 0).map((c) => (
                    <FilterPill
                        key={c.key}
                        label={c.label}
                        count={counts[c.key]}
                        active={filter === c.key}
                        onClick={() => setFilter(c.key)}
                    />
                ))}
            </div>

            {/* Timeline */}
            {loading ? (
                <div className="flex flex-col gap-4 animate-pulse mt-2">
                    {[0, 1, 2, 3, 4].map((i) => (
                        <div key={i} className="flex gap-4">
                            <div className="size-9 rounded-full bg-stone-100 shrink-0" />
                            <div className="flex-1 flex flex-col gap-2 pb-2">
                                <div className="h-3.5 bg-stone-100 rounded w-1/3" />
                                <div className="h-3 bg-stone-100 rounded w-2/3" />
                            </div>
                        </div>
                    ))}
                </div>
            ) : feed.length === 0 ? (
                <div className="flex flex-col items-center gap-1.5 bg-stone-50 border border-dashed border-stone-300 rounded-2xl py-16 text-center mt-2">
                    <p className="text-sm font-medium text-stone-600">No agent activity yet</p>
                    <p className="text-xs text-stone-500 max-w-sm leading-relaxed">
                        Activate an experiment and your agent starts checking it daily at 9:00 UTC —
                        every decision it makes shows up here.
                    </p>
                    <Link
                        href="/dashboard/experiments"
                        className="mt-2 text-xs font-medium text-white bg-orange-600 hover:bg-orange-700 rounded-lg px-4 py-2 transition-colors"
                    >
                        Go to experiments
                    </Link>
                </div>
            ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center gap-1.5 bg-stone-50 border border-dashed border-stone-300 rounded-2xl py-14 text-center mt-2">
                    <p className="text-sm font-medium text-stone-600">Nothing in this filter</p>
                    <p className="text-xs text-stone-500">Try another category, or switch back to “All”.</p>
                </div>
            ) : (
                <div className="flex flex-col gap-6 mt-1">
                    {days.map((day) => {
                        const units = buildUnits(day.items);
                        return (
                            <div key={day.key} className="flex flex-col gap-3">
                                {/* Day divider */}
                                <div className="flex items-center gap-3">
                                    <span className="text-[11px] font-medium tracking-wide text-stone-500 bg-stone-100 rounded-full px-2.5 py-1">
                                        {day.label}
                                    </span>
                                    <span className="h-px flex-1 bg-stone-100" />
                                </div>

                                {/* Timeline rows (with the connecting spine) */}
                                <div className="relative">
                                    <span className="absolute left-[17px] top-3 bottom-3 w-px bg-stone-200" aria-hidden />
                                    <div className="flex flex-col">
                                        {units.map((unit) =>
                                            unit.type === "single" ? (
                                                <TimelineRow key={unit.id} item={unit.item} />
                                            ) : (
                                                <CompactRow
                                                    key={unit.id}
                                                    items={unit.items}
                                                    open={expanded.has(unit.id)}
                                                    onToggle={() => toggle(unit.id)}
                                                />
                                            )
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}

                    {!done && (
                        <button
                            onClick={loadMore}
                            disabled={loadingMore}
                            className="self-center text-xs font-medium text-stone-500 hover:text-stone-700 bg-stone-50 hover:bg-stone-100 border border-stone-200 rounded-lg px-5 py-2.5 transition-colors disabled:opacity-50 cursor-pointer"
                        >
                            {loadingMore ? "Loading…" : "Show older activity"}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function FilterPill({
    label,
    count,
    active,
    onClick,
}: {
    label: string;
    count: number;
    active: boolean;
    onClick: () => void;
}) {
    return (
        <button
            onClick={onClick}
            className={`flex items-center gap-1.5 text-xs font-medium rounded-lg pl-3 pr-2 py-1.5 border transition-colors cursor-pointer ${
                active
                    ? "bg-stone-800 border-stone-800 text-white"
                    : "bg-white border-stone-200 text-stone-600 hover:bg-stone-50 hover:border-stone-300"
            }`}
        >
            {label}
            <span
                className={`tabular-nums text-[11px] rounded-md px-1.5 py-0.5 ${
                    active ? "bg-white/20 text-white" : "bg-stone-100 text-stone-500"
                }`}
            >
                {count}
            </span>
        </button>
    );
}

function TimelineRow({ item }: { item: AgentFeedItem }) {
    const meta = actionMeta(item);
    const Icon = meta.icon;
    return (
        <Link
            href={`/dashboard/experiments/${item.experiments.id}`}
            className="group relative flex gap-4 rounded-xl px-2 py-2.5 -mx-2 hover:bg-stone-50 transition-colors"
        >
            <div className={`relative z-10 size-9 rounded-full flex items-center justify-center shrink-0 ring-4 ring-white ${meta.tone}`}>
                <Icon className="size-4" strokeWidth={2} />
            </div>
            <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                    <p className="text-sm text-stone-800 leading-snug min-w-0 truncate">
                        <span className="font-medium">{meta.title}</span>
                        <span className="text-stone-400"> · {item.experiments.name}</span>
                    </p>
                    <span className="text-[11px] text-stone-400 tabular-nums shrink-0">
                        {fmtRelative(item.created_at)}
                    </span>
                </div>
                <p className="text-xs text-stone-500 mt-1 leading-relaxed line-clamp-2">{summaryTail(item)}</p>
            </div>
            <LuChevronRight className="self-center size-4 text-stone-300 group-hover:text-stone-500 transition-colors shrink-0" />
        </Link>
    );
}

function CompactRow({
    items,
    open,
    onToggle,
}: {
    items: AgentFeedItem[];
    open: boolean;
    onToggle: () => void;
}) {
    const meta = actionMeta(items[0]);
    const Icon = meta.icon;
    const newest = items[0];
    const oldest = items[items.length - 1];
    const uniqueExps = new Set(items.map((i) => i.experiments.id));
    const scope =
        uniqueExps.size === 1 ? newest.experiments.name : `${uniqueExps.size} experiments`;

    return (
        <div className="relative">
            <button
                onClick={onToggle}
                className="group w-full relative flex gap-4 rounded-xl px-2 py-2.5 -mx-2 hover:bg-stone-50 transition-colors text-left"
            >
                {/* stacked node with a count badge */}
                <div className="relative z-10 shrink-0">
                    <div className="absolute -bottom-1 left-1 right-1 h-9 rounded-full bg-stone-100 ring-4 ring-white" aria-hidden />
                    <div className={`relative size-9 rounded-full flex items-center justify-center ring-4 ring-white ${meta.tone}`}>
                        <Icon className="size-4" strokeWidth={2} />
                    </div>
                    <span className="absolute -bottom-1.5 -right-1.5 min-w-4 h-4 px-1 rounded-full bg-stone-800 text-white text-[10px] font-semibold flex items-center justify-center ring-2 ring-white tabular-nums">
                        {items.length}
                    </span>
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                        <p className="text-sm text-stone-800 leading-snug min-w-0 truncate">
                            <span className="font-medium">{meta.title}</span>
                            <span className="text-stone-400"> · {items.length} times</span>
                        </p>
                        <span className="text-[11px] text-stone-400 tabular-nums shrink-0">
                            {fmtRelative(newest.created_at)}
                        </span>
                    </div>
                    <p className="text-xs text-stone-500 mt-1 leading-relaxed">
                        {scope} · {fmtRelative(oldest.created_at)} → {fmtRelative(newest.created_at)}
                    </p>
                </div>
                <LuChevronDown
                    className={`self-center size-4 text-stone-400 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
                />
            </button>

            {open && (
                <div className="ml-[34px] mt-1 mb-1 pl-4 border-l border-stone-200 flex flex-col gap-3 py-1">
                    {items.map((item) => (
                        <Link
                            key={item.id}
                            href={`/dashboard/experiments/${item.experiments.id}`}
                            className="group flex items-start gap-3 rounded-lg px-2 py-1.5 -mx-2 hover:bg-stone-50 transition-colors"
                        >
                            <span className={`mt-1 size-2 rounded-full shrink-0 ${meta.tone.split(" ")[0]}`} />
                            <div className="min-w-0 flex-1">
                                <div className="flex items-baseline justify-between gap-3">
                                    <p className="text-xs text-stone-600 truncate min-w-0">{item.experiments.name}</p>
                                    <span className="text-[11px] text-stone-400 tabular-nums shrink-0">
                                        {fmtTime(item.created_at)}
                                    </span>
                                </div>
                                <p className="text-[11px] text-stone-400 mt-0.5 leading-relaxed line-clamp-1">
                                    {summaryTail(item)}
                                </p>
                            </div>
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
}
