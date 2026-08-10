/**
 * CRITIC's own harness for P33. Nothing here is copied from review/measure/P33.mjs; the archetypes,
 * the latency shapes, the response model, the drive loop and every gate are written independently.
 *
 *   node review/measure/_critic-P33-r2.mjs
 *
 * Measures, per archetype, over N sittings:
 *   - attended session length distribution (the arc's own clock)
 *   - WALL length distribution (attended + away): what the learner's afternoon actually spent
 *   - MASTERY EVENTS per sitting: certification beats, gate opens, certifications, test-out probes
 *   - whether any sitting ended with an item outstanding
 *   - whether the served acquisition node is the one the leverage table asked for, against the
 *     null hypothesis of picking at random from the legal pool
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { Graph } from "../../app/src/learn/Graph.js";
import { Mastery } from "../../app/src/learn/Mastery.js";
import { Scheduler } from "../../app/src/learn/Scheduler.js";
import { itemBank } from "../../app/src/learn/ItemBank.js";
import { Session, ARC } from "../../app/src/flow/Session.js";
import { Save, repairPace } from "../../app/src/flow/Save.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const readJson = (p) => JSON.parse(readFileSync(resolve(root, p), "utf8"));
const graphSource = readJson("content/knowledge-graph.json");
const bankAudit = readJson("app/src/learn/bank-audit.json");
await itemBank.ensure(new Graph(graphSource).ids);

const SESSIONS = Number((process.argv.find((a) => a.startsWith("--sessions=")) ?? "=10").split("=")[1]);
const SEEDS = Number((process.argv.find((a) => a.startsWith("--seeds=")) ?? "=3").split("=")[1]);

// ------------------------------------------------------------------ my own rng / distributions

function rand(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const r2 = (v) => Math.round(v * 100) / 100;
function dist(vals) {
  if (!vals.length) return { n: 0 };
  const s = [...vals].sort((a, b) => a - b);
  const q = (p) => s[clamp(Math.round(p * (s.length - 1)), 0, s.length - 1)];
  return { n: s.length, min: r2(s[0]), p10: r2(q(0.1)), med: r2(q(0.5)), p90: r2(q(0.9)), max: r2(s[s.length - 1]) };
}

class Mem {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}

/**
 * My latency shape is a shifted Weibull, NOT the builder's lognormal, and the phase multiplier is
 * flat on purpose: a learner does not know which phase the engine thinks it is serving. `spike`
 * is a separate contaminating mode.
 */
function weibull(u, k) { return Math.pow(-Math.log(Math.max(1e-9, 1 - u)), 1 / k); }

const ARCH = [
  { id: "chromebook-fast", med: 7, k: 2.2, ability: 1.6, spike: null, awayP: 0.02, awayLo: 15, awayHi: 60 },
  { id: "median-teen", med: 30, k: 1.7, ability: 0.4, spike: { p: 0.06, s: 150 }, awayP: 0.08, awayLo: 30, awayHi: 200 },
  { id: "longhand", med: 95, k: 2.5, ability: -0.6, spike: null, awayP: 0.05, awayLo: 40, awayHi: 240 },
  { id: "phone-in-lap", med: 18, k: 1.2, ability: 0.2, spike: { p: 0.18, s: 220 }, awayP: 0.22, awayLo: 45, awayHi: 420 },
  { id: "warms-up", med: 110, k: 2.0, ability: 0.8, spike: null, awayP: 0.03, awayLo: 20, awayHi: 90, warmAfter: 6, warmMed: 11 },
];

function latencyMs(a, served, rng) {
  const med = a.warmAfter && served >= a.warmAfter ? a.warmMed : a.med;
  if (a.spike && rng() < a.spike.p) return Math.round(clamp(a.spike.s * (0.6 + 0.9 * rng()), 3, 900) * 1000);
  const base = (med / Math.pow(Math.log(2), 1 / a.k)) * weibull(rng(), a.k);
  return Math.round(clamp(base, 2, 900) * 1000);
}
const gapMs = (rng) => Math.round(1800 + 5200 * rng());

