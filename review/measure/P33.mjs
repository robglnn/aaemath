/**
 * P33 — the Pomodoro session layer, measured offline.
 *
 *   node review/measure/P33.mjs                       # headline: 10 consecutive sittings each
 *   node review/measure/P33.mjs --seeds=40            # the distribution
 *   node review/measure/P33.mjs --json=review/measure/P33.json
 *
 * NO BROWSER. A human is playtesting on this machine and a headless SwiftShader capture would
 * steal CPU from them for a claim that has nothing to do with pixels. The session arc is
 * arithmetic over the real engine — `learn/Mastery.js`, `learn/Scheduler.js` and `flow/Session.js`
 * are imported and run exactly as the game runs them — so it is provable in Node and it is proved
 * here.
 *
 * ---------------------------------------------------------------------------------------------
 * THE TWO ARMS, AND WHY THE BASELINE IS NOT A STRAW MAN
 *
 * `baseline` is the shipped engine driven the only way it can be driven without this piece:
 * `Scheduler.beginSession()`, then `next()`/`submit()` until `next()` returns null, with
 * `sessionMinutes` at its constructor default of 25. That is not a weakened comparison — it is
 * literally what `boot/62-learning.js` sets up today. Its time box counts `phases.
 * secondsPerItemByPhase`, which is a **pricing** contract (a 22-second demonstration must not cost
 * what a 46-second solo item costs) and which is identical for every learner. So every learner
 * gets the same ~35 items, and the wall clock lands wherever their own speed puts it.
 *
 * `session` is the same engine with `flow/Session.js` in front of it.
 *
 * ---------------------------------------------------------------------------------------------
 * THE RESPONSE MODEL IS NOT THE BUDGET MODEL — THIS IS THE POINT
 *
 * `Session.js` estimates one number per learner: ρ, the ratio between the seconds an item
 * actually took and the seconds `phases.secondsPerItemByPhase` prices it at. If this simulation
 * generated latencies as `ρ_true × secondsPerItemByPhase[phase]`, ρ would be recoverable by
 * construction and the measurement would be the assumption wearing a number — the exact defect
 * `RESUME.md` §7 records against the first guessing-bot proof.
 *
 * So the simulated learner's time comes from a DIFFERENT shape: a per-archetype median, a
 * lognormal spread, a difficulty term, and a per-phase work factor that is deliberately not
 * proportional to the design's table (a hint-idling `guided-3` item is the LONGEST thing a
 * simulated learner does, where the design prices it the same as `solo`). ρ is therefore
 * genuinely estimated from a mixture the estimator was never told about.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { Graph } from "../../app/src/learn/Graph.js";
import { Mastery } from "../../app/src/learn/Mastery.js";
import { Scheduler } from "../../app/src/learn/Scheduler.js";
import { Session, ARC } from "../../app/src/flow/Session.js";
import { Save } from "../../app/src/flow/Save.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const readJson = (p) => JSON.parse(readFileSync(resolve(root, p), "utf8"));

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? dflt : hit.split("=").slice(1).join("=");
};
const SESSIONS = Number(arg("sessions", 10));
const SEEDS = Number(arg("seeds", 24));
const JSON_OUT = arg("json", null);

const graphSource = readJson("content/knowledge-graph.json");
const bankAudit = readJson("app/src/learn/bank-audit.json");

// ------------------------------------------------------------------------------------- helpers

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Box-Muller, scaled so the multiplier has mean 1 — spread without changing the median cost. */
function lognormal(rng, sigma) {
  const u1 = Math.max(1e-9, rng());
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.exp(sigma * z - (sigma * sigma) / 2);
}

function stats(values) {
  if (!values.length) return { n: 0 };
  const s = [...values].sort((a, b) => a - b);
  const q = (p) => s[clamp(Math.floor(p * (s.length - 1) + 0.5), 0, s.length - 1)];
  return {
    n: s.length,
    min: r2(s[0]),
    p10: r2(q(0.1)),
    median: r2(q(0.5)),
    p90: r2(q(0.9)),
    max: r2(s[s.length - 1]),
    mean: r2(s.reduce((a, b) => a + b, 0) / s.length),
  };
}
const r2 = (v) => Math.round(v * 100) / 100;

/** Minimal `Storage`, so `Save.js` is exercised for real rather than stubbed out. */
class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
}

// ---------------------------------------------------------------------------------- archetypes

/**
 * How long a simulated learner takes on one item, by teaching phase. NOT the design's table:
 * `secondsPerItemByPhase` normalises to 0.48 / 0.74 / 0.87 / 1.00 / 1.00, and these are
 * 0.55 / 0.80 / 0.85 / 1.15 / 1.00 — a demonstration is a little slower than the design assumes
 * and hint-idling is the most expensive thing on the list, because idling twelve seconds for the
 * hint surface is what a learner who reaches `guided-3` is doing.
 */
const PHASE_WORK = { model: 0.55, "guided-1": 0.8, "guided-2": 0.85, "guided-3": 1.15, solo: 1.0 };

const ARCHETYPES = [
  { id: "sprinter", medianSeconds: 9, sigma: 0.35, ability: 1.4, note: "answers fast and is usually right" },
  { id: "quick", medianSeconds: 16, sigma: 0.4, ability: 1.0, note: "" },
  { id: "steady", medianSeconds: 26, sigma: 0.45, ability: 0.5, note: "" },
  { id: "deliberate", medianSeconds: 44, sigma: 0.5, ability: 0.0, note: "" },
  { id: "slow", medianSeconds: 68, sigma: 0.55, ability: -0.4, note: "works everything out longhand" },
  { id: "erratic", medianSeconds: 24, sigma: 0.95, ability: 0.6, note: "stares, then bursts — stresses the ceiling" },
];

