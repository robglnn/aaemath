/**
 * ItemBank — the item bank the mastery engine is served from.
 *
 * Owned by P17. Four jobs and nothing else:
 *
 *   1. LOAD    the committed catalogue (`content/items/bank/*.json`, 768 items) and the
 *              generator families behind it, so the bank cannot run dry mid-session.
 *   2. INDEX   by knowledge point, form, difficulty band and — the one the teaching director
 *              actually needs — by misconception, because §4 of design/learning-architecture.md
 *              says the item after an error is drawn from variants whose distractor space
 *              contains that misconception.
 *   3. SELECT  what the scheduler asks for, honouring exclusions (no exact repeat inside a
 *              session) and falling back to a freshly generated item rather than repeating.
 *   4. CHECK   an answer, in exact rational arithmetic, accepting every honest spelling of it —
 *              `x=4`, `4`, `4.0`, `4,0`, `+4`, `8/2` are one response. What is accepted is
 *              written down in `content/items/README.md` and asserted in review/measure/P17.mjs;
 *              it is never "whatever the parser happened to do".
 *
 * No DOM, no three, no kernel state. A pure service, so P16 can drive it in a simulation with
 * no browser at all — which is what makes L4 and L5 measurable offline.
 */

import { BANK, BANK_INDEX, STRINGS } from "../../../content/items/index.mjs";
import { generateOne, generateForKp, TIERS } from "../../../content/items/generators.mjs";
import {
  rat,
  rstr,
  rcmp,
  req,
  R0,
  parseExpr,
  parseStatement,
  canonNumber,
  canonExpr,
  canonEquation,
  canonInequality,
  canonPair,
  canonPartition,
  canonRepair,
  canonRepairAll,
  polyStr,
  polySubst,
  polyIsConst,
  polyConstValue,
  surfaceTerms,
  isGathered,
  solveLinear,
} from "../../../content/items/kit.mjs";

/* ------------------------------------------------------------------ locale text */

const LOCALES = ["en", "es", "pl"];

/**
 * Words a learner may type for the two closures that are not numbers. Every locale's words are
 * accepted in every locale: a bilingual player typing "siempre" into an English session is
 * right, and refusing them would be a scoring bug wearing a language policy.
 */
const CLOSURE_WORDS = {
  always: [
    "always", "every", "every value", "any", "any value", "all", "an always", "identity",
    "siempre", "un siempre", "cualquiera", "cualquier valor", "todos", "todo valor",
    "zawsze", "kazda", "każda", "kazdy", "każdy", "dowolna", "dowolny",
  ],
  none: [
    "none", "no value", "nothing", "a refusal", "refusal", "never", "empty",
    "ninguno", "ninguna", "ningun valor", "ningún valor", "nada", "rechazo", "un rechazo",
    "zaden", "żaden", "zadna", "żadna", "nic", "odmowa", "brak",
  ],
};

function foldWord(s) {
  return String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[łŁ]/g, "l")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
}

const CLOSURE_FOLDED = {
  always: new Set(CLOSURE_WORDS.always.map(foldWord)),
  none: new Set(CLOSURE_WORDS.none.map(foldWord)),
};

/** ES and PL write a decimal comma. Integers and fractions are untouched, which is most of it. */
function localeNumber(value, locale) {
  const s = String(value);
  return locale === "en" ? s : s.replace(".", ",");
}

/* ------------------------------------------------------------------ the bank */

export class ItemBank {
  #byId = new Map();
  #byKp = new Map();
  #byKpMisconception = new Map();
  #meta = new Map();
  #generated = 0;

