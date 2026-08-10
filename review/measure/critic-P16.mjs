/**
 * CRITIC's OWN measurement of P16. Written by the reviewer, not the builder.
 *
 * Everything here runs against the SHIPPED modules (app/src/learn/*) and the SHIPPED content
 * (content/knowledge-graph.json, content/items/*). No synthetic board, no test bank.
 *
 *   PART 1  independent blind-guess measurement of >= 6 (knowledge point x form) cells, drawn
 *           through ItemBank.select() — the path a player is actually served from — and marked by
 *           ItemBank.check(). Compared against what the engine prices the same cell at.
 *   PART 2  three cohorts on the real Scheduler + real ItemBank: median learner, coin-flip
 *           guesser, hint-abuser. No success-rate parameter anywhere: a bot types a string and
 *           the shipped checker decides.
 *   PART 3  cycle injection into Graph.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");

const { Graph, GraphError } = await import(`file://${ROOT}/app/src/learn/Graph.js`);
const { Mastery, auditBlindGuessing, collectBankSample } = await import(`file://${ROOT}/app/src/learn/Mastery.js`);
const { Scheduler, virtualClock, mulberry32 } = await import(`file://${ROOT}/app/src/learn/Scheduler.js`);
const { ItemBank } = await import(`file://${ROOT}/app/src/learn/ItemBank.js`);
const { BANK } = await import(`file://${ROOT}/content/items/index.mjs`);
const { generateOne, TIERS } = await import(`file://${ROOT}/content/items/generators.mjs`);

const SRC = JSON.parse(fs.readFileSync(path.join(ROOT, "content/knowledge-graph.json"), "utf8"));
const GRAPH = new Graph(SRC);
const M = GRAPH.model;
const bank = new ItemBank();

/** The audit the SHIPPED boot module builds, byte for byte (boot/62-learning.js lines 70-77). */
const AUDIT = auditBlindGuessing(
  collectBankSample({ bankFiles: BANK, generateOne, tiers: TIERS, bandOf: (id) => GRAPH.difficulty(id) }),
  { mark: (item, response) => bank.check(item, response).correct === true, spell: (item) => bank.accepts(item)[0] }
);

const say = (...a) => console.log(...a);
const pct = (x) => `${(100 * x).toFixed(1)}%`;

say("=".repeat(100));
say("CRITIC P16 — independent measurement. Scene: the SHIPPED learn modules + content/items.");
say(`graph ${GRAPH.ids.length} nodes · catalogue ${BANK.reduce((a, f) => a + f.items.length, 0)} items · audit sampled ${AUDIT.sampled}`);
say("=".repeat(100));

// =================================================================== PART 1 — blind rates
//
// My own candidate repertoire. Chosen without reading the builder's list: the things a responder
// with no algebra types, plus every answer spelling that shows up more than once in the pool drawn.
const STAPLES = [
  "0", "1", "2", "-1", "3", "4", "5", "6", "10", "1/2", "-2",
  "x", "x = 0", "x = 1", "x = 4", "2x", "x + 1", "0 = 0", "x + x",
  "always", "none", "siempre", "ninguno", "zawsze", "zaden",
  "3|0 = 0", "1: 0 = 0", "2x + 3", "x - 1", "-x",
];

const DRAWS = 300;

/** Draw the pool a player would be served for (kp, form), through the shipped select path. */
function servedPool(kpId, form, { honourRefusals, n = DRAWS }) {
  const mastery = new Mastery(GRAPH, { bankAudit: AUDIT, storage: null, emit: () => {} });
  const avoid = honourRefusals ? new Set(mastery.refusedFamilies(kpId, form)) : new Set();
  const centre = GRAPH.difficulty(kpId);
  const out = [];
  const exclude = new Set();
  for (let i = 0; i < n; i += 1) {
    const difficulty = Math.max(1, Math.min(5, centre + ((i % 5) - 2)));
    let picked = null;
    for (let tries = 0; tries < 8; tries += 1) {
      const sel = bank.select({ kpId, form, difficulty, seed: (i * 2654435761 + tries * 104729 + 7) >>> 0, exclude });
      if (!sel) break;
      picked = sel.item;
      if (!avoid.has(sel.item.family)) break;
      exclude.add(sel.item.id);
      picked = null;
    }
    if (picked) out.push(picked);
    if (exclude.size > 5000) exclude.clear();
  }
  return out;
}

