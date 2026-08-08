import { supabase } from "@/lib/supabaseClient";
import {
    AnalyticsSnapshot,
    ChangeType,
    DailySeries,
    DailyStat,
    Experiment,
    GoalType,
    PageElement,
    Site,
    VariantPayload,
} from "@/lib/types";

// Everything the builder collects before submitting. The element objects come
// straight from report.elements — we lift the selector + fallback off them here
// so the UI never has to think about selectors.
export type NewExperiment = {
    user_id: string;
    report_id: number;
    page_url: string;
    name: string;
    hypothesis: string | null;
    target: PageElement;
    change_type: ChangeType;
    // One payload per variant (control is added automatically).
    variant_payloads: VariantPayload[];
    goal_type: GoalType;
    goal_element: PageElement | null; // required for click goals
    goal_page_path: string | null;    // required for pageview goals
    // Per-variant exposure FLOOR before the agent starts judging — a guardrail
    // against tiny-n flukes, not a power-analysis commitment (the Bayesian
    // sequential rule in lib/stats.ts decides when the data is sufficient).
    // The builder passes DECISION_FLOOR. Omit to keep the DB default.
    min_sample_size?: number;
};

// Split 100% of traffic evenly across control + variants.
// Any remainder from integer division goes to control.
function splitWeights(groupCount: number): number[] {
    const base = Math.floor(100 / groupCount);
    const weights = Array(groupCount).fill(base);
    weights[0] += 100 - base * groupCount;
    return weights;
}

// create an experiment (status: draft) with its control + variant rows.
// Two inserts: 1 row into `experiments` (what element, what goal, who owns it)
// then N rows into `experiment_variants` (control + each version to test).
export async function createExperiment(input: NewExperiment) {
    // Step 1 — the experiment row. Selector + fallback are copied off the
    // PageElement the user clicked, so the builder UI never handles selectors.
    const { data: experiment, error } = await supabase
        .from("experiments")
        .insert({
            user_id: input.user_id,
            report_id: input.report_id,
            page_url: input.page_url,
            name: input.name,
            hypothesis: input.hypothesis,
            selector: input.target.selector,
            selector_fallback: input.target.fallback,
            change_type: input.change_type,
            original_value:
                input.change_type === "image"
                    ? input.target.src ?? null
                    : input.target.text ?? input.target.alt ?? null,
            goal_type: input.goal_type,
            goal_selector: input.goal_element?.selector ?? null,
            goal_fallback: input.goal_element?.fallback ?? null,
            goal_page_path: input.goal_page_path,
            // Only override the column default when the estimator produced a
            // real number — a bare `undefined` would blow away the default.
            ...(input.min_sample_size != null && { min_sample_size: input.min_sample_size }),
            status: "draft",
        })
        .select("id")
        .single();

    if (error) {
        console.error(error);
        return { error: error.message };
    }

    // Step 2 — the variant rows. Control always exists and always comes first
    // (position 0, payload null = "change nothing for these visitors").
    const weights = splitWeights(input.variant_payloads.length + 1);
    const variantRows = [
        {
            experiment_id: experiment.id,
            name: "Control",
            is_control: true,
            payload: null,
            weight: weights[0],
            position: 0,
        },
        ...input.variant_payloads.map((payload, i) => ({
            experiment_id: experiment.id,
            name: `Variant ${String.fromCharCode(66 + i)}`, // B, C, D…
            is_control: false,
            payload,
            weight: weights[i + 1],
            position: i + 1,
        })),
    ];

    const { error: variantsError } = await supabase
        .from("experiment_variants")
        .insert(variantRows);

    if (variantsError) {
        // Don't leave an experiment with no variants behind
        await supabase.from("experiments").delete().eq("id", experiment.id);
        console.error(variantsError);
        return { error: variantsError.message };
    }

    return { id: experiment.id as string };
}

// get all experiments for a user, newest first (archived = dismissed agent
// proposals and retired tests — hidden from the list)
export async function getExperiments(user_id: string) {
    const { data, error } = await supabase
        .from("experiments")
        .select("*")
        .eq("user_id", user_id)
        .neq("status", "archived")
        .order("created_at", { ascending: false });

    if (error) {
        console.error(error);
        return { error: error.message };
    }

    return data;
}

// get one experiment by id (RLS enforces ownership)
export async function getExperiment(experiment_id: string) {
    const { data, error } = await supabase
        .from("experiments")
        .select("*")
        .eq("id", experiment_id)
        .single();

    if (error) {
        console.error(error);
        return { error: error.message };
    }

    return data;
}

