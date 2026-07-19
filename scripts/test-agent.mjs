// Phase 1 agent hardening — end-to-end test against the real routes + DB.
// Requires a dev server: `npm run dev`, then `node scripts/test-agent.mjs`.
// Override the server with BASE_URL, e.g. BASE_URL=https://sitewide.vercel.app
// Creates synthetic experiments (marker names, unreachable page path), runs
// the agent through the local dev server, asserts every decision in the DB,
// then cleans up. Usage: node test_agent.mjs [setup|assert|cleanup|all]
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
const MARK = "__SW_AGENT_TEST__";

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

// visitors v0..vN-1 for a variant; conversions for the first C of them
function events(expId, variantId, prefix, exposures, conversions, misses = 0) {
  const rows = [];
  for (let i = 0; i < exposures; i++)
    rows.push({ experiment_id: expId, variant_id: variantId, visitor_id: `${prefix}-${i}`, event_type: "exposure" });
  for (let i = 0; i < conversions; i++)
    rows.push({ experiment_id: expId, variant_id: variantId, visitor_id: `${prefix}-${i}`, event_type: "conversion" });
  for (let i = 0; i < misses; i++)
    rows.push({ experiment_id: expId, variant_id: variantId, visitor_id: `${prefix}-${i}`, event_type: "selector_miss" });
  return rows;
}

async function makeExperiment(base, name, minSample, variantDefs) {
  const [exp] = await db("POST", "experiments", {
    user_id: base.user_id,
    site_id: base.site_id,
    report_id: null, // no report -> proposal step logs proposal_skipped, writes nothing
    page_url: "https://www.talem.org/__sitewide_test__", // path never matched by real visitors
    name: `${MARK} ${name}`,
    selector: "#sw-test-nonexistent",
    change_type: "text",
    original_value: "test",
    goal_type: "click",
    goal_selector: "#sw-test-goal",
    min_sample_size: minSample,
    auto_promote: true,
    status: "running",
  });
  const variants = await db(
    "POST",
    "experiment_variants",
    variantDefs.map((v, i) => ({
      experiment_id: exp.id,
      name: v.name,
      is_control: i === 0,
      payload: i === 0 ? null : { text: v.name },
      weight: v.weight,
      position: i,
    }))
  );
  return { exp, variants };
}

async function setup() {
  console.log("== setup ==");
  const [real] = await db("GET", "experiments?select=user_id,site_id&limit=1&status=eq.running");
  if (!real) throw new Error("no running experiment to copy user/site from");

  // A: single challenger losing hard, min_sample 1000 -> harm gate must fire pre-min-sample
  const A = await makeExperiment(real, "A harm-gate all", 1000, [
    { name: "Control", weight: 50 },
    { name: "Bad Variant", weight: 50 },
  ]);
  await db("POST", "experiment_events", [
    ...events(A.exp.id, A.variants[0].id, "a-c", 100, 30),
    ...events(A.exp.id, A.variants[1].id, "a-b", 100, 5),
  ]);

  // B: one of two challengers losing hard -> partial kill, experiment continues
  const B = await makeExperiment(real, "B partial kill", 100, [
    { name: "Control", weight: 34 },
    { name: "Bad Variant", weight: 33 },
    { name: "Fine Variant", weight: 33 },
  ]);
  await db("POST", "experiment_events", [
    ...events(B.exp.id, B.variants[0].id, "b-c", 100, 20),
    ...events(B.exp.id, B.variants[1].id, "b-bad", 100, 4),
    ...events(B.exp.id, B.variants[2].id, "b-ok", 100, 22),
  ]);

  // C: variant with heavy selector misses -> pause
  const C = await makeExperiment(real, "C selector miss", 100, [
    { name: "Control", weight: 50 },
    { name: "Broken Variant", weight: 50 },
  ]);
  await db("POST", "experiment_events", [
    ...events(C.exp.id, C.variants[0].id, "c-c", 40, 5),
    ...events(C.exp.id, C.variants[1].id, "c-b", 20, 2, 6),
  ]);

  console.log("created:", A.exp.id, B.exp.id, C.exp.id);
  return { A, B, C };
}

