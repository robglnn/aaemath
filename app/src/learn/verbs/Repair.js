/**
 * P19 · REPAIR — walk up the working, strike the joint that will not hold, and rebuild the line.
 *
 * ==================================================================================================
 * THE MEASUREMENT THIS FILE EXISTS TO ANSWER
 *
 * Round 3's critic, having played the shipped game and then run the shipped `VERBS` array over the
 * shipped bank:
 *
 * > "796 items (69.1%) pose NO verb at all: the routing is perfectly systematic — EVERY `repair` item
 * > and nearly every `generate|construction` item in every knowledge point falls through all five
 * > verbs to `Teaching`'s typed KaTeX entry slot... `repair` and `generate` are the two pedagogically
 * > richest forms in the bank, and they are exactly the two with no verb."
 *
 * `repair` is 419 committed items, present in all 32 knowledge points, and it is the largest single
 * unserved block in the game. Their first demanded action names the act, and it is the right one:
 *
 * > "Stand the working as a stack of rows in world space and let the player walk up it and strike the
 * > joint that will not hold, then rebuild that line with the verb the line's own shape implies."
 *
 * ==================================================================================================
 * THE ACT, AND WHY THE STRIKE IS A COMMITMENT RATHER THAN A PROBE
 *
 * The working stands as a stack: line 1 at the top, line 2 under it, line 3 under that. Between any
 * two lines there is a **joint** — the claim that the lower line follows from the upper one. Your
 * hand walks up and down the stack, one joint at a time.
 *
 * **Strike the joint and the line under it falls away.** Always. It does not test the joint, it does
 * not resist on the ones that hold, and nothing about the stack changes colour. That is deliberate
 * and it is the single most important decision in this file: a strike that only broke the WRONG joint
 * would make walking the stack and hitting every joint in turn a hundred-percent strategy with no
 * mathematics in it, which is exactly the leak `Claim.js`'s header exists to close. Striking is you
 * saying *this is the one*. The world does not argue, and the response you build carries the line
 * number, so saying it about the wrong joint is a wrong answer with a specific shape.
 *
 * **Then the line above lands in your hands, and its own shape decides what your hands can do.** A
 * bundle is a lock and you drive the outside value through its wards (DISTRIBUTE). A row of joins is
 * a row of joins and you close them in the order you choose (COMBINE). A claim across a Sill is a
 * claim and you carry terms over it (BALANCE). A rail with a mark is a threshold and the detent goes
 * over when you turn it (TILT). A row with a socket in it takes the charge first (SEAT). None of
 * these is new code and none of them is a special case: `repair` is the form that asks a learner to
 * redo one step correctly, and the verbs are already the steps.
 *
 * What you rebuilt drops into the gap in the stack, and the response is the joint you named and the
 * reading you built for it — `2: -4*x + -7` — which is exactly the two-part shape
 * `ItemBank.canonRepair` has always parsed and `answer.canonical` has always been spelled in
 * (`2|-4*x + -7`). Nothing about this needs a text box, and nothing about it needed a new checker.
 *
 * ==================================================================================================
 * WHAT IT REFUSES TO SHOW
 *
 * The stack never marks a joint. The struck line is GONE rather than crossed out, because a crossed
 * out line is a verdict about it. The lines below the strike keep standing exactly as written — they
 * are what the working said, and this verb does not quietly re-derive them. And no part of the
 * rebuild leans toward the reading that closes: see `Claim.js`'s header, and `Span.js`'s, and the
 * round-2 measurement that put them there.
 */
import Tilt from "./Tilt.js";
import Distribute from "./Distribute.js";
import Seat from "./Seat.js";
import Combine from "./Combine.js";
import Balance from "./Balance.js";
import { R, loadCanon, parseChain, parseClaim, parseSystem, settle } from "./Claim.js";

/**
 * The order a line is offered to hands, and it is `Verbs.js`'s order for the same reasons: a rail
 * that leans is never a claim that fell, a lock is opened before a load is gathered, a charged socket
 * is filled before the row is settled, and a Sill is last because most lines that have one also have
 * something simpler standing on them.
 */
