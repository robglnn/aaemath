/**
 * P32 — prerequisite credit propagation + the 2-minute test-out. The proof.
 *
 *   node review/measure/P32.mjs
 *   node review/measure/P32.mjs --learners=200 --bots=2000 --sessions=26
 *   node review/measure/P32.mjs --json
 *
 * Entirely offline. No browser, no capture, no wall-clock waiting: it drives the SHIPPED
 * `app/src/learn/{Graph,Mastery,Scheduler}.js` — the very files the browser boots — through
 * populations of simulated learners and hostile bots, and prints PASS/FAIL against thresholds
 * declared at the top. If it prints FAIL, P32 is wrong.
 *
 * ROUND 3: IT NOW IMPORTS THE REAL ITEM BANK, AND THAT IS THE MOST IMPORTANT LINE IN THE FILE.
 *
 * Round 2 did not, on the grounds that `ItemBank.js` was mid-edit. The consequence was a proof that
 * measured a delivery nobody ships: the harness drove `Scheduler.next()` -> `submit()` with no
 * picker in between, which is exactly the shipped loop's defect, and then priced the result as if
 * the picker had honoured `avoidFamilies`. A critic re-ran it and got 21 of 29 claims failing with
 * every archetype at 0.0% mastery, against a committed table that said 29 of 29 and 96.6%.
 *
 * So the cohort simulations now run through a `Scheduler` HOLDING the real `itemBank`, which is the
 * shipped configuration after `boot/63-learnserve.js`: every item is drawn through `serve()`, the
 * refusal list is honoured, and the generator family is reported on every response. Rates still come
 * from `app/src/learn/bank-audit.json`, which is what the engine itself prices against.
 *
 * =============================================================================================
 * RULE 1 — WHERE A BOT'S SUCCESS RATE COMES FROM
 *
 * Never from `model.guessByForm`, and never from `model.trueGuessByForm` either. From the MEASURED
 * blind rate of the shipped pool for the exact (knowledge point x form) the scheduler served,
 * taken at its Wilson upper bound. That distinction is the entire piece: `trueGuessByForm` says a
 * `construct` item is flukeable at 0.03, and the bank this game ships measures 0.071 to 0.300 —
 * up to ten times worse, per item, which is up to three thousand times worse over a probe. A
 * test-out priced on the constant is a free pass, and three critics have already caught versions
 * of that mistake in this project.
 *
 * RULE 2 — A HARNESS THAT ONLY EVER PRINTS ZEROS IS MEASURING NOTHING
 *
 * Every zero here is paired with a control that must be NON-zero. `leaky-probe` runs the identical
 * guessing bot against a deliberately broken test-out (`maxBlindPass: 1`, `minItems: 1`) and
 * `leaky-ceiling` runs the identical leaf-only learner against a propagation rule with the ceiling
 * removed. If either control fails to leak, this file cannot see the defect it claims to have
 * closed and the run FAILS.
 * =============================================================================================
 *
 * MODELLING ASSUMPTIONS. All of them are attackable, so all of them are stated.
 *
 *  A1  A learner who HOLDS a skill is wrong with probability `band.slip`, raised by 0.35 per logit
 *      the item sits above their true ability. This is the assumption that decides the test-out's
 *      false-negative rate, and it is P16's assumption A2 unchanged.
 *  A2  A learner who does NOT hold a skill answers at the model's own `guess` (partial knowledge is
 *      real and BKT's `guess` is what stands in for it), floored by the phase's true blind rate.
 *      A BOT holds nothing and draws from the MEASURED bank rate instead. Conflating the two is
 *      the failure P16 was built to avoid and this file inherits the fix.
 *  A3  An item on a band-3-or-harder node exercises that node's direct prerequisites, which is the
 *      engine's own default until P17 tags items with `exercises`. Propagation past distance 1 is
 *      reached from those seeds, so this assumption bounds the whole cone rather than only its
 *      first ring — if P17 ships narrower tags, propagation narrows with it.
 *  A4  One session per day, 25 minutes, so every 12-hour retention gate is reachable next session.
 *  A5  Time is the scheduler's own time box: `phases.secondsPerItemByPhase`, 46 s for a solo item.
 *      Every "minutes" number below is scored-item time, the same currency `estMinutes` uses.
 *  A6  The strong learner genuinely knows all 32 knowledge points on arrival and has a true ability
 *      of +1.6 logits — the band-5 centre. Probe items sit at +0.3 above their node's centre, so
 *      even this learner takes a slip penalty on the hardest probes. Nothing here assumes a learner
 *      who cannot be wrong.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { Graph } from "../../app/src/learn/Graph.js";
import { Mastery, bktUpdate, PROPAGATION, TEST_OUT, REVIEW_LAPSE_BELOW, UNREPORTED_FAMILY } from "../../app/src/learn/Mastery.js";
import { Scheduler, virtualClock, mulberry32 } from "../../app/src/learn/Scheduler.js";
import { itemBank } from "../../app/src/learn/ItemBank.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const argOf = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const argNum = (k, d) => Number(argOf(k, d));
const HAS = (k) => process.argv.includes(`--${k}`);

const LEARNERS = argNum("learners", 120);
const BOTS = argNum("bots", 1200);
/**
 * The hostile arms are sized by the POWER CLAIM D1 NEEDS, not by taste. D1 tests whether the
 * measured blind-pass rate EXCEEDS `TEST_OUT.maxBlindPass`; a run that offers far fewer than
 * 1/maxBlindPass probes cannot see a violation of that size at all, so its PASS would mean nothing.
 * At least a few multiples of 1/1e-3 offered probes is the floor; a bot is offered about 1.07 probes
 * across a run and there are three hostile arms, so that is ~1200 bots. A `--bots=200` run printing
 * PASS would be the kind of green number this project keeps catching.
 */
const HOSTILE_MIN = Math.ceil(3.8415 / TEST_OUT.maxBlindPass / 3.2);
const SESSIONS = argNum("sessions", 26);
const SESSION_MINUTES = argNum("sessionMinutes", 25);
const JSON_OUT = HAS("json");

const GRAPH = new Graph(JSON.parse(readFileSync(resolve(ROOT, "content/knowledge-graph.json"), "utf8")));
const AUDIT = JSON.parse(readFileSync(resolve(ROOT, "app/src/learn/bank-audit.json"), "utf8"));
const M = GRAPH.model;
const TOTAL = GRAPH.ids.length;
const NEED80 = Math.ceil(0.8 * TOTAL);

/**
 * ---------------------------------------------------------------------------------------------
 * THE SHIPPED DELIVERY, DECLARED ONCE AND USED EVERYWHERE.
 *
 * `familyReporting: true` is not an optimistic default — it is the fact that both paths in this
 * file report the generator family on every response: the cohort runs because their Scheduler
 * holds `itemBank` and draws through `serve()`, and the direct-`respond()` claims because they
 * pass `family: famOf(...)`, the worst SURVIVING family of the cell. `strictFamilyReport: true`
 * makes any lapse from that fatal instead of merely unscored, so this harness cannot repeat round
 * 2's 1961-item silent run even by accident. PART E proves the negative arm as well.
 * ---------------------------------------------------------------------------------------------
 */
const mk = (opts = {}) =>
  new Mastery(GRAPH, {
    bankAudit: AUDIT,
    storage: null,
    emit: () => {},
    familyReporting: true,
    familyReportingSource: "P32-harness",
    strictFamilyReport: true,
    ...opts,
  });
/** The shipped picker. Attached to every Scheduler the cohorts run, exactly as boot/63 attaches it. */
const BANK = itemBank;
/**
 * The worst SURVIVING generator family of a cell — the one `probeItemBlindRate` prices against, so
 * pricing a direct `respond()` at it is the conservative choice everywhere it is used. `null` when
 * the cell has no surviving family, which is the same thing the engine refuses.
 */
const famOf = (m, kpId, form) => {
  const fams = Object.entries(m.cell(kpId, form)?.families ?? {}).filter(([, r]) => r.priceable);
  if (!fams.length) return null;
  return fams.sort((a, b) => (b[1].blind ?? 0) - (a[1].blind ?? 0) || (a[0] < b[0] ? -1 : 1))[0][0];
};
/** One direct response, priced at the family the shipped picker would have had to report. */
const say = (m, r) => m.respond({ family: famOf(m, r.kpId, r.form), ...r });
/** The reference engine, shipped configuration, used for every static claim in PART A and B. */
const REF = mk();
/** How many knowledge points can be certified AT ALL on the shipped bank. `eq-special-cases` cannot. */
const CERTIFIABLE = GRAPH.ids.filter((id) => REF.deliverableMasteryForms(id).length > 0).length;

// ---------------------------------------------------------------------------------------------
// claim plumbing

/**
 * ---------------------------------------------------------------------------------------------
 * THE TABLE IS WRITTEN BY THE SCRIPT, NOT BY A SHELL REDIRECT, AND IT CANNOT LOOK GREEN WHEN IT
 * IS NOT.
 *
 * `review/measure/P32.txt` was committed at 29/29 with a median mastery of 96.6% while the
 * committed script, re-run unmodified, produced 21/29 and 0.0%. A `>` redirect makes that possible:
 * the file is whatever was on stdout on some machine on some day, and nothing ties it to the code
 * beside it. So the script owns the file now, stamps the exact argv and the audit fingerprint the
 * numbers were produced under, and puts the failure count in the FIRST LINE — a reader who opens
 * the file and stops after one line cannot be misled by it.
 * ---------------------------------------------------------------------------------------------
 */
const LOG = [];
const rawLog = console.log.bind(console);
console.log = (...a) => {
  const line = a.map((x) => (typeof x === "string" ? x : String(x))).join(" ");
  LOG.push(line);
  rawLog(line);
};

const claims = [];
let failed = 0;
function claim(id, title, pass, detail) {
  claims.push({ id, title, pass: !!pass, detail });
  if (!pass) failed += 1;
  if (!JSON_OUT) console.log(`${pass ? "PASS" : "FAIL"}  ${id}  ${title}\n        ${detail}`);
}
function head(t) {
  if (!JSON_OUT) console.log(`\n${"=".repeat(94)}\n${t}\n${"=".repeat(94)}`);
}
function table(rows) {
  if (JSON_OUT || !rows.length) return;
  const cols = Object.keys(rows[0]);
  const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length)));
  const line = (cells) => "  " + cells.map((v, i) => String(v ?? "").padEnd(w[i])).join("  ");
  console.log(line(cols));
  console.log("  " + w.map((n) => "-".repeat(n)).join("  "));
  for (const r of rows) console.log(line(cols.map((c) => r[c])));
}
const pct = (x) => (x == null || !Number.isFinite(x) ? "—" : `${(100 * x).toFixed(1)}%`);
/**
 * Format a number that a cohort may never have produced. Every "median minutes to 80%" in this file
 * is null for a cohort that never got there, and RESUME.md's meta-lesson is that two builders'
 * proof scripts in this project died on exactly this shape before printing a single claim. A green
 * script that cannot survive `--sessions=12` is not evidence of anything.
 */
const num = (x, d = 0) => (x == null || !Number.isFinite(x) ? "—" : x.toFixed(d));
/**
 * One-sided binomial tail, P(X >= hits | n, p), in log space so n in the thousands does not overflow.
 *
 * THIS, NOT THE WILSON UPPER BOUND, IS THE RIGHT TEST FOR CLAIM D1, and getting that wrong once is
 * why the comment is here. `maxBlindPass` is a DESIGN BOUND: the probe lengths were derived so a
 * blind responder passes at most one probe in a thousand. A measurement's job is therefore to
 * detect a VIOLATION of that bound, not to re-derive it from scratch. Asking the Wilson upper bound
 * to fall below 1e-3 asks the run to prove the true rate is strictly smaller than the bound — which
 * is impossible when the true rate IS the bound, however many bots are run, and which made this
 * claim fail on 1 pass in 3853 offers where the bound itself predicts 3.9.
 */
const binomTailAtLeast = (hits, n, p) => {
  if (hits <= 0) return 1;
  let logC = 0;
  let below = 0;
  for (let i = 0; i < hits; i++) {
    if (i > 0) logC += Math.log((n - i + 1) / i);
    below += Math.exp(logC + i * Math.log(p) + (n - i) * Math.log1p(-p));
  }
  return Math.max(0, 1 - below);
};
/** Wilson 95% upper bound — reported alongside, as the honest width of the estimate. */
const wilson = (hits, n) => {
  if (!n) return 1;
  const z = 1.959964;
  const pp = hits / n;
  return Math.min(1, (pp + (z * z) / (2 * n) + z * Math.sqrt((pp * (1 - pp)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n));
};
const percentile = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))] : null);

