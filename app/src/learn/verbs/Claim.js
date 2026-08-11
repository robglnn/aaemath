/**
 * P19 — the physics a claim obeys when hands are on it.
 *
 * ==================================================================================================
 * WHY THIS FILE EXISTS AND WHAT IT DELIBERATELY DOES NOT KNOW
 *
 * `design/world.md` §2.1 says a claim hangs across the Sill on two **pans**, that everything standing
 * on one pan is a **load**, that a load is made of **terms** which have a **kind** and a **count**,
 * and that a **bundle** binds tighter than the joins around it. Every verb in this folder performs a
 * physical act on exactly that structure — so the structure lives here, once, and the verb files hold
 * only the performance: what the hands do, what stands in the world, and how it fails.
 *
 * THE ONE THING THIS FILE MUST NEVER SEE IS THE ANSWER.
 *
 * `RESUME.md` §6b's third case and P34's own round-2 defect are the same defect twice: a measurement
 * that reads the answer key proves the engine can mark a response and proves nothing about whether a
 * player could have produced one. So the whole verb layer is built on a rule with no exceptions:
 *
 *     A verb is handed the OPEN READING — the stem, the given, the unknown, the object class — and
 *     nothing else. It performs real algebra on that reading, and whatever falls out is the response.
 *     `ItemBank.check` marks it, exactly as it marks a typed one.
 *
 * That is why this file carries a rational arithmetic type, a parser and an op set rather than a
 * lookup. A verb that could not do the mathematics would have to be told the mathematics.
 *
 * ==================================================================================================
 * THE ANTI-GUESSING CONSEQUENCE, STATED BEFORE IT IS RELIED ON
 *
 * `learn/Teaching.js`'s header refuses to stand three candidates and let the learner pick, because a
 * pick-one presentation of a `construct` item is `guided-2` wearing a workshop and crediting it at
 * construct's 0.03 is the arithmetic error `content/knowledge-graph.json` spends a paragraph
 * forbidding. A physical verb can reopen that leak in a quieter way: if the world shows whether the
 * claim is true WHILE the hand is still on it, sweeping the value until the pans go level is a
 * hundred-percent strategy with no algebra in it.
 *
 * So the rule, enforced by every verb here and asserted in `review/measure/P19.mjs`:
 *
 *     While the act is being performed, the world shows WHAT YOU ARE DOING and never WHETHER IT
 *     WILL HOLD. The verdict arrives when you set it down, and not one frame earlier.
 *
 * The tilt this file computes is therefore the tilt caused by the player's OWN one-sided move — an
 * imbalance they introduced and can see they introduced — never the residual against a correct value.
 */

// ---------------------------------------------------------------------------- rationals
//
// Exact, because a value decides a physical dimension (§2.1 rule 4: "Dimensions are a pure function
// of the closed value... deterministically (G4)") and because `x/3` is a legal answer in this bank —
// 68 committed items are `answerType: "rational"`. Floating point would make a span's length depend
// on which order the terms were carried.

function gcd(a, b) {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a || 1;
}

/** A rational in lowest terms with the sign on the numerator. */
export function rat(n, d = 1) {
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
  if (!Number.isInteger(n) || !Number.isInteger(d)) {
    // A decimal reached us from somewhere. Keep it exact to three places rather than guessing.
    const s = 1000;
    return rat(Math.round(n * s), Math.round(d * s));
  }
  if (d < 0) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}

export const R = {
  zero: rat(0),
  one: rat(1),
  add: (a, b) => (a && b ? rat(a.n * b.d + b.n * a.d, a.d * b.d) : null),
  sub: (a, b) => (a && b ? rat(a.n * b.d - b.n * a.d, a.d * b.d) : null),
  mul: (a, b) => (a && b ? rat(a.n * b.n, a.d * b.d) : null),
  div: (a, b) => (a && b && b.n !== 0 ? rat(a.n * b.d, a.d * b.n) : null),
  neg: (a) => (a ? rat(-a.n, a.d) : null),
  isZero: (a) => !!a && a.n === 0,
  isInt: (a) => !!a && a.d === 1,
  eq: (a, b) => !!a && !!b && a.n === b.n && a.d === b.d,
  num: (a) => (a ? a.n / a.d : NaN),
  abs: (a) => (a ? rat(Math.abs(a.n), a.d) : null),
  /** `-5` / `2/3` — inside `ItemBank.ENTRY_GRAMMAR`, so it is typeable and therefore checkable. */
  canon: (a) => (!a ? "" : a.d === 1 ? String(a.n) : `${a.n}/${a.d}`),
  /** `-5` / `\frac{2}{3}` — KaTeX, for standing in the world. */
  tex: (a) =>
    !a ? "" : a.d === 1 ? String(a.n) : a.n < 0 ? `-\\frac{${-a.n}}{${a.d}}` : `\\frac{${a.n}}{${a.d}}`,
};

