/**
 * ItemBank — the item bank the mastery engine is served from.
 *
 * Owned by P17; the loading half below is P31's. Four jobs and nothing else:
 *
 *   1. LOAD    the committed catalogue and the generator families behind it, so the bank cannot
 *              run dry mid-session. **One knowledge point at a time, on demand** — see below.
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
 *
 * ------------------------------------------------------------------------------------------
 * P31 — PER-LESSON LOADING. Why `select()` is still synchronous.
 * ------------------------------------------------------------------------------------------
 *
 * Round 1 imported the whole Algebra I catalogue statically, and it built into a 1.6 MB
 * (147 kB gzipped) chunk — the largest asset in the game by an order of magnitude, paid for on
 * every page load before the first item was drawn, on a school Chromebook, over school wifi. A
 * 15–25 minute session touches two or three knowledge points of the thirty-two.
 *
 * So the catalogue is now one chunk per knowledge point (`content/items/groups/`), pulled the
 * first time a session needs it and cached for the life of the page. Three rules make that safe:
 *
 *   1. **The public API does not change shape.** `select`, `forKp`, `fresh`, `meta`, `present`,
 *      `check`, `accepts`, `stats`, `probe` are the same calls with the same signatures, and
 *      `select` is still SYNCHRONOUS. Scheduler and Mastery hand `select` around as a plain
 *      function; making it a promise would have rewritten the pricing audit, the offline
 *      simulations and every proof script in `review/measure`, to buy nothing.
 *   2. **Nothing a caller needs before the items is inside the items.** Band, strand, standards,
 *      misconceptions, object class and item counts come from `manifest.mjs`, which is eager and
 *      carries no items. So `meta()`, `knowledgePoints()` and `fresh()` all work with ZERO groups
 *      resident — which is exactly why a cold `select()` can degrade to the generator instead of
 *      failing.
 *   3. **A cold or failed group degrades to a real, checkable item and says so.** It never hangs
 *      and never serves a blank: `select()` answers from the generator, tags the result
 *      `generated-group-absent` / `generated-group-failed`, starts the load in the background,
 *      and records the fact in `probe().degraded` where a reviewer and the HUD can read it.
 *
 * `await bank.ensure(kpId)` / `bank.ensureLesson(lessonId)` is what a session opener should call,
 * and after any load the bank prefetches the rest of the lesson during idle time, so the
 * degraded path is a safety net rather than the normal experience.
 *
 * The loaded catalogue is MODULE-LEVEL, shared by every `ItemBank` instance. Committed items are
 * immutable and identical for everyone; the per-instance state is only what a session generates.
 */

import { BANK_INDEX, STRINGS, KP_META, LESSONS } from "../../../content/items/index.mjs";
import { GROUP_IDS, GROUP_LOADERS } from "../../../content/items/groups/index.mjs";
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

/* ------------------------------------------------------------------ the catalogue store
 *
 * P31. One module-level store of loaded groups, shared by every `ItemBank` instance: the
 * committed items are immutable and identical for everyone, and `review/measure/P16.mjs` alone
 * constructs four banks in one process. Per-instance state is only what a session GENERATES.
 */

/** kpId -> { items, byId, byMisconception } for the groups that are resident. */
const RESIDENT = new Map();
/** kpId -> Promise, so N concurrent `select()` calls on a cold group cause ONE fetch. */
const INFLIGHT = new Map();
/** kpId -> { error, attempts, at }. A group here is degraded, not pending. */
const FAILED = new Map();
/** Review-harness only: groups whose chunk is made to refuse to load. See `__faultGroup`. */
const FAULT = new Set();
/** Anything the outside world should be told about, in the order it happened. */
const ISSUES = [];

const KP_IDS = GROUP_IDS.slice();
const LESSON_OF = new Map();
for (const lesson of LESSONS) for (const id of lesson.kpIds) LESSON_OF.set(id, lesson);