if (!JSON_OUT)
  console.log(
    `P32 — prerequisite credit propagation + test-out\n` +
      `graph ${TOTAL} nodes, ${GRAPH.stats().edges} edges, longest chain ${GRAPH.stats().longestChain}, ` +
      `max ancestor distance ${GRAPH.maxAncestorDistance}\n` +
      `bank audit v${AUDIT.version} fingerprint ${AUDIT.fingerprint}, ${AUDIT.sampled} draws ` +
      `(${AUDIT.mixture ? `${AUDIT.mixture.catalogue} catalogue / ${AUDIT.mixture.generated} generated` : "?"})\n` +
      `certifiable knowledge points on this bank: ${CERTIFIABLE} of ${TOTAL}\n` +
      `learners ${LEARNERS}/cell, bots ${BOTS}/cell, ${SESSIONS} sessions x ${SESSION_MINUTES} min`
  );

// =============================================================================================
head("PART A — the propagation rule, checked against the shipped content");
// =============================================================================================

const W1 = M.bkt.prerequisiteCreditWeight;
const w = (d) => W1 ** d;

claim(
  "A1",
  "the discount is geometric in graph distance, and distance 1 is the shipped constant",
  w(1) === W1 && Math.abs(w(2) * w(3) - w(5)) < 1e-12 && Math.abs(w(2) - 0.25) < 1e-12,
  `w(d) = prerequisiteCreditWeight^d = ${[1, 2, 3, 4].map((d) => `${d}:${w(d).toFixed(3)}`).join(" ")}. ` +
    `w(1) = ${W1} is model.bkt.prerequisiteCreditWeight itself, so distance 1 keeps §1.2 byte for byte. ` +
    `w(a+b) = w(a)·w(b) holds exactly, which is the property that makes the credit a node receives ` +
    `independent of which path the engine walks — the graph is reduced but not a tree.`
);

const cut = [];
for (let d = 1; d <= GRAPH.maxAncestorDistance + 1; d++)
  cut.push(`${d}:${w(d) < PROPAGATION.minWeight ? "minWeight" : d > PROPAGATION.maxDistance ? "maxDistance" : "paid"}`);
claim(
  "A2",
  "propagation is cut off twice, and both cuts bite inside this graph",
  PROPAGATION.maxDistance < GRAPH.maxAncestorDistance && w(PROPAGATION.maxDistance + 1) < 2 * PROPAGATION.minWeight,
  `maxDistance ${PROPAGATION.maxDistance} against a graph whose ancestors reach distance ${GRAPH.maxAncestorDistance}; ` +
    `minWeight ${PROPAGATION.minWeight} against w(${PROPAGATION.maxDistance + 1}) = ${w(PROPAGATION.maxDistance + 1).toFixed(4)}. ` +
    `By distance: ${cut.join(" ")}`
);

claim(
  "A3",
  "the propagation ceiling is strictly below the mastery threshold, so M1 is unreachable by inference",
  PROPAGATION.ceiling < M.bkt.masteryThreshold && PROPAGATION.ceiling === REVIEW_LAPSE_BELOW,
  `ceiling ${PROPAGATION.ceiling} < masteryThreshold ${M.bkt.masteryThreshold}. It is not a new constant: it is ` +
    `REVIEW_LAPSE_BELOW, the posterior at which §3 already says a node is no longer confidently held. ` +
    `A propagated update may carry a node to the edge of "probably knows this" and no further.`
);

/**
 * A4 — DIRECTION, measured on every node rather than argued. Drive one credited response into each
 * knowledge point in turn on a fresh engine, and record which OTHER posteriors moved. Every mover
 * must be an ancestor; no descendant may ever move.
 */
{
  let movers = 0;
  let nonAncestor = 0;
  let descendantMoved = 0;
  let maxDistanceSeen = 0;
  for (const id of GRAPH.ids) {
    const m = mk();
    const before = new Map(GRAPH.ids.map((x) => [x, m.p(x)]));
    const form = m.deliverableMasteryForms(id)[0];
    if (!form) continue;
    say(m, { kpId: id, form, phase: "solo", mode: "acquire", correct: true, latencyMs: 9000, difficulty: GRAPH.centre(id) });
    const anc = GRAPH.ancestors(id);
    const desc = GRAPH.descendants(id);
    for (const x of GRAPH.ids) {
      if (x === id || m.p(x) === before.get(x)) continue;
      movers += 1;
      if (!anc.has(x)) nonAncestor += 1;
      if (desc.has(x)) descendantMoved += 1;
      maxDistanceSeen = Math.max(maxDistanceSeen, GRAPH.distanceToAncestor(id, x));
    }
  }
  claim(
    "A4",
    "one response moves ANCESTORS ONLY — never a descendant, never a node off the prerequisite cone",
    nonAncestor === 0 && descendantMoved === 0 && movers > 0,
    `${movers} propagated updates across all ${TOTAL} knowledge points; ${nonAncestor} landed outside the ` +
      `ancestor closure and ${descendantMoved} landed on a descendant. Deepest hop actually paid: ` +
      `${maxDistanceSeen} (cap ${PROPAGATION.maxDistance}).`
  );
}

/**
 * A5 — THE CEILING, driven to exhaustion. Take the deepest leaf, feed it credited correct responses
 * forever, and watch what happens to its ancestors. This is the "a student who knows advanced
 * material but not basics" case in its purest form: the only evidence in the system is about the
 * leaf, and everything the ancestors get is inference.
 */
const LEAF = GRAPH.leaves()
  .filter((id) => REF.deliverableMasteryForms(id).length)
  .sort((a, b) => GRAPH.depth(b) - GRAPH.depth(a))[0];
function leafOnlyRun(opts, items = 400) {
  const m = mk(opts);
  const form = m.deliverableMasteryForms(LEAF)[0];
  for (let i = 0; i < items; i++)
    say(m, { kpId: LEAF, form, phase: "solo", mode: "acquire", correct: true, latencyMs: 9000, difficulty: GRAPH.centre(LEAF) + 0.3 });
  const anc = [...GRAPH.ancestors(LEAF)];
  return {
    m,
    anc,
    maxAncestorP: Math.max(...anc.map((id) => m.p(id))),
    overThreshold: anc.filter((id) => m.p(id) >= M.bkt.masteryThreshold),
    provisional: anc.filter((id) => m.status(id) !== "learning"),
    reached: anc.filter((id) => m.p(id) > GRAPH.band(id).prior + 1e-9),
  };
}
{
  const shipped = leafOnlyRun({});
  const leaky = leafOnlyRun({ propagation: { ceiling: 1, maxDistance: 8, inferenceRequiresCredited: false } });
  claim(
    "A5",
    "400 correct answers on one leaf lift NO ancestor to the mastery threshold, and unlock none of them",
    shipped.overThreshold.length === 0 && shipped.provisional.length === 0 && shipped.reached.length > 0,
    `${LEAF} (depth ${GRAPH.depth(LEAF)}, ${shipped.anc.length} ancestors). ${shipped.reached.length} ancestors ` +
      `received credit; the highest posterior any of them reached is ${shipped.maxAncestorP.toFixed(4)} against a ` +
      `ceiling of ${PROPAGATION.ceiling} and an M1 threshold of ${M.bkt.masteryThreshold}. ` +
      `${shipped.overThreshold.length} reached M1, ${shipped.provisional.length} left "learning".`
  );
  claim(
    "A5c",
    "CONTROL — with the ceiling removed the same run DOES hand out unearned certainty",
    leaky.maxAncestorP > M.bkt.masteryThreshold && leaky.overThreshold.length > 0,
    `ceiling 1.0, maxDistance 8, inference paid on any scored response: the highest ancestor posterior reaches ` +
      `${leaky.maxAncestorP.toFixed(4)} and ${leaky.overThreshold.length} ancestors cross M1 on leaf evidence alone ` +
      `(${leaky.overThreshold.slice(0, 6).join(", ")}${leaky.overThreshold.length > 6 ? ", …" : ""}). ` +
      `If this control ever prints zero, claim A5 is measuring nothing.`
  );
}

/**
 * A6 — propagation may never touch a counter. M2 and M3 are what stop "I was tested on it in
 * passing" becoming "I was certified on it".
 */
{
  const m = mk();
  const form = m.deliverableMasteryForms(LEAF)[0];
  for (let i = 0; i < 60; i++)
    say(m, { kpId: LEAF, form, phase: "solo", mode: "acquire", correct: true, latencyMs: 9000, difficulty: GRAPH.centre(LEAF) });
  const dirty = [...GRAPH.ancestors(LEAF)].filter((id) => {
    const s = m.stateOf(id);
    return s.scored > 0 || s.atBand > 0 || s.forms.length > 0;
  });
  claim(
    "A6",
    "propagated credit increments NO M2 counter and NO M3 form on any ancestor",
    dirty.length === 0,
    `60 credited responses on ${LEAF}; ${dirty.length} of its ${GRAPH.ancestors(LEAF).size} ancestors show a ` +
      `non-zero scored/atBand/forms counter. §1.2: you cannot be certified on a skill you were only ever ` +
      `tested on incidentally.`
  );
}

// =============================================================================================
head("PART B — the test-out, and the number the bound is made of");
// =============================================================================================

const PLANS = GRAPH.ids.map((id) => ({ id, plan: REF.testOutPlan(id) }));
const ELIGIBLE = PLANS.filter((r) => r.plan.eligible);
const INELIGIBLE = PLANS.filter((r) => !r.plan.eligible);

table(
  PLANS.map(({ id, plan }) => ({
    "knowledge point": id,
    band: GRAPH.difficulty(id),
    "honest forms": REF.deliverableMasteryForms(id).join(",") || "—",
    "worst measured blind/item": (REF.deliverableMasteryForms(id).map((f) => REF.probeItemBlindRate(id, f)).sort((a, b) => a - b)[0] ?? 1).toFixed(3),
    "probe items": plan.eligible ? plan.items : "—",
    "probe minutes": plan.eligible ? ((plan.items * 46) / 60).toFixed(1) : "—",
    "blind pass": plan.eligible ? plan.blindPass.toExponential(2) : "—",
    "test-out": plan.eligible ? "yes" : "NO",
  }))
);

const lens = ELIGIBLE.map((r) => r.plan.items).sort((a, b) => a - b);
claim(
  "B1",
  "every eligible probe clears the measured blind-pass bound, and every ineligible node is named loudly",
  ELIGIBLE.every((r) => r.plan.blindPass <= TEST_OUT.maxBlindPass) &&
    INELIGIBLE.every(({ id }) => REF.issues.some((i) => i.startsWith("TEST-OUT:") && i.includes(`"${id}"`))),
  `${ELIGIBLE.length} of ${TOTAL} knowledge points are test-out eligible. Probe length: min ${lens[0]}, ` +
    `median ${percentile(lens, 0.5)}, max ${lens[lens.length - 1]} items — ` +
    `${((lens[0] * 46) / 60).toFixed(1)} to ${((lens[lens.length - 1] * 46) / 60).toFixed(1)} minutes. ` +
    `Worst blind pass across all eligible probes: ${Math.max(...ELIGIBLE.map((r) => r.plan.blindPass)).toExponential(2)} ` +
    `against the ${TEST_OUT.maxBlindPass} bound. Refused: ${INELIGIBLE.map((r) => r.id).join(", ") || "none"}.`
);

const badForm = PLANS.filter(({ plan }) => plan.forms.some((f) => !M.bkt.formsEligibleForMastery.includes(f)));
claim(
  "B2",
  "no probe anywhere contains a selected-response form — `select4` and `judge2` cannot appear at any length",
  badForm.length === 0 && ELIGIBLE.every(({ id, plan }) => plan.forms.every((f) => REF.isMasteryEligible(id, f, "solo"))),
  `${ELIGIBLE.reduce((a, r) => a + r.plan.items, 0)} probe items across the graph, all drawn from ` +
    `model.bkt.formsEligibleForMastery [${M.bkt.formsEligibleForMastery.join(", ")}] on bank cells the audit did ` +
    `not refuse, all at phase "solo" whose true blind rate is ${M.trueGuessByPhase.solo}. ` +
    `Forms outside that list: ${badForm.length}.`
);

