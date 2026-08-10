/**
 * CRITIC re-measurement of P33. Independent learner model, independent archetypes,
 * independent bookkeeping. Nothing here is imported from review/measure/P33.mjs.
 */
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
const readJson = (p) => JSON.parse(readFileSync(resolve(root, p), "utf8"));
const graphSource = readJson("content/knowledge-graph.json");
const bankAudit = readJson("app/src/learn/bank-audit.json");

function rngFrom(seed) {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a ^= a << 13; a >>>= 0;
    a ^= a >> 17;
    a ^= a << 5; a >>>= 0;
    return a / 4294967296;
  };
}
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

class Mem {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}

// --------------------------------------------------------------- my archetypes
// Deliberately NOT the builder's six. Three of these are inside his tested envelope,
// four are outside it and are the ones a real Algebra I class contains.
const ARCH = [
  { id: "flash",    kind: "gauss", med: 7,   sig: 0.3,  ability: 1.6 },
  { id: "typical",  kind: "gauss", med: 30,  sig: 0.5,  ability: 0.4 },
  { id: "grinder",  kind: "gauss", med: 95,  sig: 0.6,  ability: -0.6 },
  { id: "glacial",  kind: "gauss", med: 150, sig: 0.7,  ability: -1.2 },
  { id: "bimodal",  kind: "bimodal", med: 12, slow: 260, pSlow: 0.22, sig: 0.35, ability: 0.3 },
  { id: "fatiguing",kind: "fatigue", med: 22, sig: 0.4, ability: 0.5, endMul: 3.2 },
  { id: "distract", kind: "gauss", med: 40, sig: 1.3, ability: 0.2 },
];

function lognorm(rng, sigma) {
  const u1 = Math.max(1e-9, rng()), u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.exp(sigma * z - (sigma * sigma) / 2);
}

function latency(arch, req, rng, frac) {
  // My phase-work shape differs from both the design table and the builder's.
  const work = { model: 0.45, "guided-1": 0.7, "guided-2": 0.9, "guided-3": 1.25, solo: 1.05 }[req.phase] ?? 1;
  const hard = clamp(1 + 0.3 * (req.difficulty + 0.5), 0.4, 2.6);
  let s;
  if (arch.kind === "bimodal") {
    s = (rng() < arch.pSlow ? arch.slow : arch.med) * work * hard * lognorm(rng, arch.sig);
  } else if (arch.kind === "fatigue") {
    s = arch.med * (1 + (arch.endMul - 1) * frac) * work * hard * lognorm(rng, arch.sig);
  } else {
    s = arch.med * work * hard * lognorm(rng, arch.sig);
  }
  return Math.round(clamp(s, 1.2, 900) * 1000);
}

function makeWorld(seed, startMs) {
  const t = { ms: startMs };
  const graph = new Graph(graphSource);
  const clock = { minutes: () => t.ms / 60000, advance() {}, real: true };
  const mastery = new Mastery(graph, { now: () => t.ms / 60000, storage: null, emit: () => {}, bankAudit });
  const scheduler = new Scheduler(mastery, { clock, seed: seed ^ 0x1234, sessionMinutes: 25 });
  const learning = {
    mastery, scheduler, graph,
    next: () => scheduler.next(),
    submit: (r, o) => scheduler.submit(r, o),
    beginSession: () => scheduler.beginSession(),
    endSession: () => scheduler.endSession(),
  };
  return { t, graph, mastery, scheduler, learning };
}

