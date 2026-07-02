"use client";

import { Comment, Report, Severity } from "@/lib/types";
import { SEVERITY_COLORS } from "./CommentPin";
import { IoChevronBack, IoChevronForward } from "react-icons/io5";

import { BsArrow90DegDown } from "react-icons/bs";

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
            {/* <div className="p-5 border-b border-slate-200">
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
            </div> */}

            {comments.length === 0 ? (
                <div className="flex-1 flex items-center justify-center">
                    <p className="text-sm text-slate-400">No comments yet.</p>
                </div>
            ) : (
                <div className="flex-1 flex flex-col overflow-hidden">
                    <div className="flex items-center justify-between p-3 border-b border-slate-200">
                        <button
                            onClick={() => onNavigate(activeIndex - 1)}
                            disabled={activeIndex === 0}
                            className="p-1.5 rounded-md hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                            <IoChevronBack className="size-4 text-slate-600" />
                        </button>
                        <span className="text-xs text-slate-500 font-medium">
                            Comment {activeIndex + 1} / {comments.length}
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
                        
                        <div className="flex flex-col gap-4 p-6">
                            {/* <div className="flex items-center gap-2 mb-3">
                                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full text-white ${colors.bg}`}>
                                    {SEVERITY_LABEL[comment.severity]}
                                </span>
                                <span className="text-xs text-slate-400">{comment.dimension}</span>
                            </div> */}


                            <div className="flex flex-col gap-1">
                                <h4 className="uppercase text-slate-500 tracking-wider text-xs font-medium">
                                    comment
                                </h4>
                                <p className="text-sm text-slate-700 leading-relaxed">{comment.comment}</p>
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
                                </h4>

                                <div className="flex flex-col gap-y-3">
                                    <p className="text-xs text-slate-600 w-max leading-relaxed bg-slate-50 py-2 px-4 rounded-md border-slate-200 border ">
                                        {comment.original_value}
                                    </p>
                                    {comment.variants.map((variant, idx) => (
                                        <div
                                            key={idx}
                                            className="grid place-items-center grid-cols-8 text-slate-300 w-full group cursor-pointer"
                                        >
                                            <div className="w-full h-full flex items-center justify-center">
                                                <BsArrow90DegDown strokeWidth={0.5} className="-rotate-90 size-4 col-span-1 group-hover:text-orange-600 transition-colors" />
                                            </div>
                                            <p className="col-span-7 text-xs text-slate-600 wrap-break-word whitespace-pre-line leading-relaxed bg-slate-50 py-2 px-4 rounded-md border-slate-200 border border-dashed w-full group-hover:border-orange-600 transition-colors">
                                                {variant}
                                            </p>
                                        </div>
                                    ))}  

                                    <div className="grid place-items-center grid-cols-8 w-full group">
                                        <div className="w-full h-full flex items-center justify-center">
                                            <BsArrow90DegDown strokeWidth={0.5} className="-rotate-90 group-focus:text-orange-600 size-4 col-span-1 text-slate-300 group-focus-within:text-orange-600 transition-colors group-hover:text-orange-600" />
                                        </div>
                                        <input
                                            type="text"
                                            className="col-span-7 shadow-[0px_0px_0px_1px_rgba(0,0,0,0.06),0px_1px_1px_-0.5px_rgba(0,0,0,0.06),0px_3px_3px_-1.5px_rgba(0,0,0,0.06),_0px_6px_6px_-3px_rgba(0,0,0,0.06),0px_12px_12px_-6px_rgba(0,0,0,0.06),0px_24px_24px_-12px_rgba(0,0,0,0.06)] text-xs text-slate-700 leading-relaxed w-full bg-slate-50 py-2 px-4 rounded-md border border-slate-200 focus:outline-none hover:border-orange-600 focus:border-orange-600 placeholder-slate-400 transition-all"
                                            placeholder="Suggest your own rewrite..."
                                            style={{ fontFamily: 'inherit' }}
                                        />
                                    </div>
                              
                              

                                </div>

                            </div>

                        </div>
                    )}
                </div>
            )}
        </aside>
    );
}