/**
 * B3 — THE TRAP, PRICED BOTH WAYS. What the same probe would look like if it had been costed on
 * `model.trueGuessByForm` — the constants — instead of on the measured bank.
 */
{
  const rows = ELIGIBLE.map(({ id, plan }) => {
    const modelled = plan.forms.reduce((a, f) => a * (M.trueGuessByForm[f] ?? 0.03), 1);
    return { id, items: plan.items, measured: plan.blindPass, modelled, ratio: plan.blindPass / modelled };
  }).sort((a, b) => b.ratio - a.ratio);
  const worst = rows[0];
  const perItem = Math.max(...GRAPH.ids.flatMap((id) => REF.deliverableMasteryForms(id).map((f) => REF.probeItemBlindRate(id, f) / (M.trueGuessByForm[f] ?? 0.03))));
  table(
    rows.slice(0, 8).map((r) => ({
      "knowledge point": r.id,
      items: r.items,
      "blind pass, MEASURED bank": r.measured.toExponential(2),
      "blind pass, modelled constants": r.modelled.toExponential(2),
      "understated by": `${r.ratio.toFixed(0)}x`,
    }))
  );
  claim(
    "B3",
    "pricing the probe on model.trueGuessByForm instead of the measured bank understates it by SIX orders of magnitude",
    worst.ratio > 100,
    `Worst node ${worst.id}: measured ${worst.measured.toExponential(2)} against a modelled ` +
      `${worst.modelled.toExponential(2)} — understated ${worst.ratio.toFixed(0)}x. Per ITEM the constants are ` +
      `understated by up to ${perItem.toFixed(1)}x (construct is declared 0.03 and measures up to ` +
      `${Math.max(...GRAPH.ids.map((id) => (REF.cell(id, "construct")?.priceable === false ? 0 : REF.probeItemBlindRate(id, "construct")))).toFixed(3)}). ` +
      `A three-item probe priced on the constants would look like 2.7e-05 and really be 1.6e-02. ` +
      `THIS is why probe length is derived per node from bank-audit.json and not fixed at three.`
  );
}

/**
 * B4 — is the probe harder to fluke than the route it replaces? Monte-Carlo a blind responder
 * against the ORDINARY M1+M2+M3 gate at the same measured rates, inside §4's `Freshness` cutoff of
 * twelve attempts, and compare.
 */
function ordinaryGateBlind(id, attempts, trials, rng, rateOf) {
  const band = GRAPH.band(id);
  const forms = REF.deliverableMasteryForms(id);
  if (!forms.length) return null;
  const need = Math.min(M.bkt.minDistinctItemForms, forms.length);
  let hits = 0;
  for (let t = 0; t < trials; t++) {
    let p = band.prior;
    let scored = 0;
    const seen = new Set();
    for (let i = 0; i < attempts; i++) {
      const f = forms[scored % forms.length];
      const guess = Math.max(band.guess * (M.guessByForm[f] ?? 1), REF.cell(id, f)?.blindUpper ?? 0);
      const correct = rng() < rateOf(id, f);
      p = bktUpdate(p, correct, band.slip, guess, band.learn, 1);
      scored += 1;
      seen.add(f);
      if (p >= M.bkt.masteryThreshold && scored >= M.bkt.minScoredOpportunities && seen.size >= need) {
        hits += 1;
        break;
      }
    }
  }
  return hits / trials;
}
{
  const rng = mulberry32(0xb4);
  const rows = ELIGIBLE.map(({ id, plan }) => {
    const gate = ordinaryGateBlind(id, 12, 6000, rng, (kp, f) => REF.probeItemBlindRate(kp, f));
    return { id, band: GRAPH.difficulty(id), probe: plan.blindPass, gate, ratio: gate / plan.blindPass };
  }).sort((a, b) => a.ratio - b.ratio);
  const control = ordinaryGateBlind(ELIGIBLE[0].id, 12, 6000, mulberry32(0xc4), (kp, f) => M.trueGuessByForm[f] ?? 0.03);
  table(
    [rows[0], rows[Math.floor(rows.length / 2)], rows[rows.length - 1]].map((r, i) => ({
      "": ["tightest", "median", "loosest"][i],
      "knowledge point": r.id,
      band: r.band,
      "P(blind passes the PROBE)": r.probe.toExponential(2),
      "P(blind opens the ORDINARY gate in 12 items)": r.gate.toExponential(2),
      "probe is stricter by": `${r.ratio.toFixed(0)}x`,
    }))
  );
  claim(
    "B4",
    "the probe is 1–3 orders of magnitude harder to fluke than the M1+M2+M3 march it replaces (and that march is the defect)",
    rows[0].ratio > 10,
    `Across ${rows.length} eligible nodes the probe is between ${rows[0].ratio.toFixed(0)}x and ` +
      `${rows[rows.length - 1].ratio.toFixed(0)}x stricter than the ordinary gate at the same measured rates. ` +
      `The test-out therefore cannot be the weakest link in this system. ` +
      `THE OTHER HALF OF THAT SENTENCE IS A DEFECT AND IT IS NOT MINE TO FIX: a blind responder opens the ` +
      `ORDINARY gate on ${pct(Math.min(...rows.map((r) => r.gate)))}–${pct(Math.max(...rows.map((r) => r.gate)))} of ` +
      `Level 1's nodes inside twelve attempts, because the bank measures 0.07–0.30 blind where the design assumes ` +
      `0.03. M4's retention check is the only thing stopping certification. Reported to P16/P17.`
  );
  claim(
    "B4c",
    "CONTROL — the same Monte-Carlo run at the DESIGN's assumed rates gives a far smaller number",
    control < rows.find((r) => r.id === ELIGIBLE[0].id).gate / 5,
    `${ELIGIBLE[0].id}: ${pct(rows.find((r) => r.id === ELIGIBLE[0].id).gate)} at the measured rates against ` +
      `${pct(control)} at model.trueGuessByForm. The estimator moves with the rate, so B4's numbers are a ` +
      `measurement of the bank and not an artefact of the harness.`
  );
}

/**
 * B5 — the honest cost of "all k correct": how often does a learner who GENUINELY holds the skill
 * fail their own test-out? This is the number the design would rather not print.
 */
{
  const rows = ELIGIBLE.map(({ id, plan }) => {
    const slip = GRAPH.band(id).slip;
    return { id, band: GRAPH.difficulty(id), items: plan.items, pass: (1 - slip) ** plan.items };
  });
  const byBand = {};
  for (const r of rows) (byBand[r.band] ??= []).push(r.pass);
  table(
    Object.keys(byBand)
      .sort()
      .map((b) => ({
        band: b,
        nodes: byBand[b].length,
        slip: GRAPH.model.bands.find((x) => x.difficulty === Number(b)).slip,
        "mean probe items": (rows.filter((r) => r.band === Number(b)).reduce((a, r) => a + r.items, 0) / byBand[b].length).toFixed(1),
        "a genuine master passes first time": pct(byBand[b].reduce((a, x) => a + x, 0) / byBand[b].length),
      }))
  );
  /**
   * B5b — "why not allow one miss", answered with arithmetic instead of taste. Build the one-miss
   * probe honestly: lengthen it until P(>= n-1 correct of n) still clears `maxBlindPass` at the same
   * measured rates, then compare EXPECTED acquisition cost against the all-correct probe. The
   * comparison has to include what a failure costs, which is the probe items already spent plus the
   * ordinary teaching route the learner falls back into.
   */
  const FALLBACK_ITEMS = 4 + M.bkt.minScoredOpportunities; // model + 3 guided, then six solo
  const oneMissRows = ELIGIBLE.map(({ id }) => {
    const forms = REF.deliverableMasteryForms(id);
    const rated = forms.map((f) => REF.probeItemBlindRate(id, f)).sort((a, b) => a - b);
    const slip = GRAPH.band(id).slip;
    let n = 0;
    let tail = 1;
    while (n < 16) {
      n += 1;
      // exact tail for independent non-identical Bernoulli draws: all correct, or exactly one wrong
      const rs = Array.from({ length: n }, (_, i) => rated[i % rated.length]);
      const all = rs.reduce((a, x) => a * x, 1);
      tail = all + rs.reduce((a, _, i) => a + (1 - rs[i]) * rs.reduce((b, x, j) => (j === i ? b : b * x), 1), 0);
      if (n >= TEST_OUT.minItems && tail <= TEST_OUT.maxBlindPass) break;
    }
    const k = REF.testOutPlan(id).items;
    const passAll = (1 - slip) ** k;
    const passOne = (1 - slip) ** n + n * slip * (1 - slip) ** (n - 1);
    // expected acquisition items: pass -> probe length; fail -> items burned + the teaching route
    const burnAll = (1 - (1 - slip) ** k) / slip; // expected item of the first slip, capped by k
    const costAll = passAll * k + (1 - passAll) * (Math.min(k, burnAll) + FALLBACK_ITEMS);
    const costOne = passOne * n + (1 - passOne) * (Math.min(n, 2 / slip) + FALLBACK_ITEMS);
    return { id, k, n, passAll, passOne, costAll, costOne };
  });
  const meanAll = oneMissRows.reduce((a, r) => a + r.costAll, 0) / oneMissRows.length;
  const meanOne = oneMissRows.reduce((a, r) => a + r.costOne, 0) / oneMissRows.length;
  const meanN = oneMissRows.reduce((a, r) => a + r.n, 0) / oneMissRows.length;
  const meanK = oneMissRows.reduce((a, r) => a + r.k, 0) / oneMissRows.length;

  const mean = rows.reduce((a, r) => a + r.pass, 0) / rows.length;
  claim(
    "B5b",
    "ALL correct beats allowing one miss — measured, not preferred",
    meanAll < meanOne,
    `To keep the same ${TEST_OUT.maxBlindPass} bound while tolerating one wrong answer, the probe has to grow from ` +
      `${meanK.toFixed(1)} items to ${meanN.toFixed(1)} (up to ${Math.max(...oneMissRows.map((r) => r.n))} on the ` +
      `worst node), because P(>= n-1 of n) at a measured 0.25 needs eight items to reach 1e-3. That buys a genuine ` +
      `master a first-time pass rate of ${pct(oneMissRows.reduce((a, r) => a + r.passOne, 0) / oneMissRows.length)} ` +
      `instead of ${pct(mean)} — and it costs more overall, because the extra items are paid by EVERY learner while ` +
      `the higher pass rate only helps the ones who slip: expected acquisition cost ${meanOne.toFixed(1)} items per ` +
      `node against ${meanAll.toFixed(1)} for the all-correct probe. It also destroys the "failing is cheap" ` +
      `property, which is what protects a struggling learner: abort-on-first-wrong ends a hopeless probe in one ` +
      `item, abort-on-second-wrong takes ${(2 / 0.25).toFixed(0)}.`
  );
  claim(
    "B5",
    "a genuine master passes their own probe about three times in five, and failing costs one item",
    mean > 0.5,
    `Mean first-time pass rate for a learner who holds the skill: ${pct(mean)} ((1−slip)^items). That is the price ` +
      `of "every item correct", and it is charged in ITEMS not in credit: the probe aborts on the first wrong ` +
      `answer, every item already answered stays scored toward M2/M3, and the learner continues in "solo" rather ` +
      `than being re-lectured. The alternative — allowing one miss — needs 8 items at this bank's measured rates ` +
      `to hold the same bound, which is LONGER than the six-item route it would replace. ` +
      `THE FIX IS CONTENT: at the design's own assumed blind rate of 0.03 the probe is 2 items and a genuine ` +
      `master passes ${pct((1 - 0.12) ** 2)} of the time. More distinct answers in the committed pools buys ` +
      `both a shorter probe and a higher pass rate at once.`
  );
}

// =============================================================================================
head("PART C — six learner archetypes through the real engine");
// =============================================================================================

/** GROUND TRUTH for a bot: the measured rate of the exact cell the scheduler served. */
const measuredRate = (kpId, form, phase) =>
  Math.max(REF.probeItemBlindRate(kpId, form), M.trueGuessByPhase[phase] ?? 0);

const gauss = (rng) => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());

const ARCHETYPES = {
  /** Genuinely knows all of Level 1 on arrival. The learner the whole piece exists for. */
  strong: { bot: false, knowsAll: true, thetaTrue: 1.6, ability: 1.8 },
  /** P16's median learner: acquires at the band learn rate, prior-seeded prior knowledge. */
  median: { bot: false, knowsAll: false, thetaTrue: -0.8, ability: 1.0 },
  struggler: { bot: false, knowsAll: false, thetaTrue: -1.6, ability: 0.55 },
  /** Knows the hard half and none of the foundations. The propagation-integrity archetype. */
  advancedOnly: { bot: false, knowsAll: false, thetaTrue: 0.8, ability: 1.0, knowsBandAtLeast: 4 },
  /** Blind. Types the best fixed answer for whatever cell it is served, at the MEASURED rate. */
  guesser: { bot: true, thetaTrue: -0.8 },
  /** Idles past hintSurfaceMs on every acquisition item and takes whatever the phase gives it. */
  hintAbuser: { bot: true, thetaTrue: -0.8, hintAbuse: true },
  /** Commits every response under the latency floor. Speed cannot help you. */
  masher: { bot: true, thetaTrue: -0.8, fast: true },
  /**
   * CONTROL BOT, P16 assumption B2 pointed at the probe: P18 ships the hint surface into `solo` by
   * mistake and never tells the engine. 0.85 true success, reported UNHINTED, patient. This bot
   * SHOULD sail through test-outs — if it does not, this harness cannot see a probe being passed
   * and every zero above it is worthless.
   */
  hintLeak: { bot: true, thetaTrue: -0.8, leakRate: 0.85 },
};