function itemLatencyMs(arch, req, rng) {
  const work = PHASE_WORK[req.phase] ?? 1;
  // A harder item takes longer. Item difficulty runs about [-2.2, +2.2] on the logit scale.
  const hard = clamp(1 + 0.22 * (req.difficulty + 0.8), 0.5, 2.2);
  let seconds = arch.medianSeconds * work * hard * lognormal(rng, arch.sigma);
  if (rng() < 0.08) seconds *= 2.4; // a long think
  return Math.round(clamp(seconds, 1.5, 420) * 1000);
}

/** Time between one item being answered and the next standing up: feedback, travel, the world. */
function gapMs(rng) {
  return Math.round(2500 + 3500 * rng());
}

// ------------------------------------------------------------------------------------- absence

/**
 * How often a learner LOOKS AWAY, and for how long.
 *
 * Round 1 of this script did not contain a single call to `noteAway()`, which meant the one
 * mechanism that makes this layer a Pomodoro rather than a timer — an absence past
 * `arc.breakMinutes` ending the sitting — was never once exercised. A 1440/1440 in-band result
 * measured with the break path switched off is not a measurement of this piece.
 *
 * Four profiles, and `attentive` is kept precisely so the two can be read against each other:
 *
 *   - `attentive` — p = 0. The round-1 measurement, and the control.
 *   - `alt-tab`   — 15% of items, 20–90 s. A notification, a sibling, a glance at a phone. Never
 *                   long enough to be a break, so this profile stresses the ARC (away time must be
 *                   excluded from the fifteen minutes) rather than the break rule.
 *   - `churn`     — 8% of items, 2–9 minutes. A classroom: somebody comes to the desk, the bell for
 *                   the corridor, a fire drill that turns out to be a test. This is the critic's
 *                   own gate, and roughly one gap in three here is past `breakMinutes`.
 *   - `break`     — 3% of items, 5–15 minutes. A real break, always past the threshold.
 *
 * Half of all absences land MID-ITEM — the claim is on the slab and the learner is not — because
 * that is the case with the two invariants attached to it: the response must not be counted as
 * evidence about pace, and the sitting must not end while the item is standing open.
 */
const AWAY_PROFILES = [
  { id: "attentive", p: 0, lo: 0, hi: 0, note: "nobody looks away — the control, and round 1's only arm" },
  { id: "alt-tab", p: 0.15, lo: 20, hi: 90, note: "15% of items, 20-90s — under the break threshold" },
  { id: "churn", p: 0.08, lo: 120, hi: 540, note: "8% of items, 2-9 min — a real classroom" },
  { id: "break", p: 0.03, lo: 300, hi: 900, note: "3% of items, 5-15 min — always a break" },
];

/** One absence, or none. Returns `{ ms, mid }`; `mid` means it lands with the claim standing open. */
function drawAway(away, rng) {
  if (!away.p || rng() >= away.p) return { ms: 0, mid: false };
  const ms = Math.round((away.lo + (away.hi - away.lo) * rng()) * 1000);
  return { ms, mid: rng() < 0.5 };
}

// ------------------------------------------------------------------------------------ the world

function makeWorld(seed, startMs) {
  const t = { ms: startMs };
  const graph = new Graph(graphSource);
  const clock = { minutes: () => t.ms / 60000, advance() {}, real: true };
  const mastery = new Mastery(graph, { now: () => t.ms / 60000, storage: null, emit: () => {}, bankAudit });
  const scheduler = new Scheduler(mastery, { clock, seed: seed ^ 0x5eed, sessionMinutes: 25 });
  const learning = {
    mastery,
    scheduler,
    graph,
    next: () => scheduler.next(),
    submit: (req, outcome) => scheduler.submit(req, outcome),
    beginSession: () => scheduler.beginSession(),
    endSession: () => scheduler.endSession(),
  };
  return { t, graph, mastery, scheduler, learning };
}

/** True/false for one item, from the archetype's ability and what the world gives away. */
function respond(world, arch, req, rng) {
  const base = 1 / (1 + Math.exp(-(arch.ability - req.difficulty)));
  const floor = world.mastery.trueGuess(req.kpId, req.form, req.phase);
  return rng() < base + (1 - base) * floor;
}

/** Any knowledge point holding a certification event that was started and not finished. */
function openEvents(world) {
  const out = [];
  for (const id of world.graph.ids) {
    const ev = world.mastery.eventOf(id);
    if (ev && ev.served > 0 && ev.served < ev.items) out.push({ kpId: id, ...ev });
  }
  return out;
}

// ---------------------------------------------------------------------------------------- arms