// ---------------------------------------------------------------------------- terms and loads
//
// A **term** is one object in a load: a count and a kind (§4.2 — "a term: one object in a load. Has
// mass, has a kind, and can be gripped"). `v` is the kind: a name means a length/weight/count of that
// name, `null` means fixed weight.
//
// A **bundle** is a term that has not been opened yet: `k` outside, `inner` inside, and `reached`
// wards — how many of the inside the outside has actually got to. `reached` is the whole of
// DISTRIBUTE's failure mode made into state: `3(2x + 5)` with one ward reached IS `6x + 5`, which is
// the tagged misconception `distributed-to-first-only`, and the world can draw the half-open bracket
// that says so.

const term = (c, v = null) => ({ c, v: v ?? null });
const bundle = (k, inner) => ({ bundle: true, k, inner, reached: 0 });
export const isBundle = (t) => !!t && t.bundle === true;

/** The load a bundle currently contributes: reached wards scaled, unreached wards as they stand. */
export function bundleTerms(t) {
  if (!isBundle(t)) return [t];
  return t.inner.map((w, i) => (i < t.reached ? term(R.mul(t.k, w.c), w.v) : term(w.c, w.v)));
}

/** Every term a load currently weighs, bundles resolved at their present state of opening. */
export function settle(load) {
  const out = [];
  for (const t of load) out.push(...bundleTerms(t));
  const byKind = new Map();
  for (const t of out) {
    const k = t.v ?? "";
    byKind.set(k, byKind.has(k) ? R.add(byKind.get(k), t.c) : t.c);
  }
  const rows = [];
  for (const [k, c] of byKind) if (!R.isZero(c) || byKind.size === 1) rows.push(term(c, k || null));
  return rows.length ? rows : [term(R.zero)];
}

/** Terms of one kind gather into one term of that kind, and the kind never changes (§2.1 rule 9). */
export const alike = (a, b) => !isBundle(a) && !isBundle(b) && (a.v ?? null) === (b.v ?? null);

// ---------------------------------------------------------------------------- rendering
//
// TeX only. Nothing here writes a word: `design/voice.md` §1 bans the vocabulary a label would need
// and `world.md` §12 says there is no word for mathematics in the Margin. A load says what it is by
// being a load.

function termTex(t, first) {
  if (isBundle(t)) {
    const open = t.inner.slice(t.reached);
    const done = t.inner.slice(0, t.reached).map((w) => term(R.mul(t.k, w.c), w.v));
    const parts = [];
    if (done.length) parts.push(loadTex(done, first));
    if (open.length) {
      // The head of a half-open lock: `3(`, `-(`, `(`. Its sign is the join to whatever stands to
      // the left of it, and a bundle that is not the first term on its pan MUST carry that join —
      // `7 4(x + 9)` is a different and false statement from `7 + 4(x + 9)`.
      const neg = t.k.n < 0;
      const mag = R.abs(t.k);
      const head = R.eq(mag, R.one) ? "" : R.tex(mag);
      const piece = `${head}\\left(${loadTex(open, true)}\\right)`;
      const bare = first && !parts.length;
      if (bare) parts.push(neg ? `-${piece}` : piece);
      else parts.push(neg ? `- ${piece}` : `+ ${piece}`);
    }
    return parts.join(" ");
  }
  const c = t.c;
  const neg = c.n < 0;
  const mag = R.abs(c);
  let body;
  if (t.v == null) body = R.tex(mag);
  else if (R.eq(mag, R.one)) body = t.v;
  else if (mag.d === 1) body = `${mag.n}${t.v}`;
  else body = `\\frac{${mag.n}}{${mag.d}}${t.v}`;
  if (first) return neg ? `-${body}` : body;
  return neg ? `- ${body}` : `+ ${body}`;
}

export function loadTex(load, firstIsBare = true) {
  if (!load.length) return "0";
  return load.map((t, i) => termTex(t, firstIsBare && i === 0)).join(" ");
}

/**
 * The same load with a grip plate resting on one term.
 *
 * The plate goes AFTER the join and before the term, because the join belongs to the load and the
 * term belongs to your hand: `5y + ■5x` is a hand on a term, and `5y ■+ 5x` is a hand on a plus
 * sign, which is not an object anybody can pick up. Round 1 shipped the second one and it read as
 * a typographical accident rather than as a grip.
 */
const GRIP = "\\rule{0.3em}{0.3em}\\,";

