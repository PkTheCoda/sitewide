"use client";

import { Comment, Severity } from "@/lib/types";

export const SEVERITY_COLORS: Record<Severity, { border: string; bg: string; text: string }> = {
    critical: { border: "border-red-500", bg: "bg-red-500", text: "text-red-700" },
    warning: { border: "border-amber-500", bg: "bg-amber-500", text: "text-amber-700" },
    suggestion: { border: "border-blue-500", bg: "bg-blue-500", text: "text-blue-700" },
    positive: { border: "border-green-500", bg: "bg-green-500", text: "text-green-700" },
};

type Props = {
    comment: Comment;
    index: number;
    active: boolean;
    onClick: () => void;
    registerRef: (el: HTMLDivElement | null) => void;
};

export default function CommentPin({ comment, index, active, onClick, registerRef }: Props) {
    const colors = SEVERITY_COLORS[comment.severity];
    const dashed = comment.confidence < 0.6;

    return (
        <div
            ref={registerRef}
            onClick={onClick}
            className={`absolute rounded-sm border-2 cursor-pointer transition-shadow ${colors.border} ${
                dashed ? "border-dashed" : "border-solid"
            } ${active ? "ring-2 ring-orange-500 ring-offset-1" : ""}`}
            style={{
                top: `${comment.top_pct * 100}%`,
                left: `${comment.left_pct * 100}%`,
                width: `${comment.width_pct * 100}%`,
                height: `${comment.height_pct * 100}%`,
            }}
        >
            <span
                className={`absolute -top-3 -left-3 flex items-center justify-center w-6 h-6 rounded-full text-white text-xs font-semibold shadow ${colors.bg}`}
            >
                {index + 1}
            </span>
        </div>
    );
}
