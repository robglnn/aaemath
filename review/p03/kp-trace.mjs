/**
 * P03 — worked numeric trace of one learner through one knowledge point.
 *
 * Prints, step by step, exactly what the specified learner model does: the BKT posterior,
 * the learning transition, the ability estimate, which difficulty the next item is pitched at,
 * which teaching phase the director selects, and where the mastery gate opens.
 *
 * Also computes the two numbers the anti-guessing argument rests on:
 *   - the all-wrong fixed point of the BKT recursion (where a non-learner's P(known) settles), and
 *   - the probability that a guesser is certified.
 *
 *   node review/p03/kp-trace.mjs
 *   node review/p03/kp-trace.mjs --kp=eq-both-sides
 *
 * Everything is closed-form. There is no randomness in this file: the response pattern is
 * scripted so the arithmetic can be checked by hand.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const graph = JSON.parse(readFileSync(resolve(root, "content/knowledge-graph.json"), "utf8"));
const M = graph.model;
const BAND = Object.fromEntries(M.bands.map((b) => [b.difficulty, b]));

const argStr = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : dflt;
};
const KP_ID = argStr("kp", "eq-two-step");
const node = graph.nodes.find((n) => n.id === KP_ID);
if (!node) throw new Error(`unknown knowledge point "${KP_ID}"`);
const band = BAND[node.difficulty];

const f4 = (x) => x.toFixed(4);
const f2 = (x) => x.toFixed(2);
const logistic = (x) => 1 / (1 + Math.exp(-x));

function posterior(p, correct, s, g) {
  return correct ? (p * (1 - s)) / (p * (1 - s) + (1 - p) * g) : (p * s) / (p * s + (1 - p) * (1 - g));
}
const withLearning = (p, t) => p + (1 - p) * t;

const kFor = (n) => {
  for (const row of M.ability.kSchedule) if (row.untilResponses === null || n < row.untilResponses) return row.k;
  return 0.2;
};
function pickVariant(target) {
  let best = null;
  let gap = Infinity;
  for (const off of M.ability.variantOffsets) {
    const b = band.logit + off;
    if (Math.abs(b - target) < gap) {
      gap = Math.abs(b - target);
      best = b;
    }
  }
  return best;
}
/**
 * The teaching-phase state machine of section 6.1, implemented exactly as
 * review/p03/mastery-sim.mjs implements it and read entirely out of model.phases.
 * Round 3's trace had a `phase` column that was decoration: it never changed what was scored.
 */
const PH = M.phases;
const FADE = PH.fadeOrder;
function nextPhase(st, theta) {
  const firstEncounter = st.attempts === 0;
  const easiestOutOfReach =
    band.logit + Math.min(...M.ability.variantOffsets) > theta + M.ability.modelPhaseTriggerGap &&
    st.p < PH.modelPhaseThreshold;
  const wantModel = (firstEncounter && st.p < PH.modelPhaseThreshold) || easiestOutOfReach || st.pendingModel;
  if (wantModel && st.modelEvents < PH.modelEventsPerNodePerSession) {
    st.modelEvents++;
    st.pendingModel = false;
    st.fadeIdx = 0;
    return "model";
  }
  st.pendingModel = false;
  if (st.lastPhase === "model") {
    st.fadeIdx = 0;
    return FADE[0];
  }
  if (st.lastCorrect === null) {
    st.fadeIdx = 0;
    return st.p >= PH.soloThreshold ? "solo" : FADE[0];
  }
  if (st.p >= PH.soloThreshold && st.lastCorrect) return "solo";
  const retreat = st.consecutiveWrong >= PH.retreatAfterConsecutiveErrors;
  if (st.lastPhase === "solo") {
    if (!retreat && st.p >= PH.soloThreshold) return "solo";
    st.fadeIdx = FADE.length - 1;
    return FADE[st.fadeIdx];
  }
  if (st.lastCorrect) {
    st.fadeIdx++;
    if (st.fadeIdx >= FADE.length) return "solo";
    return FADE[st.fadeIdx];
  }
  if (!retreat) return FADE[st.fadeIdx];
  st.fadeIdx--;
  if (st.fadeIdx < 0) {
    st.fadeIdx = 0;
    if (st.modelEvents < PH.modelEventsPerNodePerSession) {
      st.modelEvents++;
      return "model";
    }
    return FADE[0];
  }
  return FADE[st.fadeIdx];
}
const scorablePhase = (ph) => PH.scored.includes(ph);
const masteryPhase = (ph) => M.bkt.phasesEligibleForMastery.includes(ph);
const composedGuess = (form, ph) => band.guess * Math.max(M.guessByForm[form] ?? 1, M.guessByPhase[ph] ?? 0);

