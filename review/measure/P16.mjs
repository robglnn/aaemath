/**
 * P16 — the proof.
 *
 *   node review/measure/P16.mjs
 *   node review/measure/P16.mjs --learners=2000 --sessions=22 --json
 *   node review/measure/P16.mjs --strict            // declared §8 misses fail the run too
 *
 * This script does not restate the design. It drives the SHIPPED ENGINE — the very
 * `app/src/learn/{Graph,Mastery,Scheduler}.js` the browser boots, and the real
 * `app/src/learn/ItemBank.js` P17 ships — through a population of simulated learners and a set of
 * hostile bots, and prints PASS/FAIL against thresholds stated at the top of the file. If it
 * prints FAIL, P16 is wrong.
 *
 * =============================================================================================
 * RULE 1 — WHERE A BOT'S SUCCESS RATE COMES FROM
 *
 * A bot's probability of being right is NEVER read from the model's own `guess` parameter. It is
 * read from ground truth — the size of an answer space, owing nothing to BKT — and it is looked
 * up from the form and phase the SCHEDULER ACTUALLY SERVED on that item, not from a form the
 * harness chose in advance. Setting `correct = rng() < guess` is not a test; it is the model's
 * assumption restated with a number on it.
 *
 * Round 2 of this script measured the blind-success rate empirically instead of reading the JSON,
 * and STILL got it wrong, because it measured the wrong STRATEGY. Its assumption B4 said a
 * responder who "picks uniformly inside the shape of the answer" is the best case for a guesser.
 * It is not. The best case is BEST FIXED ANSWER: type one string on every item of a pool and keep
 * whichever string wins most. On `eq-special-cases|repair` the shape-uniform bot invents line
 * numbers and scores 0.002; every item that pool will ever produce answers `3|0 = 0`, so a bot
 * that types it scores 1.00. Round 2 reported the 0.002, and reported `eq-special-cases|construct`
 * at 0.335, put it on a named-exception list, and passed.
 *
 * Round 3 fixes the strategy AND the granularity. The leak is not in the form and it is not even
 * in the knowledge point: it is in individual GENERATOR FAMILIES. `expr-anatomy.coefficient` asks
 * for the coefficient of a bare x and the answer is 1, forever; `expr-anatomy.term` sits in the
 * same cell and is honest work. Twenty-odd families across the shipped bank have a single
 * memorised answer, and the engine now refuses exactly those, by name, at that granularity.
 *
 * PART A2 measures it end to end: items from `ItemBank.select()`, strings from `ItemBank.accepts()`,
 * verdicts from `ItemBank.check()`. `generate` MUST go through the checker rather than through a
 * count of canonical answers, because generate items are marked against a PROPERTY — counting
 * answers says `expr-anatomy|generate` is flukeable at 0.011 and running the checker says one
 * three-term expression satisfies 95% of the pool. A sensitivity sweep still prints what the
 * result would be if the constant were wrong by 3x, 6x, 8x and 17x.
 *
 * RULE 2 — A HARNESS THAT ONLY EVER PRINTS ZEROS IS MEASURING NOTHING
 *
 * Every zero in this file is paired with a CONTROL that must be non-zero. `legacyRetention`
 * restores exactly one line of the round-1 engine — M4 counting the caller's raw `correct` flag
 * instead of the engine's own `credited` verdict — and runs the identical bot against it. If that
 * arm does not certify, this file cannot see the defect it claims to have fixed and the run fails.
 * =============================================================================================
 *
 * MODELLING ASSUMPTIONS. All of them flatter or penalise the design in ways a critic can attack,
 * so all of them are stated.
 *
 *  A1  BKT parameters are correctly specified for the median learner. Individual learners differ
 *      by an ability multiplier on the learn rate and on the prior odds.
 *  A2  Item difficulty modulates the response beyond plain BKT: an over-pitched item raises the
 *      effective slip, an under-pitched one raises the effective guess.
 *  A3  An item on a band-3-or-harder node also exercises that node's direct prerequisites and so
 *      pays them credit at weight 0.5. Bands 1-2 are atomic. (This is the engine's default until
 *      P17 tags items with `exercises`; it is the assumption most likely to flatter the design.)
 *  A4  46 s per unscaffolded item; scaffolded items cost `phases.secondsPerItemByPhase`.
 *  A5  One session per day, so every 12-hour retention gate is reachable the following session.
 *  A6  Unlocking is monotone. The world never re-locks behind a learner.
 *  A7  A HUMAN who has not acquired a skill is not a blind responder — they have partial knowledge,
 *      and the model's `guess` stands in for it. A BOT has none and draws from the TRUE blind
 *      rates. Conflating the two is the failure this file is built to avoid.
 *  A8  The hostile `formHunter` arm assumes an item bank that has gone wrong in the worst
 *      plausible way: it reads a diagnostic signature, sees a closed question, and ships `judge2`.
 *      The engine's only defence is the form gate. That is what the arm tests.
 *  A9  A scaffold helps a human as well as a bot, and by at least the scaffold's blind rate.
 *      Bots never use this line; they draw from the blind rates alone.
 *  B1  `hintAbuser` idles past `antiGuessing.hintSurfaceMs` on every acquisition item and takes
 *      whatever the phase gives it, reporting `hinted` honestly.
 *  B2  `hintLeak` additionally models P18 shipping the hint surface into `solo` BY MISTAKE during
 *      ACQUISITION, where the engine is never told: 0.85 true success, reported unhinted.
 *  B3  **DELETED.** Round 1 of this script asserted that the leak in B2 "stops at acquisition"
 *      because `model.spacing` states `hinted: false` three times. That was wrong, and it was the
 *      assumption that hid the biggest defect in the piece: the JSON field only seeds
 *      `req.hinted`, while §6.1 is explicit that `hinted` is a PER-RESPONSE fact reported by the
 *      world precisely because P18 can surface help where the phase says it should not. The case
 *      the assumption excused is now an arm — `retentionHintLeak` — and a second one,
 *      `retentionFast`, does the same through the latency floor. Both are the cases that break;
 *      neither is excused.
 *  B4  **RETIRED, AND IT WAS WRONG.** It read: "a blind responder knows the shape of the answer
 *      and picks uniformly inside that shape; that is the BEST case for a guesser". Picking
 *      uniformly inside a shape is not the best case, it is barely a strategy — it is beaten by
 *      typing the same string every time, which needs no algebra and no shape knowledge either.
 *      The gap between the two is a factor of 400 on `eq-special-cases|repair`. Both are measured
 *      now and both are printed, and the pricing follows the larger one.
 *  B5  A blind responder may repeat. It sees a knowledge point dozens of times across twenty-two
 *      sessions, so "the answer that wins most often in this pool" is a strategy available to it
 *      within a handful of items. A responder that could beat best-fixed-answer would have to
 *      know something about the mathematics, at which point it is not guessing.
 *  B6  The LIVE arms have no success-rate parameter at all: the Scheduler names a knowledge point
 *      and a form, `ItemBank.select()` produces the item a player would see, the bot types a
 *      string, and `ItemBank.check()` decides. Their success rates are OUTPUTS of the run and are
 *      printed as such. This is the arm that answers the finding that "the simulation set the
 *      bot's true success rate equal to the model's own guess parameter" — there is no rate to set.
 *  B7  A presenter honours `req.avoidFamilies`. `ItemBank.select()` has no family filter, so
 *      honouring it means draw-and-reject, which the live arms do by hand. When no compliant item
 *      can be drawn the item is served with its family reported honestly and the ENGINE refuses
 *      it, so a presenter that cannot comply costs the learner time but never buys credit.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";

import { Graph, GraphError } from "../../app/src/learn/Graph.js";
import {
  Mastery,
  bktUpdate,
  REVIEW_LAPSE_BELOW,
  auditBlindGuessing,
  collectBankSample,
  bankAuditFingerprint,
  canonicalKey,
  BANK_AUDIT_PER_CELL,
  BANK_AUDIT_WINDOW,
  BANK_AUDIT_VERSION,
} from "../../app/src/learn/Mastery.js";
import { Scheduler, virtualClock, mulberry32 } from "../../app/src/learn/Scheduler.js";
import { ItemBank } from "../../app/src/learn/ItemBank.js";
import { BANK } from "../../content/items/index.mjs";
import { generateOne, TIERS } from "../../content/items/generators.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "..", "..");
const source = JSON.parse(readFileSync(resolve(ROOT, "content/knowledge-graph.json"), "utf8"));

const argNum = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split("=")[1]) : dflt;
};
const hasFlag = (name) => process.argv.includes(`--${name}`);

const LEARNERS = argNum("learners", 400);
const BOTS = argNum("bots", 400);
const SWEEP_BOTS = argNum("sweepBots", 150);
/**
 * Items drawn per (kp x form) cell for the LIVE measurement in PART A2. Defaults to the same
 * `BANK_AUDIT_PER_CELL` the shipped engine audits at, so the two are directly comparable and the
 * agreement check in U34 is a statement about method rather than about sample size.
 */
const BLIND_N = argNum("blind", BANK_AUDIT_PER_CELL); // retained for --blind compatibility; PART A2 measures the served stream
/**
 * 22 sessions x 25 min is the budget `review/p03/mastery-sim.mjs` defaults to and the budget its
 * committed evidence file was generated at. §5 of design/learning-architecture.md says "18
 * sessions" in its prose and then quotes the 22-session numbers. This script measures at 22, and
 * PART D reports the 18-session row of §8 as its own line with its real value, PASS or MISS.
 */
const SESSIONS = argNum("sessions", 22);
const LONG_SESSIONS = argNum("longSessions", 24);
const SESSION_MINUTES = argNum("sessionMinutes", 25);
const STRICT = hasFlag("strict");
const CURVE = [12, 16, 18, 20, 22, 24];

const GRAPH = new Graph(source);
const M = GRAPH.model;

/**
 * THE AUDIT THE SHIPPED GAME PRICES ON — read from the committed table, not recomputed here.
 *
 * `app/src/learn/bank-audit.json` is what `app/src/boot/62-learning.js` hands `Mastery`, so it is
 * what every claim below has to be measured against. Recomputing it in this file would prove the
 * function, not the game. U37 recomputes it anyway and fails if the committed table differs by so
 * much as one field, which is the check that keeps the two identical.
 */
const AUDIT_BANK = new ItemBank();
const AUDIT_MARK = {
  mark: (item, response) => AUDIT_BANK.check(item, response).correct === true,
  spell: (item) => AUDIT_BANK.accepts(item)[0],
};
const AUDIT_PATH = resolve(ROOT, "app/src/learn/bank-audit.json");
const AUDIT = JSON.parse(readFileSync(AUDIT_PATH, "utf8"));
/** A pricing table with the bank term switched OFF, so the two DECLARED axes can be read alone. */
const ZERO_AUDIT = {
  families: Object.fromEntries(
    Object.keys(AUDIT.families).map((k) => [k, { n: 1000, distinct: 1000, rate: 0, upper: 0, modalAnswer: null, executed: true }])
  ),
  cells: Object.fromEntries(Object.keys(AUDIT.cells).map((c) => [c, { n: 1000, distinct: 1000, rate: 0, upper: 0, modalAnswer: null, executed: true }])),
  notExecuted: [],
};
const TOTAL = GRAPH.ids.length;
const NEED80 = Math.ceil(0.8 * TOTAL); // 26 of 32
const BAND = Object.fromEntries(M.bands.map((b) => [b.difficulty, b]));
const TRUE_FORM = Object.fromEntries(Object.entries(M.trueGuessByForm).filter(([, v]) => typeof v === "number"));
const TRUE_PHASE = Object.fromEntries(Object.entries(M.trueGuessByPhase).filter(([, v]) => typeof v === "number"));
const UNSCORED_FORMS = M.forms.unscored;
const SCORED_FORMS = M.forms.scored;
/** Kinds that acquire the material the way a person does. Everything else answers blind. */
const HONEST_KINDS = new Set(["median", "mixed", "retentionHintLeak", "retentionFast", "liveMedian"]);

// -------------------------------------------------------------------------------- thresholds
/** Every claim this script makes, with the number it has to beat. A critic edits nothing else. */
const CLAIMS = [];
const claim = (id, gate, statement, get) => CLAIMS.push({ id, gate, statement, get });

// ---------------------------------------------------------------------------------- helpers

const gauss = (rng) => Math.sqrt(-2 * Math.log(Math.max(rng(), 1e-12))) * Math.cos(2 * Math.PI * rng());
const pct = (x) => `${(100 * x).toFixed(1)}%`;
const f = (x, n = 4) => (Number.isFinite(x) ? x.toFixed(n) : String(x));
const percentile = (sorted, q) => {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
};
const sha = (obj) => createHash("sha256").update(JSON.stringify(obj)).digest("hex").slice(0, 16);
/** Wilson 95% upper bound. A measured 0 of 6400 is not "zero"; it is "below 0.0006". */
const wilsonUpper = (hits, n) => {
  if (!n) return 1;
  const z = 1.959964;
  const p = hits / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const s = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return (c + s) / d;
};
/** Wilson 95% LOWER bound. "This cell is definitely above the cap" needs this one, not the point. */
const wilsonLower = (hits, n) => {
  if (!n) return 0;
  const z = 1.959964;
  const p = hits / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const s = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return Math.max(0, (c - s) / d);
};
const out = [];
const say = (s = "") => out.push(s);

// ======================================================================= PART A — assertions
//
// Deterministic, closed-form or single-path checks. No sampling, no noise: each of these is a
// property of the engine that either holds or does not.

const asserts = [];
const check = (id, statement, fn) => {
  let ok = false;
  let detail = "";
  try {
    const r = fn();
    ok = r === true || (r && r.ok === true);
    detail = (r && r.detail) || "";
  } catch (err) {
    ok = false;
    detail = String(err?.message || err).split("\n")[0];
  }
  asserts.push({ id, statement, ok, detail });
  return ok;
};

/** A fresh engine with a virtual clock and no persistence, for single-path assertions. */
function bench({ seed = 1, sessionMinutes = SESSION_MINUTES, SchedulerClass = Scheduler } = {}) {
  const clock = virtualClock(0);
  const mastery = new Mastery(GRAPH, { bankAudit: AUDIT, now: () => clock.minutes(), emit: () => {}, storage: null });
  const sched = new SchedulerClass(mastery, { clock, rng: mulberry32(seed), sessionMinutes });
  sched.beginSession();
  return { clock, mastery, sched };
}

const snapOf = (m, id) => {
  const s = m.stateOf(id);
  return { p: s.p, scored: s.scored, atBand: s.atBand, forms: [...s.forms].join(","), status: s.status };
};

/**
 * ROUND-1 ENGINE, ONE LINE OF IT. `Scheduler.submit` used to run
 * `if (outcome.correct) this._event.right += 1;` — the CALLER's raw flag — and `_finishEvent`
 * fed that straight into M4. This subclass puts that line back and nothing else, so every "0"
 * elsewhere in this file has a control that must be non-zero.
 */
class LegacyCountingScheduler extends Scheduler {
  constructor(...a) {
    super(...a);
    this._rawRight = 0;
  }
  submit(req, outcome) {
    if (this._event && req.mode === this._event.mode && outcome.correct) this._rawRight += 1;
    return super.submit(req, outcome);
  }
  _finishEvent() {
    const ev = this._event;
    if (ev && ev.mode === "retention") {
      const tally = this.mastery.eventOf(ev.kpId);
      if (tally) tally.right = this._rawRight; // <- the defect, restored verbatim
    }
    this._rawRight = 0;
    return super._finishEvent();
  }
}

/**
 * Put one node on the doorstep of M4 and let the REAL Scheduler serve the real retention check.
 * Nothing here reaches inside the gate: the four items come from `next()` and are answered
 * through `submit()`, which is the only path the world has.
 */
const RET_KP = "var-meaning";
function retentionRun({
  correct = true,
  hinted = false,
  latencyMs = 5000,
  phaseOverride = null,
  formOverride = null,
  SchedulerClass = Scheduler,
  abandonAfter = null,
} = {}) {
  const clock = virtualClock(0);
  const mastery = new Mastery(GRAPH, { bankAudit: AUDIT, now: () => clock.minutes(), emit: () => {}, storage: null });
  const sched = new SchedulerClass(mastery, { clock, rng: mulberry32(11), sessionMinutes: 600 });
  const s = mastery.stateOf(RET_KP);
  s.p = 0.99;
  s.status = "provisional";
  s.everUnlocked = true;
  s.scored = 6;
  s.atBand = 3;
  s.forms = ["construct", "repair"];
  s.consolidated = true;
  s.provisionalAt = 0;
  s.provisionalSession = 0;
  s.nextEventAt = 0;
  clock.set(24 * 60); // past the 12 h gate
  sched.beginSession(); // the intervening session
  const served = [];
  for (let i = 0; i < 4; i++) {
    const req = sched.next();
    if (!req || req.mode !== "retention") return { mastery, sched, served, error: `item ${i} was ${req ? req.mode : "null"}` };
    if (phaseOverride) req.phase = phaseOverride;
    if (formOverride) req.form = formOverride;
    if (abandonAfter != null && i === abandonAfter) return { mastery, sched, served, abandoned: true };
    const r = sched.submit(req, { correct, hinted, latencyMs, itemId: `${RET_KP}#ret${i}` });
    served.push({ phase: req.phase, form: req.form, scored: r.scored, credited: r.credited, reason: r.reason });
  }
  return {
    mastery,
    sched,
    served,
    status: mastery.status(RET_KP),
    lapses: mastery.stateOf(RET_KP).lapses,
    refusedUpward: mastery.stats.refusedUpward,
    scoredCounter: mastery.stateOf(RET_KP).scored,
  };
}

/**
 * FEED THE GRAPH A CYCLE. Three shapes, because "it throws on one hand-made two-cycle" is not the
 * same claim as "a cyclic prerequisite relation cannot reach the runtime". Each one must throw
 * `GraphError`, must say CYCLIC, and must PRINT THE ACTUAL LOOP — a validator that says
 * "graph is invalid" and stops is a validator an author cannot act on. The last case also checks
 * that construction fails BEFORE the memoised closures are built: `ancestors()` recurses through
 * the prerequisite relation, and on a cycle that is the infinite regress the check exists to stop.
 */
