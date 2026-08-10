/**
 * A PLAYER THAT CAN ONLY SEE THE SCREEN.
 *
 * ==================================================================================================
 * WHY THIS EXISTS
 *
 * Round 2's `review/measure/P34.mjs` and the critic's own driver both closed the loop by reading
 * `ItemBank.accepts(item)[0]` — the answer key — out of the page and typing it. That run proves the
 * engine can mark a response and proves NOTHING about whether a human being could have produced one:
 * the presenter stood `item.stem` and nothing else, so on the bank's most common opening item a
 * player was shown a floating `g` and required to type `8`. A driver with the key cannot tell the
 * difference between a legible game and that.
 *
 * So this module is a learner with no privileges. Its entire input is:
 *
 *   1. `probe("mathtex").panels` — the rows actually standing in the world, `id` and `tex`, the same
 *      thing the rasterizer drew. Nothing else off that probe, and nothing off `probe("teaching")`.
 *   2. `content/items/strings/items-<locale>.mjs` — the shipped sentence table, used ONLY to
 *      comprehend the sentence it just read. A player reads "Let it settle and read it." and knows
 *      what is being asked; matching the rendered string back to its template is the machine
 *      spelling of that, and it carries no answer — the table has one entry per phrasing, shared by
 *      hundreds of items with different answers.
 *   3. `content/items/kit.mjs` — arithmetic. Parsing `9 - 2 + 3` and getting 10 is the work the item
 *      is asking for, not a shortcut around it.
 *
 * It never sees `item`, `item.answer`, `ItemBank.accepts`, `ItemBank.check` or any probe field that
 * carries them. `boot/92-teaching.js`'s `teachwiring.expected()` hook has been deleted outright so
 * there is no longer a route to the key even by accident.
 *
 * WHAT IT DELIBERATELY WILL NOT DO
 *
 * For a `generate` item the presenter stands `item.stem`, and for 226 of the bank's 303 generate
 * items the shipped checker marks that stem correct — the world displays an accepted answer to
 * "author me one of these". That is a real finding (`review/measure/P34.mjs` reports it) and it is
 * NOT this reader's shortcut: `ask.gen.*` is answered from the ask's own parameters and the given,
 * never by copying the stem. A proof that leaned on the leak would be measuring the leak.
 *
 * WHERE IT GIVES UP
 *
 * It reads what it can read. `strategy: "unsolved"` is an honest outcome and the run reports the
 * count and the reason, because "the reader could not" and "the screen did not say" are different
 * facts and the second one is a defect in the presenter this whole piece is about.
 * ==================================================================================================
 */
import {
  rat,
  rstr,
  rnum,
  parseExpr,
  parseStatement,
  polyStr,
  polySub,
  polySubst,
  polyIsConst,
  polyConstValue,
  surfaceTerms,
  solveLinear,
} from "../../../content/items/kit.mjs";

/* ------------------------------------------------------------------ reading the rows */

