/**
 * P19 — the verb runtime. The half of the learning loop that had no code in it at all.
 *
 * ==================================================================================================
 * WHAT WAS MISSING
 *
 * `RESUME.md` §6d, measured on the shipped app on 2026-08-10:
 *
 *     learn:present  1      the engine chose a knowledge point
 *     math:show     11      the world-space renderer displayed it
 *     learn:respond  0      <- nothing, ever
 *     learn:mastery  0      <- nothing, ever
 *
 * "Screen -> engine does not exist, and it is not a wiring bug. Nothing can emit `learn:respond`
 * because **P19 (in-world learning verbs) was never built**. There is no way for a player to answer."
 *
 * This file is the answer path. Five physical acts live beside it, one per file, and every one of
 * them is a thing a player does with their body in a world rather than a thing they select from a
 * list. `design/quality-bar.md` L1 is the test: "a critic plays it and says what they did with their
 * hands." So what they did with their hands is: walked a deck out over a gap until it was long
 * enough; got hold of a term and carried it over a doorsill, where it turned around; pushed two
 * terms together and felt one of them refuse; drove a value into a lock until it reached the last
 * ward; and turned a rail over and felt the detent go to the other side of the mark.
 *
 * ==================================================================================================
 * WHO EMITS `learn:respond`, AND WHY IT IS NOT THIS FILE
 *
 * A verb could emit `learn:respond` itself. It would be one line and it would be wrong, and
 * `RESUME.md` §6b is the reason: this project's dominant defect is work that is correct and connected
 * to nothing. A `learn:respond` emitted here would be *heard* — `boot/92-teaching.js`'s trace counts
 * it, `Teaching` retires on it — while `Mastery` never saw the response at all, so the count would go
 * up, the trace would look closed, and no mastery would move. That is §6b with a green light on it.
 *
 * So the response goes down the path the engine already owns and has already been audited on:
 *
 *     verb resolves  ->  Teaching.type() x n  ->  Teaching.commit()
 *                    ->  ItemBank.check()      (the SHIPPED checker marks it)
 *                    ->  Session.submit -> Scheduler.submit -> Mastery.respond
 *                    ->  learn:respond  +  learn:mastery      (ONE emitter, ONE count)
 *
 * `Mastery._emitRespond` already puts `itemId`, `correct`, `latencyMs`, `response`, `family`, `form`,
 * `phase`, `hinted`, `difficulty` and `mode` on that signal, and its own comment says `phase`,
 * `hinted`, `difficulty` and `mode` "are the whole scaffold level of the response". This runtime adds
 * nothing to that payload and duplicates none of it; `probe("verbs").lastResponse` carries the verb's
 * own record of the same event, including `scaffoldLevel`, so the two can be compared.
 *
 * THE FAMILY. `Mastery.respond` substitutes `UNREPORTED_FAMILY` for a missing report and refuses to
 * score the response on any cell that has a refused family — 24 of the bank's 96 cells. The family
 * reaches it because `Teaching.commit` copies `this.req.family` onto the outcome, which is the fix
 * P34 already landed. This runtime therefore MUST commit through `Teaching` rather than around it,
 * and `probe("verbs").familyOnWire` counts the responses that arrived with one, so a regression shows
 * up as a number rather than as silence.
 *
 * ==================================================================================================
 * THE ANSWER SPACE IS NOT NARROWED, AND THAT IS THE POINT
 *
 * `learn/Teaching.js`'s header refuses to stand three candidates and let the learner pick: a pick-one
 * presentation of a `construct` item is `guided-2` wearing a workshop, and crediting it at construct's
 * 0.03 guess parameter is the arithmetic error `content/knowledge-graph.json` forbids at length.
 *
 * A physical verb can reopen that leak, so none of these do. No verb is ever handed the answer or the
 * distractors — `learn:present` carries the OPEN READING only (stem, given, working, unknown, object
 * class, answer type) and the verbs do real algebra on it. No verb offers a menu: a deck is walked to
 * any length in [-40, 40] over any denominator up to 12, a claim can be taken apart in any order, and
 * a lock can be left open at any ward. And no verb shows fit while the hand is still on the claim —
 * see `Claim.js`'s header for why a world that leans toward the right answer is a world you can sweep.
 */

import Span from "./Span.js";
import Balance from "./Balance.js";
import Combine from "./Combine.js";
import Distribute from "./Distribute.js";
import Tilt from "./Tilt.js";

/**
 * Order matters and it is not arbitrary. A threshold leans by design and must never be posed by a
 * verb that treats a lean as a fall, so TILT sees every claim first. A bundle is opened before a load
 * is gathered (§2.1 rule 8, outward-in, top first), so DISTRIBUTE precedes COMBINE. A claim across a
 * Sill is BALANCE's. SPAN is last because it poses anything that closes at a quantity, which is most
 * of the bank, and letting it go first would swallow claims the other four say better.
 */
export const VERBS = [Tilt, Distribute, Combine, Balance, Span];

