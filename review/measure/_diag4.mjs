/** scratch diagnostic 4 — calibrate the starvation threshold. deleted before handoff */
import { readFileSync } from "node:fs";
import { Graph } from "../../app/src/learn/Graph.js";
import { Mastery } from "../../app/src/learn/Mastery.js";
import { Scheduler } from "../../app/src/learn/Scheduler.js";
import { Session } from "../../app/src/flow/Session.js";
import { Save } from "../../app/src/flow/Save.js";
import { itemBank } from "../../app/src/learn/ItemBank.js";

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
const graph0 = new Graph(graphSource);
await itemBank.ensure(graph0.ids);

const maxRunBlocks = [];
const maxRunItems = [];
const distinct = [];
const kindTotals = new Map();
for (const ability of [-1.5, -0.4, 0, 0.5, 1.0, 1.4, 2.5]) {
  for (let seed = 1; seed <= 6; seed += 1) {
    const t = { ms: Date.UTC(2026, 1, 2, 16, 30, 0) };
    const graph = new Graph(graphSource);
    const clock = { minutes: () => t.ms / 60000, advance() {}, real: true };
    const mastery = new Mastery(graph, { now: () => t.ms / 60000, storage: null, emit: () => {}, bankAudit });
    const scheduler = new Scheduler(mastery, { clock, seed: seed ^ 0x5eed, sessionMinutes: 25 });
    const learning = { mastery, scheduler, graph, next: () => scheduler.next(), submit: (r, o) => scheduler.submit(r, o), beginSession: () => scheduler.beginSession(), endSession: () => scheduler.endSession() };
    const rng = mulberry32(seed);
    const save = new Save({ storage: new MemoryStorage(), now: () => t.ms });
    save.load();
    for (let n = 0; n < 10; n += 1) {
      t.ms += Math.round((20 + 8 * rng()) * 3600 * 1000);
      const session = new Session({ learning, save, now: () => t.ms, emit: () => {} });
      session.begin();
      for (let g = 0; g < 600; g += 1) {
        const req = session.next();
        if (!req) break;
        const drawn = scheduler.serve(req, itemBank);
        const latencyMs = Math.round(20000 * (0.5 + rng()));
        t.ms += latencyMs;
        const base = 1 / (1 + Math.exp(-(ability - req.difficulty)));
        const floor = mastery.trueGuess(req.kpId, req.form, req.phase);
        session.submit(req, { correct: rng() < base + (1 - base) * floor, latencyMs, itemId: drawn?.item?.id ?? `${req.kpId}#${req.seq}`, family: drawn?.family ?? undefined, hinted: req.hinted });
        t.ms += 4000;
      }
      if (session.phase !== "closed") session.close("harness-guard");
      // longest run of consecutive beats on the same kp
      let run = 1, best = 1, runItems = 0, bestItems = 0;
      const kps = new Set();
      for (let i = 0; i < session.beats.length; i += 1) {
        const b = session.beats[i];
        kps.add(b.kpId);
        kindTotals.set(b.kind, (kindTotals.get(b.kind) ?? 0) + 1);
        if (i > 0 && session.beats[i - 1].kpId === b.kpId) { run += 1; runItems += b.served; }
        else { run = 1; runItems = b.served; }
        if (run > best) best = run;
        if (runItems > bestItems) bestItems = runItems;
      }
      maxRunBlocks.push(best);
      maxRunItems.push(bestItems);
      distinct.push(kps.size);
    }
  }
}
const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]; };
console.log("sittings", maxRunBlocks.length);
console.log("max consecutive beats on one kp: p50", q(maxRunBlocks, 0.5), "p90", q(maxRunBlocks, 0.9), "p99", q(maxRunBlocks, 0.99), "max", Math.max(...maxRunBlocks));
console.log("max consecutive ITEMS on one kp: p50", q(maxRunItems, 0.5), "p90", q(maxRunItems, 0.9), "p99", q(maxRunItems, 0.99), "max", Math.max(...maxRunItems));
console.log("distinct kps/sitting: min", Math.min(...distinct), "p10", q(distinct, 0.1), "p50", q(distinct, 0.5), "max", Math.max(...distinct));
console.log("beat kinds", [...kindTotals]);
