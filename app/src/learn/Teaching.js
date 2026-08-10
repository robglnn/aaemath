import { signals } from "../core/Signals.js";

/**
 * P34 — the presenter. The thing that was missing between an engine and a surface.
 *
 * ==================================================================================================
 * WHY THIS FILE EXISTS
 *
 * Every part of the learning round trip was already built, measured and reviewed, and none of it was
 * joined up. `tools/seams.mjs --signals` named the shape of it exactly:
 *
 *     learn:present   listened for, never emitted
 *     math:show       listened for, never emitted        <- so no chosen item was ever displayed
 *     math:hide       listened for, never emitted
 *     learn:respond   emitted, never heard
 *     learn:teach     emitted, never heard
 *     learn:unlock    emitted, never heard
 *     Scheduler.serve()   zero callers under app/
 *
 * `flow/Session.js` drove `scheduler.next()` and stopped there: nothing turned a request into pixels
 * and nothing turned a player into a response. This class is that hop and nothing else. It invents no
 * pedagogy, no selection, no scoring, no items — it asks the layers that already exist:
 *
 *     flow.session.next()  ->  req (WITH `req.item`, drawn through `Scheduler.serve()`)
 *     math:show / learn:present                        the claim stands in the world
 *     <the player constructs a response>
 *     ItemBank.check(item, response)                   the SHIPPED checker marks it
 *     flow.session.submit(req, outcome)  ->  Scheduler.submit -> Mastery.respond
 *                                          -> learn:respond / learn:mastery / learn:unlock
 *     math:hide                                        the claim is retired
 *
 * ==================================================================================================
 * THE RESPONSE IS TYPED, AND THAT IS A LEARNING-INTEGRITY DECISION, NOT A UI PREFERENCE
 *
 * The obvious presenter — stand three candidate answers in the world, let the player pick one — would
 * have been quicker to write and would have silently reopened the leak `RESUME.md` §7 lists first.
 * `content/knowledge-graph.json` prices the forms it ships and says so out loud:
 *
 *     trueGuessByForm.construct = 0.03   "a numeric slot accepts the integers in [-20,20] plus
 *                                         fraction forms: 1/41 = 0.024"
 *     trueGuessByPhase.guided-2 = 0.17   "the answer space is constrained to legal moves ...
 *                                         this is a four-option multiple choice wearing a workshop"
 *
 * A pick-one presentation of a `construct` item IS `guided-2`, and crediting it at construct's 0.03 is
 * the identical arithmetic error the model file spends a paragraph forbidding. So the response is
 * CONSTRUCTED: the learner types into the world and the string goes to `ItemBank.check`, which is the
 * same checker `tools/bank-audit.mjs` priced the whole bank with. The answer space the engine believes
 * it is pricing is the answer space the player actually faces.
 *
 * The typed response is not a form field. It stands in the world as bare white KaTeX at the socket
 * below the claim, in exactly the surface `boot/60-mathtex.js` already owns, and the player keeps
 * walking, looking and jumping the whole time — there is no modal, nothing pauses, nothing is greyed.
 * `RESUME.md` §6 priority 4: "Any modal quiz box is an automatic fail."
 *
 * ==================================================================================================
 * WHY IT DOES NOT START ITSELF
 *
 * The first `math:show` retires the claims the world stands at spawn (`boot/60-mathtex.js`'s
 * `standDown`). Those claims are P09's authored spawn frame and P15's occlusion gate reads them, so a
 * presenter that opened on frame 0 would silently rewrite four other pieces' review baselines. The
 * loop therefore opens on the `interact` verb — the player walks up to the mathematics and takes it
 * on — and from then on it runs continuously. `begin()` is the same entry point either way.
 * ==================================================================================================
 */