function makeWorld(seed, startMs, { storage = null, key = "vs.learn.mastery.v1" } = {}) {
  const t = { ms: startMs };
  const graph = new Graph(graphSource);
  const clock = { minutes: () => t.ms / 60000, advance() {} };
  const mastery = new Mastery(graph, { now: () => t.ms / 60000, storage, storageKey: key, emit: () => {}, bankAudit });
  const scheduler = new Scheduler(mastery, { clock, seed: seed ^ 0x1234, sessionMinutes: 25, bank: itemBank });
  const learning = {
    mastery, scheduler, graph,
    next: () => scheduler.next(),
    submit: (r, o) => scheduler.submit(r, o),
    beginSession: () => scheduler.beginSession(),
    endSession: () => scheduler.endSession(),
  };
  return { t, graph, mastery, scheduler, learning };
}

const CERT_KINDS = new Set(["consolidate", "retention", "review"]);

function runArch(a, seed, sessions) {
  const rng = rand(seed * 7919 + 13);
  const world = makeWorld(seed, Date.UTC(2026, 2, 3, 15, 45, 0));
  const save = new Save({ storage: new Mem(), now: () => world.t.ms });
  save.load();
  const rows = [];
  const faults = [];
  const focusRows = [];
  let session = null;
  let servedTotal = 0;

  for (let n = 0; n < sessions; n += 1) {
    if (session && session.resumable) {
      world.t.ms += Math.round((6 + 18 * rng()) * 60000);
      session.resume("returned");
    } else {
      world.t.ms += Math.round((18 + 10 * rng()) * 3600 * 1000);
      session = new Session({ learning: world.learning, save, now: () => world.t.ms, emit: () => {} });
      session.begin();
    }
    const openedMs = world.t.ms;
    const certsBefore = world.mastery.stats.certifications;
    const gatesBefore = world.mastery.stats.gateOpens;
    const probesBefore = world.mastery.stats.testOutItems;
    let away = 0;
    let lastBeatIdx = -1;

    for (let guard = 0; guard < 800; guard += 1) {
      // Snapshot what the layer WANTED before it asks the engine.
      const table = session.plan?.leverage ?? [];
      const wanted = table[0]?.kpId ?? null;
      const cand = session.candidates();
      const poolIds = cand.acquire.map((c) => c.kpId);
      const scoreOf = (id) => table.find((e) => e.kpId === id)?.score ?? null;
      const req = session.next();
      if (!req) break;
      if (session.beat && session.beat.index !== lastBeatIdx) {
        lastBeatIdx = session.beat.index;
        if (req.mode === "acquire" && wanted && poolIds.length) {
          focusRows.push({
            wanted, got: req.kpId, pool: poolIds.length, hit: wanted === req.kpId, inPool: poolIds.includes(wanted),
            wantScore: scoreOf(wanted), gotScore: scoreOf(req.kpId), tableSize: table.length,
          });
        }
      }
      // The claim is standing open. The layer must never be closed at this instant.
      if (session.phase === "closed") faults.push(`${a.id} s${n + 1}: closed with an item outstanding`);
      if (a.awayP && rng() < a.awayP) {
        const ms = Math.round((a.awayLo + (a.awayHi - a.awayLo) * rng()) * 1000);
        // Half of these land mid-item, with the claim on the slab.
        world.t.ms += ms; session.noteAway(ms); away += ms;
      }
      const lat = latencyMs(a, servedTotal, rng);
      servedTotal += 1;
      world.t.ms += lat;
      const base = 1 / (1 + Math.exp(-(a.ability - req.difficulty)));
      const floor = world.mastery.trueGuess(req.kpId, req.form, req.phase);
      session.submit(req, {
        correct: rng() < base + (1 - base) * floor,
        latencyMs: lat,
        itemId: req.itemId ?? `${req.kpId}#${req.seq}`,
        family: req.family ?? undefined,
        hinted: req.hinted,
      });
      world.t.ms += gapMs(rng);
    }
    if (session.phase !== "closed") { faults.push(`${a.id} s${n + 1}: harness had to close it`); session.close("harness-guard"); }

    const beatKinds = {};
    const kps = new Set();
    for (const b of session.beats) { beatKinds[b.kind] = (beatKinds[b.kind] ?? 0) + 1; kps.add(b.kpId); }
    const certBeats = session.beats.filter((b) => CERT_KINDS.has(b.kind)).length;
    const last = session.beats[session.beats.length - 1] ?? null;
    rows.push({
      arch: a.id, seed, n: n + 1,
      minutes: session.elapsedSeconds / 60,
      wallMinutes: (world.t.ms - openedMs) / 60000,
      awayMinutes: away / 60000,
      items: session.itemsServed,
      beats: session.beats.length,
      certBeats,
      acquireBeats: beatKinds.acquire ?? 0,
      gateOpens: world.mastery.stats.gateOpens - gatesBefore,
      certifications: world.mastery.stats.certifications - certsBefore,
      probeItems: world.mastery.stats.testOutItems - probesBefore,
      distinctKps: kps.size,
      distinctKpsByItem: session.probe().breadth.distinctKps,
      closeReason: session.closeReason,
      closingWin: session.closingWin,
      lastBeat: last ? `${last.kind}/${last.end}` : "none",
      midItemAtClose: session._servedAt != null,
      startsOutsideCeiling: session.stats.startsOutsideCeiling,
      worstResponseExcessMin: session.stats.worstResponseExcessSeconds / 60,
      rho: session.pace.ratio,
      slowRatio: session.pace.slowRatio,
      level1: world.mastery.summary().level1Percent,
      minSupply: session.probe().breadth.minSupply,
    });
  }
  return { rows, faults, focusRows, world, save };
}