/**
 * Somewhere for a host to hear about a degraded group without `ItemBank` importing anything that
 * assumes a browser. `app/src/boot/62-itembank.js` already publishes `probe()`, so a reviewer sees
 * `degraded` without any wiring at all; this is for a HUD that wants to say it out loud.
 */
export const bankIssues = {
  list: () => ISSUES.slice(),
  onIssue: null,
};

function raise(issue) {
  ISSUES.push(issue);
  if (ISSUES.length > 64) ISSUES.shift();
  try {
    bankIssues.onIssue?.(issue);
  } catch {
    /* a listener that throws is not the bank's problem, and must not take the bank down */
  }
}

/**
 * Index one loaded group. The three fields stripped from the shipped chunk — `kpId`,
 * `objectClass`, `standards` — are properties of the knowledge point that were repeated on every
 * item; they are put back here, so an item object handed to a caller is field-for-field what
 * `content/items/bank/<kpId>.json` holds minus the English `text` snapshots, which the game never
 * renders (it resolves every string through `STRINGS` and the learner's locale — G3).
 */
function indexGroup(kpId, group) {
  const meta = KP_META[kpId];
  const items = [];
  const byId = new Map();
  const byMisconception = new Map();
  for (const raw of group.items) {
    const item = raw;
    item.kpId = kpId;
    item.objectClass = meta.objectClass;
    item.standards = meta.standards;
    items.push(item);
    byId.set(item.id, item);
    // Per DISTRACTOR, not per item: an item naming one misconception twice sits in that pool
    // twice, which is the round-1 behaviour and what the selection weights were measured against.
    for (const d of item.distractors) {
      let pool = byMisconception.get(d.misconception);
      if (!pool) byMisconception.set(d.misconception, (pool = []));
      pool.push(item);
    }
  }
  const entry = { items, byId, byMisconception };
  RESIDENT.set(kpId, entry);
  FAILED.delete(kpId);
  return entry;
}

/**
 * Load one group. Retries once — a school wifi hiccup on a 4 kB chunk is worth a second attempt
 * and is not worth failing a lesson over — then gives up loudly and stays given-up until someone
 * calls `ensure` again, so the degraded path cannot turn into a retry storm.
 */
function loadGroup(kpId) {
  const resident = RESIDENT.get(kpId);
  if (resident) return Promise.resolve(resident);
  const pending = INFLIGHT.get(kpId);
  if (pending) return pending;
  const loader = GROUP_LOADERS[kpId];
  if (!loader) {
    const err = new Error(`no item group for knowledge point "${kpId}"`);
    FAILED.set(kpId, { error: err.message, attempts: 0, at: Date.now() });
    raise({ kind: "unknown-group", kpId, error: err.message });
    return Promise.reject(err);
  }
  const fetchOnce = () =>
    FAULT.has(kpId)
      ? Promise.reject(new Error(`simulated transport failure loading group "${kpId}"`))
      : loader().then((mod) => mod.default ?? mod);
  const attempt = (n) => fetchOnce().catch((err) => (n > 0 ? attempt(n - 1) : Promise.reject(err)));
  const p = attempt(1)
    .then((group) => {
      INFLIGHT.delete(kpId);
      return indexGroup(kpId, group);
    })
    .catch((err) => {
      INFLIGHT.delete(kpId);
      const message = String(err?.message || err);
      FAILED.set(kpId, { error: message, attempts: 2, at: Date.now() });
      raise({ kind: "group-load-failed", kpId, lesson: LESSON_OF.get(kpId)?.id ?? null, error: message });
      // Resolved, not rejected: a caller that awaited a lesson must carry on into a degraded but
      // playable session rather than have the whole session opener reject.
      return null;
    });
  INFLIGHT.set(kpId, p);
  return p;
}

/** True when `forKp` can answer from the catalogue for this knowledge point. */
function isResident(kpId) {
  return RESIDENT.has(kpId);
}

/**
 * Fire-and-forget. Called from the synchronous `select()` path so that a cold knowledge point is
 * loading by the time the learner has read the item the generator just made.
 */
