/**
 * P19 · BALANCE — keep both pans level with your own hands.
 *
 * `design/world.md` Law 3: "A claim hangs across the Sill on two **pans**, like a balance, because
 * that is what an equals sign has always been. Touch one pan and the claim visibly *tilts*. The world
 * never says 'wrong'. It leans."
 *
 * That is this verb, entire. The properties of equality are not a rule the player is told; they are
 * what their hands discover about a heavy object and a doorsill:
 *
 *   - **Grip a term and walk it over the Sill.** It turns around on the way (Law 2, the game's
 *     signature verb). The claim stays level, because what left one pan arrived on the other.
 *   - **Grip a term and shed it instead.** It comes off the near pan and goes nowhere. The near pan
 *     rises, the far pan sinks, and the two rows of mathematics standing in the world MOVE APART
 *     vertically by the amount you took. Nothing says anything. You did that.
 *   - **Stand at the Sill itself and share.** Both pans, by the same count, and neither objects
 *     (Third Rung). Share by only one and you are back at the tilt.
 *   - **Gather before you lift** (§11a, `eq-combine-side`: "Nobody carries two stacks at once and
 *     the crane will not pretend otherwise").
 *   - **Open a bundle standing on a pan** without breaking what is inside it (Fourth Rung).
 *
 * The claim re-typesets after every act, so the mathematics on screen is the consequence of the
 * movement — `x + 5 = 12` becomes `x = 7` because a term was carried, not because a step was
 * confirmed. `voice.md` §1 rule 1: "Never explain the rule you just used."
 *
 * WHAT IT REFUSES TO SHOW: the claim leans only by the tilt the PLAYER introduced. It never leans
 * toward or away from a correct value, because that would turn dialling into a strategy. See
 * `Claim.js`'s header.
 */
import {
  R,
  rat,
  carry,
  claimTex,
  cloneClaim,
  foldOpenBundles,
  gather,
  isBundle,
  isolated,
  loadTex,
  parseClaim,
  reachWard,
  settle,
  share,
  shed,
  swap,
  ungathered,
  valueOf,
} from "./Claim.js";

/** The Sill sits between the pans in the grip order: near terms, the Sill, far terms. */
function gripRow(c) {
  const near = c.near.map((t, i) => ({ kind: "term", side: "near", index: i, t }));
  const far = (c.far ?? []).map((t, i) => ({ kind: "term", side: "far", index: i, t }));
  return [...near, { kind: "sill" }, ...far];
}

export class BalanceAct {
  constructor(ctx, claim, opts = {}) {
    this.id = opts.id ?? "balance";
    this.ctx = ctx;
    this.claim = claim;
    this.unknown = ctx.unknown || "x";
    this.scaffoldLevel = 0;
    this.grip = 0;
    /** −1 shed clear of the pan · 0 standing where it was · +1 over the Sill. */
    this.travel = 0;
    /** The share count dialled while standing at the Sill. Never 0; crossing zero turns a rail. */
    this.dial = 1;
    this.acts = 0;
    this.history = [];
    this.oneSided = false;
    this.lastAct = null;
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

  /**
   * The body drives the act. Forward carries what you are holding toward the Sill; back sheds it off
   * the pan. At the Sill, forward and back dial the share count through zero, and crossing zero is
   * where a rail turns over — you feel it in the count before you see it in the claim.
   */
  fixed(step, hand) {
    if (this.settleFor > 0) {
      this.settleFor = Math.max(0, this.settleFor - step);
      return;
    }
    const y = hand.move.y;
    if (Math.abs(y) < 0.12) {
      if (this.travel !== 0 && !this.lockTravel) this.travel *= Math.max(0, 1 - step * 6);
      return;
    }
    if (this.atSill) {
      this.dialCarry = (this.dialCarry ?? 0) + y * step * 2.6;
      while (Math.abs(this.dialCarry) >= 1) {
        const dir = Math.sign(this.dialCarry);
        this.dialCarry -= dir;
        let next = this.dial + dir;
        if (next === 0) next = dir > 0 ? 1 : -1;
        this.dial = Math.max(-12, Math.min(12, next));
      }
      return;
    }
    // Carrying is a walk, not a click: 0.42 s of push to get a term over the Sill, and the term is
    // visibly between the pans the whole time.
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
    this.lastAct = "carry";
    this.settleFor = 0.22;
    this.grip = Math.min(this.grip, this.row.length - 1);
  }

  _shed() {
    const h = this.held;
    this.travel = 0;
    if (!h || h.kind !== "term" || isBundle(h.t)) return;
    this._remember();
    shed(this.claim, h.side, h.index);
    this.oneSided = true;
    this.acts += 1;
    this.lastAct = "shed";
    this.settleFor = 0.22;
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
      case "take":
        return this._take();
      case "hold":
        /**
         * THE OTHER HALF OF THE THIRD RUNG.
         *
         * The near grip at the Sill shares both pans by the dialled count. The second grip gathers
         * them by it instead — the same act run backwards, which is what a deck already shared into
         * parts needs: `\frac{x}{2} = 6` is a claim whose near pan is half a thing, and no number of
         * shares will ever make it whole. `props-equality` is explicit that both directions are
         * legal on a balance, and 24 committed `eq-one-mult` items are unclosable without it.
         */
        if (!this.atSill || this.dial === 0) return false;
        this._remember();
        share(this.claim, rat(1, this.dial));
        this.dial = 1;
        this.acts += 1;
        this.lastAct = "gatherPans";
        return true;
      case "back":
        if (!this.history.length) return false;
        this.claim = this.history.pop();
        this.oneSided = !R.isZero(this.claim.tilt ?? R.zero);
        this.grip = Math.min(this.grip, this.row.length - 1);
        this.lastAct = "back";
        return true;
      default:
        return false;
    }
  }

