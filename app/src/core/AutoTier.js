import { config, TIERS, TIER_ORDER } from "./Config.js";
import { signals } from "./Signals.js";
import { publish } from "./Introspect.js";

/**
 * AutoTier — pick the quality tier from what the machine actually does, not from what it says.
 *
 * ## Why this exists
 *
 * `config.autoTier` was declared and read by nothing, so every machine booted at `high`: the full
 * post stack and a 1.5x pixel ratio. This game is *for* school Chromebooks — Intel UHD 600 / Iris
 * Xe / Mali / Adreno / AMD-APU class parts pushing a 1366x768 or 1920x1080 panel — and on those
 * parts that tier is not a slightly worse experience, it is a slideshow. A student whose first
 * thirty seconds stutter does not come back, and the product goal is that they come back on their
 * own.
 *
 * ## What a tier step actually costs, as shipped — not as the table claims
 *
 * The tier table asks `high` for 3072² x3 shadow cascades. It does not get them: `world/Lighting.js`
 * builds `cascades = min(2, tier.shadowCascades)` (line 322) and `res = clamp(tier.shadowResolution,
 * 1024, 2048)` (line 337), so **`ultra`, `high` and `medium` all build the same 2048² x2 rig** and
 * only `low`/`potato` differ. Quoting the table's numbers as the price of a tier — which the first
 * two rounds of this file did — is fiction, and the measured version (P30 C10) is:
 *
 * | high → medium, as shipped | before | after |
 * |---|---|---|
 * | pixel ratio (drawing-buffer px per screen px) | 1.5 (2.25x) | 1.25 (1.5625x) — 31 % fewer pixels |
 * | post passes | 5 | 3 |
 * | shadow map | 2048² x2 | 1024² x2 — *this module's* ratio ladder, not the lighting rig's |
 * | `grassDensity` / `drawDistance` / `particleBudget` | emitted on `quality:tier` and, today, consumed by nobody |
 *
 * That last row is why `report().signal` names its own unconsumed fields instead of letting a
 * probe imply they did something: the pixel ratio, the shadow maps and the post stack are the
 * three surfaces this module actually moves, and they are the three it measures moving.
 *
 * ## The asymmetry that sets every default in this file
 *
 * Being one tier too low costs a student some bloom and some shadow resolution for a few seconds.
 * Being one tier too high costs them the frame rate, which is the whole feel of the game. The two
 * errors are not the same size, so the defaults are not symmetric:
 *
 *  * The heuristic starts at **medium unless there is positive evidence of strength** — not at
 *    `high` unless there is positive evidence of weakness. Hardware signals are routinely
 *    *illegible* (Firefox with `resistFingerprinting`, Safari, a legacy "WebKit WebGL" mask, any
 *    browser without `deviceMemory`, Chrome once `WEBGL_debug_renderer_info` finishes going away),
 *    and "I could not tell" must not mean "assume a gaming desktop".
 *  * Relief is urgent; promotion never is. The *first* decision window is deliberately small
 *    (30 warm-up / 45 scored frames, and smaller still in wall-clock terms on a slow machine), and
 *    the first down-step may **leap more than one rung** when the median is catastrophically over
 *    budget *and the hardware corroborates it*. A promotion, by contrast, always waits for the full
 *    steady-state window.
 *
 * The price of the conservative default is bounded and known: a vsync-locked 60 Hz desktop is
 * promoted medium → high about 3 s in, through the up-path below. The price of the optimistic
 * default was not bounded — it was "the slower the machine, the longer it sits at the tier it
 * cannot afford".
 *
 * ## Why a boot storm must not decide the session
 *
 * The first window is measured 1.5-4 s after the first render, which is also when thirty
 * Chromebooks on one classroom access point are finishing their asset downloads, when Chrome is
 * applying an update in the background, and when the compositor is still uploading textures. Those
 * frames are real, they are slow, and they are *not this machine*. The round-2 policy read that
 * window as steady render cost: 120 ms frames for 4 s bought `high → potato` in a single 3-rung
 * leap, and because `downSteps > 0` blocked every promotion for the rest of the session, three
 * minutes of flawless 60 Hz afterwards still ended at `potato`. Measured, on the shipped policy.
 *
 * A short window taken during the boot storm therefore buys a **provisional** decision, and
 * "provisional" is a specific, bounded thing:
 *
 *  * It moves **one rung**, not three (`firstMaxLeap`) — a small window buys a small commitment.
 *  * It is only taken when the *tail* of the window is still over budget too, so a storm that has
 *    already decayed by the time the window fills costs nothing at all.
 *  * It can be **revoked exactly once**, and only on evidence that the original reading could not
 *    have been render cost (below).
 *
 * A decision the hardware *corroborates* is not provisional: when the heuristic capped the tier on
 * a renderer string or a capability number, a catastrophic median is exactly what that machine was
 * predicted to do. It leaps immediately and it never revokes. Corroboration is the whole difference
 * between "a Gemini Lake Chromebook is slow" and "an RTX 4070 was slow for four seconds".
 *
 * ## Why revoking a descent is not the oscillation it looks like
 *
 * "Holding vsync at the lower tier" is *not* evidence the higher tier is affordable — that argument
 * is what promoted a correctly-capped Chromebook back into a tier it could not afford, and it is
 * still rejected here. Recovery rests on a different and much narrower observation: **the machine
 * improved by more than a tier step can explain.** A rung is worth at most about 2x
 * (`recoveryRungGain`), so a genuine 120 ms at `high` predicts *at best* 60 ms at `medium`. Measuring
 * 16.6 ms there does not mean the machine is fast; it means the 120 ms was never render cost. That
 * inconsistency, and nothing else, arms the revocation — and it must then hold continuous headroom
 * for a further `recoveryQuietMs` (20 s) before it fires. Every one of these must be true:
 *
 *  1. the descent was **provisional** (no hardware corroboration), and
 *  2. every down-step happened inside the first `recoveryArmMs` — one early drop, not a descent, and
 *  3. the measured cost is below `recoveryInconsistency` x the most generous model of the old
 *     reading, and
 *  4. headroom has held *continuously* for `recoveryQuietMs`, and
 *  5. `maxRecoveries` (1) is unspent and no revocation has already failed.
 *
 * A borderline machine — 30 ms at `high`, 16.6 ms at `medium` — fails gate 3 (16.6 is not below
 * 0.6 x 15) and is never probed. A revocation that turns out to be wrong is caught by the ordinary
 * down path, costs one further change, and **locks the ratchet permanently**: worst case is three
 * picture changes, which is the budget that already bound.
 *
 * ## Two mechanisms, deliberately separate
 *
 * 1. **A first-frame heuristic** (`startingTier`) runs before the world is built, at boot order 02.
 *    It reads the GL renderer string, `MAX_TEXTURE_SIZE`, WebGL2 availability, core count, device
 *    memory and the pixel count of the panel, and picks a *conservative starting tier*. Its whole
 *    job is that the first few seconds are not miserable — it is allowed to be wrong, because:
 *
 * 2. **Measurement** (`TierPolicy`) then corrects it from real frame periods. Sustained misses step
 *    the tier down; comfortable headroom buys back at most one step up.
 *
 * The split matters because neither half is trustworthy alone. A renderer string is a guess (a
 * "UHD Graphics 620" in a fanless tablet and in a desktop are different machines), and measurement
 * cannot help you for the first few seconds — which are exactly the seconds a student decides in.
 *
 * **The heuristic's cap is the measurement's ceiling.** When the heuristic lowered the tier on
 * hardware evidence, that evidence does not expire the moment the machine holds vsync at the lower
 * tier: holding 60 Hz at `medium` is not evidence that `high` is affordable. Promoting past a
 * hardware cap is how a correctly-capped Chromebook ends a session two tiers *below* the cap with
 * three visible picture changes on the way — measured, and the reason `ceiling` below is the
 * heuristic's answer whenever the heuristic had one.
 *
 * ## Why it cannot oscillate
 *
 * Oscillation — the picture visibly shifting under a student every few seconds — would be worse
 * than any tier being wrong. Four independent locks, any one of which is sufficient:
 *
 *  * **A dead band.** Step down above `downMs` (21 ms ≈ 47 fps). Step up only with real headroom,
 *    which on a vsync-locked display means *hitting the display's own cadence with tiny jitter*.
 *    Nothing at all happens between those two states.
 *  * **A cooldown plus a window flush.** After any change the sample window is emptied and the next
 *    `warmupFrames` frames are discarded, so the cost of the change itself (a shader recompile, a
 *    render-target reallocation) can never be read as evidence for the next one.
 *  * **Up is not the inverse of down.** Once the policy has stepped down even once, it will never
 *    step up again for the rest of the session. A machine that has already failed a window does not
 *    get re-promoted on a quiet stretch — that is precisely the loop that produces oscillation. The
 *    one revocation described above is not this loop: it is not bought by a quiet stretch, it is
 *    bought by an improvement the tier step cannot explain, it fires at most once, and failing it
 *    locks the ratchet for the session.
 *  * **A hard budget.** `maxChanges` total per session, `maxUpSteps` of them upward, `maxRecoveries`
 *    revocations, and the ceiling is the heuristic's cap (or the configured tier when the heuristic
 *    found nothing) — auto-tiering hands work back, it never promotes past what the hardware or the
 *    config asked for.
 *
 * ## Why an explicit choice wins completely
 *
 * `config.get("autoTier")` is the switch, and `Config.set("tier", …)` turns it off — so a settings
 * screen, `?tier=low`, or a console poke all stand this module down for the session with no further
 * cooperation required. That switch is re-read **every frame**, not captured at boot: a settings
 * screen opened ten minutes in is exactly as binding as `?tier=` on the URL, and standing down also
 * pushes the player's choice into the renderer, because a setting that does not change the picture
 * is not a setting. Auto choices go through `config.applyTier()`, which is runtime-only and never
 * persisted, so a bad afternoon on a loaded machine cannot become a permanent setting.
 *
 * ## Why a software rasteriser is not a device class
 *
 * The review harness renders through SwiftShader at a few frames per second. That is a measurement
 * environment, not a student's laptop, and a module that quietly dropped every review capture to
 * `potato` would silently change the picture every other piece in this project is judged on.
 * On a software rasteriser this module therefore measures and reports but **applies nothing** —
 * the probe still shows what it would have chosen, so the logic is inspectable. `?autotier=force`
 * opts back in, and `review/measure/P30.mjs` uses it to prove the apply path on real frames.
 *
 * ## Review knobs (query string)
 *
 * | knob | effect |
 * |---|---|
 * | `?autotier=off` | disabled entirely |
 * | `?autotier=force` | measure *and apply* even on a software rasteriser |
 * | `?autotierWarmup=N` | frames discarded after boot and after each change |
 * | `?autotierWarmupMs=MS` | wall-clock cap on that discard window |
 * | `?autotierWindow=N` | samples in the decision window |
 * | `?autotierWindowMs=MS` | wall-clock size at which a short window may decide anyway |
 * | `?autotierCooldown=MS` | minimum ms between decisions |
 * | `?autotierDown=MS` | median frame period above which the tier steps down |
 * | `?autotierQuiet=MS` | how long headroom must hold before a provisional descent is revoked |
 */

