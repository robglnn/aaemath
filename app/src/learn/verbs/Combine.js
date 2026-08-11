/**
 * P19 · COMBINE — close the joins, and choose which one.
 *
 * ==================================================================================================
 * WHY THIS VERB WAS REWRITTEN IN ROUND 3
 *
 * The round-2 critic's biggest gap was not that COMBINE was bad. It was that COMBINE never posed —
 * "Balance, Tilt, Combine and Distribute are 47 kB of unreachable code" — because every item a new
 * player is served comes off `var-meaning` and `oo-numeric`, and round 2's COMBINE only read
 * `answerType: "expression"`, of which those two knowledge points ship exactly none.
 *
 * `oo-numeric` is 36 committed items of `8 + 5 \cdot 4`, and round 2's algebra layer REFUSED to read
 * one (`Claim.js`, "a claim this layer cannot read without doing a step of it is a claim it must not
 * pose"). That was the right instinct and the wrong conclusion: the reason not to read it is that
 * folding it would do the knowledge point for the learner — so hold it with its **joins still open**
 * and let the player close them. Which one they close first IS the mathematics, and closing them
 * left to right is not a slip, it is `oo-strict-left-to-right`, a misconception the bank has tagged
 * on every one of those items with a `failKey` no code path could reach.
 *
 * ==================================================================================================
 * ONE ACT, TWO DRESSINGS
 *
 * The act is always the same: get your hand on a **join** and push it closed. The two things standing
 * either side of it come together into one thing and the row gets shorter.
 *
 *   `gather`  a row with kinds in it — `3x + 2x + 6`. §2.1 rule 9 is the only rule the world enforces
 *             by refusing your hands: "A length and a weight will not stand together, and the socket
 *             does not argue about it; it simply will not take them." So a join between unlike kinds
 *             takes the push four fifths of the way and stops dead. Keep leaning and the term goes
 *             PAST instead — `props-operations` says some joins in a load turn freely — which is what
 *             lets a row with the like kinds at opposite ends be gathered at all.
 *
 *   `settle`  a row of numbers — `8 + 5 \cdot 4`, `12 \div 6 \cdot 5`, `9 - 2 + 3`. Every join closes.
 *             None of them refuses. The joins stay exactly as they were written, `-` included, because
 *             `oo-numeric.addsub`'s whole misconception is closing the `+` before the `-` standing to
 *             its left, and a layer that quietly normalized the row would have deleted the error it
 *             exists to teach.
 *
 * WHAT IT REFUSES TO SHOW. Not one thing on screen says whether the join under your hand is the one
 * that should close first. No lean, no glow, no ordering. The hint ladder will say it if you pull it
 * (`hint.move.oo-numeric.addmul`, "The bundle of 5 and 4 settles before the join outside it") and
 * pulling it is priced. The world says nothing until you set the row down.
 */
import {
  R,
  alike,
  chainIsLoad,
  chainLoad,
  chainTex,
  cloneChain,
  closeJoin,
  joinTakes,
  loadCanon,
  parseChain,
} from "./Claim.js";

/** How far a push gets into a join that will not close. The gap that is left is the refusal. */
const REFUSE_AT = 0.78;

class CombineAct {
  constructor(ctx, chain, mode) {
    this.id = "combine";
    this.ctx = ctx;
    this.chain = chain;
    this.mode = mode;
    this.scaffoldLevel = 0;
    /** Which join is under your hand. There is always at least one; a row with none is not posed. */
    this.grip = 0;
    /** How far this join has been pushed closed, 0..1. Clamped short by a refusal. */
    this.push = 0;
    this.refused = false;
    this.leanOn = 0;
    this.closes = 0;
    this.slides = 0;
    this.acts = 0;
    this.history = [];
    this.settleFor = 0;
  }

  get joins() {
    return this.chain.ops.length;
  }
  get held() {
    return Math.min(this.grip, Math.max(0, this.joins - 1));
  }
  /** Will the join under your hand take the push? `settle` rows never refuse; `gather` rows do. */
  get willTake() {
    const i = this.held;
    return joinTakes(this.chain.parts[i], this.chain.ops[i], this.chain.parts[i + 1]);
  }

  _remember() {
    this.history.push(cloneChain(this.chain));
    if (this.history.length > 24) this.history.shift();
  }

