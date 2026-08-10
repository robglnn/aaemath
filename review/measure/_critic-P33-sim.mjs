/**
 * CRITIC's own P33 simulation. Independent of review/measure/P33.mjs.
 * Different latency shapes on purpose: bimodal, heavy-Pareto-tail, and a WITHIN-SITTING DRIFT
 * archetype (fatigue), which is the obvious attack on an EWMA pace estimator that assumes
 * stationarity. Also an "away" model of my own.
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
const rj = (p) => JSON.parse(readFileSync(resolve(root, p), "utf8"));
const graphSource = rj("content/knowledge-graph.json");
const bankAudit = rj("app/src/learn/bank-audit.json");

function rngOf(seed) {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a ^= a << 13; a >>>= 0; a ^= a >> 17; a ^= a << 5; a >>>= 0;
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

function makeWorld(seed, startMs) {
  const t = { ms: startMs };
  const graph = new Graph(graphSource);
  const clock = { minutes: () => t.ms / 60000, advance() {}, real: true };
  const mastery = new Mastery(graph, { now: () => t.ms / 60000, storage: null, emit: () => {}, bankAudit });
  const scheduler = new Scheduler(mastery, { clock, seed: seed ^ 0xc0ffee, sessionMinutes: 25 });
  const learning = {
    mastery, scheduler, graph,
    next: () => scheduler.next(),
    submit: (r, o) => scheduler.submit(r, o),
    beginSession: () => scheduler.beginSession(),
    endSession: () => scheduler.endSession(),
  };
  return { t, graph, mastery, scheduler, learning };
}

// ---- MY latency archetypes. None of these is ratio*designSeconds. -----------------------------
const ARCH = {
  // knows-it-or-stares: 72% at ~6s, 28% at ~45s. Median 6s, mean ~17s.
  bimodal: { ability: 1.2, latency: (rng, ctx) => (rng() < 0.72 ? 4 + 5 * rng() : 30 + 40 * rng()) * ctx.phaseW },
  // heavy Pareto tail: median 28s, but 4% of items run 3-8 minutes (put the tablet down).
  pareto: {
    ability: 0.4,
    latency: (rng, ctx) => {
      const u = rng();
      const base = 28 * Math.pow(1 - u, -0.45);
      const stare = rng() < 0.04 ? 180 + 300 * rng() : 0;
      return (Math.min(base, 200) + stare) * ctx.phaseW;
    },
  },
  // slow and steady, 75s median, tight.
  longhand: { ability: -0.3, latency: (rng, ctx) => (60 + 30 * rng()) * ctx.phaseW },
  // FATIGUE DRIFT: starts at 12s, ends at 3.2x that inside a single sitting.
  drift: { ability: 0.8, latency: (rng, ctx) => (12 * (1 + 2.2 * ctx.frac) * (0.7 + 0.6 * rng())) * ctx.phaseW },
};
// my own phase weights, deliberately unlike the design table AND unlike the builder's
const PHASE_W = { model: 0.4, "guided-1": 1.25, "guided-2": 1.1, "guided-3": 0.9, solo: 1.0 };

const AWAY = {
  none: () => 0,
  classroom: (rng) => (rng() < 0.10 ? (30 + 500 * rng()) * 1000 : 0), // 0.5-9 min, 10% of items
};

function runOne(archName, seed, sessions, awayName) {
  const arch = ARCH[archName];
  const rng = rngOf(seed);
  const world = makeWorld(seed, Date.UTC(2026, 2, 3, 15, 0, 0));
  const save = new Save({ storage: new Mem(), now: () => world.t.ms });
  save.load();
  const rows = [];
  let session = null;
  const phases = new Map();
  const emit = (n, v) => { if (n === "learn:session") phases.set(v.phase, (phases.get(v.phase) ?? 0) + 1); };

  for (let n = 0; n < sessions; n += 1) {
    if (session && session.resumable) {
      world.t.ms += Math.round((6 + 15 * rng()) * 60000);
      session.resume("returned");
    } else {
      world.t.ms += Math.round((18 + 10 * rng()) * 3600 * 1000);
      session = new Session({ learning: world.learning, save, now: () => world.t.ms, emit });
      session.begin();
    }
    const t0 = world.t.ms;
    let items = 0;
    let midItemAway = 0;
    for (let g = 0; g < 800; g += 1) {
      const req = session.next();
      if (!req) break;
      const frac = clamp(session.elapsedSeconds / (21 * 60), 0, 1);
      const ctx = { phaseW: PHASE_W[req.phase] ?? 1, frac };
      // away BEFORE answering (mid-problem absence)
      const a1 = AWAY[awayName](rng);
      if (a1) { world.t.ms += a1; session.noteAway(a1); midItemAway += 1; }
      const ms = Math.round(clamp(arch.latency(rng, ctx), 1.5, 900) * 1000);
      world.t.ms += ms;
      const p = 1 / (1 + Math.exp(-(arch.ability - req.difficulty)));
      const floor = world.mastery.trueGuess(req.kpId, req.form, req.phase);
      session.submit(req, {
        correct: rng() < p + (1 - p) * floor,
        latencyMs: ms,
        itemId: `${req.kpId}#${req.seq}`,
        hinted: req.hinted,
      });
      world.t.ms += Math.round((2 + 6 * rng()) * 1000);
      items += 1;
    }
    const openBeat = session.beat && !session.beat.done;
    if (session.phase !== "closed") session.close("critic-guard");
    const last = session.beats[session.beats.length - 1] ?? null;
    // strict mid-problem: any certification event left partially served anywhere
    const halfEvents = world.graph.ids
      .map((id) => ({ id, ev: world.mastery.eventOf(id) }))
      .filter((x) => x.ev && x.ev.served > 0 && x.ev.served < x.ev.items);
    const sm = world.mastery.summary();
    rows.push({
      n: n + 1,
      min: session.elapsedSeconds / 60,
      wall: (world.t.ms - t0) / 60000,
      items,
      reason: session.closeReason,
      lastEnd: last?.end ?? "none",
      win: session.closingWin,
      openBeatAtClose: !!openBeat,
      halfEvents: halfEvents.length,
      certified: session.tally.certified.length,
      set: session.tally.set.length,
      mastered: sm.mastered,
      l1: sm.level1Percent,
      rho: session.pace.ratio,
      closing: session.closing.map((l) => l.source).join(" | "),
      opening: session.opening.map((l) => l.source).join(" | "),
    });
  }
  return { rows, phases };
}

const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[clamp(Math.round(p * (s.length - 1)), 0, s.length - 1)]; };
const r2 = (v) => Math.round(v * 100) / 100;

const SEEDS = Number((process.argv.find((a) => a.startsWith("--seeds=")) ?? "--seeds=12").split("=")[1]);
console.log(`CRITIC P33 sim — ${SEEDS} seeds x 10 sittings per archetype x 2 away profiles\n`);
console.log("arch      away       n    min    p10    med    p90    max  in15-25  midProb  halfEvt  items  certs  L1%  reasons");
console.log("-".repeat(128));
const allBad = [];
for (const awayName of ["none", "classroom"]) {
  for (const archName of Object.keys(ARCH)) {
    const all = [];
    const reasons = new Map();
    let midProb = 0, half = 0, certs = 0, itemsTot = 0, l1 = 0;
    for (let s = 1; s <= SEEDS; s += 1) {
      const { rows } = runOne(archName, s, 10, awayName);
      for (const r of rows) {
        all.push(r.min);
        reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1);
        if (r.openBeatAtClose) midProb += 1;
        half += r.halfEvents > 0 ? 1 : 0;
        certs += r.certified;
        itemsTot += r.items;
        if (r.min < 15 || r.min > 25) allBad.push(`${archName}/${awayName}/seed${s}#${r.n} ${r2(r.min)}min reason=${r.reason} items=${r.items}`);
      }
      l1 = rows[rows.length - 1].l1;
    }
    const inBand = all.filter((v) => v >= 15 && v <= 25).length;
    console.log(
      archName.padEnd(10) + awayName.padEnd(11) + String(all.length).padStart(4) +
      String(r2(Math.min(...all))).padStart(7) + String(r2(q(all, 0.1))).padStart(7) +
      String(r2(q(all, 0.5))).padStart(7) + String(r2(q(all, 0.9))).padStart(7) +
      String(r2(Math.max(...all))).padStart(7) +
      `${inBand}/${all.length}`.padStart(9) + String(midProb).padStart(9) + String(half).padStart(9) +
      String(Math.round(itemsTot / all.length)).padStart(7) + String(certs).padStart(7) +
      String(r2(l1)).padStart(5) + "  " + [...reasons].map(([k, v]) => `${k}=${v}`).join(" ")
    );
  }
}
console.log("\nOUT OF BAND (first 20):");
for (const b of allBad.slice(0, 20)) console.log("  " + b);
console.log(`  total out of band: ${allBad.length}`);

// ---- copy, verbatim, from a real run ---------------------------------------------------------
console.log("\nOPEN/CLOSE COPY ACTUALLY EMITTED (bimodal seed 3, 10 sittings):");
for (const r of runOne("bimodal", 3, 10, "none").rows)
  console.log(`  #${r.n} open: "${r.opening}"\n      close: "${r.closing}"  win=${r.win} certs=${r.certified} set=${r.set}`);
