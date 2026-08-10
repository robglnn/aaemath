/**
 * generators.mjs — parameterised item families for Algebra I Level 1.
 *
 * Owned by P17. One family per stem shape; thirty-two knowledge points; every family emits
 * `construct`, `repair` and `generate` (the three forms `model.forms.scored` admits), plus the
 * unscored `select4` used only inside a `model` phase.
 *
 * Four rules are enforced here rather than hoped for, because the item bank is where they are
 * cheap and the runtime is where they are catastrophic:
 *
 *   DISCRIMINATING     every misconception's response differs from the correct one, per stem.
 *   PAIRWISE-SEPARATED no two misconceptions on a node collapse onto the same response on a
 *                      served stem. `content/knowledge-graph.json` conventions, rule (4).
 *                      A stem that violates it is rejected, never patched.
 *   EXACT              all arithmetic is rational. Never a float, never a rounded compare.
 *   READABLE-BACK      every TeX string this file authors is parsed back by `kit.mjs`, so a
 *                      stem the answer checker could not read is a build failure, not a
 *                      runtime surprise for a learner who was right.
 *
 * Nothing here is player-visible English. Learner-facing text lives in `strings.json` under
 * locale keys; items carry `{ key, params }`.
 */

import {
  rat,
  radd,
  rsub,
  rmul,
  rdiv,
  rneg,
  req,
  rstr,
  rtex,
  R0,
  R1,
  parseExpr,
  canonExpr,
  canonEquation,
  canonInequality,
  canonNumber,
  canonPartition,
  polyStr,
  polySubst,
  rng,
  intIn,
  pick,
} from "./kit.mjs";

/* ------------------------------------------------------------------ small helpers */

const I = (n) => rat(n);
const num = (r) => r.n / r.d;
const isInt = (r) => r.d === 1;

/** TeX for a signed continuation: 5 -> " + 5", -5 -> " - 5", 0 -> "". */
function plus(n) {
  if (n === 0) return "";
  return n < 0 ? ` - ${-n}` : ` + ${n}`;
}
/** TeX for a coefficient on a letter: 1x -> "x", -1x -> "-x", 0x -> "0". */
function cv(k, v = "x", pow = 1) {
  const vv = pow === 1 ? v : `${v}^{${pow}}`;
  if (k === 0) return "0";
  if (k === 1) return vv;
  if (k === -1) return `-${vv}`;
  return `${k}${vv}`;
}
const paren = (s) => `\\left(${s}\\right)`;

/**
 * Join signed pieces the way a person writes a load: `3x - 4y + 7`, never `3x + -4y`.
 * Parts are {c, v, pow} — v omitted for fixed weight. Zero counts drop out.
 */
function sumTex(parts) {
  const live = parts.filter((t) => t.c !== 0);
  if (!live.length) return "0";
  let out = "";
  live.forEach((t, i) => {
    const mag = Math.abs(t.c);
    const body = t.v ? cv(mag, t.v, t.pow || 1) : String(mag);
    if (i === 0) out = (t.c < 0 ? "-" : "") + body;
    else out += (t.c < 0 ? " - " : " + ") + body;
  });
  return out;
}

/** A working line: the TeX a learner reads and the canonical form the checker compares. */
function L(tex, kind = "equation", unknown = "x") {
  const canon =
    kind === "equation"
      ? canonEquation(tex)
      : kind === "inequality"
        ? canonInequality(tex, unknown)
        : kind === "number"
          ? canonNumber(tex, unknown)
          : canonExpr(tex);
  return { tex, canon, kind };
}

/* ------------------------------------------------------------------ object classes */
/** design/world.md §11a — every node's home class. No orphans, no improvising. */
export const NODE_CLASS = {
  "var-meaning": "Emitter",
  "oo-numeric": "Bearer",
  "expr-anatomy": "Bearer",
  "oo-structure": "Aperture",
  "eval-substitute": "Emitter",
  "eval-signed": "Emitter",
  "eval-formula": "Span",
  "translate-phrase": "Vessel",
  "translate-order": "Threshold",
  "translate-sentence": "Span",
  "props-operations": "Bearer",
  "like-terms-id": "Bearer",
  "like-terms-combine": "Bearer",
  "distribute-numeric": "Aperture",
  "distribute-variable": "Aperture",
  "distribute-negative": "Aperture",
  "simplify-expression": "Span",
  "equivalent-expressions": "Span",
  "eq-meaning": "Span",
  "props-equality": "Vessel",
  "eq-one-add": "Span",
  "eq-one-mult": "Bearer",
  "eq-two-step": "Span",
  "eq-combine-side": "Bearer",
  "eq-distribute": "Aperture",
  "eq-both-sides": "Vessel",
  "eq-special-cases": "Span",
  "eq-model-context": "Span",
  "ineq-meaning": "Threshold",
  "ineq-one-step": "Threshold",
  "ineq-negative-flip": "Threshold",
  "ineq-two-step": "Threshold",
};

/**
 * design/voice.md §4 — the failure line each misconception fires. Sixteen rows come from the
 * voice bible verbatim; the rows marked NEW extend that table, which §4 explicitly asks item
 * authors to do rather than inventing phrasings at the call site. They are listed in the P17
 * handoff so the voice owner can adopt or replace them.
 */
export const FAIL_KEY = {
  "var-as-label": "fail.label",
  "var-must-differ": "fail.twin",
  "var-alphabet-value": "fail.seat.wrongvalue",
  "oo-strict-left-to-right": "fail.load.unsettled",
  "oo-mult-before-div": "fail.load.unsettled",
  "oo-add-before-sub": "fail.sill.sign",
  "term-split-at-product": "fail.term.count",
  "bare-x-has-no-coefficient": "fail.coefficient",
  "sign-detached-from-term": "fail.negative",
  "coefficient-under-exponent": "fail.load.unsettled",
  "negative-square-sign-lost": "fail.negative",
  "juxtaposition-means-add": "fail.load.unsettled",
  "substitute-first-occurrence-only": "fail.seat.partial",
  "substitute-by-concatenation": "fail.seat.wrongvalue",
  "coefficient-dropped-on-substitution": "fail.coefficient",
  "negative-substituted-bare": "fail.negative",
  "double-negative-collapsed-wrong": "fail.negative",
  "two-negatives-make-positive-on-sum": "fail.negative",
  "values-assigned-by-order": "fail.seat.wrongsocket",
  "one-value-for-all-letters": "fail.seat.wrongsocket",
  "second-variable-ignored": "fail.seat.partial",
  "keyword-without-structure": "fail.said.flat",
  "no-variable-introduced": "fail.said.nosocket",
  "twice-read-as-plus-two": "fail.said.flat",
  "less-than-reversed": "fail.said.order",
  "divided-into-reversed": "fail.said.order",
  "subtract-from-reversed": "fail.said.order",
  "subtraction-commutes": "fail.sill.sign",
  "regroup-across-subtraction": "fail.partial.open",
  "identity-swapped": "fail.slip",
  "all-variable-terms-alike": "fail.unlike",
  "constant-like-variable": "fail.unlike",
  "exponent-ignored-in-matching": "fail.unlike",
  "combine-unlike-terms": "fail.unlike",
  "variable-parts-added-too": "fail.kind.changed",
  "sign-left-behind-on-move": "fail.negative",
  "distribute-to-first-term-only": "fail.partial.open",
  "distribute-over-a-product": "fail.partial.open",
  "distribute-by-adding": "fail.partial.open",
  "variable-multiplied-as-well": "fail.kind.changed",
  "distribute-reaches-variable-only": "fail.partial.open",
  "coefficients-added-not-multiplied": "fail.partial.open",
  "flip-first-term-only": "fail.partial.open",
  "leading-minus-dropped": "fail.negative",
  "subtract-before-distributing": "fail.partial.open",
  "combine-before-distributing": "fail.partial.open",
  "stops-before-fully-simplified": "fail.load.unsettled",
  "over-combines-to-one-term": "fail.unlike",
  "one-value-proves-equivalence": "fail.deck.onevalue",
  "different-form-means-different": "fail.deck.shape",
  "counterexample-ignored": "fail.deck.onevalue",
  "equals-means-compute-now": "fail.sill.chain",
  "solution-never-checked": "fail.slip",
  "equation-true-for-everything": "fail.deck.onevalue",
  "operate-on-one-side": "fail.onesided",
  "inverse-operations-on-each-side": "fail.inverse",
  "divide-by-possible-zero": "fail.sill.zero",
  "same-operation-not-inverse": "fail.inverse",
  "subtraction-order-reversed": "fail.sill.sign",
  "minus-inverted-wrongly": "fail.sill.sign",
  "subtract-the-coefficient": "fail.inverse",
  "division-order-reversed": "fail.sill.sign",
  "fraction-form-inverted": "fail.inverse",
  "divide-before-clearing-constant": "fail.partial.divide",
  "inverse-order-inverted": "fail.inverse",
  "constant-sign-flipped": "fail.sill.sign",
  "combine-across-the-equals": "fail.sill.sign",
  "one-like-term-dropped": "fail.coefficient",
  "constant-absorbed-into-coefficient": "fail.unlike",
  "distribute-partially-in-equation": "fail.partial.open",
  "divide-bracket-only": "fail.partial.divide",
  "coefficient-never-undone": "fail.coefficient",
  "moved-without-inverting": "fail.sill.sign",
  "removed-from-one-side-only": "fail.onesided",
  "constants-collected-wrong-side": "fail.sill.sign",
  "vanishing-variable-means-zero": "fail.socket.gone",
  "identity-called-no-solution": "fail.always",
  "contradiction-given-a-solution": "fail.refusal",
  "produces-expression-not-equation": "fail.sill.missing",
  "sides-merged": "fail.sill.missing",
  "unknown-defined-as-wrong-quantity": "fail.said.wrongquantity",
  "arithmetic-shortcut-only": "fail.sill.missing",
  "answers-the-wrong-question": "fail.said.wrongquantity",
  "non-viable-solution-accepted": "fail.viable",
  "single-value-for-a-set": "fail.mark.level",
  "endpoint-style-swapped": "fail.mark.edge",
  "reads-symbol-left-to-right-always": "fail.mark.side",
  "flip-after-adding": "fail.mark.unturned",
  "solved-as-equation": "fail.mark.level",
  "flip-because-a-negative-appeared": "fail.mark.unturned",
  "no-flip-on-negative-divide": "fail.mark.unturned",
  "flip-but-sign-lost": "fail.negative",
  "flip-on-subtracting-a-negative": "fail.mark.unturned",
  "flipped-twice": "fail.mark.unturned",
  "coefficient-applied-to-constant-only": "fail.partial.divide",
  "strictness-contradicts-context": "fail.mark.edge",
};

/**
 * Which parameters each locale key actually PRINTS. Generated from strings.json and asserted
 * against it in review/measure/P17.mjs (C21), so it cannot drift.
 *
 * The leak filter below needs this because a hint is handed every parameter the item has and
 * prints only some of them. Filtering on what it was HANDED deleted whole families — every
 * `var-meaning.seat` item carries the seated value as a parameter, and that value is also the
 * reading, so the naive filter refused every stem the family could ever draw.
 */
export const HINT_PRINTS = {
 "ask.gen.loadTo": [
  "target"
 ],
 "ask.gen.lockOpensAt": [
  "target"
 ],
 "ask.gen.loadShape": [
  "terms"
 ],
 "ask.gen.sealCan": [
  "target"
 ],
 "ask.gen.gathersTo": [
  "target"
 ],
 "ask.gen.standsWith": [
  "target"
 ],
 "ask.gen.claimClosesAt": [
  "target"
 ],
 "ask.gen.saidClaim": [
  "target"
 ],
 "ask.gen.markAdmits": [
  "target"
 ],
 "ask.gen.markAdmitsTurned": [
  "target"
 ],
 "hint.repair.3": [
  "line"
 ],
 "hint.gen.namesDiffer.3": [
  "target"
 ],
 "hint.gen.loadAuthor.3": [
  "target"
 ],
 "hint.gen.loadShape.3": [
  "terms"
 ],
 "hint.gen.loadGathersTo.3": [
  "target"
 ],
 "hint.gen.partitionWitness.3": [
  "target"
 ],
 "hint.gen.claimClosesAt.3": [
  "target"
 ],
 "hint.gen.markAdmits.3": [
  "target"
 ],
 "spoken.var-meaning.relate": [
  "k"
 ],
 "spoken.translate-phrase.groups": [
  "a",
  "b"
 ],
 "spoken.translate-phrase.twice": [
  "b"
 ],
 "spoken.translate-order.lessthan": [
  "a"
 ],
 "spoken.translate-order.subtractfrom": [
  "a"
 ],
 "spoken.translate-order.dividedinto": [
  "a"
 ],
 "spoken.translate-sentence.core": [
  "a",
  "b",
  "c"
 ],
 "story.eq-model-context.span": [
  "b",
  "g",
  "k"
 ],
 "story.eq-model-context.members": [
  "T",
  "w"
 ],
 "hint.move.var-meaning.seat": [
  "letter"
 ],
 "hint.move.var-meaning.relate": [
  "k"
 ],
 "hint.state.var-meaning.relate": [
  "k"
 ],
 "hint.state.var-meaning.twin": [
  "total"
 ],
 "hint.move.oo-numeric.addmul": [
  "b",
  "c"
 ],
 "hint.state.oo-numeric.addmul": [
  "a",
  "inner"
 ],
 "hint.state.oo-numeric.divmul": [
  "a",
  "b",
  "c",
  "first"
 ],
 "hint.state.oo-numeric.addsub": [
  "a",
  "b",
  "c",
  "first"
 ],
 "hint.move.expr-anatomy.coefficient": [
  "b"
 ],
 "hint.state.expr-anatomy.term": [
  "a"
 ],
 "hint.state.oo-structure.coefsq": [
  "a",
  "sq"
 ],
 "hint.state.oo-structure.negsq": [
  "sq"
 ],
 "hint.state.oo-structure.juxt": [
  "a",
  "v"
 ],
 "hint.state.eval-substitute.twice": [
  "sq",
  "v"
 ],
 "hint.state.eval-substitute.concat": [
  "a",
  "v"
 ],
 "hint.state.eval-substitute.coefficient": [
  "a",
  "v"
 ],
 "hint.state.eval-signed.minusneg": [
  "a",
  "b"
 ],
 "hint.state.eval-signed.sumneg": [
  "a",
  "b"
 ],
 "hint.state.eval-formula.two": [
  "rise"
 ],
 "hint.move.translate-phrase.groups": [
  "a",
  "b"
 ],
 "hint.state.translate-phrase.groups": [
  "a",
  "b"
 ],
 "hint.state.translate-phrase.twice": [
  "b"
 ],
 "hint.state.translate-order.lessthan": [
  "a"
 ],
 "hint.state.translate-order.subtractfrom": [
  "a"
 ],
 "hint.state.translate-order.dividedinto": [
  "a"
 ],
 "hint.state.translate-sentence.core": [
  "a",
  "b"
 ],
 "hint.state.props-operations.commute": [
  "b"
 ],
 "hint.state.props-operations.regroup": [
  "a",
  "inner"
 ],
 "hint.state.props-operations.identity": [
  "a"
 ],
 "hint.state.like-terms-id.xy": [
  "first"
 ],
 "hint.state.like-terms-id.pow": [
  "first"
 ],
 "hint.state.like-terms-combine.core": [
  "gathered"
 ],
 "hint.state.distribute-numeric.sum": [
  "first"
 ],
 "hint.state.distribute-numeric.product": [
  "a",
  "inner"
 ],
 "hint.state.distribute-variable.core": [
  "first"
 ],
 "hint.state.distribute-negative.bare": [
  "b",
  "c"
 ],
 "hint.state.distribute-negative.subtract": [
  "a",
  "product"
 ],
 "hint.state.simplify-expression.core": [
  "a",
  "opened"
 ],
 "hint.state.equivalent-expressions.count": [
  "a",
  "b"
 ],
 "hint.state.eq-meaning.magazine": [
  "a",
  "b"
 ],
 "hint.state.props-equality.move": [
  "a",
  "b"
 ],
 "hint.state.props-equality.zero": [
  "diff"
 ],
 "hint.state.eq-one-add.plus": [
  "p",
  "q"
 ],
 "hint.state.eq-one-add.minus": [
  "p",
  "q"
 ],
 "hint.state.eq-one-mult.mult": [
  "a",
  "b"
 ],
 "hint.state.eq-one-mult.fraction": [
  "a",
  "b"
 ],
 "hint.state.eq-two-step.core": [
  "a",
  "lifted"
 ],
 "hint.state.eq-combine-side.core": [
  "c",
  "gathered"
 ],
 "hint.move.eq-distribute.core": [
  "p"
 ],
 "hint.state.eq-distribute.core": [
  "p",
  "q",
  "shared"
 ],
 "hint.state.eq-both-sides.core": [
  "left"
 ],
 "hint.state.eq-special-cases.refusal": [
  "b",
  "d"
 ],
 "hint.state.eq-model-context.span": [
  "b",
  "deck",
  "k"
 ],
 "hint.state.eq-model-context.members": [
  "exact"
 ],
 "hint.state.ineq-meaning.stretch": [
  "c"
 ],
 "hint.state.ineq-one-step.plus": [
  "mark",
  "p"
 ],
 "hint.state.ineq-one-step.negconstant": [
  "mark"
 ],
 "hint.state.ineq-negative-flip.divide": [
  "mark"
 ],
 "hint.state.ineq-negative-flip.subneg": [
  "mark",
  "p"
 ],
 "hint.state.ineq-two-step.turned": [
  "a",
  "lifted"
 ],
 "hint.state.ineq-two-step.inclusive": [
  "a",
  "lifted"
 ],
 "ask.gen.loadReadsAt": [
  "at",
  "target",
  "unknown"
 ],
 "hint.gen.loadReadsAt.3": [
  "at",
  "target"
 ]
};

