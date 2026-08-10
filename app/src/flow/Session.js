/**
 * P33 — the session layer. Fifteen to twenty-five minutes that ends on a win.
 *
 * ---------------------------------------------------------------------------------------------
 * THE DEFECT THIS FILE EXISTS TO CLOSE
 *
 * `learn/Scheduler.js` already has a time box, and it is measured in the DESIGN's seconds:
 * `secondsSpent += req.seconds`, where `req.seconds` comes from `phases.secondsPerItemByPhase`
 * (22 / 34 / 40 / 46). Those numbers are a pricing contract — a demonstration must not cost what
 * a solo item costs — and as a pricing contract they are correct. As a **clock** they are a
 * fiction, because they are the same for every learner. Run the engine on its own with
 * `sessionMinutes = 25` and every learner alive is cut off at the same ~35 items: the one who
 * answers in nine seconds is thrown out after eight real minutes with the arc unfinished, and the
 * one who answers in seventy is still going at fifty. `review/measure/P33.mjs` measures exactly
 * that and prints both arms.
 *
 * So this file budgets in **mastery events** — beats — and calibrates those beats to wall clock
 * using the learner's own measured pace. The design's per-phase seconds survive as the SHAPE of
 * an item's cost (a demonstration really is shorter than a solo item); only the SCALE is
 * measured, as one ratio ρ, per learner, persisted between sittings by `flow/Save.js`. A learner
 * at ρ = 0.4 gets more than twice the work of a learner at ρ = 1.6 in the same twenty minutes,
 * which is the entire point.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT A BEAT IS, AND WHY THE SESSION CAN ONLY END ON ONE
 *
 * A beat is one completed unit of work:
 *
 *   - a certification event — consolidation (2 items), a retention check (4), a review (2). These
 *     are **atomic**: §3's retention check is "sampled uniformly, in one sitting", and a check cut
 *     in half by a clock is a check the learner has to be lapsed for or gifted, and both are
 *     wrong. `Scheduler.abandonEvent` lapses the node, and a lapse the learner did not earn is
 *     the worst thing this layer could do to them;
 *   - an acquisition block — up to `Scheduler.blockLength` items on one knowledge point, §4 step 2.
 *
 * **The clock never cuts a beat.** It decides whether the next beat is ADMITTED. Admission is
 * where the whole 15–25 arc is enforced: a beat is admitted only if its worst-case cost, priced
 * at the learner's own high quantile, still lands under the ceiling. That is why the ceiling is
 * 25 and the aim is 21 — the four minutes of slack are the cost of never interrupting anybody.
 *
 * The last beat is therefore always a completed beat, and `closeReason` says which kind of ending
 * it was. If time is nearly up and the only work left would OPEN a knowledge point the learner
 * has never met — an item where the world performs the algebra and the learner makes the last
 * move — the session closes instead. Ending on a demonstration is ending on somebody else's win.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT THIS FILE DOES NOT DO
 *
 * It does not choose items, and it does not choose knowledge points. §4 of
 * `design/learning-architecture.md` is the law for that and `learn/Scheduler.js` implements it:
 * due events first under the one-in-three cap, then the continuity block, then the frontier
 * score. This layer plans the **mix and the size** of a sitting — how many certifications against
 * how much new ground, and how much of that fits in the learner's twenty minutes — and then
 * admits or refuses beats at the boundary. `plan.beats` is a forecast made from the same law, and
 * `probe().adherence` reports how well the forecast matched what the engine actually served, so
 * the claim stays a measurement rather than an assertion. If P16 ever publishes a `focus(kpId)`
 * affordance this file will use it; it will not reach into the Scheduler's private state to fake
 * one.
 *
 * ---------------------------------------------------------------------------------------------
 * VOICE
 *
 * `design/voice.md` §3 binds every line below: `sys.*` register, third person, never "you", never
 * an exclamation, 7 words and 44 EN characters. §5 forbids percentages spoken aloud, "you have
 * mastered", and any congratulation — so the close is a **report of world state**, in the same
 * register as `sys.claim.set.01`, and never a report card. The strings here are EN SOURCE for
 * locale keys that `content/locales/*` (P20) does not carry yet; nothing renders them. Every
 * signal carries `{ key, params }` alongside the source text so a HUD resolves the localised
 * string and falls back to nothing rather than to English. This file deliberately does not import
 * `i18n` — `I18n.t()` records a miss on an unknown key, and a miss recorded at runtime would fail
 * another piece's gate for a string this piece has not shipped yet.
 */

import { signals } from "../core/Signals.js";

/** The Pomodoro arc, in minutes. `target` is what the plan is packed to; `max` is never exceeded. */
export const ARC = {
  minMinutes: 15,
  targetMinutes: 21,
  maxMinutes: 25,
  /** Away for longer than this and the sitting is over — a break ends a session (P33 brief). */
  breakMinutes: 5,
};

/** The longest atomic beat in the design: `spacing.retentionCheck.items`. Used for reservations. */
const MAX_EVENT_ITEMS = 4;

/** The item cost the plan is packed with. A solo item, i.e. the expensive case. */
const REFERENCE_ITEM_SECONDS = 46;

/**
 * EN source text for keys P20 has not been handed yet. See the VOICE note in the header.
 * Every line: `sys.*` register, ≤7 words, ≤44 characters, third person, no exclamation.
 */
export const VOICE = {
  "sys.session.open.first": "The field is quiet. Claims are standing.",
  "sys.session.open.working": "Someone's working is still on the slab.",
  "sys.session.open.grey": "{n} claims have gone grey.",
  "sys.session.open.set": "{n} certainties hold from before.",
  "sys.session.open.due": "{n} claims are ready to be set.",
  "sys.session.close.set": "{n} certainties set. They will not drift.",
  "sys.session.close.stood": "The last claim stands.",
  "sys.session.close.open": "The claim is still standing open.",
  "sys.session.close.rung": "Rung.",
  "sys.session.close.rest": "The light is going. The field rests.",
  "sys.session.close.quiet": "Nothing is standing open here.",
};

