/**
 * P03 — knowledge graph validator.
 *
 * Proves the two hard properties the piece is judged on:
 *   1. the prerequisite relation is a DAG (acyclic), and
 *   2. it is transitively reduced (no edge u->v that is already implied by a longer path u~>v).
 *
 * Also audits schema completeness, standards coverage, band monotonicity, misconception hygiene,
 * FORM SCORABILITY — it recomputes from the band parameters, the modelled guess multipliers, the
 * true blind-success rates and the identifiability caps which item forms are allowed into the
 * scored path, and fails if that derivation disagrees with the arrays the engine will actually
 * read — and, added in round 3, CONCEPT REQUIREMENTS.
 *
 * That last one is the check whose absence let round 2 ship a real ordering error. Every check
 * above it asks whether the graph has a good SHAPE. None of them asked whether a node's items
 * need a concept the graph has not promised to teach yet, which is the first question a maths
 * teacher asks. `like-terms-id` was gated only on `expr-anatomy` while its own third misconception
 * built an item over a·x, b·x², c·x, d·x², e — an exponent on a letter that nothing in its
 * ancestor closure had ever explained. The lint below ties what an item ACTUALLY requires to what
 * the graph GUARANTEES has been taught, and fails the build when they disagree.
 *
 * A regression in any of those fails loudly instead of quietly shipping.
 *
 *   node review/p03/kg-validate.mjs
 *
 * Exit code 0 = every check passed. Exit code 1 = at least one failure.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { collisionScan } from "./signature-collide.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");

const graph = JSON.parse(readFileSync(resolve(root, "content/knowledge-graph.json"), "utf8"));
const standards = JSON.parse(readFileSync(resolve(root, "content/standards.json"), "utf8"));

const nodes = graph.nodes;
const byId = new Map(nodes.map((n) => [n.id, n]));

const failures = [];
const lines = [];
const say = (s = "") => lines.push(s);
const fail = (s) => {
  failures.push(s);
  lines.push(`  FAIL  ${s}`);
};

// ---------------------------------------------------------------- schema ----
say("== schema ==");
const required = [
  "id",
  "title",
  "shortTitle",
  "description",
  "prerequisites",
  "difficulty",
  "estMinutes",
  "misconceptions",
  "standards",
  "worldHook",
];
const seenIds = new Set();
const seenMisc = new Set();
for (const n of nodes) {
  for (const key of required) {
    if (n[key] === undefined) fail(`node "${n.id}" is missing "${key}"`);
  }
  if (seenIds.has(n.id)) fail(`duplicate node id "${n.id}"`);
  seenIds.add(n.id);
  if (!Number.isInteger(n.difficulty) || n.difficulty < 1 || n.difficulty > 5)
    fail(`node "${n.id}" difficulty ${n.difficulty} out of range 1..5`);
  if (!(n.estMinutes > 0)) fail(`node "${n.id}" estMinutes must be positive`);
  if (!Array.isArray(n.misconceptions) || n.misconceptions.length < 2)
    fail(`node "${n.id}" needs at least 2 misconceptions`);
  for (const m of n.misconceptions ?? []) {
    if (!m.id || !m.description || !m.diagnosticSignature)
      fail(`node "${n.id}" misconception "${m.id}" is incomplete`);
    if (seenMisc.has(m.id)) fail(`duplicate misconception id "${m.id}"`);
    seenMisc.add(m.id);
  }
  if (n.strand && !graph.strands.some((s) => s.id === n.strand))
    fail(`node "${n.id}" names unknown strand "${n.strand}"`);
  if (typeof n.worldHook !== "string" || n.worldHook.length < 30)
    fail(`node "${n.id}" worldHook is too thin to build a verb from`);
}
say(`  ${nodes.length} nodes, ${seenMisc.size} distinct misconceptions`);
if (nodes.length < 22 || nodes.length > 32)
  fail(`node count ${nodes.length} outside the required 22..32`);

// --------------------------------------------- misconception separability ---
// Two misconceptions on the same node that carry the same diagnosticSignature cannot be told
// apart from a response, so L7 ("feedback specific to the misconception") is unachievable on
// that node no matter how good the item bank is. Byte-identical signatures anywhere in the
// file are also a smell: the item stems use different parameter letters per node, so an exact
// match across nodes means one of them was pasted rather than derived.
say("");
say("== misconception separability ==");
const sigOwners = new Map();
let dupWithin = 0;
let dupAcross = 0;
for (const n of nodes) {
  const local = new Map();
  for (const m of n.misconceptions ?? []) {
    const sig = (m.diagnosticSignature ?? "").trim();
    if (local.has(sig)) {
      dupWithin++;
      fail(
        `node "${n.id}": misconceptions "${local.get(sig)}" and "${m.id}" share a diagnosticSignature verbatim — they are not separable, so wrong-answer feedback cannot tell them apart`
      );
    } else local.set(sig, m.id);
    if (sigOwners.has(sig) && sigOwners.get(sig).node !== n.id) {
      dupAcross++;
      const o = sigOwners.get(sig);
      fail(`diagnosticSignature is byte-identical across nodes: "${o.node}/${o.misc}" and "${n.id}/${m.id}"`);
    } else if (!sigOwners.has(sig)) sigOwners.set(sig, { node: n.id, misc: m.id });
  }
}
if (dupWithin === 0 && dupAcross === 0)
  say(`  PASS  all ${seenMisc.size} diagnostic signatures are distinct, within nodes and across them`);

// The item bank builds items from these signatures. A signature phrased as a yes/no or a
// pick-one gets served as judge2 or select4 — forms whose true blind-success rate is 0.50 and
// 0.25 — and the mastery gate leaks through them. This lint is the reason round 2 exists.
say("");
say("== signature form lint (constructed response only) ==");
const binaryShapes = [
  { re: /response\s*==\s*(true|false)\b/i, why: "response is a boolean — that is a judge2 item" },
  { re: /->\s*response\s*==\s*['"]?(yes|no)['"]?\s*$/i, why: "response is yes/no — that is a judge2 item" },
  { re: /item:\s*'?(is|are|does|do|can|will|should)\b/i, why: "item stem is a closed question — that is a judge2 item" },
  { re: /\btrue or false\b/i, why: "explicit true/false framing" },
  { re: /\bpick (one|the)\b|\bchoose (one|the)\b|\bwhich of the (four|following)\b/i, why: "pick-one framing — that is a select4 item" },
];
let binaryHits = 0;
for (const n of nodes) {
  for (const m of n.misconceptions ?? []) {
    for (const shape of binaryShapes) {
      if (shape.re.test(m.diagnosticSignature)) {
        binaryHits++;
        fail(`node "${n.id}" misconception "${m.id}": ${shape.why}. Rewrite it as a constructed response.`);
        break;
      }
    }
  }
}
if (binaryHits === 0)
  say(`  PASS  no signature is phrased as a yes/no or a pick-one; every one is evaluable from a constructed response`);

// --------------------------------------------------------- edge integrity ---
say("");
say("== prerequisite edges ==");
let edgeCount = 0;
for (const n of nodes) {
  const seen = new Set();
  for (const p of n.prerequisites) {
    edgeCount++;
    if (!byId.has(p)) fail(`node "${n.id}" lists unknown prerequisite "${p}"`);
    if (p === n.id) fail(`node "${n.id}" is its own prerequisite`);
    if (seen.has(p)) fail(`node "${n.id}" lists prerequisite "${p}" twice`);
    seen.add(p);
  }
}
say(`  ${edgeCount} edges over ${nodes.length} nodes`);

// ------------------------------------------------------------- acyclicity ---
// Kahn's algorithm. If every node can be peeled off, no cycle exists. If not,
// the survivors are exactly the nodes on or downstream of a cycle, and we walk
// one concrete cycle out of them so the failure is actionable.
say("");
say("== property 1: acyclic ==");
const indeg = new Map(nodes.map((n) => [n.id, 0]));
const out = new Map(nodes.map((n) => [n.id, []]));
for (const n of nodes) {
  for (const p of n.prerequisites) {
    if (!byId.has(p)) continue;
    indeg.set(n.id, indeg.get(n.id) + 1);
    out.get(p).push(n.id);
  }
}
const queue = [...indeg].filter(([, d]) => d === 0).map(([id]) => id);
const topo = [];
const level = new Map();
for (const id of queue) level.set(id, 0);
while (queue.length) {
  const id = queue.shift();
  topo.push(id);
  for (const next of out.get(id)) {
    level.set(next, Math.max(level.get(next) ?? 0, level.get(id) + 1));
    indeg.set(next, indeg.get(next) - 1);
    if (indeg.get(next) === 0) queue.push(next);
  }
}
if (topo.length !== nodes.length) {
  const stuck = nodes.map((n) => n.id).filter((id) => !topo.includes(id));
  fail(`cycle present; ${stuck.length} nodes never reached zero in-degree: ${stuck.join(", ")}`);
} else {
  say(`  PASS  Kahn peeled all ${topo.length} nodes; no cycle exists`);
}

// ---------------------------------------------------- transitive reduction --
// Reachability by DFS over the prerequisite closure. Edge u->v is redundant iff
// v is reachable from u through some path of length >= 2.
say("");
say("== property 2: transitively reduced ==");
const succ = out; // u -> [nodes that list u as a prerequisite]
const reachableFrom = new Map();
function reach(id) {
  if (reachableFrom.has(id)) return reachableFrom.get(id);
  const set = new Set();
  reachableFrom.set(id, set); // guards against re-entry; graph is acyclic so this is safe
  for (const next of succ.get(id)) {
    set.add(next);
    for (const deep of reach(next)) set.add(deep);
  }
  return set;
}
for (const n of nodes) reach(n.id);

let redundant = 0;
for (const n of nodes) {
  for (const p of n.prerequisites) {
    if (!byId.has(p)) continue;
    // Is there a path p ~> n of length >= 2? Look for an intermediate m with
    // p -> ... -> m -> n where m !== p.
    for (const m of succ.get(p)) {
      if (m === n.id) continue;
      if (m === p) continue;
      if (reach(m).has(n.id)) {
        redundant++;
        fail(`redundant edge "${p}" -> "${n.id}": already implied via "${m}"`);
        break;
      }
    }
  }
}
if (redundant === 0) say(`  PASS  no edge is implied transitively; the graph is its own transitive reduction`);

// ------------------------------------------- concept requirements (closure) --
// Everything above checks the SHAPE of the graph: that it is acyclic, reduced, band-monotone,
// standards-mapped, and that its signatures are constructed-response. None of that asks the one
// question a maths teacher asks first — DOES THIS ITEM NEED SOMETHING THE GRAPH HAS NOT PROMISED
// TO TEACH YET? Round 2 shipped without this lint and shipped `like-terms-id` gated only on
// `expr-anatomy`, whose whole ancestor closure was {var-meaning, expr-anatomy}: a node whose own
// third misconception builds an item asking the learner to sort a·x, b·x², c·x, d·x², e into weld
// groups, when nothing upstream had ever said what an exponent on a letter means. The learner met
// x² for the first time inside a scored item that punished them for misreading it.
//
// A misconception is not documentation. The item bank builds a SCORED item out of its
// `diagnosticSignature`, so every mathematical object named there is an object the learner is
// about to be graded on. If the graph does not guarantee that object has been taught before the
// node unlocks, then §5 of design/learning-architecture.md — "an item is never a wall built of an
// earlier gap" — is false for that node.
//
// The rule: for each concept below, a node whose misconception text uses the concept's tokens must
// either BE the node that teaches it, or have that node in its transitive ANCESTOR closure.
//
// Scope is deliberate. The primary surface is the misconception text (description +
// diagnosticSignature), because that is what becomes an item. A concept may also declare a
// stricter `descriptionTokens` pattern that is additionally applied to the node's own description
// — stricter, because the loose form over-fires: `oo-numeric` legitimately says the word
// "exponents" while teaching 2³, and a lint that flagged it would have trained the next builder to
// weaken the rule instead of the graph. Every pattern here is narrow enough that the only
// exemption in the table is the teaching node itself.
say("");
say("== concept requirements: does an item need something the graph has not taught? ==");

/** Transitive ancestor closure over an arbitrary node list, so the control arm below can be run
 *  against a mutated copy of the graph without touching the real one. */
