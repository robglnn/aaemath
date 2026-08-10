import { readFileSync } from "node:fs";
import { Graph } from "../../../app/src/learn/Graph.js";
import { Mastery } from "../../../app/src/learn/Mastery.js";
const kg = JSON.parse(readFileSync(new URL("../../../content/knowledge-graph.json", import.meta.url), "utf8"));
const audit = JSON.parse(readFileSync(new URL("../../../app/src/learn/bank-audit.json", import.meta.url), "utf8"));
const g = new Graph(kg);
for (const reporting of [false, true]) {
  const m = new Mastery(g, { storage: null, bankAudit: audit, now: () => 0, emit: () => {}, familyReporting: reporting });
  const inel = g.ids.filter((id) => !m.testOutPlan(id).eligible);
  console.log(`\n=== familyReporting=${reporting} : ${m.issues.length} issues, test-out ineligible ${inel.length} (${inel.join(",")})`);
  for (const i of m.issues) console.log("  -", i.slice(0, 150));
}
