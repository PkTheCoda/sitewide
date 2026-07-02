"use client";

import { Comment, Severity } from "@/lib/types";

export const SEVERITY_COLORS: Record<Severity, { border: string; bg: string; text: string, bgOpacity: string }> = {
    critical: { border: "border-red-500", bg: "bg-red-600", text: "text-red-700", bgOpacity: "bg-red-600/10" },
    warning: { border: "border-amber-500", bg: "bg-amber-600", text: "text-amber-700", bgOpacity: "bg-amber-600/10" },
    suggestion: { border: "border-blue-500", bg: "bg-blue-600", text: "text-blue-700", bgOpacity: "bg-blue-600/10" },
};

type Props = {
    comment: Comment;
    index: number;
    active: boolean;
    onClick: () => void;
    registerRef: (el: HTMLDivElement | null) => void;
};

export default function CommentPin({ comment, index, active, onClick, registerRef }: Props) {
    const colors = SEVERITY_COLORS[comment.severity] ?? SEVERITY_COLORS["suggestion"];
    const dashed = comment.confidence < 0.6;

    return (
        <div className="flex items-center">
            <div
                ref={registerRef}
                onClick={onClick}
                className={`absolute rounded-md cursor-pointer transition-shadow 
                ${colors.border} ${dashed ? "border-dashed" : "border-solid"} 
                ${active ? `ring-2 ring-orange-600 ring-offset-1 ${colors.bgOpacity}` : "border-2"}
                `
            }
                style={{
                    top: `${comment.top_pct * 100}%`,
                    left: `${comment.left_pct * 100}%`,
                    width: `${comment.width_pct * 100}%`,
                    height: `${comment.height_pct * 100}%`,
                }}
            >
            {/* <div className={`${colors.bg} h-full flex items-center justify-center rounded-l-lg w-max px-2 text-white`}>
                {index + 1}
            </div> */}
            </div>
        </div>
    );
}