/** Tuning. Seconds are SIM seconds: everything here runs in `fixed()`, so it is frame-rate free. */
export const TEACH = {
  /** How long a marked claim stands before it is retired, so the learner sees the verdict. */
  feedbackSeconds: 1.6,
  /** Quiet between retiring one claim and standing the next. */
  gapSeconds: 0.5,
  /** Refuse to grow the response without bound — `TexPanel` gate 3 would refuse it anyway. */
  maxResponseChars: 48,
  /** Requests to skip when `Scheduler.serve()` comes back empty before giving the cycle up. */
  maxServeRetries: 4,
  /** How long the presenter waits before asking a momentarily empty engine again. See `fixed()`. */
  waitRetrySeconds: 5,
  /**
   * Sockets, in metres right / up / ahead of the camera. These are the three positions
   * `boot/60-mathtex.js` measured clear of world geometry for the standing claims (its header
   * documents the sweep that produced them) — the claim the engine chooses stands exactly where the
   * claim the world stood did, which is the whole meaning of "the engine takes the surface over".
   */
  sockets: {
    claim: { right: 1.44, up: 2.86, forward: 14, em: 0.88 },
    entry: { right: 1.44, up: 0.66, forward: 14, em: 0.88 },
    /**
     * The working stack is further from the camera than the pair, so it needs MORE metres per em,
     * not fewer, to clear the same legibility floor. Round 1 shipped `em: 0.66` here and
     * `TexPanel`'s gate 8 measured every line of it at 25.4-25.7 device px per em against a floor of
     * 33.3 at 1280x720 — a repair item whose broken build is below the floor is an item the learner
     * cannot read the fault in. 1.0 measures 38-39 px per em on the same frame.
     */
    working: { right: 6.3, up: 3.0, forward: 14, em: 1.0 },
  },
  /** Vertical spacing between stacked working lines, in metres. Scaled with the em above. */
  workingStep: 1.35,
};

/**
 * Panel ids this presenter owns, published on `TEACH` rather than as three loose exports so the seam
 * audit does not have to be told about names nobody imports. Stable, because `math:show` is
 * idempotent on `id` — re-sending one re-typesets that claim in place instead of standing a second.
 * Any surface that stands its own claims must stay off this prefix.
 */
const CLAIM_ID = "teach-claim";
const ENTRY_ID = "teach-entry";
const WORKING_ID = "teach-working";
TEACH.ids = { claim: CLAIM_ID, entry: ENTRY_ID, working: WORKING_ID, prefix: "teach-" };

/**
 * What a keystroke may put into a response.
 *
 * Two jobs. It keeps the entry claim PARSEABLE — every character here is legal KaTeX on its own, so
 * a half-typed response can never reach `Tex.validate` as something it must refuse, and a refused
 * claim can never appear in a capture as a hollow stand-in. And it keeps the response inside the
 * grammar `ItemBank.check` canonicalizes: digits, an unknown, the four operators, relation symbols,
 * grouping, and the separators the `pair`, `partition` and `repair` answer types use.
 */
const ENTRY_CHARS = /^[0-9a-zA-Z+\-*/=<>.,()|:; ]$/;

const round2 = (v) => Math.round(v * 100) / 100;

export class Teaching {
  /**
   * @param {object} opts
   * @param {object|null} opts.session  P33's `flow/Session.js`. Preferred: it holds the arc.
   * @param {object|null} opts.learning P16's mounted engine. Used only when no session exists.
   * @param {object|null} opts.bank     P17's `ItemBank` — INJECTED, never imported (a feature module
   *                                    may not import a sibling; `boot/92-teaching.js` is where the
   *                                    two are allowed to meet, exactly like `boot/63-learnserve.js`).
   * @param {(a:object)=>number[]|null} [opts.place] resolve a socket to a world position.
   * @param {(name:string,value:any)=>void} [opts.emit]
   * @param {(name:string,fn:Function)=>Function} [opts.on]
   */
  constructor(opts = {}) {
    this.session = opts.session ?? null;
    this.learning = opts.learning ?? null;
    this.bank = opts.bank ?? null;
    this.place = opts.place ?? (() => null);
    this.emit = opts.emit ?? ((name, value) => signals.emit(name, value));
    this.on = opts.on ?? ((name, fn) => signals.on(name, fn));

    /** `dormant` -> `idle` -> `standing` -> `marked` -> `gap` -> `standing` ... -> `spent`. */
    this.phase = this.session || this.learning ? "idle" : "dormant";
    this.simTime = 0;
    this.req = null;
    this.item = null;
    this.presented = null;
    this.response = "";
    this.mark = null;
    this.until = 0;
    this.standing = new Set();
    this.startedBy = null;

    /**
     * What the engine ANNOUNCED for the item about to be served, taken off `learn:teach`.
     *
     * This is a real consumer of a signal that had none. `Scheduler._acquisitionRequest` and
     * `_eventRequest` emit `learn:teach {kpId, phase}` from inside `next()`, before the request is
     * returned, so by the time `_present()` has a request this already holds the phase — and the
     * phase is what decides whether the world demonstrates (`model`) or stays out of the way.
     */
    this.announced = null;

    /** Whether the world put information on the screen before this response was committed. */
    this.hintShown = false;
    /** The typed response has changed and the claim below the item needs re-typesetting. */
    this._entryDirty = false;

    this.stats = {
      cycles: 0,
      presented: 0,
      committed: 0,
      correct: 0,
      wrong: 0,
      unscored: 0,
      /** Requests where `Scheduler.serve()` came back empty. Must stay 0; P32 asserts it. */
      unserved: 0,
      /** Requests carrying no `family` — the round-2 delivery defect, counted rather than assumed. */
      familyMissing: 0,
      /**
       * Responses the SITTING would not take but the ENGINE did. `Session.submit` returns null when
       * no beat is open, and a sitting closed under a standing claim produces exactly that —
       * `flow.restart()` from a menu, or the break hinge in `boot/90-flow.js`, are both reachable
       * routes. Measured, not assumed: driving `flow.restart()` mid-item lost one response before
       * this existed. See `commit()`.
       */
      rescued: 0,
      /** Responses NOTHING would take. Must be 0: a learner's answer is never allowed to vanish. */
      dropped: 0,
      emptyRequests: 0,
      shows: 0,
      hides: 0,
      /** Signals CONSUMED, not emitted. Zero on any of these is a seam that reopened. */
      teachHeard: 0,
      respondHeard: 0,
      /** What the bank actually handed over, by provenance. `itemRelaxation`, recorded. */
      bySource: {},
      byRelaxation: {},
      byPhase: {},
    };
    this.lastRespond = null;
    this._offs = [];
  }