function runSessionArm(arch, seed, sessions, away = AWAY_PROFILES[0]) {
  const rng = mulberry32(seed);
  const world = makeWorld(seed, Date.UTC(2026, 1, 2, 16, 30, 0));
  const save = new Save({ storage: new MemoryStorage(), now: () => world.t.ms });
  save.load();
  const rows = [];
  /** Events left open at a sitting boundary, so the NEXT sitting can be checked for damage. */
  let carried = [];
  const faults = [];
  /** Every `learn:session` phase the layer emitted, counted. `break` is the one round 1 lacked. */
  const phases = new Map();
  const emit = (name, value) => {
    if (name === "learn:session") phases.set(value.phase, (phases.get(value.phase) ?? 0) + 1);
  };
  const make = () => new Session({ learning: world.learning, save, now: () => world.t.ms, emit });

  /**
   * ONE `Session` object stands for one page load. A sitting that ended on a break resumes on the
   * SAME object after the break — that is `work -> break -> work`, and it is the half round 1 did
   * not ship. Anything else is the learner coming back another day, which is a new page.
   */
  let session = null;
  let onThisPage = 0;
  const perPageLoad = [];

  for (let n = 0; n < sessions; n += 1) {
    let resumed = false;
    if (session && session.resumable) {
      // The break itself: five to twenty-five minutes away from the tab.
      world.t.ms += Math.round((5 + 20 * rng()) * 60000);
      session.resume("returned");
      resumed = true;
      onThisPage += 1;
    } else {
      if (session) perPageLoad.push(onThisPage);
      // Between page loads: a day, give or take. Enough for §3's 12-hour retention gate to open.
      world.t.ms += Math.round((20 + 8 * rng()) * 3600 * 1000);
      session = make();
      session.begin();
      onThisPage = 1;
    }
    const planAtOpen = session.plan;
    const openedAtMs = world.t.ms;
    let awayMs = 0;

    /**
     * A carried event must survive the boundary INTACT — still open, same served count, no lapse —
     * and that has to be checked HERE, before this sitting serves anything. Checking it at the end
     * of the next sitting conflates "abandoned by the boundary" with "resumed and then genuinely
     * failed", and a failed retention check is supposed to lapse. This is the whole difference
     * between carrying a check and abandoning one: `Scheduler.abandonEvent` lapses the node and
     * docks its M2 counters, a carry does neither.
     */
    for (const w of carried) {
      const now = world.mastery.eventOf(w.kpId);
      const st = world.mastery.stateOf(w.kpId);
      if (!now) faults.push(`${w.kpId} ${w.mode} event vanished across the boundary`);
      else if (now.served !== w.served) faults.push(`${w.kpId} served ${w.served} -> ${now.served} across the boundary`);
      if (st.lapses !== w.lapses) faults.push(`${w.kpId} lapses ${w.lapses} -> ${st.lapses} across the boundary`);
    }
    carried = [];

    for (let guard = 0; guard < 600; guard += 1) {
      const req = session.next();
      if (!req) break;
      const gap = drawAway(away, rng);
      // Mid-item: the claim is standing open and the learner is not at the tablet. The layer must
      // exclude this from pace AND must not end the sitting until the item is closed.
      if (gap.ms && gap.mid) {
        world.t.ms += gap.ms;
        session.noteAway(gap.ms);
        awayMs += gap.ms;
      }
      const latencyMs = itemLatencyMs(arch, req, rng);
      world.t.ms += latencyMs;
      session.submit(req, {
        correct: respond(world, arch, req, rng),
        // The REAL response time. Passing 0 here trips P16's anti-guessing latency floor on every
        // item — every correct answer is refused upward, nothing is ever certified, and the whole
        // simulation quietly degenerates into a learner who cannot learn. It cost an hour once.
        latencyMs,
        itemId: `${req.kpId}#${req.seq}`,
        hinted: req.hinted,
      });
      world.t.ms += gapMs(rng);
      if (gap.ms && !gap.mid) {
        world.t.ms += gap.ms;
        session.noteAway(gap.ms);
        awayMs += gap.ms;
      }
    }
    if (session.phase !== "closed") session.close("harness-guard");

    carried = openEvents(world).map((ev) => ({ ...ev, lapses: world.mastery.stateOf(ev.kpId).lapses }));

    const last = session.beats[session.beats.length - 1] ?? null;
    const adherence = session.probe().adherence;
    rows.push({
      n: n + 1,
      minutes: r2(session.elapsedSeconds / 60),
      // Unrounded, because the band check must not be decided by a rounding rule.
      minutesExact: session.elapsedSeconds / 60,
      /** Attended + away: how long the sitting occupied of the learner's afternoon. */
      wallMinutes: r2((world.t.ms - openedAtMs) / 60000),
      awayMinutes: r2(awayMs / 60000),
      resumed,
      sittingOnPage: onThisPage,
      matchRate: adherence.servedBeats ? adherence.matched / adherence.servedBeats : null,
      slowRatio: r2(session.pace.slowRatio),
      items: session.itemsServed,
      beats: session.beats.length,
      closeReason: session.closeReason,
      closingWin: session.closingWin,
      lastBeat: last ? `${last.kind}/${last.end}` : "none",
      // The two things that must be zero.
      midItem: session._servedAt != null,
      midEvent: openEvents(world).length > 0,
      plannedEvents: planAtOpen?.events ?? 0,
      plannedMinutes: planAtOpen?.minutes ?? 0,
      paceRatio: r2(session.pace.ratio),
      secondsPerItem: r2(session.itemSeconds()),
      certified: session.tally.certified.length,
      set: session.tally.set.length,
      level1: world.mastery.summary().level1Percent,
      adherence,
      startsOutsideCeiling: session.stats.startsOutsideCeiling,
      beatsClosedAtItem: session.stats.beatsClosedAtItem,
      eventsCarried: session.stats.eventsCarried,
      lapses: world.mastery.stats.lapses,
      provisional: world.mastery.summary().provisional,
      lines: { open: session.opening.map((l) => l.source), close: session.closing.map((l) => l.source) },
    });
  }
  if (session) perPageLoad.push(onThisPage);
  return { rows, save, world, faults, perPageLoad, phases };
}

function runBaselineArm(arch, seed, sessions) {
  const rng = mulberry32(seed);
  const world = makeWorld(seed, Date.UTC(2026, 1, 2, 16, 30, 0));
  const rows = [];

  for (let n = 0; n < sessions; n += 1) {
    world.t.ms += Math.round((20 + 8 * rng()) * 3600 * 1000);
    const startedAt = world.t.ms;
    world.scheduler.beginSession();
    let items = 0;
    let midItem = false;
    for (let guard = 0; guard < 600; guard += 1) {
      const req = world.scheduler.next();
      if (!req) break;
      const latencyMs = itemLatencyMs(arch, req, rng);
      world.t.ms += latencyMs;
      world.scheduler.submit(req, {
        correct: respond(world, arch, req, rng),
        latencyMs,
        itemId: `${req.kpId}#${req.seq}`,
        hinted: req.hinted,
      });
      world.t.ms += gapMs(rng);
      items += 1;
      midItem = false;
    }
    world.scheduler.endSession();
    const open = openEvents(world);
    rows.push({
      n: n + 1,
      minutes: r2((world.t.ms - startedAt) / 60000),
      minutesExact: (world.t.ms - startedAt) / 60000,
      items,
      closeReason: "engine-budget-spent",
      midItem,
      midEvent: open.length > 0,
      openEvent: open[0] ? `${open[0].kpId} ${open[0].mode} ${open[0].served}/${open[0].items}` : null,
      level1: world.mastery.summary().level1Percent,
    });
  }
  return { rows, world };
}

