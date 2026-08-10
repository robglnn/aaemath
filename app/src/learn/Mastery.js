import { signals } from "../core/Signals.js";
import { Graph } from "./Graph.js";

/**
 * Mastery — the learner model.
 *
 * Bayesian knowledge tracing per knowledge point, one global ability estimate, and the mastery
 * gate. Every parameter comes out of `content/knowledge-graph.json` under `model`; nothing here
 * is a duplicated constant (the two exceptions are named where they occur and both are gaps in
 * the content file, reported rather than hidden).
 *
 * ---------------------------------------------------------------------------------------------
 * THE ONE THING THIS FILE EXISTS TO GET RIGHT
 *
 * An item's price has **three** factors, not one.
 *
 *   - the **form** decides how big the answer space is *in principle* (`construct`, `repair`,
 *     `generate`, `select4`, `judge2`);
 *   - the **teaching phase** decides how much of that space the world has already filled in
 *     (`solo`, `guided-1`, `guided-2`, `guided-3`, `model`);
 *   - the **knowledge point's actual pool in the shipped bank** decides how big the answer space
 *     REALLY is, which is a fact about `content/items`, not about this file.
 *
 * The third factor is the one that was missing, and it is the one a critic caught. `construct`
 * is priced at a blind rate of 0.03 because "a numeric slot accepts about forty values". That is
 * true of `eq-one-add`. It is false of `eq-special-cases`, whose entire `construct` pool asks
 * "one footing, an always, or a refusal" and whose answers are drawn from a set of size TWO:
 * a responder who types `always` on every item is right 100% of the time on the family that
 * produces them. Its `repair` pool is worse — every item in it, catalogue and generator alike, has
 * the single answer `3|0 = 0`. A form-level constant cannot see either of those, because the leak
 * is not in the form; it is in the pool the form is drawn from.
 *
 * ROUND 2 GOT THE THIRD AXIS'S POPULATION WRONG, which is worth as much space as the axis itself.
 * It measured the price on 12-17 committed items pooled with 256 generator draws per cell — 4.5%
 * catalogue — while `ItemBank.select()` answers from the catalogue FIRST and the no-repeat window
 * was too small to walk it out, so a real run served 97% catalogue. Every rate it produced was
 * about a bank nobody was handed. Two things changed, in this order:
 *
 *   - `Scheduler` now publishes the no-repeat window per (knowledge point x form) instead of one
 *     global list of forty, so a cell's catalogue is genuinely walked out and the generator
 *     genuinely supplies the rest. That is a fix to the SERVING. A learner was meeting the same
 *     handful of items for the whole curriculum, and one family measured 0.958 blind because one
 *     string answered 23 of the 24 items it ever served. Re-pricing that would have been agreeing
 *     to keep showing it.
 *   - `collectBankSample` draws the audit THROUGH `select()` under that same window, and
 *     `auditBlindGuessing` measures the catalogue and the generator SEPARATELY and prices the
 *     worse one. Pooling them is how a 15-item pool whose modal answer wins a third of the time
 *     gets diluted to 0.14 by 145 generator draws — and the mastery gate needs only
 *     `minScoredOpportunities` items, so the catalogue alone is a long enough horizon to be
 *     certified inside.
 *
 * So the true rate is measured off the bank the game actually serves and composed as a third
 * term. A scaffold shrinks an answer space in exactly the way a multiple choice does, and a
 * degenerate item family shrinks it further still. Crediting any of those at the unconstrained
 * guess parameter is how mastery gets bought. Therefore:
 *
 *   trueGuess(kp, f, ph, fam)   = max( trueGuessByForm[f],
 *                                      trueGuessByPhase[ph],
 *                                      measuredBlindRate(kp, f, fam) )
 *   modelledGuess(kp,b,f,ph,fam)= max( b.guess x max(guessByForm[f], guessByPhase[ph]),
 *                                      measuredBlindUpper(kp, f, fam) )
 *
 * `fam` is the family the presenter says it served. Named and surviving, it is priced at its own
 * measured bound, because the family is the granularity the REFUSAL is made at and pricing at a
 * coarser one would be pricing a different item. Unnamed, the cell's worst surviving family
 * stands — the conservative default, and the only one available, since the engine cannot price
 * what it was not told.
 *
 * composed by `max` and never by product, because a scaffold puts a **floor** under blind
 * success — placing the first step cannot make an item harder to fluke — and a small answer pool
 * puts a floor under it too.
 *
 * And there are three gates, not one, in strictly increasing strength:
 *
 *   scorable        — the pair may produce a BKT update at all       {construct,repair,generate} x {solo, guided-1}
 *   mastery-eligible— the pair may increment M2 / M3 counters        {construct,repair,generate} x {solo}
 *   credited upward — this particular response may move P(known) up  (not fast, not hinted)
 *
 * All three are **derived from the identifiability caps at construction**, then cross-checked
 * against the arrays the content file declares. A form or phase that violates the caps is
 * *rejected from the scored path*, never clamped: `identifiabilityCaps.clampTrueRates` is false
 * and clamping a yes/no item's real 0.50 down to 0.30 is precisely how a mastery gate gets
 * handed to a coin.
 *
 * The same rejection now runs on the third axis, per (knowledge point x form x FAMILY). On the
 * shipped bank 49 groups measure above `maxTrueGuess` and are refused by name, eleven cells lose
 * every family they had, one knowledge point (`eq-special-cases`, a leaf) is left unmasterable and
 * one (`expr-anatomy`) is left with a single honest form. M3 degrades to "every mastery-eligible
 * form this knowledge point actually has" rather than deadlocking the graph behind a gate the
 * content cannot satisfy — `expr-anatomy` is a band-1 node and everything downstream of it would
 * be permanently locked. That degradation is reported in `issues` and in the probe, never silent,
 * because it is a CONTENT defect with a named fix (see `bankPricing.relaxed`).
 * ---------------------------------------------------------------------------------------------
 */

const STATE_VERSION = 1;

/**
 * The one number the runtime needs that `model` does not carry: §3 says "a review whose posterior
 * lands below 0.90" is a lapse, and there is no `spacing.reviewLapseBelow` field to read it from.
 * Declared here, named, and reported in the handoff as a content gap rather than buried.
 */
export const REVIEW_LAPSE_BELOW = 0.9;

export const logistic = (x) => 1 / (1 + Math.exp(-x));

/**
 * One BKT observation: posterior, then the learning transition, then the credit weight.
 *
 *   P+ = P(1-slip) / ( P(1-slip) + (1-P)guess )        correct
 *   P- = P�slip    / ( P�slip    + (1-P)(1-guess) )    wrong
 *   P <- w( P� + (1-P�)learn ) + (1-w)P_before
 *
 * `weight` is 1.0 for the item's primary knowledge point and `prerequisiteCreditWeight` (0.5)
 * for a prerequisite the item also exercised.
 */
export function bktUpdate(p, correct, slip, guess, learn, weight = 1) {
  const num = correct ? p * (1 - slip) : p * slip;
  const den = correct ? p * (1 - slip) + (1 - p) * guess : p * slip + (1 - p) * (1 - guess);
  const posterior = den > 0 ? num / den : p;
  const withLearning = posterior + (1 - posterior) * learn;
  return weight * withLearning + (1 - weight) * p;
}

// ============================================================== the bank audit (third axis)

/**
 * How many items the audit DRAWS THROUGH THE SERVING PATH per (knowledge point x form) cell.
 *
 * ------------------------------------------------------------------------------------------
 * ROUND 2's FINDING, AND WHY THIS NUMBER IS NOW A DRAW COUNT AND NOT A GENERATOR COUNT
 *
 * The previous version of this audit pooled the committed catalogue (12-17 items per cell) with
 * 256 GENERATOR draws per form and priced the mixture. That sample is 4.5% catalogue. A real
 * Scheduler-driven run is 97% catalogue, because `ItemBank.select()` answers from the catalogue
 * first and the no-repeat window is far too small to exhaust it. So the engine was pricing a
 * population no player is ever served — the same defect class that cost this project two pieces.
 *
 * The sample is now DRAWN THROUGH `select()` itself, with the same exclusion window the Scheduler
 * publishes on `req.avoidItemIds`, so pricing and serving are the same distribution by
 * construction rather than by hope. `review/measure/P16.mjs` re-measures on a stream produced by
 * the real Scheduler and FAILS if the two disagree.
 * ------------------------------------------------------------------------------------------
 *
 * 160 is chosen so that the draw walks the committed catalogue out (12-17 items) and then spends
 * the remainder in the generator, which is exactly the sequence a learner meets on one knowledge
 * point. Both halves are then measured SEPARATELY and the worse one is the price (see
 * `auditBlindGuessing`), so the number only has to be large enough to characterise the generator,
 * not to balance the two populations against each other.
 */
export const BANK_AUDIT_PER_CELL = 192;

/**
 * The audit draws in LEARNER-SIZED EPISODES, and this is the number that makes it match the
 * request stream rather than merely share its select() call.
 *
 * A single long sweep of 192 draws per cell walks the whole catalogue out once and then spends the
 * rest in the generator, so every committed item is weighted equally. That is NOT what a learner
 * meets. Measured on a Scheduler-driven run, one learner is served about three items from
 * `distribute-numeric|generate` — out of a family of seven committed items — and the tier they sit
 * at decides WHICH three. Pooled over 24 learners that family delivered 72 draws over 7 distinct
 * ids and one fixed string answered 0.667 of them, while the equal-weight sweep of the same seven
 * items said 0.286. The leak was in the WEIGHTS, not in the item set.
 *
 * So the sample is 24 independent episodes of 8 items, each with its own fresh no-repeat window and
 * its own band tier, which reproduces both facts a learner's exposure has: a short horizon on any
 * one cell, and a tier that does not roam. `review/measure/P16.mjs` U39/U29/U30 re-measure on
 * independently seeded Scheduler runs and fail if the two disagree.
 */
export const BANK_AUDIT_EPISODES = 24;
export const BANK_AUDIT_ITEMS_PER_EPISODE = 8;

/**
 * The no-repeat window the audit draws under. It must equal `model.antiGuessing.noRepeatWithinItems`
 * AND the window the Scheduler actually publishes per (knowledge point x form); `review/measure/
 * P16.mjs` asserts all three are the same number, because a window mismatch is precisely how the
 * audit came to describe a different bank from the one being served.
 */
export const BANK_AUDIT_WINDOW = 40;