function ancestorMap(nodeList) {
  const index = new Map(nodeList.map((n) => [n.id, n]));
  const memo = new Map();
  const walk = (id) => {
    if (memo.has(id)) return memo.get(id);
    const set = new Set();
    memo.set(id, set);
    for (const p of index.get(id)?.prerequisites ?? []) {
      if (!index.has(p)) continue;
      set.add(p);
      for (const up of walk(p)) set.add(up);
    }
    return set;
  };
  for (const n of nodeList) walk(n.id);
  return memo;
}

const conceptRequirements = [
  {
    id: "variable-exponent",
    teaches: "oo-structure",
    // a letter carrying a power, or the words that can only mean one
    tokens: /([a-z]\s*[²³]|[a-z]\s*\^\s*[2-9]|\bexponent|\bsquared\b|\bcubed\b|raised to|same power)/i,
    descriptionTokens: /([a-z]\s*[²³]|[a-z]\s*\^\s*[2-9]|raised to|same power)/i,
    why: "an item that shows x² asks the learner to read a power on a letter; oo-structure is the only node that says 2x² means 2·(x·x) and that −x² is not (−x)²",
  },
  {
    id: "signed-value",
    teaches: "eval-signed",
    // a negative QUANTITY in play — not a subtraction sign, not a unary minus on a variable
    tokens: /(negative (number|value|coefficient|quantity|multiplier)|by a negative|subtract\w*\s+a\s+negative|substitut\w*\s+(a\s+)?negative|=\s*[−-][a-z0-9]|two negatives|double negative)/i,
    why: "an item whose stem carries a negative quantity asks for signed arithmetic; eval-signed is the node that teaches a substituted negative arrives inside its own parentheses and that subtracting a negative adds",
  },
  {
    id: "distributive-property",
    teaches: "distribute-numeric",
    tokens: /\bdistribut/i,
    why: "an item that asks the learner to open or to withhold a bracket needs the distributive property to have been taught",
  },
  {
    id: "like-terms",
    teaches: "like-terms-id",
    tokens: /\b(un)?like terms?\b/i,
    why: "an item that turns on whether two terms are of the same kind needs the node that defines like terms",
  },
];

