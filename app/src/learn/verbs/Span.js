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

  /** The deck is walked with the body: forward grows it, back brings it in. */
  fixed(step, hand) {
    const y = hand.move.y;
    if (Math.abs(y) < 0.12) {
      this.push = 0;
      this.carry = 0;
      return;
    }
    this.push += step;
    /**
     * Two and a half segments a second from a standing start, eight a second once the deck is
     * running. Fortnite's build verb resolves in a few frames and a deck a learner has to hold a key
     * on for nine seconds to reach 9 is a wait, not a verb — but the ceiling is 8/s and not 14/s for
     * a measured reason: every segment re-typesets two rows, and a deck outrunning the raster gate
     * shows a player a number that skips. The second grip lays ten at a time for the long ones.
     */
    const rate = 2.5 + Math.min(5.5, this.push * 6);
    this.carry += rate * step * Math.sign(y) * Math.min(1, Math.abs(y));
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
    s.n = Math.max(-999, Math.min(999, s.n + dir * (this.fine ? 10 : 1)));
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
      rows.push({ key: "value", tex: `${head.name} = ${R.tex(head.value)}${other.name}`, up: 1.6 });
      rows.push({ key: "deck", tex: this._deck(Math.abs(head.n)), up: 0.85 });
      return rows;
    }
    // The solid square is the hand: a grip plate resting on the socket you are holding. It is a
    // mark, not a label — `voice.md` §1 has no word this could be spelled with.
    const parts = this.sockets.map((s, i) => {
      const body = `${s.name} = ${s.tex()}`;
      return i === this.grip && this.sockets.length > 1 ? `\\rule{0.34em}{0.34em}\\,${body}` : body;
    });
    rows.push({ key: "value", tex: parts.join(",\\; ") || "\\rule{2.4em}{0.06em}", up: 1.6 });
    rows.push({ key: "deck", tex: this._deck(Math.abs(this.socket?.n ?? 0)), up: 0.85 });
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