/* ------------------------------------------------------------------ tiers */
/**
 * Three pitches inside a band. `core` sits at the node's own band; `easy` one below, `stretch`
 * one above, clamped to 1..5. §1.3 of design/learning-architecture.md asks for an acquisition
 * pitch and a certification pitch; these are the tiers those pitches select between.
 */
export const TIERS = ["easy", "core", "stretch"];
export function tierBand(band, tier) {
  const d = tier === "easy" ? band - 1 : tier === "stretch" ? band + 1 : band;
  return Math.max(1, Math.min(5, d));
}

/** Coefficient / constant ranges, widening with the tier. */
function ranges(tier) {
  if (tier === "easy") return { coef: [2, 5], konst: [1, 9], sol: [1, 6], neg: false };
  if (tier === "stretch") return { coef: [2, 6], konst: [-9, 9], sol: [-9, 9], neg: true };
  return { coef: [2, 6], konst: [-9, 9], sol: [1, 9], neg: false };
}

function nz(rand, lo, hi) {
  for (let i = 0; i < 40; i++) {
    const v = intIn(rand, lo, hi);
    if (v !== 0) return v;
  }
  return lo || hi || 1;
}

/** Coefficient draw: magnitude in range, sign allowed to go negative above the easy tier. */
function coefDraw(rand, tier) {
  const r = ranges(tier);
  const mag = intIn(rand, r.coef[0], r.coef[1]);
  return r.neg && rand() < 0.4 ? -mag : mag;
}

/* ------------------------------------------------------------------ shape framework */
/**
 * A shape declares one stem family. `draw` proposes parameters; `build` turns them into the
 * pieces every form needs. The framework, not the shape, enforces the separation rules.
 */
const SHAPES = [];
function shape(def) {
  SHAPES.push(def);
  return def;
}

/* ============================================================ EXPRESSIONS strand */

const ALPHA = "abcdefghijklmnopqrstuvwxyz";
const alphaIndex = (letter) => ALPHA.indexOf(letter) + 1;

shape({
  id: "var-meaning.seat",
  kp: "var-meaning",
  ask: "ask.reading",
  answerType: "integer",
  draw(rand, tier) {
    const letters = ["k", "m", "t", "p", "r", "w", "g", "q"];
    const letter = pick(rand, letters);
    const v = intIn(rand, 2, tier === "easy" ? 12 : 20);
    if (v === alphaIndex(letter)) return null;
    return { letter, v };
  },
  build(p) {
    const stem = p.letter;
    return {
      stem,
      given: [`${p.letter} = ${p.v}`],
      answer: { canonical: rstr(I(p.v)), tex: String(p.v) },
      sigs: {
        "var-alphabet-value": { canonical: rstr(I(alphaIndex(p.letter))), tex: String(alphaIndex(p.letter)) },
      },
      unknown: p.letter,
      hint: { letter: p.letter, v: p.v },
      trace: (misc) => {
        const read = misc === "var-alphabet-value" ? alphaIndex(p.letter) : p.v;
        return [L(`${p.letter} = ${p.v}`), L(`${p.letter} = ${read}`)];
      },
      traceKind: "equation",
      gen: {
        kind: "namesDiffer",
        check: { kind: "namesDiffer", value: rstr(I(p.v)) },
        witness: `a = ${p.v}; b = ${p.v}`,
        ask: "ask.gen.namesDiffer",
        sigs: { "var-must-differ": { canonical: `a=${p.v};b=${p.v + 1}`, tex: `a = ${p.v},\\; b = ${p.v + 1}` } },
      },
    };
  },
});

shape({
  id: "var-meaning.relate",
  kp: "var-meaning",
  ask: "ask.claim",
  answerType: "equation",
  draw(rand, tier) {
    const k = intIn(rand, 2, tier === "easy" ? 8 : 18);
    return { k };
  },
  build(p) {
    const stem = `a,\\; b`;
    return {
      stem,
      given: [],
      spoken: { key: "spoken.var-meaning.relate", params: { k: p.k } },
      answer: { canonical: canonEquation(`a = ${p.k}b`), tex: `a = ${cv(p.k, "b")}` },
      sigs: {
        "var-as-label": { canonical: canonEquation(`${p.k}a = b`), tex: `${cv(p.k, "a")} = b` },
      },
      hint: { k: p.k },
      trace: (misc) => {
        const line = misc === "var-as-label" ? `${cv(p.k, "a")} = b` : `a = ${cv(p.k, "b")}`;
        return [{ tex: `a,\\; b`, canon: "sockets", kind: "raw" }, L(line)];
      },
      traceKind: "equation",
    };
  },
});

shape({
  id: "var-meaning.twin",
  kp: "var-meaning",
  ask: "ask.pair",
  answerType: "pair",
  draw(rand, tier) {
    const v = intIn(rand, 2, tier === "easy" ? 9 : 15);
    const d = intIn(rand, 1, 4);
    return { v, d };
  },
  build(p) {
    const stem = `x + y = ${2 * p.v},\\quad x - y = 0`;
    return {
      stem,
      given: [],
      answer: { canonical: `x=${p.v};y=${p.v}`, tex: `x = ${p.v},\\; y = ${p.v}` },
      sigs: {
        "var-must-differ": {
          canonical: `x=${p.v - p.d};y=${p.v + p.d}`,
          tex: `x = ${p.v - p.d},\\; y = ${p.v + p.d}`,
        },
      },
      hint: { total: 2 * p.v, v: p.v },
      trace: (misc) => {
        const a = misc === "var-must-differ" ? p.v - p.d : p.v;
        const b = misc === "var-must-differ" ? p.v + p.d : p.v;
        return [L(`x + y = ${2 * p.v}`), L(`x = ${a}`), L(`y = ${b}`)];
      },
      traceKind: "equation",
    };
  },
});

shape({
  id: "oo-numeric.addmul",
  kp: "oo-numeric",
  ask: "ask.reading",
  answerType: "integer",
  draw(rand, tier) {
    const a = intIn(rand, 2, tier === "easy" ? 9 : 14);
    const b = intIn(rand, 2, 7);
    const c = intIn(rand, 2, 7);
    if (a + b * c === (a + b) * c) return null;
    return { a, b, c };
  },
  build(p) {
    const stem = `${p.a} + ${p.b} \\cdot ${p.c}`;
    return {
      stem,
      given: [],
      answer: { canonical: rstr(I(p.a + p.b * p.c)), tex: String(p.a + p.b * p.c) },
      sigs: {
        "oo-strict-left-to-right": {
          canonical: rstr(I((p.a + p.b) * p.c)),
          tex: String((p.a + p.b) * p.c),
        },
      },
      hint: { a: p.a, b: p.b, c: p.c, inner: p.b * p.c },
      trace: (misc) =>
        misc === "oo-strict-left-to-right"
          ? [L(stem, "expr"), L(`${p.a + p.b} \\cdot ${p.c}`, "expr"), L(String((p.a + p.b) * p.c), "expr")]
          : [L(stem, "expr"), L(`${p.a} + ${p.b * p.c}`, "expr"), L(String(p.a + p.b * p.c), "expr")],
      traceKind: "expr",
      gen: {
        kind: "loadAuthor",
        check: { kind: "loadAuthor", settleTo: p.a + p.b * p.c, needs: ["product", "sum"] },
        witness: `${p.a} + ${p.b} \\cdot ${p.c}`,
        ask: "ask.gen.loadTo",
        sigs: {},
      },
    };
  },
});

shape({
  id: "oo-numeric.divmul",
  kp: "oo-numeric",
  ask: "ask.reading",
  answerType: "rational",
  draw(rand, tier) {
    const b = intIn(rand, 2, 6);
    const q = intIn(rand, 2, tier === "easy" ? 6 : 9);
    const a = b * q;
    const c = intIn(rand, 2, 6);
    const correct = rat(a * c, b);
    const wrong = rat(a, b * c);
    if (req(correct, wrong)) return null;
    return { a, b, c };
  },
  build(p) {
    const stem = `${p.a} \\div ${p.b} \\cdot ${p.c}`;
    const correct = rat(p.a * p.c, p.b);
    const wrong = rat(p.a, p.b * p.c);
    return {
      stem,
      given: [],
      answer: { canonical: rstr(correct), tex: rtex(correct) },
      sigs: { "oo-mult-before-div": { canonical: rstr(wrong), tex: rtex(wrong) } },
      hint: { a: p.a, b: p.b, c: p.c, first: p.a / p.b },
      trace: (misc) =>
        misc === "oo-mult-before-div"
          ? [L(stem, "expr"), L(`${p.a} \\div ${p.b * p.c}`, "expr"), L(rtex(wrong), "expr")]
          : [L(stem, "expr"), L(`${p.a / p.b} \\cdot ${p.c}`, "expr"), L(rtex(correct), "expr")],
      traceKind: "expr",
    };
  },
});

shape({
  id: "oo-numeric.addsub",
  kp: "oo-numeric",
  ask: "ask.reading",
  answerType: "integer",
  draw(rand, tier) {
    const a = intIn(rand, 8, tier === "easy" ? 18 : 30);
    const b = intIn(rand, 2, 9);
    const c = nz(rand, 2, 9);
    if (a - b + c === a - b - c) return null;
    return { a, b, c };
  },
  build(p) {
    const stem = `${p.a} - ${p.b} + ${p.c}`;
    return {
      stem,
      given: [],
      answer: { canonical: rstr(I(p.a - p.b + p.c)), tex: String(p.a - p.b + p.c) },
      sigs: {
        "oo-add-before-sub": { canonical: rstr(I(p.a - p.b - p.c)), tex: String(p.a - p.b - p.c) },
      },
      hint: { a: p.a, b: p.b, c: p.c, first: p.a - p.b },
      trace: (misc) =>
        misc === "oo-add-before-sub"
          ? [L(stem, "expr"), L(`${p.a} - ${p.b + p.c}`, "expr"), L(String(p.a - p.b - p.c), "expr")]
          : [L(stem, "expr"), L(`${p.a - p.b} + ${p.c}`, "expr"), L(String(p.a - p.b + p.c), "expr")],
      traceKind: "expr",
    };
  },
});

shape({
  id: "expr-anatomy.count",
  kp: "expr-anatomy",
  ask: "ask.terms",
  answerType: "integer",
  draw(rand, tier) {
    const a = nz(rand, 2, 9);
    const b = nz(rand, 2, 9);
    const c = intIn(rand, 1, 9);
    const withY = tier !== "easy";
    return { a, b, c, withY };
  },
  build(p) {
    const stem = p.withY ? `${cv(p.a)} + ${cv(p.b, "y")} - ${p.c}` : `${cv(p.a)} + ${p.c}`;
    const terms = p.withY ? 3 : 2;
    const factors = p.withY ? 5 : 3;
    return {
      stem,
      given: [],
      answer: { canonical: rstr(I(terms)), tex: String(terms) },
      sigs: { "term-split-at-product": { canonical: rstr(I(factors)), tex: String(factors) } },
      hint: { terms, stem },
      trace: (misc) => [
        L(stem, "expr"),
        L(String(misc === "term-split-at-product" ? factors : terms), "expr"),
      ],
      traceKind: "expr",
      gen: {
        kind: "loadShape",
        check: { kind: "loadShape", terms, needsConstant: true, needsCoefficient: Math.abs(p.a) },
        witness: stem,
        ask: "ask.gen.loadShape",
        sigs: {},
      },
    };
  },
});

shape({
  id: "expr-anatomy.coefficient",
  kp: "expr-anatomy",
  ask: "ask.count",
  answerType: "integer",
  draw(rand, tier) {
    const b = nz(rand, 2, tier === "easy" ? 9 : 20);
    return { b, tierNote: tier };
  },
  build(p) {
    const stem = `x - ${cv(p.b, "y")}`;
    return {
      stem,
      given: [],
      answer: { canonical: "1", tex: "1" },
      sigs: { "bare-x-has-no-coefficient": { canonical: "0", tex: "0" } },
      hint: { b: p.b },
      trace: (misc) => [
        L(stem, "expr"),
        L(misc === "bare-x-has-no-coefficient" ? "0" : "1", "expr"),
      ],
      traceKind: "expr",
    };
  },
});

shape({
  id: "expr-anatomy.term",
  kp: "expr-anatomy",
  ask: "ask.term",
  answerType: "expression",
  draw(rand, tier) {
    const a = intIn(rand, 2, tier === "easy" ? 9 : 15);
    const b = nz(rand, 2, 9);
    return { a, b };
  },
  build(p) {
    const stem = `${p.a} - ${cv(p.b)}`;
    return {
      stem,
      given: [],
      answer: { canonical: canonExpr(`-${p.b}x`), tex: cv(-p.b) },
      sigs: { "sign-detached-from-term": { canonical: canonExpr(`${p.b}x`), tex: cv(p.b) } },
      hint: { a: p.a, b: p.b },
      trace: (misc) => [
        L(stem, "expr"),
        L(misc === "sign-detached-from-term" ? cv(p.b) : cv(-p.b), "expr"),
      ],
      traceKind: "expr",
    };
  },
});

shape({
  id: "oo-structure.coefsq",
  kp: "oo-structure",
  ask: "ask.reading",
  answerType: "integer",
  draw(rand, tier) {
    const a = intIn(rand, 2, tier === "easy" ? 4 : 6);
    const v = intIn(rand, 2, tier === "easy" ? 5 : 8);
    if (a * v * v === (a * v) * (a * v)) return null;
    return { a, v };
  },
  build(p) {
    const stem = `${cv(p.a, "x", 2)}`;
    const correct = p.a * p.v * p.v;
    const wrong = (p.a * p.v) ** 2;
    return {
      stem,
      given: [`x = ${p.v}`],
      answer: { canonical: rstr(I(correct)), tex: String(correct) },
      sigs: { "coefficient-under-exponent": { canonical: rstr(I(wrong)), tex: String(wrong) } },
      gen: {
        kind: "loadReadsAt",
        check: { kind: "loadReadsAt", unknown: "x", at: p.v, value: correct, needs: ["letter"] },
        witness: cv(p.a, "x", 2),
        ask: "ask.gen.loadReadsAt",
        sigs: {},
      },
      hint: { a: p.a, v: p.v, sq: p.v * p.v },
      trace: (misc) =>
        misc === "coefficient-under-exponent"
          ? [L(stem, "expr"), L(`${paren(`${p.a} \\cdot ${p.v}`)}^{2}`, "expr"), L(String(wrong), "expr")]
          : [L(stem, "expr"), L(`${p.a} \\cdot ${p.v}^{2}`, "expr"), L(String(correct), "expr")],
      traceKind: "expr",
    };
  },
});