check("U1", "Graph validates the real content and rejects a cyclic graph, naming the loop", () => {
  new Graph(source); // must not throw
  const shapes = [
    { name: "2-cycle", apply: (g) => (g.nodes.find((n) => n.id === "var-meaning").prerequisites = ["expr-anatomy"]) },
    {
      name: "3-cycle",
      apply: (g) => {
        g.nodes.find((n) => n.id === "var-meaning").prerequisites = ["like-terms-id"];
        g.nodes.find((n) => n.id === "like-terms-id").prerequisites = ["oo-structure"];
        g.nodes.find((n) => n.id === "oo-structure").prerequisites = ["var-meaning"];
      },
    },
    { name: "self-loop", apply: (g) => (g.nodes.find((n) => n.id === "eq-two-step").prerequisites = ["eq-two-step"]) },
  ];
  const seen = [];
  for (const shape of shapes) {
    const broken = structuredClone(source);
    shape.apply(broken);
    let threw = null;
    try {
      new Graph(broken);
    } catch (e) {
      threw = e;
    }
    if (!(threw instanceof GraphError)) return { ok: false, detail: `${shape.name}: did not throw GraphError` };
    const line = threw.issues.find((i) => i.includes("CYCLIC"));
    if (!line) return { ok: false, detail: `${shape.name}: threw without saying CYCLIC — ${threw.message}` };
    // The message has to carry the loop itself, written out with the arrow, not just a verdict.
    if (!line.includes("<-")) return { ok: false, detail: `${shape.name}: cycle not written out — ${line}` };
    // And the engine above it must refuse too, from the same source, for the same reason.
    let masteryThrew = false;
    try {
      new Mastery(broken, { bankAudit: AUDIT, storage: null, emit: () => {} });
    } catch {
      masteryThrew = true;
    }
    if (!masteryThrew) return { ok: false, detail: `${shape.name}: Mastery accepted a cyclic graph` };
    seen.push(`${shape.name}: ${line.replace("prerequisite relation is CYCLIC: ", "")}`);
  }
  return { ok: true, detail: seen.join(" | ") };
});

check("U2", "prerequisite closure, frontier and topological order are correct", () => {
  const anc = GRAPH.ancestors("eq-two-step");
  const need = ["eq-one-add", "eq-one-mult", "eval-signed", "props-equality", "eq-meaning", "eval-substitute", "oo-structure"];
  for (const n of need) if (!anc.has(n)) return { ok: false, detail: `ancestors(eq-two-step) missing ${n}` };
  const order = GRAPH.topoOrder();
  if (order.length !== TOTAL) return { ok: false, detail: "topological order is short" };
  for (const n of GRAPH.nodes)
    for (const p of n.prerequisites)
      if (order.indexOf(p) > order.indexOf(n.id)) return { ok: false, detail: `${p} sorted after ${n.id}` };
  const { mastery } = bench();
  const front = mastery.frontier().join(",");
  return { ok: front === "var-meaning,oo-numeric", detail: `frontier at t0 = ${front}` };
});

check("U3", "a judge2 item is INERT: p, scored, atBand, forms and theta all unchanged", () => {
  const { mastery } = bench();
  const before = snapOf(mastery, "like-terms-id");
  const theta0 = mastery.theta;
  const r = mastery.respond({ kpId: "like-terms-id", form: "judge2", phase: "solo", correct: true, mode: "acquire" });
  const after = snapOf(mastery, "like-terms-id");
  const same = JSON.stringify(before) === JSON.stringify(after) && mastery.theta === theta0 && r.scored === false;
  return { ok: same, detail: `scored=${r.scored} reason=${r.reason} p ${f(before.p)} -> ${f(after.p)}` };
});

check("U4", "a select4 item is INERT, correct or wrong", () => {
  const { mastery } = bench();
  const before = JSON.stringify(snapOf(mastery, "like-terms-id"));
  for (const correct of [true, false, true, true, true, true, true, true])
    mastery.respond({ kpId: "like-terms-id", form: "select4", phase: "solo", correct, mode: "acquire" });
  const after = JSON.stringify(snapOf(mastery, "like-terms-id"));
  return { ok: before === after && mastery.stats.unscoredItems === 8, detail: `unscored=${mastery.stats.unscoredItems}` };
});

check("U5", "an unscored PHASE (model / guided-2 / guided-3) is inert in BOTH directions", () => {
  for (const phase of ["model", "guided-2", "guided-3"]) {
    for (const correct of [true, false]) {
      const { mastery } = bench();
      const before = JSON.stringify(snapOf(mastery, "eq-two-step"));
      const r = mastery.respond({ kpId: "eq-two-step", form: "construct", phase, correct, mode: "acquire" });
      if (r.scored !== false) return { ok: false, detail: `${phase}/${correct} was scored` };
      if (JSON.stringify(snapOf(mastery, "eq-two-step")) !== before)
        return { ok: false, detail: `${phase}/${correct} moved the state` };
    }
  }
  return true;
});

check("U6", "guided-1 IS scorable but is NOT mastery-eligible (M2/M3 counters stay put)", () => {
  const { mastery } = bench();
  const before = snapOf(mastery, "eq-two-step");
  const r = mastery.respond({ kpId: "eq-two-step", form: "construct", phase: "guided-1", correct: true, mode: "acquire" });
  const after = snapOf(mastery, "eq-two-step");
  const moved = after.p > before.p;
  const counted = after.scored !== before.scored || after.atBand !== before.atBand || after.forms !== before.forms;
  return {
    ok: r.scored === true && r.masteryEligible === false && r.credited === false && moved && !counted,
    detail: `p ${f(before.p)} -> ${f(after.p)}, scored ${before.scored} -> ${after.scored}, credited=${r.credited}`,
  };
});

check("U7", "the two axes compose by MAX, never by product", () => {
  const { mastery } = bench();
  const b1 = BAND[1];
  // Read on a table with the bank term zeroed, so the two DECLARED axes are visible alone; the
  // third axis is then read on the real table, where it must also compose by MAX and never lower
  // a price. `eq-both-sides|construct` is the cell that exercises it: band-4 guess 0.08 against a
  // measured blind rate that the bank puts well above it.
  const KP = "var-meaning";
  const declared = new Mastery(GRAPH, { bankAudit: ZERO_AUDIT, storage: null, emit: () => {} });
  const g = declared.modelledGuess(KP, b1, "construct", "guided-1");
  const gg = declared.modelledGuess(KP, b1, "generate", "guided-1");
  const t = declared.trueGuess(KP, "construct", "guided-3");
  const solo = declared.modelledGuess(KP, BAND[3], "generate", "solo");
  const okMax = Math.abs(g - 0.05 * 2) < 1e-12 && Math.abs(gg - 0.05 * 2) < 1e-12 && t === 0.85;

  const HOT = "eq-both-sides";
  const band4 = GRAPH.band(HOT);
  const bankRate = mastery.bankBlindRate(HOT, "construct");
  const withBank = mastery.modelledGuess(HOT, band4, "construct", "solo");
  const withoutBank = declared.modelledGuess(HOT, band4, "construct", "solo");
  // MAX on the third axis too: the bank can only ever raise a price, never lower one.
  const thirdAxis = withBank >= withoutBank - 1e-12 && withBank >= bankRate - 1e-12 && bankRate > withoutBank;
  return {
    ok: okMax && thirdAxis,
    detail:
      `b1 construct/guided-1 ${f(g)}, b1 generate/guided-1 ${f(gg)} (product would be ${f(0.05 * 0.6 * 2)}), ` +
      `true construct/guided-3 ${f(t, 2)}, b3 generate/solo ${f(solo)}; ` +
      `third axis on ${HOT}|construct: declared ${f(withoutBank, 3)}, measured blind ${f(bankRate, 3)}, priced ${f(withBank, 3)}`,
  };
});

check("U8", "an over-cap form is REJECTED from the scored path, never clamped", () => {
  const { mastery } = bench();
  const caps = M.bkt.identifiabilityCaps;
  const wouldBe = BAND[3].guess * M.guessByForm.judge2;
  const rejected = !mastery.pricing.scoredForms.has("judge2") && !mastery.pricing.scoredForms.has("select4");
  const noClamp = caps.clampTrueRates === false;
  const phasesRejected = ["model", "guided-2", "guided-3"].every((p) => !mastery.pricing.scoredPhases.has(p));
  return {
    ok: rejected && noClamp && phasesRejected,
    detail: `judge2 would model at ${f(wouldBe)} vs maxGuess ${caps.maxGuess}; scored forms {${[...mastery.pricing.scoredForms].join(",")}}, scored phases {${[...mastery.pricing.scoredPhases].join(",")}}`,
  };
});

check("U9", "the derived scorable matrix is exactly {construct,repair,generate} x {solo,guided-1}, and every issue is a NAMED content defect", () => {
  const { mastery } = bench();
  const d = mastery.pricing.description;
  // Issues are no longer expected to be empty: the bank audit reports content defects, and a
  // silent engine is exactly what let `eq-special-cases` through. What must hold is that every
  // issue is one of those reports and none is a pricing failure in the engine itself.
  const stray = mastery.issues.filter((i) => !i.startsWith("CONTENT:"));
  return {
    ok: d.scorableCells === 6 && d.masteryEligibleCells === 3 && stray.length === 0,
    detail:
      `scorable ${d.scorableCells}/25 (${d.scorable}); mastery-eligible ${d.masteryEligibleCells}/25 (${d.masteryEligible}); ` +
      `${mastery.issues.length} issue(s), all CONTENT reports${stray.length ? `; STRAY: ${stray.join(" | ")}` : ""}`,
  };
});

/**
 * "Scored normally" is a comparison, not a direction. Below the mastery threshold a WRONG answer
 * can still raise P(known), because the learning transition outruns the posterior drop — that is
 * the all-wrong BKT floor of §1.1a, not a leak. So these two assertions compare the suspicious
 * response against the honest one that should be identical to it, and against the baseline that
 * should be untouched.
 */
const one = (opts) => {
  const b = bench();
  const before = snapOf(b.mastery, "eq-two-step");
  const r = b.mastery.respond({ kpId: "eq-two-step", form: "construct", phase: "solo", mode: "acquire", ...opts });
  return { before, after: snapOf(b.mastery, "eq-two-step"), theta: b.mastery.theta, r };
};

check("U10", "latency floor: a fast CORRECT answer buys nothing; a fast WRONG one is scored exactly like a slow one", () => {
  const fastRight = one({ correct: true, latencyMs: 300 });
  const slowRight = one({ correct: true, latencyMs: 9000 });
  const fastWrong = one({ correct: false, latencyMs: 300 });
  const slowWrong = one({ correct: false, latencyMs: 9000 });
  const boughtNothing =
    JSON.stringify(fastRight.after) === JSON.stringify(fastRight.before) && fastRight.r.scored === false && fastRight.theta === M.ability.theta0;
  const wrongIsNormal = JSON.stringify(fastWrong.after) === JSON.stringify(slowWrong.after) && fastWrong.after.scored === 1;
  const slowRightDidMove = slowRight.after.p > slowRight.before.p && slowRight.after.scored === 1;
  return {
    ok: boughtNothing && wrongIsNormal && slowRightDidMove,
    detail: `fast+right ${f(fastRight.before.p)} -> ${f(fastRight.after.p)} scored=${fastRight.after.scored} (${fastRight.r.reason}); slow+right -> ${f(slowRight.after.p)} scored=${slowRight.after.scored}; fast+wrong ${f(fastWrong.after.p)} == slow+wrong ${f(slowWrong.after.p)} scored=${fastWrong.after.scored}`,
  };
});

check("U11", "hinted CORRECT is refused upward; hinted WRONG is scored exactly like an unhinted one", () => {
  const hintRight = one({ correct: true, hinted: true, latencyMs: 14000 });
  const plainRight = one({ correct: true, hinted: false, latencyMs: 14000 });
  const hintWrong = one({ correct: false, hinted: true, latencyMs: 14000 });
  const plainWrong = one({ correct: false, hinted: false, latencyMs: 14000 });
  const boughtNothing =
    JSON.stringify(hintRight.after) === JSON.stringify(hintRight.before) && hintRight.r.scored === false && hintRight.theta === M.ability.theta0;
  const wrongIsNormal = JSON.stringify(hintWrong.after) === JSON.stringify(plainWrong.after) && hintWrong.after.scored === 1;
  return {
    ok: boughtNothing && wrongIsNormal && plainRight.after.p > plainRight.before.p,
    detail: `hint+right ${f(hintRight.before.p)} -> ${f(hintRight.after.p)} scored=${hintRight.after.scored} (${hintRight.r.reason}); unhinted+right -> ${f(plainRight.after.p)}; hint+wrong ${f(hintWrong.after.p)} == unhinted+wrong ${f(plainWrong.after.p)}`,
  };
});

check("U12", "M2 counters are docked on a lapse (scored -3, atBand -2) and the ladder resets", () => {
  const { mastery } = bench();
  const s = mastery.stateOf("eq-two-step");
  s.scored = 6;
  s.atBand = 3;
  s.status = "mastered";
  s.everMastered = true;
  s.ladder = 2;
  mastery.lapse("eq-two-step", "test");
  return {
    ok: s.scored === 3 && s.atBand === 1 && s.status === "learning" && s.ladder === -1 && s.relearn === true,
    detail: `scored ${s.scored}, atBand ${s.atBand}, status ${s.status}, ladder ${s.ladder}`,
  };
});

check("U13", "M4 is a CONJUNCTION: 3-of-4 with the posterior below threshold does not certify", () => {
  const { mastery } = bench();
  const s = mastery.stateOf("eq-two-step");
  s.p = 0.9;
  const passesLow = mastery.retentionPassed("eq-two-step", 3);
  s.p = 0.97;
  const passesHigh = mastery.retentionPassed("eq-two-step", 3);
  const passesFew = mastery.retentionPassed("eq-two-step", 2);
  return {
    ok: passesLow === false && passesHigh === true && passesFew === false,
    detail: `p=0.90&3/4 -> ${passesLow}; p=0.97&3/4 -> ${passesHigh}; p=0.97&2/4 -> ${passesFew}`,
  };
});

check("U14", "the form cycle is a RUNNING index on the M2 counter, never restarted at `construct`", () => {
  const { mastery, sched } = bench();
  const s = mastery.stateOf("eq-two-step");
  const seen = [];
  for (let i = 0; i < 6; i++) {
    s.p = i < 2 ? 0.3 : 0.9; // cross cycleAbove between item 2 and item 3
    s.scored = i;
    seen.push(sched._acquisitionForm("eq-two-step"));
  }
  const want = ["construct", "construct", "generate", "construct", "repair", "generate"];
  return { ok: seen.join(",") === want.join(","), detail: seen.join(",") };
});

check("U15", "the all-wrong BKT floor invariant: one correct from the floor never clears 0.95", () => {
  const rows = [];
  for (const b of M.bands) {
    for (const [label, learn] of [
      ["normal", b.learn],
      ["relearn", Math.min(M.spacing.relearnLearnRateCap, b.learn * M.spacing.relearnLearnRateMultiplier)],
    ]) {
      let p = b.prior;
      for (let i = 0; i < 400; i++) p = bktUpdate(p, false, b.slip, b.guess, learn, 1);
      const oneMore = bktUpdate(p, true, b.slip, b.guess, learn, 1);
      rows.push({ band: b.difficulty, label, floor: p, one: oneMore });
      if (oneMore >= M.bkt.masteryThreshold)
        return { ok: false, detail: `band ${b.difficulty} ${label}: floor ${f(p)} + 1 correct = ${f(oneMore)} >= ${M.bkt.masteryThreshold}` };
    }
  }
  const worst = rows.reduce((a, r) => (r.one > a.one ? r : a));
  return { ok: true, detail: `worst cell band ${worst.band} ${worst.label}: floor ${f(worst.floor)}, +1 correct ${f(worst.one)}` };
});

check("U16", "state round-trips: snapshot -> restore reproduces the probe byte for byte", () => {
  const a = runLearner({ seed: 4242, kind: "median", sessions: 3 });
  const snap = a.mastery.snapshot();
  const clock = virtualClock(a.clock.minutes());
  const fresh = new Mastery(GRAPH, { bankAudit: AUDIT, now: () => clock.minutes(), emit: () => {}, storage: null });
  fresh.restore(JSON.parse(JSON.stringify(snap)));
  const same = sha(a.mastery.probe()) === sha(fresh.probe());
  return { ok: same, detail: `probe hash ${sha(a.mastery.probe())} vs ${sha(fresh.probe())}` };
});

check("U17", "determinism: the same seed reproduces the same state exactly", () => {
  const a = runLearner({ seed: 777, kind: "mixed", sessions: 6 });
  const b = runLearner({ seed: 777, kind: "mixed", sessions: 6 });
  const c = runLearner({ seed: 778, kind: "mixed", sessions: 6 });
  const ha = sha(a.mastery.snapshot());
  const hb = sha(b.mastery.snapshot());
  const hc = sha(c.mastery.snapshot());
  return { ok: ha === hb && ha !== hc, detail: `seed 777 -> ${ha} twice; seed 778 -> ${hc}` };
});

check("U18", "a fake localStorage round-trips a session (state resumes)", () => {
  const store = new Map();
  const fake = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  const clock = virtualClock(0);
  const m1 = new Mastery(GRAPH, { bankAudit: AUDIT, now: () => clock.minutes(), emit: () => {}, storage: fake });
  m1.respond({ kpId: "var-meaning", form: "construct", phase: "solo", correct: true, mode: "acquire", latencyMs: 5000 });
  m1.persist();
  const m2 = new Mastery(GRAPH, { bankAudit: AUDIT, now: () => clock.minutes(), emit: () => {}, storage: fake });
  const hydrated = m2.hydrate();
  return { ok: hydrated && Math.abs(m1.p("var-meaning") - m2.p("var-meaning")) < 1e-15, detail: `p ${f(m1.p("var-meaning"))} -> ${f(m2.p("var-meaning"))}` };
});

// ------------------------------------------------------- THE GATE THAT GRANTS MASTERY (M4)
//
// U19-U24 are the assertions that did not exist in round 1 and that the round-1 engine fails.
// Everything above this line was already true; the leak lived here, at the one transition that
// moves a knowledge point into the only state that counts toward the Level 1 percentage.

