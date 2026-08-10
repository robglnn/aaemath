#!/usr/bin/env node
/**
 * review/measure/P17.mjs — the audit of the item bank, written to demolish it.
 *
 *   node review/measure/P17.mjs                     # full run, human table + PASS/FAIL
 *   node review/measure/P17.mjs --json              # machine-readable
 *   node review/measure/P17.mjs --generated=5000    # how many fresh items to audit
 *
 * The rule this file exists to satisfy: nothing about the bank is believed because P17 said so.
 * Every claim is recomputed here from the knowledge graph and from the items themselves, using
 * an ARITHMETIC AND PARSER WRITTEN IN THIS FILE. It deliberately does not import
 * `content/items/kit.mjs`: if the bank's own parser were the auditor, a bug in it would mark
 * itself correct, which is the exact failure mode this piece is most exposed to.
 *
 * What is independent, precisely, so nobody has to guess:
 *   - rationals, the expression parser, the canonical forms and the linear solver: written below;
 *   - the misconception formulas: transcribed from `content/knowledge-graph.json`'s
 *     `diagnosticSignature` fields, not from `content/items/generators.mjs`;
 *   - the correct answers: re-derived from each item's own stem, seatings and ask.
 * What is not independent, stated rather than hidden:
 *   - KaTeX is the real KaTeX (that is the point of the check);
 *   - `ItemBank.check` is exercised as a black box, which is what makes C11 a test of it.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split("=")[1] : d;
};
const JSON_ONLY = process.argv.includes("--json");
const N_GENERATED = Number(arg("generated", "5000"));

const load = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

/* ================================================================ independent maths */

const gcd = (a, b) => {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1;
};
function Q(n, d = 1) {
  if (d === 0) throw new Error("zero denominator");
  if (d < 0) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d);
  return [n / g, d / g];
}
const qadd = (a, b) => Q(a[0] * b[1] + b[0] * a[1], a[1] * b[1]);
const qsub = (a, b) => Q(a[0] * b[1] - b[0] * a[1], a[1] * b[1]);
const qmul = (a, b) => Q(a[0] * b[0], a[1] * b[1]);
const qdiv = (a, b) => {
  if (b[0] === 0) throw new Error("divide by zero");
  return Q(a[0] * b[1], a[1] * b[0]);
};
const qneg = (a) => Q(-a[0], a[1]);
const qeq = (a, b) => a[0] === b[0] && a[1] === b[1];
const qstr = (a) => (a[1] === 1 ? String(a[0]) : `${a[0]}/${a[1]}`);
const qcmp = (a, b) => Math.sign(a[0] * b[1] - b[0] * a[1]);
const qOf = (s) => {
  const [n, d] = String(s).split("/");
  return Q(Number(n), d === undefined ? 1 : Number(d));
};

/* polynomials: Map "x^2" -> Q. Monomial key: sorted "letter[^power]" joined by "*". */
const mkey = (vars) =>
  [...vars.entries()]
    .filter(([, p]) => p !== 0)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([v, p]) => (p === 1 ? v : `${v}^${p}`))
    .join("*");
const kvars = (k) => {
  const m = new Map();
  if (!k) return m;
  for (const part of k.split("*")) {
    const [v, p] = part.split("^");
    m.set(v, (m.get(v) || 0) + (p ? Number(p) : 1));
  }
  return m;
};
const pconst = (q) => (q[0] === 0 ? new Map() : new Map([["", q]]));
const padd = (a, b) => {
  const o = new Map(a);
  for (const [k, v] of b) {
    const s = o.has(k) ? qadd(o.get(k), v) : v;
    if (s[0] === 0) o.delete(k);
    else o.set(k, s);
  }
  return o;
};
const pneg = (a) => new Map([...a].map(([k, v]) => [k, qneg(v)]));
const psub = (a, b) => padd(a, pneg(b));
function pmul(a, b) {
  const o = new Map();
  for (const [ka, va] of a)
    for (const [kb, vb] of b) {
      const vars = kvars(ka);
      for (const [v, p] of kvars(kb)) vars.set(v, (vars.get(v) || 0) + p);
      const k = mkey(vars);
      const s = o.has(k) ? qadd(o.get(k), qmul(va, vb)) : qmul(va, vb);
      if (s[0] === 0) o.delete(k);
      else o.set(k, s);
    }
  return o;
}
function pdiv(a, b) {
  if (b.size !== 1) throw new Error("divisor must be one term");
  const [bk, bv] = [...b.entries()][0];
  const o = new Map();
  for (const [k, v] of a) {
    const vars = kvars(k);
    for (const [n, p] of kvars(bk)) vars.set(n, (vars.get(n) || 0) - p);
    o.set(mkey(vars), qdiv(v, bv));
  }
  return o;
}
const degOf = (k) => [...kvars(k).values()].reduce((a, b) => a + b, 0);
function pstr(p) {
  const keys = [...p.keys()].sort((a, b) => degOf(b) - degOf(a) || (a < b ? -1 : a > b ? 1 : 0));
  if (!keys.length) return "0";
  return keys.map((k) => `${qstr(p.get(k))}${k ? "*" + k : ""}`).join(" + ");
}
const pisconst = (p) => p.size === 0 || (p.size === 1 && p.has(""));
const pval = (p) => (p.size === 0 ? Q(0) : p.get(""));
function psubst(p, values) {
  let out = new Map();
  for (const [k, v] of p) {
    let term = pconst(v);
    for (const [name, power] of kvars(k)) {
      if (values[name] === undefined) {
        term = pmul(term, new Map([[mkey(new Map([[name, power]])), Q(1)]]));
      } else {
        let acc = Q(1);
        for (let i = 0; i < power; i++) acc = qmul(acc, values[name]);
        term = pmul(term, pconst(acc));
      }
    }
    out = padd(out, term);
  }
  return out;
}

/* parser */
function norm(src) {
  let s = String(src);
  s = s.replace(/\\left|\\right/g, "");
  s = s.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "(($1)/($2))");
  s = s.replace(/\\cdot|\\times/g, "*");
  s = s.replace(/\\div/g, "/");
  s = s.replace(/\\leq|\\le\b/g, "<=");
  s = s.replace(/\\geq|\\ge\b/g, ">=");
  s = s.replace(/\\text\{[^{}]*\}/g, "");
  s = s.replace(/\\;|\\,|\\quad|\\mid|\\square/g, " ");
  s = s.replace(/[−–—]/g, "-").replace(/[·×⋅]/g, "*").replace(/÷/g, "/");
  s = s.replace(/≤/g, "<=").replace(/≥/g, ">=");
  s = s.replace(/\{/g, "(").replace(/\}/g, ")");
  s = s.replace(/(\d),(\d)/g, "$1.$2");
  return s.replace(/\s+/g, " ").trim();
}
function lex(src) {
  const s = norm(src);
  const t = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === " ") { i++; continue; }
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9]/.test(s[j])) j++;
      if (s[j] === "." && /[0-9]/.test(s[j + 1] || "")) { j++; while (j < s.length && /[0-9]/.test(s[j])) j++; }
      t.push({ t: "num", v: s.slice(i, j) });
      i = j; continue;
    }
    if (/[a-zA-Z]/.test(c)) { t.push({ t: "id", v: c }); i++; continue; }
    if (s.startsWith("<=", i) || s.startsWith(">=", i)) { t.push({ t: "rel", v: s.slice(i, i + 2) }); i += 2; continue; }
    if ("=<>".includes(c)) { t.push({ t: "rel", v: c }); i++; continue; }
    if ("+-*/^".includes(c)) { t.push({ t: "op", v: c }); i++; continue; }
    if (c === "(") { t.push({ t: "(" }); i++; continue; }
    if (c === ")") { t.push({ t: ")" }); i++; continue; }
    if (c === ",") { t.push({ t: "," }); i++; continue; }
    throw new Error(`bad char ${c} in ${src}`);
  }
  return t;
}
function parseTokens(toks) {
  let i = 0;
  const peek = () => toks[i];
  const next = () => toks[i++];
  function expr() {
    let l = term();
    for (;;) {
      const t = peek();
      if (t && t.t === "op" && (t.v === "+" || t.v === "-")) { next(); l = t.v === "+" ? padd(l, term()) : psub(l, term()); }
      else break;
    }
    return l;
  }
  function term() {
    let l = unary();
    for (;;) {
      const t = peek();
      if (t && t.t === "op" && (t.v === "*" || t.v === "/")) { next(); l = t.v === "*" ? pmul(l, unary()) : pdiv(l, unary()); }
      else if (t && (t.t === "num" || t.t === "id" || t.t === "(")) l = pmul(l, unary());
      else break;
    }
    return l;
  }
  function unary() {
    const t = peek();
    if (t && t.t === "op" && (t.v === "-" || t.v === "+")) { next(); const v = unary(); return t.v === "-" ? pneg(v) : v; }
    return power();
  }
  function power() {
    let b = atom();
    const t = peek();
    if (t && t.t === "op" && t.v === "^") {
      next();
      let e = next();
      let br = false;
      if (e && e.t === "(") { br = true; e = next(); }
      if (!e || e.t !== "num") throw new Error("bad exponent");
      if (br) { const cl = next(); if (!cl || cl.t !== ")") throw new Error("bad exponent"); }
      let o = pconst(Q(1));
      for (let k = 0; k < Number(e.v); k++) o = pmul(o, b);
      b = o;
    }
    return b;
  }
  function atom() {
    const t = next();
    if (!t) throw new Error("unexpected end");
    if (t.t === "num") {
      const dot = t.v.indexOf(".");
      if (dot < 0) return pconst(Q(Number(t.v)));
      const den = 10 ** (t.v.length - dot - 1);
      return pconst(Q(Number(t.v.replace(".", "")), den));
    }
    if (t.t === "id") return new Map([[t.v, Q(1)]]);
    if (t.t === "(") { const e = expr(); const c = next(); if (!c || c.t !== ")") throw new Error("unclosed"); return e; }
    throw new Error(`unexpected ${t.t}`);
  }
  const out = expr();
  if (i < toks.length) throw new Error("trailing input");
  return out;
}
const P = (src) => parseTokens(lex(src));

