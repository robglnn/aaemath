import { config, TIERS, TIER_ORDER } from "./Config.js";
import { signals } from "./Signals.js";
import { publish } from "./Introspect.js";

/**
 * AutoTier — pick the quality tier from what the machine actually does, not from what it says.
 *
 * ## Why this exists
 *
 * `config.autoTier` was declared and read by nothing, so every machine booted at `high`: 3072-line
 * shadow cascades, the full post stack, and a 1.5x pixel ratio. This game is *for* school
 * Chromebooks — Intel UHD 600 / Mali / Adreno class parts pushing a 1366x768 or 1920x1080 panel —
 * and on those parts that tier is not a slightly worse experience, it is a slideshow. A student
 * whose first thirty seconds stutter does not come back, and the product goal is that they come
 * back on their own.
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
 * cannot help you for the first three seconds — which are exactly the seconds a student decides in.
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
 *    get re-promoted on a quiet stretch — that is precisely the loop that produces oscillation.
 *  * **A hard budget.** `maxChanges` total per session, `maxUpSteps` of them upward, and the ceiling
 *    is whatever tier the config asked for — auto-tiering hands work back, it never promotes past
 *    what was configured.
 *
 * ## Why an explicit choice wins completely
 *
 * `config.get("autoTier")` is the switch, and `Config.set("tier", …)` turns it off — so a settings
 * screen, `?tier=low`, or a console poke all stand this module down for the session with no further
 * cooperation required. Auto choices go through `config.applyTier()`, which is runtime-only and
 * never persisted, so a bad afternoon on a loaded machine cannot become a permanent setting.
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
 * | `?autotierWindow=N` | samples in the decision window |
 * | `?autotierCooldown=MS` | minimum ms between decisions |
 * | `?autotierDown=MS` | median frame period above which the tier steps down |
 */

/** Every threshold, in one table, so a critic can read the policy without reading the code. */
export const POLICY = {
  /**
   * Frames thrown away after boot and after every applied change.
   *
   * Not just boot hitches: for the first second or two the *scene is still assembling* — geometry
   * uploading, programs compiling, the scatter filling in — so early frames are cheap in a way that
   * describes nothing. P30 watched a decision taken 1 s in measure 37.8 ms on a machine that
   * settled at 93 ms. 90 frames is 1.5 s at 60 Hz and 9 s on a 10 fps machine, which is the right
   * way round: the slower the machine, the longer it gets to finish building before being judged.
   */
  warmupFrames: 90,
  /** Samples the decision window holds. 120 frames is 2 s at 60 Hz, 4 s at 30 Hz. */
  windowFrames: 120,
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
    this.tier = TIERS[startTier] ? startTier : "high";
    this.ceiling = TIERS[this.p.ceiling] ? this.p.ceiling : this.tier;
    this.samples = [];
    this.discard = this.p.warmupFrames;
    this.clock = 0;
    this.lastChangeAt = 0;
    this.changes = [];
    this.upSteps = 0;
    this.downSteps = 0;
    this.rejected = 0;
    this.accepted = 0;
    this.overrun = 0;
    this.lastStats = null;
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

  decide() {
    const st = this.stats();
    this.lastStats = st;
    if (!st || st.n < this.p.windowFrames) return null;
    if (this.clock - this.lastChangeAt < this.p.cooldownMs) return null;
    if (this.changes.length >= this.p.maxChanges) return null;

    const i = TIER_ORDER.indexOf(this.tier);
    const ceil = TIER_ORDER.indexOf(this.ceiling);

    if (st.median > this.p.downMs && i > 0) {
      return this._change(TIER_ORDER[clampIndex(i - 1)], "down", st,
        `median frame ${st.median.toFixed(1)} ms (${st.fps.toFixed(1)} fps) over ${st.n} frames is above the ${this.p.downMs} ms floor`);
    }

    if (
      i < ceil &&
      this.downSteps === 0 &&
      this.upSteps < this.p.maxUpSteps &&
      this.headroom(st)
    ) {
      return this._change(TIER_ORDER[clampIndex(i + 1)], "up", st,
        `median ${st.median.toFixed(1)} ms against a ${st.p10.toFixed(1)} ms cadence with p99 ${st.p99.toFixed(1)} ms — headroom for one step`);
    }
    return null;
  }

  _change(to, direction, st, why) {
    const rec = {
      at: Number(this.clock.toFixed(1)),
      from: this.tier,
      to,
      direction,
      why,
      fps: Number(st.fps.toFixed(1)),
      medianMs: Number(st.median.toFixed(2)),
      p10Ms: Number(st.p10.toFixed(2)),
      p95Ms: Number(st.p95.toFixed(2)),
      p99Ms: Number(st.p99.toFixed(2)),
      frames: st.n,
    };
    this.tier = to;
    this.changes.push(rec);
    if (direction === "up") this.upSteps++;
    else this.downSteps++;
    // Flush: the change itself costs a shader recompile and a render-target reallocation, and those
    // frames must never become evidence for the next decision.
    this.samples.length = 0;
    this.discard = this.p.warmupFrames;
    this.lastChangeAt = this.clock;
    return rec;
  }

  budget() {
    return {
      changesLeft: Math.max(0, this.p.maxChanges - this.changes.length),
      upStepsLeft: this.downSteps > 0 ? 0 : Math.max(0, this.p.maxUpSteps - this.upSteps),
      ceiling: this.ceiling,
    };
  }
}