check("U19", "M4 baseline: four honest, unhinted, unhurried corrects DO certify", () => {
  const r = retentionRun({});
  return { ok: r.status === "mastered" && r.lapses === 0, detail: `status ${r.status}, lapses ${r.lapses}, credited ${r.served.filter((x) => x.credited).length}/4` };
});

check("U20", "M4 refuses a HINTED correct: four hinted corrects certify NOTHING and lapse the node", () => {
  const r = retentionRun({ hinted: true, latencyMs: 14000 });
  return {
    ok: r.status === "learning" && r.lapses === 1 && r.refusedUpward === 4 && r.served.every((x) => x.credited === false),
    detail: `status ${r.status}, lapses ${r.lapses}, refusedUpward ${r.refusedUpward}, reasons ${[...new Set(r.served.map((x) => x.reason))].join("|")}, M2 docked to ${r.scoredCounter}`,
  };
});

check("U21", "M4 refuses a SUB-LATENCY-FLOOR correct: four 100 ms corrects certify NOTHING", () => {
  const r = retentionRun({ latencyMs: 100 });
  return {
    ok: r.status === "learning" && r.lapses === 1 && r.refusedUpward === 4,
    detail: `status ${r.status}, lapses ${r.lapses}, refusedUpward ${r.refusedUpward}, reasons ${[...new Set(r.served.map((x) => x.reason))].join("|")}`,
  };
});

check("U22", "M4 refuses a SCAFFOLDED correct: retention forced to guided-1 is scorable but not credited", () => {
  const r = retentionRun({ phaseOverride: "guided-1" });
  const scored = r.served.filter((x) => x.scored).length;
  return {
    ok: r.status === "learning" && r.lapses === 1 && scored === 4 && r.served.every((x) => x.credited === false),
    detail: `status ${r.status}, lapses ${r.lapses}, scored ${scored}/4 but credited ${r.served.filter((x) => x.credited).length}/4`,
  };
});

check("U23", "CONTROL: the round-1 counting rule DOES certify the hinted arm — this harness can see the leak", () => {
  const legacy = retentionRun({ hinted: true, latencyMs: 14000, SchedulerClass: LegacyCountingScheduler });
  const shipped = retentionRun({ hinted: true, latencyMs: 14000 });
  return {
    ok: legacy.status === "mastered" && shipped.status === "learning",
    detail: `round-1 rule (M4 counts outcome.correct) -> ${legacy.status}; shipped rule (M4 counts result.credited) -> ${shipped.status}`,
  };
});

check("U24", "there is exactly ONE retention tally: the Scheduler keeps no `right` counter of its own", () => {
  const r = retentionRun({ abandonAfter: 2 });
  const evKeys = Object.keys(r.sched._event ?? {}).sort().join(",");
  const tally = r.mastery.eventOf(RET_KP);
  return {
    ok: !("right" in (r.sched._event ?? {})) && tally && tally.right === 2 && tally.served === 2,
    detail: `scheduler event keys {${evKeys}}; mastery tally served ${tally?.served} right ${tally?.right} refusedRight ${tally?.refusedRight}`,
  };
});

check("U25", "an ABANDONED retention check is a lapse, not a free re-roll", () => {
  // Round 1: the Scheduler's half of the state was never persisted, so a reload dropped a
  // half-answered check with no lapse and no M2 dock — `nextEventAt` still due, re-roll forever.
  const r = retentionRun({ correct: false, abandonAfter: 3 });
  const before = { status: r.mastery.status(RET_KP), lapses: r.mastery.stateOf(RET_KP).lapses };
  const res = r.sched.abandonEvent("test");
  const after = { status: r.mastery.status(RET_KP), lapses: r.mastery.stateOf(RET_KP).lapses, scored: r.mastery.stateOf(RET_KP).scored };
  return {
    ok: res.lapsed === true && before.status === "provisional" && after.status === "learning" && after.lapses === 1 && after.scored === 3,
    detail: `served ${res.served} then abandoned: ${before.status} -> ${after.status}, lapses ${before.lapses} -> ${after.lapses}, M2 docked 6 -> ${after.scored}`,
  };
});

check("U26", "Scheduler state survives persist -> hydrate: open check, no-repeat window and inFlight", () => {
  const store = new Map();
  const fake = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  const clock = virtualClock(0);
  const m1 = new Mastery(GRAPH, { bankAudit: AUDIT, now: () => clock.minutes(), emit: () => {}, storage: fake });
  const s1 = new Scheduler(m1, { clock, rng: mulberry32(3), sessionMinutes: 600 });
  s1.beginSession();
  for (let i = 0; i < 5; i++) {
    const req = s1.next();
    if (!req) break;
    s1.submit(req, { correct: true, latencyMs: 5000, itemId: `it${i}` });
  }
  // open a retention check and answer one item of it
  const st = m1.stateOf(RET_KP);
  Object.assign(st, { p: 0.99, status: "provisional", scored: 6, atBand: 3, forms: ["construct", "repair"], consolidated: true, provisionalAt: 0, provisionalSession: 0, nextEventAt: 0, everUnlocked: true });
  clock.set(24 * 60);
  s1.beginSession();
  const rq = s1.next();
  s1.submit(rq, { correct: true, latencyMs: 5000, itemId: "ret0" });
  m1.persist();

  const m2 = new Mastery(GRAPH, { bankAudit: AUDIT, now: () => clock.minutes(), emit: () => {}, storage: fake });
  const s2 = new Scheduler(m2, { clock, rng: mulberry32(3), sessionMinutes: 600 });
  const okHydrate = m2.hydrate();
  const sameEvent = JSON.stringify(s1._event) === JSON.stringify(s2._event);
  const sameIds = s1.recentItemIds.join(",") === s2.recentItemIds.join(",");
  const sameTally = JSON.stringify(m1.eventOf(RET_KP)) === JSON.stringify(m2.eventOf(RET_KP));
  const sameInFlight = m1.inFlight.join(",") === m2.inFlight.join(",");
  return {
    ok: okHydrate && sameEvent && sameIds && sameTally && sameInFlight && m2.status(RET_KP) === "provisional",
    detail: `event ${JSON.stringify(s2._event)}, recentItemIds ${s2.recentItemIds.length}, tally ${JSON.stringify(m2.eventOf(RET_KP))}, inFlight [${m2.inFlight.join(",")}]`,
  };
});

check("U27", "a snapshot with NO Scheduler half lapses the orphaned retention check", () => {
  const r = retentionRun({ correct: true, abandonAfter: 3 });
  const snap = JSON.parse(JSON.stringify(r.mastery.snapshot()));
  delete snap.scheduler; // exactly the round-1 snapshot shape
  const clock = virtualClock(r.sched.clock.minutes());
  const fresh = new Mastery(GRAPH, { bankAudit: AUDIT, now: () => clock.minutes(), emit: () => {}, storage: null });
  fresh.restore(snap);
  const s = fresh.stateOf(RET_KP);
  return {
    ok: s.status === "learning" && s.lapses === 1 && s.scored === 3 && s.event === null,
    detail: `restored without a scheduler half: status ${s.status}, lapses ${s.lapses}, M2 6 -> ${s.scored}`,
  };
});

check("U28", "the `mastery` probe carries `inFlight[]` at the TOP level, as §8 requirement 11 names it", () => {
  const r = retentionRun({ abandonAfter: 2 });
  const probe = r.mastery.probe();
  return {
    ok: Array.isArray(probe.inFlight) && probe.inFlight.includes(RET_KP) && Array.isArray(probe.openEvents) && probe.openEvents[0]?.right === 2,
    detail: `inFlight [${probe.inFlight.join(",")}], openEvents ${JSON.stringify(probe.openEvents)}`,
  };
});

// ============================================================ PART A2 — the REAL item bank
//
// `model.trueGuessByForm` is a hand-authored constant and the entire L5 result is a linear
// function of it. This section stops taking it on trust: it draws real items through the real
// `ItemBank.select()` and marks real response strings with the live `check()`.
//
// ROUND 2 OF THIS FILE MEASURED THE WRONG STRATEGY, and that is why it reported
// `eq-special-cases|construct` at 0.335 and shrugged. Its assumption B4 said a responder who
// "picks uniformly inside the shape of the answer" is the BEST case for a guesser. It is not. The
// best case is BEST FIXED ANSWER: type the same string every time and keep whichever string wins
// most. On `eq-special-cases|construct` the shape-uniform bot spreads itself over
// {a number, always, none} and scores 0.335; a bot that just types `always` scores 0.53. On
// `eq-special-cases|repair` the shape-uniform bot invents line numbers and scores 0.002, while
// EVERY item in that pool — catalogue and generator alike — has the single answer `3|0 = 0`, so
// typing it scores 1.00. Both strategies are run below, side by side, and the gap between them is
// printed, because the gap IS the finding. That strategy fix survives; what round 2 got wrong ON
// TOP of it was the POPULATION, and that is what the stream below replaces.

const bank = new ItemBank();

const tBank = Date.now();

// ---------------------------------------------------------------------------------------------
// THE POPULATION EVERY NUMBER BELOW IS MEASURED ON
//
// Round 2 of this file drew each cell with a rolling exclusion set SCOPED TO THAT CELL, and its
// own comment said why: "so the catalogue is exhausted and the generator fallback appears". A
// cell's committed catalogue is 12-17 items, so it was exhausted after about fifteen draws and the
// remaining 241 draws of every 256 were generator output. The game's window was 40 items GLOBAL
// across 32 interleaved knowledge points, so in play the catalogue was never exhausted at all: a
// Scheduler-driven run served 97.2% catalogue against the audit's 4.5%. Every blind rate in that
// round therefore described a bank no player was ever handed — the exact defect class RESUME §6a
// says cost this project two pieces.
//
// It is fixed on BOTH sides, and the order matters:
//
//   1. `Scheduler` now publishes a no-repeat window per (knowledge point x form) rather than one
//      global list of forty, so a cell's catalogue really is walked out and the generator really
//      does supply the rest. That is a fix to the SERVING, not to the price: a learner was being
//      shown the same handful of items for the whole curriculum, and one family measured 0.958
//      blind because a single string answered 23 of the 24 items it ever served.
//   2. `collectBankSample` draws the audit THROUGH `ItemBank.select()` under that same window, so
//      pricing and serving are the same distribution by construction.
//
// And this file no longer draws anything by hand. The population below is produced by the REAL
// `Scheduler.next()`, with `req.avoidItemIds` as the exclusion set and `req.avoidFamilies`
// honoured exactly as a presenter must, and every claim states which stream it was measured on.
// ---------------------------------------------------------------------------------------------

/** Band tier the Scheduler's logit target lands on, so `select()` gets the item the player gets. */
function bandTierFor(req) {
  const centre = GRAPH.centre(req.kpId);
  const band = GRAPH.difficulty(req.kpId);
  return Math.max(1, Math.min(5, band + Math.round((req.difficulty - centre) / 0.3)));
}

/**
 * The item the player would be shown for this request, drawn through the shipped select path and
 * honouring `req.avoidFamilies` the way a presenter is expected to. `ItemBank.select()` has no
 * family filter, so honouring it means draw-and-reject; that is a real API gap and it is worked
 * around here rather than papered over. When every draw lands in a refused family the item is
 * served anyway with its family reported honestly — and the engine then refuses it, which is the
 * behaviour that has to hold when a presenter cannot comply.
 */
function liveItemFor(req, exclude, seq) {
  const avoid = req.avoidFamilies ?? [];
  let fallback = null;
  for (let tries = 0; tries < 10; tries++) {
    const sel = bank.select({
      kpId: req.kpId,
      form: req.form,
      difficulty: bandTierFor(req),
      misconception: tries === 0 ? (req.targetMisconception ?? null) : null,
      seed: (seq * 2654435761 + 17 + tries * 104729) >>> 0,
      exclude,
    });
    if (!sel) break;
    fallback = { item: sel.item, source: sel.source };
    if (!avoid.includes(sel.item.family)) return fallback;
    exclude.add(sel.item.id);
  }
  return fallback;
}

/**
 * Drive the SHIPPED Scheduler and record every item it actually caused to be served.
 *
 * The responder is a plain median learner — it exists only to move the scheduler forward, so that
 * the request stream has the shape a real session has: acquisition blocks, consolidation, the
 * retention ladder, the form cycle, and the phase fade. Nothing about its correctness is read by
 * any claim; only the ITEMS are.
 */
function servedStream(seed, sessions = SESSIONS) {
  const rng = mulberry32(seed);
  const clock = virtualClock(0);
  const mastery = new Mastery(GRAPH, { bankAudit: AUDIT, now: () => clock.minutes(), emit: () => {}, storage: null });
  const sched = new Scheduler(mastery, { clock, rng: mulberry32(seed ^ 0x9e3779b9), sessionMinutes: SESSION_MINUTES });
  const known = new Map();
  for (const id of GRAPH.ids) known.set(id, rng() < GRAPH.band(id).prior);
  const log = [];
  let seq = 0;
  for (let s = 0; s < sessions; s += 1) {
    clock.set(s * 1440);
    sched.beginSession();
    for (;;) {
      const req = sched.next();
      if (!req) break;
      // THE GAME'S OWN RULE, verbatim: the exclusion set is whatever the request published.
      const exclude = new Set(req.avoidItemIds ?? []);
      const got = liveItemFor(req, exclude, seq);
      seq += 1;
      if (!got) break;
      log.push({ kpId: req.kpId, form: req.form, phase: req.phase, mode: req.mode, item: got.item, source: got.source });
      if (!known.get(req.kpId) && rng() < GRAPH.band(req.kpId).learn) known.set(req.kpId, true);
      sched.submit(req, {
        correct: known.get(req.kpId) ? rng() > GRAPH.band(req.kpId).slip : rng() < 0.1,
        latencyMs: 6000,
        itemId: got.item.id,
        family: got.item.family,
        response: "-",
      });
    }
    sched.endSession();
  }
  return log;
}

const STREAM_RUNS = argNum("streamRuns", 24);
/** THE STREAM. Every blind rate in PART A2 is measured on this and on nothing else. */
const SERVED = [];
for (let i = 0; i < STREAM_RUNS; i += 1) SERVED.push(...servedStream(20260810 + i * 7919));
const SERVED_CATALOGUE = SERVED.filter((r) => r.source === "catalogue").length;
const SERVED_SHARE = SERVED.length ? SERVED_CATALOGUE / SERVED.length : 0;

/** Every response string a blind responder could sensibly commit to for a whole cell. */
function constantCandidates(items) {
  const byAnswer = new Map();
  for (const it of items) {
    const key = canonicalKey(it);
    if (!byAnswer.has(key)) byAnswer.set(key, { item: it, n: 0 });
    byAnswer.get(key).n += 1;
  }
  const ranked = [...byAnswer.values()].sort((a, b) => b.n - a.n).slice(0, 8);
  // The spelling comes from `ItemBank.accepts()`, so every candidate is a string the shipped
  // checker documents as typable. A candidate the parser rejects would understate the guesser.
  const strings = new Set();
  for (const r of ranked) {
    const acc = bank.accepts(r.item);
    if (acc && acc.length) strings.add(String(acc[0]));
  }
  // Plus the zero-knowledge staples, which cost nothing to try and which a real teenager tries.
  for (const s of ["0", "1", "x", "x = 0", "always", "none"]) strings.add(s);
  return [...strings];
}

const OVER_CAP = M.bkt.identifiabilityCaps.maxTrueGuess; // 0.30
const TRIPWIRE = 0.1; // §9's first named tripwire

/** The SHIPPED pricing table, built from the COMMITTED `AUDIT`. Everything below is measured against it. */
const AUDIT_PRICING = new Mastery(GRAPH, { bankAudit: AUDIT, storage: null, emit: () => {} });

const markOne = (item, s) => {
  try {
    return bank.check(item, s).correct === true;
  } catch {
    return false; // an unreadable response is simply wrong
  }
};

/**
 * BEST FIXED ANSWER, chosen on one half of the stream and SCORED ON THE OTHER.
 *
 * Picking the winning string and reporting its hit rate on the same items is an in-sample maximum
 * over a dozen candidates, and it is biased upward by exactly the amount a critic will (correctly)
 * subtract. The split is deterministic — alternate items in served order — so the number below is
 * an honest out-of-sample estimate of what a guesser who has watched this cell for a while gets on
 * the next item, and its Wilson bounds mean something.
 */
function splitHalfBest(items) {
  const choose = items.filter((_, i) => i % 2 === 0);
  const score = items.filter((_, i) => i % 2 === 1);
  if (!choose.length || !score.length) return { n: 0, hits: 0, rate: 0, upper95: 1, answer: null, nChoose: choose.length };
  let best = { hits: -1, answer: null };
  for (const candidate of constantCandidates(choose)) {
    let h = 0;
    for (const item of choose) if (markOne(item, candidate)) h += 1;
    if (h > best.hits) best = { hits: h, answer: candidate };
  }
  let hits = 0;
  for (const item of score) if (markOne(item, best.answer)) hits += 1;
  return { n: score.length, hits, rate: hits / score.length, upper95: wilsonUpper(hits, score.length), answer: best.answer, nChoose: choose.length };
}

/** In-sample best fixed answer over a pool. Reported alongside, never used as a bar. */
function bestFixed(items) {
  let hits = 0;
  let answer = null;
  for (const candidate of constantCandidates(items)) {
    let h = 0;
    for (const item of items) if (markOne(item, candidate)) h += 1;
    if (h > hits) {
      hits = h;
      answer = candidate;
    }
  }
  return { n: items.length, hits, rate: items.length ? hits / items.length : 0, upper95: wilsonUpper(hits, items.length), answer };
}

