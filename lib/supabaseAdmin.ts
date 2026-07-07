import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Server-only Supabase client using the service role key — bypasses RLS.
// Used by the snippet endpoints (public, no user session) and the agent.
// NEVER import this from a client component.
let adminClient: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
    if (adminClient) return adminClient;

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !serviceKey) {
        throw new Error("SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL missing");
    }

    adminClient = createClient(url, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
    return adminClient;
}