export function markedLoadTex(load, markIndex, mark = GRIP) {
  if (!load.length) return "0";
  return load
    .map((t, i) => {
      const full = termTex(t, i === 0);
      if (i !== markIndex) return full;
      if (i === 0) return `${mark}${full}`;
      const m = /^([+-]\s*)([\s\S]*)$/.exec(full);
      return m ? `${m[1]}${mark}${m[2]}` : `${mark}${full}`;
    })
    .join(" ");
}

/**
 * The load as a string a learner could have typed, in `ItemBank.ENTRY_GRAMMAR`.
 *
 * `-5*x + -6` rather than `-5x - 6`, because that is the shape the bank's own committed answers
 * canonicalize from and `check()` is the only opinion that matters. Degree first, constant last.
 */
export function loadCanon(load) {
  const rows = settle(load);
  rows.sort((a, b) => (a.v == null ? 1 : 0) - (b.v == null ? 1 : 0) || String(a.v).localeCompare(String(b.v)));
  const parts = rows.map((t) => (t.v == null ? R.canon(t.c) : `${R.canon(t.c)}*${t.v}`));
  return parts.join(" + ");
}

// ---------------------------------------------------------------------------- parsing the open reading
//
// The stems this has to read are the shipped bank's, surveyed rather than imagined
// (`review/measure/P19-scan.mjs`): 1,152 committed items use exactly eleven macros —
// `\left \right \cdot \frac \ge \Rightarrow \square \le \div \mid \quad` — and generated stems use
// the same writer. Anything outside this grammar returns null, and a verb that cannot read a claim
// does not pose it; `learn/Teaching.js`'s typed entry is still standing behind every one of them.

const MACRO_REL = { "\\ge": ">=", "\\le": "<=", "\\neq": "!=" };

function lex(src) {
  const out = [];
  let i = 0;
  const s = String(src ?? "");
  while (i < s.length) {
    const c = s[i];
    if (c === " " || c === "\t" || c === "\n") {
      i += 1;
      continue;
    }
    if (c === "\\") {
      const m = /^\\([a-zA-Z]+|[;,!{}])/.exec(s.slice(i));
      if (!m) return null;
      const name = `\\${m[1]}`;
      i += m[0].length;
      if (name === "\\left" || name === "\\right") continue; // sizing only; the bracket follows
      if (name === "\\;" || name === "\\," || name === "\\quad" || name === "\\qquad" || name === "\\!") continue;
      if (name === "\\cdot" || name === "\\times") out.push({ t: "*" });
      else if (name === "\\div") out.push({ t: "/" });
      else if (name === "\\frac") out.push({ t: "frac" });
      else if (MACRO_REL[name]) out.push({ t: "rel", v: MACRO_REL[name] });
      else return null; // \Rightarrow, \square, \mid, \{ ... — not a claim this layer reads
      continue;
    }
    if (/[0-9]/.test(c)) {
      const m = /^[0-9]+(\.[0-9]+)?/.exec(s.slice(i));
      out.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[a-zA-Z]/.test(c)) {
      out.push({ t: "name", v: c });
      i += 1;
      continue;
    }
    if ("+-*/(){}^".includes(c)) {
      out.push({ t: c });
      i += 1;
      continue;
    }
    if (c === "=") {
      out.push({ t: "rel", v: "=" });
      i += 1;
      continue;
    }
    if (c === "<" || c === ">") {
      // `<=` / `>=` are spelled with macros in this bank, but a generator may still write them.
      if (s[i + 1] === "=") {
        out.push({ t: "rel", v: `${c}=` });
        i += 2;
      } else {
        out.push({ t: "rel", v: c });
        i += 1;
      }
      continue;
    }
    return null;
  }
  return out;
}

/**
 * One pan, parsed into a load. Returns null on anything this grammar does not cover, which is the
 * honest answer: a verb that cannot read the claim must not pose it.
 */