const TEXT_UNESCAPE = [
  [/\\textbackslash\{\}/g, "\\"],
  [/\\textasciicircum\{\}/g, "^"],
  [/\\textasciitilde\{\}/g, "~"],
  [/\\([{}$&#_%])/g, "$1"],
];

/** `\text{Let it settle and read it.}` -> `Let it settle and read it.` */
export function plainOf(tex) {
  const m = /^\\text\{([\s\S]*)\}$/.exec(String(tex ?? "").trim());
  if (!m) return null;
  let s = m[1];
  for (const [re, to] of TEXT_UNESCAPE) s = s.replace(re, to);
  return s;
}

/** TeX a human reads -> the same mathematics `content/items/kit.mjs` parses. */
export function mathOf(tex) {
  let s = String(tex ?? "");
  s = s.replace(/\\left|\\right/g, "");
  s = s.replace(/\\cdot|\\times/g, "*");
  s = s.replace(/\\div/g, "/");
  s = s.replace(/\\ge/g, ">=").replace(/\\le/g, "<=");
  s = s.replace(/\\mid/g, "|");
  s = s.replace(/\\quad|\\qquad|\\;|\\,|\\:|\\!/g, " ");
  for (let i = 0; i < 4; i += 1) s = s.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "($1)/($2)");
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Everything the presenter is standing right now, sorted into what it is. Ids are
 * `learn/Teaching.js`'s `TEACH.ids`; nothing here reaches past them.
 */
export function readScreen(panels = []) {
  const s = { ask: [], said: [], stem: null, given: [], working: [], model: null, entry: null, hint: [], ids: [] };
  const workingRows = [];
  for (const p of panels) {
    const id = String(p?.id ?? "");
    if (!id.startsWith("teach-")) continue;
    s.ids.push(id);
    const tex = String(p?.tex ?? "");
    if (id.startsWith("teach-ask-")) s.ask.push([Number(id.slice(10)), plainOf(tex)]);
    else if (id.startsWith("teach-said-")) s.said.push([Number(id.slice(11)), plainOf(tex)]);
    else if (id === "teach-claim") s.stem = tex;
    else if (id.startsWith("teach-given-")) s.given.push([Number(id.slice(12)), tex]);
    else if (id === "teach-working-model") s.model = tex;
    else if (id.startsWith("teach-working-")) workingRows.push([Number(id.slice(14)), tex]);
    else if (id === "teach-entry") s.entry = tex;
    else if (id === "teach-hint") s.hint.push(plainOf(tex));
  }
  const bySeq = (a, b) => a[0] - b[0];
  s.askText = s.ask.sort(bySeq).map((r) => r[1]).filter(Boolean).join(" ");
  s.saidText = s.said.sort(bySeq).map((r) => r[1]).filter(Boolean).join(" ");
  s.given = s.given.sort(bySeq).map((r) => r[1]);
  // `1)\;q = 9` — the row number the presenter drew is the row number the answer names.
  s.working = workingRows.sort(bySeq).map((r) => String(r[1]).replace(/^\s*\d+\)\s*\\;?\s*/, ""));
  return s;
}

/* ------------------------------------------------------------------ comprehending the sentence */

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Match a rendered sentence back to the template it came from. This is the machine spelling of
 * "the player read the question and understood it": one template serves hundreds of items with
 * hundreds of different answers, so nothing about the answer comes through here.
 */
export function buildMatcher(table, prefix) {
  const rows = [];
  for (const [key, src] of Object.entries(table)) {
    if (!key.startsWith(prefix)) continue;
    const names = [];
    const pattern = escapeRe(src).replace(/\\\{(\w+)\\\}/g, (m, name) => {
      names.push(name);
      return "(.+?)";
    });
    rows.push({ key, names, re: new RegExp(`^${pattern}$`), len: src.length });
  }
  rows.sort((a, b) => b.len - a.len);
  return rows;
}

const asNumber = (raw) => {
  const s = String(raw ?? "").replace(/\s| /g, "").replace(/,/g, ".");
  return /^[-+]?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
};

export function comprehend(text, matcher) {
  const t = String(text ?? "").trim();
  if (!t) return null;
  for (const row of matcher) {
    const m = row.re.exec(t);
    if (!m) continue;
    const params = {};
    row.names.forEach((n, i) => {
      params[n] = m[i + 1];
      const num = asNumber(m[i + 1]);
      if (num !== null) params[n] = num;
    });
    return { key: row.key, params };
  }
  return null;
}

/* ------------------------------------------------------------------ doing the mathematics */

const tryOr = (fn, fallback = null) => {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
};

/** `g = 8` rows -> `{ g: 8 }`, as exact rationals. */
function substitutions(givenTex) {
  const subs = {};
  for (const g of givenTex) {
    const st = tryOr(() => parseStatement(mathOf(g)));
    if (!st || st.kind !== "rel" || st.rel !== "=") continue;
    const left = st.left;
    const right = st.right;
    if (left.size === 1 && polyIsConst(right)) {
      const key = [...left.keys()][0];
      const coef = left.get(key);
      if (key && coef && coef.n === coef.d) subs[key.replace(/\^\d+$/, "")] = polyConstValue(right);
    }
  }
  return subs;
}

function constValue(src, subs) {
  return tryOr(() => {
    const p = polySubst(parseExpr(mathOf(src)), subs);
    return polyIsConst(p) ? polyConstValue(p) : null;
  });
}

/** Solve a relation for its single unknown. */
function solveRelation(src, unknownHint = null) {
  const st = tryOr(() => parseStatement(mathOf(src)));
  if (!st || st.kind !== "rel") return null;
  const names = new Set();
  for (const p of [st.left, st.right]) for (const k of p.keys()) if (k) names.add(k.replace(/\^\d+$/, ""));
  const unknown = unknownHint && names.has(unknownHint) ? unknownHint : [...names][0];
  if (!unknown || names.size !== 1) return null;
  const sol = tryOr(() => solveLinear(st.left, st.right, unknown));
  if (sol == null || typeof sol === "string") return null;
  return { unknown, value: sol, rel: st.rel, left: st.left, right: st.right };
}

/** Two relations, two names. Enough for `x + y = 20, x - y = 0`. */
function solveSystem(stemTex) {
  const parts = mathOf(stemTex)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length !== 2) return null;
  const sts = parts.map((s) => tryOr(() => parseStatement(s)));
  if (sts.some((s) => !s || s.kind !== "rel" || s.rel !== "=")) return null;
  const names = new Set();
  for (const st of sts) for (const p of [st.left, st.right]) for (const k of p.keys()) if (k) names.add(k);
  const [u, v] = [...names];
  if (!u || !v || names.size !== 2) return null;
  // a1*u + b1*v = c1 ; a2*u + b2*v = c2, read off the difference of the two sides.
  const rows = sts.map((st) => {
    const d = new Map();
    for (const [k, c] of st.left) d.set(k, rnum(c));
    for (const [k, c] of st.right) d.set(k, (d.get(k) ?? 0) - rnum(c));
    return { a: d.get(u) ?? 0, b: d.get(v) ?? 0, c: -(d.get("") ?? 0) };
  });
  const det = rows[0].a * rows[1].b - rows[1].a * rows[0].b;
  if (!det) return null;
  const uu = (rows[0].c * rows[1].b - rows[1].c * rows[0].b) / det;
  const vv = (rows[0].a * rows[1].c - rows[1].a * rows[0].c) / det;
  if (!Number.isFinite(uu) || !Number.isFinite(vv)) return null;
  return { names: [u, v], values: [uu, vv] };
}

/** Is a relation true under these substitutions? `null` when it cannot be decided. */
function relationHolds(src, subs) {
  const st = tryOr(() => parseStatement(mathOf(src)));
  if (!st || st.kind !== "rel" || st.rel !== "=") return null;
  const l = tryOr(() => polySubst(st.left, subs));
  const r = tryOr(() => polySubst(st.right, subs));
  if (!l || !r || !polyIsConst(l) || !polyIsConst(r)) return null;
  return rstr(polyConstValue(l)) === rstr(polyConstValue(r));
}

/**
 * The broken joint in a shown build.
 *
 * Every line of a working is a different spelling of the same value, so the first line whose value
 * disagrees with the item's own is the joint that will not hold, and the value it should read is the
 * one the rest of the build agrees on. Where the lines are CLAIMS rather than values — `q = 9`,
 * `x = 4` — the same rule runs on truth instead of on arithmetic, against the substitutions the
 * `given` rows supply or the solution the stem's own system fixes.
 */
function repairAnswer(screen) {
  const subs = substitutions(screen.given);
  const sys = solveSystem(screen.stem ?? "");
  const solved = { ...subs };
  if (sys) sys.names.forEach((n, i) => (solved[n] = rat(Math.round(sys.values[i] * 1e6), 1e6)));

  /**
   * A build of VALUES. Every line of a working is a different spelling of one quantity — sometimes a
   * number (`9^{2}` under `x = 9`), sometimes a load that still carries the letter (`-4x - 7`) — so
   * the comparison is on the polynomial and it covers both. The truth is the first line of the build,
   * which is the item's own stem restated, and the joint is the first line that stops agreeing with
   * it.
   */
  const truth = tryOr(() => polySubst(parseExpr(mathOf(screen.stem ?? "")), subs));
  if (truth) {
    const want = polyStr(truth);
    for (let i = 0; i < screen.working.length; i += 1) {
      const p = tryOr(() => polySubst(parseExpr(mathOf(screen.working[i])), subs));
      if (!p) continue;
      if (polyStr(p) !== want) return { response: `${i + 1}: ${want}`, strategy: "repair-value" };
    }
  }

  /**
   * A build of CLAIMS, where the stem is itself a claim. Every line of the build has to close where
   * the first line closes, so the joint is the first line that closes somewhere else, and what it
   * should read is any claim that closes in the right place — `canonEquation` normalizes
   * `-x + 7 = 5` and `x = 2` to the same string, which is why writing the solution is a legal repair
   * of an intermediate step.
   */
  const stemSol = solveRelation(screen.stem ?? "");
  if (stemSol) {
    const want = rstr(stemSol.value);
    for (let i = 0; i < screen.working.length; i += 1) {
      const s = solveRelation(screen.working[i], stemSol.unknown);
      if (!s || s.unknown !== stemSol.unknown) continue;
      if (rstr(s.value) !== want) return { response: `${i + 1}: ${stemSol.unknown} = ${want}`, strategy: "repair-chain" };
    }
  }

  // A build of claims about a socket the given already fixed.
  if (!Object.keys(solved).length) return null;
  for (let i = 0; i < screen.working.length; i += 1) {
    const holds = relationHolds(screen.working[i], solved);
    if (holds !== false) continue;
    const st = tryOr(() => parseStatement(mathOf(screen.working[i])));
    if (!st) return null;
    const names = [...st.left.keys(), ...st.right.keys()].filter(Boolean).map((k) => k.replace(/\^\d+$/, ""));
    const name = names.find((n) => solved[n] !== undefined);
    if (!name) return null;
    return { response: `${i + 1}: ${name} = ${rstr(solved[name])}`, strategy: "repair-claim" };
  }
  return null;
}

/** The socket the said claim is about: the stem when it is a bare name, `n` otherwise. */
function socketName(screen) {
  const s = mathOf(screen.stem ?? "").trim();
  return /^[a-zA-Z]$/.test(s) ? s : "n";
}

/**
 * The load a said claim describes. Comprehending "seven less than the count you are holding" as
 * `n - 7` — and NOT as `7 - n` — is the entire knowledge point of `translate-order`, so this is the
 * reader doing the work rather than dodging it.
 */
function loadFromSaid(said, screen) {
  if (!said) return null;
  const v = socketName(screen);
  const P = said.params ?? {};
  switch (said.key) {
    case "spoken.translate-order.lessthan":
      return Number.isFinite(P.a) ? `${v} - ${P.a}` : null;
    case "spoken.translate-order.subtractfrom":
      return Number.isFinite(P.a) ? `${P.a} - ${v}` : null;
    case "spoken.translate-order.dividedinto":
      return Number.isFinite(P.a) ? `(${P.a})/(${v})` : null;
    case "spoken.translate-phrase.groups":
      return Number.isFinite(P.a) && Number.isFinite(P.b) ? `${P.a}*${v} + ${P.b}` : null;
    case "spoken.translate-phrase.twice":
      return Number.isFinite(P.b) ? `2*${v} + ${P.b}` : null;
    default:
      return null;
  }
}

/**
 * A canonical target the ask hands over verbatim — `24*n^-1`, `6*n + 8` — put back into the grammar
 * the entry allows. That the ask says this AT ALL is a finding rather than a convenience:
 * `ask.gen.sealCan` and `ask.gen.gathersTo` interpolate the checker's machine spelling into a
 * player-facing sentence, so the question a Polish learner reads contains `24*n^-1`.
 */
function targetExpr(raw) {
  let s = String(raw ?? "").trim();
  if (!s) return null;
  s = s.replace(/(\d+)\s*\*\s*([a-zA-Z])\^-1/g, "($1)/($2)");
  s = s.replace(/([a-zA-Z0-9)])\^\{?(\d)\}?/g, (m, b, n) => (Number(n) >= 1 && Number(n) <= 4 ? Array(Number(n)).fill(b).join("*") : m));
  return /^[0-9a-zA-Z+\-*/=<>.,()|:; ]*$/.test(s) ? s : null;
}

