/**
 * kit.mjs — exact arithmetic, a small algebra parser, canonical forms and TeX builders.
 *
 * Owned by P17. Imported by `content/items/generators.mjs` (authoring) and by
 * `app/src/learn/ItemBank.js` (runtime answer checking). Pure: no DOM, no three, no globals.
 *
 * Everything here works in exact rationals. A learning system that decides whether a claim
 * stands must never do it in binary floating point: 0.1 + 0.2 !== 0.3 is a wrong answer served
 * to a learner who was right, and it is unrecoverable because it is invisible.
 */

/* ------------------------------------------------------------------ rationals */

function igcd(a, b) {
  a = a < 0 ? -a : a;
  b = b < 0 ? -b : b;
  while (b) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a || 1;
}

/** Exact rational. Always reduced, denominator always positive. */
export function rat(n, d = 1) {
  if (!Number.isInteger(n) || !Number.isInteger(d)) {
    throw new Error(`rat() takes integers, got ${n}/${d}`);
  }
  if (d === 0) throw new Error("rat(): zero denominator");
  if (d < 0) {
    n = -n;
    d = -d;
  }
  const g = igcd(n, d);
  return { n: n / g, d: d / g };
}

export const R0 = rat(0);
export const R1 = rat(1);

export const radd = (a, b) => rat(a.n * b.d + b.n * a.d, a.d * b.d);
export const rsub = (a, b) => rat(a.n * b.d - b.n * a.d, a.d * b.d);
export const rmul = (a, b) => rat(a.n * b.n, a.d * b.d);
export const rdiv = (a, b) => {
  if (b.n === 0) throw new Error("rdiv(): divide by zero");
  return rat(a.n * b.d, a.d * b.n);
};
export const rneg = (a) => rat(-a.n, a.d);
export const req = (a, b) => a.n === b.n && a.d === b.d;
export const risInt = (a) => a.d === 1;
export const rcmp = (a, b) => Math.sign(a.n * b.d - b.n * a.d);
export const rnum = (a) => a.n / a.d;

/** Canonical text for a rational: "7", "-3", "5/2". Never "-5/-2", never "6/4". */
export function rstr(a) {
  return a.d === 1 ? String(a.n) : `${a.n}/${a.d}`;
}

/** TeX for a rational. Fractions use \frac; negatives keep the sign outside. */
export function rtex(a) {
  if (a.d === 1) return String(a.n);
  return a.n < 0 ? `-\\frac{${-a.n}}{${a.d}}` : `\\frac{${a.n}}{${a.d}}`;
}

/* ------------------------------------------------------------------ polynomials */
/**
 * A polynomial is a Map from a monomial key to a rational coefficient.
 * Monomial key: "" (constant), "x", "x^2", "y", "x*y", ... Variables are single letters.
 * Only what Algebra I Level 1 needs: total degree <= 3, at most two distinct letters.
 */

function monKey(vars) {
  // vars: Map letter -> power
  const parts = [...vars.entries()]
    .filter(([, p]) => p !== 0)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([v, p]) => (p === 1 ? v : `${v}^${p}`));
  return parts.join("*");
}

function keyVars(key) {
  const m = new Map();
  if (!key) return m;
  for (const part of key.split("*")) {
    const [v, p] = part.split("^");
    m.set(v, (m.get(v) || 0) + (p ? Number(p) : 1));
  }
  return m;
}

export function polyConst(r) {
  const m = new Map();
  if (r.n !== 0) m.set("", r);
  return m;
}

export function polyVar(name, power = 1) {
  const m = new Map();
  m.set(monKey(new Map([[name, power]])), R1);
  return m;
}

export function polyAdd(a, b) {
  const out = new Map(a);
  for (const [k, v] of b) {
    const cur = out.get(k);
    const sum = cur ? radd(cur, v) : v;
    if (sum.n === 0) out.delete(k);
    else out.set(k, sum);
  }
  return out;
}

