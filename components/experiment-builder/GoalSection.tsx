"use client";

import { GoalType, PageElement } from "@/lib/types";

type Props = {
    goalType: GoalType;
    onGoalTypeChange: (type: GoalType) => void;
    goalElement: PageElement | null;
    pickingGoal: boolean;
    onStartPicking: () => void;
    onCancelPicking: () => void;
    goalPagePath: string;
    onPathChange: (path: string) => void;
};

// Step 3 in the builder sidebar: how a conversion gets counted.
//   click    → the user picks an element on the canvas (pickingGoal mode is
//              owned by the page, since the canvas needs to know about it)
//   pageview → the user types a path like /thank-you; reaching it converts.
//              This is how form submits are tracked without touching the form.
export default function GoalSection({
    goalType,
    onGoalTypeChange,
    goalElement,
    pickingGoal,
    onStartPicking,
    onCancelPicking,
    goalPagePath,
    onPathChange,
}: Props) {
    return (
        <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-1 bg-slate-100 rounded-lg p-1">
                <GoalTab
                    active={goalType === "click"}
                    label="Element click"
                    onClick={() => onGoalTypeChange("click")}
                />
                <GoalTab
                    active={goalType === "pageview"}
                    label="Page visit"
                    onClick={() => onGoalTypeChange("pageview")}
                />
            </div>

            {goalType === "click" ? (
                <div className="flex flex-col gap-2">
                    {goalElement ? (
                        <div className="flex items-center justify-between gap-2 bg-emerald-50 border border-emerald-200 rounded-md py-2 px-3">
                            <p className="text-xs text-emerald-800 truncate">
                                <span className="font-semibold uppercase text-[10px] tracking-wider mr-1.5">
                                    {goalElement.tag}
                                </span>
                                {goalElement.text ?? goalElement.alt ?? "(no text)"}
                            </p>
                            <button
                                type="button"
                                onClick={onStartPicking}
                                className="text-[11px] text-emerald-600 hover:text-emerald-800 shrink-0 transition-colors"
                            >
                                Change
                            </button>
                        </div>
                    ) : pickingGoal ? (
                        <div className="flex items-center justify-between gap-2 bg-emerald-50 border border-dashed border-emerald-400 rounded-md py-2 px-3">
                            <p className="text-xs text-emerald-700">
                                Click the element on the page that counts as a conversion…
                            </p>
                            <button
                                type="button"
                                onClick={onCancelPicking}
                                className="text-[11px] text-slate-400 hover:text-slate-600 shrink-0 transition-colors"
                            >
                                Cancel
                            </button>
                        </div>
                    ) : (
                        <button
                            type="button"
                            onClick={onStartPicking}
                            className="text-xs text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md py-2 px-3 text-left transition-colors"
                        >
                            Pick the conversion element (e.g. your signup button)
                        </button>
                    )}
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                        We count a conversion when a visitor clicks this element.
                    </p>
                </div>
            ) : (
                <div className="flex flex-col gap-2">
                    <input
                        type="text"
                        value={goalPagePath}
                        onChange={(e) => onPathChange(e.target.value)}
                        placeholder="/thank-you"
                        className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-md py-2 px-3 focus:outline-none focus:border-orange-600 placeholder-slate-400"
                    />
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                        We count a conversion when a visitor reaches this path — great for
                        form submits that redirect to a confirmation page.
                    </p>
                </div>
            )}
        </div>
    );
}

function GoalTab({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`text-xs py-1.5 rounded-md transition-colors ${
                active ? "bg-white text-slate-800 font-medium shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}
        >
            {label}
        </button>
    );
}
