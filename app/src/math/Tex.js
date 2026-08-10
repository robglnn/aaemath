/**
 * Tex — the strict typesetting layer. Everything mathematical in Variable Star goes through
 * this file, and nothing else in the codebase is allowed to call KaTeX directly.
 *
 * Four properties, in the order they matter:
 *
 *  1. **Nothing malformed ever reaches a player.** KaTeX runs with `throwOnError:true` and
 *     `strict:"error"`, so a bad expression raises instead of silently emitting a red
 *     `.katex-error` node with the source inside it. We catch it, push it to `__vs.errors`
 *     (which makes `review.mjs` refuse the frame — a content bug must fail the build, not
 *     ship quietly) and hand back a safe, typeset placeholder. The source string never
 *     appears in the returned HTML, in the accessible name, or in the world.
 *
 *  2. **It is Node-importable.** No DOM, no CSS import, no `window` (the stylesheet is
 *     pulled in by `boot/60-mathtex.js`, which is browser-only by definition). That is what
 *     makes `validate()` and `lintTexBank()` usable offline, so an item bank can be linted
 *     in CI before anybody plays it.
 *
 *  3. **Locale is a property of the mathematics, not just of the words.** ES and PL take a
 *     decimal comma, a centre dot for multiplication, and — in PL — a colon for division,
 *     because that is what those classrooms write. `content/knowledge-graph.json`'s
 *     `conventions.localization` is the contract; this file implements it.
 *
 *  4. **Every expression carries a spoken form.** KaTeX's HTML is marked `aria-hidden`, and
 *     the container carries `role="math"` with a localized `aria-label`. A screen reader
 *     must never read `\frac{1}{2}` out loud, and must never be handed the MathML
 *     `<annotation>` either — which is why the output mode is `"html"` and not
 *     `"htmlAndMathml"`. The annotation element is a raw-TeX leak with a spec citation.
 *
 * Caching is not an optimisation here, it is a correctness property: the world re-reads its
 * claims every frame, and re-typesetting an expression sixty times a second would put a
 * layout pass in the frame budget. `render()` is keyed on (locale, mode, source) and the
 * miss count is published so a reviewer can prove the cache is doing its job.
 *
 * ## Two of the four bounds on hostile input live here
 *
 * A claim is drawn by parsing it, building HTML, letting the browser lay that HTML out, and
 * then allocating a canvas the size of the result. Every one of those steps scales with the
 * content, so each has a cap, and the caps are ordered cheapest-first:
 *
 *  1. `MAX_TEX_LENGTH` — before KaTeX runs at all. Bounds everything downstream.
 *  2. `MAX_TEX_DEPTH` — between the parse and the typesetting. Bounds *layout*, and it is not
 *     a nicety: a 15-deep nested fraction crashes the Chromium renderer outright.
 *  3. `RASTER_CAPS.maxInkEms*` in `TexPanel.js` — after layout. Bounds the world.
 *  4. `RASTER_CAPS.maxEdge`/`maxPixels` in `TexPanel.js` — before allocating. Bounds memory.
 *
 * Both caps here are checked in `validate()` rather than in `render()`, which means a content
 * lint catches a bad expression in Node, in CI, before anybody plays it — that is the whole
 * reason `validate()` is DOM-free.
 */
import katex from "katex";
import { introspect } from "../core/Introspect.js";
import { signals } from "../core/Signals.js";

export const LOCALES = ["en", "es", "pl"];

/**
 * The longest source string this pipeline will look at. Not a style rule — an allocation
 * bound. Everything downstream (parse tree, HTML, DOM layout, canvas) is at least linear in
 * this number and the canvas is quadratic in it, so it is the single knob that keeps a
 * hostile string from turning into a hostile allocation. Measured headroom: the longest TeX
 * in `content/items/bank` is 34 characters.
 */
export const MAX_TEX_LENGTH = 2000;

/**
 * The deepest parse tree this pipeline will typeset, and the reason it exists is not
 * hypothetical: **a 15-deep nested fraction crashes the renderer process.**
 *
 * Measured, in the shipped game, through `review/measure/P15.mjs`'s sweep: KaTeX itself is
 * fine — it parses and builds 60-deep nesting in about 5 ms and 13 KB of HTML, and the node
 * count grows linearly. Inserting that HTML into the document is fine too. The first
 * `getBoundingClientRect()` on it takes the Chromium renderer down with `Target crashed`, and
 * it does so at nested-fraction depth 15 (parse-tree depth 30) while depth 14 lays out in
 * under 2 ms. So this cannot be caught by measuring the result: by the time there is a result
 * to measure, the tab is gone. It has to be refused between the parse and the layout, which
 * is exactly where `validate()` checks it.
 *
 * 16 is half the depth that crashes, and more than five times the deepest expression in the
 * shipped bank — all 2,717 of which measure depth 3 or less. `\sqrt{\frac{x^{2}+1}{2}}`, which
 * is more elaborate than anything Algebra I asks for, is depth 6.
 */