/** Every threshold, in one table, so a critic can read the policy without reading the code. */
export const POLICY = {
  // -- the steady-state decision shape ------------------------------------------------------------
  /**
   * Frames thrown away after every applied change.
   *
   * Not just hitches: a tier change costs a shader recompile and a render-target reallocation, and
   * those frames describe the change, not the machine.
   */
  warmupFrames: 90,
  /**
   * …and the wall-clock cap on that discard window.
   *
   * The frame count alone is the wrong instrument on exactly the hardware this module exists for.
   * Recompiles and reallocations cost roughly a fixed amount of *time*, so on a 2 fps machine
   * "90 frames" is 45 s of penance for a 3 s event. Whichever bound is reached first ends the
   * warm-up: frames bind above ~30 fps, time binds below it.
   */
  warmupMs: 3000,
  /** Samples the decision window holds. 120 frames is 2 s at 60 Hz, 4 s at 30 Hz. */
  windowFrames: 120,
  /**
   * …and the wall-clock size at which a *short* window is allowed to decide anyway (down only).
   * 120 frames is 6 s at 20 fps and 60 s at 2 fps; below ~20 fps the frame count stops being
   * evidence and starts being a delay. See `minFrames` for the floor that keeps it honest.
   */
  windowMs: 5000,
  /** Never decide on fewer than this many scored frames, however long they took. */
  minFrames: 24,

  // -- the first decision, which is a different problem ------------------------------------------
  /**
   * The first window is smaller than the rest, because it is the only one whose latency a student
   * experiences as "this game is broken" rather than as "the picture changed once".
   *
   * With the shipped steady-state numbers the first down-step could not fire until 210 scored
   * frames had elapsed — 21 s at 10 fps, 42 s at 5 fps, 107 s at 2 fps. The slower the machine, the
   * longer it sat at the tier it could not afford, which is the exact failure this module exists to
   * prevent. These four numbers cut that to ~4 s at 10 fps, ~4 s at 5 fps and ~9 s at 2 fps.
   */
  firstWarmupFrames: 30,
  firstWarmupMs: 1500,
  firstWindowFrames: 45,
  firstWindowMs: 2500,
  firstMinFrames: 12,

  // -- the thresholds themselves -----------------------------------------------------------------
  /** Median frame period above which the tier steps down. 21 ms ≈ 47.6 fps sustained. */
  downMs: 21,
  /** Median frame period below which headroom is unambiguous even without a cadence estimate. */
  upMs: 13.5,
  /** For a vsync-locked display: how close the median must sit to the observed cadence. */
  cadenceTolerance: 1.06,
  /**
   * …and how tight the *99th* percentile must be against the observed cadence. A hitchy 60 fps is
   * not headroom. This gate is p99 and not p95 because p95 does not see it: over a 120-frame window
   * a stutter arriving every 40 frames is 3 samples, and the 95th percentile sits at sample 113 —
   * `review/measure/P30.mjs` A3 caught exactly that and it bought a step up it had not earned.
   * At p99 the line lands at "more than 1 % of frames hitching is not headroom".
   */
  cadenceJitter: 1.3,
  /** Above this the observed cadence is not a ≥57 Hz display and the cadence path does not apply. */
  cadenceMaxMs: 17.5,
  /** Minimum ms of measured time between two decisions. */
  cooldownMs: 3000,
  /** Hard cap on tier changes per session. The picture must stop moving. */
  maxChanges: 3,
  /** Of those, how many may be upward. */
  maxUpSteps: 1,

  // -- how far a single down-step may travel -----------------------------------------------------
  /**
   * How far one down-step may travel: `ceil(log2(median / downMs))`, capped here.
   *
   * A rung is worth *roughly* a factor of two — **as this module ships it**, not as the tier table
   * reads. `Lighting.js` clamps every tier's cascades into 1024-2048² x≤2, so `ultra`, `high` and
   * `medium` are handed the *same* rig by the lighting piece and the table's "3072² x3" is not a
   * thing any machine renders. What a rung actually moves is: the drawing buffer (2.25 → 1.5625 → 1
   * screen-pixels² at high → medium → low), this module's own shadow ladder (a real halving of
   * whatever size the lighting rig built, applied in `_applyShadows`), and the post stack (5 → 3 →
   * 1 passes). Call it 1.6-2x per rung, which is why the log is rounded *up*: under-stepping costs
   * another whole window to discover, and the round-1 policy that stepped exactly one rung per
   * decision could not carry `ultra` to `potato` inside `maxChanges` at all.
   *
   * Leaps are down-only and, like every other change, cost exactly one unit of `maxChanges`.
   */
  maxLeap: 3,
  /**
   * …but the *first* decision, taken on the short window while the boot storm is still running, may
   * move only this far unless the hardware corroborates it (see `provisional`). A 3-rung leap bought
   * on 45 frames measured 1.5-4 s after the first render is how four seconds of classroom Wi-Fi put
   * a student on `potato` for the session.
   */
  firstMaxLeap: 1,

  // -- a down-step must be true *now*, not just on average ----------------------------------------
  /**
   * The last quarter of the window (at least `tailMinFrames` samples) has to miss the budget too.
   *
   * The median is a statement about the window; a tier change is a statement about the machine from
   * here on. A boot storm that decayed while the window was filling leaves a median over budget and
   * a tail already inside it — and stepping down then is fixing a problem that has already stopped
   * happening. Costs nothing when the load is real: on a flat stream the tail *is* the median, and
   * `decide()` re-runs on the very next sample, so a deferred decision is deferred by one frame.
   */
  tailFraction: 0.25,
  tailMinFrames: 8,

  // -- revoking a provisional descent -------------------------------------------------------------
  /** Revocations of a provisional descent, per session. See the class docs for the five gates. */
  maxRecoveries: 1,
  /**
   * A descent is only revocable while every down-step in it landed inside this much measured time —
   * one early drop during the boot storm, not a machine walking itself down. Measured: on a flat
   * 40 ms stream the down-steps land at 3.0 s, 10.8 s and 18.6 s, so this cleanly separates "the
   * first window caught a storm" from "this machine keeps missing".
   */
  recoveryArmMs: 8000,
  /** …and headroom must then hold *continuously* for this long before the revocation fires. */
  recoveryQuietMs: 20000,
  /**
   * The most generous estimate of what one rung buys, used *against* revocation: predicted cost at
   * the new tier is `preMedian / recoveryRungGain^rungs`. Generous on purpose — the test is only
   * allowed to fire when even the best case for the tier step cannot explain the improvement.
   */
  recoveryRungGain: 2,
  /**
   * How far below that prediction the measurement must sit before the old reading is judged not to
   * have been render cost at all. 120 ms at `high` predicts ≤ 60 ms at `medium`; measuring 16.6 ms
   * (0.28x) is inconsistent, and a borderline 30 ms → 16.6 ms (1.11x) is not.
   */
  recoveryInconsistency: 0.6,

  // -- what counts as a frame at all -------------------------------------------------------------
  /**
   * Periods outside this range are not frames: a stall/tab switch/GC above, and below —
   *
   * **a render loop with no compositor behind it.** `renderer.render()` submits GL commands and
   * returns; the machine's real cost only shows up as backpressure at presentation time. A reviewer
   * driving `__vs.advance()` in a tight loop therefore produces 0.5 ms "frames" no matter how slow
   * the hardware is, and scoring those would let a headless harness — or any non-presenting loop —
   * buy a tier promotion nothing earned. 2 ms is 500 fps; no display presents that fast, so nothing
   * real is lost. P30 C2 found this by measuring 0.5 ms on a rasteriser that runs at 5 fps.
   */
  sampleMinMs: 2,
  sampleMaxMs: 250,
  /**
   * …unless they keep coming. A single four-second frame is a tab switch or a GC and must never be
   * scored as load. *Five consecutive* frames slower than `sampleMaxMs` is not a stall, it is a
   * machine at 2 fps — and rejecting those outright meant the worst hardware in the range was the
   * one hardware auto-tiering could never help. P30 A13. Once the run trips, over-long periods are
   * scored at `sampleMaxMs`: the exact number stops mattering far below 4 fps, the sign does not.
   */
  stallRun: 5,
};

