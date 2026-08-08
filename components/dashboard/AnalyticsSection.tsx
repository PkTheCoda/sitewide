"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/services/context/authContext";
import { supabase } from "@/lib/supabaseClient";
import { getSites } from "@/lib/experiments";
import { AnalyticsSnapshot, Integration, Site } from "@/lib/types";
import { LuLoaderCircle } from "react-icons/lu";

// The Analytics tab: a read-only window into the PostHog snapshot the agent
// reads — the exact numbers that go into analysis prompts, follow-up
// proposals, and the estimator prefill. Deliberately NOT an analytics
// product (anti-scope-creep rule): no date pickers, no filters, no charts,
// no drill-downs. If a founder wants analytics, they have PostHog — this
// page exists so they can see (and trust) what their agent knows.

type SiteView = {
    site: Site;
    integration: Integration | null;
    snapshot: AnalyticsSnapshot | null;
};

const fmt = (n: number) => n.toLocaleString();
const pct = (f: number) => `${Math.round(f * 100)}%`;

export default function AnalyticsSection() {
    const { user } = useAuth();
    const [views, setViews] = useState<SiteView[]>([]);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        if (!user) return;
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        const [sitesResult, res] = await Promise.all([
            getSites(user.id),
            token
                ? fetch("/api/integrations/posthog", { headers: { authorization: `Bearer ${token}` } })
                : Promise.resolve(null),
        ]);
        const sites = Array.isArray(sitesResult) ? (sitesResult as Site[]) : [];
        let integrations: Integration[] = [];
        if (res?.ok) {
            const body = await res.json().catch(() => ({}));
            integrations = body.integrations ?? [];
        }
        const snapshots = await Promise.all(
            sites.map(async (site) => {
                const { data } = await supabase
                    .from("analytics_snapshots")
                    .select("*")
                    .eq("site_id", site.id)
                    .order("captured_at", { ascending: false })
                    .limit(1)
                    .maybeSingle();
                return (data as AnalyticsSnapshot) ?? null;
            })
        );
        setViews(
            sites.map((site, i) => ({
                site,
                integration: integrations.find((int) => int.site_id === site.id) ?? null,
                snapshot: snapshots[i],
            }))
        );
        setLoading(false);
    }, [user]);

    useEffect(() => {
        load();
    }, [load]);

    const connected = views.filter((v) => v.integration);

    return (
        <div className="flex flex-col gap-4">
            <div>
                <h2 className="text-lg font-medium tracking-tight text-stone-800">Analytics</h2>
                <p className="text-sm text-stone-500">
                    What your agent knows about your traffic — synced daily from your PostHog. It
                    reads these numbers when analyzing pages and proposing tests. Want full
                    analytics? That&apos;s what PostHog is for.
                </p>
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-20">
                    <LuLoaderCircle className="size-5 animate-spin text-stone-400" />
                </div>
            ) : connected.length === 0 ? (
                <div className="flex flex-col items-center gap-3 bg-stone-50 border border-dashed border-stone-300 rounded-xl py-16 px-6 text-center">
                    <p className="text-sm text-stone-500 max-w-md leading-relaxed">
                        No analytics connected yet. Connect your PostHog (read-only, one minute) and
                        your agent starts grounding its suggestions in your real traffic — which
                        pages get visits, mobile vs desktop, where visitors come from.
                    </p>
                    <Link
                        href="/dashboard/settings"
                        className="text-sm font-medium text-white bg-orange-600 hover:bg-orange-700 rounded-xl px-6 py-2.5 transition-colors"
                    >
                        Connect in Settings
                    </Link>
                </div>
            ) : (
                connected.map(({ site, integration, snapshot }) => (
                    <div
                        key={site.id}
                        className="flex flex-col gap-5 bg-stone-50 border border-stone-200 rounded-xl p-6 shadow-xs"
                    >
                        {/* Site header + sync status */}
                        <div className="flex items-center justify-between gap-4">
                            <div className="flex items-center gap-3 min-w-0">
                                <span
                                    className={`size-2 rounded-full shrink-0 ${integration!.status === "connected" ? "bg-green-500" : "bg-red-500"}`}
                                />
                                <p className="text-sm font-medium text-stone-800 truncate">{site.domain}</p>
                            </div>
                            <p className="text-xs text-stone-400 shrink-0">
                                {integration!.status === "error"
                                    ? `Sync failing: ${integration!.last_error ?? "unknown"}`
                                    : snapshot
                                      ? `Last ${snapshot.payload.window_days} days · synced ${new Date(snapshot.created_at).toLocaleString()}`
                                      : "Waiting for first sync"}
                            </p>
                        </div>

                        {!snapshot ? (
                            <p className="text-xs text-stone-400">
                                No data yet — the first sync lands within a day of connecting.
                            </p>
                        ) : (
                            <>
                                {/* Totals */}
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                    <StatTile label="Unique visitors" value={fmt(snapshot.payload.total_visitors)} />
                                    <StatTile label="Pageviews" value={fmt(snapshot.payload.total_pageviews)} />
                                    <StatTile
                                        label="Top device"
                                        value={
                                            Object.entries(snapshot.payload.devices).sort((a, b) => b[1] - a[1])[0]
                                                ? `${Object.entries(snapshot.payload.devices).sort((a, b) => b[1] - a[1])[0][0]} ${pct(Object.entries(snapshot.payload.devices).sort((a, b) => b[1] - a[1])[0][1])}`
                                                : "—"
                                        }
                                    />
                                    <StatTile
                                        label="Top referrer"
                                        value={snapshot.payload.referrers[0]?.domain ?? "—"}
                                    />
                                </div>

                                <div className="grid sm:grid-cols-2 gap-5">
                                    {/* Top pages */}
                                    <div className="flex flex-col gap-2">
                                        <p className="text-[11px] font-medium tracking-wider text-stone-400 uppercase">
                                            Top pages
                                        </p>
                                        <div className="flex flex-col divide-y divide-stone-100 bg-white border border-stone-200 rounded-xl px-4">
                                            {snapshot.payload.pages.slice(0, 8).map((p) => (
                                                <div key={p.path} className="flex items-center justify-between gap-3 py-2">
                                                    <span className="text-xs text-stone-700 font-mono truncate">{p.path}</span>
                                                    <span className="text-xs text-stone-400 tabular-nums shrink-0">
                                                        {fmt(p.visitors)} visitors
                                                    </span>
                                                </div>
                                            ))}
                                            {snapshot.payload.pages.length === 0 && (
                                                <p className="text-xs text-stone-400 py-2">No pageviews in the window.</p>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex flex-col gap-5">
                                        {/* Devices */}
                                        <div className="flex flex-col gap-2">
                                            <p className="text-[11px] font-medium tracking-wider text-stone-400 uppercase">
                                                Devices
                                            </p>
                                            <div className="flex flex-wrap gap-2">
                                                {Object.entries(snapshot.payload.devices)
                                                    .sort((a, b) => b[1] - a[1])
                                                    .map(([device, share]) => (
                                                        <span
                                                            key={device}
                                                            className="text-xs text-stone-600 bg-white border border-stone-200 rounded-lg px-3 py-1.5"
                                                        >
                                                            {device}{" "}
                                                            <span className="text-stone-400 tabular-nums">{pct(share)}</span>
                                                        </span>
                                                    ))}
                                                {Object.keys(snapshot.payload.devices).length === 0 && (
                                                    <p className="text-xs text-stone-400">No device data.</p>
                                                )}
                                            </div>
                                        </div>

                                        {/* Referrers + UTM */}
                                        <div className="flex flex-col gap-2">
                                            <p className="text-[11px] font-medium tracking-wider text-stone-400 uppercase">
                                                Where visitors come from
                                            </p>
                                            <div className="flex flex-col divide-y divide-stone-100 bg-white border border-stone-200 rounded-xl px-4">
                                                {snapshot.payload.referrers.slice(0, 5).map((r) => (
                                                    <div key={r.domain} className="flex items-center justify-between gap-3 py-2">
                                                        <span className="text-xs text-stone-700 truncate">
                                                            {r.domain === "$direct" ? "Direct" : r.domain}
                                                        </span>
                                                        <span className="text-xs text-stone-400 tabular-nums shrink-0">
                                                            {fmt(r.visitors)}
                                                        </span>
                                                    </div>
                                                ))}
                                                {snapshot.payload.referrers.length === 0 && (
                                                    <p className="text-xs text-stone-400 py-2">No referrer data.</p>
                                                )}
                                            </div>
                                        </div>

                                        {/* Top events */}
                                        {snapshot.payload.top_events.length > 0 && (
                                            <div className="flex flex-col gap-2">
                                                <p className="text-[11px] font-medium tracking-wider text-stone-400 uppercase">
                                                    Your events
                                                </p>
                                                <div className="flex flex-wrap gap-2">
                                                    {snapshot.payload.top_events.slice(0, 6).map((e) => (
                                                        <span
                                                            key={e.event}
                                                            className="text-xs text-stone-600 bg-white border border-stone-200 rounded-lg px-3 py-1.5 font-mono"
                                                        >
                                                            {e.event}{" "}
                                                            <span className="text-stone-400 font-sans tabular-nums">
                                                                {fmt(e.count)}
                                                            </span>
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                ))
            )}
        </div>
    );
}

function StatTile({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex flex-col gap-0.5 bg-white border border-stone-200 rounded-xl px-4 py-3">
            <span className="text-[11px] text-stone-400">{label}</span>
            <span className="text-sm font-semibold text-stone-800 truncate font-robot tabular-nums">
                {value}
            </span>
        </div>
    );
}
