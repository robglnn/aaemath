import { Mastery, REVIEW_LAPSE_BELOW } from "./Mastery.js";

/**
 * Scheduler — spaced repetition and next-item selection.
 *
 * Mastery.js answers "what does the learner know". This file answers "what should happen next",
 * which is a different question with a different failure mode: the bottleneck in a mastery system
 * is not teaching capacity, it is **certification** capacity. §4.1 measures that — with both the
 * review rate-limit lift and the pull-forward rule switched off, the median simulated learner
 * certifies 17 of 32 knowledge points instead of 29. The two rules are redundant with each other
 * and jointly worth twelve knowledge points, so both are implemented here and both are
 * switchable so the claim stays a measurement.
 *
 * The Scheduler owns the clock. `next()` describes one item; `submit()` scores it, advances time
 * by what that phase actually costs (a 22 s demonstration is not a 46 s solo item) and moves the
 * spacing ladder. A caller that only ever calls `next()`/`submit()` cannot get the bookkeeping
 * wrong, which is the point.
 *
 * **It keeps no score of its own.** A multi-item certification event has exactly ONE tally and it
 * lives in `Mastery`, next to the scoring decision, because the round-1 version of this file kept
 * a second one — `if (outcome.correct) this._event.right += 1` — fed it the CALLER's raw flag, and
 * handed that straight to M4. A learner who idled twelve seconds, read the hint and typed what it
 * said was refused all through acquisition and then certified anyway, at the one transition that
 * decides the Level 1 percentage. Two counters is how that hid. There is one now, and it counts
 * `result.credited`.
 */

/** Wall clock, in minutes. `advance` is a no-op: real time moves on its own. */
export function realClock() {
  return { minutes: () => Date.now() / 60000, advance() {}, real: true };
}

/** Virtual clock, in minutes. Eighteen sessions of spaced repetition without waiting eighteen days. */
export function virtualClock(startMinutes = 0) {
  let t = startMinutes;
  return {
    minutes: () => t,
    advance(m) {
      t += m;
    },
    set(m) {
      t = m;
    },
    real: false,
  };
}