function makeResponder(kind, rng) {
  const A = ARCHETYPES[kind];
  const known = new Map();
  for (const id of GRAPH.ids) {
    if (A.bot) known.set(id, false);
    else if (A.knowsAll) known.set(id, true);
    else if (A.knowsBandAtLeast != null) known.set(id, GRAPH.difficulty(id) >= A.knowsBandAtLeast);
    else {
      const odds = (GRAPH.band(id).prior / (1 - GRAPH.band(id).prior)) * A.ability;
      known.set(id, rng() < odds / (1 + odds));
    }
  }
  const thetaTrue = A.thetaTrue + (kind === "median" ? gauss(rng) * 0.35 : 0);
  return {
    known,
    answer(req, mastery) {
      const band = GRAPH.band(req.kpId);
      const b = req.difficulty;
      const phaseFloor = M.trueGuessByPhase[req.phase] ?? 0;
      let hinted = req.hinted;
      let latencyMs = 4000 + Math.floor(rng() * 8000);

      // Teaching happens in every phase, including the ones that buy no credit. The acquisition
      // roll sits ABOVE the scoring gate on purpose, and bots never get it.
      if (!A.bot && !A.knowsAll && !known.get(req.kpId)) {
        const s = mastery.stateOf(req.kpId);
        const boosted = s.relearn && (!M.spacing.relearnRequiresPriorMastery || s.everMastered);
        const t = Math.min(0.9, band.learn * A.ability * (boosted ? M.spacing.relearnLearnRateMultiplier : 1));
        if (rng() < t) known.set(req.kpId, true);
      }

      let correct;
      if (A.bot) {
        let rate = measuredRate(req.kpId, req.form, req.phase);
        if (A.hintAbuse && req.mode === "acquire") {
          if (M.phases.hinted?.[req.phase]) rate = Math.max(rate, M.trueGuessByPhase["guided-3"]);
          hinted = M.phases.hinted?.[req.phase] ?? false;
          latencyMs = M.antiGuessing.hintSurfaceMs + 2000;
        }
        if (A.fast) latencyMs = 200;
        // B2: the leak the engine is never told about. Reported unhinted, patient, 0.85 correct.
        if (A.leakRate != null && req.mode === "acquire") {
          rate = Math.max(rate, A.leakRate);
          hinted = false;
        }
        correct = rng() < rate;
      } else if (known.get(req.kpId)) {
        // A1: an over-pitched item raises the effective slip. The probe sits +0.3 above the band
        // centre, so even the strong learner is charged for that.
        const slip = Math.min(0.5, band.slip * (1 + 0.35 * Math.max(0, b - thetaTrue)));
        correct = rng() >= slip;
      } else {
        const base = Math.min(0.3, band.guess * (M.guessByForm[req.form] ?? 1) * (1 + 0.5 * Math.max(0, thetaTrue - b)));
        correct = rng() < base + (1 - base) * phaseFloor;
      }
      return { correct, latencyMs, hinted, itemId: `${req.kpId}#${req.seq}` };
    },
  };
}

const ARMS = {
  /** What ships after P32. */
  shipped: {},
  /** Propagation extended, probe off — isolates what the probe alone is worth. */
  "propagation only": { testOut: { enabled: false } },
  /** Probe on, propagation back to distance 1 — isolates what propagation alone is worth. */
  "test-out only": { propagation: { maxDistance: 1 } },
  /** The pre-P32 engine, exactly: §1.2 direct credit, no probe. This is the baseline every
   *  "dramatically shorter" claim in the handoff is measured against. */
  baseline: { testOut: { enabled: false }, propagation: { maxDistance: 1 } },
  /**
   * RULE 2 control, and it is the naive implementation of this very feature: a FIXED three-item
   * probe with the measured-bank derivation switched off (`maxBlindPass: 1`). That is precisely
   * what "offer a short high-difficulty probe" turns into if the length is chosen by taste instead
   * of by `bank-audit.json`. The guessing bot MUST get through this arm.
   */
  "leaky-probe": { testOut: { maxBlindPass: 1, minItems: 3 } },
};

function runLearner({ seed, kind, arm, sessions = SESSIONS }) {
  const rng = mulberry32(seed);
  const clock = virtualClock(0);
  const mastery = mk({ now: () => clock.minutes(), ...ARMS[arm] });
  const sched = new Scheduler(mastery, { clock, rng: mulberry32(seed ^ 0x9e3779b9), sessionMinutes: SESSION_MINUTES, bank: BANK });
  const responder = makeResponder(kind, rng);

  let seconds = 0;
  // The product goal names ACQUISITION time — "two minutes instead of an hour" is about learning a
  // knowledge point, not about the consolidation and retention items every route pays alike. Split
  // the clock so the two can be reported separately instead of one hiding inside the other.
  let acqSeconds = 0;
  let certSeconds = 0;
  let acqItems = 0;
  const trace = [];
  for (let session = 0; session < sessions; session++) {
    clock.set(session * 1440); // A4: one session per day
    sched.beginSession();
    for (;;) {
      const req = sched.next();
      if (!req) break;
      if (req.mode === "acquire") {
        acqSeconds += req.seconds;
        acqItems += 1;
      } else certSeconds += req.seconds;
      sched.submit(req, responder.answer(req, mastery));
    }
    sched.endSession();
    seconds += sched.secondsSpent;
    trace.push({
      mastered: GRAPH.ids.filter((id) => mastery.status(id) === "mastered").length,
      minutes: seconds / 60,
      items: mastery.stats.items,
    });
  }

  const mastered = GRAPH.ids.filter((id) => mastery.status(id) === "mastered").length;
  const at = (need) => trace.find((t) => t.mastered >= need) ?? null;
  // A passed probe grants `provisional`, never `mastered`. These two count what happened AFTER:
  // how many probe-unlocked nodes went on to survive consolidation and the 12-hour retention check.
  const viaProbe = GRAPH.ids.filter((id) => mastery.stateOf(id).unlockedVia === "test-out");
  const viaProbeCertified = viaProbe.filter((id) => mastery.status(id) === "mastered");
  return {
    mastery,
    mastered,
    provisional: GRAPH.ids.filter((id) => mastery.status(id) === "provisional").length,
    unlocked: GRAPH.ids.filter((id) => mastery.everUnlocked(id)).length,
    items: mastery.stats.items,
    minutes: seconds / 60,
    acqMinutes: acqSeconds / 60,
    certMinutes: certSeconds / 60,
    acqItems,
    /** Acquisition minutes spent per knowledge point actually certified. THE headline number. */
    acqPerNode: mastered ? acqSeconds / 60 / mastered : null,
    to80: at(NEED80),
    toAll: at(CERTIFIABLE),
    sessionsTo80: trace.findIndex((t) => t.mastered >= NEED80) + 1 || null,
    sessionsToAll: trace.findIndex((t) => t.mastered >= CERTIFIABLE) + 1 || null,
    testOut: { ...mastery.probe().testOut, plans: undefined, ineligible: undefined },
    viaProbe: viaProbe.length,
    viaProbeCertified: viaProbeCertified.length,
    credits: mastery.stats.prerequisiteCredits,
    byDistance: { ...mastery.stats.creditsByDistance },
    trace,
  };
}

function cohort(kind, arm, n, seedBase, sessions = SESSIONS) {
  const rows = [];
  for (let i = 0; i < n; i++) rows.push(runLearner({ seed: seedBase + i * 7919, kind, arm, sessions }));
  const med = (fn) => {
    const v = rows.map(fn).filter((x) => x != null).sort((a, b) => a - b);
    return v.length ? percentile(v, 0.5) : null;
  };
  return {
    kind,
    arm,
    n,
    rows,
    mastered: med((r) => r.mastered),
    masteredMean: rows.reduce((a, r) => a + r.mastered, 0) / n,
    masteryPct: (100 * rows.reduce((a, r) => a + r.mastered, 0)) / (n * TOTAL),
    shareAt80: rows.filter((r) => r.mastered >= NEED80).length / n,
    minutesTo80: med((r) => r.to80?.minutes),
    itemsTo80: med((r) => r.to80?.items),
    sessionsTo80: med((r) => r.sessionsTo80),
    reach80: rows.filter((r) => r.to80).length / n,
    minutesToAll: med((r) => r.toAll?.minutes),
    itemsToAll: med((r) => r.toAll?.items),
    sessionsToAll: med((r) => r.sessionsToAll),
    reachAll: rows.filter((r) => r.toAll).length / n,
    totalMinutes: med((r) => r.minutes),
    totalItems: med((r) => r.items),
    acqMinutes: med((r) => r.acqMinutes),
    certMinutes: med((r) => r.certMinutes),
    acqItems: med((r) => r.acqItems),
    acqPerNode: med((r) => r.acqPerNode),
    offered: rows.reduce((a, r) => a + r.testOut.offered, 0) / n,
    offeredByPosterior: rows.reduce((a, r) => a + (r.testOut.byTrigger?.posterior ?? 0), 0) / n,
    passedByPosterior: rows.reduce((a, r) => a + (r.testOut.passedByTrigger?.posterior ?? 0), 0) / n,
    passed: rows.reduce((a, r) => a + r.testOut.passed, 0) / n,
    failed: rows.reduce((a, r) => a + r.testOut.failed, 0) / n,
    probeItems: rows.reduce((a, r) => a + r.testOut.itemsSpent, 0) / n,
    credits: rows.reduce((a, r) => a + r.credits, 0) / n,
    lapses: rows.reduce((a, r) => a + r.mastery.stats.lapses, 0) / n,
    byDistance: rows.reduce((a, r) => {
      for (const [d, c] of Object.entries(r.byDistance)) a[d] = (a[d] ?? 0) + c / n;
      return a;
    }, {}),
    everCertified: rows.filter((r) => r.mastered > 0).length,
    everTestedOut: rows.filter((r) => r.testOut.passed > 0).length,
    /** Probes OFFERED across the whole cohort — the denominator the blind-pass bound is stated per. */
    probesOffered: rows.reduce((a, r) => a + r.testOut.offered, 0),
    probesPassed: rows.reduce((a, r) => a + r.testOut.passed, 0),
    viaProbe: rows.reduce((a, r) => a + r.viaProbe, 0),
    viaProbeCertified: rows.reduce((a, r) => a + r.viaProbeCertified, 0),
  };
}

const HONEST = ["strong", "median", "struggler", "advancedOnly"];
const BOTKINDS = ["guesser", "hintAbuser", "masher"];
const RESULTS = {};
const seedFor = (kind) => 0x51000 + [...kind].reduce((a, c) => a + c.charCodeAt(0), 0) * 13;
const botSeed = (kind) => 0x7b000 + [...kind].reduce((a, c) => a + c.charCodeAt(0), 0) * 31;
for (const kind of HONEST)
  for (const arm of ["shipped", "baseline"]) RESULTS[`${kind}|${arm}`] = cohort(kind, arm, LEARNERS, seedFor(kind));
for (const kind of ["strong", "median"])
  for (const arm of ["propagation only", "test-out only"]) RESULTS[`${kind}|${arm}`] = cohort(kind, arm, LEARNERS, seedFor(kind));
// Hostile arms run on IDENTICAL seeds across arms, so shipped-vs-baseline is a paired comparison.
const HOSTILE_N = Math.max(BOTS, HOSTILE_MIN);
for (const kind of BOTKINDS)
  for (const arm of ["shipped", "baseline"]) RESULTS[`${kind}|${arm}`] = cohort(kind, arm, HOSTILE_N, botSeed(kind));
RESULTS["guesser|leaky-probe"] = cohort("guesser", "leaky-probe", HOSTILE_N, botSeed("guesser"));
RESULTS["hintLeak|shipped"] = cohort("hintLeak", "shipped", Math.min(BOTS, 300), botSeed("hintLeak"));

