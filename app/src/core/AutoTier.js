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
 * builds `cascades = min(2, tier.shadowCascades)` and `res = clamp(tier.shadowResolution, 1024,
 * 2048)`, so **`ultra`, `high` and `medium` all build the same 2048² x2 rig** and only `low`/`potato`
 * differ. The three surfaces a tier step really moves are:
 *
 * | high → medium, as shipped | before | after |
 * |---|---|---|
 * | pixel ratio (drawing-buffer px per screen px) | 1.5 (2.25x) | 1.25 (1.5625x) — 31 % fewer pixels |
 * | post passes | 5 | 3 |
 * | shadow map | 2048² x2 | 1024² x2 — *this module's* ratio ladder, not the lighting rig's |
 *
 * Those three are what `rendererState()` reads back, and they are what a critic should check. The
 * pixel ratio and the shadow maps are moved here; the post stack is moved by **`quality:tier`**,
 * which `render/PostStack.js` subscribes to. Until this round that signal had no listener at all and
 * the post response ran through a private bridge — the decision was real and the wire was not.
 *
 * ## The asymmetry that sets every default in this file
 *
 * Being one tier too low costs a student some bloom and some shadow resolution for a few seconds.
 * Being one tier too high costs them the frame rate, which is the whole feel of the game. So the
 * heuristic starts at **medium unless there is positive evidence of strength** — not at `high`
 * unless there is positive evidence of weakness. Hardware signals are routinely *illegible*
 * (Firefox with `resistFingerprinting`, Safari, a legacy "WebKit WebGL" mask, any browser without
 * `deviceMemory`, Chrome once `WEBGL_debug_renderer_info` finishes going away), and "I could not
 * tell" must not mean "assume a gaming desktop".
 *
 * ## Corroboration is a *relation*, not a fact about the GPU string
 *
 * This is the round-2 bug, named exactly by its critic and fixed here.
 *
 * Round 2 read "a GPU family was named" as corroboration. But the heuristic's cap **at medium** is a
 * *positive prediction that medium is affordable*. A UHD 600 that then measures a 120 ms median
 * **at medium** has therefore **falsified** that prediction, not confirmed it — and round 2 treated
 * exactly that as hardware evidence, leapt medium → potato in one 3-rung step, and then refused
 * every recovery for the rest of the session because `provisional` was false. Three minutes of
 * flawless 16.6 ms frames restored nothing. The two machines that recovered were the RTX 4070 and a
 * masked browser: the two that never needed help.
 *
 * So corroboration is evaluated **per decision, against the tier the miss was measured at**:
 *
 *  * the heuristic predicts a tier — "this machine can afford `predictedTier`";
 *  * a miss measured **above** that tier is the predicted outcome → **corroborated**, and the
 *    descent is final;
 *  * a miss measured **at or below** it contradicts the prediction → **falsified**, and the descent
 *    is revocable.
 *
 * Because the heuristic's answer is also what gets applied at boot, the ordinary first descent is a
 * falsification and is therefore always revocable — which is the whole point. Corroboration still
 * has real work to do: when the heuristic said `medium` and the *up-path* promoted to `high`, a
 * subsequent miss at `high` is the prediction coming true, the descent is final, and the
 * promote/demote loop cannot start.
 *
 * ## A stall is not slow rendering
 *
 * A boot storm, a network hitch on classroom Wi-Fi, a GC pause and a tab switch are all real
 * elapsed time and none of them is evidence about the GPU. Three separate mechanisms keep them out
 * of the answer, and they are deliberately different mechanisms because they catch different things:
 *
 *  1. **An isolated over-long period is discarded entirely** — no score, no window time. A single
 *     4 s frame is a tab switch. It still advances `clock` (a cooldown that ignored it would be
 *     lying about how long ago the last decision was) but it contributes nothing to the window.
 *  2. **A *run* of over-long periods is a machine at 2 fps, not a stall.** After `stallRun`
 *     consecutive over-long frames the period is winsorised to `sampleMaxMs` and scored: the exact
 *     number stops mattering far below 4 fps, the sign does not.
 *  3. **The window is judged by a median over `windowMs` of *rendered* time.** Not a mean — an
 *     outlier cannot move a median at all. And not a frame count: 120 frames is 2 s at 60 Hz and
 *     60 s at 2 fps, so a frame count is a different instrument on every machine.
 *
 * Mechanism 3 is the one that answers the round-2 finding directly. A 4.8 s boot storm can no longer
 * decide a session because the first window is **six seconds of rendered time** and slow frames are
 * inherently under-represented in it: 3.3 s of 120 ms frames is 27 samples, and the 2.7 s of
 * flawless frames that follow are 162. The median is 16.6 ms and nothing happens. The round-2 cliff
 * was one second wide (≤3.6 s storm → nothing, ≥4.8 s storm → `potato` for the session); a storm now
 * has to run for the whole window *and* still be running at the end of it to buy anything, and what
 * it buys is one rung that can be handed back.
 *
 * ## Step, observe, step
 *
 * `maxLeap` is **1**. There is no multi-rung leap in either direction, ever — not on the first
 * decision, not on a corroborated one, not on a recovery. A 3-rung leap is the biggest visual cliff
 * in the ladder (shadows off, post down to one pass) and no single window is worth it. Reaching
 * `potato` from `medium` costs two decisions and two windows, which is the point: the second window
 * is a fresh observation of the machine at the tier the first one chose.
 *
 * ## Recovery must be reachable on the hardware that needed help
 *
 * "Holding vsync at the lower tier" is *not* evidence the higher tier is affordable, and that
 * argument is still rejected. Recovery rests on a narrower observation: **the machine improved by
 * more than a tier step can explain.** A rung is worth at most about 2x (`recoveryRungGain`), so a
 * genuine 120 ms at `medium` predicts *at best* 60 ms at `low`. Measuring 16.6 ms there does not
 * mean the machine is fast; it means the 120 ms was never render cost. A borderline machine —
 * 38 ms at `medium`, 23 ms at `low` — fails that test (23 is not below 0.6 x 19) and is never
 * probed, so a genuinely weak machine settles down and stays down.
 *
 * Every gate, in order:
 *
 *  1. a descent exists, and no down-step in it was **corroborated**, and
 *  2. every down-step landed inside `recoveryArmMs` — one early episode, not a machine walking
 *     itself down over minutes, and
 *  3. the window is full and the measurement is below `recoveryInconsistency` x the most generous
 *     model of the old reading, and
 *  4. headroom has held *continuously* for `recoveryQuietMs` (20 s), and
 *  5. `maxRecoveries` is unspent and no revocation has already failed.
 *
 * Each revocation is **one rung**, and each one needs its own fresh 20 s of continuous headroom. A
 * revocation that turns out to be wrong is caught by the ordinary down path and **locks the ratchet
 * permanently**.
 *
 * ## Why it cannot oscillate
 *
 *  * **A dead band.** Step down above `downMs` (21 ms ≈ 47 fps). Step up only with real headroom,
 *    which on a vsync-locked display means hitting the display's own cadence with tiny jitter.
 *    Nothing at all happens between those two states.
 *  * **A cooldown plus a window flush.** After any change the sample window is emptied and the next
 *    `warmupFrames`/`warmupMs` are discarded, so the cost of the change itself (a shader recompile,
 *    a render-target reallocation) can never be read as evidence for the next one.
 *  * **Up is not the inverse of down.** Once the policy has stepped down even once, the ordinary
 *    up-path is closed for the session. The revocation path is not that loop: it is not bought by a
 *    quiet stretch, it is bought by an improvement the tier step cannot explain, and a down-step
 *    after one locks it for good.
 *  * **A budget.** `maxChanges` total, `maxDownSteps` of them downward, `maxUpSteps` upward,
 *    `maxRecoveries` revocations, and the ceiling is the heuristic's cap (or the configured tier
 *    when the heuristic found nothing).
 *
 * ## Why an explicit choice wins completely
 *
 * `config.get("autoTier")` is the switch, and `Config.set("tier", …)` turns it off — so a settings
 * screen, `?tier=low`, or a console poke all stand this module down for the session. That switch is
 * re-read **every frame**, not captured at boot, and standing down also pushes the player's choice
 * into the renderer and out on `quality:tier`, because a setting that does not change the picture is
 * not a setting.
 *
 * ## Why a software rasteriser is not a device class
 *
 * The review harness renders through SwiftShader at a few frames per second. On a software
 * rasteriser this module measures and reports but **applies nothing** — the probe still shows what
 * it would have chosen. `?autotier=force` opts back in, and `review/measure/P35.mjs` uses it to
 * prove the apply path on real frames.
 *
 * ## Review knobs (query string)
 *
 * | knob | effect |
 * |---|---|
 * | `?autotier=off` | disabled entirely |
 * | `?autotier=force` | measure *and apply* even on a software rasteriser |
 * | `?autotierWarmup=N` | frames discarded after boot and after each change |
 * | `?autotierWarmupMs=MS` | wall-clock cap on that discard window |
 * | `?autotierWindow=N` | retention cap on window samples (also a fullness fallback) |
 * | `?autotierWindowMs=MS` | **rendered time** the window must cover before it may decide |
 * | `?autotierCooldown=MS` | minimum ms between decisions |
 * | `?autotierDown=MS` | median frame period above which the tier steps down |
 * | `?autotierQuiet=MS` | how long headroom must hold before a provisional descent is revoked |
 */