/** Where the verb's hands stand: nearer the camera than the claim, so the two never share a plane. */
export const HAND = {
  right: 1.44,
  forward: 9.5,
  em: 0.66,
  /**
   * The prose rows that carry the world's read, under the hands.
   *
   * `wrapChars` is 34 and not "as many as fit", because round 2 stood
   * `fail.partial.open` as one 52-character line at `em 0.6` and the last seven characters were off
   * the right edge of a 1280x720 frame: "...and shut on the ot". `RESUME.md` §6a's round-2 rule was
   * written about mathematics — "a claim that cannot be rendered in full must never render
   * partially" — and it is the same rule for a sentence: a read that is cut is a different read.
   * Three rows at 34 characters is 102, and the longest `fail.*` spelling in any of the three
   * shipped locales is 63.
   */
  readUp: -1.7,
  readEm: 0.58,
  readStep: 0.62,
  readWrap: 34,
  readRows: 3,
  /**
   * WHERE THE HANDS SIT RELATIVE TO THE CLAIM, AND WHY IT IS MEASURED RATHER THAN CHOSEN.
   *
   * Round 1 stood this column at a fixed height and `review/shots/P19/01-keyboard-cycle.png` shows
   * what that is worth: the presenter's stem `x + y = 14,\quad x - y = 0` and the verb's own
   * `x = 0, y = 0` drawn through each other, both `depthTest:false` at the same renderOrder, both
   * unreadable. `math/TexPanel.js`'s header calls that "the ninth way to lose a claim" — the
   * compositor turning a true statement into an unreadable one — and it is worse here than between
   * two authored claims, because one of the two is the thing the player is doing.
   *
   * The presenter's column is not a fixed depth either: it grows a row per `given`, per `working`
   * line, per wrapped line of the question and per line of a said claim, so its lowest row lands
   * anywhere from `up 6.3` to `up -3.6` depending on the item. So the hands READ where it ends —
   * `probe("teaching").stood[].up`, published for exactly this kind of question — and stand a row
   * under the lowest of them, converted from the presenter's depth to this one so the two columns
   * are separated ON SCREEN and not merely in metres.
   */
  gapUnderEntry: 1.7,
  presenterForward: 14,
  /** Sim seconds a read stands after the claim falls. Shorter than Teaching's own feedback window. */
  readSeconds: 1.5,

  /**
   * WHERE THE CLAIM IS ALLOWED TO BE BEFORE THE WORLD PUTS IT BACK IN FRONT OF YOU.
   *
   * Round 2's off-screen failure, measured by the critic at 1280x720: after 1.6 s of `KeyW` the
   * presenter's five rows projected to y = −4727 … −1900 and both verb rows were behind the camera.
   * "Two of my three mid-performance screenshots contain no mathematics at all."
   *
   * There were two separate bugs under that one sentence and the second is the one that matters:
   *
   *   1. The body walked while the hands worked, because the left stick is both axes. Fixed by the
   *      stance — see `VerbRuntime.fixed`.
   *   2. **A column that had drifted could not be moved.** `math/TexPanel.js`'s `TexField.add()`
   *      calls `setTex` and `setLocale` on an id it already holds and NEVER reads `position`, so
   *      round 2's one-shot restand — which re-emitted `math:show` with a fresh `at` — did precisely
   *      nothing, in either column. It was not that the restand fired too rarely. It never moved a
   *      single panel in its life. Moving a claim means `math:hide` and then `math:show`, and that is
   *      what `_restand` now does.
   *
   * The box below is checked EVERY step while a claim is held, in the camera's own frame: how far
   * ahead the column is, and how far off the axis it has got as a fraction of that. The limits sit
   * inside the frustum with room to spare, so a column is put back before it clips rather than after.
   *
   * The lateral limit is `tan 17deg` and not the frustum's own `tan 39deg`, because the test is run
   * against the column's ANCHOR and a row of prose is two metres wide either side of it. Round 3's
   * first capture (`review/shots/P19-r3/A-after-turning.png`) is what set the number: every anchor
   * projected on screen and the left third of "Cut two sockets under different names" did not.
   */
  keepAhead: 3.2,
  keepBehind: 26,
  keepLateral: 0.3,
  keepVertical: 0.22,
  /** Sim seconds between restands, so a player spinning on the spot is not a raster storm. */
  restandEvery: 0.2,
};

const PREFIX = "verb-";

/** TeX's reserved characters, in the `\text{}` spellings that survive `strict: "error"`. */
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

/** Greedy word wrap. Never splits a word: a broken word in a sentence is a new sentence. */
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