export const polyNeg = (a) => {
  const out = new Map();
  for (const [k, v] of a) out.set(k, rneg(v));
  return out;
};

export const polySub = (a, b) => polyAdd(a, polyNeg(b));

export function polyMul(a, b) {
  const out = new Map();
  for (const [ka, va] of a) {
    for (const [kb, vb] of b) {
      const vars = keyVars(ka);
      for (const [v, p] of keyVars(kb)) vars.set(v, (vars.get(v) || 0) + p);
      const k = monKey(vars);
      const cur = out.get(k);
      const prod = rmul(va, vb);
      const sum = cur ? radd(cur, prod) : prod;
      if (sum.n === 0) out.delete(k);
      else out.set(k, sum);
    }
  }
  return out;
}

/**
 * Division by a single term. A constant divisor is the ordinary case; a divisor carrying a
 * letter produces negative powers, which Level 1 needs for exactly one act — "n divided into
 * a" is a/n and `translate-order` is the node that lives or dies on which letter goes under.
 * Dividing by a sum is refused: it is not a Level 1 object and silently accepting it would let
 * a wrong response canonicalise to something plausible.
 */
export function polyDiv(a, b) {
  if (b.size === 0) throw new Error("polyDiv(): divide by zero");
  if (b.size !== 1) throw new Error("polyDiv(): divisor is not a single term");
  const [bk, bv] = [...b.entries()][0];
  if (!bk) {
    const out = new Map();
    for (const [k, v] of a) out.set(k, rdiv(v, bv));
    return out;
  }
  const bvars = keyVars(bk);
  const out = new Map();
  for (const [k, v] of a) {
    const vars = keyVars(k);
    for (const [name, p] of bvars) vars.set(name, (vars.get(name) || 0) - p);
    out.set(monKey(vars), rdiv(v, bv));
  }
  return out;
}

export function polyIsConst(p) {
  return p.size === 0 || (p.size === 1 && p.has(""));
}

export function polyConstValue(p) {
  if (!polyIsConst(p)) throw new Error("polyConstValue(): not constant");
  return p.get("") || R0;
}

/** Substitute rational values for letters. Returns a polynomial (constant if all letters given). */
export function polySubst(p, values) {
  let out = new Map();
  for (const [k, v] of p) {
    let term = polyConst(v);
    for (const [name, power] of keyVars(k)) {
      const val = values[name];
      if (val === undefined) {
        term = polyMul(term, (() => {
          const m = new Map();
          m.set(monKey(new Map([[name, power]])), R1);
          return m;
        })());
      } else {
        let acc = R1;
        for (let i = 0; i < power; i++) acc = rmul(acc, val);
        term = polyMul(term, polyConst(acc));
      }
    }
    out = polyAdd(out, term);
  }
  return out;
}

function monOrder(k) {
  // Sort: higher total degree first, then alphabetically. Constants last.
  const vars = keyVars(k);
  let deg = 0;
  for (const [, p] of vars) deg += p;
  return { deg, k };
}

/** Canonical text form. Deterministic; two equal polynomials always produce the same string. */
export function polyStr(p) {
  const keys = [...p.keys()].sort((a, b) => {
    const A = monOrder(a);
    const B = monOrder(b);
    if (A.deg !== B.deg) return B.deg - A.deg;
    return A.k < B.k ? -1 : A.k > B.k ? 1 : 0;
  });
  if (keys.length === 0) return "0";
  return keys.map((k) => `${rstr(p.get(k))}${k ? "*" + k : ""}`).join(" + ");
}

export function polyEqual(a, b) {
  return polyStr(a) === polyStr(b);
}

