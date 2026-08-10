/**
 * P03 — reference simulation of the Level 1 learning architecture.
 *
 * This is the executable form of design/learning-architecture.md. It reads its numbers out of
 * content/knowledge-graph.json (`model`) and the graph itself, then runs the specified learner
 * model, mastery gate, spacing ladder, item selection and anti-guessing rules over a population
 * of simulated learners.
 *
 * It exists to answer two questions with numbers instead of adjectives:
 *   L4  does the median learner reach >= 80% mastery of Level 1 inside the budget?
 *   L5  can a guesser reach mastery?
 *
 * P16 should treat the output as a conformance target: the same parameters, the same gate and
 * the same schedule must reproduce these numbers to within sampling noise.
 *
 *   node review/p03/mastery-sim.mjs
 *   node review/p03/mastery-sim.mjs --learners=4000 --sessions=18
 *
 * ---------------------------------------------------------------------------------------------
 * THE ONE RULE THIS FILE EXISTS TO OBEY
 *
 * A bot's probability of being right is NEVER read from the model's own `guess` parameter.
 * It is read from `model.trueGuessByForm`, which is derived from the size of each form's answer
 * space and knows nothing about BKT. Setting `correct = rng() < guess` — which is what round 1
 * did — does not simulate guessing; it asserts that guessing is exactly as hard as the model
 * already believes, and then reports the assertion as a measurement. The two numbers have to be
 * allowed to disagree, because for a real player with a mouse they do.
 *
 * The same rule applies to forms. Every scored surface here — acquisition, consolidation,
 * retention, review — draws its form from the graph's declared form lists, and a hostile cohort
 * is served the selected-response forms on purpose to prove the engine refuses them.
 * ---------------------------------------------------------------------------------------------
 *
 * Deliberate modelling assumptions, all stated so a critic can attack them:
 *   A1  The engine's BKT parameters are correctly specified for the median learner. Individual
 *       learners differ by an ability multiplier on the learn rate and on the prior odds.
 *   A2  Item difficulty modulates the response beyond plain BKT: an over-pitched item raises the
 *       effective slip, an under-pitched one raises the effective guess. Plain BKT ignores this;
 *       ignoring it here would flatter the design.
 *   A3  An item for a KP of difficulty >= 3 also exercises that KP's direct prerequisites and so
 *       pays them prerequisite credit at weight 0.5. Items at bands 1-2 are atomic.
 *   A4  46 seconds per scored opportunity, including the physical act and the travel to it.
 *   A5  One session per day, so every 12-hour retention gate is reachable the following session.
 *   A6  Unlocking is monotone: a KP that has once reached `provisional` stays unlocked for its
 *       dependents even if it later lapses. The world never re-locks behind a learner.
 *   A7  A HUMAN who has not yet acquired a skill is not a blind responder. They have partial
 *       knowledge, near-misses and the ability to reason some of it out, and the model's `guess`
 *       parameter is the stand-in for that partial credit. A BOT has no partial knowledge and
 *       draws from `trueGuessByForm`. Conflating the two is the round-1 error; keeping them apart
 *       is the whole point of this file. The two rates are deliberately different in both
 *       directions: for constructed forms the model's guess (0.05-0.10) is ABOVE the bot's true
 *       rate (0.02-0.03), which slows honest learners slightly and is the safe way to be wrong.
 *   A8  The hostile cohorts assume an item server that has gone wrong in the worst plausible way:
 *       P17 reads a diagnostic signature, sees a closed question, and ships a judge2 item. The
 *       engine's only defence is `model.forms.scored`. That is what the formHunter cohort tests.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const graph = JSON.parse(readFileSync(resolve(root, "content/knowledge-graph.json"), "utf8"));

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split("=")[1]) : dflt;
};

const LEARNERS = arg("learners", 3000);
const SESSIONS = arg("sessions", 22);
const SESSION_MINUTES = arg("sessionMinutes", 25);
const BENCH_N = arg("benchLearners", 20000);
const BENCH_ACQ_CAP = arg("benchAcquisitionCap", 200);
const SECONDS_PER_ITEM = 46;
const ITEMS_PER_SESSION = Math.floor((SESSION_MINUTES * 60) / SECONDS_PER_ITEM);

// Section 4's review rate-limit lift. Toggled so the claim in section 4.1 is a measurement.
let REVIEW_CAP_LIFT = arg("reviewCapLift", 1) !== 0;
let PULL_FORWARD = arg("pullForward", 1) !== 0;

const M = graph.model;
const BAND = Object.fromEntries(M.bands.map((b) => [b.difficulty, b]));
const NODES = graph.nodes;
const BY_ID = new Map(NODES.map((n) => [n.id, n]));

// ------------------------------------------------------------------ forms ---
/** GROUND TRUTH. What a responder with zero knowledge actually achieves, per form. */
const TRUE_RATE = Object.fromEntries(
  Object.entries(M.trueGuessByForm).filter(([, v]) => typeof v === "number")
);
/** GROUND TRUTH, second axis. What the WORLD has already done for the responder, per phase. */
const TRUE_RATE_PHASE = Object.fromEntries(
  Object.entries(M.trueGuessByPhase).filter(([, v]) => typeof v === "number")
);
const SCORED_FORMS = M.forms.scored;
const MASTERY_FORMS = M.bkt.formsEligibleForMastery;
const UNSCORED_FORMS = M.forms.unscored;
const SCORED_PHASES = M.phases.scored;
const MASTERY_PHASES = M.bkt.phasesEligibleForMastery;
const FADE = M.phases.fadeOrder;
/**
 * A session is a TIME budget, not an item budget, and a scaffolded item does not cost what an
 * unscaffolded one costs — model.phases.secondsPerItemByPhase. Round 3's simulation had no phases
 * at all and so charged 46 s for everything; charging 46 s for a 22 s demonstration would make the
 * teaching sequence look twice as expensive as it is and would move section 5 right for no reason.
 */
const secondsFor = (phase) => M.phases.secondsPerItemByPhase[phase] ?? SECONDS_PER_ITEM;
const CAPS = M.bkt.identifiabilityCaps;

/**
 * The composed price of one item. Both axes, composed by max, exactly as
 * model.guessByPhase.note and model.trueGuessByPhase.note specify.
 *
 * `trueRate` is what a blind responder actually achieves; the bots draw from it and nothing else.
 * `modelGuess` is what the engine believes; the BKT update uses it. They are allowed to disagree,
 * and the whole design is arranged so that when they do, the belief is the more pessimistic one.
 */
const trueRateOf = (form, phase) => Math.max(TRUE_RATE[form] ?? 0.03, TRUE_RATE_PHASE[phase] ?? 0);
const composedMult = (form, phase) => Math.max(M.guessByForm[form] ?? 1, M.guessByPhase[phase] ?? 0);

/**
 * Two rule sets, so the leak can be measured rather than asserted.
 *
 *   current — the shipped design. A form outside model.forms.scored produces no BKT update, no
 *             M2/M3 credit, no prerequisite credit and no theta movement. It still burns time.
 *   legacy  — round 1: every form is scored, and a form whose modelled guess exceeds maxGuess is
 *             CLAMPED to the cap rather than rejected. This is the code path the critic broke.
 *             It is kept here on purpose: a claim that a leak is closed is worth nothing without
 *             the number it used to be.
 */
