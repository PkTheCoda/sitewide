"use client";

import { ChangeType, PageElement, StyleChanges } from "@/lib/types";
import { LuEyeOff, LuTriangleAlert, LuX } from "react-icons/lu";
import { Hint } from "./ui";

const MAX_VARIANTS = 3;

export function isValidImageUrl(url: string) {
    return /^https?:\/\/\S+$/.test(url.trim());
}

type Props = {
    changeType: ChangeType;
    target: PageElement;
    textVariants: string[];
    onTextVariantsChange: (variants: string[]) => void;
    // Rich-text mode (elements with textParts): one string per text node per
    // variant. Seeded by BuilderSidebar with the original parts.
    partVariants: string[][];
    onPartVariantsChange: (variants: string[][]) => void;
    styles: StyleChanges;
    onStylesChange: (styles: StyleChanges) => void;
    imageSrc: string;
    onImageSrcChange: (src: string) => void;
};

// Step 2's body in the builder sidebar: renders the right inputs for the
// selected change type. This component is pure UI — all state lives in
// BuilderSidebar and flows down through props:
//   text  → original copy + up to MAX_VARIANTS variant cards (+ a warning when
//           the element has styled children that a plain-text swap would flatten)
//   style → color / background / font-size (empty field = keep original)
//   image → URL input + current-vs-new preview (founder hosts the image)
//   hide  → no inputs, just an explainer
export default function VariantFields({
    changeType,
    target,
    textVariants,
    onTextVariantsChange,
    partVariants,
    onPartVariantsChange,
    styles,
    onStylesChange,
    imageSrc,
    onImageSrcChange,
}: Props) {
    const originalText = target.text ?? target.alt;
    const richParts = target.textParts && target.textParts.length > 1 ? target.textParts : null;
    if (changeType === "hide") {
        return (
            <div className="flex items-start gap-2.5 bg-stone-50 border border-stone-200 rounded-lg p-3">
                <LuEyeOff className="size-4 text-stone-400 shrink-0 mt-0.5" />
                <p className="text-xs text-stone-500 leading-relaxed">
                    Visitors in the variant group won&apos;t see this element — a clean
                    way to test whether a section helps or hurts.
                </p>
            </div>
        );
    }

    if (changeType === "image") {
        const validUrl = isValidImageUrl(imageSrc);
        return (
            <div className="flex flex-col gap-3">
                {target.src && (
                    <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-medium uppercase tracking-wider text-stone-400">
                            Current image
                        </span>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={target.src}
                            alt="Current"
                            className="max-h-28 w-auto self-start rounded-lg border border-stone-200 bg-stone-50"
                        />
                    </div>
                )}
                <label className="flex flex-col gap-1">
                    <span className="flex items-center gap-1.5 text-[11px] text-stone-500">
                        New image URL
                        <Hint text="Host the image yourself (your site, a CDN…) and paste its link. Visitors in the variant group see it instead. Use the same dimensions as the original for best results." />
                    </span>
                    <input
                        type="text"
                        value={imageSrc}
                        onChange={(e) => onImageSrcChange(e.target.value)}
                        placeholder="https://yoursite.com/new-image.png"
                        className="text-xs text-stone-700 bg-stone-50 border border-stone-200 rounded-lg py-2 px-3 focus:outline-none focus:border-orange-600 placeholder:text-stone-400"
                    />
                </label>
                {validUrl && (
                    <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-medium uppercase tracking-wider text-stone-400">
                            Variant image
                        </span>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={imageSrc.trim()}
                            alt="Variant preview"
                            className="max-h-28 w-auto self-start rounded-lg border border-dashed border-orange-300 bg-stone-50"
                        />
                    </div>
                )}
            </div>
        );
    }

    if (changeType === "style") {
        return (
            <div className="flex flex-col gap-3">
                <StyleField
                    label="Text color"
                    value={styles.color ?? ""}
                    onChange={(color) => onStylesChange({ ...styles, color: color || undefined })}
                />
                <StyleField
                    label="Background color"
                    value={styles.backgroundColor ?? ""}
                    onChange={(backgroundColor) =>
                        onStylesChange({ ...styles, backgroundColor: backgroundColor || undefined })
                    }
                />
                <div className="flex items-center justify-between gap-3">
                    <label className="flex items-center gap-1.5 text-xs text-stone-600">
                        Font size
                        <Hint text="Any CSS size works — 24px, 1.5rem… Fields left empty keep the original value." />
                    </label>
                    <input
                        type="text"
                        value={styles.fontSize ?? ""}
                        onChange={(e) => onStylesChange({ ...styles, fontSize: e.target.value || undefined })}
                        placeholder="unchanged"
                        className="w-28 text-xs text-stone-700 bg-stone-50 border border-stone-200 rounded-lg py-1.5 px-2.5 focus:outline-none focus:border-orange-600 placeholder:text-stone-400"
                    />
                </div>
            </div>
        );
    }

    // text change — rich mode: one input per text part, styling preserved
    if (richParts) {
        return (
            <div className="flex flex-col gap-2">
                {originalText && (
                    <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-medium uppercase tracking-wider text-stone-400">
                                Original
                            </span>
                            <span className="text-[10px] font-robot text-stone-400 bg-stone-100 rounded-full px-1.5 py-px tabular-nums">
                                {richParts.length} styled parts
                            </span>
                            <Hint
                                text={`This element has ${richParts.length} separately-styled parts. Edit any of them — each part keeps its original styling (colors, gradients, links).`}
                            />
                        </div>
                        <p className="text-xs text-stone-600 leading-relaxed bg-stone-50 py-2 px-3 rounded-lg border border-stone-200">
                            {originalText}
                        </p>
                    </div>
                )}
                {partVariants.map((parts, idx) => {
                    const unchanged =
                        parts.map((p) => p.trim()).join(" ") ===
                        richParts.map((p) => p.trim()).join(" ");
                    return (
                        <div
                            key={idx}
                            className="flex flex-col gap-1.5 bg-white py-2.5 px-3 rounded-lg border border-dashed border-stone-300"
                        >
                            <div className="flex items-center justify-between">
                                <span className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold">
                                    Variant {String.fromCharCode(66 + idx)}
                                </span>
                                {partVariants.length > 1 && (
                                    <button
                                        type="button"
                                        onClick={() =>
                                            onPartVariantsChange(
                                                partVariants.filter((_, i) => i !== idx)
                                            )
                                        }
                                        className="text-stone-300 hover:text-rose-500 transition-colors cursor-pointer"
                                        aria-label={`Remove variant ${idx + 1}`}
                                    >
                                        <LuX className="size-3.5" />
                                    </button>
                                )}
                            </div>
                            {parts.map((part, p) => (
                                <input
                                    key={p}
                                    type="text"
                                    value={part}
                                    onChange={(e) => {
                                        const next = partVariants.map((v) => [...v]);
                                        next[idx][p] = e.target.value;
                                        onPartVariantsChange(next);
                                    }}
                                    placeholder={richParts[p]}
                                    className={`text-xs leading-relaxed py-1.5 px-2.5 rounded-md border focus:outline-none focus:border-orange-600 placeholder:text-stone-400 transition-colors ${
                                        part.trim() !== richParts[p]
                                            ? "text-orange-900 bg-orange-50 border-orange-200"
                                            : "text-stone-700 bg-stone-50 border-stone-200"
                                    }`}
                                />
                            ))}
                            {unchanged && (
                                <p className="text-[10px] text-amber-600">
                                    Edit at least one part — identical variants don&apos;t run.
                                </p>
                            )}
                        </div>
                    );
                })}
                {partVariants.length < MAX_VARIANTS && (
                    <button
                        type="button"
                        onClick={() => onPartVariantsChange([...partVariants, [...richParts]])}
                        className="w-full text-[11px] font-medium text-stone-500 hover:text-orange-600 border border-dashed border-stone-300 hover:border-orange-300 rounded-lg py-2 transition-colors cursor-pointer"
                    >
                        + Add another variant
                    </button>
                )}
                {partVariants.length > 1 && (
                    <p className="text-[10px] text-stone-400">
                        Each extra variant splits traffic — decisions take longer.
                    </p>
                )}
            </div>
        );
    }

    // text change — flat mode (no inner markup, or report predates textParts)
    return (
        <div className="flex flex-col gap-2">
            {originalText && (
                <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-medium uppercase tracking-wider text-stone-400">
                        Original
                    </span>
                    <p className="text-xs text-stone-600 leading-relaxed bg-stone-50 py-2 px-3 rounded-lg border border-stone-200">
                        {originalText}
                    </p>
                </div>
            )}
            {target.hasMarkup && (
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg py-2 px-2.5">
                    <LuTriangleAlert className="size-3.5 text-amber-500 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-amber-800 leading-relaxed">
                        This element has styled parts a plain-text swap would flatten.
                        Re-run the analysis to unlock part-by-part editing, or select
                        the styled part itself.
                    </p>
                </div>
            )}
            {textVariants.map((variant, idx) => (
                <div
                    key={idx}
                    className="flex flex-col gap-1 bg-white py-2.5 px-3 rounded-lg border border-dashed border-stone-300 focus-within:border-solid focus-within:border-orange-400 transition-colors"
                >
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold">
                            Variant {String.fromCharCode(66 + idx)}
                        </span>
                        {textVariants.length > 1 && (
                            <button
                                type="button"
                                onClick={() =>
                                    onTextVariantsChange(textVariants.filter((_, i) => i !== idx))
                                }
                                className="text-stone-300 hover:text-rose-500 transition-colors cursor-pointer"
                                aria-label={`Remove variant ${idx + 1}`}
                            >
                                <LuX className="size-3.5" />
                            </button>
                        )}
                    </div>
                    <textarea
                        value={variant}
                        onChange={(e) => {
                            const next = [...textVariants];
                            next[idx] = e.target.value;
                            onTextVariantsChange(next);
                        }}
                        placeholder="New copy for this variant…"
                        rows={2}
                        className="text-xs text-stone-700 leading-relaxed bg-transparent focus:outline-none placeholder:text-stone-400 resize-none"
                    />
                </div>
            ))}
            {textVariants.length < MAX_VARIANTS && (
                <button
                    type="button"
                    onClick={() => onTextVariantsChange([...textVariants, ""])}
                    className="w-full text-[11px] font-medium text-stone-500 hover:text-orange-600 border border-dashed border-stone-300 hover:border-orange-300 rounded-lg py-2 transition-colors cursor-pointer"
                >
                    + Add another variant
                </button>
            )}
            {textVariants.length > 1 && (
                <p className="text-[10px] text-stone-400">
                    Each extra variant splits traffic — decisions take longer.
                </p>
            )}
        </div>
    );
}

function StyleField({
    label,
    value,
    onChange,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
}) {
    return (
        <div className="flex items-center justify-between gap-3">
            <label className="text-xs text-stone-600">{label}</label>
            <div className="flex items-center gap-2">
                <input
                    type="color"
                    value={value || "#000000"}
                    onChange={(e) => onChange(e.target.value)}
                    className="size-7 rounded-md border border-stone-200 cursor-pointer bg-white p-0.5"
                />
                <input
                    type="text"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder="unchanged"
                    className="w-24 text-xs text-stone-700 bg-stone-50 border border-stone-200 rounded-lg py-1.5 px-2.5 focus:outline-none focus:border-orange-600 placeholder:text-stone-400"
                />
            </div>
        </div>
    );
}
