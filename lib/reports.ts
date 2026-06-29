import { supabase } from "@/lib/supabaseClient";

// get all reports from a specific user
export async function getReports(user_id: string) {
    const { data, error } = await supabase.from('reports').select('*').eq('user_id', user_id);

    if (error) {
        console.error(error);
        return { error: error.message };
    }

    return data;
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