const RULES = {
  current: {
    label: "current (both axes gated, no clamping)",
    // Upward: the form must be scorable AND the phase must be scorable.
    scores: (form, phase) => SCORED_FORMS.includes(form) && SCORED_PHASES.includes(phase),
    // Downward: an unscored PHASE is inert upward only. A wrong answer on an item the world had
    // already half-done is strong evidence of not holding the skill and is scored normally, at
    // the FORM's own guess with the phase multiplier discarded (a bigger guess makes a wrong
    // answer weaker evidence, which is the unsafe direction).
    scoresDown: (form) => SCORED_FORMS.includes(form),
    counts: (form, phase) => MASTERY_FORMS.includes(form) && MASTERY_PHASES.includes(phase),
    modelGuess: (band, form, phase) => band.guess * composedMult(form, phase),
    downGuess: (band, form) => band.guess * (M.guessByForm[form] ?? 1),
    hintPolicy: true,
  },
  round3: {
    // The rules as they shipped in round 3: the FORM axis gated, the PHASE axis invisible. Every
    // scaffolded acquisition item was scored at the unscaffolded price and counted toward M2/M3.
    // Kept alive for the same reason `legacy` is: a claim that a leak is closed is worth nothing
    // without the number it used to be.
    label: "round 3 (form axis gated, phase axis unpriced)",
    scores: (form) => SCORED_FORMS.includes(form),
    scoresDown: (form) => SCORED_FORMS.includes(form),
    counts: (form) => MASTERY_FORMS.includes(form),
    modelGuess: (band, form) => band.guess * (M.guessByForm[form] ?? 1),
    downGuess: (band, form) => band.guess * (M.guessByForm[form] ?? 1),
    hintPolicy: false,
  },
  legacy: {
    label: "legacy (round 1: every form scored, guess clamped to maxGuess)",
    scores: () => true,
    scoresDown: () => true,
    counts: () => true,
    modelGuess: (band, form) => Math.min(CAPS.maxGuess, band.guess * (M.guessByForm[form] ?? 1)),
    downGuess: (band, form) => Math.min(CAPS.maxGuess, band.guess * (M.guessByForm[form] ?? 1)),
    hintPolicy: false,
  },
};

const succ = new Map(NODES.map((n) => [n.id, []]));
for (const n of NODES) for (const p of n.prerequisites) succ.get(p).push(n.id);
const descendantCount = new Map();
function descendants(id) {
  if (descendantCount.has(id)) return descendantCount.get(id);
  const set = new Set();
  descendantCount.set(id, set);
  for (const c of succ.get(id)) {
    set.add(c);
    for (const d of descendants(c)) set.add(d);
  }
  return set;
}
for (const n of NODES) descendants(n.id);
const MAX_REACH = Math.max(...NODES.map((n) => descendantCount.get(n.id).size));

// ------------------------------------------------------------------- rng ----
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (rng) => Math.sqrt(-2 * Math.log(Math.max(rng(), 1e-12))) * Math.cos(2 * Math.PI * rng());
const logistic = (x) => 1 / (1 + Math.exp(-x));

/** Posterior after one observation, then the learning transition. `weight` damps the move. */
function bktUpdate(p, correct, slip, guess, learn, weight = 1) {
  const num = correct ? p * (1 - slip) : p * slip;
  const den = correct ? p * (1 - slip) + (1 - p) * guess : p * slip + (1 - p) * (1 - guess);
  const posterior = den > 0 ? num / den : p;
  const withLearning = posterior + (1 - posterior) * learn;
  return weight * withLearning + (1 - weight) * p;
}

// --------------------------------------------------------------- learner ----
const BOT_KINDS = ["guesser", "masher", "formHunter", "hintAbuser", "hintLeak"];

function makeLearner(seed, kind, rules = RULES.current) {
  const rng = mulberry32(seed);
  const bot = BOT_KINDS.includes(kind);
  const ability = kind === "median" || bot ? 1 : Math.exp(gauss(rng) * 0.35);
  const thetaTrue = -0.8 + 1.2 * Math.log(ability);
  const state = new Map();
  for (const n of NODES) {
    const b = BAND[n.difficulty];
    const odds = (b.prior / (1 - b.prior)) * (bot ? 0 : ability);
    state.set(n.id, {
      p: b.prior,
      knownTrue: !bot && rng() < odds / (1 + odds),
      attempts: 0,
      scored: 0,
      atBand: 0,
      forms: new Set(),
      status: "learning",
      everUnlocked: false,
      consolidated: false,
      nextEventAt: Infinity,
      ladder: -1,
      lapses: 0,
      provisionalAt: null,
      relearn: false,
      everMasteredNode: false,
      // teaching-phase state, per node. Round 3's simulation had none of this: it ran every
      // acquisition item as if it were unscaffolded, which is exactly why it could not see the
      // scaffold priced wrong.
      phase: null,
      lastPhase: null,
      lastCorrect: null,
      fadeIdx: 0,
      modelEvents: 0,
      pendingModel: false,
      consecutiveWrong: 0,
    });
  }
  return {
    rng,
    ability,
    thetaTrue,
    theta: M.ability.theta0,
    responses: 0,
    state,
    kind,
    items: 0,
    unscoredItems: 0,
    hintedItems: 0,
    phaseCount: {},
    refusedUpward: 0,
    bot,
    rules,
    // A hostile item server: every item this learner is offered comes back as a selected-response
    // form, because the diagnostic signature it was generated from reads as a closed question.
    exploitForms: kind === "formHunter" ? UNSCORED_FORMS : null,
    // The bot a real fifteen-year-old is: it never answers before the hint surfaces.
    alwaysWaits: kind === "hintAbuser" || kind === "hintLeak",
    // ...and `hintLeak` additionally models P18 shipping the hint surface into `solo` by mistake,
    // where the engine has no idea it appeared. That is the implementation bug this design must
    // survive, so it is measured rather than assumed away.
    hintEverywhere: kind === "hintLeak",
  };
}

/**
 * The teaching phase for the next acquisition item on this node, §6.1.
 *
 * A state machine, not a function of P(known): guided-2 and guided-3 are unscored, so a phase
 * rule that only reads the posterior would strand a learner in a phase that cannot move it.
 * Entry is P-triggered, exit is performance-triggered, and there is a posterior shortcut so a
 * learner who does not need the ladder does not walk it.
 */
function nextPhase(L, node, s) {
  const P = M.phases;
  const centre = BAND[node.difficulty].logit;
  const firstEncounter = s.attempts === 0;
  // The easiest-variant trigger reads the GLOBAL ability estimate, so it must also read this
  // node's posterior: a learner who is doing fine here does not need re-lecturing merely because
  // theta is still low somewhere else. Without the second clause this fired 1.7 times per node.
  const easiestOutOfReach = centre - 0.6 > L.theta + M.ability.modelPhaseTriggerGap && s.p < P.modelPhaseThreshold;
  const wantModel = (firstEncounter && s.p < P.modelPhaseThreshold) || easiestOutOfReach || s.pendingModel;

  if (wantModel && s.modelEvents < P.modelEventsPerNodePerSession) {
    s.modelEvents++;
    s.pendingModel = false;
    s.fadeIdx = 0;
    return "model";
  }
  s.pendingModel = false;
  if (s.lastPhase === "model") {
    s.fadeIdx = 0;
    return FADE[0];
  }
  if (s.lastCorrect === null) {
    s.fadeIdx = 0;
    return s.p >= P.soloThreshold ? "solo" : FADE[0];
  }
  if (s.p >= P.soloThreshold && s.lastCorrect) return "solo";
  // A retreat costs an item and buys no evidence, so it needs a RUN of errors rather than one.
  // A single wrong answer is exactly what the `slip` parameter is for: 8-16% of responses from a
  // learner who genuinely holds the skill are wrong, and scaffolding those is pure waste.
  const retreat = s.consecutiveWrong >= P.retreatAfterConsecutiveErrors;
  if (s.lastPhase === "solo") {
    if (!retreat && s.p >= P.soloThreshold) return "solo";
    s.fadeIdx = FADE.length - 1; // retreat one position: solo -> the last, lightest scaffold
    return FADE[s.fadeIdx];
  }
  if (s.lastCorrect) {
    s.fadeIdx++;
    if (s.fadeIdx >= FADE.length) return "solo";
    return FADE[s.fadeIdx];
  }
  if (!retreat) return FADE[s.fadeIdx]; // one slip: hold position, do not add help
  s.fadeIdx--;
  if (s.fadeIdx < 0) {
    s.fadeIdx = 0;
    if (s.modelEvents < P.modelEventsPerNodePerSession) {
      s.modelEvents++;
      return "model";
    }
    return FADE[0];
  }
  return FADE[s.fadeIdx];
}