export const MAX_TEX_DEPTH = 16;

// The keys a KaTeX parse node carries its children under. Walking these rather than every own
// property keeps the measurement cheap and keeps it away from `loc`, which holds a reference
// to the lexer and therefore to the whole source.
const CHILD_KEYS = ["body", "numer", "denom", "base", "sub", "sup", "index", "mathml", "html"];

/** How deep, and how many nodes. Linear in the tree, and the tree is bounded by the length cap. */
function treeShape(node, depth = 0, acc = { depth: 0, nodes: 0 }) {
  if (node == null) return acc;
  if (Array.isArray(node)) {
    // An array is a sibling list, not a nesting level: a hundred-term sum is wide, not deep.
    for (const child of node) treeShape(child, depth, acc);
    return acc;
  }
  if (typeof node !== "object") return acc;
  acc.nodes++;
  if (depth > acc.depth) acc.depth = depth;
  for (const key of CHILD_KEYS) {
    const child = node[key];
    if (child != null && typeof child === "object") treeShape(child, depth + 1, acc);
  }
  return acc;
}

// ---------------------------------------------------------------- locale conventions

/**
 * The notation half of localization. Words are P20's; these are the marks on the page.
 *
 * `decimalTex` is braced (`{,}`) rather than bare because a bare comma is punctuation in
 * TeX math mode and KaTeX gives it trailing punctuation spacing — `3, 5` instead of `3,5`.
 * `groupTex` is a thin space in ES/PL for the same reason a comma cannot be the separator:
 * the comma is already spoken for.
 */
const CONVENTIONS = {
  en: {
    locale: "en",
    decimalTex: ".",
    decimalChar: ".",
    groupTex: "{,}",
    groupChar: ",",
    groupFrom: 5, // 1000 stays 1000; 10000 becomes 10,000
    timesTex: null, // \times is idiomatic in EN classrooms — leave what the author wrote
    divTex: null,
    numberLetter: "n",
  },
  es: {
    locale: "es",
    decimalTex: "{,}",
    decimalChar: ",",
    groupTex: "\\,",
    groupChar: " ",
    groupFrom: 5,
    timesTex: "\\cdot", // centre dot, never a cross
    divTex: null,
    numberLetter: "n",
  },
  pl: {
    locale: "pl",
    decimalTex: "{,}",
    decimalChar: ",",
    groupTex: "\\,",
    groupChar: " ",
    groupFrom: 5,
    timesTex: "\\cdot",
    // Polish school notation divides with a colon: 6 : 2 = 3. \mathbin keeps binary spacing;
    // a bare ":" is a relation in TeX and would be set with equals-sign spacing.
    divTex: "\\mathbin{:}",
    numberLetter: "x",
  },
};

/**
 * The spoken forms. This table exists because a blind player must receive exactly what a
 * sighted player receives, and `\ge` read as "backslash g e" is not that.
 *
 * These are readings of *symbols*, not interface labels: `voice.md` §1 bans "less than" and
 * "at most" as UI labels and it is right to, but an accessible name for an expression is the
 * expression, and refusing to voice a relation would lock a screen-reader user out of the
 * game entirely. Nothing here names the subject, grades the player, or explains a procedure.
 */
