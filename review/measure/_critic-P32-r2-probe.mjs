/**
 * CRITIC round 2, P32 — the decisive attack on the test-out bound.
 *
 * P32.mjs D1 fires a bot whose per-item success probability IS `REF.probeItemBlindRate(kp, form)`,
 * the very function `_deriveTestOutPlan` multiplies to produce `plan.blindPass`. So its measured
 * pass rate can only ever come out at the declared bound. It never touches an item.
 *
 * This does the opposite: it replays the SHIPPED probe sequence — `plan.forms`, in order, drawn
 * through `Scheduler.serve()` at `mastery.testOutDifficulty(kpId)` with the same per-cell
 * no-repeat exclusion the real request carries — and answers each item with ONE memorised string
 * per (kp x form), marked by the SHIPPED checker `itemBank.check`. Nothing here reads the audit.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Graph } from "../../app/src/learn/Graph.js";
import { Mastery, TEST_OUT } from "../../app/src/learn/Mastery.js";
import { Scheduler, mulberry32, virtualClock } from "../../app/src/learn/Scheduler.js";
import { itemBank } from "../../app/src/learn/ItemBank.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const GRAPH = new Graph(JSON.parse(readFileSync(resolve(ROOT, "content/knowledge-graph.json"), "utf8")));
const AUDIT = JSON.parse(readFileSync(resolve(ROOT, "app/src/learn/bank-audit.json"), "utf8"));
const clock = virtualClock(0);
const m = new Mastery(GRAPH, { bankAudit: AUDIT, storage: null, now: () => clock.minutes() });
const sch = new Scheduler(m, { clock, rng: mulberry32(7), sessionMinutes: 25, bank: itemBank });

const TRIALS = Number((process.argv.find((a) => a.startsWith("--trials=")) ?? "--trials=3000").split("=")[1]);
const STUDY = Number((process.argv.find((a) => a.startsWith("--study=")) ?? "--study=90").split("=")[1]);

const mark = (item, r) => { try { return itemBank.check(item, r).correct === true; } catch { return false; } };
const spell = (item) => { try { return itemBank.accepts(item)[0]; } catch { return null; } };

let seq = 900000;
const drawOne = (kpId, form, difficulty, exclude) =>
  sch.serve({ kpId, form, difficulty, seq: seq++, avoidFamilies: m.refusedFamilies(kpId, form), avoidItemIds: [...exclude] }, itemBank, { dry: true });

/** The adversary's homework: one string per (kp x form), chosen on the stratum the probe serves. */
function memorise(kpId, form, difficulty) {
  const items = [];
  const ex = new Set();
  for (let i = 0; i < STUDY; i++) {
    const sel = drawOne(kpId, form, difficulty, ex);
    if (!sel) break;
    items.push(sel.item);
  }
  if (!items.length) return { answer: "0", rate: 0 };
  const cand = new Set(["0", "1", "x", "always", "none", "-1", "2"]);
  for (const it of items) { const s = spell(it); if (s != null) cand.add(String(s)); }
  let best = 0, answer = "0";
  for (const c of cand) {
    let h = 0;
    for (const it of items) if (mark(it, c)) h += 1;
    if (h > best) { best = h; answer = c; }
  }
  return { answer, rate: best / items.length, n: items.length };
}

console.log(`P(pure guesser passes the probe), measured by replaying the real probe against real items`);
console.log(`trials=${TRIALS} per node, study=${STUDY} draws per cell, bound TEST_OUT.maxBlindPass=${TEST_OUT.maxBlindPass}\n`);

const rows = [];
for (const kpId of GRAPH.ids) {
  const plan = m.testOutPlan(kpId);
  if (!plan.eligible) { rows.push({ kpId, eligible: false, reason: plan.reason }); continue; }
  const diff = m.testOutDifficulty(kpId);
  const memo = new Map();
  for (const form of new Set(plan.forms)) memo.set(form, memorise(kpId, form, diff));

  let passes = 0;
  for (let t = 0; t < TRIALS; t++) {
    const ex = new Set();
    let ok = true;
    for (const form of plan.forms) {
      const sel = drawOne(kpId, form, diff, ex);
      if (!sel) { ok = false; break; }
      ex.add(sel.item.id);
      if (!mark(sel.item, memo.get(form).answer)) { ok = false; break; }
    }
    if (ok) passes += 1;
  }
  const p = passes / TRIALS;
  rows.push({
    kpId, eligible: true, band: GRAPH.difficulty(kpId), items: plan.items,
    priced: plan.blindPass, measured: p, passes,
    ratio: plan.blindPass > 0 ? p / plan.blindPass : Infinity,
    strings: [...memo.entries()].map(([f, r]) => `${f}=${JSON.stringify(r.answer)}@${r.rate.toFixed(3)}`).join(" "),
  });
}

const el = rows.filter((r) => r.eligible).sort((a, b) => b.measured - a.measured);
console.log("kp".padEnd(23) + "bd it  priced      MEASURED    passes/N   x over its own price");
for (const r of el)
  console.log(`${r.kpId.padEnd(23)}${String(r.band).padEnd(3)}${String(r.items).padEnd(3)}${r.priced.toExponential(2).padEnd(12)}${r.measured.toExponential(3).padEnd(12)}${(r.passes + "/" + TRIALS).padEnd(11)}${Number.isFinite(r.ratio) ? r.ratio.toPrecision(4) : "inf"}`);

const over = el.filter((r) => r.measured > TEST_OUT.maxBlindPass);
console.log(`\nWORST CASE: ${el[0].kpId} — a pure guesser passes its ${el[0].items}-item probe ${(el[0].measured * 100).toFixed(2)}% of the time (priced ${el[0].priced.toExponential(2)}).`);
console.log(`nodes whose MEASURED blind-pass exceeds the 1e-3 bound: ${over.length} of ${el.length}`);
console.log(`nodes a coin flip would pass (measured >= 0.5^items): ${el.filter((r) => r.measured >= 0.5 ** r.items).length}`);
// One-sided binomial: is the pooled measured rate above the bound?
const N = el.length * TRIALS;
const K = el.reduce((a, r) => a + r.passes, 0);
console.log(`pooled: ${K} passes in ${N} offered probes = ${(K / N).toExponential(3)} against a bound of ${TEST_OUT.maxBlindPass} (expected ${(N * TEST_OUT.maxBlindPass).toFixed(1)} at the bound)`);
console.log(`\nmemorised strings, worst 8 nodes:`);
for (const r of el.slice(0, 8)) console.log(`  ${r.kpId}: ${r.strings}`);
console.log(`\nineligible: ${rows.filter((r) => !r.eligible).map((r) => r.kpId).join(", ") || "(none)"}`);