function runLearner(arch, seed, sessions, awayP = 0) {
  const rng = rngFrom(seed);
  const w = makeWorld(seed, Date.UTC(2026, 2, 3, 15, 0, 0));
  const save = new Save({ storage: new Mem(), now: () => w.t.ms });
  save.load();
  const rows = [];
  let session = null;
  const beatKinds = new Map();
  let testOutBeats = 0, certEvents = 0, carried = 0;

  for (let n = 0; n < sessions; n += 1) {
    if (session && session.resumable) {
      w.t.ms += Math.round((6 + 15 * rng()) * 60000);
      session.resume("returned");
    } else {
      w.t.ms += Math.round((19 + 10 * rng()) * 3600 * 1000);
      session = new Session({ learning: w.learning, save, now: () => w.t.ms, emit: () => {} });
      session.begin();
    }
    let servedNotSubmitted = 0;
    const est = () => {}; // no-op
    for (let g = 0; g < 900; g += 1) {
      const req = session.next();
      if (!req) break;
      servedNotSubmitted = 1;
      if (awayP && rng() < awayP) {
        const ms = Math.round((120 + 600 * rng()) * 1000);
        w.t.ms += ms; session.noteAway(ms);
      }
      const frac = clamp(session.elapsedSeconds / (21 * 60), 0, 1);
      const ms = latency(arch, req, rng, frac);
      w.t.ms += ms;
      const p = 1 / (1 + Math.exp(-(arch.ability - req.difficulty)));
      const floor = w.mastery.trueGuess(req.kpId, req.form, req.phase);
      session.submit(req, {
        correct: rng() < p + (1 - p) * floor,
        latencyMs: ms,
        itemId: `${req.kpId}#${req.seq}`,
        hinted: req.hinted,
      });
      servedNotSubmitted = 0;
      w.t.ms += Math.round(2000 + 4000 * rng());
    }
    if (session.phase !== "closed") session.close("critic-guard");
    const p = session.probe();
    for (const b of session.beats) {
      beatKinds.set(b.kind, (beatKinds.get(b.kind) ?? 0) + 1);
      if (b.testOut) testOutBeats += 1;
      if (b.kind !== "acquire") certEvents += 1;
      if (b.end === "carried") carried += 1;
    }
    const last = session.beats[session.beats.length - 1] ?? null;
    rows.push({
      minutes: p.elapsed.minutes,
      items: p.elapsed.items,
      beats: p.elapsed.beats,
      reason: p.closeReason,
      win: p.closingWin,
      lastEnd: last?.end ?? "none",
      lastKind: last?.kind ?? "none",
      openBeat: !!(session.beat && session.beat.end === "stopped"),
      midProblem: servedNotSubmitted === 1,
      rho: p.pace.ratio,
      startsOutside: p.stats.startsOutsideCeiling,
      excess: p.stats.worstResponseExcessSeconds,
      certified: p.tally.certified.length,
      set: p.tally.set.length,
      lvl1: session._summary("close").level1Percent,
    });
  }
  return { rows, beatKinds, testOutBeats, certEvents, carried, mastery: w.mastery, graph: w.graph };
}

// ------------------------------------------------------------------- report
const SESSIONS = 10;
const SEEDS = Number((process.argv.find(a => a.startsWith("--seeds=")) ?? "--seeds=5").split("=")[1]);
const AWAY = Number((process.argv.find(a => a.startsWith("--away=")) ?? "--away=0").split("=")[1]);

console.log(`CRITIC P33 — ${ARCH.length} archetypes x ${SEEDS} seeds x ${SESSIONS} sittings, awayP=${AWAY}`);
console.log("arch        n    min    p10    med    p90    max  in15-25  <15  >25  midProb  items/med  certs  reasons");
console.log("-".repeat(130));
const all = [];
for (const a of ARCH) {
  const mins = [], items = [];
  let below = 0, above = 0, mid = 0, certs = 0, testOut = 0;
  const reasons = new Map(), kinds = new Map(), wins = new Map();
  for (let s = 1; s <= SEEDS; s += 1) {
    const r = runLearner(a, s * 7919 + a.id.length, SESSIONS, AWAY);
    for (const row of r.rows) {
      mins.push(row.minutes); items.push(row.items);
      if (row.minutes < 15) below += 1;
      if (row.minutes > 25) above += 1;
      if (row.midProblem) mid += 1;
      certs += row.certified;
      reasons.set(row.reason, (reasons.get(row.reason) ?? 0) + 1);
      wins.set(row.win, (wins.get(row.win) ?? 0) + 1);
    }
    for (const [k, v] of r.beatKinds) kinds.set(k, (kinds.get(k) ?? 0) + v);
    testOut += r.testOutBeats;
  }
  mins.sort((x, y) => x - y); items.sort((x, y) => x - y);
  const q = (p) => mins[clamp(Math.round(p * (mins.length - 1)), 0, mins.length - 1)];
  const r2 = (v) => Math.round(v * 100) / 100;
  all.push({ id: a.id, kinds, wins, testOut, reasons });
  console.log(
    a.id.padEnd(11) + String(mins.length).padStart(3) +
    String(r2(mins[0])).padStart(7) + String(r2(q(0.1))).padStart(7) + String(r2(q(0.5))).padStart(7) +
    String(r2(q(0.9))).padStart(7) + String(r2(mins[mins.length - 1])).padStart(7) +
    String(`${mins.length - below - above}/${mins.length}`).padStart(9) +
    String(below).padStart(5) + String(above).padStart(5) + String(mid).padStart(9) +
    String(items[Math.floor(items.length / 2)]).padStart(11) + String(certs).padStart(7) +
    "  " + [...reasons].map(([k, v]) => `${k}=${v}`).join(" ")
  );
}
console.log();
console.log("BEAT COMPOSITION — what the 'mastery event' budget was actually spent on");
console.log("arch         acquire  consolidate  retention  review  test-out beats   closingWin histogram");
for (const a of all) {
  console.log(
    a.id.padEnd(11) +
    String(a.kinds.get("acquire") ?? 0).padStart(8) +
    String(a.kinds.get("consolidate") ?? 0).padStart(13) +
    String(a.kinds.get("retention") ?? 0).padStart(11) +
    String(a.kinds.get("review") ?? 0).padStart(8) +
    String(a.testOut).padStart(16) +
    "   " + [...a.wins].map(([k, v]) => `${k}=${v}`).join(" ")
  );
}