const LINE_VERBS = [Tilt, Distribute, Seat, Combine, Balance];

/** Metres between two rows of the standing stack. Matches the hands' own row spacing. */
const ROW = 0.82;

/**
 * What KIND of thing a line is, which decides how the rebuilt reading is spelled.
 *
 * `ItemBank`'s `canonRepairAll` reads a repair response in every kind it can and takes the one that
 * matches, so this is not a correctness gate — it is what makes the sub-act spell its answer the way
 * the line was written. A claim rebuilt as a bare number would be a different statement.
 */
function kindOf(tex) {
  if (parseSystem(tex)) return "pair";
  const claim = parseClaim(tex);
  if (claim?.rel === "=") return "equation";
  if (claim?.rel) return "inequality";
  return "expression";
}

/** A line, spelled as a learner could have typed it, for the case where nothing was rebuilt. */
function lineCanon(tex) {
  const claim = parseClaim(tex);
  const side = (load) =>
    settle(load)
      .map((t) => (t.v == null ? R.canon(t.c) : `${R.canon(t.c)}*${t.v}`))
      .join(" + ");
  if (claim?.rel && claim.far) {
    const rel = { "=": "=", ">=": ">=", "<=": "<=", ">": ">", "<": "<" }[claim.rel] ?? "=";
    return `${side(claim.near)} ${rel} ${side(claim.far)}`;
  }
  if (claim) return loadCanon(claim.near);
  const chain = parseChain(tex);
  if (chain && !chain.ops.length) return loadCanon(chain.parts);
  return null;
}

class RepairAct {
  constructor(ctx, lines, joints) {
    this.id = "repair";
    this.ctx = ctx;
    this.lines = lines;
    /** Every joint that can be struck, as the index of the line BELOW it. Never line 1. */
    this.joints = joints;
    this.scaffoldLevel = 0;
    /**
     * The presenter stands the same working in its own column, and two copies of a three-row stack
     * is the taller of the two frames the round-3 critic could not read at 720p. The runtime veils
     * the presenter's copy while these hands are on it, and stands it back up on let-go.
     */
    this.veilWorking = true;
    this.grip = 0;
    /** The line that was struck out of the stack, 1-based, or 0 while the stack is whole. */
    this.struck = 0;
    /** The hands the struck line's SOURCE put in your grip. Null when nothing could read it. */
    this.hands = null;
    /** How far the strike has been driven, 0..1, when it is done with the body rather than the grip. */
    this.blow = 0;
    this.acts = 0;
    this.strikes = 0;
    this.shear = false;
    this.settleFor = 0;
  }

  get joint() {
    return this.joints[Math.min(this.grip, this.joints.length - 1)] ?? this.joints[0];
  }
  get working() {
    return this.struck > 0;
  }

  /** The line the struck one has to follow from: the row directly above the joint. */
  _source() {
    return this.lines[this.struck - 2] ?? null;
  }

  /**
   * Strike the joint under your hand. The line below it comes out of the stack and the line above it
   * lands in your hands, in whatever shape it is.
   */
  _strike(atLine) {
    if (this.struck > 0) return false;
    const line = atLine ?? this.joint;
    if (!line || line < 2 || line > this.lines.length) return false;
    this.struck = line;
    this.blow = 0;
    this.strikes += 1;
    this.acts += 1;
    this.settleFor = 0.2;
    const src = this._source();
    const lineCtx = { ...this.ctx, answerType: kindOf(src ?? ""), stem: src ?? "" };
    for (const verb of LINE_VERBS) {
      let act = null;
      try {
        act = verb.line?.(src, lineCtx) ?? null;
      } catch {
        act = null;
      }
      if (act) {
        this.hands = act;
        break;
      }
    }
    return true;
  }

