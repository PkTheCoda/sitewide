"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/services/context/authContext";
import { getReports } from "@/lib/reports";
import { Report } from "@/lib/types";
import StatusBadge from "./StatusBadge";

// The Analyses tab: a card per report (one report = one analysis run of one
// URL). Cards link OUT to real routes — /dashboard/report/[id] for the overlay
// view and .../builder for the experiment builder — because those two screens
// are full-page experiences, unlike the in-place dashboard sections.
export default function AnalysesSection() {
    const { user } = useAuth();
    const [reports, setReports] = useState<Report[] | null>(null);

    useEffect(() => {
        if (!user) return;
        getReports(user.id).then((data) => {
            // sort reports by date, earliest first
            if (Array.isArray(data)) {
                const sorted = [...(data as Report[])].sort(
                    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
                );
                setReports(sorted);
            } else {
                setReports([]);
            }
        });
    }, [user]);

    return (
        <div className="flex flex-col gap-4">
            <div>
                <h2 className="text-lg font-medium tracking-tight text-stone-800">Analyses</h2>
                <p className="text-sm text-stone-500">
                    Every page you&apos;ve analyzed — open a report to see comments or build an
                    experiment from it.
                </p>
            </div>

            {reports === null ? (
                <p className="text-sm text-stone-400">Loading analyses…</p>
            ) : reports.length === 0 ? (
                <div className="flex flex-col items-center gap-3 bg-stone-50 border border-dashed border-stone-300 rounded-xl py-14 text-center">
                    <p className="text-sm text-stone-600 font-medium">No analyses yet</p>
                    <p className="text-xs text-stone-500 max-w-sm leading-relaxed">
                        Run your first analysis from the Overview tab — paste a URL and we&apos;ll
                        crawl it, score it, and suggest what to test.
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {reports.map((report) => (
                        <div
                            key={report.id}
                            className="bg-white border border-stone-200 rounded-xl shadow-xs overflow-hidden flex flex-col"
                        >
                            <div className="h-36 bg-stone-100 overflow-hidden">
                                {report.screenshot_url ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                        src={report.screenshot_url}
                                        alt={report.url}
                                        className="w-full h-full object-cover object-top"
                                    />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-xs text-stone-400">
                                        {report.status === "error" ? "Analysis failed" : "Processing…"}
                                    </div>
                                )}
                            </div>
                            <div className="p-4 flex flex-col gap-2 flex-1">
                                <div className="flex items-center justify-between gap-2">
                                    <p className="text-xs font-medium text-stone-700 truncate">
                                        {report.url}
                                    </p>
                                    <StatusBadge status={report.status} />
                                </div>
                                <div className="flex items-center justify-between text-[11px] text-stone-400">
                                    <span>
                                        {report.overall_score !== null
                                            ? `Score: ${report.overall_score}/10`
                                            : "—"}
                                    </span>
                                    <span>{new Date(report.created_at).toLocaleDateString()}</span>
                                </div>
                                <div className="flex gap-2 mt-auto pt-2">
                                    <Link
                                        href={`/dashboard/report/${report.id}`}
                                        className="flex-1 text-center text-xs font-medium text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-lg py-2 transition-colors"
                                    >
                                        View report
                                    </Link>
                                    {report.status === "complete" && (
                                        <Link
                                            href={`/dashboard/report/${report.id}/builder`}
                                            className="flex-1 text-center text-xs font-medium text-white bg-orange-600 hover:bg-orange-700 rounded-lg py-2 transition-colors"
                                        >
                                            New experiment
                                        </Link>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
