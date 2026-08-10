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
 * `await bank.ensure(kpId)` / `bank.ensureLesson(lessonId)` is what a session opener calls, and
 * after any load the bank prefetches the rest of the lesson during idle time, so the degraded path
 * is a safety net rather than the normal experience.
 *
 * ROUND 3 — THE CALLER, WHICH IS THE WHOLE POINT.
 *
 * Round 2 shipped all of that machinery with NO caller in the game. A critic drove the built app's
 * scheduler for 117 items and it pulled 0 of the 32 group chunks; `ensure`, `ensureLesson` and
 * `prefetchAround` appeared nowhere under `app/` except their own definitions. The bytes were real
 * and the delivery was fiction: the idle prefetch never ran, and the FIRST item a learner met on
 * every knowledge point would have come from the generator, not from the thirty-six a human
 * reviewed. `warmFrontier()` below is the caller, and `app/src/boot/62-itembank.js` runs it in
 * idle time on every page load. `probe().warm` reports what it did, so "the loader has a caller"
 * is a measurement rather than a claim.
 *
 * Round 3 also moved the last two eager costs out of the barrel: the item locale table is one
 * chunk per language (see below), and the identity spine is loaded only when the audit constants
 * have moved. Neither is on the path to the first item.
 *
 * The loaded catalogue is MODULE-LEVEL, shared by every `ItemBank` instance. Committed items are
 * immutable and identical for everyone; the per-instance state is only what a session generates.
 */

import { BANK_INDEX, KP_META, LESSONS, loadItemStrings } from "../../../content/items/index.mjs";
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

/* ------------------------------------------------------------------ locale text
 *
 * P31 round 3. The item locale table used to ship all three languages of all 281 keys to every
 * learner — 24.5 kB gzipped of which a learner reads a third. `app/src/boot/05-i18n.js` had
 * already settled the shape for the UI half of the same problem: one bundle per locale, pulled
 * dynamically, awaited ONCE at boot so every lookup afterwards is synchronous. This is the item
 * half, and it obeys the same two rules.
 *
 *   1. `text()` stays synchronous. `present()` is called from the frame that draws an item.
 *   2. A learner never sees a key sentinel because of loading. `setLocale()` therefore does not
 *      flip `this.locale` until the new table is resident: mid-switch a learner keeps reading the
 *      language they were reading, which is a delayed switch, not a fallback to English (G3).
 */

const LOCALES = ["en", "es", "pl"];

/** locale -> { key: string }. Module-level: the tables are immutable and shared by every bank. */
const TEXT = new Map();
/** locale -> Promise, so N banks switching at once cause ONE fetch. */
const TEXT_INFLIGHT = new Map();

function loadLocaleTable(locale) {
  if (!LOCALES.includes(locale)) return Promise.resolve(null);
  const resident = TEXT.get(locale);
  if (resident) return Promise.resolve(resident);
  const pending = TEXT_INFLIGHT.get(locale);
  if (pending) return pending;
  const p = loadItemStrings(locale)
    .then((table) => {
      TEXT_INFLIGHT.delete(locale);
      if (table) TEXT.set(locale, table);
      return table ?? null;
    })
    .catch((err) => {
      TEXT_INFLIGHT.delete(locale);
      // Resolved, not rejected: a session opener must carry on. The consequence is visible —
      // `probe().localesResident` will not list it and `issues` will name it.
      raise({ kind: "locale-load-failed", locale, error: String(err?.message || err) });
      return null;
    });
  TEXT_INFLIGHT.set(locale, p);
  return p;
}

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
/**
 * How long a failed group stays given-up before the next `select()` on it will try again.
 *
 * Round 2 had no such window: `touch()` returned early forever on a `FAILED` entry and nothing in
 * the shipped game ever called `ensure()` a second time, so ONE dropped chunk downgraded that
 * knowledge point — every item on it generated rather than authored — for the life of the page.
 * On school wifi that is not a rare case, it is Tuesday. Thirty seconds is long enough that a real
 * outage cannot become a retry storm (a session serves an item every 20-40 s, so this is at most
 * one extra request per item) and short enough that a blip costs a learner one item, not a lesson.
 */