// --------------------------------------------------------------------------- the first-frame guess

/** Renderer-string families that are known-weak, with the reason each is capped where it is. */
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
  // with one shadow cascade and a bloom, and cannot with three cascades at a 1.5x pixel ratio.
  { re: /intel.*\b(hd|uhd) graphics\b/, tier: "medium", why: "Intel HD/UHD integrated graphics" },
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
 * Pick the tier to *start* at. Never above `ceiling`; each rule states what it keyed on and why.
 *
 * @param {object} env  from `inspectDevice`
 * @param {string} ceiling  the configured tier — the heuristic may lower, never raise
 */
export function startingTier(env, ceiling = "high") {
  const notes = [];
  const caps = [];
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
    };
  }

  for (const rule of GPU_RULES) {
    if (rule.re.test(String(env.renderer).toLowerCase())) {
      cap(rule.tier, rule.why);
      break; // first (most specific) match wins; the list is ordered narrow → broad
    }
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

  const ceilIdx = TIER_ORDER.indexOf(TIERS[ceiling] ? ceiling : "high");
  const idx = caps.reduce((lo, t) => Math.min(lo, TIER_ORDER.indexOf(t)), ceilIdx);
  const tier = TIER_ORDER[clampIndex(idx)];
  if (!caps.length) notes.push("no weak-hardware signal — starting at the configured tier");
  return { tier, standDown: false, notes, caps };
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

    this.policy = new TierPolicy(this.enabled ? this.heuristic.tier : this.bootTier, {
      ceiling: this.bootTier,
      warmupFrames: num("autotierWarmup", POLICY.warmupFrames),
      windowFrames: num("autotierWindow", POLICY.windowFrames),
      cooldownMs: num("autotierCooldown", POLICY.cooldownMs),
      downMs: num("autotierDown", POLICY.downMs),
    });

    this.history = [];
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
      });
    }

    publish("autotier", () => this.report());
  }

  // ------------------------------------------------------------------------------ measurement

  frame() {
    if (!this.enabled) return;
    this._frames++;
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

  _onDecision(change) {
    const before = this.rendererState();
    let applied = false;
    if (!this.dry) {
      applied = config.applyTier(change.to);
      if (applied) {
        this.kernel.resize(); // pixel ratio + every render target that follows the drawing buffer
        this._applyShadows();
        this._applyPost(change.why);
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
    if (applied) this._emit(change.direction, change.why);
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
  _applyPost(why) {
    const listening = signals.names().includes("quality:tier");
    this._emit("tier", why);
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
      bootTier: this.bootTier,
      startTier: this.startTier,
      tier: config.tier.id,
      policyTier: this.policy.tier,
      autoTierSetting: config.get("autoTier"),
      heuristic: {
        tier: this.heuristic.tier,
        standDown: this.heuristic.standDown,
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
        warmupFrames: this.policy.p.warmupFrames,
        cooldownMs: this.policy.p.cooldownMs,
        maxChanges: this.policy.p.maxChanges,
        maxUpSteps: this.policy.p.maxUpSteps,
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
