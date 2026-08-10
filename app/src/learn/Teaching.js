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
   * ONE COLUMN, AND WHY IT IS NOT TWO.
   *
   * Round 2 stood the stem at `right 1.44` and the working stack at `right 6.3`, which is where
   * `boot/60-mathtex.js` stands its authored pair and its authored working. That is a safe pair of
   * positions for two SHORT claims and it is not safe for arbitrary bank content: the stem
   * `x + y = 14,\quad x - y = 0` rasterizes 11.4 m wide, so it spans right −4.3 to 7.1, and the
   * working line beside it spans 2.3 to 10.3. Two claims sharing 4.8 m of the same billboard plane,
   * both `depthTest:false` at `renderOrder 5`, is the ninth way to lose a claim written down in
   * `TexPanel.js`'s own header — the compositor turning a true statement into an unreadable one —
   * with panels doing it to each other instead of rock doing it to them.
   *
   * A single column cannot do that. Every row is one line tall, rows are `mathStep` apart, and
   * nothing is ever beside anything. It also reads the way a worked solution reads, top to bottom:
   *
   *     Let it settle and read it.          <- ask       (prose, above the stem)
   *     q                                   <- stem      (the claim, at `stemUp`)
   *     q = 9                               <- given
   *     1) q = 9                            <- working
   *     2) q = 17
   *     ___                                 <- entry
   *
   * `stemUp` is unchanged at 2.86, which is where `leaf9-span` stands, so the frame the engine
   * takes over still opens on the composition P15 measured: the claim above the horizon line, on
   * bare sky, ink 0.0% occluded. Everything else grows from it.
   */
  column: { right: 1.44, forward: 14 },
  /** The stem's height. The row above it is `+proseStep`, the row below `-mathStep`. */
  stemUp: 2.86,
  /** Metres between two prose rows and between two mathematics rows. */
  proseStep: 1.15,
  mathStep: 1.3,
  /**
   * Metres per em. `TexPanel`'s gate 8 refuses to present a claim under 33.3 device px per em at
   * 1280x720, and the shipped frame measures 41.7 px per em per metre at `forward 14`.
   *
   * The prose sits HIGHER than the mathematics and is therefore further away — a row at `up 4.01` is
   * 14.56 m from the camera against the stem's 14.29 — so the same metres-per-em buys fewer device
   * pixels up there. `proseEm 0.86` measured 34.5 px per em on the shipped build against a floor of
   * 33.3, and `review/measure/P34.mjs` claim R7 caught both ask rows standing in as the solid mark
   * with 3% of margin left. 0.95 measures ~38 and leaves 14%. This is exactly the trade gate 8
   * exists to force: fewer words per line, or a question nobody can read.
   */
  proseEm: 0.95,
  mathEm: 0.88,
  /**
   * Where a prose row wraps. KaTeX does not wrap, so a line is as wide as it is: 46 characters
   * measures about 21 m at `proseEm`, against 30.7 m of visible width at `forward 14`. The longest
   * `ask` the bank ships is 89 characters (`ask.gen.reshape`, Polish), which is two rows.
   */
  wrapChars: 46,
  /**
   * Rows the `ask` may take ABOVE the stem, and the wider wrap tried before any of it is cut.
   *
   * A frame budget, measured rather than chosen: a prose row's centre projects about 0.135 of NDC
   * per metre at `forward 14`, so a THIRD row above the stem lands at NDC y 1.04 and has its ink cut
   * off by the top of the screen — measured, on the shipped build, with the said claim standing
   * above the stem. Two rows is 92 characters at `wrapChars`, and the longest `ask` the bank ships
   * is 89. `wrapWide` is tried before anything is cut so content growth widens a line rather than
   * losing the end of a question, and `stats.proseClipped` counts the day that stops being enough.
   *
   * `spoken` moved BELOW the stem for the same reason and reads better there anyway: the ask is the
   * instruction, the stem is the thing, and the said claim is a statement about the thing.
   */
  maxAskLines: 2,
  wrapWide: 52,
  /** Rows the said claim may take below the stem. */
  maxSaidLines: 3,

  /**
   * Sockets, kept because `boot/92-teaching.js` publishes them and because they name the three
   * positions the authored spawn frame was measured at. These are the rows a bare item with no
   * `given` and no `working` produces; anything else is the same column with more rows in it.
   */
  sockets: {
    prose: { right: 1.44, up: 4.01, forward: 14, em: 0.86 },
    claim: { right: 1.44, up: 2.86, forward: 14, em: 0.88 },
    entry: { right: 1.44, up: 1.56, forward: 14, em: 0.88 },
    working: { right: 1.44, up: 1.56, forward: 14, em: 0.88 },
  },
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
const ASK_ID = "teach-ask";
const SAID_ID = "teach-said";
const GIVEN_ID = "teach-given";
const HINT_ID = "teach-hint";
TEACH.ids = {
  claim: CLAIM_ID,
  entry: ENTRY_ID,
  working: WORKING_ID,
  ask: ASK_ID,
  said: SAID_ID,
  given: GIVEN_ID,
  hint: HINT_ID,
  prefix: "teach-",
};