function touch(kpId) {
  if (RESIDENT.has(kpId) || INFLIGHT.has(kpId) || FAILED.has(kpId)) return;
  loadGroup(kpId).catch(() => {});
}

const idle =
  typeof requestIdleCallback === "function"
    ? (fn) => requestIdleCallback(fn, { timeout: 2000 })
    : (fn) => setTimeout(fn, 0);

/**
 * NODE LOADS EVERYTHING, EAGERLY, AT MODULE INIT.
 *
 * Every offline consumer — `tools/bank-audit.mjs`, `review/measure/P16.mjs` and its four critic
 * scripts, `review/measure/P17.mjs` — constructs an `ItemBank` and immediately draws thousands of
 * items through the synchronous `select()`. Those runs price the bank a learner actually meets;
 * if half of them silently fell through to the generator because a chunk had not arrived, every
 * number in P16's L4/L5 evidence would describe a population nobody is served. Splitting the
 * catalogue is a DELIVERY decision, and it must not change a single measured value.
 *
 * There is no bandwidth to save in Node, so there is nothing to trade: the whole catalogue loads
 * here, before any consumer's first statement runs. In the browser this branch never executes and
 * the group chunks are reached only through `GROUP_LOADERS`.
 */
const IS_NODE =
  typeof process !== "undefined" && !!process.versions?.node && typeof window === "undefined";
if (IS_NODE) await Promise.all(KP_IDS.map((id) => loadGroup(id)));

/* ------------------------------------------------------------------ the bank */

export class ItemBank {
  #generatedById = new Map();
  #generated = 0;

  constructor({ locale = "en" } = {}) {
    this.locale = LOCALES.includes(locale) ? locale : "en";
  }

  /* ---------------------------------------------------------------- loading (P31) */

  /**
   * Make one or more knowledge points servable from the catalogue. Resolves when they are
   * resident OR have failed for good; it never rejects, because a session opener must always
   * continue into something playable.
   *
   * Returns what actually happened, so a caller can say so:
   * `{ requested, loaded, alreadyResident, failed: [kpId] }`.
   */
  async ensure(kpIds) {
    const ids = (Array.isArray(kpIds) ? kpIds : [kpIds]).filter((id) => KP_META[id]);
    const alreadyResident = ids.filter(isResident).length;
    await Promise.all(ids.map((id) => loadGroup(id).catch(() => null)));
    const failed = ids.filter((id) => !isResident(id));
    if (ids.length) this.prefetchAround(ids[ids.length - 1]);
    return { requested: ids.length, loaded: ids.length - failed.length, alreadyResident, failed };
  }

  /** Every knowledge point in a lesson, in prerequisite order. The session-opener call. */
  async ensureLesson(lessonId) {
    const lesson = LESSONS.find((l) => l.id === lessonId);
    if (!lesson) return { requested: 0, loaded: 0, alreadyResident: 0, failed: [], lesson: null };
    const out = await this.ensure(lesson.kpIds);
    return { ...out, lesson: lesson.id };
  }

  /**
   * Warm what the learner is most likely to need next, during idle time, so nobody ever waits
   * mid-session: the rest of the current lesson first, then the head of the next one. Capped,
   * because prefetching aggressively enough is just downloading the whole course again with extra
   * steps — the point of this piece is not to.
   */
  prefetchAround(kpId, { ahead = 3 } = {}) {
    const lesson = LESSON_OF.get(kpId);
    if (!lesson) return [];
    const rest = lesson.kpIds.slice(lesson.kpIds.indexOf(kpId) + 1);
    const nextLesson = LESSONS[LESSONS.indexOf(lesson) + 1];
    const queue = [...rest, ...(nextLesson ? nextLesson.kpIds.slice(0, 1) : [])]
      .filter((id) => !RESIDENT.has(id) && !INFLIGHT.has(id) && !FAILED.has(id))
      .slice(0, ahead);
    for (const id of queue) idle(() => touch(id));
    return queue;
  }

