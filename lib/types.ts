// ─────────────────────────────────────────────────────────────────────────────
// DATABASE MAP — every type below mirrors a Supabase table.
//
//   auth.users (Supabase-managed)
//    ├── reports        "I analyzed this URL once"        (user_id)
//    │    └── comments  "AI found these issues"           (report_id)
//    ├── sites          "I own this domain"               (user_id)
//    └── experiments    "I'm running this A/B test"       (user_id, report_id, site_id)
//         ├── experiment_variants  "the versions"         (experiment_id)
//         ├── experiment_events    "who saw/clicked what" (experiment_id, variant_id)
//         └── agent_actions        "what the agent decided" (experiment_id)
//
// Ownership flows down from auth.users: RLS policies let a logged-in user see
// only rows that trace back to their user_id (directly, or through a join).
// The edge function and API routes write with the service role key, which
// bypasses RLS — that's why rows must always carry the REAL user's id.
// ─────────────────────────────────────────────────────────────────────────────

// One analysis run of one URL. Created when the user hits "Analyze";
// filled in by the analyze-page edge function as it progresses
// (pending → processing → complete/error).
export type Report = {
    id: string;
    user_id: string;
    url: string;
    status: "pending" | "processing" | "complete" | "error";
    screenshot_url: string | null;
    page_height: number | null;
    viewport_width: number | null;
    overall_score: number | null;
    summary: string | null;
    error_message: string | null;
    elements: PageElement[] | null;
    created_at: string;
};

// One element captured during the crawl. Coordinates are page pixels measured
// at the crawl viewport (1440px wide) — divide by viewport_width / page_height
// to get the percentage position on the screenshot.
export type PageElement = {
    id: number;
    tag: string;
    text: string | null;
    alt: string | null;
    className: string;
    elId: string;
    selector: string;
    fallback: { tag: string; text: string };
    // Optional: only present on reports crawled after the image/rich-text update
    src?: string | null;
    hasMarkup?: boolean;
    // Text of each text node inside the element, in document order (only when
    // the element has child markup, e.g. an h1 with a gradient span). Lets the
    // builder edit rich text part-by-part instead of flattening it.
    textParts?: string[] | null;
    top: number;
    left: number;
    width: number;
    height: number;
    wordCount: number;
    siblingCount: number;
};

export type Severity = "critical" | "warning" | "suggestion";

// One AI-generated CRO finding, belonging to a report. The *_pct fields place
// the highlight box on the screenshot (percentages of full page dimensions,
// so they stay accurate at any display size).
export type Comment = {
    id: string;
    report_id: string;
    element_id: number;
    element_tag: string;
    section: string;
    dimension: string;
    severity: Severity;
    comment: string;
    why_it_matters: string | null;
    suggestion: string;
    hypothesis: string | null;
    variants: string[];
    // Rich-text split of each variant (one inner array per variant, one string
    // per text part of the element). Empty/absent for plain-text elements and
    // for reports analyzed before this column existed.
    variant_parts?: string[][] | null;
    test_type: string | null;
    selector: string | null;
    original_value: string | null;
    meta: { effort: "Quick win" | "Some work" | "Big lift"; impact: "High" | "Medium" | "Low" } | null;
    confidence: number;
    top_pct: number;
    left_pct: number;
    width_pct: number;
    height_pct: number;
    created_at: string;
};


// ─── Experiments ──────────────────────────────────────────────────────────────

export type ChangeType = "text" | "style" | "hide" | "image";
export type GoalType = "click" | "pageview";
export type ExperimentStatus = "draft" | "running" | "paused" | "completed" | "archived";

// The style properties a variant can change in v1.
export type StyleChanges = {
    color?: string;
    backgroundColor?: string;
    fontSize?: string;
};

// What the snippet applies for a variant. Control rows have payload = null.
export type VariantPayload =
    | { text: string }
    // Rich-text swap: one string per text node of the element, in document
    // order. The snippet rewrites text nodes in place, so inner spans keep
    // their styling. Falls back to a flat replace if the markup changed.
    | { textParts: string[] }
    | { styles: StyleChanges }
    | { hide: true }
    | { src: string } // image swap — the founder hosts the replacement image
    | null;

// One row per DOMAIN the user runs experiments on (not per page!). Created
// automatically the first time an experiment on that domain is activated.
// The snippet script tag carries this row's id (data-site-id) — that's how a
// page load on the founder's site finds ITS experiments in OUR database.
export type Site = {
    id: string;
    user_id: string;
    domain: string;
    name: string | null;
    snippet_installed: boolean;
    snippet_last_seen_at: string | null;
    created_at: string;
};