/** Pretty TeX for a polynomial in one or two letters. Used only for authored stems. */
export function polyTex(p) {
  const keys = [...p.keys()].sort((a, b) => {
    const A = monOrder(a);
    const B = monOrder(b);
    if (A.deg !== B.deg) return B.deg - A.deg;
    return A.k < B.k ? -1 : A.k > B.k ? 1 : 0;
  });
  if (keys.length === 0) return "0";
  let out = "";
  for (const k of keys) {
    const c = p.get(k);
    const neg = c.n < 0;
    const abs = rat(Math.abs(c.n), c.d);
    const varTex = k
      ? k
          .split("*")
          .map((part) => {
            const [v, pw] = part.split("^");
            return pw ? `${v}^{${pw}}` : v;
          })
          .join("")
      : "";
    let piece;
    if (!k) piece = rtex(abs);
    else if (req(abs, R1)) piece = varTex;
    else if (abs.d === 1) piece = `${abs.n}${varTex}`;
    else piece = `\\frac{${abs.n}}{${abs.d}}${varTex}`;
    if (out === "") out = (neg ? "-" : "") + piece;
    else out += (neg ? " - " : " + ") + piece;
  }
  return out;
}

/* ------------------------------------------------------------------ parsing */
/**
 * Reads what a learner types AND the TeX this bank authors. One parser for both, so an
 * item whose stem cannot be read back is a build failure rather than a runtime surprise.
 *
 * Accepted, deliberately and exhaustively (documented in content/items/README.md):
 *   - ASCII and unicode operators: - − –, * · × ⋅, / ÷, ^
 *   - implicit multiplication: 2x, 3(x+1), x(x+2), 2 x
 *   - TeX: \cdot \times \div \frac{a}{b} \left( \right) \le \ge \leq \geq \neq { }
 *   - decimal point AND decimal comma: 4.5 and 4,5 both parse to 9/2  (ES/PL convention)
 *   - relations: = < > <= >= ≤ ≥ ≠
 */

const OPEN = "(";
const CLOSE = ")";

function normalizeSource(src) {
  let s = String(src);
  s = s.replace(/\\left|\\right/g, "");
  s = s.replace(/\\cdot|\\times|\\ast/g, "*");
  s = s.replace(/\\div/g, "/");
  s = s.replace(/\\leq|\\le\b/g, "<=");
  s = s.replace(/\\geq|\\ge\b/g, ">=");
  s = s.replace(/\\neq|\\ne\b/g, "!=");
  s = s.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "(($1)/($2))");
  s = s.replace(/\\dfrac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "(($1)/($2))");
  s = s.replace(/[−–—]/g, "-");
  s = s.replace(/[·×⋅✕]/g, "*");
  s = s.replace(/÷/g, "/");
  s = s.replace(/[≤]/g, "<=");
  s = s.replace(/[≥]/g, ">=");
  s = s.replace(/[≠]/g, "!=");
  s = s.replace(/[{}]/g, (m) => (m === "{" ? "(" : ")"));
  s = s.replace(/\[/g, "(").replace(/\]/g, ")");
  // A comma sitting between two digits is a decimal mark, not a separator.
  s = s.replace(/(\d),(\d)/g, "$1.$2");
  s = s.replace(/\\,|\\;|\\!|\\ /g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function tokenize(src) {
  const s = normalizeSource(src);
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === " ") {
      i++;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9]/.test(s[j])) j++;
      if (s[j] === "." && /[0-9]/.test(s[j + 1] || "")) {
        j++;
        while (j < s.length && /[0-9]/.test(s[j])) j++;
      }
      out.push({ t: "num", v: s.slice(i, j) });
      i = j;
      continue;
    }
    if (/[a-zA-Z]/.test(c)) {
      out.push({ t: "id", v: c });
      i++;
      continue;
    }
    if (s.startsWith("<=", i) || s.startsWith(">=", i) || s.startsWith("!=", i)) {
      out.push({ t: "rel", v: s.slice(i, i + 2) });
      i += 2;
      continue;
    }
    if ("=<>".includes(c)) {
      out.push({ t: "rel", v: c });
      i++;
      continue;
    }
    if ("+-*/^".includes(c)) {
      out.push({ t: "op", v: c });
      i++;
      continue;
    }
    if (c === OPEN || c === CLOSE) {
      out.push({ t: c === OPEN ? "(" : ")" });
      i++;
      continue;
    }
    if (c === ",") {
      out.push({ t: "," });
      i++;
      continue;
    }
    if (c === ";") {
      out.push({ t: ";" });
      i++;
      continue;
    }
    throw new Error(`unreadable character "${c}" in "${src}"`);
  }
  return out;
}