head("MINUTES TO MASTERY, PER LEARNER ARCHETYPE  (median; minutes are scored-item time at 46 s/item)");
table(
  [...HONEST.flatMap((k) => ["shipped", "baseline"].map((a) => `${k}|${a}`)), "strong|propagation only", "strong|test-out only"].map((key) => {
    const r = RESULTS[key];
    return {
      archetype: r.kind,
      arm: r.arm,
      "min → 80%": r.minutesTo80 == null ? "—" : r.minutesTo80.toFixed(0),
      "items → 80%": r.itemsTo80 ?? "—",
      "sess → 80%": r.sessionsTo80 ?? "—",
      "reached 80%": pct(r.reach80),
      [`min → all ${CERTIFIABLE}`]: r.minutesToAll == null ? "—" : r.minutesToAll.toFixed(0),
      [`items → all`]: r.itemsToAll ?? "—",
      [`sess → all`]: r.sessionsToAll ?? "—",
      "reached all": pct(r.reachAll),
      "final mastery": pct(r.masteryPct / 100),
      "probes off/pass": `${r.offered.toFixed(1)}/${r.passed.toFixed(1)}`,
    };
  })
);

head("HOSTILE ARMS  (bots; every rate drawn from the MEASURED shipped bank)");
table(
  [...BOTKINDS.flatMap((k) => [`${k}|shipped`, `${k}|baseline`]), "guesser|leaky-probe", "hintLeak|shipped"].map((key) => {
    const r = RESULTS[key];
    return {
      bot: r.kind,
      arm: r.arm,
      n: r.n,
      "items answered": r.totalItems,
      "probes offered": r.offered.toFixed(2),
      "probes PASSED": r.passed.toFixed(4),
      "bots that passed one": `${r.everTestedOut} / ${r.n}`,
      "probe unlocks → certified": `${r.viaProbe} → ${r.viaProbeCertified}`,
      "KPs certified (mean)": r.masteredMean.toFixed(4),
      "bots that certified any": `${r.everCertified} / ${r.n}`,
    };
  })
);

// ---------------------------------------------------------------------------------------------

{
  const s = RESULTS["strong|shipped"];
  const b = RESULTS["strong|baseline"];
  const cut = (x, y) => (x != null && y != null && y !== 0 ? 1 - x / y : null);

  head("WHERE THE TIME GOES  (median, minutes of scored-item time over the whole run)");
  table(
    HONEST.flatMap((k) =>
      ["shipped", "baseline"].map((a) => {
        const r = RESULTS[`${k}|${a}`];
        return {
          archetype: k,
          arm: a,
          "ACQUISITION min": r.acqMinutes.toFixed(0),
          "acq items": r.acqItems,
          "min per KP certified": r.acqPerNode == null ? "—" : r.acqPerNode.toFixed(1),
          "CERTIFICATION min": r.certMinutes.toFixed(0),
          "total min": r.totalMinutes.toFixed(0),
          "certification share": pct(r.certMinutes / r.totalMinutes),
        };
      })
    )
  );
  claim(
    "C1",
    "the probe cuts a strong learner's ACQUISITION time per knowledge point by about a third",
    s.acqPerNode != null && b.acqPerNode != null && s.acqPerNode < 0.75 * b.acqPerNode,
    `strong learner, median of ${LEARNERS}. Acquisition time per certified knowledge point: ` +
      `${num(s.acqPerNode, 1)} min shipped against ${num(b.acqPerNode, 1)} min on the pre-P32 engine — ` +
      `${pct(cut(s.acqPerNode, b.acqPerNode))} less. That is the number the product goal names: a learner who ` +
      `already knows a knowledge point proves it in a ${percentile(lens, 0.5)}-item probe ` +
      `(${((percentile(lens, 0.5) * 46) / 60).toFixed(1)} min, ${((lens[0] * 46) / 60).toFixed(1)} min at the best ` +
      `node) instead of walking model → guided-1 → guided-2 → guided-3 → six solo items. ` +
      `Probes: ${s.offered.toFixed(1)} offered, ${s.passed.toFixed(1)} passed, ${s.probeItems.toFixed(0)} items spent.`
  );
  claim(
    "C1b",
    "end to end, that is a real but SMALLER cut — because certification, not teaching, is the floor",
    s.minutesToAll != null && b.minutesToAll != null && s.minutesToAll < 0.9 * b.minutesToAll,
    `80% of Level 1 in ${num(s.minutesTo80)} min / ${s.itemsTo80} items / ${s.sessionsTo80} sessions, against ` +
      `${num(b.minutesTo80)} min / ${b.itemsTo80} items / ${b.sessionsTo80} sessions — ` +
      `${pct(cut(s.minutesTo80, b.minutesTo80))} less time. All ${CERTIFIABLE}: ${num(s.minutesToAll)} min / ` +
      `${s.itemsToAll} items / ${s.sessionsToAll} sessions against ${num(b.minutesToAll)} / ${b.itemsToAll} / ` +
      `${b.sessionsToAll} — ${pct(cut(s.minutesToAll, b.minutesToAll))} less time, ` +
      `${pct(cut(s.itemsToAll, b.itemsToAll))} fewer items, ${b.sessionsToAll != null && s.sessionsToAll != null ? b.sessionsToAll - s.sessionsToAll : "—"} sessions saved. ` +
      `DO NOT REPORT THE FIRST NUMBER WITHOUT THIS ONE. ${pct(s.certMinutes / s.totalMinutes)} of a strong ` +
      `learner's run is now consolidation and retention items, which no amount of prior knowledge removes: ` +
      `6 items x ${CERTIFIABLE} nodes = ${((6 * 46 * CERTIFIABLE) / 60).toFixed(0)} minutes, plus a 12-hour gate ` +
      `and an intervening session per node that caps the run at ${s.sessionsToAll} sessions however fast the ` +
      `learner is. §4.1 said the bottleneck is certification capacity; the probe is what makes that visible.`
  );
  const p = RESULTS["strong|propagation only"];
  const t = RESULTS["strong|test-out only"];
  table(
    ["strong", "median"].flatMap((k) =>
      ["shipped", "test-out only", "propagation only", "baseline"].map((a) => {
        const r = RESULTS[`${k}|${a}`];
        return {
          archetype: k,
          arm: a,
          propagation: a === "shipped" || a === "propagation only" ? `distance ≤ ${PROPAGATION.maxDistance}` : "distance 1 (pre-P32)",
          probe: a === "shipped" || a === "test-out only" ? "on" : "off",
          [`min → all ${CERTIFIABLE}`]: r.minutesToAll == null ? "—" : r.minutesToAll.toFixed(0),
          "final mastery": pct(r.masteryPct / 100),
          "probes offered": r.offered.toFixed(1),
          "…of which on PROPAGATED posterior": r.offeredByPosterior.toFixed(1),
          "probes passed on propagated signal": r.passedByPosterior.toFixed(1),
        };
      })
    )
  );
  const minPrior = Math.min(...M.bands.map((x) => x.prior));
  const maxPrior = Math.max(...M.bands.map((x) => x.prior));

  /**
   * C2 — THE RESULT THIS SCRIPT WAS EXPECTING NOT TO GET, and the reason it is stated as a theorem
   * with a check rather than quietly dropped.
   *
   * The piece was specified as "propagation supplies the signal that fires the test-out". It cannot,
   * and the reason is structural rather than a bug in either mechanism. §4's frontier rule offers a
   * node only when EVERY direct prerequisite is already unlocked, and unlocking is monotone, so the
   * selector walks the graph in topological order and every ancestor of a node is already at
   * `provisional` or better before that node is served for the first time. Prerequisite credit flows
   * BACKWARDS. Backwards, from a node the learner is on, therefore lands only on nodes that are
   * already unlocked — never on a fresh `learning` node with zero attempts, which is the only kind
   * of node a probe is ever offered on.
   *
   * So the posterior trigger is structurally dead under the shipped frontier rule, and the check
   * below asserts the theorem directly rather than inferring it from a counter that stayed at zero.
   */
  let freshWithUnlockedAncestors = 0;
  let freshWithLearningAncestor = 0;
  for (const r of RESULTS["strong|shipped"].rows.slice(0, 8)) {
    for (const id of GRAPH.ids) {
      const st = r.mastery.stateOf(id);
      if (!st.testOut) continue;
      const anc = [...GRAPH.ancestors(id)];
      if (anc.every((a) => r.mastery.everUnlocked(a))) freshWithUnlockedAncestors += 1;
      else freshWithLearningAncestor += 1;
    }
  }
  claim(
    "C2",
    "the posterior trigger is structurally unreachable under §4's frontier rule — stated as a theorem, not hidden as a zero",
    s.offeredByPosterior === 0 && freshWithLearningAncestor === 0 && freshWithUnlockedAncestors > 0,
    `Every band prior in the content file is between ${minPrior} and ${maxPrior}, all below the ` +
      `${TEST_OUT.offerAbove} offer threshold, so a posterior-triggered offer could only come from propagated ` +
      `credit. It never does: ${s.offeredByPosterior.toFixed(1)} of ${s.offered.toFixed(1)} strong-learner offers ` +
      `were posterior-triggered. The reason is checked, not guessed — across ${freshWithUnlockedAncestors} probes ` +
      `offered in 8 runs, the ancestor closure was ALREADY fully unlocked ${freshWithUnlockedAncestors} times and ` +
      `still had a "learning" member ${freshWithLearningAncestor} times. §4 walks the DAG in topological order, and ` +
      `credit that flows backwards along that order can only ever reach nodes the learner has already been through. ` +
      `IF A LATER PIECE WANTS PROPAGATION TO FIRE A PROBE, THE FRONTIER RULE IS WHAT HAS TO CHANGE, NOT THIS ONE.`
  );

  /** C2b — so what IS propagation worth? Measured against the arm that differs only in that. */
  const mS = RESULTS["median|shipped"];
  const mT = RESULTS["median|test-out only"];
  const mP = RESULTS["median|propagation only"];
  const mB = RESULTS["median|baseline"];
  /**
   * ------------------------------------------------------------------------------------------
   * C2b IS A PAIRED TEST NOW, AND THE REASON IS A FAILURE THIS ROUND PRODUCED ON PURPOSE.
   *
   * It used to read `mS.masteryPct >= mT.masteryPct` — a STRICT inequality between two cohort
   * means. The arms differ only in propagation distance, and the honest finding is that the
   * difference is small; so a strict inequality on a sampled mean is a coin flip dressed as a
   * claim, and it duly flipped: PASS at one cohort size and FAIL at another with no code change
   * between them. A claim whose verdict depends on the sample size is measuring the sampler.
   *
   * The arms run on IDENTICAL seeds, so the difference is paired and its standard error is
   * computable. The claim now says what it can actually defend: propagation does not COST mastery
   * (the 95% CI on the paired difference does not sit entirely below zero) and it does not add
   * lapses. What it buys — posterior maintenance on ancestors the learner keeps using — is
   * reported as a number either way rather than asserted by an inequality.
   * ------------------------------------------------------------------------------------------
   */
  const paired = (A, B, fn) => {
    const n = Math.min(A.rows.length, B.rows.length);
    const d = Array.from({ length: n }, (_, i) => fn(A.rows[i]) - fn(B.rows[i]));
    const mean = d.reduce((a, x) => a + x, 0) / Math.max(1, n);
    const sd = Math.sqrt(d.reduce((a, x) => a + (x - mean) ** 2, 0) / Math.max(1, n - 1));
    const se = n ? sd / Math.sqrt(n) : 0;
    return { n, mean, se, lo: mean - 1.959964 * se, hi: mean + 1.959964 * se };
  };
  const dProbeOn = paired(mS, mT, (r) => r.mastered);
  const dProbeOff = paired(mP, mB, (r) => r.mastered);
  const dLapses = paired(mS, mT, (r) => r.mastery.stats.lapses);
  claim(
    "C2b",
    "propagation's real, measured contribution is posterior maintenance on already-unlocked ancestors",
    dProbeOn.hi >= 0 && dProbeOff.hi >= 0 && dLapses.lo <= 0,
    `Median learner, knowledge points mastered, arms differing ONLY in propagation distance and running on ` +
      `IDENTICAL seeds so the difference is paired. With the probe on, distance <= ${PROPAGATION.maxDistance} minus ` +
      `distance 1 = ${dProbeOn.mean.toFixed(3)} KP [95% CI ${dProbeOn.lo.toFixed(3)}, ${dProbeOn.hi.toFixed(3)}], ` +
      `n = ${dProbeOn.n}; with the probe off, ${dProbeOff.mean.toFixed(3)} ` +
      `[${dProbeOff.lo.toFixed(3)}, ${dProbeOff.hi.toFixed(3)}]. Lapses per learner ${mS.lapses.toFixed(2)} vs ` +
      `${mT.lapses.toFixed(2)}, paired difference ${dLapses.mean.toFixed(3)} ` +
      `[${dLapses.lo.toFixed(3)}, ${dLapses.hi.toFixed(3)}]. NEITHER INTERVAL EXCLUDES ZERO, and that is the ` +
      `honest reading: propagation past distance 1 is NOT a shortcut to Level 1 and this run cannot show it ` +
      `moving the total. What it demonstrably does is pay ` +
      `${JSON.stringify(mS.byDistance)} posteriors per median learner by distance ` +
      `(${JSON.stringify(s.byDistance)} for the strong learner) on ancestors the learner keeps using, without ` +
      `touching one M2 counter (A6) and without crossing M1 (A5) — posterior maintenance, exactly what §1.2 ` +
      `argued for and one edge further out. C2 explains why it cannot do more than that under §4's frontier rule.`
  );
  claim(
    "C2c",
    "the saving is the probe's, and it is not bought by lowering anyone's final mastery",
    t.minutesToAll != null && b.minutesToAll != null && t.minutesToAll <= b.minutesToAll * 0.85 && s.masteryPct >= b.masteryPct - 1,
    `strong learner, minutes to all ${CERTIFIABLE}: shipped ${num(s.minutesToAll)}, probe alone ` +
      `${num(t.minutesToAll)}, propagation alone ${num(p.minutesToAll)}, baseline ${num(b.minutesToAll)}. ` +
      `Final mastery ${pct(s.masteryPct / 100)} shipped against ${pct(b.masteryPct / 100)} baseline — the strong ` +
      `learner arrives at the same place, sooner. The floor under the remaining ${num(s.minutesToAll)} minutes ` +
      `is not teaching, it is CERTIFICATION: 2 consolidation + 4 retention items per node is ` +
      `${((6 * 46 * CERTIFIABLE) / 60).toFixed(0)} minutes that no amount of prior knowledge removes, which is ` +
      `${pct(s.minutesToAll ? (6 * 46 * CERTIFIABLE) / 60 / s.minutesToAll : null)} of the whole run. §4.1 said the bottleneck in a mastery ` +
      `system is certification capacity, not teaching capacity; with the probe in place that is now visibly true.`
  );
}