async function eventRouteChecks(runningExpId, runningVariantId) {
  console.log("== event route ==");
  const post = (body) =>
    fetch(`${LOCAL}/api/snippet/event`, { method: "POST", body: JSON.stringify(body) });

  const ok = await post({
    experiment_id: runningExpId,
    variant_id: runningVariantId,
    visitor_id: "evt-test-1",
    event_type: "selector_miss",
  });
  check("selector_miss accepted", ok.status === 200, `got ${ok.status}`);

  const dup = await post({
    experiment_id: runningExpId,
    variant_id: runningVariantId,
    visitor_id: "evt-test-1",
    event_type: "selector_miss",
  });
  check("selector_miss dedupe is silent", dup.status === 200, `got ${dup.status}`);

  const bad = await post({
    experiment_id: runningExpId,
    variant_id: runningVariantId,
    visitor_id: "evt-test-2",
    event_type: "hacked",
  });
  check("unknown event_type rejected", bad.status === 400, `got ${bad.status}`);

  const rows = await db(
    "GET",
    `experiment_events?experiment_id=eq.${runningExpId}&visitor_id=eq.evt-test-1&select=id`
  );
  check("exactly one selector_miss row stored", rows.length === 1, `got ${rows.length}`);
}

async function run() {
  console.log("== evaluate ==");
  const res = await fetch(`${LOCAL}/api/agent/evaluate`, {
    method: "POST",
    headers: { authorization: `Bearer ${AGENT_SECRET}` },
  });
  const body = await res.json();
  console.log(JSON.stringify(body).slice(0, 400));
  check("evaluate returns 200", res.status === 200, `got ${res.status}`);
  return body;
}

