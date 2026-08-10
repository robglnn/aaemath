/** CRITIC P32, part 2: re-price every probe under an honest per-source upper bound. */
import { readFileSync } from "node:fs";
import { Graph } from "../../app/src/learn/Graph.js";
import { Mastery, TEST_OUT, wilsonUpper } from "../../app/src/learn/Mastery.js";

const KG = JSON.parse(readFileSync("content/knowledge-graph.json", "utf8"));
const AUDIT = JSON.parse(readFileSync("app/src/learn/bank-audit.json", "utf8"));
const G = new Graph(KG);
const M = G.model;
const REF = new Mastery(G, { bankAudit: AUDIT, storage: null, emit: () => {} });
const say = (...a) => console.log(...a);

// index families
const famIdx = {};
for (const [k, r] of Object.entries(AUDIT.families)) {
  const c = k.lastIndexOf("|");
  (famIdx[k.slice(0, c)] ??= []).push({ family: k.slice(c + 1), ...r });
}

// How many surviving families in a shipped probe are priced with upper === rate (no CI at all)?
let flat = 0, total = 0, minN = 1e9;
const flatDetail = [];
for (const id of G.ids) {
  const plan = REF.testOutPlan(id);
  if (!plan.eligible) continue;
  for (const form of new Set(plan.forms)) {
    const cell = REF.cell(id, form);
    for (const [fam, rec] of Object.entries(cell.families)) {
      if (!rec.priceable) continue;
      total++;
      const raw = famIdx[`${id}|${form}`].find((f) => f.family === fam);
      if (Math.abs(rec.blind - rec.blindUpper) < 1e-9) {
        flat++;
        minN = Math.min(minN, rec.n);
        flatDetail.push({ cell: `${id}|${form}|${fam}`, n: rec.n, rate: rec.blind, src: raw?.source });
      }
    }
  }
}
say(`### surviving families used by shipped probes: ${total}`);
say(`  priced with upper === rate (NO confidence inflation): ${flat} (${((100 * flat) / total).toFixed(0)}%), smallest n = ${minN}`);
say(`  Mastery.js:1089 says probe rates are "taken at its Wilson upper bound"; Mastery.js:787 says`);
say(`    const upper = source === "generated" ? wilsonUpper(hits, marked) : rate;`);

// The real defect: the family record keeps the source with the higher POINT estimate and then
// uses THAT source's upper, discarding a strictly larger upper from the other source.
let discarded = 0;
const honestRate = {};
for (const [key, rec] of Object.entries(AUDIT.families)) {
  const bestUpper = Math.max(...Object.values(rec.sources ?? {}).map((s) => s.upper ?? 0), rec.upper);
  honestRate[key] = Math.max(rec.rate, bestUpper);
  if (bestUpper > rec.upper + 1e-9) discarded++;
}
say(`\n### families where a SOURCE's upper bound exceeds the one the engine priced: ${discarded} of ${Object.keys(AUDIT.families).length}`);

// Re-derive every probe with honestRate, keeping the SAME survival decision (so this is purely
// a re-pricing of the length derivation, not a re-audit).
let over = 0, worst = 0, worstId = null;
const rows = [];
for (const id of G.ids) {
  const plan = REF.testOutPlan(id);
  if (!plan.eligible) continue;
  const rated = REF.masteryFormsFor(id).map((form) => {
    const cell = REF.cell(id, form);
    const kept = Object.entries(cell.families).filter(([, r]) => r.priceable).map(([fam]) => honestRate[`${id}|${form}|${fam}`] ?? 1);
    return { form, shipped: REF.probeItemBlindRate(id, form), honest: Math.max(...kept, M.trueGuessByForm[form] ?? 0) };
  }).sort((a, b) => a.honest - b.honest);
  // shipped-length probe, honest rates
  let bp = 1;
  for (let i = 0; i < plan.items; i++) bp *= rated[i % rated.length].honest;
  if (bp > TEST_OUT.maxBlindPass) over++;
  if (bp > worst) { worst = bp; worstId = id; }
  // how long would it have to be?
  let n = 0, q = 1;
  while (n < 40 && !(n >= TEST_OUT.minItems && q <= TEST_OUT.maxBlindPass)) { q *= rated[n % rated.length].honest; n++; }
  rows.push({ id, items: plan.items, shipped: plan.blindPass, honest: bp, ratio: bp / plan.blindPass, needItems: q <= TEST_OUT.maxBlindPass ? n : `>40 (would be INELIGIBLE, cap ${TEST_OUT.maxItems})` });
}
rows.sort((a, b) => b.honest - a.honest);
say(`\n### shipped probe lengths re-priced at the honest per-source upper bound`);
say(`  probes now ABOVE the ${TEST_OUT.maxBlindPass} bound: ${over} of ${rows.length}`);
say(`  worst: ${worstId} at ${worst.toExponential(2)} (${(worst / TEST_OUT.maxBlindPass).toFixed(1)}x the bound)`);
say(`  top 10:`);
for (const r of rows.slice(0, 10))
  say(`    ${r.id.padEnd(24)} ${r.items} items  priced ${r.shipped.toExponential(2)}  honest ${r.honest.toExponential(2)}  (${r.ratio.toFixed(1)}x)  would need ${r.needItems} items`);
const stillEligible = rows.filter((r) => typeof r.needItems === "number" && r.needItems <= TEST_OUT.maxItems).length;
say(`  nodes that would STILL be test-out eligible at maxItems=${TEST_OUT.maxItems}: ${stillEligible} of ${rows.length}`);

// A guesser's actual per-probe pass under the honest rates, worst node, and the coin-flip test.
say(`\n### coin-flip test (task item 3)`);
say(`  worst eligible probe, shipped pricing:  ${Math.max(...G.ids.map((id) => REF.testOutPlan(id).eligible ? REF.testOutPlan(id).blindPass : 0)).toExponential(3)}`);
say(`  worst eligible probe, honest pricing:   ${worst.toExponential(3)}`);
say(`  worst eligible probe if the presenter cannot honour avoidFamilies: 1.000 (expr-anatomy: 2 of 3 construct families measure blind rate 1.000)`);
say(`  ItemBank.js occurrences of the word "family": ${(readFileSync("app/src/learn/ItemBank.js", "utf8").match(/family/g) ?? []).length}`);
