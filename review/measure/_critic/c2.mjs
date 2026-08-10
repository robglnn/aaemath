import { readFileSync } from "node:fs";
import { Graph } from "../../../app/src/learn/Graph.js";
import { Mastery } from "../../../app/src/learn/Mastery.js";
import { Scheduler, virtualClock, mulberry32 } from "../../../app/src/learn/Scheduler.js";
const R = "C:/dev/math/aaemath/";
const G = new Graph(JSON.parse(readFileSync(R+"content/knowledge-graph.json","utf8")));
const AUDIT = JSON.parse(readFileSync(R+"app/src/learn/bank-audit.json","utf8"));
const clock = virtualClock(0);
const m = new Mastery(G, { bankAudit: AUDIT, storage: null, emit: () => {}, now: () => clock.minutes() });
const s = new Scheduler(m, { clock, seed: 1, sessionMinutes: 25 });
s.beginSession();
for (let i=0;i<3;i++){ const req = s.next(); console.log(JSON.stringify(req)); s.submit(req,{correct:true, latencyMs:5000}); }