function decimalToRat(text) {
  const dot = text.indexOf(".");
  if (dot < 0) return rat(Number(text));
  const whole = text.slice(0, dot);
  const frac = text.slice(dot + 1);
  const den = 10 ** frac.length;
  return rat(Number(whole) * den + Number(frac), den);
}

class Parser {
  constructor(tokens) {
    this.t = tokens;
    this.i = 0;
  }
  peek() {
    return this.t[this.i];
  }
  next() {
    return this.t[this.i++];
  }
  expect(kind) {
    const tok = this.next();
    if (!tok || tok.t !== kind) throw new Error(`expected ${kind}`);
    return tok;
  }
  parseExpr() {
    let left = this.parseTerm();
    for (;;) {
      const tok = this.peek();
      if (tok && tok.t === "op" && (tok.v === "+" || tok.v === "-")) {
        this.next();
        const right = this.parseTerm();
        left = tok.v === "+" ? polyAdd(left, right) : polySub(left, right);
      } else break;
    }
    return left;
  }
  parseTerm() {
    let left = this.parseUnary();
    for (;;) {
      const tok = this.peek();
      if (tok && tok.t === "op" && (tok.v === "*" || tok.v === "/")) {
        this.next();
        const right = this.parseUnary();
        left = tok.v === "*" ? polyMul(left, right) : polyDiv(left, right);
      } else if (tok && (tok.t === "num" || tok.t === "id" || tok.t === "(")) {
        // implicit multiplication
        const right = this.parseUnary();
        left = polyMul(left, right);
      } else break;
    }
    return left;
  }
  parseUnary() {
    const tok = this.peek();
    if (tok && tok.t === "op" && (tok.v === "-" || tok.v === "+")) {
      this.next();
      const v = this.parseUnary();
      return tok.v === "-" ? polyNeg(v) : v;
    }
    return this.parsePower();
  }
  parsePower() {
    let base = this.parseAtom();
    const tok = this.peek();
    if (tok && tok.t === "op" && tok.v === "^") {
      this.next();
      // `x^{2}` normalises to `x^(2)`, and a learner may type either — accept both.
      let expTok = this.next();
      let bracketed = false;
      if (expTok && expTok.t === "(") {
        bracketed = true;
        expTok = this.next();
      }
      if (!expTok || expTok.t !== "num") throw new Error("exponent must be a whole number");
      if (bracketed) this.expect(")");
      const e = Number(expTok.v);
      if (!Number.isInteger(e) || e < 0 || e > 6) throw new Error("exponent out of range");
      let out = polyConst(R1);
      for (let i = 0; i < e; i++) out = polyMul(out, base);
      base = out;
    }
    return base;
  }
  parseAtom() {
    const tok = this.next();
    if (!tok) throw new Error("unexpected end of input");
    if (tok.t === "num") return polyConst(decimalToRat(tok.v));
    if (tok.t === "id") return polyVar(tok.v);
    if (tok.t === "(") {
      const inner = this.parseExpr();
      this.expect(")");
      return inner;
    }
    throw new Error(`unexpected token ${tok.t}${tok.v ? " " + tok.v : ""}`);
  }
}

/** Parse an expression to canonical polynomial form. Throws on anything it cannot read. */
export function parseExpr(src) {
  const p = new Parser(tokenize(src));
  const out = p.parseExpr();
  if (p.peek()) throw new Error(`trailing input in "${src}"`);
  return out;
}