/** Returns { fired, gaps } for a node list. Pure: no side effects, so it can be pointed at a
 *  mutated copy of the graph. `gaps` is the list this file exists to keep empty. */
function conceptAudit(nodeList) {
  const anc = ancestorMap(nodeList);
  const index = new Map(nodeList.map((n) => [n.id, n]));
  const fired = [];
  const gaps = [];
  for (const req of conceptRequirements) {
    if (!index.has(req.teaches)) {
      gaps.push({ req, node: req.teaches, missingTeacher: true });
      continue;
    }
    for (const n of nodeList) {
      const hits = (n.misconceptions ?? [])
        .filter((m) => req.tokens.test(`${m.description} ${m.diagnosticSignature}`))
        .map((m) => m.id);
      const descHit = req.descriptionTokens ? req.descriptionTokens.test(n.description) : false;
      if (!hits.length && !descHit) continue;
      const ok = n.id === req.teaches || anc.get(n.id).has(req.teaches);
      const rec = { req, node: n.id, hits, descHit, ok, closure: [...anc.get(n.id)] };
      fired.push(rec);
      if (!ok) gaps.push(rec);
    }
  }
  return { fired, gaps };
}

const live = conceptAudit(nodes);
for (const req of conceptRequirements) {
  const rows = live.fired.filter((f) => f.req.id === req.id);
  say(
    `  ${req.id.padEnd(22)} -> requires ${req.teaches.padEnd(18)} fires on ${String(rows.length).padStart(2)} node(s): ${rows.map((f) => `${f.node}${f.ok ? "" : " <<< GAP"}`).join(", ")}`
  );
}
for (const g of live.gaps) {
  if (g.missingTeacher) {
    fail(`concept requirement "${g.req.id}" names teaching node "${g.req.teaches}" which is not in the graph`);
    continue;
  }
  const where = `${g.descHit ? "its description" : ""}${g.descHit && g.hits.length ? " and " : ""}${g.hits.length ? `misconception${g.hits.length > 1 ? "s" : ""} ${g.hits.join(", ")}` : ""}`;
  fail(
    `node "${g.node}" requires the concept "${g.req.id}" (${where}) but "${g.req.teaches}" is NOT in its ancestor closure {${g.closure.join(", ")}}. ${g.req.why}. Add "${g.req.teaches}" to the prerequisites of "${g.node}" or of one of its ancestors.`
  );
}
if (live.gaps.length === 0)
  say(`  PASS  every node whose items need a concept has that concept's teaching node in its ancestor closure`);

// --- control arm: prove the lint can SEE a gap, not merely fail to find one ------------------
// A check that only ever reports zero is worth nothing; you cannot tell a clean graph from a
// broken detector. So run the same audit against a copy of the graph carrying the exact round-2
// prerequisites, where three gaps are known to exist, and fail the build if it does not find them.
// This is the same discipline mastery-sim.mjs uses when it keeps the leaking legacy rules running
// as a control.
const ROUND2 = {
  "like-terms-id": ["expr-anatomy"],
  "ineq-one-step": ["ineq-meaning", "eq-one-add", "eq-one-mult"],
  "ineq-negative-flip": ["ineq-one-step", "eval-signed"],
};
const EXPECTED_ROUND2_GAPS = [
  "variable-exponent/like-terms-id",
  "variable-exponent/like-terms-combine",
  "signed-value/ineq-one-step",
];
const round2Nodes = nodes.map((n) =>
  ROUND2[n.id] ? { ...n, prerequisites: ROUND2[n.id] } : n
);
const control = conceptAudit(round2Nodes);
const controlKeys = control.gaps.map((g) => `${g.req.id}/${g.node}`).sort();
const expectedKeys = [...EXPECTED_ROUND2_GAPS].sort();
const controlOk =
  controlKeys.length === expectedKeys.length && controlKeys.every((k, i) => k === expectedKeys[i]);
say(
  `  control arm (round-2 prerequisites re-injected): ${controlKeys.length} gap(s) detected — ${controlKeys.join(", ") || "(none)"}`
);
if (!controlOk)
  fail(
    `the concept lint failed its own control arm: expected exactly [${expectedKeys.join(", ")}] against the round-2 prerequisites, got [${controlKeys.join(", ")}]. A lint that cannot reproduce the failure it was written for is not measuring anything.`
  );
