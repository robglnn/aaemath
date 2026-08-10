import { readFileSync } from "node:fs";
import { Graph } from "../../../app/src/learn/Graph.js";
import { Mastery } from "../../../app/src/learn/Mastery.js";
import { Scheduler, virtualClock, mulberry32 } from "../../../app/src/learn/Scheduler.js";
import { itemBank } from "../../../app/src/learn/ItemBank.js";

const kg = JSON.parse(readFileSync(new URL("../../../content/knowledge-graph.json", import.meta.url), "utf8"));
const audit = JSON.parse(readFileSync(new URL("../../../app/src/learn/bank-audit.json", import.meta.url), "utf8"));
const g = new Graph(kg);
const clock = virtualClock(0);
const m = new Mastery(g, { storage: null, bankAudit: audit, now: () => clock.minutes(), emit: () => {}, strictFamilyReport: true });
const s = new Scheduler(m, { clock, rng: mulberry32(11), sessionMinutes: 25, bank: itemBank });
const formCount = {};
let items = 0;
let noItem = 0;
for (let session = 0; session < 8; session++) {
  clock.set(session * 1440);
  s.beginSession();
  for (;;) {
    const req = s.next();
    if (!req) break;
    items += 1;
    if (!req.item) noItem += 1;
    if (req.kpId === "var-meaning") formCount[`${req.form}/${req.phase}/${req.mode}`] = (formCount[`${req.form}/${req.phase}/${req.mode}`] ?? 0) + 1;
    s.submit(req, { correct: true, latencyMs: 9000, hinted: false });
  }
  s.endSession();
}
console.log("familyReporting:", m.familyReporting, m.familyReportingSource);
console.log("items", items, "without req.item:", noItem, "serveMisses:", s.serveMisses);
console.log("var-meaning served:", JSON.stringify(formCount));
console.log("gateDetail:", JSON.stringify(m.gateDetail("var-meaning")), "unscored:", m.stateOf("var-meaning").unscored);
console.log("stats.unreportedFamilyItems:", m.stats.unreportedFamilyItems, "unscoredItems:", m.stats.unscoredItems, "scoredItems:", m.stats.scoredItems);
console.log("uncertifiable:", g.ids.filter((id) => m.deliverableMasteryForms(id).length === 0));
console.log("testOut eligible:", g.ids.filter((id) => m.testOutPlan(id).eligible).length, "of", g.ids.length);
console.log("summary:", JSON.stringify(m.summary()));
console.log("unservable cells:", s.probe().unservableCells);
