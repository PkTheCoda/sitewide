"use client";

import { Comment, Report, Severity } from "@/lib/types";
import { SEVERITY_COLORS } from "./CommentPin";

const SEVERITY_LABEL: Record<Severity, string> = {
    critical: "Critical",
    warning: "Warning",
    suggestion: "Suggestion",
    positive: "Positive",
};

type Props = {
    report: Report;
    comments: Comment[];
    activeId: string | null;
    onCardClick: (id: string) => void;
    registerCardRef: (id: string, el: HTMLDivElement | null) => void;
};

export default function CommentSidebar({
    report,
    comments,
    activeId,
    onCardClick,
    registerCardRef,
}: Props) {
    return (
        <aside className="sticky top-0 h-screen w-[380px] shrink-0 border-l border-slate-200 bg-white flex flex-col">
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

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {comments.map((comment, index) => {
                    const colors = SEVERITY_COLORS[comment.severity];
                    const active = comment.id === activeId;

                    return (
                        <div
                            key={comment.id}
                            ref={(el) => registerCardRef(comment.id, el)}
                            onClick={() => onCardClick(comment.id)}
                            className={`rounded-lg border p-3 cursor-pointer transition-colors ${
                                active ? "border-orange-500 bg-orange-50" : "border-slate-200 hover:border-slate-300"
                            }`}
                        >
                            <div className="flex items-center gap-2">
                                <span
                                    className={`flex items-center justify-center w-5 h-5 rounded-full text-white text-[11px] font-semibold ${colors.bg}`}
                                >
                                    {index + 1}
                                </span>
                                <span className={`text-xs font-medium ${colors.text}`}>
                                    {SEVERITY_LABEL[comment.severity]}
                                </span>
                                <span className="text-xs text-slate-400">· {comment.dimension}</span>
                            </div>
                            <p className="text-sm text-slate-800 mt-2">{comment.comment}</p>
                        </div>
                    );
                })}

                {comments.length === 0 && (
                    <p className="text-sm text-slate-400 text-center mt-8">No comments yet.</p>
                )}
            </div>
        </aside>
    );
}