else say(`  PASS  the lint reproduces all ${expectedKeys.length} round-2 gaps when they are re-injected, and none on the shipped graph`);

// ---------------------------------------------------- form scorability -----
// Recomputed from first principles, not read from the file. A form may enter the scored path
// only if, for EVERY difficulty band:
//   (a) its true blind-success rate is at or below maxTrueGuess;
//   (b) trueGuess + maxSlip stays strictly under maxSlipPlusGuess, so BKT stays identifiable;
//   (c) the MODELLED guess (band.guess x guessByForm) is at least the TRUE guess, so a correct
//       response never moves P(known) further than the truth warrants — conservatism;
//   (d) that modelled guess itself respects maxGuess and maxSlipPlusGuess with no clamping.
// Clamping an over-cap rate down to the cap (the round-1 behaviour) is explicitly a failure:
// it is how a coin flip gets credited at 0.30 when it is worth 0.50.
say("");
say("== form scorability (derived from the caps, not read from the file) ==");
const M = graph.model;
const caps = M.bkt.identifiabilityCaps;
const bands = M.bands;
const allForms = Object.keys(M.trueGuessByForm).filter((k) => typeof M.trueGuessByForm[k] === "number");
const derivedScorable = [];
for (const form of allForms) {
  const tg = M.trueGuessByForm[form];
  const mult = M.guessByForm[form];
  const reasons = [];
  if (typeof mult !== "number") reasons.push(`no guessByForm multiplier`);
  if (tg > caps.maxTrueGuess) reasons.push(`trueGuess ${tg} > maxTrueGuess ${caps.maxTrueGuess}`);
  if (tg + caps.maxSlip >= caps.maxSlipPlusGuess)
    reasons.push(`trueGuess + maxSlip = ${(tg + caps.maxSlip).toFixed(2)} >= maxSlipPlusGuess ${caps.maxSlipPlusGuess}`);
  for (const b of bands) {
    const modelled = b.guess * (mult ?? 0);
    if (modelled < tg)
      reasons.push(`band ${b.difficulty}: modelled guess ${modelled.toFixed(3)} < trueGuess ${tg} (credits luck as knowledge)`);
    if (modelled > caps.maxGuess) reasons.push(`band ${b.difficulty}: modelled guess ${modelled.toFixed(3)} > maxGuess ${caps.maxGuess}`);
    if (modelled + b.slip >= caps.maxSlipPlusGuess)
      reasons.push(`band ${b.difficulty}: modelled guess + slip = ${(modelled + b.slip).toFixed(3)} >= ${caps.maxSlipPlusGuess}`);
  }
  const ok = reasons.length === 0;
  if (ok) derivedScorable.push(form);
  say(
    `  ${form.padEnd(10)} trueGuess ${String(tg).padEnd(5)} modelled ${bands.map((b) => (b.guess * (mult ?? 0)).toFixed(3)).join("/")}  -> ${ok ? "SCORABLE" : "NOT SCORABLE"}`
  );
  if (!ok) say(`      ${reasons.slice(0, 2).join("; ")}${reasons.length > 2 ? ` (+${reasons.length - 2} more)` : ""}`);
}
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
if (!sameSet(derivedScorable, M.forms.scored))
  fail(`model.forms.scored is [${M.forms.scored.join(", ")}] but the caps derive [${derivedScorable.join(", ")}]`);
else say(`  PASS  model.forms.scored matches the derivation: [${derivedScorable.join(", ")}]`);
if (!sameSet(derivedScorable, M.bkt.formsEligibleForMastery))
  fail(
    `model.bkt.formsEligibleForMastery is [${M.bkt.formsEligibleForMastery.join(", ")}] but the caps derive [${derivedScorable.join(", ")}]`
  );
else say(`  PASS  model.bkt.formsEligibleForMastery matches the derivation`);
for (const form of M.forms.unscored ?? [])
  if (derivedScorable.includes(form)) fail(`form "${form}" is listed as unscored but the derivation says it is scorable`);
if (caps.clampTrueRates !== false) fail(`identifiabilityCaps.clampTrueRates must be false — clamping an honest rate is the leak`);
if (M.bkt.minDistinctItemForms > M.bkt.formsEligibleForMastery.length)
  fail(`minDistinctItemForms ${M.bkt.minDistinctItemForms} exceeds the ${M.bkt.formsEligibleForMastery.length} eligible forms — the gate can never open`);

