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
    /**
     * ------------------------------------------------------------------------------------------
     * THE BANK, AND WHY HOLDING IT IS THE WHOLE ROUND-3 FIX.
     *
     * `serve()` has existed since round 2 and had ZERO callers anywhere in `app/`. It honours
     * `avoidFamilies` and remembers which generator family it handed out, which is the only way the
     * engine can price 24 of the bank's 96 cells at all — and the shipped loop
     * (`boot/62-learning.js` -> `flow/Session.js`) went straight from `next()` to `submit()` with no
     * picker in between and no `outcome.family`. Every response on those 24 cells was therefore
     * silently unscored, the selector re-served the same refused form forever, and the curriculum
     * deadlocked on `var-meaning` after 228 items.
     *
     * The fix is not a doc comment telling a presenter to call `serve()`. It is that the Scheduler
     * DRAWS THE ITEM ITSELF whenever it holds a bank, and publishes it on the request as
     * `req.item` / `req.family`. A presenter cannot forget to do something the selector already
     * did, and `submit()`'s existing `_servedFamily` fallback means the family is reported whether
     * or not the caller passes one through.
     *
     * When there is NO bank — an offline harness, a unit test — the Scheduler tells `Mastery` so,
     * and every "is this form worth serving" question is then asked with the same
     * `UNREPORTED_FAMILY` the scorer will use. The selector and the scorer cannot disagree, so a
     * missing bank costs coverage (visibly, in `probe().delivery`) and never a deadlock.
     * ------------------------------------------------------------------------------------------
     */
    this.bank = null;
    /** Memoised `(kp x form) -> can the bank actually produce a non-refused item here?` */
    this._servableCells = new Map();
    /** Requests where `serve()` came back empty at draw time. Must stay 0; P32 asserts it. */
    this.serveMisses = 0;

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
    /**
     * `req.seq` -> the generator family `serve()` handed out for it, so `submit()` can report the
     * family even when the presenter forgets to. Bounded in `serve()`; it is a short-lived note
     * about open requests, not state, and it is deliberately NOT persisted: a request that did not
     * survive the reload cannot be submitted either.
     */
    this._servedFamily = new Map();
    this._event = null;
    /** The open test-out probe: `{ kpId }`, or null. Atomic in the same way a retention check is. */
    this._probe = null;
    this._seq = 0;
    this._syncInFlight();
    // Declared here only when the answer is already known. A Scheduler built WITHOUT a bank does
    // not yet know whether one is coming — on the shipped path `boot/62-learning.js` constructs it
    // and `boot/63-learnserve.js` attaches the bank one module later — so the declaration is
    // deferred to the first `_select()`, which is the moment it becomes a fact about an item that
    // is about to be served. Behaviour is restrictive throughout; only the REPORTING waits.
    if (opts.bank) this.attachBank(opts.bank);
  }

  /**
   * Give the Scheduler the item bank, so it draws every item through `serve()` itself.
   *
   * This is the one line that puts `serve()` on the shipped path, and it is called from
   * `app/src/boot/63-learnserve.js`. Injected rather than imported: `app/src/learn/ItemBank.js`
   * belongs to P17/P31 and a feature module never imports a sibling.
   *
   * @param {{select:Function, forKp?:Function}|null} bank
   */
  attachBank(bank) {
    const ok = !!bank && typeof bank.select === "function";
    this.bank = ok ? bank : null;
    this._servableCells.clear();
    // The declaration and the picker are the same decision, so they are made in the same place.
    this.mastery.declareFamilyReporting(ok, ok ? "scheduler-serve" : "scheduler-bank-rejected");
    return this.bank;
  }

  /**
   * Can the bank actually hand out a non-refused item for this cell?
   *
   * `mastery.isScorable(...)` answers "would the engine price this if it arrived"; this answers
   * "can it arrive at all". Both have to be true before a form is offered, because the second
   * failure mode is the same deadlock as the first wearing different clothes: a cell whose entire
   * pool is refused families would be selected forever and served never.
   *
   * Memoised per cell and drawn DRY — no `noteServed`, no `_servedFamily` — so probing servability
   * cannot pollute the no-repeat window it is asking about.
   */
  _servable(kpId, form) {
    if (!this.bank) return true;
    const key = `${kpId}|${form}`;
    const hit = this._servableCells.get(key);
    if (hit !== undefined) return hit;
    const probe = {
      seq: -1,
      kpId,
      form,
      difficulty: this.graph.centre(kpId),
      avoidFamilies: this.mastery.refusedFamilies(kpId, form),
      avoidItemIds: [],
      targetMisconception: null,
    };
    const ok = this.serve(probe, this.bank, { dry: true }) != null;
    this._servableCells.set(key, ok);
    return ok;
  }

  /** The mastery-eligible forms this node can both EARN and BE SERVED. One question, one answer. */
  _earnableForms(kpId) {
    return this.mastery.deliverableMasteryForms(kpId).filter((form) => this._servable(kpId, form));
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
    this.mastery.setInFlight([this._event?.kpId ?? null, this._probe?.kpId ?? null, this.inFlight]);
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
  /**
   * The next learning opportunity, WITH THE ITEM ALREADY DRAWN when this Scheduler holds a bank.
   *
   * `_select()` decides what should happen; this decides what the learner is handed. Keeping the
   * draw here rather than in a presenter is what makes `serve()`'s guarantees unforgettable: the
   * refusal list is honoured and the generator family is recorded on every single request, so
   * `submit()` always has a family to price with even when the caller reports nothing.
   */
  next() {
    const req = this._select();
    if (!req) return null;
    if (!this.bank) return req;
    const sel = this.serve(req, this.bank) ?? this.serve({ ...req, avoidItemIds: [] }, this.bank);
    if (!sel) {
      // Should be unreachable: `_scorableForms` pre-checks servability for every form it offers.
      // If it ever happens, say so in a counter rather than hand out an item the engine will
      // refuse, and never offer this cell again in this session.
      this.serveMisses += 1;
      this._servableCells.set(`${req.kpId}|${req.form}`, false);
      req.unserved = true;
      return req;
    }
    req.item = sel.item;
    req.itemId = sel.item.id;
    req.family = sel.family;
    req.itemSource = sel.source;
    req.itemRelaxation = sel.relaxation ?? null;
    return req;
  }

  _select() {
    // The last possible moment at which "does anyone report the family" is still a hypothetical.
    // From here on an item is about to be chosen, so the answer is recorded and everything that
    // depends on it — plans, deficits, warnings — is derived and said out loud exactly once.
    if (!this.mastery.familyReportingDeclared) this.mastery.declareFamilyReporting(!!this.bank, this.bank ? "scheduler-serve" : "scheduler-without-bank");
    if (this.secondsSpent >= this.sessionMinutes * 60) return null;

    // A multi-item certification event is atomic: once a retention check starts, its four items
    // are the next four items. Interleaving them would break "sampled uniformly, in one sitting".
    if (this._event && this._event.index < this._event.items) return this._eventRequest();

    // A test-out probe is atomic for a sharper reason: its whole integrity is that it is ONE run of
    // consecutive unaided items. Letting the selector wander off between item 2 and item 3 would
    // turn "three in a row" into "three, eventually", which is a different and much weaker claim.
    if (this._probe) {
      const req = this._probeRequest();
      if (req) return req;
      this._probe = null;
      this._syncInFlight();
    }

    const pick = this._choose();
    if (!pick) return null;

    if (pick.mode === "acquire") {
      if (pick.kpId !== this.inFlight) {
        this.inFlight = pick.kpId;
        this.blockCount = 0;
        this._syncInFlight();
      }
      // The test-out replaces the teaching sequence, so the decision is made HERE, before
      // `_acquisitionRequest` calls `phaseFor` — that call has side effects (it spends a `model`
      // budget and moves the fade ladder), and a learner who is about to test out must not be
      // charged for a demonstration they never saw.
      // ...and the probe is only offered if every form it plans to serve can actually be drawn.
      // A probe that dies on item 3 because the bank had nothing servable in that cell fails an
      // honest learner on delivery, which is exactly what round 2 measured on `var-meaning`.
      if (this.mastery.testOutOffered(pick.kpId) && this._probeServable(pick.kpId)) {
        this.mastery.beginTestOut(pick.kpId);
        this._probe = { kpId: pick.kpId };
        this._syncInFlight();
        const req = this._probeRequest();
        if (req) return req;
        this._probe = null;
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

  /** Every form the probe plan intends to serve can be drawn from the bank without a refused family. */
  _probeServable(kpId) {
    const plan = this.mastery.testOutPlan(kpId);
    if (!plan.eligible) return false;
    return plan.forms.every((form) => this._servable(kpId, form));
  }

  _choose() {
    const now = this.clock.minutes();
    const frontier = this.mastery.frontier();
    // A node the bank audit left with no scorable form at all cannot move its own counters, so
    // offering it acquisition items would spend the session on a node that can never leave
    // `learning`. Mastery reports it as unmasterable; the Scheduler simply does not sink time
    // into it. (No node on the shipped bank is in this state; the guard is what keeps a future
    // content regression from eating the session budget instead of failing visibly.)
    // `_earnableForms`, not `masteryFormsFor`: the question is not "does the content have a form"
    // but "can THIS delivery earn one here". Round 2 asked the first and got a knowledge point that
    // was selected forever and scored never.
    const acquirable = frontier.filter(
      (id) => this.mastery.status(id) === "learning" && this._earnableForms(id).length > 0
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
    // Rotated on this node's own attempt count, so a learner walks the tier neighbourhood instead
    // of being handed the same two committed items eight times. See `_nearestVariant`.
    const difficulty = this._nearestVariant(kpId, target, s.attempts);
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

  /**
   * One item of the open test-out probe, or `null` when the probe is over (passed, failed, or out
   * of items). Returning `null` on the FIRST wrong answer is the "failing costs almost nothing"
   * half of the design: a learner who does not know the node pays one item, 46 seconds, and lands
   * in ordinary teaching with that item's evidence still counted.
   *
   * A probe item is an ORDINARY solo acquisition item — same mode, same scoring, same M2/M3
   * counters — pitched at the standard's own difficulty and never scaffolded. The only new thing in
   * the system is a second gate that reads a run of them. That is deliberate: it means the probe
   * cannot be cheaper to answer than the items it replaces, and it means a FAILED probe leaves
   * real evidence behind instead of being thrown away.
   */
  _probeRequest() {
    const kpId = this._probe.kpId;
    const t = this.mastery.testOutOf(kpId);
    if (!t || t.done || t.failed || t.index >= t.items) return null;
    const form = t.forms[t.index];
    const difficulty = this.mastery.testOutDifficulty(kpId);
    // No `phaseFor` call: the probe IS the decision about the phase, and `phaseFor` has side
    // effects. `learn:teach` still fires so P18 and P24 see a solo item arriving.
    this.mastery.emit("learn:teach", { kpId, phase: "solo", testOut: true });
    return {
      seq: this._seq++,
      kpId,
      mode: "acquire",
      testOut: true,
      phase: "solo",
      form,
      difficulty,
      seconds: this.M.phases.secondsPerItemByPhase?.solo ?? SECONDS_DEFAULT,
      hinted: false,
      targetMisconception: null,
      avoidItemIds: this._recentFor(kpId, form),
      sampling: "test-out",
      itemIndex: t.index,
      itemsInEvent: t.items,
      avoidFamilies: this.mastery.refusedFamilies(kpId, form),
      price: this.mastery.price(kpId, form, "solo"),
      // The measurement that decided this probe exists at all, published on every item of it.
      blindPass: t.blindPass,
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

  /**
   * `wanted`, in order, keeping only what this node's bank pool can be honestly priced at.
   *
   * ------------------------------------------------------------------------------------------
   * THE THIRD ARGUMENT IS THE WHOLE ROUND-2 BUG, SO IT IS NOT A LITERAL ANY MORE.
   *
   * This used to pass `null` — "answer at the CELL" — while `Mastery.respond` answered the same
   * question with `UNREPORTED_FAMILY`, which is restrictive on any cell that has a refused family.
   * The selector said yes 228 times and the scorer said no 228 times, and neither of them was
   * wrong on its own terms. `mastery.deliveryFamily()` is now the single source of that argument:
   * `null` when the picker will report the family, the sentinel when it will not. Selector and
   * scorer ask the same question with the same third argument, by construction.
   *
   * The servability filter is the same rule one step further out — see `_servable`.
   * ------------------------------------------------------------------------------------------
   */
  _scorableForms(kpId, wanted) {
    const family = this.mastery.deliveryFamily();
    return wanted.filter((form) => this.mastery.isScorable(kpId, form, "solo", family) && this._servable(kpId, form));
  }

  /**
   * A variant tier near the target, ROTATED across this node's exposure.
   *
   * ------------------------------------------------------------------------------------------
   * WHY THIS IS NOT "THE NEAREST ONE", WHICH IS WHAT IT USED TO BE
   *
   * It returned the single nearest offset, every time, for as long as theta sat still. A learner's
   * whole exposure to one (knowledge point x form) is about eight items — a 22-session budget is
   * ~780 items over 96 cells — and `ItemBank.select()` files the committed catalogue by tier, so
   * all eight came out of the two or three items filed under that one tier. Measured on a real run,
   * `distribute-numeric|generate` served 72 draws over 7 distinct committed items, and ONE fixed
   * string answered 0.667 of them; those same seven items, met evenly, hand the same string 0.286.
   * The leak was not in the item set, it was in the WEIGHTS, and no amount of re-pricing fixes a
   * learner being handed the same two questions.
   *
   * So the offsets are ordered by distance from the target — the pitch §1.3 asks for is still the
   * first choice and the far tail is still the last — and the exposure walks that order instead of
   * standing on its head. It costs the acquisition pitch nothing that matters (the neighbourhood is
   * ±0.6 logits) and it is what makes the bank audit's equal-weighted measurement describe what a
   * learner actually meets.
   * ------------------------------------------------------------------------------------------
   */
  _nearestVariant(kpId, target, rotation = 0) {
    const centre = this.graph.centre(kpId);
    const ranked = [...this.M.ability.variantOffsets].sort(
      (a, b) => Math.abs(centre + a - target) - Math.abs(centre + b - target) || a - b
    );
    // Only the THREE nearest rotate. Spreading over all five costs the acquisition pitch real
    // learning — it drags a learner across ±0.6 logits every third item and the median Level 1
    // result falls about four points — while the flattening that pricing needs is already bought by
    // three: the leak was one tier's two items answering everything, and three tiers is six to nine.
    const span = Math.min(3, ranked.length);
    return centre + ranked[((rotation % span) + span) % span];
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

  // --------------------------------------------------------------------- serve

  /**
   * ------------------------------------------------------------------------------------------
   * THE SANCTIONED PICKER. Turn one request into one item, honouring the refusal list.
   * ------------------------------------------------------------------------------------------
   *
   * WHY THIS EXISTS AND IS NOT IN `ItemBank`. Every request the Scheduler publishes carries
   * `avoidFamilies` — the generator families the audit refused on that (knowledge point x form),
   * each of which has a single memorised answer. A critic measured what happens when nothing reads
   * it: `ItemBank.select()` takes no `avoidFamilies` argument at all, so the very first
   * `select({ kpId: "expr-anatomy", form: "construct" })` returns an `expr-anatomy.coefficient`
   * item, measured 1.000 blind, on a band-1 node with 29 descendants. The engine's half of that is
   * closed inside `Mastery` (see `UNREPORTED_FAMILY`): such an item is REFUSED rather than credited.
   * But a refusal costs the learner 46 s and fails an honest probe, so the honest move is to not
   * serve it — and `app/src/learn/ItemBank.js` belongs to another piece. This is the filter, on
   * this side of the boundary, until it can live in `select()`.
   *
   * Two mechanisms, because the bank has two halves:
   *   - the committed catalogue is filtered by ID. Refused families' items are added to the
   *     exclusion set `select()` already honours, so the catalogue simply never offers them;
   *   - the generator is filtered by REJECTION AND RETRY. `select()` is deterministic in `seed`, so
   *     a rejected draw is retried at a different seed rather than argued with.
   *
   * It returns `{ item, family, source, tries, filtered }`, or `null` when the cell has nothing
   * servable left — which is a real answer and better than a refused item: the caller should ask
   * `next()` again rather than serve something the engine will not score.
   *
   * @param {object} req a request from `next()`
   * @param {{select:Function, forKp?:Function}} bank the item bank (injected, never imported)
   */
  serve(req, bank, { maxTries = 24, dry = false } = {}) {
    if (!req || !bank || typeof bank.select !== "function") return null;
    const avoid = new Set(req.avoidFamilies ?? []);
    const exclude = new Set(req.avoidItemIds ?? []);
    // Catalogue half: name the refused items so `select()`'s own exclusion set does the work.
    if (avoid.size && typeof bank.forKp === "function") {
      for (const it of bank.forKp(req.kpId, { form: req.form }) ?? []) if (avoid.has(it.family)) exclude.add(it.id);
    }
    let tries = 0;
    let filtered = 0;
    for (; tries < maxTries; tries += 1) {
      const sel = bank.select({
        kpId: req.kpId,
        form: req.form,
        difficulty: req.difficulty == null ? null : Math.max(1, Math.min(5, Math.round(req.difficulty))),
        misconception: req.targetMisconception ?? null,
        exclude,
        // Passed through even though today's bank ignores it: the day `select()` grows the filter,
        // this loop becomes a no-op instead of a second implementation of the same rule.
        avoidFamilies: [...avoid],
        seed: ((req.seq + 1) * 2654435761 + tries * 7919) >>> 0,
      });
      if (!sel || !sel.item) break;
      const family = sel.item.family ?? null;
      if (family != null && avoid.has(family)) {
        filtered += 1;
        exclude.add(sel.item.id); // never offer this one again inside this request
        continue;
      }
      // A DRY draw is a question about the cell, not a service to the learner: it must not close
      // the no-repeat window on an item nobody saw, and it must not claim a `seq` that is not real.
      if (!dry) {
        this.noteServed({ itemId: sel.item.id, kpId: req.kpId, form: req.form });
        this._servedFamily.set(req.seq, family);
        // A cap, so one long-lived session cannot grow this without bound. Only the open request
        // and its immediate predecessors can still be submitted.
        if (this._servedFamily.size > 64) this._servedFamily.delete(this._servedFamily.keys().next().value);
      }
      return { item: sel.item, family, source: sel.source, relaxation: sel.relaxation ?? null, tries: tries + 1, filtered };
    }
    return null;
  }

  // -------------------------------------------------------------------- submit

  /**
   * Score one response against the request `next()` produced, then move time and the ladder.
   *
   * @param {object} req the request from `next()`
   * @param {object} outcome `{ correct, latencyMs?, promptTokens?, hinted?, itemId?, misconception?, response?, exercises?, family? }`
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
      // `req.itemId` is what `next()` actually drew through `serve()`. A caller that presented
      // something else says so by passing its own; a caller that presented what it was given need
      // not repeat itself.
      itemId: outcome.itemId ?? req.itemId ?? null,
      /**
       * WHICH GENERATOR FAMILY WAS SERVED. Forty-odd of the bank's families answer to a single
       * memorised string and the audit refuses them by name; the engine will not score an item
       * whose family it was not told, on any cell that has such a family (see
       * `Mastery.UNREPORTED_FAMILY`). A presenter therefore has two honest options, and this line
       * is the second one: report `family` on the outcome, or draw the item through `serve()`,
       * which honours `avoidFamilies` and remembers what it handed out. Anything else is refused
       * rather than priced at the surviving-family rate, which is the round-2 leak.
       */
      family: outcome.family ?? this._servedFamily.get(req.seq) ?? null,
      misconception: outcome.misconception ?? null,
      response: outcome.response ?? null,
      exercises: outcome.exercises,
      // The probe flag travels with the REQUEST, never with the caller's outcome. A presenter must
      // not be able to declare an ordinary item a test-out item after the fact.
      testOut: req.testOut === true,
    });

    // Time is a box, and a scaffolded item does not cost what an unscaffolded one costs.
    const seconds = req.seconds ?? SECONDS_DEFAULT;
    this.secondsSpent += seconds;
    this.itemsThisSession += 1;
    if (req.mode !== "acquire") this.reviewItemsThisSession += 1;
    this.clock.advance(seconds / 60);

    const servedId = outcome.itemId ?? req.itemId ?? null;
    if (servedId) this.noteServed({ itemId: servedId, kpId: req.kpId, form: req.form });

    if (req.mode === "acquire") {
      this.blockCount += 1;
      if (this.mastery.status(req.kpId) !== "learning") this.inFlight = null;
      // `Mastery._noteTestOut` has already settled the probe's own gate inside `respond()`. All the
      // Scheduler does here is stop pointing at a probe that is over — and, when it FAILED, hand the
      // learner back the teaching sequence they would have had if the probe had never been offered.
      if (this._probe && this.mastery.testOutOf(this._probe.kpId)?.done) {
        if (this.mastery.testOutOf(this._probe.kpId).failed) this._reenterAfterProbe(this._probe.kpId);
        this._probe = null;
      }
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

  /**
   * A FAILED test-out puts the learner back exactly where the teaching sequence would have started,
   * and this method exists because getting it wrong is silent.
   *
   * `phaseFor`'s `model` trigger reads `attempts === 0`. A probe spends attempts, so without this a
   * learner who was offered a probe, got item 1 wrong and clearly needs the demonstration would be
   * handed `guided-3` — a hint surface, the LEAST helpful rung of the fade ladder — because the
   * ladder read them as someone who had already been taught and had slipped. That is the opposite
   * of what happened. "Failing the probe costs almost nothing" has to mean it costs one item and
   * NOT the worked example, or the mechanism quietly punishes exactly the learner it was supposed
   * to leave alone.
   *
   * This is not `_reenterTeaching`, which is the LAPSE path: a lapse deliberately re-enters one
   * step back from solo, because "do not re-lecture an adult about a sign error". A failed probe is
   * a first encounter, not a lapse, so it re-enters at the top.
   */
  _reenterAfterProbe(kpId) {
    const s = this.mastery.stateOf(kpId);
    s.lastPhase = null;
    s.lastCorrect = null;
    s.consecutiveWrong = 0;
    s.fadeIdx = 0;
    s.pendingModel = s.p < this.M.phases.modelPhaseThreshold;
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
      // The probe's tally lives in `Mastery` (one counter, next to the scoring decision, for the
      // same reason the certification event's does). This is only the pointer to which node it is on.
      probe: this._probe ? { ...this._probe } : null,
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
    this._probe = snap.probe ? { ...snap.probe } : null;
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
      probe: this._probe
        ? (() => {
            const t = this.mastery.testOutOf(this._probe.kpId);
            return { kpId: this._probe.kpId, index: t?.index ?? 0, items: t?.items ?? 0, right: t?.right ?? 0, blindPass: t?.blindPass ?? null };
          })()
        : null,
      reviewCapLift: this.reviewCapLift,
      pullForward: this.pullForward,
      /**
       * Whether `serve()` is on this Scheduler's path at all, and what it cost. `bank: false` is
       * not a neutral configuration — it is the round-2 delivery, and `mastery.probe().delivery`
       * names the three knowledge points it makes uncertifiable.
       */
      bank: !!this.bank,
      serveMisses: this.serveMisses,
      servableCells: Object.fromEntries([...this._servableCells].map(([k, v]) => [k, v])),
      unservableCells: [...this._servableCells].filter(([, v]) => !v).map(([k]) => k),
    };
  }
}