const out = [];
const say = (s = "") => out.push(s);

say(`Worked trace - "${node.id}" (${node.shortTitle}), difficulty band ${node.difficulty}`);
say(`  band parameters:  prior ${band.prior}   learn ${band.learn}   slip ${band.slip}   guess ${band.guess}   difficulty centre ${band.logit} logit`);
say(`  gate: P >= ${M.bkt.masteryThreshold}, >= ${M.bkt.minScoredOpportunities} scored, >= ${M.bkt.minAtBandOpportunities} at band, >= ${M.bkt.minDistinctItemForms} forms`);
say(`  M2/M3 count phases [${M.bkt.phasesEligibleForMastery.join(", ")}] only; phases [${PH.unscored.join(", ")}] are inert in both directions`);
say("");

// ---------------------------------------------------------------- learner ---
const mc = node.misconceptions;
const script = [
  { correct: true, why: "watches the machine do it, then makes the last move itself" },
  { correct: true, why: "the first step is already placed; repeats the method on the rest" },
  { correct: true, why: "answer space constrained to legal moves; builds it" },
  { correct: true, why: "hint surface available but not needed; promotes itself to solo" },
  { correct: false, why: `first unaided item; error matches "${mc[0].id}" - ${mc[0].description}` },
  { correct: true, why: "same-trap item drawn from that misconception's variant pool" },
  { correct: true, why: "clean" },
  { correct: false, why: `certification pitch has fired; error matches "${(mc[1] ?? mc[0]).id}" - ${(mc[1] ?? mc[0]).description}` },
  { correct: true, why: "recovers, still at the certification pitch" },
  { correct: true, why: "at band, unscaffolded, clean" },
  { correct: true, why: "at band, unscaffolded, clean" },
  { correct: true, why: "at band, unscaffolded, clean" },
];

const st = {
  p: band.prior,
  attempts: 0,
  lastPhase: null,
  lastCorrect: null,
  consecutiveWrong: 0,
  fadeIdx: 0,
  modelEvents: 0,
  pendingModel: false,
};
let theta = -0.3; // this learner arrives at the KP mid-Level-1, not at spawn
let responses = 24; // 24 responses already logged elsewhere in the graph -> K = 0.35
let scored = 0;
let atBand = 0;
let seconds = 0;
const forms = new Set();

say(`  learner enters with theta = ${f2(theta)} and P(known) = ${f4(st.p)} (the band prior), K = ${kFor(responses)}`);
say("");
say(`   #  phase     item b  P(correct)  resp    guess   P(known) after   theta after   scored/atBand/forms  form`);

