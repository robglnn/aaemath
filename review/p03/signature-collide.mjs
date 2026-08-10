/**
 * P03 — PAIRWISE-SEPARATED: exhaustive measurement of misconception collisions.
 *
 * conventions.misconceptions[].diagnosticSignature states four hard rules. Rules (1) and (2) are
 * cheap string/answer checks and kg-validate.mjs has always run them:
 *   (1) SEPARABLE      no two signatures on a node are the same STRING
 *   (2) DISCRIMINATING each signature differs from the CORRECT answer on the served instance
 * Neither of those notices the case that actually breaks L7: a particular choice of stem
 * parameters that collapses two DIFFERENT wrong ideas onto the SAME response. When that happens
 * the wrong-answer path in section 6.2 attributes the error to whichever misconception is listed
 * first, stages the wrong collapse, and draws the next item from the wrong distractor pool — all
 * without a single rule firing.
 *
 *   (4) PAIRWISE-SEPARATED  on a generated instance, no two misconceptions on the same node may
 *                           evaluate to the same response.
 *
 * This file measures what that rule costs, exhaustively, over a declared parameter space per node
 * family. It is a constraint on the GENERATOR, so the honest deliverable for P17 is not "obey it"
 * but "here is the share of your stem space it deletes".
 *
 * Exact rational arithmetic throughout: a response like (c/a) - b is a number the learner types,
 * and 8/6 must compare equal to 4/3 and unequal to 1.3333333333333333.
 *
 *   node review/p03/signature-collide.mjs
 *   node review/p03/signature-collide.mjs --json
 */

const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));
/** Exact rational. den > 0 always; null means "undefined on this stem" (division by zero). */
function rat(n, d = 1) {
  if (d === 0) return null;
  if (n === 0) return "0/1";
  const s = d < 0 ? -1 : 1;
  const g = gcd(Math.abs(n), Math.abs(d)) || 1;
  return `${(s * n) / g}/${(s * d) / g}`;
}
const add = (x, y) => (x === null || y === null ? null : rat(num(x) * den(y) + num(y) * den(x), den(x) * den(y)));
const mul = (x, y) => (x === null || y === null ? null : rat(num(x) * num(y), den(x) * den(y)));
const num = (r) => Number(r.split("/")[0]);
const den = (r) => Number(r.split("/")[1]);
const I = (n) => rat(n, 1);

const range = (lo, hi, skipZero = false) => {
  const out = [];
  for (let v = lo; v <= hi; v++) if (!(skipZero && v === 0)) out.push(v);
  return out;
};
const A = range(-6, 6, true); // coefficient-shaped parameters
const B = range(-9, 9); // constant-shaped parameters

/**
 * Each family declares:
 *   node      the knowledge-graph node id
 *   stem      the shared item shape, verbatim from the signatures
 *   space     a generator over parameter tuples
 *   correct   the correct response
 *   sigs      { misconceptionId: response }, each transcribed from diagnosticSignature
 * A response of `null` means the signature is undefined on that stem, which makes the stem
 * invalid for that misconception under rule (2) exactly as an equal-to-correct response does.
 */
