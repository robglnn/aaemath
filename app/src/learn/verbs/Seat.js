/**
 * P19 · SEAT — carry the charge into the socket, then close what is left standing.
 *
 * ==================================================================================================
 * WHY THIS VERB EXISTS: THE ROUND-3 CRITIC, WITH THEIR HANDS ON THE SHIPPED GAME
 *
 * > "The number I needed was printed on the screen, `t = 5`, three rows directly above the counter I
 * > was incrementing. To answer, I read the numeral 5 and pressed a button five times... I operated a
 * > counter, and a rule glyph beside it got wider."
 *
 * Their fifth demanded action is the one this file answers: *"Decide what SPAN is for. Restrict it to
 * claims where a magnitude genuinely IS the unknown, and let the items whose answer is computed in the
 * head route to a verb that performs the computation."*
 *
 * `eval-substitute`'s `x^{2} + x` with `x = 4` is exactly that item. Its answer, 20, is nowhere on the
 * screen — but it is two multiplications and an addition away from two things that ARE, and a verb
 * that hands the player a dial has asked them to do the arithmetic in their head and then transcribe
 * it. So this verb makes the arithmetic the act:
 *
 *   1. **The row stands with its sockets open.** `x^{2} + x` is not one glyph with a superscript on
 *      it, it is `x \cdot x + x` — three sockets cut for the same name, which is what a power IS
 *      (`world.md` §4.2: a socket is a place a value goes; a power is the same socket cut again).
 *      A learner who thinks `(-5)^{2}` is `-25` has never seen the second socket. Here they cannot
 *      miss it: there are two, and both take the charge, and the sign arrives twice.
 *   2. **The charge is carried in.** The given `x = 4` is an object standing beside the row. Push it
 *      into a socket and the socket takes it; the row now reads `4 \cdot x + x`. One socket at a
 *      time, in whatever order, and `fail.seat.partial` — "One socket took it. The others are still
 *      open." — is the world's read on a row set down half-charged. That sentence has shipped since
 *      P17 and this is the first pair of hands in the game that can commit the thing it describes.
 *   3. **Then the joins close, and WHICH ONE FIRST is the mathematics.** `4 \cdot 4 + 4` closed left
 *      to right is 32; the multiplication settles first and it is 20. Both are reachable, neither is
 *      hinted at, and the wrong one is a misconception the bank already has a name for. This is the
 *      same act COMBINE performs on a numeric row, because it IS that act — the row just had to be
 *      charged before it could be settled.
 *
 * WHAT IT REFUSES TO SHOW. The same rule the whole folder is built on (`Claim.js`'s header): while the
 * hands are on the row the world draws WHAT YOU ARE DOING — which socket is open, how far the charge
 * has travelled, where the joins are — and never whether it will hold. There is no lean toward the
 * right join and no detent at the right value. You find out when you set it down.
 */
import {
  R,
  rat,
  chainIsLoad,
  chainLoad,
  chainTex,
  cloneChain,
  closeJoin,
  joinTakes,
  loadCanon,
  parseChain,
  parseClaim,
} from "./Claim.js";

/**
 * `x = 4` / `r = -12` standing in the given: every charge the world is already holding, by name.
 *
 * A set (`\{-4,\; 1,\; 5\}`) is deliberately not read — that is a bag of candidates to try, not a
 * charge that has been made, and `eq-meaning`'s whole content is choosing from it. SPAN keeps those.
 */
export function chargesIn(given) {
  const out = new Map();
  for (const g of given ?? []) {
    const s = String(g).replace(/\\[a-zA-Z;,!]+/g, " ");
    const m = /^\s*([a-zA-Z])\s*=\s*(-?\s*\d+)\s*$/.exec(s);
    if (m) out.set(m[1], rat(Number(m[2].replace(/\s+/g, ""))));
  }
  return out;
}