/**
 * What a keystroke may put into a response.
 *
 * Two jobs. It keeps the entry claim PARSEABLE — every character here is legal KaTeX on its own, so
 * a half-typed response can never reach `Tex.validate` as something it must refuse, and a refused
 * claim can never appear in a capture as a hollow stand-in. And it keeps the response inside the
 * grammar `ItemBank.check` canonicalizes: digits, an unknown, the four operators, relation symbols,
 * grouping, and the separators the `pair`, `partition` and `repair` answer types use.
 *
 * IT IS ALSO THE SET THE BANK HAS TO ANSWER IN, and round 2 shipped the two halves disagreeing:
 * `ItemBank.accepts()` returned `x = 8,\; y = 8` for an `answerType: "pair"`, and `\` is not on this
 * line, so the bank's own first accepted spelling could not be entered through the shipped surface
 * at all. 241 of 1,152 committed items were in that state. The repair is on the bank's side — its
 * `ENTRY_GRAMMAR` is now this same character class, `accepts()[0]` is guaranteed to satisfy it, and
 * `boot/92-teaching.js` injects the bank's copy over this default so the two cannot drift. The
 * default below is what a presenter mounted without a bank falls back to.
 */
const ENTRY_CHARS = /^[0-9a-zA-Z+\-*/=<>.,()|:; ]$/;

/**
 * An empty response slot, and the caret that follows a response being written.
 *
 * NO DECIMAL POINT ANYWHERE IN THESE, AND IT IS NOT A STYLE CHOICE.
 *
 * `Tex.localizeTex` rewrites every decimal in a claim into the locale's own convention, and it
 * exempts only the eight text-mode commands in `VERBATIM_GROUPS`. `\rule` is not one of them, so
 * `\rule{2.4em}{0.06em}` reaches KaTeX in Polish as `\rule{2{,}4em}{0{,}06em}` — which KaTeX ACCEPTS.
 * It does not throw, nothing is refused, `texFailures` stays empty, `verify` stays green, and the
 * entry row rasterizes as a white block 0.75 of NDC tall that stands in front of two lines of the
 * learner's own working. Caught on a Polish capture, not by a gate: every gate said the frame was
 * fine. `review/measure/P34.mjs` claim R8 now measures row-on-row overlap so the next one is caught
 * by a number.
 *
 * `2em` and `1pt` carry no decimal, so the scanner passes them through in all three locales. `1pt`
 * is KaTeX's 0.1 em, thicker than the 0.06 this used to ask for and comfortably above gate 8's
 * 0.045 em stroke floor.
 */
const ENTRY_RULE = "\\rule{2em}{1pt}";
const ENTRY_CARET = "\\;\\rule{1em}{1pt}";