  // -------------------------------------------------------------------------- wiring

  /** Subscribe to the two signals this presenter CONSUMES. Idempotent. */
  attach() {
    if (this._offs.length) return this;

    /**
     * `learn:teach` — emitted, and until now never heard by anything.
     *
     * The engine announcing a teaching phase is the only notice the world gets that it is about to
     * be asked to demonstrate rather than to ask. It is consumed here and acted on in `_display`.
     */
    this._offs.push(
      this.on("learn:teach", (e) => {
        if (!e?.kpId) return;
        this.stats.teachHeard += 1;
        this.announced = { kpId: e.kpId, phase: e.phase ?? null, testOut: e.testOut === true, at: this.simTime };
      })
    );

    /**
     * `learn:respond` — emitted by `Mastery._emitRespond`, and until now never heard by anything.
     *
     * The claim is retired on the ENGINE's announcement of the response, not on `submit()`'s return
     * value, and that is deliberate: an unscored response (a refused family, a phase the model holds
     * inert) is still a response the learner made, and the claim has to come down for it too. Making
     * the retirement a consumer of the signal is what guarantees the two can never disagree.
     */
    this._offs.push(
      this.on("learn:respond", (e) => {
        if (!e || this.phase !== "standing") return;
        this.stats.respondHeard += 1;
        this.lastRespond = {
          itemId: e.itemId ?? null,
          kpId: e.kpId ?? null,
          correct: e.correct === true,
          latencyMs: e.latencyMs ?? null,
          family: e.family ?? null,
          form: e.form ?? null,
          phase: e.phase ?? null,
          hinted: e.hinted === true,
          scored: e.scored === true,
          credited: e.credited === true,
          reason: e.reason ?? null,
        };
        if (e.scored === false) this.stats.unscored += 1;
        this.phase = "marked";
        this.until = this.simTime + TEACH.feedbackSeconds;
      })
    );

    // A sitting that opens re-arms the presenter. `flow.restart()` and the break-hinge in
    // `boot/90-flow.js` both come through here, so the loop resumes without this file knowing
    // anything about breaks.
    this._offs.push(
      this.on("learn:session", (e) => {
        if (e?.phase !== "open") return;
        if (this.phase === "spent" || this.phase === "waiting") {
          this.phase = "idle";
          this.until = this.simTime;
        }
      })
    );

    return this;
  }

  dispose() {
    for (const off of this._offs) off?.();
    this._offs.length = 0;
    this._retire();
  }

  // -------------------------------------------------------------------------- driving

  /** Open the loop. The `interact` verb calls this; so does the review harness. */
  begin(reason = "interact") {
    if (this.phase === "dormant" || this.phase === "standing" || this.phase === "marked") return false;
    this.startedBy = this.startedBy ?? reason;
    this.phase = "gap";
    this.until = this.simTime;
    return true;
  }

  get open() {
    return this.phase === "standing";
  }