// ---- group the STREAM by cell and by (cell x family)
//
// TWO cell-level populations, because they answer two different questions and only one of them is
// a bar. `servedByCell` is everything the Scheduler caused to be shown. `creditableByCell` drops
// the items whose family the engine has REFUSED — those produce no BKT update however they are
// answered (U42 proves it on this very stream), so including them in the number the price has to
// dominate would be asking the price to cover items it never prices. Both are printed.
const servedByCell = new Map();
const creditableByCell = new Map();
const servedByFamily = new Map();
let refusedFamilyServed = 0;
for (const r of SERVED) {
  const cell = `${r.kpId}|${r.form}`;
  if (!servedByCell.has(cell)) servedByCell.set(cell, []);
  servedByCell.get(cell).push(r.item);
  const fam = `${cell}|${r.item.family ?? "(unfamilied)"}`;
  if (!servedByFamily.has(fam)) servedByFamily.set(fam, []);
  servedByFamily.get(fam).push(r.item);
  if (AUDIT_PRICING.refusedFamilies(r.kpId, r.form).includes(r.item.family)) {
    refusedFamilyServed += 1;
    continue;
  }
  if (!creditableByCell.has(cell)) creditableByCell.set(cell, []);
  creditableByCell.get(cell).push(r.item);
}

/**
 * measuredServed[`${kp}|${form}`] — the number the pricing has to survive. Real items, in the order
 * the real Scheduler caused them to be served; real strings from `accepts()`; real verdicts from
 * `check()`. No model parameter is read anywhere in this loop.
 */
const measuredServed = {};
/** The same over EVERYTHING served, refused families included. Reported, never used as a bar. */
const measuredAll = {};
const measuredBest = {};
const measuredByType = {};
const MIN_CELL_N = argNum("minCellN", 30);
for (const [cell, items] of servedByCell) {
  const types = [...new Set(items.map((i) => i.answerType))].join("/");
  const creditable = creditableByCell.get(cell) ?? [];
  measuredAll[cell] = { ...splitHalfBest(items), types, served: items.length };
  measuredServed[cell] = { ...splitHalfBest(creditable), types, served: creditable.length };
  measuredBest[cell] = { ...bestFixed(creditable.length ? creditable : items), types };
  for (const item of items) {
    const t = `${cell.split("|")[1]}/${item.answerType}`;
    measuredByType[t] = measuredByType[t] ?? { n: 0, hits: 0, best: 0 };
    measuredByType[t].n += 1;
  }
  const t = `${cell.split("|")[1]}/${items[0].answerType}`;
  measuredByType[t].best = Math.max(measuredByType[t].best, measuredBest[cell].rate);
}
/** The same, per family, so a refusal can be checked at the granularity the engine makes it at. */
const measuredFamily = {};
for (const [key, items] of servedByFamily) measuredFamily[key] = { ...splitHalfBest(items), served: items.length };

/**
 * Per FORM, two numbers, because they answer two different questions and round 2 printed only the
 * flattering one. `pooled` is what a guesser gets spraying the form across all 32 knowledge
 * points. `worstCell` is what a guesser gets after ten minutes of noticing which knowledge point
 * is soft — which is the number a mastery gate has to survive.
 */
const measuredByForm = {};
for (const form of SCORED_FORMS) {
  let n = 0;
  let hits = 0;
  let worst = 0;
  let worstCell = null;
  for (const [cell, m] of Object.entries(measuredServed)) {
    if (!cell.endsWith(`|${form}`)) continue;
    n += m.n;
    hits += m.hits;
    if (m.rate > worst) {
      worst = m.rate;
      worstCell = cell;
    }
  }
  measuredByForm[form] = { n, hits, rate: n ? hits / n : 0, upper95: wilsonUpper(hits, n), worst, worstCell };
}

const bankMs = Date.now() - tBank;

/** Cells the shipped bank actually gives away, worst first. This is the table that got re-priced. */
const hotCells = Object.entries(measuredServed)
  .map(([k, v]) => ({ cell: k, ...v }))
  .filter((r) => r.rate > TRIPWIRE)
  .sort((a, b) => b.rate - a.rate);
const overCapCells = hotCells.filter((r) => r.n >= MIN_CELL_N && wilsonLower(r.hits, r.n) > OVER_CAP);

/** What the SHIPPED ENGINE priced, for the same cells. */
const enginePricing = AUDIT_PRICING;

/**
 * THE CHECK THE WHOLE ROUND EXISTS FOR.
 *
 * Measured on: the Scheduler-driven SERVED stream defined above (`STREAM_RUNS` runs of `SESSIONS`
 * sessions, median learner), split-half, scored out of sample.
 */
check("U29", "no scored cell is credited at a modelled guess below what the SERVED stream measurably gives away", () => {
  const bad = [];
  let checked = 0;
  for (const [cell, m] of Object.entries(measuredServed)) {
    const [kpId, form] = cell.split("|");
    if (!enginePricing.isScorable(kpId, form, "solo")) continue; // refused: the other half of the rule
    if (m.n < MIN_CELL_N) continue;
    checked += 1;
    const priced = enginePricing.modelledGuess(kpId, GRAPH.band(kpId), form, "solo");
    // The live measurement has sampling error of its own, so the bar is its 95% LOWER bound:
    // "the blind rate here is at least this, and the engine still prices it below that".
    const floor = wilsonLower(m.hits, m.n);
    if (priced + 1e-9 < floor) bad.push(`${cell} served ${f(m.rate, 3)} (>=${f(floor, 3)}, "${m.answer}") priced ${f(priced, 3)}`);
  }
  const lifted = Object.keys(measuredServed).filter((c) => {
    const [kpId, form] = c.split("|");
    return (
      enginePricing.isScorable(kpId, form, "solo") &&
      enginePricing.modelledGuess(kpId, GRAPH.band(kpId), form, "solo") > GRAPH.band(kpId).guess * (M.guessByForm[form] ?? 1) + 1e-12
    );
  }).length;
  return {
    ok: bad.length === 0,
    detail: bad.length
      ? `UNDER-PRICED: ${bad.join("; ")}`
      : `${checked} scored cells with n>=${MIN_CELL_N} on the SERVED stream (${SERVED.length} items, ${pct(SERVED_SHARE)} catalogue); ` +
        `${enginePricing.cellPricing.description.rejectedCells.length} refusals; ${lifted} re-priced upward; none credited below its measured blind rate`,
  };
});

/**
 * Every cell above `maxTrueGuess` must be REJECTED from the scored path for that knowledge point —
 * not clamped, not declared, not absorbed into a named-exception list. `KNOWN_HOT_CELLS` is gone on
 * purpose: an exception list is how `eq-special-cases|construct` sat at 0.335 through a passing run.
 *
 * Measured on: the SERVED stream, split-half, 95% LOWER bound, which is the bar the round-2 critic
 * named verbatim and the bar `expr-anatomy|repair` (0.462, lo 0.370) and `eval-signed|generate`
 * (0.494, lo 0.388) failed.
 */
check("U30", "after the refusals, no cell the player is still SERVED is definitely above maxTrueGuess", () => {
  const wrong = [];
  for (const [cell, m] of Object.entries(measuredServed)) {
    const [kpId, form] = cell.split("|");
    if (!enginePricing.isScorable(kpId, form, "solo")) continue;
    if (m.n < MIN_CELL_N) continue;
    if (wilsonLower(m.hits, m.n) > OVER_CAP)
      wrong.push(`${cell} is at least ${f(wilsonLower(m.hits, m.n), 3)} blind on the served stream ("${m.answer}") and is still scored`);
  }
  const stillHot = Object.entries(measuredServed).filter(([c, m]) => {
    const [kpId, form] = c.split("|");
    return enginePricing.isScorable(kpId, form, "solo") && m.n >= MIN_CELL_N;
  });
  const worst = stillHot.sort((a, b) => b[1].rate - a[1].rate)[0];
  return {
    ok: wrong.length === 0,
    detail: wrong.length
      ? wrong.join("; ")
      : `${enginePricing.cellPricing.description.rejectedCells.length} refusals; worst surviving cell is ${worst?.[0]} at ${f(worst?.[1].rate ?? 0, 3)} blind ` +
        `(lo ${f(wilsonLower(worst[1].hits, worst[1].n), 3)}, "${worst[1].answer}"), priced at ` +
        `${f(enginePricing.modelledGuess(worst[0].split("|")[0], GRAPH.band(worst[0].split("|")[0]), worst[0].split("|")[1], "solo"), 3)}`,
  };
});

/**
 * The same bar one level down. The engine refuses at FAMILY granularity, so the guarantee has to
 * hold at family granularity too: no family the engine still scores may be measurably above the
 * cap on the stream. This is the check that a cell-level average cannot launder.
 */
check("U38", "no FAMILY the engine still scores is definitely above maxTrueGuess on the served stream", () => {
  const wrong = [];
  let checked = 0;
  for (const [key, m] of Object.entries(measuredFamily)) {
    const [kpId, form, family] = key.split("|");
    if (family === "(unfamilied)") continue;
    if (!enginePricing.isScorable(kpId, form, "solo", family)) continue;
    if (m.n < MIN_CELL_N) continue;
    checked += 1;
    if (wilsonLower(m.hits, m.n) > OVER_CAP)
      wrong.push(`${key} at least ${f(wilsonLower(m.hits, m.n), 3)} blind ("${m.answer}") and still scored`);
  }
  return {
    ok: wrong.length === 0,
    detail: wrong.length ? wrong.join("; ") : `${checked} scored families with n>=${MIN_CELL_N} on the served stream; none above ${OVER_CAP}`,
  };
});

/**
 * THE POPULATION CHECK — and it is a check of SET INCLUSION, not of proportions.
 *
 * Round 2's audit pooled 4.5% catalogue against a served 97.2%, so every number it produced was
 * about a different bank. What makes the two the same population now is that both walk `select()`
 * under the same window: the committed catalogue comes out first, item by item, and the generator
 * supplies the rest. The two SHARES still differ, and honestly so — the audit spends 160 draws on
 * a cell and a learner spends twenty to sixty, so the audit sits further into the generator tail.
 * That is a horizon difference, not a population difference, and it is exactly why the audit
 * measures the two sources SEPARATELY and prices the worse one instead of blending them.
 *
 * So the claim that binds is: every committed item the Scheduler serves was seen and priced by the
 * audit, and every family it serves exists in the table. Nothing the player meets is unpriced.
 */
/** The audit's own sample, recomputed here so U37 and U39 can look inside it rather than at a summary. */
const FRESH_SAMPLE = collectBankSample({ select: (o) => AUDIT_BANK.select(o), kpIds: GRAPH.ids, bandOf: (id) => GRAPH.difficulty(id) });
const FRESH_SAMPLE_IDS = new Set(FRESH_SAMPLE.map((r) => r.item.id));
check("U39", "every item the Scheduler serves was in the population the audit priced", () => {
  const auditShare = AUDIT.mixture ? AUDIT.mixture.catalogue / AUDIT.sampled : null;
  if (auditShare == null) return { ok: false, detail: "the committed audit table carries no mixture — it cannot be checked against the stream" };
  const unpricedItems = new Set();
  const unpricedFamilies = new Set();
  let catalogueChecked = 0;
  for (const r of SERVED) {
    const famKey = `${r.kpId}|${r.form}|${r.item.family ?? "(unfamilied)"}`;
    if (!AUDIT.families[famKey]) unpricedFamilies.add(famKey);
    if (r.source !== "catalogue") continue;
    catalogueChecked += 1;
    if (!FRESH_SAMPLE_IDS.has(r.item.id)) unpricedItems.add(r.item.id);
  }
  return {
    ok: unpricedItems.size === 0 && unpricedFamilies.size === 0,
    detail:
      unpricedItems.size || unpricedFamilies.size
        ? `UNPRICED: ${unpricedItems.size} committed items and ${unpricedFamilies.size} families served but never audited ` +
          `(${[...unpricedFamilies].slice(0, 4).join(", ")}${[...unpricedItems].slice(0, 4).join(", ")})`
        : `all ${catalogueChecked} committed items served (${new Set(SERVED.filter((r) => r.source === "catalogue").map((r) => r.item.id)).size} distinct) are in the audit's census, ` +
          `and all ${new Set(SERVED.map((r) => `${r.kpId}|${r.form}|${r.item.family}`)).size} served families are in the table. ` +
          `Shares differ by horizon, not population: audit ${pct(auditShare)} catalogue over ${AUDIT.sampled} draws (160/cell), ` +
          `stream ${pct(SERVED_SHARE)} catalogue over ${SERVED.length} items served across ${STREAM_RUNS} runs`,
  };
});

/**
 * The other half of the same guarantee: an item from a family the engine has refused is INERT on
 * the stream. It costs the learner time — which is why `req.avoidFamilies` exists and why a
 * presenter should not serve one — but it can never move a counter or a posterior.
 */
check("U42", "items the Scheduler still serves from a REFUSED family are inert, on the real stream", () => {
  let served = 0;
  const scored = [];
  for (const r of SERVED) {
    if (!AUDIT_PRICING.refusedFamilies(r.kpId, r.form).includes(r.item.family)) continue;
    served += 1;
    if (AUDIT_PRICING.isScorable(r.kpId, r.form, "solo", r.item.family)) scored.push(`${r.kpId}|${r.form}|${r.item.family}`);
  }
  // And prove it end to end on one of them rather than by predicate alone.
  const sample = SERVED.find((r) => AUDIT_PRICING.refusedFamilies(r.kpId, r.form).includes(r.item.family));
  let endToEnd = "no refused-family item was served at all";
  if (sample) {
    const { mastery } = bench();
    const before = snapOf(mastery, sample.kpId);
    const out = mastery.respond({ kpId: sample.kpId, form: sample.form, phase: "solo", family: sample.item.family, correct: true, mode: "acquire" });
    const after = snapOf(mastery, sample.kpId);
    if (out.scored !== false || JSON.stringify(before) !== JSON.stringify(after))
      return { ok: false, detail: `a served refused-family item MOVED the state: ${out.reason}` };
    endToEnd = `${sample.kpId}|${sample.form}|${sample.item.family} answered correctly: scored=${out.scored} reason=${out.reason}, state unchanged`;
  }
  return {
    ok: scored.length === 0,
    detail: scored.length
      ? `SCORED: ${[...new Set(scored)].join(", ")}`
      : `${served} of ${SERVED.length} served items (${pct(served / SERVED.length)}) came from a refused family and none of them is scorable; ${endToEnd}`,
  };
});

/**
 * The committed table is what the browser prices on, so it has to be what a fresh audit produces.
 * This is the check that makes a build-time table safe: it recomputes the entire thing from
 * `content/items` and fails on any difference at all, so a content edit that was never followed by
 * `node tools/bank-audit.mjs` cannot ship a stale price.
 */
const FRESH_AUDIT = auditBlindGuessing(FRESH_SAMPLE, AUDIT_MARK);
check("U37", "the COMMITTED bank-audit table is exactly what a fresh audit of content/items produces", () => {
  const want = bankAuditFingerprint({ bankFiles: BANK, model: M });
  if (AUDIT.version !== BANK_AUDIT_VERSION) return { ok: false, detail: `table version ${AUDIT.version} != ${BANK_AUDIT_VERSION}` };
  if (AUDIT.fingerprint !== want) return { ok: false, detail: `fingerprint ${AUDIT.fingerprint} != ${want} — run node tools/bank-audit.mjs` };
  const diffs = [];
  const keys = new Set([...Object.keys(AUDIT.families), ...Object.keys(FRESH_AUDIT.families)]);
  for (const k of keys) {
    const a = AUDIT.families[k];
    const b = FRESH_AUDIT.families[k];
    if (!a || !b) {
      diffs.push(`${k} ${a ? "committed only" : "fresh only"}`);
      continue;
    }
    if (a.n !== b.n || Math.abs(a.rate - b.rate) > 1e-12 || Math.abs(a.upper - b.upper) > 1e-12 || a.modalAnswer !== b.modalAnswer)
      diffs.push(`${k} committed ${f(a.rate, 3)}/${a.n} vs fresh ${f(b.rate, 3)}/${b.n}`);
  }
  return {
    ok: diffs.length === 0,
    detail: diffs.length
      ? `STALE TABLE (run node tools/bank-audit.mjs): ${diffs.slice(0, 6).join("; ")}${diffs.length > 6 ? ` (+${diffs.length - 6} more)` : ""}`
      : `${keys.size} family groups identical; fingerprint ${want}; version ${AUDIT.version}; ` +
        `sample ${AUDIT.sampled} items, ${pct(AUDIT.mixture.catalogue / AUDIT.sampled)} catalogue`,
  };
});

/**
 * The audit's window and the Scheduler's window are the same rule, or the audit is measuring a
 * different bank again. Three numbers, one identity.
 */
check("U40", "the audit window, the Scheduler's published window and the content file's are one number", () => {
  const content = M.antiGuessing.noRepeatWithinItems;
  const { sched } = bench();
  const req = sched.next();
  const probe = sched.probe();
  return {
    ok: content === BANK_AUDIT_WINDOW && AUDIT.window === BANK_AUDIT_WINDOW && probe.noRepeatWindow === BANK_AUDIT_WINDOW && Array.isArray(req?.avoidItemIds),
    detail:
      `content ${content}; audit table ${AUDIT.window}; Mastery BANK_AUDIT_WINDOW ${BANK_AUDIT_WINDOW}; ` +
      `Scheduler probe ${probe.noRepeatWindow}; a real request carries avoidItemIds (${req?.avoidItemIds?.length ?? "none"} ids)`,
  };
});

/**
 * THE CONTENT LINT the round-2 critic asked for, run here rather than in `content/items` because
 * that directory belongs to P17. It costs milliseconds and needs no simulation at all: count the
 * committed catalogue's modal answer share per (kp x form x family) and name every pool that is
 * over the cap before any checker leniency is considered.
 *
 * The assertion is the one this piece can honestly make: the engine REFUSES every one of them. The
 * fix — more distinct answers in the committed pools — is P17's, and the list is the handoff.
 */
