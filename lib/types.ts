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
    top: number;
    left: number;
    width: number;
    height: number;
    wordCount: number;
    siblingCount: number;
};

export type Severity = "critical" | "warning" | "suggestion";

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
    | { styles: StyleChanges }
    | { hide: true }
    | { src: string } // image swap — the founder hosts the replacement image
    | null;

export type Experiment = {
    id: string;
    user_id: string;
    report_id: number | null;
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
    started_at: string | null;
    ended_at: string | null;
    created_at: string;
};

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