// ------------------------------------------------------------------------------------- reporting

function histogram(rows, key) {
  const m = new Map();
  for (const r of rows) m.set(r[key], (m.get(r[key]) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}
const showHist = (h) => h.map(([k, v]) => `${k}=${v}`).join("  ");

function bandCheck(rows) {
  const inside = (r) => r.minutesExact >= ARC.minMinutes && r.minutesExact <= ARC.maxMinutes;
  return {
    sessions: rows.length,
    inBand: rows.filter(inside).length,
    outOfBand: rows
      .filter((r) => !inside(r))
      .map((r) => ({ minutes: r.minutes, closeReason: r.closeReason, lastBeat: r.lastBeat, items: r.items })),
    midItem: rows.filter((r) => r.midItem).length,
    midEvent: rows.filter((r) => r.midEvent).length,
    startsOutsideCeiling: rows.reduce((a, r) => a + (r.startsOutsideCeiling ?? 0), 0),
    eventsCarried: rows.reduce((a, r) => a + (r.eventsCarried ?? 0), 0),
    overrunMinutes: rows.filter((r) => r.minutesExact > ARC.maxMinutes).map((r) => r2(r.minutesExact - ARC.maxMinutes)),
    ...stats(rows.map((r) => r.minutes)),
  };
}

const out = [];
const say = (s = "") => {
  out.push(s);
  console.log(s);
};

say("=".repeat(100));
say("P33 — Pomodoro session layer. Offline, real engine, no browser.");
say(`arc: ${ARC.minMinutes}-${ARC.maxMinutes} min, target ${ARC.targetMinutes}; ${SESSIONS} consecutive sittings per learner`);
say("=".repeat(100));

// ---- C1: the headline. Ten consecutive sittings, one seed, every archetype. -------------------

say("");
say("C1  TEN CONSECUTIVE SITTINGS, WALL-CLOCK MINUTES  (seed 1)");
say("");
say(
  "archetype    " +
    Array.from({ length: SESSIONS }, (_, i) => String(i + 1).padStart(5)).join("") +
    "   |  min   med   max  in-band  mid-claim  carried"
);
say("-".repeat(100));

const headline = {};
for (const arch of ARCHETYPES) {
  const { rows } = runSessionArm(arch, 1, SESSIONS);
  headline[arch.id] = rows;
  const c = bandCheck(rows);
  say(
    arch.id.padEnd(13) +
      rows.map((r) => r.minutes.toFixed(1).padStart(5)).join("") +
      `   | ${String(c.min).padStart(5)} ${String(c.median).padStart(5)} ${String(c.max).padStart(5)}` +
      `   ${c.inBand}/${c.sessions}` +
      `      ${c.midItem}          ${c.eventsCarried}`
  );
}

// ---- C2: the baseline the piece exists to replace ---------------------------------------------

say("");
say("C2  BASELINE — the shipped engine with no session layer (Scheduler.sessionMinutes = 25)");
say("    The box counts the DESIGN's seconds, which are the same for everybody, so the wall clock");
say("    lands wherever the learner's own speed puts it. \"events left open\" is the modelled budget");
say("    expiring part-way through a certification check — the engine resumes it, but the cut is");
say("    made by a clock that has never met this learner.");
say("");
say(
  "archetype    " +
    Array.from({ length: SESSIONS }, (_, i) => String(i + 1).padStart(5)).join("") +
    "   |  min   med   max  in-band  events left open"
);
say("-".repeat(100));

const baseline = {};
for (const arch of ARCHETYPES) {
  const { rows } = runBaselineArm(arch, 1, SESSIONS);
  baseline[arch.id] = rows;
  const c = bandCheck(rows);
  say(
    arch.id.padEnd(13) +
      rows.map((r) => r.minutes.toFixed(1).padStart(5)).join("") +
      `   | ${String(c.min).padStart(5)} ${String(c.median).padStart(5)} ${String(c.max).padStart(5)}` +
      `   ${c.inBand}/${c.sessions}` +
      `      ${c.midEvent}`
  );
}

// ---- C3: the distribution over seeds ----------------------------------------------------------

say("");
say(`C3  DISTRIBUTION — ${SEEDS} seeds x ${SESSIONS} sittings per archetype (${SEEDS * SESSIONS} sittings each)`);
say("");
say("archetype     sittings   min    p10    med    p90    max   in 15-25   mid-claim   carried   items/sitting  rho");
say("-".repeat(118));

const distribution = {};
let worstOut = [];
let totalMidItem = 0;
let totalMidEvent = 0;
let totalSittings = 0;
let totalStartsOutside = 0;
let totalCarried = 0;
let overruns = [];
const carryFaults = [];
for (const arch of ARCHETYPES) {
  const rows = [];
  for (let s = 1; s <= SEEDS; s += 1) {
    const run = runSessionArm(arch, s, SESSIONS);
    rows.push(...run.rows);
    carryFaults.push(...run.faults.map((f) => `${arch.id}/seed${s}: ${f}`));
  }
  const c = bandCheck(rows);
  distribution[arch.id] = c;
  totalMidItem += c.midItem;
  totalMidEvent += c.midEvent;
  totalSittings += c.sessions;
  totalStartsOutside += c.startsOutsideCeiling;
  totalCarried += c.eventsCarried;
  overruns.push(...c.overrunMinutes);
  worstOut.push(...c.outOfBand.map((o) => ({ arch: arch.id, ...o })));
  const items = stats(rows.map((r) => r.items));
  const rho = stats(rows.map((r) => r.paceRatio));
  say(
    arch.id.padEnd(12) +
      String(c.sessions).padStart(8) +
      String(c.min).padStart(7) +
      String(c.p10).padStart(7) +
      String(c.median).padStart(7) +
      String(c.p90).padStart(7) +
      String(c.max).padStart(7) +
      `   ${c.inBand}/${c.sessions}`.padStart(11) +
      String(c.midItem).padStart(12) +
      String(c.eventsCarried).padStart(10) +
      String(items.median).padStart(15) +
      String(rho.median).padStart(6)
  );
}

// ---- C4: what a fast learner actually gets for their twenty minutes ---------------------------

say("");
say("C4  SAME TWENTY MINUTES, DIFFERENT AMOUNT OF WORK — items served per sitting, session arm");
say("    (this is the requirement: a student who works fast gets MORE done, not cut off earlier)");
say("");
say("archetype     median items   median minutes   items/minute   baseline items   baseline minutes");
say("-".repeat(100));
for (const arch of ARCHETYPES) {
  const s = headline[arch.id];
  const b = baseline[arch.id];
  const si = stats(s.map((r) => r.items));
  const sm = stats(s.map((r) => r.minutes));
  const bi = stats(b.map((r) => r.items));
  const bm = stats(b.map((r) => r.minutes));
  say(
    arch.id.padEnd(12) +
      String(si.median).padStart(14) +
      String(sm.median).padStart(17) +
      String(r2(si.median / sm.median)).padStart(15) +
      String(bi.median).padStart(17) +
      String(bm.median).padStart(19)
  );
}

// ---- C5: how sittings end ----------------------------------------------------------------------

say("");
say("C5  HOW A SITTING ENDS — every close reason, every last-beat outcome, session arm, C3 corpus");
say("");
const reasons = new Map();
const lastBeats = new Map();
const wins = new Map();
for (const arch of ARCHETYPES) {
  for (let s = 1; s <= Math.min(SEEDS, 8); s += 1) {
    for (const r of runSessionArm(arch, s, SESSIONS).rows) {
      reasons.set(r.closeReason, (reasons.get(r.closeReason) ?? 0) + 1);
      lastBeats.set(r.lastBeat, (lastBeats.get(r.lastBeat) ?? 0) + 1);
      wins.set(r.closingWin, (wins.get(r.closingWin) ?? 0) + 1);
    }
  }
}
say("close reason        " + [...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join("  "));
say("last beat kind/end  " + [...lastBeats.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join("  "));
say("closing win         " + [...wins.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join("  "));

// ---- C10: the break. The mechanism that makes this a Pomodoro, measured for the first time. ----

say("");
say(`C10 ABSENCE AND THE BREAK — ${AWAY_PROFILES.length} profiles x ${ARCHETYPES.length} archetypes x ${SEEDS} seeds x ${SESSIONS} sittings`);
say("    Round 1 of this script called noteAway() exactly zero times, so the break rule — the only");
say("    thing that makes this layer a Pomodoro rather than a timer — was never exercised. These are");
say("    the numbers it was missing. The band is on ATTENDED minutes, because away time is not");
say("    session time; the wall-clock span is printed beside it so the two are never confused.");
say("");
for (const p of AWAY_PROFILES) say(`    ${p.id.padEnd(10)} ${p.note}`);
say("");
say("profile     archetype     sittings   min    med    max   in 15-25   mid-claim   attended  wall  away   sittings/page");
say("-".repeat(122));

const awayRuns = {};
const awayTotals = { sittings: 0, inBand: 0, midItem: 0, midEvent: 0, startsOutside: 0, overruns: [] };
for (const profile of AWAY_PROFILES) {
  const perProfile = [];
  const pages = [];
  const phaseTotals = new Map();
  for (const arch of ARCHETYPES) {
    const rows = [];
    for (let s = 1; s <= SEEDS; s += 1) {
      const run = runSessionArm(arch, s, SESSIONS, profile);
      rows.push(...run.rows);
      pages.push(...run.perPageLoad);
      for (const [k, v] of run.phases) phaseTotals.set(k, (phaseTotals.get(k) ?? 0) + v);
    }
    const c = bandCheck(rows);
    perProfile.push(...rows);
    const wall = stats(rows.map((r) => r.wallMinutes));
    const awayS = stats(rows.map((r) => r.awayMinutes));
    const onPage = stats(rows.map((r) => r.sittingOnPage));
    say(
      profile.id.padEnd(12) +
        arch.id.padEnd(12) +
        String(c.sessions).padStart(9) +
        String(c.min).padStart(7) +
        String(c.median).padStart(7) +
        String(c.max).padStart(7) +
        `   ${c.inBand}/${c.sessions}`.padStart(12) +
        String(c.midItem).padStart(12) +
        String(c.median).padStart(11) +
        String(wall.median).padStart(6) +
        String(awayS.median).padStart(6) +
        String(onPage.max).padStart(15)
    );
  }
  const c = bandCheck(perProfile);
  awayRuns[profile.id] = { band: c, rows: perProfile, pages, phases: phaseTotals };
  awayTotals.sittings += c.sessions;
  awayTotals.inBand += c.inBand;
  awayTotals.midItem += c.midItem;
  awayTotals.midEvent += c.midEvent;
  awayTotals.startsOutside += c.startsOutsideCeiling;
  awayTotals.overruns.push(...c.overrunMinutes);
  say("-".repeat(122));
  say(
    `${profile.id.padEnd(12)}ALL         ${String(c.sessions).padStart(9)}${String(c.min).padStart(7)}` +
      `${String(c.median).padStart(7)}${String(c.max).padStart(7)}   ${c.inBand}/${c.sessions}` +
      `   (${r2((100 * c.inBand) / c.sessions)}%)`
  );
  say("");
}

say("C10b CLOSE REASONS, PER PROFILE — 'break' is the sitting ending because the learner took one");
say("");
for (const profile of AWAY_PROFILES) {
  const rows = awayRuns[profile.id].rows;
  say(`  ${profile.id.padEnd(11)}${showHist(histogram(rows, "closeReason"))}`);
}
say("");
say("C10c THE CYCLE — work -> break -> work, per page load. A break must not be a terminus.");
say("     'break signals' is learn:session {phase:\"break\"}; 'resumed' is a sitting opened by");
say("     Session.resume() on the SAME object, which is the second work half of the cycle.");
say("");
say("profile      break closes   break signals   resumed sittings   sittings per page load: med / max");
say("-".repeat(104));
for (const profile of AWAY_PROFILES) {
  const { rows, pages, phases } = awayRuns[profile.id];
  const breaks = rows.filter((r) => r.closeReason === "break").length;
  const resumedRows = rows.filter((r) => r.resumed).length;
  const pg = stats(pages);
  say(
    profile.id.padEnd(13) +
      String(breaks).padStart(12) +
      String(phases.get("break") ?? 0).padStart(16) +
      String(resumedRows).padStart(19) +
      `${pg.median} / ${pg.max}`.padStart(35)
  );
}

// ---- C11: the forecast, against reality --------------------------------------------------------

say("");
say("C11 DOES THE FORECAST DESCRIBE WHAT THE ENGINE SERVES?");
say("    `candidates()` is a model of §4's own order: the due-time queue, then the frontier score");
say("    with the same five terms and the same two-open cap. Round 1 ordered it by a leverage table");
say("    of this layer's own invention that the engine had no way to hear, and — worse — ENDED over");
say("    half of all sittings on it. The table is gone and nothing ends a sitting on a forecast now.");
say("");
say("    Two horizons, and only one of them is a real test.");
say("      NEXT BEAT  — at every beat boundary the live plan names what should come next, and the");
say("                   engine is then asked. This is falsifiable and it is the number to read.");
say("      WHOLE SITTING — the multiset of every beat forecast at the door against every beat");
say("                   served. A sprinter's sitting is thirty beats and each acquisition block");
say("                   moves the frontier score of the node it ran on, so the identity of beat 24");
say("                   is not knowable at beat 1. Reported anyway, because deleting an");
say("                   unflattering number is how a claim rots — but it never decided anything.");
say("      SIZE       — planned minutes at the door against actual. The size IS what this layer");
say("                   decides, so this is the forecast that has to be good.");
say("");
say("archetype     next-beat hits   next-beat rate   whole-sitting match   planned min   actual min   size err");
say("-".repeat(110));
let adherenceNext = 0;
let adherenceWhole = 0;
let sizeErrMedian = 0;
{
  let allCalled = 0;
  let allHit = 0;
  let allServed = 0;
  let allMatched = 0;
  const allSizeErr = [];
  for (const arch of ARCHETYPES) {
    const rows = [];
    for (let s = 1; s <= Math.min(SEEDS, 8); s += 1) rows.push(...runSessionArm(arch, s, SESSIONS).rows);
    const called = rows.reduce((a, r) => a + r.adherence.nextBeatCalled, 0);
    const hit = rows.reduce((a, r) => a + r.adherence.nextBeatHit, 0);
    const served = rows.reduce((a, r) => a + r.adherence.servedBeats, 0);
    const matched = rows.reduce((a, r) => a + r.adherence.matched, 0);
    const pm = stats(rows.map((r) => r.plannedMinutes));
    const am = stats(rows.map((r) => r.minutes));
    const err = rows.map((r) => Math.abs(r.plannedMinutes - r.minutes));
    allCalled += called;
    allHit += hit;
    allServed += served;
    allMatched += matched;
    allSizeErr.push(...err);
    say(
      arch.id.padEnd(12) +
        `${hit}/${called}`.padStart(15) +
        String(r2(hit / Math.max(1, called))).padStart(17) +
        String(r2(matched / Math.max(1, served))).padStart(22) +
        String(pm.median).padStart(14) +
        String(am.median).padStart(13) +
        String(stats(err).median).padStart(11)
    );
  }
  say("-".repeat(110));
  adherenceNext = allHit / Math.max(1, allCalled);
  adherenceWhole = allMatched / Math.max(1, allServed);
  sizeErrMedian = stats(allSizeErr).median;
  say(
    "ALL".padEnd(12) +
      `${allHit}/${allCalled}`.padStart(15) +
      String(r2(adherenceNext)).padStart(17) +
      String(r2(adherenceWhole)).padStart(22) +
      "".padStart(14) +
      "".padStart(13) +
      String(sizeErrMedian).padStart(11)
  );
}

// ---- C5b: does the arc still teach? -----------------------------------------------------------

say("");
say("C9  THE ARC MUST NOT COST LEARNING — Level 1 mastered % after 10 sittings, same learner, both arms");
say("    Read the HOURS column first. The baseline reaches more of Level 1 for a slow learner only by");
say("    spending seven and a half hours on ten sittings. Mastery per hour of attention is the number.");
say("");
say("archetype   |  session arm: mastered%  hours  %/hour  items  certs  |  baseline: mastered%  hours  %/hour  items");
say("-".repeat(112));
for (const arch of ARCHETYPES) {
  const s10 = headline[arch.id];
  const b10 = baseline[arch.id];
  const certs = s10.reduce((a, r) => a + r.certified, 0);
  const sh = s10.reduce((a, r) => a + r.minutesExact, 0) / 60;
  const bh = b10.reduce((a, r) => a + r.minutesExact, 0) / 60;
  say(
    arch.id.padEnd(12) +
      "|" +
      String(s10[s10.length - 1].level1).padStart(24) +
      String(r2(sh)).padStart(7) +
      String(r2(s10[s10.length - 1].level1 / sh)).padStart(8) +
      String(s10.reduce((a, r) => a + r.items, 0)).padStart(7) +
      String(certs).padStart(7) +
      "  |" +
      String(b10[b10.length - 1].level1).padStart(21) +
      String(r2(bh)).padStart(7) +
      String(r2(b10[b10.length - 1].level1 / bh)).padStart(8) +
      String(b10.reduce((a, r) => a + r.items, 0)).padStart(7)
  );
}

// ---- C6: Save — corrupt, absent, interrupted ---------------------------------------------------

say("");
say("C6  SAVE — absent, corrupt, wrong version, interrupted, and a denied store");
say("");
const saveChecks = [];
{
  const store = new MemoryStorage();
  saveChecks.push(["absent", new Save({ storage: store }).load().fault === "absent"]);

  store.setItem("vs.flow.save.v1", "{not json at all");
  const s2 = new Save({ storage: store });
  const r2res = s2.load();
  saveChecks.push(["corrupt-json reported", r2res.fault === "corrupt-json"]);
  saveChecks.push(["corrupt body quarantined", store.getItem("vs.flow.save.v1.corrupt") !== null]);
  saveChecks.push(["usable state after corruption", s2.state.sessions.length === 0 && s2.state.pace.ratio === 1]);

  store.setItem("vs.flow.save.v1", JSON.stringify({ version: 99, pace: { ratio: 0.4 } }));
  saveChecks.push(["wrong version reported", new Save({ storage: store }).load().fault?.startsWith("wrong-version")]);

  // Present-and-wrong is damage and is named. Absent is an older build and is not.
  store.setItem("vs.flow.save.v1", JSON.stringify({ version: 1, pace: { ratio: "fast", samples: 12 }, sessions: "no" }));
  const s4 = new Save({ storage: store });
  const r4 = s4.load();
  saveChecks.push([
    `bad fields repaired and named (${r4.repaired.join(",") || "none"})`,
    r4.fault === "repaired" &&
      r4.repaired.length === 2 &&
      r4.repaired.includes("pace.ratio") &&
      r4.repaired.includes("sessions") &&
      s4.state.pace.samples === 12,
  ]);

  // A sitting that was opened and never closed.
  const store2 = new MemoryStorage();
  const s5 = new Save({ storage: store2 });
  s5.load();
  s5.openSession({ number: 7, plannedItems: 30 });
  const s6 = new Save({ storage: store2 });
  const r6 = s6.load();
  saveChecks.push(["interrupted sitting recovered", r6.interrupted?.number === 7]);
  saveChecks.push(["interrupted sitting closed, not resumed", s6.state.live === null && s6.state.sessions.length === 1]);
  saveChecks.push(["interrupted counted", s6.state.counters.interrupted === 1]);

  const denied = new Save({ storage: null });
  saveChecks.push(["storage denied is honest, not fatal", denied.load().fault === "storage-unavailable"]);
}
for (const [name, ok] of saveChecks) say(`  ${ok ? "PASS" : "FAIL"}  ${name}`);

// ---- C7: pace carries between sittings ---------------------------------------------------------

say("");
say("C7  PACE CARRIES — a learner does not get re-measured from the design's seconds every sitting");
say("");
say("archetype     sitting 1 minutes   sitting 1 rho   sitting 2 rho   sitting 10 rho   true seconds/solo item");
say("-".repeat(104));
for (const arch of ARCHETYPES) {
  const rows = headline[arch.id];
  say(
    arch.id.padEnd(12) +
      String(rows[0].minutes).padStart(19) +
      String(rows[0].paceRatio).padStart(16) +
      String(rows[1]?.paceRatio ?? "-").padStart(16) +
      String(rows[rows.length - 1].paceRatio).padStart(17) +
      String(arch.medianSeconds).padStart(24)
  );
}

// ---- C8: the voice --------------------------------------------------------------------------

say("");
say("C8  WHAT THE SITTING SAYS  (EN source for keys P20 has not been handed yet)");
say("");
{
  const rows = headline.steady;
  const open = rows[rows.length - 1].lines.open;
  const close = rows[rows.length - 1].lines.close;
  for (const l of open) say(`  open   "${l}"   ${l.split(/\s+/).length}w ${l.length}c`);
  for (const l of close) say(`  close  "${l}"   ${l.split(/\s+/).length}w ${l.length}c`);
  const all = Object.values(
    // every line the layer can produce, checked against design/voice.md §7: sys.* is 7 words, 44 chars
    (await import("../../app/src/flow/Session.js")).VOICE
  );
  const overWords = all.filter((s) => s.replace(/\{\w+\}/g, "8").split(/\s+/).length > 7);
  const overChars = all.filter((s) => s.replace(/\{\w+\}/g, "8").length > 44);
  const secondPerson = all.filter((s) => /\byou\b|\byour\b/i.test(s));
  const exclaims = all.filter((s) => s.includes("!"));
  const banned = all.filter((s) =>
    /\b(problem|question|exercise|answer|solution|correct|incorrect|right|wrong|lesson|tutorial|practice|study|homework|drill|score|points|streak|hint|student|player|user|math|equation|algebra|great|well done|good job)\b/i.test(s)
  );
  say("");
  say(`  ${all.length} lines; over 7 words: ${overWords.length}; over 44 chars: ${overChars.length}; ` +
      `second person: ${secondPerson.length}; exclamations: ${exclaims.length}; banned vocabulary: ${banned.length}`);
  if (overWords.length) say(`  OVER WORDS: ${overWords.join(" | ")}`);
  if (overChars.length) say(`  OVER CHARS: ${overChars.join(" | ")}`);
  if (banned.length) say(`  BANNED: ${banned.join(" | ")}`);
  saveChecks.push(["voice caps hold", !overWords.length && !overChars.length && !secondPerson.length && !exclaims.length && !banned.length]);
}

// ---- verdict ------------------------------------------------------------------------------------

say("");
say("=".repeat(100));
const inBandShare = (totalSittings - worstOut.length) / totalSittings;
const claims = [
  [
    "C1/C3  every sitting lands in 15-25 minutes",
    worstOut.length === 0,
    `${totalSittings - worstOut.length}/${totalSittings} in band`,
  ],
  [
    "C1/C3  nothing is STARTED that is not expected to finish inside 25",
    totalStartsOutside === 0,
    `${totalStartsOutside} of ${totalSittings} sittings served an item outside the ceiling estimate`,
  ],
  [
    "C1/C3  the residual is a single long response, never the layer",
    inBandShare >= 0.99 && (overruns.length === 0 || Math.max(...overruns) < 1),
    overruns.length ? `${overruns.length} overrun(s), worst ${Math.max(...overruns)} min` : "no overruns",
  ],
  ["C1/C3  no sitting ends mid-problem", totalMidItem === 0, `${totalMidItem} of ${totalSittings}`],
  [
    "C1/C3  a certification event is CARRIED across the boundary, never abandoned",
    carryFaults.length === 0,
    `${totalCarried} carried of ${totalSittings} sittings; ${carryFaults.length} faults` +
      (carryFaults.length ? ` -> ${carryFaults.slice(0, 4).join("; ")}` : ""),
  ],
  [
    "C2     the baseline it replaces does NOT",
    Object.values(baseline).some((rows) => rows.some((r) => r.minutesExact < ARC.minMinutes || r.minutesExact > ARC.maxMinutes)),
    "a control that never fails is measuring nothing",
  ],
  [
    "C10    the band holds when the learner LOOKS AWAY, every profile",
    AWAY_PROFILES.every((p) => awayRuns[p.id].band.inBand / awayRuns[p.id].band.sessions >= 0.99),
    AWAY_PROFILES.map((p) => `${p.id} ${awayRuns[p.id].band.inBand}/${awayRuns[p.id].band.sessions}`).join("; "),
  ],
  [
    "C10    classroom churn (p=0.08, 2-9 min gaps) holds at >=99%",
    awayRuns.churn.band.inBand / awayRuns.churn.band.sessions >= 0.99,
    `${awayRuns.churn.band.inBand}/${awayRuns.churn.band.sessions} = ` +
      `${r2((100 * awayRuns.churn.band.inBand) / awayRuns.churn.band.sessions)}%`,
  ],
  [
    "C10    no sitting ends mid-problem WITH absences, including mid-item ones",
    awayTotals.midItem === 0,
    `${awayTotals.midItem} of ${awayTotals.sittings} across all profiles`,
  ],
  [
    "C10    a break ENDS a sitting — and only at or past the fifteen-minute floor",
    awayRuns.break.rows.some((r) => r.closeReason === "break") &&
      !awayRuns.break.rows.some((r) => r.closeReason === "break" && r.minutesExact < ARC.minMinutes) &&
      !awayRuns.churn.rows.some((r) => r.closeReason === "break" && r.minutesExact < ARC.minMinutes),
    `break closes: churn ${awayRuns.churn.rows.filter((r) => r.closeReason === "break").length}, ` +
      `break ${awayRuns.break.rows.filter((r) => r.closeReason === "break").length}; ` +
      `earliest ${r2(Math.min(...awayRuns.break.rows.filter((r) => r.closeReason === "break").map((r) => r.minutesExact), Infinity))} min`,
  ],
  [
    "C10c   a break is a HINGE — the next sitting opens on the same page load",
    awayRuns.break.rows.some((r) => r.resumed) && (awayRuns.break.phases.get("break") ?? 0) > 0,
    `${awayRuns.break.rows.filter((r) => r.resumed).length} resumed sittings; ` +
      `${awayRuns.break.phases.get("break") ?? 0} learn:session{phase:"break"} signals; ` +
      `max sittings per page load ${stats(awayRuns.break.pages).max}`,
  ],
  [
    "C11    the live forecast names the beat the engine serves next",
    adherenceNext >= 0.8,
    `${r2(100 * adherenceNext)}% of beat boundaries; whole-sitting multiset ${r2(100 * adherenceWhole)}% ` +
      `(reported, never used); median size error ${sizeErrMedian} min`,
  ],
  ["C6     a bad save is reported, never silently reset", saveChecks.every(([, ok]) => ok), ""],
];
for (const [name, ok, note] of claims) say(`${ok ? "PASS" : "FAIL"}  ${name}${note ? `   (${note})` : ""}`);
if (worstOut.length)
  say(
    `      out-of-band sittings: ${worstOut
      .slice(0, 20)
      .map((w) => `${w.arch} ${w.minutes}min close=${w.closeReason} lastBeat=${w.lastBeat} items=${w.items}`)
      .join("; ")}`
  );
say("=".repeat(100));

const failed = claims.filter(([, ok]) => !ok);
writeFileSync(resolve(root, "review/measure/P33.txt"), out.join("\n") + "\n");
if (JSON_OUT) writeFileSync(resolve(root, JSON_OUT), JSON.stringify({ headline, baseline, distribution, claims }, null, 1));
process.exit(failed.length ? 1 : 0);
