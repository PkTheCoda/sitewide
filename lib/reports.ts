import { supabase } from "@/lib/supabaseClient";

// run a full page analysis: invokes the analyze-page edge function and waits
// for it to finish (~30-60s). Returns the new report id on success.
export async function analyzeUrl(url: string, user_id: string) {
    // be forgiving about missing protocol
    const fullUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`;

    const { data, error } = await supabase.functions.invoke("analyze-page", {
        body: { url: fullUrl, user_id },
    });

    if (error) {
        console.error(error);
        return { error: error.message ?? "Analysis failed" };
    }
    if (data?.error) return { error: data.error as string };
    if (!data?.report_id) return { error: "Analysis finished but no report id returned" };

    return { report_id: data.report_id as number };
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