  /** Which lesson a knowledge point belongs to, and the lesson plan itself. */
  lessons() {
    return LESSONS;
  }
  lessonFor(kpId) {
    return LESSON_OF.get(kpId) ?? null;
  }

  /** What is in memory right now. Cheap; the loading half of `probe()` is built out of this. */
  residency() {
    return {
      groups: KP_IDS.length,
      resident: [...RESIDENT.keys()],
      loading: [...INFLIGHT.keys()],
      failed: Object.fromEntries(FAILED),
    };
  }

  setLocale(locale) {
    if (LOCALES.includes(locale)) this.locale = locale;
    return this.locale;
  }

  /**
   * ALL of them, resident or not. This answers "what does this course cover", and the answer
   * must not depend on what happens to be in memory — a scheduler that walked only the loaded
   * knowledge points would quietly stop offering the rest of Algebra I.
   */
  knowledgePoints() {
    return KP_IDS.slice();
  }

  /**
   * Band, strand, object class, standards and misconceptions, from the eager manifest. Available
   * for every knowledge point with zero groups loaded — which is what lets `fresh()` generate a
   * correct, correctly-tagged item for a knowledge point whose chunk has not arrived.
   */
  meta(kpId) {
    const m = KP_META[kpId];
    return m
      ? {
          kpId: m.kpId,
          band: m.band,
          strand: m.strand,
          objectClass: m.objectClass,
          standards: m.standards,
          misconceptions: m.misconceptions,
        }
      : null;
  }

  item(id) {
    const mine = this.#generatedById.get(id);
    if (mine) return mine;
    for (const entry of RESIDENT.values()) {
      const hit = entry.byId.get(id);
      if (hit) return hit;
    }
    return null;
  }

