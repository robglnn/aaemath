/**
 * P19 · DISTRIBUTE — drive one value through every ward of a lock.
 *
 * `design/world.md` §11a, `distribute-numeric`: "One value has to reach every ward. Cap a ward to
 * save value and the lock shears across all of them." And §4.2: a **bundle** is "terms strapped
 * together and carried as one. Open it and everything inside takes what the outside took." A
 * **ward** is one of them.
 *
 * The act is a drive, not a decision. You put the outside value into the mouth of the lock and push:
 * it travels, it reaches the first ward and that ward's rating visibly climbs, you keep pushing and
 * it reaches the second. Stop pushing and it stops where it is — **with the bracket still open around
 * everything it has not got to**, which is exactly what `3\left(2x + 5\right)` looks like once the
 * first ward has taken the 3 and the second has not:
 *
 *     3\left(2x + 5\right)   ->   6x + 3\left(5\right)   ->   6x + 15
 *
 * The middle state is not a hint and it is not a warning. It is the object, drawn correctly, at the
 * point the hand stopped. A player who sets it down there has said `6x + 5`, which is the tagged
 * misconception `distributed-to-first-only` and gets `fail.partial.open` — "The bracket opened onto
 * one thing and shut on the other." The world does not decide that for them. They can see the
 * bracket. They set it down anyway, and then they can see why.
 *
 * The Fourth Rung is called **Opener** and this is what it is a permission to do.
 */
import { R, bundleTerms, isBundle, loadCanon, loadTex, parseClaim, reachWard } from "./Claim.js";

class DistributeAct {
  constructor(ctx, load, lockIndex) {
    this.id = "distribute";
    this.ctx = ctx;
    this.load = load;
    this.lock = lockIndex;
    this.scaffoldLevel = 0;
    /** How far the outside value has travelled toward the next ward, 0..1. */
    this.drive = 0;
    this.reached = 0;
    this.acts = 0;
    this.settleFor = 0;
  }

  get bundleTerm() {
    return this.load[this.lock];
  }
  get wards() {
    return this.bundleTerm?.inner?.length ?? 0;
  }

  fixed(step, hand) {
    if (this.settleFor > 0) {
      this.settleFor = Math.max(0, this.settleFor - step);
      return;
    }
    const y = hand.move.y;
    if (Math.abs(y) < 0.12) return;
    // A ward every 0.36 s of push at a walk. The whole lock on a three-ward bundle is about a
    // second of movement, which is the resolve time this project's quality bar asks for.
    this.drive = Math.max(0, Math.min(1, this.drive + y * step * 2.8));
    if (this.drive >= 1) {
      this.drive = 0;
      if (reachWard(this.bundleTerm)) {
        this.reached = this.bundleTerm.reached;
        this.acts += 1;
        this.settleFor = 0.16;
      }
    }
    if (this.drive <= 0 && y < 0 && this.bundleTerm?.reached > 0) {
      // Pull the value back out of a ward. The ward's rating drops and the bracket closes over it
      // again, because nothing in the Margin is one-way.
      this.bundleTerm.reached -= 1;
      this.reached = this.bundleTerm.reached;
      this.drive = 0.9;
      this.acts += 1;
      this.settleFor = 0.16;
    }
  }

  act(name) {
    switch (name) {
      case "take":
        if (reachWard(this.bundleTerm)) {
          this.reached = this.bundleTerm.reached;
          this.drive = 0;
          this.acts += 1;
          return true;
        }
        return false;
      case "back":
        if (this.bundleTerm?.reached > 0) {
          this.bundleTerm.reached -= 1;
          this.reached = this.bundleTerm.reached;
          this.acts += 1;
          return true;
        }
        return false;
      default:
        return false;
    }
  }

  ready() {
    return this.acts > 0;
  }

  /**
   * What the lock currently is. Wards the value reached carry it; wards it did not are still
   * standing inside the bracket at the rating they came with. That IS the response — no correction,
   * no completion, no "did you mean".
   */
  response() {
    if (!this.ready()) return null;
    const flat = [];
    for (const t of this.load) flat.push(...(isBundle(t) ? bundleTerms(t) : [t]));
    return loadCanon(flat);
  }

  rows() {
    const b = this.bundleTerm;
    const rows = [{ key: "load", tex: loadTex(this.load), up: 0, right: 0 }];
    const depth = (b?.reached ?? 0) + this.drive;
    rows.push({
      key: "hand",
      up: -0.78,
      right: 0,
      // The value, standing as far into the lock as it has got. One notch per ward, and the last
      // notch is only as long as the push has carried it.
      tex: `${R.tex(b?.k ?? R.one)}\\;\\rule{${(0.3 + depth * 0.95).toFixed(2)}em}{0.12em}\\;\\rule{${(0.24 * Math.max(0, this.wards - depth)).toFixed(2)}em}{0.04em}`,
    });
    return rows;
  }

  read(marked) {
    // A DECLARED distractor is authored knowledge about this exact item and goes first; see
    // `Balance.js`'s `read` for the round-2 measurement (20 failures, 20 nulls) that reordered this.
    if (marked?.misconception && marked?.failKey) return { key: marked.failKey, params: {} };
    const b = this.bundleTerm;
    if (b && b.reached > 0 && b.reached < b.inner.length) return { key: "fail.partial.open", params: {} };
    if (b && b.reached === 0) return { key: "fail.load.unsettled", params: {} };
    if (marked?.failKey) return { key: marked.failKey, params: {} };
    return null;
  }

  state() {
    const b = this.bundleTerm;
    return {
      load: loadTex(this.load),
      wards: this.wards,
      reached: b?.reached ?? 0,
      drive: Math.round(this.drive * 100) / 100,
      acts: this.acts,
    };
  }
}

export default {
  id: "distribute",
  pose(ctx) {
    const t = ctx.answerType;
    if (t !== "expression" && t !== "integer" && t !== "rational") return null;
    const claim = parseClaim(ctx.stem);
    // A bundle standing on a claim's pan is BALANCE's to open, because opening it is one act inside
    // a solve. A bundle standing alone IS the claim, and opening it is the whole of it.
    if (!claim || claim.rel !== null) return null;
    const lock = claim.near.findIndex((term) => isBundle(term) && term.inner.length >= 2);
    if (lock < 0) return null;
    return new DistributeAct(ctx, claim.near, lock);
  },

  /**
   * The same drive, posed on ONE LINE of a working rather than on a stem. `Repair.js` is the caller:
   * `-\left(4x + 7\right)` is the line above a joint that did not hold, and driving the outside value
   * through both wards is what the line below it should have said. Stopping at the first ward builds
   * `-4x + 7`, which is the tagged misconception `flip-first-term-only` — the same middle state this
   * verb has always drawn, now standing in a gap in a stack of working.
   */
  line(tex, ctx) {
    const claim = parseClaim(tex);
    if (!claim || claim.rel !== null) return null;
    const lock = claim.near.findIndex((term) => isBundle(term) && term.inner.length >= 2);
    if (lock < 0) return null;
    return new DistributeAct(ctx, claim.near, lock);
  },
};
