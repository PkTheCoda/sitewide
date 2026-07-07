"use client";

// Stand-in for dashboard sections that don't exist yet (Analytics, Settings).
export default function PlaceholderSection({ title }: { title: string }) {
    return (
        <div className="flex flex-col gap-4">
            <div>
                <h2 className="text-lg font-medium tracking-tight text-stone-800">{title}</h2>
            </div>
            <div className="flex items-center justify-center bg-stone-50 border border-dashed border-stone-300 rounded-xl py-20">
                <p className="text-sm text-stone-400">Coming soon.</p>
            </div>
        </div>
    );
}
