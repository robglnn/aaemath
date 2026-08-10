import { readFileSync } from "node:fs";
import { Graph } from "../../../app/src/learn/Graph.js";
import { Mastery, TEST_OUT } from "../../../app/src/learn/Mastery.js";
const kg = JSON.parse(readFileSync(new URL("../../../content/knowledge-graph.json", import.meta.url), "utf8"));
const audit = JSON.parse(readFileSync(new URL("../../../app/src/learn/bank-audit.json", import.meta.url), "utf8"));
const g = new Graph(kg);
const m = new Mastery(g, { storage: null, bankAudit: audit, now: () => 0 });
const masteryForms = new Set(m.pricing.masteryForms);
console.log("TEST_OUT:", JSON.stringify(TEST_OUT));
let worstSurv = 0, worstSurvId = "", worstUnfil = 0, worstUnfilId = "";
const rows = [];
for (const id of g.ids) {
  const plan = m.testOutPlan(id);
  if (!plan.eligible) { rows.push([id, "REFUSED", plan.reason?.slice(0,60)]); continue; }
  // independent recomputation, surviving-family pricing (what the engine claims)
  let pSurv = 1, pUnfil = 1, bad = [];
  for (const f of plan.forms) {
    if (!masteryForms.has(f)) bad.push(f);
    pSurv *= m.probeItemBlindRate(id, f);
    const c = m.cell(id, f);
    const unf = Math.max(c?.blindUnfiltered ?? 0, c?.blindUpperUnfiltered ?? 0, m.probeItemBlindRate(id, f));
    pUnfil *= unf;
  }
  if (pSurv > worstSurv) { worstSurv = pSurv; worstSurvId = id; }
  if (pUnfil > worstUnfil) { worstUnfil = pUnfil; worstUnfilId = id; }
  rows.push([id, plan.items, plan.forms.join(","), pSurv.toExponential(2), plan.blindPass?.toExponential?.(2), pUnfil.toExponential(2), bad.length ? "NON-MASTERY FORM " + bad : ""]);
}
for (const r of rows) console.log(r.join("  |  "));
console.log("\nWORST surviving-family probe pass:", worstSurvId, worstSurv.toExponential(3), " bound", TEST_OUT.maxBlindPass);
console.log("WORST unfiltered (families served in audit proportion, if they were priced):", worstUnfilId, worstUnfil.toExponential(3));