// -------------------------------------------------- phase scorability ------
// The SAME four rules, on the other axis. A form shrinks the answer space by how the question is
// asked; a teaching phase shrinks it by how much of the item the world has already done. Round 3
// ran the rules over forms only, priced every guided item at the unscaffolded `construct` rate,
// and thereby credited a hint-read at the price of a blind construction — the exact conservatism
// failure rule (c) exists to catch, committed on the axis nobody was looking at.
say("");
say("== phase scorability (same four rules, run over the teaching phase) ==");
const allPhases = Object.keys(M.trueGuessByPhase).filter((k) => typeof M.trueGuessByPhase[k] === "number");
const derivedScorablePhases = [];
for (const phase of allPhases) {
  const tg = M.trueGuessByPhase[phase];
  const mult = M.guessByPhase[phase];
  const reasons = [];
  if (typeof mult !== "number") reasons.push(`no guessByPhase multiplier`);
  if (tg > caps.maxTrueGuess) reasons.push(`trueGuess ${tg} > maxTrueGuess ${caps.maxTrueGuess}`);
  if (tg + caps.maxSlip >= caps.maxSlipPlusGuess)
    reasons.push(`trueGuess + maxSlip = ${(tg + caps.maxSlip).toFixed(2)} >= maxSlipPlusGuess ${caps.maxSlipPlusGuess}`);
  for (const b of bands) {
    const modelled = b.guess * (mult ?? 0);
    if (modelled < tg)
      reasons.push(`band ${b.difficulty}: modelled guess ${modelled.toFixed(3)} < trueGuess ${tg} (credits help as knowledge)`);
    if (modelled > caps.maxGuess) reasons.push(`band ${b.difficulty}: modelled guess ${modelled.toFixed(3)} > maxGuess ${caps.maxGuess}`);
    if (modelled + b.slip >= caps.maxSlipPlusGuess)
      reasons.push(`band ${b.difficulty}: modelled guess + slip = ${(modelled + b.slip).toFixed(3)} >= ${caps.maxSlipPlusGuess}`);
  }
  const ok = reasons.length === 0;
  if (ok) derivedScorablePhases.push(phase);
  say(
    `  ${phase.padEnd(10)} trueGuess ${String(tg).padEnd(5)} modelled ${bands.map((b) => (b.guess * (mult ?? 0)).toFixed(3)).join("/")}  -> ${ok ? "SCORABLE" : "NOT SCORABLE"}`
  );
  if (!ok) {
    say(`      ${reasons.slice(0, 2).join("; ")}${reasons.length > 2 ? ` (+${reasons.length - 2} more)` : ""}`);
    // Is the rejection STRUCTURAL, or would some other multiplier rescue it? That is the select4
    // argument and it has to be re-run per phase rather than assumed.
    const needAtBand1 = tg / bands[0].guess;
    const allowedAtBand5 = caps.maxGuess / bands[bands.length - 1].guess;
    const rescuable = tg <= caps.maxTrueGuess && tg + caps.maxSlip < caps.maxSlipPlusGuess && needAtBand1 <= allowedAtBand5;
    say(
      `      no multiplier fixes it: conservatism at band 1 needs x${needAtBand1.toFixed(2)}, maxGuess at band 5 allows at most x${allowedAtBand5.toFixed(2)} -> ${rescuable ? "REPAIRABLE (so the exclusion is a choice, not a derivation)" : "STRUCTURALLY EXCLUDED"}`
    );
    if (rescuable)
      fail(`phase "${phase}" is excluded but a multiplier in [${needAtBand1.toFixed(2)}, ${allowedAtBand5.toFixed(2)}] would make it scorable — say why it is out, or let it in`);
  }
  // The round-3 price, printed for every phase whether it passes or not: what this phase cost
  // when the engine priced it by FORM ALONE. That is the leak, in the currency it leaked in.
  const r3 = bands.map((b) => b.guess * (M.guessByForm[M.forms.beforeThreshold] ?? 1));
  const r3Fails = bands.filter((b, i) => r3[i] < tg).map((b) => b.difficulty);
  if (r3Fails.length)
    say(
      `      round-3 price (form only, ${M.forms.beforeThreshold}): ${r3.map((v) => v.toFixed(3)).join("/")} against a true ${tg} -> conservatism failed at band(s) ${r3Fails.join(", ")}`
    );
}
if (!sameSet(derivedScorablePhases, M.phases.scored))
  fail(`model.phases.scored is [${M.phases.scored.join(", ")}] but the caps derive [${derivedScorablePhases.join(", ")}]`);
else say(`  PASS  model.phases.scored matches the derivation: [${derivedScorablePhases.join(", ")}]`);
for (const phase of M.phases.unscored ?? [])
  if (derivedScorablePhases.includes(phase)) fail(`phase "${phase}" is listed as unscored but the derivation says it is scorable`);
if (!M.phases.scored.includes("solo")) fail(`phase "solo" must be scorable — nothing else can be`);
// Mastery eligibility is STRICTER than scorability on this axis, and that has to be true rather
// than merely stated: a phase may count toward M2/M3 only if it gives the learner nothing at all.
for (const phase of M.bkt.phasesEligibleForMastery) {
  if (!derivedScorablePhases.includes(phase))
    fail(`phasesEligibleForMastery contains "${phase}", which the derivation says is not even scorable`);
  if ((M.trueGuessByPhase[phase] ?? 1) > 0)
    fail(
      `phasesEligibleForMastery contains "${phase}", whose true blind rate is ${M.trueGuessByPhase[phase]} > 0 — M2 and M3 may only count opportunities where the world contributed nothing to the answer space`
    );
  if (M.phases.hinted?.[phase] !== false) fail(`phasesEligibleForMastery contains "${phase}", which is flagged hinted`);
}
say(
  `  PASS  M2/M3 count phases [${M.bkt.phasesEligibleForMastery.join(", ")}] only — every one contributes 0.00 to the blind rate and is unhinted`
);

// -------------------------------------------------- the composed matrix ----
// What P16 actually implements is a PAIR, and the pair is what has to clear the rules:
//   trueGuess(form, phase)     = max(trueGuessByForm[form], trueGuessByPhase[phase])
//   modelledGuess(b, f, phase) = b.guess x max(guessByForm[f], guessByPhase[phase])
// Composition is by max, not by product: a scaffold puts a floor under blind success, and a
// product would let generate's x0.6 undercut the scaffold floor.
say("");
say("== composed (form x phase) scorability matrix ==");
const pairOK = (form, phase) => {
  const tg = Math.max(M.trueGuessByForm[form], M.trueGuessByPhase[phase]);
  const mult = Math.max(M.guessByForm[form] ?? 0, M.guessByPhase[phase] ?? 0);
  if (tg > caps.maxTrueGuess) return false;
  if (tg + caps.maxSlip >= caps.maxSlipPlusGuess) return false;
  for (const b of bands) {
    const modelled = b.guess * mult;
    if (modelled < tg || modelled > caps.maxGuess || modelled + b.slip >= caps.maxSlipPlusGuess) return false;
  }
  return true;
};
const scorablePairs = [];
say(`  ${"".padEnd(10)} ${allPhases.map((p) => p.padStart(9)).join("")}`);
for (const form of allForms) {
  const cells = allPhases.map((phase) => {
    const ok = pairOK(form, phase);
    if (ok) scorablePairs.push(`${form}/${phase}`);
    return (ok ? "yes" : "-").padStart(9);
  });
  say(`  ${form.padEnd(10)} ${cells.join("")}`);
}
const expectedPairs = [];
for (const f of derivedScorable) for (const p of derivedScorablePhases) expectedPairs.push(`${f}/${p}`);
if (!sameSet(scorablePairs, expectedPairs))
  fail(
    `the composed matrix derives ${scorablePairs.length} scorable cells but the per-axis derivations imply ${expectedPairs.length}: [${scorablePairs.filter((x) => !expectedPairs.includes(x)).join(", ")}] / [${expectedPairs.filter((x) => !scorablePairs.includes(x)).join(", ")}]`
  );
else
  say(
    `  PASS  ${scorablePairs.length} of ${allForms.length * allPhases.length} cells scorable, exactly the product of the two axes; ${derivedScorable.length * M.bkt.phasesEligibleForMastery.length} of them are mastery-eligible`
  );