const WORDS = {
  en: {
    plus: "plus",
    minus: "minus",
    negative: "negative",
    equals: "equals",
    notEquals: "is not equal to",
    lt: "is less than",
    gt: "is greater than",
    le: "is less than or equal to",
    ge: "is greater than or equal to",
    approx: "is about",
    times: "times",
    over: "over",
    dividedBy: "divided by",
    open: "open parenthesis",
    close: "close parenthesis",
    openBracket: "open bracket",
    closeBracket: "close bracket",
    absOpen: "absolute value of",
    absClose: "end absolute value",
    squared: "squared",
    cubed: "cubed",
    power: "to the power",
    sub: "sub",
    sqrt: "square root of",
    decimal: "point",
    comma: "comma",
    plusMinus: "plus or minus",
    percent: "percent",
    degrees: "degrees",
    infinity: "infinity",
    pi: "pi",
    // The bank separates groups of like terms with `\mid`. Named as the mark it is, in the
    // same idiom as "open parenthesis" — a screen-reader user needs the grouping.
    verticalBar: "vertical bar",
    fallback: "unreadable claim",
    empty: "empty claim",
  },
  es: {
    plus: "más",
    minus: "menos",
    negative: "menos",
    equals: "igual a",
    notEquals: "distinto de",
    lt: "menor que",
    gt: "mayor que",
    le: "menor o igual que",
    ge: "mayor o igual que",
    approx: "aproximadamente",
    times: "por",
    over: "sobre",
    dividedBy: "dividido entre",
    open: "abre paréntesis",
    close: "cierra paréntesis",
    openBracket: "abre corchete",
    closeBracket: "cierra corchete",
    absOpen: "valor absoluto de",
    absClose: "fin del valor absoluto",
    squared: "al cuadrado",
    cubed: "al cubo",
    power: "elevado a",
    sub: "sub",
    sqrt: "raíz cuadrada de",
    decimal: "coma",
    comma: "coma",
    plusMinus: "más menos",
    percent: "por ciento",
    degrees: "grados",
    infinity: "infinito",
    pi: "pi",
    verticalBar: "barra vertical",
    fallback: "afirmación ilegible",
    empty: "afirmación vacía",
  },
  pl: {
    plus: "plus",
    minus: "minus",
    negative: "minus",
    equals: "równa się",
    notEquals: "nie równa się",
    lt: "mniejsze od",
    gt: "większe od",
    le: "mniejsze lub równe",
    ge: "większe lub równe",
    approx: "w przybliżeniu",
    times: "razy",
    over: "łamane przez",
    dividedBy: "dzielone przez",
    open: "nawias otwierający",
    close: "nawias zamykający",
    openBracket: "nawias kwadratowy otwierający",
    closeBracket: "nawias kwadratowy zamykający",
    absOpen: "wartość bezwzględna z",
    absClose: "koniec wartości bezwzględnej",
    squared: "do kwadratu",
    cubed: "do sześcianu",
    power: "do potęgi",
    sub: "indeks",
    sqrt: "pierwiastek z",
    decimal: "przecinek",
    comma: "przecinek",
    plusMinus: "plus minus",
    percent: "procent",
    degrees: "stopni",
    infinity: "nieskończoność",
    pi: "pi",
    verticalBar: "kreska pionowa",
    fallback: "nieczytelne twierdzenie",
    empty: "puste twierdzenie",
  },
};

export function normalizeLocale(value) {
  const raw = String(value ?? "").toLowerCase().slice(0, 2);
  return LOCALES.includes(raw) ? raw : "en";
}

export function conventions(locale) {
  return CONVENTIONS[normalizeLocale(locale)];
}

export function words(locale) {
  return WORDS[normalizeLocale(locale)];
}

let activeLocale = "en";

export function getLocale() {
  return activeLocale;
}

/** Set the locale every render defaults to. Returns true when it actually changed. */
export function setLocale(value) {
  const next = normalizeLocale(value);
  if (next === activeLocale) return false;
  activeLocale = next;
  return true;
}

// The locale signal is the shared vocabulary; nothing here imports a sibling feature.
signals.on("ui:locale", (payload) => setLocale(payload?.locale ?? payload));

// ---------------------------------------------------------------- source localization

// \text{...} is translated copy, owned by the locale files. Its interior is copied verbatim:
// a decimal point inside a translated sentence is that translator's problem, not ours.
const VERBATIM_GROUPS = new Set([
  "text",
  "textrm",
  "textbf",
  "textit",
  "textsf",
  "texttt",
  "textnormal",
  "mbox",
]);

function readBalancedGroup(src, start) {
  if (src[start] !== "{") return { raw: "", end: start };
  let depth = 0;
  let i = start;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return { raw: src.slice(start, i + 1), end: i + 1 };
    }
  }
  return { raw: src.slice(start), end: src.length };
}

function groupDigits(digits, c) {
  if (digits.length < c.groupFrom) return { tex: digits, plain: digits };
  const parts = [];
  for (let i = digits.length; i > 0; i -= 3) parts.unshift(digits.slice(Math.max(0, i - 3), i));
  return { tex: parts.join(c.groupTex), plain: parts.join(c.groupChar) };
}

/**
 * Rewrite a source expression into one locale's conventions. Deliberately a scanner rather
 * than a pile of regexes: a regex that turns `3.5` into `3{,}5` also turns `\text{3.5}` into
 * it, and one that maps `\times` also maps `\timesomething`.
 */