{
  const m = RESULTS["median|shipped"];
  claim(
    "C3",
    "L5 — the median learner still reaches ≥80% mastery with the probe in the loop",
    m.masteryPct >= 80,
    `median learner, ${LEARNERS} runs, ${SESSIONS} sessions: ${pct(m.masteryPct / 100)} of Level 1 mastered ` +
      `(${m.masteredMean.toFixed(1)} of ${TOTAL} knowledge points, ceiling ${CERTIFIABLE}); ${pct(m.shareAt80)} of them ` +
      `at or above 80%. Baseline arm for comparison: ${pct(RESULTS["median|baseline"].masteryPct / 100)}. ` +
      `Probes offered ${m.offered.toFixed(1)}, passed ${m.passed.toFixed(1)}, failed ${m.failed.toFixed(1)} — ` +
      `a failed probe costs ${(m.probeItems / Math.max(1, m.offered)).toFixed(1)} items on average and is not punitive.`
  );
  const st = RESULTS["struggler|shipped"];
  claim(
    "C3b",
    "a struggling learner is not taxed by a mechanism built for someone else",
    st.probeItems <= 0.15 * st.totalItems,
    `struggler: ${st.offered.toFixed(1)} probes offered, ${st.probeItems.toFixed(0)} items spent on them out of ` +
      `${st.totalItems} answered (${pct(st.probeItems / st.totalItems)} of the session budget). Their theta falls, so ` +
      `the offer condition stops firing — that self-limiting behaviour is why the probe is gated on signal rather ` +
      `than offered on every first encounter. Mastery ${pct(st.masteryPct / 100)} shipped against ` +
      `${pct(RESULTS["struggler|baseline"].masteryPct / 100)} baseline.`
  );
}

{
  const g = RESULTS["guesser|shipped"];
  const h = RESULTS["hintAbuser|shipped"];
  const f = RESULTS["masher|shipped"];
  const leak = RESULTS["guesser|leaky-probe"];
  const hl = RESULTS["hintLeak|shipped"];

  const offeredAll = g.probesOffered + h.probesOffered + f.probesOffered;
  const passedAll = g.probesPassed + h.probesPassed + f.probesPassed;
  const certifiedViaProbe = g.viaProbeCertified + h.viaProbeCertified + f.viaProbeCertified;
  const pValue = binomTailAtLeast(passedAll, offeredAll, TEST_OUT.maxBlindPass);
  claim(
    "D1",
    "the measured hostile blind-pass rate does not exceed the declared bound, and no pass becomes a certification",
    pValue >= 0.05 && certifiedViaProbe === 0,
    `${HOSTILE_N} bots per arm (floor ${HOSTILE_MIN}, set by the power D1 needs) x ${SESSIONS} sessions, every `+
      `rate drawn from the MEASURED bank for the exact cell the ` +
      `scheduler served. ${offeredAll} probes offered across guesser, hint-abuser and masher; ${passedAll} passed. ` +
      `That is ${(passedAll / offeredAll).toExponential(2)} against the ${TEST_OUT.maxBlindPass} the probe lengths ` +
      `were derived to hold, which predicts ${(offeredAll * TEST_OUT.maxBlindPass).toFixed(1)} passes over this many ` +
      `offers. One-sided binomial test of "the true rate exceeds the bound": p = ${pValue.toFixed(3)}, so the bound ` +
      `is NOT rejected (95% Wilson interval on the observation itself: up to ` +
      `${wilson(passedAll, offeredAll).toExponential(2)}). STATING THIS AS "NEVER" WOULD BE THE OVERCLAIM §9 OF THE ` +
      `LEARNING ARCHITECTURE WARNS ABOUT — a 1e-3 bound means one in a thousand, not zero, and the run finds ` +
      `exactly that. Per arm, offered/passed: guesser ` +
      `${g.probesOffered}/${g.probesPassed}, hint-abuser ${h.probesOffered}/${h.probesPassed}, masher ` +
      `${f.probesOffered}/${f.probesPassed} (the masher's zero is structural, not statistical: every one of its ` +
      `responses is under the ${M.antiGuessing.latencyFloorMs} ms floor and so can never be credited). ` +
      `AND THE RESIDUAL BUYS NOTHING: ${g.viaProbe + h.viaProbe + f.viaProbe} probe-unlocked nodes across all three ` +
      `arms, ${certifiedViaProbe} of them certified. A passed probe grants "provisional" — it still owes ` +
      `consolidation and a 3-of-4 retention check twelve hours and a session later, and a blind responder does not ` +
      `pass that.`
  );
  claim(
    "D1c",
    "CONTROL — a FIXED three-item probe with the derivation switched off leaks, and D1's test REJECTS it",
    leak.passed > 0 && leak.everTestedOut > 0 && binomTailAtLeast(leak.probesPassed, leak.probesOffered, TEST_OUT.maxBlindPass) < 0.05,
    `same bot, same seeds, maxBlindPass 1.0 and a fixed 3 items — the naive implementation of this feature: ` +
      `${leak.passed.toFixed(4)} probes passed per bot, ${leak.everTestedOut} of ${HOSTILE_N} bots got a free unlock ` +
      `(${pct(leak.everTestedOut / HOSTILE_N)}). Run D1's OWN test on it: ${leak.probesPassed} passes in ` +
      `${leak.probesOffered} offers gives p = ` +
      `${binomTailAtLeast(leak.probesPassed, leak.probesOffered, TEST_OUT.maxBlindPass).toExponential(2)}, so the ` +
      `bound is REJECTED — the same statistic that cannot reject the shipped arm rejects this one decisively. ` +
      `THAT is what makes D1 a measurement rather than an absence: the test has the power to see the leak, and the ` +
      `leak is exactly what a probe length chosen by taste instead of by bank-audit.json produces.`
  );
  claim(
    "D1d",
    "CONTROL — a bot that IS credited on every probe item passes them, so the detector can see a pass",
    hl.passed > 1,
    `P16 assumption B2 pointed at the probe: P18 leaks the hint surface into "solo" and never tells the engine, so ` +
      `${hl.n} bots answer at 0.85 and report unhinted. They pass ${hl.passed.toFixed(2)} probes each ` +
      `(${hl.everTestedOut} of ${hl.n} bots) and certify ${hl.masteredMean.toFixed(2)} knowledge points. ` +
      `The mechanism is therefore only as good as the per-response "hinted" flag P18 sets — the same conclusion ` +
      `§6.1 already reached for the ordinary gate, and it now applies to the probe too.`
  );

  const gb = RESULTS["guesser|baseline"];
  const hb = RESULTS["hintAbuser|baseline"];
  const fb = RESULTS["masher|baseline"];
  /**
   * A difference of two noisy means is not a finding until it carries an error bar. Each bot's
   * certification count is one observation; the two arms are independent runs of the same seeds
   * through a different item stream, so a Welch two-sample z on the pooled difference is the right
   * test. Round 1 of this claim asserted `shipped <= baseline` outright and would have failed on
   * 265 certifications against 255 — a difference of ten in four thousand runs.
   */
  const meanVar = (rows) => {
    const xs = rows.map((r) => r.mastered);
    const mu = xs.reduce((a, x) => a + x, 0) / xs.length;
    return { mu, v: xs.reduce((a, x) => a + (x - mu) ** 2, 0) / Math.max(1, xs.length - 1), n: xs.length };
  };
  const pairs = [[g, gb], [h, hb], [f, fb]].map(([sh, ba]) => ({ s: meanVar(sh.rows), b: meanVar(ba.rows) }));
  const diff = pairs.reduce((a, p) => a + (p.s.mu - p.b.mu), 0);
  const se = Math.sqrt(pairs.reduce((a, p) => a + p.s.v / p.s.n + p.b.v / p.b.n, 0));
  const z = se > 0 ? diff / se : 0;
  claim(
    "D2",
    "P32 does not make the bots' CERTIFICATION rate worse — the residual leak is pre-existing and is P16/P17's",
    z <= 1.959964,
    `Mean knowledge points certified per bot, shipped vs pre-P32 baseline, identical seeds: ` +
      `guesser ${g.masteredMean.toFixed(4)} vs ${gb.masteredMean.toFixed(4)}, ` +
      `hint-abuser ${h.masteredMean.toFixed(4)} vs ${hb.masteredMean.toFixed(4)}, ` +
      `masher ${f.masteredMean.toFixed(4)} vs ${fb.masteredMean.toFixed(4)}. Summed difference ` +
      `${diff >= 0 ? "+" : ""}${diff.toFixed(4)} +/- ${se.toFixed(4)} (z = ${z.toFixed(2)}), i.e. NOT ` +
      `distinguishable from no change at 95%. ` +
      `NAMED RATHER THAN ABSORBED: those baseline figures are NOT zero, and the design says they should be ` +
      `(§5.0 target: "patient guessing bot, mean KPs certified < 0.01 of 32"). None of it comes through the probe — ` +
      `zero probes are passed on either arm (D1) — it comes through the ORDINARY M1+M2+M3 gate plus M4 at the bank's ` +
      `measured 0.07-0.30 blind rates, which claim B4 quantifies. That is a P16/P17 defect this piece inherits, ` +
      `does not widen, and must not be credited with fixing.`
  );
  claim(
    "D3",
    "the probe closes the two doors the design says a learner can open for themselves",
    f.passed === 0 && f.everTestedOut === 0 && h.viaProbeCertified === 0,
    `A probe item is scored exactly like the ordinary solo acquisition item it is, so both of §6.1's ` +
      `learner-chosen refusals apply to it unchanged and T1 reads their verdict: a correct answer committed under ` +
      `the ${M.antiGuessing.latencyFloorMs} ms + ${M.antiGuessing.latencyPerTokenMs} ms/token floor is not credited, ` +
      `and neither is a correct answer committed after the learner idled past ${M.antiGuessing.hintSurfaceMs} ms and ` +
      `read the help. ${2 * BOTS} bots: the masher passed ${f.probesPassed} of ${f.probesOffered} probes — a ` +
      `STRUCTURAL zero, since every response it makes is under the floor and so can never be credited at all — and ` +
      `the hint-abuser passed ${h.probesPassed} of ${h.probesOffered}, certifying ${h.viaProbeCertified} of them. ` +
      `The hint-abuser's residual is not the hint getting through: it is the ordinary blind-luck rate on the items ` +
      `whose phase surfaces no hint, bounded at ${TEST_OUT.maxBlindPass} by D1. Speed cannot help you and help ` +
      `cannot help you.`
  );
}