const kFor = (n) => {
  for (const row of M.ability.kSchedule) if (row.untilResponses === null || n < row.untilResponses) return row.k;
  return 0.2;
};

function frontier(L) {
  return NODES.filter((n) => {
    const s = L.state.get(n.id);
    if (s.status === "mastered") return false;
    return n.prerequisites.every((p) => L.state.get(p).everUnlocked);
  });
}

/** Nearest available variant difficulty to the target, on the logit scale. */
function pickVariant(node, target) {
  const centre = BAND[node.difficulty].logit;
  let best = null;
  let bestGap = Infinity;
  for (const off of M.ability.variantOffsets) {
    const gap = Math.abs(centre + off - target);
    if (gap < bestGap) {
      bestGap = gap;
      best = centre + off;
    }
  }
  return best;
}

/**
 * Which form the item server offers.
 *
 * An honest server follows the graph: acquisition cycles model.forms.order once P clears
 * cycleAbove, and consolidation / retention / review draw from their own declared lists in
 * model.spacing. A hostile server (the formHunter cohort) offers the selected-response forms
 * everywhere, which is exactly what an item bank built from a yes/no diagnostic signature does.
 */
function pickForm(L, s, mode, k) {
  if (L.exploitForms) return L.exploitForms[(s.attempts + k) % L.exploitForms.length];
  if (mode === "acquire") {
    if (s.p < M.forms.cycleAbove) return M.forms.beforeThreshold;
    return M.forms.order[s.scored % M.forms.order.length];
  }
  const list =
    mode === "consolidate"
      ? M.spacing.consolidation.forms
      : mode === "retention"
        ? M.spacing.retentionCheck.forms
        : M.spacing.review.forms;
  return list[(s.attempts + k) % list.length];
}

const modeFor = (s) => (s.status === "mastered" ? "review" : s.consolidated ? "retention" : "consolidate");

function chooseNode(L, now, inFlight, blockCount, reviewRatioOk) {
  // Acquisition work available at all? The 1-in-3 review cap exists to stop a session becoming
  // all review WHILE THERE IS STILL NEW GROUND. Once the frontier is exhausted, review is the work.
  const acquirable = frontier(L).filter((n) => L.state.get(n.id).status === "learning");
  const reviewAllowed = reviewRatioOk || (REVIEW_CAP_LIFT && acquirable.length === 0);

  if (reviewAllowed) {
    const due = NODES.map((n) => ({ n, s: L.state.get(n.id) }))
      .filter((x) => x.s.nextEventAt <= now)
      .sort((a, b) => a.s.nextEventAt - b.s.nextEventAt);
    if (due.length) return { node: due[0].n, mode: modeFor(due[0].s) };
  }
  if (inFlight && blockCount < 3 && L.state.get(inFlight).status === "learning")
    return { node: BY_ID.get(inFlight), mode: "acquire" };

  const learningNow = NODES.filter((n) => {
    const s = L.state.get(n.id);
    return s.status === "learning" && s.attempts > 0;
  }).map((n) => n.id);

  let pool = acquirable;
  if (learningNow.length >= 2) {
    const capped = pool.filter((n) => learningNow.includes(n.id));
    if (capped.length) pool = capped;
  }
  if (!pool.length) {
    // Nothing to acquire and nothing due: pull the soonest scheduled review forward. Shortening
    // an interval is always safe; a provisional node's retention check still cannot run before
    // its 12-hour gate, so certification can never be bought with idle time.
    if (!PULL_FORWARD) return null;
    const eligible = NODES.map((n) => ({ n, s: L.state.get(n.id) }))
      .filter((x) => x.s.nextEventAt < Infinity)
      .filter((x) => x.s.status === "mastered" || now >= x.s.provisionalAt + M.spacing.retentionCheck.minHours * 60)
      .sort((a, b) => a.s.nextEventAt - b.s.nextEventAt);
    if (!eligible.length) return null;
    return { node: eligible[0].n, mode: modeFor(eligible[0].s) };
  }

  const target = L.theta + M.ability.acquisitionTargetOffset;
  let best = null;
  let bestScore = -Infinity;
  for (const n of pool) {
    const s = L.state.get(n.id);
    const b = BAND[n.difficulty].logit;
    const fit = Math.exp(-((b - target) ** 2) / (2 * 0.7 ** 2));
    const reach = descendantCount.get(n.id).size / MAX_REACH;
    const fresh = 1 - Math.min(1, s.attempts / 12);
    const cont = n.id === inFlight ? 1 : 0;
    const score = 0.4 * fit + 0.3 * reach + 0.15 * fresh + 0.15 * cont;
    if (score > bestScore) {
      bestScore = score;
      best = n;
    }
  }
  return { node: best, mode: "acquire" };
}

const relearnActive = (s) => s.relearn && (!M.spacing.relearnRequiresPriorMastery || s.everMasteredNode);

/**
 * A lapsed node re-enters the teaching sequence one step back from solo — the lightest scaffold,
 * not a lecture. Except when the posterior has genuinely fallen through
 * phases.lapseReentry.unlessBelow, where the knowledge really has gone and a demonstration is the
 * honest response. Round 3's document asserted both halves of that in two places without the
 * `unless`, so an implementer had to guess; the JSON now decides it.
 */
function relapsePhase(s) {
  const LR = M.phases.lapseReentry;
  s.lastPhase = "solo";
  s.lastCorrect = false;
  s.consecutiveWrong = M.phases.retreatAfterConsecutiveErrors;
  s.fadeIdx = FADE.length - 1;
  if (s.lapses >= LR.afterLapses && s.p < LR.unlessBelow) s.pendingModel = true;
}