let gateOpenedAt = null;
for (let i = 0; i < script.length; i++) {
  const step = script[i];
  const ph = nextPhase(st, theta);
  const certPitch = st.p >= M.ability.certificationPitchThreshold;
  const target = certPitch ? band.logit + M.ability.certificationOffset : theta + M.ability.acquisitionTargetOffset;
  const b = pickVariant(target);
  const pc = logistic(theta - b);
  const form = st.p < M.forms.cycleAbove ? M.forms.beforeThreshold : M.forms.order[scored % M.forms.order.length];
  const g = composedGuess(form, ph);
  seconds += PH.secondsPerItemByPhase[ph] ?? 46;
  st.attempts++;

  let note = "";
  if (!scorablePhase(ph)) {
    // Inert in both directions. The response happens in the world; the engine records nothing.
    note = "   [inert: a scaffold the director chose - no posterior, no counters, either way]";
  } else {
    const post = posterior(st.p, step.correct, band.slip, g);
    st.p = withLearning(post, band.learn);
    theta += kFor(responses) * ((step.correct ? 1 : 0) - pc);
    responses++;
    if (masteryPhase(ph)) {
      scored++;
      if (b >= band.logit) atBand++;
      forms.add(form);
    } else {
      note = "   [scored, NOT mastery-eligible: guided-1 moves P(known) and never fills M2 or M3]";
    }
  }
  st.lastPhase = ph;
  st.lastCorrect = step.correct;
  st.consecutiveWrong = step.correct ? 0 : st.consecutiveWrong + 1;

  say(
    `  ${String(i + 1).padStart(2)}  ${ph.padEnd(8)} ${f2(b).padStart(6)}  ${f4(pc).padStart(10)}  ${step.correct ? " ok  " : "wrong"}  ${scorablePhase(ph) ? f4(g).padStart(7) : "      -"}  ${f4(st.p).padStart(14)}   ${f2(theta).padStart(11)}   ${String(scored).padStart(2)}/${atBand}/${forms.size}                ${form}`
  );
  say(`      ${step.why}${note}`);

  const gate =
    st.p >= M.bkt.masteryThreshold &&
    scored >= M.bkt.minScoredOpportunities &&
    atBand >= M.bkt.minAtBandOpportunities &&
    forms.size >= M.bkt.minDistinctItemForms;
  if (gate && gateOpenedAt === null) gateOpenedAt = i + 1;
}

const p = st.p;
say("");
say(`  after ${script.length} acquisition items: P(known) = ${f4(p)}, scored ${scored}, at band ${atBand}, forms ${forms.size}`);
say(`  mastery gate M1-M3: ${gateOpenedAt ? "OPEN at item " + gateOpenedAt + " -> status becomes provisional" : "still closed"}`);
say(
  `  acquisition cost: ${script.length} items, ${(seconds / 60).toFixed(1)} min of item time (${Object.entries(PH.secondsPerItemByPhase).map(([k, v]) => k + " " + v + "s").join(", ")})`
);
say(`  next: consolidation pass (+${M.spacing.consolidationMinutes} min, 2 items), then a retention check no sooner than +${M.spacing.retentionCheck.minHours} h`);
say("");

// -------------------------------------------------------- retention maths ---
const s = band.slip;
const g = band.guess;
const nCk = (n, k) => {
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return r;
};
const atLeast = (n, k, p1) => {
  let acc = 0;
  for (let j = k; j <= n; j++) acc += nCk(n, j) * p1 ** j * (1 - p1) ** (n - j);
  return acc;
};
const RN = M.spacing.retentionCheck.items;
const RK = M.spacing.retentionCheck.passAtLeast;
say(`Retention check: ${RK} of ${RN}, sampled uniformly over the variant pool, never hinted, forms ${JSON.stringify(M.spacing.retentionCheck.forms)}`);
say(`  a learner who genuinely knows it   (p = 1 - slip = ${f4(1 - s)}): passes with probability ${f4(atLeast(RN, RK, 1 - s))}`);
say(`  a learner who does not             (p = guess = ${f4(g)}):        passes with probability ${f4(atLeast(RN, RK, g))}`);
say(`  false-negative rate for a true master: ${f4(1 - atLeast(RN, RK, 1 - s))} -> handled as a lapse and re-checked, so it costs time, not credit`);
say("");