export class VerbRuntime {
  /**
   * @param {object} opts
   * @param {(name:string,value:any)=>void} opts.emit
   * @param {(name:string,fn:Function)=>Function} opts.on
   * @param {()=>({o:number[],f:number[],r:number[]})|null} opts.basis  the camera frame, sampled once
   *   per claim so the hands stand still in the world instead of following the head.
   * @param {()=>object|null} opts.teaching   the mounted presenter. INJECTED, never imported: it is
   *   P18/P34's file and this is P19's. `boot/64-verbs.js` is where the two are allowed to meet.
   * @param {object|null} opts.bank           P17's `ItemBank`, for `check` (the misconception tag)
   *   and `text` (the localized read). Never for `item.answer`, which no verb ever sees.
   * @param {(tex:string)=>boolean} [opts.validateTex]
   */
  constructor(opts = {}) {
    this.emit = opts.emit ?? (() => {});
    this.on = opts.on ?? (() => () => {});
    this.basis = opts.basis ?? (() => null);
    this.getTeaching = opts.teaching ?? (() => null);
    this.bank = opts.bank ?? null;
    this.validateTex = opts.validateTex ?? null;
    /**
     * PLANT THE FEET. Injected, because the body is `play/Locomotion.js`'s and this is not that piece
     * — `boot/64-verbs.js` is where the two are allowed to meet, and its header carries the argument.
     * Called with `true` on every step a claim is held and `false` the step it is set down.
     */
    this.plantBody = opts.plant ?? (() => {});
    /**
     * MOVE THE PRESENTER'S COLUMN. Also injected: the question, the given and the entry slot are
     * `learn/Teaching.js`'s rows and this piece does not own their layout. What it hands over is a
     * change of basis — where the player was when the claim was stood, where they are now — and the
     * boot module re-stands whatever is actually in the field at the same place in the new frame.
     */
    this.rebase = opts.rebase ?? (() => 0);

    this.simTime = 0;
    this.act = null;
    this.ctx = null;
    /** The last `learn:present` payload, so a claim you put down can be picked back up. */
    this.present = null;
    this.anchor = null;
    this.standing = new Map();
    this.hand = { move: { x: 0, y: 0 }, held: new Set(), work: 0 };
    /**
     * THE TRIGGERS, AND WHY THE VERB NEEDS AN AXIS THAT IS NOT THE LEFT STICK.
     *
     * The body can work a claim — leaning into a term carries it, and walking a deck out is exactly
     * what walking a deck out means. But the left stick also WALKS, so a player who works a claim
     * with it walks away from the thing they are working, and past a few metres the claim is behind
     * them. Measured: `review/shots/P19/verb-span.png`, round 1, a legible claim at 40.4 px per em
     * standing 9.5 m in front of where the player USED to be and out of frame at the top.
     *
     * So both routes exist and they are the same axis. `primary`/`secondary` are analog on a pad
     * (Pad:RT / Pad:LT) and are the two mouse buttons on a keyboard, neither of them moves the
     * player, and both carry a 0..1 value — a squeeze is a push. The stick stays wired because it is
     * legible and because the shape of the act is "lean into it", and the column re-stands when the
     * player genuinely leaves it behind (see `fixed`).
     */
    this.trigger = { push: 0, pull: 0, since: 0 };
    this.stepCharge = 0;
    this.readUntil = 0;
    /** How many times a column had to re-stand because the player looked away from it. */
    this.restands = 0;
    this.restandAt = -9;
    /** Sim steps the body was held still because the hands were on a claim. */
    this.planted = 0;
    /** Claims picked up and put down again without an answer. Never a stuck player. */
    this.letGos = 0;
    /** What the entry slot last had synced into it, so an unchanged build costs no raster. */
    this.entrySynced = null;
    this.lastResponse = null;
    this.phase = "idle";

    this.stats = {
      presented: 0,
      posed: 0,
      unposed: 0,
      byVerb: {},
      unposedByType: {},
      committed: 0,
      correct: 0,
      /** Distinct verb ids this session has actually posed. One is the round-2 failure state. */
      distinctVerbs: 0,
      /** Characters the presenter's own keyboard handler put in the slot while a claim was held. */
      strayChars: 0,
      /**
       * Commits where the slot did not hold what the hands built. Must stay 0: it is the number that
       * says no stray keystroke ever reached `Mastery`, which is the round-2 defect stated as a
       * measurement rather than as a mechanism.
       */
      commitMismatch: 0,
      /** Responses whose family reached `Mastery` — the number P34's delivery defect shows up in. */
      familyOnWire: 0,
      /** Characters `ItemBank.ENTRY_GRAMMAR` refused. Must stay 0: a mangled response is a lie. */
      refusedChars: 0,
      /** Reads the world stood, and any the strict pipeline would not set in this locale. */
      reads: 0,
      readsRefused: 0,
      shows: 0,
      hides: 0,
      respondHeard: 0,
      masteryHeard: 0,
    };
    this._offs = [];
  }

  // ------------------------------------------------------------------------ wiring