/** Best single fixed string over a pool, marked by the SHIPPED checker. No rate parameter. */
function bestFixed(pool) {
  const cands = new Set(STAPLES);
  for (const item of pool) {
    for (const s of bank.accepts(item).slice(0, 2)) if (s != null) cands.add(String(s));
  }
  let best = { answer: null, hits: 0 };
  for (const c of cands) {
    let hits = 0;
    for (const item of pool) {
      try {
        if (bank.check(item, c).correct === true) hits += 1;
      } catch { /* unreadable is wrong */ }
    }
    if (hits > best.hits) best = { answer: c, hits };
  }
  return { ...best, n: pool.length, rate: pool.length ? best.hits / pool.length : 0 };
}

const enginePricing = new Mastery(GRAPH, { bankAudit: AUDIT, storage: null, emit: () => {} });

const CELLS = [];
for (const form of ["construct", "repair", "generate"]) {
  for (const kpId of ["expr-anatomy", "eq-special-cases", "eq-one-add", "eq-both-sides", "eq-model-context", "ineq-solve-one"]) {
    if (GRAPH.has(kpId)) CELLS.push([kpId, form]);
  }
}

say("\nPART 1 — blind-guess rate I measured, against what the engine prices");
say("(pool drawn through ItemBank.select(); marked by ItemBank.check(); best single fixed string)");
say("");
say(
  "cell".padEnd(34),
  "raw".padEnd(7),
  "served".padEnd(8),
  "priced".padEnd(8),
  "model".padEnd(7),
  "scorable".padEnd(9),
  "best fixed answer"
);
const mismatches = [];
for (const [kpId, form] of CELLS) {
  const raw = bestFixed(servedPool(kpId, form, { honourRefusals: false }));
  const served = bestFixed(servedPool(kpId, form, { honourRefusals: true }));
  const price = enginePricing.price(kpId, form, "solo");
  const priced = price.bankBlindRate;
  const modelled = price.modelledGuess;
  const line = [
    `${kpId}|${form}`.padEnd(34),
    raw.rate.toFixed(3).padEnd(7),
    served.rate.toFixed(3).padEnd(8),
    (priced == null ? "n/a" : priced.toFixed(3)).padEnd(8),
    (modelled == null ? "REFUSED" : modelled.toFixed(3)).padEnd(7),
    String(price.scorable).padEnd(9),
    JSON.stringify(served.answer),
  ].join(" ");
  say(line);
  // A mismatch that matters: the engine SCORES this cell and the modelled guess is below what I
  // measured a blind responder actually gets on the pool it will actually be served.
  if (price.scorable && modelled != null && served.rate > modelled + 0.02) {
    mismatches.push({ kpId, form, measured: served.rate, modelled, answer: served.answer });
  }
  if (price.scorable && priced != null && served.rate > priced + 0.05) {
    mismatches.push({ kpId, form, measured: served.rate, enginePriced: priced, kind: "engine-blind-underestimate", answer: served.answer });
  }
}
say("");
say(mismatches.length ? `MISMATCHES: ${JSON.stringify(mismatches, null, 2)}` : "MISMATCHES: none — every scored cell is priced at or above what I measured.");

// =================================================================== PART 2 — cohorts
//
// No probability-of-correct parameter for the bots. They type a string; bank.check() rules.

const SESSIONS = Number(process.env.CRITIC_SESSIONS ?? 20);
const SESSION_MINUTES = 25;
const A = M.antiGuessing;

function bandTierFor(req) {
  const centre = GRAPH.centre(req.kpId);
  const band = GRAPH.difficulty(req.kpId);
  return Math.max(1, Math.min(5, band + Math.round((req.difficulty - centre) / 0.3)));
}

