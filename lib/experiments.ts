import { supabase } from "@/lib/supabaseClient";
import { ChangeType, Experiment, GoalType, PageElement, VariantPayload } from "@/lib/types";

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

// get all experiments for a user, newest first
export async function getExperiments(user_id: string) {
    const { data, error } = await supabase
        .from("experiments")
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", { ascending: false });

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