// activate a draft/paused experiment. Ensures a `sites` row exists for the
// experiment's domain (the snippet identifies itself by site id), links it,
// and flips status to running. Returns the site_id for install instructions.
export async function activateExperiment(experiment: Experiment) {
    let domain: string;
    try {
        domain = new URL(experiment.page_url).hostname;
    } catch {
        return { error: `Invalid page URL: ${experiment.page_url}` };
    }

    // find-or-create the site for this domain
    let site_id = experiment.site_id;
    if (!site_id) {
        const { data: existing } = await supabase
            .from("sites")
            .select("id")
            .eq("user_id", experiment.user_id)
            .eq("domain", domain)
            .maybeSingle();

        if (existing) {
            site_id = existing.id;
        } else {
            const { data: created, error: siteError } = await supabase
                .from("sites")
                .insert({ user_id: experiment.user_id, domain })
                .select("id")
                .single();
            if (siteError) {
                console.error(siteError);
                return { error: siteError.message };
            }
            site_id = created.id;
        }
    }

    const { error } = await supabase
        .from("experiments")
        .update({
            site_id,
            status: "running",
            started_at: experiment.started_at ?? new Date().toISOString(),
        })
        .eq("id", experiment.id);

    if (error) {
        console.error(error);
        return { error: error.message };
    }

    return { site_id: site_id as string };
}

// rename an experiment (names are the founder's handle on a test — shown
// everywhere instead of ids)
export async function renameExperiment(experiment_id: string, name: string) {
    const { error } = await supabase
        .from("experiments")
        .update({ name: name.trim() })
        .eq("id", experiment_id);

    if (error) {
        console.error(error);
        return { error: error.message };
    }
    return { ok: true };
}

// dismiss an experiment (archive it) — how a founder rejects an agent
// proposal. The row stays in the DB so source_comment_id keeps that finding
// marked as used and the agent never proposes it again.
export async function dismissExperiment(experiment_id: string) {
    const { error } = await supabase
        .from("experiments")
        .update({ status: "archived" })
        .eq("id", experiment_id);

    if (error) {
        console.error(error);
        return { error: error.message };
    }
    return { ok: true };
}

// permanently delete an experiment and everything under it. The DB cascades
// variants, events, agent_actions, and daily views off the experiments row
// (verified empirically — see app/api/account/delete/route.ts), so a single
// delete leaves nothing orphaned. Unlike dismiss (which archives), this is
// irreversible and removes the row entirely. RLS scopes it to the owner.
export async function deleteExperiment(experiment_id: string) {
    const { error } = await supabase
        .from("experiments")
        .delete()
        .eq("id", experiment_id);

    if (error) {
        console.error(error);
        return { error: error.message };
    }
    return { ok: true };
}

// pause a running experiment (snippet stops serving it within the cache TTL)
export async function pauseExperiment(experiment_id: string) {
    const { error } = await supabase
        .from("experiments")
        .update({ status: "paused" })
        .eq("id", experiment_id);

    if (error) {
        console.error(error);
        return { error: error.message };
    }
    return { ok: true };
}

// raw events for an experiment — the dashboard aggregates these client-side
// (unique-per-visitor is guaranteed by the DB index, so counting rows is
// counting visitors)
export async function getExperimentEvents(experiment_id: string) {
    const { data, error } = await supabase
        .from("experiment_events")
        .select("variant_id, event_type")
        .eq("experiment_id", experiment_id);

    if (error) {
        console.error(error);
        return { error: error.message };
    }
    return data;
}

// Day-by-day chart data for one experiment, zero-filled from the first day
// with any data through today (UTC days everywhere — matching the counter).
//
// Two sources, deliberately different semantics:
//   - views: experiment_daily_views — RAW page loads of the experiment page
//   - exposures/conversions: experiment_events grouped by created_at day —
//     NEW unique visitors that day, because the DB keeps only each visitor's
//     first event. These are the same numbers the agent's z-test consumes.
export async function getExperimentDailySeries(experiment_id: string): Promise<DailySeries | { error: string }> {
    const [eventsRes, viewsRes] = await Promise.all([
        supabase
            .from("experiment_events")
            .select("variant_id, event_type, created_at")
            .eq("experiment_id", experiment_id),
        supabase
            .from("experiment_daily_views")
            .select("variant_id, day, views")
            .eq("experiment_id", experiment_id),
    ]);

    if (eventsRes.error) {
        console.error(eventsRes.error);
        return { error: eventsRes.error.message };
    }
    if (viewsRes.error) {
        console.error(viewsRes.error);
        return { error: viewsRes.error.message };
    }

    const utcDay = (iso: string) => new Date(iso).toISOString().slice(0, 10);

    // bucket[variantId][day] accumulates; "" holds the cross-variant totals
    const bucket: Record<string, Record<string, { views: number; exposures: number; conversions: number }>> = {};
    const at = (variant: string, day: string) => {
        bucket[variant] ??= {};
        return (bucket[variant][day] ??= { views: 0, exposures: 0, conversions: 0 });
    };

    for (const row of viewsRes.data) {
        at(row.variant_id, row.day).views += row.views;
        at("", row.day).views += row.views;
    }
    for (const row of eventsRes.data) {
        const day = utcDay(row.created_at);
        const key = row.event_type === "exposure" ? "exposures" : "conversions";
        at(row.variant_id, day)[key] += 1;
        at("", day)[key] += 1;
    }

    // Zero-filled day range: first day with any data → today. Without this,
    // charts silently skip quiet days and the x-axis lies about time.
    const allDays = Object.values(bucket).flatMap((byDay) => Object.keys(byDay));
    if (allDays.length === 0) return { days: [], byVariant: {} };
    const first = allDays.sort()[0];
    const today = new Date().toISOString().slice(0, 10);

    const range: string[] = [];
    for (let d = new Date(first + "T00:00:00Z"); d.toISOString().slice(0, 10) <= today; d.setUTCDate(d.getUTCDate() + 1)) {
        range.push(d.toISOString().slice(0, 10));
    }

    const series = (variant: string): DailyStat[] =>
        range.map((day) => ({ day, ...(bucket[variant]?.[day] ?? { views: 0, exposures: 0, conversions: 0 }) }));

    const byVariant: Record<string, DailyStat[]> = {};
    for (const variant of Object.keys(bucket)) {
        if (variant !== "") byVariant[variant] = series(variant);
    }

    return { days: series(""), byVariant };
}