/** One learning opportunity. Returns whether it was correct. */
function attempt(L, node, b, mode, form, phase = "solo") {
  const band = BAND[node.difficulty];
  const s = L.state.get(node.id);
  const R = L.rules;
  const modelGuess = R.modelGuess(band, form, phase);
  const downGuess = R.downGuess(band, form, phase);
  const slip = band.slip;
  const phaseFloor = TRUE_RATE_PHASE[phase] ?? 0;

  // Did the world put information on the screen before this response was committed? By default
  // that is a property of the phase (model and guided-3 surface help; nothing else does), but a
  // responder who simply waits gets whatever is on offer, and the hintLeak arm models an
  // implementation that surfaces a hint where the design says it must not.
  const hinted =
    (M.phases.hinted?.[phase] ?? false) || (L.alwaysWaits && mode === "acquire" && (L.hintEverywhere || (M.phases.hinted?.[phase] ?? false)));

  // ---- the response itself -------------------------------------------------
  // A7: a bot draws from the item's TRUE blind-success rate, which owes nothing to the model —
  // and that rate now has two factors, because a scaffold shrinks an answer space exactly the way
  // a multiple choice does. A human who has not acquired the skill draws from the model's guess,
  // which stands in for partial knowledge, FLOORED by what the scaffold gives away: a scaffold
  // that did not help a struggling learner would not be a scaffold.
  let correct;
  let fast = false;
  if (L.bot) {
    const trueRate =
      L.hintEverywhere && mode === "acquire" ? TRUE_RATE_PHASE["guided-3"] : trueRateOf(form, phase);
    correct = L.rng() < trueRate;
    fast = L.kind === "masher" ? L.rng() < 0.5 : false;
  } else if (s.knownTrue) {
    const base = Math.max(0.55, 1 - slip * (1 + 0.35 * Math.max(0, b - L.thetaTrue)));
    correct = L.rng() < base + (1 - base) * phaseFloor;
  } else {
    // A9: a scaffold helps a HUMAN as well as a bot, and by more than the blind rate — it hands
    // the learner an independent shot at the part the world filled in, on top of whatever partial
    // knowledge they already had. Bots do NOT use this line; they draw from the blind rates only,
    // so nothing here can flatter the anti-guessing measurements.
    const base = Math.min(0.3, band.guess * (M.guessByForm[form] ?? 1) * (1 + 0.5 * Math.max(0, L.thetaTrue - b)));
    correct = L.rng() < base + (1 - base) * phaseFloor;
  }

  L.items++;
  s.attempts++;
  if (hinted) L.hintedItems++;
  L.phaseCount[mode === "acquire" ? phase : "cert-" + mode] = (L.phaseCount[mode === "acquire" ? phase : "cert-" + mode] ?? 0) + 1;

  // Teaching happens in every phase, including the ones that buy no credit. That is the point of
  // them: a worked example and a scaffolded attempt are where acquisition actually occurs. The
  // roll sits ABOVE the scoring gate on purpose — round 3 had it below, which would now make an
  // unscored phase pure cost and would flatter the phase gate by making it look expensive.
  if (!s.knownTrue && !L.bot) {
    const t = Math.min(0.9, band.learn * L.ability * (relearnActive(s) ? M.spacing.relearnLearnRateMultiplier : 1));
    if (L.rng() < t) s.knownTrue = true;
  }

  // ---- does the engine score it, and in which direction? -------------------
  // Two different rules, and the difference is WHO CHOSE THE HELP.
  //   The DIRECTOR's choice — an unscored form or an unscored phase — is INERT in both
  //   directions. A coin flip teaches the model nothing whichever way it lands, and a scaffolded
  //   item measures learner-plus-scaffold rather than learner. Recording a wrong answer there
  //   would punish a learner for being taught, which cost 34 points of median Level 1 mastery
  //   when an earlier draft of this round tried it.
  //   The LEARNER's choice — answering under the latency floor, or idling past hintSurfaceMs and
  //   reading the help on an item that WAS otherwise a measurement — is NOT-SCORED-UPWARD: the
  //   correct side is refused, the wrong side stands.
  if (!R.scores(form, phase)) {
    L.unscoredItems++;
    return correct;
  }
  const helped = R.hintPolicy && hinted;
  const scoreUpward = !helped && !(fast && correct);
  if (correct && !scoreUpward) {
    L.refusedUpward++;
    return correct; // buys nothing at all: no posterior, no counter, no theta, no prerequisite credit
  }

  // ability estimate: stochastic approximation on the Rasch model
  L.theta += kFor(L.responses) * ((correct ? 1 : 0) - logistic(L.theta - b));
  L.responses++;

  const learn = Math.min(
    M.spacing.relearnLearnRateCap,
    band.learn * (relearnActive(s) ? M.spacing.relearnLearnRateMultiplier : 1)
  );
  // One guess, both directions. BKT is only identifiable if the same (slip, guess) pair prices a
  // correct and a wrong response; using a different guess on the down-update would be a second,
  // quieter version of the clamping this design forbids.
  s.p = bktUpdate(s.p, correct, slip, modelGuess, learn, 1);

  // M2 counts OPPORTUNITIES, not correct answers — right or wrong, the learner met the skill
  // unaided. R.counts() gates on both axes, so a scaffolded item never lands here.
  if (mode === "acquire" && R.counts(form, phase)) {
    s.scored++;
    if (b >= band.logit) s.atBand++;
    s.forms.add(form);
  }

  if (node.difficulty >= 3) {
    for (const pid of node.prerequisites) {
      const ps = L.state.get(pid);
      const pb = BAND[BY_ID.get(pid).difficulty];
      ps.p = bktUpdate(ps.p, correct, pb.slip, pb.guess, pb.learn, M.bkt.prerequisiteCreditWeight);
    }
  }
  return correct;
}

const gateReached = (s) =>
  s.p >= M.bkt.masteryThreshold &&
  s.scored >= M.bkt.minScoredOpportunities &&
  s.atBand >= M.bkt.minAtBandOpportunities &&
  s.forms.size >= M.bkt.minDistinctItemForms;