  /** Put the line back and let the stack stand whole again. Nothing was committed by striking. */
  _reseat() {
    if (this.struck === 0) return false;
    this.grip = Math.max(0, this.joints.indexOf(this.struck));
    this.struck = 0;
    this.hands = null;
    this.blow = 0;
    this.acts += 1;
    this.settleFor = 0.16;
    return true;
  }

  fixed(step, hand) {
    if (this.settleFor > 0) {
      this.settleFor = Math.max(0, this.settleFor - step);
      return;
    }
    if (this.working) {
      // The hands are in the gap. The body drives whatever is in them.
      if (this.hands) {
        try {
          this.hands.fixed(step, hand);
        } catch {
          /* a verb that cannot perform an act simply does not perform it */
        }
      }
      return;
    }
    const y = hand.move.y;
    if (Math.abs(y) < 0.12) {
      this.blow = Math.max(0, this.blow - step * 4);
      return;
    }
    if (y < 0) {
      this.blow = Math.max(0, this.blow + y * step * 3);
      return;
    }
    // A blow is a lean, the same movement every other verb in this folder is driven by: about a third
    // of a second of push and the joint gives.
    this.blow = Math.min(1, this.blow + y * step * 3);
    if (this.blow >= 1) this._strike();
  }

  act(name, hand) {
    if (this.working) {
      switch (name) {
        case "back": {
          /**
           * BACK OUT OF IT, one step at a time.
           *
           * The sub-act's own undo goes first; when it has nothing left to give back, the next press
           * puts the struck line back in the stack. So a player who struck the wrong joint walks out
           * of it with the same button they were already using, and never has to be told there is a
           * different one. `Verbs.js` guarantees `interact` always resolves, so this is a
           * convenience rather than the only way out — but it is the one that keeps the claim.
           */
          let undone = false;
          try {
            undone = this.hands?.act?.("back", hand) === true;
          } catch {
            undone = false;
          }
          if (undone) {
            this.acts += 1;
            return true;
          }
          return this._reseat();
        }
        default: {
          let did = false;
          try {
            did = this.hands?.act?.(name, hand) === true;
          } catch {
            did = false;
          }
          if (did) this.acts += 1;
          return did;
        }
      }
    }
    switch (name) {
      case "stepNext":
        this.grip = (Math.min(this.grip, this.joints.length - 1) + 1) % this.joints.length;
        this.blow = 0;
        return true;
      case "stepPrev":
        this.grip = (Math.min(this.grip, this.joints.length - 1) + this.joints.length - 1) % this.joints.length;
        this.blow = 0;
        return true;
      case "take":
        return this._strike();
      case "back":
        return false;
      default:
        return false;
    }
  }

  /**
   * A joint has been named. That is a response.
   *
   * The bar is this low for the same reason SPAN's is: refusing to let a player set down a line they
   * have not rebuilt would be the world telling them it is not finished, which is a verdict delivered
   * while their hands are still on it. Naming the joint and leaving the reading as the line above
   * says it is a real claim about the working — usually a wrong one — and the world answers it.
   */
  ready() {
    return this.struck > 0 && this.response() != null;
  }

  response() {
    if (this.struck <= 0) return null;
    let built = null;
    try {
      built = this.hands?.response?.() ?? null;
    } catch {
      built = null;
    }
    const value = built ?? lineCanon(this._source() ?? "");
    if (!value) return null;
    return `${this.struck}: ${value}`;
  }

