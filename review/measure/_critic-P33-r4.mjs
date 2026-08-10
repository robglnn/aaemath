/** CRITIC P33 part 4: overrun forensics on r1's bimodal, KP breadth per sitting, pace-after-kill. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Graph } from "../../app/src/learn/Graph.js";
import { Mastery } from "../../app/src/learn/Mastery.js";
import { Scheduler } from "../../app/src/learn/Scheduler.js";
import { Session } from "../../app/src/flow/Session.js";
import { Save } from "../../app/src/flow/Save.js";
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const rj = (p) => JSON.parse(readFileSync(resolve(root, p), "utf8"));
const graphSource = rj("content/knowledge-graph.json");
const bankAudit = rj("app/src/learn/bank-audit.json");
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
function rngFrom(seed) { let a = (seed * 2654435761) >>> 0; return () => { a ^= a << 13; a >>>= 0; a ^= a >> 17; a ^= a << 5; a >>>= 0; return a / 4294967296; }; }
class Mem { constructor(m) { this.m = m ?? new Map(); } getItem(k) { return this.m.has(k) ? this.m.get(k) : null; } setItem(k, v) { this.m.set(k, String(v)); } removeItem(k) { this.m.delete(k); } }
function lognorm(rng, sigma) { const u1 = Math.max(1e-9, rng()), u2 = rng(); const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2); return Math.exp(sigma * z - (sigma * sigma) / 2); }
function world(seed, startMs) {
  const t = { ms: startMs };
  const graph = new Graph(graphSource);
  const clock = { minutes: () => t.ms / 60000, advance() {}, real: true };
  const mastery = new Mastery(graph, { now: () => t.ms / 60000, storage: null, emit: () => {}, bankAudit });
  const scheduler = new Scheduler(mastery, { clock, seed, sessionMinutes: 25 });
  return { t, graph, mastery, scheduler, learning: { mastery, scheduler, graph, next: () => scheduler.next(), submit: (r, o) => scheduler.submit(r, o), beginSession: () => scheduler.beginSession(), endSession: () => scheduler.endSession() } };
}
const PW = { model: 0.45, "guided-1": 0.7, "guided-2": 0.9, "guided-3": 1.25, solo: 1.05 };

console.log("E. r1 BIMODAL OVERRUNS — exact reproduction with forensics");
const rows = [];
for (let s = 1; s <= 5; s += 1) {
  const seed = s * 7919 + "bimodal".length;
  const rng = rngFrom(seed);
  const w = world(seed ^ 0x1234, Date.UTC(2026, 2, 3, 15, 0, 0));
  const save = new Save({ storage: new Mem(), now: () => w.t.ms });
  save.load();
  let session = null;
  for (let n = 0; n < 10; n += 1) {
    w.t.ms += Math.round((19 + 10 * rng()) * 3600 * 1000);
    session = new Session({ learning: w.learning, save, now: () => w.t.ms, emit: () => {} });
    session.begin();
    const kps = new Set();
    for (let g = 0; g < 900; g += 1) {
      const req = session.next(); if (!req) break;
      kps.add(req.kpId);
      const work = PW[req.phase] ?? 1;
      const hard = clamp(1 + 0.3 * (req.difficulty + 0.5), 0.4, 2.6);
      const ms = Math.round(clamp((rng() < 0.22 ? 260 : 12) * work * hard * lognorm(rng, 0.35), 1.2, 900) * 1000);
      w.t.ms += ms;
      const p = 1 / (1 + Math.exp(-(0.3 - req.difficulty)));
      const floor = w.mastery.trueGuess(req.kpId, req.form, req.phase);
      session.submit(req, { correct: rng() < p + (1 - p) * floor, latencyMs: ms, itemId: `${req.kpId}#${req.seq}`, hinted: req.hinted });
      w.t.ms += Math.round(2000 + 4000 * rng());
    }
    if (session.phase !== "closed") session.close("critic-guard");
    const pr = session.probe();
    rows.push({ min: pr.elapsed.minutes, excess: pr.stats.worstResponseExcessSeconds, outside: pr.stats.startsOutsideCeiling, closedAtItem: pr.stats.beatsClosedAtItem, win: pr.closingWin, kps: kps.size, items: pr.elapsed.items, ceil: pr.pace.secondsPerItemCeiling });
  }
}
const over = rows.filter((r) => r.min > 25);
console.log(`   ${rows.length} sittings, ${over.length} over 25 min`);
for (const r of over)
  console.log(`     ${r.min} min (over by ${((r.min - 25) * 60).toFixed(0)}s)  worstResponseExcess=${r.excess.toFixed(0)}s  startsOutsideCeiling=${r.outside}  ceiling=${r.ceil}s  -> ${(r.min - 25) * 60 <= r.excess ? "ONE RESPONSE" : "*** LAYER UNDER-RESERVED ***"}`);
console.log("   distinct KPs per sitting:", [...new Set(rows.map((r) => r.kps))].sort().join(","), " median items:", rows.map(r => r.items).sort((a, b) => a - b)[Math.floor(rows.length / 2)]);

console.log("\nF. KP BREADTH — distinct knowledge points touched in one sitting, 4 ability levels");
for (const ability of [-1.5, 0, 1.0, 2.5]) {
  const w = world(3, Date.UTC(2026, 2, 3, 15, 0, 0));
  const save = new Save({ storage: new Mem(), now: () => w.t.ms });
  save.load();
  const rng = rngFrom(55);
  const s = new Session({ learning: w.learning, save, now: () => w.t.ms, emit: () => {} });
  s.begin();
  const kps = new Map();
  for (let g = 0; g < 900; g += 1) {
    const req = s.next(); if (!req) break;
    kps.set(req.kpId, (kps.get(req.kpId) ?? 0) + 1);
    const ms = 20000; w.t.ms += ms;
    const p = 1 / (1 + Math.exp(-(ability - req.difficulty)));
    s.submit(req, { correct: rng() < p, latencyMs: ms, itemId: `${req.kpId}#${req.seq}`, hinted: req.hinted });
    w.t.ms += 4000;
  }
  if (s.phase !== "closed") s.close("g");
  console.log(`   ability ${String(ability).padStart(5)}: ${s.itemsServed} items, ${s.beats.length} beats, ${kps.size} distinct KP(s) -> ${[...kps].map(([k, v]) => `${k}:${v}`).join(" ")}`);
}