async function assertAll({ A, B, C }, evalBody) {
  console.log("== assertions ==");
  const get1 = async (p) => (await db("GET", p))[0];

  // A: harm gate ended it, control won, pre-min-sample (1000 nowhere near reached)
  const a = await get1(`experiments?id=eq.${A.exp.id}&select=status,winner_variant_id`);
  check("A completed", a.status === "completed", a.status);
  check("A winner is control", a.winner_variant_id === A.variants[0].id);
  const aActs = await db("GET", `agent_actions?experiment_id=eq.${A.exp.id}&select=action,detail`);
  const aKept = aActs.find((x) => x.action === "kept_control");
  check("A kept_control logged with harm_gate", aKept?.detail?.reason === "harm_gate");
  check("A proposal_skipped logged (no report)", aActs.some((x) => x.action === "proposal_skipped"));
  const aEmail = aActs.find((x) => x.action === "email_failed" || x.action === "email_sent");
  check(
    "A decision email attempted + logged",
    String(aEmail?.detail?.subject ?? "").includes("Test ended"),
    JSON.stringify(aEmail?.detail)
  );

  // B: bad variant killed, experiment still running
  const b = await get1(`experiments?id=eq.${B.exp.id}&select=status`);
  check("B still running", b.status === "running", b.status);
  const bBad = await get1(`experiment_variants?id=eq.${B.variants[1].id}&select=killed_at`);
  check("B bad variant killed_at set", !!bBad.killed_at);
  const bOk = await get1(`experiment_variants?id=eq.${B.variants[2].id}&select=killed_at`);
  check("B fine variant untouched", !bOk.killed_at);
  const bActs = await db("GET", `agent_actions?experiment_id=eq.${B.exp.id}&select=action,detail`);
  check("B killed_variant logged", bActs.some((x) => x.action === "killed_variant"));
  const bEmail = bActs.find((x) => x.action === "email_failed" || x.action === "email_sent");
  check(
    "B kill email names the right decision",
    String(bEmail?.detail?.subject ?? "").includes("Losing variant stopped"),
    JSON.stringify(bEmail?.detail)
  );

  // C: paused for selector misses
  const c = await get1(`experiments?id=eq.${C.exp.id}&select=status`);
  check("C paused", c.status === "paused", c.status);
  const cActs = await db("GET", `agent_actions?experiment_id=eq.${C.exp.id}&select=action,detail`);
  const cPause = cActs.find((x) => x.action === "paused_broken");
  check("C paused_broken logged with miss counts", cPause?.detail?.miss_visitors >= 6);

  // Heartbeats bracket the run
  const beats = await db(
    "GET",
    `agent_actions?experiment_id=is.null&select=action,detail&order=id.desc&limit=4`
  );
  check("run_finished heartbeat", beats.some((x) => x.action === "run_finished"));
  check("run_started heartbeat", beats.some((x) => x.action === "run_started"));
  const fin = beats.find((x) => x.action === "run_finished");
  check("heartbeat counts evaluations", (fin?.detail?.evaluated ?? 0) >= 3, JSON.stringify(fin?.detail));

  // min_sample floor: the real experiment (tiny min_sample) must now wait for 100
  const realResult = (evalBody.results ?? []).find((r) => !String(r.name ?? "").includes(MARK));
  check(
    "real experiment floored to min_sample 100",
    realResult?.reason === "insufficient_sample" && realResult?.min_sample_size === 100,
    JSON.stringify({ reason: realResult?.reason, min: realResult?.min_sample_size })
  );

  // config: killed flag visible to the snippet
  const site = (await db("GET", `experiments?id=eq.${B.exp.id}&select=site_id`))[0].site_id;
  const cfg = await (await fetch(`${LOCAL}/api/snippet/config?site_id=${site}`)).json();
  const bCfg = (cfg.experiments ?? []).find((e) => e.id === B.exp.id);
  const killedInCfg = bCfg?.variants?.find((v) => v.id === B.variants[1].id);
  check("config marks killed variant", killedInCfg?.killed === true, JSON.stringify(killedInCfg));
  check("config keeps killed variant's weight", killedInCfg?.weight === 33);

  // digest: builds per-founder; sends, or cleanly reports the missing key
  const dig = await fetch(`${LOCAL}/api/agent/digest`, {
    method: "POST",
    headers: { authorization: `Bearer ${AGENT_SECRET}`, "content-type": "application/json" },
    body: JSON.stringify({ force: true }),
  });
  const digBody = await dig.json();
  check("digest route 200", dig.status === 200, `got ${dig.status}`);
  check("digest built for at least the founder", (digBody.outcomes ?? []).length >= 1, JSON.stringify(digBody));
  const noKey = !env.RESEND_API_KEY;
  check(
    noKey ? "digest outcomes report missing key" : "digest outcomes sent",
    (digBody.outcomes ?? []).every((o) => (noKey ? o.sent === false : o.sent === true)),
    JSON.stringify(digBody.outcomes)
  );
}

async function cleanup() {
  console.log("== cleanup ==");
  const exps = await db("GET", `experiments?name=like.${MARK}*&select=id`);
  const ids = exps.map((e) => e.id);
  if (ids.length === 0) return console.log("nothing to clean");
  const inList = `in.(${ids.join(",")})`;
  await db("PATCH", `experiments?id=${inList}`, { winner_variant_id: null });
  await db("DELETE", `experiment_events?experiment_id=${inList}`);
  await db("DELETE", `experiment_daily_views?experiment_id=${inList}`);
  await db("DELETE", `agent_actions?experiment_id=${inList}`);
  await db("DELETE", `experiment_variants?experiment_id=${inList}`);
  await db("DELETE", `experiments?id=${inList}`);
  console.log(`deleted ${ids.length} synthetic experiments + children`);
}

const mode = process.argv[2] ?? "all";
try {
  if (mode === "cleanup") {
    await cleanup();
  } else {
    const ctx = await setup();
    await eventRouteChecks(ctx.B.exp.id, ctx.B.variants[2].id);
    const body = await run();
    await assertAll(ctx, body);
    await cleanup();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
} catch (err) {
  console.error("TEST ERROR:", err.message);
  console.error("run `node test_agent.mjs cleanup` to remove leftovers");
  process.exit(1);
}
