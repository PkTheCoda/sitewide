"use client";

import { ReactNode } from "react";
import { LuCheck, LuInfo } from "react-icons/lu";

// Tiny hover tooltip — replaces the sidebar's old inline explainer paragraphs
// so each step stays scannable. Left-anchored (not centered) so it never clips
// against the sidebar's overflow-y scroll container.
export function Hint({ text, side = "bottom" }: { text: string; side?: "top" | "bottom" }) {
    return (
        <span className="group/hint relative inline-flex items-center">
            <LuInfo className="size-3.5 text-stone-300 group-hover/hint:text-stone-500 transition-colors cursor-help" />
            <span
                role="tooltip"
                className={`pointer-events-none absolute left-0 z-50 w-56 rounded-lg bg-stone-800 px-3 py-2 text-[11px] font-normal normal-case tracking-normal leading-relaxed text-stone-100 shadow-lg opacity-0 group-hover/hint:opacity-100 transition-opacity duration-150 ${
                    side === "bottom" ? "top-full mt-1.5" : "bottom-full mb-1.5"
                }`}
            >
                {text}
            </span>
        </span>
    );
}

// One builder step: white card + status chip (number → orange when it's the
// step to do next, green check when complete).
export function StepCard({
    step,
    title,
    state,
    optional,
    hint,
    actions,
    children,
}: {
    step: number;
    title: string;
    state: "done" | "active" | "idle";
    optional?: boolean;
    hint?: string;
    actions?: ReactNode;
    children: ReactNode;
}) {
    return (
        <section className="bg-white border border-stone-200 rounded-xl shadow-xs p-3.5 flex flex-col gap-2.5">
            <div className="flex items-center gap-2">
                <span
                    className={`size-5 rounded-full flex items-center justify-center shrink-0 text-[10px] font-robot font-semibold tabular-nums ${
                        state === "done"
                            ? "bg-emerald-100 text-emerald-600"
                            : state === "active"
                              ? "bg-orange-100 text-orange-700"
                              : "bg-stone-100 text-stone-400"
                    }`}
                >
                    {state === "done" ? <LuCheck className="size-3" strokeWidth={3} /> : step}
                </span>
                <h4 className="text-xs font-semibold tracking-tight text-stone-800">{title}</h4>
                {hint && <Hint text={hint} />}
                <span className="ml-auto flex items-center gap-2">
                    {optional && (
                        <span className="text-[10px] font-medium text-stone-400 bg-stone-100 rounded-full px-2 py-0.5">
                            Optional
                        </span>
                    )}
                    {actions}
                </span>
            </div>
            {children}
        </section>
    );
}

// Segmented control shared by change type, goal type, and expected impact —
// the same pill-in-tray pattern the dashboard uses.
export function Segmented<T extends string>({
    options,
    value,
    onChange,
}: {
    options: { value: T; label: string; hint?: string }[];
    value: T;
    onChange: (value: T) => void;
}) {
    return (
        <div
            className="grid gap-1 bg-stone-100 rounded-lg p-1"
            style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
        >
            {options.map((option) => (
                <button
                    key={option.value}
                    type="button"
                    onClick={() => onChange(option.value)}
                    className={`flex flex-col items-center py-1.5 rounded-md transition-colors cursor-pointer ${
                        value === option.value ? "bg-white shadow-sm" : "hover:bg-white/60"
                    }`}
                >
                    <span
                        className={`text-xs ${
                            value === option.value
                                ? "text-stone-800 font-medium"
                                : "text-stone-500"
                        }`}
                    >
                        {option.label}
                    </span>
                    {option.hint && (
                        <span className="text-[10px] text-stone-400">{option.hint}</span>
                    )}
                </button>
            ))}
        </div>
    );
}