// Cross-experiment agent activity for the dashboard home, newest first.
// Joins the experiment name in (one FK links agent_actions → experiments, so
// no disambiguation hint needed). Email bookkeeping rows are noise here — the
// feed is "what did the agent decide", not "what did it mail".
// Paginated: pass the previous page's length as offset to load more.
export async function getAgentFeed(user_id: string, limit = 6, offset = 0) {
    const { data, error } = await supabase
        .from("agent_actions")
        .select("*, experiments!inner(id, name, user_id)")
        .eq("experiments.user_id", user_id)
        .not("action", "in", "(email_sent,email_failed)")
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

    if (error) {
        console.error(error);
        return { error: error.message };
    }
    return data;
}

// 7-day unique visitor / conversion counts across ALL the user's experiments —
// the dashboard stat tiles. Two head-only count queries; no rows transferred.
export async function getWeeklyEventCounts(user_id: string) {
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const countSince = (event_type: string) =>
        supabase
            .from("experiment_events")
            .select("id, experiments!inner(user_id)", { count: "exact", head: true })
            .eq("experiments.user_id", user_id)
            .eq("event_type", event_type)
            .gte("created_at", since);

    const [exposures, conversions] = await Promise.all([
        countSince("exposure"),
        countSince("conversion"),
    ]);
    if (exposures.error || conversions.error) {
        const message = (exposures.error ?? conversions.error)!.message;
        console.error(message);
        return { error: message };
    }
    return { exposures: exposures.count ?? 0, conversions: conversions.count ?? 0 };
}

// find-or-create the sites row for a URL's domain. Used by onboarding (so the
// install-snippet step has a site id before any experiment exists) — the same
// find-or-create activateExperiment does later, so no duplicate rows.
export async function ensureSite(user_id: string, page_url: string) {
    let domain: string;
    try {
        domain = new URL(/^https?:\/\//i.test(page_url) ? page_url : `https://${page_url}`).hostname;
    } catch {
        return { error: `Invalid URL: ${page_url}` };
    }

    const { data: existing } = await supabase
        .from("sites")
        .select("*")
        .eq("user_id", user_id)
        .eq("domain", domain)
        .maybeSingle();
    if (existing) return existing as Site;

    const { data: created, error } = await supabase
        .from("sites")
        .insert({ user_id, domain })
        .select("*")
        .single();
    if (error) {
        console.error(error);
        return { error: error.message };
    }
    return created as Site;
}

// Latest PostHog snapshot for the site owning this page URL — RLS returns
// only the caller's own sites/snapshots. Null on any miss (no site, no
// integration, no snapshot yet): callers fall back to no-analytics behavior.
export async function getLatestSnapshotForUrl(
    page_url: string
): Promise<AnalyticsSnapshot | null> {
    let domain: string;
    try {
        domain = new URL(/^https?:\/\//i.test(page_url) ? page_url : `https://${page_url}`).hostname;
    } catch {
        return null;
    }
    const { data: site } = await supabase
        .from("sites")
        .select("id")
        .eq("domain", domain)
        .limit(1)
        .maybeSingle();
    if (!site) return null;
    const { data: snapshot } = await supabase
        .from("analytics_snapshots")
        .select("*")
        .eq("site_id", site.id)
        .order("captured_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    return (snapshot as AnalyticsSnapshot) ?? null;
}

// the user's sites — powers the snippet-health chip (snippet_last_seen_at is
// bumped by every config fetch, so "recently seen" ≈ "installed and alive")
export async function getSites(user_id: string) {
    const { data, error } = await supabase
        .from("sites")
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", { ascending: true });

    if (error) {
        console.error(error);
        return { error: error.message };
    }
    return data;
}

// agent decision log for an experiment, newest first
export async function getAgentActions(experiment_id: string) {
    const { data, error } = await supabase
        .from("agent_actions")
        .select("*")
        .eq("experiment_id", experiment_id)
        .order("created_at", { ascending: false });

    if (error) {
        console.error(error);
        return { error: error.message };
    }
    return data;
}

// get all variants for an experiment, control first
export async function getExperimentVariants(experiment_id: string) {
    const { data, error } = await supabase
        .from("experiment_variants")
        .select("*")
        .eq("experiment_id", experiment_id)
        .order("position", { ascending: true });

    if (error) {
        console.error(error);
        return { error: error.message };
    }

    return data;
}