shape({
  id: "oo-structure.negsq",
  kp: "oo-structure",
  ask: "ask.reading",
  answerType: "integer",
  draw(rand, tier) {
    const v = intIn(rand, 2, tier === "easy" ? 12 : 20);
    return { v };
  },
  build(p) {
    const stem = `-x^{2}`;
    const correct = -(p.v * p.v);
    const wrong = p.v * p.v;
    return {
      stem,
      given: [`x = ${p.v}`],
      answer: { canonical: rstr(I(correct)), tex: String(correct) },
      sigs: { "negative-square-sign-lost": { canonical: rstr(I(wrong)), tex: String(wrong) } },
      gen: {
        kind: "loadReadsAt",
        check: { kind: "loadReadsAt", unknown: "x", at: p.v, value: correct, needs: ["letter"] },
        witness: "-x^{2}",
        ask: "ask.gen.loadReadsAt",
        sigs: {},
      },
      hint: { v: p.v, sq: p.v * p.v },
      trace: (misc) =>
        misc === "negative-square-sign-lost"
          ? [L(stem, "expr"), L(`${paren(`-${p.v}`)}^{2}`, "expr"), L(String(wrong), "expr")]
          : [L(stem, "expr"), L(`-\\left(${p.v}^{2}\\right)`, "expr"), L(String(correct), "expr")],
      traceKind: "expr",
    };
  },
});

shape({
  id: "oo-structure.juxt",
  kp: "oo-structure",
  ask: "ask.reading",
  answerType: "integer",
  draw(rand, tier) {
    const a = intIn(rand, 2, tier === "easy" ? 7 : 12);
    const v = intIn(rand, 2, tier === "easy" ? 7 : 12);
    if (a * v === a + v) return null;
    return { a, v };
  },
  build(p) {
    const stem = cv(p.a);
    return {
      stem,
      given: [`x = ${p.v}`],
      answer: { canonical: rstr(I(p.a * p.v)), tex: String(p.a * p.v) },
      sigs: { "juxtaposition-means-add": { canonical: rstr(I(p.a + p.v)), tex: String(p.a + p.v) } },
      hint: { a: p.a, v: p.v },
      trace: (misc) =>
        misc === "juxtaposition-means-add"
          ? [L(stem, "expr"), L(`${p.a} + ${p.v}`, "expr"), L(String(p.a + p.v), "expr")]
          : [L(stem, "expr"), L(`${p.a} \\cdot ${p.v}`, "expr"), L(String(p.a * p.v), "expr")],
      traceKind: "expr",
      gen: {
        kind: "loadReadsAt",
        check: { kind: "loadReadsAt", unknown: "x", at: p.v, value: p.a * p.v, needs: ["letter"] },
        witness: cv(p.a),
        ask: "ask.gen.loadReadsAt",
        sigs: {},
      },
    };
  },
});

shape({
  id: "eval-substitute.twice",
  kp: "eval-substitute",
  ask: "ask.reading",
  answerType: "integer",
  draw(rand, tier) {
    const v = intIn(rand, 2, tier === "easy" ? 9 : 24);
    return { v };
  },
  build(p) {
    const stem = `x^{2} + x`;
    const correct = p.v * p.v + p.v;
    const wrong = p.v * p.v;
    return {
      stem,
      given: [`x = ${p.v}`],
      answer: { canonical: rstr(I(correct)), tex: String(correct) },
      sigs: {
        "substitute-first-occurrence-only": { canonical: rstr(I(wrong)), tex: String(wrong) },
      },
      hint: { v: p.v, sq: p.v * p.v },
      trace: (misc) =>
        misc === "substitute-first-occurrence-only"
          ? [L(stem, "expr"), L(`${p.v}^{2}`, "expr"), L(String(wrong), "expr")]
          : [L(stem, "expr"), L(`${p.v}^{2} + ${p.v}`, "expr"), L(String(correct), "expr")],
      traceKind: "expr",
      gen: {
        kind: "loadReadsAt",
        check: { kind: "loadReadsAt", unknown: "x", at: p.v, value: correct, needs: ["letter"] },
        witness: "x^{2} + x",
        ask: "ask.gen.loadReadsAt",
        sigs: {},
      },
    };
  },
});

shape({
  id: "eval-substitute.concat",
  kp: "eval-substitute",
  ask: "ask.reading",
  answerType: "integer",
  draw(rand, tier) {
    const a = intIn(rand, 2, 9);
    const v = intIn(rand, 2, 9);
    const concat = Number(`${a}${v}`);
    if (a + v === concat) return null;
    return { a, v, concat };
  },
  build(p) {
    const stem = `${p.a} + n`;
    return {
      stem,
      given: [`n = ${p.v}`],
      answer: { canonical: rstr(I(p.a + p.v)), tex: String(p.a + p.v) },
      sigs: {
        "substitute-by-concatenation": { canonical: rstr(I(p.concat)), tex: String(p.concat) },
      },
      hint: { a: p.a, v: p.v },
      trace: (misc) => [
        L(stem, "expr"),
        L(`${p.a} + ${p.v}`, "expr"),
        L(String(misc === "substitute-by-concatenation" ? p.concat : p.a + p.v), "expr"),
      ],
      traceKind: "expr",
      gen: {
        kind: "loadReadsAt",
        check: { kind: "loadReadsAt", unknown: "n", at: p.v, value: p.a + p.v, needs: ["letter"] },
        witness: `${p.a} + n`,
        ask: "ask.gen.loadReadsAt",
        sigs: {},
      },
    };
  },
});

shape({
  id: "eval-substitute.coefficient",
  kp: "eval-substitute",
  ask: "ask.reading",
  answerType: "integer",
  draw(rand, tier) {
    const a = intIn(rand, 2, tier === "easy" ? 7 : 12);
    const v = intIn(rand, 2, tier === "easy" ? 7 : 12);
    if (a * v === v) return null;
    return { a, v };
  },
  build(p) {
    const stem = cv(p.a);
    return {
      stem,
      given: [`x = ${p.v}`],
      answer: { canonical: rstr(I(p.a * p.v)), tex: String(p.a * p.v) },
      sigs: {
        "coefficient-dropped-on-substitution": { canonical: rstr(I(p.v)), tex: String(p.v) },
      },
      gen: {
        kind: "loadReadsAt",
        check: { kind: "loadReadsAt", unknown: "x", at: p.v, value: p.a * p.v, needs: ["letter"] },
        witness: cv(p.a),
        ask: "ask.gen.loadReadsAt",
        sigs: {},
      },
      hint: { a: p.a, v: p.v },
      trace: (misc) =>
        misc === "coefficient-dropped-on-substitution"
          ? [L(stem, "expr"), L(String(p.v), "expr")]
          : [L(stem, "expr"), L(`${p.a} \\cdot ${p.v}`, "expr"), L(String(p.a * p.v), "expr")],
      traceKind: "expr",
    };
  },
});

shape({
  id: "eval-signed.square",
  kp: "eval-signed",
  ask: "ask.reading",
  answerType: "integer",
  draw(rand, tier) {
    const v = intIn(rand, 2, tier === "easy" ? 9 : 20);
    return { v };
  },
  build(p) {
    const stem = `x^{2}`;
    const correct = p.v * p.v;
    return {
      stem,
      given: [`x = -${p.v}`],
      answer: { canonical: rstr(I(correct)), tex: String(correct) },
      sigs: { "negative-substituted-bare": { canonical: rstr(I(-correct)), tex: String(-correct) } },
      hint: { v: p.v, sq: correct },
      trace: (misc) =>
        misc === "negative-substituted-bare"
          ? [L(stem, "expr"), L(`-${p.v}^{2}`, "expr"), L(String(-correct), "expr")]
          : [L(stem, "expr"), L(`${paren(`-${p.v}`)}^{2}`, "expr"), L(String(correct), "expr")],
      traceKind: "expr",
      gen: {
        kind: "loadReadsAt",
        check: { kind: "loadReadsAt", unknown: "x", at: -p.v, value: correct, needs: ["letter"] },
        witness: "x^{2}",
        ask: "ask.gen.loadReadsAt",
        sigs: {},
      },
    };
  },
});

shape({
  id: "eval-signed.minusneg",
  kp: "eval-signed",
  ask: "ask.reading",
  answerType: "integer",
  draw(rand, tier) {
    const a = intIn(rand, 2, tier === "easy" ? 9 : 15);
    const b = intIn(rand, 2, 9);
    return { a, b };
  },
  build(p) {
    const stem = `${p.a} - x`;
    return {
      stem,
      given: [`x = -${p.b}`],
      answer: { canonical: rstr(I(p.a + p.b)), tex: String(p.a + p.b) },
      sigs: {
        "double-negative-collapsed-wrong": { canonical: rstr(I(p.a - p.b)), tex: String(p.a - p.b) },
      },
      hint: { a: p.a, b: p.b },
      trace: (misc) =>
        misc === "double-negative-collapsed-wrong"
          ? [L(stem, "expr"), L(`${p.a} - ${p.b}`, "expr"), L(String(p.a - p.b), "expr")]
          : [L(stem, "expr"), L(`${p.a} - ${paren(`-${p.b}`)}`, "expr"), L(String(p.a + p.b), "expr")],
      traceKind: "expr",
      gen: {
        kind: "loadReadsAt",
        check: { kind: "loadReadsAt", unknown: "x", at: -p.b, value: p.a + p.b, needs: ["letter"] },
        witness: `${p.a} - x`,
        ask: "ask.gen.loadReadsAt",
        sigs: {},
      },
    };
  },
});

shape({
  id: "eval-signed.sumneg",
  kp: "eval-signed",
  ask: "ask.reading",
  answerType: "integer",
  draw(rand, tier) {
    const a = intIn(rand, 2, tier === "easy" ? 8 : 13);
    const b = intIn(rand, 2, tier === "easy" ? 8 : 13);
    return { a, b };
  },
  build(p) {
    const stem = `x + y`;
    return {
      stem,
      given: [`x = -${p.a}`, `y = -${p.b}`],
      answer: { canonical: rstr(I(-(p.a + p.b))), tex: String(-(p.a + p.b)) },
      sigs: {
        "two-negatives-make-positive-on-sum": {
          canonical: rstr(I(p.a + p.b)),
          tex: String(p.a + p.b),
        },
      },
      hint: { a: p.a, b: p.b },
      trace: (misc) =>
        misc === "two-negatives-make-positive-on-sum"
          ? [L(stem, "expr"), L(`${p.a} + ${p.b}`, "expr"), L(String(p.a + p.b), "expr")]
          : [
              L(stem, "expr"),
              L(`${paren(`-${p.a}`)} + ${paren(`-${p.b}`)}`, "expr"),
              L(String(-(p.a + p.b)), "expr"),
            ],
      traceKind: "expr",
      gen: {
        kind: "loadReadsAt",
        check: { kind: "loadReadsAt", unknown: "x", at: -p.a, value: -(p.a + p.b), needs: ["letter"] },
        witness: `x - ${p.b}`,
        ask: "ask.gen.loadReadsAt",
        sigs: {},
      },
    };
  },
});

shape({
  id: "eval-formula.two",
  kp: "eval-formula",
  ask: "ask.reading",
  answerType: "integer",
  draw(rand, tier) {
    const c = intIn(rand, 2, tier === "easy" ? 4 : 7);
    const d = intIn(rand, 2, tier === "easy" ? 4 : 7);
    const pp = intIn(rand, 2, tier === "easy" ? 8 : 12);
    const q = intIn(rand, 2, tier === "easy" ? 8 : 12);
    const correct = c * pp + d * q;
    const s1 = c * pp; // second-variable-ignored
    const s2 = c * q + d * pp; // values-assigned-by-order
    const s3 = c * pp + d * pp; // one-value-for-all-letters
    const vals = [correct, s1, s2, s3];
    if (new Set(vals).size !== 4) return null;
    return { c, d, p: pp, q };
  },
  build(p) {
    const stem = `${cv(p.c, "r")} + ${cv(p.d, "s")}`;
    const correct = p.c * p.p + p.d * p.q;
    return {
      stem,
      given: [`r = ${p.p}`, `s = ${p.q}`],
      answer: { canonical: rstr(I(correct)), tex: String(correct) },
      sigs: {
        "second-variable-ignored": { canonical: rstr(I(p.c * p.p)), tex: String(p.c * p.p) },
        "values-assigned-by-order": {
          canonical: rstr(I(p.c * p.q + p.d * p.p)),
          tex: String(p.c * p.q + p.d * p.p),
        },
        "one-value-for-all-letters": {
          canonical: rstr(I(p.c * p.p + p.d * p.p)),
          tex: String(p.c * p.p + p.d * p.p),
        },
      },
      hint: { c: p.c, d: p.d, p: p.p, q: p.q, rise: p.c * p.p },
      trace: (misc) => {
        const seatR = misc === "values-assigned-by-order" ? p.q : p.p;
        const seatS =
          misc === "values-assigned-by-order"
            ? p.p
            : misc === "one-value-for-all-letters"
              ? p.p
              : misc === "second-variable-ignored"
                ? 0
                : p.q;
        const val = p.c * seatR + p.d * seatS;
        return [
          L(stem, "expr"),
          L(`${p.c} \\cdot ${seatR} + ${p.d} \\cdot ${seatS}`, "expr"),
          L(String(val), "expr"),
        ];
      },
      traceKind: "expr",
      gen: {
        kind: "loadReadsAt",
        check: { kind: "loadReadsAt", unknown: "r", at: p.p, value: correct, needs: ["letter"] },
        witness: `${cv(p.c, "r")} + ${p.d * p.q}`,
        ask: "ask.gen.loadReadsAt",
        sigs: {},
      },
    };
  },
});

/* ============================================================ TRANSLATION strand */

shape({
  id: "translate-phrase.groups",
  kp: "translate-phrase",
  ask: "ask.load",
  answerType: "expression",
  draw(rand, tier) {
    const a = intIn(rand, 3, tier === "easy" ? 6 : 9);
    const b = intIn(rand, 2, 9);
    return { a, b };
  },
  build(p) {
    const stem = `n`;
    return {
      stem,
      given: [],
      unknown: "n",
      spoken: { key: "spoken.translate-phrase.groups", params: { a: p.a, b: p.b } },
      answer: { canonical: canonExpr(`${p.a}n + ${p.b}`), tex: `${cv(p.a, "n")} + ${p.b}` },
      sigs: {
        "keyword-without-structure": {
          canonical: canonExpr(`${p.a} + n + ${p.b}`),
          tex: `${p.a} + n + ${p.b}`,
        },
        "no-variable-introduced": {
          canonical: canonExpr(String(p.a + p.b)),
          tex: String(p.a + p.b),
        },
      },
      hint: { a: p.a, b: p.b },
      trace: (misc) => {
        const line =
          misc === "keyword-without-structure"
            ? `${p.a} + n + ${p.b}`
            : misc === "no-variable-introduced"
              ? String(p.a + p.b)
              : `${cv(p.a, "n")} + ${p.b}`;
        return [L(`n`, "expr"), L(line, "expr")];
      },
      traceKind: "expr",
      gen: {
        kind: "loadGathersTo",
        check: {
          kind: "loadGathersTo",
          target: canonExpr(`${p.a}n + ${p.b}`),
          unknown: "n",
          needs: ["letter"],
        },
        witness: `${cv(p.a, "n")} + ${p.b}`,
        ask: "ask.gen.sealCan",
        sigs: {},
      },
    };
  },
});

shape({
  id: "translate-phrase.twice",
  kp: "translate-phrase",
  ask: "ask.load",
  answerType: "expression",
  draw(rand, tier) {
    const b = intIn(rand, 3, tier === "easy" ? 12 : 24);
    if (b === 2) return null;
    return { b };
  },
  build(p) {
    const stem = `n`;
    return {
      stem,
      given: [],
      unknown: "n",
      spoken: { key: "spoken.translate-phrase.twice", params: { b: p.b } },
      answer: { canonical: canonExpr(`2n + ${p.b}`), tex: `2n + ${p.b}` },
      sigs: {
        "twice-read-as-plus-two": {
          canonical: canonExpr(`n + 2 + ${p.b}`),
          tex: `n + 2 + ${p.b}`,
        },
        "no-variable-introduced": { canonical: canonExpr(String(2 + p.b)), tex: String(2 + p.b) },
      },
      hint: { b: p.b },
      trace: (misc) => {
        const line =
          misc === "twice-read-as-plus-two"
            ? `n + 2 + ${p.b}`
            : misc === "no-variable-introduced"
              ? String(2 + p.b)
              : `2n + ${p.b}`;
        return [L(`n`, "expr"), L(line, "expr")];
      },
      traceKind: "expr",
    };
  },
});

shape({
  id: "translate-order.lessthan",
  kp: "translate-order",
  ask: "ask.load",
  answerType: "expression",
  draw(rand, tier) {
    const a = intIn(rand, 2, tier === "easy" ? 9 : 15);
    return { a };
  },
  build(p) {
    const stem = `n`;
    return {
      stem,
      given: [],
      unknown: "n",
      spoken: { key: "spoken.translate-order.lessthan", params: { a: p.a } },
      answer: { canonical: canonExpr(`n - ${p.a}`), tex: `n - ${p.a}` },
      sigs: {
        "less-than-reversed": { canonical: canonExpr(`${p.a} - n`), tex: `${p.a} - n` },
      },
      hint: { a: p.a },
      trace: (misc) => [
        L(`n`, "expr"),
        L(misc === "less-than-reversed" ? `${p.a} - n` : `n - ${p.a}`, "expr"),
      ],
      traceKind: "expr",
    };
  },
});