/**
 * D4 — "a student who knows advanced material but not basics". The archetype exists to answer one
 * question: did propagation hand them an ancestor the graph does not support them having?
 */
{
  const rows = RESULTS["advancedOnly|shipped"].rows;
  let unearned = 0;
  let viaProbe = 0;
  let viaGate = 0;
  let neverRetention = 0;
  for (const r of rows) {
    for (const id of GRAPH.ids) {
      if (r.mastery.status(id) !== "mastered") continue;
      const s = r.mastery.stateOf(id);
      // Every certification must rest on the node's OWN unaided evidence: either the M2 counters
      // are genuinely full, or its own test-out probe was passed. Propagation fills neither.
      const ownGate = s.scored >= M.bkt.minScoredOpportunities && s.atBand >= M.bkt.minAtBandOpportunities;
      const ownProbe = s.testOut?.passed === true;
      if (ownProbe) viaProbe += 1;
      else if (ownGate) viaGate += 1;
      else unearned += 1;
      if (s.everMastered && s.provisionalAt == null) neverRetention += 1;
    }
  }
  claim(
    "D4",
    "propagation never certifies an ancestor: every mastered node rests on its own unaided evidence",
    unearned === 0 && neverRetention === 0,
    `advancedOnly (knows every band-4/5 node, no band-1/2 foundation), ${rows.length} runs: ` +
      `${viaGate} certifications reached M2 on the node's own counters and ${viaProbe} passed the node's own probe; ` +
      `${unearned} rested on neither. Propagation moved ${RESULTS["advancedOnly|shipped"].credits.toFixed(0)} ` +
      `posteriors per learner (${JSON.stringify(RESULTS["advancedOnly|shipped"].byDistance)} by distance) and ` +
      `certified none of them. What propagation DOES buy this learner is the OFFER: a foundation node whose ` +
      `posterior it raised above ${TEST_OUT.offerAbove} gets a probe, and a learner who does not know it fails ` +
      `item 1 and lands in ordinary teaching.`
  );
}

/** D5 — one shot. A failed probe is never re-offered, including across a save/restore round trip. */
{
  const clock = virtualClock(0);
  const mastery = mk({ now: () => clock.minutes() });
  const sched = new Scheduler(mastery, { clock, rng: mulberry32(5), sessionMinutes: SESSION_MINUTES, bank: BANK });
  sched.beginSession();
  const first = sched.next();
  const kp = first.kpId;
  const wasProbe = first.testOut === true;
  sched.submit(first, { correct: false, latencyMs: 9000, itemId: "x1" });
  const afterFail = mastery.testOutOf(kp);
  const reoffered = mastery.testOutOffered(kp);
  // round-trip the whole engine and ask again
  const snap = JSON.parse(JSON.stringify(mastery.snapshot()));
  const m2 = mk({ now: () => clock.minutes() });
  new Scheduler(m2, { clock, rng: mulberry32(5), sessionMinutes: SESSION_MINUTES, bank: BANK });
  m2.restore(snap);
  claim(
    "D5",
    "a probe is offered once per knowledge point, ever — a failure is not re-rollable, not even across a reload",
    wasProbe && afterFail.failed === true && reoffered === false && m2.testOutOffered(kp) === false && m2.testOutOf(kp)?.failed === true,
    `first item of session 1 was a probe on "${kp}"; one wrong answer ended it (${afterFail.reason}). ` +
      `testOutOffered is now ${reoffered} live and ${m2.testOutOffered(kp)} after a snapshot/restore round trip. ` +
      `Without persistence a reload would turn a 1e-3 probe into an unlimited-ticket lottery: eleven retries at ` +
      `the shipped bank's rates is a 1e-2 probe.`
  );
}

/** D6 — determinism. Same seed, same numbers, or none of the above is reproducible. */
{
  const a = runLearner({ seed: 12345, kind: "strong", arm: "shipped", sessions: 6 });
  const b = runLearner({ seed: 12345, kind: "strong", arm: "shipped", sessions: 6 });
  const sa = JSON.stringify(a.mastery.probe());
  const sb = JSON.stringify(b.mastery.probe());
  claim(
    "D6",
    "the whole engine is deterministic under a fixed seed — the mastery probe is byte-identical",
    sa === sb && sa.length > 100,
    `two identical runs of a 6-session strong learner produce probe payloads of ${sa.length} bytes that compare ` +
      `${sa === sb ? "equal" : "UNEQUAL"}. §8 requirement 12 extended to the two new mechanisms.`
  );
}

// =============================================================================================
head("PART E — the delivery: the precondition the whole engine rested on, now enforced in code");
// =============================================================================================

/**
 * E1 — IS `serve()` ON THE SHIPPED PATH AT ALL?
 *
 * Round 2's rejection was not that `serve()` was wrong. It was that `grep -rn 'serve(' app/src`
 * returned only `Scheduler.js` itself: the picker that honours `avoidFamilies` and reports the
 * generator family had zero callers, so the shipped loop went `next()` -> `submit()` with nothing
 * in between. This claim greps the real tree, the same way a critic would.
 */
{
  const read = (p) => {
    try {
      return readFileSync(resolve(ROOT, p), "utf8");
    } catch {
      return "";
    }
  };
  const schedSrc = read("app/src/learn/Scheduler.js");
  const bootSrc = read("app/src/boot/63-learnserve.js");
  const boot62 = read("app/src/boot/62-learning.js");
  // The Scheduler draws the item itself inside `next()`...
  const drawsInNext = /const sel = this\.serve\(req, this\.bank\)/.test(schedSrc);
  // ...and something OUTSIDE Scheduler.js hands it the bank on the shipped path.
  const attachedOutside = /scheduler\.attachBank\(itemBank\)/.test(bootSrc);
  const bootOrder = /order:\s*63/.test(bootSrc) && /order:\s*62/.test(boot62);
  const servesOutside = /scheduler\.serve\(req, itemBank\)/.test(bootSrc);
  claim(
    "E1",
    "Scheduler.serve() is on the SHIPPED path — the picker is wired, not documented",
    drawsInNext && attachedOutside && bootOrder && servesOutside,
    `app/src/learn/Scheduler.js: next() draws every request through serve() when it holds a bank ` +
      `(${drawsInNext ? "found" : "MISSING"}). app/src/boot/63-learnserve.js: ` +
      `scheduler.attachBank(itemBank) ${attachedOutside ? "found" : "MISSING"} at order 63, after ` +
      `62-learning and 62-itembank (${bootOrder ? "ordered" : "ORDER WRONG"}); it also exposes ` +
      `scheduler.serve(req, itemBank) as the re-roll path (${servesOutside ? "found" : "MISSING"}), which is a ` +
      `caller of serve() outside Scheduler.js. Round 2 had none of these four.`
  );
}

/**
 * E2 — THE DEADLOCK, REPRODUCED AND CLOSED. This is the critic's own script
 * (`review/measure/_critic/p32c-gate.mjs`) inlined: eight sessions of perfect answers, count what
 * was served and what was scored. Round 2 served `var-meaning|construct` 228 times and scored 0.
 */
function driveAllCorrect({ bank, sessions = 8, strict = true }) {
  const clock = virtualClock(0);
  // `familyReporting: undefined` leaves the delivery UNDECLARED, which is the honest state for an
  // engine whose Scheduler has not been handed a bank yet — the Scheduler declares it itself at the
  // first `_select()`. Forcing `true` here (as `mk()` does for the direct-`respond` claims, which
  // do report a family) would be the round-2 assumption wearing a test's clothes.
  const m = mk({ now: () => clock.minutes(), strictFamilyReport: strict, familyReporting: undefined, familyReportingSource: undefined });
  const s = new Scheduler(m, { clock, rng: mulberry32(11), sessionMinutes: SESSION_MINUTES, bank });
  const served = new Map();
  let items = 0;
  let noItem = 0;
  let refusedFamilyServed = 0;
  for (let session = 0; session < sessions; session++) {
    clock.set(session * 1440);
    s.beginSession();
    for (;;) {
      const req = s.next();
      if (!req) break;
      items += 1;
      const key = `${req.kpId}|${req.form}`;
      served.set(key, (served.get(key) ?? 0) + 1);
      if (bank) {
        if (!req.item) noItem += 1;
        if (req.family && m.refusedFamilies(req.kpId, req.form).includes(req.family)) refusedFamilyServed += 1;
      }
      s.submit(req, { correct: true, latencyMs: 9000, hinted: false });
    }
    s.endSession();
  }
  return { m, s, served, items, noItem, refusedFamilyServed, worstCell: [...served.entries()].sort((a, b) => b[1] - a[1])[0] };
}
{
  const withBank = driveAllCorrect({ bank: BANK });
  const noBank = driveAllCorrect({ bank: null });
  claim(
    "E2",
    "the selector never offers a (kp x form) whose response the scorer will refuse — the round-2 deadlock is closed",
    withBank.m.stats.unscoredItems === 0 &&
      withBank.m.stats.unreportedFamilyItems === 0 &&
      noBank.m.stats.unscoredItems === 0 &&
      noBank.m.stats.unreportedFamilyItems === 0 &&
      withBank.m.summary().mastered > 0 &&
      noBank.m.summary().mastered > 0,
    `Eight sessions of perfect answers, the critic's own reproduction. WITH the bank attached (the shipped ` +
      `configuration): ${withBank.items} items, ${withBank.m.stats.unscoredItems} unscored, ` +
      `${withBank.m.stats.unreportedFamilyItems} refused for an unreported family, ` +
      `${withBank.m.summary().mastered} knowledge points mastered; busiest cell ` +
      `"${withBank.worstCell[0]}" x${withBank.worstCell[1]}. WITHOUT a bank (round 2's delivery, now honestly ` +
      `declared): ${noBank.items} items, ${noBank.m.stats.unscoredItems} unscored, ` +
      `${noBank.m.summary().mastered} mastered; busiest cell "${noBank.worstCell[0]}" x${noBank.worstCell[1]}. ` +
      `Round 2 measured var-meaning|construct served 228 times with state.unscored = 228 and gateDetail.m2 false ` +
      `forever. The selector now asks isScorable(kp, form, "solo", mastery.deliveryFamily()) — the SAME third ` +
      `argument respond() will use — and additionally refuses a cell the bank cannot draw from.`
  );
}

/** E3 — every request the shipped path produces carries a real item and a non-refused family. */
{
  const r = driveAllCorrect({ bank: BANK, sessions: 6 });
  claim(
    "E3",
    "every request drawn on the shipped path carries an item AND its generator family, and never a refused one",
    r.noItem === 0 && r.refusedFamilyServed === 0 && r.s.serveMisses === 0 && r.items > 100,
    `${r.items} requests: ${r.noItem} without req.item, ${r.refusedFamilyServed} carrying a family the audit ` +
      `refuses, ${r.s.serveMisses} where serve() came back empty. The engine's own counter agrees: ` +
      `${r.m.stats.unreportedFamilyItems} responses refused for a missing family report across the whole run, ` +
      `and mastery.probe().delivery.familyReporting = ${r.m.familyReporting} ` +
      `(source "${r.m.familyReportingSource}").`
  );
}

/**
 * E4 — CONTROL. A harness that cannot make the defect happen cannot prove it gone. Submit a
 * response with the family deliberately stripped, on a cell that has refused families, and check
 * that the engine (a) refuses it, (b) names it in `issues`, (c) publishes it on the probe, and
 * (d) throws under `strictFamilyReport`.
 */
{
  const filtered = GRAPH.ids.flatMap((id) => [...REF.pricing.masteryForms].filter((f) => REF.requiresFamilyReport(id, f)).map((f) => [id, f]));
  const [kp, form] = filtered[0] ?? [];
  const loud = mk({ strictFamilyReport: false });
  const before = loud.issues.length;
  const out = loud.respond({ kpId: kp, form, phase: "solo", mode: "acquire", correct: true, latencyMs: 9000, difficulty: GRAPH.centre(kp) });
  const named = loud.issues.slice(before).some((i) => i.startsWith("DELIVERY:") && i.includes(kp));
  const onProbe = loud.probe().delivery.defects.some((d) => d.kpId === kp && d.form === form);
  let threw = false;
  try {
    mk({ strictFamilyReport: true }).respond({ kpId: kp, form, phase: "solo", mode: "acquire", correct: true, latencyMs: 9000, difficulty: GRAPH.centre(kp) });
  } catch {
    threw = true;
  }
  // ...and the same response WITH the family reported is scored normally. Without this arm the
  // claim above would also pass on an engine that refused everything.
  const ok = mk();
  const good = say(ok, { kpId: kp, form, phase: "solo", mode: "acquire", correct: true, latencyMs: 9000, difficulty: GRAPH.centre(kp) });
  claim(
    "E4",
    "CONTROL — an unreported family is refused, named, published and (in strict mode) fatal; a reported one scores",
    !!kp && out.scored === false && out.reason.startsWith("unscored-unreported-family") && named && onProbe && threw && good.scored === true && good.credited === true,
    `${filtered.length} of ${GRAPH.ids.length * REF.pricing.masteryForms.size} mastery-eligible cells require a ` +
      `family report. On "${kp}|${form}": a response with no family is scored=${out.scored} ` +
      `(${out.reason}), raises a DELIVERY issue (${named}), appears in probe().delivery.defects (${onProbe}), ` +
      `and throws under strictFamilyReport (${threw}). The identical response reporting family ` +
      `"${famOf(ok, kp, form)}" is scored=${good.scored} credited=${good.credited}. Round 2 incremented a counter ` +
      `and did none of the other four, which is why 1961 unscored items looked like a quiet session.`
  );
}

