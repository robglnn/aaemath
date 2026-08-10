import { readFileSync } from "node:fs";
import { Graph } from "../../../app/src/learn/Graph.js";
import { Mastery } from "../../../app/src/learn/Mastery.js";
import { Scheduler, virtualClock, mulberry32 } from "../../../app/src/learn/Scheduler.js";
const kg = JSON.parse(readFileSync(new URL("../../../content/knowledge-graph.json", import.meta.url), "utf8"));
const audit = JSON.parse(readFileSync(new URL("../../../app/src/learn/bank-audit.json", import.meta.url), "utf8"));
const g = new Graph(kg);
const clock = virtualClock(0);
const m = new Mastery(g, { storage: null, bankAudit: audit, now: () => clock.minutes() });
const s = new Scheduler(m, { clock, rng: mulberry32(11), sessionMinutes: 25 });
const formCount = {};
for (let session = 0; session < 8; session++) {
  clock.set(session * 1440);
  s.beginSession();
  for (;;) {
    const req = s.next();
    if (!req) break;
    if (req.kpId === "var-meaning") formCount[`${req.form}/${req.phase}/${req.mode}`] = (formCount[`${req.form}/${req.phase}/${req.mode}`] ?? 0) + 1;
    s.submit(req, { correct: true, latencyMs: 9000, itemId: `${req.kpId}#${req.seq}`, hinted: false });
  }
  s.endSession();
}
console.log("var-meaning served by form/phase/mode:", JSON.stringify(formCount, null, 1));
console.log("gateDetail:", JSON.stringify(m.gateDetail("var-meaning")));
console.log("state:", JSON.stringify(m.stateOf("var-meaning")));
console.log("requiredDistinctForms:", m.requiredDistinctForms("var-meaning"), "masteryFormsFor:", m.masteryFormsFor("var-meaning"));
console.log("frontier:", m.frontier());