export function localizeTex(tex, locale) {
  const c = conventions(locale);
  const src = String(tex ?? "");
  let out = "";
  let i = 0;

  while (i < src.length) {
    const ch = src[i];

    if (ch === "\\") {
      const m = /^\\([a-zA-Z]+|[\s\S])/.exec(src.slice(i));
      if (!m) {
        out += ch;
        i++;
        continue;
      }
      const name = m[1];
      i += m[0].length;
      if (VERBATIM_GROUPS.has(name)) {
        const group = readBalancedGroup(src, i);
        out += m[0] + group.raw;
        i = group.end;
        continue;
      }
      if (name === "times" && c.timesTex) out += c.timesTex;
      else if (name === "div" && c.divTex) out += c.divTex;
      else out += m[0];
      continue;
    }

    if (ch >= "0" && ch <= "9") {
      const m = /^(\d+)(?:\.(\d+))?/.exec(src.slice(i));
      const whole = groupDigits(m[1], c).tex;
      out += m[2] ? whole + c.decimalTex + m[2] : whole;
      i += m[0].length;
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

/** The same rewrite for a bare number — what a HUD counter or a plaque needs. */
export function localizeNumber(value, locale) {
  const c = conventions(locale);
  if (!Number.isFinite(Number(value))) return String(value);
  const [whole, frac] = String(value).split(".");
  const sign = whole.startsWith("-") ? "-" : "";
  const digits = sign ? whole.slice(1) : whole;
  const grouped = groupDigits(digits, c).plain;
  return sign + (frac ? grouped + c.decimalChar + frac : grouped);
}

// ---------------------------------------------------------------- parse-tree readers

const REL_WORDS = {
  "=": "equals",
  "\\ne": "notEquals",
  "\\neq": "notEquals",
  "≠": "notEquals",
  "<": "lt",
  ">": "gt",
  "\\lt": "lt",
  "\\gt": "gt",
  "\\le": "le",
  "\\leq": "le",
  "\\ge": "ge",
  "\\geq": "ge",
  "\\approx": "approx",
};

const BIN_WORDS = {
  "+": "plus",
  "-": "minus",
  "−": "minus",
  "\\pm": "plusMinus",
  "\\cdot": "times",
  "\\times": "times",
  "\\div": "dividedBy",
  ":": "dividedBy",
};

const REL_PLAIN = {
  "=": "=",
  "\\ne": "!=",
  "\\neq": "!=",
  "≠": "!=",
  "<": "<",
  ">": ">",
  "\\lt": "<",
  "\\gt": ">",
  "\\le": "<=",
  "\\leq": "<=",
  "\\ge": ">=",
  "\\geq": ">=",
  "\\approx": "~=",
};

const BIN_PLAIN = {
  "+": "+",
  "-": "-",
  "−": "-",
  "\\pm": "+-",
  "\\cdot": "*",
  "\\times": "*",
  "\\div": "/",
  ":": "/",
};

const OTHER_WORDS = {
  "(": "open",
  ")": "close",
  "[": "openBracket",
  "]": "closeBracket",
  "\\%": "percent",
  "%": "percent",
  "\\infty": "infinity",
  "∞": "infinity",
  "\\pi": "pi",
  "π": "pi",
  "\\circ": "degrees",
  // A bare bar, which the bank uses to separate groups of like terms. The absolute-value
  // reading is not this: that comes from `leftright`, which checks for a bar before it ever
  // consults this table.
  "\\mid": "verticalBar",
  "\\vert": "verticalBar",
  "|": "verticalBar",
};

// Nodes that are pure layout: they carry no sound and no character.
const TRANSPARENT = new Set(["kern", "spacing", "phantom", "hphantom", "vphantom", "smash", "raw"]);
const WRAPPERS = [
  "ordgroup",
  "styling",
  "color",
  "sizing",
  "font",
  "mclass",
  "raisebox",
  "hbox",
  "vcenter",
  "overline",
  "underline",
  "operatorname",
];

function isDigitNode(n) {
  return n && (n.type === "textord" || n.type === "mathord") && /^[0-9]$/.test(n.text ?? "");
}

/** The bare mark carried by a node that could be a decimal point or a thousands separator. */
function markAt(nodes, i) {
  const n = nodes[i];
  if (!n) return null;
  if ((n.type === "textord" || n.type === "atom") && (n.text === "." || n.text === ",")) return n.text;
  if (n.type === "ordgroup" && n.body?.length === 1) {
    const inner = n.body[0];
    if (inner && (inner.text === "," || inner.text === ".")) return inner.text;
  }
  return null;
}

/**
 * Scan one numeral starting at `i`. Kerns (which is what the thin space in `16\,004` is)
 * are transparent, so a grouped numeral reads as one number rather than as two.
 *
 * The locale has to come in here, and this is the reason: after `localizeTex`, EN's
 * `16{,}000` and ES's `3{,}5` are the *same parse tree shape* with completely different
 * meanings. Read without conventions, EN 16,000 came out as "16 point 000". A comma is a
 * decimal mark only where the locale says it is.
 */
function readNumeral(nodes, i, c) {
  let whole = "";
  let frac = null;
  let j = i;
  let sawDecimal = false;
  while (j < nodes.length) {
    const n = nodes[j];
    if (TRANSPARENT.has(n?.type)) {
      j++;
      continue;
    }
    if (isDigitNode(n)) {
      if (sawDecimal) frac += n.text;
      else whole += n.text;
      j++;
      continue;
    }
    const mark = markAt(nodes, j);
    if (mark && whole && isDigitNode(nodes[j + 1])) {
      if (!sawDecimal && mark === c.decimalChar) {
        sawDecimal = true;
        frac = "";
        j++;
        continue;
      }
      // A separator that is not this locale's decimal mark is grouping: swallow it.
      if (mark !== c.decimalChar && !sawDecimal) {
        j++;
        continue;
      }
    }
    break;
  }
  if (!whole) return null;
  return { whole, frac, end: j, decimal: sawDecimal };
}

function unaryPosition(nodes, i) {
  for (let j = i - 1; j >= 0; j--) {
    const p = nodes[j];
    if (TRANSPARENT.has(p?.type)) continue;
    if (p.type === "atom") return p.family === "rel" || p.family === "bin" || p.family === "open" || p.family === "punct";
    return false;
  }
  return true;
}

/** Localized spoken form. Never contains a backslash; that is the whole point of it. */
function speakList(nodes, w, c, out) {
  if (!Array.isArray(nodes)) return speakNode(nodes, w, c, out);
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (!n || TRANSPARENT.has(n.type)) continue;

    const num = readNumeral(nodes, i, c);
    if (num) {
      // Ungrouped on purpose: a speech engine says "sixteen thousand" for 16000 and
      // "sixteen, zero, zero, zero" for a separated one.
      out.push(num.decimal ? `${num.whole} ${w.decimal} ${num.frac}` : num.whole);
      i = num.end - 1;
      continue;
    }

    if (n.type === "atom" && n.family === "bin" && (n.text === "-" || n.text === "−") && unaryPosition(nodes, i)) {
      out.push(w.negative);
      continue;
    }

    speakNode(n, w, c, out);
  }
  return out;
}

/**
 * Push a literal token — unless it is a control sequence this reader has no word for.
 *
 * Nothing with a backslash in it may reach an accessible name, and "we listed every symbol
 * the content uses" is not a guarantee, it is a hope: `\mid` leaked into 288 spoken forms in
 * the shipped bank and the fixture-based check never saw it, because the fixtures did not use
 * it. So an unknown command is dropped rather than voiced, and recorded in `UNSPOKEN`, which
 * `texStats()` publishes — a silent gap that a reviewer can see beats a leak nobody can.
 */
function sayLiteral(text, out) {
  const t = String(text ?? "");
  if (!t) return out;
  if (t.startsWith("\\") || /[{}^_]/.test(t)) {
    UNSPOKEN.add(t);
    return out;
  }
  out.push(t);
  return out;
}

function speakNode(n, w, c, out) {
  if (!n) return out;
  if (TRANSPARENT.has(n.type)) return out;

  switch (n.type) {
    case "atom": {
      const key = REL_WORDS[n.text] ?? BIN_WORDS[n.text] ?? OTHER_WORDS[n.text];
      if (key) out.push(w[key]);
      else sayLiteral(n.text, out);
      return out;
    }
    case "mathord":
    case "textord": {
      const key = OTHER_WORDS[n.text] ?? REL_WORDS[n.text] ?? BIN_WORDS[n.text];
      if (key) out.push(w[key]);
      else sayLiteral(n.text, out);
      return out;
    }
    case "supsub": {
      speakNode(n.base, w, c, out);
      if (n.sub) {
        out.push(w.sub);
        speakList(n.sub.body ?? n.sub, w, c, out);
      }
      if (n.sup) {
        const flat = [];
        speakList(n.sup.body ?? n.sup, w, c, flat);
        const joined = flat.join(" ");
        if (joined === "2") out.push(w.squared);
        else if (joined === "3") out.push(w.cubed);
        else out.push(w.power, joined);
      }
      return out;
    }
    case "genfrac": {
      // A single-token part needs no marker ("1 over 2"); a compound one does, or
      // "x plus 1 over 2" is two different fractions depending on who is listening.
      speakPart(n.numer?.body ?? n.numer, w, c, out);
      out.push(w.over);
      speakPart(n.denom?.body ?? n.denom, w, c, out);
      return out;
    }
    case "sqrt": {
      out.push(w.sqrt);
      speakList(n.body?.body ?? n.body, w, c, out);
      return out;
    }
    case "leftright":
    case "leftright-right": {
      const isBar = n.left === "|" || n.left === "\\vert";
      out.push(isBar ? w.absOpen : w[OTHER_WORDS[n.left] ?? "open"] ?? w.open);
      speakList(n.body, w, c, out);
      if (isBar) out.push(w.absClose);
      else out.push(w[OTHER_WORDS[n.right] ?? "close"] ?? w.close);
      return out;
    }
    case "text": {
      // Translated copy inside an expression: read the characters as written.
      const flat = (n.body ?? []).map((b) => b.text ?? "").join("");
      if (flat.trim()) out.push(flat.trim());
      return out;
    }
    case "htmlmathml":
      // \ne and friends: the MathML branch is the semantic one.
      return speakList(n.mathml ?? n.html, w, c, out);
    case "lap":
      return out;
    default: {
      if (WRAPPERS.includes(n.type)) return speakList(n.body ?? [], w, c, out);
      if (Array.isArray(n.body)) return speakList(n.body, w, c, out);
      if (n.body) return speakNode(n.body, w, c, out);
      if (n.text) sayLiteral(n.text, out);
      UNSPOKEN.add(n.type);
      return out;
    }
  }
}

function speakPart(nodes, w, c, out) {
  const flat = [];
  speakList(nodes, w, c, flat);
  if (flat.length > 1) out.push(w.open, ...flat, w.close);
  else out.push(...flat);
  return out;
}

/** Node types this reader met and had no rule for. Published, so the gap is visible. */
const UNSPOKEN = new Set();

/**
 * Locale-neutral linearization. This is the string an answer comparison uses, so it is
 * canonical on purpose: always a decimal point, never a thousands separator, `<=` for `\le`.
 */
function plainList(nodes, c) {
  if (!Array.isArray(nodes)) return plainNode(nodes, c);
  let out = "";
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (!n || TRANSPARENT.has(n.type)) continue;
    const num = readNumeral(nodes, i, c);
    if (num) {
      out += num.decimal ? `${num.whole}.${num.frac}` : num.whole;
      i = num.end - 1;
      continue;
    }
    out += plainNode(n, c);
  }
  return out;
}

function plainNode(n, c) {
  if (!n || TRANSPARENT.has(n.type)) return "";
  switch (n.type) {
    case "atom":
    case "mathord":
    case "textord": {
      const t = n.text ?? "";
      return REL_PLAIN[t] ?? BIN_PLAIN[t] ?? (t.startsWith("\\") ? t.slice(1) : t);
    }
    case "supsub": {
      let s = plainNode(n.base, c);
      if (n.sub) s += `_${wrapPlain(plainList(n.sub.body ?? n.sub, c))}`;
      if (n.sup) s += `^${wrapPlain(plainList(n.sup.body ?? n.sup, c))}`;
      return s;
    }
    case "genfrac":
      return `(${plainList(n.numer?.body ?? n.numer, c)})/(${plainList(n.denom?.body ?? n.denom, c)})`;
    case "sqrt":
      return `sqrt(${plainList(n.body?.body ?? n.body, c)})`;
    case "leftright":
      return `${n.left === "\\vert" ? "|" : n.left}${plainList(n.body, c)}${n.right === "\\vert" ? "|" : n.right}`;
    case "text":
      return (n.body ?? []).map((b) => b.text ?? "").join("");
    case "htmlmathml":
      return plainList(n.mathml ?? n.html, c);
    case "lap":
      return "";
    default:
      if (Array.isArray(n.body)) return plainList(n.body, c);
      if (n.body) return plainNode(n.body, c);
      return n.text ?? "";
  }
}

function wrapPlain(s) {
  return s.length > 1 ? `(${s})` : s;
}

function tidySpeech(tokens, w) {
  const text = tokens
    .map((t) => String(t ?? "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return text || w.empty;
}

// ---------------------------------------------------------------- strict settings

function settings(displayMode) {
  return {
    displayMode: !!displayMode,
    // "html" and not "htmlAndMathml": the MathML branch carries
    // <annotation encoding="application/x-tex">…</annotation>, which is the source string
    // sitting in the document waiting to be read out or scraped. We supply our own
    // accessible name instead, so nothing is lost and the leak cannot happen.
    output: "html",
    throwOnError: true,
    strict: "error",
    trust: false,
    macros: {}, // fresh each call: KaTeX mutates this object with \gdef
    maxSize: 12,
    maxExpand: 200,
    // Keeps a fraction bar from disappearing when a claim is rasterized small and then
    // mip-mapped down at gameplay distance.
    minRuleThickness: 0.055,
  };
}

// ---------------------------------------------------------------- validation (offline safe)

/**
 * Does this typeset, and what does it say? Pure: no DOM, no cache, no error reporting.
 * This is the function a content lint calls in Node.
 */
export function validate(tex, { locale = activeLocale, displayMode = false } = {}) {
  const loc = normalizeLocale(locale);
  const source = String(tex ?? "");
  const result = {
    ok: false,
    tex: source,
    localizedTex: "",
    locale: loc,
    displayMode: !!displayMode,
    text: "",
    speech: "",
    depth: null,
    nodes: null,
    error: null,
  };

  // The length gate goes first, ahead of `localizeTex` and a long way ahead of the parser.
  // `localizeTex` is a character-by-character scanner that allocates a rewritten copy, so
  // running it on a 20,000-character string before deciding to refuse it would mean the gate
  // costs O(n) of the very thing it exists to avoid. Measured: refusing three locales' worth
  // of a 20,000-character claim costs under a fifth of a millisecond this way.
  if (source.length > MAX_TEX_LENGTH) {
    result.error = `expression too long: ${source.length} characters, cap ${MAX_TEX_LENGTH}`;
    return result;
  }

  if (!source.trim()) {
    result.error = "empty expression";
    return result;
  }

  const localized = localizeTex(source, loc);
  result.localizedTex = localized;

  // `trust:false` makes KaTeX render these *without* their effect rather than complain, so a
  // content author would never learn their markup was silently dropped. Refuse instead: an
  // expression in this game is mathematics, and nothing here needs a link or an image.
  const forbidden = /\\(href|url|includegraphics|htmlClass|htmlId|htmlStyle|htmlData)\b/.exec(source);
  if (forbidden) {
    result.error = `command not permitted in a claim: ${forbidden[0]}`;
    return result;
  }

  try {
    const c = conventions(loc);
    const tree = katex.__parse(localized, settings(displayMode));

    // Between the parse and the typesetting, which is the only window where this can be
    // caught. Parsing deep nesting is safe and cheap; laying it out is what kills the
    // renderer, and `renderToString` is the step that produces the HTML that gets laid out.
    const shape = treeShape(tree);
    result.depth = shape.depth;
    result.nodes = shape.nodes;
    if (shape.depth > MAX_TEX_DEPTH) {
      result.error = `expression nested too deeply: depth ${shape.depth}, cap ${MAX_TEX_DEPTH}`;
      return result;
    }

    result.text = plainList(tree, c).replace(/\s+/g, " ").trim();
    result.speech = tidySpeech(speakList(tree, words(loc), c, []), words(loc));
    // Parsing is necessary but not sufficient — the builder can still refuse. Typeset it.
    const html = katex.renderToString(localized, settings(displayMode));
    // Belt and braces. `trust:false` already strips \href and \includegraphics, but this
    // HTML is handed to innerHTML and to a canvas rasterizer, so the output is checked
    // rather than assumed. A hit here means KaTeX changed under us.
    const unsafe = /javascript:|<script|\son[a-z]+\s*=|data:text\/html/i.exec(html);
    if (unsafe) throw new Error(`refused unsafe markup in output: ${unsafe[0]}`);
    result.ok = true;
  } catch (err) {
    result.error = err instanceof katex.ParseError ? err.message : String(err?.message || err);
  }
  return result;
}

/**
 * Lint a whole bank offline. `entries` is `[{ id, tex, displayMode }]`.
 * Returns a machine-readable report; a non-empty `failures` array is a build failure.
 */
export function lintTexBank(entries, { locales = LOCALES } = {}) {
  const failures = [];
  const rows = [];
  for (const entry of entries ?? []) {
    for (const locale of locales) {
      const v = validate(entry.tex, { locale, displayMode: entry.displayMode });
      rows.push({ id: entry.id ?? null, locale, ok: v.ok, text: v.text, speech: v.speech, error: v.error });
      if (!v.ok) failures.push({ id: entry.id ?? null, locale, tex: entry.tex, error: v.error });
      else if (/\\[a-zA-Z]/.test(v.speech)) {
        failures.push({ id: entry.id ?? null, locale, tex: entry.tex, error: `spoken form leaked TeX: ${v.speech}` });
      }
    }
  }
  return { checked: rows.length, failures, rows };
}

// ---------------------------------------------------------------- render + cache

const CACHE = new Map();
const MAX_CACHE = 600;
const FAILURES = [];
const STATS = { requests: 0, hits: 0, misses: 0, typesets: 0, failures: 0, evictions: 0, typesetMs: 0 };

/** The visible stand-in for an expression that would not typeset. Never the source. */
export const FALLBACK_TEX = "\\square";

let fallbackHtml = null;
function safeFallbackHtml() {
  if (fallbackHtml !== null) return fallbackHtml;
  try {
    fallbackHtml = katex.renderToString(FALLBACK_TEX, settings(false));
  } catch {
    // KaTeX itself is broken. Still not the source string.
    fallbackHtml = '<span class="vs-tex-hollow">□</span>';
  }
  return fallbackHtml;
}

/**
 * The record a refused claim gets, wherever the refusal came from.
 *
 * Exported because refusal is not only a parsing concern. `TexPanel` refuses a claim whose
 * *geometry* it cannot bound — one whose ink would stand forty metres wide in the world, or
 * whose raster would not fit the allocation cap — and a player has to meet exactly one
 * refusal behaviour whatever the reason: the hollow stand-in, a spoken form that says the
 * claim is unreadable, the source withheld, and a line in `__vs.errors` so a build cannot
 * ship it quietly.
 *
 * `report:false` exists so a panel that re-rasterizes at a new size does not push the same
 * refusal into `__vs.errors` once per size bucket.
 */
export function refusedRecord(source, { locale = activeLocale, displayMode = false, error = "refused", report = true } = {}) {
  const loc = normalizeLocale(locale);
  const w = words(loc);
  const src = String(source ?? "");
  if (report) {
    STATS.failures++;
    introspect.errors.push(
      `KaTeX refused a claim [${loc}${displayMode ? ",display" : ""}]: ${error} — source withheld from the world, fallback shown`
    );
    // Truncated on purpose: this list is published through `__vs.probe("tex")`, and a probe
    // that carries fifty copies of a 20,000-character attack string is its own denial of
    // service against whoever is reading the report.
    if (FAILURES.length < 50) {
      FAILURES.push({
        locale: loc,
        displayMode: !!displayMode,
        tex: src.length > 120 ? `${src.slice(0, 120)}… (${src.length} chars)` : src,
        error,
      });
    }
  }
  return {
    ok: false,
    key: null,
    tex: src,
    localizedTex: "",
    locale: loc,
    displayMode: !!displayMode,
    html: safeFallbackHtml(),
    text: "",
    speech: w.fallback,
    error,
  };
}

function remember(key, record) {
  CACHE.set(key, record);
  while (CACHE.size > MAX_CACHE) {
    const oldest = CACHE.keys().next().value;
    CACHE.delete(oldest);
    STATS.evictions++;
  }
  return record;
}

/**
 * Typeset one expression. Always returns a usable record — `ok:false` means the player is
 * looking at the fallback glyph and `__vs.errors` has the reason.
 */
export function render(tex, { locale = activeLocale, displayMode = false } = {}) {
  const loc = normalizeLocale(locale);
  const source = String(tex ?? "");
  // An over-length source is refused *and not retained*. Caching the refusal is what stops a
  // caller re-requesting it every frame from re-pushing the same line into `__vs.errors`; but
  // the cache must not become the place a 20,000-character attack string lives, so neither the
  // key nor the cached record keeps a copy of a string whose only property was its size.
  const oversize = source.length > MAX_TEX_LENGTH;
  const kept = oversize ? `#${source.length}:${source.slice(0, 64)}` : source;
  const key = `${loc} ${displayMode ? "d" : "i"} ${kept}`;

  STATS.requests++;
  const cached = CACHE.get(key);
  if (cached) {
    STATS.hits++;
    return cached;
  }
  STATS.misses++;

  const v = validate(source, { locale: loc, displayMode });
  const t0 = now();

  if (!v.ok) {
    // __vs.errors is what makes review.mjs mark the frame unreviewable. A malformed claim is
    // a content bug and must stop a build; it must never be a thing a player quietly sees.
    const rec = refusedRecord(oversize ? kept : source, { locale: loc, displayMode, error: v.error });
    rec.key = key;
    rec.localizedTex = oversize ? "" : v.localizedTex;
    return remember(key, rec);
  }

  let html;
  try {
    html = katex.renderToString(v.localizedTex, settings(displayMode));
    STATS.typesets++;
  } catch (err) {
    // validate() already typeset this once, so reaching here means something non-deterministic
    // broke. Treat it exactly like a refusal rather than letting an exception escape a frame.
    STATS.failures++;
    introspect.errors.push(`KaTeX builder failed after a clean parse [${loc}]: ${String(err?.message || err)}`);
    html = safeFallbackHtml();
    const w = words(loc);
    return remember(key, {
      ok: false,
      key,
      tex: source,
      localizedTex: v.localizedTex,
      locale: loc,
      displayMode: !!displayMode,
      html,
      text: v.text,
      speech: w.fallback,
      error: String(err?.message || err),
    });
  }
  STATS.typesetMs += now() - t0;

  return remember(key, {
    ok: true,
    key,
    tex: source,
    localizedTex: v.localizedTex,
    locale: loc,
    displayMode: !!displayMode,
    html,
    text: v.text,
    speech: v.speech,
    error: null,
  });
}

function now() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/**
 * Put an already-decided record into a DOM element. The KaTeX HTML is hidden from assistive
 * technology and the container carries the spoken form, so a screen reader reads the
 * mathematics and never the notation.
 *
 * Split out from `renderInto` because a record is not always the one `render` would produce
 * from the source. `TexPanel` refuses claims for reasons this file cannot see — ink extent,
 * raster size — and when it does, the accessible register has to show *that* record and not
 * the one the source would have earned. A critic caught the divergence: a 2,000-character
 * claim the world had already refused was still reading `"1 plus 1 plus 1 plus…"` out of the
 * live DOM. Property 1 at the top of this file says the two must never differ, so the caller
 * that made the decision passes the decision in.
 */
export function applyRecord(el, rec) {
  if (!el || !rec) return rec;
  el.setAttribute("role", "math");
  el.setAttribute("aria-label", rec.speech);
  el.setAttribute("data-vs-tex", rec.ok ? "ok" : "fallback");
  el.setAttribute("lang", rec.locale);
  el.innerHTML = `<span aria-hidden="true">${rec.html}</span>`;
  return rec;
}

/** The common case: typeset a source and show whatever that produced. */
export function renderInto(el, tex, opts = {}) {
  return applyRecord(el, render(tex, opts));
}

export function texStats() {
  return {
    ...STATS,
    typesetMs: Number(STATS.typesetMs.toFixed(2)),
    cacheSize: CACHE.size,
    locale: activeLocale,
    unspokenNodeTypes: [...UNSPOKEN],
  };
}

export function texFailures() {
  return FAILURES.slice(0, 10);
}

/** Test hook. Never called by gameplay. */
export function resetTex() {
  CACHE.clear();
  FAILURES.length = 0;
  UNSPOKEN.clear();
  for (const k of Object.keys(STATS)) STATS[k] = 0;
}