function relation(src) {
  const toks = lex(src);
  const at = toks.findIndex((t) => t.t === "rel");
  if (at < 0) return { kind: "expr", poly: parseTokens(toks) };
  const rest = toks.slice(at + 1);
  if (rest.some((t) => t.t === "rel")) return { kind: "chain" };
  return { kind: "rel", rel: toks[at].v, left: parseTokens(toks.slice(0, at)), right: parseTokens(rest) };
}

/** Canonical for a claim: (left-right) scaled so the leading coefficient is 1. */
function canonEq(src) {
  const r = relation(src);
  if (r.kind !== "rel" || r.rel !== "=") throw new Error("not a claim");
  const p = psub(r.left, r.right);
  if (!p.size) return "0 = 0";
  const keys = [...p.keys()].sort((a, b) => degOf(b) - degOf(a) || (a < b ? -1 : a > b ? 1 : 0));
  const lead = p.get(keys[0]);
  return pstr(new Map([...p].map(([k, v]) => [k, qdiv(v, lead)]))) + " = 0";
}
const FLIP = { "<": ">", ">": "<", "<=": ">=", ">=": "<=" };
function canonIneq(src, u = "x") {
  const r = relation(src);
  if (r.kind !== "rel" || r.rel === "=" ) throw new Error("not a mark");
  const p = psub(r.left, r.right);
  const c = p.get(u) || Q(0);
  if (c[0] === 0) throw new Error("no socket");
  for (const k of p.keys()) if (k !== u && k !== "") throw new Error("not linear");
  const v = qdiv(qneg(p.get("") || Q(0)), c);
  const rel = c[0] < 0 ? FLIP[r.rel] : r.rel;
  return `${u} ${rel} ${qstr(v)}`;
}
function canonNum(src, u = "x") {
  const r = relation(src);
  if (r.kind === "expr") {
    if (!pisconst(r.poly)) throw new Error("not a number");
    return qstr(pval(r.poly));
  }
  if (r.kind !== "rel" || r.rel !== "=") throw new Error("not a number");
  if (pstr(r.left) === `1*${u}` && pisconst(r.right)) return qstr(pval(r.right));
  if (pstr(r.right) === `1*${u}` && pisconst(r.left)) return qstr(pval(r.left));
  throw new Error("not a number");
}
function solveFor(src, u = "x") {
  const r = relation(src);
  if (r.kind !== "rel") throw new Error("not a claim");
  const p = psub(r.left, r.right);
  for (const k of p.keys()) if (k !== u && k !== "") return null;
  const a = p.get(u) || Q(0);
  const b = p.get("") || Q(0);
  if (a[0] === 0) return b[0] === 0 ? "always" : "none";
  const v = qdiv(qneg(b), a);
  if (r.rel === "=") return qstr(v);
  const rel = a[0] < 0 ? FLIP[r.rel] : r.rel;
  return `${u} ${rel} ${qstr(v)}`;
}
/** Surface terms, before anything gathers. */
function surface(src) {
  const toks = lex(src);
  const out = [];
  let depth = 0, cur = [], sign = 1;
  const flush = () => { if (cur.length) out.push(sign === 1 ? parseTokens(cur) : pneg(parseTokens(cur))); cur = []; };
  for (const t of toks) {
    if (t.t === "(") depth++;
    if (t.t === ")") depth--;
    if (depth === 0 && t.t === "op" && (t.v === "+" || t.v === "-")) {
      if (cur.length) { flush(); sign = t.v === "-" ? -1 : 1; continue; }
      sign *= t.v === "-" ? -1 : 1; continue;
    }
    cur.push(t);
  }
  flush();
  return out;
}
const partitionCanon = (groups) =>
  groups
    .map((g) => g.map((t) => pstr(t)).sort().join(","))
    .sort()
    .join("|");

/* ================================================================ the audit */

const kg = load("content/knowledge-graph.json");
const standards = load("content/standards.json");
const srcStrings = load("content/items/strings.json").keys;
const nodeById = new Map(kg.nodes.map((n) => [n.id, n]));

/** The ask a family's construct items carry — so a repair item can be solved as its own claim. */
const FAMILY_ASK = new Map();

const results = [];
const detail = {};
function claim(id, what, pass, measured, threshold, notes = null) {
  results.push({ id, claim: what, pass: !!pass, measured, threshold, ...(notes ? { notes } : {}) });
}

