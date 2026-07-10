import Anthropic from "@anthropic-ai/sdk";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { Comment, PageElement } from "@/lib/types";

// ─── The "closing the loop" step ────────────────────────────────────────────
//
// Called by /api/agent/evaluate right after it COMPLETES an experiment
// (winner promoted, or control kept). Claude looks at the finished test's
// outcome plus the report's unused AI findings and either:
//   - proposes the single best next test → written as a REAL draft experiment
//     (created_by = 'agent') that the founder approves via the normal
//     Activate button, or dismisses, or
//   - skips, when no remaining finding is worth betting on.
//
// Claude proposes; it never activates. Statistics still decides winners.
//
// Model: Sonnet 5 by default (cheap enough for testing), overridable via
// AGENT_PROPOSE_MODEL — set it to claude-opus-4-8 in production, where the
// quality of this one call IS the product.
const MODEL = process.env.AGENT_PROPOSE_MODEL ?? "claude-sonnet-5";

const MAX_VARIANTS = 3;

// What Claude must return. Structured outputs guarantee this exact shape —
// no JSON-escaping prompt hacks, no markdown fences to strip.
const PROPOSAL_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["decision", "comment_id", "name", "hypothesis", "variants", "rationale"],
    properties: {
        decision: { type: "string", enum: ["propose", "skip"] },
        comment_id: {
            type: "integer",
            description: "id of the chosen finding from CANDIDATE FINDINGS; 0 when skipping",
        },
        name: { type: "string", description: "short experiment name; empty when skipping" },
        hypothesis: {
            type: "string",
            description: "one sentence: 'If …, then …, because …'; empty when skipping",
        },
        variants: {
            type: "array",
            items: { type: "string" },
            description:
                "1-3 complete replacement texts for the element; empty array when skipping",
        },
        rationale: {
            type: "string",
            description:
                "1-3 sentences to the founder: why this test, why now, referencing the finished test's result. When skipping, explain why nothing is worth testing.",
        },
    },
} as const;

const SYSTEM_PROMPT = `You are the optimization agent inside Sitewide, an autonomous A/B testing tool for SaaS founders. An experiment on the founder's page just finished. Your job: pick the single best NEXT test from the page's unused AI findings — or skip if none is worth running.

Rules:
- Only propose a test you would bet money on. One strong proposal beats a mediocre one; skipping is a valid, respected decision.
- Treat the finished test's outcome as evidence about this specific audience. If a framing won, look for findings where the same lesson applies. If variants lost, don't propose more of the same idea.
- Prefer findings where has_markup is false (their elements can be swapped cleanly).
- Never propose a finding whose element was already tested.
- variants: 1 to ${MAX_VARIANTS} complete replacements for the element's current text. Each must clearly differ from the original. Match the page's voice; be concrete and benefit-led, not clever.
- rationale is read by the founder on their dashboard. Write it to them directly ("Your headline test showed…"), 1-3 sentences, no fluff.`;

type ProposeResult =
    | { proposed: true; experiment_id: string; name: string }
    | { proposed: false; reason: string };

type ClaudeProposal = {
    decision: "propose" | "skip";
    comment_id: number;
    name: string;
    hypothesis: string;
    variants: string[];
    rationale: string;
};

// Split 100% of traffic evenly; remainder goes to control.
// (Duplicated from lib/experiments.ts, which is browser-client code.)
function splitWeights(groupCount: number): number[] {
    const base = Math.floor(100 / groupCount);
    const weights = Array(groupCount).fill(base);
    weights[0] += 100 - base * groupCount;
    return weights;
}

