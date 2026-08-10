/** scratch diagnostic 2 — deleted before handoff */
import { readFileSync } from "node:fs";
import { Graph } from "../../app/src/learn/Graph.js";
import { Mastery } from "../../app/src/learn/Mastery.js";
import { Scheduler } from "../../app/src/learn/Scheduler.js";

const readJson = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const graphSource = readJson("../../content/knowledge-graph.json");
const bankAudit = readJson("../../app/src/learn/bank-audit.json");

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const t = { ms: Date.UTC(2026, 1, 2, 16, 30, 0) };
const graph = new Graph(graphSource);
const clock = { minutes: () => t.ms / 60000, advance() {}, real: true };
const mastery = new Mastery(graph, { now: () => t.ms / 60000, storage: null, emit: () => {}, bankAudit });
const scheduler = new Scheduler(mastery, { clock, seed: 7, sessionMinutes: 25 });

const rng = mulberry32(7);
const ability = 1.4;
const reasons = new Map();
const phases = new Map();
const forms = new Map();
scheduler.beginSession();
let n = 0;
for (let g = 0; g < 60; g += 1) {
  const req = scheduler.next();
  if (!req) { console.log("engine empty at", g); break; }
  const latencyMs = 12000;
  t.ms += latencyMs + 4000;
  const base = 1 / (1 + Math.exp(-(ability - req.difficulty)));
  const floor = mastery.trueGuess(req.kpId, req.form, req.phase);
  const correct = rng() < base + (1 - base) * floor;
  const res = scheduler.submit(req, { correct, latencyMs, itemId: `${req.kpId}#${req.seq}`, hinted: req.hinted });
  reasons.set(res?.reason ?? "(none)", (reasons.get(res?.reason ?? "(none)") ?? 0) + 1);
  phases.set(req.phase, (phases.get(req.phase) ?? 0) + 1);
  forms.set(req.form, (forms.get(req.form) ?? 0) + 1);
  n += 1;
  if (g < 24) console.log(g, req.kpId, req.mode, req.phase, req.form, "d=", Math.round(req.difficulty * 100) / 100, "hint=", req.hinted, "corr=", correct, "scored=", res?.scored, "elig=", res?.masteryEligible, "p=", Math.round((res?.p ?? mastery.stateOf(req.kpId).p) * 1000) / 1000);
}
console.log("reasons", [...reasons]);
console.log("phases", [...phases]);
console.log("forms", [...forms]);
const s = mastery.stateOf("var-meaning");
console.log("state", JSON.stringify({ p: s.p, scored: s.scored, atBand: s.atBand, forms: s.forms, attempts: s.attempts, refusedUpward: s.refusedUpward }));
console.log("gateDetail", JSON.stringify(mastery.gateDetail("var-meaning"), null, 1));
console.log("masteryFormsFor", mastery.masteryFormsFor("var-meaning"));
console.log("stats", mastery.stats);