  /**
   * The near grip: the act appropriate to whatever is under your hand. One button, because the
   * object decides what can be done to it — a bundle opens, a pair of like terms gathers, a term
   * crosses the Sill, and the Sill shares. `world.md` §2.1 rule 8: outward-in, top first.
   */
  _take() {
    const h = this.held;
    if (!h) return false;
    if (h.kind === "sill") {
      this._remember();
      if (this.dial === 1) swap(this.claim);
      else share(this.claim, rat(this.dial));
      this.dial = 1;
      this.acts += 1;
      this.lastAct = "share";
      return true;
    }
    if (isBundle(h.t)) {
      this._remember();
      reachWard(h.t);
      foldOpenBundles(this.claim);
      this.acts += 1;
      this.lastAct = "open";
      this.grip = Math.min(this.grip, this.row.length - 1);
      return true;
    }
    // Two of one kind standing apart on this pan gather into one, and the kind never changes.
    const load = h.side === "near" ? this.claim.near : this.claim.far;
    const mate = load.findIndex((t, i) => i !== h.index && !isBundle(t) && (t.v ?? null) === (h.t.v ?? null));
    if (mate >= 0) {
      this._remember();
      gather(this.claim, h.side, h.index, mate);
      this.acts += 1;
      this.lastAct = "gather";
      this.grip = Math.min(this.grip, this.row.length - 1);
      return true;
    }
    // Nothing to gather: the grip carries it over instead, which is the same act the body does
    // slowly with a forward push and the same act a pad player wants on a single button.
    this.travel = 1;
    this._land();
    return true;
  }

  ready() {
    return this.acts > 0;
  }

  /**
   * What the hands built, as a string a learner could have typed.
   *
   * An isolated claim closes at a value; anything else is handed over exactly as it stands, because
   * a claim you set down half-solved IS your response and the checker is entitled to read it. That
   * is how `fail.onesided` and `fail.sill.sign` get diagnosed at all.
   */
  response() {
    if (!this.ready()) return null;
    const c = this.claim;
    if (isolated(c, this.unknown)) {
      const v = valueOf(c);
      if (v) return this.ctx.answerType === "equation" ? `${this.unknown} = ${R.canon(v)}` : R.canon(v);
    }
    const near = settle(c.near)
      .map((t) => (t.v == null ? R.canon(t.c) : `${R.canon(t.c)}*${t.v}`))
      .join(" + ");
    const far = settle(c.far ?? [])
      .map((t) => (t.v == null ? R.canon(t.c) : `${R.canon(t.c)}*${t.v}`))
      .join(" + ");
    return `${near} = ${far}`;
  }

