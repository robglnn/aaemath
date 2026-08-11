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
 *   - **Seat one claim into another.** See below — this is round 3's addition and it is the reason
 *     this verb poses at all now.
 *
 * ==================================================================================================
 * WHY ROUND 2's BALANCE WAS 12 kB OF UNREACHABLE CODE
 *
 * The critic's headline: "BALANCE — the one verb where the hands genuinely perform the algebra, where
 * you carry a term over the Sill and it turns around — never poses, because `Balance.pose()` rejects
 * `names.size !== 1` and the scheduler serves nothing but `x + y = 20, x - y = 0` and `a, b` off
 * var-meaning."
 *
 * They were being generous. `Balance.pose()` never got as far as that guard: `Claim.js`'s lexer
 * refuses a bare comma, so `parseClaim("x + y = 14,\quad x - y = 0")` returned null and the shape that
 * is **40% of everything a new player is served** fell through five verbs to SPAN, where it became a
 * pair of magnitude dials. `var-meaning.twin`'s own shipped hint is "The second core has to sit
 * exactly where the first one does", and there was no act in the game that could do that.
 *
 * A comma between two claims is not notation this layer has to parse. It is the gap between two Sills
 * standing side by side. So a system is what it looks like — claims hanging one above the other, every
 * one of them grippable — and one new act joins them up:
 *
 *   **SEAT.** A claim you have reduced to `x = <something>` can be picked up and set into the other
 *   claim, and every socket cut for `x` takes what it says. `x - y = 0` carried over the Sill becomes
 *   `x = y`; seat that into `x + y = 14` and you are holding `y + y = 14`; gather it, share it, and
 *   the second core sits exactly where the first one does. Six acts, all of them physical, and the
 *   whole of it is elimination by substitution performed rather than described.
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
  markedLoadTex,
  namesOf,
  parseClaim,
  parseSystem,
  reachWard,
  settle,
  share,
  shed,
  solvedFor,
  substitute,
  swap,
  ungathered,
  valueOf,
} from "./Claim.js";

/** Every place a hand can go, across every Sill: near terms, the Sill, far terms, then the next claim. */
function gripRow(claims) {
  const out = [];
  claims.forEach((c, ci) => {
    c.near.forEach((t, i) => out.push({ kind: "term", claim: ci, side: "near", index: i, t }));
    out.push({ kind: "sill", claim: ci });
    (c.far ?? []).forEach((t, i) => out.push({ kind: "term", claim: ci, side: "far", index: i, t }));
  });
  return out;
}

class BalanceAct {
  constructor(ctx, claims, names, opts = {}) {
    this.id = opts.id ?? "balance";
    this.ctx = ctx;
    this.claims = claims;
    this.names = names;
    this.unknown = ctx.unknown || "x";
    this.scaffoldLevel = 0;
    this.grip = 0;
    /** −1 shed clear of the pan · 0 standing where it was · +1 over the Sill. */
    this.travel = 0;
    /** The share count dialled while standing at the Sill. Never 0; crossing zero turns a rail. */
    this.dial = 1;
    this.dialCarry = 0;
    this.acts = 0;
    this.seats = 0;
    this.carries = 0;
    this.history = [];
    this.oneSided = false;
    this.lastAct = null;
    this.settleFor = 0;
  }

  get row() {
    return gripRow(this.claims);
  }
  get held() {
    const row = this.row;
    return row[Math.min(this.grip, row.length - 1)];
  }
  get claim() {
    return this.claims[this.held?.claim ?? 0];
  }
  get atSill() {
    return this.held?.kind === "sill";
  }
  get isSystem() {
    return this.claims.length > 1;
  }

  _remember() {
    this.history.push(this.claims.map(cloneClaim));
    if (this.history.length > 24) this.history.shift();
  }