/**
 * A row rewritten so that every product and every power is a JOIN a pair of hands can close.
 *
 * `3x^{2}` is one atom to a parser and three objects to a player: a count, a socket, and the same
 * socket cut again. `parseChain` reads a flat row of atoms joined by visible operators, so the
 * rewrite is textual and happens before it: implicit juxtaposition becomes `\cdot`, and `y^{k}`
 * becomes `k` copies of `y` joined by `\cdot`.
 *
 * It is a rewrite of the SURFACE and never of the value — `ItemBank`'s own `deTex` does the same
 * thing for the same reason ("`x^{2}` becomes `x*x` because the entry has no superscript"). Anything
 * it cannot rewrite safely returns null, and a row this cannot read is a row this verb does not pose.
 */
export function openProducts(tex) {
  const s = String(tex ?? "");
  // `\frac` carries braces this scanner would have to balance, and a share is not a socket cut twice.
  if (/\\frac|\\square|\\Rightarrow|\\mid/.test(s)) return null;
  const out = [];
  let i = 0;
  /** What was emitted last, so juxtaposition can be told from an operator. */
  let prev = null;
  const push = (kind, text) => {
    if (prev && (prev === "atom" || prev === "close") && (kind === "atom" || kind === "open")) out.push(" \\cdot ");
    out.push(text);
    prev = kind;
  };
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    if (c === "\\") {
      const m = /^\\([a-zA-Z]+|[;,!])/.exec(s.slice(i));
      if (!m) return null;
      const name = `\\${m[1]}`;
      i += m[0].length;
      if (name === "\\left" || name === "\\right") continue;
      if (name === "\\;" || name === "\\," || name === "\\!" || name === "\\quad" || name === "\\qquad") continue;
      if (name === "\\cdot" || name === "\\times") {
        out.push(" \\cdot ");
        prev = "op";
        continue;
      }
      if (name === "\\div") {
        out.push(" \\div ");
        prev = "op";
        continue;
      }
      return null;
    }
    if (/[0-9]/.test(c)) {
      const m = /^[0-9]+/.exec(s.slice(i));
      i += m[0].length;
      push("atom", m[0]);
      continue;
    }
    if (/[a-zA-Z]/.test(c)) {
      i += 1;
      // `y^{3}` / `y^3` — the same socket, cut that many times.
      const p = /^\^\{?(\d)\}?/.exec(s.slice(i));
      let times = 1;
      if (p) {
        times = Number(p[1]);
        if (!(times >= 1 && times <= 4)) return null;
        i += p[0].length;
      }
      push("atom", Array(times).fill(c).join(" \\cdot "));
      continue;
    }
    if (c === "+" || c === "-") {
      out.push(` ${c} `);
      prev = "op";
      i += 1;
      continue;
    }
    if (c === "*") {
      out.push(" \\cdot ");
      prev = "op";
      i += 1;
      continue;
    }
    if (c === "/") {
      out.push(" \\div ");
      prev = "op";
      i += 1;
      continue;
    }
    // A bracket is a bundle and belongs to DISTRIBUTE; a relation is a Sill and belongs elsewhere.
    return null;
  }
  const joined = out.join("").replace(/\s+/g, " ").trim();
  return joined || null;
}

/** The row as a chain, with every product open. Null when nothing here can read it. */
export function openRow(tex) {
  const opened = openProducts(tex);
  if (!opened) return null;
  const chain = parseChain(opened);
  if (chain) return chain;
  // A row with nothing but one thing standing in it: `g`. Still a row, still has a socket.
  const claim = parseClaim(opened);
  if (!claim || claim.rel || claim.near.length !== 1) return null;
  return { parts: [claim.near[0]], ops: [] };
}

/** Sim seconds a charge takes to travel into a socket under a steady push. */
const SEAT_TRAVEL = 0.42;

const JOIN_TEX = { "+": "+", "-": "-", "*": "\\cdot", "/": "\\div" };

/** One thing standing in a row, as it is written. */
function partTex(t) {
  const mag = R.abs(t.c);
  if (t.v == null) return R.tex(mag);
  return R.eq(mag, R.one) ? t.v : `${R.tex(mag)}${t.v}`;
}

