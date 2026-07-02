"use client";

import { Comment, Report, Severity } from "@/lib/types";
import { SEVERITY_COLORS } from "./CommentPin";
import { IoChevronBack, IoChevronForward } from "react-icons/io5";

const SEVERITY_LABEL: Record<Severity, string> = {
    critical: "Critical",
    warning: "Warning",
    suggestion: "Suggestion",
};

type Props = {
    report: Report;
    comments: Comment[];
    activeIndex: number;
    onNavigate: (index: number) => void;
};

export default function CommentSidebar({ report, comments, activeIndex, onNavigate }: Props) {
    const comment = comments[activeIndex] ?? null;
    const colors = comment
        ? (SEVERITY_COLORS[comment.severity] ?? SEVERITY_COLORS["suggestion"])
        : null;

    return (
        <aside className="sticky top-0 h-screen w-[380px] shrink-0 border-r border-slate-200 bg-white flex flex-col">
            <div className="p-5 border-b border-slate-200">
                <p className="text-xs text-slate-500 truncate">{report.url}</p>
                <div className="flex items-baseline gap-2 mt-2">
                    <span className="text-3xl font-semibold text-slate-900">
                        {report.overall_score ?? "–"}
                    </span>
                    <span className="text-sm text-slate-500">/ 10 overall score</span>
                </div>
                {report.summary && (
                    <p className="text-sm text-slate-600 mt-3 leading-snug">{report.summary}</p>
                )}
            </div>

            {comments.length === 0 ? (
                <div className="flex-1 flex items-center justify-center">
                    <p className="text-sm text-slate-400">No comments yet.</p>
                </div>
            ) : (
                <div className="flex-1 flex flex-col p-5 overflow-hidden">
                    <div className="flex items-center justify-between mb-5">
                        <button
                            onClick={() => onNavigate(activeIndex - 1)}
                            disabled={activeIndex === 0}
                            className="p-1.5 rounded-md hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                            <IoChevronBack className="size-4 text-slate-600" />
                        </button>
                        <span className="text-xs text-slate-500 font-medium">
                            {activeIndex + 1} / {comments.length}
                        </span>
                        <button
                            onClick={() => onNavigate(activeIndex + 1)}
                            disabled={activeIndex === comments.length - 1}
                            className="p-1.5 rounded-md hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                            <IoChevronForward className="size-4 text-slate-600" />
                        </button>
                    </div>

                    {comment && colors && (
                        <div>
                            <div className="flex items-center gap-2 mb-3">
                                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full text-white ${colors.bg}`}>
                                    {SEVERITY_LABEL[comment.severity]}
                                </span>
                                <span className="text-xs text-slate-400">{comment.dimension}</span>
                            </div>
                            <p className="text-sm text-slate-800 leading-relaxed">{comment.comment}</p>
                        </div>
                    )}
                </div>
            )}
        </aside>
    );
}