// --------------------------------------------------- what a form is worth ---
// The model's guess parameter is a BELIEF. trueGuessByForm is what a responder with no knowledge
// actually achieves. Print both, and print the retention pass rate a blind bot really gets in
// each form, because the difference between those two columns is the whole of L5.
const TG = M.trueGuessByForm;
say(`Form scorability at band ${node.difficulty} — model belief vs ground truth`);
say(`  ${"form".padEnd(10)} ${"modelled".padStart(9)} ${"true".padStart(7)} ${"scored?".padStart(9)}   3-of-4 retention pass rate, blind`);
for (const form of Object.keys(TG).filter((k) => typeof TG[k] === "number")) {
  const modelled = g * (M.guessByForm[form] ?? 1);
  const scored = M.forms.scored.includes(form);
  say(
    `  ${form.padEnd(10)} ${f4(modelled).padStart(9)} ${f4(TG[form]).padStart(7)} ${(scored ? "yes" : "NO").padStart(9)}   ${atLeast(RN, RK, TG[form]).toExponential(2)}${scored ? "" : "   <- never reaches a retention check: the engine refuses the form"}`
  );
}
say(
  `  A yes/no item is worth ${f4(TG.judge2)} blind and the model would have called it ${f4(Math.min(M.bkt.identifiabilityCaps.maxGuess, g * M.guessByForm.judge2))} after clamping.`
);
say(`  That gap is not a rounding error, it is a mastery gate a coin can walk through, which is why`);
say(`  model.forms.scored excludes judge2 and select4 outright rather than pricing them.`);
say("");

// ------------------------------------------------------- guesser analysis ---
say(`Why a guesser cannot get there (band ${node.difficulty} numbers)`);
const t = band.learn;
// all-wrong fixed point of  P' = t + (1-t) * posterior(P, wrong)
let fp = band.prior;
for (let i = 0; i < 400; i++) fp = withLearning(posterior(fp, false, s, g), t);
say(`  1. All-wrong fixed point of the BKT recursion: P(known) settles at ${f4(fp)}.`);
say(`     The learn rate keeps a floor under P; that floor is far below the ${M.bkt.masteryThreshold} gate.`);
let spike = fp;
const spikes = [];
for (let i = 0; i < 4; i++) {
  spike = withLearning(posterior(spike, true, s, g), t);
  spikes.push(f4(spike));
}
const needed = spikes.findIndex((v) => Number(v) >= M.bkt.masteryThreshold) + 1;
say(`  2. From that floor, consecutive lucky guesses drive P to: ${spikes.join(" -> ")}`);
say(`     so ${needed} consecutive lucky guesses would clear M1 on their own — probability ${g}^${needed} = ${(g ** needed).toExponential(2)} per attempt window.`);
say(`  3. M2 forces >= ${M.bkt.minScoredOpportunities} scored opportunities with >= ${M.bkt.minAtBandOpportunities} at band, so the run has to happen late in a long window,`);
say(`     and M3 forces >= ${M.bkt.minDistinctItemForms} distinct item forms, so one exploitable interface is not enough.`);
say(`  4. M4 then demands ${RK}/${RN} on an unhinted, uniformly sampled check at least ${M.spacing.retentionCheck.minHours} h later: probability ${f4(atLeast(RN, RK, g))}.`);
// The bound above is stated in the model's own currency, which is exactly the mistake round 1
// made. Restate it in ground truth: the bot's real blind rate on the hardest-to-fake scored
// form, and the real rate on the yes/no form the engine now refuses.
const tgWorst = Math.max(...M.forms.scored.map((f) => M.trueGuessByForm[f]));
const perKpModel = g ** needed * atLeast(RN, RK, g);
const perKpTrue = tgWorst ** needed * atLeast(RN, RK, tgWorst);
const perKpJudge2 = M.trueGuessByForm.judge2 ** needed * atLeast(RN, RK, M.trueGuessByForm.judge2);
say(`  5. Bound on certifying ONE knowledge point by guessing, in three currencies:`);
say(`       model's own guess parameter ${f4(g)}:  ${g}^${needed} x ${f4(atLeast(RN, RK, g))} = ${perKpModel.toExponential(2)}`);
say(`       TRUE blind rate of the best scored form (${f4(tgWorst)}):  ${perKpTrue.toExponential(2)}   <- the honest number`);
say(`       TRUE blind rate of a yes/no item (${f4(M.trueGuessByForm.judge2)}):  ${perKpJudge2.toExponential(2)}   <- what it would be if judge2 were scored`);
say(`     The third row is four orders of magnitude worse than the first. It is not a hypothetical:`);
say(`     it is what the gate is worth on any node whose items are served as closed questions, and it`);
say(`     is why model.forms.scored is a hard list rather than guidance. Measured end to end in`);
say(`     review/p03/mastery-sim.mjs, which serves a bot judge2 items on purpose.`);
say(`     Expected knowledge points certified across all ${graph.nodes.length} of Level 1, honest currency: ${(perKpTrue * graph.nodes.length).toExponential(2)}.`);
say(`  6. And a certification that does slip through is revoked by the spaced review at +${M.spacing.ladderDays[0]} d,`);
say(`     which the same guesser passes with probability ${f4(tgWorst ** 2 + 2 * tgWorst * (1 - tgWorst))} at best.`);
say("");
say(`  Note: this bound assumes the guesser is patient. The latency floor (${M.antiGuessing.latencyFloorMs} ms + ${M.antiGuessing.latencyPerTokenMs} ms/token)`);
say(`  removes upward credit from fast correct responses entirely, so mashing is strictly worse than patient guessing.`);
say(`  And the learn rate is the other half of the floor: at ${f4(t)} the all-wrong fixed point sits at ${f4(fp)},`);
say(`  so the relearn boost is capped at ${M.spacing.relearnLearnRateCap} and withheld until a node has genuinely been`);
say(`  mastered once (spacing.relearnRequiresPriorMastery), or the floor rises far enough that a single`);
say(`  lucky answer clears M1 on its own.`);