shape({
  id: "translate-order.subtractfrom",
  kp: "translate-order",
  ask: "ask.load",
  answerType: "expression",
  draw(rand, tier) {
    const a = intIn(rand, 6, tier === "easy" ? 15 : 40);
    return { a };
  },
  build(p) {
    const stem = `n`;
    return {
      stem,
      given: [],
      unknown: "n",
      spoken: { key: "spoken.translate-order.subtractfrom", params: { a: p.a } },
      answer: { canonical: canonExpr(`${p.a} - n`), tex: `${p.a} - n` },
      sigs: {
        "subtract-from-reversed": { canonical: canonExpr(`n - ${p.a}`), tex: `n - ${p.a}` },
      },
      hint: { a: p.a },
      trace: (misc) => [
        L(`n`, "expr"),
        L(misc === "subtract-from-reversed" ? `n - ${p.a}` : `${p.a} - n`, "expr"),
      ],
      traceKind: "expr",
    };
  },
});

shape({
  id: "translate-order.dividedinto",
  kp: "translate-order",
  ask: "ask.load",
  answerType: "expression",
  draw(rand, tier) {
    const a = intIn(rand, 6, tier === "easy" ? 24 : 60);
    return { a };
  },
  build(p) {
    const stem = `n`;
    return {
      stem,
      given: [],
      unknown: "n",
      spoken: { key: "spoken.translate-order.dividedinto", params: { a: p.a } },
      answer: { canonical: canonExpr(`${p.a}/n`), tex: `\\frac{${p.a}}{n}` },
      sigs: {
        "divided-into-reversed": { canonical: canonExpr(`n/${p.a}`), tex: `\\frac{n}{${p.a}}` },
      },
      hint: { a: p.a },
      trace: (misc) => [
        L(`n`, "expr"),
        L(misc === "divided-into-reversed" ? `\\frac{n}{${p.a}}` : `\\frac{${p.a}}{n}`, "expr"),
      ],
      traceKind: "expr",
      gen: {
        kind: "loadGathersTo",
        check: { kind: "loadGathersTo", target: canonExpr(`${p.a}/n`), unknown: "n", needs: ["letter"] },
        witness: `\\frac{${p.a}}{n}`,
        ask: "ask.gen.sealCan",
        sigs: {},
      },
    };
  },
});

shape({
  id: "translate-sentence.core",
  kp: "translate-sentence",
  ask: "ask.claim",
  answerType: "equation",
  draw(rand, tier) {
    const a = intIn(rand, 2, tier === "easy" ? 6 : 9);
    const b = intIn(rand, 2, 9);
    const c = intIn(rand, 12, tier === "easy" ? 40 : 90);
    if ((c - b) % a !== 0) return null;
    if (a * c + b === c) return null;
    return { a, b, c };
  },
  build(p) {
    const stem = `n`;
    return {
      stem,
      given: [],
      unknown: "n",
      spoken: { key: "spoken.translate-sentence.core", params: { a: p.a, b: p.b, c: p.c } },
      answer: {
        canonical: canonEquation(`${p.a}n + ${p.b} = ${p.c}`),
        tex: `${cv(p.a, "n")} + ${p.b} = ${p.c}`,
      },
      sigs: {
        "produces-expression-not-equation": {
          canonical: canonExpr(`${p.a}n + ${p.b}`),
          tex: `${cv(p.a, "n")} + ${p.b}`,
          kindOverride: "expression",
        },
        "sides-merged": {
          canonical: canonExpr(`${p.b} + ${p.a}n + ${p.c}`),
          tex: `${p.b} + ${cv(p.a, "n")} + ${p.c}`,
          kindOverride: "expression",
        },
        "unknown-defined-as-wrong-quantity": {
          canonical: canonEquation(`${p.a} \\cdot ${p.c} + ${p.b} = n`),
          tex: `${p.a} \\cdot ${p.c} + ${p.b} = n`,
        },
      },
      hint: { a: p.a, b: p.b, c: p.c },
      trace: (misc) => {
        const line =
          misc === "sides-merged"
            ? `${p.b} + ${cv(p.a, "n")} + ${p.c}`
            : misc === "produces-expression-not-equation"
              ? `${cv(p.a, "n")} + ${p.b}`
              : misc === "unknown-defined-as-wrong-quantity"
                ? `${p.a} \\cdot ${p.c} + ${p.b} = n`
                : `${cv(p.a, "n")} + ${p.b} = ${p.c}`;
        return [L(`n`, "expr"), misc === "sides-merged" || misc === "produces-expression-not-equation" ? L(line, "expr") : L(line)];
      },
      traceKind: "mixed",
      gen: {
        kind: "claimClosesAt",
        check: {
          kind: "claimClosesAt",
          unknown: "n",
          value: rstr(rat(p.c - p.b, p.a)),
          needs: ["coefficient", "constantWithUnknown"],
        },
        witness: `${cv(p.a, "n")} + ${p.b} = ${p.c}`,
        ask: "ask.gen.saidClaim",
        sigs: {},
      },
    };
  },
});

/* ============================================================ STRUCTURE strand */

shape({
  id: "props-operations.commute",
  kp: "props-operations",
  ask: "ask.load",
  answerType: "expression",
  draw(rand, tier) {
    const a = intIn(rand, 2, tier === "easy" ? 9 : 15);
    const b = nz(rand, 2, 9);
    return { a, b };
  },
  build(p) {
    const stem = `${p.a} - ${cv(p.b)}`;
    return {
      stem,
      given: [],
      answer: { canonical: canonExpr(`-${p.b}x + ${p.a}`), tex: `${cv(-p.b)} + ${p.a}` },
      sigs: {
        "subtraction-commutes": {
          canonical: canonExpr(`${p.b}x - ${p.a}`),
          tex: `${cv(p.b)} - ${p.a}`,
        },
      },
      hint: { a: p.a, b: p.b },
      trace: (misc) => [
        L(stem, "expr"),
        L(misc === "subtraction-commutes" ? `${cv(p.b)} - ${p.a}` : `${cv(-p.b)} + ${p.a}`, "expr"),
      ],
      traceKind: "expr",
      gen: {
        kind: "loadGathersTo",
        check: { kind: "loadGathersTo", target: canonExpr(`-${p.b}x + ${p.a}`), unknown: "x", needs: ["letter"] },
        witness: `${cv(-p.b)} + ${p.a}`,
        ask: "ask.gen.gathersTo",
        sigs: {},
      },
    };
  },
});

shape({
  id: "props-operations.regroup",
  kp: "props-operations",
  ask: "ask.reading",
  answerType: "integer",
  draw(rand, tier) {
    const a = intIn(rand, 10, tier === "easy" ? 25 : 45);
    const b = intIn(rand, 2, 9);
    const c = nz(rand, 2, 9);
    if (a - (b + c) === a - b + c) return null;
    return { a, b, c };
  },
  build(p) {
    const stem = `${p.a} - \\left(${p.b} + ${p.c}\\right)`;
    return {
      stem,
      given: [],
      answer: { canonical: rstr(I(p.a - (p.b + p.c))), tex: String(p.a - (p.b + p.c)) },
      sigs: {
        "regroup-across-subtraction": {
          canonical: rstr(I(p.a - p.b + p.c)),
          tex: String(p.a - p.b + p.c),
        },
      },
      hint: { a: p.a, b: p.b, c: p.c, inner: p.b + p.c },
      gen: {
        kind: "loadAuthor",
        check: { kind: "loadAuthor", settleTo: p.a - (p.b + p.c), needs: ["bundle", "sum"] },
        witness: `${p.a} - \\left(${p.b} + ${p.c}\\right)`,
        ask: "ask.gen.loadTo",
        sigs: {},
      },
      trace: (misc) =>
        misc === "regroup-across-subtraction"
          ? [L(stem, "expr"), L(`${p.a - p.b} + ${p.c}`, "expr"), L(String(p.a - p.b + p.c), "expr")]
          : [L(stem, "expr"), L(`${p.a} - ${p.b + p.c}`, "expr"), L(String(p.a - (p.b + p.c)), "expr")],
      traceKind: "expr",
    };
  },
});

shape({
  id: "props-operations.identity",
  kp: "props-operations",
  ask: "ask.load",
  answerType: "expression",
  draw(rand, tier) {
    const a = nz(rand, 2, tier === "easy" ? 12 : 24);
    return { a };
  },
  build(p) {
    const stem = `${cv(p.a)} \\cdot 0 + x`;
    return {
      stem,
      given: [],
      answer: { canonical: canonExpr(`x`), tex: `x` },
      sigs: {
        "identity-swapped": {
          canonical: canonExpr(`${p.a}x + x`),
          tex: `${cv(p.a)} + x`,
        },
      },
      hint: { a: p.a },
      trace: (misc) => [
        L(stem, "expr"),
        L(misc === "identity-swapped" ? `${cv(p.a)} + x` : `0 + x`, "expr"),
        L(misc === "identity-swapped" ? cv(p.a + 1) : `x`, "expr"),
      ],
      traceKind: "expr",
      gen: {
        kind: "loadGathersTo",
        check: { kind: "loadGathersTo", target: canonExpr("x"), unknown: "x", needs: ["letter"] },
        witness: `x + ${cv(p.a)} \\cdot 0`,
        ask: "ask.gen.sealCan",
        sigs: {},
      },
    };
  },
});

const LTI_SHAPES = [
  {
    id: "like-terms-id.xy",
    build(p) {
      const terms = [cv(p.a), cv(p.b, "y"), String(p.c), cv(p.d), cv(p.e, "y")];
      const correct = `${cv(p.a)}, ${cv(p.d)} | ${cv(p.b, "y")}, ${cv(p.e, "y")} | ${p.c}`;
      return {
        terms,
        correct,
        sigs: {
          "all-variable-terms-alike": `${cv(p.a)}, ${cv(p.b, "y")}, ${cv(p.d)}, ${cv(p.e, "y")} | ${p.c}`,
          "constant-like-variable": `${cv(p.a)}, ${cv(p.d)}, ${p.c} | ${cv(p.b, "y")}, ${cv(p.e, "y")}`,
        },
      };
    },
  },
  {
    id: "like-terms-id.pow",
    build(p) {
      const terms = [cv(p.a), cv(p.b, "x", 2), String(p.c), cv(p.d), cv(p.e, "x", 2)];
      const correct = `${cv(p.a)}, ${cv(p.d)} | ${cv(p.b, "x", 2)}, ${cv(p.e, "x", 2)} | ${p.c}`;
      return {
        terms,
        correct,
        // Only one reading is declared here on purpose. On a stem whose letters are all `x`,
        // "all variable terms are alike" and "the power does not matter" are the SAME response,
        // and rule (4) forbids serving a stem that cannot tell two wrong ideas apart. The
        // `xy` shape is where `all-variable-terms-alike` is separable, so that is where it lives.
        sigs: {
          "exponent-ignored-in-matching": `${cv(p.a)}, ${cv(p.b, "x", 2)}, ${cv(p.d)}, ${cv(p.e, "x", 2)} | ${p.c}`,
          "constant-like-variable": `${cv(p.a)}, ${cv(p.d)}, ${p.c} | ${cv(p.b, "x", 2)}, ${cv(p.e, "x", 2)}`,
        },
      };
    },
  },
];

for (const s of LTI_SHAPES) {
  shape({
    id: s.id,
    kp: "like-terms-id",
    ask: "ask.groups",
    answerType: "partition",
    draw(rand, tier) {
      const vals = new Set();
      const draws = [];
      for (let i = 0; i < 5; i++) {
        let v = nz(rand, 2, tier === "easy" ? 7 : 9);
        let guard = 0;
        while (vals.has(v) && guard++ < 20) v = nz(rand, 2, 9);
        vals.add(v);
        draws.push(v);
      }
      if (vals.size !== 5) return null;
      const [a, b, c, d, e] = draws;
      return { a, b, c, d, e };
    },
    build(p) {
      const s2 = s.build(p);
      const sigs = {};
      for (const [k, v] of Object.entries(s2.sigs)) {
        sigs[k] = { canonical: canonPartition(v), tex: v.replace(/\|/g, "\\;\\mid\\;") };
      }
      // The two readings collapse on the `pow` shape; the framework's separation filter
      // deletes the stem when they do, so declare both and let it decide.
      return {
        stem: s2.terms.join(" \\;\\; "),
        given: [],
        answer: {
          canonical: canonPartition(s2.correct),
          tex: s2.correct.replace(/\|/g, "\\;\\mid\\;"),
        },
        sigs,
        hint: { first: s2.terms[0], count: 3 },
        trace: (misc) => {
          const line = misc && s2.sigs[misc] ? s2.sigs[misc] : s2.correct;
          return [
            { tex: s2.terms.join(" \\;\\; "), canon: "terms", kind: "raw" },
            { tex: line.replace(/\|/g, "\\;\\mid\\;"), canon: canonPartition(line), kind: "partition" },
          ];
        },
        traceKind: "partition",
        gen: {
          kind: "partitionWitness",
          check: {
            kind: "partitionWitness",
            mustStandWith: canonExpr(s2.terms[0]),
            excludes: s2.terms.map((t) => canonExpr(t)),
          },
          // One more than the largest count on the stem, so the witness can never collide with
          // a term already standing in the stacks.
          witness: cv(Math.max(p.a, p.b, p.c, p.d, p.e) + 1),
          ask: "ask.gen.standsWith",
          sigs: {
            "all-variable-terms-alike": { canonical: canonExpr(s2.terms[1]), tex: s2.terms[1] },
          },
        },
      };
    },
  });
}

shape({
  id: "like-terms-combine.core",
  kp: "like-terms-combine",
  ask: "ask.load",
  answerType: "expression",
  draw(rand, tier) {
    const a = coefDraw(rand, tier);
    const d = coefDraw(rand, tier);
    const b = coefDraw(rand, tier);
    const c = nz(rand, 2, 9);
    if (a === d) return null;
    return { a, b, c, d };
  },
  build(p) {
    const stem = sumTex([
      { c: p.a, v: "x" },
      { c: p.b, v: "y" },
      { c: -p.c },
      { c: -p.d, v: "x" },
    ]);
    const gathered = sumTex([{ c: p.a - p.d, v: "x" }, { c: p.b, v: "y" }, { c: -p.c }]);
    const alt = {
      "combine-unlike-terms": sumTex([
        { c: p.a + p.b, v: "xy" },
        { c: -p.d, v: "x" },
        { c: -p.c },
      ]),
      "variable-parts-added-too": sumTex([
        { c: p.a - p.d, v: "x", pow: 2 },
        { c: p.b, v: "y" },
        { c: -p.c },
      ]),
      "sign-left-behind-on-move": sumTex([
        { c: p.a - p.d, v: "x" },
        { c: p.b, v: "y" },
        { c: p.c },
      ]),
    };
    return {
      stem,
      given: [],
      answer: { canonical: canonExpr(gathered), tex: gathered },
      sigs: {
        "combine-unlike-terms": { canonical: canonExpr(alt["combine-unlike-terms"]), tex: alt["combine-unlike-terms"] },
        "variable-parts-added-too": {
          canonical: canonExpr(alt["variable-parts-added-too"]),
          tex: alt["variable-parts-added-too"],
        },
        "sign-left-behind-on-move": {
          canonical: canonExpr(alt["sign-left-behind-on-move"]),
          tex: alt["sign-left-behind-on-move"],
        },
      },
      hint: { a: p.a, b: p.b, c: p.c, d: p.d, gathered: p.a - p.d },
      trace: (misc) => [L(stem, "expr"), L(misc ? alt[misc] : gathered, "expr")],
      traceKind: "expr",
      gen: {
        kind: "loadGathersTo",
        check: {
          kind: "loadGathersTo",
          target: canonExpr(gathered),
          unknown: "x",
          needs: ["twoLikeTerms"],
        },
        witness: stem,
        ask: "ask.gen.gathersTo",
        sigs: {},
      },
    };
  },
});