const LINT = [];
const THIN = [];
for (const file of BANK) {
  const groups = new Map();
  for (const item of file.items ?? []) {
    if (!SCORED_FORMS.includes(item.form)) continue;
    const key = `${file.kpId}|${item.form}|${item.family ?? "(unfamilied)"}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  for (const [key, items] of groups) {
    const counts = new Map();
    for (const it of items) counts.set(canonicalKey(it), (counts.get(canonicalKey(it)) ?? 0) + 1);
    const modal = Math.max(...counts.values());
    const row = { key, n: items.length, distinct: counts.size, share: modal / items.length, modal };
    // `modal >= 2` is not a softening, it is what makes the rule mean anything: a pool of three
    // items with three different answers has a modal share of 0.333 and is as good as a pool of
    // three can be. What the lint is looking for is a REPEATED answer. The other defect — pools so
    // thin that a learner meets the same item over and over — is real and is listed separately,
    // and it is the executed audit rather than a count that prices it.
    if (modal >= 2 && row.share > OVER_CAP) LINT.push(row);
    else if (items.length < Math.ceil(1 / OVER_CAP)) THIN.push(row);
  }
}
LINT.sort((a, b) => b.share - a.share);
THIN.sort((a, b) => a.n - b.n);
check("U41", "every committed catalogue pool whose modal answer beats maxTrueGuess is REFUSED by the engine", () => {
  const scored = [];
  for (const r of LINT) {
    const [kpId, form, family] = r.key.split("|");
    if (enginePricing.isScorable(kpId, form, "solo", family)) scored.push(`${r.key} modal ${f(r.share, 3)} of ${r.n} (${r.distinct} distinct)`);
  }
  return {
    ok: scored.length === 0,
    detail: scored.length
      ? `STILL SCORED: ${scored.join("; ")}`
      : `${LINT.length} committed pools (of ${BANK.reduce((a, b) => a + b.items.length, 0)} items in ${BANK.length} files) repeat one answer more than ${OVER_CAP} of the time; ` +
        `all ${LINT.length} refused. Separately, ${THIN.length} pools hold fewer than ${Math.ceil(1 / OVER_CAP)} items, so no answer distribution can put them under the cap: ` +
        `${THIN.slice(0, 5).map((r) => `${r.key} n=${r.n}`).join(", ")}${THIN.length > 5 ? ` (+${THIN.length - 5})` : ""}`,
  };
});

/**
 * The shipped engine prices on an audit of `BANK_AUDIT_PER_CELL` draws per cell. If that sample is
 * too small, every rejection above is a coin flip wearing a decimal point. So the whole audit is
 * re-derived at a larger sample and no accept/reject verdict may get LOOSER. Only one direction is
 * a defect: refusing something a bigger sample would have kept costs curriculum and shows up in
 * L4; SCORING something a bigger sample says is guessable is the leak this piece exists to close.
 */
const REFERENCE_PER_CELL = argNum("referenceSample", BANK_AUDIT_PER_CELL * 2);
const REFERENCE_AUDIT = hasFlag("fast")
  ? null
  : auditBlindGuessing(
      collectBankSample({
        select: (o) => AUDIT_BANK.select(o),
        kpIds: GRAPH.ids,
        bandOf: (id) => GRAPH.difficulty(id),
        perCell: REFERENCE_PER_CELL,
      }),
      { ...AUDIT_MARK, executedCap: 240 }
    );
check("U33", `the shipped ${BANK_AUDIT_PER_CELL}-draw audit is never LOOSER than a ${REFERENCE_PER_CELL}-draw one`, () => {
  if (!REFERENCE_AUDIT) return { ok: true, detail: "SKIPPED (--fast)" };
  const reference = new Mastery(GRAPH, { bankAudit: REFERENCE_AUDIT, storage: null, emit: () => {} });
  const looser = [];
  const stricter = [];
  for (const kpId of GRAPH.ids) {
    for (const form of SCORED_FORMS) {
      const cellA = enginePricing.isScorable(kpId, form, "solo");
      const cellB = reference.isScorable(kpId, form, "solo");
      if (cellA && !cellB) looser.push(`${kpId}|${form}`);
      else if (!cellA && cellB) stricter.push(`${kpId}|${form}`);
      const fams = new Set([
        ...Object.keys(enginePricing.cell(kpId, form)?.families ?? {}),
        ...Object.keys(reference.cell(kpId, form)?.families ?? {}),
      ]);
      for (const fam of fams) {
        const a = enginePricing.isFamilyPriceable(kpId, form, fam);
        const b = reference.isFamilyPriceable(kpId, form, fam);
        if (a && !b) looser.push(`${kpId}|${form}::${fam}`);
        else if (!a && b) stricter.push(`${kpId}|${form}::${fam}`);
      }
    }
  }
  const refUnmasterable = reference.cellPricing.description.unmasterable;
  return {
    ok: looser.length === 0,
    detail: looser.length
      ? `LOOSER than the reference on: ${looser.join(", ")}`
      : `never looser; stricter on ${stricter.length} (${stricter.join(", ") || "none"}); ` +
        `unmasterable at ${BANK_AUDIT_PER_CELL} draws {${enginePricing.cellPricing.description.unmasterable.join(",")}} vs at ${REFERENCE_PER_CELL} {${refUnmasterable.join(",")}}`,
  };
});

/**
 * The refusal is at FAMILY granularity, and this is the assertion that says so. A whole cell would
 * have been the blunt instrument: `expr-anatomy|construct` has `.coefficient` (answer always 1) and
 * `.count` sitting next to `.term`, which is honest work. Refusing the whole cell would take a
 * BAND-1 node off the air and lock every knowledge point behind it.
 */
check("U36", "a REFUSED family is inert, its sibling family in the same cell still scores, and the request says which to avoid", () => {
  const { mastery, sched } = bench();
  let KP = null;
  let FORM = null;
  for (const id of GRAPH.ids) {
    for (const form of SCORED_FORMS) {
      const refused = mastery.refusedFamilies(id, form);
      const all = Object.keys(mastery.cell(id, form)?.families ?? {});
      if (refused.length && all.length > refused.length && mastery.isCellPriceable(id, form)) {
        KP = id;
        FORM = form;
        break;
      }
    }
    if (KP) break;
  }
  if (!KP) return { ok: false, detail: "no mixed cell (some families refused, some kept) exists — the granularity claim is untestable" };
  const refused = mastery.refusedFamilies(KP, FORM);
  const kept = Object.keys(mastery.cell(KP, FORM).families).filter((x) => !refused.includes(x));

  const before = snapOf(mastery, KP);
  const bad = mastery.respond({ kpId: KP, form: FORM, phase: "solo", family: refused[0], correct: true, mode: "acquire" });
  const afterBad = snapOf(mastery, KP);
  if (bad.scored !== false || JSON.stringify(before) !== JSON.stringify(afterBad))
    return { ok: false, detail: `refused family still scored: ${bad.reason}` };

  const good = mastery.respond({ kpId: KP, form: FORM, phase: "solo", family: kept[0], correct: true, mode: "acquire" });

  // And the request the world is handed must carry the avoid-list, or nobody can act on it. Read
  // it off a REAL request the Scheduler produced, not off the price API it copies from.
  const req = sched.next();
  const priced = mastery.price(KP, FORM, "solo");
  const carriesList = Array.isArray(req?.avoidFamilies) && req.avoidFamilies.join(",") === mastery.refusedFamilies(req.kpId, req.form).join(",");
  return {
    ok: good.scored === true && good.credited === true && carriesList && priced.avoidFamilies.join(",") === refused.join(","),
    detail:
      `${KP}|${FORM}: refused {${refused.join(",")}} inert (${bad.reason}); kept {${kept.join(",")}} credits; ` +
      `price().avoidFamilies = ${JSON.stringify(priced.avoidFamilies)}; ` +
      `a real request for ${req?.kpId}|${req?.form} carries avoidFamilies ${JSON.stringify(req?.avoidFamilies ?? null)}`,
  };
});

/**
 * The engine's cheap per-family audit and the expensive Scheduler-driven measurement sample the
 * same bank two different ways. The guarantee that binds is that the PRICE never sits below what a
 * guesser demonstrably gets, under either — plus a method-agreement bound, so a repeat of the
 * `generate` class of error, where the engine said 0.011 and the truth was 0.95, cannot hide
 * inside "sampling differs".
 */
check("U34", "the engine's PRICE dominates the served blind rate on every scored cell, and the two methods agree", () => {
  const underPriced = [];
  const disagree = [];
  let n = 0;
  let worst = 0;
  let worstCell = null;
  for (const [cell, m] of Object.entries(measuredServed)) {
    const [kpId, form] = cell.split("|");
    if (!enginePricing.isScorable(kpId, form, "solo")) continue;
    if (m.n < MIN_CELL_N) continue;
    n += 1;
    const engine = enginePricing.bankBlindRate(kpId, form);
    const floor = wilsonLower(m.hits, m.n);
    const priced = enginePricing.modelledGuess(kpId, GRAPH.band(kpId), form, "solo");
    if (priced + 1e-9 < floor) underPriced.push(`${cell} priced ${f(priced, 3)} < served floor ${f(floor, 3)}`);
    const gap = floor - engine;
    if (gap > worst) {
      worst = gap;
      worstCell = `${cell} engine ${f(engine, 3)} vs served ${f(m.rate, 3)} (>= ${f(floor, 3)}), priced ${f(priced, 3)}`;
    }
    if (gap > 0.05) disagree.push(`${cell}: engine ${f(engine, 3)} vs served ${f(m.rate, 3)}`);
  }
  return {
    ok: underPriced.length === 0 && disagree.length <= Math.floor(0.05 * n),
    detail: underPriced.length
      ? `UNDER-PRICED: ${underPriced.join("; ")}`
      : `${n} scored cells; price dominates the served floor on all of them; ${disagree.length} differ by more than 0.05 (${disagree.join(", ") || "none"}); worst method gap ${f(Math.max(0, worst), 3)} — ${worstCell}`,
  };
});

/**
 * `eq-special-cases` is the node where the content has nothing left. All five of its generator
 * families, across all three forms, answer to one memorised string. The honest engine cannot
 * certify it and says so out loud rather than crediting it at 0.10. It is a leaf at band 5, so
 * the cost is exactly one knowledge point of 32 — which is why L4 survives and why this is
 * reported as a content defect rather than absorbed as a pricing choice.
 */
check("U35", "a knowledge point with NO honest family left is refused outright, named, and costs the graph nothing behind it", () => {
  const { mastery } = bench();
  const KP = "eq-special-cases";
  const before = snapOf(mastery, KP);
  const r = mastery.respond({ kpId: KP, form: "construct", phase: "solo", correct: true, mode: "acquire" });
  const after = snapOf(mastery, KP);
  if (r.scored !== false || JSON.stringify(before) !== JSON.stringify(after))
    return { ok: false, detail: `refused cell still moved the state: scored=${r.scored} reason=${r.reason}` };
  const dead = mastery.cellPricing.description.unmasterable;
  const named = mastery.issues.some((i) => i.includes(KP));
  // It must be a LEAF, or refusing it would lock the graph behind it — that is the fact that makes
  // "refuse it" an acceptable answer instead of a catastrophe, and it is checked, not assumed.
  const blocks = GRAPH.descendants(KP).size;
  return {
    ok: dead.includes(KP) && named && blocks === 0 && dead.length === 1,
    detail: `${KP}: every form refused (${r.reason}); unmasterable ${JSON.stringify(dead)}; reported in issues ${named}; knowledge points locked behind it ${blocks}; masterable ceiling ${GRAPH.ids.length - dead.length}/${GRAPH.ids.length}`,
  };
});

check("U31", "the review ladder after certification is 1, 2, 5, 11, 24, 45, 45, 45 days (§3, growth 2.2, cap 45)", () => {
  const r = retentionRun({});
  if (r.status !== "mastered") return { ok: false, detail: `node did not certify: ${r.status}` };
  const { mastery, sched } = r;
  const days = [];
  for (let i = 0; i < 8; i++) {
    const s = mastery.stateOf(RET_KP);
    days.push(s.intervalDays);
    sched.clock.set(s.nextEventAt);
    sched.beginSession();
    for (let k = 0; k < 2; k++) {
      const req = sched.next();
      if (!req || req.mode !== "review" || req.kpId !== RET_KP)
        return { ok: false, detail: `ladder step ${i} item ${k} served ${req ? `${req.mode} on ${req.kpId}` : "null"}` };
      sched.submit(req, { correct: true, latencyMs: 5000, itemId: `rev${i}-${k}` });
    }
  }
  const want = [1, 2, 5, 11, 24, 45, 45, 45];
  return { ok: days.join(",") === want.join(","), detail: `${days.join(", ")} days` };
});

check("U32", "12 hours of idle time inside ONE session never produces a retention item (§3 needs an intervening session)", () => {
  const clock = virtualClock(0);
  const mastery = new Mastery(GRAPH, { bankAudit: AUDIT, now: () => clock.minutes(), emit: () => {}, storage: null });
  const sched = new Scheduler(mastery, { clock, rng: mulberry32(5), sessionMinutes: 100000 });
  sched.beginSession();
  const s = mastery.stateOf(RET_KP);
  Object.assign(s, {
    p: 0.99,
    status: "provisional",
    everUnlocked: true,
    scored: 6,
    atBand: 3,
    forms: ["construct", "repair"],
    consolidated: true,
    provisionalAt: 0,
    provisionalSession: mastery.session,
    nextEventAt: 0,
  });
  clock.set(100 * 1440); // a hundred days of idle time, all inside one session
  for (let i = 0; i < 20; i++) {
    const req = sched.next();
    if (req && req.mode === "retention") return { ok: false, detail: `retention served after idling, at item ${i}` };
    if (!req) break;
    sched.submit(req, { correct: true, latencyMs: 5000, itemId: `idle${i}` });
  }
  return { ok: true, detail: `100 days idle inside session ${mastery.session}: no retention item, node still ${mastery.status(RET_KP)}` };
});

// ==================================================================== PART B — the population
//
// One responder model, many kinds. Only the `answer` function differs, and only the bots' branch
// touches the ground-truth tables.

// ------------------------------------------------------------------ the LIVE arms
//
// The arms below have NO success-rate parameter anywhere in the loop. The Scheduler names a
// knowledge point, a form and a difficulty; `ItemBank.select()` hands over the item a player would
// actually be shown; the bot types a string; `ItemBank.check()` decides whether it is right. The
// only thing the harness supplies is the STRATEGY, and every strategy here is one a responder with
// no algebra can execute. Whether it works is a property of the shipped bank, not of this file.
//
// This is the answer to the finding that destroyed the previous attempt: "the simulation set the
// bot's true success rate equal to the model's own guess parameter". There is no rate to set.

/** The best fixed answer for a cell, MEASURED off the bank in PART A2. A guesser's whole plan. */
const bestConstantFor = (kpId, form) => measuredBest[`${kpId}|${form}`]?.answer ?? "0";

/** A response string that is definitely wrong: a declared distractor, else a nonsense token. */
function wrongStringFor(item, rng) {
  const ds = item.distractors ?? [];
  if (ds.length) {
    const d = ds[Math.floor(rng() * ds.length) % ds.length];
    if (d && d.response != null) return String(d.response);
  }
  return "17";
}

/** GROUND TRUTH for the item the scheduler ACTUALLY served. Never `guessByForm`. */
const blindRate = (form, phase) => Math.max(TRUE_FORM[form] ?? 0.03, TRUE_PHASE[phase] ?? 0);
/** GROUND TRUTH as MEASURED off the shipped item bank for this exact knowledge point and form. */
const measuredRate = (kpId, form, phase) =>
  Math.max(measuredServed[`${kpId}|${form}`]?.rate ?? TRUE_FORM[form] ?? 0.03, TRUE_PHASE[phase] ?? 0);

function makeResponder(kind, rng, opts = {}) {
  const bot = !HONEST_KINDS.has(kind);
  const ability = kind === "mixed" ? Math.exp(gauss(rng) * 0.35) : 1;
  const thetaTrue = -0.8 + 1.2 * Math.log(ability);
  const known = new Map();
  for (const id of GRAPH.ids) {
    const b = GRAPH.band(id);
    const odds = (b.prior / (1 - b.prior)) * (bot ? 0 : ability);
    known.set(id, !bot && rng() < odds / (1 + odds));
  }

  return {
    kind,
    bot,
    ability,
    thetaTrue,
    known,
    /**
     * @param {object} req the request the SCHEDULER produced — form and phase come from it
     * @param {Mastery} mastery
     * @param {object|null} item the REAL item, when this arm is running against the live bank
     */
    answer(req, mastery, item = null) {
      const band = GRAPH.band(req.kpId);
      const b = req.difficulty;
      const phaseFloor = TRUE_PHASE[req.phase] ?? 0;

      // Teaching happens in every phase, including the ones that buy no credit — that is the
      // point of them. The acquisition roll sits ABOVE the scoring gate on purpose.
      if (!bot && !known.get(req.kpId)) {
        const s = mastery.stateOf(req.kpId);
        const boosted = s.relearn && (!M.spacing.relearnRequiresPriorMastery || s.everMastered);
        const t = Math.min(0.9, band.learn * ability * (boosted ? M.spacing.relearnLearnRateMultiplier : 1));
        if (rng() < t) known.set(req.kpId, true);
      }

      // ---------------------------------------------------------------- THE LIVE ARMS
      // No rate. A string, and the shipped checker's verdict on it.
      if (item) {
        let response;
        let liveHinted = req.hinted;
        let liveLatency = 4000 + Math.floor(rng() * 8000);
        if (kind === "liveHintAbuser") {
          // The STRONGEST hint-abuser that can exist: it idles past `hintSurfaceMs`, reads the
          // hint, and types the right answer EVERY time. Raw correctness 1.00. If this arm still
          // certifies nothing, no weaker hint strategy can certify anything either.
          response = String(bank.accepts(item)[0]);
          liveHinted = true;
          liveLatency = M.antiGuessing.hintSurfaceMs + 2000;
        } else if (bot) {
          // The blind guesser: the best fixed answer for the cell it was actually served, which
          // PART A2 measured off the bank rather than read out of the model.
          response = bestConstantFor(req.kpId, req.form);
          if (kind === "liveMasher") liveLatency = rng() < 0.5 ? 200 : 4000;
        } else if (known.get(req.kpId)) {
          const slip = band.slip * (1 + 0.35 * Math.max(0, b - thetaTrue));
          response = rng() < slip ? wrongStringFor(item, rng) : String(bank.accepts(item)[0]);
        } else {
          // Not acquired yet: no partial-credit fudge, just the blind strategy. Harsher on L4
          // than the parameterised arm, which let the model's own `guess` stand in for partial
          // knowledge — so a median learner who clears the bar here clears it the hard way.
          response = bestConstantFor(req.kpId, req.form);
        }
        let liveCorrect = false;
        try {
          liveCorrect = bank.check(item, response).correct === true;
        } catch {
          liveCorrect = false;
        }
        // The family is reported honestly, always. A presenter that hides it is priced at the
        // worst family it was allowed to serve, which is the conservative default, not a loophole.
        return { correct: liveCorrect, latencyMs: liveLatency, hinted: liveHinted, itemId: item.id, family: item.family, response };
      }

      let correct;
      let latencyMs = 4000 + Math.floor(rng() * 8000); // patient by default: well past the floor
      let hinted = req.hinted;

      if (bot) {
        // ------- THE LOAD-BEARING LINE. Ground truth, from the served form and phase. -------
        let rate =
          opts.forcedBlindRate != null
            ? Math.max(opts.forcedBlindRate, phaseFloor)
            : kind === "bankGuesser"
              ? measuredRate(req.kpId, req.form, req.phase)
              : blindRate(req.form, req.phase);
        if (kind === "hintAbuser" && req.mode === "acquire") {
          // Idles past hintSurfaceMs. Where the phase surfaces a hint, that hint is what it gets.
          if (M.phases.hinted?.[req.phase]) rate = Math.max(rate, TRUE_PHASE["guided-3"]);
          hinted = M.phases.hinted?.[req.phase] ?? false;
          latencyMs = M.antiGuessing.hintSurfaceMs + 2000;
        } else if (kind === "hintLeak" && req.mode === "acquire") {
          // B2: P18 leaks the hint surface into every acquisition phase and never tells the engine.
          rate = Math.max(rate, TRUE_PHASE["guided-3"]);
          hinted = false;
          latencyMs = M.antiGuessing.hintSurfaceMs + 2000;
        }
        correct = rng() < rate;
        if (kind === "masher") latencyMs = rng() < 0.5 ? 200 : 4000;
      } else if (known.get(req.kpId)) {
        // A2: an over-pitched item raises the effective slip.
        const base = Math.max(0.55, 1 - band.slip * (1 + 0.35 * Math.max(0, b - thetaTrue)));
        correct = rng() < base + (1 - base) * phaseFloor;
      } else {
        // A7 + A9: the model's guess stands in for partial knowledge, floored by the scaffold.
        const base = Math.min(0.3, band.guess * (M.guessByForm[req.form] ?? 1) * (1 + 0.5 * Math.max(0, thetaTrue - b)));
        correct = rng() < base + (1 - base) * phaseFloor;
      }

      // ---- THE ARMS ASSUMPTION B3 USED TO EXCUSE ------------------------------------------
      // Acquire honestly, then abuse ONLY the certification surface. §6.1: `hinted` is a
      // per-response fact reported by the world, and the world can get it wrong anywhere.
      if (kind === "retentionHintLeak" && req.mode === "retention") {
        correct = rng() < TRUE_PHASE["guided-3"]; // idle 12 s, read the hint, type what it says
        hinted = true;
        latencyMs = M.antiGuessing.hintSurfaceMs + 2000;
      } else if (kind === "retentionFast" && req.mode === "retention") {
        latencyMs = 100; // knows it, commits under the floor
      }

      return { correct, latencyMs, hinted, itemId: `${req.kpId}#${req.seq}` };
    },
  };
}