/** Deterministic RNG. A reviewer re-running a script has to get the same answer. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SECONDS_DEFAULT = 46;

export class Scheduler {
  /**
   * @param {Mastery} mastery
   * @param {object} [opts]
   * @param {{minutes:()=>number, advance:(m:number)=>void}} [opts.clock]
   * @param {number} [opts.seed]
   * @param {number} [opts.sessionMinutes=25]
   * @param {boolean} [opts.reviewCapLift=true]  §4.1, lift the 1-in-3 review cap once the frontier is exhausted
   * @param {boolean} [opts.pullForward=true]    §4.1, pull the soonest scheduled review forward when idle
   */
  constructor(mastery, opts = {}) {
    this.mastery = mastery;
    this.graph = mastery.graph;
    this.M = mastery.M;
    this.clock = opts.clock ?? realClock();
    this.rng = opts.rng ?? mulberry32(opts.seed ?? 0x5eed);
    this.sessionMinutes = opts.sessionMinutes ?? 25;
    this.reviewCapLift = opts.reviewCapLift !== false;
    this.pullForward = opts.pullForward !== false;
    this.blockLength = opts.blockLength ?? 3;

    // Mastery reads the same clock, so `provisionalAt` and `nextEventAt` share one time base.
    this.mastery.now = () => this.clock.minutes();
    // Mastery owns persistence for the whole engine, so it needs a handle on this half of the
    // state — otherwise a reload drops a half-answered retention check and the no-repeat window.
    this.mastery._scheduler = this;

    /** The knowledge point the continuity block is on. `mastery.inFlight[]` is the persisted view. */
    this.inFlight = null;
    this.blockCount = 0;
    this.itemsThisSession = 0;
    this.reviewItemsThisSession = 0;
    this.secondsSpent = 0;
    this.sessionEndsAt = -Infinity;
    this.recentItemIds = [];
    /**
     * The no-repeat window, PER (knowledge point x form), which is the reading of
     * `antiGuessing.noRepeatWithinItems` that the rule was written for.
     *
     * ------------------------------------------------------------------------------------------
     * WHY THIS IS NOT ONE GLOBAL LIST OF FORTY
     *
     * It used to be. A global forty spans about forty different knowledge points, so it excluded
     * roughly one of any single cell's own items — and a cell's committed catalogue is 12-17 items.
     * `ItemBank.select()` answers from the catalogue first, so the catalogue was never walked out
     * and a learner was served the SAME handful of items for the whole curriculum: 97% of 17,126
     * items in a measured run came from the catalogue, and inside one (kp x form x family) the
     * concentration was worse still — one family served 24 times showed a single fixed string
     * winning 0.958 of them. That is not a pricing problem, it is a SERVING problem, and re-pricing
     * it would have been agreeing to keep showing a learner the same three questions.
     *
     * Per-cell is strictly stronger than the global list it replaces: excluding the last 40 items
     * of THIS cell implies no repeat within the last 40 items overall, so the content file's rule
     * still holds and holds harder. The catalogue is now walked out in its first pass and the
     * generator supplies the rest, which is what the bank audit measures and what the mastery gate
     * was priced against. Both windows are published on the request; the union is what a presenter
     * must honour.
     * ------------------------------------------------------------------------------------------
     */
    this.recentByCell = new Map();
    this._event = null;
    this._seq = 0;
    this._syncInFlight();
  }

  /** The no-repeat window a request publishes: this cell's last N, plus the global last N. */
  _recentFor(kpId, form) {
    const cell = this.recentByCell.get(`${kpId}|${form}`);
    if (!cell || !cell.length) return this.recentItemIds.slice();
    const seen = new Set(cell);
    const out = cell.slice();
    for (const id of this.recentItemIds) if (!seen.has(id)) out.push(id);
    return out;
  }

  /**
   * Record that an item was SERVED, whether or not it was ever answered.
   *
   * The window has to close on presentation, not on submission: an item a learner looked at and
   * walked away from is an item they have seen, and serving it again is the repeat the rule
   * forbids. P17 signals `learn:present`; `submit` calls this too so the rule holds however the
   * bank is wired.
   */
  noteServed({ itemId, kpId, form } = {}) {
    if (!itemId) return;
    const cap = this.M.antiGuessing.noRepeatWithinItems ?? 40;
    this.recentItemIds.push(itemId);
    while (this.recentItemIds.length > cap) this.recentItemIds.shift();
    if (!kpId || !form) return;
    const key = `${kpId}|${form}`;
    let ring = this.recentByCell.get(key);
    if (!ring) this.recentByCell.set(key, (ring = []));
    ring.push(itemId);
    while (ring.length > cap) ring.shift();
  }

  /**
   * Publish what is open right now into the learner state, where it is persisted and probed.
   * Two things can be open at once: a multi-item certification event and the acquisition block.
   */
  _syncInFlight() {
    this.mastery.setInFlight([this._event?.kpId ?? null, this.inFlight]);
  }

  // ------------------------------------------------------------------ sessions

  beginSession() {
    const n = this.mastery.beginSession();
    this.itemsThisSession = 0;
    this.reviewItemsThisSession = 0;
    this.secondsSpent = 0;
    this.inFlight = null;
    this.blockCount = 0;
    this.sessionEndsAt = this.clock.minutes() + this.sessionMinutes;
    // A half-answered certification event is NOT dropped at a session boundary: §3's retention
    // gate is about elapsed time and intervening sessions, not about finishing inside one sitting,
    // and dropping it would punish a learner whose 25 minutes ran out on item 3 of 4. It is
    // dropped only when the state itself is discarded, and that path lapses (Mastery.restore).
    this._syncInFlight();
    return n;
  }

  endSession() {
    this.mastery.endSession();
  }

  get sessionSecondsLeft() {
    return this.sessionMinutes * 60 - this.secondsSpent;
  }

  // ------------------------------------------------------------------ selection

  /**
   * The next learning opportunity, or `null` when the session's time box is spent or the graph
   * has nothing legal to offer. Returns a *request*, not an item: P17 builds the item from it.
   *
   * §4, in order: due reviews (rate-limited) -> continuity block -> frontier score -> variant.
   */
  next() {
    if (this.secondsSpent >= this.sessionMinutes * 60) return null;

    // A multi-item certification event is atomic: once a retention check starts, its four items
    // are the next four items. Interleaving them would break "sampled uniformly, in one sitting".
    if (this._event && this._event.index < this._event.items) return this._eventRequest();

    const pick = this._choose();
    if (!pick) return null;

    if (pick.mode === "acquire") {
      if (pick.kpId !== this.inFlight) {
        this.inFlight = pick.kpId;
        this.blockCount = 0;
        this._syncInFlight();
      }
      return this._acquisitionRequest(pick.kpId);
    }

    const items =
      pick.mode === "consolidate"
        ? this.M.spacing.consolidation.items
        : pick.mode === "retention"
          ? this.M.spacing.retentionCheck.items
          : this.M.spacing.review.items;
    // NO `right` counter here. There is exactly one tally for a certification event and it lives
    // in Mastery, where the scoring decision is made. Two counters is how the round-1 leak hid.
    this._event = { kpId: pick.kpId, mode: pick.mode, items, index: 0 };
    this.mastery.beginEvent(pick.kpId, pick.mode, items);
    this._syncInFlight();
    return this._eventRequest();
  }

  _choose() {
    const now = this.clock.minutes();
    const frontier = this.mastery.frontier();
    // A node the bank audit left with no scorable form at all cannot move its own counters, so
    // offering it acquisition items would spend the session on a node that can never leave
    // `learning`. Mastery reports it as unmasterable; the Scheduler simply does not sink time
    // into it. (No node on the shipped bank is in this state; the guard is what keeps a future
    // content regression from eating the session budget instead of failing visibly.)
    const acquirable = frontier.filter(
      (id) => this.mastery.status(id) === "learning" && this.mastery.masteryFormsFor(id).length > 0
    );

    // The 1-in-3 review cap exists to stop a session becoming all review WHILE THERE IS STILL NEW
    // GROUND. Once the frontier is exhausted, review IS the work and the cap lifts.
    const underCap = this.reviewItemsThisSession < (this.itemsThisSession + 1) / 3;
    const reviewAllowed = underCap || (this.reviewCapLift && acquirable.length === 0);

    if (reviewAllowed) {
      const due = this._dueQueue(now);
      if (due.length) return { kpId: due[0].kpId, mode: due[0].mode };
    }

    // Continuity: stay on the current node for a block. Long enough to carry a model -> guided ->
    // solo arc, short enough that blocked practice does not manufacture a false sense of fluency.
    if (this.inFlight && this.blockCount < this.blockLength && acquirable.includes(this.inFlight))
      return { kpId: this.inFlight, mode: "acquire" };

    // At most two nodes may be in `learning` at once.
    let pool = acquirable;
    const openNow = this.graph.ids.filter((id) => {
      const s = this.mastery.stateOf(id);
      return s.status === "learning" && s.attempts > 0;
    });
    if (openNow.length >= 2) {
      const capped = pool.filter((id) => openNow.includes(id));
      if (capped.length) pool = capped;
    }

    if (!pool.length) {
      if (!this.pullForward) return null;
      // Nothing to acquire and nothing due: pull the soonest scheduled event forward. Shortening
      // an interval is always safe, and a provisional node's retention check still cannot run
      // before its 12-hour gate, so certification can never be bought with idle time.
      const soon = this._eligibleQueue(now);
      if (!soon.length) return null;
      return { kpId: soon[0].kpId, mode: soon[0].mode };
    }

    const target = this.mastery.theta + this.M.ability.acquisitionTargetOffset;
    let best = null;
    let bestScore = -Infinity;
    for (const id of pool) {
      const s = this.mastery.stateOf(id);
      const b = this.graph.centre(id);
      const fit = Math.exp(-((b - target) ** 2) / (2 * 0.7 ** 2));
      const reach = this.graph.descendants(id).size / this.graph.maxDescendants;
      const fresh = 1 - Math.min(1, s.attempts / 12);
      const cont = id === this.inFlight ? 1 : 0;
      const score = 0.4 * fit + 0.3 * reach + 0.15 * fresh + 0.15 * cont;
      if (score > bestScore) {
        bestScore = score;
        best = id;
      }
    }
    return { kpId: best, mode: "acquire" };
  }

  /** What a node's scheduled event actually is when its clock comes up. */
  _modeFor(id) {
    const s = this.mastery.stateOf(id);
    if (s.status === "mastered") return "review";
    return s.consolidated ? "retention" : "consolidate";
  }

  /**
   * A retention check needs BOTH halves of §3's gate — at least 12 hours AND at least one
   * intervening session. Idle time alone can never buy a certification.
   */
  _retentionReady(id, now) {
    const s = this.mastery.stateOf(id);
    const rc = this.M.spacing.retentionCheck;
    if (s.provisionalAt == null) return false;
    if (now < s.provisionalAt + rc.minHours * 60) return false;
    return this.mastery.session - (s.provisionalSession ?? 0) >= rc.minInterveningSessions;
  }

  _dueQueue(now) {
    const out = [];
    for (const id of this.graph.ids) {
      const s = this.mastery.stateOf(id);
      if (!Number.isFinite(s.nextEventAt) || s.nextEventAt > now) continue;
      const mode = this._modeFor(id);
      if (mode === "retention" && !this._retentionReady(id, now)) continue;
      out.push({ kpId: id, mode, at: s.nextEventAt });
    }
    out.sort((a, b) => a.at - b.at || (a.kpId < b.kpId ? -1 : 1));
    return out;
  }

  _eligibleQueue(now) {
    const out = [];
    for (const id of this.graph.ids) {
      const s = this.mastery.stateOf(id);
      if (!Number.isFinite(s.nextEventAt)) continue;
      const mode = this._modeFor(id);
      if (mode === "retention" && !this._retentionReady(id, now)) continue;
      out.push({ kpId: id, mode, at: s.nextEventAt });
    }
    out.sort((a, b) => a.at - b.at || (a.kpId < b.kpId ? -1 : 1));
    return out;
  }

  // ------------------------------------------------------------------- requests

  _acquisitionRequest(kpId) {
    const s = this.mastery.stateOf(kpId);
    const phase = this.phaseFor(kpId);
    const form = this._acquisitionForm(kpId);
    const target = this.mastery.targetDifficulty(kpId, "acquire");
    const difficulty = this._nearestVariant(kpId, target);
    const seconds = this.M.phases.secondsPerItemByPhase?.[phase] ?? SECONDS_DEFAULT;
    this.mastery.emit("learn:teach", { kpId, phase });
    return {
      seq: this._seq++,
      kpId,
      mode: "acquire",
      phase,
      form,
      difficulty,
      seconds,
      hinted: this.M.phases.hinted?.[phase] ?? false,
      // §4: retrieval practice against the specific wrong idea is what kills it. A fresh
      // unrelated item just lets the misconception survive.
      targetMisconception: s.lastCorrect === false ? s.lastMisconception : null,
      avoidItemIds: this._recentFor(kpId, form),
      sampling: "theta-targeted",
      // Generator families this node's engine will NOT score, so whoever picks the item can pick
      // something else. Each one has a single memorised answer; see `Mastery.refusedFamilies`.
      avoidFamilies: this.mastery.refusedFamilies(kpId, form),
      price: this.mastery.price(kpId, form, phase),
    };
  }

  _eventRequest() {
    const ev = this._event;
    const kpId = ev.kpId;
    const spec =
      ev.mode === "consolidate"
        ? this.M.spacing.consolidation
        : ev.mode === "retention"
          ? this.M.spacing.retentionCheck
          : this.M.spacing.review;
    // Consolidation, retention and review draw forms from their OWN arrays and run at their own
    // phase. A caller may not pass a form in here: these are the three surfaces an engineer
    // following a checklist reaches for a quick yes/no confirmation, and a guesser would farm them.
    const phase = spec.phase ?? "solo";
    // Certification draws from the spec's OWN form array, minus whatever the bank audit refused
    // for this node. A retention item in a refused form is not scorable, so it can never be
    // `credited`, so M4's 3-of-4 becomes unreachable and the node lapses forever on content it
    // was doing nothing wrong on. Filtering here is what keeps a content defect from turning into
    // an infinite lapse loop, and the refusal itself still stands.
    const pool = this._scorableForms(kpId, spec.forms);
    const forms = pool.length ? pool : spec.forms;
    const form = forms[(ev.index + this.graph.indexOf.get(kpId)) % forms.length];
    const centre = this.graph.centre(kpId);
    // Consolidation sits at the band centre. Retention and review sample UNIFORMLY over the whole
    // variant pool and are never theta-targeted: there is no easy tail to hide in.
    const difficulty = spec.atBandCentre
      ? centre
      : centre + this.M.ability.variantOffsets[Math.floor(this.rng() * this.M.ability.variantOffsets.length)];
    this.mastery.emit("learn:teach", { kpId, phase });
    return {
      seq: this._seq++,
      kpId,
      mode: ev.mode,
      phase,
      form,
      difficulty,
      seconds: SECONDS_DEFAULT,
      hinted: spec.hinted ?? false,
      targetMisconception: null,
      avoidItemIds: this._recentFor(kpId, form),
      sampling: spec.sampling ?? "uniform-over-variant-pool",
      itemIndex: ev.index,
      itemsInEvent: ev.items,
      avoidFamilies: this.mastery.refusedFamilies(kpId, form),
      price: this.mastery.price(kpId, form, phase),
    };
  }

  /**
   * §4 step 4. `construct` below `cycleAbove`, then a **running** index into `forms.order` keyed on
   * the node's cumulative mastery-eligible scored count. The cycle is never restarted when P
   * crosses the threshold: §5.1 item 3 is 0.9920 with the running index and 0.8256 without it,
   * and nothing after it lines up. Indexing on the M2 counter also means the form cycle cannot be
   * advanced by grinding scaffolded items.
   */
  _acquisitionForm(kpId) {
    const s = this.mastery.stateOf(kpId);
    const F = this.M.forms;
    // The cycle runs over the forms this knowledge point can actually be SCORED on. Serving
    // `construct` on `eq-special-cases` — whose whole construct pool answers `always` or `none`,
    // measured 0.53 blind — produces an item the engine refuses and the learner still pays 46 s
    // for, and the node then never leaves `learning` because nothing can move its counters.
    const order = this._scorableForms(kpId, F.order);
    if (!order.length) return F.beforeThreshold; // reported by Mastery as unmasterable; refused on submit
    if (s.p < F.cycleAbove && order.includes(F.beforeThreshold)) return F.beforeThreshold;
    return order[s.scored % order.length];
  }

  /** `wanted`, in order, keeping only what this node's bank pool can be honestly priced at. */
  _scorableForms(kpId, wanted) {
    return wanted.filter((form) => this.mastery.isScorable(kpId, form, "solo", null));
  }

  /** Nearest available variant tier to the target, on the logit scale. P17 owes five tiers per node. */
  _nearestVariant(kpId, target) {
    const centre = this.graph.centre(kpId);
    let best = centre;
    let bestGap = Infinity;
    for (const off of this.M.ability.variantOffsets) {
      const gap = Math.abs(centre + off - target);
      if (gap < bestGap) {
        bestGap = gap;
        best = centre + off;
      }
    }
    return best;
  }

  // ------------------------------------------------------------- teaching phase

  /**
   * §6.1 — the fade ladder, as a state machine rather than a function of P(known). `guided-2` and
   * `guided-3` are unscored, so a rule that only read the posterior would strand a learner in a
   * phase that cannot move it. Entry is P-triggered, exit is performance-triggered, and the
   * posterior shortcut means a learner who does not need the ladder never walks it.
   *
   * P18 is the teaching director and may override the phase; the engine prices whatever phase is
   * actually reported on the response, never the one it recommended.
   */
  phaseFor(kpId) {
    const P = this.M.phases;
    const FADE = P.fadeOrder;
    const s = this.mastery.stateOf(kpId);
    const centre = this.graph.centre(kpId);
    const easiestOffset = Math.min(...this.M.ability.variantOffsets);

    const firstEncounter = s.attempts === 0;
    // The easiest-variant trigger reads the GLOBAL ability estimate, so it must also read this
    // node's posterior — otherwise a learner doing fine on a band-5 node is re-lectured every
    // session merely because theta is still low somewhere else.
    const outOfReach =
      centre + easiestOffset > this.mastery.theta + this.M.ability.modelPhaseTriggerGap && s.p < P.modelPhaseThreshold;
    const sameTrapTwice = s.consecutiveSameMisconception >= 2;
    const LR = P.lapseReentry ?? {};
    const lapsedHard = this.mastery.recentLapses(kpId) >= (LR.afterLapses ?? 2) && s.p < (LR.unlessBelow ?? 0.3);

    const wantModel = (firstEncounter && s.p < P.modelPhaseThreshold) || outOfReach || sameTrapTwice || lapsedHard || s.pendingModel;

    if (wantModel && s.modelEvents < P.modelEventsPerNodePerSession) {
      s.modelEvents += 1;
      s.pendingModel = false;
      s.consecutiveSameMisconception = 0;
      s.fadeIdx = 0;
      return "model";
    }
    s.pendingModel = false;

    if (s.lastPhase === "model") {
      s.fadeIdx = 0;
      return FADE[0];
    }
    if (s.lastCorrect === null) {
      s.fadeIdx = 0;
      return s.p >= P.soloThreshold ? "solo" : FADE[0];
    }
    if (s.p >= P.soloThreshold && s.lastCorrect) return "solo";

    // A single wrong answer is exactly what `slip` is FOR. Scaffolding a slip is insulting and
    // expensive, so a retreat needs a RUN of errors.
    const retreat = s.consecutiveWrong >= P.retreatAfterConsecutiveErrors;
    if (s.lastPhase === "solo") {
      if (!retreat && s.p >= P.soloThreshold) return "solo";
      s.fadeIdx = FADE.length - 1;
      return FADE[s.fadeIdx];
    }
    if (s.lastCorrect) {
      s.fadeIdx += 1;
      if (s.fadeIdx >= FADE.length) return "solo";
      return FADE[s.fadeIdx];
    }
    if (!retreat) return FADE[s.fadeIdx];
    s.fadeIdx -= 1;
    if (s.fadeIdx < 0) {
      s.fadeIdx = 0;
      if (s.modelEvents < P.modelEventsPerNodePerSession) {
        s.modelEvents += 1;
        return "model";
      }
      return FADE[0];
    }
    return FADE[s.fadeIdx];
  }

  // -------------------------------------------------------------------- submit

  /**
   * Score one response against the request `next()` produced, then move time and the ladder.
   *
   * @param {object} req the request from `next()`
   * @param {object} outcome `{ correct, latencyMs?, promptTokens?, hinted?, itemId?, misconception?, response?, exercises? }`
   */
  submit(req, outcome) {
    const result = this.mastery.respond({
      kpId: req.kpId,
      form: req.form,
      phase: req.phase,
      mode: req.mode,
      difficulty: req.difficulty,
      correct: !!outcome.correct,
      latencyMs: outcome.latencyMs ?? null,
      promptTokens: outcome.promptTokens ?? 0,
      // What the world ACTUALLY did on this item. `req.hinted` is only the default for the phase.
      hinted: typeof outcome.hinted === "boolean" ? outcome.hinted : req.hinted,
      itemId: outcome.itemId ?? null,
      // Which generator family the presenter actually served. Twenty of the bank's families have
      // a single memorised answer; the engine refuses those outright, and a presenter that does
      // not say which family it served is priced at the worst family it was allowed to serve.
      family: outcome.family ?? null,
      misconception: outcome.misconception ?? null,
      response: outcome.response ?? null,
      exercises: outcome.exercises,
    });

    // Time is a box, and a scaffolded item does not cost what an unscaffolded one costs.
    const seconds = req.seconds ?? SECONDS_DEFAULT;
    this.secondsSpent += seconds;
    this.itemsThisSession += 1;
    if (req.mode !== "acquire") this.reviewItemsThisSession += 1;
    this.clock.advance(seconds / 60);

    if (outcome.itemId) this.noteServed({ itemId: outcome.itemId, kpId: req.kpId, form: req.form });

    if (req.mode === "acquire") {
      this.blockCount += 1;
      if (this.mastery.status(req.kpId) !== "learning") this.inFlight = null;
      this._syncInFlight();
    } else if (this._event) {
      this._event.index += 1;
      // The event's `right` is NOT counted here. `outcome.correct` is the caller's claim;
      // `Mastery._bookkeep` counts `result.credited`, which is the engine's decision, and M4
      // reads that. Counting the caller's claim here is exactly the defect that let a learner
      // read the hint on all four retention items and certify anyway.
      if (this._event.index >= this._event.items) this._finishEvent();
    }
    return result;
  }

  _finishEvent() {
    const ev = this._event;
    this._event = null;
    const now = this.clock.minutes();
    const kpId = ev.kpId;
    const s = this.mastery.stateOf(kpId);
    const sp = this.M.spacing;
    // Read the engine's tally BEFORE any transition below clears it.
    const tally = this.mastery.eventOf(kpId) ?? { served: ev.index, right: 0, refusedRight: 0 };
    this._syncInFlight();

    if (ev.mode === "consolidate") {
      // A practice pass, not a passing score: `spacing.consolidation.passAtLeast` is 0. The two
      // items are scored normally, so getting them wrong pushes P(known) down and can strand the
      // node below threshold when M4 arrives — but the transition is not conditional on the count.
      this.mastery.markConsolidated(kpId, Math.max(now, (s.provisionalAt ?? now) + sp.retentionCheck.minHours * 60));
      return;
    }

    if (ev.mode === "retention") {
      if (this.mastery.retentionPassed(kpId, tally.right)) {
        const intervalDays = Math.min(sp.capDays, sp.ladderDays[0]);
        this.mastery.certify(kpId, { intervalDays, dueAtMinutes: now + intervalDays * 1440 });
      } else {
        this.mastery.lapse(kpId, "retention");
        this._reenterTeaching(kpId);
      }
      return;
    }

    // review
    if (s.p >= REVIEW_LAPSE_BELOW) {
      const ladder = s.ladder + 1;
      const days =
        ladder < sp.ladderDays.length
          ? sp.ladderDays[ladder]
          : Math.min(sp.capDays, (s.intervalDays || sp.ladderDays[sp.ladderDays.length - 1]) * sp.growthFactor);
      const intervalDays = Math.min(sp.capDays, days);
      s.ladder = ladder;
      s.intervalDays = intervalDays;
      s.nextEventAt = now + intervalDays * 1440;
      s.event = null;
    } else {
      this.mastery.lapse(kpId, "review");
      this._reenterTeaching(kpId);
    }
  }

  /**
   * §3 rule 5. A lapsed node re-enters one step back from solo — the lightest scaffold, not a
   * lecture. Unless the posterior has genuinely fallen through `lapseReentry.unlessBelow`, at
   * which point the knowledge really has gone and a demonstration is the honest response.
   */
  _reenterTeaching(kpId) {
    const s = this.mastery.stateOf(kpId);
    const P = this.M.phases;
    const LR = P.lapseReentry ?? {};
    s.lastPhase = "solo";
    s.lastCorrect = false;
    s.consecutiveWrong = P.retreatAfterConsecutiveErrors;
    s.fadeIdx = P.fadeOrder.length - 1;
    if (this.mastery.recentLapses(kpId) >= (LR.afterLapses ?? 2) && s.p < (LR.unlessBelow ?? 0.3)) s.pendingModel = true;
  }

  // ------------------------------------------------------------------ abandonment

  /**
   * Drop the open certification event without finishing it.
   *
   * A retention check that has already been served items and is then thrown away is a lapse, for
   * the same reason a failed one is: otherwise "walk away when it is going badly, come back and
   * re-roll" is a strategy, and the check `nextEventAt` still points at is free. Consolidation
   * carries no gate (`passAtLeast` is 0) and review is re-scheduled by its own ladder, so those
   * two are simply dropped.
   */
  abandonEvent(reason = "abandoned") {
    const ev = this._event;
    if (!ev) return null;
    this._event = null;
    const tally = this.mastery.eventOf(ev.kpId);
    const served = tally ? tally.served : ev.index;
    this.mastery.clearEvent(ev.kpId);
    this._syncInFlight();
    if (ev.mode === "retention" && served > 0) {
      this.mastery.lapse(ev.kpId, `retention-abandoned:${reason}`);
      this._reenterTeaching(ev.kpId);
      return { kpId: ev.kpId, mode: ev.mode, served, lapsed: true };
    }
    return { kpId: ev.kpId, mode: ev.mode, served, lapsed: false };
  }

  // ---------------------------------------------------------------- persistence

  /**
   * The Scheduler's half of the learner state. `Mastery.snapshot()` embeds this, so one
   * `persist()` writes the whole engine. Without it a reload used to lose the open retention
   * check (silently, with no lapse and no M2 dock) and the 40-item no-repeat window.
   */
  snapshot() {
    return {
      event: this._event ? { ...this._event } : null,
      recentItemIds: [...this.recentItemIds],
      // The per-cell window is state: dropping it on reload would hand the learner the same items
      // again, which is exactly the repeat the audit priced against.
      recentByCell: Object.fromEntries([...this.recentByCell].map(([k, v]) => [k, [...v]])),
      inFlight: this.inFlight,
      blockCount: this.blockCount,
      secondsSpent: this.secondsSpent,
      itemsThisSession: this.itemsThisSession,
      reviewItemsThisSession: this.reviewItemsThisSession,
      seq: this._seq,
    };
  }

  restore(snap) {
    if (!snap) return false;
    this._event = snap.event ? { ...snap.event } : null;
    this.recentItemIds = [...(snap.recentItemIds ?? [])];
    this.recentByCell = new Map(Object.entries(snap.recentByCell ?? {}).map(([k, v]) => [k, [...v]]));
    this.inFlight = snap.inFlight ?? null;
    this.blockCount = snap.blockCount ?? 0;
    this.secondsSpent = snap.secondsSpent ?? 0;
    this.itemsThisSession = snap.itemsThisSession ?? 0;
    this.reviewItemsThisSession = snap.reviewItemsThisSession ?? 0;
    this._seq = snap.seq ?? 0;
    this._syncInFlight();
    return true;
  }

  // -------------------------------------------------------------------- probe

  probe() {
    const tally = this._event ? this.mastery.eventOf(this._event.kpId) : null;
    return {
      sessionMinutes: this.sessionMinutes,
      secondsSpent: this.secondsSpent,
      itemsThisSession: this.itemsThisSession,
      reviewItemsThisSession: this.reviewItemsThisSession,
      inFlight: this.inFlight ? [this.inFlight] : [],
      blockCount: this.blockCount,
      recentItemIds: this.recentItemIds.length,
      // How wide the window a presenter is actually handed is, at its widest cell. A reviewer can
      // read straight off the probe whether the catalogue is being walked out or recycled.
      noRepeatWindow: this.M.antiGuessing.noRepeatWithinItems ?? 40,
      recentCells: this.recentByCell.size,
      widestCellWindow: this.recentByCell.size ? Math.max(...[...this.recentByCell.values()].map((v) => v.length)) : 0,
      event: this._event
        ? {
            kpId: this._event.kpId,
            mode: this._event.mode,
            index: this._event.index,
            items: this._event.items,
            // The credited tally, so a reviewer can watch M4's count refuse a hinted correct.
            right: tally?.right ?? 0,
            refusedRight: tally?.refusedRight ?? 0,
          }
        : null,
      reviewCapLift: this.reviewCapLift,
      pullForward: this.pullForward,
    };
  }
}