const FAMILIES = [
  {
    node: "eq-two-step",
    stem: "a·x + b = c, integer solution",
    params: "a in [-6,6]\\{0}, b in [-9,9], c in [-9,9], (c-b) divisible by a",
    *space() {
      for (const a of A) for (const b of B) for (const c of B) if ((c - b) % a === 0) yield { a, b, c };
    },
    correct: ({ a, b, c }) => rat(c - b, a),
    sigs: ({ a, b, c }) => ({
      "divide-before-clearing-constant": add(rat(c, a), I(-b)), // (c / a) − b
      "inverse-order-inverted": I((c - b) * a), //                 (c − b)·a
      "constant-sign-flipped": rat(c + b, a), //                   (c + b) / a
    }),
  },
  {
    node: "eq-both-sides",
    stem: "a·x + b = c·x + d, integer solution",
    params: "a,c in [-6,6]\\{0}, a != c, b,d in [-9,9], (d-b) divisible by (a-c)",
    *space() {
      for (const a of A)
        for (const c of A)
          if (a !== c)
            for (const b of B) for (const d of B) if ((d - b) % (a - c) === 0) yield { a, b, c, d };
    },
    correct: ({ a, b, c, d }) => rat(d - b, a - c),
    sigs: ({ a, b, c, d }) => ({
      "moved-without-inverting": rat(d - b, a + c),
      "removed-from-one-side-only": rat(d - b, a),
      "constants-collected-wrong-side": rat(d + b, a - c),
    }),
  },
  {
    node: "eq-combine-side",
    stem: "a·x + b·x + c = d, integer solution",
    params: "a,b in [-6,6]\\{0}, a+b != 0, c,d in [-9,9], (d-c) divisible by (a+b)",
    *space() {
      for (const a of A)
        for (const b of A)
          if (a + b !== 0)
            for (const c of B) for (const d of B) if ((d - c) % (a + b) === 0) yield { a, b, c, d };
    },
    correct: ({ a, b, c, d }) => rat(d - c, a + b),
    sigs: ({ a, b, c, d }) => ({
      "combine-across-the-equals": rat(d + c, a + b),
      "one-like-term-dropped": rat(d - c, a),
      "constant-absorbed-into-coefficient": rat(d, a + b + c),
    }),
  },
  {
    node: "eq-distribute",
    stem: "p(x + q) = r, integer solution",
    params: "p in [-6,6]\\{0}, q in [-9,9], r in [-9,9], r divisible by p",
    *space() {
      for (const p of A) for (const q of B) for (const r of B) if (r % p === 0) yield { p, q, r };
    },
    correct: ({ p, q, r }) => add(rat(r, p), I(-q)),
    sigs: ({ p, q, r }) => ({
      "distribute-partially-in-equation": rat(r - q, p),
      "divide-bracket-only": I(r - q),
      "coefficient-never-undone": I(r - p * q),
    }),
  },
  {
    node: "eq-one-add",
    stem: "x + p = q  (2 of 3 misconceptions share this stem; minus-inverted-wrongly uses x − p = q)",
    params: "p,q in [-9,9]",
    *space() {
      for (const p of B) for (const q of B) yield { p, q };
    },
    correct: ({ p, q }) => I(q - p),
    sigs: ({ p, q }) => ({
      "same-operation-not-inverse": I(q + p),
      "subtraction-order-reversed": I(p - q),
    }),
  },
  {
    node: "eq-one-mult",
    stem: "a·x = b, integer solution  (2 of 3 share this stem; fraction-form-inverted uses x / a = b)",
    params: "a in [-6,6]\\{0}, b in [-9,9], b divisible by a",
    *space() {
      for (const a of A) for (const b of B) if (b % a === 0) yield { a, b };
    },
    correct: ({ a, b }) => rat(b, a),
    sigs: ({ a, b }) => ({
      "subtract-the-coefficient": I(b - a),
      "division-order-reversed": rat(a, b),
    }),
  },
  {
    node: "distribute-variable",
    stem: "a(b·x + c), response compared as the triple (x² coefficient, x coefficient, constant)",
    params: "a,b in [-6,6]\\{0}, c in [-9,9]",
    *space() {
      for (const a of A) for (const b of A) for (const c of B) yield { a, b, c };
    },
    correct: ({ a, b, c }) => `0|${a * b}|${a * c}`,
    sigs: ({ a, b, c }) => ({
      "variable-multiplied-as-well": `${a * b}|0|${a * c}`,
      "distribute-reaches-variable-only": `0|${a * b}|${c}`,
      "coefficients-added-not-multiplied": `0|${a + b}|${a + c}`,
    }),
  },
  {
    node: "distribute-numeric",
    stem: "a(b + c)  (2 of 3 misconceptions share this stem; distribute-over-a-product uses a(b·c))",
    params: "a in [-6,6]\\{0}, b,c in [-9,9]",
    *space() {
      for (const a of A) for (const b of B) for (const c of B) yield { a, b, c };
    },
    correct: ({ a, b, c }) => I(a * b + a * c),
    sigs: ({ a, b, c }) => ({
      "distribute-to-first-term-only": I(a * b + c),
      "distribute-by-adding": I(a + b + (a + c)),
    }),
  },
];

/** A family whose two signatures are ALGEBRAICALLY IDENTICAL. The scan must flag 100% of it. */
const CONTROL = {
  node: "__control__",
  stem: "a·x = b with two signatures that differ only in how they are written",
  params: "a in [-6,6]\\{0}, b in [-9,9]",
  *space() {
    for (const a of A) for (const b of B) yield { a, b };
  },
  correct: ({ a, b }) => rat(b, a),
  sigs: ({ a, b }) => ({
    "control-alpha": I(b + a),
    "control-beta": I(a + b),
  }),
};