function runLearner({
  seed,
  kind,
  sessions = SESSIONS,
  reviewCapLift = true,
  pullForward = true,
  prerequisiteClockReset = true,
  SchedulerClass = Scheduler,
  forcedBlindRate = null,
}) {
  const rng = mulberry32(seed);
  const clock = virtualClock(0);
  const mastery = new Mastery(GRAPH, { bankAudit: AUDIT, now: () => clock.minutes(), emit: () => {}, storage: null, prerequisiteClockReset });
  const sched = new SchedulerClass(mastery, {
    clock,
    rng: mulberry32(seed ^ 0x9e3779b9),
    sessionMinutes: SESSION_MINUTES,
    reviewCapLift,
    pullForward,
  });
  const responder = makeResponder(kind, rng, { forcedBlindRate });
  const hostileBank = kind === "formHunter";
  /** LIVE arms pull the real item and let `ItemBank.check()` decide. No rate anywhere. */
  const live = kind.startsWith("live");
  const recentItems = new Set();

  let retentionAttempts = 0;
  let retentionPasses = 0;
  let peakMastered = 0;
  let liveRight = 0;
  let liveServed = 0;
  const trace = [];
  const scoredTrace = [];

  for (let session = 0; session < sessions; session++) {
    clock.set(session * 1440); // A5: one session per day
    sched.beginSession();
    for (;;) {
      const req = sched.next();
      if (!req) break;
      // A8: an item bank that read a closed question in a diagnostic signature and shipped it.
      if (hostileBank) req.form = UNSCORED_FORMS[req.seq % UNSCORED_FORMS.length];
      const lastOfCheck = req.mode === "retention" && req.itemIndex === req.itemsInEvent - 1;
      // The exclusion set is the REQUEST'S, never one this harness keeps of its own. A harness
      // that invents its own no-repeat window is measuring its own window, not the game's.
      const item = live ? (liveItemFor(req, new Set(req.avoidItemIds ?? []), req.seq + seed) ?? {}).item ?? null : null;
      const outcome = responder.answer(req, mastery, item);
      if (item) {
        liveServed += 1;
        if (outcome.correct) liveRight += 1;
      }
      sched.submit(req, outcome);
      if (lastOfCheck) {
        retentionAttempts += 1;
        if (mastery.status(req.kpId) === "mastered") retentionPasses += 1;
      }
    }
    sched.endSession();
    const now = GRAPH.ids.filter((id) => mastery.status(id) === "mastered").length;
    peakMastered = Math.max(peakMastered, now);
    trace.push(now);
    scoredTrace.push(mastery.stats.scoredItems);
  }

  const mastered = GRAPH.ids.filter((id) => mastery.status(id) === "mastered").length;
  const at80 = trace.findIndex((m) => m >= NEED80);
  return {
    mastery,
    clock,
    mastered,
    peakMastered,
    provisional: GRAPH.ids.filter((id) => mastery.status(id) === "provisional").length,
    unlocked: GRAPH.ids.filter((id) => mastery.everUnlocked(id)).length,
    gateOpens: mastery.stats.gateOpens,
    maxScoredCounter: Math.max(...GRAPH.ids.map((id) => mastery.stateOf(id).scored)),
    items: mastery.stats.items,
    scoredItems: mastery.stats.scoredItems,
    unscoredItems: mastery.stats.unscoredItems,
    refusedUpward: mastery.stats.refusedUpward,
    lapses: mastery.stats.lapses,
    theta: mastery.theta,
    retentionAttempts,
    retentionPasses,
    // The live arm's RAW success rate on the items it was actually served, as marked by the
    // shipped checker. Not an input; an output. This is the number claim V reports.
    liveServed,
    liveRight,
    trace,
    scoredTrace,
    sessionsTo80: at80 < 0 ? null : at80 + 1,
    // §8's real row: SCORED OPPORTUNITIES consumed by the time 80% of Level 1 is certified —
    // not the total the learner ever answers. Snapshotted at the session where it happens.
    scoredTo80: at80 < 0 ? null : scoredTrace[at80],
  };
}

const cohortTimings = [];
function cohort(kind, n, seedBase, sessions, opts = {}) {
  const rows = [];
  const tc = Date.now();
  for (let i = 0; i < n; i++) rows.push(runLearner({ seed: seedBase + i * 7919, kind, sessions, ...opts }));
  cohortTimings.push({ kind, n, ms: Date.now() - tc, label: opts.label ?? kind });
  const p = rows.map((r) => (100 * r.mastered) / TOTAL).sort((a, b) => a - b);
  const items = rows.map((r) => r.items).sort((a, b) => a - b);
  const sum = (fn) => rows.reduce((a, r) => a + fn(r), 0);
  /** Level 1 mastery, in percent, as it stood at the END of session k (1-indexed). */
  const atSession = (k) => {
    if (k > sessions) return null;
    const v = rows.map((r) => (100 * r.trace[k - 1]) / TOTAL).sort((a, b) => a - b);
    return { median: percentile(v, 0.5), p10: percentile(v, 0.1), shareAt80: rows.filter((r) => r.trace[k - 1] >= NEED80).length / n };
  };
  const to80 = rows.map((r) => r.scoredTo80).filter((x) => x != null).sort((a, b) => a - b);
  return {
    n,
    sessions,
    atSession,
    curve: Object.fromEntries(CURVE.filter((k) => k <= sessions).map((k) => [k, atSession(k)])),
    p10: percentile(p, 0.1),
    median: percentile(p, 0.5),
    p90: percentile(p, 0.9),
    shareAt80: rows.filter((r) => (100 * r.mastered) / TOTAL >= 80).length / n,
    meanMastered: sum((r) => r.mastered) / n,
    maxMastered: Math.max(...rows.map((r) => r.mastered)),
    peakEverMastered: Math.max(...rows.map((r) => r.peakMastered)),
    meanUnlocked: sum((r) => r.unlocked) / n,
    shareEverUnlocked: rows.filter((r) => r.unlocked > 0).length / n,
    meanGateOpens: sum((r) => r.gateOpens) / n,
    maxGateOpens: Math.max(...rows.map((r) => r.gateOpens)),
    maxScoredCounter: Math.max(...rows.map((r) => r.maxScoredCounter)),
    medianItems: percentile(items, 0.5),
    meanScoredItems: sum((r) => r.scoredItems) / n,
    meanUnscoredItems: sum((r) => r.unscoredItems) / n,
    meanRefusedUpward: sum((r) => r.refusedUpward) / n,
    maxRefusedUpward: Math.max(...rows.map((r) => r.refusedUpward)),
    meanLapses: sum((r) => r.lapses) / n,
    retentionPassRate: sum((r) => r.retentionAttempts) ? sum((r) => r.retentionPasses) / sum((r) => r.retentionAttempts) : null,
    // §8: "median scored opportunities TO 80% mastery". Null for anyone who never got there.
    medianScoredTo80: to80.length ? percentile(to80, 0.5) : null,
    shareReaching80: to80.length / n,
    medianSessionsTo80: percentile(rows.map((r) => r.sessionsTo80 ?? 999).sort((a, b) => a - b), 0.5),
    shareBySession: Array.from({ length: sessions }, (_, s) => rows.filter((r) => r.trace[s] >= NEED80).length / n),
    meanTheta: sum((r) => r.theta) / n,
    // Live arms only: raw items right / items served, decided by `ItemBank.check()`.
    liveServed: sum((r) => r.liveServed ?? 0),
    liveRight: sum((r) => r.liveRight ?? 0),
    liveRate: sum((r) => r.liveServed ?? 0) ? sum((r) => r.liveRight ?? 0) / sum((r) => r.liveServed ?? 0) : null,
  };
}

// ---------------------------------------------------------------------------------------- run

const t0 = Date.now();

const median = cohort("median", LEARNERS, 5150, SESSIONS);
const mixedLong = cohort("mixed", LEARNERS, 1234, LONG_SESSIONS);
const guesser = cohort("guesser", BOTS, 99991, SESSIONS);
const masher = cohort("masher", BOTS, 424242, SESSIONS);
const formHunter = cohort("formHunter", BOTS, 606060, SESSIONS);
const hintAbuser = cohort("hintAbuser", BOTS, 515151, SESSIONS);
const hintLeak = cohort("hintLeak", BOTS, 727272, SESSIONS);
// The arms assumption B3 used to declare out of scope.
const retentionHintLeak = cohort("retentionHintLeak", BOTS, 838383, SESSIONS);
const retentionFast = cohort("retentionFast", BOTS, 949494, SESSIONS);
// The same arm against the ROUND-1 counting rule. Must be large, or this file sees nothing.
const legacyRetention = cohort("retentionHintLeak", Math.max(60, Math.floor(BOTS / 2)), 838383, SESSIONS, {
  SchedulerClass: LegacyCountingScheduler,
});
// The blind bot, priced off the REAL bank rather than off the content file's constants.
const bankGuesser = cohort("bankGuesser", BOTS, 161616, SESSIONS);

/**
 * THE LIVE ARMS. Real items, real strings, real `check()`. Smaller cohorts because each item
 * costs a bank selection and a parse, and because these arms are not measuring a distribution —
 * they are answering a yes/no question about whether the gate can be walked through.
 */
const LIVE = argNum("live", 120);
const liveMedian = cohort("liveMedian", LIVE, 5150, SESSIONS);
const liveGuesser = cohort("liveGuesser", LIVE, 99991, SESSIONS);
const liveHintAbuser = cohort("liveHintAbuser", LIVE, 515151, SESSIONS);

// §4.1: both selection rules off. The claim is that they are jointly load-bearing, so it has to
// be measured on this engine and not quoted from the design document.
const ablated = cohort("median", Math.max(60, Math.floor(LEARNERS / 4)), 5150, SESSIONS, {
  reviewCapLift: false,
  pullForward: false,
});
// §1.2 says prerequisite credit "resets the prerequisite's spacing clock". That rule defers
// review of a well-exercised prerequisite, which frees session time — i.e. it is a rule that can
// only flatter L4. So it is measured with the rule switched off rather than assumed harmless.
const noClockReset = cohort("median", Math.max(60, Math.floor(LEARNERS / 4)), 5150, SESSIONS, { prerequisiteClockReset: false });

/**
 * SENSITIVITY. The whole L5 result is a linear function of `trueGuessByForm.construct = 0.03`.
 * This sweep prices the guessing bot at a forced blind rate and prints what the gate does, so
 * the tolerance is a measurement rather than a hope. 0.10 and 0.17 are §9's two named tripwires.
 */
const SWEEP_RATES = [0.03, 0.1, 0.17, 0.25, 0.5];
const sweep = SWEEP_RATES.map((r) => ({
  rate: r,
  cohort: cohort("guesser", SWEEP_BOTS, 313131, SESSIONS, { forcedBlindRate: r }),
}));

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
if (hasFlag("time")) console.error(cohortTimings.map((c) => `${c.kind} n=${c.n} ${c.ms}ms`).join("\n"));

// --------------------------------------------------------------------------------- the claims

claim("A", "L4", `median learner: median Level 1 mastery at ${SESSIONS} sessions x ${SESSION_MINUTES} min >= 80%`, () => ({
  value: `${median.median.toFixed(1)}% (p10 ${median.p10.toFixed(1)}%, ${pct(median.shareAt80)} of learners at >= 80%)`,
  pass: median.median >= 80,
}));
claim("A2", "L4", "median learner: median number of sessions to reach 80% of Level 1 <= 20 (8.3 h of play)", () => ({
  value: `median ${median.medianSessionsTo80} sessions; ${pct(median.shareReaching80)} of learners reach 80% inside the ${SESSIONS}-session budget`,
  pass: median.medianSessionsTo80 <= 20,
}));
claim("B", "L4", `mixed-ability population: share at >= 80% mastery by ${LONG_SESSIONS} sessions >= 90%`, () => ({
  value: pct(mixedLong.shareAt80),
  pass: mixedLong.shareAt80 >= 0.9,
}));
/**
 * §8's row is "median scored opportunities TO 80% mastery, 480-600". Round 1 of this script
 * measured the total scored over the whole 22 sessions against a band it had widened to 480-900,
 * which is a different quantity with a different band. This measures the quantity §8 names:
 * `mastery.stats.scoredItems` snapshotted at the session where `mastered` first reaches 26 of 32.
 */
claim("C", "L4", "median SCORED OPPORTUNITIES consumed by the time 80% of Level 1 is certified is 480-600 (§8's real row)", () => ({
  value: `${median.medianScoredTo80 == null ? "n/a" : Math.round(median.medianScoredTo80)} scored opportunities to ${NEED80}/32 certified (${pct(median.shareReaching80)} of learners get there; whole-budget total is ${Math.round(median.meanScoredItems)})`,
  pass: median.medianScoredTo80 != null && median.medianScoredTo80 >= 480 && median.medianScoredTo80 <= 600,
}));
claim("D", "L5", "patient guessing bot: mean knowledge points certified < 0.01 of 32", () => ({
  value: `${guesser.meanMastered.toFixed(4)} (max ${guesser.maxMastered}, peak ever ${guesser.peakEverMastered})`,
  pass: guesser.meanMastered < 0.01,
}));
claim("E", "L5", "mashing bot (half its answers under the latency floor): mean certified < 0.01", () => ({
  value: `${masher.meanMastered.toFixed(4)} (max ${masher.maxMastered})`,
  pass: masher.meanMastered < 0.01,
}));
claim("F", "L5", "hint-abusing bot (idles for maximum scaffolding on every item): 0 certified", () => ({
  value: `${hintAbuser.meanMastered.toFixed(4)} (max ${hintAbuser.maxMastered}, gate opened on ${hintAbuser.meanGateOpens.toFixed(3)} nodes/run)`,
  pass: hintAbuser.maxMastered === 0,
}));
claim("G", "L5", "hint-LEAK bug arm (P18 leaks help into solo during ACQUISITION): < 0.1 of 32 certified, none near the bar", () => ({
  value: `${hintLeak.meanMastered.toFixed(4)} certified/run (max ${hintLeak.maxMastered}, ${pct(hintLeak.shareAt80)} of runs at >= 80%), gate opened ${hintLeak.meanGateOpens.toFixed(1)}x/run on ${hintLeak.meanUnlocked.toFixed(1)}/32 nodes`,
  pass: hintLeak.meanMastered < 0.1 && hintLeak.maxMastered <= 2 && hintLeak.shareAt80 === 0,
}));
/**
 * THE ARM THE PREVIOUS ROUND EXCUSED. Honest acquisition, then the hint on all four retention
 * items — the strategy a real fifteen-year-old actually runs. Round 1 of this engine certified
 * 31.95 of 32 here. The threshold is exactly 0, and `refusedUpward > 0` proves the arm is live
 * rather than silently inert.
 */