/**
 * Parse a statement: an expression, an equation or a relation.
 * Returns { kind:"expr", poly } | { kind:"rel", rel, left, right }.
 */
export function parseStatement(src) {
  const toks = tokenize(src);
  const relIdx = toks.findIndex((t) => t.t === "rel");
  if (relIdx < 0) {
    return { kind: "expr", poly: parseExprTokens(toks) };
  }
  const rel = toks[relIdx].v;
  const left = parseExprTokens(toks.slice(0, relIdx));
  const right = parseExprTokens(toks.slice(relIdx + 1));
  if (toks.slice(relIdx + 1).some((t) => t.t === "rel")) {
    // A chained equality (a + b = c = d) is itself a diagnostic, never a valid statement.
    return { kind: "chain", rel, left, right };
  }
  return { kind: "rel", rel, left, right };
}

function parseExprTokens(toks) {
  const p = new Parser(toks);
  const out = p.parseExpr();
  if (p.peek()) throw new Error("trailing input");
  return out;
}

/* ------------------------------------------------------------------ canonical answers */

/** Canonical form of a numeric response. "x = 4", "4", "4.0", "8/2", "4,0" all land here. */
export function canonNumber(src, unknown = "x") {
  const st = parseStatement(src);
  if (st.kind === "expr") {
    if (!polyIsConst(st.poly)) throw new Error("not a number");
    return rstr(polyConstValue(st.poly));
  }
  if (st.kind !== "rel" || st.rel !== "=") throw new Error("not a number");
  // Accept "x = 4" and "4 = x", but only when the named side is exactly the unknown.
  const lv = polyStr(st.left);
  const rv = polyStr(st.right);
  if (lv === `1*${unknown}` && polyIsConst(st.right)) return rstr(polyConstValue(st.right));
  if (rv === `1*${unknown}` && polyIsConst(st.left)) return rstr(polyConstValue(st.left));
  throw new Error("not a number");
}

/** Canonical form of an expression response. Order and spelling are free; value is not. */
export function canonExpr(src) {
  const st = parseStatement(src);
  if (st.kind !== "expr") throw new Error("expected a load, not a claim");
  return polyStr(st.poly);
}

/**
 * Canonical form of an equation response. `a = k*b` and `k*b = a` and `a - k*b = 0` are one claim.
 * Normalised to (left - right), then scaled so the first nonzero coefficient in canonical
 * monomial order is positive and, where the coefficients are integral, primitive.
 */
export function canonEquation(src) {
  const st = parseStatement(src);
  if (st.kind !== "rel" || st.rel !== "=") throw new Error("expected a claim with a Sill");
  let p = polySub(st.left, st.right);
  return normalizeHomogeneous(p);
}

function normalizeHomogeneous(p) {
  if (p.size === 0) return "0 = 0";
  const keys = [...p.keys()].sort((a, b) => {
    const A = monOrder(a);
    const B = monOrder(b);
    if (A.deg !== B.deg) return B.deg - A.deg;
    return A.k < B.k ? -1 : A.k > B.k ? 1 : 0;
  });
  const lead = p.get(keys[0]);
  const scaled = new Map();
  for (const [k, v] of p) scaled.set(k, rdiv(v, lead));
  return polyStr(scaled) + " = 0";
}

const FLIP = { "<": ">", ">": "<", "<=": ">=", ">=": "<=" };

/**
 * Canonical form of a threshold response: a stretch, written as unknown REL value.
 * "x > 3" and "3 < x" are the same stretch. Anything that is not a single stretch in the
 * unknown is refused, which is exactly what `single-value-for-a-set` produces.
 */
