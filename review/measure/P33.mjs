/**
 * P33 — the Pomodoro session layer, measured offline.
 *
 *   node review/measure/P33.mjs                       # headline: 10 consecutive sittings each
 *   node review/measure/P33.mjs --seeds=16            # the distribution
 *   node review/measure/P33.mjs --json=review/measure/P33.json
 *
 * NO BROWSER. A human is playtesting on this machine and a headless SwiftShader capture would
 * steal CPU from them for a claim that has nothing to do with pixels. The session arc is
 * arithmetic over the real engine — `learn/Mastery.js`, `learn/Scheduler.js`, `learn/ItemBank.js`
 * and `flow/Session.js` are imported and run exactly as `app/src/boot/*` assembles them — so it is
 * provable in Node and it is proved here.
 *
 * =============================================================================================
 * ROUND 3 — THE DEFECT THAT INVALIDATED EVERY NUMBER THIS SCRIPT PRINTED
 * =============================================================================================
 *
 * A critic ran 350 independent sittings against round 2 and found this:
 *
 *   > All 4,698 beats were `acquire` blocks — 0 consolidate, 0 retention, 0 review, 0
 *   > certifications — and every sitting served exactly 1 distinct knowledge point
 *   > (`var-meaning`) at every ability level from -1.5 to +2.5. The piece's own currency never
 *   > occurs. Every gate about atomic events, carried checks and the retention window therefore
 *   > passes vacuously.
 *
 * That is exactly right, and the cause was in THIS FILE rather than in `flow/Session.js`.
 *
 * `Mastery` will not score a response whose generator family it was not told, on any cell that has
 * a family the bank audit refuses — 24 of the bank's 96 (kp x form) cells do, and on those an
 * unreported family cannot be told apart from a memorised-answer one (`Mastery.UNREPORTED_FAMILY`).
 * Round 2 of this script called `scheduler.submit(req, { correct, latencyMs, itemId, hinted })`
 * with **no `family` and no picker**, so 91% of responses came back
 * `unscored-unreported-family`, no M2 counter ever moved, no node ever certified, and the frontier
 * never left its first node. Measured on this machine before the fix: 33 items on `var-meaning`,
 * 3 scored, 30 refused, `gateOpens: 0`.
 *
 * **A proof harness that drives the engine differently from the way a presenter must drive it is
 * not measuring the game.** The fix is one line and it is the SHIPPED line: `boot/63-learnserve.js`
 * calls `Scheduler.attachBank(itemBank)`, which makes the Scheduler draw every item through
 * `serve()` itself and publish it as `req.item` / `req.family`. `makeWorld()` below constructs the
 * Scheduler the same way the boot module does, and `--delivery=none` reproduces round 2's broken
 * wiring on purpose as a CONTROL — see C5.
 *
 * What the same corpus looks like on either side of that one line, sprinter archetype, 12 sittings:
 *
 *                        round 2 (no bank)      round 3 (bank attached)
 *   distinct kps/sitting          1                     13 - 31
 *   beat kinds                    acquire only          acquire/consolidate/retention/review
 *   certifications                0                     30
 *   Level 1 mastered              0%                    93.75%
 *
 * =============================================================================================
 * THE THREE ARMS
 * =============================================================================================
 *
 * `baseline` is the shipped engine driven the only way it can be driven without this piece:
 * `Scheduler.beginSession()`, then `next()`/`submit()` until `next()` returns null, with
 * `sessionMinutes` at its constructor default of 25. Its time box counts
 * `phases.secondsPerItemByPhase`, which is a **pricing** contract (a 22-second demonstration must
 * not cost what a 46-second solo item costs) and which is identical for every learner. So every
 * learner gets the same item count and the wall clock lands wherever their own speed puts it.
 *
 * `session` is the same engine with `flow/Session.js` in front of it.
 *
 * `starved` is the same engine with the bank DETACHED — round 2's delivery, kept as a control for
 * the same reason C2 keeps the baseline: a gate that can never fail is measuring nothing. The
 * breadth gates in C5 must fail on this arm and pass on the session arm, and the `starved` signal
 * `flow/Session.js` emits must fire here and never there.
 *
 * =============================================================================================
 * THE RESPONSE MODEL IS NOT THE BUDGET MODEL — THIS IS THE POINT
 * =============================================================================================
 *
 * `Session.js` estimates one number per learner: ρ, the ratio between the seconds an item actually
 * took and the seconds `phases.secondsPerItemByPhase` prices it at. If this simulation generated
 * latencies as `ρ_true x secondsPerItemByPhase[phase]`, ρ would be recoverable by construction and
 * the measurement would be the assumption wearing a number — the exact defect `RESUME.md` §7
 * records against the first guessing-bot proof.
 *
 * So the simulated learner's time comes from a DIFFERENT shape: a per-archetype median, a
 * lognormal spread, a difficulty term, and a per-phase work factor that is deliberately not
 * proportional to the design's table (a hint-idling `guided-3` item is the LONGEST thing a
 * simulated learner does, where the design prices it the same as `solo`). ρ is therefore genuinely
 * estimated from a mixture the estimator was never told about.
 *
 * And one archetype is not lognormal at all. All six of round 2's archetypes were unimodal, so no
 * sitting in that corpus COULD overrun and the ceiling claim was never stressed. `bimodal` answers
 * in 12 s most of the time and in 260 s the rest — 22% of items — which is a learner who reads the
 * claim, walks away from the tablet, and comes back to it. That shape is what the ceiling
 * reservation exists for, and C1/C3 now measure it instead of assuming it away.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { Graph } from "../../app/src/learn/Graph.js";
import { Mastery } from "../../app/src/learn/Mastery.js";
import { Scheduler } from "../../app/src/learn/Scheduler.js";
import { itemBank } from "../../app/src/learn/ItemBank.js";
import { Session, ARC, STARVE_REPS } from "../../app/src/flow/Session.js";
import { Save } from "../../app/src/flow/Save.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const readJson = (p) => JSON.parse(readFileSync(resolve(root, p), "utf8"));

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? dflt : hit.split("=").slice(1).join("=");
};
const SESSIONS = Number(arg("sessions", 10));
const SEEDS = Number(arg("seeds", 8));
const JSON_OUT = arg("json", null);

const graphSource = readJson("content/knowledge-graph.json");
const bankAudit = readJson("app/src/learn/bank-audit.json");

/**
 * The bank is warmed once, exactly as `boot/62-itembank.js` warms it before a sitting opens.
 * `ItemBank.select()` is synchronous and degrades to the generator when a group is cold, so a cold
 * bank would quietly measure the generator half of the catalogue and call it the game.
 */
await itemBank.ensure(new Graph(graphSource).ids);

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

/**
 * `heavy` is the round-3 addition and it is the only non-lognormal shape here. A bimodal learner
 * spends `heavy.p` of their items at `heavy.seconds` instead of at `medianSeconds`: they read the
 * claim, put the tablet down, and come back to it. Nothing about a variance can see that — an EWMA
 * spread barely moves on a mode that is rare — which is exactly why `Session.itemSecondsCeiling`
 * reserves on an OBSERVED upper quantile (`pace.slowRatio`) as well as on moments, and why that
 * decision was previously untested: all six unimodal archetypes could reach the ceiling only by
 * accident.
 */