claim("N", "L5", "retention hint-leak arm (acquires honestly, reads the hint on every M4 item): EXACTLY 0 certified", () => ({
  value: `${retentionHintLeak.meanMastered.toFixed(4)} certified/run (max ${retentionHintLeak.maxMastered}); ${retentionHintLeak.meanRefusedUpward.toFixed(0)} refusedUpward and ${retentionHintLeak.meanLapses.toFixed(1)} lapses per run; ${retentionHintLeak.meanGateOpens.toFixed(1)} gate opens (it does reach M4)`,
  pass: retentionHintLeak.meanMastered === 0 && retentionHintLeak.meanRefusedUpward > 0 && retentionHintLeak.meanGateOpens > 5,
}));
claim("O", "L5", "retention speed arm (acquires honestly, commits every M4 item in 100 ms): EXACTLY 0 certified", () => ({
  value: `${retentionFast.meanMastered.toFixed(4)} certified/run (max ${retentionFast.maxMastered}); ${retentionFast.meanRefusedUpward.toFixed(0)} refusedUpward and ${retentionFast.meanLapses.toFixed(1)} lapses per run; ${retentionFast.meanGateOpens.toFixed(1)} gate opens`,
  pass: retentionFast.meanMastered === 0 && retentionFast.meanRefusedUpward > 0 && retentionFast.meanGateOpens > 5,
}));
/**
 * CONTROL ARM FOR N AND O. One line of the round-1 engine, restored. If this does not certify,
 * the two zeros above are the zeros of a broken detector and the run is worthless.
 */
claim("P", "L5", "CONTROL: the round-1 M4 counting rule certifies the SAME arm on >= 20 of 32 — the harness can see the leak", () => ({
  value: `round-1 rule: ${legacyRetention.meanMastered.toFixed(2)}/32 certified per run (max ${legacyRetention.maxMastered}, ${pct(legacyRetention.shareAt80)} of runs at >= 80%); shipped rule on the identical arm: ${retentionHintLeak.meanMastered.toFixed(4)}`,
  pass: legacyRetention.meanMastered >= 20 && retentionHintLeak.meanMastered === 0,
}));
/**
 * L5 without the content file's hand-authored constants anywhere in the loop.
 */
claim("Q", "L5", "blind bot priced off the REAL ItemBank (measured per kp x form, not the JSON): mean certified < 0.01", () => ({
  value: `${bankGuesser.meanMastered.toFixed(4)} (max ${bankGuesser.maxMastered}, peak ever ${bankGuesser.peakEverMastered}); measured rates: ${SCORED_FORMS.map((x) => `${x} ${f(measuredByForm[x].rate, 4)}`).join(", ")}`,
  pass: bankGuesser.meanMastered < 0.01,
}));
/**
 * THE CLAIM THE PREVIOUS ROUND GOT WRONG. `model.trueGuessByForm` says `construct` is flukeable at
 * 0.03. Measured against the shipped bank with the strategy a guesser actually runs, the WORST
 * `construct` cell is `eq-special-cases` and the worst `repair` cell is the same knowledge point
 * at 1.00. So the content file's per-form claim is FALSE, and the pass condition is no longer
 * "the bank agrees with the constant" — it is "the engine prices what the bank does, not what the
 * constant says", cell by cell.
 */
claim("R", "L5", "the content file's per-form blind rate is FALSE on the shipped bank, and the engine prices the measurement instead", () => {
  const rows = SCORED_FORMS.map(
    (x) =>
      `${x}: declared ${TRUE_FORM[x]}, pooled ${f(measuredByForm[x].rate, 4)}, WORST CELL ${f(measuredByForm[x].worst, 3)} at ${measuredByForm[x].worstCell}`
  );
  const understated = SCORED_FORMS.filter((x) => measuredByForm[x].worst > TRUE_FORM[x]);
  // Every form the constant understates must have every offending cell either refused or lifted.
  // Cells the stream barely touches are named rather than judged: a cell served six times in
  // 40,000 items cannot be estimated from the stream, and the engine's own 160-draw-per-cell audit
  // is the better evidence about it. Naming them is what keeps that from being a hiding place.
  const unhandled = [];
  const tooThin = [];
  for (const [cell, m] of Object.entries(measuredServed)) {
    const [kpId, form] = cell.split("|");
    if (m.rate <= (TRUE_FORM[form] ?? 0)) continue;
    if (!enginePricing.isScorable(kpId, form, "solo")) continue;
    const priced = enginePricing.modelledGuess(kpId, GRAPH.band(kpId), form, "solo");
    if (priced + 1e-9 >= wilsonLower(m.hits, m.n)) continue;
    if (m.n < MIN_CELL_N) tooThin.push(`${cell} n=${m.n} rate ${f(m.rate, 3)} priced ${f(priced, 3)} (engine audit says ${f(enginePricing.bankBlindRate(kpId, form), 3)})`);
    else unhandled.push(cell);
  }
  return {
    value:
      `${rows.join("; ")} — ${understated.length}/${SCORED_FORMS.length} forms understated by the constant; ` +
      `${unhandled.length} cells left under-priced at n>=${MIN_CELL_N}` +
      (tooThin.length ? `; ${tooThin.length} too thinly served to judge from the stream: ${tooThin.join(", ")}` : ""),
    pass: unhandled.length === 0,
  };
});
claim("T", "L5", "every generator family the bank gives away above maxTrueGuess is REFUSED and named, and nothing certifies on one", () => {
  const refusals = enginePricing.cellPricing.description.rejectedCells.filter((r) => r.family);
  // Any cell whose SURVIVING families are still definitely over the cap would be a live leak.
  const stillHot = Object.entries(measuredServed).filter(([cell, m]) => {
    const [kpId, form] = cell.split("|");
    return enginePricing.isScorable(kpId, form, "solo") && m.n >= MIN_CELL_N && wilsonLower(m.hits, m.n) > OVER_CAP;
  });
  return {
    value:
      `${refusals.length} generator families refused, each answerable by ONE string: ` +
      `${refusals.slice(0, 6).map((r) => `${r.cell}::${r.family.split(".").pop()} ${f(r.blind, 3)} by typing ${JSON.stringify(r.modalAnswer)}`).join("; ")}` +
      `${refusals.length > 6 ? ` (+${refusals.length - 6} more)` : ""}; ` +
      `${stillHot.length} surviving cells still over the cap; bank-priced bot peak ever certified ${bankGuesser.peakEverMastered}`,
    pass: refusals.length > 0 && stillHot.length === 0 && bankGuesser.peakEverMastered === 0,
  };
});
/**
 * L5 WITH NO RATE PARAMETER ANYWHERE. Real items, real strings, `ItemBank.check()` as the judge.
 * The bots' success is an OUTPUT of this run, printed below, not an input to it.
 */
claim("V", "L5", "LIVE bank, no rate parameter: the blind guesser certifies NOTHING and its measured success is an output", () => ({
  value: `guesser answered ${liveGuesser.liveRight}/${liveGuesser.liveServed} items right on the real bank (${pct(liveGuesser.liveRate ?? 0)}, decided by ItemBank.check) and certified ${liveGuesser.meanMastered.toFixed(4)}/32 (max ${liveGuesser.maxMastered}, peak ever ${liveGuesser.peakEverMastered}, gate opened on ${liveGuesser.meanGateOpens.toFixed(3)} nodes/run)`,
  pass: liveGuesser.peakEverMastered === 0 && (liveGuesser.liveRate ?? 0) > 0,
}));
claim("W", "L5", "LIVE bank: a hint-abuser that answers EVERY item correctly certifies nothing", () => ({
  value: `raw success ${pct(liveHintAbuser.liveRate ?? 0)} (${liveHintAbuser.liveRight}/${liveHintAbuser.liveServed} items, every one of them marked correct by ItemBank.check); certified ${liveHintAbuser.meanMastered.toFixed(4)}/32, peak ever ${liveHintAbuser.peakEverMastered}, refused upward ${liveHintAbuser.meanRefusedUpward.toFixed(0)} items/run`,
  pass: liveHintAbuser.peakEverMastered === 0 && (liveHintAbuser.liveRate ?? 0) > 0.95 && liveHintAbuser.meanRefusedUpward > 100,
}));
claim("X", "L4", "LIVE bank: the median learner still reaches >= 80% of Level 1 with the real checker marking every answer", () => ({
  value: `median ${liveMedian.median.toFixed(1)}%, p10 ${liveMedian.p10.toFixed(1)}%, ${pct(liveMedian.shareAt80)} of learners at >= 80%; raw item accuracy ${pct(liveMedian.liveRate ?? 0)}`,
  pass: liveMedian.median >= 80,
}));
claim("S", "L5", "sensitivity: the gate holds at 3x the assumed blind rate (§9's first tripwire, 0.10)", () => {
  const at010 = sweep.find((s) => s.rate === 0.1).cohort;
  const at017 = sweep.find((s) => s.rate === 0.17).cohort;
  return {
    value: `certified/32 at forced blind rate: ${sweep.map((s) => `${s.rate} -> ${s.cohort.meanMastered.toFixed(3)}`).join(", ")}`,
    pass: at010.meanMastered < 0.05 && at017.meanMastered < 0.5,
  };
});
/**
 * The control's job is SEPARATION, so its bar is a ratio and a majority of the graph, not a fixed
 * count. Round 2's bar was "the leak arm unlocks >= 20 of 32", and that number was read off a
 * pricing table that has since refused 49 family groups: the leak arm now has materially less soft
 * content to farm, which is the piece working rather than the control weakening. Both numbers are
 * printed, so the movement is visible instead of being absorbed by a rewritten threshold.
 */
claim("L", "L5", "control arm: the harness can SEE a leak — the bug arm opens the gate on most of the graph, the shipped rules on none of it", () => ({
  value:
    `leak arm unlocks ${hintLeak.meanUnlocked.toFixed(1)}/32 nodes per run (${pct(hintLeak.meanUnlocked / TOTAL)} of the graph, ` +
    `${(hintLeak.meanUnlocked / Math.max(hintAbuser.meanUnlocked, 1e-6)).toFixed(0)}x the shipped hint-abuse arm); ` +
    `shipped hint-abuse arm unlocks ${hintAbuser.meanUnlocked.toFixed(2)}/32; guessing bot ${guesser.meanUnlocked.toFixed(2)}/32; form-hunting bot ${formHunter.meanUnlocked.toFixed(2)}/32`,
  pass:
    hintLeak.meanUnlocked > TOTAL / 2 &&
    hintLeak.meanUnlocked >= 25 * Math.max(hintAbuser.meanUnlocked, guesser.meanUnlocked) &&
    hintAbuser.meanUnlocked < 4 &&
    formHunter.meanUnlocked === 0,
}));
claim("H", "L5", "form-hunting bot (judge2/select4 on every item): 0 certified AND `scored` never increments", () => ({
  value: `certified ${formHunter.maxMastered}, max M2 counter ${formHunter.maxScoredCounter}, unscored items/run ${formHunter.meanUnscoredItems.toFixed(0)}`,
  pass: formHunter.maxMastered === 0 && formHunter.maxScoredCounter === 0,
}));
claim("I", "L5", "retention check pass rate for real learners is 80-95% (a gate, not a formality)", () => ({
  value: pct(median.retentionPassRate ?? 0),
  pass: (median.retentionPassRate ?? 0) >= 0.8 && (median.retentionPassRate ?? 0) <= 0.95,
}));
claim("J", "L4", "§4.1 is load-bearing: turning BOTH selection rules off costs >= 6 knowledge points", () => ({
  value: `${median.meanMastered.toFixed(1)} certified with the rules, ${ablated.meanMastered.toFixed(1)} without`,
  pass: median.meanMastered - ablated.meanMastered >= 6,
}));
claim("M", "L4", "L4 does not depend on the §1.2 prerequisite spacing-clock reset (the rule that can only flatter it)", () => ({
  value: `${median.median.toFixed(1)}% with the rule, ${noClockReset.median.toFixed(1)}% without (mean certified ${median.meanMastered.toFixed(1)} vs ${noClockReset.meanMastered.toFixed(1)})`,
  pass: noClockReset.median >= 80,
}));
claim("K", "L2/L5", `every deterministic engine assertion passes (${asserts.length} checks)`, () => ({
  value: `${asserts.filter((a) => a.ok).length}/${asserts.length}`,
  pass: asserts.every((a) => a.ok),
}));

// ------------------------------------------------ PART D — §8's conformance table, measured
//
// Six rows, six bands, measured on THIS engine. A row that misses is printed as a miss with its
// real value. One miss is DECLARED — it is a disagreement about the session budget, and the
// reason is stated rather than the band quietly widened, which is what round 1 did.

const at18 = median.atSession(18);
/** The first session at which the median learner's mastery lands INSIDE §8's 90-96% band. */
let bandEnteredAt = null;
let bandEnteredValue = null;
for (let k = 1; k <= SESSIONS; k++) {
  const a = median.atSession(k);
  if (a && a.median >= 90 && a.median <= 96) {
    bandEnteredAt = k;
    bandEnteredValue = a.median;
    break;
  }
}

/**
 * Stated, not widened. Round 1 of this script quietly reframed this row to a >= 80% threshold at
 * 22 sessions, which is a different claim about a different budget. The numbers cited from the
 * reference simulation are line-checkable in `review/p03/evidence/mastery-sim.txt`.
 */
const DECLARED_MISS =
  `§8's row is stated against an 18-session budget; §5 of the same document, and ` +
  `review/p03/mastery-sim.mjs, both run 22. On 18 sessions this engine's median learner holds ` +
  `${at18.median.toFixed(1)}% with ${pct(at18.shareAt80)} of learners past 80%, and lands inside the 90-96% band at ` +
  `session ${bandEnteredAt ?? ">" + SESSIONS}${bandEnteredValue == null ? "" : ` (${bandEnteredValue.toFixed(1)}%)`}. ` +
  `The row is not reproduced by the design's OWN script either: ` +
  `\`node review/p03/mastery-sim.mjs --sessions=18 --learners=200\` measures the median learner at ` +
  `71.9%, and the committed evidence at review/p03/evidence/mastery-sim.txt line 107 reads ` +
  `"by session 18 (7.5 h of play): 24.3% of learners have >= 80% mastery" with line 113 putting the ` +
  `median at 20 sessions to 80%. This engine is AHEAD of the reference on that row ` +
  `(${at18.median.toFixed(1)}% against 71.9%) and still misses the band. ` +
  `The honest conclusion is that §8's 18-session row is stated against ` +
  `the wrong budget and belongs at ${bandEnteredAt ?? "20+"} sessions. That is a P03 content defect to fix in ` +
  `the document, not a reason to move P16's own bar or to widen a band.`;

const conformance = [
  {
    row: "median learner, mastered % at 18 sessions",
    target: "90-96%",
    value: `${at18.median.toFixed(1)}%`,
    hit: at18.median >= 90 && at18.median <= 96,
    declared: DECLARED_MISS,
  },
  {
    row: "mixed population, share >= 80% at 24 sessions",
    target: ">= 95%",
    value: pct(mixedLong.shareAt80),
    hit: mixedLong.shareAt80 >= 0.95,
  },
  {
    row: "retention check pass rate, real learners",
    target: "85-92%",
    value: pct(median.retentionPassRate ?? 0),
    hit: (median.retentionPassRate ?? 0) >= 0.85 && (median.retentionPassRate ?? 0) <= 0.92,
  },
  {
    row: "patient guessing bot, mean KPs certified",
    target: "< 0.01 of 32",
    value: guesser.meanMastered.toFixed(4),
    hit: guesser.meanMastered < 0.01,
  },
  {
    row: "bot served judge2/select4, KPs certified",
    target: "exactly 0, `scored` never increments",
    value: `${formHunter.maxMastered} certified, max M2 counter ${formHunter.maxScoredCounter}`,
    hit: formHunter.maxMastered === 0 && formHunter.maxScoredCounter === 0,
  },
  {
    row: "median scored opportunities to 80% mastery",
    target: "480-600",
    value: median.medianScoredTo80 == null ? "never reached" : String(Math.round(median.medianScoredTo80)),
    hit: median.medianScoredTo80 != null && median.medianScoredTo80 >= 480 && median.medianScoredTo80 <= 600,
  },
];
const undeclaredMisses = conformance.filter((c) => !c.hit && !c.declared);
const declaredMisses = conformance.filter((c) => !c.hit && c.declared);

// ------------------------------------------------------------------------------------- output

say("P16 — mastery engine: measured proof of L4 and L5");
say("=".repeat(100));
say(`engine under test: app/src/learn/{Graph,Mastery,Scheduler,ItemBank}.js   content: content/knowledge-graph.json`);
say(`graph: ${JSON.stringify(GRAPH.stats())}`);
say(
  `gate: P >= ${M.bkt.masteryThreshold}, >= ${M.bkt.minScoredOpportunities} scored (>= ${M.bkt.minAtBandOpportunities} at band), >= ${M.bkt.minDistinctItemForms} forms, ` +
    `then ${M.spacing.retentionCheck.passAtLeast}/${M.spacing.retentionCheck.items} CREDITED AND P >= ${M.bkt.masteryThreshold} at a check >= ${M.spacing.retentionCheck.minHours} h and >= ${M.spacing.retentionCheck.minInterveningSessions} session later`
);
say(`budget: ${SESSIONS} sessions x ${SESSION_MINUTES} min, one session per day. Bots: ${BOTS}/arm, learners: ${LEARNERS}/cohort. ${elapsed}s`);
say("");
say("TRUE blind-success rates the bots draw from (ground truth, never the model's guess):");
say(`  declared by form:  ${Object.entries(TRUE_FORM).map(([k, v]) => `${k} ${v}`).join("   ")}`);
say(`  declared by phase: ${Object.entries(TRUE_PHASE).map(([k, v]) => `${k} ${v}`).join("   ")}`);
say(
  `  MEASURED on the SCHEDULER-DRIVEN SERVED STREAM: ${SERVED.length} items over ${STREAM_RUNS} runs x ${SESSIONS} sessions, ` +
    `${pct(SERVED_SHARE)} catalogue / ${pct(1 - SERVED_SHARE)} generated, ${bankMs} ms`
);
say(`     best fixed answer, pooled:   ${SCORED_FORMS.map((x) => `${x} ${f(measuredByForm[x].rate, 4)}`).join("   ")}`);
say(`     best fixed answer, WORST kp: ${SCORED_FORMS.map((x) => `${x} ${f(measuredByForm[x].worst, 4)} (${measuredByForm[x].worstCell})`).join("   ")}`);
say(`     chosen on one half of the stream and SCORED ON THE OTHER, so none of these is an in-sample maximum.`);
say(`  for contrast, the model's own belief at band 3: ${Object.keys(TRUE_FORM).map((f2) => `${f2} ${(BAND[3].guess * (M.guessByForm[f2] ?? 1)).toFixed(3)}`).join("   ")}`);
say("");

