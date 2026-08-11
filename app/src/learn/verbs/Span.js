/**
 * P19 · SPAN — walk the deck out until it fits.
 *
 * `design/world.md` §2.1: "Dimensions are a pure function of the closed value... An object's size is
 * readable proof of what the value was." So this verb does not ask for a number. It hands the player
 * a deck and lets them walk it out over the gap with their own legs: push forward and the deck grows
 * a segment at a time, pull back and it comes in. What you set down is what you built, and its
 * length IS the value the engine marks.
 *
 * Four dressings of one act, chosen by what the claim is cut for — never by a question type:
 *
 *   `one`    one socket, one length.            integer · rational · valueSet
 *   `pair`   two sockets cut in the same claim.  pair — §11a: "Every socket cut for that name holds
 *            Charge both or the load will not      the same value. Two different names may still
 *            settle (§4.2, *to seat*).             hold the same one."
 *   `cut`    no sockets yet: cut your own, name  a `generate` Emitter — the world asks for sockets
 *            them apart, charge them alike.        that hold what the given holds.
 *   `ratio`  two sockets and a rating between    equation, where the stem is a name list and the
 *            them: so many of one for one of      claim is spoken rather than written.
 *            the other.
 *
 * WHAT IT REFUSES TO SHOW. While the deck is being walked out, the world draws the deck and the
 * count on it and nothing else. It does not lean, it does not glow, it does not say "nearly". A verb
 * that showed fit while the hand was still on it would make sweeping the dial a hundred-percent
 * strategy with no algebra in it — see `Claim.js`'s header. The far lip is met, or it is not, and you
 * find out when you set it down.
 */
import { R, rat } from "./Claim.js";

/** Names already spoken for by the claim, so a cut socket never collides with one. */
const NAME_POOL = "pqrsuvwkmn".split("");

/** Sim seconds a held push waits after laying its first segment, so a short push means exactly one. */
const LEAD = 0.34;
/** Sim seconds the deck takes to get from two segments a second up to seven. */
const RAMP = 1.4;
/** The deck length at which the second grip becomes a x10 gear rather than a single span. */
const GEAR_AT = 20;

/** Single letters standing in a stem, in the order they first appear. `a,\; b` -> ["a","b"]. */
function namesIn(tex) {
  const out = [];
  const s = String(tex ?? "").replace(/\\[a-zA-Z]+/g, " ");
  for (const m of s.matchAll(/[a-zA-Z]/g)) if (!out.includes(m[0])) out.push(m[0]);
  return out;
}

/** `t = 5` standing in the given: the charge the world is already holding, and its name. */
function chargeInGiven(given) {
  for (const g of given ?? []) {
    const m = /^\s*([a-zA-Z])\s*=\s*(-?\d+)\s*$/.exec(String(g).replace(/\\[a-zA-Z;,!]+/g, " "));
    if (m) return { name: m[1], value: rat(Number(m[2])) };
  }
  return null;
}

/**
 * A deck being walked out. `n` over `d` so a claim that closes at a third of a span can be built
 * rather than typed; `d` moves only while the second grip is held, so the common case is one axis.
 */
class Socket {
  constructor(name) {
    this.name = name;
    this.n = 0;
    this.d = 1;
    this.charged = false;
  }
  get value() {
    return rat(this.n, this.d);
  }
  tex() {
    return R.tex(this.value);
  }
}

class SpanAct {
  constructor(ctx, mode, sockets, opts = {}) {
    this.id = "span";
    this.ctx = ctx;
    this.mode = mode;
    this.sockets = sockets;
    this.grip = 0;
    this.scaffoldLevel = 0;
    /** Sim seconds the current push has been held, which is what makes the deck accelerate. */
    this.push = 0;
    /** Fractional progress into the next segment, so a short tap still moves the deck one span. */
    this.carry = 0;
    /** `cut` mode: how many sockets the player has cut so far. */
    this.cutCount = opts.cutCount ?? sockets.length;
    this.head = 0;
    this.set = false;
    this.shear = false;
    this.acts = 0;
  }

