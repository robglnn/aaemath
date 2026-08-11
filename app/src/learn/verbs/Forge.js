/**
 * P19 · FORGE — cut a term, set it on the pan, and build the thing that has the property.
 *
 * ==================================================================================================
 * THE OTHER HALF OF THE 69%
 *
 * Round 3's critic measured that `repair` and `generate` "are the two pedagogically richest forms in
 * the bank, and they are exactly the two with no verb". `Repair.js` is the first of those. This is
 * the second: 303 committed `generate` items across the whole graph, every one of which asks the
 * learner to AUTHOR an object with a declared property rather than to close one somebody else wrote.
 *
 *     "Author a claim on this site that closes at 3."          claimClosesAt   116
 *     "Stack a load that gathers to -2*x + -14."               loadGathersTo    74
 *     "Stack a load in r that reads 94 when the socket holds 12."  loadReadsAt  44
 *     "Set a rail whose admitted stretch is x >= 12."          markAdmits       31
 *     "Cut a lock with two wards that opens at 30."            loadAuthor       16
 *     "Bring one more term that will stand with 6*x."          partitionWitness 12
 *     "Stack a load of 2 terms with one fixed weight among them."  loadShape     5
 *     "Cut two sockets under different names that hold the same value."  namesDiffer 5
 *
 * Every one of those verbs — *author*, *stack*, *cut*, *set*, *bring* — is already a physical
 * instruction, and there was no pair of hands in the game that could obey it. There is now, and it is
 * one act repeated: **you hold a blank, you shape it, you set it down.**
 *
 *   - The blank is a term. The body dials its **count** — forward lengthens, back shortens — exactly
 *     as SPAN walks a deck out, because a count IS a magnitude and this is the same movement.
 *   - The second grip shares the blank into **parts**, so a load with a third in it can be built
 *     rather than typed.
 *   - The second grip and a bumper change the blank's **kind**: a fixed weight, or any name standing
 *     in the claim. §2.1 rule 9 is why kind is a separate axis from count and always will be.
 *   - The near grip **sets it down** on the pan you are standing at, and a fresh blank is in your
 *     hands. The load grows to the left of you, in the order you built it.
 *   - The second grip and the near grip **strap** what you are about to set into a bundle: a lock
 *     whose outside count is the blank you were holding, open until you strap it shut. That is how
 *     `2 - 2\left(x + 8\right)` gets built by a person rather than spelled by one.
 *   - Walk to the **Sill** and the near grip hangs a mark on it — nothing, then a level Sill, then a
 *     detent on either side of it. Walk past the Sill and you are on the far pan.
 *
 * ==================================================================================================
 * WHY THIS IS ALSO THE ANSWER TO THE PAD
 *
 * The critic's second action: *"Give the typed-entry fallback a gamepad path, or refuse to serve
 * unposed items to a pad player... Shipping a state where the primary input device cannot answer 69%
 * of the content is the §6b failure in a new costume."*
 *
 * They offer a character wheel as one option and it is the wrong one: a radial alphabet is a text box
 * with a thumbstick, and this project's whole thesis is that the mathematics is the mechanic. So the
 * pad's route to the remaining content is not a keyboard — it is this verb, which poses on every
 * `generate` item and on every `expression`, `equation` and `inequality` no other verb reads, takes
 * its whole input through `input:action` and `input:move` (Pad:RT, Pad:LT, Pad:LB, Pad:RB, Pad:B,
 * Pad:X, left stick), and can build any object the answer grammar can spell. What is left after it is
 * counted, published on `probe("verbs").stats.unposedByType`, and — for a pad player specifically —
 * on `probe("verbs").pad`.
 *
 * ==================================================================================================
 * WHAT IT REFUSES TO SHOW
 *
 * The property is never on the wire (`learn:present` carries the open reading and nothing else), so
 * this verb could not lean toward a correct build even if it wanted to. Nothing here says whether
 * what you have built has the property. You build it, you set it down, and the world answers.
 */
import { R, rat, isBundle, namesOf, parseClaim, parseSystem } from "./Claim.js";

/** Sim seconds a held dial waits after its first notch, so a short push means exactly one. */
const LEAD = 0.34;
/** Sim seconds the dial takes to get from two notches a second up to seven. */
const RAMP = 1.4;

const RELS = [null, "=", ">=", "<=", ">", "<"];
const REL_TEX = { "=": "=", ">=": "\\ge", "<=": "\\le", ">": ">", "<": "<" };

/** Single letters standing in a TeX string, in the order they first appear. */
function namesIn(tex) {
  const out = [];
  const s = String(tex ?? "").replace(/\\[a-zA-Z]+/g, " ");
  for (const m of s.matchAll(/[a-zA-Z]/g)) if (!out.includes(m[0])) out.push(m[0]);
  return out;
}