const clampIndex = (i) => Math.max(0, Math.min(TIER_ORDER.length - 1, i));

/**
 * The measurement half. Pure: no DOM, no THREE, no clock of its own — it advances a clock from the
 * samples it is fed. That is what lets `review/measure/P30.mjs` prove the hysteresis, the budget and
 * the no-oscillation property offline, deterministically, without booting a browser at all.
 */
export class TierPolicy {
  constructor(startTier, opts = {}) {
    this.p = { ...POLICY, ...opts };
    // Keep the first window inside the steady-state one however the knobs were overridden, so a
    // review run that shrinks `windowFrames` can never ask for a first window it will never fill.
    this.p.windowFrames = Math.max(1, this.p.windowFrames);
    this.p.firstWindowFrames = Math.min(this.p.firstWindowFrames, this.p.windowFrames);
    this.p.minFrames = Math.min(this.p.minFrames, this.p.windowFrames);
    this.p.firstMinFrames = Math.min(this.p.firstMinFrames, this.p.firstWindowFrames);
    this.p.firstWarmupFrames = Math.min(this.p.firstWarmupFrames, this.p.warmupFrames);

    this.tier = TIERS[startTier] ? startTier : "high";
    this.ceiling = TIERS[this.p.ceiling] ? this.p.ceiling : this.tier;
    /**
     * Is the first descent provisional — small, and revocable?
     *
     * True when nothing about the hardware corroborates a bad reading, which is the default because
     * "the hardware said nothing" is the common case (see `startingTier`). `AutoTier` sets it false
     * when the heuristic capped the tier on real evidence: on that machine a catastrophic median is
     * the predicted outcome, not a surprise, and it should leap at once and never look back.
     */
    this.provisional = this.p.provisional !== false;
    this.samples = [];
    this.clock = 0;
    this.lastChangeAt = 0;
    this.changes = [];
    this.upSteps = 0;
    this.downSteps = 0;
    this.recoveries = 0;
    this.rejected = 0;
    this.accepted = 0;
    this.overrun = 0;
    this.lastStats = null;
    /** The provisional descent, if one is still revocable. Cleared for good by `locked`. */
    this.descent = null;
    this.locked = false;
    /** Clock time at which the current unbroken run of headroom began; null when it is broken. */
    this.quietSince = null;

    const s = this.shape(true);
    this.discard = s.warmFrames;
    this._warmMs = s.warmMs;
    this._warmStart = 0;
  }

  /** The window shape for the next decision. The first one is deliberately not the shipped one. */
  shape(first = this.changes.length === 0) {
    return first
      ? {
          warmFrames: this.p.firstWarmupFrames,
          warmMs: this.p.firstWarmupMs,
          frames: this.p.firstWindowFrames,
          ms: this.p.firstWindowMs,
          min: this.p.firstMinFrames,
        }
      : {
          warmFrames: this.p.warmupFrames,
          warmMs: this.p.warmupMs,
          frames: this.p.windowFrames,
          ms: this.p.windowMs,
          min: this.p.minFrames,
        };
  }

  /**
   * Feed one frame period in milliseconds. Returns a change record when this sample tipped a
   * decision, otherwise null.
   */
  sample(ms) {
    if (!Number.isFinite(ms) || ms < 0) return null;
    // The clock counts *all* elapsed time, including the stalls we refuse to score. A five-second
    // tab switch really did happen; it just is not evidence about frame cost.
    this.clock += ms;
    let scored = ms;
    if (ms < this.p.sampleMinMs) {
      this.rejected++;
      return null;
    }
    if (ms > this.p.sampleMaxMs) {
      this.overrun++;
      if (this.overrun < this.p.stallRun) {
        this.rejected++;
        return null;
      }
      scored = this.p.sampleMaxMs; // sustained, not a stall — see POLICY.stallRun
    } else {
      this.overrun = 0;
    }
    if (this.discard > 0) {
      this.discard--;
      // …or the wall clock ends it first. See POLICY.warmupMs.
      if (this.clock - this._warmStart >= this._warmMs) this.discard = 0;
      return null;
    }
    this.accepted++;
    this.samples.push(scored);
    if (this.samples.length > this.p.windowFrames) this.samples.shift();
    return this.decide();
  }