function liveItem(req, exclude, seq) {
  const avoid = req.avoidFamilies ?? [];
  let fallback = null;
  for (let t = 0; t < 8; t += 1) {
    const sel = bank.select({
      kpId: req.kpId,
      form: req.form,
      difficulty: bandTierFor(req),
      misconception: t === 0 ? (req.targetMisconception ?? null) : null,
      seed: (seq * 2246822519 + 11 + t * 104729) >>> 0,
      exclude,
    });
    if (!sel) break;
    fallback = sel.item;
    if (!avoid.includes(sel.item.family)) return sel.item;
    exclude.add(sel.item.id);
  }
  return fallback;
}

/** Best fixed answer per cell, measured here (PART 1's machinery), for the guesser's plan. */
const PLAN = new Map();
function planFor(kpId, form) {
  const key = `${kpId}|${form}`;
  if (!PLAN.has(key)) PLAN.set(key, bestFixed(servedPool(kpId, form, { honourRefusals: true, n: 60 })).answer ?? "0");
  return PLAN.get(key);
}

function runOne(kind, seed) {
  const rng = mulberry32(seed);
  const clock = virtualClock(0);
  const mastery = new Mastery(GRAPH, { bankAudit: AUDIT, now: () => clock.minutes(), emit: () => {}, storage: null });
  const sched = new Scheduler(mastery, { clock, rng: mulberry32(seed ^ 0x9e3779b9), sessionMinutes: SESSION_MINUTES });
  const exclude = new Set();
  const known = new Map();
  for (const id of GRAPH.ids) {
    const b = GRAPH.band(id);
    known.set(id, kind === "median" ? rng() < b.prior : false);
  }
  let served = 0;
  let right = 0;
  let seq = 0;
  for (let s = 0; s < SESSIONS; s += 1) {
    clock.set(s * 1440);
    sched.beginSession();
    for (;;) {
      const req = sched.next();
      if (!req) break;
      const item = liveItem(req, exclude, seq++);
      if (!item) break;
      exclude.add(item.id);
      if (exclude.size > 4000) exclude.clear();

      let response;
      let hinted = req.hinted;
      let latency = 5000 + Math.floor(rng() * 6000);

      if (kind === "median") {
        // Teaching happens on every exposure, scaffolded or not.
        if (!known.get(req.kpId) && rng() < GRAPH.band(req.kpId).learn) known.set(req.kpId, true);
        if (known.get(req.kpId)) {
          response = rng() < GRAPH.band(req.kpId).slip ? planFor(req.kpId, req.form) : String(bank.accepts(item)[0]);
        } else {
          response = planFor(req.kpId, req.form);
        }
      } else if (kind === "guesser") {
        // Coin-flip guesser: picks uniformly from its own repertoire plus the cell's best plan.
        const rep = [planFor(req.kpId, req.form), ...STAPLES];
        response = rep[Math.floor(rng() * rep.length) % rep.length];
      } else if (kind === "bestFixedGuesser") {
        response = planFor(req.kpId, req.form);
      } else if (kind === "hintAbuser") {
        // Strongest possible: idles past the hint surface, then answers correctly EVERY time.
        response = String(bank.accepts(item)[0]);
        hinted = true;
        latency = A.hintSurfaceMs + 2000;
      }

      let correct = false;
      try {
        correct = bank.check(item, response).correct === true;
      } catch { correct = false; }
      served += 1;
      if (correct) right += 1;
      sched.submit(req, { correct, latencyMs: latency, hinted, itemId: item.id, family: item.family, response });
    }
    sched.endSession();
  }
  const sum = mastery.summary();
  return {
    mastered: sum.mastered,
    level1Percent: sum.level1Percent,
    unlocked: sum.unlocked,
    gateOpens: mastery.stats.gateOpens,
    served,
    right,
    rawRate: served ? right / served : 0,
    scoredItems: mastery.stats.scoredItems,
    unscoredItems: mastery.stats.unscoredItems,
    refusedUpward: mastery.stats.refusedUpward,
  };
}