/**
 * The row with the grip plate on ONE PART, built term by term.
 *
 * It is built rather than patched, and that is not a style preference: the obvious implementation is
 * to draw the row with `chainTex` and then substitute the socket's letter for a marked copy of it,
 * and that is a KaTeX failure waiting for a particular item. The join glyphs are `\cdot` and `\div`,
 * this bank names sockets `t`, `c`, `d`, `s` and `r` among others, and a substitution of `t` across
 * the drawn string turns `\cdot` into `\c` + a rule + `dot` — a claim `Tex.validate` refuses, which
 * `math/TexPanel.js` correctly renders as nothing at all. `var-meaning` ships `t` as a socket name.
 */
function markedRowTex(chain, markIndex) {
  const plate = "\\rule{0.3em}{0.3em}\\,";
  let out = "";
  chain.parts.forEach((t, i) => {
    const neg = t.c.n < 0;
    const body = partTex(t);
    if (i === 0) {
      out += `${i === markIndex ? plate : ""}${neg ? "-" : ""}${body}`;
      return;
    }
    const op = chain.ops[i - 1];
    if (op === "+" && neg) out += `\\;-\\;${i === markIndex ? plate : ""}${body}`;
    else {
      const piece = neg ? `\\left(-${body}\\right)` : body;
      out += `\\;${JOIN_TEX[op] ?? "+"}\\;${i === markIndex ? plate : ""}${piece}`;
    }
  });
  return out;
}

class SeatAct {
  constructor(ctx, chain, charges) {
    this.id = "seat";
    this.ctx = ctx;
    this.chain = chain;
    this.charges = charges;
    this.scaffoldLevel = 0;
    this.grip = 0;
    /** How far the charge in your hands has travelled into the socket you are at, 0..1. */
    this.drive = 0;
    /** How far the join under your hand has been pushed closed, 0..1. */
    this.push = 0;
    this.refused = false;
    this.seated = 0;
    this.closes = 0;
    this.acts = 0;
    this.shear = false;
    this.history = [];
    this.settleFor = 0;
  }

  /**
   * Every place a hand can be, in the order the row reads: the open sockets first, then the joins.
   *
   * Sockets first is not a rail and it is not a hint — an open socket is not a quantity, so a join
   * beside one cannot close anyway (`joinTakes` refuses a length against a weight). Standing the
   * hand where work is possible is the same courtesy `Balance.js` extends by putting the Sill in the
   * grip row. The ORDER within each kind is the row's own order, left to right, and nothing about
   * which one to take first is drawn.
   */
  get stations() {
    const out = [];
    this.chain.parts.forEach((p, i) => {
      if (p.v != null && this.charges.has(p.v)) out.push({ kind: "socket", index: i });
    });
    this.chain.ops.forEach((_, i) => out.push({ kind: "join", index: i }));
    return out;
  }

  get at() {
    const row = this.stations;
    if (!row.length) return null;
    return row[Math.min(this.grip, row.length - 1)];
  }

  get open() {
    return this.chain.parts.filter((p) => p.v != null && this.charges.has(p.v)).length;
  }

  _remember() {
    this.history.push(cloneChain(this.chain));
    if (this.history.length > 24) this.history.shift();
  }