const ARCHETYPES = [
  { id: "sprinter", medianSeconds: 9, sigma: 0.35, ability: 1.4, note: "answers fast and is usually right" },
  { id: "quick", medianSeconds: 16, sigma: 0.4, ability: 1.0, note: "" },
  { id: "steady", medianSeconds: 26, sigma: 0.45, ability: 0.5, note: "" },
  { id: "deliberate", medianSeconds: 44, sigma: 0.5, ability: 0.0, note: "" },
  { id: "slow", medianSeconds: 68, sigma: 0.55, ability: -0.4, note: "works everything out longhand" },
  { id: "erratic", medianSeconds: 24, sigma: 0.95, ability: 0.6, note: "stares, then bursts — stresses the ceiling" },
  {
    id: "bimodal",
    medianSeconds: 12,
    sigma: 0.3,
    ability: 0.3,
    heavy: { p: 0.22, seconds: 260, sigma: 0.35 },
    note: "12s or 260s, p=0.22 — a heavy tail no variance can see. THE ceiling stress case.",
  },
];

function itemLatencyMs(arch, req, rng) {
  const work = PHASE_WORK[req.phase] ?? 1;
  // A harder item takes longer. Item difficulty runs about [-2.2, +2.2] on the logit scale.
  const hard = clamp(1 + 0.22 * (req.difficulty + 0.8), 0.5, 2.2);
  const heavy = arch.heavy && rng() < arch.heavy.p;
  const centre = heavy ? arch.heavy.seconds : arch.medianSeconds;
  const sigma = heavy ? arch.heavy.sigma : arch.sigma;
  let seconds = centre * work * hard * lognormal(rng, sigma);
  if (!heavy && rng() < 0.08) seconds *= 2.4; // a long think
  return Math.round(clamp(seconds, 1.5, 600) * 1000);
}

/** Time between one item being answered and the next standing up: feedback, travel, the world. */
function gapMs(rng) {
  return Math.round(2500 + 3500 * rng());
}

// ------------------------------------------------------------------------------------- absence

/**
 * How often a learner LOOKS AWAY, and for how long.
 *
 * Four profiles, and `attentive` is kept precisely so the two can be read against each other:
 *
 *   - `attentive` — p = 0. The control.
 *   - `alt-tab`   — 15% of items, 20–90 s. A notification, a sibling, a glance at a phone. Never
 *                   long enough to be a break, so this profile stresses the ARC (away time must be
 *                   excluded from the fifteen minutes) rather than the break rule.
 *   - `churn`     — 8% of items, 2–9 minutes. A classroom: somebody comes to the desk, the bell for
 *                   the corridor, a fire drill that turns out to be a test. Roughly one gap in
 *                   three here is past `breakMinutes`.
 *   - `break`     — 3% of items, 5–15 minutes. A real break, always past the threshold.
 *
 * Half of all absences land MID-ITEM — the claim is on the slab and the learner is not — because
 * that is the case with the two invariants attached to it: the response must not be counted as
 * evidence about pace, and the sitting must not end while the item is standing open.
 */