  /**
   * The claim, standing on two pans that are physically apart when it leans.
   *
   * The tilt is real geometry, not a graphic: the near-pan row rises and the far-pan row sinks by
   * the same amount, so a claim you unbalanced is a pair of rows that no longer read as one line.
   * That is `world.md` Law 3 rendered with nothing but two `math:show` positions.
   */
  rows() {
    const c = this.claim;
    const t = Math.max(-1.6, Math.min(1.6, R.num(c.tilt ?? R.zero) / 6));
    const lean = t * 0.34;
    const held = this.held;
    const mark = (side, i) => (held?.kind === "term" && held.side === side && held.index === i ? "\\rule{0.3em}{0.3em}\\," : "");
    const pan = (load, side) =>
      load.map((tm, i) => `${mark(side, i)}${loadTex([tm], i === 0)}`).join(" ") || "0";
    const rel = { "=": "=", ">=": "\\ge", "<=": "\\le", ">": ">", "<": "<" }[c.rel] ?? "=";
    const travelling = this.travel !== 0 && held?.kind === "term";
    const sill = this.atSill ? `\\rule{0.3em}{0.3em}\\,${rel}` : rel;
    return [
      { key: "near", tex: pan(c.near, "near"), up: 1.6 + lean, right: -3.2 },
      { key: "sill", tex: sill, up: 1.6, right: 0 },
      { key: "far", tex: pan(c.far ?? [], "far"), up: 1.6 - lean, right: 3.2 },
      {
        key: "hand",
        up: 0.72,
        right: 0,
        tex: this.atSill
          ? `\\rule{0.3em}{0.3em}\\;${this.dial === 1 ? "\\rule{1.4em}{0.06em}" : R.tex(rat(this.dial))}`
          : travelling
            ? `\\rule{${(Math.abs(this.travel) * 2.2 + 0.2).toFixed(2)}em}{0.1em}`
            : "\\rule{0.35em}{0.1em}",
      },
    ];
  }

  /**
   * The read, and it is the workhorse of `voice.md` §4: which pan is heavier, and by how much.
   * Nothing here evaluates the player; it describes the object they are standing in front of.
   */
  read(marked) {
    const tilt = this.claim.tilt ?? R.zero;
    if (!R.isZero(tilt)) {
      const n = R.abs(tilt);
      const kind = this.claim.tiltKind;
      const amount = kind ? `${R.canon(n)}${kind}` : R.canon(n);
      return { key: tilt.n > 0 ? "fail.tilt.near" : "fail.tilt.far", params: { n: amount } };
    }
    if (this.oneSided) return { key: "fail.onesided", params: {} };
    if (ungathered(this.claim)) return { key: "fail.load.unsettled", params: {} };
    if (marked?.failKey) return { key: marked.failKey, params: {} };
    return null;
  }

  state() {
    return {
      claim: claimTex(this.claim),
      grip: this.grip,
      holding: this.held?.kind === "sill" ? "sill" : `${this.held?.side}:${this.held?.index}`,
      travel: Math.round(this.travel * 100) / 100,
      dial: this.dial,
      tilt: R.canon(this.claim.tilt ?? R.zero),
      oneSided: this.oneSided,
      lastAct: this.lastAct,
      acts: this.acts,
      isolated: isolated(this.claim, this.unknown),
    };
  }
}

export default {
  id: "balance",
  pose(ctx) {
    const t = ctx.answerType;
    if (t !== "integer" && t !== "rational" && t !== "equation") return null;
    const claim = parseClaim(ctx.stem);
    // A threshold leans on purpose and belongs to TILT; a bare load has no Sill to stand at.
    if (!claim || claim.rel !== "=" || !claim.far) return null;
    const unknown = ctx.unknown || "x";
    const names = new Set();
    for (const t2 of [...claim.near, ...claim.far]) {
      if (isBundle(t2)) {
        for (const w of t2.inner) if (w.v) names.add(w.v);
      } else if (t2.v) {
        names.add(t2.v);
      }
    }
    // One unknown per claim you close (§2.1 rule 3). Two names is a load you SETTLE, not one you
    // close, and settling is SPAN's act.
    if (names.size !== 1 || !names.has(unknown)) return null;
    return new BalanceAct(ctx, claim);
  },
};