const RETRY_AFTER_MS = 30_000;

/**
 * ------------------------------------------------------------------------------------------
 * THE SWEEP GUARD. Why a cold `select()` does not fetch a chunk immediately, or always.
 * ------------------------------------------------------------------------------------------
 *
 * `select()` starts a background load when its knowledge point is cold, because the learner is
 * about to see more items on that node and the next one should come from the catalogue. That
 * speculation is right for a LEARNER, who comes back to the same handful of knowledge points for
 * twenty-five minutes. It is wrong for a SWEEP, which visits all thirty-two once and never returns.
 *
 * There is a sweep in the shipped game. `app/src/boot/62-learning.js` recomputes the blind-guess
 * audit live whenever `bank-audit.json` is stale, by driving `collectBankSample` through
 * `itemBank.select()` across every knowledge point and every form. Measured here: **54,788 draws,
 * 32 group chunks requested, and — the fact that decides this design — `residency()` reports 0
 * resident and 32 still in flight when the sweep ends.** The sweep is one synchronous block, so not
 * one of those chunks can resolve while it runs. All thirty-two arrive too late to put a single
 * catalogue item into the sample, and land 93.0 kB gzipped on the critical path for nothing.
 *
 * So the rule is not a rate limit — the sweep is SLOW, not fast, and a rate limit measured nothing
 * (it fired zero times across 282 s of sweeping). The rule is relevance, and it is rate-independent:
 *
 *   1. A cold `select()` never fetches synchronously. It queues the fetch for idle time. A caller
 *      that never yields therefore gets nothing until it has finished, which costs the audit
 *      exactly what it was already getting: nothing.
 *   2. When the idle callback runs, the fetch happens only if that knowledge point is still one of
 *      the last `SPECULATION_RECENT` distinct ones a cold `select()` asked for. A session works on
 *      a handful and every one of them stays current; a sweep leaves thirty-two behind and only its
 *      tail is still current — which is correct, because the sweep is not coming back to any of them.
 *
 * Nothing about correctness depends on this. A suppressed load means `select()` answers from the
 * generator and tags it `generated-group-absent`, which is the documented cold path, and the group
 * is pulled the next time a learner actually asks for it. `ensure`, `ensureLesson`, `warmFrontier`
 * and `prefetchLesson` are EXPLICIT requests from code that knows where the learner is; they fetch
 * at once and are never suppressed.
 */
const SPECULATION_RECENT_DEFAULT = 10;
let SPECULATION_RECENT = SPECULATION_RECENT_DEFAULT;
/** The last distinct knowledge points a cold `select()` asked for, most recent last. */
let RECENT_COLD = [];
/** Knowledge points with a queued-but-not-yet-decided speculative fetch, so it is queued once. */
const SPECULATING = new Set();
/** Everything `loadGroup` ever started on this page, by origin. `probe().loads` reports it. */
const LOADS = { demand: 0, prefetch: 0, explicit: 0, suppressed: 0 };

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

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/** Attempts inside one `loadGroup` call, and the pause before each retry. */
const ATTEMPTS = 3;
const BACKOFF_MS = 250;

/**
 * Load one group. Three attempts with a growing pause between them — a school wifi hiccup on a
 * 4 kB chunk is worth a second and a third go, and hammering the same dead socket twice inside a
 * millisecond (which is what round 2 did) is not a retry, it is the same failure counted twice.
 * Then it gives up, loudly, and the group is degraded until `RETRY_AFTER_MS` has passed or someone
 * calls `ensure` — so the degraded path cannot turn into a retry storm and cannot become permanent.
 */