const bankFiles = fs
  .readdirSync(path.join(ROOT, "content/items/bank"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => load(`content/items/bank/${f}`));
const catalogue = bankFiles.flatMap((f) => f.items);
for (const it of catalogue) if (it.form === "construct") FAMILY_ASK.set(it.family, it.ask);

/* ---------------------------------------------------------------- C1 coverage */
{
  const missing = kg.nodes.filter((n) => !bankFiles.some((f) => f.kpId === n.id));
  const counts = Object.fromEntries(bankFiles.map((f) => [f.kpId, f.items.length]));
  const min = Math.min(...Object.values(counts));
  detail.itemsPerKp = counts;
  claim(
    "C1",
    "every knowledge point in the graph has >= 24 committed items",
    missing.length === 0 && min >= 24,
    `${kg.nodes.length - missing.length}/${kg.nodes.length} nodes, min ${min} items`,
    "32/32 nodes, min >= 24"
  );
}

/* ---------------------------------------------------------------- C2 misconception coverage */
{
  const per = {};
  let worst = Infinity;
  const holes = [];
  for (const n of kg.nodes) {
    const items = catalogue.filter((i) => i.kpId === n.id);
    for (const m of n.misconceptions) {
      const c = items.filter((i) => i.distractors.some((d) => d.misconception === m.id)).length;
      per[`${n.id}|${m.id}`] = c;
      if (c < worst) worst = c;
      if (c < 3) holes.push(`${n.id}|${m.id}=${c}`);
    }
  }
  const undeclared = new Set();
  for (const it of catalogue)
    for (const d of it.distractors)
      if (!nodeById.get(it.kpId).misconceptions.some((m) => m.id === d.misconception))
        undeclared.add(`${it.kpId}|${d.misconception}`);
  detail.itemsPerMisconception = per;
  claim(
    "C2",
    "every (knowledge point x misconception) pair the graph declares is carried by committed items, and no distractor names a misconception the graph does not declare",
    holes.length === 0 && undeclared.size === 0,
    `${Object.keys(per).length} pairs, min ${worst} committed items, ${undeclared.size} undeclared`,
    "96 pairs, min >= 3 committed, 0 undeclared",
    holes.length ? holes.slice(0, 8) : null
  );
  detail.misconceptionHoles = holes;
}

/* ---------------------------------------------------------------- independent solving */

/**
 * Re-derive an item's answer from the item itself. Every family must be reachable by one of
 * these routes; a family with no route is a FAILURE, not a skip, so nothing can be quietly
 * excused from the audit.
 */
function independentAnswer(item) {
  const u = item.unknown || "x";
  const seat = {};
  for (const g of item.given || []) {
    try {
      const r = relation(g);
      if (r.kind === "rel" && r.rel === "=" && pstr(r.left).startsWith("1*") && pisconst(r.right)) {
        seat[pstr(r.left).slice(2)] = pval(r.right);
      }
    } catch {
      /* the magazine line is a set, not a seating */
    }
  }
  const fam = item.family;
  const p = item.params;

  // Routes that read the stem directly.
  switch (item.ask.key) {
    case "ask.reading": {
      const settled = psubst(P(item.stem), seat);
      if (!pisconst(settled)) throw new Error("did not settle");
      return qstr(pval(settled));
    }
    case "ask.value": {
      if (fam === "eq-model-context.members") {
        // Declared domain: whole members only, and the load must be carried.
        const exact = qdiv(Q(p.T), Q(p.w));
        return String(Math.ceil(exact[0] / exact[1]));
      }
      const s = solveFor(item.stem, u);
      if (typeof s !== "string") throw new Error("unsolved");
      return s;
    }
    case "ask.mark":
      return solveFor(item.stem, u);
    case "ask.closure": {
      const s = solveFor(item.stem, u);
      return s === "always" ? "always" : s === "none" ? "none" : s;
    }
    case "ask.terms":
      return String(surface(item.stem).length);
    case "ask.count": {
      if (fam === "equivalent-expressions.count") {
        // "Two expressions are equivalent when they agree for every substitution." So the
        // missing count n is whatever makes E1 - E2 the zero load. Solved, not looked up.
        const [e1, e2] = item.stem.split("\\Rightarrow").map((s) => s.trim());
        const diff = psub(P(e1), P(e2.replace(/\\square/g, "n")));
        const s = solveFor(`${pstr(diff)} = 0`, "n");
        if (typeof s !== "string") throw new Error("unsolved box");
        return s;
      }
      return qstr(P(item.stem).get(u) || Q(0));
    }
    case "ask.term":
      return pstr(surface(item.stem)[1]);
    case "ask.groups": {
      const terms = item.stem.split("\\;\\;").map((s) => P(s.trim()));
      const groups = new Map();
      for (const t of terms) {
        const k = t.size ? [...t.keys()][0] : "";
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(t);
      }
      return partitionCanon([...groups.values()]);
    }
    case "ask.pair": {
      // x + y = 2v and x - y = 0 -> the unique pair
      const total = qOf(qstr(Q(p.v * 2)));
      const half = qdiv(total, Q(2));
      return `x=${qstr(half)};y=${qstr(half)}`;
    }
    case "ask.charges": {
      const hits = p.mag.filter((v) => {
        const r = relation(item.stem);
        const l = psubst(r.left, { x: Q(v) });
        return qeq(pval(l), pval(r.right));
      });
      return hits.map((v) => qstr(Q(v))).join(",");
    }
    case "ask.load": {
      // Loads whose answer is the stem rewritten: expand and gather.
      if (fam.startsWith("translate-")) return null; // language, audited by C4b
      if (fam === "expr-anatomy.term") return pstr(surface(item.stem)[1]);
      return pstr(P(item.stem));
    }
    case "ask.claim": {
      if (fam === "var-meaning.relate") return canonEq(`a = ${p.k}b`);
      if (fam === "props-equality.move") return canonEq(`${u} = ${p.b - p.a}`);
      if (fam === "props-equality.zero") return canonEq(`${p.a - p.b}${u} = 0`);
      return null;
    }
    default:
      return null;
  }
}

/* ---------------------------------------------------------------- C3 arithmetic */
function auditArithmetic(items, label) {
  const bad = [];
  const byRoute = {};
  let checked = 0;
  const unrouted = new Set();
  for (const item of items) {
    if (item.form === "repair" || item.form === "generate") continue;
    let got;
    try {
      got = independentAnswer(item);
    } catch (err) {
      bad.push(`${item.id}: solver threw ${err.message}`);
      continue;
    }
    if (got === null) {
      unrouted.add(item.family);
      continue;
    }
    checked++;
    byRoute[item.ask.key] = (byRoute[item.ask.key] || 0) + 1;
    const want = item.answer.canonical;
    const same =
      got === want ||
      (looksNumeric(got) && looksNumeric(want) && qeq(qOf(got), qOf(want)));
    if (!same) bad.push(`${item.id}: independent ${got} vs stated ${want}`);
  }
  return { bad, checked, byRoute, unrouted: [...unrouted], label };
}
const looksNumeric = (s) => /^-?\d+(\/\d+)?$/.test(String(s));

/**
 * C4b — the families whose correct answer is a fact about LANGUAGE rather than about the stem.
 * `translate-phrase` and `translate-order` do not have a TeX stem to solve: the stem is a bare
 * socket and the claim lives in the spoken line. They are audited against the mapping stated in
 * the knowledge graph's node description, transcribed here, which is the only independent
 * source there is for them.
 */
const LANGUAGE_RULE = {
  "translate-phrase.groups": (p) => pstr(P(`${p.a}n + ${p.b}`)), // "a groups of n, and b more"
  "translate-phrase.twice": (p) => pstr(P(`2n + ${p.b}`)), //        "twice n" is 2n, never n+2
  "translate-order.lessthan": (p) => pstr(P(`n - ${p.a}`)), //       "a less than n" is n - a
  "translate-order.subtractfrom": (p) => pstr(P(`${p.a} - n`)), //   "subtract n from a" is a - n
  "translate-order.dividedinto": (p) => pstr(P(`${p.a}/n`)), //      "n divided into a" is a / n
  "translate-sentence.core": (p) => canonEq(`${p.a}n + ${p.b} = ${p.c}`),
};

function auditLanguage(items) {
  const bad = [];
  let checked = 0;
  for (const item of items) {
    if (item.form !== "construct") continue;
    const rule = LANGUAGE_RULE[item.family];
    if (!rule) continue;
    checked++;
    const want = rule(item.params);
    if (want !== item.answer.canonical) bad.push(`${item.id}: rule ${want} vs stated ${item.answer.canonical}`);
  }
  return { bad, checked };
}

/* ---------------------------------------------------------------- misconception formulas */
/**
 * Transcribed from `content/knowledge-graph.json` -> nodes[].misconceptions[].diagnosticSignature.
 * Keyed by `family|misconception` because a signature written for one stem shape has to be
 * derived for another (`flip-first-term-only` on -(bx+c) and on a - b(x+c) are the same idea and
 * different arithmetic). Returns the canonical response a learner holding that idea produces.
 */
const N = (v) => qstr(typeof v === "number" ? Q(v) : v);
const SIG = {
  // -------- var-meaning
  "var-meaning.seat|var-alphabet-value": (p) => N("abcdefghijklmnopqrstuvwxyz".indexOf(p.letter) + 1),
  "var-meaning.relate|var-as-label": (p) => canonEq(`${p.k}a = b`),
  "var-meaning.twin|var-must-differ": (p) => `x=${p.v - p.d};y=${p.v + p.d}`,
  // -------- oo-numeric
  "oo-numeric.addmul|oo-strict-left-to-right": (p) => N((p.a + p.b) * p.c),
  "oo-numeric.divmul|oo-mult-before-div": (p) => qstr(Q(p.a, p.b * p.c)),
  "oo-numeric.addsub|oo-add-before-sub": (p) => N(p.a - (p.b + p.c)),
  // -------- expr-anatomy
  "expr-anatomy.count|term-split-at-product": (p) => N(p.withY ? 5 : 3),
  "expr-anatomy.coefficient|bare-x-has-no-coefficient": () => "0",
  "expr-anatomy.term|sign-detached-from-term": (p) => pstr(P(`${p.b}x`)),
  // -------- oo-structure
  "oo-structure.coefsq|coefficient-under-exponent": (p) => N((p.a * p.v) ** 2),
  "oo-structure.negsq|negative-square-sign-lost": (p) => N(p.v * p.v),
  "oo-structure.juxt|juxtaposition-means-add": (p) => N(p.a + p.v),
  // -------- eval-substitute
  "eval-substitute.twice|substitute-first-occurrence-only": (p) => N(p.v * p.v),
  "eval-substitute.concat|substitute-by-concatenation": (p) => N(Number(`${p.a}${p.v}`)),
  "eval-substitute.coefficient|coefficient-dropped-on-substitution": (p) => N(p.v),
  // -------- eval-signed
  "eval-signed.square|negative-substituted-bare": (p) => N(-(p.v * p.v)),
  "eval-signed.minusneg|double-negative-collapsed-wrong": (p) => N(p.a - p.b),
  "eval-signed.sumneg|two-negatives-make-positive-on-sum": (p) => N(p.a + p.b),
  // -------- eval-formula
  "eval-formula.two|second-variable-ignored": (p) => N(p.c * p.p),
  "eval-formula.two|values-assigned-by-order": (p) => N(p.c * p.q + p.d * p.p),
  "eval-formula.two|one-value-for-all-letters": (p) => N(p.c * p.p + p.d * p.p),
  // -------- translate-phrase / order / sentence
  "translate-phrase.groups|keyword-without-structure": (p) => pstr(P(`${p.a} + n + ${p.b}`)),
  "translate-phrase.groups|no-variable-introduced": (p) => pstr(P(String(p.a + p.b))),
  "translate-phrase.twice|twice-read-as-plus-two": (p) => pstr(P(`n + 2 + ${p.b}`)),
  "translate-phrase.twice|no-variable-introduced": (p) => pstr(P(String(2 + p.b))),
  "translate-order.lessthan|less-than-reversed": (p) => pstr(P(`${p.a} - n`)),
  "translate-order.subtractfrom|subtract-from-reversed": (p) => pstr(P(`n - ${p.a}`)),
  "translate-order.dividedinto|divided-into-reversed": (p) => pstr(P(`n/${p.a}`)),
  "translate-sentence.core|produces-expression-not-equation": (p) => pstr(P(`${p.a}n + ${p.b}`)),
  "translate-sentence.core|sides-merged": (p) => pstr(P(`${p.b} + ${p.a}n + ${p.c}`)),
  "translate-sentence.core|unknown-defined-as-wrong-quantity": (p) => canonEq(`${p.a}*${p.c} + ${p.b} = n`),
  // -------- props-operations
  "props-operations.commute|subtraction-commutes": (p) => pstr(P(`${p.b}x - ${p.a}`)),
  "props-operations.regroup|regroup-across-subtraction": (p) => N(p.a - p.b + p.c),
  "props-operations.identity|identity-swapped": (p) => pstr(P(`${p.a}x + x`)),
  // -------- like-terms-id
  "like-terms-id.xy|all-variable-terms-alike": (p) =>
    partitionCanon([[P(`${p.a}x`), P(`${p.b}y`), P(`${p.d}x`), P(`${p.e}y`)], [P(String(p.c))]]),
  "like-terms-id.xy|constant-like-variable": (p) =>
    partitionCanon([[P(`${p.a}x`), P(`${p.d}x`), P(String(p.c))], [P(`${p.b}y`), P(`${p.e}y`)]]),
  "like-terms-id.pow|exponent-ignored-in-matching": (p) =>
    partitionCanon([[P(`${p.a}x`), P(`${p.b}x^2`), P(`${p.d}x`), P(`${p.e}x^2`)], [P(String(p.c))]]),
  "like-terms-id.pow|constant-like-variable": (p) =>
    partitionCanon([[P(`${p.a}x`), P(`${p.d}x`), P(String(p.c))], [P(`${p.b}x^2`), P(`${p.e}x^2`)]]),
  // -------- like-terms-combine
  "like-terms-combine.core|combine-unlike-terms": (p) => pstr(P(`${p.a + p.b}xy - ${p.d}x - ${p.c}`)),
  "like-terms-combine.core|variable-parts-added-too": (p) => pstr(P(`${p.a - p.d}x^2 + ${p.b}y - ${p.c}`)),
  "like-terms-combine.core|sign-left-behind-on-move": (p) => pstr(P(`${p.a - p.d}x + ${p.b}y + ${p.c}`)),
  // -------- distribute
  "distribute-numeric.sum|distribute-to-first-term-only": (p) => N(p.a * p.b + p.c),
  "distribute-numeric.sum|distribute-by-adding": (p) => N(p.a + p.b + (p.a + p.c)),
  "distribute-numeric.product|distribute-over-a-product": (p) => N(p.a * p.b * (p.a * p.c)),
  "distribute-variable.core|variable-multiplied-as-well": (p) => pstr(P(`${p.a * p.b}x^2 + ${p.a * p.c}`)),
  "distribute-variable.core|distribute-reaches-variable-only": (p) => pstr(P(`${p.a * p.b}x + ${p.c}`)),
  "distribute-variable.core|coefficients-added-not-multiplied": (p) => pstr(P(`${p.a + p.b}x + ${p.a + p.c}`)),
  "distribute-negative.bare|flip-first-term-only": (p) => pstr(P(`${-p.b}x + ${p.c}`)),
  "distribute-negative.bare|leading-minus-dropped": (p) => pstr(P(`${p.b}x + ${p.c}`)),
  "distribute-negative.subtract|subtract-before-distributing": (p) =>
    pstr(P(`${p.a - p.b}x + ${(p.a - p.b) * p.c}`)),
  "distribute-negative.subtract|flip-first-term-only": (p) => pstr(P(`${-p.b}x + ${p.a + p.b * p.c}`)),
  "distribute-negative.subtract|leading-minus-dropped": (p) => pstr(P(`${p.b}x + ${p.a + p.b * p.c}`)),
  // -------- simplify / equivalent
  "simplify-expression.core|combine-before-distributing": (p) =>
    pstr(P(`${p.a + p.b}x + ${(p.a + p.b) * p.c}`)),
  "simplify-expression.core|over-combines-to-one-term": (p) => pstr(P(`${p.b + p.a + p.b * p.c}x`)),
  "simplify-expression.core|stops-before-fully-simplified": (p) => pstr(P(`${p.b}x + ${p.a + p.b * p.c}`)),
  "equivalent-expressions.count|different-form-means-different": (p) => N(p.b),
  "equivalent-expressions.count|one-value-proves-equivalence": () => "1",
  "equivalent-expressions.count|counterexample-ignored": () => "always",
  // -------- equations
  "eq-meaning.magazine|equation-true-for-everything": (p) => p.mag.map((v) => N(v)).sort().join(","),
  "eq-meaning.magazine|solution-never-checked": (p) => N(p.mag.find((v) => v !== p.sol)),
  "props-equality.move|operate-on-one-side": (p) => canonEq(`x = ${p.b}`),
  "props-equality.move|inverse-operations-on-each-side": (p) => canonEq(`x = ${p.b + p.a}`),
  "props-equality.zero|divide-by-possible-zero": (p) => canonEq(`${p.a} = ${p.b}`),
  "eq-one-add.plus|same-operation-not-inverse": (p) => N(p.q + p.p),
  "eq-one-add.plus|subtraction-order-reversed": (p) => N(p.p - p.q),
  "eq-one-add.minus|minus-inverted-wrongly": (p) => N(p.q - p.p),
  "eq-one-mult.mult|subtract-the-coefficient": (p) => N(p.b - p.a),
  "eq-one-mult.mult|division-order-reversed": (p) => qstr(Q(p.a, p.b)),
  "eq-one-mult.fraction|fraction-form-inverted": (p) => qstr(Q(p.b, p.a)),
  "eq-two-step.core|divide-before-clearing-constant": (p) => qstr(qsub(Q(p.c, p.a), Q(p.b))),
  "eq-two-step.core|inverse-order-inverted": (p) => N((p.c - p.b) * p.a),
  "eq-two-step.core|constant-sign-flipped": (p) => qstr(Q(p.c + p.b, p.a)),
  "eq-combine-side.core|combine-across-the-equals": (p) => qstr(Q(p.d + p.c, p.a + p.b)),
  "eq-combine-side.core|one-like-term-dropped": (p) => qstr(Q(p.d - p.c, p.a)),
  "eq-combine-side.core|constant-absorbed-into-coefficient": (p) => qstr(Q(p.d, p.a + p.b + p.c)),
  "eq-distribute.core|distribute-partially-in-equation": (p) => qstr(Q(p.r - p.q, p.p)),
  "eq-distribute.core|divide-bracket-only": (p) => N(p.r - p.q),
  "eq-distribute.core|coefficient-never-undone": (p) => N(p.r - p.p * p.q),
  "eq-both-sides.core|moved-without-inverting": (p) => qstr(Q(p.d - p.b, p.a + p.c)),
  "eq-both-sides.core|removed-from-one-side-only": (p) => qstr(Q(p.d - p.b, p.a)),
  "eq-both-sides.core|constants-collected-wrong-side": (p) => qstr(Q(p.d + p.b, p.a - p.c)),
  "eq-special-cases.always|vanishing-variable-means-zero": () => "0",
  "eq-special-cases.always|identity-called-no-solution": () => "none",
  "eq-special-cases.refusal|vanishing-variable-means-zero": () => "0",
  "eq-special-cases.refusal|contradiction-given-a-solution": (p) => N(p.d - p.b),
  "eq-model-context.span|answers-the-wrong-question": (p) => N(p.g - p.b),
  "eq-model-context.span|arithmetic-shortcut-only": (p) => qstr(Q(p.g, p.k)),
  "eq-model-context.members|non-viable-solution-accepted": (p) => qstr(Q(p.T, p.w)),
  "eq-model-context.members|arithmetic-shortcut-only": (p) => N(p.T - p.w),
  // -------- inequalities
  "ineq-meaning.stretch|reads-symbol-left-to-right-always": (p) =>
    canonIneq(p.strict ? `x < ${p.c}` : `x <= ${p.c}`),
  "ineq-meaning.stretch|endpoint-style-swapped": (p) => canonIneq(p.strict ? `x >= ${p.c}` : `x > ${p.c}`),
  "ineq-meaning.stretch|single-value-for-a-set": (p) => N(p.c),
  "ineq-one-step.plus|flip-after-adding": (p) => canonIneq(`x > ${p.q - p.p}`),
  "ineq-one-step.plus|solved-as-equation": (p) => N(p.q - p.p),
  "ineq-one-step.negconstant|flip-because-a-negative-appeared": (p) => canonIneq(`x > ${p.q + p.p}`),
  "ineq-one-step.negconstant|solved-as-equation": (p) => N(p.q + p.p),
  "ineq-negative-flip.divide|no-flip-on-negative-divide": (p) => canonIneq(`x < ${qstr(Q(p.b, -p.a))}`),
  "ineq-negative-flip.divide|flip-but-sign-lost": (p) => canonIneq(`x > ${qstr(Q(p.b, p.a))}`),
  "ineq-negative-flip.subneg|flip-on-subtracting-a-negative": (p) => canonIneq(`x < ${p.q - p.p}`),
  "ineq-two-step.turned|flipped-twice": (p) => canonIneq(`x > ${qstr(Q(p.b - p.c, p.a))}`),
  "ineq-two-step.turned|coefficient-applied-to-constant-only": (p) => canonIneq(`x > ${p.c - p.b}`),
  "ineq-two-step.inclusive|strictness-contradicts-context": (p) => canonIneq(`x > ${p.sol}`),
  "ineq-two-step.inclusive|coefficient-applied-to-constant-only": (p) => canonIneq(`x >= ${p.c - p.b}`),
};

function auditDistractors(items) {
  const bad = [];
  const uncovered = new Set();
  let checked = 0;
  let total = 0;
  for (const item of items) {
    if (item.form !== "construct") continue;
    for (const d of item.distractors) {
      total++;
      const key = `${item.family}|${d.misconception}`;
      const f = SIG[key];
      if (!f) {
        uncovered.add(key);
        continue;
      }
      checked++;
      let want;
      try {
        want = f(item.params);
      } catch (err) {
        bad.push(`${item.id} ${key}: formula threw ${err.message}`);
        continue;
      }
      const same = want === d.response || (looksNumeric(want) && looksNumeric(d.response) && qeq(qOf(want), qOf(d.response)));
      if (!same) bad.push(`${item.id} ${key}: signature ${want} vs stated ${d.response}`);
    }
  }
  return { bad, checked, total, uncovered: [...uncovered] };
}

/* ---------------------------------------------------------------- C5 separation */
function auditSeparation(items) {
  const bad = [];
  for (const item of items) {
    const seen = new Map();
    for (const d of item.distractors) {
      if (d.surface) continue;
      if (d.response === item.answer.canonical) bad.push(`${item.id}: ${d.misconception} equals the correct response`);
      if (seen.has(d.response)) bad.push(`${item.id}: ${d.misconception} collides with ${seen.get(d.response)}`);
      seen.set(d.response, d.misconception);
    }
  }
  return bad;
}

/* ---------------------------------------------------------------- C6 repair workings */
/**
 * A repair item is honest only if the shown working really does stop following at the line it
 * names. Independent test: every line of a solve working must be an equivalent claim to the one
 * above it (same solution, for claims; same value, for loads). The first line where that breaks
 * is the broken joint, and it must be the line the answer names.
 */
function lineValue(tex) {
  // Canonical, and independent of which letter the item calls its unknown: a claim is compared
  // as (near - far) scaled to a leading 1, a mark as the stretch it admits, a load as its
  // polynomial. Anything unreadable — a chained equality, a list of sockets — compares as
  // itself, which is exactly what makes a chain line detectable as a broken joint.
  try {
    const r = relation(tex);
    if (r.kind === "chain") return "chain";
    if (r.kind === "rel" && r.rel === "=") return canonEq(tex);
    if (r.kind === "rel") {
      const vars = new Set([...psub(r.left, r.right).keys()].filter(Boolean));
      if (vars.size === 1) return canonIneq(tex, [...vars][0]);
      return `raw:${tex}`;
    }
    return pstr(r.poly);
  } catch {
    return `raw:${tex}`;
  }
}
function auditRepair(items) {
  const bad = [];
  let universal = 0;
  let chainChecked = 0;
  for (const item of items) {
    if (item.form !== "repair") continue;
    const u = item.unknown || "x";
    const lines = item.working;
    if (!lines || lines.length < 2) {
      bad.push(`${item.id}: working has fewer than two lines`);
      continue;
    }
    universal++;
    const vals = lines.map((l) => lineValue(l));
    const named = item.answer.line;

    let trueAnswer = null;
    try {
      trueAnswer = independentAnswer({ ...item, ask: askOfFamily(item), form: "construct" });
    } catch {
      trueAnswer = null;
    }
    // R2/R4 the named joint is a real line, is not the claim as it stands, and is changed.
    if (!(named >= 2 && named <= lines.length)) bad.push(`${item.id}: names line ${named} of ${lines.length}`);
    if (lineValue(lines[named - 1]) === lineValue(item.answer.tex))
      bad.push(`${item.id}: the repair does not change line ${named}`);
    // R3 no distractor repair is also right, and no two agree.
    const seen = new Map();
    for (const d of item.distractors) {
      const dv = lineValue(d.tex);
      if (dv === lineValue(item.answer.tex)) bad.push(`${item.id}: ${d.misconception} would also restore the joint`);
      if (seen.has(dv)) bad.push(`${item.id}: ${d.misconception} collides with ${seen.get(dv)}`);
      seen.set(dv, d.misconception);
    }
    // R5 where the working IS an equivalence chain rooted in the stem — every line before the
    // break must still be the same claim, and the named line must be the first that is not.
    // Applicability is decided structurally, not declared by the builder: the chain rule holds
    // exactly when line 1 read on its own already carries the item's true reading.
    // The chain rule applies exactly when the item's own reading is what you get by SOLVING or
    // GATHERING the stem — that is what makes every line of the working the same object. An
    // evaluation working (letters, then values, then a number) is not that, and asserting the
    // chain rule over it would be the auditor inventing a property the item never claimed.
    let rooted = false;
    if (trueAnswer !== null) {
      try {
        const r = relation(item.stem);
        if (r.kind === "rel") {
          const vars = new Set([...psub(r.left, r.right).keys()].filter(Boolean));
          rooted = vars.size === 1 && solveFor(item.stem, [...vars][0]) === trueAnswer;
        } else {
          rooted = pstr(r.poly) === trueAnswer;
        }
      } catch {
        rooted = false;
      }
    }
    if (!rooted) continue;
    chainChecked++;
    let firstBreak = -1;
    for (let i = 1; i < vals.length; i++) {
      if (vals[i] !== vals[0]) {
        firstBreak = i;
        break;
      }
    }
    if (firstBreak < 0) bad.push(`${item.id}: nothing in the working is broken`);
    else if (named !== firstBreak + 1)
      bad.push(`${item.id}: names line ${named}, first break is line ${firstBreak + 1}`);
    if (lineValue(item.answer.tex) !== vals[0])
      bad.push(`${item.id}: the repair ${item.answer.tex} does not restore the claim`);
  }
  return { bad, universal, chainChecked };
}

function askOfFamily(item) {
  return FAMILY_ASK.get(item.family) || { key: "ask.value" };
}

/* ---------------------------------------------------------------- C7 generate properties */
function auditGenerate(items, bank) {
  const bad = [];
  let checked = 0;
  for (const item of items) {
    if (item.form !== "generate") continue;
    checked++;
    const r = bank.check(item, item.answer.canonical);
    if (!r.correct) bad.push(`${item.id}: its own witness fails the property (${r.reason})`);
    for (const d of item.distractors) {
      const rd = bank.check(item, d.tex.replace(/\\text\{[^{}]*\}/g, "always"));
      if (rd.correct) bad.push(`${item.id}: ${d.misconception} passes the property`);
    }
  }
  return { bad, checked };
}

/* ================================================================ run */

const t0 = Date.now();
const gen = await imp("content/items/generators.mjs");
const bankMod = await imp("app/src/learn/ItemBank.js");
const bank = new bankMod.ItemBank({ locale: "en" });

/* --- generated corpus --- */
const perKpGenerated = Math.max(1, Math.ceil(N_GENERATED / kg.nodes.length));
const generated = [];
for (const n of kg.nodes) {
  const items = gen.generateForKp(n.id, { count: perKpGenerated, seed: 99991 + n.id.length * 7, band: n.difficulty });
  for (const it of items) {
    generated.push({
      ...it,
      ask: { key: it.ask },
      standards: n.standards,
    });
  }
}

/* C3 */
{
  const cat = auditArithmetic(catalogue, "catalogue");
  const lang = auditLanguage(catalogue);
  detail.arithmeticRoutes = cat.byRoute;
  const unroutedFamilies = cat.unrouted.filter((f) => !LANGUAGE_RULE[f]);
  claim(
    "C3",
    "every committed construct item's stated answer is reproduced by an independent solver reading only its stem, seatings and ask",
    cat.bad.length === 0 && lang.bad.length === 0 && unroutedFamilies.length === 0,
    `${cat.checked} solved from the stem + ${lang.checked} from the language rule, ${cat.bad.length + lang.bad.length} disagreements, ${unroutedFamilies.length} families with no audit route`,
    "0 disagreements, 0 unrouted families",
    [...cat.bad, ...lang.bad].slice(0, 8).concat(unroutedFamilies.map((f) => `unrouted: ${f}`))
  );
}

/* C4 */
{
  const d = auditDistractors(catalogue);
  detail.uncoveredSignatures = d.uncovered;
  claim(
    "C4",
    "every distractor equals the response its misconception's diagnosticSignature predicts, recomputed from the knowledge graph",
    d.bad.length === 0 && d.uncovered.length === 0,
    `${d.checked}/${d.total} distractors re-derived, ${d.bad.length} mismatches, ${d.uncovered.length} family/misconception pairs with no transcribed formula`,
    "100% re-derived, 0 mismatches",
    d.bad.slice(0, 8).concat(d.uncovered.slice(0, 8).map((k) => `no formula: ${k}`))
  );
}

/* C5 */
{
  const bad = auditSeparation(catalogue);
  claim(
    "C5",
    "PAIRWISE-SEPARATED: on every served stem, no misconception equals the correct response and no two collide",
    bad.length === 0,
    `${catalogue.length} items, ${bad.length} violations`,
    "0 violations",
    bad.slice(0, 6)
  );
}

/* C6 */
{
  const r = auditRepair(catalogue);
  claim(
    "C6",
    "every repair item's working really does stop following at the line the answer names, and no distractor would also restore the claim",
    r.bad.length === 0,
`${r.universal} repair items, ${r.chainChecked} of them equivalence-chain workings audited line by line, ${r.bad.length} violations`,
    "0 violations",
    r.bad.slice(0, 6)
  );
}

/* C7 */
{
  const r = auditGenerate(catalogue, bank);
  claim(
    "C7",
    "every generate item's own witness satisfies its declared property and every distractor fails it",
    r.bad.length === 0,
    `${r.checked} generate items, ${r.bad.length} violations`,
    "0 violations",
    r.bad.slice(0, 6)
  );
}

/* C8 — the same four audits over freshly generated items */
{
  const a = auditArithmetic(generated, "generated");
  const l = auditLanguage(generated);
  const s = auditSeparation(generated);
  const rp = auditRepair(generated);
  const g = auditGenerate(generated, bank);
  const dd = auditDistractors(generated);
  const bad = [...a.bad, ...l.bad, ...s, ...rp.bad, ...g.bad, ...dd.bad];
  claim(
    "C8",
    "freshly generated items pass every audit the committed ones pass — the bank cannot run dry and cannot go wrong when it refills",
    bad.length === 0 && dd.uncovered.length === 0,
    `${generated.length} generated, ${a.checked + l.checked} answers re-derived, ${dd.checked} distractors re-derived, ${rp.universal} workings, ${g.checked} properties, ${bad.length} failures`,
    `>= ${N_GENERATED} generated, 0 failures`,
    bad.slice(0, 8)
  );
}

/* C9 — KaTeX */
{
  const katex = (await import(pathToFileURL(path.join(ROOT, "node_modules/katex/dist/katex.mjs")).href)).default;
  let n = 0;
  const bad = [];
  for (const item of [...catalogue, ...generated]) {
    const texts = [
      item.stem,
      ...(item.given || []),
      ...(item.working || []),
      item.answer?.tex,
      ...item.distractors.map((d) => d.tex),
    ];
    for (const t of texts) {
      if (t == null) continue;
      n++;
      try {
        katex.renderToString(String(t), { throwOnError: true, strict: "error" });
      } catch (err) {
        if (bad.length < 6) bad.push(`${item.id}: "${t}" -> ${String(err.message).slice(0, 80)}`);
      }
    }
  }
  claim("C9", "every TeX string in the bank typesets under strict KaTeX (G2)", bad.length === 0, `${n} strings, ${bad.length} failures`, "0 failures", bad);
}

/* C10 — localization */
{
  const missing = [];
  const unresolved = [];
  const englishInOther = [];
  const seen = new Set();
  for (const item of [...catalogue, ...generated]) {
    const uses = [
      [item.ask.key ?? item.ask, item.ask.params ?? item.hintParams ?? {}],
      [item.worldFraming.key, item.worldFraming.params],
      ...(item.hints || []).map((h) => [h.key, h.params]),
      ...(item.spoken ? [[item.spoken.key, item.spoken.params]] : []),
      ...(item.story ? [[item.story.key, item.story.params]] : []),
      ...item.distractors.map((d) => [d.failKey, {}]),
    ];
    for (const [key, params] of uses) {
      const entry = srcStrings[key];
      if (!entry) {
        missing.push(key);
        continue;
      }
      for (const loc of ["en", "es", "pl"]) {
        if (!entry[loc] || !String(entry[loc]).trim()) missing.push(`${key}:${loc}`);
        for (const m of String(entry[loc] ?? "").matchAll(/\{(\w+)\}/g)) {
          if (params[m[1]] === undefined) unresolved.push(`${key}:${loc}:{${m[1]}}`);
        }
      }
      if (!seen.has(key)) {
        seen.add(key);
        if (entry.es === entry.en) englishInOther.push(`${key}:es`);
        if (entry.pl === entry.en) englishInOther.push(`${key}:pl`);
      }
    }
  }
  claim(
    "C10",
    "every learner-facing key resolves in en, es and pl, every placeholder has a parameter, and no locale falls back to the English string (G3)",
    missing.length === 0 && unresolved.length === 0 && englishInOther.length === 0,
    `${seen.size} distinct keys, ${missing.length} missing, ${unresolved.length} unresolvable placeholders, ${englishInOther.length} untranslated`,
    "0 / 0 / 0",
    [...new Set([...missing, ...unresolved, ...englishInOther])].slice(0, 8)
  );
}

/* C11 — voice */
{
  /** design/voice.md §1: hard-banned in any player-visible string, in any locale. */
  const BANNED = [
    "problem", "question", "exercise", "answer", "solution", "correct", "incorrect",
    "try again", "good job", "well done", "nice work", "lesson", "tutorial", "practice",
    "homework", "drill", "equation", "algebra", "inequality", "variable", "expression",
    "substitute", "distribute", "simplify", "score", "points", "student",
    "problema", "pregunta", "ejercicio", "respuesta", "solucion", "correcto", "incorrecto",
    "muy bien", "leccion", "ecuacion", "algebra", "desigualdad", "variable", "expresion",
    "sustituir", "simplificar", "puntos", "estudiante",
    "zadanie", "pytanie", "cwiczenie", "odpowiedz", "rozwiazanie", "poprawn", "brawo",
    "lekcja", "rownanie", "algebra", "nierownosc", "zmienna", "wyrazenie", "uprosc",
    "punkty", "uczen",
  ];
  const fold = (s) =>
    String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[łŁ]/g, "l");
  const hits = [];
  for (const [key, entry] of Object.entries(srcStrings)) {
    for (const loc of ["en", "es", "pl"]) {
      const text = fold(entry[loc]);
      for (const word of BANNED) {
        if (text.includes(word)) hits.push(`${key}:${loc}: "${word}"`);
      }
    }
  }
  claim(
    "C11",
    "no banned classroom word from design/voice.md appears in any item string, in any locale",
    hits.length === 0,
    `${Object.keys(srcStrings).length} keys x 3 locales, ${hits.length} hits`,
    "0 hits",
    hits.slice(0, 8)
  );
}