  constructor({ locale = "en" } = {}) {
    this.locale = LOCALES.includes(locale) ? locale : "en";
    for (const file of BANK) {
      this.#meta.set(file.kpId, {
        kpId: file.kpId,
        band: file.band,
        strand: file.strand,
        objectClass: file.objectClass,
        standards: file.standards,
        misconceptions: file.misconceptions,
      });
      const list = [];
      for (const item of file.items) {
        this.#byId.set(item.id, item);
        list.push(item);
        for (const d of item.distractors) {
          const key = `${file.kpId}|${d.misconception}`;
          if (!this.#byKpMisconception.has(key)) this.#byKpMisconception.set(key, []);
          this.#byKpMisconception.get(key).push(item);
        }
      }
      this.#byKp.set(file.kpId, list);
    }
  }

  setLocale(locale) {
    if (LOCALES.includes(locale)) this.locale = locale;
    return this.locale;
  }

  knowledgePoints() {
    return [...this.#byKp.keys()];
  }

  meta(kpId) {
    return this.#meta.get(kpId) || null;
  }

  item(id) {
    return this.#byId.get(id) || null;
  }

  /** Everything on one knowledge point, optionally narrowed. Never mutated by callers. */
  forKp(kpId, { form = null, difficulty = null, misconception = null, exclude = null } = {}) {
    let list = misconception
      ? this.#byKpMisconception.get(`${kpId}|${misconception}`) || []
      : this.#byKp.get(kpId) || [];
    if (form) list = list.filter((i) => i.form === form);
    if (difficulty != null) list = list.filter((i) => i.difficulty === difficulty);
    if (exclude) list = list.filter((i) => !has(exclude, i.id));
    return list;
  }

  /**
   * What the scheduler calls. Narrow first, then relax in a fixed order so the caller always
   * knows what it got: exact difficulty, then nearest difficulty, then any difficulty on the
   * requested form. The form is never relaxed — `model.forms.scored` decides whether an item
   * scores at all, so quietly swapping one in would corrupt the mastery gate.
   *
   * When nothing survives the exclusion set, a fresh item is generated rather than a repeat
   * served. That is the whole reason the generators exist.
   */
  select({
    kpId,
    form = "construct",
    difficulty = null,
    misconception = null,
    exclude = null,
    seed = null,
  } = {}) {
    const relaxations = [];
    if (misconception) {
      relaxations.push({ form, difficulty, misconception, why: "targeted" });
      if (difficulty != null) relaxations.push({ form, difficulty: null, misconception, why: "targeted-any-band" });
    }
    relaxations.push({ form, difficulty, misconception: null, why: "exact" });
    if (difficulty != null) {
      for (const d of [difficulty - 1, difficulty + 1, difficulty - 2, difficulty + 2]) {
        if (d >= 1 && d <= 5) relaxations.push({ form, difficulty: d, misconception: null, why: "nearest-band" });
      }
    }
    relaxations.push({ form, difficulty: null, misconception: null, why: "any-band" });

    for (const r of relaxations) {
      const pool = this.forKp(kpId, {
        form: r.form,
        difficulty: r.difficulty,
        misconception: r.misconception,
        exclude,
      });
      if (pool.length) {
        const pick = pool[pickIndex(seed ?? hashOf(kpId + r.why + (exclude ? sizeOf(exclude) : 0)), pool.length)];
        return { item: pick, source: "catalogue", relaxation: r.why };
      }
    }

    const fresh = this.fresh({ kpId, form, difficulty, seed, exclude });
    return fresh ? { item: fresh, source: "generated", relaxation: "generated" } : null;
  }

  /** A brand-new item from the generator families. Deterministic in `seed`. */
  fresh({ kpId, form = "construct", difficulty = null, seed = null, exclude = null } = {}) {
    const meta = this.#meta.get(kpId);
    if (!meta) return null;
    const band = meta.band;
    const tier =
      difficulty == null
        ? "core"
        : difficulty < band
          ? "easy"
          : difficulty > band
            ? "stretch"
            : "core";
    const base = seed == null ? 0x5eed ^ this.#generated : seed;
    for (let attempt = 0; attempt < 400; attempt++) {
      const item = generateOne(kpId, {
        form,
        tier: TIERS.includes(tier) ? tier : "core",
        band,
        seed: (base + attempt * 7919 + sizeOf(exclude) * 104729) >>> 0,
      });
      if (!item) continue;
      if (exclude && has(exclude, item.id)) continue;
      this.#generated++;
      const withStandards = { ...item, standards: meta.standards };
      this.#byId.set(item.id, withStandards);
      return withStandards;
    }
    return null;
  }

  /* ---------------------------------------------------------------- presentation */

  /** Resolve one locale key with its parameters. Never falls back to English (G3). */
  text(key, params = {}, locale = this.locale) {
    const entry = STRINGS[key];
    if (!entry) return `⟨${key}⟩`;
    const src = entry[locale] ?? entry.en;
    return src.replace(/\{(\w+)\}/g, (m, name) =>
      params[name] === undefined ? m : localeNumber(params[name], locale)
    );
  }

  /**
   * Everything a verb needs to put an item in the world, already localized. TeX comes through
   * untouched — P15 typesets it; nothing here ever writes TeX into a text surface (G2).
   */
  present(item, locale = this.locale) {
    return {
      id: item.id,
      kpId: item.kpId,
      form: item.form,
      difficulty: item.difficulty,
      objectClass: item.objectClass,
      tex: {
        stem: item.stem,
        given: item.given || [],
        working: item.working || null,
      },
      framing: this.text(item.worldFraming.key, item.worldFraming.params, locale),
      ask: this.text(item.ask.key ?? item.ask, item.ask.params ?? item.hintParams ?? {}, locale),
      spoken: item.spoken ? this.text(item.spoken.key, item.spoken.params, locale) : null,
      story: item.story ? this.text(item.story.key, item.story.params, locale) : null,
      hints: (item.hints || []).map((h) => this.text(h.key, h.params, locale)),
      answerType: item.answerType,
      unknown: item.unknown,
    };
  }

  /* ---------------------------------------------------------------- checking */

  /**
   * The documented acceptance set for an item, as example strings. Kept next to the checker on
   * purpose: a claim about what is accepted that is not executed is a claim nobody can trust.
   */
  accepts(item) {
    const a = item.answer;
    switch (item.answerType) {
      case "integer":
      case "rational": {
        const out = [a.canonical, `${item.unknown} = ${a.canonical}`, `${item.unknown}=${a.canonical}`];
        if (!a.canonical.includes("/")) {
          out.push(`${a.canonical}.0`, `${a.canonical},0`, `+${a.canonical}`.replace("+-", "-"));
        }
        return out;
      }
      case "expression":
        return [a.tex, a.canonical.replace(/\*/g, ""), a.tex.replace(/\\cdot/g, "*")];
      case "equation":
        return [a.tex, a.tex.replace(/=/, " = "), flipEquation(a.tex)];
      case "inequality":
        return [a.tex, a.tex.replace(/\\le/, "<=").replace(/\\ge/, ">="), flipInequality(a.tex)];
      case "pair":
        return [a.tex, a.canonical.replace(/;/g, ", ")];
      case "partition":
        return [a.tex, a.canonical.replace(/\|/g, " | ")];
      case "valueSet":
        return [a.canonical, a.canonical.replace(/,/g, "; ")];
      case "closure":
        return a.canonical === "always"
          ? ["always", "siempre", "zawsze"]
          : ["none", "ninguno", "żaden"];
      case "repair":
        return [`${a.line}: ${a.tex}`, `#${a.line} ${a.tex}`, `line ${a.line} = ${a.tex}`];
      case "construction":
        return [a.canonical];
      default:
        return [a.canonical];
    }
  }

  /**
   * Mark a response.
   *
   * Returns { correct, canonical, misconception, failKey, reason }.
   *   `misconception` is set only when the response matches a declared distractor exactly.
   *   `reason` is a machine-readable note for the teaching director, never a player string.
   */
  check(item, response, { locale = this.locale } = {}) {
    const raw = String(response ?? "").trim();
    if (!raw) return miss("empty");

    if (item.form === "generate" && item.check) {
      return this.#checkConstruction(item, raw);
    }

    let canon;
    try {
      canon = this.#canonicalize(item, raw);
    } catch (err) {
      return miss("unreadable", { detail: String(err.message || err) });
    }

    // Correct, unless the knowledge point is about the surface and the surface is not there.
    if (canon.primary === item.answer.canonical) {
      if (item.requiresGathered && !isGathered(raw)) {
        const d = (item.distractors || []).find((x) => x.surface);
        return {
          correct: false,
          canonical: canon.primary,
          misconception: d ? d.misconception : "stops-before-fully-simplified",
          failKey: d ? d.failKey : "fail.load.unsettled",
          reason: "equivalent-but-ungathered",
        };
      }
      return { correct: true, canonical: canon.primary, misconception: null, failKey: null, reason: "exact" };
    }

    for (const d of item.distractors || []) {
      if (d.surface) continue;
      if (canon.all.includes(d.response)) {
        return {
          correct: false,
          canonical: canon.primary,
          misconception: d.misconception,
          failKey: d.failKey,
          reason: "distractor",
        };
      }
    }

    return miss("unmatched", { canonical: canon.primary, near: this.#near(item, canon.primary) });
  }

  /** Every reading of the response the item's distractors could plausibly be written in. */
  #canonicalize(item, raw) {
    const unknown = item.unknown || "x";
    const all = [];
    const push = (fn) => {
      try {
        const v = fn();
        if (v != null && !all.includes(v)) all.push(v);
      } catch {
        /* a reading that does not apply is not an error */
      }
    };

    let primary;
    switch (item.answerType) {
      case "integer":
      case "rational":
        primary = canonNumber(raw, unknown);
        break;
      case "expression":
        primary = canonExpr(raw);
        break;
      case "equation":
        primary = canonEquation(raw);
        break;
      case "inequality":
        primary = canonInequality(raw, unknown);
        break;
      case "pair":
        primary = canonPair(raw);
        break;
      case "partition":
        primary = canonPartition(raw);
        break;
      case "valueSet":
        primary = canonValueSet(raw);
        break;
      case "closure":
        primary = canonClosure(raw, unknown);
        break;
      case "repair": {
        const readings = canonRepairAll(raw, unknown);
        let declared = null;
        try {
          declared = canonRepair(raw, item.answer.valueKind || "equation", unknown);
        } catch {
          declared = null;
        }
        if (!readings.length && !declared) throw new Error("a repair names the joint and what it should read");
        primary = declared && readings.includes(declared) ? declared : readings[0];
        for (const r of readings) if (!all.includes(r)) all.push(r);
        break;
      }
      default:
        primary = canonExpr(raw);
    }
    all.push(primary);
    // Alternative readings, so a distractor written in another shape still gets diagnosed —
    // `produces-expression-not-equation` is a load where a claim was asked for, and the whole
    // point of that misconception is that the learner did not write a Sill.
    push(() => canonNumber(raw, unknown));
    push(() => canonExpr(raw));
    push(() => canonEquation(raw));
    push(() => canonInequality(raw, unknown));
    push(() => canonValueSet(raw));
    return { primary, all };
  }

  /** Distance to the true value, when both are numbers. Feeds `fail.near`, never a score. */
  #near(item, canonical) {
    if (!/^-?\d+(\/\d+)?$/.test(canonical) || !/^-?\d+(\/\d+)?$/.test(item.answer.canonical)) return null;
    const a = parseRatString(canonical);
    const b = parseRatString(item.answer.canonical);
    const diff = Math.abs(a.n / a.d - b.n / b.d);
    return diff <= 1 ? "within-one" : null;
  }

  /* ---------------------------------------------------------------- generate form */

  /**
   * A `generate` item has no single answer; it has a declared property, and the property is
   * checked. `model.trueGuessByForm.generate` prices this form at 0.02 on exactly that basis —
   * "many answers are correct, but none is reachable by luck, because the property has to be
   * checked". If this function ever stopped checking, that number would become a lie.
   */
  #checkConstruction(item, raw) {
    const c = item.check;
    const unknown = c.unknown || item.unknown || "x";
    const surfaceKey = `surface:${String(raw).replace(/\\left|\\right|\\cdot|\s/g, "")}`;
    const fail = (reason) => {
      for (const d of item.distractors || []) {
        try {
          if (d.surfaceMatch ? surfaceKey === d.response : canonAny(raw, unknown).includes(d.response)) {
            return { correct: false, canonical: raw, misconception: d.misconception, failKey: d.failKey, reason };
          }
        } catch {
          /* ignore */
        }
      }
      return miss(reason, { canonical: raw });
    };

    try {
      switch (c.kind) {
        case "claimClosesAt": {
          const st = parseStatement(raw);
          if (st.kind !== "rel" || st.rel !== "=") return fail("not-a-claim");
          const sol = solveLinear(st.left, st.right, unknown);
          const got = sol === null ? null : typeof sol === "string" ? sol : rstr(sol);
          if (got !== c.value) return fail("closes-elsewhere");
          if (!shapeOK(raw, unknown, c.needs)) return fail("shape");
          return ok(raw);
        }
        case "loadAuthor": {
          const p = parseExpr(raw);
          if (!polyIsConst(p)) return fail("not-a-number");
          if (rstr(polyConstValue(p)) !== rstr(rat(Number(c.settleTo)))) return fail("settles-elsewhere");
          if (!shapeOK(raw, unknown, c.needs)) return fail("shape");
          return ok(raw);
        }
        case "loadGathersTo": {
          if (canonExpr(raw) !== c.target) return fail("gathers-elsewhere");
          if (c.surface && sameSurface(raw, c.surface)) return fail("shape");
          if (!shapeOK(raw, unknown, c.needs)) return fail("shape");
          return ok(raw);
        }
        case "loadReadsAt": {
          const p = parseExpr(raw);
          if (!shapeOK(raw, unknown, c.needs)) return fail("shape");
          const settled = polySubst(p, { [unknown]: rat(Number(c.at)) });
          if (!polyIsConst(settled)) return fail("not-settled");
          if (rstr(polyConstValue(settled)) !== rstr(rat(Number(c.value)))) return fail("reads-elsewhere");
          return ok(raw);
        }
        case "loadShape": {
          const terms = surfaceTerms(raw);
          if (terms.length !== c.terms) return fail("term-count");
          if (c.needsConstant && !terms.some((t) => polyIsConst(t))) return fail("no-fixed-weight");
          return ok(raw);
        }
        case "socketValue": {
          const v = parseRatString(canonNumber(raw, unknown));
          const values = { [unknown]: v };
          for (const [k, n] of Object.entries(c.fixed || {})) values[k] = rat(Number(n));
          const settled = polySubst(parseExpr(c.expr), values);
          if (!polyIsConst(settled)) return fail("not-settled");
          const got = polyConstValue(settled);
          const target = rat(Number(c.value));
          const cmp = rcmp(got, target);
          const pass = c.relation === "greaterThan" ? cmp > 0 : c.relation === "lessThan" ? cmp < 0 : cmp === 0;
          return pass ? ok(raw) : fail("property");
        }
        case "markAdmits": {
          if (canonInequality(raw, unknown) !== c.stretch) return fail("admits-elsewhere");
          if (!shapeOK(raw, unknown, c.needs)) return fail("shape");
          return ok(raw);
        }
        case "partitionWitness": {
          const terms = surfaceTerms(raw);
          if (terms.length !== 1) return fail("one-term");
          const t = terms[0];
          const want = parseExpr(c.mustStandWith);
          const keyOf = (poly) => [...poly.keys()][0] ?? "";
          if (t.size !== 1 || keyOf(t) !== keyOf(want)) return fail("wrong-kind");
          if ((c.excludes || []).includes(polyStr(t))) return fail("already-standing");
          return ok(raw);
        }
        case "separatorValue": {
          const v = parseRatString(canonNumber(raw, unknown));
          const a = polySubst(parseExpr(c.e1), { [unknown]: v });
          const b = polySubst(parseExpr(c.e2), { [unknown]: v });
          if (!polyIsConst(a) || !polyIsConst(b)) return fail("not-settled");
          return req(polyConstValue(a), polyConstValue(b)) ? fail("agrees-there") : ok(raw);
        }
        case "namesDiffer": {
          const pair = canonPair(raw);
          const parts = pair.split(";").map((s) => s.split("="));
          if (parts.length < 2) return fail("two-sockets");
          const names = new Set(parts.map((p) => p[0]));
          if (names.size < 2) return fail("same-name");
          if (!parts.every((p) => p[1] === c.value)) return fail("different-values");
          return ok(raw);
        }
        default:
          return miss("unknown-check");
      }
    } catch (err) {
      return miss("unreadable", { detail: String(err.message || err) });
    }
  }

  /* ---------------------------------------------------------------- reviewer surface */

  stats() {
    const perKp = {};
    for (const [kpId, list] of this.#byKp) {
      const misc = {};
      for (const m of this.#meta.get(kpId).misconceptions) {
        misc[m] = (this.#byKpMisconception.get(`${kpId}|${m}`) || []).length;
      }
      perKp[kpId] = {
        items: list.length,
        forms: {
          construct: list.filter((i) => i.form === "construct").length,
          repair: list.filter((i) => i.form === "repair").length,
          generate: list.filter((i) => i.form === "generate").length,
        },
        bands: [...new Set(list.map((i) => i.difficulty))].sort(),
        itemsPerMisconception: misc,
      };
    }
    return {
      knowledgePoints: this.#byKp.size,
      items: this.#byId.size,
      catalogue: BANK_INDEX.generated,
      generatedThisSession: this.#generated,
      locale: this.locale,
      perKp,
    };
  }

  /** Cheap, JSON-safe and honest — the reviewer contract in design/architecture.md. */
  probe() {
    const s = this.stats();
    const minItems = Math.min(...Object.values(s.perKp).map((v) => v.items));
    const minMisc = Math.min(
      ...Object.values(s.perKp).flatMap((v) => Object.values(v.itemsPerMisconception))
    );
    return {
      knowledgePoints: s.knowledgePoints,
      items: s.items,
      generatedThisSession: s.generatedThisSession,
      locale: this.locale,
      minItemsPerKp: minItems,
      minItemsPerMisconception: minMisc,
      formsPerKp: Object.fromEntries(
        Object.entries(s.perKp).map(([k, v]) => [k, `${v.forms.construct}/${v.forms.repair}/${v.forms.generate}`])
      ),
    };
  }
}