function runLearner(seed, kind, sessions = SESSIONS, rules = RULES.current) {
  const L = makeLearner(seed, kind, rules);
  let inFlight = null;
  let blockCount = 0;
  let retentionAttempts = 0;
  let retentionPasses = 0;
  let everMastered = 0;
  const trace = [];

  for (let session = 0; session < sessions; session++) {
    const sessionStart = session * 24 * 60;
    const nextSessionStart = (session + 1) * 24 * 60;
    let now = sessionStart;
    let reviewItems = 0;
    // The model-phase budget is per node PER SESSION. Past two, the problem is not explanation.
    for (const n of NODES) L.state.get(n.id).modelEvents = 0;

    // The session is a TIME box. Round 3's loop counted items and charged 46 s for each; with
    // teaching phases in the model, item count and minutes are no longer the same quantity.
    let spent = 0;
    const budgetSeconds = SESSION_MINUTES * 60;
    for (let i = 0; spent < budgetSeconds; ) {
      const pick = chooseNode(L, now, inFlight, blockCount, reviewItems < (i + 1) / 3);
      if (!pick) break;
      const { node, mode } = pick;
      const s = L.state.get(node.id);
      const centre = BAND[node.difficulty].logit;

      if (mode === "consolidate") {
        // Same-session consolidation: 2 items, always solo, always unhinted, then the clock starts.
        const cn = M.spacing.consolidation.items;
        for (let k = 0; k < cn; k++)
          attempt(L, node, centre, "consolidate", pickForm(L, s, "consolidate", k), M.spacing.consolidation.phase);
        i += cn;
        reviewItems += cn;
        spent += SECONDS_PER_ITEM * cn;
        now += (SECONDS_PER_ITEM * cn) / 60;
        s.consolidated = true;
        s.nextEventAt = Math.max(s.provisionalAt + M.spacing.retentionCheck.minHours * 60, nextSessionStart);
        continue;
      }

      if (mode === "retention") {
        // Uniform over the whole variant pool. Not adaptive, not hinted: no easy tail to hide in.
        let right = 0;
        for (let k = 0; k < M.spacing.retentionCheck.items; k++) {
          const off = M.ability.variantOffsets[Math.floor(L.rng() * M.ability.variantOffsets.length)];
          if (attempt(L, node, centre + off, "retention", pickForm(L, s, "retention", k), M.spacing.retentionCheck.phase))
            right++;
        }
        i += M.spacing.retentionCheck.items;
        reviewItems += M.spacing.retentionCheck.items;
        spent += SECONDS_PER_ITEM * M.spacing.retentionCheck.items;
        now += (SECONDS_PER_ITEM * M.spacing.retentionCheck.items) / 60;
        retentionAttempts++;
        if (right >= M.spacing.retentionCheck.passAtLeast && s.p >= M.bkt.masteryThreshold) {
          retentionPasses++;
          s.status = "mastered";
          s.everMasteredNode = true;
          s.ladder = 0;
          s.nextEventAt = now + M.spacing.ladderDays[0] * 24 * 60;
          s.relearn = false;
        } else {
          s.lapses++;
          s.relearn = true;
          s.status = "learning";
          s.consolidated = false;
          s.scored = Math.max(0, s.scored - 3);
          s.atBand = Math.max(0, s.atBand - 2);
          s.nextEventAt = Infinity;
          relapsePhase(s);
        }
        continue;
      }

      if (mode === "review") {
        const rn = M.spacing.review.items;
        for (let k = 0; k < rn; k++) {
          const off = M.ability.variantOffsets[Math.floor(L.rng() * M.ability.variantOffsets.length)];
          attempt(L, node, centre + off, "review", pickForm(L, s, "review", k), M.spacing.review.phase);
        }
        i += rn;
        reviewItems += rn;
        spent += SECONDS_PER_ITEM * rn;
        now += (SECONDS_PER_ITEM * rn) / 60;
        if (s.p >= 0.9) {
          s.ladder = Math.min(s.ladder + 1, M.spacing.ladderDays.length - 1);
          s.nextEventAt = now + Math.min(M.spacing.capDays, M.spacing.ladderDays[s.ladder]) * 24 * 60;
        } else {
          s.lapses++;
          s.relearn = true;
          s.status = "learning";
          s.consolidated = false;
          s.scored = Math.max(0, s.scored - 3);
          s.atBand = Math.max(0, s.atBand - 2);
          s.nextEventAt = Infinity;
          relapsePhase(s);
        }
        continue;
      }

      // ---- acquisition ----
      if (node.id !== inFlight) {
        inFlight = node.id;
        blockCount = 0;
      }
      // Learn at the edge of ability; certify at the difficulty the standard names.
      const target =
        s.p >= M.ability.certificationPitchThreshold
          ? centre + M.ability.certificationOffset
          : L.theta + M.ability.acquisitionTargetOffset;
      const phase = nextPhase(L, node, s);
      const wasCorrect = attempt(L, node, pickVariant(node, target), "acquire", pickForm(L, s, "acquire", 0), phase);
      s.lastPhase = phase;
      s.lastCorrect = wasCorrect;
      s.consecutiveWrong = wasCorrect ? 0 : s.consecutiveWrong + 1;
      blockCount++;
      i += 1;
      spent += secondsFor(phase);
      now += secondsFor(phase) / 60;

      if (s.status === "learning" && gateReached(s)) {
        s.status = "provisional";
        s.everUnlocked = true;
        s.provisionalAt = now;
        s.consolidated = false;
        s.nextEventAt = now + M.spacing.consolidationMinutes;
        inFlight = null;
      }
    }
    const nowMastered = NODES.filter((n) => L.state.get(n.id).status === "mastered").length;
    everMastered = Math.max(everMastered, nowMastered);
    trace.push(nowMastered);
  }

  const mastered = NODES.filter((n) => L.state.get(n.id).status === "mastered").length;
  const provisional = NODES.filter((n) => L.state.get(n.id).status === "provisional").length;
  const unlocked = NODES.filter((n) => L.state.get(n.id).everUnlocked).length;
  const need = Math.ceil(0.8 * NODES.length);
  const sessionsTo80 = trace.findIndex((m) => m >= need);
  return {
    mastered,
    provisional,
    unlocked,
    everMastered,
    items: L.items,
    unscoredItems: L.unscoredItems,
    refusedUpward: L.refusedUpward,
    hintedItems: L.hintedItems,
    theta: L.theta,
    retentionAttempts,
    retentionPasses,
    trace,
    phaseCount: L.phaseCount,
    sessionsTo80: sessionsTo80 < 0 ? null : sessionsTo80 + 1,
  };
}

// ------------------------------------------------------------------- run ----
function percentile(sorted, q) {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}
const population = (kind, n, seedBase, sessions, rules = RULES.current) =>
  Array.from({ length: n }, (_, i) => runLearner(seedBase + i * 7919, kind, sessions, rules));

const out = [];
const say = (s = "") => out.push(s);

say("Variable Star — Level 1 learning architecture, reference simulation");
say(`graph: ${NODES.length} knowledge points`);
say(
  `budget: ${SESSIONS} sessions x ${SESSION_MINUTES} min. A session is a TIME box, not an item count: ${Object.entries(M.phases.secondsPerItemByPhase).map(([k, v]) => `${k} ${v}s`).join(", ")}, everything else ${SECONDS_PER_ITEM}s`
);
say(
  `gate: P(known) >= ${M.bkt.masteryThreshold}, >= ${M.bkt.minScoredOpportunities} scored opportunities, >= ${M.bkt.minAtBandOpportunities} at band, >= ${M.bkt.minDistinctItemForms} forms, then ${M.spacing.retentionCheck.passAtLeast}/${M.spacing.retentionCheck.items} on a uniform, unhinted retention check >= ${M.spacing.retentionCheck.minHours} h later`
);
say("");

say(`forms: scored [${SCORED_FORMS.join(", ")}]   unscored [${UNSCORED_FORMS.join(", ")}]`);
say(
  `true blind-success rates the bots actually draw from: ${Object.entries(TRUE_RATE)
    .map(([f, v]) => `${f} ${v}`)
    .join(", ")}`
);
say(
  `model's own guess belief, for contrast: ${Object.keys(TRUE_RATE)
    .map((f) => `${f} ${(BAND[3].guess * (M.guessByForm[f] ?? 1)).toFixed(3)}`)
    .join(", ")} (band 3)`
);
say("");

const cohorts = [
  ["mixed-ability population", "mixed", 1234],
  ["median learner (ability = 1.00)", "median", 5150],
  ["patient guessing bot (waits out the latency floor; takes whatever the scaffold gives)", "guesser", 99991],
  ["mashing bot (50% of responses under the latency floor)", "masher", 424242],
  ["form-hunting bot (served judge2/select4 on every item by a broken item bank)", "formHunter", 606060],
  ["hint-abusing bot (idles past hintSurfaceMs on every acquisition item, blind on retention)", "hintAbuser", 515151],
  ["hint-leak bot (as above, PLUS P18 leaks the hint surface into solo — an implementation bug arm)", "hintLeak", 727272],
];

const results = {};
for (const [label, kind, seed] of cohorts) {
  const n = kind === "median" ? Math.min(LEARNERS, 1500) : LEARNERS;
  const rows = population(kind, n, seed);
  const pct = rows.map((r) => (100 * r.mastered) / NODES.length).sort((a, b) => a - b);
  const items = rows.map((r) => r.items).sort((a, b) => a - b);
  results[kind] = { pct, rows };
  say(`--- ${label}  (n = ${n}) ---`);
  say(
    `  mastered %:   p10 ${percentile(pct, 0.1).toFixed(1)}   p25 ${percentile(pct, 0.25).toFixed(1)}   median ${percentile(pct, 0.5).toFixed(1)}   p75 ${percentile(pct, 0.75).toFixed(1)}   p90 ${percentile(pct, 0.9).toFixed(1)}`
  );
  say(`  >= 80% mastery: ${((100 * pct.filter((p) => p >= 80).length) / pct.length).toFixed(1)}% of learners`);
  say(`  >= 90% mastery: ${((100 * pct.filter((p) => p >= 90).length) / pct.length).toFixed(1)}% of learners`);
  say(`  mean KPs certified: ${(rows.reduce((a, r) => a + r.mastered, 0) / rows.length).toFixed(4)} of ${NODES.length}`);
  say(`  mean KPs unlocked:  ${(rows.reduce((a, r) => a + r.unlocked, 0) / rows.length).toFixed(2)} of ${NODES.length}`);
  say(`  scored opportunities used (median): ${percentile(items, 0.5).toFixed(0)}`);
  const ra = rows.reduce((a, r) => a + r.retentionAttempts, 0);
  const rp = rows.reduce((a, r) => a + r.retentionPasses, 0);
  say(`  retention checks: ${ra} attempted, ${rp} passed (${ra ? ((100 * rp) / ra).toFixed(2) : "—"}%)`);
  {
    const agg = {};
    for (const r of rows) for (const [k, v] of Object.entries(r.phaseCount)) agg[k] = (agg[k] ?? 0) + v / rows.length;
    say(`  item mix per run: ${Object.entries(agg).map(([k, v]) => `${k} ${v.toFixed(1)}`).join("  ")}`);
    say(`  median theta at end: ${percentile(rows.map((r) => r.theta).sort((a, b) => a - b), 0.5).toFixed(2)}`);
  }
  const peak = Math.max(...rows.map((r) => r.everMastered));
  const anyPeak = rows.filter((r) => r.everMastered > 0).length;
  say(`  peak KPs ever certified by a single run: ${peak}   (runs that ever certified anything: ${anyPeak}/${rows.length})`);
  const unscored = rows.reduce((a, r) => a + r.unscoredItems, 0);
  if (unscored > 0)
    say(
      `  items that bought no credit (unscored form, or a scaffold the director chose): ${(unscored / rows.length).toFixed(0)} per run`
    );
  const refused = rows.reduce((a, r) => a + r.refusedUpward, 0) / rows.length;
  if (refused > 0)
    say(`  correct responses refused upward (under the latency floor, or after reading a hint): ${refused.toFixed(1)} per run`);
  say("");
}

