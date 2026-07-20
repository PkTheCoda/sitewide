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
import {
    LuArrowLeft,
    LuCamera,
    LuCheck,
    LuCog,
    LuEye,
    LuFileText,
    LuGlobe,
    LuHourglass,
    LuSparkles,
    LuTarget,
} from "react-icons/lu";
import Link from "next/link";
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
    { label: "Crawling your page", icon: LuGlobe },
    { label: "Taking a full-page screenshot", icon: LuCamera },
    { label: "Extracting your page's content", icon: LuFileText },
    { label: "Reading your copy like a CRO strategist", icon: LuSparkles },
    { label: "Picking what's worth testing first", icon: LuTarget },
];

// Bookends for the stage carousel, purely visual: the two "already done"
// rows fill the slots above the first active stage (true by this point —
// answers saved, analysis queued), and the trailing row fills the slot below
// the last one. Neither ever becomes active.
const PRE_STAGES = [
    { label: "Setting up your workspace", icon: LuCog },
    { label: "Queueing your analysis", icon: LuHourglass },
];
const POST_STAGES = [{ label: "Revealing what we found", icon: LuEye }];
const CAROUSEL_STAGES = [...PRE_STAGES, ...ANALYSIS_STAGES, ...POST_STAGES];

const STEP_LABELS: { key: Step[]; label: string }[] = [
    { key: ["intro"], label: "About you" },
    { key: ["site"], label: "Your site" },
    { key: ["analyzing", "reveal"], label: "Analysis" },
    { key: ["snippet"], label: "Install" },
];

const IMPACT_RANK: Record<string, number> = { High: 3, Medium: 2, Low: 1 };

// ── Dev-only UI preview: /onboarding?preview=<step> ─────────────────────────
// Jumps straight to any screen with stubbed data so screens can be styled
// without running (or billing) anything. Preview mode never writes metadata,
// never redirects, never polls. `?preview=snippet&verified=1` shows the green
// state. Stripped from production builds via the NODE_ENV check.
const PREVIEW_ENABLED = process.env.NODE_ENV === "development";

const PREVIEW_REPORT = {
    id: "preview",
    overall_score: 7,
    url: "https://yourstartup.com",
} as Report;

const PREVIEW_COMMENTS = [
    {
        id: "p1",
        comment:
            "Your hero headline describes what the product is, not what the visitor gets — benefit-led headlines consistently outperform descriptive ones for SaaS landing pages.",
        suggestion: "Lead with the outcome: “Ship experiments while you sleep” instead of “An A/B testing platform.”",
        meta: { impact: "High", effort: "Quick win" },
    },
    {
        id: "p2",
        comment: "The pricing CTA is below the fold on mobile.",
        suggestion: "Move it above the testimonial block.",
        meta: { impact: "Medium", effort: "Quick win" },
    },
    {
        id: "p3",
        comment: "Navigation has seven items competing with the primary CTA.",
        suggestion: "Collapse docs links into one menu.",
        meta: { impact: "Low", effort: "Some work" },
    },
] as Comment[];

