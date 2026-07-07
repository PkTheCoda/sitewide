"use client";

// One badge for every status string in the app (reports + experiments).
const TONES: Record<string, string> = {
    // experiments
    draft: "bg-stone-100 text-stone-600 border-stone-200",
    running: "bg-emerald-50 text-emerald-700 border-emerald-200",
    paused: "bg-amber-50 text-amber-700 border-amber-200",
    completed: "bg-sky-50 text-sky-700 border-sky-200",
    archived: "bg-stone-100 text-stone-500 border-stone-200",
    // reports
    pending: "bg-amber-50 text-amber-700 border-amber-200",
    processing: "bg-amber-50 text-amber-700 border-amber-200",
    complete: "bg-emerald-50 text-emerald-700 border-emerald-200",
    error: "bg-red-50 text-red-700 border-red-200",
};

export default function StatusBadge({ status }: { status: string }) {
    const tone = TONES[status] ?? TONES.draft;
    return (
        <span
            className={`inline-flex items-center text-[11px] font-medium capitalize px-2 py-0.5 rounded-full border ${tone}`}
        >
            {status}
        </span>
    );
}