function parseLoad(toks, pos) {
  const terms = [];
  let sign = 1;
  const readFactorChain = () => {
    // A chain of factors: `5x`, `3\cdot x`, `\frac{2}{3}x`, `\frac{x}{2}`, `2(x + 1)`.
    let coef = null;
    let name = null;
    let grouped = null;
    /**
     * How many independent NUMBERS this chain multiplied together.
     *
     * More than one and the chain is refused, and the reason is pedagogy rather than parsing:
     * `8 + 5 \cdot 4` is an `oo-numeric` claim whose whole content is that the multiplication
     * settles first, and a reader that quietly folded it to `8 + 20` would have performed the
     * knowledge point in front of the learner and then asked them to do it. `props-operations`'s
     * `6x \cdot 0 + x` is the same trap with the zero property. A claim this layer cannot read
     * without doing a step of it is a claim it must not pose.
     */
    let numerics = 0;
    for (;;) {
      const t = toks[pos];
      if (!t) break;
      if (t.t === "num") {
        const v = rat(t.v);
        coef = coef ? R.mul(coef, v) : v;
        numerics += 1;
        pos += 1;
      } else if (t.t === "frac") {
        // `\frac{<num>}{<num>}` is a count; `\frac{<name>}{<num>}` is a share of one kind, which is
        // what `eq-one-mult` writes and is the single most common shape this used to turn away.
        const isNum = toks[pos + 1]?.t === "{" && toks[pos + 2]?.t === "num" && toks[pos + 3]?.t === "}";
        const isName = toks[pos + 1]?.t === "{" && toks[pos + 2]?.t === "name" && toks[pos + 3]?.t === "}";
        if ((!isNum && !isName) || toks[pos + 4]?.t !== "{" || toks[pos + 5]?.t !== "num" || toks[pos + 6]?.t !== "}") return null;
        const den = toks[pos + 5].v;
        if (isName) {
          if (name) return null;
          name = toks[pos + 2].v;
          const v = rat(1, den);
          coef = coef ? R.mul(coef, v) : v;
        } else {
          const v = rat(toks[pos + 2].v, den);
          if (!v) return null;
          coef = coef ? R.mul(coef, v) : v;
          numerics += 1;
        }
        pos += 7;
      } else if (t.t === "name") {
        if (name) return null; // two kinds multiplied is not a load this layer reads
        name = t.v;
        pos += 1;
        if (toks[pos]?.t === "^") return null; // a power is not linear; SPAN still poses it
      } else if (t.t === "(") {
        if (grouped) return null;
        pos += 1;
        const inner = parseLoad(toks, pos);
        if (!inner) return null;
        pos = inner.pos;
        if (toks[pos]?.t !== ")") return null;
        pos += 1;
        grouped = inner.load;
      } else if (t.t === "*" || t.t === "/") {
        const div = t.t === "/";
        pos += 1;
        const nxt = toks[pos];
        if (nxt?.t !== "num") return null;
        const v = rat(nxt.v);
        coef = div ? R.div(coef ?? R.one, v) : R.mul(coef ?? R.one, v);
        numerics += 1;
        pos += 1;
      } else break;
    }
    if (numerics > 1) return null;
    if (grouped) {
      if (name) return null;
      const k = R.mul(rat(sign), coef ?? R.one);
      // A bracket with one thing in it is not a bundle — it is a term wearing brackets, which is
      // how a negative constant is written: `x + \left(-4\right)`. Binding it as a lock would give
      // the player a ward to open that has nothing on the other side of it.
      if (grouped.length === 1 && !isBundle(grouped[0])) return { kind: "term", value: term(R.mul(k, grouped[0].c), grouped[0].v) };
      return { kind: "bundle", value: bundle(k, grouped) };
    }
    if (coef == null && name == null) return null;
    const c = R.mul(rat(sign), coef ?? R.one);
    return { kind: "term", value: term(c, name) };
  };

  for (;;) {
    const t = toks[pos];
    if (!t) break;
    if (t.t === "+") {
      sign = 1;
      pos += 1;
      continue;
    }
    if (t.t === "-") {
      // A minus is the join to what follows, whether it opens the load or sits between two terms.
      sign = -1;
      pos += 1;
      continue;
    }
    if (t.t === "rel" || t.t === ")" || t.t === "}") break;
    const f = readFactorChain();
    if (!f) return null;
    terms.push(f.value);
    sign = 1;
  }
  if (!terms.length) return null;
  return { load: terms, pos };
}

/**
 * The open reading of a claim: two pans across a Sill, or one load standing on its own.
 *
 * `rel` is null for a bare load (`3x + 2x`, which is what a Bearer's near pan looks like before
 * anybody has hung it), and `=` / `>=` / `>` / `<=` / `<` for a claim proper.
 */
export function parseClaim(tex) {
  const toks = lex(tex);
  if (!toks || !toks.length) return null;
  const near = parseLoad(toks, 0);
  if (!near) return null;
  let pos = near.pos;
  if (pos >= toks.length) return { rel: null, near: near.load, far: null, tilt: R.zero };
  const r = toks[pos];
  if (r.t !== "rel") return null;
  pos += 1;
  const far = parseLoad(toks, pos);
  if (!far || far.pos !== toks.length) return null;
  return { rel: r.v, near: near.load, far: far.load, tilt: R.zero };
}

