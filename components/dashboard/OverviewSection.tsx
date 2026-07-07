"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useAuth } from "@/services/context/authContext";
import { analyzeUrl } from "@/lib/reports";

import dashboardCta1 from "@/public/assets/dashboard-cta-1-2.svg";
import dashboardCta2 from "@/public/assets/dashboard-cta-2.svg";

type Props = {
    displayName: string;
    onNavigate: (section: string) => void; // switches dashboard sections in-place
};

// The Overview tab (dashboard home). The analyze bar is the important part:
// it calls the analyze-page edge function directly (via lib/reports.analyzeUrl),
// waits the ~30-60s the crawl+Claude analysis takes, then redirects to the
// finished report. The CTA cards below it just focus the input / switch tabs.
export default function OverviewSection({ displayName, onNavigate }: Props) {
    const { user } = useAuth();
    const router = useRouter();

    const urlInputRef = useRef<HTMLInputElement>(null);
    const [url, setUrl] = useState("");
    const [analyzing, setAnalyzing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleAnalyze() {
        if (!user || !url.trim() || analyzing) return;
        setAnalyzing(true);
        setError(null);

        const result = await analyzeUrl(url.trim(), user.id);

        if ("error" in result && result.error) {
            setAnalyzing(false);
            setError(result.error);
        } else if ("report_id" in result) {
            router.push(`/dashboard/report/${result.report_id}`);
        }
    }

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-y-2">
                <h1 className="three-title tracking-tight">
                    What now, <span className="font-medium text-orange-600">@{displayName}?</span>
                </h1>
                <p className="text-stone-500">
                    Analyze a page, spin up an experiment, or check on your running tests.
                </p>
            </div>

            {/* Analyze bar — the front door of the whole product */}
            <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                    <input
                        ref={urlInputRef}
                        type="url"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleAnalyze()}
                        placeholder="https://yourstartup.com"
                        disabled={analyzing}
                        className="flex-1 text-sm text-stone-800 bg-stone-50 border border-stone-200 rounded-xl py-3 px-4 focus:outline-none focus:border-orange-600 placeholder:text-stone-400 disabled:opacity-60"
                    />
                    <button
                        onClick={handleAnalyze}
                        disabled={analyzing || !url.trim()}
                        className="text-sm font-medium text-white bg-orange-600 hover:bg-orange-700 disabled:bg-stone-300 disabled:cursor-not-allowed rounded-xl px-6 transition-colors"
                    >
                        {analyzing ? "Analyzing… ~30s" : "Analyze"}
                    </button>
                </div>
                {analyzing && (
                    <p className="text-xs text-stone-500">
                        Crawling the page, taking a screenshot, and running the CRO analysis.
                        You&apos;ll be redirected to the report when it&apos;s ready.
                    </p>
                )}
                {error && <p className="text-xs text-red-600">{error}</p>}
            </div>

            <div className="grid grid-cols-3 gap-3">
                {/* Analyze Page CTA Cards */}
                <button
                    onClick={() => urlInputRef.current?.focus()}
                    className="w-full bg-stone-50 rounded-2xl grid grid-cols-2 relative shadow-xs border border-stone-200 hover:bg-stone-200 hover:border-stone-400 cursor-pointer transition-colors text-left"
                >
                    <div className="p-4 flex flex-col justify-center gap-2 text-left">
                        <h1 className="one-title font-medium tracking-tight ">
                            Run new <br /> Site Analysis
                        </h1>
                        <p className="text-xs text-stone-500">
                            Analyze your page&apos;s funnel top to bottom.
                        </p>
                    </div>
                    <div className="flex justify-center items-end px-4 pt-4">
                        <Image src={dashboardCta1} alt="dashboard cta 1" className="w-full h-full shadow-xs" />
                    </div>
                </button>

                <button
                    onClick={() => onNavigate("analyses")}
                    className="w-full bg-stone-50 rounded-2xl grid grid-cols-2 relative shadow-xs border border-stone-200 hover:bg-stone-200 hover:border-stone-400 cursor-pointer transition-colors text-left"
                >
                    <div className="p-4 flex flex-col justify-center gap-2 text-left">
                        <h1 className="one-title font-medium tracking-tight ">
                            Create new <br /> Experiment
                        </h1>
                        <p className="text-xs text-stone-500">
                            Create a new A/B test on your pages.
                        </p>
                    </div>
                    <div className="flex justify-center items-end px-4 pt-4">
                        <Image src={dashboardCta2} alt="dashboard cta 2" className="w-full h-full shadow-xs" />
                    </div>
                </button>

                <button
                    onClick={() => onNavigate("experiments")}
                    className="w-full bg-stone-50 rounded-2xl grid grid-cols-2 relative shadow-xs border border-stone-200 hover:bg-stone-200 hover:border-stone-400 cursor-pointer transition-colors text-left"
                >
                    <div className="p-4 flex flex-col justify-center gap-2 text-left">
                        <h1 className="one-title font-medium tracking-tight ">
                            View your <br /> Experiments
                        </h1>
                        <p className="text-xs text-stone-500">
                            View your experiment analytics and results.
                        </p>
                    </div>
                    <div className="flex justify-center items-end px-4 pt-4">
                        <Image src={dashboardCta1} alt="dashboard cta 3" className="w-full h-full shadow-xs" />
                    </div>
                </button>
            </div>
        </div>
    );
}