const PREVIEW_SITE = {
    id: "preview-site",
    domain: "yourstartup.com",
    snippet_last_seen_at: null,
} as Site;

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
    const [preview, setPreview] = useState(false);
    const hydrated = useRef(false);

    // ── Dev-only screen preview (?preview=<step>) ────────────────────────────
    useEffect(() => {
        if (!PREVIEW_ENABLED) return;
        const params = new URLSearchParams(window.location.search);
        const target = params.get("preview") as Step | null;
        if (!target || !["intro", "site", "analyzing", "reveal", "snippet"].includes(target)) return;
        setPreview(true);
        hydrated.current = true; // block the metadata resume from moving the step
        setSiteUrl("https://yourstartup.com");
        setReport(PREVIEW_REPORT);
        setComments(PREVIEW_COMMENTS);
        setSite(PREVIEW_SITE);
        if (params.get("verified") === "1") setVerified(true);
        setStep(target);
    }, []);

    // Accumulated onboarding answers. Kept in a ref (seeded from user
    // metadata on hydrate) so consecutive saves can't race the auth context's
    // USER_UPDATED refresh and wipe earlier answers.
    const metaRef = useRef<Record<string, string | undefined>>({});

    // ── Route guards ─────────────────────────────────────────────────────────
    // `finishing` suppresses the completed-redirect: finish() sets the flag
    // and navigates to the report itself — this guard must not clobber that.
    const completed = !!user?.user_metadata?.onboarding_completed;
    useEffect(() => {
        if (loading || finishing || preview) return;
        if (!user) router.replace("/signin");
        else if (completed) router.replace("/dashboard");
    }, [loading, user, completed, finishing, preview, router]);

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
        if (preview) return;
        metaRef.current = { ...metaRef.current, ...patch };
        await supabase.auth.updateUser({
            data: { onboarding: metaRef.current },
        });
    }

    // ── Analysis ─────────────────────────────────────────────────────────────
    // Warn before closing the tab while the (billed) analysis runs.
    useEffect(() => {
        if (step !== "analyzing" || preview) return;
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
        // Preview: show the screen, never call the (billed) pipeline.
        if (preview) {
            setStep("analyzing");
            return;
        }
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
        if (step !== "snippet" || !user || !site || verified || preview) return;
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
        // Preview: never mark the real account onboarded or navigate away.
        if (preview) return;
        setFinishing(true);
        // Set the flag BEFORE navigating — the dashboard guard reads it.
        await supabase.auth.updateUser({ data: { onboarding_completed: true } });
        router.replace(
            destination ?? (report ? `/dashboard/report/${report.id}` : "/dashboard")
        );
    }

    if (!preview && (loading || !user || completed)) return null;

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
                        <Image src={logo} alt="Sitewide" className="size-8 w-max" />
                        {/* <span className="font-medium three-title tracking-tight text-stone-800">Sitewide</span> */}
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
                                Welcome, tell us a little about you.
                            </h1>
                            <p className="text-stone-500 text-sm">
                                Two quick questions, then our agent will analyze your site!
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
                    <div className="flex flex-col items-center gap-8 py-6 text-center font-inter">
                        {!analysisError ? (
                            <>
                                {/* <div className="relative flex items-center justify-center">
                                    <span className="absolute size-16 rounded-full bg-orange-100 animate-ping opacity-40" />
                                    <span className="relative size-14 rounded-full bg-orange-50 border border-orange-200 flex items-center justify-center">
                                        <LuSparkles className="size-6 text-orange-600" />
                                    </span>
                                </div> */}
                                <div className="flex flex-col gap-3 items-center">
                                    <h1 className="four-title font-medium tracking-tight text-stone-900">
                                        Your agent is reading{" "}
                                        <span className="text-orange-600 five-title tracking-tight">
                                            {siteUrl.replace(/^https?:\/\//, "")}
                                        </span>
                                    </h1>
                                    <p className="text-base text-stone-500">
                                        Hang tight, we're working on your analysis :)
                                    </p>
                                </div>

                                {/* Stage carousel: the active stage stays vertically
                                    centered; the column slides up as stages advance and
                                    neighbors fade with distance (plus a soft mask at the
                                    viewport edges). Row height and translate step must
                                    match: h-11 = 44px. */}
                                <div
                                    className="h-[220px] overflow-hidden w-fit mx-auto "
                                    style={{
                                        maskImage:
                                            "linear-gradient(to bottom, transparent, black 30%, black 70%, transparent)",
                                        WebkitMaskImage:
                                            "linear-gradient(to bottom, transparent, black 30%, black 70%, transparent)",
                                    }}
                                >
                                    <div
                                        className="flex flex-col transition-transform duration-700 ease-in-out "
                                        style={{
                                            // active row (stageIndex + the pre-stage offset)
                                            // pinned to the center slot (index 2 of 5)
                                            transform: `translateY(${(2 - (stageIndex + PRE_STAGES.length)) * 44}px)`,
                                        }}
                                    >
                                        {CAROUSEL_STAGES.map((stage, i) => {
                                            const Icon = stage.icon;
                                            const activeIndex = stageIndex + PRE_STAGES.length;
                                            const distance = Math.abs(i - activeIndex);
                                            const active = i === activeIndex;
                                            return (
                                                <div
                                                    key={stage.label}
                                                    className={`h-10 flex items-center gap-3 text-left transition-all duration-700 ${
                                                        active
                                                            ? "opacity-100 text-stone-900 font-medium"
                                                            : distance === 1
                                                              ? "opacity-50 text-stone-400"
                                                              : distance === 2
                                                                ? "opacity-25 text-stone-400"
                                                                : "opacity-0 text-stone-300"
                                                    }`}
                                                >
                                                    <Icon
                                                        className={`size-5 shrink-0 transition-colors duration-700 ${
                                                            active ? "text-orange-600" : "text-stone-300"
                                                        }`}
                                                        strokeWidth={active ? 2 : 1.75}
                                                    />
                                                    <span className="text-base">
                                                        {stage.label}
                                                        {active && <AnimatedDots />}
                                                    </span>
                                                </div>
                                            );
                                        })}
                                    </div>
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
                            <p className="text-[11px] font-medium uppercase tracking-wider text-stone-400">
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
                                        Your page scored a{" "}
                                        <span className="font-robot font-semibold text-stone-700">
                                            {report.overall_score}/10.
                                        </span>
                                        {" "}
                                    </>
                                    
                                )}
                                Your full report is waiting for you!
                            </p>
                        </div>

                        {topFinding && (
                            <div className="border border-stone-200 bg-stone-50 rounded-2xl p-5 flex flex-col gap-4">
                                <div className="flex flex-col gap-2">
                                    <div className="flex items-center gap-2">
                                        <span className="text-[10px] font-medium uppercase tracking-wider text-white bg-orange-600 rounded-md px-2 py-0.5">
                                            Our Top finding
                                        </span>
                                        {topFinding.meta?.impact && (
                                            // <span className="text-[10px] text-stone-400">
                                            //     {topFinding.meta.impact} impact
                                            // </span>
                                            <span className="text-[10px] font-medium uppercase tracking-wider text-stone-500 bg-slate-200 rounded-md px-2 py-0.5">
                                                {topFinding.meta.impact} impact
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-sm text-stone-800 leading-relaxed">
                                        {topFinding.comment}
                                    </p>
                                </div>

                                {topFinding.suggestion && (
                                    <p className="text-xs text-stone-500 leading-relaxed flex flex-col gap-2">
                                        <span className="text-[10px] font-medium uppercase tracking-wider w-max text-white bg-green-600  rounded-md px-2 py-0.5">
                                            Our Suggestion
                                        </span>
                                        {topFinding.suggestion}
                                    </p>
                                )}
                            </div>
                        )}

                        <Footer onContinue={() => setStep("snippet")} continueLabel="One last step (Not a paywall, promise)" />
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
                                Our script tag lets your agent run experiments and track results. You
                                can also do this later, your report will always be visible on your dashboard!
                            </p>
                        </div>

                        {site ? (
                            <div className="flex flex-col">
                                <SnippetInstructions siteId={site.id} />
                                <div
                                    className={`flex items-center justify-center gap-2.5 rounded-b-xl border border-t-0 px-4 py-3 text-sm transition-colors mx-4  ${
                                        verified
                                            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                            : "border-stone-200 bg-white text-stone-500"
                                    }`}
                                >
                                    {verified ? (
                                        <>
                                            <LuCheck className="size-4 shrink-0" />
                                            <span className="font-medium">
                                                We heard from {site.domain}, you&apos;re live.
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
                                                <AnimatedDots /> paste the tag and deploy.
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
            className={`text-sm rounded-lg px-4 py-2 transition-colors cursor-pointer ${
                selected
                    ? "text-white font-medium bg-orange-600"
                    : "text-stone-600 hover:text-stone-800 bg-stone-50 border-stone-200 border"
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
                        className="flex items-center gap-1.5 text-sm font-medium text-stone-500 bg-stone-50 border border-stone-100 rounded-lg px-4 py-2 transition-colors cursor-pointer"
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
                        className="cursor-pointer w-max h-max text-sm bg-orange-600 flex items-center gap-2 hover:bg-orange-700 disabled:bg-stone-100 disabled:text-stone-300 disabled:cursor-not-allowed transition-colors text-white font-semibold px-4 py-2 rounded-lg drop-shadow-[0px_4px_0px_rgba(194,65,12,1)] disabled:drop-shadow-[0px_4px_0px_rgba(231,229,228,1)]"
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