say("");
say(`The second axis, in closed form: what the SCAFFOLD is worth at band ${node.difficulty}`);
say(`  ${"phase".padEnd(10)} ${"modelled".padStart(9)} ${"true".padStart(7)} ${"scored?".padStart(9)}  ${"M2/M3?".padStart(8)}   3-of-4 retention pass rate at that phase's blind rate`);
for (const ph of M.phases.order) {
  const modelledP = g * (M.guessByPhase[ph] ?? 0);
  const tgP = Math.max(M.trueGuessByPhase[ph] ?? 0, M.trueGuessByForm.construct);
  const sc = M.phases.scored.includes(ph);
  const me = M.bkt.phasesEligibleForMastery.includes(ph);
  say(
    `  ${ph.padEnd(10)} ${f4(modelledP).padStart(9)} ${f4(M.trueGuessByPhase[ph]).padStart(7)} ${(sc ? "yes" : "NO").padStart(9)}  ${(me ? "yes" : "NO").padStart(8)}   ${atLeast(RN, RK, tgP).toExponential(2)}`
  );
}
say(`  Read the guided-3 row against the construct row of the form table above. A responder who`);
say(`  idles ${M.antiGuessing.hintSurfaceMs / 1000} s and reads the hint is right ${f4(M.trueGuessByPhase["guided-3"])} of the time, against a modelled ${f4(g)} if the`);
say(`  engine prices the item by form alone - which is what round 3 did. That is a factor of`);
say(`  ${(M.trueGuessByPhase["guided-3"] / g).toFixed(1)} of unearned credit per correct response, on the path every learner walks.`);
say(`  Priced honestly the phase is not scorable at all, so the response is worth nothing instead:`);
say(`  no posterior, no M2, no M3. The retention column is unchanged either way, because the check`);
say(`  is pinned to phase "${M.spacing.retentionCheck.phase}" with hinted ${M.spacing.retentionCheck.hinted} - which is why a blind bot still failed L5`);
say(`  under the round-3 rules even while its P(known) was climbing on hint-reads. The defect was`);
say(`  never that a bot could certify; it was that M1, M2 and M3 filled on evidence worth nothing,`);
say(`  the certification pitch fired early, and the learner was told they had it.`);
say("");

console.log(out.join("\n"));