// ------------------------------------------------------------------------------------- run

const all = [];
const allFocus = [];
const allFaults = [];
for (const a of ARCH) {
  for (let s = 1; s <= SEEDS; s += 1) {
    const r = runArch(a, s, SESSIONS);
    all.push(...r.rows); allFocus.push(...r.focusRows); allFaults.push(...r.faults);
  }
}

const line = (s = "") => console.log(s);
line("=".repeat(112));
line(`CRITIC P33 — ${ARCH.length} archetypes x ${SEEDS} seeds x ${SESSIONS} sittings = ${all.length} sittings`);
line("=".repeat(112));
line();
line("A. SESSION LENGTH (attended minutes — the arc's own clock) and WALL minutes (what the afternoon spent)");
line();
line("archetype          n   min   p10   med   p90   max  |  wall med  wall max  |  <15  >25   items med");
line("-".repeat(112));
for (const a of ARCH) {
  const rows = all.filter((r) => r.arch === a.id);
  const d = dist(rows.map((r) => r.minutes));
  const w = dist(rows.map((r) => r.wallMinutes));
  const under = rows.filter((r) => r.minutes < ARC.minMinutes).length;
  const over = rows.filter((r) => r.minutes > ARC.maxMinutes).length;
  const it = dist(rows.map((r) => r.items));
  line(
    `${a.id.padEnd(17)} ${String(d.n).padStart(2)} ${String(d.min).padStart(5)} ${String(d.p10).padStart(5)} ${String(d.med).padStart(5)} ${String(d.p90).padStart(5)} ${String(d.max).padStart(5)}  |  ${String(w.med).padStart(8)} ${String(w.max).padStart(9)}  |  ${String(under).padStart(3)} ${String(over).padStart(3)}   ${String(it.med).padStart(8)}`
  );
}
const dAll = dist(all.map((r) => r.minutes));
line("-".repeat(112));
line(`ALL               ${String(dAll.n).padStart(3)} ${String(dAll.min).padStart(5)} ${String(dAll.p10).padStart(5)} ${String(dAll.med).padStart(5)} ${String(dAll.p90).padStart(5)} ${String(dAll.max).padStart(5)}   under-floor ${all.filter((r) => r.minutes < 15).length}  over-ceiling ${all.filter((r) => r.minutes > 25).length}`);
line();

