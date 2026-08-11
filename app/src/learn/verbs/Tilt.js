/**
 * P19 · TILT — set a mark, and feel the detent go over.
 *
 * `design/world.md` Law 3 is written twice on purpose, once for equalities and once for thresholds,
 * and the second half is this verb:
 *
 * > "A **threshold's** Sill rests on a **detent** — a notch cut on one side of a **mark** — and the
 * > pan is *permitted* to lie anywhere on that side. **A leaning threshold is not broken. Leaning is
 * > its job.**... Carry a threshold's rail over the Sill inverted and **the detent goes to the other
 * > side of the mark**: everything it used to admit, it now refuses. You feel the detent go over
 * > through your hands a moment before you see it. No piece may render this as a failure — it is a
 * > *turn*."
 *
 * So three things this verb does that BALANCE does not, and all three are the Fifth Rung:
 *
 * 1. **It never renders a lean as a fall.** A threshold's pans stand apart by design. The rows are
 *    drawn at a fixed lean the whole time and nothing about that lean is a verdict.
 * 2. **The detent is drawn**, as a notch on one side of the mark, and it is the only thing in the
 *    frame that says which half of the world gets through.
 * 3. **Sharing by a negative turns the rail.** The share dial runs from +12 down through zero to
 *    −12; it cannot rest on zero; and the frame in which it crosses is the frame the detent changes
 *    sides in. `ineq-negative-flip`'s whole misconception — `fail.mark.unturned`, "The rail went
 *    over. The mark did not." — is reachable here by turning the rail with the second grip, which
 *    negates the pans and deliberately leaves the mark where it was.
 *
 * `voice.md` §1 forbids the words this verb is about: not "inequality", not "greater than", not "at
 * least". A threshold, a mark, what it admits and what it refuses. Nothing on screen is a label.
 */
import { R, rat, carry, cloneClaim, isBundle, isolated, loadTex, markedLoadTex, parseClaim, settle, share, shed, swap, turn, valueOf } from "./Claim.js";

function gripRow(c) {
  const near = c.near.map((t, i) => ({ kind: "term", side: "near", index: i, t }));
  const far = (c.far ?? []).map((t, i) => ({ kind: "term", side: "far", index: i, t }));
  return [...near, { kind: "sill" }, ...far];
}

class TiltAct {
  constructor(ctx, claim) {
    this.id = "tilt";
    this.ctx = ctx;
    this.claim = claim;
    this.unknown = ctx.unknown || "x";
    this.scaffoldLevel = 0;
    this.grip = 0;
    this.travel = 0;
    this.dial = 1;
    this.dialCarry = 0;
    this.acts = 0;
    this.railTurns = 0;
    this.markTurns = 0;
    this.history = [];
    this.settleFor = 0;
  }

  get row() {
    return gripRow(this.claim);
  }
  get held() {
    return this.row[Math.min(this.grip, this.row.length - 1)];
  }
  get atSill() {
    return this.held?.kind === "sill";
  }

  _remember() {
    this.history.push(cloneClaim(this.claim));
    if (this.history.length > 24) this.history.shift();
  }

  fixed(step, hand) {
    if (this.settleFor > 0) {
      this.settleFor = Math.max(0, this.settleFor - step);
      return;
    }
    const y = hand.move.y;
    if (Math.abs(y) < 0.12) {
      if (this.travel !== 0) this.travel *= Math.max(0, 1 - step * 6);
      return;
    }
    if (this.atSill) {
      this.dialCarry += y * step * 2.6;
      while (Math.abs(this.dialCarry) >= 1) {
        const dir = Math.sign(this.dialCarry);
        this.dialCarry -= dir;
        let next = this.dial + dir;
        // The dial cannot rest on zero — you cannot share a claim into nothing — so it steps over,
        // and stepping over is where the detent changes sides.
        if (next === 0) next = dir > 0 ? 1 : -1;
        this.dial = Math.max(-12, Math.min(12, next));
      }
      return;
    }
    this.travel = Math.max(-1, Math.min(1, this.travel + y * step * 2.4));
    if (this.travel >= 1) this._land();
    else if (this.travel <= -1) this._shed();
  }

