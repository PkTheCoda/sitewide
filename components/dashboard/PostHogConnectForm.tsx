"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { LuLoaderCircle } from "react-icons/lu";

type Status = { type: "success" | "error"; message: string } | null;

export type ConnectableSite = { id: string; domain: string };

// The PostHog connect form, shared by the Settings Integrations card and the
// optional onboarding step. Owns the whole connect flow: field state,
// validation, the authed POST to /api/integrations/posthog, and error/success
// messaging (401/403/404 messages come from the server's testConnection).
// The API key passes through this form once and is never displayed again.
export default function PostHogConnectForm({
    sites,
    onConnected,
}: {
    sites: ConnectableSite[]; // sites without a connection; picker shown when > 1
    onConnected?: () => void;
}) {
    const [siteId, setSiteId] = useState("");
    const [region, setRegion] = useState<"us" | "eu" | "custom">("us");
    const [customHost, setCustomHost] = useState("");
    const [projectId, setProjectId] = useState("");
    const [apiKey, setApiKey] = useState("");
    const [connecting, setConnecting] = useState(false);
    const [status, setStatus] = useState<Status>(null);

    const selectedSiteId = siteId || sites[0]?.id || "";

    async function handleConnect() {
        if (connecting) return;
        setStatus(null);
        if (!selectedSiteId) return;
        if (!projectId.trim()) {
            setStatus({ type: "error", message: "Enter your PostHog project ID." });
            return;
        }
        if (!apiKey.trim()) {
            setStatus({ type: "error", message: "Paste a personal API key." });
            return;
        }
        if (region === "custom" && !customHost.trim()) {
            setStatus({ type: "error", message: "Enter your PostHog instance URL." });
            return;
        }
        setConnecting(true);

        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) {
            setConnecting(false);
            setStatus({ type: "error", message: "Session expired — sign in again first." });
            return;
        }

        const host =
            region === "us" ? "https://us.posthog.com"
            : region === "eu" ? "https://eu.posthog.com"
            : customHost;
        const res = await fetch("/api/integrations/posthog", {
            method: "POST",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${token}` },
            body: JSON.stringify({
                site_id: selectedSiteId,
                host,
                project_id: projectId.trim(),
                api_key: apiKey.trim(),
            }),
        });
        setConnecting(false);

        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
            setStatus({ type: "error", message: body.error ?? "Couldn't connect — please try again." });
            return;
        }
        setApiKey("");
        setProjectId("");
        setStatus({
            type: "success",
            message: body.snapshot_ready
                ? "Connected. Your traffic data is already synced — the agent uses it from the next analysis on."
                : "Connected. Your traffic data will sync within a day.",
        });
        onConnected?.();
    }

    const inputClass =
        "w-full text-sm text-stone-800 bg-white border border-stone-200 rounded-xl py-3 px-4 focus:outline-none focus:border-orange-600 placeholder:text-stone-400";

    return (
        <div className="flex flex-col gap-4">
            {sites.length > 1 && (
                <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium text-stone-800">Site</label>
                    <select value={selectedSiteId} onChange={(e) => setSiteId(e.target.value)} className={inputClass}>
                        {sites.map((s) => (
                            <option key={s.id} value={s.id}>
                                {s.domain}
                            </option>
                        ))}
                    </select>
                </div>
            )}

            <div className="flex gap-4">
                <div className="flex flex-col gap-1.5 flex-1">
                    <label className="text-sm font-medium text-stone-800">Region</label>
                    <select
                        value={region}
                        onChange={(e) => setRegion(e.target.value as "us" | "eu" | "custom")}
                        className={inputClass}
                    >
                        <option value="us">US Cloud (us.posthog.com)</option>
                        <option value="eu">EU Cloud (eu.posthog.com)</option>
                        <option value="custom">Self-hosted / custom</option>
                    </select>
                </div>
                <div className="flex flex-col gap-1.5 flex-1">
                    <label className="text-sm font-medium text-stone-800">Project ID</label>
                    <input
                        type="text"
                        inputMode="numeric"
                        value={projectId}
                        onChange={(e) => setProjectId(e.target.value)}
                        placeholder="e.g. 12345"
                        className={inputClass}
                    />
                    <p className="text-xs text-stone-400">In PostHog: Settings → Project → Project ID.</p>
                </div>
            </div>

            {region === "custom" && (
                <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium text-stone-800">Instance URL</label>
                    <input
                        type="text"
                        value={customHost}
                        onChange={(e) => setCustomHost(e.target.value)}
                        placeholder="https://posthog.your-company.com"
                        className={inputClass}
                    />
                </div>
            )}

            <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-stone-800">Personal API key</label>
                <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="phx_…"
                    className={inputClass}
                />
                <p className="text-xs text-stone-400">
                    Create one in PostHog under{" "}
                    <a
                        href="https://app.posthog.com/settings/user-api-keys"
                        target="_blank"
                        rel="noreferrer"
                        className="underline hover:text-stone-600"
                    >
                        Settings → Personal API keys
                    </a>
                    . Give it only the <span className="font-mono">query:read</span> scope, scoped to just
                    this project — that&apos;s all we need. The key is kept server-side, never sent to your
                    browser, and never shown again after connecting.
                </p>
            </div>

            {status && (
                <p className={`text-xs ${status.type === "error" ? "text-red-600" : "text-green-600"}`}>
                    {status.message}
                </p>
            )}

            <button
                onClick={handleConnect}
                disabled={connecting || !selectedSiteId}
                className="self-start flex items-center gap-2 text-sm font-medium text-white bg-orange-600 hover:bg-orange-700 disabled:bg-stone-300 disabled:cursor-not-allowed rounded-xl px-6 py-2.5 transition-colors"
            >
                {connecting && <LuLoaderCircle className="size-4 animate-spin" />}
                {connecting ? "Testing connection…" : "Test & connect"}
            </button>
        </div>
    );
}