shape({
  id: "distribute-numeric.sum",
  kp: "distribute-numeric",
  ask: "ask.reading",
  answerType: "integer",
  draw(rand, tier) {
    const a = tier === "easy" ? intIn(rand, 2, 5) : coefDraw(rand, tier);
    const b = nz(rand, tier === "easy" ? 2 : -9, 9);
    const c = nz(rand, tier === "easy" ? 2 : -9, 9);
    const correct = a * b + a * c;
    const s1 = a * b + c;
    const s2 = a + b + (a + c);
    if (new Set([correct, s1, s2]).size !== 3) return null;
    return { a, b, c };
  },
  build(p) {
    const stem = `${p.a}\\left(${p.b}${plus(p.c)}\\right)`;
    const correct = p.a * p.b + p.a * p.c;
    return {
      stem,
      given: [],
      answer: { canonical: rstr(I(correct)), tex: String(correct) },
      sigs: {
        "distribute-to-first-term-only": {
          canonical: rstr(I(p.a * p.b + p.c)),
          tex: String(p.a * p.b + p.c),
        },
        "distribute-by-adding": {
          canonical: rstr(I(p.a + p.b + (p.a + p.c))),
          tex: String(p.a + p.b + (p.a + p.c)),
        },
      },
      hint: { a: p.a, b: p.b, c: p.c, first: p.a * p.b, second: p.a * p.c },
      trace: (misc) => {
        const mid = {
          "distribute-to-first-term-only": `${p.a * p.b}${plus(p.c)}`,
          "distribute-by-adding": `${p.a + p.b}${plus(p.a + p.c)}`,
        }[misc] || `${p.a * p.b}${plus(p.a * p.c)}`;
        return [L(stem, "expr"), L(mid, "expr"), L(String(canonNumberValue(mid)), "expr")];
      },
      traceKind: "expr",
      gen: {
        kind: "loadAuthor",
        check: { kind: "loadAuthor", settleTo: correct, needs: ["bundle"] },
        witness: stem,
        ask: "ask.gen.lockOpensAt",
        sigs: {},
      },
    };
  },
});

function canonNumberValue(tex) {
  return Number(canonNumber(tex));
}

shape({
  id: "distribute-numeric.product",
  kp: "distribute-numeric",
  ask: "ask.reading",
  answerType: "integer",
  draw(rand, tier) {
    const a = intIn(rand, 2, tier === "easy" ? 4 : 6);
    const b = intIn(rand, 2, 6);
    const c = intIn(rand, 2, 6);
    if (a * b * c === a * b * (a * c)) return null;
    return { a, b, c };
  },
  build(p) {
    const stem = `${p.a}\\left(${p.b} \\cdot ${p.c}\\right)`;
    const correct = p.a * p.b * p.c;
    const wrong = p.a * p.b * (p.a * p.c);
    return {
      stem,
      given: [],
      answer: { canonical: rstr(I(correct)), tex: String(correct) },
      sigs: { "distribute-over-a-product": { canonical: rstr(I(wrong)), tex: String(wrong) } },
      hint: { a: p.a, b: p.b, c: p.c, inner: p.b * p.c },
      trace: (misc) =>
        misc === "distribute-over-a-product"
          ? [L(stem, "expr"), L(`${p.a * p.b} \\cdot ${p.a * p.c}`, "expr"), L(String(wrong), "expr")]
          : [L(stem, "expr"), L(`${p.a} \\cdot ${p.b * p.c}`, "expr"), L(String(correct), "expr")],
      traceKind: "expr",
    };
  },
});

shape({
  id: "distribute-variable.core",
  kp: "distribute-variable",
  ask: "ask.load",
  answerType: "expression",
  draw(rand, tier) {
    const a = tier === "easy" ? intIn(rand, 2, 5) : coefDraw(rand, tier);
    const b = tier === "easy" ? intIn(rand, 2, 5) : coefDraw(rand, tier);
    const c = nz(rand, tier === "easy" ? 2 : -9, 9);
    return { a, b, c };
  },
  build(p) {
    const stem = `${p.a}\\left(${cv(p.b)}${plus(p.c)}\\right)`;
    const correct = `${cv(p.a * p.b)}${plus(p.a * p.c)}`;
    return {
      stem,
      given: [],
      answer: { canonical: canonExpr(correct), tex: correct },
      sigs: {
        "variable-multiplied-as-well": {
          canonical: canonExpr(`${p.a * p.b}x^2 ${plus(p.a * p.c)}`),
          tex: `${cv(p.a * p.b, "x", 2)}${plus(p.a * p.c)}`,
        },
        "distribute-reaches-variable-only": {
          canonical: canonExpr(`${p.a * p.b}x ${plus(p.c)}`),
          tex: `${cv(p.a * p.b)}${plus(p.c)}`,
        },
        "coefficients-added-not-multiplied": {
          canonical: canonExpr(`${p.a + p.b}x ${plus(p.a + p.c)}`),
          tex: `${cv(p.a + p.b)}${plus(p.a + p.c)}`,
        },
      },
      hint: { a: p.a, b: p.b, c: p.c, first: p.a * p.b, second: p.a * p.c },
      trace: (misc) => {
        const line =
          {
            "variable-multiplied-as-well": `${cv(p.a * p.b, "x", 2)}${plus(p.a * p.c)}`,
            "distribute-reaches-variable-only": `${cv(p.a * p.b)}${plus(p.c)}`,
            "coefficients-added-not-multiplied": `${cv(p.a + p.b)}${plus(p.a + p.c)}`,
          }[misc] || correct;
        return [L(stem, "expr"), L(line, "expr")];
      },
      traceKind: "expr",
      gen: {
        kind: "loadGathersTo",
        check: { kind: "loadGathersTo", target: canonExpr(correct), unknown: "x", needs: ["bundle"] },
        witness: stem,
        ask: "ask.gen.gathersTo",
        sigs: {},
      },
    };
  },
});

shape({
  id: "distribute-negative.bare",
  kp: "distribute-negative",
  ask: "ask.load",
  answerType: "expression",
  draw(rand, tier) {
    const b = tier === "easy" ? intIn(rand, 2, 6) : coefDraw(rand, tier);
    const c = nz(rand, tier === "easy" ? 2 : -9, 9);
    return { b, c };
  },
  build(p) {
    const stem = `-\\left(${cv(p.b)}${plus(p.c)}\\right)`;
    const correct = `${cv(-p.b)}${plus(-p.c)}`;
    return {
      stem,
      given: [],
      answer: { canonical: canonExpr(correct), tex: correct },
      sigs: {
        "flip-first-term-only": {
          canonical: canonExpr(`${-p.b}x ${plus(p.c)}`),
          tex: `${cv(-p.b)}${plus(p.c)}`,
        },
        "leading-minus-dropped": {
          canonical: canonExpr(`${p.b}x ${plus(p.c)}`),
          tex: `${cv(p.b)}${plus(p.c)}`,
        },
      },
      hint: { b: p.b, c: p.c },
      trace: (misc) => {
        const line =
          {
            "flip-first-term-only": `${cv(-p.b)}${plus(p.c)}`,
            "leading-minus-dropped": `${cv(p.b)}${plus(p.c)}`,
          }[misc] || correct;
        return [L(stem, "expr"), L(line, "expr")];
      },
      traceKind: "expr",
    };
  },
});

shape({
  id: "distribute-negative.subtract",
  kp: "distribute-negative",
  ask: "ask.load",
  answerType: "expression",
  draw(rand, tier) {
    const a = intIn(rand, 2, tier === "easy" ? 9 : 15);
    const b = intIn(rand, 2, tier === "easy" ? 5 : 7);
    const c = nz(rand, tier === "easy" ? 2 : -9, 9);
    return { a, b, c };
  },
  build(p) {
    const stem = `${p.a} - ${p.b}\\left(x${plus(p.c)}\\right)`;
    const correct = `${cv(-p.b)}${plus(p.a - p.b * p.c)}`;
    return {
      stem,
      given: [],
      answer: { canonical: canonExpr(correct), tex: correct },
      sigs: {
        "subtract-before-distributing": {
          canonical: canonExpr(`${p.a - p.b}x ${plus((p.a - p.b) * p.c)}`),
          tex: `${cv(p.a - p.b)}${plus((p.a - p.b) * p.c)}`,
        },
        "flip-first-term-only": {
          canonical: canonExpr(`${-p.b}x ${plus(p.a + p.b * p.c)}`),
          tex: `${cv(-p.b)}${plus(p.a + p.b * p.c)}`,
        },
        "leading-minus-dropped": {
          canonical: canonExpr(`${p.b}x ${plus(p.a + p.b * p.c)}`),
          tex: `${cv(p.b)}${plus(p.a + p.b * p.c)}`,
        },
      },
      hint: { a: p.a, b: p.b, c: p.c, product: p.b * p.c },
      trace: (misc) => {
        const line =
          {
            "subtract-before-distributing": `${cv(p.a - p.b)}${plus((p.a - p.b) * p.c)}`,
            "flip-first-term-only": `${cv(-p.b)}${plus(p.a + p.b * p.c)}`,
            "leading-minus-dropped": `${cv(p.b)}${plus(p.a + p.b * p.c)}`,
          }[misc] || correct;
        return [L(stem, "expr"), L(line, "expr")];
      },
      traceKind: "expr",
      gen: {
        kind: "loadGathersTo",
        check: {
          kind: "loadGathersTo",
          target: canonExpr(correct),
          unknown: "x",
          needs: ["bundle", "negativeOutside"],
        },
        witness: stem,
        ask: "ask.gen.gathersTo",
        sigs: {},
      },
    };
  },
});

shape({
  id: "simplify-expression.core",
  kp: "simplify-expression",
  ask: "ask.load",
  answerType: "expression",
  requiresGathered: true,
  draw(rand, tier) {
    const a = intIn(rand, 2, tier === "easy" ? 9 : 15);
    const b = tier === "easy" ? intIn(rand, 2, 5) : coefDraw(rand, tier);
    const c = nz(rand, tier === "easy" ? 2 : -9, 9);
    if (b + a + b * c === 0) return null;
    return { a, b, c };
  },
  build(p) {
    const stem = `${p.a} + ${p.b}\\left(x${plus(p.c)}\\right)`;
    const correct = `${cv(p.b)}${plus(p.a + p.b * p.c)}`;
    return {
      stem,
      given: [],
      answer: { canonical: canonExpr(correct), tex: correct },
      sigs: {
        "combine-before-distributing": {
          canonical: canonExpr(`${p.a + p.b}x ${plus((p.a + p.b) * p.c)}`),
          tex: `${cv(p.a + p.b)}${plus((p.a + p.b) * p.c)}`,
        },
        "over-combines-to-one-term": {
          canonical: canonExpr(`${p.b + p.a + p.b * p.c}x`),
          tex: cv(p.b + p.a + p.b * p.c),
        },
        "stops-before-fully-simplified": {
          canonical: canonExpr(correct),
          tex: `${p.a} + ${cv(p.b)}${plus(p.b * p.c)}`,
          surface: true,
        },
      },
      hint: { a: p.a, b: p.b, c: p.c, opened: p.b * p.c },
      trace: (misc) => {
        if (misc === "combine-before-distributing") {
          return [
            L(stem, "expr"),
            L(`${p.a + p.b}\\left(x${plus(p.c)}\\right)`, "expr"),
            L(`${cv(p.a + p.b)}${plus((p.a + p.b) * p.c)}`, "expr"),
          ];
        }
        if (misc === "over-combines-to-one-term") {
          return [
            L(stem, "expr"),
            L(`${p.a} + ${cv(p.b)}${plus(p.b * p.c)}`, "expr"),
            L(cv(p.b + p.a + p.b * p.c), "expr"),
          ];
        }
        if (misc === "stops-before-fully-simplified") {
          return [L(stem, "expr"), L(`${p.a} + ${cv(p.b)}${plus(p.b * p.c)}`, "expr")];
        }
        return [
          L(stem, "expr"),
          L(`${p.a} + ${cv(p.b)}${plus(p.b * p.c)}`, "expr"),
          L(correct, "expr"),
        ];
      },
      traceKind: "expr",
      gen: {
        kind: "loadGathersTo",
        check: {
          kind: "loadGathersTo",
          target: canonExpr(correct),
          unknown: "x",
          needs: ["bundle"],
        },
        witness: stem,
        ask: "ask.gen.gathersTo",
        sigs: {},
      },
    };
  },
});

shape({
  id: "equivalent-expressions.count",
  kp: "equivalent-expressions",
  ask: "ask.count",
  answerType: "integer",
  draw(rand, tier) {
    const a = intIn(rand, 2, tier === "easy" ? 5 : 8);
    const b = nz(rand, 2, 9);
    if (a * b === b) return null;
    return { a, b };
  },
  build(p) {
    const stem = `${p.a}\\left(x${plus(p.b)}\\right) \\;\\Rightarrow\\; ${cv(p.a)} + \\square`;
    return {
      stem,
      given: [],
      answer: { canonical: rstr(I(p.a * p.b)), tex: String(p.a * p.b) },
      sigs: {
        "different-form-means-different": { canonical: rstr(I(p.b)), tex: String(p.b) },
      },
      hint: { a: p.a, b: p.b },
      trace: (misc) => [
        L(`${p.a}\\left(x${plus(p.b)}\\right)`, "expr"),
        L(
          misc === "different-form-means-different"
            ? `${cv(p.a)}${plus(p.b)}`
            : `${cv(p.a)}${plus(p.a * p.b)}`,
          "expr"
        ),
      ],
      traceKind: "expr",
      gen: {
        // "Find a value where these two disagree" reads like the right item and is not one:
        // for a pair that agrees only at 0 and 1, thirty-nine of the forty-one integers in the
        // slot are correct, so a responder with no knowledge succeeds most of the time. The act
        // this node is actually about is building the other deck, which is checked and cannot
        // be reached by luck.
        kind: "loadGathersTo",
        check: {
          kind: "loadGathersTo",
          target: canonExpr(`${p.a}x + ${p.a * p.b}`),
          unknown: "x",
          needs: ["differentSurface"],
          surface: `${p.a}(x + ${p.b})`,
        },
        witness: `${cv(p.a)} + ${p.a * p.b}`,
        ask: "ask.gen.reshape",
        sigs: {
          "different-form-means-different": {
            canonical: `surface:${p.a}(x+${p.b})`,
            tex: `${p.a}\\left(x + ${p.b}\\right)`,
            surfaceMatch: true,
          },
          "counterexample-ignored": {
            canonical: canonExpr(`${p.a}x + ${p.b}`),
            tex: `${cv(p.a)} + ${p.b}`,
          },
          // A deck that agrees at exactly one value — which is what "I checked one value" buys.
          "one-value-proves-equivalence": {
            canonical: canonExpr(String(p.a + p.a * p.b)),
            tex: String(p.a + p.a * p.b),
          },
        },
      },
    };
  },
});

/* ============================================================ EQUATIONS strand */

shape({
  id: "eq-meaning.magazine",
  kp: "eq-meaning",
  ask: "ask.charges",
  answerType: "valueSet",
  draw(rand, tier) {
    const a = nz(rand, tier === "easy" ? 2 : -9, 9);
    const sol = intIn(rand, 1, tier === "easy" ? 9 : 12);
    const b = sol + a;
    const others = new Set([sol]);
    const mag = [sol];
    let guard = 0;
    while (mag.length < 6 && guard++ < 60) {
      const v = intIn(rand, -6, 14);
      if (!others.has(v)) {
        others.add(v);
        mag.push(v);
      }
    }
    if (mag.length !== 6) return null;
    mag.sort((x, y) => x - y);
    return { a, b, sol, mag };
  },
  build(p) {
    const stem = `x${plus(p.a)} = ${p.b}`;
    const wrong = p.mag.find((v) => v !== p.sol);
    return {
      stem,
      given: [`\\{${p.mag.join(",\\; ")}\\}`],
      answer: { canonical: rstr(I(p.sol)), tex: String(p.sol) },
      sigs: {
        "equation-true-for-everything": {
          canonical: p.mag.map((v) => rstr(I(v))).sort().join(","),
          tex: p.mag.join(",\\; "),
        },
        "solution-never-checked": { canonical: rstr(I(wrong)), tex: String(wrong) },
      },
      hint: { a: p.a, b: p.b, count: 6 },
      // A three-line equivalence chain: the claim as it stands, the same claim with the lip
      // lifted off both pans, and the closed reading. Every line is the same claim, which is
      // what makes a broken one findable.
      trace: (misc) => {
        const lifted = L(`x${plus(p.a)}${plus(-p.a)} = ${p.b}${plus(-p.a)}`);
        if (misc === "equals-means-compute-now") {
          return [
            L(stem),
            { tex: `x = ${p.b} = ${p.b - p.a}`, canon: "chain", kind: "raw" },
            L(`x = ${p.sol}`),
          ];
        }
        if (misc === "solution-never-checked") return [L(stem), lifted, L(`x = ${wrong}`)];
        return [L(stem), lifted, L(`x = ${p.sol}`)];
      },
      traceKind: "equation",
      chainMisc: "equals-means-compute-now",
      gen: {
        kind: "claimClosesAt",
        check: { kind: "claimClosesAt", unknown: "x", value: rstr(I(p.sol)), needs: ["constantWithUnknown"] },
        witness: `x${plus(p.a)} = ${p.b}`,
        ask: "ask.gen.claimClosesAt",
        sigs: {},
      },
    };
  },
});