// One A/B test. Points three ways:
//   report_id — which analysis it was built from (null if that report is deleted)
//   site_id   — which domain serves it (null until first activation)
//   user_id   — who owns it (RLS key)
// The element being tested lives here as selector + fallback; WHAT each
// version shows lives in experiment_variants.payload.
// created_by = 'agent' rows are proposals from the weekly evaluation loop —
// drafts the founder approves (Activate) or rejects (Dismiss → archived).
export type Experiment = {
    id: string;
    user_id: string;
    report_id: number | null;
    site_id: string | null;
    created_by: "user" | "agent";
    agent_rationale: string | null;
    source_comment_id: number | null;
    page_url: string;
    name: string;
    hypothesis: string | null;
    selector: string;
    selector_fallback: { tag: string; text: string } | null;
    change_type: ChangeType;
    original_value: string | null;
    goal_type: GoalType;
    goal_selector: string | null;
    goal_fallback: { tag: string; text: string } | null;
    goal_page_path: string | null;
    traffic_percent: number;
    status: ExperimentStatus;
    winner_variant_id: string | null;
    min_sample_size: number;
    auto_promote: boolean;
    started_at: string | null;
    ended_at: string | null;
    created_at: string;
};

// One "a visitor saw variant X" (exposure) or "a visitor converted on variant
// X" (conversion) record. A unique DB index on (experiment_id, visitor_id,
// event_type) guarantees max ONE of each per visitor per experiment — so
// counting rows literally counts unique visitors. This table is the agent's
// entire perception of the world.
export type ExperimentEvent = {
    id: number;
    experiment_id: string;
    variant_id: string;
    visitor_id: string;
    event_type: "exposure" | "conversion";
    page_url: string | null;
    created_at: string;
};

// Raw page-view counter, one row per (experiment, variant, UTC day). Bumped
// by /api/snippet/event on every exposure beacon (which the snippet sends on
// every load of the experiment page — experiment_events only keeps the first
// one per visitor, this table counts them all).
export type ExperimentDailyView = {
    experiment_id: string;
    variant_id: string;
    day: string; // "YYYY-MM-DD", UTC
    views: number;
};

// One point in a day-by-day chart series. exposures/conversions are NEW
// unique visitors that day (first-ever exposure / first-ever conversion —
// exactly what the z-test consumes); views are raw page loads.
export type DailyStat = {
    day: string; // "YYYY-MM-DD", UTC
    views: number;
    exposures: number;
    conversions: number;
};

// Chart-ready daily data for one experiment: totals across all variants,
// plus the same series per variant (for layered/compare charts). All series
// cover the same zero-filled day range, oldest first.
export type DailySeries = {
    days: DailyStat[];
    byVariant: Record<string, DailyStat[]>;
};

// One decision the agent made, kept as an audit trail the founder can read.
// proposed_experiment rows live under the COMPLETED experiment (the decision
// context); detail.experiment_id points at the new draft it created.
export type AgentAction = {
    id: number;
    experiment_id: string;
    action: "evaluated" | "promoted_winner" | "kept_control" | "proposed_experiment" | "error";
    detail: Record<string, unknown> | null;
    created_at: string;
};

// One version inside an experiment. Control is a row too (is_control: true,
// payload: null = "change nothing"). weight = % of visitors bucketed into it.
// position preserves order (0 = control, 1 = Variant B, …).
export type ExperimentVariant = {
    id: string;
    experiment_id: string;
    name: string;
    is_control: boolean;
    payload: VariantPayload;
    weight: number;
    position: number;
    created_at: string;
};

// sample obj
[
    {
        "id": 67,
        "created_at": "2026-07-02T00:34:38.893609+00:00",
        "element_id": 4,
        "element_tag": "h3",
        "section": "body",
        "dimension": "Friction & Clarity",
        "severity": "warning",
        "comment": "Query your company is a feature headline that assumes visitors already know why they would query the company. No benefit statement follows immediately.",
        "suggestion": "Reframe as a benefit: 'Stop hunting across five tools. Ask Shepherd one question and get the answer in seconds.'",
        "confidence": 1,
        "top_pct": 0.402055498458376,
        "left_pct": 0.106944444444444,
        "width_pct": 0.311111111111111,
        "height_pct": 0.00801644398766701,
        "report_id": 16,
        "hypothesis": "If the headline becomes outcome-focused and shows time savings, visitors will recognize themselves in the pain point and be more likely to click the CTA.",
        "variants": [
            "Find answers in seconds instead of pinging five people",
            "One question. One answer. No more context switching."
        ],
        "test_type": "copy_change",
        "selector": "h3.text-\\[22px\\]\\ font-.emibold\\ tracking-\\[-0\\.015em\\]\\ text-\\[var\\(--ink-",
        "original_value": "Query your company",
        "why_it_matters": "Visitors at 40% down the page are still deciding whether to convert. A cryptic headline delays the decision and increases likelihood they bounce before reaching the CTA.",
        "meta": {
            "effort": "Quick win",
            "impact": "Medium"
        }
    }
]