line("B. MASTERY EVENTS PER SITTING — the currency the piece claims to budget in");
line();
line("archetype        certBeats med/p10/max  acquireBeats med  gateOpens med(sum)  certifications med(sum)  sittings with ZERO cert-beat  with ZERO certification  distinctKps med");
line("-".repeat(112));
for (const a of ARCH) {
  const rows = all.filter((r) => r.arch === a.id);
  const cb = dist(rows.map((r) => r.certBeats));
  const ab = dist(rows.map((r) => r.acquireBeats));
  const go = dist(rows.map((r) => r.gateOpens));
  const ce = dist(rows.map((r) => r.certifications));
  const zeroCb = rows.filter((r) => r.certBeats === 0).length;
  const zeroCe = rows.filter((r) => r.certifications === 0).length;
  const dk = dist(rows.map((r) => r.distinctKps));
  line(
    `${a.id.padEnd(16)} ${String(cb.med).padStart(4)}/${String(cb.p10).padStart(3)}/${String(cb.max).padStart(3)}         ${String(ab.med).padStart(4)}            ${String(go.med).padStart(3)}(${rows.reduce((s, r) => s + r.gateOpens, 0)})              ${String(ce.med).padStart(3)}(${rows.reduce((s, r) => s + r.certifications, 0)})               ${String(zeroCb).padStart(3)}/${rows.length}                ${String(zeroCe).padStart(3)}/${rows.length}          ${String(dk.med).padStart(4)}`
  );
}
line();
line("B2. IS ANY SITTING EMPTY OF MASTERY WORK, AND WHERE DOES TEN SITTINGS GET THE LEARNER?");
line("archetype        sittings with NO mastery event at all   test-out probe items   Level 1 mastered after 10   breaks/resumes");
line("-".repeat(112));
for (const a of ARCH) {
  const rows = all.filter((r) => r.arch === a.id);
  const empty = rows.filter((r) => r.certBeats === 0 && r.gateOpens === 0 && r.certifications === 0).length;
  const probes = rows.reduce((s, r) => s + r.probeItems, 0);
  const finals = [...new Set(rows.map((r) => r.seed))].map((s) => rows.filter((r) => r.seed === s).slice(-1)[0].level1);
  const breaks = rows.filter((r) => r.closeReason === "break").length;
  line(`${a.id.padEnd(16)} ${String(empty).padStart(4)}/${rows.length}                            ${String(probes).padStart(6)}                 ${finals.map((f) => `${f}%`).join(" ")}          ${breaks}`);
}
line();

line("C. HOW IT ENDED");
const byReason = new Map();
const byWin = new Map();
const byLast = new Map();
for (const r of all) {
  byReason.set(r.closeReason, (byReason.get(r.closeReason) ?? 0) + 1);
  byWin.set(r.closingWin, (byWin.get(r.closingWin) ?? 0) + 1);
  byLast.set(r.lastBeat, (byLast.get(r.lastBeat) ?? 0) + 1);
}
line(`  closeReason: ${[...byReason].map(([k, v]) => `${k}=${v}`).join("  ")}`);
line(`  closingWin : ${[...byWin].map(([k, v]) => `${k}=${v}`).join("  ")}`);
line(`  last beat  : ${[...byLast].map(([k, v]) => `${k}=${v}`).join("  ")}`);
line(`  ended with an item outstanding: ${all.filter((r) => r.midItemAtClose).length}`);
line(`  startsOutsideCeiling (must be 0): ${all.reduce((s, r) => s + r.startsOutsideCeiling, 0)}`);
line(`  harness faults: ${allFaults.length ? allFaults.slice(0, 6).join(" | ") : "none"}`);
line();
const over = all.filter((r) => r.minutes > ARC.maxMinutes);
if (over.length) {
  line("  OVER-CEILING SITTINGS — is the residual one long response, or the layer?");
  for (const r of over) {
    const excess = r.minutes - ARC.maxMinutes;
    line(`    ${r.arch} s${r.n} ${r2(r.minutes)}min (+${r2(excess)}) worst single response ran +${r2(r.worstResponseExcessMin)} past its promise -> ${excess <= r.worstResponseExcessMin + 0.02 ? "one response" : "*** THE LAYER ***"}`);
  }
  line();
}