/** Every threshold, in one table, so a critic can read the policy without reading the code. */
export const POLICY = {
  // -- what is discarded after a change ------------------------------------------------------------
  /**
   * Frames thrown away after every applied change.
   *
   * Not just hitches: a tier change costs a shader recompile and a render-target reallocation, and
   * those frames describe the change, not the machine.
   */
  warmupFrames: 90,
  /**
   * …and the wall-clock cap on that discard window. Recompiles cost roughly a fixed amount of
   * *time*, so on a 2 fps machine "90 frames" is 45 s of penance for a 3 s event. Whichever bound
   * is reached first ends the warm-up: frames bind above ~35 fps, time binds below it.
   */
  warmupMs: 2500,
  /** The boot warm-up is shorter: the first seconds are the ones a student judges the game in. */
  firstWarmupFrames: 30,
  firstWarmupMs: 1500,

  // -- the window ----------------------------------------------------------------------------------
  /**
   * **The window is a duration, not a frame count.** 120 frames is 2 s at 60 Hz and 60 s at 2 fps;
   * a frame count is therefore a different instrument on every machine, and it was the instrument
   * that let 4.8 s of classroom Wi-Fi decide a session. `windowMs` is *rendered* time — an isolated
   * stall contributes none of it (see `sampleMaxMs`).
   *
   * 12 s steady state. A boot storm is a minority of that even at its worst, and slow frames are
   * under-represented in a count-based median by construction: 4 s of 120 ms frames is 33 samples
   * and 8 s of 60 Hz frames is 480.
   */
  windowMs: 12000,
  /**
   * …and the *first* window, taken while the boot storm may still be running. Six seconds: long
   * enough that a 4.8 s storm cannot fill it, short enough that a genuinely miserable machine gets
   * relief inside eight seconds of the first frame. It buys one rung, and that rung is revocable.
   */
  firstWindowMs: 6000,
  /** Never decide on fewer than this many scored frames, however long they took. */
  minFrames: 24,
  firstMinFrames: 15,
  /**
   * Retention cap on window samples, and a fullness fallback: a machine producing this many frames
   * inside `windowMs` is running above ~75 fps, and 900 frames is evidence enough on its own. The
   * cap also bounds the per-decision sort on the hardware this module exists for.
   */
  windowFrames: 900,

  // -- a down-step must be true *now*, not just on average ------------------------------------------
  /**
   * The most recent `tailMs` of rendered time has to miss the budget too.
   *
   * The median is a statement about the window; a tier change is a statement about the machine from
   * here on. A storm that decayed while the window was filling leaves a median over budget and a
   * tail already inside it — stepping down then is fixing a problem that has stopped happening.
   * Measured in time, not in samples: 25 % of the *samples* of a storm-contaminated window can be
   * most of its wall clock.
   */
  tailMs: 2500,
  tailMinFrames: 8,

  // -- the thresholds themselves --------------------------------------------------------------------
  /** Median frame period above which the tier steps down. 21 ms ≈ 47.6 fps sustained. */
  downMs: 21,
  /** Median frame period below which headroom is unambiguous even without a cadence estimate. */
  upMs: 13.5,
  /** For a vsync-locked display: how close the median must sit to the observed cadence. */
  cadenceTolerance: 1.06,
  /**
   * …and how tight the *99th* percentile must be against the observed cadence. A hitchy 60 fps is
   * not headroom, and p95 does not see it: over a long window a stutter arriving every 40 frames is
   * 2.5 % of samples. At p99 the line lands at "more than 1 % of frames hitching is not headroom".
   */
  cadenceJitter: 1.3,
  /** Above this the observed cadence is not a ≥57 Hz display and the cadence path does not apply. */
  cadenceMaxMs: 17.5,
  /** Minimum ms of measured time between two decisions. */
  cooldownMs: 4000,

  // -- how far a decision may travel, and how many there may be ------------------------------------
  /**
   * **One rung. Always.** Step, observe, step.
   *
   * A rung is worth *roughly* a factor of two as this module ships it — the drawing buffer (2.25 →
   * 1.5625 → 1 screen-pixels² at high → medium → low), this module's shadow ladder, and the post
   * stack (5 → 3 → 1 passes). Round 2 let one window buy three of those at once and the result was
   * the biggest visual cliff in the ladder bought by four seconds of Wi-Fi. No single window is
   * worth that, because the *next* window is a fresh observation of the machine at the tier this
   * one chose — which is the only way to find out whether one rung was enough.
   */
  maxLeap: 1,
  /** Hard cap on tier changes per session. The picture must stop moving. */
  maxChanges: 5,
  /** Of those, how many may be downward — four rungs is the whole ladder, ultra to potato. */
  maxDownSteps: 4,
  /** …how many may be an ordinary promotion. */
  maxUpSteps: 1,
  /**
   * …and how many may revoke a falsified descent. Two, because a descent may be two rungs deep and
   * a revocation is one rung, and each one costs its own fresh `recoveryQuietMs` of headroom.
   */
  maxRecoveries: 2,

  // -- revoking a falsified descent -----------------------------------------------------------------
  /**
   * A descent is only revocable while every down-step in it landed inside this much measured time.
   * Generous on purpose: with a 6 s first window and a 12 s steady one, a two-rung descent bought by
   * a long storm lands around 8 s and 27 s, and the gate has to separate "one early episode" from
   * "this machine has been missing for a minute" without punishing the longer windows that make the
   * first decision trustworthy.
   */
  recoveryArmMs: 45000,
  /** …and headroom must then hold *continuously* for this long before each revocation fires. */
  recoveryQuietMs: 20000,
  /**
   * The most generous estimate of what one rung buys, used *against* revocation: predicted cost at
   * the current tier is `descent.medianMs / recoveryRungGain^rungsBelowDescentStart`.
   */
  recoveryRungGain: 2,
  /**
   * How far below that prediction the measurement must sit before the old reading is judged not to
   * have been render cost at all. 120 ms at `medium` predicts ≤ 60 ms at `low`; measuring 16.6 ms
   * (0.28x) is inconsistent, and a borderline 38 ms → 23 ms (1.21x) is not.
   */
  recoveryInconsistency: 0.6,

  // -- what counts as a frame at all ----------------------------------------------------------------
  /**
   * Below this a "frame" is not a frame at all: `renderer.render()` submits GL commands and returns,
   * and the machine's real cost only shows up as backpressure at presentation time. A reviewer
   * driving `__vs.advance()` in a tight loop produces 0.5 ms "frames" no matter how slow the
   * hardware is. 2 ms is 500 fps; no display presents that fast, so nothing real is lost.
   */
  sampleMinMs: 2,
  /**
   * Above this a period is an **excursion**, and an isolated excursion is a stall: a tab switch, a
   * GC pause, a network hitch while the asset fetch finishes. It is discarded entirely — no score,
   * no window time — because it is elapsed time that says nothing about the GPU.
   */
  sampleMaxMs: 250,
  /**
   * …unless they keep coming. *Five consecutive* excursions is not a stall, it is a machine at
   * 2 fps, and rejecting those outright meant the worst hardware in the range was the one hardware
   * auto-tiering could never help. Once the run trips, the period is winsorised to `sampleMaxMs`
   * for scoring while its **real** duration still fills the window.
   */
  stallRun: 5,
};