// ---------------------------------------------------------------------------- the acts
//
// Law 3: "Both pans or neither — and the Sill knows which kind of claim it is holding." Every act
// below either touches both pans or records the tilt it introduced by touching one. Nothing here
// consults a correct value, so nothing here can tell a player whether they are winning.

export const cloneClaim = (c) => ({
  rel: c.rel,
  near: c.near.map(cloneTerm),
  far: c.far ? c.far.map(cloneTerm) : null,
  tilt: c.tilt ?? R.zero,
});
const cloneTerm = (t) => (isBundle(t) ? { bundle: true, k: t.k, inner: t.inner.map(cloneTerm), reached: t.reached } : term(t.c, t.v));

/**
 * Lift a term off its pan, walk it over the Sill and set it down. It turns around on the way
 * (Law 2), and because it left one pan and arrived on the other the claim is still level.
 */
export function carry(c, side, index) {
  const from = side === "near" ? c.near : c.far;
  const to = side === "near" ? c.far : c.near;
  if (!from || !to || !from[index] || isBundle(from[index])) return false;
  const t = from.splice(index, 1)[0];
  to.push(term(R.neg(t.c), t.v));
  return true;
}

/**
 * Shove a term across the Sill WITHOUT lifting it, so it lands the same way up.
 *
 * ROUND 3, AND IT IS AN AFFORDANCE FOR MAKING A MISTAKE ON PURPOSE.
 *
 * `world.md` Law 2 is that a term carried over the Sill turns around on the way, and `carry` above
 * enforces it. That made `moved-without-inverting` — 124 committed items carry it, tagged
 * `fail.sill.sign`, "It came over the Sill and did not turn around" — a thing no pair of hands in
 * this game could do. The round-2 critic named the consequence: "the best line in the piece... is
 * unreachable."
 *
 * TILT already had the matching pair, and it is the model: `turn(claim, false)` sends the rail over
 * and deliberately leaves the mark, which is how `fail.mark.unturned` is committed rather than asked
 * about. This is the same shape one rung down. Lifting a term is work; shoving it is not, and a
 * player with their weight set (the second grip) can push it flat across the Sill instead. The claim
 * does not object at the time. The world says what happened when it is set down.
 */
export function carryFlat(c, side, index) {
  const from = side === "near" ? c.near : c.far;
  const to = side === "near" ? c.far : c.near;
  if (!from || !to || !from[index] || isBundle(from[index])) return false;
  const t = from.splice(index, 1)[0];
  to.push(term(t.c, t.v));
  c.shoved = true;
  return true;
}

/**
 * Shed a term off the pan you are standing at without carrying it anywhere.
 *
 * This is the one-sided move, and it is reachable on purpose: `world.md` Law 3 says the world never
 * says "wrong", it *leans*, and a lean you can only see because you caused it is the entire lesson of
 * the properties of equality. The tilt is recorded, the claim keeps standing, and the player can put
 * it back.
 */
export function shed(c, side, index) {
  const from = side === "near" ? c.near : c.far;
  if (!from || !from[index] || isBundle(from[index])) return false;
  const t = from.splice(index, 1)[0];
  const weight = t.v == null ? t.c : t.c; // the tilt reads in whatever kind was lifted
  c.tilt = side === "near" ? R.sub(c.tilt, weight) : R.add(c.tilt, weight);
  c.tiltKind = t.v ?? null;
  return true;
}

/** Share both pans alike, by the same factor, and neither objects. Third Rung. */
export function share(c, k) {
  if (!k || R.isZero(k)) return false;
  const div = (load) =>
    load.map((t) => (isBundle(t) ? { bundle: true, k: R.div(t.k, k), inner: t.inner, reached: t.reached } : term(R.div(t.c, k), t.v)));
  c.near = div(c.near);
  if (c.far) c.far = div(c.far);
  if (c.rel && c.rel !== "=" && k.n < 0) c.rel = flipRel(c.rel);
  return true;
}

/** Gather like into one. The load gets shorter; the kind never changes. Second Rung. */
export function gather(c, side, i, j) {
  const load = side === "near" ? c.near : c.far;
  if (!load || !load[i] || !load[j] || i === j) return false;
  if (!alike(load[i], load[j])) return false;
  const joined = term(R.add(load[i].c, load[j].c), load[i].v);
  const lo = Math.min(i, j);
  const hi = Math.max(i, j);
  load.splice(hi, 1);
  load.splice(lo, 1, joined);
  return true;
}

/** One more ward reached by the value outside the bundle. Returns false when the lock is fully open. */
export function reachWard(t) {
  if (!isBundle(t) || t.reached >= t.inner.length) return false;
  t.reached += 1;
  return true;
}