line("D. LEVERAGE — does the sitting go where the layer says the leverage is, or is that a coincidence?");
const hits = allFocus.filter((f) => f.hit).length;
const inPool = allFocus.filter((f) => f.inPool).length;
const meanPool = allFocus.reduce((s, f) => s + f.pool, 0) / Math.max(1, allFocus.length);
// Null hypothesis: the engine picks from the legal acquisition pool without regard to the request.
const nullRate = allFocus.reduce((s, f) => s + (f.inPool ? 1 / f.pool : 0), 0) / Math.max(1, allFocus.length);
line(`  acquisition beats observed: ${allFocus.length}`);
line(`  the requested node was legal at all: ${inPool} (${r2((100 * inPool) / allFocus.length)}%)`);
line(`  the engine served it: ${hits} (${r2((100 * hits) / allFocus.length)}%)`);
line(`  mean legal pool size: ${r2(meanPool)}  ->  RANDOM-PICK expectation: ${r2(100 * nullRate)}%`);
line(`  lift over chance: ${r2((100 * hits) / allFocus.length - 100 * nullRate)} points`);
line(`  Scheduler.focus() exists: ${typeof new Scheduler(new Mastery(new Graph(graphSource), { storage: null, bankAudit })).focus === "function"}`);
{
  const poolHist = new Map();
  for (const f of allFocus) poolHist.set(f.pool, (poolHist.get(f.pool) ?? 0) + 1);
  line(`  legal acquisition pool size at the boundary: ${[...poolHist].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join("  ")}`);
  line(`  boundaries where the choice is forced (pool = 1): ${r2((100 * (poolHist.get(1) ?? 0)) / allFocus.length)}%`);
  const misses = allFocus.filter((f) => !f.hit && f.wantScore != null && f.gotScore != null);
  const gaps = misses.map((f) => f.wantScore - f.gotScore);
  line(`  when the request is NOT honoured, the leverage score it gave up: ${JSON.stringify(dist(gaps))} (top scores run ~0.17-1.0)`);
  const ties = gaps.filter((g) => g <= 1e-9).length;
  line(`  ...of which exact ties (the table had no opinion): ${ties}/${misses.length}`);
}
line();

// ------------------------------------------------------------ E. kill mid-sitting, then reload