  get socket() {
    return this.sockets[Math.min(this.grip, this.sockets.length - 1)];
  }

  /**
   * The deck is walked with the body: forward grows it, back brings it in.
   *
   * ==================================================================================================
   * ROUND 3's REGEAR, WHICH THE CRITIC MEASURED RATHER THAN GUESSED AT
   *
   * "On the pad the second grip took p from 9 to 59 in one second and the left stick added nine more;
   * landing exactly on 5 is a fight against acceleration, not a measurement. Small targets are the
   * common case in Algebra I."
   *
   * Round 2 started at 2.5 segments a second and reached 8, from the first frame of the push, with a
   * flat ten-at-a-time on the second grip. That is a dial you cannot stop on 5 and a gearbox with no
   * neutral. Three changes, and none of them touches the answer:
   *
   *   1. **The first segment lands on the edge, then the deck holds still for `LEAD` seconds.** Every
   *      key-repeat in every operating system works this way and for this reason: a short push must
   *      mean exactly one, or one is the hardest number in the range to build.
   *   2. **It ramps from 2 to 7 over `RAMP` seconds** rather than opening at 2.5 and being at 8 in
   *      under a second.
   *   3. **The second grip is a x10 gear that will not engage below `GEAR_AT`.** Ten spans at a time
   *      is for the 33 committed answers above 40 and the one at 180; near zero it is a way to
   *      overshoot the whole of Algebra I in a single frame.
   *
   * WHAT IT DELIBERATELY IS NOT: a detent at the right answer. The critic's own suggestion was to
   * "decay the rate near a value the given implies", and this verb will not — a deck that gets heavy
   * near the value that closes it is the world leaning toward the correct answer, which is exactly
   * the strategy `Claim.js`'s header exists to forbid. The gearing is shaped by the INPUT and nothing
   * else, so it feels identical whether the deck is right or wrong.
   */
  fixed(step, hand) {
    const y = hand.move.y;
    if (Math.abs(y) < 0.12) {
      this.push = 0;
      this.carry = 0;
      this.led = false;
      return;
    }
    const dir = Math.sign(y);
    if (!this.led) {
      // The edge of the push lays exactly one, which is what a player who wants 5 reaches for.
      this.led = true;
      this.push = 0;
      this._step(dir);
      return;
    }
    this.push += step;
    if (this.push < LEAD) return;
    const t = Math.min(1, (this.push - LEAD) / RAMP);
    const rate = 2 + t * 5;
    this.carry += rate * step * dir * Math.min(1, Math.abs(y));
    while (this.carry >= 1) {
      this.carry -= 1;
      this._step(1);
    }
    while (this.carry <= -1) {
      this.carry += 1;
      this._step(-1);
    }
  }

  /**
   * One segment of deck, or one bundle of ten.
   *
   * The second grip lays the deck ten spans at a time, and it is not a convenience: 33 of the
   * bank's committed numeric answers are above 40 and one of them is 180, and a deck a player has to
   * tap out 180 times is not a verb. Ten is the count a **bundle** already means in this world
   * (§4.2), so a bundled push is the same object the load grammar already has.
   */
  _step(dir) {
    const s = this.socket;
    if (!s) return;
    // The x10 gear only engages once the deck is long enough that ten is a sensible unit of it.
    const gear = this.fine && Math.abs(s.n) >= GEAR_AT ? 10 : 1;
    s.n = Math.max(-999, Math.min(999, s.n + dir * gear));
    s.charged = true;
    this.acts += 1;
  }

  /** Share the deck into parts. One socket has nothing to cycle between, so the bumpers do this. */
  _shareDeck(dir) {
    const s = this.socket;
    if (!s) return;
    s.d = Math.max(1, Math.min(12, s.d + dir));
    s.charged = true;
    this.acts += 1;
  }

