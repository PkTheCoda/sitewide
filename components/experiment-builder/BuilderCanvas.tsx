"use client";

import { useRef, useState } from "react";
import { PageElement } from "@/lib/types";

type Props = {
    screenshotUrl: string;
    elements: PageElement[];
    pageHeight: number;
    viewportWidth: number;
    // "target" = picking the element to change, "goal" = picking the conversion element
    mode: "target" | "goal";
    targetId: number | null;
    goalId: number | null;
    onSelect: (element: PageElement) => void;
};

// Convert an element's crawl-time pixel box to percentage positioning,
// same math as CommentPin — stays accurate at any rendered size.
function boxStyle(el: PageElement, pageHeight: number, viewportWidth: number) {
    return {
        top: `${(el.top / pageHeight) * 100}%`,
        left: `${(el.left / viewportWidth) * 100}%`,
        width: `${(el.width / viewportWidth) * 100}%`,
        height: `${(el.height / pageHeight) * 100}%`,
    };
}

export default function BuilderCanvas({
    screenshotUrl,
    elements,
    pageHeight,
    viewportWidth,
    mode,
    targetId,
    goalId,
    onSelect,
}: Props) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [hovered, setHovered] = useState<PageElement | null>(null);

    // Hit-testing happens on the container, not on per-element divs — element
    // boxes overlap (a section contains its h1), so instead we convert the mouse
    // position back to page pixels and pick the smallest box under the cursor.
    // Smallest wins = the innermost element, which is what the user is aiming at.
    function handleMouseMove(e: React.MouseEvent) {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;

        const pageX = ((e.clientX - rect.left) / rect.width) * viewportWidth;
        const pageY = ((e.clientY - rect.top) / rect.height) * pageHeight;

        let best: PageElement | null = null;
        for (const el of elements) {
            const inside =
                pageX >= el.left && pageX <= el.left + el.width &&
                pageY >= el.top && pageY <= el.top + el.height;
            if (!inside) continue;
            if (!best || el.width * el.height < best.width * best.height) best = el;
        }
        setHovered(best);
    }

    const hoverColor = mode === "goal" ? "border-emerald-500 bg-emerald-500/10" : "border-orange-600 bg-orange-600/10";
    const target = targetId !== null ? elements.find((el) => el.id === targetId) : null;
    const goal = goalId !== null ? elements.find((el) => el.id === goalId) : null;

    return (
        <div
            ref={containerRef}
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHovered(null)}
            onClick={() => hovered && onSelect(hovered)}
            className="relative w-full bg-white rounded-lg shadow-sm overflow-hidden cursor-crosshair"
        >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={screenshotUrl} alt="Page screenshot" className="block w-full h-auto select-none" draggable={false} />

            <div className="absolute inset-0 pointer-events-none">
                {/* selected target element */}
                {target && (
                    <div
                        className="absolute rounded-md border-2 border-orange-600 bg-orange-600/10"
                        style={boxStyle(target, pageHeight, viewportWidth)}
                    >
                        <span className="absolute -top-6 left-0 text-[10px] font-semibold uppercase tracking-wider text-white bg-orange-600 rounded px-1.5 py-0.5">
                            Testing
                        </span>
                    </div>
                )}

                {/* selected goal element */}
                {goal && (
                    <div
                        className="absolute rounded-md border-2 border-emerald-500 bg-emerald-500/10"
                        style={boxStyle(goal, pageHeight, viewportWidth)}
                    >
                        <span className="absolute -top-6 left-0 text-[10px] font-semibold uppercase tracking-wider text-white bg-emerald-500 rounded px-1.5 py-0.5">
                            Goal
                        </span>
                    </div>
                )}

                {/* hover highlight */}
                {hovered && hovered.id !== targetId && hovered.id !== goalId && (
                    <div
                        className={`absolute rounded-md border-2 border-dashed ${hoverColor}`}
                        style={boxStyle(hovered, pageHeight, viewportWidth)}
                    >
                        <span className="absolute -top-6 left-0 text-[10px] font-medium text-white bg-slate-800 rounded px-1.5 py-0.5">
                            {hovered.tag}
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
}
