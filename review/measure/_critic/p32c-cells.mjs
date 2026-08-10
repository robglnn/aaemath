import { readFileSync } from "node:fs";
import { Graph } from "../../../app/src/learn/Graph.js";
import { Mastery, UNREPORTED_FAMILY } from "../../../app/src/learn/Mastery.js";

const kg = JSON.parse(readFileSync(new URL("../../../content/knowledge-graph.json", import.meta.url), "utf8"));
const audit = JSON.parse(readFileSync(new URL("../../../app/src/learn/bank-audit.json", import.meta.url), "utf8"));
const g = new Graph(kg);
const m = new Mastery(g, { storage: null, bankAudit: audit, now: () => 0 });

const forms = Object.keys(m.M.trueGuessByForm ?? m.M.guessByForm ?? {});
console.log("forms in model:", forms.join(","));
console.log("masteryForms:", [...m.pricing.masteryForms].join(","), "scoredForms:", [...m.pricing.scoredForms].join(","));

let cellsWithRefused = 0, totalCells = 0;
const perKp = {};
for (const id of g.ids) {
  perKp[id] = { refusedForms: [], masteryFormsCellLevel: [], masteryFormsShipped: [], scoredFormsShipped: [] };
  for (const f of forms) {
    const c = m.cell(id, f);
    if (!c) continue;
    totalCells++;
    const refused = c.refusedFamilies?.length ?? 0;
    if (refused > 0) { cellsWithRefused++; perKp[id].refusedForms.push(f + ":" + c.refusedFamilies.join("|")); }
    if (m.isMasteryEligible(id, f, "solo", null)) perKp[id].masteryFormsCellLevel.push(f);
    if (m.isMasteryEligible(id, f, "solo", UNREPORTED_FAMILY)) perKp[id].masteryFormsShipped.push(f);
    if (m.isScorable(id, f, "solo", UNREPORTED_FAMILY)) perKp[id].scoredFormsShipped.push(f);
  }
}
console.log(`cells: ${totalCells}, with refused families: ${cellsWithRefused}`);
let broken = [], narrowed = [];
for (const id of g.ids) {
  const p = perKp[id];
  if (p.masteryFormsShipped.length === 0) broken.push(id);
  else if (p.masteryFormsShipped.length < p.masteryFormsCellLevel.length) narrowed.push(`${id} ${p.masteryFormsCellLevel.join(",")} -> ${p.masteryFormsShipped.join(",")}`);
}
console.log("\nKPs with ZERO mastery-eligible form on the SHIPPED path (family never reported):");
console.log(broken.length ? broken.join("\n") : "  none");
console.log("\nKPs narrowed by the unreported-family rule:");
console.log(narrowed.length ? narrowed.join("\n") : "  none");
console.log("\nrequiredDistinctForms vs shipped forms:");
for (const id of g.ids) {
  const need = m.requiredDistinctForms(id);
  const have = perKp[id].masteryFormsShipped.length;
  if (have < need) console.log(`  ${id}: needs ${need} distinct forms, shipped path offers ${have} (${perKp[id].masteryFormsShipped.join(",")||"-"})`);
}
console.log("\nissues at construction:", m.issues.length);
for (const i of m.issues) console.log("  -", i.slice(0, 220));
