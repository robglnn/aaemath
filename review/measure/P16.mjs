/**
 * P16 — the proof.
 *
 *   node review/measure/P16.mjs
 *   node review/measure/P16.mjs --learners=2000 --sessions=18 --json
 *
 * This script does not restate the design. It drives the SHIPPED ENGINE — the very
 * `app/src/learn/{Graph,Mastery,Scheduler}.js` the browser boots — through a population of
 * simulated learners and a set of hostile bots, and prints PASS/FAIL against thresholds stated
 * at the top of the file. If it prints FAIL, P16 is wrong.
 *
 * =============================================================================================
 * THE RULE THIS FILE EXISTS TO OBEY
 *
 * A bot's probability of being right is NEVER read from the model's own `guess` parameter. It is
 * read from `model.trueGuessByForm` / `model.trueGuessByPhase` — ground truth derived from the
 * size of an answer space, owing nothing to BKT — and it is looked up from the form and phase the
 * SCHEDULER ACTUALLY SERVED on that item, not from a form the harness chose in advance. Setting
 * `correct = rng() < guess` is not a test; it is the model's assumption restated with a number on
 * it, and a critic has already destroyed one attempt for exactly that.
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
 *  B2  `hintLeak` additionally models P18 shipping the hint surface into `solo` BY MISTAKE, where
 *      the engine is never told: 0.85 true success on every acquisition item, reported unhinted.
 *      This is the implementation bug the design has to survive, not a legal strategy.
 *  B3  The leak in B2 stops at acquisition. Consolidation, retention and review are built by the
 *      Scheduler at `phase: solo, hinted: false` from `model.spacing`, and a leak into THOSE would
 *      defeat the design outright — which is precisely why the JSON states `hinted: false` three
 *      separate times. Stated because it is the assumption that most protects the result.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";

import { Graph, GraphError } from "../../app/src/learn/Graph.js";
import { Mastery, bktUpdate, REVIEW_LAPSE_BELOW } from "../../app/src/learn/Mastery.js";
import { Scheduler, virtualClock, mulberry32 } from "../../app/src/learn/Scheduler.js";

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
/**
 * 22 sessions x 25 min is the budget `review/p03/mastery-sim.mjs` defaults to and the budget its
 * committed evidence file was generated at. §5 of design/learning-architecture.md says "18
 * sessions" in its prose and then quotes the 22-session numbers, which is a defect in that
 * document reported in the P16 handoff rather than silently adopted. This script measures at 22
 * and prints the whole session-by-session curve, so the 18-session figure is visible too and
 * nobody has to take a budget on trust.
 */
const SESSIONS = argNum("sessions", 22);
const LONG_SESSIONS = argNum("longSessions", 24);
const SESSION_MINUTES = argNum("sessionMinutes", 25);
const CURVE = [12, 16, 18, 20, 22, 24];

const GRAPH = new Graph(source);
const M = GRAPH.model;
const TOTAL = GRAPH.ids.length;
const BAND = Object.fromEntries(M.bands.map((b) => [b.difficulty, b]));
const TRUE_FORM = Object.fromEntries(Object.entries(M.trueGuessByForm).filter(([, v]) => typeof v === "number"));
const TRUE_PHASE = Object.fromEntries(Object.entries(M.trueGuessByPhase).filter(([, v]) => typeof v === "number"));
const UNSCORED_FORMS = M.forms.unscored;

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
function bench({ seed = 1 } = {}) {
  const clock = virtualClock(0);
  const mastery = new Mastery(GRAPH, { now: () => clock.minutes(), emit: () => {}, storage: null });
  const sched = new Scheduler(mastery, { clock, rng: mulberry32(seed), sessionMinutes: SESSION_MINUTES });
  sched.beginSession();
  return { clock, mastery, sched };
}

const snapOf = (m, id) => {
  const s = m.stateOf(id);
  return { p: s.p, scored: s.scored, atBand: s.atBand, forms: [...s.forms].join(","), status: s.status };
};