// ---- how long does it actually take? Level 1 is gated by mastery, not by a clock. ----
const LONG = 34;
const longRows = population("mixed", Math.min(LEARNERS, 1200), 777001, LONG);
const need = Math.ceil(0.8 * NODES.length);
say(`--- time to 80% mastery, mixed-ability population, no time box (n = ${longRows.length}, run out to ${LONG} sessions) ---`);
say(`  80% of Level 1 = ${need} of ${NODES.length} knowledge points certified`);
for (const s of [12, 16, 18, 20, 24, 28, 34]) {
  const share = (100 * longRows.filter((r) => r.trace[s - 1] >= need).length) / longRows.length;
  say(`  by session ${String(s).padStart(2, " ")} (${((s * SESSION_MINUTES) / 60).toFixed(1)} h of play): ${share.toFixed(1)}% of learners have >= 80% mastery`);
}
const reached = longRows.filter((r) => r.sessionsTo80 !== null).map((r) => r.sessionsTo80).sort((a, b) => a - b);
say(`  learners who reach 80% at all within ${LONG} sessions: ${((100 * reached.length) / longRows.length).toFixed(1)}%`);
say(`  sessions to 80%: p25 ${percentile(reached, 0.25).toFixed(0)}   median ${percentile(reached, 0.5).toFixed(0)}   p75 ${percentile(reached, 0.75).toFixed(0)}   p90 ${percentile(reached, 0.9).toFixed(0)}`);
say("");

// ---- section 4.1: is the review rate-limit lift load-bearing, or is it decoration? ----
{
  const n = Math.min(LEARNERS, 800);
  const run = (seed) => population("mixed", n, seed, SESSIONS);
  const med = (rows) => percentile(rows.map((r) => r.mastered).sort((a, b) => a - b), 0.5);
  const cells = [];
  for (const [lift, pull, label] of [
    [true, true, "both rules on (shipped)"],
    [false, true, "rate-limit lift OFF, pull-forward on"],
    [true, false, "rate-limit lift on, pull-forward OFF"],
    [false, false, "both rules OFF"],
  ]) {
    REVIEW_CAP_LIFT = lift;
    PULL_FORWARD = pull;
    cells.push([label, med(run(313131))]);
  }
  REVIEW_CAP_LIFT = true;
  PULL_FORWARD = true;
  say(`--- section 4.1: which review-scheduling rule is load-bearing? (n = ${n}, identical seeds) ---`);
  for (const [label, m] of cells)
    say(`  ${label.padEnd(38)} median learner certifies ${m.toFixed(0)} of ${NODES.length}`);
  say(`  Certification capacity, not teaching capacity, is what rations Level 1.`);
  say("");
}

// ============================================================================
// L5, isolated: run the mastery gate on ONE knowledge point against a bot whose true rate is
// decoupled from the model, and let it retry the retention check as often as a bored bot would.
//
// This is the measurement round 1 could not make. The gate is implemented here in full — M1
// P>=0.95, M2 >=6 scored and >=3 at band, M3 >=2 distinct forms, a 2-item consolidation pass,
// M4 3-of-4 on a uniformly sampled unhinted check, and revocation at the +1 day review — with
// nothing else in the way: no session budget, no frontier, no competing nodes. Just the gate
// and an adversary with unlimited patience.
// ============================================================================
function gateBench({
  nodeId,
  formsOffered,
  rules,
  retentionAttempts,
  n,
  seedBase,
  acqCap = BENCH_ACQ_CAP,
  botHint = "none",
}) {
  const node = BY_ID.get(nodeId);
  const band = BAND[node.difficulty];
  const fakeL = { theta: band.logit }; // the bench has no session, so the easiest-variant trigger is off
  let certified = 0;
  let survived = 0;
  let everOpenedGate = 0;
  let checksAttempted = 0;
  let checksPassed = 0;
  let gateItems = 0;

  for (let bot = 0; bot < n; bot++) {
    const rng = mulberry32(seedBase + bot * 7919);
    const s = {
      p: band.prior,
      scored: 0,
      atBand: 0,
      forms: new Set(),
      attempts: 0,
      relearn: false,
      everMasteredNode: false,
      lastPhase: null,
      lastCorrect: null,
      fadeIdx: 0,
      modelEvents: 0,
      pendingModel: false,
      consecutiveWrong: 0,
    };
    let mastered = false;
    let openedGate = false;

    for (let round = 0; round < retentionAttempts && !mastered; round++) {
      // ---- acquisition: grind until the gate opens or the patience cap runs out ----
      let opened = false;
      s.modelEvents = 0; // one bench round stands in for one session
      for (let i = 0; i < acqCap; i++) {
        const form = formsOffered[i % formsOffered.length];
        const phase = nextPhase(fakeL, node, s);
        const target =
          s.p >= M.ability.certificationPitchThreshold
            ? band.logit + M.ability.certificationOffset
            : band.logit + M.ability.acquisitionTargetOffset;
        const b = pickVariant(node, target);
        // The bot's true rate. `none`  = it answers when asked and gets whatever the scaffold
        // gives; `wait` = it idles past hintSurfaceMs, so it also gets whatever HELP is on offer;
        // `leak` = as `wait`, plus an implementation that surfaces the hint in solo too.
        const trueRate =
          botHint === "leak"
            ? TRUE_RATE_PHASE["guided-3"]
            : Math.max(TRUE_RATE[form] ?? 0.03, TRUE_RATE_PHASE[phase] ?? 0);
        const correct = rng() < trueRate;
        s.attempts++;
        gateItems++;
        s.lastPhase = phase;
        s.lastCorrect = correct;
        s.consecutiveWrong = correct ? 0 : s.consecutiveWrong + 1;
        if (!rules.scores(form, phase)) continue; // director-chosen: inert in both directions
        const hinted = M.phases.hinted?.[phase] ?? false;
        if (correct && rules.hintPolicy && hinted) continue; // learner-chosen help: not scored upward
        const g = rules.modelGuess(band, form, phase);
        const learn = Math.min(
          M.spacing.relearnLearnRateCap,
          band.learn * (relearnActive(s) ? M.spacing.relearnLearnRateMultiplier : 1)
        );
        s.p = bktUpdate(s.p, correct, band.slip, g, learn, 1);
        if (rules.counts(form, phase)) {
          s.scored++;
          if (b >= band.logit) s.atBand++;
          s.forms.add(form);
        }
        if (gateReached(s)) {
          opened = true;
          break;
        }
      }
      if (!opened) continue;
      openedGate = true;

      // ---- consolidation: 2 items, band centre, solo, unhinted ----
      const consPhase = M.spacing.consolidation.phase;
      for (let k = 0; k < M.spacing.consolidation.items; k++) {
        const form = formsOffered[k % formsOffered.length];
        const correct = rng() < Math.max(TRUE_RATE[form] ?? 0.03, TRUE_RATE_PHASE[consPhase] ?? 0);
        if (!rules.scores(form, consPhase)) continue;
        s.p = bktUpdate(s.p, correct, band.slip, rules.modelGuess(band, form, consPhase), band.learn, 1);
      }

      // ---- M4: 3 of 4, uniform over the variant pool, solo, unhinted ----
      const retPhase = M.spacing.retentionCheck.phase;
      let right = 0;
      checksAttempted++;
      for (let k = 0; k < M.spacing.retentionCheck.items; k++) {
        const form = formsOffered[k % formsOffered.length];
        const correct = rng() < Math.max(TRUE_RATE[form] ?? 0.03, TRUE_RATE_PHASE[retPhase] ?? 0);
        if (correct) right++;
        if (!rules.scores(form, retPhase)) continue;
        s.p = bktUpdate(s.p, correct, band.slip, rules.modelGuess(band, form, retPhase), band.learn, 1);
      }
      if (right >= M.spacing.retentionCheck.passAtLeast && s.p >= M.bkt.masteryThreshold) {
        checksPassed++;
        mastered = true;
        s.everMasteredNode = true;
      } else {
        s.scored = Math.max(0, s.scored - 3);
        s.atBand = Math.max(0, s.atBand - 2);
        s.relearn = true;
      }
    }

    if (openedGate) everOpenedGate++;
    if (mastered) {
      certified++;
      // ---- +1 day review: 2 items; posterior below 0.90 revokes the certification ----
      const revPhase = M.spacing.review.phase;
      for (let k = 0; k < M.spacing.review.items; k++) {
        const form = formsOffered[k % formsOffered.length];
        const correct = rng() < Math.max(TRUE_RATE[form] ?? 0.03, TRUE_RATE_PHASE[revPhase] ?? 0);
        if (!rules.scores(form, revPhase)) continue;
        s.p = bktUpdate(s.p, correct, band.slip, rules.modelGuess(band, form, revPhase), band.learn, 1);
      }
      if (s.p >= 0.9) survived++;
    }
  }
  return {
    certifiedPct: (100 * certified) / n,
    survivedPct: (100 * survived) / n,
    openedPct: (100 * everOpenedGate) / n,
    itemsPerBot: gateItems / n,
    checksAttempted,
    checksPassed,
  };
}