  _land() {
    const h = this.held;
    this.travel = 0;
    if (!h || h.kind !== "term" || isBundle(h.t)) return;
    this._remember();
    carry(this.claim, h.side, h.index);
    this.acts += 1;
    this.settleFor = 0.2;
    this.grip = Math.min(this.grip, this.row.length - 1);
  }

  _shed() {
    const h = this.held;
    this.travel = 0;
    if (!h || h.kind !== "term" || isBundle(h.t)) return;
    this._remember();
    shed(this.claim, h.side, h.index);
    this.acts += 1;
    this.settleFor = 0.2;
    this.grip = Math.min(this.grip, this.row.length - 1);
  }

  act(name) {
    switch (name) {
      case "stepNext":
        this.grip = (this.grip + 1) % this.row.length;
        this.travel = 0;
        return true;
      case "stepPrev":
        this.grip = (this.grip + this.row.length - 1) % this.row.length;
        this.travel = 0;
        return true;
      case "take": {
        const h = this.held;
        if (!h) return false;
        this._remember();
        if (h.kind === "sill") {
          if (this.dial === 1) swap(this.claim);
          else {
            share(this.claim, rat(this.dial));
            if (this.dial < 0) this.markTurns += 1;
          }
          this.dial = 1;
        } else {
          this.travel = 1;
          this._land();
          return true;
        }
        this.acts += 1;
        return true;
      }
      case "hold": {
        /**
         * TURN THE RAIL, AND ONLY THE RAIL.
         *
         * Both pans go over inverted and the mark stays where it was. `world.md` Law 3 says the
         * detent is supposed to change sides when the rail turns; leaving the mark is precisely
         * `fail.mark.unturned`, and this is the affordance that makes committing that misconception
         * a thing a player DOES rather than a thing they are asked about.
         */
        this._remember();
        turn(this.claim, false);
        this.railTurns += 1;
        this.acts += 1;
        return true;
      }
      case "back":
        if (!this.history.length) return false;
        this.claim = this.history.pop();
        this.grip = Math.min(this.grip, this.row.length - 1);
        return true;
      default:
        return false;
    }
  }

  ready() {
    return this.acts > 0;
  }

  /** A threshold closes to a **stretch**, never to a point — so the response always carries a mark. */
  response() {
    if (!this.ready()) return null;
    const c = this.claim;
    const rel = { ">=": ">=", "<=": "<=", ">": ">", "<": "<", "=": "=" }[c.rel] ?? ">=";
    if (isolated(c, this.unknown)) {
      const v = valueOf(c);
      if (v) return `${this.unknown} ${rel} ${R.canon(v)}`;
    }
    const side = (load) =>
      settle(load)
        .map((t) => (t.v == null ? R.canon(t.c) : `${R.canon(t.c)}*${t.v}`))
        .join(" + ");
    return `${side(c.near)} ${rel} ${side(c.far ?? [])}`;
  }