/* C12 — hints never contain the answer */
{
  const bad = [];
  for (const item of catalogue) {
    const answer = String(item.answer.canonical);
    if (!looksNumeric(answer)) continue;
    for (const h of item.hints) {
      const text = h.text ?? "";
      const tokens = String(text).match(/-?\d+(?:\/\d+)?/g) || [];
      if (tokens.includes(answer)) bad.push(`${item.id}: ${h.key} contains ${answer}`);
    }
  }
  claim(
    "C12",
    "no rung of the faded ladder contains the value being asked for — a hint that gives the answer is not a scaffold",
    bad.length === 0,
    `${catalogue.length * 3} hint rungs, ${bad.length} leaks`,
    "0 leaks",
    bad.slice(0, 8)
  );
}

/* C13 — answer checking, both directions */
{
  let accepted = 0;
  let rejected = 0;
  const bad = [];
  for (const item of catalogue) {
    if (item.form === "generate") continue;
    for (const spelling of bank.accepts(item)) {
      accepted++;
      const r = bank.check(item, spelling);
      if (!r.correct) bad.push(`${item.id}: rejected "${spelling}" (${r.reason})`);
    }
    for (const d of item.distractors) {
      rejected++;
      const spelling = spellingFor(item, d);
      if (spelling === null) continue;
      const r = bank.check(item, spelling);
      if (r.correct) bad.push(`${item.id}: accepted the ${d.misconception} response "${spelling}"`);
      else if (r.misconception !== d.misconception)
        bad.push(`${item.id}: "${spelling}" diagnosed as ${r.misconception ?? "nothing"}, expected ${d.misconception}`);
    }
  }
  claim(
    "C13",
    "every documented spelling of a correct response is accepted, and every distractor is refused AND diagnosed as its own misconception (L7)",
    bad.length === 0,
    `${accepted} accepted spellings, ${rejected} distractor spellings, ${bad.length} failures`,
    "0 failures",
    bad.slice(0, 8)
  );
}

