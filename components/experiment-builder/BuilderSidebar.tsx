"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/services/context/authContext";
import { createExperiment } from "@/lib/experiments";
import {
    ChangeType,
    GoalType,
    PageElement,
    Report,
    StyleChanges,
    VariantPayload,
} from "@/lib/types";
import VariantFields, { isValidImageUrl } from "./VariantFields";
import GoalSection from "./GoalSection";4

import gridPattern from "@/public/assets/grid-pattern-ES1.png"

import sidebarEmpty from "@/public/assets/sidebar-empty-state-graphic1.svg"
import Image from "next/image";

type Props = {
    report: Report;
    target: PageElement | null;
    goalElement: PageElement | null;
    pickingGoal: boolean;
    onStartPickingGoal: () => void;
    onCancelPickingGoal: () => void;
    onReset: () => void;
};

// Images get an image-swap test instead of text/style — font size and text
// color are meaningless on an <img>.
const TEXT_CHANGE_TYPES: { value: ChangeType; label: string }[] = [
    { value: "text", label: "Text" },
    { value: "style", label: "Style" },
    { value: "hide", label: "Hide" },
];
const IMAGE_CHANGE_TYPES: { value: ChangeType; label: string }[] = [
    { value: "image", label: "Image" },
    { value: "hide", label: "Hide" },
];