shape({
  id: "props-equality.move",
  kp: "props-equality",
  ask: "ask.claim",
  answerType: "equation",
  draw(rand, tier) {
    const a = nz(rand, tier === "easy" ? 2 : -9, 9);
    const b = intIn(rand, tier === "easy" ? 5 : -9, 18);
    if (b - a === b || b - a === b + a) return null;
    return { a, b };
  },
  build(p) {
    const stem = `x${plus(p.a)} = ${p.b}`;
    return {
      stem,
      given: [],
      answer: { canonical: canonEquation(`x = ${p.b - p.a}`), tex: `x = ${p.b - p.a}` },
      sigs: {
        "operate-on-one-side": { canonical: canonEquation(`x = ${p.b}`), tex: `x = ${p.b}` },
        "inverse-operations-on-each-side": {
          canonical: canonEquation(`x = ${p.b + p.a}`),
          tex: `x = ${p.b + p.a}`,
        },
      },
      hint: { a: p.a, b: p.b },
      trace: (misc) => {
        const val =
          misc === "operate-on-one-side"
            ? p.b
            : misc === "inverse-operations-on-each-side"
              ? p.b + p.a
              : p.b - p.a;
        return [L(stem), L(`x = ${val}`)];
      },
      traceKind: "equation",
      gen: {
        kind: "claimClosesAt",
        check: {
          kind: "claimClosesAt",
          unknown: "x",
          value: rstr(I(p.b - p.a)),
          needs: ["constantWithUnknown"],
        },
        witness: `x${plus(p.a)} = ${p.b}`,
        ask: "ask.gen.claimClosesAt",
        sigs: {},
      },
    };
  },
});

shape({
  id: "props-equality.zero",
  kp: "props-equality",
  ask: "ask.claim",
  answerType: "equation",
  draw(rand, tier) {
    const a = nz(rand, 2, 9);
    let b = nz(rand, 2, 9);
    if (a === b) return null;
    return { a, b };
  },
  build(p) {
    const stem = `${cv(p.a)} = ${cv(p.b)}`;
    return {
      stem,
      given: [],
      answer: { canonical: canonEquation(`${p.a - p.b}x = 0`), tex: `${cv(p.a - p.b)} = 0` },
      sigs: {
        "divide-by-possible-zero": {
          canonical: canonEquation(`${p.a} = ${p.b}`),
          tex: `${p.a} = ${p.b}`,
        },
      },
      hint: { a: p.a, b: p.b, diff: p.a - p.b },
      trace: (misc) =>
        misc === "divide-by-possible-zero"
          ? [L(stem), L(`${p.a} = ${p.b}`)]
          : [L(stem), L(`${cv(p.a - p.b)} = 0`)],
      traceKind: "equation",
    };
  },
});

shape({
  id: "eq-one-add.plus",
  kp: "eq-one-add",
  ask: "ask.value",
  answerType: "integer",
  draw(rand, tier) {
    const r = ranges(tier);
    const p1 = nz(rand, r.konst[0], r.konst[1]);
    const sol = intIn(rand, r.sol[0], r.sol[1]);
    const q = sol + p1;
    return { p: p1, q };
  },
  build(pp) {
    const stem = `x${plus(pp.p)} = ${pp.q}`;
    return {
      stem,
      given: [],
      answer: { canonical: rstr(I(pp.q - pp.p)), tex: String(pp.q - pp.p) },
      sigs: {
        "same-operation-not-inverse": { canonical: rstr(I(pp.q + pp.p)), tex: String(pp.q + pp.p) },
        "subtraction-order-reversed": { canonical: rstr(I(pp.p - pp.q)), tex: String(pp.p - pp.q) },
      },
      hint: { p: pp.p, q: pp.q },
      trace: (misc) => {
        const val =
          misc === "same-operation-not-inverse"
            ? pp.q + pp.p
            : misc === "subtraction-order-reversed"
              ? pp.p - pp.q
              : pp.q - pp.p;
        return [L(stem), L(`x = ${val}`)];
      },
      traceKind: "equation",
      gen: {
        kind: "claimClosesAt",
        check: {
          kind: "claimClosesAt",
          unknown: "x",
          value: rstr(I(pp.q - pp.p)),
          needs: ["constantWithUnknown"],
        },
        witness: stem,
        ask: "ask.gen.claimClosesAt",
        sigs: {},
      },
    };
  },
});

shape({
  id: "eq-one-add.minus",
  kp: "eq-one-add",
  ask: "ask.value",
  answerType: "integer",
  draw(rand, tier) {
    const r = ranges(tier);
    const p1 = nz(rand, 2, 9);
    const sol = intIn(rand, r.sol[0], r.sol[1]);
    const q = sol - p1;
    return { p: p1, q };
  },
  build(pp) {
    const stem = `x - ${pp.p} = ${pp.q}`;
    return {
      stem,
      given: [],
      answer: { canonical: rstr(I(pp.q + pp.p)), tex: String(pp.q + pp.p) },
      sigs: {
        "minus-inverted-wrongly": { canonical: rstr(I(pp.q - pp.p)), tex: String(pp.q - pp.p) },
      },
      hint: { p: pp.p, q: pp.q },
      trace: (misc) => [
        L(stem),
        L(`x = ${misc === "minus-inverted-wrongly" ? pp.q - pp.p : pp.q + pp.p}`),
      ],
      traceKind: "equation",
    };
  },
});

shape({
  id: "eq-one-mult.mult",
  kp: "eq-one-mult",
  ask: "ask.value",
  answerType: "rational",
  draw(rand, tier) {
    const a = tier === "easy" ? intIn(rand, 2, 5) : coefDraw(rand, tier);
    const sol = intIn(rand, ranges(tier).sol[0], ranges(tier).sol[1]);
    const b = a * sol;
    if (b === 0) return null;
    const correct = rat(b, a);
    const s1 = I(b - a);
    const s2 = rat(a, b);
    if (req(correct, s1) || req(correct, s2) || req(s1, s2)) return null;
    return { a, b };
  },
  build(p) {
    const stem = `${cv(p.a)} = ${p.b}`;
    const correct = rat(p.b, p.a);
    return {
      stem,
      given: [],
      answer: { canonical: rstr(correct), tex: rtex(correct) },
      sigs: {
        "subtract-the-coefficient": { canonical: rstr(I(p.b - p.a)), tex: String(p.b - p.a) },
        "division-order-reversed": { canonical: rstr(rat(p.a, p.b)), tex: rtex(rat(p.a, p.b)) },
      },
      hint: { a: p.a, b: p.b },
      trace: (misc) => {
        const v =
          misc === "subtract-the-coefficient"
            ? I(p.b - p.a)
            : misc === "division-order-reversed"
              ? rat(p.a, p.b)
              : correct;
        return [L(stem), L(`x = ${rtex(v)}`)];
      },
      traceKind: "equation",
      gen: {
        kind: "claimClosesAt",
        check: {
          kind: "claimClosesAt",
          unknown: "x",
          value: rstr(correct),
          needs: ["coefficient"],
        },
        witness: stem,
        ask: "ask.gen.claimClosesAt",
        sigs: {},
      },
    };
  },
});

shape({
  id: "eq-one-mult.fraction",
  kp: "eq-one-mult",
  ask: "ask.value",
  answerType: "rational",
  draw(rand, tier) {
    const a = intIn(rand, 2, tier === "easy" ? 5 : 8);
    const b = nz(rand, 2, 9);
    if (a * b === b / a) return null;
    return { a, b };
  },
  build(p) {
    const stem = `\\frac{x}{${p.a}} = ${p.b}`;
    return {
      stem,
      given: [],
      answer: { canonical: rstr(I(p.a * p.b)), tex: String(p.a * p.b) },
      sigs: {
        "fraction-form-inverted": { canonical: rstr(rat(p.b, p.a)), tex: rtex(rat(p.b, p.a)) },
      },
      hint: { a: p.a, b: p.b },
      trace: (misc) => [
        L(stem),
        L(`x = ${misc === "fraction-form-inverted" ? rtex(rat(p.b, p.a)) : p.a * p.b}`),
      ],
      traceKind: "equation",
    };
  },
});

shape({
  id: "eq-two-step.core",
  kp: "eq-two-step",
  ask: "ask.value",
  answerType: "rational",
  draw(rand, tier) {
    const r = ranges(tier);
    const a = tier === "easy" ? intIn(rand, 2, 5) : coefDraw(rand, tier);
    const b = nz(rand, r.konst[0], r.konst[1]);
    const sol = intIn(rand, r.sol[0], r.sol[1]);
    const c = a * sol + b;
    if (Math.abs(c) > 60) return null;
    return { a, b, c };
  },
  build(p) {
    const stem = `${cv(p.a)}${plus(p.b)} = ${p.c}`;
    const correct = rat(p.c - p.b, p.a);
    return {
      stem,
      given: [],
      answer: { canonical: rstr(correct), tex: rtex(correct) },
      sigs: {
        "divide-before-clearing-constant": {
          canonical: rstr(rsub(rat(p.c, p.a), I(p.b))),
          tex: rtex(rsub(rat(p.c, p.a), I(p.b))),
        },
        "inverse-order-inverted": {
          canonical: rstr(I((p.c - p.b) * p.a)),
          tex: String((p.c - p.b) * p.a),
        },
        "constant-sign-flipped": {
          canonical: rstr(rat(p.c + p.b, p.a)),
          tex: rtex(rat(p.c + p.b, p.a)),
        },
      },
      hint: { a: p.a, b: p.b, c: p.c, lifted: p.c - p.b },
      trace: (misc) => {
        if (misc === "divide-before-clearing-constant") {
          return [
            L(stem),
            L(`x${plus(p.b)} = ${rtex(rat(p.c, p.a))}`),
            L(`x = ${rtex(rsub(rat(p.c, p.a), I(p.b)))}`),
          ];
        }
        if (misc === "constant-sign-flipped") {
          return [L(stem), L(`${cv(p.a)} = ${p.c + p.b}`), L(`x = ${rtex(rat(p.c + p.b, p.a))}`)];
        }
        if (misc === "inverse-order-inverted") {
          return [L(stem), L(`${cv(p.a)} = ${p.c - p.b}`), L(`x = ${(p.c - p.b) * p.a}`)];
        }
        return [L(stem), L(`${cv(p.a)} = ${p.c - p.b}`), L(`x = ${rtex(correct)}`)];
      },
      traceKind: "equation",
      gen: {
        kind: "claimClosesAt",
        check: {
          kind: "claimClosesAt",
          unknown: "x",
          value: rstr(correct),
          needs: ["coefficient", "constantWithUnknown"],
        },
        witness: stem,
        ask: "ask.gen.claimClosesAt",
        sigs: {},
      },
    };
  },
});

shape({
  id: "eq-combine-side.core",
  kp: "eq-combine-side",
  ask: "ask.value",
  answerType: "rational",
  draw(rand, tier) {
    const r = ranges(tier);
    const a = tier === "easy" ? intIn(rand, 2, 5) : coefDraw(rand, tier);
    const b = tier === "easy" ? intIn(rand, 2, 5) : coefDraw(rand, tier);
    if (a + b === 0) return null;
    const c = nz(rand, r.konst[0], r.konst[1]);
    const sol = intIn(rand, r.sol[0], r.sol[1]);
    const d = (a + b) * sol + c;
    if (Math.abs(d) > 80) return null;
    if (a + b + c === 0) return null;
    return { a, b, c, d };
  },
  build(p) {
    const stem = `${sumTex([{ c: p.a, v: "x" }, { c: p.b, v: "x" }, { c: p.c }])} = ${p.d}`;
    const correct = rat(p.d - p.c, p.a + p.b);
    return {
      stem,
      given: [],
      answer: { canonical: rstr(correct), tex: rtex(correct) },
      sigs: {
        "combine-across-the-equals": {
          canonical: rstr(rat(p.d + p.c, p.a + p.b)),
          tex: rtex(rat(p.d + p.c, p.a + p.b)),
        },
        "one-like-term-dropped": {
          canonical: rstr(rat(p.d - p.c, p.a)),
          tex: rtex(rat(p.d - p.c, p.a)),
        },
        "constant-absorbed-into-coefficient": {
          canonical: rstr(rat(p.d, p.a + p.b + p.c)),
          tex: rtex(rat(p.d, p.a + p.b + p.c)),
        },
      },
      hint: { a: p.a, b: p.b, c: p.c, d: p.d, gathered: p.a + p.b },
      trace: (misc) => {
        if (misc === "one-like-term-dropped") {
          return [L(stem), L(`${cv(p.a)} = ${p.d - p.c}`), L(`x = ${rtex(rat(p.d - p.c, p.a))}`)];
        }
        if (misc === "combine-across-the-equals") {
          return [
            L(stem),
            L(`${cv(p.a + p.b)} = ${p.d + p.c}`),
            L(`x = ${rtex(rat(p.d + p.c, p.a + p.b))}`),
          ];
        }
        if (misc === "constant-absorbed-into-coefficient") {
          return [
            L(stem),
            L(`${cv(p.a + p.b + p.c)} = ${p.d}`),
            L(`x = ${rtex(rat(p.d, p.a + p.b + p.c))}`),
          ];
        }
        return [
          L(stem),
          L(`${cv(p.a + p.b)}${plus(p.c)} = ${p.d}`),
          L(`${cv(p.a + p.b)} = ${p.d - p.c}`),
          L(`x = ${rtex(correct)}`),
        ];
      },
      traceKind: "equation",
      gen: {
        kind: "claimClosesAt",
        check: {
          kind: "claimClosesAt",
          unknown: "x",
          value: rstr(correct),
          needs: ["twoLikeTerms", "constantWithUnknown"],
        },
        witness: stem,
        ask: "ask.gen.claimClosesAt",
        sigs: {},
      },
    };
  },
});

shape({
  id: "eq-distribute.core",
  kp: "eq-distribute",
  ask: "ask.value",
  answerType: "rational",
  draw(rand, tier) {
    const r = ranges(tier);
    const pp = tier === "easy" ? intIn(rand, 2, 5) : coefDraw(rand, tier);
    const q = nz(rand, r.konst[0], r.konst[1]);
    const sol = intIn(rand, r.sol[0], r.sol[1]);
    const rr = pp * (sol + q);
    if (Math.abs(rr) > 80) return null;
    return { p: pp, q, r: rr };
  },
  build(p) {
    const stem = `${p.p}\\left(x${plus(p.q)}\\right) = ${p.r}`;
    const correct = rsub(rat(p.r, p.p), I(p.q));
    return {
      stem,
      given: [],
      answer: { canonical: rstr(correct), tex: rtex(correct) },
      sigs: {
        "distribute-partially-in-equation": {
          canonical: rstr(rat(p.r - p.q, p.p)),
          tex: rtex(rat(p.r - p.q, p.p)),
        },
        "divide-bracket-only": { canonical: rstr(I(p.r - p.q)), tex: String(p.r - p.q) },
        "coefficient-never-undone": {
          canonical: rstr(I(p.r - p.p * p.q)),
          tex: String(p.r - p.p * p.q),
        },
      },
      hint: { p: p.p, q: p.q, r: p.r, shared: rstr(rat(p.r, p.p)) },
      trace: (misc) => {
        if (misc === "divide-bracket-only") {
          return [L(stem), L(`x${plus(p.q)} = ${p.r}`), L(`x = ${p.r - p.q}`)];
        }
        if (misc === "coefficient-never-undone") {
          return [
            L(stem),
            L(`${cv(p.p)}${plus(p.p * p.q)} = ${p.r}`),
            L(`x = ${p.r - p.p * p.q}`),
          ];
        }
        if (misc === "distribute-partially-in-equation") {
          return [L(stem), L(`${cv(p.p)}${plus(p.q)} = ${p.r}`), L(`x = ${rtex(rat(p.r - p.q, p.p))}`)];
        }
        return [L(stem), L(`x${plus(p.q)} = ${rtex(rat(p.r, p.p))}`), L(`x = ${rtex(correct)}`)];
      },
      traceKind: "equation",
      gen: {
        kind: "claimClosesAt",
        check: {
          kind: "claimClosesAt",
          unknown: "x",
          value: rstr(correct),
          needs: ["bundle"],
        },
        witness: stem,
        ask: "ask.gen.claimClosesAt",
        sigs: {},
      },
    };
  },
});