  /**
   * The body drives both halves of the act, and they are the same movement: lean forward and the
   * thing under your hand travels. A charge travels into a socket; a join travels closed.
   */
  fixed(step, hand) {
    if (this.settleFor > 0) {
      this.settleFor = Math.max(0, this.settleFor - step);
      return;
    }
    const here = this.at;
    if (!here) return;
    const y = hand.move.y;
    if (Math.abs(y) < 0.12) {
      this.drive = Math.max(0, this.drive - step * 3);
      this.push = Math.max(0, this.push - step * 4);
      if (this.push === 0) this.refused = false;
      return;
    }
    if (here.kind === "socket") {
      this.drive = Math.max(0, Math.min(1, this.drive + (y * step) / SEAT_TRAVEL));
      if (this.drive >= 1) this._seat(here.index);
      return;
    }
    if (y < 0) {
      this.push = Math.max(0, this.push + y * step * 3);
      return;
    }
    if (joinTakes(this.chain.parts[here.index], this.chain.ops[here.index], this.chain.parts[here.index + 1])) {
      this.push = Math.min(1, this.push + y * step * 3);
      if (this.push >= 1) this._close(here.index);
      return;
    }
    // §2.1 rule 9, the one rule the world enforces by refusing your hands. An open socket is not a
    // weight and the join simply will not take it. Nothing is said about why.
    this.push = Math.min(0.78, this.push + y * step * 3);
    this.refused = true;
  }

  _seat(i) {
    const part = this.chain.parts[i];
    const charge = part?.v != null ? this.charges.get(part.v) : null;
    this.drive = 0;
    if (!charge) return false;
    this._remember();
    // The socket takes the charge. Whatever count was standing on the socket keeps standing on it —
    // `4 \cdot x` charged at 3 is `4 \cdot 3`, never 12, because the join outside is still the
    // player's to close.
    this.chain.parts[i] = { c: R.mul(part.c, charge), v: null };
    this.seated += 1;
    this.acts += 1;
    this.settleFor = 0.18;
    this.grip = 0;
    return true;
  }

  _close(i) {
    this._remember();
    if (!closeJoin(this.chain, i)) {
      this.history.pop();
      this.push = 0;
      return false;
    }
    this.push = 0;
    this.refused = false;
    this.closes += 1;
    this.acts += 1;
    this.settleFor = 0.18;
    this.grip = Math.min(this.grip, Math.max(0, this.stations.length - 1));
    return true;
  }

  act(name) {
    const here = this.at;
    switch (name) {
      case "stepNext":
        if (!this.stations.length) return false;
        this.grip = (Math.min(this.grip, this.stations.length - 1) + 1) % this.stations.length;
        this.drive = 0;
        this.push = 0;
        this.refused = false;
        return true;
      case "stepPrev":
        if (!this.stations.length) return false;
        this.grip = (Math.min(this.grip, this.stations.length - 1) + this.stations.length - 1) % this.stations.length;
        this.drive = 0;
        this.push = 0;
        this.refused = false;
        return true;
      case "take":
        // The near grip does in one movement what the body does slowly.
        if (!here) return false;
        if (here.kind === "socket") return this._seat(here.index);
        if (joinTakes(this.chain.parts[here.index], this.chain.ops[here.index], this.chain.parts[here.index + 1]))
          return this._close(here.index);
        this.push = 0.78;
        this.refused = true;
        return true;
      case "back":
        if (!this.history.length) return false;
        this.chain = this.history.pop();
        this.grip = Math.min(this.grip, Math.max(0, this.stations.length - 1));
        this.drive = 0;
        this.push = 0;
        this.refused = false;
        this.acts += 1;
        return true;
      default:
        return false;
    }
  }

  /**
   * A row you can read as one load is a row you may set down — half-charged, half-settled, whatever
   * state your hands left it in. A row with a `\cdot` still open in it is not a quantity at all, so
   * there is nothing yet to hand over and `Verbs.js` lets go of it rather than committing it.
   */
  response() {
    if (this.acts <= 0 || !chainIsLoad(this.chain)) return null;
    return loadCanon(chainLoad(this.chain));
  }

  ready() {
    return this.response() != null;
  }