/** A bundle every ward of which has been reached stops being a bundle. */
export function foldOpenBundles(c) {
  const fold = (load) => {
    const out = [];
    for (const t of load) {
      if (isBundle(t) && t.reached >= t.inner.length) out.push(...bundleTerms(t));
      else out.push(t);
    }
    return out;
  };
  c.near = fold(c.near);
  if (c.far) c.far = fold(c.far);
}

const flipRel = (rel) => ({ ">=": "<=", "<=": ">=", ">": "<", "<": ">", "=": "=" })[rel] ?? rel;

/**
 * Walk round to the other side of the Sill: the pans exchange places and the relation turns with
 * them. `1 < x` read from the far side is `x > 1` — the same statement, standing where you can
 * reach it. Nothing is negated and nothing is shared, so this is always legal.
 */
export function swap(c) {
  if (!c.far) return false;
  const n = c.near;
  c.near = c.far;
  c.far = n;
  c.rel = flipRel(c.rel);
  c.tilt = R.neg(c.tilt ?? R.zero);
  return true;
}

/**
 * Carry the whole rail over the Sill inverted. Both pans turn, and on a threshold **the detent goes
 * to the other side of the mark** (Law 3) — everything it used to admit, it now refuses.
 *
 * `turnedMark` is false when the rail went over and the mark did not, which is exactly
 * `fail.mark.unturned` and is the misconception the Fifth Rung exists to teach.
 */
export function turn(c, turnedMark = true) {
  const neg = (load) => load.map((t) => (isBundle(t) ? { bundle: true, k: R.neg(t.k), inner: t.inner, reached: t.reached } : term(R.neg(t.c), t.v)));
  c.near = neg(c.near);
  if (c.far) c.far = neg(c.far);
  if (c.rel && c.rel !== "=" && turnedMark) c.rel = flipRel(c.rel);
  c.turnedRail = true;
  c.markTurned = turnedMark;
  return true;
}

// ---------------------------------------------------------------------------- reading a claim back

/** True when the near pan is one unit of the unknown and the far pan holds no unknown. */
export function isolated(c, unknown) {
  if (!c.far) return false;
  const n = settle(c.near);
  const f = settle(c.far);
  if (n.length !== 1 || n[0].v !== unknown || !R.eq(n[0].c, R.one)) return false;
  return f.every((t) => t.v == null);
}

/** The value standing on the far pan of an isolated claim. */
export function valueOf(c) {
  const f = settle(c.far ?? []);
  return f.length === 1 && f[0].v == null ? f[0].c : null;
}

/** The claim, as it stands, in TeX — the open reading, transformed by whatever the hands have done. */
export function claimTex(c) {
  const near = loadTex(c.near);
  if (!c.rel) return near;
  const rel = { "=": "=", ">=": "\\ge", "<=": "\\le", ">": ">", "<": "<" }[c.rel] ?? "=";
  return `${near} ${rel} ${loadTex(c.far ?? [])}`;
}

// ---------------------------------------------------------------------------- chains: the joins, still open
//
// ROUND 2's CRITIC, ON THE WHOLE PIECE: "SPAN is a magnitude dial: you hold a button until a counter
// reaches the number you already worked out in your head, so the algebra stays in your head and your
// hands only transcribe it."
//
// `parseClaim` above cannot help with that, and it says so at line 300: a chain with two independent
// numbers in it is REFUSED, because folding `8 + 5 \cdot 4` to `8 + 20` would be the reader
// performing `oo-numeric` in front of the learner. That was the right call and the wrong conclusion.
// The claim does not have to be settled to be held — it has to be held with its **joins still open**,
// so that closing one is the player's act and choosing WHICH one is the mathematics.
//
// The bank already speaks this way. `hint.move.oo-numeric.divmul` is "Neither join is privileged.
// Take them in the order they stand", `hint.move.oo-numeric.addmul` is "The bundle of 5 and 4 settles
// before the join outside it", and `\design/world.md` §2.1 rule 8 is "outward-in, top first". A chain
// is that reading: the parts standing in a row, and the joins between them, unclosed.

const JOIN_TEX = { "+": "+", "-": "-", "*": "\\cdot", "/": "\\div" };

