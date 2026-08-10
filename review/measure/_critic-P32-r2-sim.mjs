/**
 * CRITIC round 2, P32 — my own cohort simulation and my own propagation attack.
 *
 * The learner model here is deliberately NOT the builder's. P32.mjs models a learner with BKT's
 * own slip/guess constants, which are the same constants the engine updates with. This uses a
 * plain 3PL IRT response model with an independent learning rule, so a result that agrees with
 * P32.mjs agrees for a reason other than sharing arithmetic.
 *
 *   P(correct) = c + (1-c) * sigmoid(1.7 * (theta_kp + hintBonus - b))
 *   theta_kp grows by `gain` on every acquisition item the learner is served (teaching happens
 *   even when the item is not credited), and by 0 on certification items.
 */
import { readFileSync } from "node:fs";
import { Graph } from "../../app/src/learn/Graph.js";
import { Mastery, PROPAGATION, UNREPORTED_FAMILY } from "../../app/src/learn/Mastery.js";
import { Scheduler, mulberry32, virtualClock } from "../../app/src/learn/Scheduler.js";
import { itemBank } from "../../app/src/learn/ItemBank.js";

const R = "C:/dev/math/aaemath/";
const GRAPH = new Graph(JSON.parse(readFileSync(R + "content/knowledge-graph.json", "utf8")));
const AUDIT = JSON.parse(readFileSync(R + "app/src/learn/bank-audit.json", "utf8"));
const N = Number((process.argv.find((a) => a.startsWith("--n=")) ?? "--n=60").split("=")[1]);
const SESSIONS = 26;
const TOTAL = GRAPH.ids.length;
const NEED80 = Math.ceil(0.8 * TOTAL);

const sig = (x) => 1 / (1 + Math.exp(-x));
const gauss = (rng) => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());

const ARCH = {
  strong:       { theta0: () => 2.2, gain: 0.05, spread: 0.3 },
  median:       { theta0: () => -0.6, gain: 0.30, spread: 0.5 },
  struggler:    { theta0: () => -1.9, gain: 0.12, spread: 0.5 },
  advancedOnly: { theta0: (band) => (band >= 4 ? 2.2 : -1.0), gain: 0.30, spread: 0.4 },
};

const ARMS = {
  shipped: {},
  baseline: { testOut: { enabled: false }, propagation: { maxDistance: 1 } },
};

function run({ kind, arm, seed }) {
  const rng = mulberry32(seed);
  const clock = virtualClock(0);
  const mastery = new Mastery(GRAPH, { bankAudit: AUDIT, storage: null, now: () => clock.minutes(), ...ARMS[arm] });
  const sch = new Scheduler(mastery, { clock, rng: mulberry32(seed ^ 0x51ed), sessionMinutes: 25, bank: itemBank });
  const A = ARCH[kind];
  const theta = new Map();
  for (const id of GRAPH.ids) theta.set(id, A.theta0(GRAPH.difficulty(id)) + gauss(rng) * A.spread);

  let seconds = 0;
  const trace = [];
  for (let s = 0; s < SESSIONS; s++) {
    clock.set(s * 1440);
    sch.beginSession();
    for (;;) {
      const req = sch.next();
      if (!req) break;
      const hintBonus = req.hinted ? 1.1 : 0;
      const c = 0.05;
      const p = c + (1 - c) * sig(1.7 * (theta.get(req.kpId) + hintBonus - req.difficulty));
      const correct = rng() < p;
      if (req.mode === "acquire") theta.set(req.kpId, theta.get(req.kpId) + A.gain);
      sch.submit(req, { correct, latencyMs: 4000 + Math.floor(rng() * 6000), hinted: req.hinted, itemId: req.itemId ?? req.item?.id });
    }
    sch.endSession();
    seconds += sch.secondsSpent;
    trace.push({ mastered: GRAPH.ids.filter((id) => mastery.status(id) === "mastered").length, minutes: seconds / 60, items: mastery.stats.items });
  }
  const mastered = trace[trace.length - 1].mastered;
  const at = (n) => trace.find((t) => t.mastered >= n) ?? null;
  const to80 = at(NEED80);
  return {
    mastered, pct: mastered / TOTAL, minutes: seconds / 60, items: mastery.stats.items,
    to80Min: to80?.minutes ?? null, to80Items: to80?.items ?? null,
    to80Sess: (trace.findIndex((t) => t.mastered >= NEED80) + 1) || null,
    reached80: mastered >= NEED80,
    probesOffered: mastery.stats.testOutsOffered, probesPassed: mastery.stats.testOutsPassed,
    viaProbe: GRAPH.ids.filter((id) => mastery.stateOf(id).unlockedVia === "test-out").length,
    credits: mastery.stats.prerequisiteCredits,
  };
}