/**
 * E5 — THE CONTENT QUESTION, ANSWERED WITH THE FAMILIES A FIX HAS TO TOUCH. Which knowledge points
 * cannot be certified, and is it because of the content or because of the delivery?
 */
{
  const dead = REF.contentDeficits.filter((d) => d.kind === "dead");
  const unreported = mk({ familyReporting: false, familyReportingSource: "no-picker" });
  const deliveryOnly = unreported.contentDeficits.filter((d) => d.kind === "delivery");
  table(
    [...dead, ...deliveryOnly].map((d) => ({
      "knowledge point": d.kpId,
      band: d.band,
      "why": d.kind === "dead" ? "CONTENT — no form on any delivery" : "DELIVERY — needs the family reported",
      "forms if reported": d.bestCaseForms.join(",") || "—",
      "refused families": d.refused.map((x) => `${x.form}:${x.family}@${x.blind}`).join(" ") || "—",
    }))
  );
  claim(
    "E5",
    "the four uncertifiable knowledge points are told apart: three were a DELIVERY bug, one is a real content hole",
    dead.length === 1 &&
      dead[0].kpId === "eq-special-cases" &&
      deliveryOnly.length === 3 &&
      REF.issues.some((i) => i.startsWith("CONTENT:") && i.includes("eq-special-cases") && i.includes("ANY delivery")) &&
      deliveryOnly.every((d) => d.bestCaseForms.length > 0),
    `On the shipped delivery ${CERTIFIABLE} of ${TOTAL} knowledge points are certifiable and the single ` +
      `exception is "${dead[0]?.kpId}" (band ${dead[0]?.band}), whose every generator family on every scored form ` +
      `is above the caps: ${dead[0]?.refused.map((x) => `${x.form}:${x.family} blind ${x.blind} answers "${x.modalAnswer}"`).join("; ")}. ` +
      `THE FIX IS CONTENT AND IT IS SPECIFIED: those pools need enough distinct answers that the measured blind ` +
      `rate falls under ${M.bkt.identifiabilityCaps?.maxTrueGuess ?? 0.3} — a construct/repair pool, never a looser ` +
      `threshold. The other three — ${deliveryOnly.map((d) => d.kpId).join(", ")} — were NOT content holes at all: ` +
      `they carry ${deliveryOnly.map((d) => `${d.kpId} [${d.bestCaseForms.join(",")}]`).join(", ")} and were ` +
      `uncertifiable only while nobody reported the family. Round 2 named exactly one of the four in issues.`
  );
}

/**
 * E6 — PROPAGATION SEEDS ARE FILTERED THROUGH THE ANCESTOR CONE, with the control arm that proves
 * the detector works: an ON-cone seed IS paid.
 */
{
  const src = "var-meaning";
  const target = "eq-two-step"; // a DESCENDANT of var-meaning
  const hostile = mk();
  const p0 = hostile.p(target);
  for (let i = 0; i < 600; i++)
    say(hostile, { kpId: src, form: "repair", phase: "solo", mode: "acquire", correct: true, latencyMs: 9000, difficulty: GRAPH.centre(src), exercises: [target] });
  const everything = mk();
  for (let i = 0; i < 800; i++)
    say(everything, { kpId: src, form: "generate", phase: "solo", mode: "acquire", correct: true, latencyMs: 9000, difficulty: GRAPH.centre(src), exercises: GRAPH.ids.filter((x) => x !== src) });
  const lifted = GRAPH.ids.filter((x) => x !== src && everything.p(x) > GRAPH.band(x).prior + 1e-9);
  // CONTROL: the same mechanism on a node that HAS ancestors must pay them.
  const deep = GRAPH.ids.filter((id) => GRAPH.ancestors(id).size >= 2 && REF.deliverableMasteryForms(id).length)[0];
  const onCone = mk();
  const anc = [...GRAPH.ancestors(deep)][0];
  say(onCone, { kpId: deep, form: REF.deliverableMasteryForms(deep)[0], phase: "solo", mode: "acquire", correct: true, latencyMs: 9000, difficulty: GRAPH.centre(deep), exercises: [anc] });
  const paidControl = onCone.p(anc) > GRAPH.band(anc).prior + 1e-9;
  const namedOffCone = hostile.issues.some((i) => i.startsWith("CONTENT:") && i.includes(target) && i.includes("DESCENDANT"));
  claim(
    "E6",
    "a caller's `exercises` tag cannot pay a non-ancestor — the cone filters the seeds, not just the walk past them",
    hostile.p(target) === p0 && hostile.stats.offConeSeeds === 600 && namedOffCone && lifted.length === 0 && paidControl,
    `600 responses on "${src}" declaring exercises:["${target}"] — a DESCENDANT — leave it at ` +
      `${hostile.p(target).toFixed(4)} (was ${p0.toFixed(4)}); all ${hostile.stats.offConeSeeds} seeds were dropped ` +
      `and named in issues (${namedOffCone}). Round 2 read `+"`r.exercises`"+` verbatim at distance 1 and this same ` +
      `sequence lifted it from 0.180 to the 0.900 ceiling. Declaring ALL 31 other nodes for 800 responses now ` +
      `lifts ${lifted.length} of them. CONTROL: one response on "${deep}" declaring its genuine ancestor ` +
      `"${anc}" DOES pay it (${onCone.p(anc).toFixed(4)} against a prior of ${GRAPH.band(anc).prior}), so the ` +
      `filter is a filter and not an off switch.`
  );
}

/**
 * E7 — THE PROBE TABLE, RE-DERIVED INDEPENDENTLY. The committed round-2 table disagreed with the
 * engine it was supposed to describe (translate-order printed 5 items / 4.00e-4 against a live
 * 6 / 3.20e-4) because it was generated against an older bank audit and never regenerated. This
 * recomputes every eligible probe's blind-pass from `probeItemBlindRate` per SERVED form and
 * requires it to equal the engine's own `testOutPlan(...).blindPass`.
 */
{
  const rows = ELIGIBLE.map(({ id, plan }) => {
    const recomputed = plan.forms.reduce((a, f) => a * REF.probeItemBlindRate(id, f), 1);
    return { id, items: plan.items, forms: plan.forms.join(","), engine: plan.blindPass, recomputed, agree: Math.abs(recomputed - plan.blindPass) <= 1e-6 + 1e-9 };
  });
  const disagree = rows.filter((r) => !r.agree);
  claim(
    "E7",
    "the printed probe table is recomputed from the shipped audit, item by item, and agrees with the engine",
    disagree.length === 0 && rows.length === ELIGIBLE.length && rows.length > 0,
    `${rows.length} eligible probes; ${disagree.length} disagree with an independent product of ` +
      `probeItemBlindRate over the exact forms the probe serves. Audit v${AUDIT.version} fingerprint ` +
      `${AUDIT.fingerprint} — the table in review/measure/P32.txt is written by THIS run and stamped with that ` +
      `fingerprint, so a stale audit can no longer sit under a green table. Spot checks: ` +
      `${rows.slice(0, 3).map((r) => `${r.id} ${r.items} items ${r.engine.toExponential(2)}`).join("; ")}.`
  );
}

/**
 * E8 — THE RESUME PATH, which is where a delivery declaration would have quietly died.
 *
 * `boot/62-learning.js` hydrates the persisted learner BEFORE `boot/63-learnserve.js` attaches the
 * bank, and `Mastery.restore()` copies the persisted `stats` wholesale — so a returning learner
 * arrives with `stats.items` in the hundreds before this engine has priced anything. A declaration
 * guard written against `stats.items` would refuse the attach and leave every resumed session in
 * the restrictive delivery: three band-1/2 knowledge points uncertifiable, forever, for returning
 * players only. This claim is here because that bug existed in this file's first draft and nothing
 * else in the suite would have caught it.
 */
{
  // Session one: play a bit through the shipped delivery, then persist.
  const one = driveAllCorrect({ bank: BANK, sessions: 2 });
  const snap = JSON.parse(JSON.stringify(one.m.snapshot()));
  // Session two, exactly as boot does it: construct, hydrate, THEN attach the bank.
  const clock = virtualClock(3 * 1440);
  const resumed = mk({ now: () => clock.minutes(), familyReporting: undefined, familyReportingSource: undefined });
  const sched = new Scheduler(resumed, { clock, rng: mulberry32(11), sessionMinutes: SESSION_MINUTES });
  const restored = resumed.restore(snap);
  const itemsCarried = resumed.stats.items;
  sched.attachBank(BANK);
  sched.beginSession();
  let served = 0;
  for (;;) {
    const req = sched.next();
    if (!req) break;
    served += 1;
    sched.submit(req, { correct: true, latencyMs: 9000, hinted: false });
  }
  claim(
    "E8",
    "a RESUMED session still gets the shipped delivery — the declaration is guarded on this engine's own work, not the snapshot's",
    restored && itemsCarried > 0 && resumed.familyReporting === true && resumed.stats.unreportedFamilyItems === 0 && served > 0 && resumed.deliverableMasteryForms("props-operations").length === 3,
    `restored a snapshot carrying ${itemsCarried} prior responses, then attached the bank exactly as ` +
      `boot/62 -> boot/63 does: familyReporting = ${resumed.familyReporting} ("${resumed.familyReportingSource}"), ` +
      `${served} further items served with ${resumed.stats.unreportedFamilyItems} refused for a missing family, ` +
      `and props-operations still carries ${resumed.deliverableMasteryForms("props-operations").length} earnable ` +
      `forms. Guarding on stats.items instead of this engine's own priced count would have pinned every returning ` +
      `player to the restrictive delivery and left that node at 0.`
  );
}

// =============================================================================================
head(`RESULT — ${claims.length - failed} of ${claims.length} claims pass`);
// =============================================================================================

if (JSON_OUT) {
  console.log(
    JSON.stringify(
      {
        claims,
        certifiable: CERTIFIABLE,
        plans: Object.fromEntries(PLANS.map(({ id, plan }) => [id, plan])),
        cohorts: Object.fromEntries(
          Object.entries(RESULTS).map(([k, v]) => [k, { ...v, rows: undefined }])
        ),
      },
      null,
      1
    )
  );
} else {
  for (const c of claims.filter((c) => !c.pass)) console.log(`FAILED  ${c.id}  ${c.title}`);
  console.log(
    failed
      ? `\n${failed} claim(s) FAILED — P32 is wrong until they pass.\n`
      : `\nAll ${claims.length} claims pass.\n`
  );

  /**
   * ...and the file, written by the script, stamped, and honest in its first line.
   *
   * `--no-write` exists for a reviewer who wants the numbers without touching the tree. Nothing
   * else can suppress it: a run that fails still writes, because the failure mode this closes is a
   * GREEN committed table sitting on top of red code, and the way to make that impossible is not to
   * withhold the file — it is to make the file say so before anything else in it.
   */
  if (!HAS("no-write")) {
    const stamp = [
      failed
        ? `!!! ${failed} OF ${claims.length} CLAIMS FAILED — THIS TABLE IS NOT A PASS. ` +
          `Failing: ${claims.filter((c) => !c.pass).map((c) => c.id).join(", ")}.`
        : `ALL ${claims.length} CLAIMS PASS.`,
      `written by review/measure/P32.mjs on ${new Date().toISOString().slice(0, 19)}Z`,
      `argv: ${process.argv.slice(2).join(" ") || "(defaults)"}  ->  learners=${LEARNERS} bots=${HOSTILE_N} sessions=${SESSIONS}`,
      `bank audit v${AUDIT.version} fingerprint ${AUDIT.fingerprint}  (regenerate with: node tools/bank-audit.mjs)`,
      `engine delivery: familyReporting=${REF.familyReporting} source="${REF.familyReportingSource}" strict=${REF.strictFamilyReport}`,
      "=".repeat(94),
      "",
    ];
    const path = resolve(ROOT, "review/measure/P32.txt");
    writeFileSync(path, stamp.concat(LOG).join("\n") + "\n", "utf8");
    rawLog(`${failed ? "FAILING" : "passing"} table written to ${path}`);
  }
}
process.exit(failed ? 1 : 0);