  fixed(step, simTime) {
    this.simTime = simTime ?? this.simTime + step;
    /**
     * THE RESPONSE IS RE-TYPESET HERE, NOT ON THE KEYSTROKE.
     *
     * A `math:show` is a KaTeX parse, a canvas raster and a texture upload. Re-typesetting on every
     * `keydown` measured 100 `math:show` calls for 13 items — eight rasters per item to display one
     * answer, all but the last of them thrown away before a frame was ever drawn with it. Nothing on
     * screen can change faster than a simulation step, so a burst of keystrokes inside one step is
     * one raster. `TexPanel`'s panel cap and raster budget are what this protects.
     */
    if (this._entryDirty && this.phase === "standing") {
      this._entryDirty = false;
      this._showEntry();
    }
    /**
     * `waiting` means the engine had nothing legal to offer THIS INSTANT — a cell whose whole
     * servable pool was exhausted inside one request, most likely. It is not `spent`: the sitting is
     * still open, so parking here forever would be a presenter that stops teaching and never says
     * so. `Session.next()` on a closed sitting returns immediately, so the retry costs a Map lookup
     * and cannot turn into a loop; a learner can also just take the claim on again with `interact`.
     */
    if (this.phase === "waiting" && this.simTime >= this.until) {
      this.until = this.simTime + TEACH.waitRetrySeconds;
      this._present();
      return;
    }
    if (this.phase === "idle" || this.phase === "dormant" || this.phase === "spent" || this.phase === "waiting") return;
    if (this.phase === "marked" && this.simTime >= this.until) {
      this._retire();
      this.phase = "gap";
      this.until = this.simTime + TEACH.gapSeconds;
      return;
    }
    if (this.phase === "gap" && this.simTime >= this.until) this._present();
  }

  // -------------------------------------------------------------------------- the cycle

  /**
   * Ask for the next item and stand it in the world.
   *
   * The request comes from the session layer when there is one, so the Pomodoro arc, the beat
   * structure and the pace calibration all see every item — and from the engine directly when there
   * is not, so a page where `boot/90-flow.js` failed still teaches.
   */
  _present() {
    const driver = this.session ?? this.learning;
    if (!driver) return null;

    let req = null;
    for (let i = 0; i < TEACH.maxServeRetries && !req; i += 1) {
      let candidate = null;
      try {
        candidate = driver.next();
      } catch {
        candidate = null;
      }
      if (!candidate) {
        // The engine has nothing legal left, or the sitting is spent. Both are real answers.
        this.stats.emptyRequests += 1;
        this.phase = this.session && this.session.phase === "closed" ? "spent" : "waiting";
        this.until = this.simTime + TEACH.waitRetrySeconds;
        return null;
      }
      if (candidate.item) req = candidate;
      else this.stats.unserved += 1;
    }
    if (!req) {
      this.phase = "waiting";
      this.until = this.simTime + TEACH.waitRetrySeconds;
      return null;
    }

    this.req = req;
    this.item = req.item;
    this.response = "";
    this.hintShown = false;
    this.mark = this.simTime;
    if (!req.family) this.stats.familyMissing += 1;
    this.stats.bySource[req.itemSource ?? "unknown"] = (this.stats.bySource[req.itemSource ?? "unknown"] ?? 0) + 1;
    const relax = req.itemRelaxation ?? "none";
    this.stats.byRelaxation[relax] = (this.stats.byRelaxation[relax] ?? 0) + 1;
    this.stats.byPhase[req.phase ?? "?"] = (this.stats.byPhase[req.phase ?? "?"] ?? 0) + 1;

    this.presented = this.bank?.present ? this.bank.present(this.item) : null;

    /**
     * `learn:present` — listened for by `boot/62-learning.js` (which closes the no-repeat window on
     * it) and by `boot/60-mathtex.js` (which stands the world's own claims down), and emitted by
     * nothing until now. `kpId` and `form` are what put the item in the right per-cell window;
     * without them `Scheduler.noteServed` can only close the weaker global one.
     *
     * It fires BEFORE the first `math:show` of the item, and the order is load-bearing rather than
     * stylistic: `standDown` is reachable from either signal, so emitting the display first would
     * make it impossible to tell from outside which of the two the field actually answered. This way
     * the authored spawn claims come down on the announcement, and what stands afterwards is only
     * ever what the engine chose.
     */
    this.emit("learn:present", {
      itemId: this.item.id,
      kpId: req.kpId,
      form: req.form,
      phase: req.phase,
      mode: req.mode,
      family: req.family ?? null,
      difficulty: req.difficulty ?? null,
      source: req.itemSource ?? null,
      relaxation: req.itemRelaxation ?? null,
      testOut: req.testOut === true,
    });

    this._display();

    this.stats.presented += 1;
    this.phase = "standing";
    return req;
  }

