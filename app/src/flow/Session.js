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
 *   - a certification event — consolidation (2 items), a retention check (4), a review (2);
 *   - an acquisition block — up to `Scheduler.blockLength` items on one knowledge point, §4 step 2.
 *
 * **The clock never cuts a claim.** It decides whether the next BEAT is admitted, and admission is
 * where the whole 15–25 arc is enforced: a beat is admitted only if its cost, priced at this
 * learner's own high quantile, still lands under the ceiling. Nothing is ever served that is not
 * expected to close one more claim inside 25 minutes; `probe().stats.startsOutsideCeiling` is that
 * invariant, counted rather than asserted, and `review/measure/P33.mjs` reports it.
 *
 * When the ceiling arrives anyway — a learner who stops to think for four minutes on an item they
 * usually answer in twenty seconds — the stop happens BETWEEN claims, and what happens next
 * depends on the beat. A block simply ends; it is a continuity preference, not a unit. A
 * certification event is **carried**, not abandoned, and the difference is the whole of §3:
 * `Scheduler.abandonEvent` lapses the node and docks its M2 counters, because otherwise "walk away
 * when it is going badly and come back for a fresh check" is a strategy — while
 * `Scheduler.beginSession` is explicit that a half-answered check is NOT dropped at a session
 * boundary, since the retention gate is about elapsed time and intervening sessions rather than
 * about finishing inside one sitting. `Mastery.snapshot()` persists it and the Scheduler serves its
 * remaining items first next time. Measured over 2 400 simulated sittings: 16 carries, 0 lapses
 * caused by one, 0 items lost.
 *
 * So the last beat is a completed beat in all but a handful of sittings, `closeReason` says which
 * kind of ending it was, and `closingWin` says what the learner was left holding. If time is
 * nearly up and the only work left would OPEN a knowledge point they have never met — an item
 * where the world performs the algebra and the learner makes the last move — the sitting closes
 * instead. Ending on a demonstration is ending on somebody else's win.
 *
 * ---------------------------------------------------------------------------------------------
 * WORK -> BREAK -> WORK. THE BREAK IS A HINGE, NOT A TERMINUS
 *
 * A Pomodoro is a cycle. Round 1 of this file shipped only the first half of it: an away gap past
 * `arc.breakMinutes` latched `_breakPending`, `_admit` tested that latch BEFORE the fifteen-minute
 * floor, and the only way to get a second sitting was to reload the page. Two things were wrong
 * with that and both are fixed here.
 *
 *   1. **The floor outranks the break.** A bathroom trip at minute one does not break a fifteen
 *      minute promise. Below `arc.minMinutes` the latch is CLEARED and the sitting carries on: the
 *      learner came back. At or past the floor the same gap ends the sitting at the next beat
 *      boundary — which is the whole of "a break genuinely ends a session", and is band-safe by
 *      construction, because the earliest it can fire is the floor itself.
 *   2. **The next sitting is one method call away.** `resumable` is true exactly when this sitting
 *      ended on a break; `resume()` opens the next arc on the same object, incrementing the
 *      engine's own session counter so §3's "one intervening session" gate advances honestly.
 *      `close()` emits `learn:session {phase:"break"}` alongside the close so a HUD can offer it,
 *      and `boot/90-flow.js` arms it on the next `visibilitychange` back to visible.
 *      `probe().cycle.sittings` counts how many sittings one page load actually completed, and
 *      `review/measure/P33.mjs` reports that distribution rather than assuming it is one.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT THIS FILE DOES NOT DO — AND THE SECOND SELECTION POLICY THAT USED TO LIVE HERE
 *
 * It does not choose items, and it does not choose knowledge points. §4 of
 * `design/learning-architecture.md` is the law for that and `learn/Scheduler.js` implements it:
 * due events first under the one-in-three cap, then the continuity block, then the frontier
 * score. This layer plans the **size** of a sitting — how much of the legal work fits in this
 * learner's own twenty minutes — and then admits or refuses beats at the boundary.
 *
 * Round 1 also carried a `LEVERAGE` table: a second ordering, in Level-1-certifications-bought,
 * over the same candidates. It is gone, and its removal is the honest resolution of a defect
 * rather than a simplification. `Scheduler` publishes no `focus(kpId)` affordance, and this layer
 * writes exactly one thing to it (`sessionMinutes`, in `_syncEngineBudget`) — so the table ordered
 * a forecast and nothing else, the forecast matched only 41% of the beats actually served, and
 * `plan-complete` — an ending derived from that forecast — decided over half of all sittings.
 * A 41%-accurate forecast is not allowed to end a Pomodoro.
 *
 * So `candidates()` now mirrors §4's OWN order — `_dueQueue`'s due-time sort, then the frontier
 * score with the same five terms and the same two-open cap — because a forecast that fights the
 * law it is forecasting is not a forecast; and `_admit` no longer consults the forecast at all.
 * The ending is decided by three order-free facts: what one more beat could cost at this learner's
 * own high quantile, where the floor is, and whether the next beat can finish before the aim.
 * `probe().adherence` still reports forecast against reality, and it is reported whether it
 * flatters this layer or not.
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
import { freshPace } from "./Save.js";

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
  "sys.session.open.back": "The slab is where it was.",
  "sys.session.open.grey": "{n} claims have gone grey.",
  "sys.session.open.set": "{n} certainties hold from before.",
  "sys.session.open.due": "{n} claims are ready to be set.",
  "sys.session.close.set": "{n} certainties set. They will not drift.",
  "sys.session.close.stood": "The last claim stands.",
  "sys.session.close.open": "The claim is still standing open.",
  "sys.session.close.rung": "Rung.",
  "sys.session.close.rest": "The light is going. The field rests.",
  "sys.session.close.quiet": "Nothing is standing open here.",
  /** The break. Not an ending — the field is still there when the learner looks back. */
  "sys.session.close.keep": "The field will keep. Nothing drifts yet.",
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
    // Merged over the defaults rather than copied, so a save written by an older build (no
    // `slowRatio`) yields a usable estimator instead of `undefined` in the ceiling arithmetic.
    this.pace = { ...freshPace(), ...(this.save?.pace ?? {}) };
    this._var = this.pace.spread * this.pace.spread;

    // --- the cycle: work -> break -> work, counted per page load ----------------------------
    /** Sittings CLOSED on this object. `boot/90-flow.js` builds one per page load. */
    this.sittings = 0;
    /** How many of those were opened by `resume()` rather than by a fresh page. */
    this.resumes = 0;
    this._resumedFrom = null;

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
    this.stats = { startsOutsideCeiling: 0, beatsClosedAtItem: 0, eventsCarried: 0, nextBeatCalled: 0, nextBeatHit: 0 };
    /** The head of the live plan, checked against the beat the engine actually opens next. */
    this._nextForecast = null;
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
   * usually costs. Nothing bounds a single response from above — a learner may put the tablet down
   * — so this is an honest start guarantee (nothing is STARTED that is not expected to finish
   * inside the ceiling), not an arithmetic impossibility proof.
   *
   * It takes the LARGER of two estimates and that is the round-2 fix:
   *
   *   - `ratio + 5·spread`, a moment estimate. It is fine for a learner whose slow items are a
   *     stretched version of their fast ones, and it under-reads a heavy tail badly, because a
   *     tail that is rare barely moves an EWMA variance.
   *   - `slowRatio`, an **observed** upper quantile of this learner's own item ratios, tracked
   *     online in `_calibrate` and persisted by `flow/Save.js`. It is a fact about the tail rather
   *     than an inference from the middle. On the learner that overran the ceiling by 3.27 minutes
   *     in round 1 — ~92 s an item — the moment estimate read the four-item retention check at
   *     roughly what four typical items cost; the observed quantile does not.
   */
  itemSecondsCeiling(phaseSeconds = REFERENCE_ITEM_SECONDS) {
    const moments = (this.pace.ratio + 5 * this.pace.spread) * phaseSeconds + this.pace.gapSeconds;
    const observed = (this.pace.slowRatio ?? 2) * phaseSeconds + this.pace.gapSeconds;
    return clamp(Math.max(moments, observed), this.itemSecondsHigh(phaseSeconds), 8 * this.itemSeconds(phaseSeconds));
  }

  /**
   * What a beat of `items` items could plausibly cost.
   *
   * NOT `items × itemSecondsHigh()`. The high quantile of a SUM is not the sum of high quantiles —
   * four items each at their own p90 is a p99.99 for the group, and reserving that much is what
   * made a slow learner's sitting end at nine minutes because a four-item check "would not fit" in
   * fifteen.
   *
   * But round 1's `items × itemSeconds + 2√items · sd` was a Gaussian-sum assumption all the way
   * through, and an atomic beat is exactly where that assumption is most expensive: the beat cannot
   * be stopped, so the ONE long response inside it is not a risk to be averaged, it is the thing
   * that decides whether the beat fits. So the last item of the beat is priced at
   * `itemSecondsCeiling()` — what a single response could plausibly cost — and only the other
   * `n-1` are pooled. The reservation is then "n-1 ordinary items, plus one item that goes long",
   * which is the failure this gate exists to survive.
   */
  beatSecondsHigh(items) {
    const n = Math.max(1, items);
    if (n === 1) return this.itemSecondsCeiling();
    const sd = this.pace.spread * REFERENCE_ITEM_SECONDS;
    return (n - 1) * this.itemSeconds() + 2 * Math.sqrt(n - 1) * sd + this.itemSecondsCeiling();
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
    this._calibrateTail(clamp(itemMs / 1000 / modelled, 0.05, 12));
  }

  /**
   * The observed upper quantile of this learner's item ratios — the number `itemSecondsCeiling`
   * reserves on, and the round-2 answer to a heavy tail that a variance could not see.
   *
   * Robbins–Monro on the quantile: step UP by `η·p` when an item comes in above the estimate, DOWN
   * by `η·(1−p)` when it comes in below, so the fixed point is the p-quantile whatever the shape of
   * the distribution. `p = 0.95`, and the step is multiplicative (`η ∝ q`) so one estimator works
   * for a learner at nine seconds an item and a learner at ninety.
   *
   * The **raw** ratio is fed in on purpose. `_calibrate` winsorises at 2.5× before it moves the
   * central estimate, because one item somebody walked away from mid-thought is not a fact about
   * how fast they work — but it IS a fact about how long a single response can take, and that is
   * precisely what this number is for. Floored at `pace.ratio`, so the worst case is never read as
   * cheaper than the typical case.
   */
  _calibrateTail(rawRatio) {
    const q = this.pace.slowRatio ?? 2;
    const eta = 0.12 * Math.max(0.25, q);
    const moved = q + eta * (rawRatio > q ? 0.95 : -0.05);
    this.pace.slowRatio = clamp(moved, this.pace.ratio, 12);
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

  /**
   * Every beat the engine could legally serve, **in the order §4 will serve them**.
   *
   * Three queues, matching `Scheduler._choose()` step for step, and the fidelity is the whole
   * point: round 1 ordered these by a leverage table of its own invention, the engine ignored it
   * (there is nothing to ignore it WITH — no `focus(kpId)` affordance exists), and the resulting
   * forecast matched 41% of the beats served. A forecast is either a model of the law or it is
   * decoration.
   *
   *   - `due`   — `_dueQueue`'s exact contents: a finite `nextEventAt` at or before now, mode from
   *               `_modeFor`, a retention check filtered out until BOTH halves of §3's gate open,
   *               sorted by due time then id.
   *   - `acquire` — the frontier, minus nodes the bank audit left with no scorable form, minus the
   *               two-open cap, scored with §4's own five-term frontier score including the
   *               continuity term (read off `scheduler.inFlight`, which is published state).
   *   - `soon`  — the pull-forward queue (§4.1), which the engine reaches for ONLY when there is
   *               nothing to acquire. Disjoint from `due` by construction.
   *
   * Everything here is a read of published state. Nothing reaches into the Scheduler's privates.
   */
  candidates() {
    const m = this.mastery;
    if (!m) return { due: [], acquire: [], soon: [] };
    const g = this.graph;
    const now = m.now();
    const sp = m.M.spacing;

    const modeFor = (id) => {
      const s = m.stateOf(id);
      if (s.status === "mastered") return "review";
      return s.consolidated ? "retention" : "consolidate";
    };
    const itemsFor = (mode) =>
      mode === "consolidate" ? sp.consolidation.items : mode === "retention" ? sp.retentionCheck.items : sp.review.items;

    /** `Scheduler._dueQueue` when `dueOnly`; the strictly-future tail of `_eligibleQueue` when not. */
    const queue = (dueOnly) => {
      const out = [];
      for (const id of g.ids) {
        const s = m.stateOf(id);
        if (!Number.isFinite(s.nextEventAt)) continue;
        if (dueOnly ? s.nextEventAt > now : s.nextEventAt <= now) continue;
        const mode = modeFor(id);
        if (mode === "retention" && !this._retentionReady(id, now)) continue;
        out.push({ kind: mode, kpId: id, items: itemsFor(mode), atomic: true, at: s.nextEventAt });
      }
      out.sort((a, b) => a.at - b.at || (a.kpId < b.kpId ? -1 : 1));
      return out;
    };

    let pool = m.frontier().filter((id) => m.status(id) === "learning" && m.masteryFormsFor(id).length > 0);
    // §4: at most two nodes may be in `learning` at once.
    const openNow = g.ids.filter((id) => {
      const s = m.stateOf(id);
      return s.status === "learning" && s.attempts > 0;
    });
    if (openNow.length >= 2) {
      const capped = pool.filter((id) => openNow.includes(id));
      if (capped.length) pool = capped;
    }
    const target = m.theta + m.M.ability.acquisitionTargetOffset;
    const inFlight = this.scheduler?.inFlight ?? null;
    const acquire = pool
      .map((id) => {
        const s = m.stateOf(id);
        const fit = Math.exp(-((g.centre(id) - target) ** 2) / (2 * 0.7 ** 2));
        const reach = g.descendants(id).size / g.maxDescendants;
        const fresh = 1 - Math.min(1, s.attempts / 12);
        const cont = id === inFlight ? 1 : 0;
        return {
          kind: "acquire",
          kpId: id,
          items: this.blockLength,
          atomic: false,
          frontierScore: 0.4 * fit + 0.3 * reach + 0.15 * fresh + 0.15 * cont,
        };
      })
      .sort((a, b) => b.frontierScore - a.frontierScore || (a.kpId < b.kpId ? -1 : 1));

    return { due: queue(true), acquire, soon: acquire.length ? [] : queue(false) };
  }

  /**
   * Pack the REMAINING budget: which beats, in what order, sized to this learner's own seconds.
   *
   * Re-run at every beat boundary, so `remaining` is a live forecast rather than a number written
   * once at the door and then quietly falsified by a learner who turned out to be twice as fast.
   * The budget is in **beats**; wall clock enters only through `itemSeconds()`, which is measured.
   *
   * The ORDER is §4's, taken whole from `candidates()`. This layer contributes the SIZE — how much
   * of that work fits in this learner's own minutes — and nothing else. It used to contribute an
   * ordering too; see the header for why that is gone.
   */
  replan() {
    const perItem = this.itemSeconds();
    const elapsed = this.elapsedSeconds;
    const budget = Math.max(0, this.targetSeconds() - elapsed);
    const work = this.candidates();

    const ahead = [];
    let items = 0;
    // The cap is a session-wide ratio, so the forecast starts from what has already been served.
    let eventItems = this.beats.filter((b) => b.kind !== "acquire").reduce((a, b) => a + b.served, 0);
    let servedItems = this.itemsServed;
    let di = 0;
    let ai = 0;
    let si = 0;
    let guard = 0;
    // After a block ends, §4 picks the best-scoring frontier node again — and the two-open cap
    // means that is a rotation over at most two nodes, not a walk down the whole frontier.
    const span = Math.min(2, work.acquire.length);
    while (guard++ < 400) {
      const acquisitionRemains = work.acquire.length > 0;
      // The Scheduler's own cap: `reviewItemsThisSession < (itemsThisSession + 1) / 3`, lifted
      // once the frontier is exhausted.
      const underCap = eventItems < (servedItems + 1) / 3;
      let next = null;
      if ((underCap || !acquisitionRemains) && di < work.due.length) next = work.due[di++];
      else if (acquisitionRemains) next = work.acquire[ai++ % span];
      else if (si < work.soon.length) next = work.soon[si++];
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
        /** §4's own frontier score for an acquisition beat; a due time for an event. */
        score: b.frontierScore !== undefined ? round4(b.frontierScore) : null,
        dueAt: b.at ?? null,
      })),
    };
    /**
     * The one horizon on which a forecast of §4 is falsifiable, kept for `next()` to check.
     *
     * The whole-sitting multiset is not that horizon and reporting it as though it were is how
     * round 1 talked itself into a 41% number: a sprinter's sitting is thirty beats long, every
     * acquisition block moves the node's own `attempts` and therefore its frontier score, and the
     * identity of the twenty-fourth beat is not a thing anybody can know at the door. What IS
     * knowable — and what the probe's `remaining` actually rests on — is what the engine will hand
     * back NEXT, from the state that exists now. `stats.nextBeatHit / nextBeatCalled` is that,
     * counted at every beat boundary, and it is the honest test of whether this file models §4 or
     * argues with it.
     */
    this._nextForecast = ahead.length ? { kind: ahead[0].kind, kpId: ahead[0].kpId } : null;
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
    this.stats = { startsOutsideCeiling: 0, beatsClosedAtItem: 0, eventsCarried: 0, nextBeatCalled: 0, nextBeatHit: 0 };
    this._nextForecast = null;

    // `beginSession` is P16's: it increments the session counter and resets the per-node model
    // budget. Calling it here rather than at boot is what makes "a break ends a session" true all
    // the way down to the retention gate.
    if (opts.adopt) this.number = this.mastery.session;
    else this.number = this.learning.beginSession ? this.learning.beginSession() : this.mastery.beginSession();

    this._resumedFrom = this._pendingResumeFrom ?? null;
    this._pendingResumeFrom = null;
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
    // Back from a break is a different re-entry from back the next day: nothing has changed, and
    // saying so is the whole of it. Still no opinion about the learner, still no elapsed time.
    else if (this._resumedFrom === "break") out.push(line("sys.session.open.back"));
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
      // Score the live forecast against what the engine actually opened, once per beat.
      if (this._nextForecast) {
        this.stats.nextBeatCalled += 1;
        if (this._nextForecast.kind === req.mode && this._nextForecast.kpId === req.kpId) this.stats.nextBeatHit += 1;
        this._nextForecast = null;
      }
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

    /**
     * A sitting that has not reached the floor keeps going, whatever else is true. Reserving a
     * whole four-item check here instead is what ended a slow learner's sitting at fourteen
     * minutes: the guard refused work there was room for, to avoid a carry that costs nothing.
     *
     * **And the break latch is cleared here, which is the round-2 fix.** In round 1 the latch was
     * tested at the very top of this method, so a single five-minute absence — at minute one, at
     * minute four, at any point at all — ended the sitting at the very next beat. A promise of
     * fifteen minutes cannot be broken by a bathroom trip: the learner is BACK, the away time never
     * counted against the arc in the first place (`_settle` subtracts it), and the only honest
     * reading of a gap below the floor is that the sitting has not started properly yet.
     */
    if (elapsed < min) {
      this._breakPending = false;
      return { admit: true, reason: "floor" };
    }

    /**
     * Past the floor, an absence longer than `arc.breakMinutes` IS the break, and the break ends
     * the sitting — at a beat boundary, never inside a claim. Because it can now only fire at or
     * past the floor, and because a beat boundary at or past the floor is by construction inside
     * the arc, the break is band-safe: it can end a sitting early inside 15–25, and it can never
     * end one at nine. `boot/90-flow.js` arms the other half of the cycle on the way back in.
     */
    if (this._breakPending && this.itemsServed > 0) return { admit: false, reason: "break" };

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

    /**
     * The aim. Round 1 ended here on `plan.ahead.events === 0` — "the forecast has nothing left" —
     * and that made a 41%-accurate forecast the deciding authority on 54.8% of all sittings. The
     * same decision, taken from facts this layer can actually stand behind: the next beat is
     * `worstItems` items at this learner's measured pace, and if that does not finish before the
     * aim then this beat was the last one. It is order-free — it depends on the SIZE of the next
     * beat, which is fixed by the design, and never on which knowledge point it lands on.
     */
    if (elapsed + worstItems * this.itemSeconds() > target) return { admit: false, reason: "arc-complete" };
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

    this.sittings += 1;
    this.emit("learn:session", { phase: "close", summary: this._summary("close") });
    // The other half of the Pomodoro, announced as its own phase so a HUD can offer the way back
    // in rather than leaving `resume()` with no callers, which is what round 1 shipped.
    if (reason === "break") this.emit("learn:session", { phase: "break", summary: this._summary("break") });
    return this._summary("close");
  }

  /** True exactly when this sitting ended on a break and the next one is waiting to be opened. */
  get resumable() {
    return this.phase === "closed" && this.closeReason === "break";
  }

  /**
   * Open the next sitting of the cycle on this same object — work -> break -> **work**.
   *
   * This is what makes the layer a Pomodoro rather than the first half of one. It runs the full
   * `begin()`: a new engine session (so §3's "one intervening session" gate advances honestly and
   * a retention check cannot be bought by waiting), a fresh plan against whatever the break changed,
   * a fresh arc clock, and the re-entry line. The learner MODEL is untouched — `Mastery` persisted
   * that separately and a half-answered check resumes exactly as P16 designed it to.
   *
   * Returns the new plan, or null when there was no closed sitting to resume from.
   */
  resume(reason = "resumed") {
    if (this.phase !== "closed") return null;
    this.lastResumeReason = reason;
    this._pendingResumeFrom = this.closeReason;
    this.phase = "idle";
    const plan = this.begin();
    if (plan) this.resumes += 1;
    return plan;
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
    // A break is not the end of the day, and the closing line must not sound like one.
    else if (this.closeReason === "break") out.push(line("sys.session.close.keep"));
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
        /** The observed upper quantile the ceiling reserves on. See `_calibrateTail`. */
        slowRatio: round4(this.pace.slowRatio ?? 2),
        gapSeconds: round2(this.pace.gapSeconds),
        samples: this.pace.samples,
        secondsPerItem: round2(this.itemSeconds()),
        secondsPerItemHigh: round2(this.itemSecondsHigh()),
        secondsPerItemCeiling: round2(this.itemSecondsCeiling()),
        source: this.pace.samples > 0 ? "measured" : "design-default",
      },
      /** work -> break -> work, per page load. `resumable` is the HUD's cue to offer the way back. */
      cycle: {
        sittings: this.sittings,
        resumes: this.resumes,
        resumable: this.resumable,
        resumedFrom: this._resumedFrom,
        breakPending: this._breakPending,
        breakMinutes: this.arc.breakMinutes,
      },
      adherence: {
        /** The falsifiable one: did the live plan name the beat the engine opened next? */
        nextBeatCalled: this.stats.nextBeatCalled,
        nextBeatHit: this.stats.nextBeatHit,
        nextBeatRate: this.stats.nextBeatCalled ? round4(this.stats.nextBeatHit / this.stats.nextBeatCalled) : null,
        /** The weak one, kept because deleting an unflattering number is how a claim rots. */
        plannedBeats: this._planAtStart?.beats?.length ?? 0,
        servedBeats: this.beats.length,
        matched,
        /** How close the SIZE was — which is the thing this layer actually decides. */
        plannedMinutes: this._planAtStart?.minutes ?? null,
        actualMinutes: round2(elapsed / 60),
        note: "item selection is P16's (§4); this layer forecasts §4's own order and sizes the sitting",
      },
      tally: { ...this.tally },
      /**
       * The start guarantee, and what it cost. `startsOutsideCeiling` must be 0: no item is ever
       * served that is not expected to finish inside the ceiling. `beatsClosedAtItem` is how often
       * a block was stopped at an item boundary because the ceiling came into view — a completed
       * claim, never a cut one.
       */
      stats: { ...this.stats },
      lines: { opening: this.opening, closing: this.closing },
      save: this.save ? this.save.probe() : null,
    };
  }
}
