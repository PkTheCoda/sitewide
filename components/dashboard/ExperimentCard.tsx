"use client";

import { useState } from "react";
import {
    activateExperiment,
    getExperimentEvents,
    getExperimentVariants,
    pauseExperiment,
} from "@/lib/experiments";
import { Experiment, ExperimentVariant, VariantPayload } from "@/lib/types";
import { buildPreviewLink } from "@/lib/preview";
import StatusBadge from "./StatusBadge";
import SnippetInstructions from "./SnippetInstructions";
import { LuChevronDown, LuChevronUp } from "react-icons/lu";

const CHANGE_LABEL: Record<string, string> = {
    text: "Text",
    style: "Style",
    hide: "Hide",
    image: "Image",
};

function payloadSummary(payload: VariantPayload): string {
    if (!payload) return "Original (unchanged)";
    if ("text" in payload) return `“${payload.text}”`;
    if ("textParts" in payload) return `“${payload.textParts.filter(Boolean).join(" ")}”`;
    if ("src" in payload) return payload.src;
    if ("hide" in payload) return "Element hidden";
    if ("styles" in payload)
        return Object.entries(payload.styles)
            .map(([k, v]) => `${k}: ${v}`)
            .join(" · ");
    return "—";
}

type VariantCounts = Record<string, { exposures: number; conversions: number }>;

type Props = {
    experiment: Experiment;
    onChanged: () => void; // parent refetches the list after activate/pause
};