  /** Stand the claim, the working it is about, and the empty response slot. */
  _display() {
    const S = TEACH.sockets;
    const stem = this.presented?.tex?.stem ?? this.item?.stem ?? "";
    if (stem) this._show(CLAIM_ID, stem, S.claim);

    /**
     * The lines the item is ABOUT, when it has them. A `repair` item is a shown build with one
     * joint wrong — without the build on screen there is nothing to repair, so this is the item, not
     * decoration. Each line is its own claim rather than one `array` environment because `math:show`
     * types one expression and `TexPanel`'s gates are written per expression.
     */
    const lines = Array.isArray(this.item?.working) ? this.item.working : [];
    lines.forEach((tex, i) => {
      this._show(`${WORKING_ID}-${i}`, `${i + 1})\\;${tex}`, {
        ...S.working,
        up: S.working.up - i * TEACH.workingStep,
      });
    });

    /**
     * THE MODEL PHASE, which is the whole reason `learn:teach` is consumed rather than counted.
     *
     * `model.phases.trueGuessByPhase.model` is 0.70 — "the world has just performed the identical act
     * in front of the learner" — and `phases.unscored` holds `model`, so the engine already treats
     * this as inert in both directions. The world demonstrating is therefore free, and refusing to
     * demonstrate would make the announcement a lie. `hintShown` records that it happened, and it is
     * reported on the outcome, so the response is priced as what it was.
     */
    /**
     * BOTH have to say `model`: the announcement the engine made, and the request it then handed
     * over. `learn:teach` is what gates the demonstration — that is the consumption — but a stale
     * announcement must never be able to scaffold an item the engine served as `solo`, and a test-out
     * probe announces `{phase:"solo", testOut:true}` precisely so it can never be demonstrated at.
     * One belt, one pair of braces, on the surface where a mistake buys unearned mastery.
     */
    const announcedHere = this.announced?.kpId === this.req?.kpId && this.announced?.phase === this.req?.phase;
    if (announcedHere && this.req?.phase === "model" && this.req?.testOut !== true) {
      const shown = this.item?.answer?.tex ?? this.item?.answer?.canonical ?? null;
      if (shown) {
        this._show(`${WORKING_ID}-model`, shown, {
          ...S.working,
          up: S.working.up - lines.length * TEACH.workingStep,
        });
        this.hintShown = true;
      }
    }
  }

  /** `math:show` — one expression, at one socket. The seam that had no emitter. */
  _show(id, tex, socket) {
    const at = this.place(socket);
    this.emit("math:show", {
      id,
      tex,
      kpId: this.req?.kpId ?? null,
      at: at ?? undefined,
      anchor: at ? null : { right: socket.right, up: socket.up, forward: socket.forward },
      em: socket.em,
      billboard: "yaw",
      display: true,
    });
    this.standing.add(id);
    this.stats.shows += 1;
  }

  /** `math:hide` — the other half of the same seam. */
  _hide(id) {
    this.emit("math:hide", { id });
    this.standing.delete(id);
    this.stats.hides += 1;
  }

  _retire() {
    for (const id of [...this.standing]) this._hide(id);
    this.req = null;
    this.item = null;
    this.presented = null;
    this.response = "";
    this._entryDirty = false;
    this.mark = null;
  }

  // -------------------------------------------------------------------------- the response

  /** One character of a constructed response. Returns false when the character is refused. */
  type(ch) {
    if (this.phase !== "standing") return false;
    const c = String(ch ?? "");
    if (c.length !== 1 || !ENTRY_CHARS.test(c)) return false;
    if (this.response.length >= TEACH.maxResponseChars) return false;
    this.response += c;
    this._entryDirty = true;
    return true;
  }

  erase() {
    if (this.phase !== "standing" || !this.response) return false;
    this.response = this.response.slice(0, -1);
    this._entryDirty = true;
    return true;
  }

  _showEntry() {
    if (!this.response) {
      if (this.standing.has(ENTRY_ID)) this._hide(ENTRY_ID);
      return;
    }
    this._show(ENTRY_ID, this.response, TEACH.sockets.entry);
  }