/** `{ key, params, source }` — the shape every voice line travels in. `source` is EN, not copy. */
function line(key, params = null) {
  const raw = VOICE[key] ?? "";
  const source = params ? raw.replace(/\{(\w+)\}/g, (whole, name) => (name in params ? String(params[name]) : whole)) : raw;
  return { key, params, source };
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const round2 = (v) => Math.round(v * 100) / 100;
const round4 = (v) => Math.round(v * 10000) / 10000;

/**
 * Expected value of one beat, in **Level 1 certifications bought per item served**. One unit is
 * one knowledge point moved from `provisional` to `mastered`, because that is the only transition
 * `level1Percent` counts (§2). Everything else is priced as a fraction of one, discounted for how
 * far away the payoff is. These are the numbers that decide the MIX of a sitting; §4's own
 * frontier score decides the order inside the acquisition half, so the plan never contradicts the
 * law the engine is implementing.
 */
export const LEVERAGE = {
  /** A retention check IS the certification. §4.1: certification capacity is the bottleneck. */
  certify: (pPass) => pPass / 4,
  /**
   * Consolidation buys the right to attempt one, at least twelve hours and one sitting later.
   * Half the value (it is one of two gates), discounted 0.6 for the deferral.
   */
  consolidate: (pPass) => (0.5 * pPass * 0.6) / 2,
  /**
   * A review protects a certification already counted. Worth more the more overdue it is, because
   * the posterior has had longer to decay past `REVIEW_LAPSE_BELOW`.
   */
  review: (overdueFraction) => (0.08 + 0.22 * clamp(overdueFraction, 0, 1)) / 2,
  /**
   * Acquisition buys a share of one future certification: `1 / itemsToProvisional`, weighted by
   * how much of the graph this node opens. `Reach` is §4's own term and it is here for §4's own
   * reason — a node that gates twenty-nine descendants is leverage on everything behind it.
   */
  acquire: (itemsToProvisional, reach) => ((0.5 + 0.5 * reach) / Math.max(1, itemsToProvisional)) * 0.5,
};

export class Session {
  /**
   * @param {object} opts
   * @param {object|null} opts.learning the kernel's `learning` system (P16). Null is legal: the
   *        session layer then reports `dormant` and does nothing, rather than throwing at boot.
   * @param {import("./Save.js").Save|null} [opts.save]
   * @param {() => number} [opts.now] wall clock in **milliseconds**.
   * @param {(name: string, value: any) => void} [opts.emit]
   * @param {Partial<typeof ARC>} [opts.arc]
   */
  constructor(opts = {}) {
    this.learning = opts.learning ?? null;
    this.save = opts.save ?? null;
    this.now = opts.now ?? (() => Date.now());
    this.emit = opts.emit ?? ((name, value) => signals.emit(name, value));
    this.arc = { ...ARC, ...(opts.arc ?? {}) };

    /** `idle` -> `open` -> `work` -> `closing` -> `closed`. `dormant` when there is no engine. */
    this.phase = this.learning ? "idle" : "dormant";
    this.closeReason = null;
    this.number = 0;

    // --- wall clock, in ATTENDED milliseconds. Away time never counts against a Pomodoro. -----
    this.openedAt = null;
    this.startedAt = null;
    this._mark = null;
    this.attendedMs = 0;
    this.awayMs = 0;
    this._awayPending = 0;
    this._awayThisItem = 0;
    this._breakPending = false;

    // --- pace calibration -------------------------------------------------------------------
    this.pace = this.save?.pace ? { ...this.save.pace } : { ratio: 1, spread: 0, gapSeconds: 4, samples: 0 };
    this._var = this.pace.spread * this.pace.spread;

    // --- work in flight ----------------------------------------------------------------------
    this.beat = null;
    this.beats = [];
    this.itemsServed = 0;
    this._servedAt = null;
    this._lastSubmitAt = null;
    this._req = null;
    this.plan = null;
    this._planAtStart = null;
    this.opening = [];
    this.closing = [];

    /** Counted so the summary is a fact rather than a feeling. */
    this.tally = { items: 0, stood: 0, fell: 0, unscored: 0, certified: [], set: [], lapsed: [] };
    /** Invariants a reviewer can read instead of taking on trust. See `next()`. */
    this.stats = { startsOutsideCeiling: 0, beatsClosedAtItem: 0, eventsCarried: 0 };
    this._statusAtOpen = new Map();
  }

  // ----------------------------------------------------------------- engine handles

  get mastery() {
    return this.learning?.mastery ?? null;
  }

  get scheduler() {
    return this.learning?.scheduler ?? null;
  }

  get graph() {
    return this.learning?.graph ?? this.mastery?.graph ?? null;
  }

  get blockLength() {
    return this.scheduler?.blockLength ?? 3;
  }

  // ------------------------------------------------------------------------- clock

  /** Move attended time up to `nowMs`, subtracting anything the learner was away for. */
  _settle(nowMs) {
    if (this._mark == null) {
      this._mark = nowMs;
      return;
    }
    const gross = Math.max(0, nowMs - this._mark);
    const away = Math.min(gross, this._awayPending);
    this.attendedMs += gross - away;
    this._awayPending -= away;
    this._mark = nowMs;
  }

  /**
   * The learner was away for `ms`. Called by the boot module on `visibilitychange`; a simulation
   * calls it directly. Away time is excluded from the arc AND from pace calibration, and a gap
   * past `arc.breakMinutes` ends the sitting at the next beat boundary — that is what "a break
   * genuinely ends a session" means. It does not end it *immediately*, because ending immediately
   * would mean ending inside an open retention check.
   */
  noteAway(ms) {
    const away = Math.max(0, Number(ms) || 0);
    if (!away) return;
    this.awayMs += away;
    this._awayPending += away;
    if (this._servedAt != null) this._awayThisItem += away;
    if (away >= this.arc.breakMinutes * 60000) this._breakPending = true;
  }

  /** Attended seconds since the first item was served. Zero while nothing has been served. */
  get elapsedSeconds() {
    if (this.startedAt == null) return 0;
    const at = this.phase === "closed" ? this._mark : this.now();
    if (at != null && this.phase !== "closed") this._settle(at);
    return this.attendedMs / 1000;
  }

  // --------------------------------------------------------------------- pace model

  /** Expected seconds for one item of this phase, at this learner's measured pace. */
  itemSeconds(phaseSeconds = REFERENCE_ITEM_SECONDS) {
    return this.pace.ratio * phaseSeconds + this.pace.gapSeconds;
  }

  /**
   * The same estimate at a high quantile. **Admission** uses this and the plan does not: a plan
   * built on the worst case under-books every sitting, and a ceiling built on the median is a
   * ceiling the first learner who stops to think walks straight through.
   *
   * The 2.2× clamp is what keeps one very long item from making the estimator hysterical. Without
   * it a single five-minute stare on a high-variance learner drove the reservation past fifteen
   * minutes, admission refused everything, and the sitting ended at nine — a Pomodoro layer
   * failing the floor because it was too frightened of the ceiling.
   */
  itemSecondsHigh(phaseSeconds = REFERENCE_ITEM_SECONDS) {
    const hi = (this.pace.ratio + 1.5 * this.pace.spread) * phaseSeconds + this.pace.gapSeconds;
    return clamp(hi, this.itemSeconds(phaseSeconds), 2.2 * this.itemSeconds(phaseSeconds));
  }

  /**
   * The last line of defence on the ceiling: what one more item could plausibly cost, not what it
   * usually costs. Used only INSIDE a non-atomic beat, where an item boundary is a legal place to
   * stop. Nothing bounds a single response from above — a learner may put the tablet down — so
   * this is an honest start guarantee (nothing is STARTED that is not expected to finish inside
   * the ceiling), not an arithmetic impossibility proof.
   */
  itemSecondsCeiling(phaseSeconds = REFERENCE_ITEM_SECONDS) {
    const hi = (this.pace.ratio + 5 * this.pace.spread) * phaseSeconds + this.pace.gapSeconds;
    return clamp(hi, this.itemSecondsHigh(phaseSeconds), 8 * this.itemSeconds(phaseSeconds));
  }

  /**
   * What a beat of `items` items could plausibly cost.
   *
   * NOT `items × itemSecondsHigh()`. The high quantile of a SUM is not the sum of high quantiles —
   * four items each at their own p90 is a p99.99 for the group, and reserving that much is what
   * made a slow learner's sitting end at nine minutes because a four-item check "would not fit" in
   * fifteen. The spread term scales with √n, which is what a sum of independent draws does.
   */
  beatSecondsHigh(items) {
    const sd = this.pace.spread * REFERENCE_ITEM_SECONDS;
    return items * this.itemSeconds() + 2 * Math.sqrt(items) * sd;
  }

  /**
   * The aim, backed off by how unpredictable this learner's timing is.
   *
   * A learner whose items take between five seconds and four minutes cannot be promised the same
   * arc as one who is metronomic, because the promise that matters is the CEILING and the tail is
   * what breaks it. So the target moves toward the floor in proportion to the gap between a
   * typical item and a slow one, capped at a quarter of the arc so it can never fall through
   * `minMinutes`. A shorter promise kept beats a longer promise broken.
   */
  targetSeconds() {
    const full = this.arc.targetMinutes * 60;
    const slack = clamp(this.itemSecondsCeiling() - this.itemSeconds(), 0, 0.25 * full);
    return Math.max(this.arc.minMinutes * 60 + 60, full - slack);
  }

  _calibrate(req, itemMs) {
    const modelled = req.seconds || REFERENCE_ITEM_SECONDS;
    let ratio = clamp(itemMs / 1000 / modelled, 0.05, 8);
    const n = this.pace.samples;
    // Winsorise once there is something to compare against. One item somebody walked away from
    // mid-thought is not a fact about how fast they work, and letting it move the estimate by a
    // factor of five is how a budget stops describing anybody.
    if (n >= 5) ratio = Math.min(ratio, 2.5 * this.pace.ratio);
    /**
     * Fast for the first handful of items, then slow. Both ends are load-bearing. A learner's
     * first sitting must not spend ten minutes believing the design's seconds are theirs — and a
     * settled learner's budget must not be rewritten by one item they spent four minutes on. At a
     * floor of 0.2, one clamped outlier moved a slow learner's ρ from 1.7 to 2.7, the reservation
     * for a four-item check went past fifteen minutes, admission refused everything, and the
     * sitting ended at nine. At 0.06 a whole sitting still moves ρ 84% of the way to a genuine
     * change of speed, and one item moves it by a sixteenth.
     */
    const alpha = clamp(1 / (n + 1), 0.06, 1);
    const before = this.pace.ratio;
    this.pace.ratio = before + alpha * (ratio - before);
    const dev = ratio - this.pace.ratio;
    this._var = this._var + alpha * (dev * dev - this._var);
    this.pace.spread = Math.sqrt(Math.max(0, this._var));
    this.pace.samples = n + 1;
  }

  _calibrateGap(gapMs) {
    const g = clamp(gapMs / 1000, 0, 120);
    const alpha = clamp(1 / (this.pace.samples + 1), 0.06, 1);
    this.pace.gapSeconds = this.pace.gapSeconds + alpha * (g - this.pace.gapSeconds);
  }

  // ------------------------------------------------------------------------ planning

  /** §3's retention gate, read off the same JSON fields the Scheduler reads. */
  _retentionReady(kpId, nowMinutes) {
    const m = this.mastery;
    const rc = m.M.spacing.retentionCheck;
    const s = m.stateOf(kpId);
    if (s.provisionalAt == null) return false;
    if (nowMinutes < s.provisionalAt + rc.minHours * 60) return false;
    return m.session - (s.provisionalSession ?? 0) >= rc.minInterveningSessions;
  }

  /** P(3 of 4) for a learner who genuinely holds this node — §2's own arithmetic. */
  _pPass(kpId) {
    const q = 1 - this.graph.band(kpId).slip;
    return 4 * q * q * q * (1 - q) + q * q * q * q;
  }

  /** How many mastery-eligible items this node still needs before the gate can open at all. */
  _itemsToProvisional(kpId) {
    const m = this.mastery;
    const s = m.stateOf(kpId);
    const B = m.M.bkt;
    const needScored = Math.max(0, B.minScoredOpportunities - s.scored);
    const needAtBand = Math.max(0, B.minAtBandOpportunities - s.atBand);
    const needForms = Math.max(0, B.minDistinctItemForms - (s.forms?.length ?? 0));
    // Posterior distance, priced in learn-rate steps. Crude on purpose: it only has to ORDER
    // nodes, and the counters above dominate it for anything that has not been worked yet.
    const needP = s.p >= B.masteryThreshold ? 0 : Math.ceil((B.masteryThreshold - s.p) / Math.max(0.05, m.learnRate(kpId)));
    return Math.max(1, needScored, needAtBand, needForms, needP);
  }

  /** Every beat the engine could legally serve right now, priced. */
  candidates() {
    const m = this.mastery;
    if (!m) return [];
    const g = this.graph;
    const nowMin = m.now();
    const sp = m.M.spacing;
    const out = [];

    for (const id of g.ids) {
      const s = m.stateOf(id);
      const due = Number.isFinite(s.nextEventAt) && s.nextEventAt <= nowMin;
      if (!due) continue;
      if (s.status === "provisional" && !s.consolidated) {
        out.push({ kind: "consolidate", kpId: id, items: sp.consolidation.items, atomic: true, leverage: LEVERAGE.consolidate(this._pPass(id)) });
      } else if (s.status === "provisional" && s.consolidated) {
        if (this._retentionReady(id, nowMin))
          out.push({ kind: "retention", kpId: id, items: sp.retentionCheck.items, atomic: true, leverage: LEVERAGE.certify(this._pPass(id)) });
      } else if (s.status === "mastered") {
        const window = Math.max(1, s.intervalDays || 1) * 1440;
        out.push({
          kind: "review",
          kpId: id,
          items: sp.review.items,
          atomic: true,
          leverage: LEVERAGE.review((nowMin - s.nextEventAt) / window),
        });
      }
    }

    // Acquisition: the frontier §4 step 3 would actually offer, minus anything the bank audit left
    // with no scorable form (the Scheduler refuses those, so planning them would book time the
    // engine will not spend).
    const target = m.theta + m.M.ability.acquisitionTargetOffset;
    for (const id of m.frontier()) {
      if (m.status(id) !== "learning") continue;
      if (m.masteryFormsFor(id).length === 0) continue;
      const s = m.stateOf(id);
      const b = g.centre(id);
      const reach = g.descendants(id).size / g.maxDescendants;
      // §4's own frontier score, so the forecast is made from the law the engine implements.
      const fit = Math.exp(-((b - target) ** 2) / (2 * 0.7 ** 2));
      const fresh = 1 - Math.min(1, s.attempts / 12);
      out.push({
        kind: "acquire",
        kpId: id,
        items: this.blockLength,
        atomic: false,
        leverage: LEVERAGE.acquire(this._itemsToProvisional(id), reach),
        frontierScore: 0.4 * fit + 0.3 * reach + 0.15 * fresh,
        fresh: s.attempts === 0,
      });
    }
    return out;
  }

  /**
   * Pack the REMAINING budget: which beats, in what order, sized to this learner's own seconds.
   *
   * Re-run at every beat boundary, so `remaining` is a live forecast rather than a number written
   * once at the door and then quietly falsified by a learner who turned out to be twice as fast.
   * The budget is in **beats**; wall clock enters only through `itemSeconds()`, which is measured.
   *
   * The ORDER follows §4 — a due event outranks new ground, subject to the one-in-three review cap
   * while acquisition work remains — because that is what the engine will do, and a forecast that
   * fights the law it is forecasting is not a forecast. Where §4 leaves a choice, `leverage`
   * decides: which of six due events is worth the four items, and which frontier node is worth the
   * block. That choice — **the mix** — is what this layer contributes and §4 does not legislate.
   */
  replan() {
    const perItem = this.itemSeconds();
    const elapsed = this.elapsedSeconds;
    const budget = Math.max(0, this.targetSeconds() - elapsed);
    const cands = this.candidates();
    const events = cands.filter((c) => c.kind !== "acquire").sort((a, b) => b.leverage - a.leverage);
    const acquire = cands.filter((c) => c.kind === "acquire").sort((a, b) => b.frontierScore - a.frontierScore);

    const ahead = [];
    let items = 0;
    // The cap is a session-wide ratio, so the forecast starts from what has already been served.
    let eventItems = this.beats.filter((b) => b.kind !== "acquire").reduce((a, b) => a + b.served, 0);
    let servedItems = this.itemsServed;
    let ei = 0;
    let ai = 0;
    let guard = 0;
    while (guard++ < 400) {
      const acquisitionRemains = acquire.length > 0;
      // The Scheduler's own cap: `reviewItemsThisSession < (itemsThisSession + 1) / 3`, lifted
      // once the frontier is exhausted.
      const underCap = eventItems < (servedItems + 1) / 3;
      const takeEvent = ei < events.length && (underCap || !acquisitionRemains);
      const next = takeEvent ? events[ei++] : acquire.length ? acquire[ai++ % acquire.length] : null;
      if (!next) break;
      if ((items + next.items) * perItem > budget) break;
      ahead.push({ ...next, index: this.beats.length + ahead.length });
      items += next.items;
      servedItems += next.items;
      if (next.kind !== "acquire") eventItems += next.items;
    }

    const totalItems = this.itemsServed + items;
    this.plan = {
      /** For the WHOLE sitting: beats already closed plus beats still forecast. */
      events: this.beats.length + ahead.length,
      items: totalItems,
      minutes: round2((elapsed + items * perItem) / 60),
      perItemSeconds: round2(perItem),
      targetMinutes: round2(this.targetSeconds() / 60),
      ahead: {
        events: ahead.length,
        items,
        seconds: Math.round(items * perItem),
        minutes: round2((items * perItem) / 60),
      },
      /** True when the graph has less legal work than the arc has room for. Reported, not hidden. */
      shortfall: elapsed + items * perItem < this.arc.minMinutes * 60,
      beats: ahead.map((b) => ({
        index: b.index,
        kind: b.kind,
        kpId: b.kpId,
        items: b.items,
        leverage: round4(b.leverage),
      })),
    };
    return this.plan;
  }

  // ---------------------------------------------------------------------- lifecycle

  /**
   * Open a sitting: plan it, say what was going on when the learner left, and start the engine's
   * own session counter (which §3's "one intervening session" gate reads).
   *
   * @param {object} [opts]
   * @param {boolean} [opts.adopt] adopt the session the engine has ALREADY begun instead of
   *        beginning another. `boot/62-learning.js` calls `scheduler.beginSession()` during its
   *        own setup, so the first sitting of a page load is already open by the time this layer
   *        mounts at order 90. Counting it twice would hand §3's "at least one intervening
   *        session" gate a free session per reload, and a retention check bought by pressing F5
   *        is exactly the kind of thing §5.0 exists to keep closed.
   */
  begin(opts = {}) {
    if (!this.learning) {
      this.phase = "dormant";
      return null;
    }
    if (this.phase === "work" || this.phase === "closing") return this.plan;

    const nowMs = this.now();
    this.openedAt = nowMs;
    this._mark = nowMs;
    this.attendedMs = 0;
    this.awayMs = 0;
    this._awayPending = 0;
    this._breakPending = false;
    this.startedAt = null;
    this.closeReason = null;
    this.beat = null;
    this.beats = [];
    this.itemsServed = 0;
    this._servedAt = null;
    this._lastSubmitAt = null;
    this.tally = { items: 0, stood: 0, fell: 0, unscored: 0, certified: [], set: [], lapsed: [] };
    this.stats = { startsOutsideCeiling: 0, beatsClosedAtItem: 0, eventsCarried: 0 };

    // `beginSession` is P16's: it increments the session counter and resets the per-node model
    // budget. Calling it here rather than at boot is what makes "a break ends a session" true all
    // the way down to the retention gate.
    if (opts.adopt) this.number = this.mastery.session;
    else this.number = this.learning.beginSession ? this.learning.beginSession() : this.mastery.beginSession();

    this._statusAtOpen = new Map(this.graph.ids.map((id) => [id, this.mastery.status(id)]));
    this.replan();
    this._planAtStart = this.plan;
    this.opening = this._openingLines();
    this.phase = "open";

    this.save?.openSession({
      number: this.number,
      openedAt: nowMs,
      plannedEvents: this.plan.events,
      plannedItems: this.plan.items,
      plannedMinutes: this.plan.minutes,
      paceAtOpen: { ...this.pace },
    });

    this.emit("learn:session", { phase: "plan", summary: this._summary("plan") });
    this.emit("learn:session", { phase: "open", summary: this._summary("open") });
    return this.plan;
  }

  /**
   * Re-entry, in the world's voice. It reports what the field looks like — open working, claims
   * that have drifted, certainties that hold — and never what the learner did or how well.
   * §5 of `design/voice.md` is unambiguous: nobody in the Margin has an opinion about you.
   */
  _openingLines() {
    const m = this.mastery;
    const out = [];
    const last = this.save?.lastSession() ?? null;
    const open = m.inFlight.filter(Boolean);
    const s = m.summary();
    const due = m.probe().dueNow;

    if (open.length) out.push({ ...line("sys.session.open.working"), refs: open.map((id) => `kp.${id}.title`) });
    else if (!last) out.push(line("sys.session.open.first"));

    const grey = this.graph.ids.filter((id) => {
      const st = m.stateOf(id);
      return st.everMastered && st.status !== "mastered";
    });
    if (grey.length) out.push({ ...line("sys.session.open.grey", { n: grey.length }), refs: grey.slice(0, 3).map((id) => `kp.${id}.title`) });
    if (s.mastered > 0) out.push(line("sys.session.open.set", { n: s.mastered }));
    if (due > 0) out.push(line("sys.session.open.due", { n: due }));
    // The world does not nag. Three lines is the whole re-entry.
    return out.slice(0, 3);
  }

  // -------------------------------------------------------------------------- work

  /**
   * The next request, or null when the sitting is over. **A null answer here always arrives at a
   * beat boundary** — see `_admit`.
   */
  next() {
    if (!this.learning) return null;
    if (this.phase === "closed" || this.phase === "dormant") return null;
    if (this.phase === "idle") this.begin();

    const nowMs = this.now();
    this._settle(nowMs);

    /**
     * The ceiling, enforced between claims and never inside one.
     *
     * A block is a continuity preference (§4 step 2), so stopping it at an item boundary simply
     * ends it. A certification event is different, and the difference is worth stating exactly,
     * because getting it wrong lapses a node the learner did nothing wrong on:
     *
     *   - **Abandoning** an event is a lapse. `Scheduler.abandonEvent` says so, and it is right:
     *     otherwise "walk away when it is going badly and come back for a fresh check" is a
     *     strategy.
     *   - **Carrying** one is not. `Scheduler.beginSession` is explicit that a half-answered check
     *     is NOT dropped at a session boundary, because §3's gate is about elapsed time and
     *     intervening sessions, not about finishing inside one sitting. `Mastery.snapshot()`
     *     persists the open event and the Scheduler serves its remaining items before anything
     *     else next time.
     *
     * So an event that meets the ceiling is left standing exactly where it is, and resumed. The
     * learner loses nothing — no lapse, no M2 dock, no re-roll — and the alternative, taking the
     * claim off the table mid-thought to make a clock look tidy, is what this layer exists to
     * refuse. `review/measure/P33.mjs` counts carries and checks that they cost no lapses.
     */
    if (this.beat && !this.beat.done && this.elapsedSeconds + this.itemSecondsCeiling() > this.arc.maxMinutes * 60) {
      this._closeBeat(this.beat.atomic ? "carried" : "closed-at-item");
    }

    const beatOpen = this.beat != null && !this.beat.done;
    if (!beatOpen) {
      const verdict = this._admit();
      if (!verdict.admit) {
        this.close(verdict.reason);
        return null;
      }
    }

    this._syncEngineBudget(beatOpen);
    const req = this.scheduler.next();
    if (!req) {
      // The engine has nothing legal to offer. That is a real answer, not a timer cut, and it
      // cannot land inside an atomic event: `_syncEngineBudget` has just written a budget that
      // covers the open event's remaining items, and `Scheduler.next()` serves those before it
      // consults anything else. `engine-empty-mid-event` is therefore an anomaly channel — if it
      // ever appears in a run, something upstream changed and this claim needs re-measuring.
      const midEvent = this.beat != null && !this.beat.done && this.beat.atomic;
      this.close(midEvent ? "engine-empty-mid-event" : "no-work");
      return null;
    }

    // Fold the request into the beat. The engine may pre-empt an acquisition block with a due
    // event; an item boundary inside a block is a safe place for that, an atomic event is not,
    // and the Scheduler never interleaves one.
    const sameBeat =
      this.beat && !this.beat.done && this.beat.kpId === req.kpId && this.beat.kind === req.mode;
    if (!sameBeat) {
      if (this.beat && !this.beat.done) this._closeBeat("preempted");
      this.beat = {
        index: this.beats.length,
        kind: req.mode,
        kpId: req.kpId,
        atomic: req.mode !== "acquire",
        items: req.mode === "acquire" ? this.blockLength : (req.itemsInEvent ?? MAX_EVENT_ITEMS),
        served: 0,
        stood: 0,
        done: false,
        end: null,
        startedAt: nowMs,
        phases: [],
      };
    }

    this.beat.served += 1;
    this.beat.phases.push(req.phase);
    if (this.startedAt == null) {
      this.startedAt = nowMs;
      this._mark = nowMs;
      this.attendedMs = 0;
      this.phase = "work";
    }
    if (this._lastSubmitAt != null) this._calibrateGap(nowMs - this._lastSubmitAt - this._awayThisItem);
    this._servedAt = nowMs;
    this._awayThisItem = 0;
    this._req = req;
    // The start guarantee, counted rather than asserted: no item is ever SERVED unless it is
    // expected to finish inside the ceiling. A response that then takes longer than any response
    // this learner has ever given is the learner still working, and taking the claim away from
    // them mid-thought is the one thing this layer will not do. `review/measure/P33.mjs` reports
    // this counter and the residual overrun separately, so the two are never confused.
    if (this.elapsedSeconds + this.itemSecondsCeiling() > this.arc.maxMinutes * 60) this.stats.startsOutsideCeiling += 1;
    return req;
  }

  /**
   * Score the response through the engine, then decide whether the beat has ended.
   *
   * @param {object} req the request `next()` returned
   * @param {object} outcome `{ correct, latencyMs?, hinted?, itemId?, ... }` — passed straight
   *        through to `Scheduler.submit`, which is the only thing allowed to score it.
   */
  submit(req, outcome) {
    if (!this.learning || !this.beat) return null;
    const nowMs = this.now();
    this._settle(nowMs);

    const itemMs = this._servedAt == null ? 0 : Math.max(0, nowMs - this._servedAt - this._awayThisItem);
    // An item the learner walked away from is not evidence about their pace.
    if (itemMs > 0 && this._awayThisItem === 0) this._calibrate(req, itemMs);
    this._awayThisItem = 0;
    this._servedAt = null;
    this._lastSubmitAt = nowMs;

    const before = this.mastery.status(req.kpId);
    const result = this.scheduler.submit(req, outcome);
    const after = this.mastery.status(req.kpId);

    this.itemsServed += 1;
    this.tally.items += 1;
    if (outcome?.correct) this.tally.stood += 1;
    else this.tally.fell += 1;
    if (result && result.scored === false) this.tally.unscored += 1;
    if (outcome?.correct) this.beat.stood += 1;
    if (before !== after) {
      if (after === "provisional" && before === "learning") this.tally.set.push(req.kpId);
      if (after === "mastered") this.tally.certified.push(req.kpId);
      if (before === "mastered" && after === "learning") this.tally.lapsed.push(req.kpId);
    }

    // Beat completion. An atomic event ends when its items are spent; a block ends at its length,
    // or early if the node left `learning` (the Scheduler drops the block then too).
    const done = this.beat.atomic
      ? this.beat.served >= this.beat.items
      : this.beat.served >= this.beat.items || this.mastery.status(this.beat.kpId) !== "learning";
    if (done) this._closeBeat("complete");
    return result;
  }

  _closeBeat(end) {
    if (!this.beat || this.beat.done) return;
    this.beat.done = true;
    this.beat.end = end;
    if (end === "closed-at-item") this.stats.beatsClosedAtItem += 1;
    if (end === "carried") this.stats.eventsCarried += 1;
    this.beat.seconds = round2(this.elapsedSeconds - (this.beats.reduce((a, b) => a + (b.seconds ?? 0), 0) || 0));
    this.beats.push(this.beat);
    this.replan();
    this.save?.checkpoint({
      beats: this.beats.length,
      items: this.itemsServed,
      elapsedSeconds: Math.round(this.elapsedSeconds),
      pace: { ...this.pace },
    });
    this.emit("learn:session", { phase: "beat", summary: this._summary("beat") });
  }

  /**
   * Admission — the only place the arc is enforced, and it only ever runs at a beat boundary.
   *
   * The reservation is the worst case the engine could hand back next, priced at this learner's
   * high quantile: four items if a certification event could come up, otherwise a block. Knowing
   * WHICH is a read of published state (`dueNow`, `frontier`, `status`), not a re-implementation
   * of §4's selection.
   */
  _admit() {
    const elapsed = this.elapsedSeconds;
    const min = this.arc.minMinutes * 60;
    const max = this.arc.maxMinutes * 60;
    const target = this.targetSeconds();

    if (this._breakPending && this.itemsServed > 0) return { admit: false, reason: "break" };

    const m = this.mastery;
    const acquirable = m.frontier().filter((id) => m.status(id) === "learning" && m.masteryFormsFor(id).length > 0);
    const nowMin = m.now();
    let dueNow = 0;
    for (const id of this.graph.ids) {
      const s = m.stateOf(id);
      if (Number.isFinite(s.nextEventAt) && s.nextEventAt <= nowMin) dueNow += 1;
    }
    // An event can only be next if something is due, or if the acquisition pool is empty and the
    // pull-forward rule (§4.1) is about to reach for the soonest scheduled one.
    const couldBeEvent = dueNow > 0 || acquirable.length === 0;
    const worstItems = couldBeEvent ? MAX_EVENT_ITEMS : this.blockLength;
    const worstSeconds = this.beatSecondsHigh(worstItems);
    const fitsWorst = elapsed + worstSeconds <= max;
    // The FIRST item of a beat is the one no interior check protects, so it is gated at the same
    // quantile the interior check uses. Gating it at the ordinary high estimate is how a slow
    // learner started a block at 22.4 minutes and finished it at 25.5.
    const fitsOne = elapsed + this.itemSecondsCeiling() <= max;

    // The ceiling, and it is the only hard gate: nothing is started that cannot close one more
    // claim inside it.
    if (!fitsOne) return { admit: false, reason: elapsed >= min ? "arc-complete" : "ceiling-guard" };

    // A sitting that has not reached the floor keeps going, whatever else is true. Reserving a
    // whole four-item check here instead is what ended a slow learner's sitting at fourteen
    // minutes: the guard refused work there was room for, to avoid a carry that costs nothing.
    if (elapsed < min) return { admit: true, reason: "floor" };

    // Past the floor the reservation shapes the ENDING rather than gating it: do not start a beat
    // that will not finish, because a beat carried into tomorrow is a weaker ending than a beat
    // that ran out of items. Below the floor the same rule would be a worse trade, which is why
    // it sits after the floor and not before it.
    if (!fitsWorst) return { admit: false, reason: "arc-complete" };

    // Closing window: never OPEN a knowledge point the learner has not met. That beat begins with
    // a `model` item — the world performing the algebra — and a sitting that ends on a
    // demonstration ends on somebody else's win.
    const warm = acquirable.filter((id) => m.stateOf(id).attempts > 0);
    const nearEnd = elapsed + worstSeconds > target;
    if (nearEnd && !couldBeEvent && warm.length === 0) return { admit: false, reason: "no-closing-win" };

    if (elapsed >= target) return { admit: false, reason: "arc-complete" };
    // The budget is in beats: when the live plan has nothing left ahead of it and the floor is
    // behind us, the sitting is done, whatever the clock says.
    if (this.plan && this.plan.ahead && this.plan.ahead.events === 0) return { admit: false, reason: "plan-complete" };
    return { admit: true, reason: "in-arc" };
  }

  /**
   * Keep the engine's own time box in agreement with this layer's, so the two authorities can
   * never disagree about when a sitting ends.
   *
   * `Scheduler.secondsSpent` counts DESIGN seconds; `sessionMinutes` is the budget it compares
   * them against. Writing a headroom that always covers the open beat is what guarantees the
   * engine cannot return null in the middle of a retention check — the failure mode the fixed
   * 25-minute box produces on its own, and which `review/measure/P33.mjs` measures in its
   * baseline arm.
   */
  _syncEngineBudget(beatOpen) {
    const sch = this.scheduler;
    if (!sch) return;
    const remainingInBeat = beatOpen && this.beat ? Math.max(0, this.beat.items - this.beat.served) : 0;
    const headroom = (remainingInBeat + (beatOpen ? 0 : MAX_EVENT_ITEMS) + 1) * REFERENCE_ITEM_SECONDS;
    sch.sessionMinutes = (sch.secondsSpent + headroom) / 60;
  }

  // ------------------------------------------------------------------------- close

  close(reason = "closed") {
    if (this.phase === "closed" || this.phase === "dormant") return this._summary("close");
    const nowMs = this.now();
    this._settle(nowMs);
    // Nothing is ever abandoned here. An open beat at this point can only be a block the learner
    // stopped inside, and a block is not atomic; an atomic event is never left open, because
    // `_admit` is the only path to `close` and it runs at boundaries.
    if (this.beat && !this.beat.done) this._closeBeat("stopped");

    this.closeReason = reason;
    this.phase = "closed";
    this.closing = this._closingLines();
    this.pace.spread = Math.sqrt(Math.max(0, this._var));
    this.save?.savePace(this.pace);
    this.save?.closeSession({
      number: this.number,
      closedAt: nowMs,
      closeReason: reason,
      minutes: round2(this.elapsedSeconds / 60),
      items: this.itemsServed,
      beats: this.beats.length,
      certified: [...this.tally.certified],
      set: [...this.tally.set],
      pace: { ...this.pace },
    });

    if (this.learning?.endSession) this.learning.endSession();
    else this.mastery?.endSession();

    this.emit("learn:session", { phase: "close", summary: this._summary("close") });
    return this._summary("close");
  }

  /**
   * The close, in the world's voice. An honest report of what is now true in the field, and never
   * a report card: no percentage, no comparison, no praise, no verdict on the learner.
   */
  _closingLines() {
    const out = [];
    if (this.tally.certified.length)
      out.push({
        ...line("sys.session.close.set", { n: this.tally.certified.length }),
        refs: this.tally.certified.map((id) => `kp.${id}.title`),
      });
    if (this.tally.set.length) out.push(line("sys.session.close.rung"));
    const last = this.beats[this.beats.length - 1];
    if (!this.tally.certified.length && !this.tally.set.length) {
      if (last && last.stood > 0) out.push(line("sys.session.close.stood"));
      else if (this.itemsServed > 0) out.push(line("sys.session.close.open"));
    }
    if (this.closeReason === "no-work") out.push(line("sys.session.close.quiet"));
    else out.push(line("sys.session.close.rest"));
    return out.slice(0, 3);
  }

  /** What kind of ending this was, as a fact about the last beat. Never a compliment. */
  get closingWin() {
    const last = this.beats[this.beats.length - 1] ?? null;
    if (!last) return "none";
    if (this.tally.certified.length) return "certified";
    if (this.tally.set.length) return "set";
    if (last.end !== "complete") return "stopped";
    return last.stood > 0 ? "stood" : "held";
  }

  // ------------------------------------------------------------------------ driving

  /**
   * Convenience loop for a caller that has a presenter. `present(req)` puts the item in the world
   * and resolves with the outcome `Scheduler.submit` wants. Returns the close summary.
   */
  async run(present, { maxItems = 500 } = {}) {
    if (!this.learning) return null;
    if (this.phase === "idle") this.begin();
    for (let i = 0; i < maxItems; i += 1) {
      const req = this.next();
      if (!req) break;
      // eslint-disable-next-line no-await-in-loop
      const outcome = await present(req);
      if (!outcome) {
        this.close("presenter-gave-up");
        break;
      }
      this.submit(req, outcome);
    }
    if (this.phase !== "closed") this.close("max-items");
    return this._summary("close");
  }

  // ------------------------------------------------------------------------- report

  _summary(phase) {
    const elapsed = this.elapsedSeconds;
    const m = this.mastery;
    return {
      phase,
      number: this.number,
      minutes: round2(elapsed / 60),
      items: this.itemsServed,
      beats: this.beats.length,
      planned: this.plan ? { events: this.plan.events, items: this.plan.items, minutes: this.plan.minutes } : null,
      stood: this.tally.stood,
      fell: this.tally.fell,
      certified: [...this.tally.certified],
      set: [...this.tally.set],
      lapsed: [...this.tally.lapsed],
      level1Percent: m ? m.summary().level1Percent : null,
      closeReason: this.closeReason,
      closingWin: this.phase === "closed" ? this.closingWin : null,
      lines: phase === "close" ? this.closing : phase === "open" ? this.opening : [],
    };
  }

  /**
   * The `session` probe. Everything the brief names — planned, elapsed, remaining, the current
   * beat, the close reason — plus the two numbers that let a reviewer check the claim rather than
   * read it: the measured pace the budget was built from, and how closely what the engine served
   * matched what this layer forecast.
   */
  probe() {
    if (!this.learning) return { phase: "dormant", reason: "no learning system mounted", planned: null, remaining: null };
    const elapsed = this.elapsedSeconds;
    const plan = this.plan ?? { events: 0, items: 0, minutes: 0, beats: [], ahead: { events: 0, items: 0, seconds: 0 } };
    const doneItems = this.itemsServed;
    const ahead = plan.ahead ?? { events: 0, items: 0, seconds: 0 };

    // Forecast against reality: of the beats actually served, how many matched the plan's
    // (kind, kpId) multiset. Item SELECTION is P16's; this number says how good a forecast made
    // from §4's law is, and it is reported whether it flatters this layer or not.
    const want = new Map();
    for (const b of (this._planAtStart?.beats ?? [])) {
      const k = `${b.kind}|${b.kpId}`;
      want.set(k, (want.get(k) ?? 0) + 1);
    }
    let matched = 0;
    for (const b of this.beats) {
      const k = `${b.kind}|${b.kpId}`;
      if ((want.get(k) ?? 0) > 0) {
        want.set(k, want.get(k) - 1);
        matched += 1;
      }
    }

    return {
      phase: this.phase,
      number: this.number,
      arc: { ...this.arc },
      planned: {
        events: plan.events,
        items: plan.items,
        minutes: plan.minutes,
        perItemSeconds: plan.perItemSeconds ?? null,
        shortfall: plan.shortfall ?? false,
        beats: (plan.beats ?? []).slice(0, 12),
      },
      elapsed: {
        seconds: Math.round(elapsed),
        minutes: round2(elapsed / 60),
        items: doneItems,
        beats: this.beats.length,
        awaySeconds: Math.round(this.awayMs / 1000),
      },
      remaining: {
        /** Beats still forecast — the budget's own currency. */
        events: ahead.events,
        items: ahead.items,
        /** Their cost at this learner's measured pace, which is what "remaining" has to mean. */
        seconds: ahead.seconds ?? 0,
        minutes: round2((ahead.seconds ?? 0) / 60),
        /** How much of the arc's target is left on the clock, regardless of what fits in it. */
        arcSeconds: Math.max(0, Math.round(this.targetSeconds() - elapsed)),
      },
      beat: this.beat
        ? {
            index: this.beat.index,
            kind: this.beat.kind,
            kpId: this.beat.kpId,
            atomic: this.beat.atomic,
            served: this.beat.served,
            items: this.beat.items,
            done: this.beat.done,
            end: this.beat.end,
          }
        : null,
      closeReason: this.closeReason,
      closingWin: this.phase === "closed" ? this.closingWin : null,
      pace: {
        ratio: round4(this.pace.ratio),
        spread: round4(this.pace.spread),
        gapSeconds: round2(this.pace.gapSeconds),
        samples: this.pace.samples,
        secondsPerItem: round2(this.itemSeconds()),
        secondsPerItemHigh: round2(this.itemSecondsHigh()),
        secondsPerItemCeiling: round2(this.itemSecondsCeiling()),
        source: this.pace.samples > 0 ? "measured" : "design-default",
      },
      adherence: {
        plannedBeats: this._planAtStart?.beats?.length ?? 0,
        servedBeats: this.beats.length,
        matched,
        note: "item selection is P16's (§4); this layer plans the mix and the size and admits beats",
      },
      tally: { ...this.tally },
      /**
       * The start guarantee, and what it cost. `startsOutsideCeiling` must be 0: no item is ever
       * served that is not expected to finish inside the ceiling. `beatsClosedAtItem` is how often
       * a block was stopped at an item boundary because the ceiling came into view — a completed
       * claim, never a cut one.
       */
      stats: { ...this.stats },
      stats: { ...this.stats },
      lines: { opening: this.opening, closing: this.closing },
      save: this.save ? this.save.probe() : null,
    };
  }
}