/** One thing standing in a chain: `8`, `5x`, `\frac{2}{3}`, `\frac{x}{2}`. No brackets, no powers. */
function readAtom(toks, start) {
  let pos = start;
  let coef = null;
  let name = null;
  for (;;) {
    const k = toks[pos];
    if (!k) break;
    if (k.t === "num") {
      if (coef != null || name != null) break;
      coef = rat(k.v);
      pos += 1;
      continue;
    }
    if (k.t === "frac") {
      if (coef != null) break;
      const isNum = toks[pos + 1]?.t === "{" && toks[pos + 2]?.t === "num" && toks[pos + 3]?.t === "}";
      const isName = toks[pos + 1]?.t === "{" && toks[pos + 2]?.t === "name" && toks[pos + 3]?.t === "}";
      if ((!isNum && !isName) || toks[pos + 4]?.t !== "{" || toks[pos + 5]?.t !== "num" || toks[pos + 6]?.t !== "}") return null;
      const den = toks[pos + 5].v;
      if (isName) {
        if (name) return null;
        name = toks[pos + 2].v;
        coef = rat(1, den);
      } else {
        coef = rat(toks[pos + 2].v, den);
      }
      if (!coef) return null;
      pos += 7;
      continue;
    }
    if (k.t === "name") {
      if (name != null) break;
      name = k.v;
      pos += 1;
      // A power is not one thing standing in a row; it is a build. SPAN still poses it.
      if (toks[pos]?.t === "^") return null;
      continue;
    }
    break;
  }
  if (coef == null && name == null) return null;
  return { t: term(coef ?? R.one, name), pos };
}

/**
 * A load with every join still open: `{ parts, ops }`, one more part than there are joins.
 *
 * Returns null for anything that is not a flat row — a bracket, a power, a relation. Those are other
 * verbs' shapes and a chain that quietly flattened one would be a chain telling a lie about it.
 */
export function parseChain(tex) {
  const toks = lex(tex);
  if (!toks || !toks.length) return null;
  let pos = 0;
  let sign = 1;
  if (toks[0].t === "-") {
    sign = -1;
    pos = 1;
  } else if (toks[0].t === "+") pos = 1;
  const first = readAtom(toks, pos);
  if (!first) return null;
  const parts = [term(R.mul(rat(sign), first.t.c), first.t.v)];
  const ops = [];
  pos = first.pos;
  while (pos < toks.length) {
    const k = toks[pos];
    const op = k.t === "+" || k.t === "-" || k.t === "*" || k.t === "/" ? k.t : null;
    if (!op) return null;
    const next = readAtom(toks, pos + 1);
    if (!next) return null;
    parts.push(next.t);
    ops.push(op);
    pos = next.pos;
  }
  if (!ops.length) return null;
  return { parts, ops };
}

export const cloneChain = (c) => ({ parts: c.parts.map((t) => term(t.c, t.v)), ops: c.ops.slice() });

/**
 * Will this join close?
 *
 * §2.1 rule 9 is the only rule the world enforces by refusing your hands: "A length and a weight will
 * not stand together, and the socket does not argue about it; it simply will not take them." So a
 * `+` between unlike kinds refuses, and so does a `\cdot` between two names — that is not a load this
 * layer reads, and pretending otherwise would put a quadratic in a player's hands.
 */
export function joinTakes(a, op, b) {
  if (!a || !b) return false;
  if (op === "+" || op === "-") return (a.v ?? null) === (b.v ?? null);
  if (op === "*") return a.v == null || b.v == null;
  if (op === "/") return b.v == null && !R.isZero(b.c);
  return false;
}

/** Close one join. The two parts it held become one part, and the row gets shorter. */
export function closeJoin(chain, i) {
  const a = chain.parts[i];
  const b = chain.parts[i + 1];
  const op = chain.ops[i];
  if (!joinTakes(a, op, b)) return false;
  let out;
  if (op === "+") out = term(R.add(a.c, b.c), a.v ?? b.v);
  else if (op === "-") out = term(R.sub(a.c, b.c), a.v ?? b.v);
  else if (op === "*") out = term(R.mul(a.c, b.c), a.v ?? b.v);
  else out = term(R.div(a.c, b.c), a.v);
  if (!out.c) return false;
  chain.parts.splice(i, 2, out);
  chain.ops.splice(i, 1);
  return true;
}

/** True when nothing but `+` and `-` is left holding the row, so it can be read as one load. */
export const chainIsLoad = (chain) => chain.ops.every((o) => o === "+" || o === "-");

/** The chain as a load, `-` folded into the sign of what follows it. Only legal when `chainIsLoad`. */
export function chainLoad(chain) {
  const out = [term(chain.parts[0].c, chain.parts[0].v)];
  for (let i = 0; i < chain.ops.length; i += 1) {
    const t = chain.parts[i + 1];
    out.push(chain.ops[i] === "-" ? term(R.neg(t.c), t.v) : term(t.c, t.v));
  }
  return out;
}

const bareTex = (t) => (t.v == null ? R.tex(t.c) : termTex(term(t.c, t.v), true));

