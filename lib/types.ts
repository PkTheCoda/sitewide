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
    created_at: string;
};

export type Severity = "critical" | "warning" | "suggestion" | "positive";

export type Comment = {
    id: string;
    report_id: string;
    element_id: number;
    element_tag: string;
    section: string;
    dimension: string;
    severity: Severity;
    comment: string;
    suggestion: string;
    hypothesis: string | null;
    variants: string[];
    test_type: string | null;
    selector: string | null;
    original_value: string | null;
    confidence: number;
    top_pct: number;
    left_pct: number;
    width_pct: number;
    height_pct: number;
    created_at: string;
};