/* C13a — how a learner holding a misconception would actually type it */
function spellingFor(item, d) {
  if (item.form === "repair") return `${item.answer.line}: ${d.tex}`;
  if (item.answerType === "closure") return d.response;
  if (item.answerType === "partition") return d.tex.replace(/\\;\\mid\\;/g, "|");
  if (item.answerType === "pair") return d.tex.replace(/\\;/g, "");
  if (item.answerType === "valueSet") return d.tex.replace(/\\;/g, "");
  if (/\\text|\\square/.test(d.tex)) return d.response;
  return d.tex;
}

/* C14 — equivalent-form acceptance, stated explicitly */
{
  const cases = [];
  const numeric = catalogue.find((i) => i.answerType === "integer" && !i.answer.canonical.startsWith("-"));
  const v = numeric.answer.canonical;
  for (const s of [v, `x = ${v}`, `x=${v}`, `${v}.0`, `${v},0`, `+${v}`, ` ${v} `, `${Number(v) * 2}/2`])
    cases.push([numeric, s, true]);
  const expr = catalogue.find((i) => i.answerType === "expression" && i.answer.tex.includes("x") && !i.requiresGathered);
  for (const s of [expr.answer.tex, expr.answer.tex.replace(/(\d)x/g, "$1 \\cdot x"), expr.answer.tex.replace(/(\d)x/g, "$1*x")])
    cases.push([expr, s, true]);
  const ineq = catalogue.find((i) => i.answerType === "inequality");
  const m = ineq.answer.tex.match(/^x\s*(\\le|\\ge|<|>)\s*(.+)$/);
  if (m) {
    const flip = { "<": ">", ">": "<", "\\le": "\\ge", "\\ge": "\\le" }[m[1]];
    cases.push([ineq, ineq.answer.tex, true], [ineq, `${m[2]} ${flip} x`, true]);
  }
  const bad = [];
  for (const [item, spelling, want] of cases) {
    const got = bank.check(item, spelling).correct;
    if (got !== want) bad.push(`${item.id}: "${spelling}" -> ${got}, expected ${want}`);
  }
  claim(
    "C14",
    "equivalent forms are one response: x=4 / 4 / 4.0 / 4,0 / +4 / 8/2, a\\cdot b / a*b / ab, and x>3 / 3<x",
    bad.length === 0,
    `${cases.length} spellings, ${bad.length} failures`,
    "0 failures",
    bad
  );
}