export function canonInequality(src, unknown = "x") {
  const st = parseStatement(src);
  if (st.kind !== "rel") throw new Error("expected a mark");
  if (st.rel === "=" || st.rel === "!=") throw new Error("a level claim is not a stretch");
  let rel = st.rel;
  let left = st.left;
  let right = st.right;
  // Move everything to the left, constants to the right: (left-right) REL 0
  let p = polySub(left, right);
  const coeff = p.get(unknown) || R0;
  if (coeff.n === 0) throw new Error("no socket in the mark");
  const constPart = p.get("") || R0;
  for (const k of p.keys()) {
    if (k !== unknown && k !== "") throw new Error("a Level 1 mark carries one socket only");
  }
  // coeff*x + constPart REL 0  ->  x REL' -constPart/coeff  (flip when coeff < 0)
  let value = rdiv(rneg(constPart), coeff);
  if (coeff.n < 0) rel = FLIP[rel];
  return `${unknown} ${rel} ${rstr(value)}`;
}

/** Canonical form of a pair response: "x=4; y=4" in any order and spelling. */
export function canonPair(src) {
  const parts = String(src)
    .split(/[;\n]|(?:,(?![0-9]))/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length < 2) throw new Error("two sockets, two values");
  const seen = [];
  for (const part of parts) {
    const st = parseStatement(part);
    if (st.kind !== "rel" || st.rel !== "=") throw new Error("name each socket");
    const name = polyStr(st.left);
    if (!/^1\*[a-z]$/.test(name)) throw new Error("name each socket");
    seen.push(`${name.slice(2)}=${rstr(polyConstValue(st.right))}`);
  }
  seen.sort();
  return seen.join(";");
}

/**
 * Canonical form of a partition response: groups of terms, order-free at both levels.
 * "3x, 5x | 2y | 7" == "7 | 5x, 3x | 2y".
 */
export function canonPartition(src) {
  const groups = String(src)
    .split(/[;|\n]/)
    .map((g) => g.trim())
    .filter(Boolean);
  if (!groups.length) throw new Error("empty partition");
  const canon = groups.map((g) => {
    const terms = g
      .split(/,(?![0-9])/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => canonExpr(t));
    terms.sort();
    return terms.join(",");
  });
  canon.sort();
  return canon.join("|");
}

/**
 * Every reading of a repair response, as `line|canonical`.
 *
 * A working carries claims, marks and loads in the same column, and a learner repairing line 3
 * writes whichever of those that line is. Reading the response in ONE declared kind and giving
 * up is how a right answer gets marked wrong and, worse, how a wrong one goes undiagnosed.
 */
