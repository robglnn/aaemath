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
 * An item's price has **two** factors, not one.
 *
 *   - the **form** decides how big the answer space is (`construct`, `repair`, `generate`,
 *     `select4`, `judge2`);
 *   - the **teaching phase** decides how much of that space the world has already filled in
 *     (`solo`, `guided-1`, `guided-2`, `guided-3`, `model`).
 *
 * A scaffold shrinks an answer space in exactly the way a multiple choice does. Crediting a
 * hinted item at the unhinted guess parameter is how hint-abuse buys mastery, and it is the
 * single biggest failure this project has previously shipped. So:
 *
 *   trueGuess(form, phase)           = max( trueGuessByForm[form], trueGuessByPhase[phase] )
 *   modelledGuess(band, form, phase) = band.guess x max( guessByForm[form], guessByPhase[phase] )
 *
 * composed by `max` and never by product, because a scaffold puts a **floor** under blind
 * success — placing the first step cannot make an item harder to fluke.
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

    this.theta = this.M.ability.theta0;
    this.responses = 0;
    this.session = 0;
    this.sessionStartedAt = null;

    this.stats = {
      items: 0,
      scoredItems: 0,
      unscoredItems: 0,
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

  /** Is this (form, phase) pair allowed to produce a BKT update at all? */
  isScorable(form, phase) {
    return this.pricing.scoredForms.has(form) && this.pricing.scoredPhases.has(phase);
  }

  /** May this (form, phase) pair increment M2's opportunity counters and M3's form set? */
  isMasteryEligible(form, phase) {
    return this.pricing.masteryForms.has(form) && this.pricing.masteryPhases.has(phase);
  }

  /** GROUND TRUTH: what a responder with zero knowledge actually achieves on this pair. */
  trueGuess(form, phase) {
    return Math.max(this.pricing.trueByForm[form] ?? 0, this.pricing.trueByPhase[phase] ?? 0);
  }

  /** MODEL BELIEF: the guess parameter the BKT update uses for this pair at this band. */
  modelledGuess(band, form, phase) {
    return band.guess * Math.max(this.pricing.multByForm[form] ?? 1, this.pricing.multByPhase[phase] ?? 1);
  }

  /**
   * Everything the engine believes about one prospective item, before it is answered. P17/P18 can
   * ask this to check they are about to serve something that counts.
   */
  price(kpId, form, phase = "solo") {
    const band = this.graph.band(kpId);
    const scorable = this.isScorable(form, phase);
    return {
      kpId,
      form,
      phase,
      band: band.difficulty,
      slip: band.slip,
      modelledGuess: scorable ? this.modelledGuess(band, form, phase) : null,
      trueGuess: this.trueGuess(form, phase),
      scorable,
      masteryEligible: this.isMasteryEligible(form, phase),
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
    if (!this.isScorable(form, phase)) {
      this.stats.unscoredItems += 1;
      s.unscored += 1;
      out.reason = this.pricing.scoredForms.has(form) ? "unscored-phase" : "unscored-form";
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
    out.masteryEligible = this.isMasteryEligible(form, phase);
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
    const guess = this.modelledGuess(band, form, phase);
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
      ps.p = bktUpdate(ps.p, correct, pband.slip, pband.guess, this.learnRate(pid), this.M.bkt.prerequisiteCreditWeight);
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
    return {
      m1: s.p >= B.masteryThreshold,
      m2: s.scored >= B.minScoredOpportunities && s.atBand >= B.minAtBandOpportunities,
      m3: s.forms.length >= B.minDistinctItemForms,
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
        event: from.event ? { refusedRight: 0, ...from.event } : null,
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