function cohort(kind, n, seed0) {
  const rows = [];
  for (let i = 0; i < n; i += 1) rows.push(runOne(kind, (seed0 + i * 7919) >>> 0));
  const pctl = (arr, q) => {
    const v = [...arr].sort((a, b) => a - b);
    return v[Math.min(v.length - 1, Math.floor(q * v.length))];
  };
  const lvl = rows.map((r) => r.level1Percent);
  return {
    kind,
    n,
    median: pctl(lvl, 0.5),
    p10: pctl(lvl, 0.1),
    meanMastered: rows.reduce((a, r) => a + r.mastered, 0) / n,
    maxMastered: Math.max(...rows.map((r) => r.mastered)),
    meanGateOpens: rows.reduce((a, r) => a + r.gateOpens, 0) / n,
    shareAt80: rows.filter((r) => r.level1Percent >= 80).length / n,
    rawRate: rows.reduce((a, r) => a + r.rawRate, 0) / n,
    meanServed: rows.reduce((a, r) => a + r.served, 0) / n,
    meanScored: rows.reduce((a, r) => a + r.scoredItems, 0) / n,
    meanRefusedUpward: rows.reduce((a, r) => a + r.refusedUpward, 0) / n,
  };
}

const LEARNERS = Number(process.env.CRITIC_LEARNERS ?? 40);
const BOTS = Number(process.env.CRITIC_BOTS ?? 40);

say(`\nPART 2 — cohorts on the REAL Scheduler + REAL ItemBank (${SESSIONS} sessions x ${SESSION_MINUTES} min)`);
const med = cohort("median", LEARNERS, 20260810);
const gue = cohort("guesser", BOTS, 909091);
const bfg = cohort("bestFixedGuesser", BOTS, 313133);
const hab = cohort("hintAbuser", Math.min(BOTS, 20), 424243);
for (const c of [med, gue, bfg, hab]) {
  say(
    `${c.kind.padEnd(18)} n=${String(c.n).padEnd(4)} median L1 ${String(c.median.toFixed(1)).padStart(6)}%  p10 ${String(c.p10.toFixed(1)).padStart(6)}%  ` +
      `>=80%: ${pct(c.shareAt80).padStart(6)}  mean certified ${c.meanMastered.toFixed(3)}/32 (max ${c.maxMastered})  ` +
      `gateOpens ${c.meanGateOpens.toFixed(2)}  raw item accuracy ${pct(c.rawRate)} on ${c.meanServed.toFixed(0)} items  refusedUpward ${c.meanRefusedUpward.toFixed(1)}`
  );
}

// =================================================================== PART 3 — cycle
say("\nPART 3 — feed the graph a cycle");
const clone = JSON.parse(JSON.stringify(SRC));
const a = clone.nodes[0].id;
const b = clone.nodes.find((n) => (n.prerequisites ?? []).includes(a))?.id ?? clone.nodes[1].id;
clone.nodes.find((n) => n.id === a).prerequisites = [b];
try {
  new Graph(clone);
  say("FAIL — a cyclic graph constructed without throwing");
} catch (err) {
  say(`threw ${err.name}: ${String(err.message).split("\n").slice(0, 3).join(" | ")}`);
  say(`GraphError? ${err instanceof GraphError} · issues listed: ${err.issues?.length ?? 0}`);
}

// A cycle that is NOT reachable from the declaration-order first node either.
const clone2 = JSON.parse(JSON.stringify(SRC));
const n1 = clone2.nodes[clone2.nodes.length - 1];
const n2 = clone2.nodes[clone2.nodes.length - 2];
n1.prerequisites = [n2.id];
n2.prerequisites = [n1.id];
try {
  new Graph(clone2);
  say("FAIL — a two-node cycle at the tail constructed without throwing");
} catch (err) {
  say(`tail cycle threw ${err.name}: ${String(err.message).split("\n").find((l) => l.includes("CYCLIC")) ?? "(no CYCLIC line)"}`);
}
say("\ndone.");