line("E. KILLED MID-SITTING, THEN A REAL RELOAD (new Mastery + hydrate, new Save, new Session)");
{
  const mstore = new Mem();
  const fstore = new Mem();
  const w = makeWorld(21, Date.UTC(2026, 2, 3, 15, 45, 0), { storage: mstore });
  const save = new Save({ storage: fstore, now: () => w.t.ms });
  save.load();
  // Sittings 1-3 run to their natural end, so there is real history and a real pace on disk.
  const rng = rand(99);
  const a = ARCH[1];
  const drive = (se, n) => {
    for (let i = 0; i < n; i += 1) {
      const req = se.next();
      if (!req) return false;
      const lat = latencyMs(a, 30, rng);
      w.t.ms += lat;
      const base = 1 / (1 + Math.exp(-(a.ability - req.difficulty)));
      const floor = w.mastery.trueGuess(req.kpId, req.form, req.phase);
      se.submit(req, { correct: rng() < base + (1 - base) * floor, latencyMs: lat, itemId: req.itemId ?? `${req.kpId}#${req.seq}`, family: req.family, hinted: req.hinted });
      w.t.ms += gapMs(rng);
      // Stop the instant a certification event is half-answered: THAT is the moment to pull the plug.
      for (const id of w.graph.ids) {
        const ev = w.mastery.eventOf(id);
        if (ev && ev.served > 0 && ev.served < ev.items) return true;
      }
    }
    return false;
  };
  let s1 = null;
  let killedInEvent = null;
  for (let sit = 0; sit < 6 && !killedInEvent; sit += 1) {
    w.t.ms += 20 * 3600 * 1000;
    s1 = new Session({ learning: w.learning, save, now: () => w.t.ms, emit: () => {} });
    s1.begin();
    const hit = drive(s1, 400);
    if (hit) {
      for (const id of w.graph.ids) {
        const ev = w.mastery.eventOf(id);
        if (ev && ev.served > 0 && ev.served < ev.items) { killedInEvent = { kpId: id, mode: ev.mode, served: ev.served, items: ev.items }; break; }
      }
      break; // THE KILL: leave the sitting open, mid-event, and never call close().
    }
    if (s1.phase !== "closed") s1.close("guard");
  }
  const openBeforeKill = s1.phase;
  const rhoAtKill = s1.pace.ratio;
  const samplesAtKill = s1.pace.samples;
  const itemsAtKill = s1.itemsServed;
  const lapsesAtKill = w.mastery.stats.lapses;
  const certsAtKill = w.mastery.stats.certifications;
  // THE KILL. No close(), no savePace(), no endSession(), no persist() — a tab that died.
  w.t.ms += 3 * 3600 * 1000;

  const w2 = makeWorld(21, w.t.ms, { storage: mstore });
  const hydrated = w2.mastery.hydrate();
  const save2 = new Save({ storage: fstore, now: () => w2.t.ms });
  const load = save2.load();
  const s2 = new Session({ learning: w2.learning, save: save2, now: () => w2.t.ms, emit: () => {} });
  s2.begin();
  const evAfter = killedInEvent ? w2.mastery.eventOf(killedInEvent.kpId) : null;
  const firstReq = s2.next();
  line(`  killed with the sitting in phase "${openBeforeKill}" after ${itemsAtKill} items, rho ${r2(rhoAtKill)} over ${samplesAtKill} samples`);
  line(`  mid-event at the kill: ${killedInEvent ? `${killedInEvent.kpId} ${killedInEvent.mode} ${killedInEvent.served}/${killedInEvent.items}` : "none reached"}`);
  line(`  mastery.hydrate(): ${hydrated}`);
  line(`  save fault after reload: ${load.fault}   interrupted recorded: ${!!load.interrupted}   paceSource: ${load.paceSource}`);
  line(`  rho after reload: ${r2(s2.pace.ratio)} over ${s2.pace.samples} samples  (provenance ${s2.probe().pace.provenance})`);
  line(`  opening line: ${s2.opening.map((l) => `"${l.source}"`).join(" ") || "(none)"}`);
  line(`  the half-answered event after reload: ${evAfter ? `${evAfter.mode} ${evAfter.served}/${evAfter.items}` : "GONE"}`);
  line(`  first request after reload: ${firstReq ? `${firstReq.kpId}/${firstReq.mode}` : "null"}   ${killedInEvent && firstReq ? (firstReq.kpId === killedInEvent.kpId ? "-> resumes the open event first" : "-> DOES NOT resume the open event first") : ""}`);
  line(`  lapses ${lapsesAtKill} -> ${w2.mastery.stats.lapses}   certifications ${certsAtKill} -> ${w2.mastery.stats.certifications}`);
  line(`  Level 1 mastered % before the kill ${w.mastery.summary().level1Percent} -> after reload ${w2.mastery.summary().level1Percent}`);
  line(`  scored items in the model before/after: ${w.graph.ids.reduce((s, id) => s + w.mastery.stateOf(id).scored, 0)} -> ${w2.graph.ids.reduce((s, id) => s + w2.mastery.stateOf(id).scored, 0)}`);
}
line();

// ------------------------------------------------------------------- F. corrupted saves