// Every scored surface must draw its forms from the eligible set. Three separate surfaces,
// three separate chances for an engineer to reach for a quick yes/no confirmation.
const surfaces = [
  ["spacing.consolidation.forms", M.spacing.consolidation?.forms],
  ["spacing.retentionCheck.forms", M.spacing.retentionCheck?.forms],
  ["spacing.review.forms", M.spacing.review?.forms],
  ["forms.order", M.forms.order],
];
let surfaceFaults = 0;
for (const [name, list] of surfaces) {
  if (!Array.isArray(list) || list.length === 0) {
    surfaceFaults++;
    fail(`${name} is missing — a scored surface with no declared form list is a leak waiting to happen`);
    continue;
  }
  const bad = list.filter((f) => !M.bkt.formsEligibleForMastery.includes(f));
  if (bad.length) {
    surfaceFaults++;
    fail(`${name} contains non-eligible form(s): ${bad.join(", ")}`);
  }
}
if (surfaceFaults === 0) say(`  PASS  all ${surfaces.length} scored surfaces draw only from the eligible forms`);

// ...and the same three surfaces must pin the PHASE, for the same reason. A retention check that
// runs at guided-3 is a retention check with the answer printed on it.
let phaseSurfaceFaults = 0;
for (const [name, block] of [
  ["spacing.consolidation", M.spacing.consolidation],
  ["spacing.retentionCheck", M.spacing.retentionCheck],
  ["spacing.review", M.spacing.review],
]) {
  if (!block || block.phase === undefined) {
    phaseSurfaceFaults++;
    fail(`${name}.phase is undefined — a scored surface with no declared phase inherits whatever the director last set`);
    continue;
  }
  if (!M.bkt.phasesEligibleForMastery.includes(block.phase)) {
    phaseSurfaceFaults++;
    fail(`${name}.phase is "${block.phase}", which is not mastery-eligible`);
  }
  if (block.hinted !== false) {
    phaseSurfaceFaults++;
    fail(`${name}.hinted must be false`);
  }
}
if (phaseSurfaceFaults === 0)
  say(`  PASS  consolidation, retention and review all pinned to phase "${M.spacing.retentionCheck.phase}", hinted false`);

// The help axis of the anti-gaming rules. Without hintedCorrectPolicy the latency floor makes
// IDLING strictly dominant: fast-and-right is refused, slow-and-right-after-the-hint is not.
say("");
say("== anti-gaming: speed and help are priced symmetrically ==");
const ag = M.antiGuessing ?? {};
let agFaults = 0;
for (const [name, want] of [
  ["fastCorrectPolicy", "not-scored-upward"],
  ["hintedCorrectPolicy", "not-scored-upward"],
  ["fastWrongPolicy", "scored-normally"],
  ["hintedWrongPolicy", "scored-normally"],
]) {
  if (ag[name] !== want) {
    agFaults++;
    fail(`antiGuessing.${name} must be "${want}" — otherwise ${name.startsWith("hinted") ? "waiting for the hint" : "answering instantly"} pays`);
  }
}
if (typeof ag.hintSurfaceMs !== "number" || ag.hintSurfaceMs <= 0) {
  agFaults++;
  fail(`antiGuessing.hintSurfaceMs must be a positive number — the engine cannot flag a hinted response without knowing when the hint appears`);
}
if (agFaults === 0)
  say(
    `  PASS  latency floor ${ag.latencyFloorMs} ms + ${ag.latencyPerTokenMs} ms/token and hint surface ${ag.hintSurfaceMs} ms both resolve to "${ag.fastCorrectPolicy}" on a correct response and "${ag.fastWrongPolicy}" on a wrong one`
  );
// Two policies, and confusing them is a measured 34-point mistake. What the DIRECTOR chose is
// inert both ways; what the LEARNER chose is refused upward only.
if (M.phases?.unscoredPolicy !== "inert")
  fail(
    `model.phases.unscoredPolicy must be "inert": a scaffold the DIRECTOR chose measures learner-plus-scaffold, not learner, so it must record nothing in either direction. Scoring its wrong answers punishes a learner for being taught and cost 34 points of median Level 1 mastery when it was tried.`
  );
else
  say(
    `  PASS  a director-chosen scaffold is inert both ways; a learner-chosen shortcut (fast, or hinted) is refused upward only`
  );

// The gate fields P16 implements §2 from must exist in the JSON, not only in the prose. Two of
// them were implicit in round 2: consolidation had no pass requirement written anywhere (so
// "a consolidation pass" read as a gate that is not one), and the retention check's re-assertion
// of the mastery threshold lived only in the simulation source. An engineer building "§2 exactly"
// from the JSON has to be able to see both.
const gateFields = [
  ["spacing.consolidation.passAtLeast", M.spacing.consolidation?.passAtLeast],
  ["spacing.retentionCheck.passAtLeast", M.spacing.retentionCheck?.passAtLeast],
  ["spacing.retentionCheck.requiresThresholdAtCheck", M.spacing.retentionCheck?.requiresThresholdAtCheck],
  ["forms.cycleIndexedOn", M.forms?.cycleIndexedOn],
  ["bkt.phasesEligibleForMastery", M.bkt?.phasesEligibleForMastery],
  ["phases.scored", M.phases?.scored],
  ["phases.unscored", M.phases?.unscored],
  ["phases.fadeOrder", M.phases?.fadeOrder],
  ["phases.soloThreshold", M.phases?.soloThreshold],
  ["phases.modelPhaseThreshold", M.phases?.modelPhaseThreshold],
  ["phases.modelEventsPerNodePerSession", M.phases?.modelEventsPerNodePerSession],
  ["antiGuessing.hintSurfaceMs", M.antiGuessing?.hintSurfaceMs],
  ["antiGuessing.hintedCorrectPolicy", M.antiGuessing?.hintedCorrectPolicy],
];
let gateFieldFaults = 0;
for (const [name, value] of gateFields) {
  if (value === undefined || value === null) {
    gateFieldFaults++;
    fail(`${name} is undefined — the gate P16 builds must be fully specified in the JSON, not inferred from prose`);
  }
}
if ((M.spacing.consolidation?.passAtLeast ?? 0) > (M.spacing.consolidation?.items ?? 0)) {
  gateFieldFaults++;
  fail(`spacing.consolidation.passAtLeast exceeds its item count — that gate can never open`);
}
if ((M.spacing.retentionCheck?.passAtLeast ?? 0) > (M.spacing.retentionCheck?.items ?? 0)) {
  gateFieldFaults++;
  fail(`spacing.retentionCheck.passAtLeast exceeds its item count — that gate can never open`);
}
if (M.forms?.cycleIndexedOn !== undefined && M.forms.cycleIndexedOn !== "scoredCount") {
  gateFieldFaults++;
  fail(
    `forms.cycleIndexedOn is "${M.forms.cycleIndexedOn}" — the worked trace in design/learning-architecture.md §5.1 is computed on "scoredCount"; changing it changes the third item's guess multiplier and every number after it`
  );
}
for (const p of M.phases?.fadeOrder ?? [])
  if (!M.phases.order.includes(p)) {
    gateFieldFaults++;
    fail(`phases.fadeOrder names "${p}", which is not in phases.order`);
  }