  /**
   * The row as it stands, the charge in your hands, and how far it has got.
   *
   * The socket you are at is drawn with the grip plate on it, exactly as `Claim.js` draws a hand on
   * a term; the charge travels toward it as a bar that lengthens. Nothing here is a label and
   * nothing here is a verdict.
   */
  rows() {
    const here = this.at;
    const held = here?.kind === "join" ? here.index : -1;
    const gap = 1 - this.push;
    const row =
      here?.kind === "socket"
        ? markedRowTex(this.chain, here.index)
        : chainTex(this.chain, held, gap);
    const out = [{ key: "row", tex: row, up: 0, right: 0 }];
    const charge = here?.kind === "socket" ? this.charges.get(this.chain.parts[here.index]?.v ?? "") : null;
    out.push({
      key: "hand",
      up: -0.78,
      right: 0,
      tex: charge
        ? // The charge, and the distance it still has to travel. Light first, then stone (§4.2).
          `${R.tex(charge)}\\;\\rule{${(0.3 + this.drive * 1.5).toFixed(2)}em}{0.12em}\\;\\rule{${(1.5 * (1 - this.drive) + 0.2).toFixed(2)}em}{0.04em}`
        : `\\rule{${(0.35 + this.closes * 0.75).toFixed(2)}em}{0.12em}${this.refused ? "\\;\\rule{0.5em}{0.05em}" : ""}`,
    });
    return out;
  }

  /**
   * The world's read on a row that did not close where the far lip wanted it.
   *
   * The bank goes first — a declared distractor is authored knowledge about this exact item, and
   * round 2's measurement (20 deliberate failures, 20 null misconceptions) is why every verb in this
   * folder orders it that way. What this verb knows on its own is the state of the sockets, and
   * `fail.seat.partial` is the sentence for it: it has been in the bank since P17 and no code in the
   * game could commit the thing it describes until now.
   */
  read(marked) {
    if (marked?.misconception && marked?.failKey) return { key: marked.failKey, params: {} };
    if (this.open > 0 && this.seated > 0) return { key: "fail.seat.partial", params: {} };
    if (this.open > 0) return { key: "fail.socket.gone", params: {} };
    if (this.chain.ops.length) return { key: "fail.load.unsettled", params: {} };
    if (marked?.failKey) return { key: marked.failKey, params: {} };
    return null;
  }

  state() {
    return {
      row: chainTex(this.chain),
      sockets: this.chain.parts.filter((p) => p.v != null).map((p) => p.v),
      openSockets: this.open,
      charges: [...this.charges.entries()].map(([k, v]) => `${k}=${R.canon(v)}`),
      station: this.at ? `${this.at.kind}:${this.at.index}` : null,
      drive: Math.round(this.drive * 100) / 100,
      push: Math.round(this.push * 100) / 100,
      refused: this.refused,
      seated: this.seated,
      closes: this.closes,
      acts: this.acts,
    };
  }
}

/** Build the act for a row and a set of charges, or null. Shared by `pose` and `line`. */
function hands(ctx, tex, charges) {
  if (!charges || !charges.size) return null;
  const chain = openRow(tex);
  if (!chain) return null;
  const sockets = chain.parts.filter((p) => p.v != null);
  // Every socket in the row has to have a charge for it, or the row cannot close to a quantity and
  // this is not the verb that closes it.
  if (!sockets.length || !sockets.every((p) => charges.has(p.v))) return null;
  return new SeatAct(ctx, chain, charges);
}

export default {
  id: "seat",

  /**
   * Pose the open reading, or hand it back.
   *
   * The gate is a statement about the ITEM and not about its answer type: the world is holding a
   * charge, the row has a socket cut for it, and the row closes to a quantity. That is `eval-*`,
   * `oo-structure` and `var-meaning`'s "let it settle and read it" — the 57 committed items the
   * round-3 critic was dialling on a counter.
   */
  pose(ctx) {
    const t = ctx.answerType;
    if (t !== "integer" && t !== "rational") return null;
    return hands(ctx, ctx.stem, chargesIn(ctx.given));
  },

  /**
   * The same act, posed on ONE LINE of a working rather than on a stem. `Repair.js` is the caller:
   * a joint that will not hold is rebuilt with the verb the line above it implies, and for a line
   * with a socket in it that verb is this one.
   */
  line(tex, ctx) {
    return hands(ctx, tex, chargesIn(ctx.given));
  },
};