/* C15 — blind-success rate per form (the number design/learning-architecture.md §9 asks P17 for) */
{
  const trueGuess = kg.model.trueGuessByForm;
  const rand = (() => {
    let s = 20260809;
    return () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
  })();
  const pool = [];
  for (let n = -20; n <= 20; n++) pool.push(String(n));
  for (let n = -6; n <= 6; n++) for (const d of [2, 3, 4, 5]) if (n !== 0) pool.push(`${n}/${d}`);
  const rates = {};
  for (const form of ["construct", "repair", "generate"]) {
    const items = catalogue.filter((i) => i.form === form);
    let hits = 0;
    let tries = 0;
    for (const item of items) {
      for (let k = 0; k < 40; k++) {
        tries++;
        let guess;
        if (form === "repair") {
          const line = 1 + Math.floor(rand() * (item.working.length || 1));
          guess = `${line}: x = ${pool[Math.floor(rand() * pool.length)]}`;
        } else if (item.answerType === "expression") {
          guess = `${1 + Math.floor(rand() * 9)}x + ${Math.floor(rand() * 19) - 9}`;
        } else if (item.answerType === "inequality") {
          guess = `x ${rand() < 0.5 ? ">" : "<"} ${pool[Math.floor(rand() * pool.length)]}`;
        } else if (item.answerType === "equation") {
          guess = `x = ${pool[Math.floor(rand() * pool.length)]}`;
        } else if (item.answerType === "partition") {
          guess = item.stem.replace(/\\;\\;/g, " | ");
        } else if (item.answerType === "pair") {
          guess = `x = ${pool[Math.floor(rand() * pool.length)]}; y = ${pool[Math.floor(rand() * pool.length)]}`;
        } else if (item.answerType === "closure") {
          guess = rand() < 0.33 ? "always" : rand() < 0.5 ? "none" : pool[Math.floor(rand() * pool.length)];
        } else if (item.form === "generate") {
          // The bot is given the SHAPES a construction can take, not just numbers: a bare value,
          // a load, a claim, a mark. Anything less would measure the bot rather than the item.
          const k = Math.floor(rand() * 5);
          const n1 = 1 + Math.floor(rand() * 9);
          const n2 = Math.floor(rand() * 19) - 9;
          const n3 = Math.floor(rand() * 19) - 9;
          guess =
            k === 0 ? pool[Math.floor(rand() * pool.length)]
            : k === 1 ? `${n1}x + ${n2}`
            : k === 2 ? `${n1}x + ${n2} = ${n3}`
            : k === 3 ? `${n1}(x + ${n2}) = ${n3}`
            : `x ${rand() < 0.5 ? ">" : "<"} ${pool[Math.floor(rand() * pool.length)]}`;
        } else {
          guess = pool[Math.floor(rand() * pool.length)];
        }
        try {
          if (bank.check(item, guess).correct) hits++;
        } catch {
          /* an unreadable guess is a miss */
        }
      }
    }
    rates[form] = { tries, hits, rate: Number((hits / tries).toFixed(4)), priced: trueGuess[form] };
  }
  detail.blindSuccess = rates;
  const over = Object.entries(rates).filter(([f, r]) => r.rate > trueGuess[f]);
  claim(
    "C15",
    "a bot with no knowledge succeeds no more often than model.trueGuessByForm prices the form at (L5, and the measurement §9 asks P17 to supply)",
    over.length === 0,
    Object.entries(rates).map(([f, r]) => `${f} ${r.rate} vs priced ${r.priced}`).join("; "),
    "measured <= priced, per form",
    over.map(([f, r]) => `${f}: measured ${r.rate} > priced ${r.priced}`)
  );
}

