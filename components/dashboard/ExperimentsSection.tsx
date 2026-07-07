"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/services/context/authContext";
import { getExperiments } from "@/lib/experiments";
import { Experiment } from "@/lib/types";
import ExperimentCard from "./ExperimentCard";

type Props = {
    onNavigate: (section: string) => void;
};

// The Experiments tab: fetches every experiment the logged-in user owns
// (RLS enforces ownership — the query itself doesn't need a filter beyond
// user_id) and renders one ExperimentCard per row. `load` is passed down as
// onChanged so cards can refresh the whole list after activate/pause.
export default function ExperimentsSection({ onNavigate }: Props) {
    const { user } = useAuth();
    const [experiments, setExperiments] = useState<Experiment[] | null>(null);

    const load = useCallback(async () => {
        if (!user) return;
        const data = await getExperiments(user.id);
        if (Array.isArray(data)) setExperiments(data as Experiment[]);
        else setExperiments([]);
    }, [user]);

    useEffect(() => {
        load();
    }, [load]);

    return (
        <div className="flex flex-col gap-4">
            <div>
                <h2 className="text-lg font-medium tracking-tight text-stone-800">Experiments</h2>
                <p className="text-sm text-stone-500">
                    Your A/B tests — drafts, live tests, and finished winners.
                </p>
            </div>

            {experiments === null ? (
                <p className="text-sm text-stone-400">Loading experiments…</p>
            ) : experiments.length === 0 ? (
                <div className="flex flex-col items-center gap-3 bg-stone-50 border border-dashed border-stone-300 rounded-xl py-14 text-center">
                    <p className="text-sm text-stone-600 font-medium">No experiments yet</p>
                    <p className="text-xs text-stone-500 max-w-sm leading-relaxed">
                        Run an analysis, open the report, and click any element on your page
                        to create your first A/B test.
                    </p>
                    <button
                        onClick={() => onNavigate("analyses")}
                        className="text-xs font-medium text-white bg-orange-600 hover:bg-orange-700 rounded-lg px-4 py-2 transition-colors"
                    >
                        Go to analyses
                    </button>
                </div>
            ) : (
                <div className="flex flex-col gap-3">
                    {experiments.map((experiment) => (
                        <ExperimentCard key={experiment.id} experiment={experiment} onChanged={load} />
                    ))}
                </div>
            )}
        </div>
    );
}
