"use client";

import { useState } from "react";
import Link from "next/link";
import { Comment, Report, Severity } from "@/lib/types";
import { SEVERITY_COLORS } from "./CommentPin";
import { IoChevronBack, IoChevronForward } from "react-icons/io5";
import { LuChevronDown, LuLightbulb } from "react-icons/lu";
import { BsArrow90DegDown } from "react-icons/bs";

const SEVERITY_LABEL: Record<Severity, string> = {
    critical: "Critical",
    warning: "Warning",
    suggestion: "Suggestion",
};

// Meta chips carry judgment, so they get tone; everything else stays neutral.
const IMPACT_TONE: Record<string, string> = {
    High: "bg-orange-50 text-orange-700 border-orange-200",
    Medium: "bg-slate-50 text-slate-600 border-slate-200",
    Low: "bg-slate-50 text-slate-400 border-slate-200",
};
const EFFORT_TONE: Record<string, string> = {
    "Quick win": "bg-emerald-50 text-emerald-700 border-emerald-200",
    "Some work": "bg-slate-50 text-slate-600 border-slate-200",
    "Big lift": "bg-amber-50 text-amber-700 border-amber-200",
};

type Props = {
    report: Report;
    comments: Comment[];
    activeIndex: number;
    onNavigate: (index: number) => void;
};

export default function CommentSidebar({ report, comments, activeIndex, onNavigate }: Props) {
    const comment = comments[activeIndex] ?? null;

    return (
        <aside className="sticky top-0 h-screen w-[380px] shrink-0 border-r border-slate-200 bg-white flex flex-col">
            {comments.length === 0 ? (
                <div className="flex-1 flex items-center justify-center">
                    <p className="text-sm text-slate-400">No comments yet.</p>
                </div>
            ) : (
                <div className="flex-1 flex flex-col overflow-hidden">
                    {/* Pager: position + where on the page this finding lives */}
                    <div className="flex items-center justify-between p-3 border-b border-slate-200">
                        <button
                            onClick={() => onNavigate(activeIndex - 1)}
                            disabled={activeIndex === 0}
                            className="p-1.5 rounded-md hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                            <IoChevronBack className="size-4 text-slate-600" />
                        </button>
                        <div className="text-center leading-tight">
                            <p className="text-xs text-slate-600 font-medium">
                                Finding {activeIndex + 1} of {comments.length}
                            </p>
                            {(comment?.section || comment?.dimension) && (
                                <p className="text-[10px] text-slate-400 capitalize mt-0.5">
                                    {[comment.section, comment.dimension].filter(Boolean).join(" · ")}
                                </p>
                            )}
                        </div>
                        <button
                            onClick={() => onNavigate(activeIndex + 1)}
                            disabled={activeIndex === comments.length - 1}
                            className="p-1.5 rounded-md hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                            <IoChevronForward className="size-4 text-slate-600" />
                        </button>
                    </div>

                    {/* key resets the disclosure state on every navigation */}
                    {comment && <CommentBody key={comment.id} comment={comment} report={report} />}
                </div>
            )}
        </aside>
    );
}