line("F. CORRUPTED SAVE — does it degrade honestly?");
const cases = [
  ["truncated json", "{\"version\":1,\"pace\":{\"ratio\":0.4"],
  ["a bare array", "[1,2,3]"],
  ["null", "null"],
  ["version 99", JSON.stringify({ version: 99, pace: { ratio: 0.5 } })],
  ["hostile types", JSON.stringify({ version: 1, pace: { ratio: "fast", spread: null, slowRatio: 9999, gapSeconds: -3, samples: -12 }, sessions: "many", live: 7, counters: { opened: "x" } })],
  ["in-range poison", JSON.stringify({ version: 1, pace: { ratio: 6, spread: 6, slowRatio: 12, gapSeconds: 120, samples: 100000 }, paceSource: "measured", sessions: [], live: null, counters: { opened: 3, closed: 3, interrupted: 0 } })],
  ["NaN-ish", JSON.stringify({ version: 1, pace: { ratio: 1e308 * 10, samples: Infinity } })],
  ["a 2 MB blob", JSON.stringify({ version: 1, pace: { ratio: 1 }, junk: "x".repeat(2_000_000) })],
];
for (const [name, blob] of cases) {
  const st = new Mem();
  st.setItem("vs.flow.save.v1", blob);
  let thrown = null;
  let res = null;
  const warns = [];
  try {
    const sv = new Save({ storage: st, now: () => Date.now(), onWarn: (m) => warns.push(m) });
    res = sv.load();
    const w = makeWorld(5, Date.UTC(2026, 2, 3, 15, 45, 0));
    const se = new Session({ learning: w.learning, save: sv, now: () => w.t.ms, emit: () => {} });
    se.begin();
    const req = se.next();
    res.firstItem = req ? `${req.kpId}/${req.mode}` : "null";
    res.pacePlan = `rho ${r2(se.pace.ratio)} perItem ${r2(se.itemSeconds())}s ceiling ${r2(se.itemSecondsCeiling())}s target ${r2(se.targetSeconds() / 60)}min`;
  } catch (e) { thrown = e; }
  line(`  ${name.padEnd(16)} fault=${String(res?.fault).padEnd(16)} repaired=[${(res?.repaired ?? []).join(",")}] quarantined=${res?.quarantined ?? "-"} ${thrown ? `*** THREW: ${thrown.message}` : `ok -> ${res.firstItem}`}`);
  if (res && !thrown) line(`  ${" ".repeat(16)} ${res.pacePlan}`);
  const quar = st.getItem("vs.flow.save.v1.corrupt");
  if (res?.quarantined) line(`  ${" ".repeat(16)} quarantine holds ${quar ? quar.length : 0} chars of the original`);
}
line();
line(`repairPace on a raw hostile blob: ${JSON.stringify(repairPace({ ratio: -4, spread: "x", slowRatio: 50, gapSeconds: 1e9, samples: 2.7 }, () => {}))}`);
line();
line("G. TYPE-VALID POISON — a save whose pace passes every check and describes nobody. Does the ARC survive?");
{
  const poison = JSON.stringify({
    version: 1,
    pace: { ratio: 6, spread: 6, slowRatio: 12, gapSeconds: 120, samples: 100000 },
    paceSource: "measured",
    sessions: [], live: null, counters: { opened: 9, closed: 9, interrupted: 0 },
  });
  for (const a of [ARCH[0], ARCH[2]]) {
    const st = new Mem();
    st.setItem("vs.flow.save.v1", poison);
    const w = makeWorld(3, Date.UTC(2026, 2, 3, 15, 45, 0));
    const sv = new Save({ storage: st, now: () => w.t.ms });
    sv.load();
    const rng = rand(7);
    const mins = [];
    let se = null;
    for (let n = 0; n < 4; n += 1) {
      w.t.ms += 20 * 3600 * 1000;
      se = new Session({ learning: w.learning, save: sv, now: () => w.t.ms, emit: () => {} });
      se.begin();
      for (let i = 0; i < 500; i += 1) {
        const req = se.next();
        if (!req) break;
        const lat = latencyMs(a, i, rng);
        w.t.ms += lat;
        const base = 1 / (1 + Math.exp(-(a.ability - req.difficulty)));
        const floor = w.mastery.trueGuess(req.kpId, req.form, req.phase);
        se.submit(req, { correct: rng() < base + (1 - base) * floor, latencyMs: lat, itemId: req.itemId ?? `${req.kpId}#${req.seq}`, family: req.family, hinted: req.hinted });
        w.t.ms += gapMs(rng);
      }
      if (se.phase !== "closed") se.close("guard");
      mins.push(r2(se.elapsedSeconds / 60));
    }
    line(`  ${a.id.padEnd(16)} sittings ${mins.join(", ")} min   final rho ${r2(se.pace.ratio)}   floorOverCeiling ${se.stats.floorOverCeiling}   in band: ${mins.every((m) => m >= 15 && m <= 25)}`);
  }
}
line();
line("=".repeat(112));
