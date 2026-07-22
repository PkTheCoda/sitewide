// The WIN path, end to end — the half test-agent.mjs deliberately skips.
//
// test-agent.mjs exercises harm-gate / kill / pause with report_id=null, so it
// never promotes a winner and never drafts a follow-up. This script does the
// opposite: it seeds ONE experiment where a challenger clearly beats control,
// linked to a REAL report so the agent has findings to propose from, then runs
// the real evaluate route and asserts the whole closing-the-loop chain:
//
//   promoted_winner  →  proposed_experiment (a real agent draft)  →  email_sent
//
// Unlike test-agent.mjs it does NOT clean up on success — the point is to leave
// the promoted experiment + the queued draft in the dashboard so you can SEE
// them in the frontend. Run `node scripts/test-win-loop.mjs cleanup` when done.
//
//   Requires: `npm run dev` running (BASE_URL to override), ANTHROPIC_API_KEY
//   (for the proposal step) and RESEND_API_KEY (for the real email) in .env.
//   Usage: node scripts/test-win-loop.mjs [run|fresh|cleanup]  (default: run)
//     run     — seed + evaluate + assert, leave everything for inspection
//     fresh   — cleanup FIRST, then a clean run (use this to restart)
//     cleanup — remove the seeded experiment + the draft it queued
import { readFileSync } from "fs";

const env = {};
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
}
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const AGENT_SECRET = env.AGENT_SECRET;
const LOCAL = process.env.BASE_URL ?? "http://localhost:3000";
const MARK = "__SW_WIN_TEST__";

// Seed against a real report so the proposal step has real findings to pick
// from. Report 22 (talem.org) is owned by the founder account and has 10
// findings, only one used. Its owner/site/goal are copied from the running
// experiment on it so the seeded row is internally consistent.
const REPORT_ID = 22;
const OWNER_EXP_ID = "c5bf6ec3-d571-4b0f-9ef1-697239b58793";