const AWAY_PROFILES = [
  { id: "attentive", p: 0, lo: 0, hi: 0, note: "nobody looks away — the control" },
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

/**
 * Assemble the engine EXACTLY as `app/src/boot/62-learning.js` + `boot/63-learnserve.js` do.
 *
 * `bank` is the whole argument of this round. With it the Scheduler draws every item through
 * `serve()`, honours `avoidFamilies`, publishes `req.item` / `req.family`, and tells `Mastery` the
 * family is reported — which is what makes 24 of the 96 cells scoreable at all. Without it the
 * engine is in round 2's delivery, and `--delivery=none` / the `starved` arm keeps that reachable
 * on purpose, as the control C5's breadth gates are measured against.
 */
function makeWorld(seed, startMs, { bank = itemBank, source = graphSource } = {}) {
  const t = { ms: startMs };
  const graph = new Graph(source);
  const clock = { minutes: () => t.ms / 60000, advance() {}, real: true };
  const mastery = new Mastery(graph, { now: () => t.ms / 60000, storage: null, emit: () => {}, bankAudit });
  const scheduler = new Scheduler(mastery, { clock, seed: seed ^ 0x5eed, sessionMinutes: 25, bank });
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

/**
 * The outcome a PRESENTER is contractually obliged to report. `itemId` and `family` come off the
 * request the Scheduler already drew — this is the shipped contract, not a courtesy: see the
 * ROUND 3 note at the top and `Scheduler.submit`'s `family` parameter.
 */
function outcomeFor(world, arch, req, rng, latencyMs) {
  return {
    correct: respond(world, arch, req, rng),
    // The REAL response time. Passing 0 here trips P16's anti-guessing latency floor on every
    // item — every correct answer is refused upward, nothing is ever certified, and the whole
    // simulation quietly degenerates into a learner who cannot learn. It cost an hour once.
    latencyMs,
    itemId: req.itemId ?? `${req.kpId}#${req.seq}`,
    family: req.family ?? undefined,
    hinted: req.hinted,
  };
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

function runSessionArm(arch, seed, sessions, away = AWAY_PROFILES[0], { bank = itemBank, source = graphSource } = {}) {
  const rng = mulberry32(seed);
  const world = makeWorld(seed, Date.UTC(2026, 1, 2, 16, 30, 0), { bank, source });
  const save = new Save({ storage: new MemoryStorage(), now: () => world.t.ms });
  save.load();
  const rows = [];
  /** Events left open at a sitting boundary, so the NEXT sitting can be checked for damage. */
  let carried = [];
  const faults = [];
  /** Every `learn:session` phase the layer emitted, counted. */
  const phases = new Map();
  /** Every `starved` signal, with its payload — the breadth alarm, C5's control. */
  const starvedSignals = [];
  const emit = (name, value) => {
    if (name !== "learn:session") return;
    phases.set(value.phase, (phases.get(value.phase) ?? 0) + 1);
    if (value.phase === "starved") starvedSignals.push(value.summary);
  };
  const make = () => new Session({ learning: world.learning, save, now: () => world.t.ms, emit });

  /**
   * ONE `Session` object stands for one page load. A sitting that ended on a break resumes on the
   * SAME object after the break — that is `work -> break -> work`. Anything else is the learner
   * coming back another day, which is a new page.
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
    const certsBefore = world.mastery.stats.certifications;
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
      session.submit(req, outcomeFor(world, arch, req, rng, latencyMs));
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
    const probe = session.probe();
    const beatKinds = {};
    const kps = new Set();
    for (const b of session.beats) {
      beatKinds[b.kind] = (beatKinds[b.kind] ?? 0) + 1;
      kps.add(b.kpId);
    }
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
      matchRate: probe.adherence.servedBeats ? probe.adherence.matched / probe.adherence.servedBeats : null,
      slowRatio: r2(session.pace.slowRatio),
      items: session.itemsServed,
      beats: session.beats.length,
      /** ---- the round-3 measurements. C5 is built entirely out of these three. ---- */
      beatKinds,
      distinctKps: kps.size,
      distinctKpsByItem: probe.breadth.distinctKps,
      certifications: world.mastery.stats.certifications - certsBefore,
      starved: session.stats.starved.length,
      minSupply: probe.breadth.minSupply,
      focus: { ...session.focus },
      closeReason: session.closeReason,
      closingWin: session.closingWin,
      lastBeat: last ? `${last.kind}/${last.end}` : "none",
      // The two things that must be zero.
      midItem: session._servedAt != null,
      midEvent: openEvents(world).length > 0,
      plannedEvents: planAtOpen?.events ?? 0,
      plannedMinutes: planAtOpen?.minutes ?? 0,
      paceRatio: r2(session.pace.ratio),
      paceProvenance: probe.pace.provenance,
      secondsPerItem: r2(session.itemSeconds()),
      certified: session.tally.certified.length,
      set: session.tally.set.length,
      level1: world.mastery.summary().level1Percent,
      adherence: probe.adherence,
      startsOutsideCeiling: session.stats.startsOutsideCeiling,
      /** How far the worst SINGLE response ran past what admission promised. See the claim below. */
      worstResponseExcess: r2(session.stats.worstResponseExcessSeconds / 60),
      /** How far past the ceiling the floor rule let a below-floor reservation run. See `_admit`. */
      floorReservation: r2(session.stats.floorReservationSeconds / 60),
      floorOverCeiling: session.stats.floorOverCeiling,
      beatsClosedAtItem: session.stats.beatsClosedAtItem,
      eventsCarried: session.stats.eventsCarried,
      lapses: world.mastery.stats.lapses,
      provisional: world.mastery.summary().provisional,
      lines: { open: session.opening.map((l) => l.source), close: session.closing.map((l) => l.source) },
    });
  }
  if (session) perPageLoad.push(onThisPage);
  return { rows, save, world, faults, perPageLoad, phases, starvedSignals };
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
    const kps = new Set();
    for (let guard = 0; guard < 600; guard += 1) {
      const req = world.scheduler.next();
      if (!req) break;
      const latencyMs = itemLatencyMs(arch, req, rng);
      world.t.ms += latencyMs;
      world.scheduler.submit(req, outcomeFor(world, arch, req, rng, latencyMs));
      world.t.ms += gapMs(rng);
      kps.add(req.kpId);
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
      distinctKps: kps.size,
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

/**
 * The promise, stated exactly as it can be kept: **15–25 minutes plus at most one response.**
 *
 * Round 2 claimed a flat 15–25 band and then measured it on six unimodal archetypes, none of which
 * could produce a response long enough to break it — so the ceiling reservation, the one piece of
 * arithmetic the arc actually rests on, was never stressed. The `bimodal` archetype breaks it, and
 * that is the point: nothing bounds a single response from above, because a learner may put the
 * tablet down mid-claim and the one thing this layer will not do is take the claim off the slab
 * while they are still thinking. So `kept` is the honest promise — the sitting is inside the band,
 * OR the whole of the overrun is one response that outran every response that learner had ever
 * given. `blamesLayer` is the failure, and it is what the gate is on.
 */
function bandCheck(rows) {
  const inside = (r) => r.minutesExact >= ARC.minMinutes && r.minutesExact <= ARC.maxMinutes;
  const over = (r) => r.minutesExact - ARC.maxMinutes;
  /**
   * What the layer's own two documented decisions can account for, in minutes:
   *
   *   - `worstResponseExcess` — one response that ran past the mark admission set for it. Nothing
   *     bounds a single response from above and the layer will not take a claim off the slab while
   *     the learner is still thinking.
   *   - `floorReservation` — an item admitted BELOW the fifteen-minute floor whose own reservation
   *     already ran past the ceiling. `Session._admit` documents that trade: for a heavy-tailed
   *     learner the floor and the ceiling are incompatible and the floor wins, because a sitting
   *     that ends at fourteen minutes has broken the only promise the layer makes alone.
   *
   * Anything past their sum is the layer being wrong, and that is what `blamesLayer` means.
   */
  const accounted = (r) => (r.worstResponseExcess ?? 0) + (r.floorReservation ?? 0);
  const blamesLayer = (r) => !inside(r) && (r.minutesExact < ARC.minMinutes || over(r) > accounted(r));
  return {
    sessions: rows.length,
    inBand: rows.filter(inside).length,
    /** In band, or out of band by no more than one response. The promise as it can be kept. */
    kept: rows.filter((r) => !blamesLayer(r)).length,
    outOfBand: rows
      .filter((r) => !inside(r))
      .map((r) => ({ minutes: r.minutes, closeReason: r.closeReason, lastBeat: r.lastBeat, items: r.items })),
    midItem: rows.filter((r) => r.midItem).length,
    midEvent: rows.filter((r) => r.midEvent).length,
    startsOutsideCeiling: rows.reduce((a, r) => a + (r.startsOutsideCeiling ?? 0), 0),
    eventsCarried: rows.reduce((a, r) => a + (r.eventsCarried ?? 0), 0),
    overrunMinutes: rows.filter((r) => r.minutesExact > ARC.maxMinutes).map((r) => r2(over(r))),
    floorOverCeiling: rows.reduce((a, r) => a + (r.floorOverCeiling ?? 0), 0),
    overruns: rows
      .filter((r) => r.minutesExact > ARC.maxMinutes)
      .map((r) => ({
        minutes: r.minutes,
        over: r2(over(r)),
        worstResponseExcess: r.worstResponseExcess ?? 0,
        floorReservation: r.floorReservation ?? 0,
        blamesLayer: over(r) > accounted(r),
        startsOutsideCeiling: r.startsOutsideCeiling ?? 0,
        closeReason: r.closeReason,
        lastBeat: r.lastBeat,
      })),
    ...stats(rows.map((r) => r.minutes)),
  };
}

/** The corpus-wide beat-kind histogram and the breadth distribution. C5's whole substance. */
function corpusShape(rows) {
  const kinds = new Map();
  for (const r of rows) for (const [k, v] of Object.entries(r.beatKinds)) kinds.set(k, (kinds.get(k) ?? 0) + v);
  const beats = [...kinds.values()].reduce((a, b) => a + b, 0);
  return {
    sittings: rows.length,
    beats,
    kinds: [...kinds.entries()].sort((a, b) => b[1] - a[1]),
    /** The three certification-event kinds. Round 2's whole corpus had zero of all three. */
    certificationBeats: (kinds.get("consolidate") ?? 0) + (kinds.get("retention") ?? 0) + (kinds.get("review") ?? 0),
    certifications: rows.reduce((a, r) => a + r.certifications, 0),
    distinct: stats(rows.map((r) => r.distinctKps)),
    singleKpSittings: rows.filter((r) => r.distinctKps <= 1).length,
    /**
     * The shape the critic actually caught, stated exactly: a sitting that spent a real amount of
     * work on ONE knowledge point. A six-item sitting on one node is a short sitting, not
     * repetition; forty-six is the defect. `STARVE_REPS` is the same threshold `Session` alarms on,
     * so the gate and the alarm cannot drift apart.
     */
    repetitionSittings: rows.filter((r) => r.distinctKps <= 1 && r.items >= STARVE_REPS).length,
    /** ...and of those, the ones the layer SAID something about. Silence is the failure. */
    silentRepetitionSittings: rows.filter((r) => r.distinctKps <= 1 && r.items >= STARVE_REPS && r.starved === 0).length,
    starvedSittings: rows.filter((r) => r.starved > 0).length,
  };
}

const out = [];
const say = (s = "") => {
  out.push(s);
  console.log(s);
};

say("=".repeat(110));
say("P33 — Pomodoro session layer. Offline, real engine, real item bank, no browser.");
say(`arc: ${ARC.minMinutes}-${ARC.maxMinutes} min, target ${ARC.targetMinutes}; ${SESSIONS} consecutive sittings per learner`);
say(`delivery: Scheduler.attachBank(itemBank) — the shipped wiring from boot/63-learnserve.js`);
say("=".repeat(110));

// ---- C1: the headline. Ten consecutive sittings, one seed, every archetype. -------------------

say("");
say("C1  TEN CONSECUTIVE SITTINGS, WALL-CLOCK MINUTES  (seed 1)");
say("");
say(
  "archetype    " +
    Array.from({ length: SESSIONS }, (_, i) => String(i + 1).padStart(5)).join("") +
    "   |  min   med   max  in-band   kept  mid-claim  carried"
);
say("-".repeat(110));

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
      `  ${c.kept}/${c.sessions}` +
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
say("-".repeat(110));

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

// ---- C3 / C10: ONE corpus, every archetype x every absence profile x every seed ----------------
//
// Round 2 built C3, C5, C10 and C11 out of four separate re-runs of the same simulation, which
// cost four times the CPU and — worse — let two sections disagree about how many sittings there
// were. One corpus, computed once, and every section below reads it.

say("");
say(
  `C3  THE CORPUS — ${ARCHETYPES.length} archetypes x ${AWAY_PROFILES.length} absence profiles x ${SEEDS} seeds x ` +
    `${SESSIONS} sittings = ${ARCHETYPES.length * AWAY_PROFILES.length * SEEDS * SESSIONS} sittings`
);
say("");

/** archetype -> profile -> rows, plus every run's faults, page counts, phases and starve signals. */
const corpus = { rows: [], byArch: new Map(), byProfile: new Map(), faults: [], pages: [], phases: new Map(), starved: [] };
for (const arch of ARCHETYPES) {
  corpus.byArch.set(arch.id, []);
  for (const profile of AWAY_PROFILES) {
    if (!corpus.byProfile.has(profile.id)) corpus.byProfile.set(profile.id, { rows: [], pages: [], phases: new Map(), starved: [] });
    const slot = corpus.byProfile.get(profile.id);
    for (let s = 1; s <= SEEDS; s += 1) {
      const run = runSessionArm(arch, s, SESSIONS, profile);
      for (const r of run.rows) {
        r.arch = arch.id;
        r.profile = profile.id;
      }
      corpus.rows.push(...run.rows);
      corpus.byArch.get(arch.id).push(...run.rows);
      slot.rows.push(...run.rows);
      slot.pages.push(...run.perPageLoad);
      corpus.pages.push(...run.perPageLoad);
      corpus.faults.push(...run.faults.map((f) => `${profile.id}/${arch.id}/seed${s}: ${f}`));
      corpus.starved.push(...run.starvedSignals);
      slot.starved.push(...run.starvedSignals);
      for (const [k, v] of run.phases) {
        corpus.phases.set(k, (corpus.phases.get(k) ?? 0) + v);
        slot.phases.set(k, (slot.phases.get(k) ?? 0) + v);
      }
    }
  }
}

say("archetype     sittings   min    p10    med    p90    max   in 15-25    kept   mid-claim  carried  items  rho");
say("-".repeat(118));
const distribution = {};
for (const arch of ARCHETYPES) {
  const rows = corpus.byArch.get(arch.id);
  const c = bandCheck(rows);
  distribution[arch.id] = c;
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
      `   ${c.inBand}/${c.sessions}`.padStart(12) +
      `${c.kept}/${c.sessions}`.padStart(9) +
      String(c.midItem).padStart(11) +
      String(c.eventsCarried).padStart(9) +
      String(items.median).padStart(7) +
      String(rho.median).padStart(6)
  );
}
const corpusBand = bandCheck(corpus.rows);
say("-".repeat(118));
say(
  "ALL".padEnd(12) +
    String(corpusBand.sessions).padStart(8) +
    String(corpusBand.min).padStart(7) +
    String(corpusBand.p10).padStart(7) +
    String(corpusBand.median).padStart(7) +
    String(corpusBand.p90).padStart(7) +
    String(corpusBand.max).padStart(7) +
    `   ${corpusBand.inBand}/${corpusBand.sessions}`.padStart(14) +
    `${corpusBand.kept}/${corpusBand.sessions}`.padStart(12)
);

// ---- C4: what a fast learner actually gets for their twenty minutes ---------------------------

say("");
say("C4  SAME TWENTY MINUTES, DIFFERENT AMOUNT OF WORK — items served per sitting, session arm");
say("    (this is the requirement: a student who works fast gets MORE done, not cut off earlier)");
say("");
say("archetype     median items   median minutes   items/minute   baseline items   baseline minutes");
say("-".repeat(110));
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

// ---- C5: WHAT IS ACTUALLY IN THE CORPUS. The section round 2 did not have. ---------------------

say("");
say("=".repeat(110));
say("C5  IS THERE ANY LEARNING IN THIS CORPUS AT ALL?");
say("=".repeat(110));
say("    Round 2 reported one line here — the last beat's kind — and that line was `acquire/complete`");
say("    350 times out of 350, which is what a corpus containing ZERO mastery events looks like from");
say("    the outside. A session layer whose currency is the mastery event has to count its currency.");
say("    Every number below is a gate, not a report: they FAIL, they do not print and move on.");
say("");

const shape = corpusShape(corpus.rows);
say(`  beats in corpus            ${shape.beats} across ${shape.sittings} sittings`);
say(`  beat kinds                 ${shape.kinds.map(([k, v]) => `${k}=${v}`).join("  ")}`);
say(`  certification beats        ${shape.certificationBeats}  (consolidate + retention + review)`);
say(`  certifications             ${shape.certifications}`);
say(
  `  distinct kps per sitting   min ${shape.distinct.min}  p10 ${shape.distinct.p10}  median ${shape.distinct.median}` +
    `  p90 ${shape.distinct.p90}  max ${shape.distinct.max}`
);
say(`  single-knowledge-point sittings   ${shape.singleKpSittings} of ${shape.sittings}`);
say(`  ...of which >= ${STARVE_REPS} items on that one node   ${shape.repetitionSittings}`);
say(`  sittings that fired 'starved'     ${shape.starvedSittings} of ${shape.sittings}`);
/**
 * The alarms the FULL graph produces, with the one fact that decides whether each is noise: how
 * many descendants the node has. A leaf at the end of a strand is where §4's frontier genuinely
 * narrows to one node — the learner has mastered everything above it — and eighteen items there is
 * the curriculum running out of breadth, which is exactly what this signal exists to report. An
 * alarm on a node with descendants still ahead of it would be a different and much worse story.
 */
{
  const g = new Graph(graphSource);
  say(`  starve alarms on the full graph    ${corpus.starved.length}`);
  for (const s of corpus.starved.slice(0, 8))
    say(
      `      ${s.kpId.padEnd(20)} reps=${String(s.reps).padStart(3)} beats=${String(s.beats).padStart(2)} ` +
        `at ${String(s.atMinutes).padStart(6)}min  supply=${s.supply}  descendants-ahead=${g.descendants(s.kpId).size}`
    );
}

say("");
say("  BY ARCHETYPE — a struggling learner and a talented one must not get the same sitting");
say("");
say("  archetype     distinct kps (min/med/max)   certifications   L1% after 10   beat kinds");
say("  " + "-".repeat(106));
for (const arch of ARCHETYPES) {
  const rows = corpus.byArch.get(arch.id);
  const sh = corpusShape(rows);
  const l1 = stats(headline[arch.id].map((r) => r.level1));
  say(
    "  " +
      arch.id.padEnd(12) +
      `${sh.distinct.min} / ${sh.distinct.median} / ${sh.distinct.max}`.padStart(24) +
      String(sh.certifications).padStart(17) +
      String(l1.max).padStart(15) +
      "   " +
      sh.kinds.map(([k, v]) => `${k}=${v}`).join(" ")
  );
}

// ---- C5b: THE CONTROL. Round 2's own delivery, kept reachable on purpose. ----------------------

say("");
say("C5b THE STARVED CONTROL — a graph whose whole legal supply is ONE knowledge point");
say("    A gate that can never fail is measuring nothing (C2's rule, applied to the session arm).");
say("    So the failure mode is kept reachable on purpose: the same engine, the same bank, the same");
say("    archetypes, over a graph pruned to `var-meaning` alone. The engine then has exactly one");
say("    node to offer at every boundary, which is the shape the critic measured, and every breadth");
say("    gate above must be FALSE here while Session's 'starved' signal fires.");
say("");

/** `content/knowledge-graph.json` with every node but the first removed. Nothing else changes. */
const ONE_NODE_SOURCE = { ...graphSource, nodes: graphSource.nodes.filter((n) => n.id === "var-meaning") };

const starvedArm = [];
const starvedSignals = [];
for (const arch of ARCHETYPES) {
  for (let s = 1; s <= Math.min(SEEDS, 3); s += 1) {
    const run = runSessionArm(arch, s, SESSIONS, AWAY_PROFILES[0], { source: ONE_NODE_SOURCE });
    starvedArm.push(...run.rows);
    starvedSignals.push(...run.starvedSignals);
  }
}
const starvedShape = corpusShape(starvedArm);
say(`  sittings                   ${starvedShape.sittings}`);
say(`  beat kinds                 ${starvedShape.kinds.map(([k, v]) => `${k}=${v}`).join("  ")}`);
say(`  distinct kps per sitting   min ${starvedShape.distinct.min}  median ${starvedShape.distinct.median}  max ${starvedShape.distinct.max}`);
say(`  single-kp sittings         ${starvedShape.singleKpSittings} of ${starvedShape.sittings}`);
say(`  'starved' signals emitted  ${starvedSignals.length}  (session arm: ${corpus.starved.length})`);
if (starvedSignals.length)
  say(
    `  first three                ${starvedSignals
      .slice(0, 3)
      .map((s) => `${s.kpId} reps=${s.reps} beats=${s.beats} at ${s.atMinutes}min supply=${s.supply}`)
      .join(" | ")}`
  );

// ---- C5d: round 2's delivery, kept as a historical control. P32 fixed the deadlock under us. ---

say("");
say("C5d ROUND 2's WIRING — the same engine with the bank DETACHED — for the record");
say("    This is how the corpus was produced that had 0 certifications and 1 knowledge point. It no");
say("    longer deadlocks, and not because of anything in this piece: P32 landed");
say("    `Scheduler.attachBank` + `Mastery.declareFamilyReporting` while this round was being");
say("    written, so a bankless Scheduler now declares its own delivery and routes around the 24");
say("    cells it cannot report a family for, at a cost in coverage rather than a deadlock.");
say("");
const noBankArm = [];
for (const arch of ARCHETYPES) {
  for (let s = 1; s <= Math.min(SEEDS, 2); s += 1) noBankArm.push(...runSessionArm(arch, s, SESSIONS, AWAY_PROFILES[0], { bank: null }).rows);
}
const noBankShape = corpusShape(noBankArm);
say(
  `  no-bank arm: ${noBankShape.sittings} sittings, ${noBankShape.certifications} certifications, ` +
    `${noBankShape.certificationBeats} certification beats, distinct kps median ${noBankShape.distinct.median}`
);
say(
  `  bank attached: ${shape.sittings} sittings, ${shape.certifications} certifications, ` +
    `${shape.certificationBeats} certification beats, distinct kps median ${shape.distinct.median}`
);

// ---- C5c: how sittings end --------------------------------------------------------------------

say("");
say("C5c HOW A SITTING ENDS — every close reason, every last-beat outcome, whole corpus");
say("");
say("close reason        " + showHist(histogram(corpus.rows, "closeReason")));
say("last beat kind/end  " + showHist(histogram(corpus.rows, "lastBeat")));
say("closing win         " + showHist(histogram(corpus.rows, "closingWin")));
say("");
say("    The brief: ALWAYS END ON A COMPLETED BEAT. Three endings are legal and they are not the");
say("    same thing, so they are counted apart rather than added up:");
say("      complete        — the beat spent its items. The ordinary ending.");
say("      carried         — an ATOMIC beat met the ceiling and was left standing exactly where it");
say("                        was. `Scheduler.beginSession` resumes it; no lapse, no M2 dock, no");
say("                        re-roll. Not a completed beat, and not a cut one either.");
say("      closed-at-item  — a BLOCK ended at an item boundary. A block is a continuity preference");
say("                        (§4 step 2), not a unit, so there is nothing to complete.");
say("    `stopped` and `preempted` are the endings that WOULD be cuts, and they must not occur.");
const endKinds = new Map();
for (const r of corpus.rows) {
  const end = r.lastBeat.split("/")[1] ?? "none";
  endKinds.set(end, (endKinds.get(end) ?? 0) + 1);
}
say("");
say("last beat END       " + [...endKinds.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join("  "));

// ---- C10: absence and the break ---------------------------------------------------------------

say("");
say(`C10 ABSENCE AND THE BREAK — the same corpus, split by absence profile`);
say("    The band is on ATTENDED minutes, because away time is not session time; the wall-clock");
say("    span is printed beside it so the two are never confused.");
say("");
for (const p of AWAY_PROFILES) say(`    ${p.id.padEnd(10)} ${p.note}`);
say("");
say("profile      sittings    min    med    max   in 15-25     kept   mid-claim   attended  wall  away  sittings/page");
say("-".repeat(118));
const awayRuns = {};
for (const profile of AWAY_PROFILES) {
  const slot = corpus.byProfile.get(profile.id);
  const c = bandCheck(slot.rows);
  awayRuns[profile.id] = { band: c, ...slot };
  const wall = stats(slot.rows.map((r) => r.wallMinutes));
  const awayS = stats(slot.rows.map((r) => r.awayMinutes));
  const onPage = stats(slot.rows.map((r) => r.sittingOnPage));
  say(
    profile.id.padEnd(13) +
      String(c.sessions).padStart(8) +
      String(c.min).padStart(7) +
      String(c.median).padStart(7) +
      String(c.max).padStart(7) +
      `   ${c.inBand}/${c.sessions}`.padStart(12) +
      `${c.kept}/${c.sessions}`.padStart(9) +
      String(c.midItem).padStart(12) +
      String(c.median).padStart(11) +
      String(wall.median).padStart(6) +
      String(awayS.median).padStart(6) +
      `${onPage.median} / ${onPage.max}`.padStart(15)
  );
}

say("");
say("C10b CLOSE REASONS, PER PROFILE — 'break' is the sitting ending because the learner took one");
say("");
for (const profile of AWAY_PROFILES) say(`  ${profile.id.padEnd(11)}${showHist(histogram(awayRuns[profile.id].rows, "closeReason"))}`);
say("");
say("C10c THE CYCLE — work -> break -> work, per page load. A break must not be a terminus.");
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
say("    with the same five terms and the same two-open cap. Nothing ends a sitting on it.");
say("      NEXT BEAT  — at every beat boundary the live plan names what should come next, and the");
say("                   engine is then asked. This is falsifiable and it is the number to read.");
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
    const rows = corpus.byArch.get(arch.id);
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

// ---- C12: LEVERAGE, and the affordance that does not exist yet ---------------------------------

say("");
say("C12 LEVERAGE — 'time spent where leverage on mastery is highest', and who decides it");
say("    Session.leverage() ranks the acquirable frontier in CERTIFICATIONS BOUGHT PER ITEM SPENT:");
say("    the node's own certification plus the descendants for which it is the last unmastered");
say("    prerequisite, over the M2/M3 opportunities still outstanding on gateDetail(). §4's own");
say("    frontier score has a `reach` term — descendants/maxDescendants — which is a different");
say("    number: it is blind to cost and it counts descendants that are behind three other open");
say("    prerequisites. Round 2 DELETED this table because `Scheduler` publishes no focus(kpId);");
say("    the response to a missing affordance is to request it, not to drop the requirement.");
say("");
say("    So the request goes out as learn:session {phase:'focus'} and this is what became of it.");
say("");
say("archetype     focus requests   answered by a block   landed on the asked node   rate   affordance");
say("-".repeat(110));
let focusRequested = 0;
let focusAnswered = 0;
let focusMatched = 0;
let focusAffordance = false;
const focusNodes = new Set();
for (const arch of ARCHETYPES) {
  const rows = corpus.byArch.get(arch.id);
  const req = rows.reduce((a, r) => a + r.focus.requested, 0);
  const ans = rows.reduce((a, r) => a + r.focus.answered, 0);
  const mat = rows.reduce((a, r) => a + r.focus.matched, 0);
  const aff = rows.some((r) => r.focus.affordance);
  for (const r of rows) if (r.focus.kpId) focusNodes.add(r.focus.kpId);
  focusRequested += req;
  focusAnswered += ans;
  focusMatched += mat;
  focusAffordance = focusAffordance || aff;
  say(
    arch.id.padEnd(12) +
      String(req).padStart(15) +
      String(ans).padStart(22) +
      String(mat).padStart(27) +
      String(r2(mat / Math.max(1, ans))).padStart(7) +
      String(aff).padStart(13)
  );
}
say("-".repeat(110));
say(
  "ALL".padEnd(12) +
    String(focusRequested).padStart(15) +
    String(focusAnswered).padStart(22) +
    String(focusMatched).padStart(27) +
    String(r2(focusMatched / Math.max(1, focusAnswered))).padStart(7) +
    String(focusAffordance).padStart(13)
);
say("");
say(`    distinct nodes this layer asked for across the corpus: ${focusNodes.size}`);
say(`    learn:session{phase:"focus"} signals emitted: ${corpus.phases.get("focus") ?? 0}`);
say("    HANDOFF TO P16 — `learn/Scheduler.js` is P16's file and this piece may not edit it");
say("    (CLAUDE.md rule 5). The ask is one method: `focus(kpId)`, a soft preference read by");
say("    `_choose()` step 2 as a tie-break on the frontier score, cleared when the block ends.");
say("    The rate above is what it would be worth: the fraction of acquisition beats that already");
say("    land where the leverage is without it.");

// ---- C9: does the arc still teach? -------------------------------------------------------------

say("");
say("C9  THE ARC MUST NOT COST LEARNING — Level 1 mastered % after 10 sittings, same learner, both arms");
say("    Read the HOURS column first. Mastery per hour of attention is the number.");
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

// ---- C6: Save — corrupt, absent, interrupted, and the pace that must survive a crash -----------

say("");
say("C6  SAVE — absent, corrupt, wrong version, interrupted, a denied store, and pace recovery");
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

  store.setItem("vs.flow.save.v1", JSON.stringify({ version: 1, pace: { ratio: 1.4, slowRatio: 99 } }));
  const s4b = new Save({ storage: store });
  const r4b = s4b.load();
  saveChecks.push([
    "out-of-range pace.slowRatio named and defaulted",
    r4b.repaired.includes("pace.slowRatio") && s4b.state.pace.slowRatio === 2 && s4b.state.pace.ratio === 1.4,
  ]);
  store.setItem("vs.flow.save.v1", JSON.stringify({ version: 1, pace: { ratio: 1.4 } }));
  const s4c = new Save({ storage: store });
  const r4c = s4c.load();
  saveChecks.push(["an older save with no slowRatio is defaulted, not reported as damage", r4c.fault === null && s4c.state.pace.slowRatio === 2]);

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

  /**
   * THE ROUND-3 SAVE FIX, checked at the level of the file rather than through a whole simulation.
   * A sitting killed after forty items leaves its calibration in `live.pace`; round 2 read only
   * `state.pace`, which only a CLEAN close writes, so the reload planned at the design default.
   */
  const store3 = new MemoryStorage();
  const s7 = new Save({ storage: store3 });
  s7.load();
  s7.openSession({ number: 3 });
  s7.checkpoint({ items: 40, pace: { ratio: 0.304, spread: 0.2, slowRatio: 1.58, gapSeconds: 3, samples: 39 } });
  const s8 = new Save({ storage: store3 });
  const r8 = s8.load();
  saveChecks.push([
    `interrupted pace ADOPTED (ratio ${s8.pace.ratio}, samples ${s8.pace.samples}, source ${s8.paceSource})`,
    r2(s8.pace.ratio) === 0.3 && s8.pace.samples === 39 && r2(s8.pace.slowRatio) === 1.58 && s8.paceSource === "recovered",
  ]);
  // ...and it is not unconditional. A clean close with more samples outranks a crash with fewer.
  const store4 = new MemoryStorage();
  const s9 = new Save({ storage: store4 });
  s9.load();
  s9.savePace({ ratio: 1.9, spread: 0.3, slowRatio: 3, gapSeconds: 5, samples: 200 });
  s9.openSession({ number: 12 });
  s9.checkpoint({ pace: { ratio: 0.2, spread: 0.1, slowRatio: 1.1, gapSeconds: 2, samples: 3 } });
  const s10 = new Save({ storage: store4 });
  s10.load();
  saveChecks.push([
    `a 200-sample clean close outranks a 3-sample crash (ratio ${s10.pace.ratio}, source ${s10.paceSource})`,
    s10.pace.samples === 200 && s10.paceSource === "measured",
  ]);
  // A recovered pace goes through the same validation a stored one does.
  const store5 = new MemoryStorage();
  const s11 = new Save({ storage: store5 });
  s11.load();
  s11.openSession({ number: 1 });
  s11.checkpoint({ pace: { ratio: 99, slowRatio: 1.4, samples: 20 } });
  const s12 = new Save({ storage: store5 });
  const r12 = s12.load();
  saveChecks.push([
    `a corrupt field inside a recovered pace is named and defaulted (${r12.repaired.join(",") || "none"})`,
    r12.repaired.includes("interrupted.pace.ratio") && s12.pace.ratio === 1 && s12.pace.samples === 20,
  ]);

  const denied = new Save({ storage: null });
  saveChecks.push(["storage denied is honest, not fatal", denied.load().fault === "storage-unavailable"]);
}
for (const [name, ok] of saveChecks) say(`  ${ok ? "PASS" : "FAIL"}  ${name}`);

// ---- C7: pace carries between sittings, AND across a sitting that died -------------------------

say("");
say("C7  PACE CARRIES — a learner does not get re-measured from the design's seconds every sitting");
say("");
say("archetype     sitting 1 minutes   sitting 1 rho   sitting 2 rho   sitting 10 rho   true seconds/solo item");
say("-".repeat(110));
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

say("");
say("C7b ...AND ACROSS AN UNCLEAN EXIT. Round 2 held only for a CLEAN close: a killed sitting left");
say("    its calibration in `interrupted.pace`, which nothing read, and the reload planned at the");
say("    design default. Here the sitting is killed mid-flight — no close(), no savePace() — and a");
say("    fresh Save + Session is built over the same storage, which is what a reload IS.");
say("");
say("archetype    items before the kill   rho at the kill   rho after reload   provenance   opening line");
say("-".repeat(118));
const crashChecks = [];
for (const arch of ARCHETYPES.slice(0, 4)) {
  const world = makeWorld(11, Date.UTC(2026, 1, 2, 16, 30, 0));
  const store = new MemoryStorage();
  const rng = mulberry32(11);
  const save = new Save({ storage: store, now: () => world.t.ms });
  save.load();
  const session = new Session({ learning: world.learning, save, now: () => world.t.ms, emit: () => {} });
  session.begin();
  let served = 0;
  // Twelve items, not forty: a `deliberate` learner's whole sitting is nineteen, and a harness
  // that lets the session CLOSE before it kills it is measuring a clean close, which is the path
  // that already worked. The assertion below is what keeps that honest.
  for (; served < 12; served += 1) {
    const req = session.next();
    if (!req) break;
    const latencyMs = itemLatencyMs(arch, req, rng);
    world.t.ms += latencyMs;
    session.submit(req, outcomeFor(world, arch, req, rng, latencyMs));
    world.t.ms += gapMs(rng);
  }
  const stillOpen = session.phase !== "closed";
  const rhoAtKill = r2(session.pace.ratio);
  const samplesAtKill = session.pace.samples;
  // THE KILL. No close(), no savePace(), no endSession — the tab is gone.
  world.t.ms += 3600 * 1000;
  const save2 = new Save({ storage: store, now: () => world.t.ms });
  save2.load();
  const session2 = new Session({ learning: world.learning, save: save2, now: () => world.t.ms, emit: () => {} });
  session2.begin();
  const opening = session2.opening.map((l) => l.source);
  say(
    arch.id.padEnd(12) +
      String(served).padStart(22) +
      `${rhoAtKill}/${samplesAtKill}`.padStart(18) +
      `${r2(session2.pace.ratio)}/${session2.pace.samples}`.padStart(19) +
      String(session2.paceSource).padStart(13) +
      `   "${opening[0] ?? "(nothing)"}"`
  );
  crashChecks.push({
    arch: arch.id,
    // The kill has to be a kill. A sitting that closed itself first proves nothing here.
    stillOpen,
    carried: session2.pace.samples === samplesAtKill && r2(session2.pace.ratio) === rhoAtKill,
    provenance: session2.paceSource,
    spoke: opening.length > 0,
    cutLine: opening[0] === "The last working was left standing.",
    opening,
  });
}

// ---- C8: the voice ----------------------------------------------------------------------------

say("");
say("C8  WHAT THE SITTING SAYS  (EN source for keys P20 has not been handed yet)");
say("");
{
  const rows = headline.steady;
  const open = rows[rows.length - 1].lines.open;
  const close = rows[rows.length - 1].lines.close;
  for (const l of open) say(`  open   "${l}"   ${l.split(/\s+/).length}w ${l.length}c`);
  for (const l of close) say(`  close  "${l}"   ${l.split(/\s+/).length}w ${l.length}c`);
  for (const c of crashChecks.slice(0, 1)) for (const l of c.opening) say(`  cut    "${l}"   ${l.split(/\s+/).length}w ${l.length}c`);
  const all = Object.values((await import("../../app/src/flow/Session.js")).VOICE);
  const overWords = all.filter((s) => s.replace(/\{\w+\}/g, "8").split(/\s+/).length > 7);
  const overChars = all.filter((s) => s.replace(/\{\w+\}/g, "8").length > 44);
  const secondPerson = all.filter((s) => /\byou\b|\byour\b/i.test(s));
  const exclaims = all.filter((s) => s.includes("!"));
  const banned = all.filter((s) =>
    /\b(problem|question|exercise|answer|solution|correct|incorrect|right|wrong|lesson|tutorial|practice|study|homework|drill|score|points|streak|hint|student|player|user|math|equation|algebra|great|well done|good job)\b/i.test(s)
  );
  say("");
  say(
    `  ${all.length} lines; over 7 words: ${overWords.length}; over 44 chars: ${overChars.length}; ` +
      `second person: ${secondPerson.length}; exclamations: ${exclaims.length}; banned vocabulary: ${banned.length}`
  );
  if (overWords.length) say(`  OVER WORDS: ${overWords.join(" | ")}`);
  if (overChars.length) say(`  OVER CHARS: ${overChars.join(" | ")}`);
  if (banned.length) say(`  BANNED: ${banned.join(" | ")}`);
  saveChecks.push(["voice caps hold", !overWords.length && !overChars.length && !secondPerson.length && !exclaims.length && !banned.length]);
}

// ---- verdict ------------------------------------------------------------------------------------

say("");
say("=".repeat(110));

const allSittings = corpus.rows.length;
const allOverruns = corpusBand.overruns;
const belowFloor = corpus.rows.filter((r) => r.minutesExact < ARC.minMinutes).length;
const claims = [
  /**
   * ===========================================================================================
   * THE CORPUS GATES. These come FIRST because every gate under them is conditional on them.
   * ===========================================================================================
   * A control that never fails is measuring nothing — C2 has applied that rule to the baseline
   * since round 1, and round 2 did not apply it to the session arm. It applies now: a corpus with
   * no certification event in it makes every claim about atomic events, carried checks and the
   * retention window pass vacuously, including "a certification event is CARRIED across every
   * boundary (0 carried)".
   */
  [
    "C5     the corpus CONTAINS mastery events — all three certification kinds occur",
    ["consolidate", "retention", "review"].every((k) => (shape.kinds.find(([kk]) => kk === k)?.[1] ?? 0) > 0),
    `${shape.certificationBeats} certification beats of ${shape.beats}: ${shape.kinds.map(([k, v]) => `${k}=${v}`).join(" ")}`,
  ],
  [
    "C5     the corpus CONTAINS certifications",
    shape.certifications > 0,
    `${shape.certifications} across ${shape.sittings} sittings`,
  ],
  [
    "C5     a sitting is not one knowledge point on repeat",
    shape.repetitionSittings === 0 && shape.distinct.p10 >= 2 && shape.distinct.median >= 3,
    `distinct kps/sitting min ${shape.distinct.min}, p10 ${shape.distinct.p10}, median ${shape.distinct.median}, ` +
      `max ${shape.distinct.max}; ${shape.singleKpSittings} single-kp sittings, of which ` +
      `${shape.repetitionSittings} served >= ${STARVE_REPS} items on that one node`,
  ],
  [
    "C5     a struggling learner and a talented one do NOT get the same sitting",
    (() => {
      const l1 = ARCHETYPES.map((a) => headline[a.id][SESSIONS - 1].level1);
      return Math.max(...l1) - Math.min(...l1) > 20;
    })(),
    ARCHETYPES.map((a) => `${a.id} ${headline[a.id][SESSIONS - 1].level1}%`).join(", "),
  ],
  [
    "C5b    the starved CONTROL fails the breadth gate — the failure mode is still reachable",
    starvedShape.repetitionSittings > 0 && starvedShape.singleKpSittings === starvedShape.sittings,
    `one-node graph: ${starvedShape.singleKpSittings}/${starvedShape.sittings} single-kp sittings, ` +
      `${starvedShape.repetitionSittings} of them past ${STARVE_REPS} items on that node`,
  ],
  /**
   * The alarm is a FACT ABOUT SUPPLY, not a smell test, and this is the gate that says so.
   *
   * It is deliberately not "zero alarms on the full graph". Six of the 2,240 full-graph sittings do
   * fire it, every one of them on `ineq-two-step` or `eq-model-context` — leaves at the end of
   * their strands, reached by a learner who has already mastered everything above them, where §4's
   * frontier genuinely narrows to a single node. Eighteen items there is the curriculum running out
   * of breadth and the world should say so. Suppressing that to make a gate green would be the same
   * mistake as round 2's silence, dressed as a pass.
   *
   * What must hold is that the alarm never fires on anything else: every alarm carries a supply of
   * exactly one node and a rep count at or past the threshold, the control never stays SILENT about
   * a repetition sitting, and the rate on a full graph stays under one percent.
   */
  [
    "C5b    Session SAYS SO when the engine starves it — and the alarm is never noise",
    starvedSignals.length > 0 &&
      starvedShape.silentRepetitionSittings === 0 &&
      corpus.starved.every((s) => s.supply <= 1 && s.reps >= STARVE_REPS) &&
      corpus.starved.length / allSittings < 0.01,
    `${starvedSignals.length} learn:session{phase:"starved"} on the one-node control, ` +
      `${starvedShape.silentRepetitionSittings} repetition sittings it stayed silent about; ` +
      `${corpus.starved.length}/${allSittings} = ${r2((100 * corpus.starved.length) / allSittings)}% on the full graph, ` +
      `all with supply=1 and reps >= ${STARVE_REPS}, on ${[...new Set(corpus.starved.map((s) => s.kpId))].join("/") || "no nodes"}`,
  ],

  /**
   * ===========================================================================================
   * THE ARC GATES.
   * ===========================================================================================
   * The floor is the promise and it is absolute. A Pomodoro that ends at nine minutes has broken
   * the only thing it offered; the layer decides that one entirely by itself (`_admit`'s floor
   * rule admits whatever else is true), so there is no excuse available and the gate is exact.
   */
  [
    "C1/C3/C10  no sitting EVER ends below the fifteen-minute floor",
    belowFloor === 0,
    `${belowFloor} of ${allSittings} sittings across all four absence profiles`,
  ],
  /**
   * The promise, stated as it can be kept. Nothing bounds a single response from above, so a
   * flat 15-25 claim is a claim about the learner rather than about the layer — and round 2 only
   * got away with it because none of its six unimodal archetypes could produce a long enough
   * response. `bimodal` can. So the claim is "15-25 minutes plus at most one response", and it is
   * checked by arithmetic on every out-of-band sitting rather than by a threshold in minutes.
   */
  [
    "C1/C3/C10  the arc lands in 15-25 minutes PLUS AT MOST ONE RESPONSE",
    corpusBand.kept === allSittings,
    `${corpusBand.inBand}/${allSittings} strictly inside the band; ${corpusBand.kept}/${allSittings} kept once one ` +
      `long response is allowed for; ${allOverruns.length} overruns`,
  ],
  [
    "C1/C3/C10  nothing is STARTED that is not expected to finish inside 25",
    corpusBand.startsOutsideCeiling === 0,
    `${corpusBand.startsOutsideCeiling} of ${allSittings} sittings served an item outside the ceiling estimate`,
  ],
  /**
   * The attribution, and it is arithmetic rather than a threshold in minutes. Each out-of-band
   * sitting carries the excess of its own worst single response over what admission promised that
   * item would cost; if the overrun is no bigger than that excess, the whole of it is the learner
   * still working. `blamesLayer` is the failure.
   */
  [
    "C1/C3/C10  the residual is a single long response, never the layer",
    allOverruns.every((o) => !o.blamesLayer),
    allOverruns.length
      ? `${allOverruns.length} overrun(s) of ${allSittings}; ${allOverruns.filter((o) => o.blamesLayer).length} the layer cannot account for; ` +
        allOverruns
          .slice(0, 6)
          .map((o) => `${o.minutes}min = +${o.over} with one response +${o.worstResponseExcess} over its promise`)
          .join("; ")
      : "no overruns",
  ],
  ["C1/C3  no sitting ends mid-problem", corpusBand.midItem === 0, `${corpusBand.midItem} of ${allSittings}`],
  /**
   * The brief's own words: ALWAYS END ON A COMPLETED BEAT, never a hard timer cut mid-problem. The
   * gate is on the two endings that would BE a cut — a beat stopped inside itself, or one
   * pre-empted by the engine — and it is exact. A carry is neither: the claim is left standing
   * where it was and resumed, which the carry gate above proves costs nothing.
   */
  [
    "C5c    the last beat is completed, carried or a block that ran out — never cut",
    (endKinds.get("stopped") ?? 0) === 0 && (endKinds.get("preempted") ?? 0) === 0 && (endKinds.get("none") ?? 0) === 0,
    [...endKinds.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" "),
  ],
  [
    "C1/C3/C10  a certification event is CARRIED across every boundary, including a break",
    corpus.faults.length === 0 && corpusBand.eventsCarried > 0,
    `${corpusBand.eventsCarried} carried across ${allSittings} sittings; ${corpus.faults.length} faults` +
      (corpus.faults.length ? ` -> ${corpus.faults.slice(0, 4).join("; ")}` : "") +
      (corpusBand.eventsCarried === 0 ? "  <- ZERO CARRIES MEANS THIS GATE MEASURED NOTHING" : ""),
  ],
  [
    "C2     the baseline it replaces does NOT hold the band",
    Object.values(baseline).some((rows) => rows.some((r) => r.minutesExact < ARC.minMinutes || r.minutesExact > ARC.maxMinutes)),
    "a control that never fails is measuring nothing",
  ],
  [
    "C10    the band holds when the learner LOOKS AWAY, every profile",
    AWAY_PROFILES.every((p) => awayRuns[p.id].band.kept === awayRuns[p.id].band.sessions),
    AWAY_PROFILES.map((p) => `${p.id} ${awayRuns[p.id].band.kept}/${awayRuns[p.id].band.sessions}`).join("; "),
  ],
  [
    "C10    no sitting ends mid-problem WITH absences, including mid-item ones",
    corpusBand.midItem === 0,
    `${corpusBand.midItem} of ${allSittings} across all profiles`,
  ],
  [
    "C10    a break ENDS a sitting — and only at or past the fifteen-minute floor",
    awayRuns.break.rows.some((r) => r.closeReason === "break") &&
      !corpus.rows.some((r) => r.closeReason === "break" && r.minutesExact < ARC.minMinutes),
    `break closes: churn ${awayRuns.churn.rows.filter((r) => r.closeReason === "break").length}, ` +
      `break ${awayRuns.break.rows.filter((r) => r.closeReason === "break").length}; ` +
      `earliest ${r2(Math.min(...corpus.rows.filter((r) => r.closeReason === "break").map((r) => r.minutesExact), Infinity))} min`,
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
  [
    "C12    leverage is COMPUTED and REQUESTED, over more than one node",
    focusRequested > 0 && focusNodes.size > 1 && (corpus.phases.get("focus") ?? 0) > 0,
    `${focusRequested} requests over ${focusNodes.size} distinct nodes; ${corpus.phases.get("focus") ?? 0} focus signals; ` +
      `${focusMatched}/${focusAnswered} = ${r2(focusMatched / Math.max(1, focusAnswered))} of acquisition beats already land there; ` +
      `Scheduler.focus() affordance present: ${focusAffordance}`,
  ],
  [
    "C7b    the pace survives an UNCLEAN exit, with its provenance",
    crashChecks.length > 0 && crashChecks.every((c) => c.stillOpen && c.carried && c.provenance === "recovered"),
    crashChecks
      .map((c) => `${c.arch} ${c.stillOpen ? "killed-open" : "CLOSED-ITSELF"}/${c.carried ? "carried" : "LOST"}/${c.provenance}`)
      .join("; "),
  ],
  [
    "C7b    the interrupted re-entry SAYS something, and says the right thing",
    crashChecks.every((c) => c.spoke && c.cutLine),
    crashChecks.map((c) => `${c.arch} "${c.opening[0] ?? "(nothing)"}"`).join("; "),
  ],
  ["C6     a bad save is reported, never silently reset", saveChecks.every(([, ok]) => ok), ""],
];
for (const [name, ok, note] of claims) say(`${ok ? "PASS" : "FAIL"}  ${name}${note ? `   (${note})` : ""}`);
if (corpusBand.outOfBand.length)
  say(
    `      out-of-band sittings: ${corpusBand.outOfBand
      .slice(0, 20)
      .map((w) => `${w.minutes}min close=${w.closeReason} lastBeat=${w.lastBeat} items=${w.items}`)
      .join("; ")}`
  );
say("=".repeat(110));

const failed = claims.filter(([, ok]) => !ok);
writeFileSync(resolve(root, "review/measure/P33.txt"), out.join("\n") + "\n");
if (JSON_OUT)
  writeFileSync(
    resolve(root, JSON_OUT),
    JSON.stringify({ headline, baseline, distribution, shape, starvedShape, claims }, null, 1)
  );
process.exit(failed.length ? 1 : 0);