if (M.phases && !sameSet([...(M.phases.scored ?? []), ...(M.phases.unscored ?? [])], M.phases.order ?? [])) {
  gateFieldFaults++;
  fail(`phases.scored + phases.unscored must partition phases.order exactly — an unclassified phase is a phase with no price`);
}
if (M.phases && !(M.phases.modelPhaseThreshold < M.phases.soloThreshold)) {
  gateFieldFaults++;
  fail(`phases.modelPhaseThreshold must sit below phases.soloThreshold or the guided band is empty`);
}
if (gateFieldFaults === 0)
  say(
    `  PASS  gate fully specified in JSON: consolidation passAtLeast ${M.spacing.consolidation.passAtLeast}/${M.spacing.consolidation.items}, retention ${M.spacing.retentionCheck.passAtLeast}/${M.spacing.retentionCheck.items} with threshold re-check ${M.spacing.retentionCheck.requiresThresholdAtCheck}, form cycle indexed on ${M.forms.cycleIndexedOn}, phases ${M.phases.order.join(">")} with the fade ladder ${M.phases.fadeOrder.join(">")} and M2/M3 counting [${M.bkt.phasesEligibleForMastery.join(", ")}]`
  );

// -------------------------------------- PAIRWISE-SEPARATED (rule 4) --------
// Rules (1) and (2) are string checks. Rule (4) is arithmetic: on a GENERATED instance, no two
// misconceptions on the same node may evaluate to the same response. review/p03/signature-collide.mjs
// scans every node family whose signatures share a stem and can be evaluated in closed form. It
// carries its own control arm (two algebraically identical signatures, which must flag at 100%).
say("");
say("== misconception collisions on generated instances (rule 4, PAIRWISE-SEPARATED) ==");
const collide = collisionScan();
for (const r of collide.rows)
  say(
    `  ${r.node.padEnd(20)} ${String(r.allValid).padStart(7)} valid stems, ${String(r.collide).padStart(5)} collide  ${(r.pct.toFixed(2) + "%").padStart(8)}${r.pct >= collide.threshold ? "   OVER THRESHOLD" : ""}`
  );
const worstCollide = collide.rows.reduce((a, r) => (r.pct > a.pct ? r : a), collide.rows[0]);
if (worstCollide.pct >= collide.threshold)
  fail(
    `node "${worstCollide.node}" has two misconceptions that collide on ${worstCollide.pct.toFixed(2)}% of otherwise-valid stems (threshold ${collide.threshold}%) — at that rate they are not different misconceptions and no stem filter repairs it`
  );
else
  say(
    `  PASS  worst family ${worstCollide.node} at ${worstCollide.pct.toFixed(2)}%, under the ${collide.threshold}% build threshold; P17 implements rule 4 as a stem filter`
  );
if (collide.control.pct !== 100)
  fail(
    `the collision scan's control arm (two algebraically identical signatures) flagged ${collide.control.pct.toFixed(2)}% instead of 100% — the scan is not detecting collisions and its zeroes mean nothing`
  );
else say(`  PASS  control arm flags 100% of an algebraically identical signature pair, so the scan can see a collision`);

// ------------------------------------------- the one-lucky-answer invariant --
// The learn rate puts a FLOOR under the all-wrong BKT fixed point: a responder who is never
// right still drifts upward, and the higher the learn rate the higher that floor sits. If the
// floor gets close enough to masteryThreshold that ONE correct answer clears M1, the threshold
// has stopped being a threshold. Assert, for every band and both learn-rate states, that at
// least two consecutive correct answers are needed from the floor.
say("");
say("== invariant: one lucky answer never clears M1 ==");
const post = (p, correct, s, g) =>
  correct ? (p * (1 - s)) / (p * (1 - s) + (1 - p) * g) : (p * s) / (p * s + (1 - p) * (1 - g));
const withLearning = (p, t) => p + (1 - p) * t;
for (const b of bands) {
  for (const [state, learn] of [
    ["normal ", b.learn],
    ["relearn", Math.min(M.spacing.relearnLearnRateCap, b.learn * M.spacing.relearnLearnRateMultiplier)],
  ]) {
    let floor = b.prior;
    for (let i = 0; i < 500; i++) floor = withLearning(post(floor, false, b.slip, b.guess), learn);
    const one = withLearning(post(floor, true, b.slip, b.guess), learn);
    const two = withLearning(post(one, true, b.slip, b.guess), learn);
    const ok = one < M.bkt.masteryThreshold;
    say(
      `  band ${b.difficulty} ${state} (t=${learn.toFixed(3)}): all-wrong floor ${floor.toFixed(4)} -> +1 correct ${one.toFixed(4)} -> +2 ${two.toFixed(4)}  ${ok ? "" : "  <-- ONE LUCKY ANSWER CLEARS THE GATE"}`
    );
    if (!ok)
      fail(
        `band ${b.difficulty} in ${state.trim()} state: a single correct answer from the all-wrong floor reaches ${one.toFixed(4)} >= masteryThreshold ${M.bkt.masteryThreshold}. Lower spacing.relearnLearnRateCap or the band learn rate.`
      );
  }
}
if (M.spacing.relearnRequiresPriorMastery !== true)
  fail(`spacing.relearnRequiresPriorMastery must be true — the savings boost belongs to relearning, not to a first failed certification`);