/* ------------------------------------------------------------------ helpers */

function ok(canonical) {
  return { correct: true, canonical, misconception: null, failKey: null, reason: "property-holds" };
}
function miss(reason, extra = {}) {
  return { correct: false, canonical: null, misconception: null, failKey: "fail.slip", reason, ...extra };
}

function has(set, id) {
  if (!set) return false;
  if (typeof set.has === "function") return set.has(id);
  return Array.isArray(set) ? set.includes(id) : false;
}
function sizeOf(set) {
  if (!set) return 0;
  return typeof set.size === "number" ? set.size : Array.isArray(set) ? set.length : 0;
}
function hashOf(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function pickIndex(seed, n) {
  let s = (seed >>> 0) || 1;
  s ^= s << 13;
  s >>>= 0;
  s ^= s >> 17;
  s ^= s << 5;
  s >>>= 0;
  return s % n;
}

function parseRatString(s) {
  const [n, d] = String(s).split("/");
  return rat(Number(n), d === undefined ? 1 : Number(d));
}

function flipEquation(tex) {
  const i = tex.indexOf("=");
  return i < 0 ? tex : `${tex.slice(i + 1).trim()} = ${tex.slice(0, i).trim()}`;
}
function flipInequality(tex) {
  const m = tex.match(/^(.*?)(\\le|\\ge|<=|>=|<|>)(.*)$/);
  if (!m) return tex;
  const flip = { "<": ">", ">": "<", "\\le": "\\ge", "\\ge": "\\le", "<=": ">=", ">=": "<=" };
  return `${m[3].trim()} ${flip[m[2]] || m[2]} ${m[1].trim()}`;
}

/** "4, 7, -2" / "4; 7; -2" / "4 7 -2" -> a sorted canonical list of exact rationals. */
function canonValueSet(raw) {
  const parts = String(raw)
    .split(/[;\n]|,(?!\d)|\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) throw new Error("empty set");
  const vals = parts.map((p) => canonNumber(p));
  return [...new Set(vals)].sort().join(",");
}

/** A number, or one of the two words that are not numbers. */
function canonClosure(raw, unknown) {
  const folded = foldWord(raw);
  if (CLOSURE_FOLDED.always.has(folded)) return "always";
  if (CLOSURE_FOLDED.none.has(folded)) return "none";
  return canonNumber(raw, unknown);
}

function canonAny(raw, unknown) {
  const out = [];
  const push = (fn) => {
    try {
      const v = fn();
      if (v != null && !out.includes(v)) out.push(v);
    } catch {
      /* not this reading */
    }
  };
  push(() => canonNumber(raw, unknown));
  push(() => canonExpr(raw));
  push(() => canonEquation(raw));
  push(() => canonInequality(raw, unknown));
  push(() => canonPair(raw));
  push(() => canonClosure(raw, unknown));
  return out;
}

/**
 * Shape requirements for a `generate` item, read off the SURFACE of what the learner wrote.
 * These are the difference between "author a claim that closes at 4" and "type x = 4".
 */
function shapeOK(raw, unknown, needs = []) {
  if (!needs || !needs.length) return true;
  const src = String(raw);
  const bare = src.replace(/\\left|\\right/g, "");
  for (const need of needs) {
    switch (need) {
      case "coefficient": {
        const sides = splitRelation(bare);
        const coef = sides.reduce((acc, s) => {
          try {
            const c = parseExpr(s).get(unknown);
            return c ? Math.abs(c.n / c.d) : acc;
          } catch {
            return acc;
          }
        }, 0);
        if (!(coef > 0 && coef !== 1)) return false;
        break;
      }
      case "constantWithUnknown": {
        // A lip on the SAME pan as the socket. Without this, "author a claim that closes at 4"
        // is satisfied by typing `x = 4`, which is not authoring anything and is reachable by
        // a blind responder one time in forty-one.
        const sides = splitRelation(bare);
        let found = false;
        for (const s of sides) {
          try {
            const p = parseExpr(s);
            const k = p.get("");
            if (p.get(unknown) && k && k.n !== 0) found = true;
          } catch {
            /* ignore */
          }
        }
        if (!found) return false;
        break;
      }
      case "differentSurface":
        break; // handled where the reference surface is known
      case "constant": {
        const sides = splitRelation(bare);
        let anyConst = false;
        for (const s of sides) {
          try {
            const k = parseExpr(s).get("");
            if (k && k.n !== 0) anyConst = true;
          } catch {
            /* ignore */
          }
        }
        if (!anyConst) return false;
        break;
      }
      case "bothPans": {
        const sides = splitRelation(bare);
        if (sides.length !== 2) return false;
        const carries = sides.map((s) => {
          try {
            return !!parseExpr(s).get(unknown);
          } catch {
            return false;
          }
        });
        if (!(carries[0] && carries[1])) return false;
        break;
      }
      case "bundle":
        if (!/[()]/.test(bare)) return false;
        break;
      case "negativeOutside":
        if (!/-\s*\d*\s*\(/.test(bare)) return false;
        break;
      case "product":
        if (!/\\cdot|\*|\d\s*\(/.test(bare)) return false;
        break;
      case "sum":
        if (!/[+]/.test(bare.replace(/^[-+]/, ""))) return false;
        break;
      case "letter":
        if (!/[a-zA-Z]/.test(bare.replace(/\\[a-zA-Z]+/g, ""))) return false;
        break;
      case "twoLikeTerms": {
        const sides = splitRelation(bare);
        let found = false;
        for (const s of sides) {
          try {
            const terms = surfaceTerms(s);
            const keys = terms.map((t) => (t.size ? [...t.keys()][0] : ""));
            if (keys.some((k, i) => k !== "" && keys.indexOf(k) !== i)) found = true;
          } catch {
            /* ignore */
          }
        }
        if (!found) return false;
        break;
      }
      case "negativeCount": {
        const sides = splitRelation(bare);
        let neg = false;
        for (const s of sides) {
          try {
            const c = parseExpr(s).get(unknown);
            if (c && c.n < 0) neg = true;
          } catch {
            /* ignore */
          }
        }
        if (!neg) return false;
        break;
      }
      default:
        break;
    }
  }
  return true;
}

/** Two loads written the same way, ignoring spacing and TeX niceties. */
function sameSurface(a, b) {
  const strip = (s) => String(s).replace(/\\left|\\right|\\cdot|[\s{}]/g, "").replace(/\*/g, "");
  return strip(a) === strip(b);
}

function splitRelation(src) {
  const parts = String(src).split(/<=|>=|\\le|\\ge|[=<>]/);
  return parts.map((s) => s.trim()).filter(Boolean);
}

/** One bank per session. P16 imports this; nothing else needs to construct its own. */
export const itemBank = new ItemBank();

export { generateForKp, BANK_INDEX };