  attach() {
    if (this._offs.length) return this;

    /**
     * `learn:present` — the engine has chosen, the presenter has stood it, and now something has to
     * be able to answer it. `payload.item` is the OPEN READING and nothing else; see
     * `learn/Teaching.js`, where it is assembled, and note what is deliberately not on it.
     */
    this._offs.push(
      this.on("learn:present", (e) => {
        if (!e) return;
        this.stats.presented += 1;
        this.present = e;
        this._pose(e);
      })
    );

    this._offs.push(
      this.on("input:move", (e) => {
        this.hand.move.x = Number.isFinite(e?.x) ? e.x : 0;
        this.hand.move.y = Number.isFinite(e?.y) ? e.y : 0;
        /**
         * The stance, taken on the edge rather than a step later.
         *
         * `play/Input.js` emits `input:move` only when the vector CHANGES, and `play/Locomotion.js`
         * registered its listener first (order 30 against this piece's 64), so the body has already
         * taken the new intent by the time this runs. Planting here means the step the stick moves is
         * the step the body does not — see `fixed` for the standing guard that covers the other case,
         * a claim posed while the stick is already held over.
         */
        if (this.phase === "performing") this.plantBody(true);
      })
    );

    /**
     * `input:action` — actions, never keys. Everything below is bound on the pad as well as the
     * keyboard in `play/bindings.js`'s default tables, which is what makes these verbs playable on a
     * controller: `interact` is Pad:X, `primary` is Pad:RT, `secondary` is Pad:LT, and
     * `cyclePrev`/`cycleNext` are Pad:LB/Pad:RB. The continuous axis is the left stick, arriving as
     * `input:move`, so the deck is walked out with the same thumb that walks the player — and while
     * a claim is in your hands that thumb ONLY does that, because the feet are planted. Round 2 wired
     * the stick to both at once and the critic measured the consequence: "I kept holding W, the
     * counter kept climbing, and I was performing algebra into an empty orange sky."
     */
    this._offs.push(
      this.on("input:action", (e) => {
        if (!e?.action) return;
        const down = e.phase === "down";
        if (down) this.hand.held.add(e.action);
        else this.hand.held.delete(e.action);
        if (e.action === "primary") this.trigger.push = down ? Math.max(0.35, Number(e.value) || 1) : 0;
        if (e.action === "secondary") this.trigger.pull = down ? Math.max(0.35, Number(e.value) || 1) : 0;
        if (down && (e.action === "primary" || e.action === "secondary")) this.trigger.since = this.simTime;
        if (e.action === "interact" && down) {
          this._interact();
          return;
        }
        if (!this.act) return;
        switch (e.action) {
          case "primary":
            // Tap: the act appropriate to what is under your hand. Hold: the same work the body
            // does by leaning into it, without taking a step. See `_work`.
            if (down) this._drive("take");
            break;
          case "secondary":
            if (down) this._drive("back");
            break;
          case "crouch":
            // Set your feet. The second grip: ten spans at a time, a rail turned over, both pans
            // gathered rather than shared. Held state, not an edge, so a verb reads it every step.
            this._drive(down ? "hold" : "release");
            break;
          case "cycleNext":
            if (down) this._drive("stepNext");
            break;
          case "cyclePrev":
            if (down) this._drive("stepPrev");
            break;
          default:
            break;
        }
      })
    );

    /**
     * `learn:respond` — the engine's verdict on what the hands built. The world answers the
     * MISCONCEPTION, not the response: `voice.md` §4, "A claim that falls is information about the
     * claim, never a verdict about the person."
     */
    this._offs.push(
      this.on("learn:respond", (e) => {
        if (!e || !this.act) return;
        this.stats.respondHeard += 1;
        if (e.family != null && typeof e.family === "string") this.stats.familyOnWire += 1;
        /**
         * A COMMIT THIS RUNTIME DID NOT MAKE IS STILL THIS RUNTIME'S BUILD.
         *
         * `boot/92-teaching.js` binds Enter straight to `Teaching.commit()`, and since `_syncEntry`
         * keeps the entry slot holding what the hands built, Enter is now a second, legitimate way to
         * set a claim down. Without this the record would still describe the PREVIOUS claim and
         * `probe("verbs").lastResponse` would quietly disagree with the signal beside it — which is
         * exactly the class of half-connected reporting `RESUME.md` §6b is about.
         */
        if (this.lastResponse?.itemId !== (e.itemId ?? null)) this._record(this.entrySynced ?? "");
        if (this.lastResponse) {
          this.lastResponse.correct = e.correct === true;
          this.lastResponse.scored = e.scored === true;
          this.lastResponse.credited = e.credited === true;
          this.lastResponse.family = typeof e.family === "string" ? e.family : null;
          this.lastResponse.form = e.form ?? null;
          this.lastResponse.phase = e.phase ?? null;
          this.lastResponse.misconception = e.misconception ?? null;
          this.lastResponse.engineLatencyMs = e.latencyMs ?? null;
        }
        if (e.correct === true) this.stats.correct += 1;
        this._stand(e.correct === true);
      })
    );

    this._offs.push(
      this.on("learn:mastery", () => {
        this.stats.masteryHeard += 1;
      })
    );

    return this;
  }

  dispose() {
    for (const off of this._offs) off?.();
    this._offs.length = 0;
    this._retire();
    // A torn-down runtime that left the feet planted would be a piece that removed the player's
    // ability to walk on its way out.
    this.plantBody(false);
  }

  // ------------------------------------------------------------------------ posing

  _pose(present) {
    this._retire();
    const raw = present.item ?? null;
    if (!raw || typeof raw !== "object") {
      this.stats.unposed += 1;
      this.stats.unposedByType.noItem = (this.stats.unposedByType.noItem ?? 0) + 1;
      return;
    }
    const ctx = {
      itemId: present.itemId ?? raw.id ?? null,
      kpId: present.kpId ?? null,
      form: present.form ?? raw.form ?? null,
      stem: raw.stem ?? "",
      given: Array.isArray(raw.given) ? raw.given : [],
      working: Array.isArray(raw.working) ? raw.working : [],
      unknown: raw.unknown ?? "x",
      answerType: raw.answerType ?? null,
      objectClass: raw.objectClass ?? null,
    };
    this.ctx = ctx;

    let act = null;
    for (const verb of VERBS) {
      try {
        act = verb.pose(ctx);
      } catch {
        act = null;
      }
      if (act) break;
    }
    if (!act) {
      // An honest answer, not a failure: `learn/Teaching.js`'s typed entry is still standing behind
      // every claim, so a shape no verb reads stays answerable. The count is published so the gap is
      // a measured number rather than an assumption.
      this.stats.unposed += 1;
      const k = `${ctx.objectClass ?? "?"}/${ctx.form ?? "?"}/${ctx.answerType ?? "?"}`;
      this.stats.unposedByType[k] = (this.stats.unposedByType[k] ?? 0) + 1;
      this.phase = "idle";
      return;
    }

    this.act = act;
    this.anchor = this.basis();
    // Sampled on the first render, not here: the presenter emits `learn:present` BEFORE it stands
    // its own rows, so its column depth is still the previous claim's at this instant.
    this._topUp = null;
    this.phase = "performing";
    this.startedAt = this.simTime;
    this.stats.posed += 1;
    this.stats.byVerb[act.id] = (this.stats.byVerb[act.id] ?? 0) + 1;
    this.stats.distinctVerbs = Object.keys(this.stats.byVerb).length;
    this.entrySynced = null;
    // NOT rendered here. `Teaching._present()` emits `learn:present` and only THEN stands its own
    // rows, so a column measured inside this handler is measured against the claim before this one.
    // The first `fixed()` is the earliest moment the presenter can honestly be asked how tall it is.
  }

