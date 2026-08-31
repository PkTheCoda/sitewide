import { supabase } from "@/lib/supabaseClient";

// run a full page analysis: invokes the analyze-page edge function and waits
// for it to finish (~30-60s). Returns the new report id on success.
// The function identifies the caller from the session JWT supabase-js attaches
// to the invoke; the user_id argument is kept for call-site symmetry only.
export async function analyzeUrl(url: string, _user_id: string) {
    // be forgiving about missing protocol
    const fullUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`;

    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) return { error: "Session expired — sign in again first." };

    const { data, error } = await supabase.functions.invoke("analyze-page", {
        body: { url: fullUrl },
    });

    if (error) {
        console.error(error);
        // FunctionsHttpError carries the function's JSON body in context.
        const ctx = (error as { context?: Response }).context;
        if (ctx && typeof ctx.json === "function") {
            const detail = await ctx.json().catch(() => null);
            if (detail?.error) return { error: detail.error as string };
        }
        return { error: error.message ?? "Analysis failed" };
    }
    if (data?.error) return { error: data.error as string };
    if (!data?.report_id) return { error: "Analysis finished but no report id returned" };

    return { report_id: data.report_id as number };
}

// A report can only be `processing` while the edge function is alive, and the
// function bounds its own upstream calls so it always finishes (success or
// error) well inside this window. Anything older is a run the platform killed
// (deploy mid-run, hard runtime cap) — treat it as failed so the founder can
// retry instead of staring at a spinner forever.
export const PROCESSING_STALE_MS = 5 * 60 * 1000;
export function isStaleProcessing(report: { status: string; created_at: string }) {
    return (
        report.status === "processing" &&
        Date.now() - new Date(report.created_at).getTime() > PROCESSING_STALE_MS
    );
}

// re-run the analysis on an existing report row (same id, screenshot and
// comments replaced). The edge function verifies the caller owns the report.
export async function reanalyzeReport(report_id: number | string, url: string) {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) return { error: "Session expired — sign in again first." };

    const { data, error } = await supabase.functions.invoke("analyze-page", {
        body: { url, report_id },
    });
    if (error) {
        const ctx = (error as { context?: Response }).context;
        if (ctx && typeof ctx.json === "function") {
            const detail = await ctx.json().catch(() => null);
            if (detail?.error) return { error: detail.error as string };
        }
        return { error: error.message ?? "Analysis failed" };
    }
    if (data?.error) return { error: data.error as string };
    return { report_id: (data?.report_id ?? report_id) as number };
}

// get a single report by id
export async function getReport(report_id: string) {
    const { data, error } = await supabase.from('reports').select('*').eq('id', report_id).single();

    if (error) {
        console.error(error);
        return { error: error.message };
    }

    return data;
}

// get all reports from a specific user
export async function getReports(user_id: string) {
    const { data, error } = await supabase.from('reports').select('*').eq('user_id', user_id);

    if (error) {
        console.error(error);
        return { error: error.message };
    }

    return data;
}

// permanently delete a report (one analysis) and its comments + screenshots.
// Runs through /api/report/delete because clearing Storage screenshots needs
// the service role; the caller's access token proves ownership server-side.
export async function deleteReport(report_id: number | string) {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) return { error: "Session expired — sign in again first." };

    const res = await fetch("/api/report/delete", {
        method: "POST",
        headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ report_id }),
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return { error: body.error ?? "Deletion failed — please try again." };
    }
    return { ok: true };
}

// get all comments from a specific report
export async function getComments(report_id: string) {
    const { data, error } = await supabase.from('comments').select('*').eq('report_id', report_id)

    if (error) {
        console.error(error);
        return { error: error.message };
    }

    return data;
}