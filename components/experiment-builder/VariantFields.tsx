"use client";

import { ChangeType, PageElement, StyleChanges } from "@/lib/types";

const MAX_VARIANTS = 3;

export function isValidImageUrl(url: string) {
    return /^https?:\/\/\S+$/.test(url.trim());
}

type Props = {
    changeType: ChangeType;
    target: PageElement;
    textVariants: string[];
    onTextVariantsChange: (variants: string[]) => void;
    styles: StyleChanges;
    onStylesChange: (styles: StyleChanges) => void;
    imageSrc: string;
    onImageSrcChange: (src: string) => void;
};

export default function VariantFields({
    changeType,
    target,
    textVariants,
    onTextVariantsChange,
    styles,
    onStylesChange,
    imageSrc,
    onImageSrcChange,
}: Props) {
    const originalText = target.text ?? target.alt;
    if (changeType === "hide") {
        return (
            <p className="text-xs text-slate-500 leading-relaxed bg-slate-50 border border-slate-200 rounded-md p-3">
                Visitors in the variant group won&apos;t see this element. Useful for
                testing whether a section is helping or hurting conversions.
            </p>
        );
    }

    if (changeType === "image") {
        const validUrl = isValidImageUrl(imageSrc);
        return (
            <div className="flex flex-col gap-3">
                {target.src && (
                    <div className="flex flex-col gap-1">
                        <span className="text-[11px] text-slate-400">Current image</span>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={target.src}
                            alt="Current"
                            className="max-h-28 w-auto self-start rounded-md border border-slate-200 bg-slate-50"
                        />
                    </div>
                )}
                <input
                    type="text"
                    value={imageSrc}
                    onChange={(e) => onImageSrcChange(e.target.value)}
                    placeholder="https://yoursite.com/new-image.png"
                    className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-md py-2 px-3 focus:outline-none focus:border-orange-600 placeholder-slate-400"
                />
                {validUrl && (
                    <div className="flex flex-col gap-1">
                        <span className="text-[11px] text-slate-400">Variant image</span>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={imageSrc.trim()}
                            alt="Variant preview"
                            className="max-h-28 w-auto self-start rounded-md border border-dashed border-orange-300 bg-slate-50"
                        />
                    </div>
                )}
                <p className="text-[11px] text-slate-400 leading-relaxed">
                    Paste a link to an image you host (your site, a CDN…). Visitors in
                    the variant group see it instead of the current image. For best
                    results use the same dimensions as the original.
                </p>
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
                    <label className="text-xs text-slate-600">Font size</label>
                    <input
                        type="text"
                        value={styles.fontSize ?? ""}
                        onChange={(e) => onStylesChange({ ...styles, fontSize: e.target.value || undefined })}
                        placeholder="e.g. 24px"
                        className="w-28 text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-md py-1.5 px-2.5 focus:outline-none focus:border-orange-600 placeholder-slate-400"
                    />
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                    Leave a field empty to keep the original value.
                </p>
            </div>
        );
    }

    // text change
    return (
        <div className="flex flex-col gap-2">
            {originalText && (
                <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 py-2 px-3 rounded-md border border-slate-200">
                    {originalText}
                </p>
            )}
            {target.hasMarkup && (
                <p className="text-[11px] text-amber-800 leading-relaxed bg-amber-50 border border-amber-200 rounded-md py-2 px-3">
                    This element contains styled parts inside it (like a colored word or
                    a link). A text variant replaces everything as plain text, so that
                    styling is lost. Tip: you can often click the styled part itself on
                    the page and test just that piece.
                </p>
            )}
            {textVariants.map((variant, idx) => (
                <div key={idx} className="flex items-start gap-2">
                    <textarea
                        value={variant}
                        onChange={(e) => {
                            const next = [...textVariants];
                            next[idx] = e.target.value;
                            onTextVariantsChange(next);
                        }}
                        placeholder={`Variant ${String.fromCharCode(66 + idx)} copy…`}
                        rows={2}
                        className="flex-1 text-xs text-slate-700 leading-relaxed bg-white py-2 px-3 rounded-md border border-dashed border-slate-300 focus:outline-none focus:border-orange-600 focus:border-solid placeholder-slate-400 resize-none transition-colors"
                    />
                    {textVariants.length > 1 && (
                        <button
                            type="button"
                            onClick={() => onTextVariantsChange(textVariants.filter((_, i) => i !== idx))}
                            className="text-slate-300 hover:text-red-500 text-sm px-1 pt-2 transition-colors"
                            aria-label={`Remove variant ${idx + 1}`}
                        >
                            ✕
                        </button>
                    )}
                </div>
            ))}
            {textVariants.length < MAX_VARIANTS && (
                <button
                    type="button"
                    onClick={() => onTextVariantsChange([...textVariants, ""])}
                    className="self-start text-xs text-slate-500 hover:text-orange-600 transition-colors"
                >
                    + Add another variant
                </button>
            )}
            <p className="text-[11px] text-slate-400 leading-relaxed">
                Each variant splits your traffic further — more variants means the
                test needs more visitors to reach a confident result.
            </p>
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
            <label className="text-xs text-slate-600">{label}</label>
            <div className="flex items-center gap-2">
                <input
                    type="color"
                    value={value || "#000000"}
                    onChange={(e) => onChange(e.target.value)}
                    className="size-7 rounded border border-slate-200 cursor-pointer bg-white p-0.5"
                />
                <input
                    type="text"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder="unchanged"
                    className="w-24 text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-md py-1.5 px-2.5 focus:outline-none focus:border-orange-600 placeholder-slate-400"
                />
            </div>
        </div>
    );
}