  /**
   * The stack, with a hole in it where your hands are.
   *
   * Rows above the strike stand where they always did. The struck line is not drawn at all — a line
   * with a stroke through it is a verdict about that line, and this verb has no opinion about which
   * joint was the one. What stands in the gap is whatever the source line became in your hands, and
   * the rows below are pushed down by however much room those hands need.
   */
  rows() {
    const out = [];
    let sub = [];
    if (this.working && this.hands) {
      try {
        sub = this.hands.rows() ?? [];
      } catch {
        sub = [];
      }
    }
    const lowest = sub.reduce((m, r) => Math.min(m, r.up ?? 0), 0);
    const extra = this.working ? Math.max(0, -lowest) + 0.2 : 0;
    this.lines.forEach((tex, i) => {
      const n = i + 1;
      if (this.working && n === this.struck) return;
      const below = this.working && n > this.struck ? extra : 0;
      // The joint your hand is on is a plate resting between two rows, drawn on the row under it —
      // it is a mark and not a label, exactly as every other grip in this folder is.
      const marked = !this.working && n === this.joint;
      out.push({
        key: `line-${n}`,
        tex: marked ? `\\rule{0.3em}{0.3em}\\,${tex}` : tex,
        up: -(i * ROW) - below,
        right: 0,
      });
    });
    if (this.working) {
      for (const r of sub) out.push({ ...r, key: `hands-${r.key}`, up: -((this.struck - 1) * ROW) + (r.up ?? 0) });
      return out;
    }
    out.push({
      key: "hand",
      up: -(this.lines.length * ROW) - 0.2,
      right: 0,
      // The blow, gathering. Light first, then stone: a short bar that lengthens as the lean builds.
      tex: `\\rule{${(0.35 + this.blow * 1.6).toFixed(2)}em}{0.12em}`,
    });
    return out;
  }

  /**
   * The read. This verb has no structural opinion of its own about which joint was the one — that IS
   * the question, and a verb that could answer it would have already answered it for the player.
   *
   * So the bank's tagged distractor goes first, exactly as it does in every other verb here, and what
   * comes second is whatever the HANDS know about the object they were holding when it fell: a
   * bracket that opened onto one thing, a socket that never took its charge, a pan that was left
   * low. That is the specific sentence `voice.md` §4 requires and it comes from the thing the player
   * was actually doing.
   */
  read(marked) {
    if (marked?.misconception && marked?.failKey) return { key: marked.failKey, params: {} };
    let sub = null;
    try {
      sub = this.hands?.read?.(null) ?? null;
    } catch {
      sub = null;
    }
    if (sub?.key) return sub;
    if (marked?.failKey) return { key: marked.failKey, params: {} };
    return null;
  }

  state() {
    let inner = null;
    try {
      inner = this.hands?.state?.() ?? null;
    } catch {
      inner = null;
    }
    return {
      lines: this.lines.slice(),
      joints: this.joints.slice(),
      joint: this.joint,
      struck: this.struck,
      source: this._source(),
      hands: this.hands?.id ?? null,
      blow: Math.round(this.blow * 100) / 100,
      strikes: this.strikes,
      acts: this.acts,
      inner,
    };
  }
}

export default {
  id: "repair",

  /**
   * Pose a working with at least two lines in it, when at least one joint has a source line a pair of
   * hands can read.
   *
   * The last clause is not a hedge, it is the honest gate: a stack you can strike but not rebuild is
   * a verb that takes a line away and offers nothing back, and `translate-phrase`'s working — a bare
   * `n` above a sentence the player has to hear rather than derive — is genuinely not this act.
   * `probe("verbs").stats.unposedByType` counts every one of those so the remaining gap stays a
   * measured number rather than an assumption.
   */
  pose(ctx) {
    if (ctx.form !== "repair" && ctx.answerType !== "repair") return null;
    const lines = (ctx.working ?? []).map((t) => String(t ?? "")).filter(Boolean);
    if (lines.length < 2) return null;
    const joints = [];
    for (let n = 2; n <= lines.length; n += 1) {
      const src = lines[n - 2];
      const lineCtx = { ...ctx, answerType: kindOf(src), stem: src };
      const readable = LINE_VERBS.some((v) => {
        try {
          return !!v.line?.(src, lineCtx);
        } catch {
          return false;
        }
      });
      if (readable || lineCanon(src)) joints.push(n);
    }
    if (!joints.some((n) => LINE_VERBS.some((v) => {
      const src = lines[n - 2];
      try {
        return !!v.line?.(src, { ...ctx, answerType: kindOf(src), stem: src });
      } catch {
        return false;
      }
    }))) return null;
    return new RepairAct(ctx, lines, joints);
  },
};