function loadGroup(kpId, origin = "explicit") {
  const resident = RESIDENT.get(kpId);
  if (resident) return Promise.resolve(resident);
  const pending = INFLIGHT.get(kpId);
  if (pending) return pending;
  LOADS[origin] = (LOADS[origin] ?? 0) + 1;
  const loader = GROUP_LOADERS[kpId];
  if (!loader) {
    const err = new Error(`no item group for knowledge point "${kpId}"`);
    FAILED.set(kpId, { error: err.message, attempts: 0, at: Date.now() });
    raise({ kind: "unknown-group", kpId, error: err.message });
    return Promise.reject(err);
  }
  const previous = FAILED.get(kpId)?.attempts ?? 0;
  const fetchOnce = () =>
    FAULT.has(kpId)
      ? Promise.reject(new Error(`simulated transport failure loading group "${kpId}"`))
      : loader().then((mod) => mod.default ?? mod);
  const attempt = (left, wait) =>
    fetchOnce().catch((err) =>
      left > 0 ? delay(wait).then(() => attempt(left - 1, wait * 3)) : Promise.reject(err)
    );
  const p = attempt(ATTEMPTS - 1, BACKOFF_MS)
    .then((group) => {
      INFLIGHT.delete(kpId);
      const entry = indexGroup(kpId, group);
      if (previous) raise({ kind: "group-recovered", kpId, afterAttempts: previous + ATTEMPTS });
      return entry;
    })
    .catch((err) => {
      INFLIGHT.delete(kpId);
      const message = String(err?.message || err);
      FAILED.set(kpId, { error: message, attempts: previous + ATTEMPTS, at: Date.now() });
      raise({
        kind: "group-load-failed",
        kpId,
        lesson: LESSON_OF.get(kpId)?.id ?? null,
        error: message,
        attempts: previous + ATTEMPTS,
        retryAfterMs: RETRY_AFTER_MS,
      });
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

/** How long until a failed group may be tried again. 0 means "now". */
function retryIn(kpId) {
  const f = FAILED.get(kpId);
  if (!f) return 0;
  return Math.max(0, RETRY_AFTER_MS - (Date.now() - f.at));
}

/**
 * Fire-and-forget. Called from the synchronous `select()` path so that a cold knowledge point is
 * loading by the time the learner has read the item the generator just made — and, once
 * `RETRY_AFTER_MS` has elapsed, so that a knowledge point downgraded by one dropped chunk gets
 * another chance instead of serving generated items for the life of the page.
 */
function touch(kpId, origin = "demand") {
  if (RESIDENT.has(kpId) || INFLIGHT.has(kpId)) return;
  if (FAILED.has(kpId)) {
    if (retryIn(kpId) > 0) return;
    raise({ kind: "group-retry", kpId, afterMs: RETRY_AFTER_MS, attempts: FAILED.get(kpId).attempts });
  }
  if (origin !== "demand") {
    loadGroup(kpId, origin).catch(() => {});
    return;
  }
  // Speculative. Noted now, decided later — see the SWEEP GUARD note above.
  noteCold(kpId);
  if (SPECULATING.has(kpId)) return;
  SPECULATING.add(kpId);
  idle(() => {
    SPECULATING.delete(kpId);
    if (RESIDENT.has(kpId) || INFLIGHT.has(kpId)) return;
    if (!RECENT_COLD.includes(kpId)) {
      LOADS.suppressed += 1;
      raise({
        kind: "speculation-dropped",
        kpId,
        recent: SPECULATION_RECENT,
        error:
          `a cold select() asked for "${kpId}", then ${SPECULATION_RECENT} other knowledge points were asked for ` +
          `before idle time came round — that is a catalogue sweep, not a learner, so the chunk was not fetched`,
      });
      return;
    }
    loadGroup(kpId, origin).catch(() => {});
  });
}

/** Remember that a cold `select()` wanted this knowledge point, most recent last. */
function noteCold(kpId) {
  const at = RECENT_COLD.indexOf(kpId);
  if (at >= 0) RECENT_COLD.splice(at, 1);
  RECENT_COLD.push(kpId);
  while (RECENT_COLD.length > SPECULATION_RECENT) RECENT_COLD.shift();
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
if (IS_NODE) {
  await Promise.all([...KP_IDS.map((id) => loadGroup(id)), ...LOCALES.map(loadLocaleTable)]);
}

/**
 * What the last `warmFrontier()` did, module-level because it is a fact about the PAGE, not about
 * an instance. `probe().warm` reports it, which is how a reviewer sees that the shipped game
 * called the loader rather than that the loader exists.
 */
let WARM = null;
/** How many warms this page has run, and what each of them did. Re-warming is the round-4 claim. */
let WARM_SEQ = 0;
const WARM_LOG = [];
/**
 * How far through a lesson the learner must be before the WHOLE next lesson is pulled during idle.
 * Half: at the median 3,438 B gzipped per lesson the lookahead costs less than one KaTeX font, and
 * a learner who is halfway through a 20-minute lesson will reach the boundary inside this sitting.
 */
const LOOKAHEAD_AT = 0.5;

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

  /**
   * The WHOLE catalogue, awaited. The one call a catalogue-wide consumer must make.
   *
   * There is exactly one such consumer in the shipped game and it does not make this call yet:
   * `app/src/boot/62-learning.js` recomputes the blind-guess audit live when `bank-audit.json` is
   * stale, by driving `collectBankSample` through `select()` across every knowledge point. That
   * sweep is synchronous, so no chunk it triggers can resolve while it runs — measured here, the
   * sweep ends with **0 groups resident and 32 in flight**, and the sample it produced is therefore
   * 100% generator-sourced. Splitting the catalogue is what made that true, so P31 owns the fix and
   * this is it: `await itemBank.ensureAll()` before the sweep makes the audit price the population
   * a learner is actually served, and makes the 93.0 kB cost explicit and awaited instead of a
   * thirty-two-request stampede whose answers arrive too late to be used.
   *
   * `62-learning.js` belongs to P16, so the one-line call site is named in P31's handoff rather
   * than edited here. `review/measure/P31.mjs` F1 measures both halves of the defect.
   */
  async ensureAll() {
    return this.ensure(KP_IDS);
  }

  /** Every knowledge point in a lesson, in prerequisite order. The session-opener call. */
  async ensureLesson(lessonId) {
    const lesson = LESSONS.find((l) => l.id === lessonId);
    if (!lesson) return { requested: 0, loaded: 0, alreadyResident: 0, failed: [], lesson: null };
    const out = await this.ensure(lesson.kpIds);
    return { ...out, lesson: lesson.id };
  }

  /**
   * ------------------------------------------------------------------------------------------
   * THE CALLER. `app/src/boot/62-itembank.js` runs this, in idle time, on every page load.
   * ------------------------------------------------------------------------------------------
   *
   * Round 2 shipped `ensure`, `ensureLesson` and `prefetchAround` and gave them no caller inside
   * the game. The critic drove the real built app's scheduler for 117 items and it pulled 0 of 32
   * group chunks: the delivery mechanism was documentation, the idle prefetch never ran, and the
   * DEFAULT path for the first item on every knowledge point was the degraded generator — so the
   * first item a learner ever met on a node would not be one of the thirty-six a human reviewed.
   *
   * This closes that. It asks the mastery engine what the learner is actually working on
   * (`learning.frontier()[0]` — the first unlocked, unmastered knowledge point in prerequisite
   * order), resolves the lesson that knowledge point belongs to, and pulls that lesson's groups.
   * `ensure()` then triggers `prefetchAround()`, so the rest of the lesson and the head of the next
   * one arrive during idle too.
   *
   * It costs ZERO first-load bytes: it runs inside `requestIdleCallback` after boot has returned,
   * and a lesson is 2.3-7.9 kB gzipped. The engine is the source of truth for what to warm, so a
   * returning learner warms where they are, not where the course starts.
   *
   * It never throws. A warm that fails leaves the game exactly where round 2 left it — degrading
   * to the generator on first touch — and says so in `probe().warm.reason`.
   *
   * ROUND 4 — IT HAS TO FOLLOW THE LEARNER, NOT THE PAGE LOAD.
   *
   * Round 3 called this exactly once, inside `setup()`. The product goal is a student who tests out
   * of `expressions-1` in two minutes and walks into `expressions-2`; under round 3 they walked
   * into a lesson nothing had warmed, and every first item on it came from the generator. So
   * `app/src/boot/62-itembank.js` now calls this again whenever the frontier crosses a lesson
   * boundary, and `trigger` records which of the two paths asked. Cost per re-warm is one idle call
   * and one lesson — 3.4 kB gzipped at the median.
   *
   * And the boundary itself is pre-empted: once the learner is at or past the halfway point of the
   * lesson they are on, the WHOLE next lesson is queued during idle (`prefetchLesson`), so crossing
   * costs nothing at all. `prefetchAround` only ever took the head of the next lesson, which meant
   * the second knowledge point after a boundary was still cold.
   */
  async warmFrontier(learningOrGetter, { trigger = "boot" } = {}) {
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    const record = {
      at: Date.now(),
      seq: WARM_SEQ + 1,
      trigger,
      kpId: null,
      lesson: null,
      groups: 0,
      failed: [],
      ms: 0,
      reason: null,
      lessonProgress: null,
      nextLesson: null,
      nextLessonQueued: [],
    };
    try {
      // A THUNK is allowed, and is what the boot module passes: `62-learning.js` mounts at the
      // same order as `62-itembank.js`, so the registry lookup has to happen when the idle
      // callback runs, not when `setup()` schedules it.
      const learning = typeof learningOrGetter === "function" ? learningOrGetter() : learningOrGetter;
      const frontier = typeof learning?.frontier === "function" ? learning.frontier() : null;
      record.kpId = Array.isArray(frontier) ? (frontier[0] ?? null) : null;
      if (!record.kpId) {
        record.reason = frontier ? "frontier-empty" : "no-learning-system";
      } else {
        const lesson = this.lessonFor(record.kpId);
        if (!lesson) {
          record.reason = `no lesson contains "${record.kpId}"`;
        } else {
          const out = await this.ensureLesson(lesson.id);
          record.lesson = lesson.id;
          record.groups = out.loaded;
          record.failed = out.failed;
          record.reason = out.failed.length ? "partial" : "ok";

          const ahead = this.lookaheadFrom(lesson.id, learning);
          record.lessonProgress = ahead.progress;
          record.nextLesson = ahead.nextLesson;
          record.nextLessonQueued = ahead.queued;
        }
      }
    } catch (err) {
      record.reason = `warm-failed: ${String(err?.message || err)}`;
      raise({ kind: "warm-failed", error: record.reason });
    }
    record.ms = Math.round(((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0) * 10) / 10;
    WARM_SEQ += 1;
    WARM = record;
    WARM_LOG.push({ seq: record.seq, trigger, lesson: record.lesson, groups: record.groups, reason: record.reason, nextLesson: record.nextLesson });
    if (WARM_LOG.length > 16) WARM_LOG.shift();
    return record;
  }

  /**
   * THE LOOKAHEAD. Queue the WHOLE next lesson once this one is at least half behind the learner.
   *
   * Idempotent and cheap — `prefetchLesson` filters out anything resident, loading or failed — so
   * `app/src/boot/62-itembank.js` can call it on the same idle re-check that watches for a lesson
   * change, which is what makes it reachable in the MIDDLE of a lesson. Evaluating it only inside
   * `warmFrontier` would have made it dead code: a warm happens at the moment the frontier crosses
   * into a lesson, and progress into a lesson you have just entered is zero.
   */
  lookaheadFrom(lessonId, learning) {
    const lesson = LESSONS.find((l) => l.id === lessonId);
    if (!lesson) return { progress: null, nextLesson: null, queued: [] };
    const progress = this.lessonProgress(lesson, learning);
    if (progress < LOOKAHEAD_AT) return { progress, nextLesson: null, queued: [] };
    const next = LESSONS[LESSONS.indexOf(lesson) + 1];
    if (!next) return { progress, nextLesson: null, queued: [] };
    return { progress, nextLesson: next.id, queued: this.prefetchLesson(next.id) };
  }

  /**
   * How far through a lesson this learner is, in [0,1].
   *
   * Two readings, and the larger wins. `mastery.status` is the accurate one and is present on the
   * shipped `learning` system; the frontier's own position inside the lesson is the fallback, and
   * it is what the offline harnesses (which mount only `frontier()`) can supply. Both answer the
   * same question — how much of this lesson is behind the learner — and neither can be gamed by
   * the other being absent.
   */
  lessonProgress(lesson, learning) {
    const ids = lesson.kpIds;
    if (!ids.length) return 1;
    let byStatus = 0;
    const statusOf = learning?.mastery?.status;
    if (typeof statusOf === "function") {
      const mastered = ids.filter((id) => {
        try {
          return learning.mastery.status(id) === "mastered";
        } catch {
          return false;
        }
      }).length;
      byStatus = mastered / ids.length;
    }
    const frontier = typeof learning?.frontier === "function" ? learning.frontier() : null;
    const head = Array.isArray(frontier) ? frontier[0] : null;
    const idx = head ? ids.indexOf(head) : -1;
    const byPosition = idx < 0 ? 0 : idx / ids.length;
    return Math.round(Math.max(byStatus, byPosition) * 1000) / 1000;
  }

  /** The same, deferred to idle time so it cannot compete with the first frames. */
  warmFrontierWhenIdle(learningOrGetter, opts = {}) {
    return new Promise((resolve) => idle(() => resolve(this.warmFrontier(learningOrGetter, opts))));
  }

  /**
   * Pull one locale's item text and make it the active one. Awaited once at boot, exactly the way
   * `boot/05-i18n.js` awaits its UI bundle, so every `text()` and `present()` afterwards is
   * synchronous and complete.
   */
  async loadLocale(locale) {
    const want = LOCALES.includes(locale) ? locale : "en";
    const table = await loadLocaleTable(want);
    if (table) this.locale = want;
    return this.locale;
  }

  /** Which item-text locales are in memory. `probe()` reports it; nothing gameplay depends on. */
  localesResident() {
    return [...TEXT.keys()];
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
    for (const id of queue) idle(() => touch(id, "prefetch"));
    return queue;
  }

  /**
   * Pull a WHOLE lesson during idle time. This is the lookahead `warmFrontier` fires once the
   * learner is halfway through the lesson they are on.
   *
   * `prefetchAround` walks forward INSIDE the current lesson and takes only the head of the next
   * one, which leaves the lesson boundary itself cold — and the lesson boundary is exactly where
   * the stated product goal puts the learner who tests out in two minutes. A lesson is 2.3-9.6 kB
   * gzipped, median 3.4 kB: less than one KaTeX font, and cheaper than the first item of the next
   * lesson arriving from the generator instead of from the thirty-six a human reviewed.
   */
  prefetchLesson(lessonId) {
    const lesson = LESSONS.find((l) => l.id === lessonId);
    if (!lesson) return [];
    const queue = lesson.kpIds.filter((id) => !RESIDENT.has(id) && !INFLIGHT.has(id) && !FAILED.has(id));
    for (const id of queue) idle(() => touch(id, "prefetch"));
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
      failed: Object.fromEntries(
        [...FAILED].map(([id, f]) => [id, { ...f, retryInMs: retryIn(id) }])
      ),
    };
  }

  /**
   * Switch language. The flip happens when the new table is RESIDENT, not when the request is
   * made: `text()` is synchronous, and flipping first would put `⟨fail.slip⟩` in front of a
   * learner for a few hundred milliseconds. Until then they keep reading the language they were
   * reading — a delayed switch, not a fallback to English (G3).
   */
  setLocale(locale) {
    if (!LOCALES.includes(locale)) return this.locale;
    if (TEXT.has(locale)) {
      this.locale = locale;
      return this.locale;
    }
    this.pendingLocale = locale;
    loadLocaleTable(locale).then((table) => {
      if (table && this.pendingLocale === locale) this.locale = locale;
    });
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

  /**
   * Resolve one locale key with its parameters. Never falls back to English (G3).
   *
   * The table is per-locale and lazily loaded, so there is a fourth failure mode round 2 did not
   * have: the table is not in memory. It is not silently papered over with English — that is the
   * exact bug G3 exists to forbid — it is reported as the missing key it is, the load is started,
   * and `probe().localesResident` shows a reviewer why. In practice it does not happen: the boot
   * module awaits `loadLocale()` before publishing the bank, the way `05-i18n.js` does.
   */
  text(key, params = {}, locale = this.locale) {
    const table = TEXT.get(locale);
    if (!table) {
      loadLocaleTable(locale);
      return `⟨${key}⟩`;
    }
    const src = table[key];
    if (src === undefined) return `⟨${key}⟩`;
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
   *
   * ==================================================================================================
   * `accepts(item)[0]` IS GUARANTEED TYPEABLE, AND IT DID NOT USED TO BE
   *
   * The learner constructs a response by typing, and `learn/Teaching.js`'s entry admits exactly
   * `ENTRY_GRAMMAR` below — no backslash, no braces, no superscript. Round 2 shipped a bank whose own
   * first accepted spelling was outside that set for 241 of 1,152 committed items:
   * `answerType: "pair"` documented `x = 8,\; y = 8`, `repair` documented `2: 4 \cdot 30`,
   * `expression` documented `\frac{11}{n}`, `partition` documented `3x, 7x \;\mid\; 4y, 2y \;\mid\; 6`
   * and `construction` documented `2 - 2\left(x + 8\right)`. Not one of them can be entered through
   * the shipped surface. An acceptance set stated in a grammar the answer surface refuses is not an
   * acceptance set; it is a defect wearing documentation.
   *
   * So `spellTypeable` rewrites the canonical (or, failing that, the TeX) into the grammar the entry
   * allows — `\cdot` to `*`, `\frac{a}{b}` to `(a)/(b)`, `\ge` to `>=`, `x^{2}` to `x*x`, spacing
   * commands to spaces — and the result goes FIRST. `review/measure/P34.mjs` runs the shipped
   * `check()` over every committed item's `accepts()[0]` and fails the run unless all 1,152 are both
   * inside the grammar and marked correct. The old spellings stay in the list behind it: they are
   * still accepted, they are just no longer the one a caller reaches for first.
   * ==================================================================================================
   */
  accepts(item) {
    const first = spellTypeable(item);
    const rest = this.#acceptsRaw(item);
    return first ? [first, ...rest.filter((s) => s !== first)] : rest;
  }

  #acceptsRaw(item) {
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
      degraded: Object.entries(res.failed).map(
        ([kpId, f]) => `${kpId}: ${f.error} (${f.attempts} attempts, retry in ${Math.round(f.retryInMs / 1000)}s)`
      ),
      issues: ISSUES.length,
      lastIssue: ISSUES.length ? ISSUES[ISSUES.length - 1] : null,
      // Did the SHIPPED game call the loader on this page load, and what did it get? Null here
      // means the per-lesson path exists and nothing ran it — which is the state round 2 shipped.
      warm: WARM,
      /**
       * Round 4. ONE warm is the state round 3 shipped: per-lesson loading that fired at boot and
       * then never followed the learner. `warms` > 1 with distinct `lesson` values is the evidence
       * that it does now, and `trigger` says which path asked for each.
       */
      warms: WARM_SEQ,
      warmLog: WARM_LOG.slice(),
      /**
       * Where every group load on this page came from. `demand` is a cold `select()`; `prefetch` is
       * idle lookahead; `explicit` is `ensure`/`ensureLesson`/`warmFrontier`. `suppressed` counts
       * cold selects the sweep guard refused — non-zero means something drove the bank at a rate no
       * learner can produce (the live bank-audit fallback is the one that does).
       */
      loads: { ...LOADS },
      itemLocale: this.locale,
      localesResident: [...TEXT.keys()],
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

/* ------------------------------------------------------------------ the entry grammar */

/**
 * ONE CHARACTER OF A CONSTRUCTED RESPONSE — the acceptance set stated in the grammar the answer
 * surface allows, which is the whole point of it living here.
 *
 * `learn/Teaching.js` owns the entry and has its own copy as a fallback; `boot/92-teaching.js`
 * injects THIS one over it, so the set the bank promises and the set the keyboard admits are the
 * same object at runtime and cannot drift into the round-2 state where they disagreed on 241 items.
 * Every character is legal KaTeX on its own, so a half-typed response never reaches `Tex.validate`
 * as something it must refuse.
 */
export const ENTRY_GRAMMAR = /^[0-9a-zA-Z+\-*/=<>.,()|:; ]$/;
const ENTRY_GRAMMAR_ALL = /^[0-9a-zA-Z+\-*/=<>.,()|:; ]*$/;

/** Is this whole spelling something the learner could actually type? */
export function isTypeable(s) {
  return ENTRY_GRAMMAR_ALL.test(String(s ?? ""));
}

/**
 * TeX -> the entry grammar. Meaning-preserving by construction: every rewrite below is a different
 * spelling of the same operation, and `#canonicalize` reads both spellings to the same canonical
 * form. `x^{2}` becomes `x*x` because the entry has no superscript and `\^` is not legal KaTeX on
 * its own — the alternative was admitting `^`, which makes the half-typed `x^` a refused claim and
 * therefore a recorded KaTeX failure on a surface that is re-typeset every keystroke.
 */
function deTex(src) {
  let s = String(src ?? "");
  s = s.replace(/\\left|\\right/g, "");
  s = s.replace(/\\cdot|\\times/g, "*");
  s = s.replace(/\\div/g, "/");
  s = s.replace(/\\ge/g, ">=").replace(/\\le/g, "<=");
  s = s.replace(/\\mid/g, "|");
  s = s.replace(/\\quad|\\qquad|\\;|\\,|\\:|\\!/g, " ");
  // Nested fractions need more than one pass; four is deeper than anything the bank ships.
  for (let i = 0; i < 4; i += 1) s = s.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "($1)/($2)");
  s = s.replace(/([A-Za-z0-9)])\^\{?(\d)\}?/g, (m, base, n) => {
    const k = Number(n);
    return k >= 1 && k <= 4 ? Array(k).fill(base).join("*") : m;
  });
  s = s.replace(/\\\{|\\\}/g, "").replace(/[{}]/g, "");
  return s.replace(/\s+/g, " ").trim();
}

/**
 * The first spelling of this item's answer that a learner could type. `null` when nothing survives —
 * which is a content fault worth seeing rather than papering over, so it is not substituted for.
 */
function spellTypeable(item) {
  const a = item?.answer;
  if (!a) return null;
  const pick = (...candidates) => {
    for (const c of candidates) {
      if (c == null) continue;
      const s = deTex(c);
      if (s && isTypeable(s)) return s;
    }
    return null;
  };
  switch (item.answerType) {
    case "repair": {
      // `2|120` and `2|1*q + -9 = 0` — the line number, then the value in whichever kind it is.
      const i = String(a.canonical ?? "").indexOf("|");
      if (i < 0) return pick(a.canonical, a.tex);
      const value = pick(a.canonical.slice(i + 1), a.tex);
      return value ? `${a.canonical.slice(0, i)}: ${value}` : null;
    }
    case "partition":
      return pick(String(a.canonical ?? "").replace(/\|/g, " | "), a.tex);
    case "pair":
      return pick(String(a.canonical ?? "").replace(/;/g, ", "), a.tex);
    default:
      return pick(a.canonical, a.tex);
  }
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
  WARM = null;
  WARM_SEQ = 0;
  WARM_LOG.length = 0;
  __resetLoadStats();
}
/** Where every load on this page came from, and how many cold selects the sweep guard dropped. */
export function __loadStats() {
  return { ...LOADS, recentWindow: SPECULATION_RECENT, recentCold: RECENT_COLD.slice() };
}
export function __resetLoadStats() {
  for (const k of Object.keys(LOADS)) LOADS[k] = 0;
  RECENT_COLD = [];
  SPECULATING.clear();
}
/**
 * Widen or restore the sweep guard's relevance window, so `review/measure/_p31-audit-sweep.mjs`
 * can run the SAME sweep with the guard effectively off and prove that bounding it changes no
 * price. `null` restores the shipped value. Nothing in `app/` calls this.
 */
export function __setSpeculationRecent(n) {
  SPECULATION_RECENT = n == null ? SPECULATION_RECENT_DEFAULT : n;
  return SPECULATION_RECENT;
}
/** Make a group's chunk refuse to load, the way a dropped connection would. */
export function __faultGroup(kpId, on = true) {
  if (on) FAULT.add(kpId);
  else FAULT.delete(kpId);
  __evictGroup(kpId);
}
/**
 * Age a recorded failure, so the retry window can be proved without sleeping through it. Thirty
 * real seconds inside a proof script measures patience, not code.
 */
export function __ageFailure(kpId, byMs) {
  const f = FAILED.get(kpId);
  if (f) f.at -= byMs;
  return { kpId, agedByMs: byMs, retryAfterMs: RETRY_AFTER_MS, retryInMs: retryIn(kpId), failed: !!f };
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
