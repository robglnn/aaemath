/**
 * P19 · COMBINE — push like into like until the load is one thing.
 *
 * `design/world.md` §2.1 rule 9, and it is the only rule in the game the world enforces by refusing
 * your hands:
 *
 * > "Every term is *of a kind* — a length, a weight, a count. Two terms of one kind gather into one
 * > term of that kind and the kind never changes. A length and a weight will not stand together, and
 * > the socket does not argue about it; it simply will not take them."
 *
 * So: you get hold of a term and you push it into its neighbour. If they are of a kind, they go
 * together with a snap and the load gets one shorter. If they are not, **the push stops dead**. Not
 * a message, not a shake, not a red anything — the term travels four fifths of the way, meets
 * something that will not take it, and comes back. Nobody says why. The hands learn it, which is what
 * `voice.md` §1 rule 1 means by never explaining the rule you just used.
 *
 * The Second Rung is called **Binder** and this is what it is a permission to do.
 *
 * WHERE THE ERROR LIVES. Because unlike kinds cannot be forced together, the misconception this verb
 * exposes is not "combined a length with a weight" — the world made that unreachable. It is
 * **stopping early**: setting down a load that still has two of a kind standing apart in it, which is
 * `requiresGathered` in `ItemBank.check` and `fail.load.unsettled` in `voice.md` §4. You may always
 * set the load down. The world will simply be holding something that is still in two pieces.
 */
import { R, alike, isBundle, loadCanon, loadTex, markedLoadTex, parseClaim, settle } from "./Claim.js";

const REFUSE_AT = 0.78;

class CombineAct {
  constructor(ctx, load) {
    this.id = "combine";
    this.ctx = ctx;
    this.load = load;
    this.scaffoldLevel = 0;
    this.grip = 0;
    /** How far the held term has been pushed toward the next one. Clamped by a refusal. */
    this.push = 0;
    this.refused = false;
    this.joins = 0;
    this.acts = 0;
    this.history = [];
    this.settleFor = 0;
  }

  get held() {
    return this.load[Math.min(this.grip, this.load.length - 1)];
  }
  get mateIndex() {
    return this.grip + 1 < this.load.length ? this.grip + 1 : this.grip - 1;
  }
  get mate() {
    return this.load[this.mateIndex];
  }

  fixed(step, hand) {
    if (this.settleFor > 0) {
      this.settleFor = Math.max(0, this.settleFor - step);
      return;
    }
    const y = hand.move.y;
    if (Math.abs(y) < 0.12) {
      this.push = Math.max(0, this.push - step * 4);
      if (this.push === 0) this.refused = false;
      return;
    }
    if (y < 0) {
      this.push = Math.max(0, this.push + y * step * 3);
      return;
    }
    const willTake = this.mate && alike(this.held, this.mate);
    this.push = Math.min(willTake ? 1 : REFUSE_AT, this.push + y * step * 3);
    if (willTake) {
      if (this.push >= 1) this._join();
      return;
    }
    if (this.push < REFUSE_AT) return;
    this.refused = true;
    /**
     * IT REFUSED TO JOIN. IT DID NOT REFUSE TO MOVE.
     *
     * §2.1 rule 9 says unlike kinds will not stand together; `props-operations` says "some joins in
     * a load turn freely". Both are true at once, and the difference is the whole of the Second
     * Rung: a length and a weight cannot become one term, and they can absolutely change places.
     * So a term that meets something it cannot join keeps pushing and goes PAST it, which is what
     * lets a load with the like kinds at opposite ends be gathered at all.
     */
    this.leanOn = (this.leanOn ?? 0) + step;
    if (this.leanOn >= 0.34) this._slidePast();
  }

  _slidePast() {
    const i = this.grip;
    const j = this.mateIndex;
    if (j < 0 || j >= this.load.length) return;
    this.history.push(this.load.map((t) => ({ ...t })));
    const a = this.load[i];
    this.load[i] = this.load[j];
    this.load[j] = a;
    this.grip = j;
    this.push = 0;
    this.leanOn = 0;
    this.refused = false;
    this.acts += 1;
    this.slides = (this.slides ?? 0) + 1;
    this.settleFor = 0.14;
  }