export default function BuilderSidebar({
    report,
    target,
    goalElement,
    pickingGoal,
    onStartPickingGoal,
    onCancelPickingGoal,
    onReset,
}: Props) {
    const { user } = useAuth();

    const [changeType, setChangeType] = useState<ChangeType>("text");
    const [textVariants, setTextVariants] = useState<string[]>([""]);
    const [styles, setStyles] = useState<StyleChanges>({});
    const [imageSrc, setImageSrc] = useState("");
    const [goalType, setGoalType] = useState<GoalType>("click");
    const [goalPagePath, setGoalPagePath] = useState("");
    const [name, setName] = useState("");
    const [hypothesis, setHypothesis] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [createdId, setCreatedId] = useState<string | null>(null);

    // Keep the change type valid for the selected element kind.
    useEffect(() => {
        if (!target) return;
        if (target.tag === "img" && (changeType === "text" || changeType === "style")) {
            setChangeType("image");
        } else if (target.tag !== "img" && changeType === "image") {
            setChangeType("text");
        }
    }, [target, changeType]);

    // Suggest a name from the selected element, but never overwrite the user's own.
    useEffect(() => {
        if (target && !name) {
            const label = target.text ?? target.alt ?? target.tag;
            setName(`Test: ${label.slice(0, 40)}`);
        }
    }, [target]); // eslint-disable-line react-hooks/exhaustive-deps

    const cleanedStyles: StyleChanges = Object.fromEntries(
        Object.entries(styles).filter(([, v]) => v && v.trim())
    );
    const filledTextVariants = textVariants.map((v) => v.trim()).filter(Boolean);

    const changeValid =
        changeType === "hide" ||
        (changeType === "text" && filledTextVariants.length > 0) ||
        (changeType === "style" && Object.keys(cleanedStyles).length > 0) ||
        (changeType === "image" && isValidImageUrl(imageSrc));
    const goalValid =
        (goalType === "click" && goalElement !== null) ||
        (goalType === "pageview" && goalPagePath.trim().startsWith("/"));
    const canSubmit = !!user && !!target && !!name.trim() && changeValid && goalValid && !submitting;

    async function handleSubmit() {
        if (!canSubmit || !user || !target) return;
        setSubmitting(true);
        setSubmitError(null);

        const variant_payloads: VariantPayload[] =
            changeType === "text"
                ? filledTextVariants.map((text) => ({ text }))
                : changeType === "style"
                  ? [{ styles: cleanedStyles }]
                  : changeType === "image"
                    ? [{ src: imageSrc.trim() }]
                    : [{ hide: true }];

        const result = await createExperiment({
            user_id: user.id,
            report_id: Number(report.id),
            page_url: report.url,
            name: name.trim(),
            hypothesis: hypothesis.trim() || null,
            target,
            change_type: changeType,
            variant_payloads,
            goal_type: goalType,
            goal_element: goalType === "click" ? goalElement : null,
            goal_page_path: goalType === "pageview" ? goalPagePath.trim() : null,
        });

        setSubmitting(false);
        if ("error" in result && result.error) {
            setSubmitError(result.error);
        } else if ("id" in result && result.id) {
            setCreatedId(result.id);
        }
    }

    function resetForm() {
        setCreatedId(null);
        setSubmitError(null);
        setTextVariants([""]);
        setStyles({});
        setImageSrc("");
        setGoalPagePath("");
        setName("");
        setHypothesis("");
        setChangeType("text");
        setGoalType("click");
        onReset();
    }

    // ── Success state ──────────────────────────────────────────────────────
    if (createdId) {
        return (
            <aside className="sticky top-0 h-screen w-[380px] shrink-0 border-r border-slate-200 bg-white flex flex-col items-center justify-center gap-4 p-8">
                <div className="size-12 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 text-xl">
                    ✓
                </div>
                <div className="text-center">
                    <h3 className="text-sm font-semibold text-slate-800">Experiment created</h3>
                    <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                        Saved as a draft. It starts running once your snippet is installed
                        and the experiment is activated.
                    </p>
                </div>
                <div className="flex flex-col gap-2 w-full mt-2">
                    <button
                        onClick={resetForm}
                        className="text-xs font-medium text-white bg-orange-600 hover:bg-orange-700 rounded-md py-2.5 transition-colors"
                    >
                        Create another experiment
                    </button>
                    <Link
                        href={`/dashboard/report/${report.id}`}
                        className="text-xs text-center text-slate-500 hover:text-slate-700 py-2 transition-colors"
                    >
                        Back to report
                    </Link>
                </div>
            </aside>
        );
    }

    // ── Builder form ───────────────────────────────────────────────────────
    return (
        <aside className="sticky top-0 h-screen w-[380px] shrink-0 border-r border-slate-200 bg-white flex flex-col">
            <div className="p-5 border-b border-slate-200">
                <h2 className="text-sm font-semibold text-slate-800">New experiment</h2>
                <p className="text-xs text-slate-500 mt-1 truncate">{report.url}</p>
            </div>

            <div className="flex-1 overflow-y-auto flex flex-col gap-6 p-5">

                {/* Step 1 — element */}
                <section className="flex flex-col gap-2 items-center justify-center h-full">
                    {target ? (
                        <div className="w-full">
                            <h4 className="uppercase text-slate-500 tracking-wider text-xs font-medium">
                                1 · Element to test
                            </h4>
                            <div className="bg-orange-50 border border-orange-200 rounded-md py-2 px-3">
                                <p className="text-xs text-orange-900 line-clamp-2">
                                    <span className="font-semibold uppercase text-[10px] tracking-wider mr-1.5">
                                        {target.tag}
                                    </span>
                                    {target.text ?? target.alt ?? "(no text)"}
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div
                            className="w-full h-max flex flex-col items-center justify-center text-center px-2   gap-4"
                        >
                            <Image src={sidebarEmpty} alt="sidebar empty state" className="w-full h-full" />

                            <div className="flex flex-col gap-2">
                                <h3 className="text-slate-700 one-title tracking-tight font-medium">
                                    No Element Selected
                                </h3>
                                <p className="text-xs text-slate-500">
                                    Hover over the page and click the element that you would like to test for this experiment.
                                </p>
                            </div>

                        </div>
                    )}
                </section>

                {target && (
                    <>
                        {/* Step 2 — change */}
                        <section className="flex flex-col gap-2">
                            <h4 className="uppercase text-slate-500 tracking-wider text-xs font-medium">
                                2 · What changes
                            </h4>
                            <div
                                className={`grid gap-1 bg-slate-100 rounded-lg p-1 ${
                                    target.tag === "img" ? "grid-cols-2" : "grid-cols-3"
                                }`}
                            >
                                {(target.tag === "img" ? IMAGE_CHANGE_TYPES : TEXT_CHANGE_TYPES).map(
                                    ({ value, label }) => (
                                        <button
                                            key={value}
                                            type="button"
                                            onClick={() => setChangeType(value)}
                                            className={`text-xs py-1.5 rounded-md transition-colors ${
                                                changeType === value
                                                    ? "bg-white text-slate-800 font-medium shadow-sm"
                                                    : "text-slate-500 hover:text-slate-700"
                                            }`}
                                        >
                                            {label}
                                        </button>
                                    )
                                )}
                            </div>
                            <VariantFields
                                changeType={changeType}
                                target={target}
                                textVariants={textVariants}
                                onTextVariantsChange={setTextVariants}
                                styles={styles}
                                onStylesChange={setStyles}
                                imageSrc={imageSrc}
                                onImageSrcChange={setImageSrc}
                            />
                        </section>

                        {/* Step 3 — goal */}
                        <section className="flex flex-col gap-2">
                            <h4 className="uppercase text-slate-500 tracking-wider text-xs font-medium">
                                3 · Conversion goal
                            </h4>
                            <GoalSection
                                goalType={goalType}
                                onGoalTypeChange={(type) => {
                                    setGoalType(type);
                                    onCancelPickingGoal();
                                }}
                                goalElement={goalElement}
                                pickingGoal={pickingGoal}
                                onStartPicking={onStartPickingGoal}
                                onCancelPicking={onCancelPickingGoal}
                                goalPagePath={goalPagePath}
                                onPathChange={setGoalPagePath}
                            />
                        </section>

                        {/* Step 4 — details */}
                        <section className="flex flex-col gap-2">
                            <h4 className="uppercase text-slate-500 tracking-wider text-xs font-medium">
                                4 · Details
                            </h4>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="Experiment name"
                                className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-md py-2 px-3 focus:outline-none focus:border-orange-600 placeholder-slate-400"
                            />
                            <textarea
                                value={hypothesis}
                                onChange={(e) => setHypothesis(e.target.value)}
                                placeholder="Hypothesis (optional) — e.g. 'A benefit-led headline will lift signups because…'"
                                rows={3}
                                className="text-xs text-slate-700 leading-relaxed bg-slate-50 border border-slate-200 rounded-md py-2 px-3 focus:outline-none focus:border-orange-600 placeholder-slate-400 resize-none"
                            />
                        </section>
                    </>
                )}
            </div>

            <div className="p-5 border-t border-slate-200 flex flex-col gap-2">
                {submitError && (
                    <p className="text-xs text-red-600 leading-relaxed">{submitError}</p>
                )}
                <button
                    onClick={handleSubmit}
                    disabled={!canSubmit}
                    className="text-xs font-medium text-white bg-orange-600 hover:bg-orange-700 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-md py-2.5 transition-colors"
                >
                    {submitting ? "Creating…" : "Create experiment (draft)"}
                </button>
            </div>
        </aside>
    );
}
