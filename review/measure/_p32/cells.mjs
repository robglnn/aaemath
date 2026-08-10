import { readFileSync } from "node:fs";
import { Graph } from "../../../app/src/learn/Graph.js";
import { Mastery } from "../../../app/src/learn/Mastery.js";
const kg = JSON.parse(readFileSync(new URL("../../../content/knowledge-graph.json", import.meta.url),"utf8"));
const audit = JSON.parse(readFileSync(new URL("../../../app/src/learn/bank-audit.json", import.meta.url),"utf8"));
const g = new Graph(kg);
const m = new Mastery(g, { storage: null, bankAudit: audit, now: () => 0 });
for (const id of ["var-meaning","expr-anatomy","eval-signed","props-operations","eq-special-cases"]) {
  for (const f of ["construct","repair","generate"]) {
    const c = m.cell(id, f);
    if (!c) { console.log(`${id}|${f}  NO CELL`); continue; }
    const fams = Object.entries(c.families ?? {}).map(([n,r]) => `${n}=${r.priceable?"ok":"REF"}@${(r.blind??-1).toFixed(3)}/n${r.n??"?"}`);
    console.log(`${id}|${f}  priceable=${c.priceable} blind=${(c.blind??-1).toFixed(3)} unfilt=${(c.blindUnfiltered??-1).toFixed(3)} refused=[${(c.refusedFamilies??[]).join(",")}]\n     ${fams.join("  ")}`);
  }
}
