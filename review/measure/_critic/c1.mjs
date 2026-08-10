import { readFileSync } from "node:fs";
import { Graph } from "file:///C:/dev/math/aaemath/app/src/learn/Graph.js";
import { Mastery, PROPAGATION, TEST_OUT } from "file:///C:/dev/math/aaemath/app/src/learn/Mastery.js";
const G = new Graph(JSON.parse(readFileSync("C:/dev/math/aaemath/content/knowledge-graph.json","utf8")));
const AUDIT = JSON.parse(readFileSync("C:/dev/math/aaemath/app/src/learn/bank-audit.json","utf8"));
const m = new Mastery(G, { bankAudit: AUDIT, storage: null, emit: () => {} });
console.log("audit version", AUDIT.version, AUDIT.fingerprint, "sampled", AUDIT.sampled, JSON.stringify(AUDIT.mixture));
let total=0, refused=0, needsReport=0, priceable=0;
const forms=[...m.pricing.scoredForms];
for (const id of G.ids) for (const f of forms) {
  const c = m.cell(id,f); if(!c) continue; total++;
  if (c.priceable===false) refused++; else priceable++;
  if ((c.refusedFamilies?.length??0)>0) needsReport++;
}
console.log({total, priceable, refusedCells:refused, cellsRequiringFamilyReport:needsReport});
// how many PRICEABLE cells require family report
let pr=0; for (const id of G.ids) for (const f of forms){const c=m.cell(id,f); if(c&&c.priceable!==false&&(c.refusedFamilies?.length??0)>0)pr++;}
console.log("priceable cells requiring family report:", pr);
// probe forms: how many probe items land on cells requiring report
let probeItems=0, probeItemsNeedingReport=0, nodesAllNeed=0;
for (const id of G.ids){ const p=m.testOutPlan(id); if(!p.eligible) continue; let all=true;
  for(const f of p.forms){ probeItems++; if(m.requiresFamilyReport(id,f)) probeItemsNeedingReport++; else all=false; }
  if(all) nodesAllNeed++;
}
console.log({probeItems, probeItemsNeedingReport, nodesWhereEveryProbeItemNeedsFamily:nodesAllNeed});
// what happens to a plain correct response with no family
const out = m.respond({kpId:"var-meaning", form:"construct", phase:"solo", correct:true, latencyMs:9000, difficulty:0});
console.log("respond w/o family:", {scored:out.scored, credited:out.credited, reason:out.reason});
const out2 = m.respond({kpId:"var-meaning", form:"construct", phase:"solo", correct:true, latencyMs:9000, difficulty:0, family:Object.keys(m.cell("var-meaning","construct").families)[0]});
console.log("respond w/ family:", {scored:out2.scored, credited:out2.credited, reason:out2.reason, fam:Object.keys(m.cell("var-meaning","construct").families)});
console.log("issues count", m.issues.length);
console.log(m.issues.filter(s=>s.startsWith("CONTENT")).join("\n"));
