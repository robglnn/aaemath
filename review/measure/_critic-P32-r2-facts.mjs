/**
 * CRITIC round 2, P32 — independent fact gathering. Nothing here reuses the builder's harness.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Graph } from "../../app/src/learn/Graph.js";
import { Mastery, TEST_OUT, PROPAGATION, UNREPORTED_FAMILY } from "../../app/src/learn/Mastery.js";
import { Scheduler, mulberry32, virtualClock } from "../../app/src/learn/Scheduler.js";
import { itemBank } from "../../app/src/learn/ItemBank.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const GRAPH = new Graph(JSON.parse(readFileSync(resolve(ROOT, "content/knowledge-graph.json"), "utf8")));
const AUDIT = JSON.parse(readFileSync(resolve(ROOT, "app/src/learn/bank-audit.json"), "utf8"));

const clock = virtualClock(0);
const m = new Mastery(GRAPH, { bankAudit: AUDIT, storage: null, now: () => clock.minutes() });
const sch = new Scheduler(m, { clock, rng: mulberry32(7), sessionMinutes: 25, bank: itemBank });

console.log("=== 0. shapes ===");
console.log("kps:", GRAPH.ids.length, "audit families:", Object.keys(AUDIT.families ?? {}).length,
  "audit cells:", Object.keys(AUDIT.cells ?? {}).length, "sampled:", AUDIT.sampled, "mixture:", JSON.stringify(AUDIT.mixture));
console.log("familyReporting:", m.familyReporting, m.familyReportingSource);

console.log("\n=== 1. does every drawn item carry a .family? (real bank, real serve) ===");
let noFam = 0, drawn = 0, refusedServed = 0, empty = 0;
const perForm = {};
for (const kpId of GRAPH.ids) {
  for (const form of ["construct", "repair", "generate", "select4", "judge2"]) {
    const avoid = m.refusedFamilies(kpId, form);
    for (let s = 0; s < 6; s++) {
      const req = { kpId, form, difficulty: 3, seq: 100000 + s * 37 + kpId.length, avoidFamilies: avoid };
      const sel = sch.serve(req, itemBank, { dry: true });
      if (!sel) { empty++; continue; }
      drawn++;
      perForm[form] ??= { n: 0, noFam: 0 };
      perForm[form].n++;
      if (sel.family == null) { noFam++; perForm[form].noFam++; }
      else if (avoid.includes(sel.family)) refusedServed++;
    }
  }
}
console.log("drawn:", drawn, "empty:", empty, "family==null:", noFam, "refused family SERVED:", refusedServed);
console.log("per form:", JSON.stringify(perForm));

console.log("\n=== 2. test-out plans, recomputed independently from bank-audit.json ===");
// my own derivation, from the raw audit file, not from Mastery's pricing
const caps = GRAPH.model.bkt.identifiabilityCaps;
const trueByForm = GRAPH.model.trueGuessByForm ?? {};
const famIdx = {};
for (const [k, rec] of Object.entries(AUDIT.families ?? {})) {
  const cut = k.lastIndexOf("|");
  (famIdx[k.slice(0, cut)] ??= []).push({ family: k.slice(cut + 1), ...rec });
}
const masteryForms = GRAPH.model.forms.eligibleForMastery ?? GRAPH.model.forms.formsEligibleForMastery ?? [];
console.log("masteryForms from content:", JSON.stringify(masteryForms), "scoredForms:", JSON.stringify([...m.pricing.masteryForms]));

const rows = [];
for (const kpId of GRAPH.ids) {
  const plan = m.testOutPlan(kpId);
  // independent worst-case: what a guesser gets if handed the SOFTEST SURVIVING family each item
  let survWorst = 1, unfWorst = 1, mix = 1;
  if (plan.eligible) {
    for (const f of plan.forms) {
      const c = m.cell(kpId, f);
      const fams = famIdx[`${kpId}|${f}`] ?? [];
      const surviving = fams.filter((x) => c?.families?.[x.family]?.priceable !== false);
      const w = surviving.length ? Math.max(...surviving.map((x) => Math.max(x.rate, x.upper))) : 1;
      survWorst *= Math.max(trueByForm[f] ?? 0, w);
      unfWorst *= Math.max(trueByForm[f] ?? 0, Math.max(...fams.map((x) => Math.max(x.rate, x.upper))));
      const nAll = fams.reduce((a, x) => a + x.n, 0);
      mix *= Math.max(trueByForm[f] ?? 0, nAll ? fams.reduce((a, x) => a + (x.n / nAll) * x.rate, 0) : 1);
    }
  }
  rows.push({ kpId, band: GRAPH.band(kpId).band ?? GRAPH.bandOf?.(kpId), eligible: plan.eligible, items: plan.items,
    forms: (plan.forms ?? []).join(","), engineBlind: plan.blindPass, myWorstSurviving: survWorst,
    myWorstUnfiltered: unfWorst, myMixture: mix, reason: plan.reason });
}
const elig = rows.filter((r) => r.eligible);
console.log("eligible:", elig.length, "of", rows.length);
console.log("WORST engine blindPass:", Math.max(...elig.map((r) => r.engineBlind)).toExponential(3));
console.log("WORST my surviving-worst blindPass:", Math.max(...elig.map((r) => r.myWorstSurviving)).toExponential(3));
console.log("WORST my unfiltered blindPass:", Math.max(...elig.map((r) => r.myWorstUnfiltered)).toExponential(3));
console.log("WORST my mixture blindPass:", Math.max(...elig.map((r) => r.myMixture)).toExponential(3));
const disagree = elig.filter((r) => Math.abs(r.myWorstSurviving - r.engineBlind) > 1e-9);
console.log("nodes where my recomputation disagrees with engine:", disagree.length);
for (const d of disagree.slice(0, 8)) console.log("  ", d.kpId, "engine", d.engineBlind, "mine", d.myWorstSurviving);

console.log("\n--- eligible probes, sorted worst-first ---");
for (const r of [...elig].sort((a, b) => b.myWorstUnfiltered - a.myWorstUnfiltered).slice(0, 12))
  console.log(`  ${r.kpId.padEnd(20)} items=${r.items} forms=${r.forms.padEnd(34)} surv=${r.myWorstSurviving.toExponential(2)} unfilt=${r.myWorstUnfiltered.toExponential(2)} mix=${r.myMixture.toExponential(2)}`);

console.log("\n--- INELIGIBLE ---");
for (const r of rows.filter((x) => !x.eligible)) console.log(`  ${r.kpId}: ${r.reason}`);

console.log("\n=== 3. forms actually used in probes: are they all low-guess measured forms? ===");
const usedCells = new Set();
for (const r of elig) for (const f of r.forms.split(",")) usedCells.add(`${r.kpId}|${f}`);
let bad = 0;
for (const key of usedCells) {
  const [kpId, form] = key.split("|");
  const c = m.cell(kpId, form);
  if (!c) { console.log("  NO AUDIT CELL:", key); bad++; continue; }
  if (!c.priceable) { console.log("  NOT PRICEABLE:", key); bad++; }
  if (!m.pricing.masteryForms.has(form)) { console.log("  NOT MASTERY FORM:", key); bad++; }
  if (c.blind > caps.maxTrueGuess) { console.log("  OVER maxTrueGuess:", key, c.blind); bad++; }
}
console.log("cells used by probes:", usedCells.size, "problems:", bad);
console.log("distinct forms used by probes:", JSON.stringify([...new Set([...usedCells].map((k) => k.split("|")[1]))]));

console.log("\n=== 4. propagation: ancestors-only structural check ===");
let violations = 0;
for (const id of GRAPH.ids) {
  const anc = GRAPH.ancestorDistances(id);
  for (const [aid, d] of anc) {
    const back = GRAPH.ancestorDistances(aid);
    if (back.has(id)) { console.log("  CYCLE:", id, aid); violations++; }
  }
}
console.log("ancestor-relation cycles:", violations);
console.log("PROPAGATION:", JSON.stringify(PROPAGATION));
console.log("TEST_OUT:", JSON.stringify(TEST_OUT));
console.log("masteryThreshold:", GRAPH.model.bkt.masteryThreshold, "ceiling:", PROPAGATION.ceiling);
