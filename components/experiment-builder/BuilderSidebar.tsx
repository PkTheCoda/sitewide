"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/services/context/authContext";
import { createExperiment, getLatestSnapshotForUrl } from "@/lib/experiments";
import { DECISION_FLOOR } from "@/lib/stats";
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
import { summarizeForPath } from "@/lib/analytics";
import PreviewLinks from "./PreviewLinks";
import { Hint, Segmented, StepCard } from "./ui";
import { buildPreviewLink } from "@/lib/preview";
import { LuCheck, LuCircleAlert } from "react-icons/lu";

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

    // Real traffic for this page (founder's PostHog snapshot, if connected) —
    // seeds the estimator's "monthly visitors" input so the founder doesn't
    // have to guess it. Null (no integration/snapshot) = today's behavior.
    const [pageVisitors, setPageVisitors] = useState<number | null>(null);
    useEffect(() => {
        let cancelled = false;
        getLatestSnapshotForUrl(report.url).then((snapshot) => {
            if (cancelled || !snapshot) return;
            const ctx = summarizeForPath(snapshot.payload, report.url);
            if (ctx && ctx.page_visitors > 0) setPageVisitors(ctx.page_visitors);
        });
        return () => {
            cancelled = true;
        };
    }, [report.url]);

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

    // ── Step status → progress meter, chips, and the "why is the button
    //    disabled" hint. One source of truth for all three. ──────────────────
    const steps = [
        { done: !!target },
        { done: !!target && changeValid },
        { done: goalValid },
        { done: !!target && !!name.trim() },
    ];
    const doneCount = steps.filter((s) => s.done).length;
    const activeStep = steps.findIndex((s) => !s.done); // -1 when all done
    const stepState = (idx: number): "done" | "active" | "idle" =>
        steps[idx].done ? "done" : idx === activeStep ? "active" : "idle";

    const missing: string[] = [];
    if (!target) missing.push("select an element on the page");
    else {
        if (!changeValid)
            missing.push(
                changeType === "text"
                    ? "write a variant that differs from the original"
                    : changeType === "style"
                      ? "set at least one style change"
                      : "paste a valid image URL"
            );
        if (!goalValid)
            missing.push(
                goalType === "click"
                    ? "pick the element that counts as a conversion"
                    : "enter a goal path starting with /"
            );
        if (!name.trim()) missing.push("give the experiment a name");
    }
    const nextMissing = missing[0] ?? null;

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
            // Just the flake-guard floor — the agent's sequential rule decides
            // when there's enough data, so no sample size is committed here.
            min_sample_size: DECISION_FLOOR,
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
            <aside className="sticky top-0 h-screen w-95 shrink-0 border-r border-stone-200 bg-stone-50 flex flex-col items-center justify-center gap-4 p-6">
                <div className="size-12 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600">
                    <LuCheck className="size-6" strokeWidth={2.5} />
                </div>
                <div className="text-center">
                    <h3 className="text-sm font-semibold tracking-tight text-stone-800">
                        Experiment created
                    </h3>
                    <p className="text-xs text-stone-500 mt-1 leading-relaxed">
                        Saved as a draft — one step left: activate it so it starts
                        showing variants to visitors.
                    </p>
                </div>
                {previewLinks.length > 0 && (
                    <div className="w-full bg-white border border-stone-200 rounded-xl shadow-xs p-3 flex flex-col gap-2">
                        <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-medium uppercase tracking-wider text-stone-400">
                                Live preview
                            </span>
                            <Hint text="Each link opens your live page with that variant applied — nothing is recorded. Share them with your cofounder." />
                        </div>
                        <PreviewLinks links={previewLinks} />
                    </div>
                )}
                <div className="flex flex-col gap-3 w-full mt-2">
                    <Link
                        href={`/dashboard/experiments/${createdId}`}
                        className="text-xs font-semibold text-center text-white bg-orange-600 hover:bg-orange-700 rounded-lg py-2.5 transition-colors drop-shadow-[0px_4px_0px_rgba(194,65,12,1)]"
                    >
                        Review &amp; activate →
                    </Link>
                    <button
                        onClick={resetForm}
                        className="cursor-pointer text-xs font-medium text-stone-600 bg-white hover:bg-stone-50 border border-stone-200 rounded-lg py-2.5 transition-colors"
                    >
                        Create another experiment
                    </button>
                    <Link
                        href={`/dashboard/report/${report.id}`}
                        className="text-xs text-center text-stone-500 hover:text-stone-700 py-1 transition-colors"
                    >
                        Back to report
                    </Link>
                </div>
            </aside>
        );
    }

    // ── Builder form ───────────────────────────────────────────────────────
    return (
        <aside className="sticky top-0 h-screen w-95 shrink-0 border-r border-stone-200 bg-stone-50 flex flex-col">
            {/* Header: what + where + how far along */}
            <div className="bg-white px-5 py-4 border-b border-stone-200 flex flex-col gap-2.5">
                <div className="min-w-0">
                    <h2 className="text-sm font-semibold tracking-tight text-stone-800">
                        New experiment
                    </h2>
                    <p className="text-xs text-stone-400 mt-0.5 truncate">{report.url}</p>
                </div>
                <div className="flex items-center gap-1.5">
                    {steps.map((step, i) => (
                        <span
                            key={i}
                            className={`h-1 flex-1 rounded-full transition-colors ${
                                step.done ? "bg-orange-500" : "bg-stone-200"
                            }`}
                        />
                    ))}
                    <span className="text-[10px] font-robot font-semibold text-stone-400 tabular-nums ml-1">
                        {doneCount}/4
                    </span>
                </div>
            </div>

            {!target ? (
                /* Empty state — nothing selected yet */
                <div className="flex-1 flex flex-col items-center justify-center text-center gap-5 px-6">
                    <Image src={sidebarEmpty} alt="" className="w-full h-auto" />
                    <div className="flex flex-col gap-1.5">
                        <h3 className="one-title tracking-tight font-medium text-stone-700">
                            Pick an element to test
                        </h3>
                        <p className="text-xs text-stone-500 leading-relaxed">
                            Hover the page preview and click the element you want to
                            experiment on — a headline, a button, an image.
                        </p>
                    </div>
                </div>
            ) : (
                <div className="flex-1 overflow-y-auto flex flex-col gap-3 p-4">
                    {/* Step 1 — element */}
                    <StepCard
                        step={1}
                        title="Element to test"
                        state={stepState(0)}
                        hint="Click any other element in the page preview to switch what you're testing."
                    >
                        <div className="flex items-center gap-2 bg-orange-50 border border-orange-200 rounded-lg py-2 px-2.5">
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-orange-600 bg-orange-100 rounded px-1.5 py-0.5 shrink-0">
                                {target.tag}
                            </span>
                            <p className="text-xs text-orange-900 truncate">
                                {target.text ?? target.alt ?? "(no text)"}
                            </p>
                        </div>
                    </StepCard>

                    {/* Step 2 — change */}
                    <StepCard
                        step={2}
                        title="What changes"
                        state={stepState(1)}
                        hint="This is the change visitors in the test group will see instead of the original."
                    >
                        <Segmented
                            options={target.tag === "img" ? IMAGE_CHANGE_TYPES : TEXT_CHANGE_TYPES}
                            value={changeType}
                            onChange={setChangeType}
                        />
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
                            <div className="flex flex-col gap-1.5 pt-2 border-t border-stone-100">
                                <div className="flex items-center gap-1.5">
                                    <span className="text-[10px] font-medium uppercase tracking-wider text-stone-400">
                                        Live preview
                                    </span>
                                    <Hint text="Each link opens your live page with that variant applied — nothing is recorded. Needs the Sitewide snippet installed on the page." />
                                </div>
                                <PreviewLinks links={previewLinks} />
                            </div>
                        )}
                    </StepCard>

                    {/* Step 3 — goal */}
                    <StepCard
                        step={3}
                        title="Conversion goal"
                        state={stepState(2)}
                        hint="The action that counts as a win — a click on your signup button, or reaching a page like /thank-you."
                    >
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
                    </StepCard>

                    {/* Step 4 — details */}
                    <StepCard step={4} title="Details" state={stepState(3)}>
                        <label className="flex flex-col gap-1">
                            <span className="text-[11px] text-stone-500">Name</span>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="Experiment name"
                                className="text-xs text-stone-700 bg-stone-50 border border-stone-200 rounded-lg py-2 px-3 focus:outline-none focus:border-orange-600 placeholder:text-stone-400"
                            />
                        </label>
                        <label className="flex flex-col gap-1">
                            <span className="text-[11px] text-stone-500">
                                Hypothesis <span className="text-stone-300">· optional</span>
                            </span>
                            <textarea
                                value={hypothesis}
                                onChange={(e) => setHypothesis(e.target.value)}
                                placeholder="e.g. A benefit-led headline will lift signups because…"
                                rows={2}
                                className="text-xs text-stone-700 leading-relaxed bg-stone-50 border border-stone-200 rounded-lg py-2 px-3 focus:outline-none focus:border-orange-600 placeholder:text-stone-400 resize-none"
                            />
                        </label>
                    </StepCard>

                    {/* Step 5 — time-to-decision reality check */}
                    <StepCard
                        step={5}
                        title="Time to decision"
                        state="idle"
                        optional
                        hint="Estimates how long this test is likely to run on your traffic. There's no fixed sample size — your agent checks daily and ends the test as soon as one version is confidently better."
                    >
                        <DecisionEstimator
                            groupCount={Math.max(variantPayloads.length, 1) + 1}
                            prefill={pageVisitors !== null ? { monthlyVisitors: pageVisitors } : null}
                        />
                    </StepCard>
                </div>
            )}

            {/* Footer — the CTA always says what it's waiting on */}
            <div className="bg-white border-t border-stone-200 p-4 flex flex-col gap-2.5">
                {submitError && (
                    <p className="text-xs text-rose-600 leading-relaxed">{submitError}</p>
                )}
                {!canSubmit && !submitting && nextMissing && (
                    <div className="flex items-center gap-2 text-[11px] text-stone-500">
                        <LuCircleAlert className="size-3.5 text-amber-500 shrink-0" />
                        <span>
                            <span className="font-medium text-stone-600">Next:</span>{" "}
                            {nextMissing}
                        </span>
                    </div>
                )}
                <button
                    onClick={handleSubmit}
                    disabled={!canSubmit}
                    className="cursor-pointer text-xs font-semibold text-white bg-orange-600 hover:bg-orange-700 rounded-lg py-2.5 transition-colors drop-shadow-[0px_4px_0px_rgba(194,65,12,1)] disabled:bg-stone-200 disabled:text-stone-400 disabled:cursor-not-allowed disabled:drop-shadow-none"
                >
                    {submitting ? "Creating…" : "Create experiment"}
                </button>
                <p className="text-[10px] text-stone-400 text-center mt-0.5">
                    Saves as a draft — you activate it whenever you&apos;re ready.
                </p>
            </div>
        </aside>
    );
}