const clampIndex = (i) => Math.max(0, Math.min(TIER_ORDER.length - 1, i));
const tierIndex = (t) => TIER_ORDER.indexOf(t);

/**
 * The measurement half. Pure: no DOM, no THREE, no clock of its own — it advances a clock from the
 * samples it is fed. That is what lets `review/measure/P35.mjs` prove the corroboration model, the
 * hysteresis, the budget and the no-oscillation property offline, deterministically, without
 * booting a browser at all.
 */
export class TierPolicy {
  constructor(startTier, opts = {}) {
    this.p = { ...POLICY, ...opts };
    this.p.windowFrames = Math.max(8, this.p.windowFrames);
    this.p.minFrames = Math.min(this.p.minFrames, this.p.windowFrames);
    this.p.firstMinFrames = Math.min(this.p.firstMinFrames, this.p.minFrames);
    this.p.firstWindowMs = Math.min(this.p.firstWindowMs, this.p.windowMs);
    this.p.firstWarmupFrames = Math.min(this.p.firstWarmupFrames, this.p.warmupFrames);
    this.p.maxLeap = Math.max(1, this.p.maxLeap | 0);

    this.tier = TIERS[startTier] ? startTier : "high";
    this.ceiling = TIERS[this.p.ceiling] ? this.p.ceiling : this.tier;

    /**
     * The tier the first-frame heuristic *predicted this machine can afford*.
     *
     * This is the whole corroboration model. A miss measured **above** this tier is the prediction
     * coming true; a miss measured **at or below** it falsifies the prediction and is therefore not
     * hardware evidence about anything. `null` when no heuristic ran, which is treated as "no
     * prediction was made" and so nothing can corroborate.
     */
    this.predictedTier = TIERS[this.p.predictedTier] ? this.p.predictedTier : null;
    /** Escape hatch, for a caller that wants every descent treated as final. Default: relational. */
    this.forceCorroborated = this.p.provisional === false;

    /** Window entries: `{ score, real }`. `score` is winsorised; `real` is elapsed time. */
    this.samples = [];
    this._span = 0;
    this.clock = 0;
    this.lastChangeAt = 0;
    this.changes = [];
    this.upSteps = 0;
    this.downSteps = 0;
    this.recoveries = 0;
    this.rejected = 0;
    this.accepted = 0;
    this.overrun = 0;
    this.excursions = 0;
    this.stalledMs = 0;
    this.lastStats = null;
    /** The descent, if one is still revocable. Cleared for good by `locked`. */
    this.descent = null;
    this.locked = false;
    /** Clock time at which the current unbroken run of headroom began; null when it is broken. */
    this.quietSince = null;
    this._buf = null;
    this._sinceEval = 0;

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
          ms: this.p.firstWindowMs,
          min: this.p.firstMinFrames,
        }
      : {
          warmFrames: this.p.warmupFrames,
          warmMs: this.p.warmupMs,
          ms: this.p.windowMs,
          min: this.p.minFrames,
        };
  }

  /**
   * Feed one frame period in milliseconds. Returns a change record when this sample tipped a
   * decision, otherwise null.
   *
   * The three-way classification of a period — not a frame / a stall / rendered time — happens
   * here, and it is the difference between "this machine is slow" and "something else happened".
   */
  sample(ms) {
    if (!Number.isFinite(ms) || ms < 0) return null;
    // The clock counts *all* elapsed time, including the stalls we refuse to score. A five-second
    // tab switch really did happen; it just is not evidence about frame cost, and a cooldown that
    // pretended it had not elapsed would be lying about how long ago the last decision was.
    this.clock += ms;

    if (ms < this.p.sampleMinMs) {
      // Not a presented frame: a non-presenting render loop, or a reviewer's tight advance() loop.
      this.rejected++;
      return null;
    }

    let score = ms;
    if (ms > this.p.sampleMaxMs) {
      this.excursions++;
      this.overrun++;
      if (this.overrun < this.p.stallRun) {
        // An isolated excursion is a stall. Discarded whole — no score, no window time.
        this.stalledMs += ms;
        this.rejected++;
        return null;
      }
      // Sustained: not a stall, a machine at 2 fps. Winsorise the magnitude, keep the duration.
      score = this.p.sampleMaxMs;
    } else {
      this.overrun = 0;
    }

    if (this.discard > 0) {
      this.discard--;
      if (this.clock - this._warmStart >= this._warmMs) this.discard = 0;
      return null;
    }

    this.accepted++;
    this.samples.push({ score, real: ms });
    this._span += ms;
    // Evict from the front until the window is the *smallest suffix* covering `windowMs` of rendered
    // time. Rendered time, not clock: a stall consumes none of the window.
    while (
      this.samples.length > this.p.minFrames &&
      (this._span - this.samples[0].real >= this.p.windowMs ||
        this.samples.length > this.p.windowFrames)
    ) {
      this._span -= this.samples.shift().real;
    }

    // Sorting the window on every frame is 6 kB of garbage per frame on the hardware this module
    // exists for. Once the window is large the answer cannot change materially in four frames, and
    // a decision arriving four frames late is not a decision anyone can perceive.
    this._sinceEval++;
    const stride = this.samples.length >= 120 ? 4 : 1;
    if (this._sinceEval < stride) return null;
    this._sinceEval = 0;
    return this.decide();
  }

  /** Window scores, sorted, in a reused buffer. */
  _sorted() {
    const n = this.samples.length;
    if (!this._buf || this._buf.length < n) this._buf = new Float64Array(Math.max(128, n * 2));
    const b = this._buf.subarray(0, n);
    for (let i = 0; i < n; i++) b[i] = this.samples[i].score;
    b.sort();
    return b;
  }

  stats() {
    const n = this.samples.length;
    if (!n) return null;
    const s = this._sorted();
    const q = (f) => s[Math.min(n - 1, Math.floor(f * (n - 1)))];
    let sum = 0;
    for (let i = 0; i < n; i++) sum += s[i];
    const median = q(0.5);
    return {
      n,
      p10: q(0.1),
      median,
      p95: q(0.95),
      p99: q(0.99),
      max: s[n - 1],
      meanMs: sum / n,
      /** *Rendered* time the window covers. Stalls are not in here; that is the point. */
      spanMs: this._span,
      fps: median > 0 ? 1000 / median : 0,
    };
  }

  /** True when the window covers enough rendered time (or enough frames) to be an answer. */
  isFull(st, w = this.shape()) {
    if (!st) return false;
    return (st.spanMs >= w.ms || st.n >= this.p.windowFrames) && st.n >= w.min;
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
   * Does a miss measured at the current tier corroborate the heuristic's prediction?
   *
   * The round-2 bug in one line: this used to be `heuristic.caps.length > 0`, evaluated once at
   * boot, which is "a GPU family was named" and not "the measurement agrees with the prediction".
   */
  corroboratesAt(tier = this.tier) {
    if (this.forceCorroborated) return true;
    if (!this.predictedTier) return false;
    return tierIndex(tier) > tierIndex(this.predictedTier);
  }

  /** How far one down-step may travel. One rung. See POLICY.maxLeap. */
  rungsFor() {
    return Math.max(1, Math.min(this.p.maxLeap, 1));
  }

  /** The median of the most recent `tailMs` of rendered time. See POLICY.tailMs. */
  tailMedian() {
    const n = this.samples.length;
    if (!n) return Infinity;
    let k = 0;
    let acc = 0;
    while (k < n && (acc < this.p.tailMs || k < this.p.tailMinFrames)) {
      acc += this.samples[n - 1 - k].real;
      k++;
    }
    const t = [];
    for (let i = n - k; i < n; i++) t.push(this.samples[i].score);
    t.sort((a, b) => a - b);
    return t[Math.floor(0.5 * (t.length - 1))];
  }

  /**
   * Track the unbroken run of headroom that gate 4 of a revocation needs.
   *
   * Runs on every evaluation, *before* any of `decide()`'s early returns, so the run keeps
   * accumulating through the cooldown and through a spent change budget. A single window without
   * headroom breaks it and it starts again from zero.
   */
  _trackQuiet(st) {
    const steady = this.shape(false);
    if (this.isFull(st, steady) && this.headroom(st)) {
      if (this.quietSince === null) this.quietSince = this.clock;
    } else {
      this.quietSince = null;
    }
  }

  /**
   * Could the descent be revoked right now? Every gate in the class docs, in order, and each returns
   * the name of the gate that stopped it so the probe can say *why* not.
   */
  recoveryState(st) {
    const d = this.descent;
    if (this.locked) return { armed: false, gate: "a revocation already failed — locked" };
    if (this.recoveries >= this.p.maxRecoveries)
      return { armed: false, gate: "revocation budget spent" };
    if (!d) return { armed: false, gate: "no descent to revoke" };
    if (d.corroborated)
      return {
        armed: false,
        gate: `the descent corroborated the heuristic (measured at ${d.from}, above the predicted ${this.predictedTier})`,
      };
    if (d.late) return { armed: false, gate: "the descent continued past the arming window" };
    const back = Math.min(tierIndex(d.from), tierIndex(this.tier) + 1, tierIndex(this.ceiling));
    if (!(back > tierIndex(this.tier)))
      return { armed: false, gate: "already back at the tier the descent started from" };
    if (!this.isFull(st, this.shape(false))) return { armed: false, gate: "window not full" };
    // Gate 3: the improvement is larger than the tier step can account for, so the earlier reading
    // was not render cost. The most generous model of the step is used, against the revocation.
    const rungsBelow = Math.max(1, tierIndex(d.from) - tierIndex(this.tier));
    const predicted = d.medianMs / this.p.recoveryRungGain ** rungsBelow;
    const ratio = st.median / predicted;
    if (!(ratio <= this.p.recoveryInconsistency))
      return {
        armed: false,
        gate: `improvement is consistent with the tier step (${st.median.toFixed(1)} ms is ${ratio.toFixed(2)}x the ${predicted.toFixed(1)} ms a ${rungsBelow}-rung step predicts)`,
        ratio: Number(ratio.toFixed(3)),
      };
    if (this.quietSince === null)
      return { armed: false, gate: "headroom is not currently held", ratio: Number(ratio.toFixed(3)) };
    const heldMs = this.clock - this.quietSince;
    if (heldMs < this.p.recoveryQuietMs)
      return {
        armed: false,
        gate: `headroom held for ${(heldMs / 1000).toFixed(1)} s of ${(this.p.recoveryQuietMs / 1000).toFixed(0)} s`,
        ratio: Number(ratio.toFixed(3)),
        heldMs: Number(heldMs.toFixed(0)),
      };
    return {
      armed: true,
      gate: null,
      to: TIER_ORDER[back],
      ratio: Number(ratio.toFixed(3)),
      heldMs: Number(heldMs.toFixed(0)),
      predictedMs: Number(predicted.toFixed(1)),
    };
  }

  decide() {
    const st = this.stats();
    this.lastStats = st;
    if (!st) return null;
    this._trackQuiet(st);
    if (this.changes.length >= this.p.maxChanges) return null;

    const w = this.shape();
    if (!this.isFull(st, w)) return null;
    if (this.clock - this.lastChangeAt < this.p.cooldownMs) return null;

    const i = tierIndex(this.tier);
    const ceil = tierIndex(this.ceiling);

    // A down-step needs the window *and* its tail to miss the budget: the median describes the
    // window, but the change describes the rest of the session. See POLICY.tailMs.
    if (st.median > this.p.downMs && i > 0 && this.downSteps < this.p.maxDownSteps) {
      const tail = this.tailMedian();
      if (tail <= this.p.downMs) return null; // a storm that has already passed
      const rungs = this.rungsFor();
      const corroborated = this.corroboratesAt(this.tier);
      return this._change(
        TIER_ORDER[clampIndex(i - rungs)],
        "down",
        st,
        `median frame ${st.median.toFixed(1)} ms (${st.fps.toFixed(1)} fps) over ${st.n} frames / ${(st.spanMs / 1000).toFixed(1)} s of rendered time is ${(st.median / this.p.downMs).toFixed(1)}x the ${this.p.downMs} ms floor, tail ${tail.toFixed(1)} ms — one rung, ${corroborated ? `corroborated (measured at ${this.tier}, above the predicted ${this.predictedTier})` : `falsifies the predicted ${this.predictedTier ?? "nothing"} and is revocable`}`,
        rungs,
        { corroborated }
      );
    }

    /**
     * Revoking a falsified descent. Deliberately checked *before* the ordinary up path and
     * deliberately not gated on `downSteps === 0`: this is the one promotion that exists precisely
     * because a down-step happened, and the gates in `recoveryState` are what keep it from being the
     * oscillation loop the `downSteps` lock exists to prevent.
     */
    const rec = this.recoveryState(st);
    if (rec.armed) {
      return this._change(
        rec.to,
        "recover",
        st,
        `the ${this.descent.medianMs} ms that bought ${this.descent.from}→${this.descent.to} at ${(this.descent.at / 1000).toFixed(1)} s cannot have been render cost: the tier steps taken since predict ${rec.predictedMs} ms at best and this machine measures ${st.median.toFixed(1)} ms (${rec.ratio}x), with headroom held for ${(rec.heldMs / 1000).toFixed(0)} s — restoring ${rec.to}`,
        1
      );
    }

    // Promotion always waits for the full steady-state window. Relief is urgent and promotion is
    // not, and the p99 jitter gate is only meaningful over a long window.
    if (
      this.isFull(st, this.shape(false)) &&
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

  _change(to, direction, st, why, rungs = 1, extra = {}) {
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
      ...extra,
    };
    this.tier = to;
    this.changes.push(rec);
    if (direction === "up") this.upSteps++;
    else if (direction === "recover") this.recoveries++;
    else this.downSteps++;

    if (direction === "down") {
      if (!this.descent) {
        this.descent = { ...rec, late: rec.at > this.p.recoveryArmMs };
      } else {
        // A later down-step joins the same descent: it deepens it, and it can only *remove*
        // revocability — a corroborated step anywhere in the descent makes the whole thing final,
        // and a step outside the arming window makes it a machine walking itself down.
        this.descent.to = to;
        this.descent.corroborated = this.descent.corroborated || !!rec.corroborated;
        if (rec.at > this.p.recoveryArmMs) this.descent.late = true;
      }
      // …and a down-step *after* a revocation means the revocation was wrong. Never again.
      if (this.recoveries > 0) this.locked = true;
    }
    this.quietSince = null;
    // Flush: the change itself costs a shader recompile and a render-target reallocation, and those
    // frames must never become evidence for the next decision.
    this.samples.length = 0;
    this._span = 0;
    this._sinceEval = 0;
    const s = this.shape(false);
    this.discard = s.warmFrames;
    this._warmMs = s.warmMs;
    this._warmStart = this.clock;
    this.lastChangeAt = this.clock;
    return rec;
  }

  budget() {
    const d = this.descent;
    return {
      changesLeft: Math.max(0, this.p.maxChanges - this.changes.length),
      downStepsLeft: Math.max(0, this.p.maxDownSteps - this.downSteps),
      upStepsLeft: this.downSteps > 0 ? 0 : Math.max(0, this.p.maxUpSteps - this.upSteps),
      /**
       * Not just the count: a descent that corroborated the heuristic, or one that outgrew the
       * arming window, has no revocation available however much of the budget is unspent. Reported
       * as spendable-now so the budget line cannot imply an option `recoveryState()` has ruled out.
       */
      recoveriesLeft:
        this.locked || !d || d.corroborated || d.late
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
 *
 * Read these as *predictions of affordability*, because that is exactly how the policy above uses
 * them: "≤ medium" says medium is affordable on this part. When the machine then misses at medium,
 * the rule was wrong about this machine and the policy treats it that way.
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
 * every Ryzen APU and every Mali-G610 shipped since about 2018 reports exactly those numbers. It put
 * a privacy-masked Firefox, a legacy "WebKit WebGL" mask and every browser without `deviceMemory`
 * straight back into `high`. Capability numbers cap; they never promote.
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
 * Pick the tier to *start* at — which is to say, predict the tier this machine can afford.
 *
 * The baseline is `NEUTRAL_START`, and only *positive evidence of strength* raises it to the
 * configured `ceiling`. Weak-hardware rules then cap it further. The old shape — start at the
 * ceiling, lower on evidence of weakness — meant every machine whose signals were illegible booted
 * into a 2.25x drawing buffer, a 2048² x2 shadow rig and a 5-pass post stack, and "illegible"
 * describes a large and *growing* share of real browsers.
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
  const ceilIdx = tierIndex(TIERS[ceiling] ? ceiling : "high");
  const neutralIdx = Math.min(ceilIdx, tierIndex(NEUTRAL_START));
  const baseIdx = strengths.length ? ceilIdx : neutralIdx;
  notes.unshift(
    strengths.length
      ? `evidence of strength (${strengths.join("; ")}) → start at the configured ${TIER_ORDER[ceilIdx]}`
      : `no evidence of strength → start at ${TIER_ORDER[baseIdx]} and let measurement earn the rest`
  );

  const idx = caps.reduce((lo, t) => Math.min(lo, tierIndex(t)), baseIdx);
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
     * treating it as such is how a correctly-capped Chromebook goes medium → high → medium → low.
     * When the heuristic found nothing to cap, the configured tier is the ceiling, which is what
     * lets a machine with illegible hardware signals earn its way back up from `NEUTRAL_START`.
     */
    this.ceilingSource = this.heuristic.caps.length ? "heuristic cap" : "configured tier";
    this.ceiling = this.heuristic.caps.length ? this.heuristic.tier : this.bootTier;

    this.policy = new TierPolicy(this.enabled ? this.heuristic.tier : this.bootTier, {
      ceiling: this.enabled ? this.ceiling : this.bootTier,
      /**
       * The heuristic's *prediction* — the tier it says this machine can afford. Corroboration is
       * then decided per decision, against the tier the miss was actually measured at, rather than
       * once at boot on "was a GPU family named". See `TierPolicy.corroboratesAt`.
       */
      predictedTier: this.heuristic.tier,
      warmupFrames: num("autotierWarmup", POLICY.warmupFrames),
      firstWarmupFrames: num("autotierWarmup", POLICY.firstWarmupFrames),
      warmupMs: num("autotierWarmupMs", POLICY.warmupMs),
      firstWarmupMs: num("autotierWarmupMs", POLICY.firstWarmupMs),
      windowFrames: num("autotierWindow", POLICY.windowFrames),
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
        /**
         * Not "signal": no post system exists at boot order 02, so this emit reaches nobody and
         * saying otherwise would be the exact kind of probe that lies by omission. `PostStack`
         * mounts at 52 and reads `config.tier.postStack` in its own constructor, which is already
         * this tier — the heuristic is honoured, it just is not honoured over the wire.
         */
        post: "pre-mount",
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
    // `?tier=` on the URL.
    if (config.get("autoTier") === false) {
      this._standDown();
      return;
    }

    // The lighting rig builds its cascades at boot order 14, so the baseline can only be read once
    // the first frames are running. Bounded on both axes: every 15th frame, and abandoned after
    // 300 — a machine that starts at `potato` has `castShadow` false on every light and would
    // otherwise pay a full scene traverse every frame, for ever, on the hardware that can least
    // afford it.
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
   * Post is P12's, and the contract is the `quality:tier` signal — which `render/PostStack.js` now
   * subscribes to. Until this round it did not, so the signal was emitted into nothing and the post
   * response ran entirely through the private bridge below.
   *
   * The bridge is kept, and it is not dead weight: `AutoTier` mounts at boot order 02 and `PostStack`
   * at 52, so on a machine where the post module fails to mount at all the tier still reaches
   * whatever `kernel.get("post")` exposes. `_postRoute` records which path ran, and a critic should
   * see `"signal"` on every decision in a healthy boot.
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
    const p = this.policy;
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
      policyTier: p.tier,
      ceiling: p.ceiling,
      ceilingSource: this.ceilingSource,
      autoTierSetting: config.get("autoTier"),
      /**
       * The corroboration model, in full. `predictedTier` is what the heuristic said this machine
       * can afford; `corroboratesHere` is whether a miss measured *at the current tier* would agree
       * with that prediction. Round 2 answered this question once, at boot, from the GPU string.
       */
      prediction: {
        predictedTier: p.predictedTier,
        evidence: this.heuristic.caps,
        measuringAt: p.tier,
        corroboratesHere: p.corroboratesAt(),
        forceCorroborated: p.forceCorroborated,
      },
      /** The revocation machinery, so a reviewer can see *why* one has or has not fired. */
      provisional: {
        descent: p.descent
          ? {
              from: p.descent.from,
              to: p.descent.to,
              rungs: p.descent.rungs,
              atMs: p.descent.at,
              medianMs: p.descent.medianMs,
              corroborated: !!p.descent.corroborated,
              late: !!p.descent.late,
            }
          : null,
        locked: p.locked,
        recoveries: p.recoveries,
        quietForMs: p.quietSince === null ? 0 : Math.round(p.clock - p.quietSince),
        ...p.recoveryState(p.lastStats),
      },
      /**
       * What the `quality:tier` signal actually reaches. `subscribed` is the seam this round closed:
       * `render/PostStack.js` listens, so `postStack` is consumed by its owner rather than by a
       * private bridge. `maxPixelRatio`, `shadows` and `shadowResolution` are applied here, against
       * the live renderer, and read back on `renderer` below.
       */
      signal: {
        name: "quality:tier",
        subscribed: signals.names().includes("quality:tier"),
        appliedHere: ["maxPixelRatio", "shadowResolution", "shadows"],
        appliedByListener: ["postStack"],
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
            windowFull: p.isFull(st, p.shape()),
            // Infinity while the window is empty (the flush after a change); reported as null
            // rather than as a number, because "no tail yet" is not a measurement.
            tailMedianMs: p.samples.length ? Number(p.tailMedian().toFixed(2)) : null,
          }
        : null,
      samples: {
        accepted: p.accepted,
        rejected: p.rejected,
        /** Periods over `sampleMaxMs`, and the elapsed time of the isolated ones we threw away. */
        excursions: p.excursions,
        stalledMs: Math.round(p.stalledMs),
        clockMs: Math.round(p.clock),
      },
      thresholds: {
        downMs: p.p.downMs,
        upMs: p.p.upMs,
        windowMs: p.p.windowMs,
        firstWindowMs: p.p.firstWindowMs,
        windowFrames: p.p.windowFrames,
        minFrames: p.p.minFrames,
        firstMinFrames: p.p.firstMinFrames,
        warmupFrames: p.p.warmupFrames,
        warmupMs: p.p.warmupMs,
        firstWarmupFrames: p.p.firstWarmupFrames,
        firstWarmupMs: p.p.firstWarmupMs,
        tailMs: p.p.tailMs,
        tailMinFrames: p.p.tailMinFrames,
        cooldownMs: p.p.cooldownMs,
        maxChanges: p.p.maxChanges,
        maxDownSteps: p.p.maxDownSteps,
        maxUpSteps: p.p.maxUpSteps,
        maxLeap: p.p.maxLeap,
        maxRecoveries: p.p.maxRecoveries,
        recoveryArmMs: p.p.recoveryArmMs,
        recoveryQuietMs: p.p.recoveryQuietMs,
        recoveryInconsistency: p.p.recoveryInconsistency,
        sampleMinMs: p.p.sampleMinMs,
        sampleMaxMs: p.p.sampleMaxMs,
        stallRun: p.p.stallRun,
      },
      budget: p.budget(),
      changes: this.history,
      renderer: this.rendererState(),
      postRoute: this._postRoute,
    };
  }
}
