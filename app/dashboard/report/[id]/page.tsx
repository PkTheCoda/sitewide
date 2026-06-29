"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import { getReport, getComments } from "@/lib/reports";
import { Comment, Report } from "@/lib/types";
import ScreenshotOverlay from "@/components/report/ScreenshotOverlay";
import CommentSidebar from "@/components/report/CommentSidebar";

export default function ReportPage() {
    const params = useParams<{ id: string }>();
    const reportId = params.id;

    const [report, setReport] = useState<Report | null>(null);
    const [comments, setComments] = useState<Comment[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeId, setActiveId] = useState<string | null>(null);

    const pinRefs = useRef<Record<string, HTMLDivElement | null>>({});
    const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

    useEffect(() => {
        if (!reportId) return;

        async function load() {
            const [reportData, commentsData] = await Promise.all([
                getReport(reportId),
                getComments(reportId),
            ]);

            if (reportData && !("error" in reportData)) setReport(reportData as Report);
            if (Array.isArray(commentsData)) setComments(commentsData as Comment[]);

            setLoading(false);
        }

        load();
    }, [reportId]);

    function selectComment(id: string) {
        setActiveId(id);
        pinRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "center" });
        cardRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    return (
        <ProtectedRoute>
            <div className="w-full min-h-screen bg-slate-100">
                {loading ? (
                    <div className="flex items-center justify-center min-h-screen text-slate-500">
                        Loading report…
                    </div>
                ) : !report ? (
                    <div className="flex items-center justify-center min-h-screen text-slate-500">
                        Report not found.
                    </div>
                ) : report.status === "error" ? (
                    <div className="flex items-center justify-center min-h-screen text-slate-500">
                        {report.error_message ?? "Something went wrong analyzing this page."}
                    </div>
                ) : report.status !== "complete" || !report.screenshot_url ? (
                    <div className="flex items-center justify-center min-h-screen text-slate-500">
                        Analysis in progress…
                    </div>
                ) : (
                    <div className="flex">
                        <div className="flex-1 p-8">
                            <Link
                                href="/dashboard"
                                className="text-sm text-slate-500 hover:text-orange-600 transition-colors"
                            >
                                ← Back to dashboard
                            </Link>
                            <div className="mt-4">
                                <ScreenshotOverlay
                                    screenshotUrl={report.screenshot_url}
                                    comments={comments}
                                    activeId={activeId}
                                    onPinClick={selectComment}
                                    registerPinRef={(id, el) => {
                                        pinRefs.current[id] = el;
                                    }}
                                />
                            </div>
                        </div>

                        <CommentSidebar
                            report={report}
                            comments={comments}
                            activeId={activeId}
                            onCardClick={selectComment}
                            registerCardRef={(id, el) => {
                                cardRefs.current[id] = el;
                            }}
                        />
                    </div>
                )}
            </div>
        </ProtectedRoute>
    );
}