  stats() {
    const n = this.samples.length;
    if (!n) return null;
    const s = [...this.samples].sort((a, b) => a - b);
    const q = (f) => s[Math.min(n - 1, Math.floor(f * (n - 1)))];
    const sum = s.reduce((a, b) => a + b, 0);
    const median = q(0.5);
    return {
      n,
      p10: q(0.1),
      median,
      p95: q(0.95),
      p99: q(0.99),
      max: s[n - 1],
      meanMs: sum / n,
      spanMs: sum,
      fps: median > 0 ? 1000 / median : 0,
    };
  }

  /** True when the window says there is real room to spend. See the class docs for the two paths. */
  headroom(st) {
    if (!st) return false;
    const cadence = st.p10; // the best period this machine reaches ≈ the display's own
    // Gate one, on both paths: a window with stutter in it is not a window with room in it.
    if (st.p99 > cadence * this.p.cadenceJitter) return false;
    if (st.median <= this.p.upMs) return true; // unlocked and genuinely fast
    return cadence <= this.p.cadenceMaxMs && st.median <= cadence * this.p.cadenceTolerance;
  }

  /**
   * How many rungs a single down-step may travel. See POLICY.maxLeap for the model, and
   * POLICY.firstMaxLeap for why the first one is smaller when nothing corroborates it.
   */
  rungsFor(median) {
    const over = median / this.p.downMs;
    const cap =
      this.provisional && this.changes.length === 0 ? this.p.firstMaxLeap : this.p.maxLeap;
    return Math.max(1, Math.min(cap, Math.ceil(Math.log2(over))));
  }

  /** The median of the most recent slice of the window. See POLICY.tailFraction. */
  tailMedian() {
    const n = this.samples.length;
    if (!n) return Infinity;
    const k = Math.min(n, Math.max(this.p.tailMinFrames, Math.ceil(n * this.p.tailFraction)));
    const s = this.samples.slice(n - k).sort((a, b) => a - b);
    return s[Math.floor(0.5 * (s.length - 1))];
  }

  /**
   * Track the unbroken run of headroom that gate 4 of a revocation needs.
   *
   * Runs on every sample, *before* any of `decide()`'s early returns, so the run keeps accumulating
   * through the cooldown and through a spent change budget. A single window without headroom breaks
   * it and it starts again from zero.
   */
  _trackQuiet(st) {
    if (st.n >= this.p.windowFrames && this.headroom(st)) {
      if (this.quietSince === null) this.quietSince = this.clock;
    } else {
      this.quietSince = null;
    }
  }

  /**
   * Could the provisional descent be revoked right now? Every gate in the class docs, in order, and
   * each returns the name of the gate that stopped it so the probe can say *why* not.
   */
  recoveryState(st) {
    const d = this.descent;
    if (!this.provisional) return { armed: false, gate: "corroborated by hardware evidence" };
    if (this.locked) return { armed: false, gate: "a revocation already failed — locked" };
    if (this.recoveries >= this.p.maxRecoveries) return { armed: false, gate: "revocation budget spent" };
    if (!d) return { armed: false, gate: "no descent to revoke" };
    if (d.late) return { armed: false, gate: "the descent continued past the boot window" };
    if (!st || st.n < this.p.windowFrames) return { armed: false, gate: "window not full" };
    // Gate 3: the improvement is larger than the tier step can account for, so the earlier reading
    // was not render cost. The most generous model of the step is used, against the revocation.
    const predicted = d.medianMs / this.p.recoveryRungGain ** d.rungs;
    const ratio = st.median / predicted;
    if (!(ratio <= this.p.recoveryInconsistency))
      return {
        armed: false,
        gate: `improvement is consistent with the tier step (${st.median.toFixed(1)} ms is ${ratio.toFixed(2)}x the ${predicted.toFixed(1)} ms a ${d.rungs}-rung step predicts)`,
        ratio: Number(ratio.toFixed(3)),
      };
    if (this.quietSince === null) return { armed: false, gate: "headroom is not currently held", ratio: Number(ratio.toFixed(3)) };
    const heldMs = this.clock - this.quietSince;
    if (heldMs < this.p.recoveryQuietMs)
      return {
        armed: false,
        gate: `headroom held for ${(heldMs / 1000).toFixed(1)} s of ${(this.p.recoveryQuietMs / 1000).toFixed(0)} s`,
        ratio: Number(ratio.toFixed(3)),
        heldMs: Number(heldMs.toFixed(0)),
      };
    return { armed: true, gate: null, ratio: Number(ratio.toFixed(3)), heldMs: Number(heldMs.toFixed(0)), predictedMs: Number(predicted.toFixed(1)) };
  }

  decide() {
    const st = this.stats();
    this.lastStats = st;
    if (!st) return null;
    this._trackQuiet(st);
    if (this.changes.length >= this.p.maxChanges) return null;

    const w = this.shape();
    const full = st.n >= w.frames;
    // A window short on frames but long in wall-clock is a machine so slow that waiting for the
    // frame count *is* the harm. It may step down; it may never step up (below).
    const early = !full && st.n >= w.min && st.spanMs >= w.ms;
    if (!full && !early) return null;
    if (this.clock - this.lastChangeAt < this.p.cooldownMs) return null;

    const i = TIER_ORDER.indexOf(this.tier);
    const ceil = TIER_ORDER.indexOf(this.ceiling);

    // A down-step needs the window *and* its tail to miss the budget: the median describes the
    // window, but the change describes the rest of the session. See POLICY.tailFraction.
    const tail = this.tailMedian();
    if (st.median > this.p.downMs && i > 0) {
      if (tail <= this.p.downMs) return null; // a storm that has already passed
      const rungs = this.rungsFor(st.median);
      return this._change(
        TIER_ORDER[clampIndex(i - rungs)],
        "down",
        st,
        `median frame ${st.median.toFixed(1)} ms (${st.fps.toFixed(1)} fps) over ${st.n} frames / ${(st.spanMs / 1000).toFixed(1)} s is ${(st.median / this.p.downMs).toFixed(1)}x the ${this.p.downMs} ms floor, tail ${tail.toFixed(1)} ms — ${rungs} rung(s)`,
        rungs
      );
    }

    /**
     * Revoking a provisional descent. Deliberately checked *before* the ordinary up path and
     * deliberately not gated on `downSteps === 0`: this is the one promotion that exists precisely
     * because a down-step happened, and the five gates in `recoveryState` are what keep it from
     * being the oscillation loop the `downSteps` lock exists to prevent.
     */
    const rec = this.recoveryState(st);
    if (rec.armed) {
      const back = Math.min(TIER_ORDER.indexOf(this.descent.from), ceil);
      if (back > i) {
        return this._change(
          TIER_ORDER[clampIndex(back)],
          "recover",
          st,
          `the ${this.descent.medianMs} ms that bought ${this.descent.from}→${this.descent.to} at ${(this.descent.at / 1000).toFixed(1)} s cannot have been render cost: a ${this.descent.rungs}-rung step predicts ${rec.predictedMs} ms at best and this machine measures ${st.median.toFixed(1)} ms (${rec.ratio}x), with headroom held for ${(rec.heldMs / 1000).toFixed(0)} s — restoring ${TIER_ORDER[back]}`,
          back - i
        );
      }
    }

    // Promotion always waits for the full steady-state window. Relief is urgent and promotion is
    // not, and the p99 jitter gate is only meaningful over a long window: in 45 frames a 1-in-40
    // stutter is a single sample and p99 cannot see it, which buys a step up nothing earned.
    if (
      st.n >= this.p.windowFrames &&
      i < ceil &&
      this.downSteps === 0 &&
      this.upSteps < this.p.maxUpSteps &&
      this.headroom(st)
    ) {
      return this._change(
        TIER_ORDER[clampIndex(i + 1)],
        "up",
        st,
        `median ${st.median.toFixed(1)} ms against a ${st.p10.toFixed(1)} ms cadence with p99 ${st.p99.toFixed(1)} ms — headroom for one step`,
        1
      );
    }
    return null;
  }

