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

    this.inFlight = null;
    this.blockCount = 0;
    this.itemsThisSession = 0;
    this.reviewItemsThisSession = 0;
    this.secondsSpent = 0;
    this.sessionEndsAt = -Infinity;
    this.recentItemIds = [];
    this._event = null;
    this._seq = 0;
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
      }
      return this._acquisitionRequest(pick.kpId);
    }

    const items =
      pick.mode === "consolidate"
        ? this.M.spacing.consolidation.items
        : pick.mode === "retention"
          ? this.M.spacing.retentionCheck.items
          : this.M.spacing.review.items;
    this._event = { kpId: pick.kpId, mode: pick.mode, items, index: 0, right: 0 };
    this.mastery.beginEvent(pick.kpId, pick.mode, items);
    return this._eventRequest();
  }

  _choose() {
    const now = this.clock.minutes();
    const frontier = this.mastery.frontier();
    const acquirable = frontier.filter((id) => this.mastery.status(id) === "learning");

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
    if (this.inFlight && this.blockCount < this.blockLength && this.mastery.status(this.inFlight) === "learning")
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
      avoidItemIds: this.recentItemIds.slice(),
      sampling: "theta-targeted",
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
    const form = spec.forms[(ev.index + this.graph.indexOf.get(kpId)) % spec.forms.length];
    const phase = spec.phase ?? "solo";
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
      avoidItemIds: this.recentItemIds.slice(),
      sampling: spec.sampling ?? "uniform-over-variant-pool",
      itemIndex: ev.index,
      itemsInEvent: ev.items,
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
    if (s.p < F.cycleAbove) return F.beforeThreshold;
    return F.order[s.scored % F.order.length];
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

    if (outcome.itemId) {
      this.recentItemIds.push(outcome.itemId);
      const cap = this.M.antiGuessing.noRepeatWithinItems ?? 40;
      while (this.recentItemIds.length > cap) this.recentItemIds.shift();
    }

    if (req.mode === "acquire") {
      this.blockCount += 1;
      if (this.mastery.status(req.kpId) !== "learning") this.inFlight = null;
    } else if (this._event) {
      this._event.index += 1;
      if (outcome.correct) this._event.right += 1;
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

    if (ev.mode === "consolidate") {
      // A practice pass, not a passing score: `spacing.consolidation.passAtLeast` is 0. The two
      // items are scored normally, so getting them wrong pushes P(known) down and can strand the
      // node below threshold when M4 arrives — but the transition is not conditional on the count.
      this.mastery.markConsolidated(kpId, Math.max(now, (s.provisionalAt ?? now) + sp.retentionCheck.minHours * 60));
      return;
    }

    if (ev.mode === "retention") {
      if (this.mastery.retentionPassed(kpId, ev.right)) {
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

  // -------------------------------------------------------------------- probe

  probe() {
    return {
      sessionMinutes: this.sessionMinutes,
      secondsSpent: this.secondsSpent,
      itemsThisSession: this.itemsThisSession,
      reviewItemsThisSession: this.reviewItemsThisSession,
      inFlight: this.inFlight ? [this.inFlight] : [],
      blockCount: this.blockCount,
      event: this._event ? { kpId: this._event.kpId, mode: this._event.mode, index: this._event.index, items: this._event.items } : null,
      reviewCapLift: this.reviewCapLift,
      pullForward: this.pullForward,
    };
  }
}
