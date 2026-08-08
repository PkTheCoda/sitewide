"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/services/context/authContext";
import { supabase } from "@/lib/supabaseClient";
import { getSites } from "@/lib/experiments";
import { Integration, Site } from "@/lib/types";
import PostHogConnectForm from "@/components/dashboard/PostHogConnectForm";
import { LuLoaderCircle, LuTriangleAlert } from "react-icons/lu";

// PostHog connection card on the Settings page. The connect form itself is
// shared with onboarding (PostHogConnectForm); this card adds the connected
// rows (sync status + two-click disconnect) around it.
export default function IntegrationsCard() {
    const { user } = useAuth();

    const [sites, setSites] = useState<Site[]>([]);
    const [integrations, setIntegrations] = useState<Integration[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [disconnectArmed, setDisconnectArmed] = useState<string | null>(null);
    const [disconnecting, setDisconnecting] = useState<string | null>(null);

    const load = useCallback(async () => {
        if (!user) return;
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        const [sitesResult, res] = await Promise.all([
            getSites(user.id),
            token
                ? fetch("/api/integrations/posthog", { headers: { authorization: `Bearer ${token}` } })
                : Promise.resolve(null),
        ]);
        if (Array.isArray(sitesResult)) setSites(sitesResult as Site[]);
        if (res?.ok) {
            const body = await res.json().catch(() => ({}));
            setIntegrations(body.integrations ?? []);
        }
        setLoading(false);
    }, [user]);

    useEffect(() => {
        load();
    }, [load]);

    async function handleDisconnect(integration: Integration) {
        if (disconnecting) return;
        // Two-step confirm: first click arms the button, second click disconnects.
        if (disconnectArmed !== integration.id) {
            setDisconnectArmed(integration.id);
            return;
        }
        setDisconnecting(integration.id);
        setError(null);
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        const res = token
            ? await fetch("/api/integrations/posthog", {
                  method: "DELETE",
                  headers: { "Content-Type": "application/json", authorization: `Bearer ${token}` },
                  body: JSON.stringify({ site_id: integration.site_id }),
              })
            : null;
        setDisconnecting(null);
        setDisconnectArmed(null);
        if (!res?.ok) {
            setError("Couldn't disconnect — please try again.");
            return;
        }
        load();
    }

    const connectedSiteIds = new Set(integrations.map((i) => i.site_id));
    const connectableSites = sites.filter((s) => !connectedSiteIds.has(s.id));
    const domainOf = (site_id: string) => sites.find((s) => s.id === site_id)?.domain ?? "your site";

    return (
        <div className="flex flex-col gap-4 bg-stone-50 border border-stone-200 rounded-xl p-6 shadow-xs">
            <p className="text-[11px] font-medium tracking-wider text-stone-400 uppercase">Integrations</p>

            <div>
                <p className="text-sm font-medium text-stone-800">PostHog</p>
                <p className="text-xs text-stone-500 leading-relaxed">
                    Connect your PostHog project (read-only) and the agent grounds its suggestions in
                    your real traffic — which pages get visits, mobile vs desktop, where visitors come
                    from. Synced once a day. Never shown as a dashboard, never used to score experiments.
                </p>
            </div>

            {loading ? (
                <LuLoaderCircle className="size-4 animate-spin text-stone-400" />
            ) : (
                <>
                    {integrations.map((integration) => (
                        <div
                            key={integration.id}
                            className="flex items-center justify-between gap-4 bg-white border border-stone-200 rounded-xl p-4"
                        >
                            <div className="flex items-center gap-3 min-w-0">
                                <span
                                    className={`size-2 rounded-full shrink-0 ${integration.status === "connected" ? "bg-green-500" : "bg-red-500"}`}
                                />
                                <div className="min-w-0">
                                    <p className="text-sm font-medium text-stone-800 truncate">
                                        {domainOf(integration.site_id)} · project {integration.project_id}
                                    </p>
                                    <p className="text-xs text-stone-500 truncate">
                                        {integration.status === "error"
                                            ? `Last sync failed: ${integration.last_error ?? "unknown error"}`
                                            : integration.last_synced_at
                                              ? `Last synced ${new Date(integration.last_synced_at).toLocaleString()}`
                                              : "Waiting for first sync"}
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => handleDisconnect(integration)}
                                onBlur={() => setDisconnectArmed(null)}
                                disabled={disconnecting === integration.id}
                                className={`flex items-center gap-2 text-sm font-medium rounded-xl px-5 py-2.5 transition-colors disabled:opacity-60 disabled:cursor-not-allowed shrink-0 cursor-pointer ${
                                    disconnectArmed === integration.id
                                        ? "text-white bg-red-600 hover:bg-red-700"
                                        : "text-red-600 bg-white border border-red-200 hover:bg-red-50"
                                }`}
                            >
                                {disconnecting === integration.id && (
                                    <LuLoaderCircle className="size-4 animate-spin" />
                                )}
                                {disconnecting !== integration.id && disconnectArmed === integration.id && (
                                    <LuTriangleAlert className="size-4" />
                                )}
                                {disconnecting === integration.id
                                    ? "Disconnecting…"
                                    : disconnectArmed === integration.id
                                      ? "Click again to disconnect"
                                      : "Disconnect"}
                            </button>
                        </div>
                    ))}
                    {error && <p className="text-xs text-red-600">{error}</p>}

                    {sites.length === 0 ? (
                        <p className="text-xs text-stone-400">
                            Add your site first (finish onboarding or activate an experiment) — the
                            connection is per site.
                        </p>
                    ) : connectableSites.length > 0 ? (
                        <PostHogConnectForm sites={connectableSites} onConnected={load} />
                    ) : null}
                </>
            )}
        </div>
    );
}