shape({
  id: "eq-both-sides.core",
  kp: "eq-both-sides",
  ask: "ask.value",
  answerType: "rational",
  draw(rand, tier) {
    const r = ranges(tier);
    const a = tier === "easy" ? intIn(rand, 3, 7) : coefDraw(rand, tier);
    let c = tier === "easy" ? intIn(rand, 2, 5) : coefDraw(rand, tier);
    if (a === c || a + c === 0) return null;
    const b = nz(rand, r.konst[0], r.konst[1]);
    const sol = intIn(rand, r.sol[0], r.sol[1]);
    const d = (a - c) * sol + b;
    if (Math.abs(d) > 80) return null;
    return { a, b, c, d };
  },
  build(p) {
    const stem = `${cv(p.a)}${plus(p.b)} = ${cv(p.c)}${plus(p.d)}`;
    const correct = rat(p.d - p.b, p.a - p.c);
    return {
      stem,
      given: [],
      answer: { canonical: rstr(correct), tex: rtex(correct) },
      sigs: {
        "moved-without-inverting": {
          canonical: rstr(rat(p.d - p.b, p.a + p.c)),
          tex: rtex(rat(p.d - p.b, p.a + p.c)),
        },
        "removed-from-one-side-only": {
          canonical: rstr(rat(p.d - p.b, p.a)),
          tex: rtex(rat(p.d - p.b, p.a)),
        },
        "constants-collected-wrong-side": {
          canonical: rstr(rat(p.d + p.b, p.a - p.c)),
          tex: rtex(rat(p.d + p.b, p.a - p.c)),
        },
      },
      hint: { a: p.a, b: p.b, c: p.c, d: p.d, left: p.a - p.c },
      trace: (misc) => {
        if (misc === "moved-without-inverting") {
          return [
            L(stem),
            L(`${cv(p.a + p.c)} = ${p.d - p.b}`),
            L(`x = ${rtex(rat(p.d - p.b, p.a + p.c))}`),
          ];
        }
        if (misc === "removed-from-one-side-only") {
          return [L(stem), L(`${cv(p.a)} = ${p.d - p.b}`), L(`x = ${rtex(rat(p.d - p.b, p.a))}`)];
        }
        if (misc === "constants-collected-wrong-side") {
          return [
            L(stem),
            L(`${cv(p.a - p.c)} = ${p.d + p.b}`),
            L(`x = ${rtex(rat(p.d + p.b, p.a - p.c))}`),
          ];
        }
        return [
          L(stem),
          L(`${cv(p.a - p.c)}${plus(p.b)} = ${p.d}`),
          L(`${cv(p.a - p.c)} = ${p.d - p.b}`),
          L(`x = ${rtex(correct)}`),
        ];
      },
      traceKind: "equation",
      gen: {
        kind: "claimClosesAt",
        check: {
          kind: "claimClosesAt",
          unknown: "x",
          value: rstr(correct),
          needs: ["bothPans"],
        },
        witness: stem,
        ask: "ask.gen.claimClosesAt",
        sigs: {},
      },
    };
  },
});

shape({
  id: "eq-special-cases.always",
  kp: "eq-special-cases",
  ask: "ask.closure",
  answerType: "closure",
  draw(rand, tier) {
    const a = tier === "easy" ? intIn(rand, 2, 5) : coefDraw(rand, tier);
    const b = nz(rand, 2, 9);
    return { a, b };
  },
  build(p) {
    const stem = `${p.a}\\left(x${plus(p.b)}\\right) = ${cv(p.a)}${plus(p.a * p.b)}`;
    return {
      stem,
      given: [],
      answer: { canonical: "always", tex: "\\text{---}" },
      sigs: {
        "vanishing-variable-means-zero": { canonical: "0", tex: "0" },
        "identity-called-no-solution": { canonical: "none", tex: "\\text{---}" },
      },
      hint: { a: p.a, b: p.b },
      trace: (misc) => {
        if (misc === "vanishing-variable-means-zero") {
          return [L(stem), L(`0 = 0`), L(`x = 0`)];
        }
        return [L(stem), L(`${cv(p.a)}${plus(p.a * p.b)} = ${cv(p.a)}${plus(p.a * p.b)}`), L(`0 = 0`)];
      },
      traceKind: "equation",
      gen: {
        kind: "claimClosesAt",
        check: { kind: "claimClosesAt", unknown: "x", value: "always", needs: ["bothPans"] },
        witness: stem,
        ask: "ask.gen.always",
        sigs: {},
      },
    };
  },
});

shape({
  id: "eq-special-cases.refusal",
  kp: "eq-special-cases",
  ask: "ask.closure",
  answerType: "closure",
  draw(rand, tier) {
    const a = tier === "easy" ? intIn(rand, 2, 5) : coefDraw(rand, tier);
    const b = nz(rand, -9, 9);
    let d = nz(rand, -9, 9);
    if (b === d) return null;
    return { a, b, d };
  },
  build(p) {
    const stem = `${cv(p.a)}${plus(p.b)} = ${cv(p.a)}${plus(p.d)}`;
    return {
      stem,
      given: [],
      answer: { canonical: "none", tex: "\\text{---}" },
      sigs: {
        "vanishing-variable-means-zero": { canonical: "0", tex: "0" },
        "contradiction-given-a-solution": {
          canonical: rstr(I(p.d - p.b)),
          tex: String(p.d - p.b),
        },
      },
      hint: { a: p.a, b: p.b, d: p.d },
      trace: (misc) => {
        if (misc === "vanishing-variable-means-zero") return [L(stem), L(`${p.b} = ${p.d}`), L(`x = 0`)];
        if (misc === "contradiction-given-a-solution")
          return [L(stem), L(`${p.b} = ${p.d}`), L(`x = ${p.d - p.b}`)];
        return [L(stem), L(`${p.b} = ${p.d}`)];
      },
      traceKind: "equation",
      gen: {
        kind: "claimClosesAt",
        check: { kind: "claimClosesAt", unknown: "x", value: "none", needs: ["bothPans"] },
        witness: stem,
        ask: "ask.gen.refusal",
        sigs: {},
      },
    };
  },
});

shape({
  id: "eq-model-context.span",
  kp: "eq-model-context",
  ask: "ask.value",
  answerType: "rational",
  draw(rand, tier) {
    const k = intIn(rand, 3, tier === "easy" ? 6 : 9);
    const b = intIn(rand, 2, 12);
    const seg = intIn(rand, 2, tier === "easy" ? 9 : 14);
    const g = k * seg + b;
    if (g - b === g / k) return null;
    return { k, b, g, seg };
  },
  build(p) {
    const stem = `${cv(p.k, "s")} + ${p.b} = ${p.g}`;
    return {
      stem,
      given: [],
      story: { key: "story.eq-model-context.span", params: { k: p.k, b: p.b, g: p.g } },
      answer: { canonical: rstr(I(p.seg)), tex: String(p.seg) },
      sigs: {
        "answers-the-wrong-question": { canonical: rstr(I(p.g - p.b)), tex: String(p.g - p.b) },
        "arithmetic-shortcut-only": { canonical: rstr(rat(p.g, p.k)), tex: rtex(rat(p.g, p.k)) },
      },
      hint: { k: p.k, b: p.b, g: p.g, deck: p.g - p.b },
      trace: (misc) => {
        if (misc === "answers-the-wrong-question")
          return [L(stem, "equation", "s"), L(`${cv(p.k, "s")} = ${p.g - p.b}`, "equation", "s"), L(`s = ${p.g - p.b}`, "equation", "s")];
        if (misc === "arithmetic-shortcut-only")
          return [L(stem, "equation", "s"), L(`s = ${rtex(rat(p.g, p.k))}`, "equation", "s")];
        return [
          L(stem, "equation", "s"),
          L(`${cv(p.k, "s")} = ${p.g - p.b}`, "equation", "s"),
          L(`s = ${p.seg}`, "equation", "s"),
        ];
      },
      traceKind: "equation",
      unknown: "s",
      gen: {
        kind: "claimClosesAt",
        check: { kind: "claimClosesAt", unknown: "s", value: rstr(I(p.seg)), needs: ["coefficient", "constantWithUnknown"] },
        witness: stem,
        ask: "ask.gen.claimClosesAt",
        sigs: {},
      },
    };
  },
});

shape({
  id: "eq-model-context.members",
  kp: "eq-model-context",
  ask: "ask.value",
  answerType: "integer",
  draw(rand, tier) {
    const w = intIn(rand, 3, tier === "easy" ? 8 : 12);
    const whole = intIn(rand, 2, 9);
    const rem = intIn(rand, 1, w - 1);
    const T = w * whole + rem;
    const need = whole + 1;
    if (need === T - w) return null;
    return { w, T, need, exact: rstr(rat(T, w)) };
  },
  build(p) {
    const stem = `${cv(p.w, "m")} \\ge ${p.T}`;
    return {
      stem,
      given: [],
      story: { key: "story.eq-model-context.members", params: { w: p.w, T: p.T } },
      answer: { canonical: rstr(I(p.need)), tex: String(p.need) },
      sigs: {
        "non-viable-solution-accepted": { canonical: p.exact, tex: rtex(rat(p.T, p.w)) },
        "arithmetic-shortcut-only": { canonical: rstr(I(p.T - p.w)), tex: String(p.T - p.w) },
      },
      hint: { w: p.w, T: p.T, exact: p.exact },
      trace: (misc) => {
        if (misc === "non-viable-solution-accepted")
          return [L(stem, "inequality", "m"), L(`m = ${rtex(rat(p.T, p.w))}`, "equation", "m")];
        if (misc === "arithmetic-shortcut-only")
          return [L(stem, "inequality", "m"), L(`m = ${p.T - p.w}`, "equation", "m")];
        return [
          L(stem, "inequality", "m"),
          L(`m \\ge ${rtex(rat(p.T, p.w))}`, "inequality", "m"),
          L(`m = ${p.need}`, "equation", "m"),
        ];
      },
      traceKind: "mixed",
      unknown: "m",
    };
  },
});

/* ============================================================ INEQUALITIES strand */

shape({
  id: "ineq-meaning.stretch",
  kp: "ineq-meaning",
  ask: "ask.mark",
  answerType: "inequality",
  draw(rand, tier) {
    const c = nz(rand, tier === "easy" ? 1 : -9, 12);
    const strict = rand() < 0.5;
    return { c, strict };
  },
  build(p) {
    const rel = p.strict ? "<" : "\\le";
    const stem = `${p.c} ${rel} x`;
    const correct = p.strict ? `x > ${p.c}` : `x \\ge ${p.c}`;
    return {
      stem,
      given: [],
      answer: { canonical: canonInequality(correct), tex: correct },
      sigs: {
        "reads-symbol-left-to-right-always": {
          canonical: canonInequality(p.strict ? `x < ${p.c}` : `x \\le ${p.c}`),
          tex: p.strict ? `x < ${p.c}` : `x \\le ${p.c}`,
        },
        "endpoint-style-swapped": {
          canonical: canonInequality(p.strict ? `x \\ge ${p.c}` : `x > ${p.c}`),
          tex: p.strict ? `x \\ge ${p.c}` : `x > ${p.c}`,
        },
        "single-value-for-a-set": { canonical: rstr(I(p.c)), tex: String(p.c), kindOverride: "value" },
      },
      hint: { c: p.c, strict: p.strict ? 1 : 0 },
      trace: (misc) => {
        const line =
          {
            "reads-symbol-left-to-right-always": p.strict ? `x < ${p.c}` : `x \\le ${p.c}`,
            "endpoint-style-swapped": p.strict ? `x \\ge ${p.c}` : `x > ${p.c}`,
          }[misc] || correct;
        return [L(stem, "inequality"), L(line, "inequality")];
      },
      traceKind: "inequality",
      gen: {
        kind: "markAdmits",
        check: {
          kind: "markAdmits",
          stretch: canonInequality(correct),
          unknown: "x",
          needs: ["constantWithUnknown"],
        },
        witness: `x - 1 ${p.strict ? ">" : "\\ge"} ${p.c - 1}`,
        ask: "ask.gen.markAdmits",
        sigs: {},
      },
    };
  },
});

shape({
  id: "ineq-one-step.plus",
  kp: "ineq-one-step",
  ask: "ask.mark",
  answerType: "inequality",
  draw(rand, tier) {
    const pp = intIn(rand, 2, 9);
    const q = intIn(rand, tier === "easy" ? 5 : -9, 20);
    return { p: pp, q };
  },
  build(p) {
    const stem = `x + ${p.p} < ${p.q}`;
    const correct = `x < ${p.q - p.p}`;
    return {
      stem,
      given: [],
      answer: { canonical: canonInequality(correct), tex: correct },
      sigs: {
        "flip-after-adding": {
          canonical: canonInequality(`x > ${p.q - p.p}`),
          tex: `x > ${p.q - p.p}`,
        },
        "solved-as-equation": {
          canonical: rstr(I(p.q - p.p)),
          tex: String(p.q - p.p),
          kindOverride: "value",
        },
      },
      hint: { p: p.p, q: p.q, mark: p.q - p.p },
      trace: (misc) =>
        misc === "flip-after-adding"
          ? [L(stem, "inequality"), L(`x > ${p.q - p.p}`, "inequality")]
          : [L(stem, "inequality"), L(correct, "inequality")],
      traceKind: "inequality",
      gen: {
        kind: "markAdmits",
        check: { kind: "markAdmits", stretch: canonInequality(correct), unknown: "x", needs: ["constantWithUnknown"] },
        witness: stem,
        ask: "ask.gen.markAdmits",
        sigs: {},
      },
    };
  },
});

shape({
  id: "ineq-one-step.negconstant",
  kp: "ineq-one-step",
  ask: "ask.mark",
  answerType: "inequality",
  draw(rand, tier) {
    const pp = intIn(rand, 2, 9);
    const q = intIn(rand, tier === "easy" ? 2 : -9, 15);
    return { p: pp, q };
  },
  build(p) {
    const stem = `x + \\left(-${p.p}\\right) < ${p.q}`;
    const correct = `x < ${p.q + p.p}`;
    return {
      stem,
      given: [],
      answer: { canonical: canonInequality(correct), tex: correct },
      sigs: {
        "flip-because-a-negative-appeared": {
          canonical: canonInequality(`x > ${p.q + p.p}`),
          tex: `x > ${p.q + p.p}`,
        },
        "solved-as-equation": {
          canonical: rstr(I(p.q + p.p)),
          tex: String(p.q + p.p),
          kindOverride: "value",
        },
      },
      hint: { p: p.p, q: p.q, mark: p.q + p.p },
      trace: (misc) =>
        misc === "flip-because-a-negative-appeared"
          ? [L(stem, "inequality"), L(`x > ${p.q + p.p}`, "inequality")]
          : [L(stem, "inequality"), L(correct, "inequality")],
      traceKind: "inequality",
    };
  },
});

shape({
  id: "ineq-negative-flip.divide",
  kp: "ineq-negative-flip",
  ask: "ask.mark",
  answerType: "inequality",
  draw(rand, tier) {
    const a = intIn(rand, 2, tier === "easy" ? 5 : 8);
    const b = nz(rand, -9, 12);
    const sol = rat(b, -a);
    if (b === 0) return null;
    return { a, b, sol: rstr(sol) };
  },
  build(p) {
    const stem = `${cv(-p.a)} < ${p.b}`;
    const v = rat(p.b, -p.a);
    const correct = `x > ${rtex(v)}`;
    return {
      stem,
      given: [],
      answer: { canonical: canonInequality(correct), tex: correct },
      sigs: {
        "no-flip-on-negative-divide": {
          canonical: canonInequality(`x < ${rtex(v)}`),
          tex: `x < ${rtex(v)}`,
        },
        "flip-but-sign-lost": {
          canonical: canonInequality(`x > ${rtex(rat(p.b, p.a))}`),
          tex: `x > ${rtex(rat(p.b, p.a))}`,
        },
      },
      hint: { a: p.a, b: p.b, mark: rstr(v) },
      trace: (misc) => {
        const line =
          {
            "no-flip-on-negative-divide": `x < ${rtex(v)}`,
            "flip-but-sign-lost": `x > ${rtex(rat(p.b, p.a))}`,
          }[misc] || correct;
        return [L(stem, "inequality"), L(line, "inequality")];
      },
      traceKind: "inequality",
      gen: {
        kind: "markAdmits",
        check: {
          kind: "markAdmits",
          stretch: canonInequality(correct),
          unknown: "x",
          needs: ["negativeCount"],
        },
        witness: stem,
        ask: "ask.gen.markAdmitsTurned",
        sigs: {},
      },
    };
  },
});

