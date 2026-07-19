"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useAuth } from "@/services/context/authContext";
import { supabase } from "@/lib/supabaseClient";
import { analyzeUrl, getComments, getReport } from "@/lib/reports";
import { ensureSite, getSites } from "@/lib/experiments";
import { Comment, Report, Site } from "@/lib/types";
import SnippetInstructions from "@/components/dashboard/SnippetInstructions";
import { LuArrowLeft, LuCheck, LuSparkles } from "react-icons/lu";

import logo from "@/public/assets/sitewide-logo-v7.svg";

// ─── Onboarding ──────────────────────────────────────────────────────────────
//
// The one goal: get a brand-new founder from "signed up" to "looking at real
// findings on their own site" in a single sitting. Steps:
//
//   intro     → who are you (source + traffic band, stored in user metadata)
//   site      → their URL
//   analyzing → the wow moment: the agent reads their page while they watch
//   reveal    → "we found N things worth testing" + the top finding
//   snippet   → install + live verification (skippable — never force a drop)
//
// Routing contract (the rest lives in ProtectedRoute / the dashboard shell):
//   not signed in            → /signin
//   signed in + completed    → /dashboard
//   signed in + not completed + on /dashboard → here (shell layout handles it)
//
// State survives refreshes via user metadata: answers are saved per step, and
// a finished analysis stores its report_id so we never bill a second crawl.

type Step = "intro" | "site" | "analyzing" | "reveal" | "snippet";

const SOURCES = ["X / Twitter", "Reddit", "A friend or referral", "Search", "Somewhere else"];
const TRAFFIC_BANDS = ["Under 5k", "5k – 20k", "20k – 100k", "100k+"];

// Honest-ish stage narration for the ~30-60s analysis. Timings roughly track
// the real pipeline (crawl → screenshot → extraction → Claude).
const ANALYSIS_STAGES = [
    "Crawling your page",
    "Taking a full-page screenshot",
    "Extracting your page's content",
    "Reading your copy like a CRO strategist",
    "Picking what's worth testing first",
];

const STEP_LABELS: { key: Step[]; label: string }[] = [
    { key: ["intro"], label: "About you" },
    { key: ["site"], label: "Your site" },
    { key: ["analyzing", "reveal"], label: "Analysis" },
    { key: ["snippet"], label: "Install" },
];

const IMPACT_RANK: Record<string, number> = { High: 3, Medium: 2, Low: 1 };

