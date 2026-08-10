/**
 * CRITIC round 2, P32 — attack (3): is the probe's blind-pass bound priced on the population the
 * probe actually SERVES?
 *
 * `_deriveTestOutPlan` multiplies `probeItemBlindRate`, which comes from `bank-audit.json`. That
 * audit was drawn by `collectBankSample`, which sweeps bank difficulty tiers 1..5. The shipped
 * probe asks the bank for ONE tier, and it is not the node's: `_probeRequest` passes
 * `mastery.testOutDifficulty(kpId)` = `graph.centre(kpId) + 0.3`, which is a LOGIT (-1.6 .. +1.9),
 * and `Scheduler.serve()` hands `Math.max(1, Math.min(5, Math.round(difficulty)))` to
 * `ItemBank.select()`. So every probe on the graph draws bank tier 1 or 2.
 *
 * This script re-measures the blind rate of the stratum the probe really draws, using the SHIPPED
 * checker (`bank.check`) and the SHIPPED canonical-answer speller (`bank.accepts`), on items drawn
 * through the SHIPPED `Scheduler.serve()` at the SHIPPED probe request's difficulty.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Graph } from "../../app/src/learn/Graph.js";
import { Mastery } from "../../app/src/learn/Mastery.js";
import { Scheduler, mulberry32, virtualClock } from "../../app/src/learn/Scheduler.js";
import { itemBank } from "../../app/src/learn/ItemBank.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const GRAPH = new Graph(JSON.parse(readFileSync(resolve(ROOT, "content/knowledge-graph.json"), "utf8")));
const AUDIT = JSON.parse(readFileSync(resolve(ROOT, "app/src/learn/bank-audit.json"), "utf8"));
const clock = virtualClock(0);
const m = new Mastery(GRAPH, { bankAudit: AUDIT, storage: null, now: () => clock.minutes() });
const sch = new Scheduler(m, { clock, rng: mulberry32(7), sessionMinutes: 25, bank: itemBank });

const DRAWS = Number((process.argv.find((a) => a.startsWith("--draws=")) ?? "--draws=240").split("=")[1]);

const mark = (item, response) => {
  try { return itemBank.check(item, response).correct === true; } catch { return false; }
};
const spell = (item) => { try { return itemBank.accepts(item)[0]; } catch { return null; } };

/** Best fixed string over a drawn stratum, using the same candidate construction the audit uses. */
function strataRate(items) {
  if (!items.length) return { rate: 1, n: 0, answer: null, distinct: 0 };
  const counts = new Map();
  for (const it of items) {
    const k = spell(it) ?? JSON.stringify(it.answer ?? it.id);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const candidates = [...new Set([...counts.keys()].filter((x) => x != null).concat(["0", "1", "x", "always", "none"]))];
  let best = 0, answer = null;
  for (const c of candidates) {
    let h = 0;
    for (const it of items) if (mark(it, c)) h += 1;
    if (h > best) { best = h; answer = c; }
  }
  return { rate: best / items.length, n: items.length, answer, distinct: counts.size };
}

console.log(`stratum re-measurement — ${DRAWS} draws per probe cell, through Scheduler.serve() at the shipped probe difficulty\n`);
const rows = [];
let seq = 500000;
for (const kpId of GRAPH.ids) {
  const plan = m.testOutPlan(kpId);
  if (!plan.eligible) continue;
  const probeDiff = m.testOutDifficulty(kpId);
  const bankTier = Math.max(1, Math.min(5, Math.round(probeDiff)));
  const perForm = new Map();
  for (const form of new Set(plan.forms)) {
    const avoid = m.refusedFamilies(kpId, form);
    const items = [];
    const seenFams = new Map();
    const tierSeen = new Map();
    for (let d = 0; d < DRAWS; d++) {
      const req = { kpId, form, difficulty: probeDiff, seq: seq++, avoidFamilies: avoid, avoidItemIds: [] };
      const sel = sch.serve(req, itemBank, { dry: true });
      if (!sel) break;
      items.push(sel.item);
      seenFams.set(sel.family, (seenFams.get(sel.family) ?? 0) + 1);
      const t = sel.item.difficulty ?? sel.item.tier ?? null;
      tierSeen.set(t, (tierSeen.get(t) ?? 0) + 1);
    }
    perForm.set(form, { ...strataRate(items), fams: [...seenFams.entries()], tiers: [...tierSeen.entries()] });
  }
  let served = 1;
  for (const f of plan.forms) served *= perForm.get(f).rate;
  rows.push({
    kpId, band: GRAPH.difficulty(kpId), items: plan.items, probeDiff, bankTier,
    priced: plan.blindPass, served,
    ratio: plan.blindPass > 0 ? served / plan.blindPass : Infinity,
    detail: [...perForm.entries()].map(([f, r]) => `${f}:${r.rate.toFixed(3)}(n=${r.n},d=${r.distinct},tiers=${JSON.stringify(r.tiers)})`).join(" "),
  });
}

rows.sort((a, b) => b.served - a.served);
console.log("kp".padEnd(22) + "bd it  probeLogit bankTier  priced      SERVED(measured)  x over price");
for (const r of rows)
  console.log(
    `${r.kpId.padEnd(22)}${String(r.band).padEnd(3)}${String(r.items).padEnd(3)}${String(r.probeDiff).padEnd(11)}${String(r.bankTier).padEnd(10)}${r.priced.toExponential(2).padEnd(12)}${r.served.toExponential(3).padEnd(18)}${Number.isFinite(r.ratio) ? r.ratio.toPrecision(4) : "inf"}`
  );

const worst = rows[0];
const over = rows.filter((r) => r.served > 1e-3);
console.log(`\nWORST measured blind-pass on the SERVED stratum: ${worst.kpId} = ${worst.served.toExponential(3)} (priced ${worst.priced.toExponential(2)}; ${worst.ratio.toPrecision(4)}x)`);
console.log(`nodes whose MEASURED probe blind-pass exceeds TEST_OUT.maxBlindPass (1e-3): ${over.length} of ${rows.length}`);
for (const r of over) console.log("   ", r.kpId, r.served.toExponential(3), "|", r.detail);
console.log("\ncoin-flip check — nodes a 50/50 responder passes: " + rows.filter((r) => r.served >= 0.5 ** r.items).length);
console.log("\n--- per-form detail, worst 8 ---");
for (const r of rows.slice(0, 8)) console.log(`  ${r.kpId}: ${r.detail}`);