  fixed(step, hand) {
    if (this.settleFor > 0) {
      this.settleFor = Math.max(0, this.settleFor - step);
      return;
    }
    if (!this.joins) return;
    const y = hand.move.y;
    if (Math.abs(y) < 0.12) {
      this.push = Math.max(0, this.push - step * 4);
      if (this.push === 0) {
        this.refused = false;
        this.leanOn = 0;
      }
      return;
    }
    if (y < 0) {
      // Easing off opens the join back up. Nothing is undone; you simply are not pushing any more.
      this.push = Math.max(0, this.push + y * step * 3);
      return;
    }
    if (this.willTake) {
      this.push = Math.min(1, this.push + y * step * 3);
      if (this.push >= 1) this._close();
      return;
    }
    this.push = Math.min(REFUSE_AT, this.push + y * step * 3);
    if (this.push < REFUSE_AT) return;
    this.refused = true;
    /**
     * IT REFUSED TO JOIN. IT DID NOT REFUSE TO MOVE.
     *
     * A length and a weight cannot become one term, and they can absolutely change places. So a term
     * that meets something it cannot join keeps pushing and goes past it — and only in `gather`, where
     * every join is a `+` and the sign travels with the term it belongs to. In `settle` a row's order
     * is the whole content of the knowledge point and nothing may quietly reorder it.
     */
    this.leanOn += step;
    if (this.mode === "gather" && this.leanOn >= 0.34) this._slidePast();
  }

  _close() {
    const i = this.held;
    this._remember();
    if (!closeJoin(this.chain, i)) {
      this.history.pop();
      this.push = 0;
      return;
    }
    this.grip = Math.min(i, Math.max(0, this.chain.ops.length - 1));
    this.push = 0;
    this.leanOn = 0;
    this.refused = false;
    this.closes += 1;
    this.acts += 1;
    this.settleFor = 0.18;
  }

  /** The two things this join holds change places. Only ever legal in `gather`. */
  _slidePast() {
    const i = this.held;
    this._remember();
    const a = this.chain.parts[i];
    this.chain.parts[i] = this.chain.parts[i + 1];
    this.chain.parts[i + 1] = a;
    this.push = 0;
    this.leanOn = 0;
    this.refused = false;
    this.slides += 1;
    this.acts += 1;
    this.settleFor = 0.14;
  }

  act(name) {
    if (!this.joins) return false;
    switch (name) {
      case "stepNext":
        this.grip = (this.held + 1) % this.joins;
        this.push = 0;
        this.refused = false;
        this.leanOn = 0;
        return true;
      case "stepPrev":
        this.grip = (this.held + this.joins - 1) % this.joins;
        this.push = 0;
        this.refused = false;
        this.leanOn = 0;
        return true;
      case "take":
        // The grip does in one movement what the body does slowly: home if it will go, past if it
        // will not. A `settle` row's joins always go, so this is the one-button route through it.
        if (this.willTake) this._close();
        else {
          this.push = REFUSE_AT;
          this.refused = true;
          if (this.mode === "gather") this._slidePast();
        }
        return true;
      case "back":
        if (!this.history.length) return false;
        this.chain = this.history.pop();
        this.grip = Math.min(this.grip, Math.max(0, this.chain.ops.length - 1));
        this.push = 0;
        this.refused = false;
        this.acts += 1;
        return true;
      default:
        return false;
    }
  }

  /**
   * A row you can read as one load is a row you may set down.
   *
   * In `gather` that is always true and it is meant to be: you may hand over a load that is still in
   * two pieces, and `fail.load.unsettled` is what the world says about it. In `settle` a row with a
   * `\cdot` still open in it is not a quantity at all, so there is nothing yet to hand over — the
   * hands are still holding it, and `Verbs.js` lets go of a claim nobody can read rather than
   * committing a half-closed one as if it were an answer.
   */
  response() {
    if (this.acts <= 0 || !chainIsLoad(this.chain)) return null;
    return loadCanon(chainLoad(this.chain));
  }

  ready() {
    return this.response() != null;
  }