const realistic = {};
const BENCH_NODE = "like-terms-id"; // band 2; the node whose signatures were yes/no in round 1
say(`--- L5 isolated: the mastery gate alone, one knowledge point ("${BENCH_NODE}", band ${BY_ID.get(BENCH_NODE).difficulty}), n = ${BENCH_N} bots per cell ---`);
say(`    bot patience: up to ${BENCH_ACQ_CAP} acquisition items per retention attempt, retried as many times as shown`);
say("");
const benchArms = [
  ["LEGACY rules, bot served judge2+select4", ["judge2", "select4"], RULES.legacy, "none"],
  ["LEGACY rules, bot served judge2 only", ["judge2"], RULES.legacy, "none"],
  ["CURRENT rules, bot served judge2+select4", ["judge2", "select4"], RULES.current, "none"],
  ["CURRENT rules, bot served the scored forms", SCORED_FORMS, RULES.current, "none"],
  ["ROUND-3 rules, hint-abusing bot", SCORED_FORMS, RULES.round3, "wait"],
  ["CURRENT rules, hint-abusing bot", SCORED_FORMS, RULES.current, "wait"],
  ["CURRENT rules, hint-abusing bot + leaked hint in solo", SCORED_FORMS, RULES.current, "leak"],
];
const RETRIES = [1, 2, 5, 11];
say(`  ${"arm".padEnd(54)} ${RETRIES.map((r) => `${r} try`.padStart(9)).join("")}   survives +1d   gate opened`);
const benchOut = {};
for (const [label, forms, rules, botHint] of benchArms) {
  const cells = RETRIES.map((r, idx) =>
    gateBench({
      nodeId: BENCH_NODE,
      formsOffered: forms,
      rules,
      retentionAttempts: r,
      n: BENCH_N,
      seedBase: 31337 + idx * 104729,
      botHint,
    })
  );
  benchOut[label] = cells;
  say(
    `  ${label.padEnd(54)} ${cells.map((c) => `${c.certifiedPct.toFixed(2)}%`.padStart(9)).join("")}   ${cells[cells.length - 1].survivedPct.toFixed(2)}%${" ".repeat(9)}${cells[cells.length - 1].openedPct.toFixed(2)}%`
  );
}
say("");
{
  // The realistic cell: the patience a bot inside the real session loop actually gets. Section 4's
  // Freshness term pushes a learner off a node after 12 attempts, and a retention check cannot be
  // retried the same day. This is where the round-3 defect is visible as a number rather than as
  // an argument: M1+M2+M3 filled, the certification pitch fired, the world told the learner it was
  // nearly there — all on evidence the design's own rules reject.
  say(`  at the design's own Freshness cutoff (${12} acquisition items, 1 retention try) — the patience a bot`);
  say(`  inside the real session loop gets:`);
  say(`  ${"arm".padEnd(54)} ${"gate opened".padStart(12)} ${"certified".padStart(11)}`);
  for (const [key, label, forms, rules, botHint] of [
    ["r3Hint", "ROUND-3 rules, hint-abusing bot", SCORED_FORMS, RULES.round3, "wait"],
    ["curHint", "CURRENT rules, hint-abusing bot", SCORED_FORMS, RULES.current, "wait"],
    ["leakHint", "CURRENT rules, hint-abusing bot + leaked hint in solo", SCORED_FORMS, RULES.current, "leak"],
    ["curBlind", "CURRENT rules, patient guessing bot", SCORED_FORMS, RULES.current, "none"],
  ]) {
    const c = gateBench({
      nodeId: BENCH_NODE,
      formsOffered: forms,
      rules,
      retentionAttempts: 1,
      n: BENCH_N,
      seedBase: 20250809,
      acqCap: 12,
      botHint,
    });
    realistic[key] = c;
    say(`  ${label.padEnd(54)} ${(c.openedPct.toFixed(2) + "%").padStart(12)} ${(c.certifiedPct.toFixed(3) + "%").padStart(11)}`);
  }
  say("");
  say(`  Under the current rules the hint-abusing bot and the patient guessing bot produce the SAME`);
  say(`  numbers, and that identity is the fix: waiting for the hint buys exactly nothing, so the`);
  say(`  two strategies are the same strategy.`);
  say("");
  const r3 = benchOut["ROUND-3 rules, hint-abusing bot"][3];
  const cur = benchOut["CURRENT rules, hint-abusing bot"][3];
  const leak = benchOut["CURRENT rules, hint-abusing bot + leaked hint in solo"][3];
  say(`  the SECOND door, measured. A bot that idles ${M.antiGuessing.hintSurfaceMs / 1000} s on every acquisition item and`);
  say(`  answers blind on the retention check:`);
  say(`    under ROUND-3 rules  it opened the mastery gate on ${r3.openedPct.toFixed(2)}% of runs (M1+M2+M3 satisfied on hint-reads)`);
  say(`                         and certified ${r3.certifiedPct.toFixed(3)}%;`);
  say(`    under CURRENT rules  it opens the gate on ${cur.openedPct.toFixed(2)}% and certifies ${cur.certifiedPct.toFixed(3)}%;`);
  say(`    if P18 ALSO leaks the hint surface into solo, ${leak.openedPct.toFixed(2)}% / ${leak.certifiedPct.toFixed(3)}% — which is why phases.hinted`);
  say(`                         is a per-response fact and not a phase name.`);
  say("");
}
const legacyWorst = benchOut["LEGACY rules, bot served judge2+select4"][3].certifiedPct;
const currentExploit = benchOut["CURRENT rules, bot served judge2+select4"][3].certifiedPct;
const currentHonest = benchOut["CURRENT rules, bot served the scored forms"][3].certifiedPct;
say(`  the leak, measured: ${legacyWorst.toFixed(2)}% of coin-flipping bots certified a knowledge point under the round-1 rules.`);
say(`  the leak, closed:   ${currentExploit.toFixed(2)}% under the current rules with the same hostile item server,`);
say(`                      because the engine refuses to score a form outside model.forms.scored — the bot`);
say(`                      never accumulates an M2 opportunity, so the gate is never even opened`);
say(`                      (gate ever opened: ${benchOut["CURRENT rules, bot served judge2+select4"][3].openedPct.toFixed(2)}% of bots).`);
say(`  honest L5 number:   ${currentHonest.toFixed(3)}% of bots certified when served the legitimate scored forms`);
say(`                      at their true blind rates (construct ${TRUE_RATE.construct}, repair ${TRUE_RATE.repair}, generate ${TRUE_RATE.generate}),`);
say(`                      with ${RETRIES[3]} retention attempts and ${BENCH_ACQ_CAP} acquisition items of patience each.`);
say("");

