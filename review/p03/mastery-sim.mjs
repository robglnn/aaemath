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
const SESSIONS = arg("sessions", 18);
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
const SCORED_FORMS = M.forms.scored;
const MASTERY_FORMS = M.bkt.formsEligibleForMastery;
const UNSCORED_FORMS = M.forms.unscored;
const CAPS = M.bkt.identifiabilityCaps;

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
    label: "current (forms gated, no clamping)",
    scores: (form) => SCORED_FORMS.includes(form),
    counts: (form) => MASTERY_FORMS.includes(form),
    modelGuess: (band, form) => band.guess * (M.guessByForm[form] ?? 1),
  },
  legacy: {
    label: "legacy (round 1: every form scored, guess clamped to maxGuess)",
    scores: () => true,
    counts: () => true,
    modelGuess: (band, form) => Math.min(CAPS.maxGuess, band.guess * (M.guessByForm[form] ?? 1)),
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
function makeLearner(seed, kind, rules = RULES.current) {
  const rng = mulberry32(seed);
  const bot = kind === "guesser" || kind === "masher" || kind === "formHunter";
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
    bot,
    rules,
    // A hostile item server: every item this learner is offered comes back as a selected-response
    // form, because the diagnostic signature it was generated from reads as a closed question.
    exploitForms: kind === "formHunter" ? UNSCORED_FORMS : null,
  };
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

/** One learning opportunity. Returns whether it was correct. */
function attempt(L, node, b, mode, form) {
  const band = BAND[node.difficulty];
  const s = L.state.get(node.id);
  const R = L.rules;
  const modelGuess = R.modelGuess(band, form);
  const slip = band.slip;

  // ---- the response itself -------------------------------------------------
  // A7: a bot draws from the form's TRUE blind-success rate, which owes nothing to the model.
  // A human who has not acquired the skill draws from the model's guess, which stands in for
  // partial knowledge. These are separate numbers on purpose and they are allowed to disagree.
  let correct;
  let fast = false;
  if (L.bot) {
    const trueRate = TRUE_RATE[form] ?? 0.03;
    correct = L.rng() < trueRate;
    fast = L.kind === "masher" ? L.rng() < 0.5 : false;
  } else if (s.knownTrue) {
    correct = L.rng() < Math.max(0.55, 1 - slip * (1 + 0.35 * Math.max(0, b - L.thetaTrue)));
  } else {
    correct = L.rng() < Math.min(0.3, modelGuess * (1 + 0.5 * Math.max(0, L.thetaTrue - b)));
  }

  L.items++;
  s.attempts++;

  // ---- does the engine score it at all? ------------------------------------
  // A form outside model.forms.scored is inert: no posterior, no counters, no ability movement,
  // no prerequisite credit. It costs the learner time and buys them nothing. This single branch
  // is the difference between an 18% guessing leak and no leak.
  if (!R.scores(form)) {
    L.unscoredItems++;
    return correct;
  }

  // ability estimate: stochastic approximation on the Rasch model
  L.theta += kFor(L.responses) * ((correct ? 1 : 0) - logistic(L.theta - b));
  L.responses++;

  // anti-guessing: a suspiciously fast CORRECT response is never scored upward.
  const scoreUpward = !(fast && correct);
  const learn = Math.min(
    M.spacing.relearnLearnRateCap,
    band.learn * (relearnActive(s) ? M.spacing.relearnLearnRateMultiplier : 1)
  );

  if (scoreUpward || !correct) s.p = bktUpdate(s.p, correct && scoreUpward, slip, modelGuess, learn, 1);
  if (mode === "acquire" && scoreUpward && R.counts(form)) {
    s.scored++;
    if (b >= band.logit) s.atBand++;
    s.forms.add(form);
  }

  if (node.difficulty >= 3 && scoreUpward) {
    for (const pid of node.prerequisites) {
      const ps = L.state.get(pid);
      const pb = BAND[BY_ID.get(pid).difficulty];
      ps.p = bktUpdate(ps.p, correct, pb.slip, pb.guess, pb.learn, M.bkt.prerequisiteCreditWeight);
    }
  }

  if (!s.knownTrue && !L.bot) {
    const t = Math.min(0.9, band.learn * L.ability * (relearnActive(s) ? M.spacing.relearnLearnRateMultiplier : 1));
    if (L.rng() < t) s.knownTrue = true;
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

    for (let i = 0; i < ITEMS_PER_SESSION; ) {
      const pick = chooseNode(L, now, inFlight, blockCount, reviewItems < (i + 1) / 3);
      if (!pick) break;
      const { node, mode } = pick;
      const s = L.state.get(node.id);
      const centre = BAND[node.difficulty].logit;

      if (mode === "consolidate") {
        // Same-session consolidation: 2 items, still scaffold-free, then the clock starts.
        const cn = M.spacing.consolidation.items;
        for (let k = 0; k < cn; k++) attempt(L, node, centre, "consolidate", pickForm(L, s, "consolidate", k));
        i += cn;
        reviewItems += cn;
        now += (SECONDS_PER_ITEM * 2) / 60;
        s.consolidated = true;
        s.nextEventAt = Math.max(s.provisionalAt + M.spacing.retentionCheck.minHours * 60, nextSessionStart);
        continue;
      }

      if (mode === "retention") {
        // Uniform over the whole variant pool. Not adaptive, not hinted: no easy tail to hide in.
        let right = 0;
        for (let k = 0; k < M.spacing.retentionCheck.items; k++) {
          const off = M.ability.variantOffsets[Math.floor(L.rng() * M.ability.variantOffsets.length)];
          if (attempt(L, node, centre + off, "retention", pickForm(L, s, "retention", k))) right++;
        }
        i += M.spacing.retentionCheck.items;
        reviewItems += M.spacing.retentionCheck.items;
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
        }
        continue;
      }

      if (mode === "review") {
        const rn = M.spacing.review.items;
        for (let k = 0; k < rn; k++) {
          const off = M.ability.variantOffsets[Math.floor(L.rng() * M.ability.variantOffsets.length)];
          attempt(L, node, centre + off, "review", pickForm(L, s, "review", k));
        }
        i += rn;
        reviewItems += rn;
        now += (SECONDS_PER_ITEM * 2) / 60;
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
      attempt(L, node, pickVariant(node, target), "acquire", pickForm(L, s, "acquire", 0));
      blockCount++;
      i += 1;
      now += SECONDS_PER_ITEM / 60;

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
    theta: L.theta,
    retentionAttempts,
    retentionPasses,
    trace,
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
say(`budget: ${SESSIONS} sessions x ${SESSION_MINUTES} min = ${SESSIONS * ITEMS_PER_SESSION} scored opportunities at ${SECONDS_PER_ITEM}s each`);
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
  ["patient guessing bot (waits out the latency floor)", "guesser", 99991],
  ["mashing bot (50% of responses under the latency floor)", "masher", 424242],
  ["form-hunting bot (served judge2/select4 on every item by a broken item bank)", "formHunter", 606060],
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
  const peak = Math.max(...rows.map((r) => r.everMastered));
  const anyPeak = rows.filter((r) => r.everMastered > 0).length;
  say(`  peak KPs ever certified by a single run: ${peak}   (runs that ever certified anything: ${anyPeak}/${rows.length})`);
  const unscored = rows.reduce((a, r) => a + r.unscoredItems, 0);
  if (unscored > 0)
    say(`  items the engine refused to score (wrong form): ${(unscored / rows.length).toFixed(0)} per run — time spent, nothing bought`);
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
function gateBench({ nodeId, formsOffered, rules, retentionAttempts, n, seedBase, acqCap = BENCH_ACQ_CAP }) {
  const node = BY_ID.get(nodeId);
  const band = BAND[node.difficulty];
  let certified = 0;
  let survived = 0;
  let everOpenedGate = 0;
  let checksAttempted = 0;
  let checksPassed = 0;

  for (let bot = 0; bot < n; bot++) {
    const rng = mulberry32(seedBase + bot * 7919);
    const s = { p: band.prior, scored: 0, atBand: 0, forms: new Set(), attempts: 0, relearn: false, everMasteredNode: false };
    let mastered = false;
    let openedGate = false;

    for (let round = 0; round < retentionAttempts && !mastered; round++) {
      // ---- acquisition: grind until the gate opens or the patience cap runs out ----
      let opened = false;
      for (let i = 0; i < acqCap; i++) {
        const form = formsOffered[i % formsOffered.length];
        const target =
          s.p >= M.ability.certificationPitchThreshold
            ? band.logit + M.ability.certificationOffset
            : band.logit + M.ability.acquisitionTargetOffset;
        const b = pickVariant(node, target);
        const correct = rng() < (TRUE_RATE[form] ?? 0.03);
        s.attempts++;
        if (!rules.scores(form)) continue; // engine refuses the form outright
        const g = rules.modelGuess(band, form);
        const learn = Math.min(
          M.spacing.relearnLearnRateCap,
          band.learn * (relearnActive(s) ? M.spacing.relearnLearnRateMultiplier : 1)
        );
        s.p = bktUpdate(s.p, correct, band.slip, g, learn, 1);
        if (rules.counts(form)) {
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

      // ---- consolidation: 2 items, band centre, unscaffolded ----
      const consForms = rules === RULES.current ? formsOffered : formsOffered;
      for (let k = 0; k < M.spacing.consolidation.items; k++) {
        const form = consForms[k % consForms.length];
        const correct = rng() < (TRUE_RATE[form] ?? 0.03);
        if (!rules.scores(form)) continue;
        s.p = bktUpdate(s.p, correct, band.slip, rules.modelGuess(band, form), band.learn, 1);
      }

      // ---- M4: 3 of 4, uniform over the variant pool, unhinted ----
      let right = 0;
      checksAttempted++;
      for (let k = 0; k < M.spacing.retentionCheck.items; k++) {
        const form = formsOffered[k % formsOffered.length];
        const correct = rng() < (TRUE_RATE[form] ?? 0.03);
        if (correct) right++;
        if (!rules.scores(form)) continue;
        s.p = bktUpdate(s.p, correct, band.slip, rules.modelGuess(band, form), band.learn, 1);
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
      for (let k = 0; k < M.spacing.review.items; k++) {
        const form = formsOffered[k % formsOffered.length];
        const correct = rng() < (TRUE_RATE[form] ?? 0.03);
        if (!rules.scores(form)) continue;
        s.p = bktUpdate(s.p, correct, band.slip, rules.modelGuess(band, form), band.learn, 1);
      }
      if (s.p >= 0.9) survived++;
    }
  }
  return {
    certifiedPct: (100 * certified) / n,
    survivedPct: (100 * survived) / n,
    openedPct: (100 * everOpenedGate) / n,
    checksAttempted,
    checksPassed,
  };
}

const BENCH_NODE = "like-terms-id"; // band 2; the node whose signatures were yes/no in round 1
say(`--- L5 isolated: the mastery gate alone, one knowledge point ("${BENCH_NODE}", band ${BY_ID.get(BENCH_NODE).difficulty}), n = ${BENCH_N} bots per cell ---`);
say(`    bot patience: up to ${BENCH_ACQ_CAP} acquisition items per retention attempt, retried as many times as shown`);
say("");
const benchArms = [
  ["LEGACY rules, bot served judge2+select4", ["judge2", "select4"], RULES.legacy],
  ["LEGACY rules, bot served judge2 only", ["judge2"], RULES.legacy],
  ["CURRENT rules, bot served judge2+select4", ["judge2", "select4"], RULES.current],
  ["CURRENT rules, bot served the scored forms", SCORED_FORMS, RULES.current],
];
const RETRIES = [1, 2, 5, 11];
say(`  ${"arm".padEnd(42)} ${RETRIES.map((r) => `${r} try`.padStart(9)).join("")}   survives +1d`);
const benchOut = {};
for (const [label, forms, rules] of benchArms) {
  const cells = RETRIES.map((r, idx) =>
    gateBench({
      nodeId: BENCH_NODE,
      formsOffered: forms,
      rules,
      retentionAttempts: r,
      n: BENCH_N,
      seedBase: 31337 + idx * 104729,
    })
  );
  benchOut[label] = cells;
  say(
    `  ${label.padEnd(42)} ${cells.map((c) => `${c.certifiedPct.toFixed(2)}%`.padStart(9)).join("")}   ${cells[cells.length - 1].survivedPct.toFixed(2)}%`
  );
}
say("");
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
const masherPeak = Math.max(...results.masher.rows.map((r) => r.everMastered));
const hunterPeak = Math.max(...results.formHunter.rows.map((r) => r.everMastered));
const botCeiling = Math.ceil(0.1 * NODES.length); // a bot must stay under 10% of Level 1
const longShare = (100 * longRows.filter((r) => r.sessionsTo80 !== null).length) / longRows.length;
const exploitOK = currentExploit < 0.05;
const honestOK = currentHonest < 0.05;
const leakVisible = legacyWorst > 5; // the harness must be ABLE to see a leak, or it proves nothing

say("== gates ==");
say(`  L4  median learner reaches >= 80% mastery ................. ${medianOK ? "PASS" : "FAIL"}`);
say(`  L4  median of the mixed-ability population >= 80% ......... ${mixedOK ? "PASS" : "FAIL"}  (${mixed80.toFixed(1)}% clear 80% inside the ${SESSIONS}-session budget)`);
say(`  L4  >= 95% of learners reach 80% given unbounded sessions .. ${longShare >= 95 ? "PASS" : "FAIL"}  (${longShare.toFixed(1)}%)`);
say(`  L5  patient guessing bot stays under 10% of Level 1 ....... ${guesserPeak < botCeiling ? "PASS" : "FAIL"}  (peak ever certified: ${guesserPeak} of ${NODES.length})`);
say(`  L5  mashing bot stays under 10% of Level 1 ................ ${masherPeak < botCeiling ? "PASS" : "FAIL"}  (peak ever certified: ${masherPeak} of ${NODES.length})`);
say(`  L5  form-hunting bot stays under 10% of Level 1 ........... ${hunterPeak < botCeiling ? "PASS" : "FAIL"}  (peak ever certified: ${hunterPeak} of ${NODES.length})`);
say(`  L5  isolated gate, hostile forms, 11 retries ............. ${exploitOK ? "PASS" : "FAIL"}  (${currentExploit.toFixed(3)}% certified, must be < 0.05%)`);
say(`  L5  isolated gate, scored forms, 11 retries .............. ${honestOK ? "PASS" : "FAIL"}  (${currentHonest.toFixed(3)}% certified, must be < 0.05%)`);
say(`  L5* harness can actually detect a leak .................... ${leakVisible ? "PASS" : "FAIL"}  (legacy rules leak ${legacyWorst.toFixed(2)}%, must be > 5% or this file is measuring nothing)`);
say("");
const ok =
  medianOK &&
  mixedOK &&
  longShare >= 95 &&
  guesserPeak < botCeiling &&
  masherPeak < botCeiling &&
  hunterPeak < botCeiling &&
  exploitOK &&
  honestOK &&
  leakVisible;
say(`RESULT: ${ok ? "PASS" : "FAIL"}`);

console.log(out.join("\n"));
process.exit(ok ? 0 : 1);