  /**
   * The row, with the gap the push is closing drawn where it actually is.
   *
   * The whole teaching surface of this verb is that gap: it shrinks as you lean, and it stops with
   * space still in it when the join will not take. Nobody is told why.
   */
  rows() {
    const gap = 1 - this.push;
    const rows = [{ key: "load", tex: chainTex(this.chain, this.held, gap), up: 0, right: 0 }];
    rows.push({
      key: "hand",
      up: -0.78,
      right: 0,
      // A bar as long as the row has been closed up, and a short broken length after it when a
      // join stopped the push dead.
      tex: `\\rule{${(0.35 + this.closes * 0.75).toFixed(2)}em}{0.12em}${this.refused ? "\\;\\rule{0.5em}{0.05em}" : ""}`,
    });
    return rows;
  }

  /**
   * The read, when the row did not settle to what the far lip wanted.
   *
   * The bank goes first now and that is a round-3 correction. The critic measured 20 deliberate
   * failures in round 2 and `learn:respond.misconception` was null on every one, because each verb
   * answered with its own structural guess before the checker's tagged distractor was ever consulted.
   * A tagged misconception is authored knowledge about THIS item; a structural read is this verb
   * noticing something about the object in its hands. When both have something to say, the authored
   * one is the better sentence.
   */
  read(marked) {
    if (marked?.misconception && marked?.failKey) return { key: marked.failKey, params: {} };
    const parts = this.chain.parts;
    for (let i = 0; i < parts.length; i += 1)
      for (let j = i + 1; j < parts.length; j += 1) if (alike(parts[i], parts[j])) return { key: "fail.load.unsettled", params: {} };
    if (marked?.failKey) return { key: marked.failKey, params: {} };
    return null;
  }

  state() {
    return {
      mode: this.mode,
      row: chainTex(this.chain),
      joins: this.joins,
      grip: this.held,
      willTake: this.joins ? this.willTake : null,
      push: Math.round(this.push * 100) / 100,
      refused: this.refused,
      closes: this.closes,
      slides: this.slides,
      acts: this.acts,
    };
  }
}

/** Fold every `-` into the sign of the part after it, so the joins are all `+` and order is free. */
function foldSigns(chain) {
  const parts = [chain.parts[0]];
  for (let i = 0; i < chain.ops.length; i += 1) {
    const t = chain.parts[i + 1];
    parts.push(chain.ops[i] === "-" ? { c: R.neg(t.c), v: t.v } : t);
  }
  return { parts, ops: chain.ops.map(() => "+") };
}

export default {
  id: "combine",
  pose(ctx) {
    const t = ctx.answerType;
    if (t !== "expression" && t !== "integer" && t !== "rational") return null;
    const chain = parseChain(ctx.stem);
    // A bracket, a power or a Sill is not a flat row. Those belong to DISTRIBUTE, SPAN and BALANCE,
    // all of which are asked before or after this one in `VERBS`.
    if (!chain || !chain.ops.length) return null;

    const named = chain.parts.some((p) => p.v != null);

    if (t === "integer" || t === "rational") {
      /**
       * A row of pure numbers closes to a quantity, which is what an `integer` or a `rational` item
       * wants. A row with a KIND in it does not: `7x + 7` is an `expr-anatomy` item whose answer is
       * `2` — the number of terms standing in it — and a verb that gathered it would hand the engine
       * `7*x + 7` against an answer of `2`. Round 2 shipped exactly that class of mistake in SPAN's
       * `cut` mode and it took a 30-item offline sweep to find it.
       */
      if (named) return null;
      // Nothing but `+` between numbers is arithmetic with no order in it. `9 - 2 + 3` has an order
      // and so does anything with a `\cdot` or a `\div`, and that order is the knowledge point.
      if (chain.ops.every((o) => o === "+")) return null;
      return new CombineAct(ctx, chain, "settle");
    }

    if (!named) return null;
    const folded = foldSigns(chain);
    // Nothing of a kind to gather is nothing to do. `expr-anatomy`'s `7 - 9x` is a row with no two
    // parts alike in it; posing a gathering verb on one gives a player a pair of hands and nowhere
    // to put them.
    const gatherable = folded.parts.some((a, i) => folded.parts.some((b, j) => j > i && alike(a, b)));
    if (!gatherable) return null;
    return new CombineAct(ctx, folded, "gather");
  },
};