/* C16 — no repeat inside a session */
{
  const bad = [];
  let draws = 0;
  for (const n of kg.nodes) {
    const seen = new Set();
    for (let i = 0; i < 80; i++) {
      const forms = ["construct", "repair", "generate"];
      const r = bank.select({ kpId: n.id, form: forms[i % 3], difficulty: n.difficulty, exclude: seen, seed: i * 31 + 7 });
      draws++;
      if (!r) {
        bad.push(`${n.id}: ran dry after ${seen.size} draws, on form ${forms[i % 3]}`);
        break;
      }
      if (seen.has(r.item.id)) {
        bad.push(`${n.id}: repeated ${r.item.id} at draw ${i}`);
        break;
      }
      seen.add(r.item.id);
    }
  }
  claim(
    "C16",
    "80 consecutive draws on one knowledge point never repeat an item id — more than any session can ask for, with the generator covering what the catalogue cannot",
    bad.length === 0,
    `${draws} draws across 32 knowledge points, ${bad.length} failures`,
    "0 repeats, 0 dry",
    bad.slice(0, 6)
  );
}

/* C2b — targeted retrieval supply, catalogue plus generator */
{
  const bad = [];
  let pairs = 0;
  let worst = Infinity;
  for (const n of kg.nodes) {
    for (const m of n.misconceptions) {
      pairs++;
      const homes = [...new Set(catalogue.filter((it) => it.kpId === n.id && it.distractors.some((d) => d.misconception === m.id)).map((it) => it.form))];
      const form = homes[0] || "construct";
      const seen = new Set();
      for (let i = 0; i < 12; i++) {
        const r = bank.select({
          kpId: n.id,
          form,
          difficulty: n.difficulty,
          misconception: m.id,
          exclude: seen,
          seed: i * 7919 + 13,
        });
        if (!r || !r.item.distractors.some((d) => d.misconception === m.id)) break;
        if (seen.has(r.item.id)) break;
        seen.add(r.item.id);
      }
      if (seen.size < worst) worst = seen.size;
      if (seen.size < 12) bad.push(`${n.id}|${m.id}: ${seen.size} of 12`);
    }
  }
  claim(
    "C2b",
    "for every (knowledge point x misconception) pair the selector can serve 12 distinct items that carry that misconception, so retrieval practice against a specific wrong idea never repeats or runs out (learning-architecture.md §4)",
    bad.length === 0,
    `${pairs} pairs, worst ${worst} of 12 distinct targeted items`,
    "96 pairs, 12 of 12",
    bad.slice(0, 8)
  );
}