  // ------------------------------------------------------------------------ driving

  _drive(name) {
    if (!this.act || this.phase !== "performing") return;
    try {
      this.act.act(name, this.hand);
    } catch {
      /* a verb that cannot perform an act simply does not perform it */
    }
    this._render(true);
  }

  /**
   * The horizontal axis slides the grip, in steps, with a charge so a stick held over does not walk
   * the hand along the whole load in one frame. Bumpers do the same thing discretely for a player who
   * would rather not use the stick for it.
   */
  _slide(step) {
    const x = this.hand.move.x;
    if (Math.abs(x) < 0.45) {
      this.stepCharge = 0;
      return;
    }
    this.stepCharge -= step;
    if (this.stepCharge > 0) return;
    this.stepCharge = 0.22;
    this._drive(x > 0 ? "stepNext" : "stepPrev");
  }

  /**
   * One work axis, from either hand.
   *
   * The stick's forward push and the right trigger's squeeze are the same movement as far as every
   * verb is concerned, so they are resolved here rather than five times over. A trigger only starts
   * working after a quarter of a second, because its edge already fired the discrete act and a tap
   * must not also be a shove.
   */
  _work() {
    const stick = Math.abs(this.hand.move.y) > 0.12 ? this.hand.move.y : 0;
    const heldFor = this.simTime - this.trigger.since;
    const squeeze = heldFor >= 0.25 ? this.trigger.push - this.trigger.pull : 0;
    return Math.abs(squeeze) > Math.abs(stick) ? squeeze : stick;
  }

  fixed(step, simTime) {
    this.simTime = simTime ?? this.simTime + step;
    if (this.phase === "read" && this.simTime >= this.readUntil) this._retire();

    /**
     * THE STANCE. Your feet are planted for exactly as long as your hands are on the claim.
     *
     * This is the first of the critic's two sanctioned fixes for the off-screen failure — "freeze the
     * body's translation while a claim is held so the stick is purely the verb axis" — and it is the
     * one that is also better to play. Taking a claim on is a stance, the way drawing a bow is a
     * stance: you stop, you work it, you set it down and you walk on. It costs nothing, it removes a
     * whole class of failure rather than compensating for it, and it makes the left stick mean one
     * thing at a time instead of two.
     *
     * Re-asserted every step and not once on entry, because a claim can be posed while the stick is
     * already held over and no further `input:move` will ever arrive to notice — and released the
     * same way, on the step the hands come off, so the read that stands afterwards is walkable.
     */
    const holding = this.phase === "performing" && !!this.act;
    this.plantBody(holding);
    if (!holding) return;
    this.planted += 1;

    this._keepInFrame();
    // The presenter's own keyboard handler admits `w`, `a`, `s` and `d`; while a claim is in your
    // hands the slot says what your hands built and nothing else. See `_syncEntry`.
    this._syncEntry();
    // The second grip is a state, not an edge: a verb reads it every step.
    if (!this.hand.held.has("crouch") && this.act.fine) this.act.act("release", this.hand);
    this._slide(step);
    this.hand.work = this._work();
    try {
      this.act.fixed(step, { ...this.hand, move: { x: this.hand.move.x, y: this.hand.work } });
    } catch {
      /* never let a verb take the kernel down with it */
    }
    this._render();
  }

  /**
   * Put the claim back in front of the player when it has genuinely left the frame.
   *
   * With the feet planted this is about the HEAD, not the body: a player who turns to look at
   * something has not abandoned the claim they are holding, and a claim in your hands does not stay
   * behind you. The test is the camera's own frame — how far ahead the column is and how far off the
   * axis as a fraction of that — with margins inside the frustum so a column is put back before it
   * clips rather than after.
   *
   * Both columns move together, in one change of basis, so the question and the hands keep exactly
   * the separation `_top()` measured for them. Round 2's two columns re-based independently and
   * "diverged in opposite directions"; there is only one transform here and both take it.
   */
  _keepInFrame() {
    const b = this.basis();
    if (!b || !this.anchor) return false;
    if (this.simTime - this.restandAt < HAND.restandEvery) return false;
    const p = this._place({ up: 0, right: 0 });
    if (!p) return false;
    const dx = p[0] - b.o[0];
    const dy = p[1] - b.o[1];
    const dz = p[2] - b.o[2];
    const fwd = dx * b.f[0] + dz * b.f[1];
    const lat = dx * b.r[0] + dz * b.r[1];
    const inFrame =
      fwd > HAND.keepAhead &&
      fwd < HAND.keepBehind &&
      Math.abs(lat) < fwd * HAND.keepLateral &&
      Math.abs(dy) < fwd * HAND.keepVertical;
    if (inFrame) return false;

    const from = this.anchor;
    this.anchor = b;
    this.restands += 1;
    this.restandAt = this.simTime;
    /**
     * A MOVE IS A HIDE AND THEN A SHOW, and this line is the whole of round 2's second bug.
     * `TexField.add()` on an id it already holds calls `setTex` and `setLocale` and never touches
     * `position`, so re-emitting `math:show` at a new `at` moved nothing at all. Standing the rows
     * down first is what makes the new position real.
     */
    for (const id of [...this.standing.keys()]) {
      this.emit("math:hide", { id });
      this.stats.hides += 1;
    }
    this.standing.clear();
    try {
      this.rebase(from, b);
    } catch {
      /* the presenter's column staying put is a worse frame, never a broken one */
    }
    this._render(true);
    return true;
  }