  /**
   * Everything on one knowledge point, optionally narrowed. Never mutated by callers.
   *
   * Empty when the group is not resident — deliberately, and it is the caller's business:
   * `select()` reads `isResident` first and goes to the generator with a relaxation tag that says
   * so, rather than reporting "the catalogue had nothing" when the truth is "the catalogue had
   * not arrived". The two are different facts and the audit prices them differently.
   */
  forKp(kpId, { form = null, difficulty = null, misconception = null, exclude = null } = {}) {
    const entry = RESIDENT.get(kpId);
    if (!entry) return [];
    let list = misconception ? entry.byMisconception.get(misconception) || [] : entry.items;
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
    /**
     * P31 — THE COLD PATH, and why it is not a hang and not a blank.
     *
     * `select()` is synchronous because Scheduler, Mastery and every offline audit pass it around
     * as a plain function. So when this knowledge point's chunk is not in memory there are three
     * options and only one of them is honest: block (there is no blocking primitive on the main
     * thread, and a frozen game is the worst possible answer), serve nothing (the caller has
     * nothing to draw and the session stalls), or serve a REAL generated item on the same
     * knowledge point at the same band and say, in the returned `relaxation`, that the catalogue
     * was not consulted.
     *
     * The third is what happens. The generators are code and live in the main chunk, the band and
     * standards come from the eager manifest, so the item is correct, checkable and correctly
     * tagged — it is simply not one of the thirty-six a human reviewed for this node. The load is
     * started here, so the next request on this knowledge point is served from the catalogue.
     *
     * `generated-group-absent` and `generated-group-failed` are distinct from `generated` on
     * purpose: "the catalogue was exhausted" and "the catalogue never arrived" are different
     * facts about a session, and the second one is a delivery bug that must be visible as one.
     */
    if (!isResident(kpId)) {
      if (!KP_META[kpId]) return null;
      const failure = FAILED.get(kpId);
      touch(kpId);
      const cold = this.fresh({ kpId, form, difficulty, seed, exclude, misconception });
      if (cold) {
        return {
          item: cold,
          source: "generated",
          relaxation: failure ? "generated-group-failed" : "generated-group-absent",
        };
      }
      // The generator could not satisfy this (kp x form) either. Say nothing rather than
      // something wrong; `null` is the round-1 contract for "no item", and every caller handles it.
      return null;
    }

    // A targeted request is exhausted — catalogue AND generator — before the target is dropped.
    // Relaxing the band first and the misconception last is the whole point: §4 says the item
    // after an error is drawn from variants whose distractor space contains that misconception,
    // and an engine that quietly serves an untargeted item instead has stopped doing retrieval
    // practice against the wrong idea while still reporting that it did.
    if (misconception) {
      for (const d of [difficulty, null]) {
        const pool = this.forKp(kpId, { form, difficulty: d, misconception, exclude });
        if (pool.length) {
          const pick = pool[pickIndex(seed ?? hashOf(kpId + misconception + sizeOf(exclude)), pool.length)];
          return { item: pick, source: "catalogue", relaxation: d === difficulty ? "targeted" : "targeted-any-band" };
        }
        if (d === null) break;
      }
      const aimed = this.fresh({ kpId, form, difficulty, seed, exclude, misconception });
      if (aimed) return { item: aimed, source: "generated", relaxation: "generated-targeted" };
    }

    const relaxations = [];
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

  /**
   * A brand-new item from the generator families. Deterministic in `seed`.
   *
   * Reads its band and standards from the EAGER manifest, never from a loaded group, which is the
   * whole reason a cold knowledge point still produces a correct item.
   */
  fresh({ kpId, form = "construct", difficulty = null, seed = null, exclude = null, misconception = null } = {}) {
    const meta = KP_META[kpId];
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
      if (misconception && !item.distractors.some((d) => d.misconception === misconception)) continue;
      this.#generated++;
      const withStandards = { ...item, standards: meta.standards };
      this.#generatedById.set(item.id, withStandards);
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

    const canon = this.#canonicalize(item, raw);
    if (canon.primary === null && !canon.all.length) {
      return miss("unreadable", { detail: canon.detail });
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

  /**
   * Every reading of the response the item's distractors could plausibly be written in.
   *
   * The reading the item ASKED for is the primary one, and it is the only one that can mark a
   * response correct. The others exist so a wrong response is still diagnosed: a learner who
   * answers a threshold with a single value has written something the primary reading cannot
   * parse at all, and `single-value-for-a-set` is precisely the misconception that produces it.
   * Refusing to read it would turn the most diagnosable error in the strand into a shrug.
   */
  #canonicalize(item, raw) {
    const unknown = item.unknown || "x";
    const all = [];
    let detail = null;
    const push = (fn) => {
      try {
        const v = fn();
        if (v != null && !all.includes(v)) all.push(v);
      } catch {
        /* a reading that does not apply is not an error */
      }
    };

    let primary = null;
    try {
      primary = this.#primaryReading(item, raw, unknown, all);
    } catch (err) {
      detail = String(err.message || err);
    }
    if (primary != null) all.unshift(primary);
    push(() => canonNumber(raw, unknown));
    push(() => canonExpr(raw));
    push(() => canonEquation(raw));
    push(() => canonInequality(raw, unknown));
    push(() => canonValueSet(raw));
    push(() => canonClosure(raw, unknown));
    for (const r of canonRepairAll(raw, unknown)) if (!all.includes(r)) all.push(r);
    return { primary, all, detail };
  }

  #primaryReading(item, raw, unknown, all) {
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
    return primary;
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

  /**
   * The catalogue's shape, for all thirty-two knowledge points, whether or not their chunks are
   * in memory.
   *
   * This deliberately does NOT narrow to what is resident. `minItemsPerKp` and
   * `minItemsPerMisconception` below are coverage gates — L4 lives on them — and a gate computed
   * over "whatever happened to be loaded" would read as passing precisely because the thin
   * knowledge point was absent. The per-knowledge-point counts come from the eager manifest,
   * which is generated from the same `bank/*.json` the chunks are; `review/measure/P31.mjs`
   * asserts the manifest's counts equal the loaded groups' counts, item for item.
   *
   * `items` is the honest RESIDENT number — memory, not coverage — and is reported next to
   * `catalogueItems`, which is the coverage number.
   */
  stats() {
    const perKp = {};
    let residentItems = 0;
    for (const kpId of KP_IDS) {
      const m = KP_META[kpId];
      const entry = RESIDENT.get(kpId);
      if (entry) residentItems += entry.items.length;
      perKp[kpId] = {
        items: m.count,
        forms: m.forms,
        bands: m.bands,
        itemsPerMisconception: m.itemsPerMisconception,
        resident: !!entry,
        lesson: m.lesson,
      };
    }
    const res = this.residency();
    return {
      knowledgePoints: KP_IDS.length,
      items: residentItems + this.#generatedById.size,
      catalogueItems: KP_IDS.reduce((a, id) => a + KP_META[id].count, 0),
      catalogue: BANK_INDEX.generated,
      generatedThisSession: this.#generated,
      locale: this.locale,
      groups: {
        total: res.groups,
        resident: res.resident.length,
        loading: res.loading.length,
        failed: Object.keys(res.failed).length,
        lessons: LESSONS.length,
      },
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
    const res = this.residency();
    return {
      knowledgePoints: s.knowledgePoints,
      items: s.items,
      catalogueItems: s.catalogueItems,
      generatedThisSession: s.generatedThisSession,
      locale: this.locale,
      minItemsPerKp: minItems,
      minItemsPerMisconception: minMisc,
      // P31 — the loading surface. `degraded` is the one that matters: a non-empty list means a
      // learner is being served generated items on those knowledge points because their chunk
      // never arrived, and the session is playable but not the session that was authored.
      groups: `${res.resident.length}/${res.groups} resident, ${res.loading.length} loading`,
      lessons: LESSONS.length,
      residentGroups: res.resident,
      degraded: Object.entries(res.failed).map(([kpId, f]) => `${kpId}: ${f.error}`),
      issues: ISSUES.length,
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

/**
 * "4, 7, -2" / "4; 7; -2" / "4 7 -2" -> a sorted canonical list of exact rationals.
 * Inside a list the comma is a separator, never a decimal mark — see kit.mjs `listSource`.
 */
function canonValueSet(raw) {
  const parts = String(raw)
    .replace(/\\;|\\,|\\quad/g, " ")
    .split(/[;\n,]|\s+/)
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

/**
 * ------------------------------------------------------------------ the review harness surface
 *
 * P31's proof has to exercise the cold path and the failure path, and it runs in Node, where the
 * whole catalogue is resident before the first statement executes (see IS_NODE above). Without a
 * way to evict a group and to make one fail on demand, the two paths that matter most — "the
 * chunk has not arrived" and "the chunk never will" — could only be argued, not measured.
 *
 * These are not gameplay API. Nothing under `app/src/boot/` or `app/src/learn/` calls them;
 * `review/measure/P31.mjs` does.
 */

/** Forget a loaded group, so the next `select()` on it takes the cold path. */
export function __evictGroup(kpId) {
  RESIDENT.delete(kpId);
  INFLIGHT.delete(kpId);
  FAILED.delete(kpId);
}
export function __evictAllGroups() {
  for (const id of KP_IDS) __evictGroup(id);
  ISSUES.length = 0;
}
/** Make a group's chunk refuse to load, the way a dropped connection would. */
export function __faultGroup(kpId, on = true) {
  if (on) FAULT.add(kpId);
  else FAULT.delete(kpId);
  __evictGroup(kpId);
}
/** SOURCE bytes of the resident groups — a build-time estimate. P31 measures the shipped chunks. */
export function __groupBytesLoaded() {
  return [...RESIDENT.keys()].reduce(
    (acc, id) => ({
      raw: acc.raw + (KP_META[id].sourceBytes?.raw ?? 0),
      gzip: acc.gzip + (KP_META[id].sourceBytes?.gzip ?? 0),
    }),
    { raw: 0, gzip: 0 }
  );
}
export { FAULT as __FAULT };

export { generateForKp, BANK_INDEX };