/**
 * A join and the part hanging off it.
 *
 * A negative part on a `+` join is drawn the way anybody writes it — `5x - 6`, not
 * `5x + \left(-6\right)` — because the join and the sign are the same mark and always have been.
 * On any other join they are not, and `9 - -2` is two marks the eye reads as one, so those keep
 * their brackets.
 */
function joinPartTex(op, t) {
  const neg = t.c.n < 0;
  if (op === "+" && neg) return { sym: "-", body: bareTex(term(R.abs(t.c), t.v)) };
  const sym = JOIN_TEX[op] ?? "+";
  return { sym, body: neg ? `\\left(${bareTex(t)}\\right)` : bareTex(t) };
}

/**
 * The row, drawn with the joins in it and the hand on one of them.
 *
 * `gap` is how far the push has closed the held join: the two parts it holds physically approach
 * each other, and the space between them is the only thing on screen that says what the hands are
 * doing. Nothing here says whether closing it is a good idea.
 */
export function chainTex(chain, held = -1, gap = 1) {
  let out = bareTex(chain.parts[0]);
  for (let i = 0; i < chain.ops.length; i += 1) {
    const { sym, body } = joinPartTex(chain.ops[i], chain.parts[i + 1]);
    if (i === held) {
      const s = `\\rule{${Math.max(0.02, gap * 0.55).toFixed(2)}em}{0em}`;
      out += `${s}\\rule{0.3em}{0.3em}${sym}${s}${body}`;
    } else {
      out += `\\;${sym}\\;${body}`;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------- systems: more than one Sill
//
// `x + y = 14,\quad x - y = 0` is 40% of everything a new player is served and NO verb read it, because
// `lex` refuses a bare comma and `parseClaim` refuses two names. The critic's measurement of round 2
// is that this one shape is why BALANCE — "the one verb where the hands genuinely perform the algebra"
// — never posed at all.
//
// A comma between two claims is not notation this layer has to understand; it is the gap between two
// Sills standing side by side. Split there, and each piece is a claim `parseClaim` already reads.

/** Two or more claims standing together, or null if any piece is not a claim. */
export function parseSystem(tex) {
  const pieces = String(tex ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (pieces.length < 2) return null;
  const claims = [];
  for (const p of pieces) {
    const c = parseClaim(p);
    if (!c || !c.far || c.rel !== "=") return null;
    claims.push(c);
  }
  return claims;
}

/** Every kind standing anywhere in a claim, bundles opened. */
export function namesOf(c) {
  const out = new Set();
  const walk = (load) => {
    for (const t of load ?? []) {
      if (isBundle(t)) for (const w of t.inner) {
        if (w.v) out.add(w.v);
      }
      else if (t.v) out.add(t.v);
    }
  };
  walk(c.near);
  walk(c.far);
  return out;
}

/**
 * The name this claim has been reduced to, or null.
 *
 * Looser than `isolated` on purpose: `x = y` IS solved for `x` even though the far pan is not a
 * number, and that is precisely the state SEAT needs — a core that has been reduced to "wherever the
 * other one is sitting" is the thing you pick up and set into the other socket.
 */
export function solvedFor(c) {
  if (!c.far) return null;
  const n = settle(c.near);
  if (n.length !== 1 || n[0].v == null || !R.eq(n[0].c, R.one)) return null;
  const name = n[0].v;
  if (settle(c.far).some((t) => t.v === name)) return null;
  return name;
}

/**
 * Seat one claim into another: every socket cut for `name` takes what the other claim says goes in it.
 *
 * `hint.move.var-meaning.twin`, shipped since P17 and never once performable: "The second core has to
 * sit exactly where the first one does." This is that sentence as a pair of hands.
 */
export function substitute(c, name, load) {
  const rows = settle(load);
  const sub = (terms) => {
    const out = [];
    for (const t of terms ?? []) {
      if (isBundle(t) || t.v !== name) {
        out.push(t);
        continue;
      }
      for (const w of rows) out.push(term(R.mul(t.c, w.c), w.v));
    }
    return out;
  };
  const before = `${loadTex(c.near)}|${loadTex(c.far ?? [])}`;
  c.near = sub(c.near);
  if (c.far) c.far = sub(c.far);
  return `${loadTex(c.near)}|${loadTex(c.far ?? [])}` !== before;
}

/** Are there still two terms of one kind standing apart on either pan? */
export function ungathered(c) {
  const check = (load) => {
    for (let i = 0; i < load.length; i += 1)
      for (let j = i + 1; j < load.length; j += 1) if (alike(load[i], load[j])) return true;
    return false;
  };
  return check(c.near) || (c.far ? check(c.far) : false);
}