/**
 * One term, spelled as a learner could have typed it.
 *
 * `3*x` and not `3x`, because `ItemBank.ENTRY_GRAMMAR` has the star and the bank's own canonical
 * answers are written with it. A bundle is the exception and it matters: `shapeOK`'s
 * `negativeOutside` test is the literal regexp `/-\s*\d*\s*\(/`, so a lock has to be written the way
 * anybody writes one — `-2(x + 8)`, with the count against the bracket and no star between them — or
 * a correctly built lock fails a surface test it satisfies in every other spelling.
 */
function termSurface(t, first) {
  if (isBundle(t)) {
    const k = t.k;
    const mag = R.abs(k);
    const head = R.eq(mag, R.one) ? "" : R.canon(mag);
    const body = loadSurface(t.inner);
    const piece = `${head}(${body})`;
    if (first) return k.n < 0 ? `-${piece}` : piece;
    return k.n < 0 ? `- ${piece}` : `+ ${piece}`;
  }
  const mag = R.abs(t.c);
  const body = t.v == null ? R.canon(mag) : `${R.canon(mag)}*${t.v}`;
  if (first) return t.c.n < 0 ? `-${body}` : body;
  return t.c.n < 0 ? `- ${body}` : `+ ${body}`;
}

function loadSurface(load) {
  if (!load.length) return "0";
  return load.map((t, i) => termSurface(t, i === 0)).join(" ");
}

/** One term as it stands in the world. Same object, typeset rather than typed. */
function termTexOf(t, first) {
  if (isBundle(t)) {
    const mag = R.abs(t.k);
    const head = R.eq(mag, R.one) ? "" : R.tex(mag);
    const piece = `${head}\\left(${loadTexOf(t.inner)}\\right)`;
    if (first) return t.k.n < 0 ? `-${piece}` : piece;
    return t.k.n < 0 ? `- ${piece}` : `+ ${piece}`;
  }
  const mag = R.abs(t.c);
  const body = t.v == null ? R.tex(mag) : R.eq(mag, R.one) ? t.v : `${R.tex(mag)}${t.v}`;
  if (first) return t.c.n < 0 ? `-${body}` : body;
  return t.c.n < 0 ? `- ${body}` : `+ ${body}`;
}

function loadTexOf(load) {
  if (!load.length) return "\\rule{1.4em}{0.06em}";
  return load.map((t, i) => termTexOf(t, i === 0)).join(" ");
}

class ForgeAct {
  constructor(ctx, kinds, opts = {}) {
    this.id = "forge";
    this.ctx = ctx;
    /** The kinds a blank may be cut in: a fixed weight first, then every name standing in the claim. */
    this.kinds = kinds;
    this.scaffoldLevel = 0;
    this.pans = [[], []];
    this.rel = opts.rel ?? null;
    /** 0 near pan · 1 the Sill · 2 far pan. */
    this.station = 0;
    this.blank = { n: 1, d: 1, kind: 0 };
    /** The lock standing open on a pan, waiting to be strapped shut. */
    this.openLock = null;
    this.push = 0;
    this.carry = 0;
    this.led = false;
    this.fine = false;
    this.acts = 0;
    this.placed = 0;
    this.straps = 0;
    this.shear = false;
    this.history = [];
  }

  get kind() {
    return this.kinds[this.blank.kind % this.kinds.length] ?? null;
  }
  get value() {
    return rat(this.blank.n, this.blank.d);
  }
  get pan() {
    return this.station === 2 ? this.pans[1] : this.pans[0];
  }
  /** Where a term you set down actually lands: inside the open lock, or on the pan itself. */
  get site() {
    return this.openLock ? this.openLock.inner : this.pan;
  }

  _remember() {
    this.history.push({
      pans: this.pans.map((p) => JSON.parse(JSON.stringify(p))),
      rel: this.rel,
      lock: this.openLock ? { at: this.pans.indexOf(this.pan), i: this.pan.indexOf(this.openLock) } : null,
    });
    if (this.history.length > 24) this.history.shift();
  }

