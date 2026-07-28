"use client";

import { GoalType, PageElement } from "@/lib/types";
import { LuMousePointerClick } from "react-icons/lu";
import { Segmented } from "./ui";

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
        <div className="flex flex-col gap-2.5">
            <Segmented<GoalType>
                options={[
                    { value: "click", label: "Element click" },
                    { value: "pageview", label: "Page visit" },
                ]}
                value={goalType}
                onChange={onGoalTypeChange}
            />

            {goalType === "click" ? (
                goalElement ? (
                    <div className="flex items-center justify-between gap-2 bg-emerald-50 border border-emerald-200 rounded-lg py-2 px-2.5">
                        <p className="text-xs text-emerald-800 truncate">
                            <span className="font-semibold uppercase text-[10px] tracking-wider mr-1.5">
                                {goalElement.tag}
                            </span>
                            {goalElement.text ?? goalElement.alt ?? "(no text)"}
                        </p>
                        <button
                            type="button"
                            onClick={onStartPicking}
                            className="text-[11px] font-medium text-emerald-600 hover:text-emerald-800 shrink-0 transition-colors cursor-pointer"
                        >
                            Change
                        </button>
                    </div>
                ) : pickingGoal ? (
                    <div className="flex items-center justify-between gap-2 bg-emerald-50 border border-dashed border-emerald-400 rounded-lg py-2.5 px-3">
                        <p className="text-xs text-emerald-700">
                            Now click the element that counts as a conversion…
                        </p>
                        <button
                            type="button"
                            onClick={onCancelPicking}
                            className="text-[11px] text-stone-400 hover:text-stone-600 shrink-0 transition-colors cursor-pointer"
                        >
                            Cancel
                        </button>
                    </div>
                ) : (
                    <button
                        type="button"
                        onClick={onStartPicking}
                        className="flex items-center gap-2 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-dashed border-emerald-300 rounded-lg py-2.5 px-3 transition-colors cursor-pointer"
                    >
                        <LuMousePointerClick className="size-3.5 shrink-0" />
                        Pick the conversion element on the page
                    </button>
                )
            ) : (
                <div className="flex flex-col gap-1.5">
                    <input
                        type="text"
                        value={goalPagePath}
                        onChange={(e) => onPathChange(e.target.value)}
                        placeholder="/thank-you"
                        className="text-xs text-stone-700 bg-stone-50 border border-stone-200 rounded-lg py-2 px-3 focus:outline-none focus:border-orange-600 placeholder:text-stone-400"
                    />
                    <p className="text-[11px] text-stone-400 leading-relaxed">
                        Reaching this path counts as a conversion — great for forms
                        that redirect to a confirmation page.
                    </p>
                </div>
            )}
        </div>
    );
}