// How much of that 11-retry number is bought with patience nobody has? At 46 s an item, 11
// retries x 200 acquisition items is 2200 items on ONE knowledge point: 28 hours of grinding a
// single skill while certifying nothing. Show the curve so the reader can see what it costs.
say(`  patience sensitivity, CURRENT rules with the scored forms (the honest arm):`);
say(`  ${"acquisition items per retry".padEnd(30)} ${"hours on one KP".padStart(16)} ${"certified".padStart(11)}`);
for (const cap of [12, 40, 100, 200, 400]) {
  const c = gateBench({
    nodeId: BENCH_NODE,
    formsOffered: SCORED_FORMS,
    rules: RULES.current,
    retentionAttempts: 11,
    n: BENCH_N,
    seedBase: 909091,
    acqCap: cap,
  });
  const hours = (cap * 11 * SECONDS_PER_ITEM) / 3600;
  const bound = c.certifiedPct === 0 ? `< ${((100 * 3) / BENCH_N).toFixed(3)}%` : `${c.certifiedPct.toFixed(3)}%`;
  say(`  ${String(cap).padEnd(30)} ${hours.toFixed(1).padStart(16)} ${bound.padStart(11)}`);
}
say(`  (12 is the design's own Freshness cutoff in section 4 — past 12 attempts the selector pushes`);
say(`   the learner off the node, so 12 is the patience a bot inside the real session loop actually gets.`);
say(`   Zero certifications there is why the full-session guessing cohort above certifies nothing at all.)`);
say("");

const medianOK = percentile(results.median.pct, 0.5) >= 80;
const mixedOK = percentile(results.mixed.pct, 0.5) >= 80;
const mixed80 = (100 * results.mixed.pct.filter((p) => p >= 80).length) / results.mixed.pct.length;
const guesserPeak = Math.max(...results.guesser.rows.map((r) => r.everMastered));
const hintPeak = Math.max(...results.hintAbuser.rows.map((r) => r.everMastered));
const leakPeak = Math.max(...results.hintLeak.rows.map((r) => r.everMastered));
const masherPeak = Math.max(...results.masher.rows.map((r) => r.everMastered));
const hunterPeak = Math.max(...results.formHunter.rows.map((r) => r.everMastered));
const botCeiling = Math.ceil(0.1 * NODES.length); // a bot must stay under 10% of Level 1
const longShare = (100 * longRows.filter((r) => r.sessionsTo80 !== null).length) / longRows.length;
const exploitOK = currentExploit < 0.05;
const honestOK = currentHonest < 0.05;
const leakVisible = legacyWorst > 5; // the harness must be ABLE to see a leak, or it proves nothing
const hintGateShut = realistic.curHint.openedPct === 0;
const hintHoleVisible = realistic.r3Hint.openedPct > 5; // same discipline, on the phase axis

say("== gates ==");
say(`  L4  median learner reaches >= 80% mastery ................. ${medianOK ? "PASS" : "FAIL"}`);
say(`  L4  median of the mixed-ability population >= 80% ......... ${mixedOK ? "PASS" : "FAIL"}  (${mixed80.toFixed(1)}% clear 80% inside the ${SESSIONS}-session budget)`);
say(`  L4  >= 95% of learners reach 80% given unbounded sessions .. ${longShare >= 95 ? "PASS" : "FAIL"}  (${longShare.toFixed(1)}%)`);
say(`  L5  patient guessing bot stays under 10% of Level 1 ....... ${guesserPeak < botCeiling ? "PASS" : "FAIL"}  (peak ever certified: ${guesserPeak} of ${NODES.length})`);
say(`  L5  mashing bot stays under 10% of Level 1 ................ ${masherPeak < botCeiling ? "PASS" : "FAIL"}  (peak ever certified: ${masherPeak} of ${NODES.length})`);
say(`  L5  form-hunting bot stays under 10% of Level 1 ........... ${hunterPeak < botCeiling ? "PASS" : "FAIL"}  (peak ever certified: ${hunterPeak} of ${NODES.length})`);
say(`  L5  isolated gate, hostile forms, 11 retries ............. ${exploitOK ? "PASS" : "FAIL"}  (${currentExploit.toFixed(3)}% certified, must be < 0.05%)`);
say(`  L5  isolated gate, scored forms, 11 retries .............. ${honestOK ? "PASS" : "FAIL"}  (${currentHonest.toFixed(3)}% certified, must be < 0.05%)`);
say(`  L5  hint-abusing bot stays under 10% of Level 1 ........... ${hintPeak < botCeiling ? "PASS" : "FAIL"}  (peak ever certified: ${hintPeak} of ${NODES.length})`);
say(`  L5  hint-LEAK bot (P18 bug arm) stays under 10% ........... ${leakPeak < botCeiling ? "PASS" : "FAIL"}  (peak ever certified: ${leakPeak} of ${NODES.length})`);
say(`  L5  hint-abusing bot never OPENS the gate at real patience  ${hintGateShut ? "PASS" : "FAIL"}  (${realistic.curHint.openedPct.toFixed(2)}% of bots reached provisional, must be 0)`);
say(`  L5* harness can actually detect a leak .................... ${leakVisible ? "PASS" : "FAIL"}  (legacy rules leak ${legacyWorst.toFixed(2)}%, must be > 5% or this file is measuring nothing)`);
say(`  L5* harness can see the ROUND-3 hint hole ................. ${hintHoleVisible ? "PASS" : "FAIL"}  (round-3 rules let the hint-abuser open the gate on ${realistic.r3Hint.openedPct.toFixed(2)}% of runs at the same patience, must be > 5%)`);
say("");
const ok =
  medianOK &&
  mixedOK &&
  longShare >= 95 &&
  guesserPeak < botCeiling &&
  masherPeak < botCeiling &&
  hunterPeak < botCeiling &&
  hintPeak < botCeiling &&
  leakPeak < botCeiling &&
  hintGateShut &&
  exploitOK &&
  honestOK &&
  leakVisible &&
  hintHoleVisible;
say(`RESULT: ${ok ? "PASS" : "FAIL"}`);

console.log(out.join("\n"));
process.exit(ok ? 0 : 1);