// The invariant above is about the all-wrong FIXED POINT, and it is easy to over-read it as
// "two CONSECUTIVE corrects are always needed". That is false away from the floor, and P16 must
// not build a consecutive-run detector on it: from the ordinary band prior the pattern
// correct, wrong, correct clears 0.95 at bands 1 and 2. Printed so the claim in
// design/learning-architecture.md §1.1a is checkable rather than asserted.
say("");
say("== the same invariant, read correctly: 'two corrects in the window', not 'two in a row' ==");
for (const b of bands) {
  let p = b.prior;
  const seq = [true, false, true];
  const path = [p];
  for (const c of seq) {
    p = withLearning(post(p, c, b.slip, b.guess), b.learn);
    path.push(p);
  }
  say(
    `  band ${b.difficulty} from the prior ${b.prior.toFixed(2)}, pattern C,W,C: ${path.map((x) => x.toFixed(4)).join(" -> ")}  ${p >= M.bkt.masteryThreshold ? "clears" : "does not clear"} ${M.bkt.masteryThreshold} on two NON-consecutive corrects`
  );
}

// ------------------------------------------------------- standards audit ----
say("");
say("== standards ==");
const codes = standards.codes;
const usedCodes = new Set();
const frameworksUsed = new Set();
for (const n of nodes) {
  if (!Array.isArray(n.standards) || n.standards.length === 0)
    fail(`node "${n.id}" maps to no standard`);
  for (const c of n.standards ?? []) {
    if (!codes[c]) {
      fail(`node "${n.id}" cites "${c}" which is not in content/standards.json`);
      continue;
    }
    usedCodes.add(c);
    frameworksUsed.add(codes[c].framework);
  }
}
const nonCcss = [...frameworksUsed].filter((f) => f !== "CCSS");
say(`  ${usedCodes.size} distinct codes cited across ${frameworksUsed.size} frameworks`);
say(`  non-CCSS frameworks in use: ${nonCcss.join(", ") || "(none)"}`);
if (nonCcss.length < 3) fail(`need at least 3 non-CCSS state frameworks, found ${nonCcss.length}`);
const needsVerification = Object.entries(codes).filter(
  ([, v]) => v.verification === "NEEDS_VERIFICATION"
);
say(`  codes marked NEEDS_VERIFICATION: ${needsVerification.length}`);
for (const [id] of needsVerification) say(`    - ${id}`);
const unusedCodes = Object.keys(codes).filter((c) => !usedCodes.has(c));
say(`  registered but not yet cited by a node (available to P17): ${unusedCodes.length}`);
// Per-framework node coverage, with the uncovered nodes named. §7 of
// design/learning-architecture.md justifies every hole here node by node; printing the holes is
// what stops that prose drifting away from the data, which is exactly how round 2 came to say
// "two nodes" where the file said seven.
for (const f of standards.frameworks) {
  const uncovered = nodes
    .filter((n) => !(n.standards ?? []).some((c) => codes[c]?.framework === f.id))
    .map((n) => n.id);
  say(
    `  ${f.id.padEnd(5)} node coverage ${String(nodes.length - uncovered.length).padStart(2)}/${nodes.length}${uncovered.length ? `   uncovered: ${uncovered.join(", ")}` : ""}`
  );
}
for (const [id, v] of Object.entries(codes)) {
  if (!v.text || v.text.length < 20) fail(`standard "${id}" has no usable text`);
  if (!standards.frameworks.some((f) => f.id === v.framework))
    fail(`standard "${id}" names unknown framework "${v.framework}"`);
  if (!v.verification) fail(`standard "${id}" has no verification marker`);
}

// -------------------------------------------------------------- topology ----
say("");
say("== topology ==");
const roots = nodes.filter((n) => n.prerequisites.length === 0).map((n) => n.id);
const leaves = nodes.filter((n) => succ.get(n.id).length === 0).map((n) => n.id);
const depth = new Map();
for (const id of topo) {
  const n = byId.get(id);
  depth.set(id, n.prerequisites.length ? Math.max(...n.prerequisites.map((p) => depth.get(p) + 1)) : 0);
}
const maxDepth = Math.max(...depth.values());
const deepest = [...depth].filter(([, d]) => d === maxDepth).map(([id]) => id);
say(`  roots (no prerequisites): ${roots.join(", ")}`);
say(`  leaves (nothing depends on them): ${leaves.join(", ")}`);
say(`  longest prerequisite chain: ${maxDepth + 1} nodes, ending at ${deepest.join(", ")}`);
const totalMinutes = nodes.reduce((a, n) => a + n.estMinutes, 0);
say(`  total estMinutes: ${totalMinutes} (${(totalMinutes / 60).toFixed(1)} h of scored-item time)`);
const byBand = {};
for (const n of nodes) byBand[n.difficulty] = (byBand[n.difficulty] ?? 0) + 1;
say(`  nodes per difficulty band: ${JSON.stringify(byBand)}`);

// Band monotonicity. A node sitting behind a harder prerequisite is a pitch inversion: the
// selector pitches it at the easier band centre and hands the learner an item they have
// already outgrown, and its prior is set for a population that has not met the prerequisite.
let inversions = 0;
for (const n of nodes) {
  for (const p of n.prerequisites) {
    const pn = byId.get(p);
    if (pn && pn.difficulty > n.difficulty) {
      inversions++;
      fail(`band inversion: "${n.id}" (d${n.difficulty}) sits behind harder prerequisite "${p}" (d${pn.difficulty})`);
    }
  }
}
if (inversions === 0) say(`  PASS  no band inversion: every node is at least as hard as each of its prerequisites`);

// order the graph is learnable in, for P16's default unlock walk
say("");
say("== a valid learning order (topological) ==");
let i = 0;
for (const id of topo) say(`  ${String(++i).padStart(2, " ")}. ${id}  (d${byId.get(id).difficulty})`);

say("");
if (failures.length === 0) {
  say(`RESULT: PASS — ${nodes.length} nodes, ${edgeCount} edges, acyclic, transitively reduced, fully standards-mapped.`);
} else {
  say(`RESULT: FAIL — ${failures.length} problem(s).`);
}

console.log(lines.join("\n"));
process.exit(failures.length === 0 ? 0 : 1);