say("PART A — deterministic engine assertions");
say("-".repeat(100));
for (const a of asserts) {
  say(`  ${a.ok ? "PASS" : "FAIL"}  ${a.id}  ${a.statement}`);
  if (a.detail) say(`             ${a.detail}`);
}
say("");

say("PART A2 — blind success measured on the stream the SCHEDULER actually serves");
say("-".repeat(100));
say("  Strategy: type ONE string on every item of a (knowledge point x form) cell and keep the best.");
say("  Population: Scheduler.next() -> req.avoidItemIds -> ItemBank.select(). Nothing here draws items by hand.");
say("  The string is chosen on half the stream and scored on the other half; the verdict is ItemBank.check().");
say("");
say(`  audit table mixture ${pct(AUDIT.mixture.catalogue / AUDIT.sampled)} catalogue vs served stream ${pct(SERVED_SHARE)} catalogue`);
say("");
say("  form/answerType".padEnd(30) + "n served".padStart(10) + "worst cell".padStart(12));
for (const [k, v] of Object.entries(measuredByType).sort((a, b) => b[1].best - a[1].best)) {
  say(`  ${k}`.padEnd(30) + String(v.n).padStart(10) + f(v.best, 4).padStart(12));
}
say("");
if (hotCells.length) {
  say(`  cells above the §9 tripwire of ${TRIPWIRE}, with the string that does it and what the ENGINE did about it:`);
  say(
    "    cell".padEnd(38) + "blind".padStart(8) + "n".padStart(6) + "  by typing".padEnd(26) + "engine verdict"
  );
  for (const h of hotCells) {
    const [kpId, form] = h.cell.split("|");
    const scorable = enginePricing.isScorable(kpId, form, "solo");
    const priced = scorable ? enginePricing.modelledGuess(kpId, GRAPH.band(kpId), form, "solo") : null;
    const base = GRAPH.band(kpId).guess * (M.guessByForm[form] ?? 1);
    say(
      `    ${h.cell}`.padEnd(38) +
        f(h.rate, 4).padStart(8) +
        String(h.n).padStart(6) +
        `  ${JSON.stringify(h.answer)}`.padEnd(26) +
        (scorable
          ? `re-priced ${f(base, 3)} -> ${f(priced, 3)}`
          : `*** REFUSED (was priced ${f(base, 3)}) ***`)
    );
  }
} else {
  say(`  no (kp x form) cell above the §9 tripwire of ${TRIPWIRE}.`);
}
say("");
say("  WHAT THE ENGINE REFUSED, at the granularity the fix has to happen at — one generator family,");
say("  one string that answers everything it will ever produce. This is the P17 work list:");
const D = enginePricing.cellPricing.description;
for (const r of D.rejectedCells.filter((x) => x.family))
  say(`    ${(r.cell + " :: " + r.family).padEnd(56)} ${f(r.blind, 3)}  by typing ${JSON.stringify(r.modalAnswer)}`);
for (const r of D.rejectedCells.filter((x) => !x.family)) say(`    ${r.cell.padEnd(56)} ALL FAMILIES REFUSED — ${r.reason}`);
say("");
say(
  `  CONSEQUENCE: ${D.rejectedCells.filter((x) => x.family).length} families and ${D.rejectedCells.filter((x) => !x.family).length} whole cells refused; ` +
    `${D.repricedCells.length} cells re-priced upward; ${D.relaxed.length} knowledge points down to one honest form; ` +
    `${D.unmasterable.length} unmasterable (${D.unmasterable.join(", ") || "none"})`
);
for (const r of D.relaxed) say(`    ${r.kpId.padEnd(24)} survives on: ${r.forms.join(", ")}`);
say(`  Level 1 ceiling with the bank as shipped: ${GRAPH.ids.length - D.unmasterable.length}/${GRAPH.ids.length} knowledge points.`);
say("");

say("PART B — cohorts");
say("-".repeat(100));
const cols = ["cohort", "n", "sess", "p10", "median", "p90", ">=80%", "certified", "peak", "items", "unscored", "refused"];
say(cols[0].padEnd(32) + cols.slice(1).map((c, i) => c.padStart([5, 5, 8, 8, 8, 8, 10, 6, 8, 9, 9][i])).join(""));
const row = (label, c) =>
  say(
    label.padEnd(32) +
      String(c.n).padStart(5) +
      String(c.sessions).padStart(5) +
      `${c.p10.toFixed(1)}%`.padStart(8) +
      `${c.median.toFixed(1)}%`.padStart(8) +
      `${c.p90.toFixed(1)}%`.padStart(8) +
      pct(c.shareAt80).padStart(8) +
      c.meanMastered.toFixed(3).padStart(10) +
      String(c.peakEverMastered).padStart(6) +
      String(Math.round(c.medianItems)).padStart(8) +
      c.meanUnscoredItems.toFixed(0).padStart(9) +
      c.meanRefusedUpward.toFixed(0).padStart(9)
  );
row("median learner", median);
row("mixed population (long)", mixedLong);
row("LIVE median learner", liveMedian);
row("LIVE blind guesser", liveGuesser);
row("LIVE hint-abuser (100% right)", liveHintAbuser);
row("patient guessing bot", guesser);
row("bank-priced guessing bot", bankGuesser);
row("mashing bot", masher);
row("form-hunting bot", formHunter);
row("hint-abusing bot", hintAbuser);
row("hint-leak bot (acquisition)", hintLeak);
row("retention hint-leak bot", retentionHintLeak);
row("retention speed bot", retentionFast);
row("^ SAME arm, round-1 M4 rule", legacyRetention);
row("median, §4.1 rules OFF", ablated);
row("median, prereq clock reset OFF", noClockReset);
say("");
say(
  `  median learner: mean theta ${median.meanTheta.toFixed(2)}, retention pass rate ${pct(median.retentionPassRate ?? 0)}, ` +
    `median sessions to 80% ${median.medianSessionsTo80}, median scored opportunities to 80% ${median.medianScoredTo80 == null ? "n/a" : Math.round(median.medianScoredTo80)}`
);
say("");
say("  LIVE arms — every answer a real string, marked by ItemBank.check(). No rate parameter exists in this loop:");
for (const [label, c] of [
  ["median learner", liveMedian],
  ["blind guesser", liveGuesser],
  ["hint-abuser", liveHintAbuser],
])
  say(
    `    ${label.padEnd(18)} raw item accuracy ${pct(c.liveRate ?? 0).padStart(7)} (${c.liveRight}/${c.liveServed})` +
      `   certified ${c.meanMastered.toFixed(3).padStart(7)}/32   peak ever ${String(c.peakEverMastered).padStart(2)}   gate opens ${c.meanGateOpens.toFixed(2)}`
  );
say("");
say("  sensitivity of L5 to the hand-authored `trueGuessByForm.construct = 0.03`:");
say("    forced blind rate   certified/32   >=80% of runs");
for (const s of sweep)
  say(`      ${String(s.rate).padEnd(6)}            ${s.cohort.meanMastered.toFixed(3).padStart(8)}      ${pct(s.cohort.shareAt80).padStart(8)}`);
say("");
say("  Level 1 is gated by mastery, not by a clock, so the honest question is how LONG to 80%:");
say("    session   hours   median learner: median %   share >= 80%      mixed population: median %   share >= 80%");
for (const k of CURVE) {
  const a = median.atSession(k);
  const b = mixedLong.atSession(k);
  if (!a && !b) continue;
  say(
    `      ${String(k).padStart(2)}     ${((k * SESSION_MINUTES) / 60).toFixed(1)}` +
      (a ? `${a.median.toFixed(1)}%`.padStart(24) + pct(a.shareAt80).padStart(15) : "".padStart(39)) +
      (b ? `${b.median.toFixed(1)}%`.padStart(29) + pct(b.shareAt80).padStart(15) : "")
  );
}
say("");

// ---------------------------------------------- §7 of RESUME.md, answered route by route
//
// Three ways scaffolded practice was once laundered into mastery. Each one gets the evidence that
// closes it AND the control that proves this harness could still see it if it reopened.

const routeRow = (n, route, closedBy, control) => {
  say(`  ROUTE ${n}. ${route}`);
  say(`     closed by : ${closedBy}`);
  say(`     control   : ${control}`);
};
const A = Object.fromEntries(asserts.map((a) => [a.id, a]));
const allOk = (...ids) => ids.every((id) => A[id]?.ok);

say("§7 — the three laundering routes, re-verified against the code as it stands");
say("=".repeat(100));
routeRow(
  1,
  "hinted / scaffolded items credited at the SAME guess parameter as unconstrained ones",
  `guided-1 is scorable but never mastery-eligible (U6 ${A.U6?.ok ? "PASS" : "FAIL"}); a hinted correct is refused UPWARD while a ` +
    `hinted wrong is scored normally (U11 ${A.U11?.ok ? "PASS" : "FAIL"}); a retention item forced to guided-1 scores but is not ` +
    `credited (U22 ${A.U22?.ok ? "PASS" : "FAIL"}); the phase multiplier composes by MAX, never product (U7 ${A.U7?.ok ? "PASS" : "FAIL"})`,
  `the LIVE hint-abuser answers ${pct(liveHintAbuser.liveRate ?? 0)} of real items correctly through ItemBank.check() and certifies ` +
    `${liveHintAbuser.meanMastered.toFixed(3)}/32, refusing ${liveHintAbuser.meanRefusedUpward.toFixed(0)} items per run; the acquisition-leak arm ` +
    `unlocks ${hintLeak.meanUnlocked.toFixed(1)}/32 nodes, so the detector is live`
);
routeRow(
  2,
  "a CIRCULAR bot proof — true success rate set equal to the model's own guess parameter",
  `the LIVE arms have no rate at all: item from ItemBank.select(), string from the bot, verdict from ItemBank.check(). ` +
    `The guesser's ${pct(liveGuesser.liveRate ?? 0)} (${liveGuesser.liveRight}/${liveGuesser.liveServed}) is an OUTPUT. PART A2 derives every ` +
    `blind rate from the shipped bank per generator family, and the engine refuses ${enginePricing.cellPricing.description.rejectedCells.length} of them`,
  `the sensitivity sweep certifies ${sweep[sweep.length - 1].cohort.meanMastered.toFixed(2)}/32 at a forced blind rate of ` +
    `${sweep[sweep.length - 1].rate}, so a bot that really could guess would show up here`
);
routeRow(
  3,
  "M4's retention count reading raw `outcome.correct` and ignoring the scaffold discount",
  `Scheduler.submit keeps NO tally (U24 ${A.U24?.ok ? "PASS" : "FAIL"}); the single tally lives in Mastery._bookkeep and counts ` +
    `result.credited; four hinted corrects certify nothing and lapse the node (U20 ${A.U20?.ok ? "PASS" : "FAIL"}), four 100 ms corrects the ` +
    `same (U21 ${A.U21?.ok ? "PASS" : "FAIL"}), four honest ones DO certify (U19 ${A.U19?.ok ? "PASS" : "FAIL"})`,
  `LegacyCountingScheduler restores that one line and the IDENTICAL arm certifies ${legacyRetention.meanMastered.toFixed(2)}/32 ` +
    `(${pct(legacyRetention.shareAt80)} of runs past 80%) against ${retentionHintLeak.meanMastered.toFixed(4)} under the shipped rule`
);
say(
  `  All three closed: ${allOk("U6", "U7", "U11", "U19", "U20", "U21", "U22", "U24") ? "YES" : "NO"}; ` +
    `all three controls non-zero: ${hintLeak.meanUnlocked > 0 && legacyRetention.meanMastered > 0 && sweep[sweep.length - 1].cohort.meanMastered > 0 ? "YES" : "NO"}`
);
say("");

say("PART C — claims");
say("=".repeat(100));
let allPass = true;
const claimRows = [];
for (const c of CLAIMS) {
  const r = c.get();
  allPass = allPass && r.pass;
  claimRows.push({ id: c.id, gate: c.gate, statement: c.statement, value: r.value, pass: r.pass });
  say(`  ${r.pass ? "PASS" : "FAIL"}  [${c.gate.padEnd(5)}] ${c.id}. ${c.statement}`);
  say(`             measured: ${r.value}`);
}
say("");

say("PART D — §8 conformance table, measured on this engine");
say("=".repeat(100));
for (const c of conformance) {
  say(`  ${c.hit ? "HIT " : "MISS"}  ${c.row.padEnd(48)} target ${c.target.padEnd(34)} measured ${c.value}`);
}
if (declaredMisses.length) {
  say("");
  say("  DECLARED MISS — stated, not widened:");
  for (const c of declaredMisses) {
    say(`    ${c.row}: measured ${c.value} against ${c.target}.`);
    for (const line of wrap(c.declared, 96)) say(`      ${line}`);
  }
}
say("");

const conformanceOk = undeclaredMisses.length === 0 && (!STRICT || declaredMisses.length === 0);
const result = allPass && conformanceOk ? "PASS" : "FAIL";
say(
  `RESULT: ${result} — ${claimRows.filter((c) => c.pass).length}/${claimRows.length} claims, ` +
    `${asserts.filter((a) => a.ok).length}/${asserts.length} assertions, ` +
    `§8 conformance ${conformance.filter((c) => c.hit).length}/${conformance.length} rows` +
    (declaredMisses.length ? ` (+${declaredMisses.length} declared miss${declaredMisses.length > 1 ? "es" : ""}; run with --strict to fail on it)` : "")
);

function wrap(s, n) {
  const words = s.split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > n) {
      lines.push(line.trim());
      line = w;
    } else line += " " + w;
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

const json = {
  generated: new Date().toISOString(),
  engine: "app/src/learn/{Graph,Mastery,Scheduler,ItemBank}.js",
  graph: GRAPH.stats(),
  budget: { sessions: SESSIONS, sessionMinutes: SESSION_MINUTES, learners: LEARNERS, bots: BOTS, streamRuns: STREAM_RUNS, streamItems: SERVED.length, streamCatalogueShare: Number(SERVED_SHARE.toFixed(4)) },
  trueGuessByForm: TRUE_FORM,
  trueGuessByPhase: TRUE_PHASE,
  measuredBlindByForm: Object.fromEntries(
    Object.entries(measuredByForm).map(([k, v]) => [
      k,
      {
        n: v.n,
        hits: v.hits,
        pooledRate: Number(v.rate.toFixed(5)),
        upper95: Number(v.upper95.toFixed(5)),
        worstCellRate: Number(v.worst.toFixed(5)),
        worstCell: v.worstCell,
      },
    ])
  ),
  measuredBlindByAnswerType: Object.fromEntries(Object.entries(measuredByType).map(([k, v]) => [k, { n: v.n, bestCellRate: Number(v.best.toFixed(5)) }])),
  measuredBlindHotCells: hotCells.map((h) => {
    const [kpId, form] = h.cell.split("|");
    const scorable = enginePricing.isScorable(kpId, form, "solo");
    return {
      cell: h.cell,
      rate: Number(h.rate.toFixed(5)),
      byTyping: h.answer,
      types: h.types,
      n: h.n,
      engineVerdict: scorable ? "re-priced" : "refused",
      modelledGuessBefore: Number((GRAPH.band(kpId).guess * (M.guessByForm[form] ?? 1)).toFixed(5)),
      modelledGuessAfter: scorable ? Number(enginePricing.modelledGuess(kpId, GRAPH.band(kpId), form, "solo").toFixed(5)) : null,
    };
  }),
  bankPricing: enginePricing.cellPricing.description,
  sensitivitySweep: sweep.map((s) => ({ forcedBlindRate: s.rate, meanCertified: Number(s.cohort.meanMastered.toFixed(4)), shareAt80: Number(s.cohort.shareAt80.toFixed(4)) })),
  assertions: asserts,
  cohorts: { median, mixedLong, liveMedian, liveGuesser, liveHintAbuser, guesser, bankGuesser, masher, formHunter, hintAbuser, hintLeak, retentionHintLeak, retentionFast, legacyRetention, ablated, noClockReset },
  claims: claimRows,
  conformance: conformance.map((c) => ({ row: c.row, target: c.target, value: c.value, hit: c.hit, declaredMiss: c.declared ?? null })),
  result,
};

if (hasFlag("json")) {
  console.log(JSON.stringify(json, null, 2));
} else {
  console.log(out.join("\n"));
  console.log("");
  console.log("JSON TABLE");
  console.log(
    JSON.stringify(
      {
        result: json.result,
        claims: claimRows,
        conformance: json.conformance,
        measuredBlindByForm: json.measuredBlindByForm,
        measuredBlindHotCells: json.measuredBlindHotCells,
        sensitivitySweep: json.sensitivitySweep,
        cohorts: Object.fromEntries(
          Object.entries(json.cohorts).map(([k, v]) => [
            k,
            {
              n: v.n,
              sessions: v.sessions,
              medianPercent: Number(v.median.toFixed(2)),
              shareAt80: Number(v.shareAt80.toFixed(4)),
              meanCertified: Number(v.meanMastered.toFixed(4)),
              maxCertified: v.maxMastered,
              peakEverCertified: v.peakEverMastered,
              maxM2Counter: v.maxScoredCounter,
              meanUnscoredItems: Number(v.meanUnscoredItems.toFixed(1)),
              meanRefusedUpward: Number(v.meanRefusedUpward.toFixed(1)),
              meanLapses: Number(v.meanLapses.toFixed(2)),
              medianScoredTo80: v.medianScoredTo80 == null ? null : Math.round(v.medianScoredTo80),
              retentionPassRate: v.retentionPassRate == null ? null : Number(v.retentionPassRate.toFixed(4)),
            },
          ])
        ),
      },
      null,
      2
    )
  );
}

process.exitCode = result === "PASS" ? 0 : 1;
