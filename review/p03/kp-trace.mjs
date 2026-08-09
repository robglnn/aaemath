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
function phase(p, lastWrong, firstEncounter, easiestGap) {
  if (firstEncounter && p < 0.4) return "model";
  if (easiestGap) return "model";
  if (lastWrong || p < 0.75) return "guided";
  return "solo";
}

const out = [];
const say = (s = "") => out.push(s);

say(`Worked trace — "${node.id}" (${node.shortTitle}), difficulty band ${node.difficulty}`);
say(`  band parameters:  prior ${band.prior}   learn ${band.learn}   slip ${band.slip}   guess ${band.guess}   difficulty centre ${band.logit} logit`);
say(`  gate: P >= ${M.bkt.masteryThreshold}, >= ${M.bkt.minScoredOpportunities} scored, >= ${M.bkt.minAtBandOpportunities} at band, >= ${M.bkt.minDistinctItemForms} forms`);
say("");

// ---------------------------------------------------------------- learner ---
const mc = node.misconceptions;
const script = [
  { correct: false, why: `error matches misconception "${mc[0].id}" — ${mc[0].description}` },
  { correct: true, why: "after the modelled example, repeats the method on a scaffolded item" },
  { correct: true, why: "same method, scaffold reduced one level" },
  {
    correct: false,
    why: `first item at the certification pitch; error matches "${(mc[1] ?? mc[0]).id}" — ${(mc[1] ?? mc[0]).description}`,
  },
  { correct: true, why: "recovers on a same-trap item drawn from that misconception's variant pool" },
  { correct: true, why: "clean, unscaffolded, at band" },
];

let p = band.prior;
let theta = -0.30; // this learner arrives at the KP mid-Level-1, not at spawn
let responses = 24; // 24 responses already logged elsewhere in the graph -> K = 0.35
let scored = 0;
let atBand = 0;
const forms = new Set();
let lastWrong = false;

say(`  learner enters with theta = ${f2(theta)} and P(known) = ${f4(p)} (the band prior)`);
say("");
say(`  #  phase   item b   P(correct|theta)  resp  P(known) after   theta after   scored/atBand/forms`);

script.forEach((step, i) => {
  const certPitch = p >= M.ability.certificationPitchThreshold;
  const target = certPitch ? band.logit + M.ability.certificationOffset : theta + M.ability.acquisitionTargetOffset;
  const b = pickVariant(target);
  const easiestGap = band.logit + Math.min(...M.ability.variantOffsets) > theta + M.ability.modelPhaseTriggerGap;
  const ph = phase(p, lastWrong, i === 0, i === 0 && easiestGap);
  const pc = logistic(theta - b);

  const form = p < M.forms.cycleAbove ? M.forms.beforeThreshold : M.forms.order[scored % M.forms.order.length];
  const post = posterior(p, step.correct, band.slip, band.guess * (M.guessByForm[form] ?? 1));
  p = withLearning(post, band.learn);
  theta += kFor(responses) * ((step.correct ? 1 : 0) - pc);
  responses++;
  scored++;
  if (b >= band.logit) atBand++;
  forms.add(form);
  lastWrong = !step.correct;

  say(
    `  ${i + 1}  ${ph.padEnd(7)} ${f2(b).padStart(6)}   ${f4(pc).padStart(14)}   ${step.correct ? " ok " : "wrong"}  ${f4(p).padStart(14)}   ${f2(theta).padStart(11)}   ${scored}/${atBand}/${forms.size}   [${form}]`
  );
  say(`       ${step.why}`);
});

const gate =
  p >= M.bkt.masteryThreshold &&
  scored >= M.bkt.minScoredOpportunities &&
  atBand >= M.bkt.minAtBandOpportunities &&
  forms.size >= M.bkt.minDistinctItemForms;
say("");
say(`  after ${script.length} scored opportunities: P(known) = ${f4(p)}, scored ${scored}, at band ${atBand}, forms ${forms.size}`);
say(`  mastery gate M1-M3: ${gate ? "OPEN -> status becomes `provisional`" : "still closed"}`);
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

console.log(out.join("\n"));
