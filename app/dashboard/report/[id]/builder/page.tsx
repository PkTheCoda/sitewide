"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import { getReport, getComments } from "@/lib/reports";
import { Comment, PageElement, Report } from "@/lib/types";
import BuilderCanvas from "@/components/experiment-builder/BuilderCanvas";
import BuilderSidebar, { Prefill } from "@/components/experiment-builder/BuilderSidebar";

function ExperimentBuilder() {
    const params = useParams<{ id: string }>();
    const reportId = params.id;
    // ?comment=<id> — arrive from a report finding with the form prefilled.
    const commentId = useSearchParams().get("comment");

    const [report, setReport] = useState<Report | null>(null);
    const [loading, setLoading] = useState(true);
    const [prefill, setPrefill] = useState<Prefill | null>(null);

    // Selection state shared between the canvas and the sidebar. Everything
    // else (variants, goal path, name…) lives inside BuilderSidebar.
    const [target, setTarget] = useState<PageElement | null>(null);
    const [goalElement, setGoalElement] = useState<PageElement | null>(null);
    const [pickingGoal, setPickingGoal] = useState(false);

    useEffect(() => {
        if (!reportId) return;
        async function load() {
            const reportData = await getReport(reportId);
            if (!reportData || "error" in reportData) {
                setLoading(false);
                return;
            }
            const loaded = reportData as Report;
            setReport(loaded);

            // Deep link from a finding: select its element and carry the AI's
            // name/hypothesis/variants into the sidebar.
            if (commentId && loaded.elements?.length) {
                const commentsData = await getComments(reportId);
                const comment = Array.isArray(commentsData)
                    ? (commentsData as Comment[]).find((c) => String(c.id) === commentId)
                    : null;
                const element = comment
                    ? loaded.elements.find((el) => el.id === comment.element_id)
                    : null;
                if (comment && element) {
                    setTarget(element);
                    setPrefill({
                        elementId: element.id,
                        name: `Test: ${(element.text ?? element.tag).slice(0, 40)}`,
                        hypothesis: comment.hypothesis ?? "",
                        variants: comment.variants ?? [],
                        variantParts: comment.variant_parts ?? [],
                    });
                }
            }
            setLoading(false);
        }
        load();
    }, [reportId, commentId]);

    function handleSelect(element: PageElement) {
        if (pickingGoal) {
            setGoalElement(element);
            setPickingGoal(false);
        } else {
            setTarget(element);
        }
    }

    function handleReset() {
        setTarget(null);
        setGoalElement(null);
        setPickingGoal(false);
    }

    const ready =
        report &&
        report.status === "complete" &&
        report.screenshot_url &&
        report.page_height &&
        report.viewport_width;

    return (
        <ProtectedRoute>
            <div className="w-full min-h-screen bg-slate-100">
                {loading ? (
                    <div className="flex items-center justify-center min-h-screen text-slate-500">
                        Loading builder…
                    </div>
                ) : !report ? (
                    <div className="flex items-center justify-center min-h-screen text-slate-500">
                        Report not found.
                    </div>
                ) : !ready ? (
                    <div className="flex items-center justify-center min-h-screen text-slate-500">
                        This report isn&apos;t ready yet — run the analysis first.
                    </div>
                ) : !report.elements?.length ? (
                    <div className="flex flex-col items-center justify-center min-h-screen text-slate-500 gap-2 px-8 text-center">
                        <p>This report has no element data.</p>
                        <p className="text-sm text-slate-400">
                            It was created before the experiment builder existed — re-run the
                            analysis on this page to enable element selection.
                        </p>
                    </div>
                ) : (
                    <div className="flex">
                        <BuilderSidebar
                            report={report}
                            target={target}
                            goalElement={goalElement}
                            pickingGoal={pickingGoal}
                            prefill={prefill}
                            onStartPickingGoal={() => setPickingGoal(true)}
                            onCancelPickingGoal={() => setPickingGoal(false)}
                            onReset={handleReset}
                        />

                        <div className="flex-1 px-8 py-4">
                            <div className="flex items-center justify-between">
                                <Link
                                    href={`/dashboard/report/${report.id}`}
                                    className="text-sm text-slate-500 hover:text-orange-600 transition-colors"
                                >
                                    ← Back to report
                                </Link>
                                {pickingGoal && (
                                    <span className="text-xs font-medium text-emerald-700 bg-emerald-100 rounded-full px-3 py-1">
                                        Picking conversion goal — click an element
                                    </span>
                                )}
                            </div>
                            <div className="mt-4">
                                <BuilderCanvas
                                    screenshotUrl={report.screenshot_url!}
                                    elements={report.elements}
                                    pageHeight={report.page_height!}
                                    viewportWidth={report.viewport_width!}
                                    mode={pickingGoal ? "goal" : "target"}
                                    targetId={target?.id ?? null}
                                    goalId={goalElement?.id ?? null}
                                    onSelect={handleSelect}
                                />
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </ProtectedRoute>
    );
}

// useSearchParams requires a Suspense boundary in production builds — without
// it the whole page bails out of prerendering and the build fails.
export default function ExperimentBuilderPage() {
    return (
        <Suspense
            fallback={
                <div className="flex items-center justify-center min-h-screen text-slate-500">
                    Loading builder…
                </div>
            }
        >
            <ExperimentBuilder />
        </Suspense>
    );
}