// One collapsible row in the Experiments section.
// Collapsed: name + status + one-line summary.
// Expanded:  hypothesis, per-variant live results, and lifecycle actions
//            (Activate/Resume for drafts+paused, Pause for running).
// Variants and events are fetched lazily on first expand — the list stays
// cheap no matter how many experiments exist.
export default function ExperimentCard({ experiment, onChanged }: Props) {
    const [expanded, setExpanded] = useState(false);
    const [variants, setVariants] = useState<ExperimentVariant[] | null>(null);
    const [counts, setCounts] = useState<VariantCounts>({});
    const [siteId, setSiteId] = useState<string | null>(experiment.site_id);
    const [showSnippet, setShowSnippet] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    let pagePath = experiment.page_url;
    try {
        pagePath = new URL(experiment.page_url).hostname + new URL(experiment.page_url).pathname;
    } catch {
        /* show raw url */
    }

    const goalLabel =
        experiment.goal_type === "click"
            ? "Goal: click on target element"
            : `Goal: visit ${experiment.goal_page_path}`;

    async function toggleExpand() {
        const next = !expanded;
        setExpanded(next);
        if (next && variants === null) {
            const [variantData, eventData] = await Promise.all([
                getExperimentVariants(experiment.id),
                getExperimentEvents(experiment.id),
            ]);
            if (Array.isArray(variantData)) setVariants(variantData as ExperimentVariant[]);
            if (Array.isArray(eventData)) {
                // Events arrive as raw rows (one per visitor per event type,
                // deduped by the DB) — tally them into per-variant counts here.
                const agg: VariantCounts = {};
                for (const event of eventData) {
                    agg[event.variant_id] ??= { exposures: 0, conversions: 0 };
                    if (event.event_type === "exposure") agg[event.variant_id].exposures++;
                    else agg[event.variant_id].conversions++;
                }
                setCounts(agg);
            }
        }
    }

    // Activate does three things (see lib/experiments.ts): finds-or-creates the
    // sites row for this domain, links it, flips status to running. We then
    // show the install snippet, because a running experiment does nothing until
    // the founder's site actually loads the snippet.
    async function handleActivate() {
        setBusy(true);
        setError(null);
        const result = await activateExperiment(experiment);
        setBusy(false);
        if ("error" in result && result.error) {
            setError(result.error);
        } else if ("site_id" in result && result.site_id) {
            setSiteId(result.site_id);
            setShowSnippet(true);
            onChanged();
        }
    }

    async function handlePause() {
        setBusy(true);
        setError(null);
        const result = await pauseExperiment(experiment.id);
        setBusy(false);
        if ("error" in result && result.error) setError(result.error);
        else onChanged();
    }

    return (
        <div className="bg-white border border-stone-200 rounded-xl shadow-xs overflow-hidden">
            {/* header row */}
            <button
                onClick={toggleExpand}
                className="w-full flex items-center gap-3 p-4 text-left hover:bg-stone-50 transition-colors"
            >
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <h3 className="text-sm font-medium text-stone-800 truncate">
                            {experiment.name}
                        </h3>
                        <StatusBadge status={experiment.status} />
                    </div>
                    <p className="text-xs text-stone-500 mt-0.5 truncate">
                        {pagePath} · {CHANGE_LABEL[experiment.change_type] ?? experiment.change_type} test
                        · {goalLabel}
                    </p>
                </div>
                <span className="text-[11px] text-stone-400 shrink-0">
                    {new Date(experiment.created_at).toLocaleDateString()}
                </span>
                {expanded ? (
                    <LuChevronUp className="size-4 text-stone-400 shrink-0" />
                ) : (
                    <LuChevronDown className="size-4 text-stone-400 shrink-0" />
                )}
            </button>

            {expanded && (
                <div className="border-t border-stone-200 p-4 flex flex-col gap-4">
                    {experiment.hypothesis && (
                        <p className="text-xs text-stone-600 leading-relaxed bg-stone-50 border border-stone-200 rounded-lg p-3">
                            <span className="font-medium text-stone-700">Hypothesis: </span>
                            {experiment.hypothesis}
                        </p>
                    )}

                    {/* variants + live results */}
                    <div className="flex flex-col gap-2">
                        {variants === null ? (
                            <p className="text-xs text-stone-400">Loading variants…</p>
                        ) : (
                            variants.map((variant) => {
                                const c = counts[variant.id] ?? { exposures: 0, conversions: 0 };
                                const rate = c.exposures > 0 ? (c.conversions / c.exposures) * 100 : 0;
                                const isWinner = experiment.winner_variant_id === variant.id;
                                // Works at ANY status (even drafts) — the change is
                                // encoded in the link, not served by the config route.
                                const previewUrl = buildPreviewLink(
                                    experiment.page_url,
                                    experiment.selector,
                                    experiment.selector_fallback,
                                    variant.payload
                                );
                                return (
                                    <div
                                        key={variant.id}
                                        className={`flex items-center gap-3 rounded-lg border p-3 ${
                                            isWinner
                                                ? "border-emerald-300 bg-emerald-50"
                                                : "border-stone-200 bg-white"
                                        }`}
                                    >
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs font-medium text-stone-700">
                                                {variant.name}
                                                {variant.is_control && (
                                                    <span className="text-stone-400 font-normal"> · original</span>
                                                )}
                                                {isWinner && (
                                                    <span className="text-emerald-700"> · winner 🏆</span>
                                                )}
                                            </p>
                                            <p className="text-[11px] text-stone-500 truncate mt-0.5">
                                                {payloadSummary(variant.payload)}
                                            </p>
                                            {previewUrl && (
                                                <a
                                                    href={previewUrl}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="inline-block text-[11px] text-orange-600 hover:text-orange-700 mt-1 transition-colors"
                                                >
                                                    Preview on your site ↗
                                                </a>
                                            )}
                                        </div>
                                        <div className="text-right shrink-0">
                                            <p className="text-xs font-medium text-stone-700">
                                                {rate.toFixed(1)}%
                                            </p>
                                            <p className="text-[11px] text-stone-400">
                                                {c.conversions}/{c.exposures} visitors
                                            </p>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>

                    {showSnippet && siteId && <SnippetInstructions siteId={siteId} />}

                    {error && <p className="text-xs text-red-600">{error}</p>}

                    {/* actions */}
                    <div className="flex items-center gap-2">
                        {(experiment.status === "draft" || experiment.status === "paused") && (
                            <button
                                onClick={handleActivate}
                                disabled={busy}
                                className="text-xs font-medium text-white bg-orange-600 hover:bg-orange-700 disabled:bg-stone-300 rounded-lg px-4 py-2 transition-colors"
                            >
                                {busy ? "Working…" : experiment.status === "paused" ? "Resume" : "Activate"}
                            </button>
                        )}
                        {experiment.status === "running" && (
                            <>
                                <button
                                    onClick={handlePause}
                                    disabled={busy}
                                    className="text-xs font-medium text-stone-700 bg-stone-100 hover:bg-stone-200 disabled:opacity-50 rounded-lg px-4 py-2 transition-colors"
                                >
                                    {busy ? "Working…" : "Pause"}
                                </button>
                                <button
                                    onClick={() => setShowSnippet((s) => !s)}
                                    className="text-xs text-stone-500 hover:text-orange-600 px-2 py-2 transition-colors"
                                >
                                    {showSnippet ? "Hide install snippet" : "Show install snippet"}
                                </button>
                            </>
                        )}
                        {experiment.status === "completed" && (
                            <p className="text-xs text-stone-500">
                                Finished — the winner is being served to all visitors.
                            </p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