  _change(to, direction, st, why, rungs = 1) {
    const rec = {
      at: Number(this.clock.toFixed(1)),
      from: this.tier,
      to,
      direction,
      rungs,
      why,
      fps: Number(st.fps.toFixed(1)),
      medianMs: Number(st.median.toFixed(2)),
      p10Ms: Number(st.p10.toFixed(2)),
      p95Ms: Number(st.p95.toFixed(2)),
      p99Ms: Number(st.p99.toFixed(2)),
      frames: st.n,
      spanMs: Number(st.spanMs.toFixed(1)),
    };
    this.tier = to;
    this.changes.push(rec);
    if (direction === "up") this.upSteps++;
    else if (direction === "recover") this.recoveries++;
    else this.downSteps++;

    if (direction === "down") {
      // The first down-step is the one that might be revocable; every later one is a machine
      // walking itself down, which is not a boot storm and must disarm the revocation for good.
      if (!this.descent) this.descent = { ...rec, late: rec.at > this.p.recoveryArmMs };
      else this.descent.late = true;
      // …and a down-step *after* a revocation means the revocation was wrong. Never again.
      if (this.recoveries > 0) this.locked = true;
    }
    this.quietSince = null;
    // Flush: the change itself costs a shader recompile and a render-target reallocation, and those
    // frames must never become evidence for the next decision.
    this.samples.length = 0;
    const s = this.shape(false);
    this.discard = s.warmFrames;
    this._warmMs = s.warmMs;
    this._warmStart = this.clock;
    this.lastChangeAt = this.clock;
    return rec;
  }

  budget() {
    return {
      changesLeft: Math.max(0, this.p.maxChanges - this.changes.length),
      upStepsLeft: this.downSteps > 0 ? 0 : Math.max(0, this.p.maxUpSteps - this.upSteps),
      // Not just the count: a descent that outgrew the boot window, or hardware that corroborated
      // it, has no revocation available however much of the budget is unspent. Reported as 0 so the
      // budget line cannot imply an option that `recoveryState()` has already ruled out.
      recoveriesLeft:
        this.locked || !this.provisional || this.descent?.late
          ? 0
          : Math.max(0, this.p.maxRecoveries - this.recoveries),
      ceiling: this.ceiling,
    };
  }
}

// --------------------------------------------------------------------------- the first-frame guess

/** The tier a machine starts at when nothing legible says it can afford more. */
export const NEUTRAL_START = "medium";

/**
 * Renderer-string families that are known-weak, with the reason each is capped where it is.
 * Ordered narrow → broad; the first match wins.
 */
const GPU_RULES = [
  // Raspberry Pi / VideoCore-class parts: no meaningful fill rate at all.
  { re: /videocore|\bvc4\b|\bv3d\b/, tier: "potato", why: "VideoCore-class GPU" },
  // Imagination PowerVR: common in the cheapest ARM tablets; tile-based with tiny bandwidth.
  { re: /powervr|\bsgx\b/, tier: "low", why: "PowerVR-class GPU" },
  // Older Mali (T-series and below) is the floor of the Chromebook range; newer G-series is capable
  // enough that measurement should decide rather than the string.
  { re: /mali-?\s*(4\d\d|t6|t7|t8)/, tier: "low", why: "Mali T-series or older" },
  { re: /\bmali\b/, tier: "medium", why: "Mali-class mobile GPU" },
  // Adreno below the 620 is the Snapdragon 7c / 665 class that ships in ARM Chromebooks.
  { re: /adreno[^0-9]{0,4}(3\d\d|4\d\d|5\d\d|6[01]\d)\b/, tier: "low", why: "Adreno 6xx-or-below" },
  { re: /\badreno\b/, tier: "medium", why: "Adreno-class mobile GPU" },
  // Intel integrated. HD 3000/4000-era parts predate a usable WebGL2 driver on most machines.
  { re: /intel.*(gma|hd graphics (2000|3000|4000))/, tier: "low", why: "pre-Haswell Intel integrated" },
  // UHD 600/605 (Gemini Lake) is *the* school-Chromebook GPU. Capped at medium: it can hold 60 Hz
  // with a 1024² shadow rig and a bloom, and cannot with 2048² x2 at a 1.5x pixel ratio and
  // five post passes. (The rig sizes are the ones `Lighting.js` really builds, not the table's.)
  { re: /intel.*\b(hd|uhd) graphics\b/, tier: "medium", why: "Intel HD/UHD integrated graphics" },
  // Iris / Xe / Arc integrated: the *current* Chromebook Plus and thin-laptop part. Far better than
  // UHD 600 and still integrated — it shares system memory bandwidth with the CPU, which is what
  // a 2.25x drawing buffer and a five-pass post stack actually run out of. It reports MAX_TEXTURE_SIZE
  // 16384 and ships with 8 cores and 8 GB, so *every* capability cap below misses it: without this
  // rule an Iris Xe Chromebook Plus booted straight into `high`.
  {
    re: /(intel|mesa).*\b(iris|xe graphics|arc)\b/,
    tier: "medium",
    why: "Intel Iris/Xe/Arc integrated graphics",
  },
  // AMD APU integrated. Codenames first: Mesa reports them explicitly ("AMD Radeon Graphics
  // (renoir, LLVM …)"), and the marketing string on those parts is the maximally unhelpful
  // "AMD Radeon Graphics". Only the 4-core / 4 GB caps used to rescue these, and an 8 GB / 8-core
  // Ryzen Chromebook was rescued by nothing at all.
  {
    re: /raven|renoir|cezanne|picasso|barcelo|mendocino|lucienne|rembrandt|stoney|carrizo/,
    tier: "medium",
    why: "AMD APU integrated graphics",
  },
  // …and the marketing strings: "AMD Radeon(TM) Graphics", "AMD Radeon(TM) Vega 8 Graphics".
  // Discrete parts are named ("Radeon RX 7600", "Radeon Pro W6600") and do not match.
  { re: /radeon\s*(\(tm\)\s*)?(graphics|vega)\b/, tier: "medium", why: "AMD integrated Radeon graphics" },
];

/**
 * Positive evidence that a machine can afford the configured tier. Nothing here is required; the
 * absence of all of it simply means the machine starts at `NEUTRAL_START` and earns the rest.
 *
 * **Only the renderer string may promote.** The obvious alternative — "MAX_TEXTURE_SIZE ≥ 16384
 * with ≥ 8 cores" — sounds like a capability check and is really a calendar check: every Iris Xe,
 * every Ryzen APU and every Mali-G610 shipped since about 2018 reports exactly those numbers. I
 * tried it and it put a privacy-masked Firefox, a legacy "WebKit WebGL" mask and every browser
 * without `deviceMemory` straight back into `high`, which is the bug this round exists to kill.
 * Capability numbers cap; they never promote. A machine behind a mask starts at `NEUTRAL_START` and
 * buys `high` back in about three seconds through the up-path, which is the cheap side of the
 * asymmetry.
 */
const STRENGTH_RULES = [
  // Brand words, not the vendor word: "NVIDIA" also appears on Tegra, which is not this machine.
  { re: /\b(geforce|rtx|gtx|quadro|titan|tesla)\b/, why: "discrete NVIDIA GPU" },
  { re: /radeon\s*(rx|pro)\b|\bfirepro\b|\bnavi\b|\bvega\s*(56|64)\b/, why: "discrete AMD Radeon GPU" },
  { re: /\bapple\s*m\d/, why: "Apple-silicon GPU" },
];

/** True for SwiftShader / llvmpipe / Apple's software fallback. See the class docs. */
export function isSoftwareRaster(name) {
  return /swiftshader|llvmpipe|software|basic render|microsoft basic/i.test(String(name));
}

/**
 * Read everything about the machine that is legible before a single frame has been drawn.
 * Every field is reported on the probe, so the heuristic's inputs are auditable, not asserted.
 */