  /**
   * The count is walked with the body, exactly as SPAN walks a deck: the edge of the push lays one,
   * then it holds for `LEAD`, then it ramps. The second grip shares the blank into parts instead.
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
      this.led = true;
      this.push = 0;
      this._notch(dir);
      return;
    }
    this.push += step;
    if (this.push < LEAD) return;
    const t = Math.min(1, (this.push - LEAD) / RAMP);
    this.carry += (2 + t * 6) * step * dir * Math.min(1, Math.abs(y));
    while (this.carry >= 1) {
      this.carry -= 1;
      this._notch(1);
    }
    while (this.carry <= -1) {
      this.carry += 1;
      this._notch(-1);
    }
  }

  _notch(dir) {
    if (this.fine) {
      // Share the blank into parts. A count over a denominator is a share of one thing, never a
      // second thing: §2.1 rule 9 again, from the other side.
      this.blank.d = Math.max(1, Math.min(12, this.blank.d + dir));
    } else {
      this.blank.n = Math.max(-99, Math.min(99, this.blank.n + dir));
    }
    this.acts += 1;
  }

  /** Set the blank down where you are standing, and take a fresh one. */
  _set() {
    if (this.station === 1) return false;
    const v = this.value;
    if (!v) return false;
    // A term of no count is nothing, and nothing does not stand in a load beside something. On an
    // EMPTY site it is the whole load, and `-2x + 2 = 0` is a claim the bank commits: a far pan that
    // holds nothing at all is a pan you cannot build, so zero is allowed to be the first thing down.
    if (R.isZero(v) && this.site.length) return false;
    this._remember();
    this.site.push({ c: v, v: this.kind });
    this.placed += 1;
    this.acts += 1;
    this.blank = { n: 1, d: 1, kind: this.blank.kind };
    return true;
  }

  /** Open a lock with the blank's count outside it, or strap the open one shut. */
  _strap() {
    if (this.station === 1) return false;
    if (this.openLock) {
      // A lock with nothing in it is not a lock; it comes back off rather than standing empty.
      if (!this.openLock.inner.length) {
        const at = this.pan.indexOf(this.openLock);
        if (at >= 0) this.pan.splice(at, 1);
      }
      this.openLock = null;
      this.straps += 1;
      this.acts += 1;
      return true;
    }
    const v = this.value;
    if (!v || R.isZero(v)) return false;
    this._remember();
    const lock = { bundle: true, k: v, inner: [], reached: 0 };
    this.pan.push(lock);
    this.openLock = lock;
    this.blank = { n: 1, d: 1, kind: this.blank.kind };
    this.straps += 1;
    this.acts += 1;
    return true;
  }

  /** Take the last thing back off the site you are standing at, into your hands. */
  _lift() {
    const site = this.site;
    if (!site.length) {
      if (this.openLock) return this._strap();
      return false;
    }
    this._remember();
    const t = site.pop();
    if (t === this.openLock) this.openLock = null;
    if (!isBundle(t)) {
      this.blank.n = t.c.n;
      this.blank.d = t.c.d;
      const k = this.kinds.indexOf(t.v ?? null);
      if (k >= 0) this.blank.kind = k;
    }
    this.acts += 1;
    return true;
  }

  act(name, hand) {
    const fine = hand?.held?.has?.("crouch") === true;
    switch (name) {
      case "hold":
        this.fine = true;
        return true;
      case "release":
        this.fine = false;
        return true;
      case "stepNext":
      case "stepPrev": {
        const dir = name === "stepNext" ? 1 : -1;
        if (fine) {
          // The second grip turns the bumpers into the KIND axis: a fixed weight, or a name.
          this.blank.kind = (this.blank.kind + dir + this.kinds.length) % this.kinds.length;
          this.acts += 1;
          return true;
        }
        // Walking the site: near pan, the Sill, far pan. There is no far pan until a mark hangs on
        // the Sill, because a claim with one pan is not a claim.
        const stops = this.rel ? 3 : 2;
        this.station = (this.station + dir + stops) % stops;
        return true;
      }
      case "take":
        if (this.station === 1) {
          this._remember();
          this.rel = RELS[(RELS.indexOf(this.rel) + 1) % RELS.length];
          if (!this.rel && this.station === 2) this.station = 0;
          this.acts += 1;
          return true;
        }
        return fine || this.fine ? this._strap() : this._set();
      case "back":
        if (this.station === 1) {
          this._remember();
          this.rel = RELS[(RELS.indexOf(this.rel) + RELS.length - 1) % RELS.length];
          this.acts += 1;
          return true;
        }
        return this._lift();
      default:
        return false;
    }
  }

  ready() {
    return this.response() != null;
  }

  /**
   * What stands on the site, spelled as a learner could have typed it.
   *
   * A claim needs both pans carrying something; a load is whatever is on the near pan. An empty site
   * is not a response and there is nothing to hand over.
   */
  response() {
    if (!this.pans[0].length) return null;
    const near = loadSurface(this.pans[0]);
    if (!this.rel) return near;
    if (!this.pans[1].length) return null;
    return `${near} ${this.rel} ${loadSurface(this.pans[1])}`;
  }

