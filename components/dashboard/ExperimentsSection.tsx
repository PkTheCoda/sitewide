"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/services/context/authContext";
import { getExperiments } from "@/lib/experiments";
import { Experiment } from "@/lib/types";
import ExperimentCard from "./ExperimentCard";
import Image from "next/image";

import ExperimentGraphic from "@/public/assets/dashboard-cta-2.svg"

// The Experiments tab: fetches every experiment the logged-in user owns
// (RLS enforces ownership — the query itself doesn't need a filter beyond
// user_id) and renders one ExperimentCard per row. `load` is passed down as
// onChanged so cards can refresh the whole list after activate/pause.
export default function ExperimentsSection() {
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
            <div className="flex justify-between gap-2 items-start">

                <div className="flex gap-x-2">
                    {/* <Image src={ExperimentGraphic} alt="Experiments" className="h-14 w-max" /> */}
                    <div className="flex flex-col gap-y-1">
                        <h2 className="two-title tracking-tight font-medium">Your Experiments</h2>
                        <p className="text-sm text-stone-500">
                            Manage, search, and analayze your drafted or ongoing experiments.
                        </p>
                    </div>
                </div>

                

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
                    <Link
                        href="/dashboard/analyses"
                        className="text-xs font-medium text-white bg-orange-600 hover:bg-orange-700 rounded-lg px-4 py-2 transition-colors"
                    >
                        Go to analyses
                    </Link>
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