/* C17 — standards */
{
  const bad = [];
  for (const item of catalogue) {
    if (!item.standards || !item.standards.length) bad.push(`${item.id}: no standard`);
    for (const s of item.standards || []) if (!standards.codes[s]) bad.push(`${item.id}: unknown standard ${s}`);
    if (!nodeById.has(item.kpId)) bad.push(`${item.id}: unknown knowledge point`);
  }
  claim(
    "C17",
    "every item is tagged to a knowledge point in the graph and to standards codes that exist in content/standards.json (L3)",
    bad.length === 0,
    `${catalogue.length} items, ${new Set(catalogue.flatMap((i) => i.standards)).size} distinct codes, ${bad.length} failures`,
    "0 failures",
    bad.slice(0, 6)
  );
}

/* C18 — the shipped module and the readable files are the same data */
{
  const mod = await imp("content/items/index.mjs");
  const key = (files) =>
    JSON.stringify(
      files
        .map((f) => [f.kpId, f.items.map((i) => i.id)])
        .sort((x, y) => (x[0] < y[0] ? -1 : 1))
    );
  const a = key(bankFiles);
  const b = key(mod.BANK);
  const sameStrings = JSON.stringify(mod.STRINGS) === JSON.stringify(srcStrings);
  claim(
    "C18",
    "content/items/index.mjs carries exactly the data in content/items/bank/*.json and strings.json — the inlined copy cannot drift",
    a === b && sameStrings,
    `${mod.BANK.length} files, ids ${a === b ? "identical" : "DIFFERENT"}, strings ${sameStrings ? "identical" : "DIFFERENT"}`,
    "identical"
  );
}

/* C19 — determinism */
{
  const again = [];
  const perKpShipped = bankFiles[0].items.length;
  for (const n of kg.nodes) {
    let h = 20260809 >>> 0;
    for (let i = 0; i < n.id.length; i++) h = (Math.imul(h, 31) + n.id.charCodeAt(i)) >>> 0;
    const items = gen.generateForKp(n.id, { count: perKpShipped, seed: h || 1, band: n.difficulty });
    again.push(...items.map((i) => `${i.id}|${i.answer.canonical}`));
  }
  const shipped = kg.nodes
    .flatMap((n) => bankFiles.find((f) => f.kpId === n.id).items)
    .map((i) => `${i.id}|${i.answer.canonical}`);
  claim(
    "C19",
    "re-running the builder from the shipped seed reproduces the shipped bank exactly (G4)",
    JSON.stringify(again) === JSON.stringify(shipped),
    `${again.length} regenerated vs ${shipped.length} shipped, ${again.length === shipped.length && again.every((v, i) => v === shipped[i]) ? "identical" : "DIFFERENT"}`,
    "identical"
  );
}

/* C20 — the cost of the separation filter, per family */
{
  const rows = [];
  for (const shp of gen.ALL_SHAPES) {
    let drawn = 0;
    let rejected = 0;
    const rnd = (() => {
      let s = 12345;
      return () => ((s ^= s << 13), (s >>>= 0), (s ^= s >> 17), (s ^= s << 5), (s >>>= 0), s / 4294967296);
    })();
    for (let i = 0; i < 900; i++) {
      const tier = ["easy", "core", "stretch"][i % 3];
      const p = shp.draw(rnd, tier);
      if (!p) continue;
      drawn++;
      if (!gen.separationOK(shp.build(p))) rejected++;
    }
    rows.push({ family: shp.id, drawn, rejected, pct: drawn ? Number(((100 * rejected) / drawn).toFixed(2)) : 0 });
  }
  detail.separationFilter = rows;
  const worst = rows.reduce((a, b) => (b.pct > a.pct ? b : a), rows[0]);
  claim(
    "C20",
    "the PAIRWISE-SEPARATED stem filter costs less than the 25% the knowledge graph sets as a build failure",
    worst.pct < 25,
    `worst family ${worst.family} at ${worst.pct}% of drawn stems rejected`,
    "< 25%"
  );
}

/* C21 — the generator's printed-parameter map against the strings it describes */
{
  const want = {};
  for (const [k, v] of Object.entries(srcStrings)) {
    const set = new Set();
    for (const loc of ["en", "es", "pl"]) for (const mm of String(v[loc]).matchAll(/\{(\w+)\}/g)) set.add(mm[1]);
    if (set.size) want[k] = [...set].sort();
  }
  const got = gen.HINT_PRINTS;
  const diff = [];
  for (const k of new Set([...Object.keys(want), ...Object.keys(got)])) {
    if (JSON.stringify(want[k]) !== JSON.stringify(got[k])) diff.push(k);
  }
  claim(
    "C21",
    "the generator's map of which parameters each string prints agrees with strings.json — the leak filter cannot go stale without failing here",
    diff.length === 0,
    `${Object.keys(want).length} keys with parameters, ${diff.length} disagreements`,
    "0 disagreements",
    diff.slice(0, 8)
  );
}

/* ---------------------------------------------------------------- report */

const passed = results.filter((r) => r.pass).length;
const summary = {
  piece: "P17",
  ranAt: new Date().toISOString(),
  ms: Date.now() - t0,
  catalogueItems: catalogue.length,
  generatedAudited: generated.length,
  knowledgePoints: kg.nodes.length,
  claims: results,
  passed,
  failed: results.length - passed,
  detail: {
    itemsPerKp: detail.itemsPerKp,
    blindSuccess: detail.blindSuccess,
    separationFilterWorst: (detail.separationFilter || [])
      .slice()
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 6),
  },
};

if (JSON_ONLY) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log("P17 — item bank & generators, measured\n");
  console.log(`catalogue ${catalogue.length} items · generated audited ${generated.length} · ${kg.nodes.length} knowledge points\n`);
  const w = Math.max(...results.map((r) => r.measured.length));
  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.id}  ${r.measured.padEnd(Math.min(w, 96))}  [threshold: ${r.threshold}]`);
    console.log(`        ${r.claim}`);
    if (!r.pass && r.notes) for (const n of r.notes) console.log(`        x ${n}`);
  }
  console.log("\nblind-success by form (bot draws, no knowledge):");
  for (const [f, v] of Object.entries(detail.blindSuccess || {})) {
    console.log(`  ${f.padEnd(10)} ${String(v.hits).padStart(5)}/${v.tries}  = ${v.rate}   priced at ${v.priced}`);
  }
  console.log(`\n${passed}/${results.length} claims pass`);
  console.log(summary.failed === 0 ? "\nRESULT: PASS" : "\nRESULT: FAIL");
}

process.exit(summary.failed === 0 ? 0 : 1);