  _reseat() {
    const row = this.row;
    this.grip = Math.max(0, Math.min(this.grip, row.length - 1));
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
      if (this.travel !== 0) this.travel *= Math.max(0, 1 - step * 6);
      return;
    }
    if (this.atSill) {
      this.dialCarry += y * step * 2.6;
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
    carry(this.claims[h.claim], h.side, h.index);
    this.acts += 1;
    this.carries += 1;
    this.lastAct = "carry";
    this.settleFor = 0.22;
    this._reseat();
  }

  _shed() {
    const h = this.held;
    this.travel = 0;
    if (!h || h.kind !== "term" || isBundle(h.t)) return;
    this._remember();
    shed(this.claims[h.claim], h.side, h.index);
    this.oneSided = true;
    this.acts += 1;
    this.lastAct = "shed";
    this.settleFor = 0.22;
    this._reseat();
  }

  /** The other claim that has been reduced to a name, and the name it was reduced to. */
  _donor() {
    const mine = this.held?.claim ?? 0;
    for (let i = 0; i < this.claims.length; i += 1) {
      if (i === mine) continue;
      const name = solvedFor(this.claims[i]);
      if (!name) continue;
      if (namesOf(this.claims[mine]).has(name)) return { index: i, name };
    }
    return null;
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
      case "hold": {
        /**
         * THE SECOND GRIP, which means two things because there are two kinds of claim in your hands.
         *
         * On a SYSTEM it seats: the other claim, reduced to a name, is picked up and set into this
         * one. `hint.move.var-meaning.twin` — "The second core has to sit exactly where the first one
         * does" — has shipped since P17 and this is the first code that can perform it.
         *
         * On a single claim it is the other half of the Third Rung: the near grip at the Sill SHARES
         * both pans by the dialled count, this one GATHERS them by it. `\frac{x}{2} = 6` is a claim
         * whose near pan is half a thing, and no number of shares will ever make it whole;
         * `props-equality` is explicit that both directions are legal on a balance, and 24 committed
         * `eq-one-mult` items are unclosable without it.
         */
        const donor = this.isSystem ? this._donor() : null;
        if (donor) {
          this._remember();
          const from = this.claims[donor.index];
          if (!substitute(this.claims[this.held.claim], donor.name, from.far ?? [])) {
            this.history.pop();
            return false;
          }
          this.seats += 1;
          this.acts += 1;
          this.lastAct = "seat";
          this.settleFor = 0.24;
          this._reseat();
          return true;
        }
        if (!this.atSill || this.dial === 0) return false;
        this._remember();
        share(this.claim, rat(1, this.dial));
        this.dial = 1;
        this.acts += 1;
        this.lastAct = "gatherPans";
        return true;
      }
      case "back":
        if (!this.history.length) return false;
        this.claims = this.history.pop();
        this.oneSided = this.claims.some((c) => !R.isZero(c.tilt ?? R.zero));
        this._reseat();
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
    const claim = this.claims[h.claim];
    if (h.kind === "sill") {
      this._remember();
      if (this.dial === 1) swap(claim);
      else share(claim, rat(this.dial));
      this.dial = 1;
      this.acts += 1;
      this.lastAct = "share";
      return true;
    }
    if (isBundle(h.t)) {
      this._remember();
      reachWard(h.t);
      foldOpenBundles(claim);
      this.acts += 1;
      this.lastAct = "open";
      this._reseat();
      return true;
    }
    // Two of one kind standing apart on this pan gather into one, and the kind never changes.
    const load = h.side === "near" ? claim.near : claim.far;
    const mate = load.findIndex((t, i) => i !== h.index && !isBundle(t) && (t.v ?? null) === (h.t.v ?? null));
    if (mate >= 0) {
      this._remember();
      gather(claim, h.side, h.index, mate);
      this.acts += 1;
      this.lastAct = "gather";
      this._reseat();
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

  /** One claim, spelled as a learner could have typed it. */
  _claimCanon(c) {
    const side = (load) =>
      settle(load)
        .map((t) => (t.v == null ? R.canon(t.c) : `${R.canon(t.c)}*${t.v}`))
        .join(" + ");
    return `${side(c.near)} = ${side(c.far ?? [])}`;
  }

  /**
   * What the hands built, as a string a learner could have typed.
   *
   * An isolated claim closes at a value; a system closes at one reading per name; anything else is
   * handed over exactly as it stands, because a claim you set down half-solved IS your response and
   * the checker is entitled to read it. That is how `fail.onesided`, `fail.sill.sign` and `fail.twin`
   * get diagnosed at all.
   */
  response() {
    if (!this.ready()) return null;
    if (!this.isSystem) {
      const c = this.claims[0];
      if (isolated(c, this.unknown)) {
        const v = valueOf(c);
        if (v) return this.ctx.answerType === "equation" ? `${this.unknown} = ${R.canon(v)}` : R.canon(v);
      }
      return this._claimCanon(c);
    }
    const parts = [];
    for (const n of this.names) {
      const c = this.claims.find((cl) => solvedFor(cl) === n);
      if (!c) return this.claims.map((cl) => this._claimCanon(cl)).join(", ");
      const v = valueOf(c);
      parts.push(
        `${n} = ${
          v
            ? R.canon(v)
            : settle(c.far ?? [])
                .map((t) => (t.v == null ? R.canon(t.c) : `${R.canon(t.c)}*${t.v}`))
                .join(" + ")
        }`
      );
    }
    return parts.join(", ");
  }

  /**
   * The claims, standing on pans that are physically apart when they lean.
   *
   * The tilt is real geometry, not a graphic: the near-pan row rises and the far-pan row sinks by
   * the same amount, so a claim you unbalanced is a pair of rows that no longer read as one line.
   * That is `world.md` Law 3 rendered with nothing but two `math:show` positions. A system stands
   * one claim under the other, and every Sill in it is a place your hand can be.
   */
  rows() {
    const held = this.held;
    const out = [];
    const step = 0.92;
    this.claims.forEach((c, ci) => {
      const base = this.isSystem ? (this.claims.length - 1) * step * 0.5 - ci * step : 0;
      const t = Math.max(-1.6, Math.min(1.6, R.num(c.tilt ?? R.zero) / 6));
      const lean = t * 0.34;
      const pan = (load, side) =>
        markedLoadTex(load, held?.kind === "term" && held.claim === ci && held.side === side ? held.index : -1);
      const rel = { "=": "=", ">=": "\\ge", "<=": "\\le", ">": ">", "<": "<" }[c.rel] ?? "=";
      const onSill = held?.kind === "sill" && held.claim === ci;
      out.push({ key: `near-${ci}`, tex: pan(c.near, "near"), up: base + lean, right: -2.9 });
      out.push({ key: `sill-${ci}`, tex: onSill ? `\\rule{0.3em}{0.3em}\\,${rel}` : rel, up: base, right: 0 });
      out.push({ key: `far-${ci}`, tex: pan(c.far ?? [], "far"), up: base - lean, right: 2.9 });
    });
    const travelling = this.travel !== 0 && held?.kind === "term";
    const donor = this.isSystem ? this._donor() : null;
    out.push({
      key: "hand",
      up: (this.isSystem ? -(this.claims.length - 1) * step * 0.5 : 0) - 0.78,
      right: 0,
      tex: this.atSill
        ? `\\rule{0.3em}{0.3em}\\;${this.dial === 1 ? "\\rule{1.4em}{0.06em}" : R.tex(rat(this.dial))}`
        : travelling
          ? `\\rule{${(Math.abs(this.travel) * 2.2 + 0.2).toFixed(2)}em}{0.1em}`
          : donor
            ? // A core standing ready to be set into the socket that is cut for it. It is a mark and
              // not a label: `voice.md` §1 has no word this could be spelled with.
              `\\rule{0.34em}{0.34em}\\;${donor.name}`
            : "\\rule{0.35em}{0.1em}",
    });
    return out;
  }

  /**
   * The read, and it is the workhorse of `voice.md` §4: which pan is heavier, and by how much.
   * Nothing here evaluates the player; it describes the object they are standing in front of.
   *
   * ROUND 3 REORDERED THIS. The critic measured 20 deliberate failures and `misconception` was null
   * on all 20, because every verb answered with its own structural guess before the shipped checker's
   * tagged distractor was ever consulted — so `fail.sill.sign`, "It came over the Sill and did not
   * turn around", was unreachable. A DECLARED distractor is authored knowledge about this exact item;
   * a structural read is this verb noticing something about the object in its hands. The authored one
   * goes first. `check()`'s undiagnosed `fail.slip` carries no misconception, so it stays last and the
   * structural reads still cover everything the bank has no name for.
   */
  read(marked) {
    if (marked?.misconception && marked?.failKey) return { key: marked.failKey, params: {} };
    for (const c of this.claims) {
      const tilt = c.tilt ?? R.zero;
      if (!R.isZero(tilt)) {
        const n = R.abs(tilt);
        const amount = c.tiltKind ? `${R.canon(n)}${c.tiltKind}` : R.canon(n);
        return { key: tilt.n > 0 ? "fail.tilt.near" : "fail.tilt.far", params: { n: amount } };
      }
    }
    if (this.oneSided) return { key: "fail.onesided", params: {} };
    if (this.claims.some(ungathered)) return { key: "fail.load.unsettled", params: {} };
    if (marked?.failKey) return { key: marked.failKey, params: {} };
    return null;
  }

  state() {
    const held = this.held;
    return {
      system: this.isSystem,
      claims: this.claims.map(claimTex),
      names: this.names.slice(),
      grip: this.grip,
      holding: held?.kind === "sill" ? `sill:${held.claim}` : `${held?.claim}:${held?.side}:${held?.index}`,
      travel: Math.round(this.travel * 100) / 100,
      dial: this.dial,
      seatReady: this._donor()?.name ?? null,
      seats: this.seats,
      carries: this.carries,
      tilt: this.claims.map((c) => R.canon(c.tilt ?? R.zero)),
      oneSided: this.oneSided,
      lastAct: this.lastAct,
      acts: this.acts,
      solved: this.claims.map((c) => solvedFor(c)),
    };
  }
}

/** Single letters standing in a stem, in the order they first appear. */
function namesInOrder(tex) {
  const out = [];
  const s = String(tex ?? "").replace(/\\[a-zA-Z]+/g, " ");
  for (const m of s.matchAll(/[a-zA-Z]/g)) if (!out.includes(m[0])) out.push(m[0]);
  return out;
}

export default {
  id: "balance",
  pose(ctx) {
    const t = ctx.answerType;
    if (t !== "integer" && t !== "rational" && t !== "equation" && t !== "pair") return null;
    const unknown = ctx.unknown || "x";

    /**
     * MORE THAN ONE SILL. This is the branch the critic's action 2 asked for, and it is 40% of what a
     * new player is served: `x + y = 14,\quad x - y = 0`, one claim per Sill, standing side by side.
     */
    if (t === "pair") {
      const claims = parseSystem(ctx.stem);
      if (!claims || claims.length < 2) return null;
      const names = new Set();
      for (const c of claims) for (const n of namesOf(c)) names.add(n);
      if (names.size < 2) return null;
      // Every name has to be reachable from the claims themselves; a system with a name nobody
      // constrains is not a system this verb can close, and dialling it would be SPAN's act.
      const ordered = namesInOrder(ctx.stem).filter((n) => names.has(n));
      if (ordered.length !== names.size) return null;
      return new BalanceAct(ctx, claims, ordered);
    }

    const claim = parseClaim(ctx.stem);
    // A threshold leans on purpose and belongs to TILT; a bare load has no Sill to stand at.
    if (!claim || claim.rel !== "=" || !claim.far) return null;
    const names = namesOf(claim);
    // One unknown per claim you close (§2.1 rule 3). Two names across ONE Sill is a load you SETTLE,
    // not one you close, and settling is SPAN's act.
    if (names.size !== 1 || !names.has(unknown)) return null;
    return new BalanceAct(ctx, [claim], [unknown]);
  },
};