/**
 * Candidate strings tried per cell, and the cap on how many items of one group get marked.
 *
 * The candidate pool is built ACROSS THE WHOLE CELL and then tried against every family in it.
 * Per-family candidate pools were too narrow: `generate` items are marked against a PROPERTY, so
 * a string harvested from `eval-signed.minusneg` also satisfies items in `eval-signed.sumneg`, and
 * a family that only ever saw its own answers looked honest while a guesser typing the neighbour's
 * string was at 0.49.
 */
export const EXECUTED_CANDIDATES = 8;
export const EXECUTED_SAMPLE_CAP = 120;

/** Wilson 95% upper bound. A measured 0.136 over 400 draws is not "0.136"; it is "at most 0.175". */
export function wilsonUpper(hits, n) {
  if (!n) return 1;
  const z = 1.959964;
  const p = hits / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const s = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return Math.min(1, (c + s) / d);
}

/**
 * Draw the population a player is actually served, per (knowledge point x form), THROUGH THE
 * SERVING PATH.
 *
 * `select` is `ItemBank.select` — injected, never imported, for the same reason `Graph` takes its
 * JSON as an argument: this file must run unchanged inside Vite, inside plain Node and inside a
 * build tool, and a mastery module must not reach into a sibling feature module to do its own
 * pricing. Handing it in is also the only way the audit and the game can be the SAME draw: there
 * is one implementation of "what item comes next", and both call it.
 *
 * The exclusion set is a rolling window of the last `window` items drawn FROM THIS CELL, which is
 * exactly what `Scheduler` publishes on `req.avoidItemIds` (see `Scheduler._recentFor`). That is
 * the whole correction of round 2: the audit's window and the game's window are now one rule, so
 * "the catalogue is walked out and then the generator supplies" is either true of both or false
 * of both. `review/measure/P16.mjs` re-measures on a real Scheduler-driven stream and fails if the
 * mixtures diverge.
 *
 * Each row is tagged with the `source` `select()` reported, because the two sub-populations are
 * NOT pooled downstream — a guesser meets the catalogue first and can be certified inside it, so
 * diluting a degenerate 15-item catalogue with 145 generator draws is how a leak hides.
 *
 * @param {object} o
 * @param {(req:object)=>({item:object, source:string}|null)} o.select the shipped `ItemBank.select`
 * @param {string[]} o.kpIds knowledge points to audit
 * @param {(kpId:string)=>number} o.bandOf difficulty band of a knowledge point
 * @param {string[]} [o.forms] which forms to audit
 * @param {number} [o.perCell] draws per (knowledge point x form)
 * @param {number} [o.window] no-repeat window, per cell, in items
 * @param {Array<{kpId:string, items:Array<object>}>} [o.bankFiles] legacy shape, see `catalogueSelect`
 * @param {(kpId:string, opts:object)=>object|null} [o.generateOne] legacy shape
 * @param {string[]} [o.tiers] legacy shape
 * @returns {Array<{kpId:string, form:string, item:object, source:"catalogue"|"generated"}>}
 */
export function collectBankSample({
  select,
  kpIds,
  bandOf,
  forms = ["construct", "repair", "generate"],
  perCell = BANK_AUDIT_PER_CELL,
  itemsPerEpisode = BANK_AUDIT_ITEMS_PER_EPISODE,
  window = BANK_AUDIT_WINDOW,
  bankFiles = null,
  generateOne = null,
  tiers = null,
}) {
  // Callers written against the round-1 shape get the round-2 SEMANTICS rather than a silent
  // measurement of a population nobody is served: their catalogue and generator are wrapped in a
  // stand-in for `select()` that answers catalogue-first, exactly as the shipped bank does.
  const draw = typeof select === "function" ? select : catalogueSelect({ bankFiles, generateOne, tiers, bandOf });
  const ids = kpIds ?? (bankFiles ?? []).map((f) => f.kpId);

  /**
   * ONE EPISODE = one learner's whole exposure to this cell, which is about eight items: a
   * 22-session budget is ~780 items spread over 96 cells. The window is fresh per episode because
   * it is a different learner, and the TIER ROTATES inside the episode because that is what
   * `Scheduler._acquisitionRequest` now does.
   *
   * That rotation is load-bearing on both sides. Before it, acquisition re-requested the learner's
   * one nearest tier every time, `select()` answered from the two or three committed items filed
   * under it, and a learner's eight draws landed on a handful of items: measured on a
   * Scheduler-driven run, `distribute-numeric|generate` served 72 draws over 7 distinct ids and one
   * fixed string answered 0.667 of them, against 0.286 for the same seven items weighted equally.
   * With the rotation the eight draws walk the tier neighbourhood, the weights flatten, and the
   * audit and the stream measure the same number — which is the property `review/measure/P16.mjs`
   * U29/U30/U34/U39 check on independently seeded runs.
   */
  const DRIFT = [0, 1, -1, 2, -2];
  const episodes = Math.max(1, Math.round(perCell / itemsPerEpisode));

  const sample = [];
  for (const kpId of ids) {
    const band = typeof bandOf === "function" ? bandOf(kpId) : 3;
    for (const form of forms) {
      for (let e = 0; e < episodes; e += 1) {
        const recent = [];
        const exclude = new Set();
        const base = e % 5 === 0 ? band : 1 + ((e * 2 + band) % 5);
        for (let d = 0; d < itemsPerEpisode; d += 1) {
          const difficulty = Math.max(1, Math.min(5, base + DRIFT[d % DRIFT.length]));
          // Fixed seeds: the audit is a property of the bank, not of the run that measured it.
          const sel = draw({ kpId, form, difficulty, seed: ((e * 7919 + d) * 2654435761 + 17) >>> 0, exclude });
          if (!sel || !sel.item) continue;
          sample.push({ kpId, form, item: sel.item, source: sel.source === "catalogue" ? "catalogue" : "generated" });
          recent.push(sel.item.id);
          exclude.add(sel.item.id);
          while (recent.length > window) exclude.delete(recent.shift());
        }
      }
    }
  }
  return sample;
}

/**
 * A stand-in for `ItemBank.select()` built from a raw catalogue and a generator entry point.
 *
 * Only for callers that cannot hand in the real one (the round-1 call shape, and any harness that
 * wants the audit without constructing an `ItemBank`). It reproduces the one property the pricing
 * depends on: **the catalogue answers first**, and the generator is the fallback when exclusions
 * have walked the catalogue out.
 */
export function catalogueSelect({ bankFiles, generateOne, tiers, bandOf }) {
  const byCell = new Map();
  for (const file of bankFiles ?? [])
    for (const item of file.items ?? []) {
      const key = `${file.kpId}|${item.form}`;
      let list = byCell.get(key);
      if (!list) byCell.set(key, (list = []));
      list.push(item);
    }
  return ({ kpId, form, difficulty, seed, exclude }) => {
    const pool = byCell.get(`${kpId}|${form}`) ?? [];
    for (const d of [difficulty, null]) {
      const live = pool.filter((i) => !exclude.has(i.id) && (d == null || i.difficulty === d));
      if (live.length) return { item: live[(seed >>> 3) % live.length], source: "catalogue" };
    }
    if (typeof generateOne !== "function") return null;
    const band = typeof bandOf === "function" ? bandOf(kpId) : 3;
    const list = tiers ?? ["core"];
    for (let attempt = 0; attempt < 64; attempt += 1) {
      const item = generateOne(kpId, {
        form,
        tier: list[(seed + attempt) % list.length],
        band,
        seed: (seed + attempt * 7919 + 13) >>> 0,
      });
      if (item && !exclude.has(item.id)) return { item, source: "generated" };
    }
    return null;
  };
}

/**
 * The audit table is a property of the BANK, not of the run that measured it, so it is computed
 * once at build time (`tools/bank-audit.mjs`) and committed. This is the fingerprint that says the
 * committed table still describes the committed content: every item's identity and answer, plus
 * every constant that changes what the audit means.
 *
 * A build-time table is not an optimisation for its own sake. Measured on this machine, computing
 * it inside `setup()` costs 1.4 s of blocking main-thread arithmetic on EVERY page load, and it
 * has to finish before the first item can be priced, so it is 1.4 s the player spends looking at
 * nothing. It is also the same answer every time.
 *
 * The generator families are deliberately NOT hashed — hashing them means running them, which is
 * the cost this exists to avoid. `review/measure/P16.mjs` recomputes the whole table from scratch
 * and fails on any difference, so generator drift is caught by the proof rather than by the hash.
 */
export const BANK_AUDIT_VERSION = 2;

