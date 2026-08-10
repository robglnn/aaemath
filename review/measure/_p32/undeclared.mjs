import { readFileSync } from "node:fs";
import { Graph } from "../../../app/src/learn/Graph.js";
import { Mastery } from "../../../app/src/learn/Mastery.js";
import { Scheduler, realClock } from "../../../app/src/learn/Scheduler.js";
const kg = JSON.parse(readFileSync(new URL("../../../content/knowledge-graph.json", import.meta.url), "utf8"));
const audit = JSON.parse(readFileSync(new URL("../../../app/src/learn/bank-audit.json", import.meta.url), "utf8"));
const g = new Graph(kg);
// exactly what boot/62-learning.js does, in order
const m = new Mastery(g, { storage: null, bankAudit: audit, now: () => 0, emit: () => {} });
const s = new Scheduler(m, { clock: realClock(), seed: 0x5eed, sessionMinutes: 25 });
console.log(`issues warned by 62-learning (undeclared): ${m.issues.length}`);
for (const i of m.issues) console.log("  -", i.slice(0, 130));
