// Can an OMNISCIENT learner (always correct, honest latency, no hints) certify every KP
// through the SHIPPED path (Scheduler.next/submit, no family reported)?
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

let items = 0;
const servedByKp = {};
for (let session = 0; session < 60; session++) {
  clock.set(session * 1440);
  s.beginSession();
  for (;;) {
    const req = s.next();
    if (!req) break;
    servedByKp[req.kpId] = (servedByKp[req.kpId] ?? 0) + 1;
    s.submit(req, { correct: true, latencyMs: 9000, itemId: `${req.kpId}#${req.seq}`, hinted: false });
    items++;
    if (items > 40000) break;
  }
  s.endSession();
  if (items > 40000) break;
}
console.log("items answered:", items, "sessions:", m.session);
console.log("unreportedFamilyItems:", m.stats.unreportedFamilyItems, "unscored:", m.stats.unscored ?? "-");
const mastered = g.ids.filter((id) => m.status(id) === "mastered");
console.log("MASTERED", mastered.length, "of", g.ids.length);
const notm = g.ids.filter((id) => m.status(id) !== "mastered");
for (const id of notm) {
  const s2 = m.stateOf(id);
  console.log(`  NOT MASTERED ${id} status=${s2.status} p=${s2.p?.toFixed(3)} scored=${s2.scored ?? "-"} atBand=${s2.atBand ?? "-"} forms=${[...(s2.forms ?? [])].join("/")} served=${servedByKp[id] ?? 0}`);
}
console.log("summary:", JSON.stringify(m.summary()));