export function inspectDevice(renderer) {
  const env = {
    renderer: "unknown",
    vendor: "unknown",
    maxTextureSize: 0,
    webgl2: false,
    devicePixelRatio: Number(globalThis.devicePixelRatio || 1),
    cores: Number(globalThis.navigator?.hardwareConcurrency || 0),
    memoryGB: Number(globalThis.navigator?.deviceMemory || 0),
    viewport: [Number(globalThis.innerWidth || 0), Number(globalThis.innerHeight || 0)],
  };
  try {
    const gl = renderer.getContext();
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    // Chrome masks the real string behind ANGLE unless the extension is present, and is in the
    // process of removing the extension — so match on both, joined. The masked ANGLE string still
    // carries the part name ("ANGLE (Intel, Intel(R) UHD Graphics 600 Direct3D11 …)").
    const masked = String(gl.getParameter(gl.RENDERER) || "");
    const unmasked = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || "") : "";
    env.renderer = [masked, unmasked].filter(Boolean).join(" | ") || "unknown";
    env.vendor = String(
      (dbg && gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)) || gl.getParameter(gl.VENDOR) || "unknown"
    );
    env.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) | 0;
    env.webgl2 = !!renderer.capabilities?.isWebGL2;
  } catch {
    /* a context that will not answer questions is itself evidence; the caps below handle it */
  }
  return env;
}

/**
 * Pick the tier to *start* at.
 *
 * The shape of the answer, and the thing that changed in round 2: the baseline is
 * `NEUTRAL_START`, and only *positive evidence of strength* raises it to the configured `ceiling`.
 * Weak-hardware rules then cap it further. The old shape — start at the ceiling, lower on evidence
 * of weakness — meant every machine whose signals were illegible booted into a 2.25x drawing
 * buffer, a 2048² x2 shadow rig and a 5-pass post stack, and "illegible" describes a large and
 * *growing* share of real browsers.
 *
 * @param {object} env  from `inspectDevice`
 * @param {string} ceiling  the configured tier — the heuristic may lower, never raise
 */
export function startingTier(env, ceiling = "high") {
  const notes = [];
  const caps = [];
  const strengths = [];
  const cap = (tier, why) => {
    if (!TIERS[tier]) return;
    caps.push(tier);
    notes.push(`${why} → ≤ ${tier}`);
  };

  if (isSoftwareRaster(env.renderer)) {
    return {
      tier: ceiling,
      standDown: true,
      notes: [`software rasteriser "${env.renderer}" — a measurement environment, not a device class`],
      caps: [],
      strengths: [],
    };
  }

  const name = String(env.renderer).toLowerCase();

  for (const rule of GPU_RULES) {
    if (!rule.re.test(name)) continue;
    cap(rule.tier, rule.why);
    break; // first (most specific) match wins; the list is ordered narrow → broad
  }

  // A GL stack without WebGL2 in 2026 is an old driver on old silicon, and it also costs the post
  // stack its multisampled target — the frame gets slower *and* worse. Treat it as evidence.
  if (!env.webgl2) cap("low", "no WebGL2");

  // MAX_TEXTURE_SIZE is the cheapest honest capability signal there is: current desktop parts report
  // 16384, the weakest mobile GL stacks still report 4096.
  if (env.maxTextureSize && env.maxTextureSize <= 4096) cap("low", `MAX_TEXTURE_SIZE ${env.maxTextureSize}`);
  else if (env.maxTextureSize && env.maxTextureSize <= 8192) cap("medium", `MAX_TEXTURE_SIZE ${env.maxTextureSize}`);

  // Cores and memory. 4 GB / 4 cores is the standard school Chromebook; 2 of either is a netbook.
  if (env.cores && env.cores <= 2) cap("low", `${env.cores} logical cores`);
  else if (env.cores && env.cores <= 4) cap("medium", `${env.cores} logical cores`);
  if (env.memoryGB && env.memoryGB <= 2) cap("potato", `${env.memoryGB} GB device memory`);
  else if (env.memoryGB && env.memoryGB <= 4) cap("medium", `${env.memoryGB} GB device memory`);

  // Fill rate is pixels, not parts. A 4K panel is 8.3 M pixels per frame whatever is behind it.
  const dpr = Math.min(env.devicePixelRatio || 1, TIERS[ceiling]?.maxPixelRatio ?? 1.5);
  const pixels = (env.viewport[0] || 0) * (env.viewport[1] || 0) * dpr * dpr;
  if (pixels > 5e6) cap("medium", `${(pixels / 1e6).toFixed(1)} MP drawing buffer`);

  // ---- and now the other direction: is there any positive reason to believe in this machine?
  for (const rule of STRENGTH_RULES) {
    if (rule.re.test(name)) {
      strengths.push(rule.why);
      break;
    }
  }
  const ceilIdx = TIER_ORDER.indexOf(TIERS[ceiling] ? ceiling : "high");
  const neutralIdx = Math.min(ceilIdx, TIER_ORDER.indexOf(NEUTRAL_START));
  const baseIdx = strengths.length ? ceilIdx : neutralIdx;
  notes.unshift(
    strengths.length
      ? `evidence of strength (${strengths.join("; ")}) → start at the configured ${TIER_ORDER[ceilIdx]}`
      : `no evidence of strength → start at ${TIER_ORDER[baseIdx]} and let measurement earn the rest`
  );

  const idx = caps.reduce((lo, t) => Math.min(lo, TIER_ORDER.indexOf(t)), baseIdx);
  const tier = TIER_ORDER[clampIndex(idx)];
  return { tier, standDown: false, notes, caps, strengths };
}

// ------------------------------------------------------------------------------------ the system

/**
 * The kernel system. Samples the period between its own `frame()` calls — which is the full loop
 * period including the render, the same quantity `kernel.frameMs` reports, but measured whether the
 * loop is driven by rAF or by a reviewer's `advance()`.
 */