function CommentBody({ comment, report }: { comment: Comment; report: Report }) {
    const [showWhy, setShowWhy] = useState(false);
    const colors = SEVERITY_COLORS[comment.severity] ?? SEVERITY_COLORS["suggestion"];

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            {/* Scrollable content; the CTA stays pinned below */}
            <div className="flex-1 overflow-y-auto hide-scroll-bar">
                <div className="flex flex-col gap-5 p-6">
                    {/* Judgment at a glance: severity, impact, effort */}
                    <div className="flex flex-wrap items-center gap-1.5">
                        <span
                            className={`flex items-center gap-1.5 text-[11px] font-medium border border-slate-200 rounded-full px-2.5 py-1 ${colors.text}`}
                        >
                            <span className={`size-1.5 rounded-full ${colors.bg}`} />
                            {SEVERITY_LABEL[comment.severity]}
                        </span>
                        {comment.meta?.impact && (
                            <span
                                className={`text-[11px] font-medium border rounded-full px-2.5 py-1 ${IMPACT_TONE[comment.meta.impact] ?? IMPACT_TONE.Medium}`}
                            >
                                {comment.meta.impact} impact
                            </span>
                        )}
                        {comment.meta?.effort && (
                            <span
                                className={`text-[11px] font-medium border rounded-full px-2.5 py-1 ${EFFORT_TONE[comment.meta.effort] ?? EFFORT_TONE["Some work"]}`}
                            >
                                {comment.meta.effort}
                            </span>
                        )}
                    </div>

                    {/* Which element this is about */}
                    {(comment.element_tag || comment.original_value) && (
                        <div className="flex items-center gap-2.5 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 min-w-0">
                            <span className="font-robot text-orange-600 font-bold text-sm shrink-0">
                                {comment.element_tag || "el"}
                            </span>
                            <p className="text-xs text-slate-500 truncate">
                                {comment.original_value ?? "—"}
                            </p>
                        </div>
                    )}

                    <div className="flex flex-col gap-1">
                        <h4 className="uppercase text-slate-500 tracking-wider text-xs font-medium">
                            comment
                        </h4>
                        <p className="text-sm text-slate-700 leading-relaxed">{comment.comment}</p>

                        {/* The evidence, one click away — keeps the panel short */}
                        {comment.why_it_matters && (
                            <div className="mt-1">
                                <button
                                    onClick={() => setShowWhy((v) => !v)}
                                    className="flex items-center gap-1 text-[11px] font-medium text-slate-400 hover:text-orange-600 transition-colors cursor-pointer"
                                >
                                    Why this matters
                                    <LuChevronDown
                                        className={`size-3 transition-transform ${showWhy ? "rotate-180" : ""}`}
                                    />
                                </button>
                                {showWhy && (
                                    <p className="text-xs text-slate-500 leading-relaxed mt-1.5 pl-3 border-l-2 border-slate-200">
                                        {comment.why_it_matters}
                                    </p>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="flex flex-col gap-1">
                        <h4 className="uppercase text-slate-500 tracking-wider text-xs font-medium">
                            suggestion
                        </h4>
                        <p className="text-sm text-slate-700 leading-relaxed">{comment.suggestion}</p>
                    </div>

                    <div className="flex flex-col gap-2">
                        <h4 className="uppercase text-slate-500 tracking-wider text-xs font-medium">
                            suggested rewrites
                            {comment.variants.length > 0 && (
                                <span className="text-slate-300 normal-case tracking-normal">
                                    {" "}
                                    · {comment.variants.length}
                                </span>
                            )}
                        </h4>

                        <div className="flex flex-col gap-y-3">
                            <p className="text-xs text-slate-600 w-max max-w-full leading-relaxed bg-slate-50 py-2 px-4 rounded-md border-slate-200 border">
                                {comment.original_value}
                            </p>
                            {comment.variants.map((variant, idx) => (
                                <div
                                    key={idx}
                                    className="grid place-items-center grid-cols-8 text-slate-300 w-full group cursor-pointer"
                                >
                                    <div className="w-full h-full flex items-center justify-center">
                                        <BsArrow90DegDown
                                            strokeWidth={0.5}
                                            className="-rotate-90 size-4 col-span-1 group-hover:text-orange-600 transition-colors"
                                        />
                                    </div>
                                    <p className="col-span-7 text-xs text-slate-600 wrap-break-word whitespace-pre-line leading-relaxed bg-slate-50 py-2 px-4 rounded-md border-slate-200 border border-dashed w-full group-hover:border-orange-600 transition-colors">
                                        {variant}
                                    </p>
                                </div>
                            ))}

                            <div className="grid place-items-center grid-cols-8 w-full group transition-colors">
                                <div className="w-full h-full flex items-center justify-center">
                                    <BsArrow90DegDown
                                        strokeWidth={0.5}
                                        className="-rotate-90 size-4 col-span-1 text-slate-300 group-focus-within:text-orange-600 group-hover:text-orange-600 transition-colors"
                                    />
                                </div>
                                <input
                                    type="text"
                                    className="col-span-7 group-hover:border-orange-600 shadow-[0px_0px_0px_1px_rgba(0,0,0,0.06),0px_1px_1px_-0.5px_rgba(0,0,0,0.06),0px_3px_3px_-1.5px_rgba(0,0,0,0.06),0px_6px_6px_-3px_rgba(0,0,0,0.06),0px_12px_12px_-6px_rgba(0,0,0,0.06),0px_24px_24px_-12px_rgba(0,0,0,0.06)] text-xs text-slate-700 leading-relaxed w-full bg-slate-50 py-2 px-4 rounded-md border border-slate-200 focus:outline-none focus:border-orange-600 placeholder-slate-400 transition-all"
                                    placeholder="Suggest your own rewrite..."
                                    style={{ fontFamily: "inherit" }}
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Pinned action area: the hypothesis sells the test, the button starts it */}
            <div className="border-t border-slate-200 bg-white p-4 flex flex-col gap-3">
                {comment.hypothesis && (
                    <div className="flex items-start gap-2">
                        <LuLightbulb className="size-3.5 text-orange-500 shrink-0 mt-0.5" />
                        <p className="text-[11px] text-slate-500 leading-relaxed italic line-clamp-3">
                            {comment.hypothesis}
                        </p>
                    </div>
                )}
                {/* One-click test creation: opens the builder with the element,
                    name, hypothesis and variants prefilled — the founder only
                    picks the goal. */}
                <Link
                    href={`/dashboard/report/${report.id}/builder?comment=${comment.id}`}
                    className="text-xs font-medium text-center text-white bg-orange-600 hover:bg-orange-700 rounded-md py-2.5 transition-colors"
                >
                    Create this test →
                </Link>
            </div>
        </div>
    );
}