  /**
   * A threshold, standing the way a threshold stands.
   *
   * The two pans are drawn permanently apart — that is the lean it is entitled to — and the row
   * between them carries the **detent**: a notch drawn on the side of the mark the claim admits. When
   * the rail turns, the notch moves to the other side, and it moves in the same frame the pans
   * invert. Nothing here is coloured, flashed or labelled.
   */
  rows() {
    const c = this.claim;
    const held = this.held;
    const pan = (load, side) => markedLoadTex(load, held?.kind === "term" && held.side === side ? held.index : -1);
    const rel = { ">=": "\\ge", "<=": "\\le", ">": ">", "<": "<", "=": "=" }[c.rel] ?? "\\ge";
    const admitsLow = c.rel === "<=" || c.rel === "<";
    const notch = admitsLow
      ? `\\rule{1.5em}{0.11em}\\rule{0.34em}{0.34em}\\rule{0.35em}{0.03em}`
      : `\\rule{0.35em}{0.03em}\\rule{0.34em}{0.34em}\\rule{1.5em}{0.11em}`;
    return [
      // The lean is fixed and it is not a verdict: a threshold's Sill rests on a detent, so the
      // pans are entitled to sit at different heights for as long as the claim stands.
      { key: "near", tex: pan(c.near, "near"), up: 0.17, right: -2.9 },
      { key: "sill", tex: this.atSill ? `\\rule{0.3em}{0.3em}\\,${rel}` : rel, up: 0, right: 0 },
      { key: "far", tex: pan(c.far ?? [], "far"), up: -0.17, right: 2.9 },
      { key: "detent", tex: notch, up: -0.7, right: 0 },
      {
        key: "hand",
        up: -1.36,
        right: 0,
        tex: this.atSill
          ? `\\rule{0.3em}{0.3em}\\;${this.dial === 1 ? "\\rule{1.4em}{0.06em}" : R.tex(rat(this.dial))}`
          : `\\rule{${(Math.abs(this.travel) * 2.2 + 0.2).toFixed(2)}em}{0.1em}`,
      },
    ];
  }

  /**
   * A threshold's fall read is never about the lean — Law 3 — it is about what got through. So the
   * two reads this verb owns are the rail that went over without its mark, and a stretch that was
   * closed to a point.
   */
  read(marked) {
    // A DECLARED distractor is authored knowledge about this exact item and goes first; see
    // `Balance.js`'s `read` for the round-2 measurement (20 failures, 20 nulls) that reordered this.
    if (marked?.misconception && marked?.failKey) return { key: marked.failKey, params: {} };
    if (this.railTurns > this.markTurns) return { key: "fail.mark.unturned", params: {} };
    if (this.claim.rel === "=") return { key: "fail.mark.level", params: {} };
    if (marked?.failKey) return { key: marked.failKey, params: {} };
    return null;
  }

  state() {
    return {
      claim: `${loadTex(this.claim.near)} ${this.claim.rel} ${loadTex(this.claim.far ?? [])}`,
      admits: this.claim.rel === "<=" || this.claim.rel === "<" ? "below" : "above",
      grip: this.grip,
      holding: this.atSill ? "sill" : `${this.held?.side}:${this.held?.index}`,
      dial: this.dial,
      travel: Math.round(this.travel * 100) / 100,
      railTurns: this.railTurns,
      markTurns: this.markTurns,
      acts: this.acts,
      isolated: isolated(this.claim, this.unknown),
    };
  }
}

export default {
  id: "tilt",
  pose(ctx) {
    if (ctx.answerType !== "inequality") return null;
    const claim = parseClaim(ctx.stem);
    if (!claim || !claim.far || !claim.rel || claim.rel === "=") return null;
    const unknown = ctx.unknown || "x";
    const names = new Set();
    for (const t of [...claim.near, ...claim.far]) {
      if (isBundle(t)) {
        for (const w of t.inner) if (w.v) names.add(w.v);
      } else if (t.v) {
        names.add(t.v);
      }
    }
    if (names.size !== 1 || !names.has(unknown)) return null;
    return new TiltAct(ctx, claim);
  },

  /**
   * The same act, posed on ONE LINE of a working rather than on a stem. `Repair.js` is the caller.
   *
   * The `answerType` gate is deliberately not applied: a line of a working is whatever shape it is,
   * and a `repair` item's answer type says `repair` about the response, nothing about the line. What
   * still holds is the shape test — a rail with a mark on it and two pans — because a verb that
   * cannot read the line must not pose on it.
   */
  line(tex, ctx) {
    const claim = parseClaim(tex);
    if (!claim || !claim.far || !claim.rel || claim.rel === "=") return null;
    return new TiltAct(ctx, claim);
  },
};