function scan(fam) {
  let total = 0;
  let allValid = 0;
  let collide = 0;
  const pairs = new Map();
  let example = null;
  for (const p of fam.space()) {
    total++;
    const correct = fam.correct(p);
    const sig = fam.sigs(p);
    const ids = Object.keys(sig);
    // rule (2) DISCRIMINATING: the stem is only valid for a misconception whose signature is
    // defined and differs from the correct answer. A stem valid for every misconception on the
    // node is the stem an item generator would happily serve.
    const valid = ids.filter((id) => sig[id] !== null && sig[id] !== correct);
    if (valid.length !== ids.length) continue;
    allValid++;
    let hit = null;
    for (let i = 0; i < valid.length; i++)
      for (let j = i + 1; j < valid.length; j++)
        if (sig[valid[i]] === sig[valid[j]]) hit = `${valid[i]} == ${valid[j]}`;
    if (hit) {
      collide++;
      pairs.set(hit, (pairs.get(hit) ?? 0) + 1);
      if (!example) example = { p, hit, value: sig[hit.split(" == ")[0]] };
    }
  }
  return { fam, total, allValid, collide, pct: allValid ? (100 * collide) / allValid : 0, pairs, example };
}

const rows = FAMILIES.map(scan);
const control = scan(CONTROL);

/** Consumed by kg-validate.mjs so the build gate and this report can never disagree. */
export function collisionScan() {
  return {
    rows: rows.map((r) => ({
      node: r.fam.node,
      total: r.total,
      allValid: r.allValid,
      collide: r.collide,
      pct: r.pct,
      pairs: [...r.pairs],
    })),
    control: { allValid: control.allValid, collide: control.collide, pct: control.pct },
    threshold: 25,
  };
}

const invokedDirectly = process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("signature-collide.mjs");
if (invokedDirectly && process.argv.includes("--json")) {
  console.log(
    JSON.stringify(
      {
        families: rows.map((r) => ({
          node: r.fam.node,
          total: r.total,
          allValid: r.allValid,
          collide: r.collide,
          pct: Number(r.pct.toFixed(4)),
        })),
        control: { collide: control.collide, allValid: control.allValid, pct: Number(control.pct.toFixed(4)) },
      },
      null,
      2
    )
  );
  process.exit(0);
}

const out = [];
const say = (s = "") => out.push(s);
say("PAIRWISE-SEPARATED — exhaustive misconception-collision scan");
say("");
say("Rule (4) of conventions.misconceptions[].diagnosticSignature: on a generated instance no two");
say("misconceptions on the same node may evaluate to the same response. Rules (1) and (2) do not");
say("imply it — every stem counted in the `all 3 valid` column below already passes rule (2).");
say("");
say(
  `  ${"node".padEnd(20)} ${"stems in space".padStart(15)} ${"all sigs valid".padStart(15)} ${"collide".padStart(9)} ${"rejected".padStart(10)}`
);
for (const r of rows)
  say(
    `  ${r.fam.node.padEnd(20)} ${String(r.total).padStart(15)} ${String(r.allValid).padStart(15)} ${String(r.collide).padStart(9)} ${(r.pct.toFixed(2) + "%").padStart(10)}`
  );
say("");
for (const r of rows) {
  say(`  ${r.fam.node}: ${r.fam.stem}`);
  say(`      space: ${r.fam.params}`);
  if (!r.collide) {
    say(`      no collision anywhere in the space — the rule costs this family nothing`);
  } else {
    for (const [pair, n] of [...r.pairs].sort((a, b) => b[1] - a[1]))
      say(`      ${String(n).padStart(6)} stems  ${pair}`);
    const e = r.example;
    say(
      `      example: ${JSON.stringify(e.p)} -> both signatures produce ${e.value.includes("|") ? e.value : num(e.value) / den(e.value)}`
    );
  }
  say("");
}
say(`  control arm (two signatures that are algebraically identical, b+a vs a+b):`);
say(
  `      ${control.collide} of ${control.allValid} stems flagged (${control.pct.toFixed(2)}%) — the scan can see a collision, ` +
    `${control.pct === 100 ? "PASS" : "FAIL"}`
);
say("");
const worst = rows.reduce((a, r) => (r.pct > a.pct ? r : a), rows[0]);
say(`  worst family: ${worst.fam.node} at ${worst.pct.toFixed(2)}% of its valid stems rejected.`);
say(`  build threshold is 25%: past that the misconceptions are not distinguishable and the node`);
say(`  needs different ones rather than a filter. P17 implements rule (4) as a stem filter.`);
const ok = control.pct === 100 && worst.pct < 25;
say("");
say(`RESULT: ${ok ? "PASS" : "FAIL"}`);
if (invokedDirectly) {
  console.log(out.join("\n"));
  process.exit(ok ? 0 : 1);
}