  act(name, hand) {
    switch (name) {
      case "hold":
        // The second grip: while it is held the deck is shared into parts rather than lengthened.
        this.fine = true;
        return true;
      case "release":
        this.fine = false;
        return true;
      case "take":
        // The near grip nudges the deck by exactly one, which is what a player reaches for at the
        // last span. Held with the second grip it lays ten. It never does anything else, in any
        // mode: a button that means two things depending on state is a button that gets pressed by
        // accident, and here the accident would be a socket nobody wanted.
        this._step(1);
        return true;
      case "back":
        this._step(-1);
        return true;
      case "stepNext":
        if (this.mode === "ratio") this.head = (this.head + 1) % this.sockets.length;
        else if (this.mode === "cut" && this.grip === this.sockets.length - 1 && this.sockets.length < 4) {
          // Walk past the last socket and cut a new one where you are standing. Only the verb whose
          // claim is *about* cutting sockets has anywhere to walk to.
          this.sockets.push(new Socket(this._freshName()));
          this.grip = this.sockets.length - 1;
          this.acts += 1;
        } else if (this.sockets.length > 1) this.grip = (this.grip + 1) % this.sockets.length;
        else this._shareDeck(1);
        return true;
      case "stepPrev":
        if (this.mode === "ratio") this.head = (this.head + this.sockets.length - 1) % this.sockets.length;
        else if (this.sockets.length > 1) this.grip = (this.grip + this.sockets.length - 1) % this.sockets.length;
        else this._shareDeck(-1);
        return true;
      default:
        return false;
    }
  }

  _freshName() {
    const taken = new Set([...this.sockets.map((s) => s.name), ...namesIn(this.ctx.stem), ...(this.ctx.given ?? []).flatMap(namesIn)]);
    return NAME_POOL.find((c) => !taken.has(c)) ?? "z";
  }

  /**
   * A deck nobody has walked out is not a response, and everything else is.
   *
   * The bar is deliberately this low. Refusing to let a player set down a deck that is obviously
   * short would be the world telling them it is short, which is the one thing this verb may never
   * do (see the header). You may always set it down. What happens next is the world's business.
   */
  ready() {
    return this.acts > 0;
  }

  response() {
    if (!this.ready()) return null;
    if (this.mode === "one") return R.canon(this.sockets[0].value);
    if (this.mode === "ratio") {
      const head = this.sockets[this.head];
      const other = this.sockets[(this.head + 1) % this.sockets.length];
      const k = R.canon(head.value);
      return `${head.name} = ${k}*${other.name}`;
    }
    return this.sockets.map((s) => `${s.name} = ${R.canon(s.value)}`).join(", ");
  }

  /**
   * The deck, drawn at the length it was built to, and the count on it.
   *
   * `\rule` is the whole trick: a bar whose width is the value in ems is a physical dimension
   * standing in world space, typeset by the same strict pipeline as the mathematics and needing no
   * geometry, no new material and no new renderer. It is the closed reading of a Span made of the
   * only material this piece is allowed to build with.
   */
  rows() {
    const rows = [];
    if (this.mode === "ratio") {
      const head = this.sockets[this.head];
      const other = this.sockets[(this.head + 1) % this.sockets.length];
      rows.push({ key: "value", tex: `${head.name} = ${R.tex(head.value)}${other.name}`, up: 0 });
      rows.push({ key: "deck", tex: this._deck(Math.abs(head.n)), up: -0.72 });
      return rows;
    }
    // The solid square is the hand: a grip plate resting on the socket you are holding. It is a
    // mark, not a label — `voice.md` §1 has no word this could be spelled with.
    const parts = this.sockets.map((s, i) => {
      const body = `${s.name} = ${s.tex()}`;
      return i === this.grip && this.sockets.length > 1 ? `\\rule{0.34em}{0.34em}\\,${body}` : body;
    });
    rows.push({ key: "value", tex: parts.join(",\\; ") || "\\rule{2.4em}{0.06em}", up: 0 });
    rows.push({ key: "deck", tex: this._deck(Math.abs(this.socket?.n ?? 0)), up: -0.72 });
    return rows;
  }