/* ------------------------------------------------------------------ the reader */

/**
 * @param {object} opts
 * @param {Array}  opts.panels  `probe("mathtex").panels`, verbatim.
 * @param {object} opts.table   the shipped locale sentence table for the running locale.
 * @returns {{response:string|null, strategy:string, askKey:string|null, screen:object}}
 */
export function answerFromScreen({ panels, table }) {
  const screen = readScreen(panels);
  const askMatcher = buildMatcher(table, "ask.");
  const saidMatcher = buildMatcher(table, "spoken.");
  const ask = comprehend(screen.askText, askMatcher);
  const said = comprehend(screen.saidText, saidMatcher);
  const subs = substitutions(screen.given);
  /**
   * A response the entry would refuse is not a response. `learn/Teaching.js`'s `type()` drops any
   * character outside `ItemBank.ENTRY_GRAMMAR`, so a reader that "answered" `24*n^-1` would be
   * typing `24*n-1` into the world and measuring something that never happened.
   */
  const out = (response, strategy) => {
    if (response != null && !/^[0-9a-zA-Z+\-*/=<>.,()|:; ]*$/.test(response)) {
      return { response: null, strategy: "outside-grammar", askKey: ask?.key ?? null, said: said?.key ?? null, screen };
    }
    return { response, strategy, askKey: ask?.key ?? null, said: said?.key ?? null, screen };
  };

  if (!ask) return out(null, "ask-unreadable");
  const P = ask.params ?? {};

  switch (ask.key) {
    /* ---- read the socket, or settle the load ------------------------------------------- */
    case "ask.reading":
    case "ask.value": {
      const v = constValue(screen.stem ?? "", subs);
      if (v !== null) return out(rstr(v), "evaluate");
      const sol = solveRelation(screen.stem ?? "");
      if (sol) return out(rstr(sol.value), "solve");
      return out(null, "unsolved");
    }

    /* ---- the stretch a rail admits ------------------------------------------------------ */
    case "ask.mark": {
      const st = tryOr(() => parseStatement(mathOf(screen.stem ?? "")));
      if (!st || st.kind !== "rel" || st.rel === "=") return out(null, "unsolved");
      const names = new Set();
      for (const p of [st.left, st.right]) for (const k of p.keys()) if (k) names.add(k);
      const u = [...names][0];
      if (!u || names.size !== 1) return out(null, "unsolved");
      const a = rnum(st.left.get(u) ?? rat(0)) - rnum(st.right.get(u) ?? rat(0));
      const c = rnum(st.right.get("") ?? rat(0)) - rnum(st.left.get("") ?? rat(0));
      if (!a) return out(null, "unsolved");
      const v = c / a;
      const flip = { "<": ">", ">": "<", "<=": ">=", ">=": "<=" };
      const rel = a > 0 ? st.rel : flip[st.rel] ?? st.rel;
      return out(`${u} ${rel} ${Number.isInteger(v) ? v : v.toFixed(6)}`, "solve-inequality");
    }

    /* ---- charge both cores -------------------------------------------------------------- */
    case "ask.pair": {
      const sys = solveSystem(screen.stem ?? "");
      if (!sys) return out(null, "unsolved");
      return out(`${sys.names[0]}=${sys.values[0]}, ${sys.names[1]}=${sys.values[1]}`, "solve-system");
    }

    /* ---- write the load ----------------------------------------------------------------- *
     * For the `translate-*` families the load is not on the stem at all — the stem is a bare `n`
     * and the mathematics is the SENTENCE. This branch is the reason the said claim is stood: with
     * `spoken` off the screen these items are a floating letter and an instruction to write a load.
     */
    case "ask.load": {
      const fromSaid = loadFromSaid(said, screen);
      if (fromSaid) return out(fromSaid, "said-load");
      const p = tryOr(() => polySubst(parseExpr(mathOf(screen.stem ?? "")), subs));
      return p ? out(polyStr(p), "gather-load") : out(null, "unsolved");
    }

    /* ---- what the Sill is holding ------------------------------------------------------- */
    case "ask.closure": {
      const st = tryOr(() => parseStatement(mathOf(screen.stem ?? "")));
      if (!st || st.kind !== "rel" || st.rel !== "=") return out(null, "unsolved");
      const d = tryOr(() => polySub(st.left, st.right));
      if (!d) return out(null, "unsolved");
      if (polyIsConst(d)) return out(polyConstValue(d).n === 0 ? "always" : "none", "closure");
      const sol = solveRelation(screen.stem ?? "");
      return sol ? out(rstr(sol.value), "closure-value") : out(null, "unsolved");
    }

    /* ---- sort them into weld stacks ----------------------------------------------------- */
    case "ask.groups": {
      // The stem is a row of loose terms — `3x \;\; 4y \;\; 6 \;\; 7x \;\; 2y` — not one expression.
      const tokens = mathOf(screen.stem ?? "")
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (tokens.length < 2) return out(null, "unsolved");
      const stacks = new Map();
      for (const tok of tokens) {
        const p = tryOr(() => parseExpr(tok));
        if (!p) return out(null, "unsolved");
        const key = [...p.keys()].find(Boolean) ?? "";
        if (!stacks.has(key)) stacks.set(key, []);
        stacks.get(key).push(polyStr(p));
      }
      return out([...stacks.values()].map((g) => g.join(",")).join(" | "), "sort-stacks");
    }

    /* ---- the anatomy of a load ---------------------------------------------------------- */
    case "ask.terms": {
      const terms = tryOr(() => surfaceTerms(mathOf(screen.stem ?? "")));
      return terms ? out(String(terms.length), "count-terms") : out(null, "unsolved");
    }
    case "ask.term": {
      const terms = tryOr(() => surfaceTerms(mathOf(screen.stem ?? "")));
      if (!terms || terms.length < 2) return out(null, "unsolved");
      return out(polyStr(terms[1]), "second-term");
    }
    case "ask.count": {
      const terms = tryOr(() => surfaceTerms(mathOf(screen.stem ?? "")));
      if (!terms || !terms.length) return out(null, "unsolved");
      const first = terms[0];
      const key = [...first.keys()].find(Boolean);
      const coef = key ? first.get(key) : null;
      return coef ? out(rstr(coef), "first-coefficient") : out(null, "unsolved");
    }

    /* ---- name the joint that will not hold ---------------------------------------------- */
    case "ask.repair": {
      const r = repairAnswer(screen);
      return r ? out(r.response, r.strategy) : out(null, "unsolved");
    }

    /* ---- write the claim that stands ---------------------------------------------------- */
    case "ask.claim": {
      if (said?.key === "spoken.var-meaning.relate") {
        const names = String(mathOf(screen.stem ?? ""))
          .split(",")
          .map((s) => s.trim())
          .filter((s) => /^[a-zA-Z]$/.test(s));
        const k = said.params?.k;
        if (names.length === 2 && Number.isFinite(k)) return out(`${names[0]} = ${k}${names[1]}`, "said-claim");
      }
      if (said?.key === "spoken.translate-sentence.core") {
        const { a, b, c } = said.params ?? {};
        const v = socketName(screen);
        if ([a, b, c].every(Number.isFinite)) return out(`${a}*${v} + ${b} = ${c}`, "said-claim");
      }
      return out(null, "unsolved");
    }

    /* ---- author one of these ------------------------------------------------------------ *
     * Built from the ASK's own parameters and the given, never from the stem. See the header. */
    case "ask.gen.loadReadsAt": {
      const u = typeof P.unknown === "string" ? P.unknown.trim() : null;
      const target = Number(P.target);
      const at = Number(P.at);
      if (!u || !/^[a-zA-Z]$/.test(u) || !Number.isFinite(target) || !Number.isFinite(at)) return out(null, "unsolved");
      const d = target - at;
      return out(d >= 0 ? `${u} + ${d}` : `${u} - ${-d}`, "author-reads-at");
    }
    case "ask.gen.loadTo": {
      const target = Number(P.target);
      if (!Number.isFinite(target)) return out(null, "unsolved");
      return out(`2 * 3 + ${target - 6}`, "author-settles-to");
    }
    case "ask.gen.loadShape": {
      const n = Number(P.terms);
      if (!Number.isFinite(n) || n < 1 || n > 6) return out(null, "unsolved");
      const letters = ["x", "y", "z", "w", "v"];
      const parts = [];
      for (let i = 0; i < n - 1; i += 1) parts.push(`${i + 2}${letters[i]}`);
      parts.push("1");
      return out(parts.join(" + "), "author-shape");
    }
    case "ask.gen.namesDiffer": {
      const v = screen.given.map((g) => constValue(String(g).split("=").pop(), {})).find((x) => x !== null);
      if (v === null || v === undefined) return out(null, "unsolved");
      return out(`a = ${rstr(v)}; b = ${rstr(v)}`, "author-two-names");
    }
    case "ask.gen.saidClaim":
      if (said?.key === "spoken.translate-sentence.core") {
        const { a, b, c } = said.params ?? {};
        const v = socketName(screen);
        if ([a, b, c].every(Number.isFinite)) return out(`${a}*${v} + ${b} = ${c}`, "said-claim");
      }
    // falls through to the generic authored claim
    case "ask.gen.claimClosesAt": {
      const target = Number(P.target);
      if (!Number.isFinite(target)) return out(null, "unsolved");
      return out(`2x + 1 = x + ${target + 1}`, "author-claim");
    }
    case "ask.gen.sealCan":
    case "ask.gen.gathersTo": {
      const t = targetExpr(P.target);
      return t ? out(t, "author-to-target") : out(null, "unsolved");
    }
    case "ask.gen.markAdmits": {
      const t = String(P.target ?? "");
      const m = /([a-zA-Z])\s*(<=|>=|<|>)\s*(-?\d+)/.exec(mathOf(t));
      if (!m) return out(null, "unsolved");
      return out(`2${m[1]} ${m[2]} ${Number(m[3]) * 2}`, "author-rail");
    }

    default:
      return out(null, "no-strategy");
  }
}
