/** scratch diagnostic — deleted before handoff */
import { readFileSync } from "node:fs";
import { Graph } from "../../app/src/learn/Graph.js";
import { Mastery } from "../../app/src/learn/Mastery.js";
import { Scheduler } from "../../app/src/learn/Scheduler.js";
import { Session } from "../../app/src/flow/Session.js";
import { Save } from "../../app/src/flow/Save.js";

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
class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
}

const t = { ms: Date.UTC(2026, 1, 2, 16, 30, 0) };
const graph = new Graph(graphSource);
const clock = { minutes: () => t.ms / 60000, advance() {}, real: true };
const mastery = new Mastery(graph, { now: () => t.ms / 60000, storage: null, emit: () => {}, bankAudit });
const scheduler = new Scheduler(mastery, { clock, seed: 7, sessionMinutes: 25 });
const learning = { mastery, scheduler, graph, next: () => scheduler.next(), submit: (r, o) => scheduler.submit(r, o), beginSession: () => scheduler.beginSession(), endSession: () => scheduler.endSession() };

console.log("graph ids:", graph.ids.length);
console.log("frontier at t0:", mastery.frontier());
console.log("eligible frontier:", mastery.frontier().filter((id) => mastery.status(id) === "learning" && mastery.masteryFormsFor(id).length > 0));
console.log("warnings:", (mastery.warnings ?? []).slice(0, 8));
console.log("level1 ids:", graph.ids.filter((id) => graph.levelOf?.(id) === 1).slice(0, 10));

const rng = mulberry32(7);
const save = new Save({ storage: new MemoryStorage(), now: () => t.ms });
save.load();

const ability = 1.4;
for (let n = 0; n < 10; n += 1) {
  t.ms += Math.round((20 + 8 * rng()) * 3600 * 1000);
  const session = new Session({ learning, save, now: () => t.ms, emit: () => {} });
  session.begin();
  for (let g = 0; g < 600; g += 1) {
    const req = session.next();
    if (!req) break;
    const latencyMs = Math.round(9000 * (0.6 + rng()));
    t.ms += latencyMs;
    const base = 1 / (1 + Math.exp(-(ability - req.difficulty)));
    const floor = mastery.trueGuess(req.kpId, req.form, req.phase);
    session.submit(req, { correct: rng() < base + (1 - base) * floor, latencyMs, itemId: `${req.kpId}#${req.seq}`, hinted: req.hinted });
    t.ms += 4000;
  }
  if (session.phase !== "closed") session.close("harness-guard");
  const kinds = {};
  const kps = new Set();
  for (const b of session.beats) { kinds[b.kind] = (kinds[b.kind] ?? 0) + 1; kps.add(b.kpId); }
  const sum = mastery.summary();
  console.log(
    `#${n + 1} min=${(session.elapsedSeconds / 60).toFixed(1)} items=${session.itemsServed} beats=${session.beats.length}`,
    "kinds=", JSON.stringify(kinds), "kps=", [...kps].join(","),
    "close=", session.closeReason,
    "L1%=", sum.level1Percent, "prov=", sum.provisional, "mast=", sum.mastered
  );
  const st = mastery.stateOf("var-meaning");
  console.log("   var-meaning:", JSON.stringify({ status: st.status, attempts: st.attempts, p: Math.round(st.p * 1000) / 1000, nextEventAt: st.nextEventAt, consolidated: st.consolidated }));
  console.log("   gate:", JSON.stringify(mastery.gateDetail ? mastery.gateDetail("var-meaning") : null));
}