const med = (a) => { const s = [...a].filter((x) => x != null).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

console.log(`=== MY OWN COHORT (3PL learner model, real Graph/Mastery/Scheduler/ItemBank), n=${N} per cell, ${SESSIONS} sessions ===\n`);
console.log("archetype    arm       med min→80%  med items→80%  med sess→80%  reached 80%  med final mastery  probes off/pass  probe unlocks");
const cohort = {};
for (const kind of Object.keys(ARCH)) {
  for (const arm of Object.keys(ARMS)) {
    const rows = [];
    for (let i = 0; i < N; i++) rows.push(run({ kind, arm, seed: 1000 + i * 7919 }));
    cohort[`${kind}|${arm}`] = rows;
    const r80 = rows.filter((r) => r.reached80).length / rows.length;
    console.log(
      `${kind.padEnd(13)}${arm.padEnd(10)}${String(med(rows.map((r) => r.to80Min))?.toFixed(0) ?? "—").padEnd(13)}` +
      `${String(med(rows.map((r) => r.to80Items)) ?? "—").padEnd(15)}${String(med(rows.map((r) => r.to80Sess)) ?? "—").padEnd(14)}` +
      `${(r80 * 100).toFixed(1).padStart(5)}%       ${(med(rows.map((r) => r.pct)) * 100).toFixed(1).padStart(5)}%             ` +
      `${med(rows.map((r) => r.probesOffered))}/${med(rows.map((r) => r.probesPassed))}`.padEnd(17) +
      `${med(rows.map((r) => r.viaProbe))}`
    );
  }
}

const M = cohort["median|shipped"];
console.log(`\nL5 CHECK — median learner, shipped arm: median final mastery ${(med(M.map((r) => r.pct)) * 100).toFixed(1)}%; ` +
  `${((M.filter((r) => r.reached80).length / M.length) * 100).toFixed(1)}% of runs reach >=80%.`);
const S = cohort["strong|shipped"], SB = cohort["strong|baseline"];
console.log(`TEST-OUT SAVING — strong learner minutes to 80%: shipped ${med(S.map((r) => r.to80Min))?.toFixed(0)} vs baseline ${med(SB.map((r) => r.to80Min))?.toFixed(0)} ` +
  `(${(100 * (1 - med(S.map((r) => r.to80Min)) / med(SB.map((r) => r.to80Min)))).toFixed(1)}% less). ` +
  `Items: ${med(S.map((r) => r.to80Items))} vs ${med(SB.map((r) => r.to80Items))}.`);
console.log(`2-MINUTE CLAIM — probes at or under 2 min: ${JSON.stringify(new Mastery(GRAPH, { bankAudit: AUDIT, storage: null }).testOutMinutesSummary())}`);

// =============================================================================================
console.log(`\n=== PROPAGATION ATTACK — adversarial orderings against respond() directly ===\n`);
const attacks = {
  "declare every node on every response": (id) => GRAPH.ids.filter((x) => x !== id),
  "declare descendants only": (id) => [...GRAPH.descendants(id)],
  "declare self": (id) => [id],
  "declare the deepest node": () => [GRAPH.ids[GRAPH.ids.length - 1]],
  "declare direct prerequisites (the engine default)": null,
};
for (const [name, fn] of Object.entries(attacks)) {
  const clock = virtualClock(0);
  const mastery = new Mastery(GRAPH, { bankAudit: AUDIT, storage: null, now: () => clock.minutes() });
  const leaf = GRAPH.leaves()[0] ?? GRAPH.ids[GRAPH.ids.length - 1];
  const own = new Set();
  // 4000 hostile responses, alternating the source node so every cone in the graph gets hammered.
  let t = 0;
  for (let i = 0; i < 4000; i++) {
    const src = GRAPH.ids[i % GRAPH.ids.length];
    const forms = mastery.deliverableMasteryForms(src);
    if (!forms.length) continue;
    const form = forms[i % forms.length];
    const fam = Object.entries(mastery.cell(src, form)?.families ?? {}).find(([, r]) => r.priceable)?.[0] ?? null;
    clock.set((t += 3));
    own.add(src);
    mastery.respond(
      { kpId: src, form, phase: "solo", difficulty: GRAPH.centre(src) + 0.3, mode: "acquire", ...(fn ? { exercises: fn(src) } : {}) },
      { correct: true, latencyMs: 6000, hinted: false, family: fam }
    );
  }
  // Every node that never received its own response must not be certified and must not exceed the ceiling.
  const unearned = GRAPH.ids.filter((id) => mastery.stateOf(id).scored === 0 && mastery.stateOf(id).attempts === 0);
  const certified = unearned.filter((id) => mastery.status(id) !== "learning");
  const overCeiling = unearned.filter((id) => mastery.stateOf(id).p > PROPAGATION.ceiling + 1e-9);
  const counters = unearned.filter((id) => (mastery.stateOf(id).scored ?? 0) > 0 || (mastery.stateOf(id).atBand ?? 0) > 0);
  const maxP = unearned.length ? Math.max(...unearned.map((id) => mastery.stateOf(id).p)) : 0;
  console.log(`${name.padEnd(52)} unearned=${String(unearned.length).padEnd(4)} certified=${String(certified.length).padEnd(3)} over-ceiling=${String(overCeiling.length).padEnd(3)} counters-moved=${String(counters.length).padEnd(3)} maxP=${maxP.toFixed(4)} offConeSeeds=${mastery.stats.offConeSeeds}`);
}