  /** Light first, then stone (§4.2, *snapping*): a walked deck, and the gap where it shears. */
  _deck(spans) {
    const n = Math.max(0, Math.min(14, spans));
    if (!n) return "\\rule{0.35em}{0.14em}";
    const bar = `\\rule{${(n * 0.62).toFixed(2)}em}{0.14em}`;
    return this.shear ? `${bar}\\;\\rule{0.35em}{0.05em}\\;\\rule{0.5em}{0.14em}` : bar;
  }

  /**
   * The world's own read when the deck did not meet the far lip.
   *
   * `voice.md` §4 requirement 2: "Every failure line names the specific thing that is out of balance.
   * Generic failure text is a bug." This verb only knows two specific things — that the sockets it
   * cut were charged unalike, and whatever misconception the checker tagged — so it says one of
   * those or it says nothing at all and lets the sheared deck be the sentence. There is no
   * house fallback line here on purpose: a fallback line is generic failure text with a key.
   */
  read(marked) {
    // The bank goes first when it recognised the response as a DECLARED misconception — see
    // `Balance.js`'s `read` for the measurement that reordered this. `check()`'s undiagnosed
    // `fail.slip` carries no misconception and stays last, so the structural read below still covers
    // everything the bank has no name for.
    if (marked?.misconception && marked?.failKey) return { key: marked.failKey, params: {} };
    if (this.mode === "cut" && new Set(this.sockets.map((s) => R.canon(s.value))).size > 1)
      return { key: "fail.seat.partial", params: {} };
    if (marked?.failKey) return { key: marked.failKey, params: {} };
    return null;
  }

  state() {
    return {
      mode: this.mode,
      grip: this.grip,
      head: this.head,
      fine: !!this.fine,
      acts: this.acts,
      sockets: this.sockets.map((s) => ({ name: s.name, n: s.n, d: s.d, charged: s.charged })),
    };
  }
}

export default {
  id: "span",
  /**
   * Pose the open reading, or hand it back. Handing it back is a real answer: `learn/Teaching.js`'s
   * typed entry is still standing behind every claim, so a shape no verb reads is answerable rather
   * than stuck, and `probe("verbs").unposed` counts them so the gap is measured instead of assumed.
   */
  pose(ctx) {
    const t = ctx.answerType;
    const unknown = ctx.unknown || "x";

    if (t === "integer" || t === "rational" || t === "valueSet") {
      return new SpanAct(ctx, "one", [new Socket(unknown)]);
    }

    if (t === "pair") {
      const names = namesIn(ctx.stem).filter((n) => n !== "e");
      if (names.length < 2) return null;
      return new SpanAct(ctx, "pair", names.slice(0, 3).map((n) => new Socket(n)));
    }

    if (t === "equation") {
      // A written claim (`x + 5 = 12`) belongs to BALANCE; a claim that is only SPOKEN arrives as a
      // bare list of names, and what the player builds is the rating between them.
      const names = namesIn(ctx.stem);
      if (/[=<>]/.test(String(ctx.stem)) || names.length < 2) return null;
      return new SpanAct(ctx, "ratio", names.slice(0, 2).map((n) => new Socket(n)));
    }

    if (t === "construction" && ctx.objectClass === "Emitter") {
      /**
       * The world is holding a charge and asking for sockets to put it in. Cut them yourself.
       *
       * The stem must be the charged name STANDING ALONE — `q`, with `q = 7` under it. That is the
       * open reading of a socket with something in it and nothing else going on, and it is the only
       * Emitter shape where cutting more sockets is the act. An Emitter whose stem is a LOAD
       * (`9 - x` with `x = -7` given) is asking to be settled and read, not to be re-socketed, and
       * posing this act on one produced `p = 0, q = 0` against an answer of `9 - x` — a verb
       * answering a claim nobody made. Measured, 30 items, in `review/measure/P19-unit.mjs`.
       */
      const charge = chargeInGiven(ctx.given);
      if (!charge) return null;
      if (String(ctx.stem ?? "").trim() !== charge.name) return null;
      const act = new SpanAct(ctx, "cut", []);
      act.sockets.push(new Socket(act._freshName()));
      act.sockets.push(new Socket(act._freshName()));
      return act;
    }

    return null;
  },
};