  _join() {
    const i = this.grip;
    const j = this.mateIndex;
    if (j < 0 || j >= this.load.length) return;
    this.history.push(this.load.map((t) => ({ ...t })));
    const joined = { c: R.add(this.load[i].c, this.load[j].c), v: this.load[i].v ?? null };
    const lo = Math.min(i, j);
    const hi = Math.max(i, j);
    this.load.splice(hi, 1);
    this.load.splice(lo, 1, joined);
    this.grip = lo;
    this.push = 0;
    this.joins += 1;
    this.acts += 1;
    this.settleFor = 0.18;
  }

  act(name) {
    switch (name) {
      case "stepNext":
        this.grip = (this.grip + 1) % this.load.length;
        this.push = 0;
        this.refused = false;
        return true;
      case "stepPrev":
        this.grip = (this.grip + this.load.length - 1) % this.load.length;
        this.push = 0;
        this.refused = false;
        return true;
      case "take":
        // The grip does in one movement what the body does slowly: home if it will go, past if
        // it will not.
        if (this.mate && alike(this.held, this.mate)) {
          this.push = 1;
          this._join();
        } else {
          this.push = REFUSE_AT;
          this.refused = true;
          this._slidePast();
        }
        return true;
      case "back":
        if (!this.history.length) return false;
        this.load = this.history.pop();
        this.grip = Math.min(this.grip, this.load.length - 1);
        this.push = 0;
        this.acts += 1;
        return true;
      default:
        return false;
    }
  }

  /** You may always set a load down. A load in two pieces is a load in two pieces. */
  ready() {
    return this.acts > 0;
  }

  response() {
    if (!this.ready()) return null;
    return loadCanon(this.load);
  }

  /**
   * The load, drawn with a gap where the hand is pushing.
   *
   * The pushed term physically closes on its neighbour — the space between them shrinks as the push
   * grows — and stops with a visible gap still open when the neighbour will not take it. That gap is
   * the refusal, and it is the whole teaching surface of this verb.
   */
  rows() {
    const gap = (1 - this.push) * 0.9 + 0.12;
    // The gap the push is closing, drawn where it actually is: between the term in your hand and
    // the one it is being pushed into. A zero-height rule is a measured space the strict pipeline
    // sets without a spacing macro, so the width is a number a raster can be checked against.
    const head = markedLoadTex(this.load.slice(0, this.grip + 1), this.grip);
    const tail = this.load.slice(this.grip + 1);
    const spacer = tail.length ? `\\rule{${gap.toFixed(2)}em}{0em}` : "";
    const rest = tail.length ? loadTex(tail, false) : "";
    const rows = [{ key: "load", tex: `${head}${spacer}${rest}`.trim() || "0", up: 0, right: 0 }];
    rows.push({
      key: "hand",
      up: -0.78,
      right: 0,
      // A bar as long as the gathering has got: it grows as terms go together and it stops growing
      // the instant a kind refuses one.
      tex: `\\rule{${(0.35 + this.joins * 0.75).toFixed(2)}em}{0.12em}${this.refused ? "\\;\\rule{0.5em}{0.05em}" : ""}`,
    });
    return rows;
  }

  read(marked) {
    const rows = this.load;
    for (let i = 0; i < rows.length; i += 1)
      for (let j = i + 1; j < rows.length; j += 1)
        if (alike(rows[i], rows[j])) return { key: "fail.load.unsettled", params: {} };
    if (marked?.failKey) return { key: marked.failKey, params: {} };
    return null;
  }

  state() {
    return {
      load: loadTex(this.load),
      grip: this.grip,
      push: Math.round(this.push * 100) / 100,
      refused: this.refused,
      joins: this.joins,
      slides: this.slides ?? 0,
      acts: this.acts,
      settled: settle(this.load).length,
    };
  }
}

export default {
  id: "combine",
  pose(ctx) {
    if (ctx.answerType !== "expression") return null;
    const claim = parseClaim(ctx.stem);
    // A load standing on its own — no Sill. A claim across a Sill is BALANCE's, and a load with a
    // bundle still shut in it is DISTRIBUTE's: you open before you gather (§2.1 rule 8).
    if (!claim || claim.rel !== null) return null;
    if (claim.near.some(isBundle)) return null;
    if (claim.near.length < 2) return null;
    // Nothing to gather is nothing to do. `expr-anatomy`'s "which of these is the term" claims are
    // loads with no two kinds alike in them; posing a gathering verb on one would give a player a
    // pair of hands and nowhere to put them.
    const gatherable = claim.near.some((t, i) => claim.near.some((u, j) => j > i && alike(t, u)));
    if (!gatherable) return null;
    return new CombineAct(ctx, claim.near);
  },
};