  /**
   * Commit the constructed response.
   *
   * Everything that decides anything happens somewhere else: `ItemBank.check` marks it with the
   * shipped checker, `Scheduler.submit` prices it, `Mastery.respond` scores it. What this does is
   * report honestly — the family the Scheduler served, the scaffold the world actually surfaced, and
   * a latency measured on the fixed clock rather than on wall time, which is what makes the
   * anti-guessing floor mean the same thing in a review capture as in play.
   */
  commit() {
    if (this.phase !== "standing" || !this.req || !this.item) return null;
    if (!this.response.trim()) return null;
    // Commit can land in the same step as the last keystroke. Flush first: a learner must be able to
    // read what they submitted, and the marked claim standing beside the item is that reading.
    if (this._entryDirty) {
      this._entryDirty = false;
      this._showEntry();
    }

    const marked = this.bank?.check ? this.bank.check(this.item, this.response) : { correct: false, misconception: null };
    const latencyMs = Math.max(0, Math.round((this.simTime - (this.mark ?? this.simTime)) * 1000));
    const outcome = {
      correct: marked.correct === true,
      latencyMs,
      response: this.response,
      itemId: this.item.id,
      /**
       * The round-2 delivery defect, closed at the caller as well as inside the Scheduler. 24 of the
       * bank's 96 cells hold a family the audit refuses, and `Mastery.respond` will not score a
       * response whose family it was never told — an unreported family cannot be told apart from a
       * refused one. `Scheduler.next()` already remembers what `serve()` handed out; saying it again
       * here means a presenter that ever re-draws an item cannot silently stop reporting it.
       */
      family: this.req.family ?? null,
      misconception: marked.misconception ?? null,
      /** What the world ACTUALLY did, never inferred from the phase name. See `model.phases.hintedNote`. */
      hinted: this.hintShown || this.req.hinted === true,
    };

    const driver = this.session ?? this.learning;
    let result = null;
    try {
      result = driver.submit(this.req, outcome);
    } catch {
      result = null;
    }

    /**
     * THE SITTING REFUSED IT. SCORE IT ANYWAY, THROUGH THE ENGINE.
     *
     * `Session.submit` opens with `if (!this.learning || !this.beat) return null;` and returns
     * BEFORE it scores anything, while `Scheduler.submit` always returns a verdict — so a null from
     * the session unambiguously means "nothing was scored", and there is no double-submission to
     * worry about. The reachable route is a sitting that closed under a standing claim:
     * `flow.restart()` from a menu, or the break hinge in `boot/90-flow.js`.
     *
     * Driving `flow.restart()` mid-item measured exactly one lost response before this existed, and
     * a lost response is not a bookkeeping detail — it is a learner who did the work and got no
     * credit for it. The sitting's arc genuinely should not count an item belonging to the sitting
     * before it; the LEARNER MODEL always should. Those are different books, and this is the line
     * that keeps them from being confused.
     */
    if (result == null && this.session && typeof this.learning?.submit === "function") {
      try {
        result = this.learning.submit(this.req, outcome);
      } catch {
        result = null;
      }
      if (result != null) this.stats.rescued += 1;
    }

    this.stats.committed += 1;
    this.stats.cycles += 1;
    if (result == null) this.stats.dropped += 1;
    if (outcome.correct) this.stats.correct += 1;
    else this.stats.wrong += 1;

    // `learn:respond` fired synchronously inside `submit()` and moved us to `marked`. If it did not —
    // an engine that refused the request outright — the claim must still come down.
    if (this.phase === "standing") {
      this.phase = "marked";
      this.until = this.simTime + TEACH.feedbackSeconds;
    }
    return result;
  }

  // -------------------------------------------------------------------------- reporting

  probe() {
    return {
      phase: this.phase,
      driver: this.session ? "session" : this.learning ? "learning" : null,
      startedBy: this.startedBy,
      simTime: round2(this.simTime),
      standing: [...this.standing],
      response: this.response,
      item: this.req
        ? {
            itemId: this.item?.id ?? null,
            kpId: this.req.kpId,
            form: this.req.form,
            phase: this.req.phase,
            mode: this.req.mode,
            family: this.req.family ?? null,
            source: this.req.itemSource ?? null,
            relaxation: this.req.itemRelaxation ?? null,
            difficulty: this.req.difficulty ?? null,
            testOut: this.req.testOut === true,
            hintShown: this.hintShown,
          }
        : null,
      announced: this.announced,
      lastRespond: this.lastRespond,
      /** The localized surfaces the bank resolved for this item. P21's HUD is what will draw them. */
      framing: this.presented ? { framing: this.presented.framing, ask: this.presented.ask, hints: this.presented.hints.length } : null,
      stats: { ...this.stats },
    };
  }
}
