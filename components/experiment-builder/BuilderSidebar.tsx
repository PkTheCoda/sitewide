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
import GoalSection from "./GoalSection";
import DecisionEstimator from "./DecisionEstimator";
import PreviewLinks from "./PreviewLinks";
import { buildPreviewLink } from "@/lib/preview";

import gridPattern from "@/public/assets/grid-pattern-ES1.png"

import sidebarEmpty from "@/public/assets/sidebar-empty-state-graphic.svg"
import Image from "next/image";

// Seed values carried in from an AI finding ("Create this test" on the report
// page). Applied once, when the deep-linked element becomes the target.
export type Prefill = {
    elementId: number; // only applies while this element is the target
    name: string;
    hypothesis: string;
    variants: string[]; // flat replacement texts
    variantParts: string[][]; // rich-text split, one inner array per variant
};

type Props = {
    report: Report;
    target: PageElement | null;
    goalElement: PageElement | null;
    pickingGoal: boolean;
    prefill?: Prefill | null;
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

// The builder's left panel — owns ALL form state (change type, variant copy,
// styles, image URL, goal, name, hypothesis). The page only owns what the
// canvas also needs: which elements are selected and whether we're picking a
// goal. On submit it assembles variant payloads and calls createExperiment,
// which writes the experiments + experiment_variants rows (status: draft).
export default function BuilderSidebar({
    report,
    target,
    goalElement,
    pickingGoal,
    prefill,
    onStartPickingGoal,
    onCancelPickingGoal,
    onReset,
}: Props) {
    const { user } = useAuth();

    const [changeType, setChangeType] = useState<ChangeType>("text");
    const [textVariants, setTextVariants] = useState<string[]>([""]);
    // Rich-text mode: elements captured with textParts (an h1 with a gradient
    // span…) get one input per part instead of one flat textarea, so inner
    // styling survives. partVariants[variantIdx][partIdx] mirrors textParts.
    const [partVariants, setPartVariants] = useState<string[][]>([]);
    const [styles, setStyles] = useState<StyleChanges>({});
    const [imageSrc, setImageSrc] = useState("");
    const [goalType, setGoalType] = useState<GoalType>("click");
    const [goalPagePath, setGoalPagePath] = useState("");
    const [name, setName] = useState("");
    const [hypothesis, setHypothesis] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [createdId, setCreatedId] = useState<string | null>(null);
    // Per-variant sample size from the time-to-decision estimator. Persisted as
    // min_sample_size so the agent waits for exactly the sample the founder was
    // shown a date for.
    const [estSampleSize, setEstSampleSize] = useState<number | null>(null);

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

    // Seed the variant editors whenever the selection changes. When the
    // selected element is the deep-linked AI finding, seed with its rewrites;
    // otherwise rich-text elements start with one variant holding the original
    // parts, so the founder only edits the piece they want to test.
    // Deliberately ONE idempotent effect: a previous version split this into
    // a plain reseed ([target]) plus a run-once prefill guarded by a ref, and
    // StrictMode's second effect pass re-ran the reseed while the ref made the
    // prefill skip — wiping the rewrites right after they were applied.
    useEffect(() => {
        const isPrefillTarget = !!target && !!prefill && target.id === prefill.elementId;
        const parts = target?.textParts && target.textParts.length > 1 ? target.textParts : null;

        if (isPrefillTarget) {
            if (prefill.name) setName(prefill.name);
            if (prefill.hypothesis) setHypothesis(prefill.hypothesis);
        }

        if (parts) {
            // Only part-splits that match the element's actual part count are
            // usable — the snippet maps them onto text nodes 1:1.
            const usable = isPrefillTarget
                ? prefill.variantParts.filter((v) => v.length === parts.length)
                : [];
            setPartVariants(usable.length > 0 ? usable.map((v) => [...v]) : [[...parts]]);
        } else {
            setPartVariants([]);
            if (isPrefillTarget && prefill.variants.length > 0) {
                setTextVariants([...prefill.variants]);
            }
        }
    }, [target, prefill]);

    const cleanedStyles: StyleChanges = Object.fromEntries(
        Object.entries(styles).filter(([, v]) => v && v.trim())
    );
    const filledTextVariants = textVariants.map((v) => v.trim()).filter(Boolean);

    // Rich-text variants count as filled once they differ from the original —
    // they start prefilled with the original parts, so "non-empty" alone would
    // let an unchanged copy of the control through.
    const richParts = target?.textParts && target.textParts.length > 1 ? target.textParts : null;
    const originalJoined = richParts?.map((p) => p.trim()).join(" ") ?? "";
    const filledPartVariants = partVariants
        .map((parts) => parts.map((p) => p.trim()))
        .filter((parts) => parts.some(Boolean) && parts.join(" ") !== originalJoined);

    const changeValid =
        changeType === "hide" ||
        (changeType === "text" &&
            (richParts ? filledPartVariants.length > 0 : filledTextVariants.length > 0)) ||
        (changeType === "style" && Object.keys(cleanedStyles).length > 0) ||
        (changeType === "image" && isValidImageUrl(imageSrc));

    // Payloads assembled once, from live form state — used for BOTH the
    // preview links and the actual submit, so what you preview is exactly
    // what gets created.
    const variantPayloads: VariantPayload[] =
        changeType === "text"
            ? richParts
                ? filledPartVariants.map((textParts) => ({ textParts }))
                : filledTextVariants.map((text) => ({ text }))
            : changeType === "style"
              ? Object.keys(cleanedStyles).length > 0
                  ? [{ styles: cleanedStyles }]
                  : []
              : changeType === "image"
                ? isValidImageUrl(imageSrc)
                    ? [{ src: imageSrc.trim() }]
                    : []
                : [{ hide: true }];

    // Live preview links (?sw_preview=…): the change is encoded in the URL
    // itself, so these work before the experiment exists — the only
    // requirement is the snippet being installed on the page.
    const previewLinks = target
        ? variantPayloads
              .map((payload, i) => ({
                  label: `Variant ${String.fromCharCode(66 + i)}`,
                  url: buildPreviewLink(report.url, target.selector, target.fallback, payload),
              }))
              .filter((link): link is { label: string; url: string } => link.url !== null)
        : [];
    const goalValid =
        (goalType === "click" && goalElement !== null) ||
        (goalType === "pageview" && goalPagePath.trim().startsWith("/"));
    const canSubmit = !!user && !!target && !!name.trim() && changeValid && goalValid && !submitting;

    async function handleSubmit() {
        if (!canSubmit || !user || !target) return;
        setSubmitting(true);
        setSubmitError(null);

        const result = await createExperiment({
            user_id: user.id,
            report_id: Number(report.id),
            page_url: report.url,
            name: name.trim(),
            hypothesis: hypothesis.trim() || null,
            target,
            change_type: changeType,
            variant_payloads: variantPayloads,
            goal_type: goalType,
            goal_element: goalType === "click" ? goalElement : null,
            goal_page_path: goalType === "pageview" ? goalPagePath.trim() : null,
            min_sample_size: estSampleSize ?? undefined,
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
        setPartVariants([]);
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
                {previewLinks.length > 0 && (
                    <div className="w-full flex flex-col gap-1.5">
                        <p className="text-[11px] text-slate-400 leading-relaxed">
                            Preview the variants on your live site (or share the links):
                        </p>
                        <PreviewLinks links={previewLinks} />
                    </div>
                )}
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
                                partVariants={partVariants}
                                onPartVariantsChange={setPartVariants}
                                styles={styles}
                                onStylesChange={setStyles}
                                imageSrc={imageSrc}
                                onImageSrcChange={setImageSrc}
                            />
                            {previewLinks.length > 0 && (
                                <div className="flex flex-col gap-1.5 mt-1">
                                    <p className="text-[11px] text-slate-400 leading-relaxed">
                                        See it before you commit — each link opens your live
                                        page with that variant applied. Needs the Sitewide
                                        snippet installed; records no data.
                                    </p>
                                    <PreviewLinks links={previewLinks} />
                                </div>
                            )}
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

                        {/* Step 5 — time-to-decision reality check */}
                        <DecisionEstimator
                            groupCount={Math.max(variantPayloads.length, 1) + 1}
                            onSampleSize={setEstSampleSize}
                        />
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