  /**
   * The entry slot says what the hands built, and nothing else can write in it.
   *
   * `boot/92-teaching.js` feeds every character `ItemBank.ENTRY_GRAMMAR` admits from a raw `keydown`
   * straight to `Teaching.type()`, and that grammar contains `w`, `a`, `s`, `d` and space. The critic
   * measured it on the shipped app: "holding W then A then S puts the string `was` in the world-space
   * answer slot, the presenter renders it as `wad \;\rule{1em}{1pt}` beside the claim, and pressing
   * Enter commits it — Mastery scored it and theta went to −1.173476."
   *
   * That handler is P34's file and this piece does not edit it. It does not have to: while a claim is
   * in the verb runtime's hands, the runtime OWNS the slot and writes the current build into it every
   * step it changes. A stray movement key survives at most one sixtieth of a second, Enter commits
   * what the hands built rather than what the feet typed, and the strays are counted rather than
   * silently swallowed so a regression shows up as a number.
   *
   * It also earns its keep in the other direction: the slot under the question is now a live reading
   * of the deck, the row or the system you are holding, in the presenter's own column, in the
   * player's own language of notation.
   */
  _syncEntry() {
    const teaching = this.getTeaching();
    if (!teaching || teaching.open !== true) return;
    let want = null;
    try {
      want = this.act?.response?.() ?? null;
    } catch {
      want = null;
    }
    want = typeof want === "string" ? want : "";
    const have = typeof teaching.response === "string" ? teaching.response : "";
    if (have === want) {
      this.entrySynced = want;
      return;
    }
    // Anything in the slot that is not the build is a stray: count the difference honestly rather
    // than assuming every mismatch is a keystroke.
    if (this.entrySynced != null && have !== this.entrySynced) this.stats.strayChars += Math.abs(have.length - this.entrySynced.length) || 1;
    let guard = 0;
    while (typeof teaching.response === "string" && teaching.response.length && guard < 96) {
      teaching.erase();
      guard += 1;
    }
    let refused = 0;
    for (const ch of want) if (teaching.type(ch) !== true) refused += 1;
    this.stats.refusedChars += refused;
    this.entrySynced = want;
  }

  // ------------------------------------------------------------------------ setting it down

  /**
   * `interact` — the one button, and it always resolves.
   *
   * Hands empty: pick the claim back up. Hands full and the build is readable: set it down. Hands
   * full and it is not readable yet — a numeric row with a `\cdot` still open in it is not a quantity
   * — let go of it, feet free, and the presenter's typed entry is still standing behind the claim.
   *
   * The "always" is load-bearing. The feet are planted while a claim is held, so a route out of the
   * stance that could ever refuse would be a player standing in a field unable to move, which is a
   * worse bug than the one the stance fixes.
   */
  _interact() {
    if (this.phase === "performing" && this.act) {
      if (!this._setDown()) this._letGo();
      return;
    }
    if (!this.act && this.present && this.getTeaching()?.open === true) this._pose(this.present);
  }

  /** Put the claim down without answering it. Nothing is committed and nothing is scored. */
  _letGo() {
    this.letGos += 1;
    this._retire();
    this.plantBody(false);
  }

  /**
   * Set it down. This is the only route from a pair of hands to the learner model, and every part of
   * it is somebody else's audited code: the grammar is the bank's, the checker is the bank's, the
   * pricing is the engine's. What this method owns is honesty about what was built.
   */
  _setDown() {
    if (!this.act || this.phase !== "performing") return null;
    const teaching = this.getTeaching();
    if (!teaching || teaching.open !== true) return null;
    let response = null;
    try {
      response = this.act.response();
    } catch {
      response = null;
    }
    if (!response || !this.act.ready()) return null;

    // The slot has been carrying the build every step (`_syncEntry`); this is the flush that
    // guarantees it, so a commit can never send a response the player was not looking at.
    this._syncEntry();
    this._record(response);

    /**
     * The last gate before the engine, and it is a number rather than a promise.
     *
     * `_syncEntry` has just written the build into the slot; if the slot still disagrees, something
     * put a character there that this runtime did not, and the response about to be priced is not the
     * one the player built. Round 2's defect — `was`, committed, scored, theta to −1.173476 — is
     * exactly this condition, so it is counted rather than assumed away, and `review/measure/P19.mjs`
     * fails the run on a non-zero.
     */
    if (teaching.response !== response) this.stats.commitMismatch += 1;

    this.stats.committed += 1;
    try {
      teaching.commit();
    } catch {
      /* the presenter's own guards decide what a refused commit means */
    }
    return this.lastResponse;
  }