export default function OnboardingPage() {
    const { user, loading } = useAuth();
    const router = useRouter();

    const [step, setStep] = useState<Step>("intro");
    const [source, setSource] = useState<string | null>(null);
    const [traffic, setTraffic] = useState<string | null>(null);
    const [siteUrl, setSiteUrl] = useState("");
    const [siteError, setSiteError] = useState<string | null>(null);

    const [analysisError, setAnalysisError] = useState<string | null>(null);
    const [stageIndex, setStageIndex] = useState(0);
    const [report, setReport] = useState<Report | null>(null);
    const [comments, setComments] = useState<Comment[]>([]);
    const [site, setSite] = useState<Site | null>(null);
    const [verified, setVerified] = useState(false);
    const [finishing, setFinishing] = useState(false);
    const hydrated = useRef(false);

    // Accumulated onboarding answers. Kept in a ref (seeded from user
    // metadata on hydrate) so consecutive saves can't race the auth context's
    // USER_UPDATED refresh and wipe earlier answers.
    const metaRef = useRef<Record<string, string | undefined>>({});

    // ── Route guards ─────────────────────────────────────────────────────────
    // `finishing` suppresses the completed-redirect: finish() sets the flag
    // and navigates to the report itself — this guard must not clobber that.
    const completed = !!user?.user_metadata?.onboarding_completed;
    useEffect(() => {
        if (loading || finishing) return;
        if (!user) router.replace("/signin");
        else if (completed) router.replace("/dashboard");
    }, [loading, user, completed, finishing, router]);

    // ── Resume from a previous attempt (refresh mid-flow) ───────────────────
    useEffect(() => {
        if (!user || hydrated.current) return;
        hydrated.current = true;
        metaRef.current = {
            ...((user.user_metadata?.onboarding ?? {}) as Record<string, string | undefined>),
        };
        const meta = metaRef.current;
        if (meta.source) setSource(meta.source);
        if (meta.traffic) setTraffic(meta.traffic);
        if (meta.site_url) setSiteUrl(meta.site_url);
        // Analysis already paid for? Jump straight past it.
        if (meta.report_id && meta.site_url) {
            loadReveal(meta.report_id, meta.site_url).then((ok) => {
                if (ok) setStep("reveal");
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user]);

    // ── Metadata persistence ─────────────────────────────────────────────────
    // Supabase merges `data` shallowly per top-level key, so `onboarding` is
    // replaced wholesale — always write the full accumulated object.
    async function saveMeta(patch: Record<string, string>) {
        metaRef.current = { ...metaRef.current, ...patch };
        await supabase.auth.updateUser({
            data: { onboarding: metaRef.current },
        });
    }

    // ── Analysis ─────────────────────────────────────────────────────────────
    // Warn before closing the tab while the (billed) analysis runs.
    useEffect(() => {
        if (step !== "analyzing") return;
        const warn = (e: BeforeUnloadEvent) => e.preventDefault();
        window.addEventListener("beforeunload", warn);
        return () => window.removeEventListener("beforeunload", warn);
    }, [step]);

    // Stage narration ticker.
    useEffect(() => {
        if (step !== "analyzing") return;
        setStageIndex(0);
        const timer = setInterval(
            () => setStageIndex((i) => Math.min(i + 1, ANALYSIS_STAGES.length - 1)),
            7000
        );
        return () => clearInterval(timer);
    }, [step]);

    const loadReveal = useCallback(
        async (reportId: string, url: string): Promise<boolean> => {
            if (!user) return false;
            const [reportData, commentData, siteData] = await Promise.all([
                getReport(reportId),
                getComments(reportId),
                ensureSite(user.id, url),
            ]);
            if (!reportData || "error" in reportData) return false;
            setReport(reportData as Report);
            if (Array.isArray(commentData)) setComments(commentData as Comment[]);
            if (siteData && !("error" in siteData)) setSite(siteData);
            return true;
        },
        [user]
    );

    async function startAnalysis() {
        if (!user) return;
        const trimmed = siteUrl.trim();
        try {
            new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
        } catch {
            setSiteError("That doesn't look like a URL — try yourstartup.com");
            return;
        }
        setSiteError(null);
        setAnalysisError(null);
        saveMeta({ site_url: trimmed });
        setStep("analyzing");

        const result = await analyzeUrl(trimmed, user.id);
        if ("error" in result && result.error) {
            setAnalysisError(result.error);
            return;
        }
        if ("report_id" in result) {
            const reportId = String(result.report_id);
            await saveMeta({ site_url: trimmed, report_id: reportId });
            const ok = await loadReveal(reportId, trimmed);
            if (ok) setStep("reveal");
            else setAnalysisError("The analysis finished but the report couldn't be loaded.");
        }
    }

    // ── Snippet verification (poll while on the install step) ────────────────
    useEffect(() => {
        if (step !== "snippet" || !user || !site || verified) return;
        const seenRecently = (s: Site) =>
            !!s.snippet_last_seen_at &&
            Date.now() - new Date(s.snippet_last_seen_at).getTime() < 3 * 60_000;
        if (seenRecently(site)) {
            setVerified(true);
            return;
        }
        const timer = setInterval(async () => {
            const sites = await getSites(user.id);
            if (Array.isArray(sites)) {
                const fresh = (sites as Site[]).find((s) => s.id === site.id);
                if (fresh && seenRecently(fresh)) {
                    setVerified(true);
                    clearInterval(timer);
                }
            }
        }, 3000);
        return () => clearInterval(timer);
    }, [step, user, site, verified]);

    // ── Finish ───────────────────────────────────────────────────────────────
    async function finish(destination?: string) {
        if (finishing) return;
        setFinishing(true);
        // Set the flag BEFORE navigating — the dashboard guard reads it.
        await supabase.auth.updateUser({ data: { onboarding_completed: true } });
        router.replace(
            destination ?? (report ? `/dashboard/report/${report.id}` : "/dashboard")
        );
    }

    if (loading || !user || completed) return null;

    // ── Derived ──────────────────────────────────────────────────────────────
    const stepIndex = STEP_LABELS.findIndex((s) => s.key.includes(step));
    const topFinding = [...comments].sort(
        (a, b) => (IMPACT_RANK[b.meta?.impact ?? ""] ?? 0) - (IMPACT_RANK[a.meta?.impact ?? ""] ?? 0)
    )[0];

    return (
        <div className="min-h-screen bg-stone-100 flex items-center justify-center p-4">
            <div className="w-full max-w-2xl bg-white border border-stone-200 rounded-3xl shadow-xs p-8 sm:p-12 flex flex-col gap-8">
                {/* header: logo + progress */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Image src={logo} alt="Sitewide" className="h-8 w-max" />
                        <span className="font-medium tracking-tight text-stone-800">Sitewide</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        {STEP_LABELS.map((s, i) => (
                            <span
                                key={s.label}
                                className={`h-1.5 rounded-full transition-all ${
                                    i === stepIndex
                                        ? "w-6 bg-orange-600"
                                        : i < stepIndex
                                          ? "w-1.5 bg-orange-300"
                                          : "w-1.5 bg-stone-200"
                                }`}
                            />
                        ))}
                    </div>
                </div>

                {/* ── Step: intro ────────────────────────────────────────── */}
                {step === "intro" && (
                    <>
                        <div className="flex flex-col gap-1.5">
                            <h1 className="two-title font-semibold tracking-tight text-stone-900">
                                Welcome — tell us a little about you.
                            </h1>
                            <p className="text-stone-500 text-sm">
                                Two quick questions, then your site gets its first analysis.
                            </p>
                        </div>

                        <div className="flex flex-col gap-6">
                            <div className="flex flex-col gap-2.5">
                                <p className="text-sm font-medium text-stone-700">How did you find us?</p>
                                <div className="flex flex-wrap gap-2">
                                    {SOURCES.map((s) => (
                                        <Chip key={s} label={s} selected={source === s} onClick={() => setSource(s)} />
                                    ))}
                                </div>
                            </div>
                            <div className="flex flex-col gap-2.5">
                                <p className="text-sm font-medium text-stone-700">
                                    Roughly how many monthly visitors does your site get?
                                </p>
                                <div className="flex flex-wrap gap-2">
                                    {TRAFFIC_BANDS.map((t) => (
                                        <Chip key={t} label={t} selected={traffic === t} onClick={() => setTraffic(t)} />
                                    ))}
                                </div>
                                <p className="text-[11px] text-stone-400">
                                    This helps your agent set honest expectations for how long tests take.
                                </p>
                            </div>
                        </div>

                        <Footer
                            onContinue={() => {
                                saveMeta({ source: source ?? "", traffic: traffic ?? "" });
                                setStep("site");
                            }}
                            continueDisabled={!source || !traffic}
                            onSkip={() => finish("/dashboard")}
                        />
                    </>
                )}

                {/* ── Step: site ─────────────────────────────────────────── */}
                {step === "site" && (
                    <>
                        <div className="flex flex-col gap-1.5">
                            <h1 className="two-title font-semibold tracking-tight text-stone-900">
                                What&apos;s your site?
                            </h1>
                            <p className="text-stone-500 text-sm">
                                Your agent will crawl it and find what&apos;s worth testing — takes
                                about a minute.
                            </p>
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <input
                                autoFocus
                                type="url"
                                value={siteUrl}
                                onChange={(e) => setSiteUrl(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && siteUrl.trim() && startAnalysis()}
                                placeholder="https://yourstartup.com"
                                className="w-full text-sm text-stone-800 bg-stone-50 border border-stone-200 rounded-xl py-3.5 px-4 focus:outline-none focus:border-orange-600 placeholder:text-stone-400"
                            />
                            {siteError && <p className="text-xs text-red-600">{siteError}</p>}
                            <p className="text-[11px] text-stone-400">
                                Tip: use the page where conversions matter most — usually your landing
                                page.
                            </p>
                        </div>

                        <Footer
                            onBack={() => setStep("intro")}
                            onContinue={startAnalysis}
                            continueLabel="Analyze my site"
                            continueDisabled={!siteUrl.trim()}
                        />
                    </>
                )}

                {/* ── Step: analyzing ────────────────────────────────────── */}
                {step === "analyzing" && (
                    <div className="flex flex-col items-center gap-8 py-6 text-center">
                        {!analysisError ? (
                            <>
                                <div className="relative flex items-center justify-center">
                                    <span className="absolute size-16 rounded-full bg-orange-100 animate-ping opacity-40" />
                                    <span className="relative size-14 rounded-full bg-orange-50 border border-orange-200 flex items-center justify-center">
                                        <LuSparkles className="size-6 text-orange-600" />
                                    </span>
                                </div>
                                <div className="flex flex-col gap-2 items-center">
                                    <h1 className="one-title font-semibold tracking-tight text-stone-900">
                                        Your agent is reading{" "}
                                        <span className="text-orange-600">
                                            {siteUrl.replace(/^https?:\/\//, "")}
                                        </span>
                                    </h1>
                                    <p className="text-sm text-stone-500">
                                        Hang tight — this is the part where it earns its keep.
                                    </p>
                                </div>
                                <div className="flex flex-col gap-2 w-full max-w-sm text-left">
                                    {ANALYSIS_STAGES.map((stage, i) => (
                                        <div
                                            key={stage}
                                            className={`flex items-center gap-2.5 text-sm transition-colors ${
                                                i < stageIndex
                                                    ? "text-stone-400"
                                                    : i === stageIndex
                                                      ? "text-stone-800 font-medium"
                                                      : "text-stone-300"
                                            }`}
                                        >
                                            {i < stageIndex ? (
                                                <LuCheck className="size-4 text-emerald-500 shrink-0" />
                                            ) : i === stageIndex ? (
                                                <span className="size-4 flex items-center justify-center shrink-0">
                                                    <span className="size-2 rounded-full bg-orange-500 animate-pulse" />
                                                </span>
                                            ) : (
                                                <span className="size-4 flex items-center justify-center shrink-0">
                                                    <span className="size-1.5 rounded-full bg-stone-200" />
                                                </span>
                                            )}
                                            <span>
                                                {stage}
                                                {i === stageIndex && <AnimatedDots />}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="flex flex-col gap-2 items-center">
                                    <h1 className="one-title font-semibold tracking-tight text-stone-900">
                                        That didn&apos;t work
                                    </h1>
                                    <p className="text-sm text-stone-500 max-w-sm leading-relaxed">
                                        {analysisError}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => setStep("site")}
                                        className="text-sm font-medium text-white bg-orange-600 hover:bg-orange-700 rounded-xl px-6 py-2.5 transition-colors cursor-pointer"
                                    >
                                        Try again
                                    </button>
                                    <button
                                        onClick={() => finish("/dashboard")}
                                        disabled={finishing}
                                        className="text-sm font-medium text-stone-500 hover:text-stone-700 rounded-xl px-4 py-2.5 transition-colors disabled:opacity-50 cursor-pointer"
                                    >
                                        Skip for now
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                )}

                {/* ── Step: reveal ───────────────────────────────────────── */}
                {step === "reveal" && report && (
                    <>
                        <div className="flex flex-col gap-1.5">
                            <p className="text-[11px] font-medium uppercase tracking-wider text-emerald-600">
                                Analysis complete
                            </p>
                            <h1 className="two-title font-semibold tracking-tight text-stone-900">
                                We found{" "}
                                <span className="text-orange-600">
                                    {comments.length} thing{comments.length === 1 ? "" : "s"}
                                </span>{" "}
                                worth testing.
                            </h1>
                            <p className="text-stone-500 text-sm">
                                {report.overall_score !== null && (
                                    <>
                                        Your page scored{" "}
                                        <span className="font-robot font-semibold text-stone-700">
                                            {report.overall_score}/10
                                        </span>
                                        {" — "}
                                    </>
                                )}
                                the full report is waiting for you, pins and all.
                            </p>
                        </div>

                        {topFinding && (
                            <div className="border border-stone-200 bg-stone-50 rounded-2xl p-5 flex flex-col gap-2">
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-medium uppercase tracking-wider text-orange-600 bg-orange-50 border border-orange-200 rounded-full px-2 py-0.5">
                                        Top finding
                                    </span>
                                    {topFinding.meta?.impact && (
                                        <span className="text-[10px] text-stone-400">
                                            {topFinding.meta.impact} impact
                                        </span>
                                    )}
                                </div>
                                <p className="text-sm text-stone-800 leading-relaxed">
                                    {topFinding.comment}
                                </p>
                                {topFinding.suggestion && (
                                    <p className="text-xs text-stone-500 leading-relaxed">
                                        <span className="font-medium text-stone-600">Suggestion: </span>
                                        {topFinding.suggestion}
                                    </p>
                                )}
                            </div>
                        )}

                        <Footer onContinue={() => setStep("snippet")} continueLabel="One last step" />
                    </>
                )}

                {/* ── Step: snippet ──────────────────────────────────────── */}
                {step === "snippet" && (
                    <>
                        <div className="flex flex-col gap-1.5">
                            <h1 className="two-title font-semibold tracking-tight text-stone-900">
                                Connect your site.
                            </h1>
                            <p className="text-stone-500 text-sm">
                                One script tag lets your agent run experiments and track results. You
                                can also do this later — your report isn&apos;t going anywhere.
                            </p>
                        </div>

                        {site ? (
                            <div className="flex flex-col gap-3">
                                <SnippetInstructions siteId={site.id} />
                                <div
                                    className={`flex items-center gap-2.5 rounded-xl border px-4 py-3 text-sm transition-colors ${
                                        verified
                                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                            : "border-stone-200 bg-white text-stone-500"
                                    }`}
                                >
                                    {verified ? (
                                        <>
                                            <LuCheck className="size-4 shrink-0" />
                                            <span className="font-medium">
                                                We heard from {site.domain} — you&apos;re live.
                                            </span>
                                        </>
                                    ) : (
                                        <>
                                            <span className="relative flex size-2.5 shrink-0">
                                                <span className="animate-ping absolute h-full w-full rounded-full bg-orange-400 opacity-60" />
                                                <span className="relative rounded-full size-2.5 bg-orange-500" />
                                            </span>
                                            <span>
                                                Listening for {site.domain}
                                                <AnimatedDots /> paste the tag, deploy, and this turns
                                                green.
                                            </span>
                                        </>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <p className="text-xs text-stone-400">
                                Snippet setup will be available from your dashboard.
                            </p>
                        )}

                        <Footer
                            onBack={() => setStep(report ? "reveal" : "site")}
                            onContinue={() => finish()}
                            continueLabel={verified ? "Finish — see my report" : "See my report"}
                            secondaryLabel={verified ? undefined : "Skip for now"}
                            onSecondary={verified ? undefined : () => finish()}
                            continueDisabled={finishing}
                        />
                    </>
                )}
            </div>
        </div>
    );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function Chip({
    label,
    selected,
    onClick,
}: {
    label: string;
    selected: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`text-sm rounded-xl border px-4 py-2.5 transition-colors cursor-pointer ${
                selected
                    ? "border-orange-600 bg-orange-50 text-orange-800 font-medium"
                    : "border-stone-200 text-stone-600 hover:border-stone-400"
            }`}
        >
            {label}
        </button>
    );
}

function Footer({
    onBack,
    onContinue,
    continueLabel = "Continue",
    continueDisabled = false,
    secondaryLabel,
    onSecondary,
    onSkip,
}: {
    onBack?: () => void;
    onContinue: () => void;
    continueLabel?: string;
    continueDisabled?: boolean;
    secondaryLabel?: string;
    onSecondary?: () => void;
    onSkip?: () => void;
}) {
    return (
        <div className="flex items-center justify-between pt-2">
            <div>
                {onBack && (
                    <button
                        onClick={onBack}
                        className="flex items-center gap-1.5 text-sm font-medium text-stone-600 border border-stone-200 hover:border-stone-400 rounded-xl px-4 py-2.5 transition-colors cursor-pointer"
                    >
                        <LuArrowLeft className="size-3.5" />
                        Go back
                    </button>
                )}
                {onSkip && (
                    <button
                        onClick={onSkip}
                        className="text-xs text-stone-400 hover:text-stone-600 transition-colors cursor-pointer"
                    >
                        Skip setup for now
                    </button>
                )}
            </div>
            <div className="flex items-center gap-2">
                {secondaryLabel && onSecondary && (
                    <button
                        onClick={onSecondary}
                        className="text-sm font-medium text-stone-500 hover:text-stone-700 rounded-xl px-4 py-2.5 transition-colors cursor-pointer"
                    >
                        {secondaryLabel}
                    </button>
                )}
                <button
                    onClick={onContinue}
                    disabled={continueDisabled}
                    className="text-sm font-medium text-white bg-orange-600 hover:bg-orange-700 disabled:bg-stone-300 disabled:cursor-not-allowed rounded-xl px-6 py-2.5 transition-colors cursor-pointer"
                >
                    {continueLabel}
                </button>
            </div>
        </div>
    );
}

function AnimatedDots() {
    return (
        <span className="inline-flex w-5">
            <span className="animate-pulse">.</span>
            <span className="animate-pulse [animation-delay:200ms]">.</span>
            <span className="animate-pulse [animation-delay:400ms]">.</span>
        </span>
    );
}