export function canonRepairAll(src, unknown = "x") {
  const s = String(src).trim();
  const m = s.match(/^\s*(?:#\s*|line\s*|l[ií]nea\s*|linia\s*)?(\d+)\s*(.*)$/i);
  if (!m) return [];
  const line = Number(m[1]);
  const rest = m[2].replace(/^\s*[:>|=]\s*/, "").trim();
  if (!rest) return [];
  const out = [];
  const push = (fn) => {
    try {
      const v = fn();
      if (v != null && !out.includes(`${line}|${v}`)) out.push(`${line}|${v}`);
    } catch {
      /* not this reading */
    }
  };
  push(() => {
    const st = parseStatement(rest);
    if (st.kind === "chain") return "chain";
    throw new Error("not a chain");
  });
  push(() => canonEquation(rest));
  push(() => canonInequality(rest, unknown));
  push(() => canonExpr(rest));
  push(() => canonPartition(rest));
  return out;
}

/** Canonical form of a repair response: which line, and what it should read. */
export function canonRepair(src, valueKind = "equation", unknown = "x") {
  const s = String(src).trim();
  // "3: x = 5", "#3 x = 5", "line 3 = x = 5", "3 | x = 5" — the joint, then what it should read.
  const m = s.match(/^\s*(?:#\s*|line\s*|l[ií]nea\s*|linia\s*)?(\d+)\s*(.*)$/i);
  if (!m) throw new Error("a repair names the joint and what it should read");
  const line = Number(m[1]);
  const rest = m[2].replace(/^\s*[:>|=]\s*/, "").trim();
  if (!rest) throw new Error("a repair names the joint and what it should read");
  const value =
    valueKind === "equation"
      ? canonEquation(rest)
      : valueKind === "inequality"
        ? canonInequality(rest, unknown)
        : valueKind === "partition"
          ? canonPartition(rest)
          : canonExpr(rest);
  return `${line}|${value}`;
}

/* ------------------------------------------------------------------ surface reading */

/**
 * The terms of a response AS WRITTEN, before anything gathers. Two responses can carry the
 * same value and still be different acts: `4 + 3x + 6` is the same load as `3x + 10` and it is
 * not gathered, which is the whole content of `stops-before-fully-simplified`. Canonical
 * equality cannot see that, so this reads the surface instead.
 */
export function surfaceTerms(src) {
  const toks = tokenize(src);
  const out = [];
  let depth = 0;
  let cur = [];
  let sign = 1;
  const flush = () => {
    if (cur.length) out.push({ sign, poly: parseExprTokens(cur) });
    cur = [];
  };
  for (const t of toks) {
    if (t.t === "(") depth++;
    if (t.t === ")") depth--;
    if (depth === 0 && t.t === "op" && (t.v === "+" || t.v === "-") && cur.length) {
      flush();
      sign = t.v === "-" ? -1 : 1;
      continue;
    }
    if (depth === 0 && t.t === "op" && (t.v === "+" || t.v === "-") && !cur.length) {
      sign *= t.v === "-" ? -1 : 1;
      continue;
    }
    cur.push(t);
  }
  flush();
  return out.map((t) => (t.sign === 1 ? t.poly : polyNeg(t.poly)));
}

/** True when no two written terms carry the same monomial and nothing is still bundled. */
export function isGathered(src) {
  if (/[()]/.test(normalizeSource(src))) return false;
  const terms = surfaceTerms(src);
  const seen = new Set();
  for (const t of terms) {
    if (t.size > 1) return false;
    const k = t.size === 0 ? "" : [...t.keys()][0];
    if (seen.has(k)) return false;
    seen.add(k);
  }
  return true;
}

/** Solve a linear claim for `unknown`. Returns a rational, "always", "none", or null. */
export function solveLinear(left, right, unknown = "x") {
  const p = polySub(left, right);
  for (const k of p.keys()) {
    if (k !== "" && k !== unknown) return null; // not linear in the one unknown
  }
  const a = p.get(unknown) || R0;
  const b = p.get("") || R0;
  if (a.n === 0) return b.n === 0 ? "always" : "none";
  return rdiv(rneg(b), a);
}

/* ------------------------------------------------------------------ TeX builders */

export const texMul = (a, b) => `${a} \\cdot ${b}`;

/** `k` and `x` -> "3x"; 1 and x -> "x"; -1 and x -> "-x". */
export function texCoefVar(k, v, power = 1) {
  const vv = power === 1 ? v : `${v}^{${power}}`;
  if (k === 1) return vv;
  if (k === -1) return `-${vv}`;
  return `${k}${vv}`;
}

/** Signed continuation: 5 -> " + 5"; -5 -> " - 5". */
export function texAdd(n, body = null) {
  const b = body === null ? String(Math.abs(n)) : body;
  return n < 0 ? ` - ${b}` : ` + ${b}`;
}

/** ax + b, printed the way a person writes it. b === 0 prints nothing. */
export function texLinear(a, b, v = "x") {
  let out = texCoefVar(a, v);
  if (b !== 0) out += texAdd(b);
  return out;
}

/** Deterministic seeded RNG. Same seed, same bank, on every machine, forever (G4). */
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

export function pick(rand, arr) {
  return arr[Math.floor(rand() * arr.length) % arr.length];
}

export function intIn(rand, lo, hi) {
  return lo + Math.floor(rand() * (hi - lo + 1));
}