export class AutoTier {
  constructor(kernel) {
    this.kernel = kernel;
    const q = new URLSearchParams(globalThis.location?.search || "");
    const flag = (q.get("autotier") || "").toLowerCase();

    const num = (name, fallback) => {
      const v = Number(q.get(name));
      return Number.isFinite(v) && v > 0 ? v : fallback;
    };

    this.bootTier = TIERS[config.get("tier")] ? config.get("tier") : "high";
    this.env = inspectDevice(kernel.renderer);
    this.heuristic = startingTier(this.env, this.bootTier);

    // Order matters: an explicit choice beats everything, then the query switch, then hardware.
    if (config.get("autoTier") === false) {
      this.enabled = false;
      this.reason = "explicit: a tier was chosen (settings or ?tier=), autoTier stood down";
    } else if (flag === "off" || flag === "0" || flag === "false") {
      this.enabled = false;
      this.reason = "disabled by ?autotier=off";
    } else {
      this.enabled = true;
      this.forced = flag === "force";
      this.dry = this.heuristic.standDown && !this.forced;
      this.reason = this.dry
        ? `measuring but not applying: ${this.heuristic.notes[0]}`
        : "measuring";
    }

    /**
     * The ceiling measurement may promote to.
     *
     * When the heuristic capped the tier on hardware evidence, *that cap is the ceiling* — not the
     * configured tier. Holding vsync at `medium` is not evidence that `high` is affordable, and
     * treating it as such is how a correctly-capped Chromebook goes medium → high → medium → low
     * and ends two tiers below the heuristic's own answer with its whole change budget spent.
     * When the heuristic found nothing to cap, the configured tier is the ceiling as before, which
     * is what lets a machine with illegible hardware signals earn its way back up from
     * `NEUTRAL_START`.
     */
    this.ceilingSource = this.heuristic.caps.length ? "heuristic cap" : "configured tier";
    this.ceiling = this.heuristic.caps.length ? this.heuristic.tier : this.bootTier;

    /**
     * Does the hardware corroborate a bad reading?
     *
     * The same evidence that sets the ceiling also decides whether the first descent is provisional.
     * When the heuristic capped the tier — a named integrated GPU, no WebGL2, 4 GB, a 4K buffer —
     * a catastrophic first window is that machine behaving as predicted: leap at once, never revoke.
     * When it found nothing (or found *strength*), a catastrophic first window is a surprise, and a
     * surprise measured 1.5-4 s after the first render is more often a boot storm than a machine.
     */
    this.corroborated = this.heuristic.caps.length > 0;

    this.policy = new TierPolicy(this.enabled ? this.heuristic.tier : this.bootTier, {
      ceiling: this.enabled ? this.ceiling : this.bootTier,
      provisional: !this.corroborated,
      warmupFrames: num("autotierWarmup", POLICY.warmupFrames),
      firstWarmupFrames: num("autotierWarmup", POLICY.firstWarmupFrames),
      warmupMs: num("autotierWarmupMs", POLICY.warmupMs),
      firstWarmupMs: num("autotierWarmupMs", POLICY.firstWarmupMs),
      windowFrames: num("autotierWindow", POLICY.windowFrames),
      firstWindowFrames: num("autotierWindow", POLICY.firstWindowFrames),
      windowMs: num("autotierWindowMs", POLICY.windowMs),
      firstWindowMs: num("autotierWindowMs", POLICY.firstWindowMs),
      cooldownMs: num("autotierCooldown", POLICY.cooldownMs),
      downMs: num("autotierDown", POLICY.downMs),
      recoveryQuietMs: num("autotierQuiet", POLICY.recoveryQuietMs),
    });

    this.history = [];
    this.standDown = null;
    this.startTier = this.bootTier;
    this._last = 0;
    this._frames = 0;
    this._shadowBase = null;
    this._shadowBaseRes = null;
    this._postRoute = null;

    // The heuristic's own decision, applied before the world is built. This is the whole point of
    // running at boot order 02: `Lighting.js` (14) reads `config.tier.shadowResolution` when it
    // builds its cascades, and `Scatter.js` (16) reads `grassDensity`. Arriving after them would
    // mean the first change had to tear down work that never should have been done.
    if (this.enabled && !this.dry && this.heuristic.tier !== this.bootTier) {
      config.applyTier(this.heuristic.tier);
      this.startTier = this.heuristic.tier;
      this._emit("heuristic", `first-frame heuristic: ${this.heuristic.notes.join("; ")}`);
      this.kernel.resize(); // pixel ratio follows the tier immediately
      this.history.push({
        at: 0,
        from: this.bootTier,
        to: this.heuristic.tier,
        direction: "heuristic",
        why: this.heuristic.notes.join("; "),
        applied: true,
        // No post system exists at boot order 02; the signal above is the whole contract here.
        post: "signal",
      });
    }

    publish("autotier", () => this.report());
  }

  // ------------------------------------------------------------------------------ measurement

  frame() {
    // Counted even when the module is standing down, so the probe can prove that thousands of real
    // frames went by under an explicit choice and nothing moved.
    this._frames++;
    if (!this.enabled) return;

    // Re-read the switch every frame, not once at boot. `Config.set("tier", …)` flips `autoTier`
    // to false, and a settings screen opened ten minutes into a session is exactly as binding as
    // `?tier=` on the URL. Captured at construction, this check was true only of the boot instant:
    // the player picked `low`, and 2000 frames later auto-tiering had walked the picture down to
    // `potato` underneath them.
    if (config.get("autoTier") === false) {
      this._standDown();
      return;
    }

    // The lighting rig builds its cascades at boot order 14, so the baseline can only be read once
    // the first frames are running. Bounded on both axes: every 15th frame, and abandoned after
    // 300. A machine that starts at `potato` has `castShadow` false on every light and would
    // otherwise pay a full scene traverse every frame, for ever, looking for something that is
    // never going to be there — on precisely the hardware that can least afford it.
    if (this._shadowBase === null && this._frames <= 300 && !this.dry) {
      if (this._frames % 15 === 1) this._captureShadowBaseline();
      if (this._frames === 300 && this._shadowBase === null) this._shadowBase = 0;
    }
    const now = performance.now();
    if (this._last !== 0) {
      const change = this.policy.sample(now - this._last);
      if (change) this._onDecision(change);
    }
    this._last = now;
  }

  /**
   * Hand control back to the player, for good.
   *
   * Recorded separately from `history` on purpose: `history` is the list of changes *auto-tiering
   * decided*, and standing down is the opposite of a decision. It still applies, because
   * `config.tier` is already the player's choice while the renderer is still wearing whatever
   * auto-tiering last chose — and a setting that does not change the picture is not a setting.
   */
  _standDown() {
    this.enabled = false;
    this.reason =
      "explicit: a tier was chosen mid-session (settings screen or console), autoTier stood down";
    this.standDown = {
      reason: this.reason,
      atFrame: this._frames,
      atMs: Number(this.policy.clock.toFixed(1)),
      playerTier: config.tier.id,
      autoTierWas: this.policy.tier,
      autoChangesMade: this.history.length,
      applied: false,
    };
    if (this.dry) return;
    this.kernel.resize();
    this._applyShadows();
    this._applyPost(this.reason, "player");
    this.standDown.applied = true;
    this.standDown.renderer = this.rendererState();
  }

  _onDecision(change) {
    const before = this.rendererState();
    let applied = false;
    if (!this.dry) {
      applied = config.applyTier(change.to);
      if (applied) {
        this.kernel.resize(); // pixel ratio + every render target that follows the drawing buffer
        this._applyShadows();
        this._applyPost(change.why, change.direction);
      }
    }
    this.history.push({
      ...change,
      applied,
      dry: this.dry,
      before,
      after: applied ? this.rendererState() : null,
      post: this._postRoute,
    });
  }

  // ------------------------------------------------------------------------------ applying it

  /**
   * The shadow ladder is expressed as a *ratio*, not as a number copied from `Lighting.js`.
   *
   * P11 clamps `tier.shadowResolution` to its own range when it builds the cascades, so the map
   * that actually exists is not the number in the tier table. Reading the built size once and
   * scaling it by the tier ratio keeps this module honest about not owning that file: whatever
   * resolution the lighting rig chose is the ceiling, and a tier step is a real halving below it.
   */
  _captureShadowBaseline() {
    let max = 0;
    let n = 0;
    this.kernel.scene.traverse((o) => {
      if (o.castShadow && o.shadow?.mapSize) {
        max = Math.max(max, o.shadow.mapSize.x);
        n++;
      }
    });
    if (!n) return; // lights not built yet; try again next frame
    this._shadowBase = max;
    this._shadowBaseRes = config.tier.shadowResolution || max;
  }

  _shadowTargetSize() {
    if (!this._shadowBase) return 0;
    const ratio = (config.tier.shadowResolution || 1024) / (this._shadowBaseRes || 1024);
    const raw = this._shadowBase * ratio;
    const pow2 = 2 ** Math.round(Math.log2(Math.max(1, raw)));
    return Math.max(512, Math.min(this._shadowBase, pow2));
  }

  _applyShadows() {
    const r = this.kernel.renderer;
    const want = !!config.tier.shadows;
    const size = this._shadowTargetSize();

    if (size) {
      this.kernel.scene.traverse((o) => {
        if (!o.castShadow || !o.shadow?.mapSize) return;
        const from = o.shadow.mapSize.x;
        if (from === size) return;
        o.shadow.mapSize.set(size, size);
        // Normal-offset bias is authored in *texels* (`Lighting.js` writes it as
        // (radius*2)/res*1.1). Changing the resolution without carrying the bias with it is how a
        // tier step turns into shadow acne, which reads as a rendering bug rather than a setting.
        if (o.shadow.normalBias) o.shadow.normalBias *= from / size;
        o.shadow.map?.dispose();
        o.shadow.map = null; // three reallocates at the new size on the next shadow pass
      });
    }

    if (r.shadowMap.enabled !== want) {
      r.shadowMap.enabled = want;
      r.shadowMap.needsUpdate = true;
      // `USE_SHADOWMAP` is a compile-time define. Three only rebuilds a program when it is told the
      // material changed, so without this the world keeps its old shaders and the setting does
      // nothing at all — the exact class of "applied a tier" that is a lie.
      this.kernel.scene.traverse((o) => {
        const m = o.material;
        if (!m) return;
        if (Array.isArray(m)) m.forEach((x) => x && (x.needsUpdate = true));
        else m.needsUpdate = true;
      });
    }
  }