  /**
   * The site, and the blank in your hands.
   *
   * The pans stand apart the way BALANCE's do so that a claim under construction reads as a claim.
   * The grip plate marks the site your hand is on — a pan, or the Sill — and the blank hangs below,
   * with its count and its kind and the bar that says how long it is.
   */
  rows() {
    const out = [];
    const plate = "\\rule{0.3em}{0.3em}\\,";
    if (this.rel) {
      const rel = REL_TEX[this.rel] ?? "=";
      out.push({ key: "near", tex: `${this.station === 0 ? plate : ""}${loadTexOf(this.pans[0])}`, up: 0, right: -2.9 });
      out.push({ key: "sill", tex: this.station === 1 ? `${plate}${rel}` : rel, up: 0, right: 0 });
      out.push({ key: "far", tex: `${this.station === 2 ? plate : ""}${loadTexOf(this.pans[1])}`, up: 0, right: 2.9 });
    } else {
      out.push({ key: "near", tex: `${this.station === 0 ? plate : ""}${loadTexOf(this.pans[0])}`, up: 0, right: 0 });
      out.push({ key: "sill", tex: this.station === 1 ? `${plate}\\rule{1.4em}{0.06em}` : "\\rule{1.4em}{0.06em}", up: -0.78, right: 0 });
    }
    const v = this.value;
    const kind = this.kind;
    const blank = kind == null ? R.tex(v) : R.eq(R.abs(v), R.one) ? `${v.n < 0 ? "-" : ""}${kind}` : `${R.tex(v)}${kind}`;
    out.push({
      key: "blank",
      up: this.rel ? -0.9 : -1.68,
      right: 0,
      // The blank, and its length. A count is a magnitude and a magnitude is a bar (§2.1 rule 4).
      tex: `${blank}\\;\\rule{${(0.3 + Math.min(9, Math.abs(R.num(v))) * 0.34).toFixed(2)}em}{0.14em}${this.openLock ? "\\;\\rule{0.34em}{0.34em}" : ""}`,
    });
    return out;
  }

  /**
   * The read. This verb knows almost nothing about the property it was built against — the property
   * is deliberately not on the wire — so the bank's tagged distractor is the whole of what it can
   * honestly say, and when the bank has no name for it, nothing is written and the object standing
   * in the world is the sentence.
   */
  read(marked) {
    if (marked?.misconception && marked?.failKey) return { key: marked.failKey, params: {} };
    if (this.rel && !this.pans[1].length) return { key: "fail.sill.missing", params: {} };
    if (marked?.failKey) return { key: marked.failKey, params: {} };
    return null;
  }

  state() {
    return {
      near: loadSurface(this.pans[0]),
      far: this.rel ? loadSurface(this.pans[1]) : null,
      rel: this.rel,
      station: ["near", "sill", "far"][this.station],
      blank: `${R.canon(this.value)}${this.kind ?? ""}`,
      kinds: this.kinds.map((k) => k ?? "1"),
      lockOpen: !!this.openLock,
      placed: this.placed,
      straps: this.straps,
      fine: !!this.fine,
      acts: this.acts,
    };
  }
}

export default {
  id: "forge",

  /**
   * Pose anything that is ASKED FOR rather than closed.
   *
   * `generate` is the form this verb was built for and it takes every one of them. The three open
   * answer types come with it because they are the same act — a load, a claim or a threshold that
   * the learner produces — and because every one of them that reaches here is an item no other verb
   * in `VERBS` could read, which on a gamepad is the difference between an answerable item and a
   * dead one. `closure` (a word, not an object) and `partition` (a sorting, not a build) are
   * deliberately left; they are counted in `probe("verbs").stats.unposedByType`.
   */
  pose(ctx) {
    const t = ctx.answerType;
    const generative = ctx.form === "generate" || t === "construction";
    if (!generative && t !== "expression" && t !== "equation" && t !== "inequality") return null;

    // Every kind the claim already speaks of, so a blank can be cut in it. A fixed weight first:
    // it is the commonest term in the bank and the one a player reaches for without thinking.
    const names = new Set(namesIn(ctx.stem));
    for (const g of ctx.given ?? []) for (const n of namesIn(g)) names.add(n);
    const claim = parseClaim(ctx.stem);
    if (claim) for (const n of namesOf(claim)) names.add(n);
    const system = parseSystem(ctx.stem);
    if (system) for (const c of system) for (const n of namesOf(c)) names.add(n);
    if (ctx.unknown) names.add(ctx.unknown);
    const kinds = [null, ...[...names].filter((n) => /^[a-z]$/.test(n))];
    if (kinds.length < 2) return null;

    // A threshold is asked for with a mark already on it, so the Sill starts hung rather than bare;
    // everything else starts as a bare load and the player hangs the Sill if the ask wants one.
    return new ForgeAct(ctx, kinds, { rel: t === "inequality" ? ">=" : t === "equation" ? "=" : null });
  },
};