  /** The runtime's own record of what the hands built, beside what the engine says about it. */
  _record(response) {
    const latencyMs = Math.max(0, Math.round((this.simTime - (this.startedAt ?? this.simTime)) * 1000));
    this.lastResponse = {
      itemId: this.ctx?.itemId ?? null,
      kpId: this.ctx?.kpId ?? null,
      verb: this.act?.id ?? null,
      response,
      latencyMs,
      /**
       * `scaffoldLevel` is this runtime's own record of how much the world put on the screen that the
       * learner did not produce. It is 0 for every verb here — no verb pre-places a step, constrains
       * the answer space or shows fit — and when it is not 0 the act must have called
       * `Teaching.hint()`, which is what puts `hinted: true` on `learn:respond` and stops the engine
       * scoring the response upward. The two must never disagree, and `review/measure/P19.mjs`
       * asserts they do not.
       */
      scaffoldLevel: this.act?.scaffoldLevel ?? 0,
      acts: (() => {
        try {
          return this.act?.state?.().acts ?? null;
        } catch {
          return null;
        }
      })(),
      at: round2(this.simTime),
      correct: null,
      scored: null,
      credited: null,
      family: null,
      misconception: null,
    };
    return this.lastResponse;
  }

  /**
   * The world's read on a claim that fell, and its silence on one that stood.
   *
   * Two sources, in this order: what the VERB knows about the object it was just holding (which pan
   * is heavier and by how much, which wards the value never reached, that a rail went over without
   * its mark), and then whatever misconception the shipped checker tagged. If neither has anything
   * specific to say, NOTHING is written — `voice.md` §4 requirement 2 makes generic failure text a
   * bug, and a house fallback line is generic failure text with a key on it.
   */
  _stand(correct) {
    this.phase = "read";
    this.readUntil = this.simTime + HAND.readSeconds;
    if (correct) {
      // "Let objects say it. A bridge existing is a better sentence than any sentence." The deck
      // stands, whole, and nothing is written beside it.
      this._render(true);
      return;
    }
    if (this.act && typeof this.act.shear === "boolean") this.act.shear = true;
    this._render(true);

    let marked = null;
    const item = this.getTeaching()?.item ?? null;
    if (this.bank?.check && item && this.lastResponse?.response) {
      try {
        marked = this.bank.check(item, this.lastResponse.response);
      } catch {
        marked = null;
      }
    }
    let read = null;
    try {
      read = this.act?.read?.(marked) ?? null;
    } catch {
      read = null;
    }
    if (this.lastResponse && marked) this.lastResponse.misconception = marked.misconception ?? this.lastResponse.misconception;
    if (this.lastResponse) this.lastResponse.read = read?.key ?? null;
    this._render(true);
    if (!read?.key || !this.bank?.text) return;

    let line = "";
    try {
      line = this.bank.text(read.key, read.params ?? {});
    } catch {
      line = "";
    }
    if (!line || line === read.key) return;

    // Wrap first, then gate: a sentence is refused WHOLE or stood whole, never in part.
    const lines = wrapText(line, HAND.readWrap);
    if (!lines.length || lines.length > HAND.readRows) {
      this.stats.readsRefused += 1;
      return;
    }
    const rows = lines.map((l) => `\\text{${escapeText(l)}}`);
    if (this.validateTex && !rows.every((t) => this.validateTex(t))) {
      this.stats.readsRefused += 1;
      return;
    }
    rows.forEach((tex, i) => this._show(`read-${i}`, tex, { up: HAND.readUp - i * HAND.readStep, right: 0, em: HAND.readEm }, true));
    this.stats.reads += 1;
  }

  // ------------------------------------------------------------------------ standing it in the world

  /**
   * A socket in the hands' column, resolved against the camera frame CAPTURED WHEN THE CLAIM WAS
   * POSED. Not the live camera: a row re-typeset every step against a live basis would chase the
   * head around, which is a HUD wearing world space. The claim stands still and the player walks.
   */
  _place(socket) {
    const b = this.anchor;
    if (!b) return null;
    const f = HAND.forward;
    const r = (socket.right ?? 0) + HAND.right;
    return [b.o[0] + b.f[0] * f + b.r[0] * r, b.o[1] + this._top() + (socket.up ?? 0), b.o[2] + b.f[1] * f + b.r[1] * r];
  }

  /**
   * The top of the hands' column: one row under whatever row the presenter's column ends on,
   * expressed at this column's depth so the separation is the one the player sees.
   *
   * Sampled once per claim, on the first render after posing rather than on the signal itself,
   * because `Teaching._display()` runs AFTER it emits `learn:present` — read it any earlier and the
   * height belongs to the claim before this one.
   */
  _top() {
    if (this._topUp != null) return this._topUp;
    let lowest = 1.56;
    try {
      const p = this.getTeaching()?.probe?.();
      // Every row the presenter ACTUALLY stood for this item, with its height — not just the entry
      // slot. A wrapped `ask` and a two-line said claim are rows too, and round 2 collided with one
      // of them by trusting `entryUp` alone.
      const ups = (p?.stood ?? []).map((r) => r.up).filter((v) => Number.isFinite(v));
      if (ups.length) lowest = Math.min(...ups);
      else if (Number.isFinite(p?.entryUp)) lowest = p.entryUp;
    } catch {
      /* a presenter that cannot describe itself gets the default */
    }
    // Equal screen angle needs `up` proportional to depth (tan θ = up / forward), so the gap is
    // expressed at the presenter's depth and converted to this one.
    this._topUp = (lowest - HAND.gapUnderEntry) * (HAND.forward / HAND.presenterForward);
    return this._topUp;
  }