export async function proposeNextExperiment(
    supabase: ReturnType<typeof getSupabaseAdmin>,
    completed_experiment_id: string,
    outcome_summary: string
): Promise<ProposeResult> {
    // ── 1. Load the finished experiment + its context ────────────────────────
    const { data: exp } = await supabase
        .from("experiments")
        .select("*")
        .eq("id", completed_experiment_id)
        .single();
    if (!exp) return { proposed: false, reason: "experiment not found" };
    if (!exp.report_id) return { proposed: false, reason: "no report linked — nothing to propose from" };

    // Guardrail: one pending proposal per founder. Don't pile up drafts the
    // user hasn't looked at yet.
    const { data: pending } = await supabase
        .from("experiments")
        .select("id")
        .eq("user_id", exp.user_id)
        .eq("created_by", "agent")
        .eq("status", "draft")
        .limit(1);
    if (pending && pending.length > 0) {
        return { proposed: false, reason: "a previous agent proposal is still awaiting review" };
    }

    const [{ data: report }, { data: comments }, { data: siblings }] = await Promise.all([
        supabase.from("reports").select("url, elements").eq("id", exp.report_id).single(),
        supabase.from("comments").select("*").eq("report_id", exp.report_id),
        supabase
            .from("experiments")
            .select("selector, source_comment_id")
            .eq("user_id", exp.user_id)
            .eq("report_id", exp.report_id),
    ]);
    if (!report?.elements || !comments || comments.length === 0) {
        return { proposed: false, reason: "no findings available on this report" };
    }

    const elements = report.elements as PageElement[];
    const usedCommentIds = new Set((siblings ?? []).map((s) => s.source_comment_id).filter(Boolean));
    const usedSelectors = new Set((siblings ?? []).map((s) => s.selector).filter(Boolean));

    // ── 2. Build the candidate list (unused, text-swappable findings) ───────
    const candidates = (comments as Comment[])
        .map((c) => ({ comment: c, element: elements.find((el) => el.id === c.element_id) }))
        .filter(({ comment, element }) => {
            if (usedCommentIds.has(Number(comment.id))) return false;
            if (element?.selector && usedSelectors.has(element.selector)) return false;
            // v1 proposes text changes only — the element needs visible text
            return !!element && !!element.text && element.tag !== "img";
        });
    if (candidates.length === 0) {
        return { proposed: false, reason: "every finding on this report has already been tested" };
    }

    // ── 3. Ask Claude ─────────────────────────────────────────────────────────
    const context = {
        page_url: exp.page_url,
        finished_experiment: {
            name: exp.name,
            hypothesis: exp.hypothesis,
            element_original_text: exp.original_value,
            outcome: outcome_summary,
        },
        candidate_findings: candidates.map(({ comment, element }) => ({
            id: Number(comment.id),
            element_tag: element!.tag,
            current_text: element!.text,
            has_markup: !!element!.hasMarkup,
            finding: comment.comment,
            suggestion: comment.suggestion,
            hypothesis: comment.hypothesis,
            suggested_variants: comment.variants,
            impact: comment.meta?.impact ?? null,
            effort: comment.meta?.effort ?? null,
        })),
    };

    const anthropic = new Anthropic();
    const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 4000, // adaptive thinking spends from this budget too
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: JSON.stringify(context, null, 2) }],
        output_config: { format: { type: "json_schema", schema: PROPOSAL_SCHEMA } },
    });

    if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") {
        return { proposed: false, reason: `model stopped early (${response.stop_reason})` };
    }
    const text = response.content.find((b) => b.type === "text")?.text;
    if (!text) return { proposed: false, reason: "model returned no text" };
    const proposal = JSON.parse(text) as ClaudeProposal;

    if (proposal.decision === "skip") {
        return { proposed: false, reason: proposal.rationale || "model chose to skip" };
    }

    // ── 4. Validate — never trust model output into the database ────────────
    const chosen = candidates.find(({ comment }) => Number(comment.id) === proposal.comment_id);
    if (!chosen) return { proposed: false, reason: "model picked an unknown finding — skipped" };
    const element = chosen.element!;

    const variants = proposal.variants
        .map((v) => v.trim())
        .filter((v) => v && v !== element.text)
        .slice(0, MAX_VARIANTS);
    if (variants.length === 0) {
        return { proposed: false, reason: "model produced no usable variants — skipped" };
    }

    // ── 5. Write the draft experiment + variant rows ─────────────────────────
    const { data: created, error: expError } = await supabase
        .from("experiments")
        .insert({
            user_id: exp.user_id,
            report_id: exp.report_id,
            site_id: exp.site_id,
            page_url: exp.page_url,
            name: proposal.name.slice(0, 120) || `Agent: ${element.text?.slice(0, 40)}`,
            hypothesis: proposal.hypothesis || null,
            selector: element.selector,
            selector_fallback: element.fallback,
            change_type: "text",
            original_value: element.text,
            // Same goal as the finished test — same page, same conversion.
            goal_type: exp.goal_type,
            goal_selector: exp.goal_selector,
            goal_fallback: exp.goal_fallback,
            goal_page_path: exp.goal_page_path,
            min_sample_size: exp.min_sample_size,
            auto_promote: exp.auto_promote,
            status: "draft",
            created_by: "agent",
            agent_rationale: proposal.rationale || null,
            source_comment_id: proposal.comment_id,
        })
        .select("id")
        .single();
    if (expError || !created) {
        return { proposed: false, reason: `insert failed: ${expError?.message}` };
    }

    const weights = splitWeights(variants.length + 1);
    const { error: variantsError } = await supabase.from("experiment_variants").insert([
        {
            experiment_id: created.id,
            name: "Control",
            is_control: true,
            payload: null,
            weight: weights[0],
            position: 0,
        },
        ...variants.map((text, i) => ({
            experiment_id: created.id,
            name: `Variant ${String.fromCharCode(66 + i)}`,
            is_control: false,
            payload: { text },
            weight: weights[i + 1],
            position: i + 1,
        })),
    ]);
    if (variantsError) {
        // never leave a variant-less experiment behind
        await supabase.from("experiments").delete().eq("id", created.id);
        return { proposed: false, reason: `variant insert failed: ${variantsError.message}` };
    }

    // ── 6. Remember — the audit-trail row the founder reads ─────────────────
    await supabase.from("agent_actions").insert({
        experiment_id: completed_experiment_id,
        action: "proposed_experiment",
        detail: {
            experiment_id: created.id,
            name: proposal.name,
            variants,
            rationale: proposal.rationale,
            source_comment_id: proposal.comment_id,
            model: MODEL,
        },
    });

    return { proposed: true, experiment_id: created.id as string, name: proposal.name };
}