check("U1", "Graph validates the real content and rejects a cyclic graph", () => {
  new Graph(source); // must not throw
  const broken = structuredClone(source);
  broken.nodes.find((n) => n.id === "var-meaning").prerequisites = ["expr-anatomy"];
  let threw = null;
  try {
    new Graph(broken);
  } catch (e) {
    threw = e;
  }
  if (!(threw instanceof GraphError)) return { ok: false, detail: "cyclic graph did not throw GraphError" };
  const sawCycle = threw.issues.some((i) => i.includes("CYCLIC"));
  return { ok: sawCycle, detail: sawCycle ? threw.issues.find((i) => i.includes("CYCLIC")) : threw.message };
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
    ok: r.scored === true && r.masteryEligible === false && moved && !counted,
    detail: `p ${f(before.p)} -> ${f(after.p)}, scored ${before.scored} -> ${after.scored}`,
  };
});

check("U7", "the two axes compose by MAX, never by product", () => {
  const { mastery } = bench();
  const b1 = BAND[1];
  const g = mastery.modelledGuess(b1, "construct", "guided-1");
  const gg = mastery.modelledGuess(b1, "generate", "guided-1");
  const t = mastery.trueGuess("construct", "guided-3");
  const solo = mastery.modelledGuess(BAND[3], "generate", "solo");
  const okMax = Math.abs(g - 0.05 * 2) < 1e-12 && Math.abs(gg - 0.05 * 2) < 1e-12 && t === 0.85;
  return { ok: okMax, detail: `b1 construct/guided-1 ${f(g)}, b1 generate/guided-1 ${f(gg)} (product would be ${f(0.05 * 0.6 * 2)}), true construct/guided-3 ${f(t, 2)}, b3 generate/solo ${f(solo)}` };
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

check("U9", "the derived scorable matrix is exactly {construct,repair,generate} x {solo,guided-1}", () => {
  const { mastery } = bench();
  const d = mastery.pricing.description;
  return {
    ok: d.scorableCells === 6 && d.masteryEligibleCells === 3 && mastery.issues.length === 0,
    detail: `scorable ${d.scorableCells}/25 (${d.scorable}); mastery-eligible ${d.masteryEligibleCells}/25 (${d.masteryEligible}); issues ${mastery.issues.length}`,
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
  return { ok: passesLow === false && passesHigh === true && passesFew === false, detail: `p=0.90&3/4 -> ${passesLow}; p=0.97&3/4 -> ${passesHigh}; p=0.97&2/4 -> ${passesFew}` };
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
      const one = bktUpdate(p, true, b.slip, b.guess, learn, 1);
      rows.push({ band: b.difficulty, label, floor: p, one });
      if (one >= M.bkt.masteryThreshold)
        return { ok: false, detail: `band ${b.difficulty} ${label}: floor ${f(p)} + 1 correct = ${f(one)} >= ${M.bkt.masteryThreshold}` };
    }
  }
  const worst = rows.reduce((a, r) => (r.one > a.one ? r : a));
  return { ok: true, detail: `worst cell band ${worst.band} ${worst.label}: floor ${f(worst.floor)}, +1 correct ${f(worst.one)}` };
});

check("U16", "state round-trips: snapshot -> restore reproduces the probe byte for byte", () => {
  const a = runLearner({ seed: 4242, kind: "median", sessions: 3 });
  const snap = a.mastery.snapshot();
  const clock = virtualClock(a.clock.minutes());
  const fresh = new Mastery(GRAPH, { now: () => clock.minutes(), emit: () => {}, storage: null });
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
  const m1 = new Mastery(GRAPH, { now: () => clock.minutes(), emit: () => {}, storage: fake });
  m1.respond({ kpId: "var-meaning", form: "construct", phase: "solo", correct: true, mode: "acquire", latencyMs: 5000 });
  m1.persist();
  const m2 = new Mastery(GRAPH, { now: () => clock.minutes(), emit: () => {}, storage: fake });
  const hydrated = m2.hydrate();
  return { ok: hydrated && Math.abs(m1.p("var-meaning") - m2.p("var-meaning")) < 1e-15, detail: `p ${f(m1.p("var-meaning"))} -> ${f(m2.p("var-meaning"))}` };
});

// ==================================================================== PART B — the population
//
// One responder model, five kinds. Only the `answer` function differs, and only the bots' branch
// touches the ground-truth tables.

/** GROUND TRUTH for the item the scheduler ACTUALLY served. Never `guessByForm`. */
const blindRate = (form, phase) => Math.max(TRUE_FORM[form] ?? 0.03, TRUE_PHASE[phase] ?? 0);

function makeResponder(kind, rng) {
  const bot = kind !== "median" && kind !== "mixed";
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
     */
    answer(req, mastery) {
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

      let correct;
      let latencyMs = 4000 + Math.floor(rng() * 8000); // patient by default: well past the floor
      let hinted = req.hinted;

      if (bot) {
        // ------- THE LOAD-BEARING LINE. Ground truth, from the served form and phase. -------
        let rate = blindRate(req.form, req.phase);
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

      return { correct, latencyMs, hinted, itemId: `${req.kpId}#${req.seq}` };
    },
  };
}

function runLearner({ seed, kind, sessions = SESSIONS, reviewCapLift = true, pullForward = true, prerequisiteClockReset = true }) {
  const rng = mulberry32(seed);
  const clock = virtualClock(0);
  const mastery = new Mastery(GRAPH, { now: () => clock.minutes(), emit: () => {}, storage: null, prerequisiteClockReset });
  const sched = new Scheduler(mastery, {
    clock,
    rng: mulberry32(seed ^ 0x9e3779b9),
    sessionMinutes: SESSION_MINUTES,
    reviewCapLift,
    pullForward,
  });
  const responder = makeResponder(kind, rng);
  const hostileBank = kind === "formHunter";

  let retentionAttempts = 0;
  let retentionPasses = 0;
  let peakMastered = 0;
  const trace = [];

  for (let session = 0; session < sessions; session++) {
    clock.set(session * 1440); // A5: one session per day
    sched.beginSession();
    for (;;) {
      const req = sched.next();
      if (!req) break;
      // A8: an item bank that read a closed question in a diagnostic signature and shipped it.
      if (hostileBank) req.form = UNSCORED_FORMS[req.seq % UNSCORED_FORMS.length];
      const lastOfCheck = req.mode === "retention" && req.itemIndex === req.itemsInEvent - 1;
      const outcome = responder.answer(req, mastery);
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
  }

  const mastered = GRAPH.ids.filter((id) => mastery.status(id) === "mastered").length;
  const need = Math.ceil(0.8 * TOTAL);
  const at80 = trace.findIndex((m) => m >= need);
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
    theta: mastery.theta,
    retentionAttempts,
    retentionPasses,
    trace,
    sessionsTo80: at80 < 0 ? null : at80 + 1,
  };
}

function cohort(kind, n, seedBase, sessions, opts = {}) {
  const rows = [];
  for (let i = 0; i < n; i++) rows.push(runLearner({ seed: seedBase + i * 7919, kind, sessions, ...opts }));
  const p = rows.map((r) => (100 * r.mastered) / TOTAL).sort((a, b) => a - b);
  const items = rows.map((r) => r.items).sort((a, b) => a - b);
  const sum = (f) => rows.reduce((a, r) => a + f(r), 0);
  const need = Math.ceil(0.8 * TOTAL);
  /** Level 1 mastery, in percent, as it stood at the END of session k (1-indexed). */
  const atSession = (k) => {
    if (k > sessions) return null;
    const v = rows.map((r) => (100 * r.trace[k - 1]) / TOTAL).sort((a, b) => a - b);
    return { median: percentile(v, 0.5), p10: percentile(v, 0.1), shareAt80: rows.filter((r) => r.trace[k - 1] >= need).length / n };
  };
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
    retentionPassRate: sum((r) => r.retentionAttempts) ? sum((r) => r.retentionPasses) / sum((r) => r.retentionAttempts) : null,
    medianSessionsTo80: percentile(rows.map((r) => r.sessionsTo80 ?? 999).sort((a, b) => a - b), 0.5),
    shareBySession: Array.from({ length: sessions }, (_, s) => rows.filter((r) => r.trace[s] >= Math.ceil(0.8 * TOTAL)).length / n),
    meanTheta: sum((r) => r.theta) / n,
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

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

// --------------------------------------------------------------------------------- the claims

claim("A", "L4", `median learner: median Level 1 mastery at ${SESSIONS} sessions x ${SESSION_MINUTES} min >= 80%`, () => ({
  value: `${median.median.toFixed(1)}% (p10 ${median.p10.toFixed(1)}%, ${pct(median.shareAt80)} of learners at >= 80%)`,
  pass: median.median >= 80,
}));
/**
 * §5: "Level 1 is gated by mastery, not by a clock, so the honest question is not 'how much in 18
 * sessions' but 'how long to 80%'." So the second L4 claim is measured in sessions, and the
 * 18-session snapshot is printed inside it rather than quietly dropped for failing a threshold
 * this script invented.
 */
claim("A2", "L4", "median learner: median number of sessions to reach 80% of Level 1 <= 20 (8.3 h of play)", () => {
  const at18 = median.atSession(18);
  return {
    value:
      `median ${median.medianSessionsTo80} sessions; at the 18-session mark this engine's median learner holds ` +
      `${at18.median.toFixed(1)}% with ${pct(at18.shareAt80)} of learners past the bar ` +
      `(review/p03/mastery-sim.mjs --sessions=18 measures 71.9% / 9.0% on the same budget)`,
    pass: median.medianSessionsTo80 <= 20,
  };
});
claim("B", "L4", `mixed-ability population: share at >= 80% mastery by ${LONG_SESSIONS} sessions >= 90%`, () => ({
  value: pct(mixedLong.shareAt80),
  pass: mixedLong.shareAt80 >= 0.9,
}));
claim("C", "L4", "median learner: median scored opportunities used is 480-900 (§8 conformance band)", () => ({
  value: `${Math.round(median.meanScoredItems)} scored of ${Math.round(median.medianItems)} items in ${SESSIONS} sessions`,
  pass: median.meanScoredItems >= 480 && median.meanScoredItems <= 900,
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
/**
 * The bug arm, and the one place this script refuses to claim a zero. §9 of the design is explicit
 * that the residual "is real, and it is per node, not per learner", and that claiming it is
 * structurally zero would be the overclaim the whole round exists to remove. Under a leaked hint
 * the gate OPENS on essentially every node — the bot is told it nearly has it — and the retention
 * check, which is built by the Scheduler at solo/unhinted and answered blind, is what stops
 * certification.
 */
claim("G", "L5", "hint-LEAK bug arm (P18 leaks help into solo, engine never told): < 0.1 of 32 certified, none near the bar", () => ({
  value: `${hintLeak.meanMastered.toFixed(4)} certified/run (max ${hintLeak.maxMastered}, ${pct(hintLeak.shareAt80)} of runs at >= 80%), gate opened ${hintLeak.meanGateOpens.toFixed(1)}x/run on ${hintLeak.meanUnlocked.toFixed(1)}/32 nodes`,
  pass: hintLeak.meanMastered < 0.1 && hintLeak.maxMastered <= 2 && hintLeak.shareAt80 === 0,
}));
/**
 * CONTROL ARM. A harness that only ever prints zeros cannot be told apart from a broken detector,
 * which is the reason `mastery-sim.mjs` keeps its legacy rules running. If the leak arm did not
 * visibly move the gate, every other zero in this table would be worthless.
 */
claim("L", "L5", "control arm: the harness can SEE a leak — the bug arm opens the gate, the shipped rules do not", () => ({
  value: `leak arm unlocks ${hintLeak.meanUnlocked.toFixed(1)}/32 nodes per run; shipped hint-abuse arm unlocks ${hintAbuser.meanUnlocked.toFixed(2)}/32; guessing bot ${guesser.meanUnlocked.toFixed(2)}/32; form-hunting bot ${formHunter.meanUnlocked.toFixed(2)}/32`,
  pass: hintLeak.meanUnlocked >= 20 && hintAbuser.meanUnlocked < 4 && formHunter.meanUnlocked === 0,
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

// ------------------------------------------------------------------------------------- output

say("P16 — mastery engine: measured proof of L4 and L5");
say("=".repeat(96));
say(`engine under test: app/src/learn/{Graph,Mastery,Scheduler}.js   content: content/knowledge-graph.json`);
say(`graph: ${JSON.stringify(GRAPH.stats())}`);
say(
  `gate: P >= ${M.bkt.masteryThreshold}, >= ${M.bkt.minScoredOpportunities} scored (>= ${M.bkt.minAtBandOpportunities} at band), >= ${M.bkt.minDistinctItemForms} forms, ` +
    `then ${M.spacing.retentionCheck.passAtLeast}/${M.spacing.retentionCheck.items} AND P >= ${M.bkt.masteryThreshold} at a check >= ${M.spacing.retentionCheck.minHours} h and >= ${M.spacing.retentionCheck.minInterveningSessions} session later`
);
say(`budget: ${SESSIONS} sessions x ${SESSION_MINUTES} min, one session per day. Bots: ${BOTS}/arm, learners: ${LEARNERS}/cohort. ${elapsed}s`);
say("");
say("TRUE blind-success rates the bots draw from (ground truth, never the model's guess):");
say(
  `  by form:  ${Object.entries(TRUE_FORM).map(([k, v]) => `${k} ${v}`).join("   ")}`
);
say(`  by phase: ${Object.entries(TRUE_PHASE).map(([k, v]) => `${k} ${v}`).join("   ")}`);
say(
  `  for contrast, the model's own belief at band 3: ${Object.keys(TRUE_FORM).map((f2) => `${f2} ${(BAND[3].guess * (M.guessByForm[f2] ?? 1)).toFixed(3)}`).join("   ")}`
);
say("");

say("PART A — deterministic engine assertions");
say("-".repeat(96));
for (const a of asserts) {
  say(`  ${a.ok ? "PASS" : "FAIL"}  ${a.id}  ${a.statement}`);
  if (a.detail) say(`             ${a.detail}`);
}
say("");

say("PART B — cohorts");
say("-".repeat(96));
const cols = ["cohort", "n", "sess", "p10", "median", "p90", ">=80%", "certified", "peak", "items", "unscored", "refused"];
say(cols[0].padEnd(30) + cols.slice(1).map((c, i) => c.padStart([5, 5, 8, 8, 8, 8, 10, 6, 8, 9, 9][i])).join(""));
const row = (label, c) =>
  say(
    label.padEnd(30) +
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
row("patient guessing bot", guesser);
row("mashing bot", masher);
row("form-hunting bot", formHunter);
row("hint-abusing bot", hintAbuser);
row("hint-leak bot (P18 bug arm)", hintLeak);
row("median, §4.1 rules OFF", ablated);
row("median, prereq clock reset OFF", noClockReset);
say("");
say(`  median learner: mean theta ${median.meanTheta.toFixed(2)}, retention pass rate ${pct(median.retentionPassRate ?? 0)}, median sessions to 80% ${median.medianSessionsTo80}`);
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

say("PART C — claims");
say("=".repeat(96));
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
say(`RESULT: ${allPass ? "PASS" : "FAIL"} — ${claimRows.filter((c) => c.pass).length}/${claimRows.length} claims, ${asserts.filter((a) => a.ok).length}/${asserts.length} assertions`);

const json = {
  generated: new Date().toISOString(),
  engine: "app/src/learn/{Graph,Mastery,Scheduler}.js",
  graph: GRAPH.stats(),
  budget: { sessions: SESSIONS, sessionMinutes: SESSION_MINUTES, learners: LEARNERS, bots: BOTS },
  trueGuessByForm: TRUE_FORM,
  trueGuessByPhase: TRUE_PHASE,
  assertions: asserts,
  cohorts: { median, mixedLong, guesser, masher, formHunter, hintAbuser, hintLeak, ablated, noClockReset },
  claims: claimRows,
  result: allPass ? "PASS" : "FAIL",
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

process.exitCode = allPass ? 0 : 1;