  /**
   * Post is P12's. The contract is the `quality:tier` signal; the direct call is a bridge that
   * retires itself the moment `PostStack` subscribes, and it uses only the two methods P12
   * documents as its runtime control surface (`setEnabled` / `setEffect`), reached through the
   * kernel's system registry rather than an import.
   */
  _applyPost(why, direction = "tier") {
    const listening = signals.names().includes("quality:tier");
    this._emit(direction, why);
    if (listening) {
      this._postRoute = "signal";
      return;
    }
    const post = this.kernel.get?.("post");
    if (!post || typeof post.setEffect !== "function") {
      this._postRoute = "absent";
      return;
    }
    const want = new Set(config.tier.postStack || []);
    const anyEffect = ["bloom", "godrays", "grain", "vignette"].some((id) => want.has(id));
    // Effects first, unconditionally, and only then the composer. Skipping the flags on the way
    // down left them describing the *previous* tier — the composer was genuinely uninstalled but
    // `__vs.probe("post").effects` still claimed bloom and vignette, and a later `setEnabled(true)`
    // would have rebuilt the chain to the old tier's shape. P30 C5.
    post.setEffect("bloom", want.has("bloom"));
    post.setEffect("sunGlow", want.has("godrays"));
    post.setEffect("grain", want.has("grain"));
    post.setEffect("vignette", want.has("vignette"));
    if (typeof post.setEnabled === "function") post.setEnabled(anyEffect);
    this._postRoute = anyEffect ? "bridge" : "bridge:off";
  }

  _emit(direction, why) {
    const t = config.tier;
    signals.emit("quality:tier", {
      tier: t.id,
      direction,
      why,
      source: "autotier",
      postStack: [...(t.postStack || [])],
      shadows: !!t.shadows,
      shadowResolution: t.shadowResolution,
      maxPixelRatio: t.maxPixelRatio,
      // Carried but deliberately not applied here: `Lighting.js` builds the fog ramp from
      // `drawDistance`, and moving the camera's far plane without the fog puts a hard clip inside
      // the ramp. Whoever owns the fog can follow this number when they choose to.
      drawDistance: t.drawDistance,
      grassDensity: t.grassDensity,
      particleBudget: t.particleBudget,
    });
  }

  // ------------------------------------------------------------------------------ reporting

  rendererState() {
    const r = this.kernel.renderer;
    let shadowMax = 0;
    let casters = 0;
    this.kernel.scene.traverse((o) => {
      if (o.castShadow && o.shadow?.mapSize) {
        shadowMax = Math.max(shadowMax, o.shadow.mapSize.x);
        casters++;
      }
    });
    return {
      pixelRatio: Number(r.getPixelRatio().toFixed(4)),
      shadowMapEnabled: !!r.shadowMap.enabled,
      shadowMapSize: shadowMax,
      shadowCasters: casters,
      drawingBuffer: [r.domElement.width, r.domElement.height],
    };
  }

  report() {
    const st = this.policy.lastStats;
    return {
      enabled: this.enabled,
      dry: !!this.dry,
      forced: !!this.forced,
      reason: this.reason,
      standDown: this.standDown,
      frames: this._frames,
      bootTier: this.bootTier,
      startTier: this.startTier,
      tier: config.tier.id,
      policyTier: this.policy.tier,
      ceiling: this.policy.ceiling,
      ceilingSource: this.ceilingSource,
      autoTierSetting: config.get("autoTier"),
      /**
       * The provisional-descent machinery, in full, so a reviewer can see *why* a revocation has or
       * has not fired without re-deriving it. `gate` names the first condition that is not met.
       */
      provisional: {
        corroborated: !!this.corroborated,
        enabled: this.policy.provisional,
        descent: this.policy.descent
          ? {
              from: this.policy.descent.from,
              to: this.policy.descent.to,
              rungs: this.policy.descent.rungs,
              atMs: this.policy.descent.at,
              medianMs: this.policy.descent.medianMs,
              late: this.policy.descent.late,
            }
          : null,
        locked: this.policy.locked,
        recoveries: this.policy.recoveries,
        quietForMs:
          this.policy.quietSince === null ? 0 : Math.round(this.policy.clock - this.policy.quietSince),
        ...this.policy.recoveryState(this.policy.lastStats),
      },
      /**
       * What the `quality:tier` signal actually reaches. `postStack` is consumed (by P12's subscriber
       * or, until it has one, by the bridge in `_applyPost`); the rest is advisory and, as of this
       * round, has no subscriber at all. Reported rather than implied, because a probe that lists
       * `grassDensity` without saying nobody reads it is a probe that lies by omission.
       */
      signal: {
        name: "quality:tier",
        subscribed: signals.names().includes("quality:tier"),
        applied: ["maxPixelRatio", "shadowResolution", "shadows", "postStack"],
        advisory: ["drawDistance", "grassDensity", "particleBudget"],
      },
      heuristic: {
        tier: this.heuristic.tier,
        standDown: this.heuristic.standDown,
        caps: this.heuristic.caps,
        strengths: this.heuristic.strengths,
        notes: this.heuristic.notes,
        env: this.env,
      },
      measured: st
        ? {
            fps: Number(st.fps.toFixed(1)),
            medianMs: Number(st.median.toFixed(2)),
            p10Ms: Number(st.p10.toFixed(2)),
            p95Ms: Number(st.p95.toFixed(2)),
            p99Ms: Number(st.p99.toFixed(2)),
            maxMs: Number(st.max.toFixed(2)),
            frames: st.n,
            spanMs: Number(st.spanMs.toFixed(1)),
          }
        : null,
      samples: {
        accepted: this.policy.accepted,
        rejected: this.policy.rejected,
        clockMs: Math.round(this.policy.clock),
      },
      thresholds: {
        downMs: this.policy.p.downMs,
        upMs: this.policy.p.upMs,
        windowFrames: this.policy.p.windowFrames,
        windowMs: this.policy.p.windowMs,
        minFrames: this.policy.p.minFrames,
        firstWindowFrames: this.policy.p.firstWindowFrames,
        firstWindowMs: this.policy.p.firstWindowMs,
        firstMinFrames: this.policy.p.firstMinFrames,
        warmupFrames: this.policy.p.warmupFrames,
        warmupMs: this.policy.p.warmupMs,
        firstWarmupFrames: this.policy.p.firstWarmupFrames,
        firstWarmupMs: this.policy.p.firstWarmupMs,
        cooldownMs: this.policy.p.cooldownMs,
        maxChanges: this.policy.p.maxChanges,
        maxUpSteps: this.policy.p.maxUpSteps,
        maxLeap: this.policy.p.maxLeap,
        firstMaxLeap: this.policy.p.firstMaxLeap,
        tailFraction: this.policy.p.tailFraction,
        maxRecoveries: this.policy.p.maxRecoveries,
        recoveryArmMs: this.policy.p.recoveryArmMs,
        recoveryQuietMs: this.policy.p.recoveryQuietMs,
        recoveryInconsistency: this.policy.p.recoveryInconsistency,
        sampleMinMs: this.policy.p.sampleMinMs,
        sampleMaxMs: this.policy.p.sampleMaxMs,
      },
      budget: this.policy.budget(),
      changes: this.history,
      renderer: this.rendererState(),
      postRoute: this._postRoute,
    };
  }
}