/** TeX's own reserved characters, in the `\text{}` spellings that survive `strict: "error"`. */
const TEXT_ESCAPES = {
  "\\": "\\textbackslash{}",
  "{": "\\{",
  "}": "\\}",
  $: "\\$",
  "&": "\\&",
  "#": "\\#",
  _: "\\_",
  "%": "\\%",
  "^": "\\textasciicircum{}",
  "~": "\\textasciitilde{}",
};
const escapeText = (s) => String(s ?? "").replace(/[\\{}$&#_%^~]/g, (c) => TEXT_ESCAPES[c]);

/** Greedy word wrap. Never splits a word: a broken word in the middle of a question is a new lie. */
function wrapText(text, max) {
  const words = String(text ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let line = "";
  for (const w of words) {
    if (!line) line = w;
    else if (line.length + 1 + w.length <= max) line += ` ${w}`;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

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
   * @param {(tex:string)=>boolean} [opts.validateTex] `math/Tex.js`'s `validate`, INJECTED for the
   *   same reason the bank is: `math/` is a sibling piece. Every localized sentence this presenter
   *   stands is gated through it, so a Polish or Spanish `ask` that KaTeX cannot set is refused
   *   whole rather than rendered as a hollow stand-in beside a live question.
   * @param {RegExp} [opts.entryChars] the bank's `ENTRY_GRAMMAR`, one character at a time.
   */
  constructor(opts = {}) {
    this.session = opts.session ?? null;
    this.learning = opts.learning ?? null;
    this.bank = opts.bank ?? null;
    this.place = opts.place ?? (() => null);
    this.emit = opts.emit ?? ((name, value) => signals.emit(name, value));
    this.on = opts.on ?? ((name, fn) => signals.on(name, fn));
    this.validateTex = opts.validateTex ?? null;
    this.entryChars = opts.entryChars instanceof RegExp ? opts.entryChars : ENTRY_CHARS;

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
    /** How far up the item's own graded hint ladder the learner has asked. */
    this.hintIndex = 0;
    /** The typed response has changed and the claim below the item needs re-typesetting. */
    this._entryDirty = false;
    /** Where the entry row landed for THIS item, and how many rows stand below the stem. */
    this._entrySocket = { ...TEACH.sockets.entry };
    this._belowRows = 0;
    /** Localized rows this presenter stood, and any it had to refuse. Reported in `probe()`. */
    this._stood = [];
    this._refused = [];

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
      /** Localized sentences stood in the world, and any `Tex.validate` would not set. */
      textRows: 0,
      textRefused: 0,
      /** Questions too long for the frame budget even at the wide wrap. Must stay 0. */
      proseClipped: 0,
      /** Items whose `given` reached the surface — round 2 stood none of them. */
      givenRows: 0,
      askRows: 0,
      saidRows: 0,
      /** Rungs of the item's own graded hint ladder the learner asked for. */
      hintsShown: 0,
      hintedItems: 0,
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
    this.hintIndex = 0;
    this._stood = [];
    this._refused = [];
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
      /**
       * P19. THE OPEN READING, AND ONLY THE OPEN READING.
       *
       * `app/src/learn/verbs/` needs to know what the claim SAYS in order to let a player perform it
       * — a deck cannot be walked out over a gap nobody has described, and a bundle cannot be opened
       * ward by ward by something that has not been told there is a bundle. Until now this signal
       * carried identifiers only, so the only thing that could act on it was a renderer.
       *
       * What goes on the wire is exactly what is already standing in front of the player:
       * `world.md` §2.1's **open reading** — the stem, the charge in the socket, the lines the item
       * is about, the name of the unknown, the object class and the shape of the response. Every one
       * of those is on screen the instant this fires.
       *
       * `answer`, `distractors`, `check` and `hints` are deliberately NOT here, and that is the
       * whole design of the verb layer: a verb does real algebra on the open reading and whatever
       * falls out goes to `ItemBank.check` exactly as a typed response does. A signal carrying the
       * answer key would make every future listener a cheat channel and would make P19's own
       * measurements worthless in the same way round 2's `expected()` hook made P34's worthless.
       */
      item: {
        id: this.item.id,
        stem: this.presented?.tex?.stem ?? this.item.stem ?? "",
        given: this.presented?.tex?.given ?? this.item.given ?? [],
        working: this.item.working ?? [],
        unknown: this.presented?.unknown ?? this.item.unknown ?? "x",
        answerType: this.presented?.answerType ?? this.item.answerType ?? null,
        objectClass: this.presented?.objectClass ?? this.item.objectClass ?? null,
        form: this.item.form ?? req.form ?? null,
      },
    });

    this._display();

    this.stats.presented += 1;
    this.phase = "standing";
    return req;
  }

  /**
   * Stand the whole item: what is being asked, the claim, what is given, the build it is about,
   * and the slot the answer goes in.
   *
   * ==================================================================================================
   * WHAT ROUND 2 STOOD, AND WHY IT WAS UNANSWERABLE
   *
   * Round 2 stood `item.stem` and `item.working` and nothing else. `ItemBank.present()` was called on
   * every cycle and returned the localized `ask`, `framing`, `spoken` and three graded `hints` for
   * that item, in the player's own language, and every one of them went into the probe and stopped.
   * The consequence is not cosmetic. The bank's most common opening item is
   * `var-meaning.seat/construct`: `stem "g"`, `given ["g = 8"]`, `ask "Let it settle and read it."`,
   * answer `8`. Standing only the stem shows a player a floating `g` and requires them to type `8`.
   * 196 committed items carry a `given` and none of it reached the screen; 1,152 carry an `ask` and
   * none of it reached the screen. This is §6b happening inside the piece written to end §6b, and it
   * is the reason this method is now the longest one in the file.
   *
   * Four things stand, and each is here because without it some item is impossible rather than hard:
   *
   *   `ask`     the question, wrapped and set in `\text{}`. It is the only thing that says what to do
   *             with the claim: `ask.reading` and `ask.claim` and `ask.terms` are three completely
   *             different demands on the identical stem.
   *   `spoken`  the said claim, for the 117 items whose mathematics is a SENTENCE — "There are 3
   *             crates on my barge for every one on yours" — which the stem `a,\; b` does not carry.
   *   `given`   the charge in the socket. Already TeX, already produced, already localized.
   *   `hints`   the item's own three-rung ladder, on request. See `hint()`.
   *
   * `framing` is deliberately NOT stood: it is scene-setting, its longest spelling is 125 characters
   * (three more rows above an already two-row `ask`), and the ladder's first rung is the same class of
   * line — `hint.look.Emitter`, "a socket cut for a name, and a charge waiting outside it" — reachable
   * on request rather than pushing the question off the top of the frame. `probe().prose` reports it
   * so the choice is visible instead of silent.
   * ==================================================================================================
   */
  _display() {
    const above = [];
    const below = [];
    const p = this.presented;

    // ---------------------------------------------------------------- above the stem: the question
    const ask = typeof p?.ask === "string" ? p.ask : "";
    let askLines = wrapText(ask, TEACH.wrapChars);
    if (askLines.length > TEACH.maxAskLines) askLines = wrapText(ask, TEACH.wrapWide);
    if (askLines.length > TEACH.maxAskLines) {
      this.stats.proseClipped += 1;
      askLines = askLines.slice(0, TEACH.maxAskLines);
    }
    askLines.forEach((line, i) => above.push({ id: `${ASK_ID}-${i}`, text: line, kind: "ask" }));

    // ---------------------------------------------------------------- below the stem: the mathematics
    /**
     * The said claim, for the 117 items whose mathematics is a sentence. `spoken.var-meaning.relate`
     * is "There are 13 crates on my barge for every one on yours" and the stem is `a,\; b` — without
     * this row the item is a pair of letters and an instruction to write a claim about nothing.
     */
    const spoken = typeof p?.spoken === "string" ? p.spoken : "";
    const saidLines = wrapText(spoken, TEACH.wrapChars).slice(0, TEACH.maxSaidLines);
    saidLines.forEach((line, i) => below.push({ id: `${SAID_ID}-${i}`, text: line, kind: "said" }));

    /**
     * The charge that is actually in the socket. `ItemBank.present()` hands this over as
     * `tex.given` — TeX, untouched, exactly like the stem — so standing it is one loop and no new
     * anything. It is the difference between a floating `g` and `g` with `g = 8` under it.
     */
    const given = Array.isArray(p?.tex?.given) ? p.tex.given : Array.isArray(this.item?.given) ? this.item.given : [];
    given.forEach((tex, i) => below.push({ id: `${GIVEN_ID}-${i}`, tex, kind: "given" }));

    /**
     * The lines the item is ABOUT, when it has them. A `repair` item is a shown build with one
     * joint wrong — without the build on screen there is nothing to repair, so this is the item, not
     * decoration. Each line is its own claim rather than one `array` environment because `math:show`
     * types one expression and `TexPanel`'s gates are written per expression.
     */
    const lines = Array.isArray(this.item?.working) ? this.item.working : [];
    lines.forEach((tex, i) => below.push({ id: `${WORKING_ID}-${i}`, tex: `${i + 1})\\;${tex}`, kind: "working" }));

    /**
     * THE MODEL PHASE, which is the whole reason `learn:teach` is consumed rather than counted.
     *
     * `model.phases.trueGuessByPhase.model` is 0.70 — "the world has just performed the identical act
     * in front of the learner" — and `phases.unscored` holds `model`, so the engine already treats
     * this as inert in both directions. The world demonstrating is therefore free, and refusing to
     * demonstrate would make the announcement a lie. `hintShown` records that it happened, and it is
     * reported on the outcome, so the response is priced as what it was.
     *
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
        below.push({ id: `${WORKING_ID}-model`, tex: shown, kind: "model" });
        this.hintShown = true;
      }
    }

    /**
     * THE EMPTY SLOT, AND WHY IT STANDS BEFORE THERE IS ANYTHING IN IT.
     *
     * Round 2's `_showEntry` returned early while `this.response` was empty, so the game gave a
     * player no indication whatsoever that a response was possible — the loop opened, mathematics
     * appeared, and the only way to discover that typing does anything was to guess. A rule at the
     * bottom of the column is the smallest honest statement of "this is where your answer goes", and
     * it is retired with the rest of the item in `_retire()`.
     */
    below.push({ id: ENTRY_ID, tex: ENTRY_RULE, kind: "entry" });

    // ---------------------------------------------------------------- place the column
    const col = TEACH.column;
    above.forEach((row, i) => {
      const socket = { ...col, up: TEACH.stemUp + (above.length - i) * TEACH.proseStep, em: TEACH.proseEm };
      this._showText(row.id, row.text, socket, row.kind);
    });

    const stem = p?.tex?.stem ?? this.item?.stem ?? "";
    if (stem) this._show(CLAIM_ID, stem, { ...col, up: TEACH.stemUp, em: TEACH.mathEm }, "claim");

    below.forEach((row, i) => {
      const up = TEACH.stemUp - (i + 1) * TEACH.mathStep;
      if (row.text) {
        this._showText(row.id, row.text, { ...col, up, em: TEACH.proseEm }, row.kind);
        return;
      }
      const socket = { ...col, up, em: TEACH.mathEm };
      if (row.id === ENTRY_ID) this._entrySocket = socket;
      this._show(row.id, row.tex, socket, row.kind);
      if (row.kind === "given") this.stats.givenRows += 1;
    });
    this._belowRows = below.length;
  }

  /**
   * One localized SENTENCE, standing in the world as mathematics does.
   *
   * `\text{}` and the existing `_show`/`TexPanel` path — no HUD, no DOM, no second renderer. The
   * gate is the point: `Tex.validate` runs `strict: "error"` KaTeX over the escaped sentence before
   * it is sent, so a locale whose diacritics or punctuation KaTeX will not set is refused WHOLE and
   * counted, rather than reaching the rasterizer and standing as a hollow mark next to a live
   * question. That is RESUME's round-2 rule applied to prose: partially-rendered mathematics is a
   * different and false statement, and a partially-rendered question is a different question.
   */
  _showText(id, plain, socket, kind = "text") {
    const text = String(plain ?? "").trim();
    if (!text) return false;
    const tex = `\\text{${escapeText(text)}}`;
    if (this.validateTex && !this.validateTex(tex)) {
      this.stats.textRefused += 1;
      this._refused.push({ id, kind, text });
      return false;
    }
    this._show(id, tex, socket, kind);
    this.stats.textRows += 1;
    if (kind === "ask") this.stats.askRows += 1;
    if (kind === "said") this.stats.saidRows += 1;
    return true;
  }

  /** `math:show` — one expression, at one socket. The seam that had no emitter. */
  _show(id, tex, socket, kind = "claim") {
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
    const was = this._stood.find((r) => r.id === id);
    if (was) was.tex = tex;
    else this._stood.push({ id, kind, tex, up: round2(socket.up), em: socket.em });
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
    this._stood = [];
    this.mark = null;
  }

  // -------------------------------------------------------------------------- the response

  /** One character of a constructed response. Returns false when the character is refused. */
  type(ch) {
    if (this.phase !== "standing") return false;
    const c = String(ch ?? "");
    if (c.length !== 1 || !this.entryChars.test(c)) return false;
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

  /**
   * The response slot, standing whether or not there is anything in it.
   *
   * Empty is a rule; written-on is the response with a caret after it, so the slot never disappears
   * and a learner who backspaces to nothing is not left staring at a question with no visible way to
   * answer it. Every character `entryChars` admits is legal KaTeX on its own, so no half-typed
   * response can reach `Tex.validate` as something it must refuse — measured over 37 partial
   * spellings including `x =`, `2 |`, `1:` and `(`, all of which typeset.
   */
  _showEntry() {
    const tex = this.response ? `${this.response}${ENTRY_CARET}` : ENTRY_RULE;
    this._show(ENTRY_ID, tex, this._entrySocket, "entry");
  }

  /**
   * The next rung of the item's OWN graded hint ladder, into the world.
   *
   * `ItemBank.present()` has been returning three localized hints per item since P17 and nothing has
   * ever shown one. There is no new pedagogy here and no new content: rung 0 is the item's
   * `hint.look.<objectClass>` line, rung 1 moves, rung 2 states. It is pulled by the learner rather
   * than pushed by a timer, and asking sets `hintShown`, which `commit()` already reports as
   * `hinted` — so the engine prices a hinted response as a hinted response. `model.phases`'s
   * `hintedNote` is explicit that this must be what the world ACTUALLY did, never inferred.
   */
  hint() {
    if (this.phase !== "standing") return null;
    const hints = Array.isArray(this.presented?.hints) ? this.presented.hints : [];
    if (this.hintIndex >= hints.length) return null;
    const i = this.hintIndex;
    /**
     * ONE ROW, REPLACED, and not a growing stack. `math:show` is idempotent on `id`, so re-sending
     * `teach-hint` re-typesets the rung in place. The reason is the frame and it is measured: the
     * deepest item the bank ships puts seven rows under the stem, and three accumulating hint rows
     * under THAT project past NDC y −1 — a rung a player cannot see is not a rung. A ladder whose
     * rungs supersede each other is also what "graded" means: rung 2 says everything rung 1 did.
     */
    const socket = {
      ...TEACH.column,
      up: TEACH.stemUp - (this._belowRows + 1) * TEACH.mathStep,
      em: TEACH.proseEm,
    };
    const ok = this._showText(HINT_ID, hints[i], socket, "hint");
    this.hintIndex += 1;
    if (!this.hintShown) this.stats.hintedItems += 1;
    this.hintShown = true;
    this.stats.hintsShown += 1;
    return ok ? hints[i] : null;
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
      /**
       * The localized surfaces the bank resolved for this item, BESIDE the rows actually standing in
       * the world. Round 2 published the left half of this and stood none of it, which is exactly the
       * failure that has to be readable off a probe rather than argued about: `stood` is what
       * `math:show` was called with, so a reviewer can check character for character that what
       * `ItemBank.text()` returned is what is in front of the player.
       *
       * `framing` is reported and deliberately not stood — see `_display`.
       */
      prose: this.presented
        ? {
            ask: this.presented.ask,
            spoken: this.presented.spoken,
            framing: this.presented.framing,
            hints: this.presented.hints,
            hintIndex: this.hintIndex,
            validated: !!this.validateTex,
          }
        : null,
      stood: this._stood.map((r) => ({ ...r })),
      refused: this._refused.map((r) => ({ ...r })),
      entryUp: round2(this._entrySocket?.up ?? 0),
      grammar: String(this.entryChars),
      stats: { ...this.stats },
    };
  }
}