export function bankAuditFingerprint({ bankFiles, model }) {
  let h = 0x811c9dc5;
  const eat = (s) => {
    const str = String(s);
    for (let i = 0; i < str.length; i += 1) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    h ^= 0x7c; // field separator, so "ab"+"c" and "a"+"bc" differ
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  eat(`v${BANK_AUDIT_VERSION}`);
  eat(BANK_AUDIT_PER_CELL);
  eat(BANK_AUDIT_WINDOW);
  eat(EXECUTED_CANDIDATES);
  eat(EXECUTED_SAMPLE_CAP);
  eat(EXECUTED_FORMS.join(","));
  const caps = model?.bkt?.identifiabilityCaps ?? {};
  for (const k of Object.keys(caps).sort()) eat(`${k}=${caps[k]}`);
  for (const file of bankFiles ?? []) {
    eat(file.kpId);
    for (const item of file.items ?? []) {
      eat(item.id);
      eat(item.form);
      eat(item.family ?? "");
      eat(item.difficulty ?? "");
      eat(canonicalKey(item));
    }
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** The string a responder has to produce. `repair` carries its line number; both halves matter. */
export function canonicalKey(item) {
  const a = item.answer ?? {};
  if (item.answerType === "repair" && a.line != null && a.canonical == null) return `${a.line}|${a.tex}`;
  return String(a.canonical ?? a.tex ?? "");
}

/**
 * Forms whose marking rule is NOT "does the response canonicalise to this item's answer".
 *
 * `generate` is checked against a PROPERTY — "an expression with three terms", "an equation with
 * no solution" — so a single well-chosen string satisfies a whole family at once. Counting
 * canonical answers says `expr-anatomy|generate` has 437 distinct answers and is flukeable at
 * 0.011; running the shipped checker says one expression with three terms in it satisfies 93% of
 * the pool.
 *
 * Round 2 measured every OTHER form by counting canonical answers, and that was wrong too, only
 * less spectacularly: `check()` accepts more spellings than one canonical key, so a single string
 * can satisfy several distinct answers. On the committed catalogue the executed count beats the
 * canonical count on 17 family groups, by as much as 0.86. There is therefore no form left whose
 * marking rule can be inferred instead of run: **every form is executed**, and this constant only
 * survives as the list of forms that CANNOT fall back to counting when no checker is supplied.
 */
export const EXECUTED_FORMS = ["construct", "repair", "generate"];

/**
 * GROUND TRUTH, measured. What a responder with zero knowledge of the knowledge point actually
 * achieves on this (knowledge point x form) cell of the bank the game ships.
 *
 * The strategy measured is **best fixed answer**: type the same string on every item of the cell
 * and keep the one that wins most. It is the strategy a real guesser converges on within a
 * handful of items, it requires no algebra whatsoever, and it dominates the "pick uniformly
 * inside the answer's shape" strategy an earlier round of `review/measure/P16.mjs` measured —
 * which is exactly why that round reported `eq-special-cases|construct` at 0.335 (≈ one in three
 * of {number, always, none}) and `eq-special-cases|repair` at 0.002, and missed that the real
 * numbers are 0.53 and 1.00. A responder who does strictly better than best-fixed-answer would
 * have to know something about the mathematics, at which point they are not guessing.
 *
 * Reported per family as the point estimate (which decides REJECTION) and an upper bound (which
 * decides the MODELLED guess, because conservatism must survive sampling noise).
 *
 * ------------------------------------------------------------------------------------------
 * THE TWO SUB-POPULATIONS ARE NEVER POOLED, AND THAT IS THE ROUND-2 CORRECTION
 *
 * A cell's committed catalogue is 12-17 items and the generator behind it is unbounded. Pool them
 * and a 15-item catalogue whose modal answer wins 5 times — 0.333, already over the cap — is
 * diluted to 0.14 by 145 generator draws and priced as safe. But a learner meets the CATALOGUE
 * FIRST and the mastery gate needs only `minScoredOpportunities` items, so the catalogue alone is
 * a long enough horizon to be certified inside. Each source is therefore measured on its own and
 * the family's price is the WORSE of the two.
 *
 * Both halves are measured as MULTISETS, at the weights `collectBankSample`'s episodes actually
 * produced. An earlier version reduced the catalogue to one row per committed item on the theory
 * that a finite pool is a census with no sampling error. Its membership has none; its WEIGHTS have
 * plenty, and the weights are the whole story — `distribute-numeric|generate` has seven committed
 * items, equal-weighted they hand a fixed string 0.286, and at the weights a learner is served
 * they hand it 0.667.
 * ------------------------------------------------------------------------------------------
 *
 * @param {ReturnType<typeof collectBankSample>} sample
 * @param {object} [o]
 * @param {(item:object, response:string)=>boolean} [o.mark] the SHIPPED checker. Without it the
 *        audit falls back to counting canonical answers, which UNDERSTATES the blind rate, and
 *        every affected group is named in `notExecuted`.
 * @param {(item:object)=>string} [o.spell] a typable spelling of an item's own answer.
 * @param {string[]} [o.executedForms]
 */
export function auditBlindGuessing(
  sample,
  {
    mark = null,
    spell = null,
    executedForms = EXECUTED_FORMS,
    candidates: candidateCount = EXECUTED_CANDIDATES,
    executedCap = EXECUTED_SAMPLE_CAP,
  } = {}
) {
  /** cell -> every row of it, so the candidate pool can be built across families. */
  const byCell = new Map();
  for (const row of sample ?? []) {
    const cell = `${row.kpId}|${row.form}`;
    let rows = byCell.get(cell);
    if (!rows) byCell.set(cell, (rows = []));
    rows.push(row);
  }

  const families = {};
  const notExecuted = [];
  const mixture = { catalogue: 0, generated: 0 };

  for (const [cell, rows] of byCell) {
    const form = cell.slice(cell.indexOf("|") + 1);
    const executed = executedForms.includes(form) && typeof mark === "function";

    // ---- the candidate pool, built ACROSS THE WHOLE CELL.
    // A guesser sees one cell, not one family, and the string that beats `eval-signed.minusneg`
    // is harvested from whichever family happens to produce it. Ranking by canonical frequency
    // first means the cheap strings a responder actually reaches for come first, and the early
    // abandonment below makes the tail nearly free.
    const counts = new Map();
    for (const row of rows) {
      const ckey = canonicalKey(row.item);
      const hit = counts.get(ckey);
      if (hit) hit.n += 1;
      else counts.set(ckey, { n: 1, item: row.item });
    }
    const ranked = [...counts.entries()].sort((a, b) => b[1].n - a[1].n);
    const candidates = [];
    const seenCandidate = new Set();
    const addCandidate = (raw) => {
      if (raw == null) return;
      const str = String(raw);
      if (seenCandidate.has(str)) return;
      seenCandidate.add(str);
      candidates.push(str);
    };
    for (const [ckey, rec] of ranked.slice(0, candidateCount))
      addCandidate(typeof spell === "function" ? spell(rec.item) : ckey);
    // EVERY family's own top two answers, on top of the cell's, so the executed rate can never be
    // LOWER than a plain count of canonical answers would have been. A cell-wide top-8 misses a
    // three-item family whose answers never reach the cell's leaderboard, and the executed number
    // then reads 0.000 for a pool that a canonical count says is 0.333 — an audit that understates
    // is the only kind that matters.
    const perFamily = new Map();
    for (const row of rows) {
      const fam = row.item.family ?? "(unfamilied)";
      let c = perFamily.get(fam);
      if (!c) perFamily.set(fam, (c = new Map()));
      const ck = canonicalKey(row.item);
      const hit = c.get(ck);
      if (hit) hit.n += 1;
      else c.set(ck, { n: 1, item: row.item });
    }
    for (const c of perFamily.values())
      for (const [ckey, rec] of [...c.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 3))
        addCandidate(typeof spell === "function" ? spell(rec.item) : ckey);
    // The zero-knowledge staples: what a teenager types before reading the question.
    for (const s of ["0", "1", "x", "always", "none"]) addCandidate(s);

    // ---- group by (family x source). Catalogue groups are de-duplicated into a census.
    const groups = new Map();
    for (const row of rows) {
      mixture[row.source === "catalogue" ? "catalogue" : "generated"] += 1;
      // GRANULARITY IS THE WHOLE ARGUMENT. The leak is not in the form and it is not evenly spread
      // across a knowledge point: it is in individual FAMILIES. `expr-anatomy.coefficient` asks for
      // the coefficient of a bare x and the answer is 1, every single time, forever;
      // `expr-anatomy.term` sitting beside it in the same (kp x form) cell is perfectly sound.
      // Measuring the cell as a lump either condemns the sound family or excuses the broken one.
      const key = `${row.item.family ?? "(unfamilied)"}|${row.source}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { items: [], ids: new Set(), keys: new Set() }));
      // NOT de-duplicated. An earlier version reduced the catalogue to one row per committed item
      // — a census — on the theory that a finite pool has no sampling error. It has no sampling
      // error about its MEMBERSHIP and a great deal about its WEIGHTS, and the weights are the
      // whole story: seven items, of which the two a fixed string answers are the two a learner at
      // that tier is actually handed. The multiset as drawn is the population.
      g.ids.add(row.item.id);
      g.keys.add(canonicalKey(row.item));
      g.items.push(row.item);
    }

    /** Best fixed answer for one group over a candidate list, starting from a known floor. */
    const best = (g, marked, list, floorHits, floorAnswer) => {
      let hits = floorHits;
      let modalAnswer = floorAnswer;
      for (const candidate of list) {
        let h = 0;
        for (let i = 0; i < marked; i += 1) {
          // Early abandonment: a candidate that cannot catch the leader is not worth finishing.
          if (h + (marked - i) <= hits) break;
          try {
            if (mark(g.items[i], candidate)) h += 1;
          } catch {
            /* an unreadable response is simply wrong */
          }
        }
        if (h > hits) {
          hits = h;
          modalAnswer = candidate;
        }
      }
      return { hits, modalAnswer };
    };

    const scored = [];
    for (const [key, g] of groups) {
      const cut = key.lastIndexOf("|");
      const family = key.slice(0, cut);
      const source = key.slice(cut + 1);
      const marked = Math.min(g.items.length, executedCap);
      let hits = 0;
      let modalAnswer = null;

      if (executed) ({ hits, modalAnswer } = best(g, marked, candidates, 0, null));
      else {
        notExecuted.push(`${cell}|${family}|${source}`);
        const local = new Map();
        for (let i = 0; i < marked; i += 1) {
          const ck = canonicalKey(g.items[i]);
          local.set(ck, (local.get(ck) ?? 0) + 1);
        }
        for (const [ck, n] of local) if (n > hits) ((hits = n), (modalAnswer = ck));
      }
      scored.push({ g, family, source, marked, hits, modalAnswer });
    }

    // ---- SECOND PASS: every string that won ANY group is tried against EVERY group.
    //
    // A `generate` item is marked against a property, so the string harvested from one family
    // routinely satisfies its neighbour: `eval-signed.minusneg`'s "9 - x" also answers items in
    // `eval-signed.sumneg`. Without this pass a family's rate is only "the best of the strings we
    // happened to draw from it", and a guesser typing the cell's winner beats it — which is exactly
    // how a cell can measure 0.31 on the served stream while every one of its families audits under
    // 0.30. This closes it by construction: after the pass, no string anywhere in the cell beats
    // any family's recorded rate.
    if (executed) {
      const winners = [...new Set(scored.map((r) => r.modalAnswer).filter((s) => s != null))];
      for (const row of scored) {
        const untried = winners.filter((s) => s !== row.modalAnswer);
        if (!untried.length) continue;
        const lifted = best(row.g, row.marked, untried, row.hits, row.modalAnswer);
        row.hits = lifted.hits;
        row.modalAnswer = lifted.modalAnswer;
      }
    }

    for (const row of scored) {
      const { g, family, source, marked, hits, modalAnswer } = row;
      const rate = marked ? hits / marked : 0;
      // The catalogue half has NO sampling error to bound, and this is not a shortcut. Its
      // membership is a committed file and its WEIGHTS are the deterministic output of a fixed,
      // seeded walk of the serving policy — the multiset above IS the population, not a draw from
      // it. Putting a Wilson bound on it would refuse a pool measured at 0.25 for the crime of
      // being answered 25 times out of 100, which is a different error from the one this audit
      // exists to catch. The generator is a genuine sample from an unbounded family and gets one.
      const upper = source === "catalogue" ? rate : wilsonUpper(hits, marked);
      const key2 = `${cell}|${family}`;
      const prev = families[key2];
      const rec = { n: marked, distinct: g.keys.size, rate, upper, modalAnswer, executed, source };
      // The family's price is the WORSE of its two sub-populations, never their blend.
      if (!prev || rec.rate > prev.rate || (rec.rate === prev.rate && rec.upper > prev.upper)) {
        families[key2] = { ...rec, sources: { ...(prev?.sources ?? {}), [source]: { n: marked, rate, upper, modalAnswer } } };
      } else {
        prev.sources = { ...(prev.sources ?? {}), [source]: { n: marked, rate, upper, modalAnswer } };
      }
    }
  }

  // The cell aggregate, kept because it is what a caller that reports no family gets priced at,
  // and because "how bad is this knowledge point overall" is still a question worth answering.
  const cells = {};
  for (const [key, rec] of Object.entries(families)) {
    const cell = key.slice(0, key.lastIndexOf("|"));
    const agg = (cells[cell] ??= { n: 0, distinct: 0, rate: 0, upper: 0, modalAnswer: null, executed: rec.executed, familyCount: 0 });
    agg.n += rec.n;
    agg.distinct += rec.distinct;
    agg.familyCount += 1;
    // A guesser picks the softest family it is offered, so the cell's rate is the WORST family's,
    // not the average — an average would let one sound family launder three broken ones.
    if (rec.rate > agg.rate) {
      agg.rate = rec.rate;
      agg.upper = rec.upper;
      agg.modalAnswer = rec.modalAnswer;
    }
  }
  return { families, cells, sampled: sample?.length ?? 0, notExecuted, mixture };
}

// ---------------------------------------------------------------------------------------------

export class Mastery {
  /**
   * @param {Graph|object} graph a `Graph`, or the parsed knowledge-graph JSON
   * @param {object} [opts]
   * @param {() => number} [opts.now] wall clock in **minutes**. Injectable so a simulation can run
   *        eighteen sessions of spaced repetition without waiting eighteen days.
   * @param {(name:string, value:any) => void} [opts.emit] signal sink; defaults to core/Signals.
   * @param {Storage|null} [opts.storage] where session state is persisted; defaults to localStorage.
   * @param {string} [opts.storageKey]
   * @param {"exercises-or-band3"|"exercises-only"} [opts.prerequisiteCredit]
   * @param {ReturnType<typeof auditBlindGuessing>} [opts.bankAudit] measured blind-success rates
   *        per (knowledge point x form), from `collectBankSample` over the SHIPPED item bank.
   *        Omitting it prices on the content file's form-level constants alone, which is what
   *        the critic caught: `eq-special-cases|construct` is priced at a modelled 0.10 and
   *        measures 0.53. Omission is therefore RECORDED as an issue, not treated as normal.
   */
  constructor(graph, opts = {}) {
    this.graph = graph instanceof Graph ? graph : new Graph(graph);
    this.M = this.graph.model;

    this.now = opts.now ?? (() => Date.now() / 60000);
    this.emit = opts.emit ?? ((name, value) => signals.emit(name, value));
    this.storageKey = opts.storageKey ?? "vs.learn.mastery.v1";
    this.prerequisiteCreditMode = opts.prerequisiteCredit ?? "exercises-or-band3";
    // §1.2: "Prerequisite credit resets the prerequisite's spacing clock." Switchable so
    // review/measure/P16.mjs can measure what the rule is worth instead of asserting it.
    this.prerequisiteClockReset = opts.prerequisiteClockReset !== false;
    this._storage = opts.storage === undefined ? safeStorage() : opts.storage;

    /** Non-fatal content problems found at load. Surfaced in the probe so they cannot hide. */
    this.issues = [];

    this.pricing = derivePricing(this.M, this.issues);
    /** Third pricing axis: what the SHIPPED bank actually gives away, per (kp x form). */
    this.bankAudit = opts.bankAudit ?? null;
    this.cellPricing = deriveCellPricing(this.graph, this.M, this.pricing, this.bankAudit, this.issues);

    this.theta = this.M.ability.theta0;
    this.responses = 0;
    this.session = 0;
    this.sessionStartedAt = null;

    this.stats = {
      items: 0,
      scoredItems: 0,
      unscoredItems: 0,
      /** Of `unscoredItems`, the ones refused because the BANK cell was too guessable. */
      unpriceableCellItems: 0,
      refusedUpward: 0,
      prerequisiteCredits: 0,
      gateOpens: 0,
      certifications: 0,
      lapses: 0,
    };

    /**
     * Knowledge points with work open right now — the continuity block and any multi-item
     * certification event. §8 requirement 11 names `inFlight[]` as a top-level probe field, so it
     * lives here (learner state, persisted, restored) rather than only on the Scheduler, where a
     * reload used to drop it. The Scheduler writes it through `setInFlight()`.
     */
    this.inFlight = [];

    /** Set by `new Scheduler(this)`. Lets `snapshot()` carry the Scheduler's half of the state. */
    this._scheduler = null;

    this.byKp = new Map();
    for (const id of this.graph.ids) this.byKp.set(id, freshNodeState(this.graph.band(id).prior));
  }

  // ------------------------------------------------------------------- pricing

  /** The measured cell record for one (knowledge point x form), or null if it was never audited. */
  cell(kpId, form) {
    return this.cellPricing.cells[`${kpId}|${form}`] ?? null;
  }

  /**
   * GROUND TRUTH, third axis: the measured blind rate of this knowledge point's pool in this form.
   * 0 when the cell was not audited — which is reported as an issue rather than assumed safe.
   */
  bankBlindRate(kpId, form) {
    return this.cell(kpId, form)?.blind ?? 0;
  }

  /**
   * Does the bank's own pool for this (kp x form) survive the identifiability caps? A cell that
   * does not is REJECTED from the scored path for this knowledge point — never clamped, exactly
   * as `onFormExceedingCaps` requires on the other two axes.
   */
  isCellPriceable(kpId, form) {
    return this.cell(kpId, form)?.priceable !== false;
  }

  /**
   * The generator families of this (kp x form) the engine will NOT score. Published on every
   * request so whoever picks the item can pick a different one — the leak is closed either way,
   * but a refused item still costs the learner 46 s, so the honest move is to not serve it.
   */
  refusedFamilies(kpId, form) {
    return this.cell(kpId, form)?.refusedFamilies ?? [];
  }

  /**
   * Was THIS item's family one the engine will score? `null`/`undefined` means the presenter did
   * not say, and the cell-level price — the worst surviving family — stands.
   */
  isFamilyPriceable(kpId, form, family) {
    if (family == null) return this.isCellPriceable(kpId, form);
    const rec = this.cell(kpId, form)?.families?.[family];
    return rec ? rec.priceable : this.isCellPriceable(kpId, form);
  }

  /** Is this (form, phase) pair, ON THIS NODE, allowed to produce a BKT update at all? */
  isScorable(kpId, form, phase, family = null) {
    return (
      this.pricing.scoredForms.has(form) &&
      this.pricing.scoredPhases.has(phase) &&
      this.isCellPriceable(kpId, form) &&
      this.isFamilyPriceable(kpId, form, family)
    );
  }

  /** May this (form, phase) pair, ON THIS NODE, increment M2's counters and M3's form set? */
  isMasteryEligible(kpId, form, phase, family = null) {
    return (
      this.pricing.masteryForms.has(form) &&
      this.pricing.masteryPhases.has(phase) &&
      this.isCellPriceable(kpId, form) &&
      this.isFamilyPriceable(kpId, form, family)
    );
  }

  /**
   * GROUND TRUTH: what a responder with zero knowledge actually achieves on this exact item.
   *
   * When the presenter says which family it served, that family's OWN measured rate is the honest
   * number — it is the granularity the refusal is made at, so it is the granularity the price is
   * made at too. When it does not, the cell's worst SURVIVING family stands, which is the
   * conservative default and the only one available: the engine cannot price what it was not told.
   */
  trueGuess(kpId, form, phase, family = null) {
    const fam = family == null ? null : this.cell(kpId, form)?.families?.[family];
    return Math.max(
      this.pricing.trueByForm[form] ?? 0,
      this.pricing.trueByPhase[phase] ?? 0,
      fam && fam.priceable ? fam.blind : this.bankBlindRate(kpId, form)
    );
  }

  /**
   * MODEL BELIEF: the guess parameter the BKT update uses here.
   *
   * Lifted to the measured rate's 95% upper bound whenever the bank is more guessable than the
   * form/phase constants believe — that is the "re-price to the measured value" half of the rule.
   * The other half is `isCellPriceable`: when no value at or below `maxGuess` is conservative, the
   * cell is refused instead of being clamped down to `maxGuess`, because a clamp is precisely the
   * leak the caps exist to forbid.
   */
  modelledGuess(kpId, band, form, phase, family = null) {
    const base = band.guess * Math.max(this.pricing.multByForm[form] ?? 1, this.pricing.multByPhase[phase] ?? 1);
    const fam = family == null ? null : this.cell(kpId, form)?.families?.[family];
    // A named, surviving family is priced at its own bound; anything else at the worst family the
    // engine is still willing to serve. Both are >= the true blind rate of what was actually asked.
    return Math.max(base, (fam && fam.priceable ? fam.blindUpper : this.cell(kpId, form)?.blindUpper) ?? 0);
  }

  /**
   * The mastery-eligible forms this knowledge point ACTUALLY has, after the bank audit. M3 reads
   * this rather than the global `formsEligibleForMastery`, because a node whose `construct` and
   * `repair` pools are both blind-guessable has two forms on paper and one in reality.
   */
  masteryFormsFor(kpId) {
    return [...this.pricing.masteryForms].filter((form) => this.isCellPriceable(kpId, form));
  }

  /**
   * M3's bar for one node: `minDistinctItemForms`, or every honest form it has if it has fewer.
   * Never zero — a node with no honest form cannot pass M3 at all, which `gateDetail` enforces
   * directly rather than by arithmetic on an empty list.
   */
  requiredDistinctForms(kpId) {
    const have = this.masteryFormsFor(kpId).length;
    return Math.min(this.M.bkt.minDistinctItemForms, Math.max(1, have));
  }

  /**
   * Everything the engine believes about one prospective item, before it is answered. P17/P18 can
   * ask this to check they are about to serve something that counts.
   */
  price(kpId, form, phase = "solo", family = null) {
    const band = this.graph.band(kpId);
    const scorable = this.isScorable(kpId, form, phase, family);
    const cell = this.cell(kpId, form);
    return {
      kpId,
      form,
      phase,
      family,
      band: band.difficulty,
      slip: band.slip,
      modelledGuess: scorable ? this.modelledGuess(kpId, band, form, phase, family) : null,
      trueGuess: this.trueGuess(kpId, form, phase, family),
      scorable,
      masteryEligible: this.isMasteryEligible(kpId, form, phase, family),
      // Serve none of these. Each one is a generator family with a single memorised answer.
      avoidFamilies: this.refusedFamilies(kpId, form),
      // What the bank measured, and why the cell was refused if it was. A caller that serves an
      // item this engine will not score should be able to read the reason without guessing.
      bankBlindRate: cell ? cell.blind : null,
      bankBlindUpper: cell ? cell.blindUpper : null,
      bankModalAnswer: cell ? cell.modalAnswer : null,
      rejectedReason: cell?.reason ?? null,
      hintedByDefault: this.M.phases.hinted?.[phase] ?? false,
      seconds: this.M.phases.secondsPerItemByPhase?.[phase] ?? 46,
    };
  }

  // --------------------------------------------------------------------- state

  /** The live per-node record. Mutating spacing fields on it is the Scheduler's job, and only its. */
  stateOf(kpId) {
    const s = this.byKp.get(kpId);
    if (!s) throw new Error(`Mastery: unknown knowledge point "${kpId}"`);
    return s;
  }

  p(kpId) {
    return this.stateOf(kpId).p;
  }

  status(kpId) {
    return this.stateOf(kpId).status;
  }

  everUnlocked(kpId) {
    return this.stateOf(kpId).everUnlocked;
  }

  /**
   * §4 step 3. Unlocking is monotone, so the predicate reads `everUnlocked` and not the current
   * status: the world never re-locks behind a learner who lapsed.
   */
  frontier() {
    return this.graph.frontier(
      (id) => this.stateOf(id).everUnlocked,
      (id) => this.stateOf(id).status === "mastered"
    );
  }

  /** Ability-adjusted learn rate for a node, §3 rule 4 including `relearnRequiresPriorMastery`. */
  learnRate(kpId) {
    const s = this.stateOf(kpId);
    const band = this.graph.band(kpId);
    const sp = this.M.spacing;
    const boosted = s.relearn && (!sp.relearnRequiresPriorMastery || s.everMastered);
    return Math.min(sp.relearnLearnRateCap, band.learn * (boosted ? sp.relearnLearnRateMultiplier : 1));
  }

  kFactor() {
    for (const row of this.M.ability.kSchedule)
      if (row.untilResponses === null || this.responses < row.untilResponses) return row.k;
    return this.M.ability.kSchedule[this.M.ability.kSchedule.length - 1].k;
  }

  /**
   * §1.3, the two pitches. You **learn** at the edge of your ability and you **certify** at the
   * difficulty the standard names. Shipping the acquisition pitch alone means the at-band
   * requirement can never be satisfied and nothing is ever certified.
   */
  targetDifficulty(kpId, mode = "acquire") {
    const A = this.M.ability;
    const centre = this.graph.centre(kpId);
    if (mode !== "acquire") return centre;
    return this.stateOf(kpId).p >= A.certificationPitchThreshold
      ? centre + A.certificationOffset
      : this.theta + A.acquisitionTargetOffset;
  }

  // ------------------------------------------------------------------ sessions

  /**
   * A new play session. Matters twice: the `model`-phase budget is per node **per session**, and
   * M4's retention check needs at least one *intervening session*, which idle time cannot buy.
   */
  beginSession() {
    this.session += 1;
    this.sessionStartedAt = this.now();
    for (const s of this.byKp.values()) s.modelEvents = 0;
    this.emit("learn:session", { phase: "begin", summary: this.summary() });
    return this.session;
  }

  endSession() {
    this.emit("learn:session", { phase: "end", summary: this.summary() });
    this.persist();
  }

  // ------------------------------------------------------------------ responses

  /**
   * Score one learning opportunity. This is the whole engine in one function, and it is written
   * in gate order so a reviewer can read the refusals top to bottom.
   *
   * @param {object} r
   * @param {string} r.kpId
   * @param {boolean} r.correct
   * @param {string} r.form   one of model.forms.order / model.forms.unscored
   * @param {string} [r.phase="solo"]
   * @param {string} [r.itemId]
   * @param {number} [r.difficulty] item difficulty b on the logit scale; defaults to the band centre
   * @param {"acquire"|"consolidate"|"retention"|"review"} [r.mode="acquire"]
   * @param {number|null} [r.latencyMs]
   * @param {number} [r.promptTokens=0]
   * @param {boolean} [r.hinted] what the world ACTUALLY did — not what the phase name implies
   * @param {string[]} [r.exercises] prerequisites this item also exercised (§1.2 credit weight 0.5)
   * @param {string|null} [r.misconception]
   * @param {any} [r.response]
   */
  respond(r) {
    const kpId = r.kpId;
    const s = this.stateOf(kpId);
    const node = this.graph.node(kpId);
    const band = this.graph.band(kpId);
    const form = r.form;
    const phase = r.phase ?? "solo";
    const mode = r.mode ?? "acquire";
    const correct = !!r.correct;
    const b = Number.isFinite(r.difficulty) ? r.difficulty : band.logit;
    const before = s.p;

    s.attempts += 1;
    this.stats.items += 1;

    // What the world actually did, per response, never inferred from the phase name alone —
    // P18 may surface help inside `solo` for an accessibility reason and the gate has to see it.
    const hinted = typeof r.hinted === "boolean" ? r.hinted : (this.M.phases.hinted?.[phase] ?? false);
    if (hinted) s.hintedItems += 1;

    const out = {
      itemId: r.itemId ?? null,
      kpId,
      form,
      phase,
      mode,
      correct,
      latencyMs: r.latencyMs ?? null,
      response: r.response ?? null,
      hinted,
      scored: false,
      masteryEligible: false,
      // The engine's verdict, not the caller's: `correct` is what the world reported, `credited`
      // is what the engine is willing to count. Every gate reads this one.
      credited: false,
      reason: null,
      p: s.p,
      delta: 0,
      status: s.status,
    };
    if (r.misconception) {
      out.misconception = r.misconception;
      if (!correct) {
        s.consecutiveSameMisconception = s.lastMisconception === r.misconception ? s.consecutiveSameMisconception + 1 : 1;
        s.lastMisconception = r.misconception;
      }
    } else if (!correct) {
      s.lastMisconception = null;
      s.consecutiveSameMisconception = 0;
    }

    // ---- gate 1: the FORM x PHASE gate. M0 in §2, and the first thing written, not the last.
    // What the DIRECTOR chose is inert in BOTH directions: no posterior up or down, no counters,
    // no prerequisite credit, no theta movement. Punishing a learner for being taught cost an
    // earlier draft 34 percentage points of median Level 1 mastery.
    if (!this.isScorable(kpId, form, phase, r.family ?? null)) {
      this.stats.unscoredItems += 1;
      s.unscored += 1;
      out.reason = !this.pricing.scoredForms.has(form)
        ? "unscored-form"
        : !this.pricing.scoredPhases.has(phase)
          ? "unscored-phase"
          : // The third axis. Named separately because it is a CONTENT defect, not a design
            // choice: this form is fine in general and this item's family is not.
            !this.isCellPriceable(kpId, form)
            ? `unscored-cell:blind-${this.bankBlindRate(kpId, form).toFixed(3)}`
            : `unscored-family:${r.family}:blind-${(this.cell(kpId, form)?.families?.[r.family]?.blind ?? 1).toFixed(3)}`;
      if (out.reason.startsWith("unscored-cell") || out.reason.startsWith("unscored-family"))
        this.stats.unpriceableCellItems += 1;
      this._bookkeep(s, out);
      this._emitRespond(out);
      return out;
    }

    // ---- gate 2: what the LEARNER chose. Refused UPWARD only; the wrong side stands.
    const floorMs = this.M.antiGuessing.latencyFloorMs + this.M.antiGuessing.latencyPerTokenMs * (r.promptTokens ?? 0);
    const fast = Number.isFinite(r.latencyMs) && r.latencyMs < floorMs;
    if (fast) s.fastItems += 1;
    const refusedUpward = correct && (fast || hinted);
    if (refusedUpward) {
      this.stats.refusedUpward += 1;
      s.refusedUpward += 1;
      out.reason = fast ? "not-scored-upward:latency-floor" : "not-scored-upward:hinted";
      this._bookkeep(s, out);
      this._emitRespond(out);
      return out;
    }

    out.scored = true;
    out.masteryEligible = this.isMasteryEligible(kpId, form, phase, r.family ?? null);
    // `credited` is the engine's own verdict on this response, and it is the ONLY thing any gate
    // is allowed to count. See `_bookkeep`.
    out.credited = correct && out.masteryEligible;
    this.stats.scoredItems += 1;
    // Fire the response before anything moves, so a listener sees respond -> mastery -> unlock in
    // the order the world experiences them.
    this._bookkeep(s, out);
    this._emitRespond(out);

    // ---- ability, §1.3. Rasch + stochastic approximation with provisional-rating decay.
    this.theta += this.kFactor() * ((correct ? 1 : 0) - logistic(this.theta - b));
    this.responses += 1;

    // ---- BKT, §1.2. ONE guess prices both directions: using a smaller guess on the down-update
    // would be a second, quieter version of the clamping the caps forbid.
    const guess = this.modelledGuess(kpId, band, form, phase, r.family ?? null);
    const learn = this.learnRate(kpId);
    s.p = bktUpdate(s.p, correct, band.slip, guess, learn, 1);
    out.p = s.p;
    out.delta = s.p - before;

    // ---- M2 / M3 counters. Opportunities, not correct answers: right or wrong, the learner met
    // the skill unaided. Both axes must clear, and only acquisition fills the gate.
    const eligible = out.masteryEligible;
    if (mode === "acquire" && eligible) {
      s.scored += 1;
      if (b >= band.logit) s.atBand += 1;
      if (!s.forms.includes(form)) s.forms.push(form);
      // M5 is a real check even though the policy above makes it unreachable: if a future edit
      // ever flips fastCorrectPolicy to scored-normally, this is what catches it at the gate.
      if (fast && correct) s.fastUpwardInWindow += 1;
    }

    // ---- prerequisite credit, §1.2 at weight 0.5. Never counts toward M2 — you cannot be
    // certified on a skill you were only ever tested on incidentally — but it does reset the
    // prerequisite's spacing clock.
    for (const pid of this._exercised(r, node)) {
      if (pid === kpId || !this.graph.has(pid)) continue;
      const ps = this.stateOf(pid);
      const pband = this.graph.band(pid);
      const pbefore = ps.p;
      // The prerequisite is priced at its OWN band, but never below what the item that paid the
      // credit was worth: a correct answer to something flukeable at 0.15 is not stronger evidence
      // about the prerequisite than it is about the knowledge point it was actually aimed at.
      const pguess = Math.max(pband.guess, this.trueGuess(kpId, form, phase, r.family ?? null));
      ps.p = bktUpdate(ps.p, correct, pband.slip, pguess, this.learnRate(pid), this.M.bkt.prerequisiteCreditWeight);
      ps.creditedAt = this.now();
      this.stats.prerequisiteCredits += 1;
      // The clock restarts on a CORRECT exposure only, and it restarts the current interval
      // rather than advancing the ladder — a skill you exercised in passing is not a skill you
      // were checked on. A wrong response must not be able to defer the revocation check.
      if (correct && this.prerequisiteClockReset && ps.status === "mastered" && Number.isFinite(ps.nextEventAt) && ps.intervalDays > 0) {
        ps.nextEventAt = Math.max(ps.nextEventAt, this.now() + ps.intervalDays * 1440);
      }
      this.emit("learn:mastery", {
        kpId: pid,
        p: round6(ps.p),
        delta: round6(ps.p - pbefore),
        status: ps.status,
        credit: "prerequisite",
      });
    }

    this.emit("learn:mastery", { kpId, p: round6(s.p), delta: round6(out.delta), status: s.status });

    // ---- the gate itself
    if (s.status === "learning" && this.gateReached(kpId)) this._openGate(kpId, s);
    out.status = s.status;
    return out;
  }

  /**
   * Bookkeeping every response does regardless of whether the engine scored it.
   *
   * ------------------------------------------------------------------------------------------
   * THE LINE THAT DECIDES WHETHER MASTERY CAN BE BOUGHT
   *
   * `out.correct` is what the WORLD reported. `out.credited` is what the ENGINE decided. A
   * multi-item certification event may only ever tally the second. Round 1 of this piece tallied
   * `correct` here and again in `Scheduler.submit`, so a learner who idled twelve seconds, read
   * the hint and typed what it said — or who committed in 100 ms — was refused during acquisition
   * and then credited identically to an unaided learner at M4, the one transition that decides
   * the Level 1 percentage. The refusal was computed, logged as `refusedUpward`, and then ignored
   * exactly where it mattered.
   *
   * `credited` is strictly stronger than "scored": it also requires the pair to be
   * MASTERY-ELIGIBLE, so a retention item that somehow arrived at `guided-1` — scorable, but a
   * step the world placed for you — buys nothing either. There is exactly one counter now; the
   * Scheduler reads this one and keeps none of its own, because a duplicate counter is what made
   * the original bug invisible on inspection.
   * ------------------------------------------------------------------------------------------
   */
  _bookkeep(s, out) {
    if (out.mode === "acquire") {
      s.lastPhase = out.phase;
      s.lastCorrect = out.correct;
      s.consecutiveWrong = out.correct ? 0 : s.consecutiveWrong + 1;
    }
    // Only responses belonging to the open event tally into it. A caller that scores an
    // acquisition item while a retention check is open cannot pad the check.
    if (s.event && out.mode === s.event.mode) {
      s.event.served += 1;
      if (out.credited) s.event.right += 1;
      else if (out.correct) s.event.refusedRight += 1;
    }
  }

  _emitRespond(out) {
    this.emit("learn:respond", {
      itemId: out.itemId,
      kpId: out.kpId,
      correct: out.correct,
      latencyMs: out.latencyMs,
      response: out.response,
      form: out.form,
      phase: out.phase,
      hinted: out.hinted,
      scored: out.scored,
      // Additive field, in the spirit of §6.3's `scored`: a reviewer (and P24) must be able to
      // see the gate's verdict from OUTSIDE the engine, not infer it from a counter that did not
      // move. `scored` says the response produced a BKT update; `credited` says it was allowed to
      // count toward mastery. Round 1's defect was invisible precisely because nothing published
      // the difference.
      credited: out.credited,
      ...(out.misconception ? { misconception: out.misconception } : {}),
    });
  }

  /**
   * Which prerequisites an item pays credit to. P17 should tag items with `exercises`; until it
   * does, assumption A3 of the reference simulation stands in — an item at band 3 or harder also
   * exercises its direct prerequisites, and items at bands 1-2 are atomic.
   */
  _exercised(r, node) {
    if (Array.isArray(r.exercises)) return r.exercises;
    if (this.prerequisiteCreditMode === "exercises-only") return [];
    return node.difficulty >= 3 ? node.prerequisites ?? [] : [];
  }

  // ---------------------------------------------------------------------- gate

  /**
   * M1-M3 and M5, §2. Read the posterior, the counters and the form set; nothing here inspects
   * the ORDER of responses, and §1.1a is explicit that a consecutive-run detector would be the
   * wrong mechanism.
   */
  gateDetail(kpId) {
    const s = this.stateOf(kpId);
    const B = this.M.bkt;
    // M3 reads the forms this node HAS, not the forms the content file wishes it had. A node whose
    // whole honest supply is one form can still be mastered on that one form — it cannot be
    // mastered on none, and it is never let through on fewer than it has.
    const honestForms = this.masteryFormsFor(kpId).length;
    return {
      m1: s.p >= B.masteryThreshold,
      m2: s.scored >= B.minScoredOpportunities && s.atBand >= B.minAtBandOpportunities,
      m3: honestForms > 0 && s.forms.length >= Math.min(B.minDistinctItemForms, honestForms),
      m5: s.fastUpwardInWindow === 0,
    };
  }

  gateReached(kpId) {
    const g = this.gateDetail(kpId);
    return g.m1 && g.m2 && g.m3 && g.m5;
  }

  _openGate(kpId, s) {
    s.status = "provisional";
    s.everUnlocked = true;
    s.provisionalAt = this.now();
    s.provisionalSession = this.session;
    s.consolidated = false;
    s.nextEventAt = this.now() + this.M.spacing.consolidationMinutes;
    this.stats.gateOpens += 1;
    this.emit("learn:unlock", { kpId });
    this.emit("learn:mastery", { kpId, p: round6(s.p), delta: 0, status: s.status });
    this.persist();
  }

  // ------------------------------------------------- event state machine hooks

  /**
   * Open a multi-item certification event (consolidation, retention check, review). Responses
   * tally into it automatically; the Scheduler finalises it when `served` reaches `items`.
   */
  beginEvent(kpId, mode, items) {
    const s = this.stateOf(kpId);
    // `right` counts CREDITED corrects only. `refusedRight` is the same response set the engine
    // refused, kept so a reviewer can see the refusal happening at the gate instead of inferring
    // it from a missing increment.
    s.event = { mode, items, served: 0, right: 0, refusedRight: 0 };
    return s.event;
  }

  eventOf(kpId) {
    return this.stateOf(kpId).event;
  }

  clearEvent(kpId) {
    this.stateOf(kpId).event = null;
  }

  /** Consolidation is a practice PASS, not a passing score: `spacing.consolidation.passAtLeast` is 0. */
  markConsolidated(kpId, dueAtMinutes) {
    const s = this.stateOf(kpId);
    s.consolidated = true;
    s.event = null;
    s.nextEventAt = dueAtMinutes;
  }

  /**
   * M4, and it is a **conjunction and not a count**: `right >= passAtLeast` AND the posterior is
   * still at threshold after all four items have been scored. The count alone certifies a learner
   * who slipped through the threshold on the fourth item; the posterior alone lets 2-of-4 through
   * on a favourable prior.
   */
  retentionPassed(kpId, right = null) {
    const rc = this.M.spacing.retentionCheck;
    const s = this.stateOf(kpId);
    // Default to the engine's own tally — `s.event.right`, which counts CREDITED corrects and
    // nothing else. The explicit argument exists so a test can drive the conjunction directly.
    const credited = right == null ? (s.event?.right ?? 0) : right;
    const okCount = credited >= rc.passAtLeast;
    const okPosterior = !rc.requiresThresholdAtCheck || s.p >= this.M.bkt.masteryThreshold;
    return okCount && okPosterior;
  }

  certify(kpId, { intervalDays, dueAtMinutes }) {
    const s = this.stateOf(kpId);
    s.status = "mastered";
    s.everMastered = true;
    s.everUnlocked = true;
    s.relearn = false;
    s.event = null;
    s.ladder = 0;
    s.intervalDays = intervalDays;
    s.nextEventAt = dueAtMinutes;
    s.fastUpwardInWindow = 0;
    this.stats.certifications += 1;
    this.emit("learn:mastery", { kpId, p: round6(s.p), delta: 0, status: s.status });
    this.persist();
    return s;
  }

  /**
   * §3 lapse handling. The node returns to `learning` and **loses** mastered (it keeps
   * `everUnlocked` — the world never re-locks); its M2 counters are docked so it must re-earn
   * the gate rather than walk back through it on one correct answer; the ladder resets to the
   * consolidation slot; and the relearn boost is armed, which only actually fires on a node that
   * has genuinely been mastered once.
   */
  lapse(kpId, reason = "review") {
    const s = this.stateOf(kpId);
    s.status = "learning";
    s.consolidated = false;
    s.event = null;
    s.scored = Math.max(0, s.scored - 3);
    s.atBand = Math.max(0, s.atBand - 2);
    s.fastUpwardInWindow = 0;
    s.ladder = -1;
    s.intervalDays = 0;
    s.nextEventAt = Infinity;
    s.lapses += 1;
    s.lapseAt.push(this.now());
    if (s.lapseAt.length > 8) s.lapseAt.shift();
    s.relearn = true;
    this.stats.lapses += 1;
    this.emit("learn:mastery", { kpId, p: round6(s.p), delta: 0, status: s.status, lapse: reason });
    this.persist();
    return s;
  }

  /**
   * The Scheduler writes the currently-open work through here so `inFlight[]` is learner state
   * that survives a reload, not a field that only exists while one Scheduler object is alive.
   */
  setInFlight(ids) {
    this.inFlight = [...new Set(ids.filter(Boolean))];
    return this.inFlight;
  }

  /** Two lapses inside `withinDays`, §3 rule 5 — the condition the re-entry phase reads. */
  recentLapses(kpId) {
    const within = (this.M.phases.lapseReentry?.withinDays ?? 7) * 1440;
    const t = this.now();
    return this.stateOf(kpId).lapseAt.filter((x) => t - x <= within).length;
  }

  // ------------------------------------------------------------------ reporting

  summary() {
    let unlocked = 0;
    let learning = 0;
    let provisional = 0;
    let mastered = 0;
    for (const id of this.graph.ids) {
      const s = this.stateOf(id);
      if (s.everUnlocked) unlocked += 1;
      if (s.status === "learning") learning += 1;
      else if (s.status === "provisional") provisional += 1;
      else if (s.status === "mastered") mastered += 1;
    }
    const total = this.graph.ids.length;
    return {
      theta: round6(this.theta),
      unlocked,
      learning,
      provisional,
      mastered,
      total,
      level1Percent: round6((100 * mastered) / total),
    };
  }

  /**
   * The `mastery` probe payload. Every float is rounded so `review.mjs probe --name=mastery` is
   * byte-identical across runs of the same script — §8 requirement 12.
   */
  probe(extra = {}) {
    const t = this.now();
    const due = [];
    const kps = {};
    for (const id of this.graph.ids) {
      const s = this.stateOf(id);
      kps[id] = {
        p: round6(s.p),
        status: s.status,
        scored: s.scored,
        atBand: s.atBand,
        forms: [...s.forms].sort(),
        attempts: s.attempts,
        lapses: s.lapses,
      };
      if (Number.isFinite(s.nextEventAt) && s.nextEventAt <= t) due.push({ kpId: id, overdueMinutes: round6(t - s.nextEventAt) });
    }
    due.sort((a, b) => b.overdueMinutes - a.overdueMinutes || (a.kpId < b.kpId ? -1 : 1));
    // §8 requirement 11 names `inFlight[]` as a TOP-LEVEL field of the `mastery` probe. It used to
    // survive only because boot/62-learning.js merged the Scheduler's probe in, so a reviewer
    // reading the spec did not find the field the spec names. It is here now.
    const openEvent = this.inFlight
      .map((id) => {
        const s = this.byKp.get(id);
        return s?.event ? { kpId: id, mode: s.event.mode, served: s.event.served, right: s.event.right, of: s.event.items } : null;
      })
      .filter(Boolean);
    return {
      ...this.summary(),
      session: this.session,
      responses: this.responses,
      dueNow: due.length,
      due: due.slice(0, 8),
      inFlight: [...this.inFlight],
      openEvents: openEvent,
      unscoredItems: this.stats.unscoredItems,
      refusedUpward: this.stats.refusedUpward,
      stats: { ...this.stats },
      scorablePairs: this.pricing.description,
      bankPricing: this.cellPricing.description,
      issues: this.issues,
      graph: this.graph.stats(),
      kps,
      ...extra,
    };
  }

  // ---------------------------------------------------------------- persistence

  snapshot() {
    const kps = {};
    for (const id of this.graph.ids) {
      const s = this.stateOf(id);
      kps[id] = {
        p: s.p,
        status: s.status,
        everUnlocked: s.everUnlocked,
        everMastered: s.everMastered,
        scored: s.scored,
        atBand: s.atBand,
        forms: [...s.forms],
        consolidated: s.consolidated,
        ladder: s.ladder,
        intervalDays: s.intervalDays,
        lapses: s.lapses,
        lapseAt: [...s.lapseAt],
        nextEventAt: Number.isFinite(s.nextEventAt) ? s.nextEventAt : null,
        provisionalAt: s.provisionalAt,
        provisionalSession: s.provisionalSession,
        relearn: s.relearn,
        attempts: s.attempts,
        unscored: s.unscored,
        refusedUpward: s.refusedUpward,
        fastItems: s.fastItems,
        hintedItems: s.hintedItems,
        fastUpwardInWindow: s.fastUpwardInWindow,
        lastPhase: s.lastPhase,
        lastCorrect: s.lastCorrect,
        fadeIdx: s.fadeIdx,
        consecutiveWrong: s.consecutiveWrong,
        lastMisconception: s.lastMisconception,
        consecutiveSameMisconception: s.consecutiveSameMisconception,
        event: s.event,
      };
    }
    return {
      version: STATE_VERSION,
      theta: this.theta,
      responses: this.responses,
      session: this.session,
      stats: { ...this.stats },
      inFlight: [...this.inFlight],
      // The Scheduler's half of the state. Without it a reload used to drop a half-answered
      // retention check on the floor — no lapse, no M2 dock, `nextEventAt` still due, so the check
      // could be re-rolled indefinitely — and reset the no-repeat-within-40 window every time.
      scheduler: this._scheduler ? this._scheduler.snapshot() : null,
      kps,
    };
  }

  restore(snap) {
    if (!snap || snap.version !== STATE_VERSION) return false;
    this.theta = snap.theta ?? this.M.ability.theta0;
    this.responses = snap.responses ?? 0;
    this.session = snap.session ?? 0;
    Object.assign(this.stats, snap.stats ?? {});
    this.inFlight = [...(snap.inFlight ?? [])];
    for (const id of this.graph.ids) {
      const from = snap.kps?.[id];
      if (!from) continue;
      const s = this.stateOf(id);
      Object.assign(s, from, {
        forms: [...(from.forms ?? [])],
        lapseAt: [...(from.lapseAt ?? [])],
        nextEventAt: from.nextEventAt == null ? Infinity : from.nextEventAt,
        // Key order is preserved so a re-persisted snapshot is byte-identical to the one read.
        event: from.event ? { ...from.event, refusedRight: from.event.refusedRight ?? 0 } : null,
      });
    }
    // A snapshot that CARRIES a scheduler block is resumable, whether or not this particular
    // Mastery has a Scheduler attached (a reviewer round-tripping the state has none). A snapshot
    // that does not carry one is state that was thrown away mid-check.
    if (snap.scheduler) this._scheduler?.restore(snap.scheduler);
    else this._abandonOrphanedChecks(snap.scheduler === undefined ? "legacy-state" : "no-scheduler-state");
    return true;
  }

  /**
   * A retention check whose Scheduler half did not come back cannot be resumed, and a check that
   * cannot be resumed is a check that was abandoned. §3 says a failed retention check is a lapse;
   * an abandoned one is not cheaper than a failed one, or "close the tab when it is going badly"
   * becomes a strategy. Consolidation and review carry no gate, so they are simply dropped.
   */
  _abandonOrphanedChecks(reason) {
    const hits = [];
    for (const id of this.graph.ids) {
      const s = this.stateOf(id);
      if (!s.event) continue;
      const wasRetention = s.event.mode === "retention" && s.event.served > 0;
      s.event = null;
      if (wasRetention) {
        this.lapse(id, `retention-abandoned:${reason}`);
        hits.push(id);
      }
    }
    return hits;
  }

  persist() {
    if (!this._storage) return false;
    try {
      this._storage.setItem(this.storageKey, JSON.stringify(this.snapshot()));
      return true;
    } catch {
      return false;
    }
  }

  hydrate() {
    if (!this._storage) return false;
    try {
      const raw = this._storage.getItem(this.storageKey);
      if (!raw) return false;
      return this.restore(JSON.parse(raw));
    } catch {
      return false;
    }
  }

  clearPersisted() {
    try {
      this._storage?.removeItem(this.storageKey);
    } catch {
      /* storage may be denied; that is not a gameplay failure */
    }
  }
}

// ---------------------------------------------------------------------------------------------

function freshNodeState(prior) {
  return {
    p: prior,
    status: "learning",
    everUnlocked: false,
    everMastered: false,
    scored: 0,
    atBand: 0,
    forms: [],
    consolidated: false,
    ladder: -1,
    intervalDays: 0,
    lapses: 0,
    lapseAt: [],
    nextEventAt: Infinity,
    provisionalAt: null,
    provisionalSession: null,
    relearn: false,
    attempts: 0,
    unscored: 0,
    refusedUpward: 0,
    fastItems: 0,
    hintedItems: 0,
    fastUpwardInWindow: 0,
    // teaching-ladder state (§6.1). Lives here because it must survive a reload with the rest.
    lastPhase: null,
    lastCorrect: null,
    fadeIdx: 0,
    consecutiveWrong: 0,
    modelEvents: 0,
    pendingModel: false,
    lastMisconception: null,
    consecutiveSameMisconception: 0,
    creditedAt: null,
    event: null,
  };
}

/**
 * Re-derive the scorable sets from `identifiabilityCaps` instead of trusting the declared arrays,
 * then cross-check. §8 requirement 4: assert the caps at load and **reject** any form or phase that
 * violates them. `onFormExceedingCaps` is `reject-form-from-scored-path`, and
 * `clampTrueRates` is false — a clamp is the leak §5.0 measures at 80%.
 *
 * The four rules, run identically over the form axis, the phase axis and the composed matrix:
 *   (a) trueGuess <= maxTrueGuess
 *   (b) trueGuess + maxSlip < maxSlipPlusGuess
 *   (c) conservatism: modelled guess >= trueGuess at EVERY band
 *   (d) the modelled guess itself respects maxGuess and maxSlip + guess < maxSlipPlusGuess,
 *       without being clamped
 */
function derivePricing(M, issues) {
  const caps = M.bkt.identifiabilityCaps;
  const bands = M.bands;
  const numeric = (obj) => Object.fromEntries(Object.entries(obj ?? {}).filter(([, v]) => typeof v === "number"));

  const multByForm = numeric(M.guessByForm);
  const trueByForm = numeric(M.trueGuessByForm);
  const multByPhase = numeric(M.guessByPhase);
  const trueByPhase = numeric(M.trueGuessByPhase);

  const check = (trueRate, mult) => {
    if (trueRate > caps.maxTrueGuess) return false;
    if (trueRate + caps.maxSlip >= caps.maxSlipPlusGuess) return false;
    for (const b of bands) {
      const modelled = b.guess * mult;
      if (modelled < trueRate) return false; // (c) conservatism
      if (modelled > caps.maxGuess) return false; // (d) no clamping allowed
      if (modelled + caps.maxSlip >= caps.maxSlipPlusGuess) return false;
    }
    return true;
  };

  const derivedForms = new Set(Object.keys(trueByForm).filter((f) => check(trueByForm[f], multByForm[f] ?? 1)));
  const derivedPhases = new Set(Object.keys(trueByPhase).filter((ph) => check(trueByPhase[ph], multByPhase[ph] ?? 1)));

  const declaredForms = new Set(M.forms.scored ?? []);
  const declaredPhases = new Set(M.phases.scored ?? []);

  for (const f of declaredForms) {
    if (!derivedForms.has(f))
      issues.push(`form "${f}" is declared scored but violates the identifiability caps — REJECTED from the scored path`);
  }
  for (const ph of declaredPhases) {
    if (!derivedPhases.has(ph))
      issues.push(`phase "${ph}" is declared scored but violates the identifiability caps — REJECTED from the scored path`);
  }

  // Intersection, never union: the engine may be stricter than the content file, never looser.
  const scoredForms = new Set([...declaredForms].filter((f) => derivedForms.has(f)));
  const scoredPhases = new Set([...declaredPhases].filter((p) => derivedPhases.has(p)));

  // Mastery eligibility is a SECOND gate, not a restatement of the first. A mastery-eligible phase
  // must give the learner nothing at all: true blind rate exactly 0 and no hint surface.
  const masteryForms = new Set((M.bkt.formsEligibleForMastery ?? []).filter((f) => scoredForms.has(f)));
  const masteryPhases = new Set(
    (M.bkt.phasesEligibleForMastery ?? []).filter((ph) => {
      if (!scoredPhases.has(ph)) {
        issues.push(`phase "${ph}" is mastery-eligible but not scorable — REJECTED`);
        return false;
      }
      if ((trueByPhase[ph] ?? 0) !== 0) {
        issues.push(`phase "${ph}" is mastery-eligible but has a non-zero blind rate ${trueByPhase[ph]} — REJECTED`);
        return false;
      }
      if (M.phases.hinted?.[ph]) {
        issues.push(`phase "${ph}" is mastery-eligible but surfaces a hint — REJECTED`);
        return false;
      }
      return true;
    })
  );

  const pairs = [];
  for (const f of scoredForms) for (const ph of scoredPhases) pairs.push(`${f}x${ph}`);

  return {
    multByForm,
    trueByForm,
    multByPhase,
    trueByPhase,
    scoredForms,
    scoredPhases,
    masteryForms,
    masteryPhases,
    description: {
      scorable: `${[...scoredForms].sort().join(",")} x ${[...scoredPhases].sort().join(",")}`,
      scorableCells: pairs.length,
      masteryEligible: `${[...masteryForms].sort().join(",")} x ${[...masteryPhases].sort().join(",")}`,
      masteryEligibleCells: masteryForms.size * masteryPhases.size,
      rejectedForms: Object.keys(trueByForm).filter((f) => !scoredForms.has(f)).sort(),
      rejectedPhases: Object.keys(trueByPhase).filter((p) => !scoredPhases.has(p)).sort(),
    },
  };
}

/**
 * The third axis, run through exactly the four rules `derivePricing` runs on the other two, but
 * per (knowledge point x form) CELL and against a MEASURED rate rather than a declared one.
 *
 *   (a) measured blind rate <= maxTrueGuess
 *   (b) measured + maxSlip < maxSlipPlusGuess
 *   (c) conservatism: the modelled guess is >= the measured rate at THIS node's band, in every
 *       scorable phase — which is what the lift to the 95% upper bound buys
 *   (d) the lifted modelled guess still respects maxGuess and maxSlip + guess < maxSlipPlusGuess,
 *       WITHOUT being clamped
 *
 * A cell that fails any of them is refused, and the refusal is recorded with the number that
 * caused it so the handoff can name the content fix. Nothing here is clamped and nothing is
 * silently downgraded: `clampTrueRates` is false on this axis too.
 */
function deriveCellPricing(graph, M, pricing, audit, issues) {
  const caps = M.bkt.identifiabilityCaps;
  const cells = {};
  const rejected = [];
  const repriced = [];

  if (!audit || !audit.cells) {
    issues.push(
      "no bank audit supplied — items are priced on model.trueGuessByForm alone, which does not " +
        "see a knowledge point whose whole pool has two answers. Pass opts.bankAudit."
    );
    return { cells, description: { audited: false, rejectedCells: [], repricedCells: [], relaxed: [], unmasterable: [] } };
  }
  if (audit.notExecuted?.length)
    issues.push(
      `bank audit ran without the shipped checker on ${audit.notExecuted.length} group(s); those rates are ` +
        `counts of canonical answers and UNDERSTATE the real blind rate — on the committed catalogue the ` +
        `executed count beats the canonical one by as much as 0.86. Pass { mark, spell } to auditBlindGuessing.`
    );
  // The audit is only worth anything if it drew the population the player is served. A sample that
  // is mostly generator when the game serves mostly catalogue is the round-2 defect, restated.
  if (audit.mixture && audit.mixture.catalogue === 0)
    issues.push("bank audit drew ZERO catalogue items — it is pricing a population `ItemBank.select()` does not serve first");

  /** The four caps, run against one measured rate at one band. Returns null when it passes. */
  const refuseReason = (band, form, blind, blindUpper) => {
    if (blind > caps.maxTrueGuess) return `blind ${blind.toFixed(3)} > maxTrueGuess ${caps.maxTrueGuess}`;
    if (blind + caps.maxSlip >= caps.maxSlipPlusGuess)
      return `blind ${blind.toFixed(3)} + maxSlip ${caps.maxSlip} >= ${caps.maxSlipPlusGuess}`;
    // (c) + (d), evaluated in every phase the engine will actually score this cell in.
    for (const phase of pricing.scoredPhases) {
      const base = band.guess * Math.max(pricing.multByForm[form] ?? 1, pricing.multByPhase[phase] ?? 1);
      const modelled = Math.max(base, blindUpper);
      const trueRate = Math.max(pricing.trueByForm[form] ?? 0, pricing.trueByPhase[phase] ?? 0, blind);
      if (modelled < trueRate) return `modelled ${modelled.toFixed(3)} below true ${trueRate.toFixed(3)} at ${phase}`;
      if (modelled > caps.maxGuess) return `conservative price ${modelled.toFixed(3)} > maxGuess ${caps.maxGuess} at ${phase}`;
      if (modelled + caps.maxSlip >= caps.maxSlipPlusGuess)
        return `price ${modelled.toFixed(3)} + maxSlip ${caps.maxSlip} >= ${caps.maxSlipPlusGuess} at ${phase}`;
    }
    return null;
  };

  const familyIndex = {};
  for (const [key, rec] of Object.entries(audit.families ?? {})) {
    const cut = key.lastIndexOf("|");
    (familyIndex[key.slice(0, cut)] ??= []).push({ family: key.slice(cut + 1), ...rec });
  }

  for (const kpId of graph.ids) {
    const band = graph.band(kpId);
    for (const form of pricing.scoredForms) {
      const cell = `${kpId}|${form}`;
      const fams = familyIndex[cell];
      if (!fams || !fams.length) {
        issues.push(`bank audit has no sample for "${cell}" — cell refused rather than assumed safe`);
        cells[cell] = { blind: 1, blindUpper: 1, n: 0, distinct: 0, modalAnswer: null, priceable: false, reason: "not-audited", families: {}, refusedFamilies: [] };
        rejected.push({ cell, blind: null, reason: "not-audited" });
        continue;
      }

      // Refuse the FAMILY, not the cell. A knowledge point whose `.coefficient` family always
      // answers 1 still has a `.term` family that is honest work, and condemning the whole cell
      // would take a band-1 node — and therefore the entire graph behind it — off the air.
      const familyRecords = {};
      const refusedFamilies = [];
      const kept = [];
      for (const fam of fams) {
        const reason = refuseReason(band, form, fam.rate, fam.upper);
        familyRecords[fam.family] = {
          blind: round6(fam.rate),
          blindUpper: round6(fam.upper),
          n: fam.n,
          modalAnswer: fam.modalAnswer,
          priceable: reason === null,
          reason,
        };
        if (reason) {
          refusedFamilies.push(fam.family);
          rejected.push({ cell, family: fam.family, blind: round6(fam.rate), n: fam.n, modalAnswer: fam.modalAnswer, reason });
        } else kept.push(fam);
      }

      // What a guesser gets once only the surviving families are served: the worst of those.
      const blind = kept.length ? Math.max(...kept.map((x) => x.rate)) : 1;
      const blindUpper = kept.length ? Math.max(...kept.map((x) => x.upper)) : 1;
      const reason = kept.length ? null : `every generator family is above the caps (${fams.length} of ${fams.length})`;

      cells[cell] = {
        blind,
        blindUpper,
        n: fams.reduce((a, x) => a + x.n, 0),
        distinct: fams.reduce((a, x) => a + x.distinct, 0),
        modalAnswer: kept.length ? kept.reduce((a, x) => (x.rate > a.rate ? x : a)).modalAnswer : null,
        priceable: reason === null,
        reason,
        families: familyRecords,
        refusedFamilies,
      };
      if (reason) rejected.push({ cell, blind: null, reason });
      else if (blindUpper > band.guess * (pricing.multByForm[form] ?? 1))
        repriced.push({ cell, from: round6(band.guess * (pricing.multByForm[form] ?? 1)), to: round6(blindUpper) });
    }
  }

  // Which nodes lost so much supply that M3 has to degrade, and which lost all of it.
  const relaxed = [];
  const unmasterable = [];
  for (const kpId of graph.ids) {
    const have = [...pricing.masteryForms].filter((form) => cells[`${kpId}|${form}`]?.priceable !== false);
    if (have.length === 0) unmasterable.push(kpId);
    else if (have.length < M.bkt.minDistinctItemForms) relaxed.push({ kpId, forms: have, need: have.length });
  }
  for (const r of relaxed)
    issues.push(
      `CONTENT: "${r.kpId}" has only ${r.forms.join(",")} left after the bank audit, so M3 asks for ` +
        `${r.need} distinct form(s) instead of ${M.bkt.minDistinctItemForms}. Fix the generator families named in ` +
        `bankPricing.rejectedCells and this reverts on its own.`
    );
  for (const id of unmasterable)
    issues.push(`CONTENT: "${id}" has NO mastery-eligible form left after the bank audit and can never be certified`);

  return {
    cells,
    description: {
      audited: true,
      cellsPriced: Object.keys(cells).length,
      // What the price was measured ON. A reviewer must be able to read the sample's composition
      // off the probe rather than take the sampler's word for it.
      sampled: audit.sampled ?? 0,
      mixture: audit.mixture ?? null,
      catalogueShare: audit.mixture && audit.sampled ? round6(audit.mixture.catalogue / audit.sampled) : null,
      // Named at the granularity the fix has to happen at: a generator family and the one string
      // that answers everything it will ever produce.
      rejectedCells: rejected.sort((a, b) => (b.blind ?? 1) - (a.blind ?? 1)),
      repricedCells: repriced.sort((a, b) => b.to - a.to),
      relaxed,
      unmasterable,
    },
  };
}

function safeStorage() {
  try {
    if (typeof localStorage === "undefined") return null;
    const probe = "__vs_probe__";
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

const round6 = (x) => (Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : null);