  _show(key, tex, socket, force = false) {
    const id = `${PREFIX}${key}`;
    const at = this._place(socket);
    const em = socket.em ?? HAND.em;
    const was = this.standing.get(id);
    // A `math:show` is a KaTeX parse, a canvas raster and a texture upload. Re-sending an unchanged
    // row every step would spend a raster per frame per row for nothing; `TexPanel`'s raster budget
    // is what this protects. Position is compared with a tolerance because the tilt moves rows.
    if (
      was &&
      was.tex === tex &&
      was.em === em &&
      (!at || !was.at || (Math.abs(was.at[0] - at[0]) < 0.02 && Math.abs(was.at[1] - at[1]) < 0.02 && Math.abs(was.at[2] - at[2]) < 0.02))
    )
      return;
    /**
     * A deck running at fourteen spans a second changes fourteen times a second, and re-typesetting
     * every one of them costs a raster the player never sees a frame of. `learn/Teaching.js` learned
     * the same lesson from its typed entry — "eight rasters per item to display one answer, all but
     * the last of them thrown away before a frame was ever drawn with it". Continuous rows are
     * therefore gated to ~11 Hz of sim time; a discrete act passes `force` and lands immediately,
     * and so does the last render of a claim, so the state a capture reads is never a stale one.
     */
    if (!force && was && this.simTime - (was.shownAt ?? -9) < 0.09) return;
    /**
     * A ROW THAT HAS MOVED HAS TO STAND DOWN FIRST.
     *
     * `TexField.add()` on an id it already holds calls `setTex` and `setLocale` and never reads
     * `position`. Round 2 leaned BALANCE's pans by sending the same ids at new heights and not one of
     * them ever moved a millimetre — Law 3's "the world never says wrong, it leans" was drawn by code
     * that could not lean. `math:hide` then `math:show` is what makes a new position real, and it is
     * sent only when the position actually changed, which for a pan is once per act.
     */
    if (was && at && was.at && (Math.abs(was.at[0] - at[0]) > 0.02 || Math.abs(was.at[1] - at[1]) > 0.02 || Math.abs(was.at[2] - at[2]) > 0.02)) {
      this.emit("math:hide", { id });
      this.stats.hides += 1;
    }
    this.emit("math:show", {
      id,
      tex,
      kpId: this.ctx?.kpId ?? null,
      at: at ?? undefined,
      anchor: at ? null : { right: HAND.right + (socket.right ?? 0), up: socket.up ?? 0, forward: HAND.forward },
      em,
      billboard: "yaw",
      display: true,
    });
    this.standing.set(id, { tex, em, at, shownAt: this.simTime });
    this.stats.shows += 1;
  }

  _render(force = false) {
    if (!this.act) return;
    let rows = [];
    try {
      rows = this.act.rows() ?? [];
    } catch {
      rows = [];
    }
    const live = new Set(rows.map((r) => `${PREFIX}${r.key}`));
    for (const row of rows) this._show(row.key, row.tex, { up: row.up ?? 0, right: row.right ?? 0, em: row.em }, force);
    // A row a verb stopped drawing — a term that was carried away, a bundle that folded — comes down.
    for (const id of [...this.standing.keys()]) {
      if (live.has(id) || id.startsWith(`${PREFIX}read`)) continue;
      this.emit("math:hide", { id });
      this.standing.delete(id);
      this.stats.hides += 1;
    }
  }

  _retire() {
    for (const id of [...this.standing.keys()]) {
      this.emit("math:hide", { id });
      this.stats.hides += 1;
    }
    this.standing.clear();
    this.act = null;
    this.ctx = null;
    this.anchor = null;
    this._topUp = null;
    this.phase = "idle";
  }

  // ------------------------------------------------------------------------ reporting

  probe() {
    return {
      phase: this.phase,
      verb: this.act?.id ?? null,
      item: this.ctx
        ? {
            itemId: this.ctx.itemId,
            kpId: this.ctx.kpId,
            form: this.ctx.form,
            answerType: this.ctx.answerType,
            objectClass: this.ctx.objectClass,
            unknown: this.ctx.unknown,
            stem: this.ctx.stem,
            // The charge already in the socket, published because it is on screen: a reviewer
            // deriving a response the way a player would needs the same rows the player has.
            given: this.ctx.given,
          }
        : null,
      state: (() => {
        try {
          return this.act?.state?.() ?? null;
        } catch {
          return null;
        }
      })(),
      hand: {
        move: { x: round2(this.hand.move.x), y: round2(this.hand.move.y) },
        work: round2(this.hand.work ?? 0),
        trigger: { push: round2(this.trigger.push), pull: round2(this.trigger.pull) },
        held: [...this.hand.held],
      },
      restands: this.restands,
      /** Simulation steps the body was held still because the hands were on a claim. */
      plantedSteps: this.planted,
      letGos: this.letGos,
      /** What the runtime has written into the presenter's entry slot, so a stray can be seen. */
      entry: this.entrySynced,
      columnTop: this._topUp == null ? null : round2(this._topUp),
      standing: [...this.standing.keys()],
      rows: [...this.standing.entries()].map(([id, r]) => ({ id, tex: r.tex, em: r.em })),
      lastResponse: this.lastResponse ? { ...this.lastResponse } : null,
      verbs: VERBS.map((v) => v.id),
      stats: { ...this.stats, byVerb: { ...this.stats.byVerb }, unposedByType: { ...this.stats.unposedByType } },
      simTime: round2(this.simTime),
    };
  }
}