shape({
  id: "ineq-negative-flip.subneg",
  kp: "ineq-negative-flip",
  ask: "ask.mark",
  answerType: "inequality",
  draw(rand, tier) {
    const pp = intIn(rand, 2, 9);
    const q = intIn(rand, tier === "easy" ? 2 : -9, 15);
    return { p: pp, q };
  },
  build(p) {
    const stem = `x - \\left(-${p.p}\\right) > ${p.q}`;
    const correct = `x > ${p.q - p.p}`;
    return {
      stem,
      given: [],
      answer: { canonical: canonInequality(correct), tex: correct },
      sigs: {
        "flip-on-subtracting-a-negative": {
          canonical: canonInequality(`x < ${p.q - p.p}`),
          tex: `x < ${p.q - p.p}`,
        },
      },
      hint: { p: p.p, q: p.q, mark: p.q - p.p },
      trace: (misc) =>
        misc === "flip-on-subtracting-a-negative"
          ? [L(stem, "inequality"), L(`x < ${p.q - p.p}`, "inequality")]
          : [L(stem, "inequality"), L(correct, "inequality")],
      traceKind: "inequality",
    };
  },
});

shape({
  id: "ineq-two-step.turned",
  kp: "ineq-two-step",
  ask: "ask.mark",
  answerType: "inequality",
  draw(rand, tier) {
    const a = intIn(rand, 2, tier === "easy" ? 5 : 8);
    const b = nz(rand, -9, 12);
    const c = nz(rand, -9, 12);
    if (b === c) return null;
    const mark = rat(b - c, a);
    const s1 = rat(c - b, a);
    const s2 = I(c - b);
    if (req(mark, s1) || req(mark, s2) || req(s1, s2)) return null;
    return { a, b, c };
  },
  build(p) {
    const stem = `${cv(-p.a)}${plus(p.b)} > ${p.c}`;
    const mark = rat(p.b - p.c, p.a);
    const correct = `x < ${rtex(mark)}`;
    return {
      stem,
      given: [],
      answer: { canonical: canonInequality(correct), tex: correct },
      sigs: {
        "flipped-twice": {
          canonical: canonInequality(`x > ${rtex(mark)}`),
          tex: `x > ${rtex(mark)}`,
        },
        "coefficient-applied-to-constant-only": {
          canonical: canonInequality(`x > ${p.c - p.b}`),
          tex: `x > ${p.c - p.b}`,
        },
      },
      hint: { a: p.a, b: p.b, c: p.c, lifted: p.c - p.b, mark: rstr(mark) },
      trace: (misc) => {
        if (misc === "flipped-twice")
          return [
            L(stem, "inequality"),
            L(`${cv(-p.a)} > ${p.c - p.b}`, "inequality"),
            L(`x > ${rtex(mark)}`, "inequality"),
          ];
        if (misc === "coefficient-applied-to-constant-only")
          return [L(stem, "inequality"), L(`x > ${p.c - p.b}`, "inequality")];
        return [
          L(stem, "inequality"),
          L(`${cv(-p.a)} > ${p.c - p.b}`, "inequality"),
          L(correct, "inequality"),
        ];
      },
      traceKind: "inequality",
      gen: {
        kind: "markAdmits",
        check: {
          kind: "markAdmits",
          stretch: canonInequality(correct),
          unknown: "x",
          needs: ["negativeCount", "constantWithUnknown"],
        },
        witness: stem,
        ask: "ask.gen.markAdmitsTurned",
        sigs: {},
      },
    };
  },
});

shape({
  id: "ineq-two-step.inclusive",
  kp: "ineq-two-step",
  ask: "ask.mark",
  answerType: "inequality",
  draw(rand, tier) {
    const a = intIn(rand, 2, tier === "easy" ? 5 : 8);
    const b = nz(rand, -9, 12);
    const sol = intIn(rand, 1, 9);
    const c = a * sol + b;
    if (Math.abs(c) > 90) return null;
    return { a, b, c, sol };
  },
  build(p) {
    const stem = `${cv(p.a)}${plus(p.b)} \\ge ${p.c}`;
    const correct = `x \\ge ${p.sol}`;
    return {
      stem,
      given: [],
      inclusive: true,
      answer: { canonical: canonInequality(correct), tex: correct },
      sigs: {
        "strictness-contradicts-context": {
          canonical: canonInequality(`x > ${p.sol}`),
          tex: `x > ${p.sol}`,
        },
        "coefficient-applied-to-constant-only": {
          canonical: canonInequality(`x \\ge ${p.c - p.b}`),
          tex: `x \\ge ${p.c - p.b}`,
        },
      },
      hint: { a: p.a, b: p.b, c: p.c, lifted: p.c - p.b, mark: p.sol },
      trace: (misc) => {
        if (misc === "strictness-contradicts-context")
          return [
            L(stem, "inequality"),
            L(`${cv(p.a)} \\ge ${p.c - p.b}`, "inequality"),
            L(`x > ${p.sol}`, "inequality"),
          ];
        if (misc === "coefficient-applied-to-constant-only")
          return [L(stem, "inequality"), L(`x \\ge ${p.c - p.b}`, "inequality")];
        return [
          L(stem, "inequality"),
          L(`${cv(p.a)} \\ge ${p.c - p.b}`, "inequality"),
          L(correct, "inequality"),
        ];
      },
      traceKind: "inequality",
    };
  },
});

/* ------------------------------------------------------------------ the framework */

export const ALL_SHAPES = SHAPES;
export const SHAPES_BY_KP = (() => {
  const m = new Map();
  for (const s of SHAPES) {
    if (!m.has(s.kp)) m.set(s.kp, []);
    m.get(s.kp).push(s);
  }
  return m;
})();

/**
 * PAIRWISE-SEPARATED, applied. A stem is servable only when every declared misconception on it
 * is defined, differs from the correct response, and differs from every other declared
 * misconception on the same stem. `content/knowledge-graph.json` conventions rule (4); the cost
 * of the filter is measured in review/measure/P17.mjs, not assumed.
 */
export function separationOK(built) {
  const entries = Object.entries(built.sigs || {});
  const correct = built.answer.canonical;
  for (const [, v] of entries) {
    if (v == null || v.canonical == null) return false;
    if (v.surface) continue; // a surface misconception is separated by shape, not by value
    if (v.canonical === correct) return false;
  }
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (entries[i][1].surface || entries[j][1].surface) continue;
      if (entries[i][1].canonical === entries[j][1].canonical) return false;
    }
  }
  return true;
}

/**
 * Where the misconception's working first stops matching the true one — compared by CANONICAL
 * value, never by how the line is written. `0 = 0` and `3x + 6 = 3x + 6` are the same claim, so
 * a line that only looks different is not a broken joint; naming it as one would send a learner
 * to repair something that was never wrong.
 */
function firstDivergence(correctTrace, wrongTrace) {
  const n = Math.min(correctTrace.length, wrongTrace.length);
  for (let i = 0; i < n; i++) {
    if (correctTrace[i].canon !== wrongTrace[i].canon) return i;
  }
  return correctTrace.length === wrongTrace.length ? -1 : n;
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** Stable id: the same parameters always produce the same id, on every machine. */
function itemId(shapeId, form, params) {
  return `${shapeId}/${form}/${hash(JSON.stringify(params))}`;
}

/** The numbers a `generate` hint is allowed to name: the property, never a witness. */
function genParams(check) {
  const out = {};
  if (check.settleTo != null) out.target = check.settleTo;
  if (check.value != null) out.target = check.value;
  if (check.target != null) out.target = check.target;
  if (check.stretch != null) out.target = check.stretch;
  if (check.mustStandWith != null) out.target = check.mustStandWith;
  if (check.at != null) out.at = check.at;
  if (check.relation != null) out.relation = check.relation;
  if (check.unknown != null) out.unknown = check.unknown;
  return out;
}

/**
 * Turn one drawn parameter set into one item in one form.
 * Returns null when the form is not available on that shape or the stem fails separation.
 */
export function makeItem(shp, form, params, tier, band) {
  const built = shp.build(params);
  if (!separationOK(built)) return null;
  const unknown = built.unknown || shp.unknown || "x";
  const cls = NODE_CLASS[shp.kp];
  const difficulty = tierBand(band, tier);
  const h = parseInt(hash(JSON.stringify(params)), 36);
  const common = {
    kpId: shp.kp,
    family: shp.id,
    difficulty,
    tier,
    objectClass: cls,
    // Two framings per knowledge point, chosen deterministically, so a block of three items on
    // one node does not read as the same sentence three times.
    worldFraming: { key: `frame.${shp.kp}.${(h % 2) + 1}`, params: {} },
    params,
  };
  /**
   * The faded ladder. Rung 1 orients you in the class of object and names no move; rung 2 names
   * the move and no number; rung 3 states where the load has got to, one step short of the
   * value. No rung ever contains the value — asserted, per item, in review/measure/P17.mjs.
   */
  const ladder = (mid, last, extra = {}) => [
    { key: `hint.look.${cls}`, params: {} },
    { key: mid, params: { ...(built.hint || {}), ...extra } },
    { key: last, params: { ...(built.hint || {}), ...extra } },
  ];

  if (form === "construct") {
    const distractors = [];
    for (const [misc, v] of Object.entries(built.sigs)) {
      distractors.push({
        misconception: misc,
        response: v.canonical,
        tex: v.tex,
        failKey: FAIL_KEY[misc] || "fail.slip",
        ...(v.surface ? { surface: true } : {}),
        ...(v.kindOverride ? { responseKind: v.kindOverride } : {}),
      });
    }
    if (!distractors.length) return null;
    // A rung of the ladder that happens to print the value being asked for is not a scaffold.
    // Refuse the stem: the numbers a hint may name are fixed by its template, so softening the
    // hint would cost more than redrawing. Asserted from outside in review/measure/P17.mjs.
    for (const key of [`hint.move.${shp.id}`, `hint.state.${shp.id}`]) {
      for (const name of HINT_PRINTS[key] || []) {
        const v = (built.hint || {})[name];
        if (v !== undefined && String(v) === built.answer.canonical) return null;
      }
    }
    return {
      id: itemId(shp.id, form, params),
      ...common,
      form: "construct",
      stem: built.stem,
      given: built.given || [],
      spoken: built.spoken || null,
      story: built.story || null,
      ask: shp.ask,
      answerType: shp.answerType,
      unknown,
      answer: built.answer,
      requiresGathered: !!shp.requiresGathered,
      check: null,
      distractors,
      hints: ladder(`hint.move.${shp.id}`, `hint.state.${shp.id}`),
      hintParams: built.hint || {},
    };
  }

  if (form === "repair") {
    const correct = built.trace(null);
    const candidates = [];
    const traceMiscs = [...Object.keys(built.sigs), ...(built.chainMisc ? [built.chainMisc] : [])];
    for (const misc of traceMiscs) {
      const wrong = built.trace(misc);
      const at = firstDivergence(correct, wrong);
      if (at < 0 || at >= correct.length || at >= wrong.length) continue;
      candidates.push({ misc, at, wrong });
    }
    if (!candidates.length) return null;
    // Rotate which joint is broken, deterministically in the parameters, so a knowledge point's
    // repair items do not all fail the same way and misconception targeting has somewhere to go.
    const chosen = candidates[parseInt(hash(JSON.stringify(params)), 36) % candidates.length];
    const lines = chosen.wrong.map((l) => l.tex);
    const answerLine = correct[chosen.at];
    const distractors = [];
    for (const c of candidates) {
      if (c.at !== chosen.at) continue;
      if (c.wrong[c.at].canon === answerLine.canon) continue;
      distractors.push({
        misconception: c.misc,
        response: `${chosen.at + 1}|${c.wrong[c.at].canon}`,
        tex: c.wrong[c.at].tex,
        failKey: FAIL_KEY[c.misc] || "fail.slip",
      });
    }
    if (!distractors.length) {
      distractors.push({
        misconception: chosen.misc,
        response: `${chosen.at + 1}|${chosen.wrong[chosen.at].canon}`,
        tex: chosen.wrong[chosen.at].tex,
        failKey: FAIL_KEY[chosen.misc] || "fail.slip",
      });
    }
    return {
      id: itemId(shp.id, form, params),
      ...common,
      form: "repair",
      stem: built.stem,
      given: built.given || [],
      spoken: built.spoken || null,
      story: built.story || null,
      working: lines,
      brokenBy: chosen.misc,
      ask: "ask.repair",
      answerType: "repair",
      unknown,
      answer: {
        canonical: `${chosen.at + 1}|${answerLine.canon}`,
        tex: answerLine.tex,
        line: chosen.at + 1,
        valueKind: answerLine.kind,
      },
      check: null,
      distractors,
      hints: ladder("hint.repair.2", "hint.repair.3", { line: chosen.at + 1, lines: lines.length }),
      hintParams: { ...(built.hint || {}), lines: lines.length, line: chosen.at + 1 },
    };
  }

  if (form === "generate") {
    if (!built.gen) return null;
    const distractors = Object.entries(built.gen.sigs || {}).map(([misc, v]) => ({
      misconception: misc,
      response: v.canonical,
      tex: v.tex,
      failKey: FAIL_KEY[misc] || "fail.slip",
    }));
    return {
      id: itemId(shp.id, form, params),
      ...common,
      form: "generate",
      stem: built.stem,
      given: built.given || [],
      spoken: built.spoken || null,
      story: built.story || null,
      ask: built.gen.ask,
      answerType: "construction",
      unknown,
      answer: { canonical: built.gen.witness, tex: built.gen.witness, witness: true },
      check: built.gen.check,
      distractors,
      hints: ladder(`hint.gen.${built.gen.kind}.2`, `hint.gen.${built.gen.kind}.3`, genParams(built.gen.check)),
      hintParams: { ...(built.hint || {}), ...genParams(built.gen.check) },
    };
  }

  return null;
}

/**
 * Draw `count` distinct valid items for one knowledge point.
 * Deterministic in `seed`: the bank is the same on every machine and in every session (G4).
 */
export function generateForKp(
  kpId,
  { count = 24, seed = 1, band = 3, forms = ["construct", "repair", "generate"], tiers = TIERS } = {}
) {
  const shapes = SHAPES_BY_KP.get(kpId) || [];
  if (!shapes.length) return [];
  const rand = rng(seed);
  // A balanced plan rather than a random walk: every (form x shape x tier) cell is visited in
  // turn, so no knowledge point ends up with sixteen `construct` items and no `generate`.
  const plan = [];
  for (const form of forms) for (const shp of shapes) plan.push({ shp, form });
  const out = [];
  const seen = new Set();
  let guard = 0;
  let i = 0;
  while (out.length < count && guard++ < count * 600) {
    const cell = plan[i % plan.length];
    const tier = tiers[Math.floor(i / plan.length) % tiers.length];
    i++;
    const params = cell.shp.draw(rand, tier);
    if (!params) continue;
    const item = makeItem(cell.shp, cell.form, params, tier, band);
    if (!item) continue;
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

/** One fresh item on demand — the reason the bank never runs dry mid-session. */
export function generateOne(kpId, { form = "construct", tier = "core", band = 3, seed = 1, tries = 200 } = {}) {
  const shapes = (SHAPES_BY_KP.get(kpId) || []).filter((s) => true);
  if (!shapes.length) return null;
  const rand = rng(seed);
  const start = (seed >>> 0) % shapes.length;
  for (let i = 0; i < tries; i++) {
    const shp = shapes[(start + i) % shapes.length];
    const params = shp.draw(rand, tier);
    if (!params) continue;
    const item = makeItem(shp, form, params, tier, band);
    if (item) return item;
  }
  return null;
}

/** Every misconception this bank can target, per knowledge point. */
export function misconceptionsCovered(kpId) {
  const out = new Set();
  for (const s of SHAPES_BY_KP.get(kpId) || []) {
    const rand = rng(7);
    for (let i = 0; i < 400; i++) {
      const params = s.draw(rand, TIERS[i % 3]);
      if (!params) continue;
      const built = s.build(params);
      if (!separationOK(built)) continue;
      for (const k of Object.keys(built.sigs)) out.add(k);
      if (built.gen) for (const k of Object.keys(built.gen.sigs || {})) out.add(k);
      if (built.chainMisc) out.add(built.chainMisc);
    }
  }
  return [...out];
}