const HEADERS = {
    apikey: KEY,
    Authorization: `Bearer ${KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
};

async function db(method, path, body) {
    const res = await fetch(`${URL_}/rest/v1/${path}`, {
        method,
        headers: HEADERS,
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
    return text ? JSON.parse(text) : null;
}

let pass = 0,
    fail = 0;
function check(name, cond, extra = "") {
    if (cond) {
        pass++;
        console.log(`  PASS ${name}`);
    } else {
        fail++;
        console.log(`  FAIL ${name} ${extra}`);
    }
}

// exposures visitors, conversions for the first C of them (same shape the real
// snippet produces: one exposure row + at most one conversion row per visitor).
function events(expId, variantId, prefix, exposures, conversions) {
    const rows = [];
    for (let i = 0; i < exposures; i++)
        rows.push({ experiment_id: expId, variant_id: variantId, visitor_id: `${prefix}-${i}`, event_type: "exposure" });
    for (let i = 0; i < conversions; i++)
        rows.push({ experiment_id: expId, variant_id: variantId, visitor_id: `${prefix}-${i}`, event_type: "conversion" });
    return rows;
}

async function setup() {
    console.log("== setup ==");
    const [owner] = await db(
        "GET",
        `experiments?id=eq.${OWNER_EXP_ID}&select=user_id,site_id,goal_type,goal_selector,goal_page_path`
    );
    if (!owner) throw new Error(`owner experiment ${OWNER_EXP_ID} not found`);

    // Guardrail check: the proposal step allows one pending agent draft per
    // founder. If one already exists, queue-next will (correctly) skip — warn
    // instead of producing a confusing FAIL.
    const pendingDrafts = await db(
        "GET",
        `experiments?user_id=eq.${owner.user_id}&created_by=eq.agent&status=eq.draft&select=id,name`
    );
    if (pendingDrafts.length > 0) {
        console.log(
            `  NOTE: founder already has a pending agent draft (${pendingDrafts[0].id}). ` +
                `queue-next will skip. Clear it first to test the proposal step.`
        );
    }

    const [exp] = await db("POST", "experiments", {
        user_id: owner.user_id,
        site_id: owner.site_id,
        report_id: REPORT_ID,
        page_url: "https://www.talem.org/__sitewide_win_test__", // never matched by real visitors
        name: `${MARK} hero headline win`,
        hypothesis: "A benefit-led headline converts better than the current one.",
        selector: "#sw-win-nonexistent",
        change_type: "text",
        original_value: "High School Made Easy",
        goal_type: owner.goal_type,
        goal_selector: owner.goal_selector,
        goal_page_path: owner.goal_page_path,
        min_sample_size: 100,
        auto_promote: true,
        status: "running",
    });
    const variants = await db("POST", "experiment_variants", [
        { experiment_id: exp.id, name: "Control", is_control: true, payload: null, weight: 50, position: 0 },
        { experiment_id: exp.id, name: "Variant B", is_control: false, payload: { text: "Get into college, stress-free" }, weight: 50, position: 1 },
    ]);

    // Control 6/120 = 5.0%, Variant B 42/120 = 35.0%. Both arms clear the
    // SAMPLE_FLOOR of 100; the gap is p ≈ 1e-9 — an unambiguous winner.
    await db("POST", "experiment_events", [
        ...events(exp.id, variants[0].id, "win-c", 120, 6),
        ...events(exp.id, variants[1].id, "win-b", 120, 42),
    ]);

    console.log("  seeded experiment:", exp.id, `(control 6/120 vs B 42/120)`);
    return { exp, variants };
}

async function run() {
    console.log("== evaluate (real route) ==");
    const res = await fetch(`${LOCAL}/api/agent/evaluate`, {
        method: "POST",
        headers: { authorization: `Bearer ${AGENT_SECRET}` },
    });
    const body = await res.json();
    check("evaluate returns 200", res.status === 200, `got ${res.status}`);
    return body;
}

async function assertAll({ exp, variants }) {
    console.log("== assertions ==");
    const [row] = await db("GET", `experiments?id=eq.${exp.id}&select=status,winner_variant_id,ended_at`);
    check("experiment completed", row.status === "completed", row.status);
    check("winner is Variant B", row.winner_variant_id === variants[1].id, row.winner_variant_id);
    check("ended_at stamped", !!row.ended_at);

    const acts = await db("GET", `agent_actions?experiment_id=eq.${exp.id}&select=action,detail`);

    const promoted = acts.find((a) => a.action === "promoted_winner");
    check("promoted_winner logged", !!promoted, JSON.stringify(acts.map((a) => a.action)));
    check("promoted_winner names Variant B", promoted?.detail?.winner_name === "Variant B", JSON.stringify(promoted?.detail?.winner_name));
    check("promoted_winner auto_promoted", promoted?.detail?.auto_promoted === true);

    // ── queue-next: a real agent draft must appear ────────────────────────────
    const proposed = acts.find((a) => a.action === "proposed_experiment");
    const skipped = acts.find((a) => a.action === "proposal_skipped" || a.action === "proposal_failed");
    if (proposed) {
        const draftId = proposed.detail?.experiment_id;
        check("proposed_experiment logged a draft id", !!draftId, JSON.stringify(proposed.detail));
        const [draft] = await db(
            "GET",
            `experiments?id=eq.${draftId}&select=id,name,status,created_by,agent_rationale,report_id`
        );
        check("queued draft exists", !!draft, draftId);
        check("queued draft is an agent draft", draft?.created_by === "agent" && draft?.status === "draft", JSON.stringify(draft));
        check("queued draft has variants", (await db("GET", `experiment_variants?experiment_id=eq.${draftId}&select=id`)).length >= 2);
        console.log(`  → QUEUED NEXT: "${draft?.name}"`);
        console.log(`    rationale: ${draft?.agent_rationale}`);
    } else {
        // Not a hard fail — surface WHY the loop didn't close so it's actionable.
        check(
            "queue-next produced a draft",
            false,
            skipped ? `skipped/failed: ${JSON.stringify(skipped.detail)}` : "no proposed_experiment and no skip logged"
        );
    }

    // ── the real decision email ───────────────────────────────────────────────
    const emailAct = acts.find((a) => a.action === "email_sent" || a.action === "email_failed");
    check("decision email attempted", !!emailAct, JSON.stringify(acts.map((a) => a.action)));
    check(
        "email subject is the winner subject",
        String(emailAct?.detail?.subject ?? "").includes("Winner promoted"),
        JSON.stringify(emailAct?.detail?.subject)
    );
    if (emailAct?.action === "email_sent") {
        console.log(`  → EMAIL SENT to ${emailAct.detail?.to} (resend id ${emailAct.detail?.resend_id}) — check your inbox`);
    } else {
        console.log(`  → EMAIL NOT SENT: ${emailAct?.detail?.reason} (fix RESEND_API_KEY / EMAIL_FROM to actually receive it)`);
    }
}

async function cleanup() {
    console.log("== cleanup ==");
    const exps = await db("GET", `experiments?name=like.${MARK}*&select=id`);
    const ids = exps.map((e) => e.id);
    if (ids.length === 0) return console.log("nothing to clean");

    // Also remove any agent draft this test caused the loop to queue.
    const draftIds = [];
    for (const id of ids) {
        const acts = await db("GET", `agent_actions?experiment_id=eq.${id}&action=eq.proposed_experiment&select=detail`);
        for (const a of acts) if (a.detail?.experiment_id) draftIds.push(a.detail.experiment_id);
    }
    const all = [...ids, ...draftIds];
    const inList = `in.(${all.join(",")})`;
    await db("PATCH", `experiments?id=${inList}`, { winner_variant_id: null });
    await db("DELETE", `experiment_events?experiment_id=${inList}`);
    await db("DELETE", `experiment_daily_views?experiment_id=${inList}`);
    await db("DELETE", `agent_actions?experiment_id=${inList}`);
    await db("DELETE", `experiment_variants?experiment_id=${inList}`);
    await db("DELETE", `experiments?id=${inList}`);
    console.log(`deleted ${ids.length} seeded experiment(s) + ${draftIds.length} queued draft(s)`);
}

const mode = process.argv[2] ?? "run";
try {
    if (mode === "cleanup") {
        await cleanup();
    } else {
        if (mode === "fresh") await cleanup();
        const ctx = await setup();
        await run();
        await assertAll(ctx);
        console.log(`\n${pass} passed, ${fail} failed`);
        console.log("\nLEFT IN PLACE for frontend inspection:");
        console.log(`  • completed experiment + 🏆: ${LOCAL.replace(/\/$/, "")}/dashboard/experiments/${ctx.exp.id}`);
        console.log(`  • the queued draft + winner:  ${LOCAL.replace(/\/$/, "")}/dashboard/experiments`);
        console.log("  When done: node scripts/test-win-loop.mjs cleanup");
        process.exit(fail > 0 ? 1 : 0);
    }
} catch (err) {
    console.error("TEST ERROR:", err.message);
    console.error("run `node scripts/test-win-loop.mjs cleanup` to remove leftovers");
    process.exit(1);
}
