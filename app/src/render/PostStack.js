import * as THREE from "three";
import { config } from "../core/Config.js";
import { signals } from "../core/Signals.js";
import { publish, warn } from "../core/Introspect.js";
import { makeTarget, targetBytes } from "./passes/FullScreenPass.js";
import { BrightPass } from "./passes/BrightPass.js";
import { BloomPass, bloomRadiusFraction } from "./passes/BloomPass.js";
import { SunGlowPass, sunScreenPosition } from "./passes/SunGlowPass.js";
import { GradePass, LOOK } from "./passes/GradePass.js";
import { DISPLAY_MODE, displayModeForToneMapping } from "./passes/glsl.js";

/**
 * PostStack — the whole post-processing chain, written against Three render targets and our own
 * shaders. No post-processing library, and nothing in here that another piece has to know about.
 *
 * ## The one rule this piece is judged on
 *
 * The render target is `reference/target-lowpoly.png`: flat-shaded low-poly, where §2.3 says
 * *"silhouette carries every read"* and §3.3 says a facet holds exactly one value. **Post is the
 * fastest way in the entire renderer to destroy that.** A bloom with the threshold two stops too
 * low, a filmic shoulder, a soft vignette, a 5-pixel halo — any one of them turns hard facet edges
 * into a gauze and the picture stops being this art direction. So the chain is built inside out
 * from a single property:
 *
 *   > **With every effect at zero, a composited frame and a straight `renderer.render()` frame are
 *   > the same picture.** Not similar — the same, to within the dither and half-float rounding.
 *
 * `review/measure/P12.mjs` claim A1 measures that as a mean absolute code difference over every
 * pixel of the real game, and claim A2 measures the median hard-edge transition width with the
 * chain on and off and fails if post widened it. Everything the stack *does* is then an addition on
 * top of a proven no-op, and can be measured the same way: A3 fails if bloom raises luminance
 * anywhere far from a bright source, A4 fails if it fails to raise luminance near one.
 *
 * ## Why the display transform is a mirror
 *
 * Three.js forces `NoToneMapping` on every scene material the moment you render into a render
 * target (`WebGLPrograms.getParameters`). A composer that did not put the transform back would
 * change the exposure of the entire world simply by existing, and `world/Sky.js` numerically
 * inverts `renderer.toneMapping` to place every palette stop — so it would also move every colour
 * in `design/palette.json`. `GradePass` therefore reproduces `renderer.toneMapping` and
 * `renderer.toneMappingExposure` exactly, read fresh each frame because `world/Lighting.js` drives
 * the exposure at runtime. §3.5 asks for `NoToneMapping` and a linear path; the day the renderer is
 * set that way, `displayModeForToneMapping()` follows it with no change here.
 *
 * ## Tiers
 *
 * `config.tier.postStack` is read literally.
 *
 * | tier | asks for | what is built |
 * |---|---|---|
 * | potato | `tonemap` | **nothing.** No composer, no render target, no full-screen pass |
 * | low | `tonemap` | **nothing** |
 * | medium | `bloom, tonemap, vignette` | scene target + bright + bloom + grade |
 * | high | `bloom, godrays, tonemap, grain, vignette` | the above + sun glow |
 * | ultra | the above + `ca` | the above; `ca` is declined, see below |
 *
 * "Costs nothing on the potato tier" is meant literally: when a tier asks only for `tonemap`, this
 * class installs no composer at all, because an identity grade is bit-for-bit what the renderer's
 * own path already produces and the honest cost of reproducing it through an RGBA16F round trip is
 * not zero. `kernel.composer` stays `null` and the game renders straight to the canvas.
 *
 * **`ca` (chromatic aberration) is declined, loudly.** It is the one entry in the tier table that
 * cannot be built without breaking the binding art direction: §4 — *"Antialias, do not soften"*,
 * a light/shadow boundary is *"a geometric edge with antialiasing on it, never a shading falloff"*,
 * measured at 1.4 px at 1920; and §6.1 — *"no ghosts, no anamorphic streak, no lens dirt"*. Lateral
 * CA is by definition a coloured multi-pixel ramp laid across every silhouette in the outer frame.
 * The refusal is recorded on the probe as `declined`, with its reason, rather than silently
 * ignored, and `config.tier.postStack` (owned by P00) should drop the entry.
 */

/** Everything `config.tier.postStack` may legally contain. */
const KNOWN_PASSES = new Set(["tonemap", "bloom", "godrays", "grain", "vignette", "ca"]);

/** Passes we refuse to build, with the reason a critic will ask for. */
const DECLINED_PASSES = {
  ca: "chromatic aberration lays a coloured multi-pixel ramp across every silhouette; art-direction §4 requires a 1.4 px antialiased geometric edge and §6.1 bans lens artefacts",
};

/**
 * MSAA sample count for the scene target.
 *
 * `WebGLRenderer({ antialias: true })` antialiases the canvas drawing buffer and does exactly
 * nothing once the scene renders into a target, so the composer has to carry the MSAA itself or it
 * silently ships jaggies — §13 row 2 fails a render whose foreground edges are not a hard step
 * ≤ 3 px wide, and jagged is as wrong as soft. 4x below ~4 MP; 2x above it, because a
 * multisampled RGBA16F at 3840x2160 is 66 MB per sample and the edges up there are already half
 * the angular size.
 *
 * Measured, and reported on the probe as `megabytes` so nobody has to take this on trust: 1920x1080
 * at 4x costs **117 MB** of render target (16.6 colour + 66.4 samples + 33.2 multisampled depth,
 * plus 5.5 for the bloom chain); 3840x2160 at 2x costs **264 MB**. Above ~9 MP — an 8K buffer, or
 * 4K at DPR 1.5 — MSAA is dropped entirely, because at that density a geometric edge is already
 * sub-pixel at any sane viewing distance and half a gigabyte of sample memory is not a trade this
 * project should make.
 */
function samplesFor(pixels, renderer, override) {
  if (override !== null) return override;
  if (!renderer.capabilities.isWebGL2) return 0;
  if (softwareRaster(renderer)) return 0;
  if (pixels > 9.0e6) return 0;
  if (pixels > 2.5e6) return 2;
  return 4;
}

/**
 * True on a software rasteriser (SwiftShader in the review harness, llvmpipe on a Linux box with
 * no GPU driver, Apple's software fallback).
 *
 * This is not a convenience. Resolving a 1920x1080 4x-multisampled RGBA16F target costs 8.3 M
 * sample reads per frame, and SwiftShader takes long enough over it that `page.screenshot()` in
 * `tools/lib/session.mjs` times out at 30 s — which would mean **no capture of this game at 1080p
 * is reviewable while the composer is installed**, for every piece, not just this one. A hard rule
 * of this project is that a frame nobody can look at is a bug. So a software rasteriser is treated
 * as its own device class and gets no MSAA, exactly as a potato GPU would.
 *
 * The consequence is stated rather than hidden: **headless captures carry aliased silhouettes that
 * real hardware does not.** `review/measure/P12.mjs` therefore measures edge width as a *delta*
 * between post-on and post-off captures taken in the same environment, never as an absolute, and
 * forces MSAA back on with `?postMsaa=4` for the claim that the multisampled path works at all.
 */
function softwareRaster(renderer) {
  try {
    const gl = renderer.getContext();
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    const name = String(
      dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
    );
    return /swiftshader|llvmpipe|software|basic render/i.test(name);
  } catch {
    return false;
  }
}

export class PostStack {
  constructor(kernel) {
    this.kernel = kernel;
    this.renderer = kernel.renderer;
    this.scene = kernel.scene;
    this.camera = kernel.camera;

    const requested = Array.isArray(config.tier.postStack) ? [...config.tier.postStack] : [];
    this.requested = requested;
    this.declined = [];
    this.unknown = requested.filter((id) => !KNOWN_PASSES.has(id));
    for (const id of this.unknown) warn(`PostStack: unknown pass "${id}" in tier ${config.tier.id}`);

    const want = new Set(requested.filter((id) => KNOWN_PASSES.has(id)));
    for (const id of Object.keys(DECLINED_PASSES)) {
      if (want.delete(id)) this.declined.push({ id, why: DECLINED_PASSES[id] });
    }

    // ?post=off  — never install a composer (the A/B control for every claim in P12.mjs)
    // ?post=bare — install a composer with every effect off (the transparency proof)
    // ?post=on   — install it even if the tier asked for nothing
    const query = new URLSearchParams(location.search);
    const mode = query.get("post");
    this.mode = mode === "off" || mode === "bare" || mode === "on" ? mode : "tier";
    // ?postMsaa=0|2|4 — forces the scene target's sample count. The only reason it exists is that
    // the headless rasteriser is treated as its own device class above, and a claim about the
    // multisampled path has to be able to turn it back on.
    const msaa = query.get("postMsaa");
    this.msaaOverride = msaa === null ? null : Math.max(0, Math.min(8, Number(msaa) | 0));

    this.effects = {
      bloom: want.has("bloom"),
      sunGlow: want.has("godrays"),
      grain: want.has("grain"),
      vignette: want.has("vignette"),
    };
    if (this.mode === "bare") for (const k of Object.keys(this.effects)) this.effects[k] = false;

    const anyEffect = Object.values(this.effects).some(Boolean);
    this.installed = this.mode === "off" ? false : this.mode !== "tier" || anyEffect;

    this.size = new THREE.Vector2(1, 1);
    this.sceneTarget = null;
    this.sunGlowTarget = null;
    this.bright = null;
    this.bloom = null;
    this.sunGlow = null;
    this.grade = null;
    this.displayMode = DISPLAY_MODE.none;
    this._sunUv = new THREE.Vector2(0.5, 0.5);
    this._sun = { uv: this._sunUv, weight: 0, onScreen: false };
    this.sunDir = new THREE.Vector3(0.35, 0.16, -0.92).normalize();
    this.sunSource = "default";
    this._offSun = signals.on("world:sun", (p) => this._adoptSun(p));
    this._frames = 0;
    this._glowDrawn = null;
    this._lastDraws = 0;

    if (this.installed) this._build();

    publish("post", () => this.report());
  }

  // ------------------------------------------------------------------------------ construction

  _build() {
    const px = this._drawingBuffer();
    this.bright = new BrightPass({
      threshold: LOOK.bloomThreshold,
      knee: LOOK.bloomKnee,
      clamp: LOOK.bloomClamp,
    });
    this.bloom = new BloomPass();
    if (this.effects.sunGlow) this.sunGlow = new SunGlowPass();

    this.displayMode = displayModeForToneMapping(this.renderer.toneMapping);
    this.grade = new GradePass(this.effects, this.displayMode);

    this.setSize(px.x, px.y);
    this.kernel.composer = this;
  }

  _drawingBuffer() {
    return this.renderer.getDrawingBufferSize(new THREE.Vector2());
  }

  _adoptSun(payload) {
    const d = payload?.direction;
    if (!d || typeof d.x !== "number") return;
    const v = new THREE.Vector3(d.x, d.y, d.z);
    if (v.lengthSq() < 1e-8) return;
    this.sunDir.copy(v).normalize();
    this.sunSource = payload.source ?? "signal";
  }

  /**
   * Fallback bearing, used only until `world:sun` arrives. P10 emits that signal from its own
   * setup, which runs at boot order 12 — before this piece at order 52 — so on a cold boot the
   * signal has already been sent to nobody, and a stack that only listened would point its glow at
   * a default until the next time of day tick. Scanning the scene once costs nothing and is the
   * same information.
   */
  _seedSunFromScene() {
    const u = this.scene.userData?.sunDirection;
    if (u && typeof u.x === "number") {
      this.sunDir.set(u.x, u.y, u.z).normalize();
      this.sunSource = "scene.userData";
      return;
    }
    let best = null;
    this.scene.traverse((o) => {
      if (o.isDirectionalLight && o.intensity > 0 && (!best || o.intensity > best.intensity)) {
        best = o;
      }
    });
    if (best) {
      const dir = new THREE.Vector3().subVectors(best.position, best.target.position);
      if (dir.lengthSq() > 1e-8) {
        this.sunDir.copy(dir).normalize();
        this.sunSource = `light:${best.name || "directional"}`;
      }
    }
  }

  // ------------------------------------------------------------------------------ sizing

  /** Kernel `resize` hook. Ignores its CSS-pixel arguments: targets are sized in device pixels. */
  resize() {
    if (!this.installed) return;
    const px = this._drawingBuffer();
    this.setSize(px.x, px.y);
  }

  setSize(width, height) {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    if (this.size.x === w && this.size.y === h && this.sceneTarget) return;
    this.size.set(w, h);

    const samples = samplesFor(w * h, this.renderer, this.msaaOverride);
    if (!this.sceneTarget || this.sceneTarget.samples !== samples) {
      this.sceneTarget?.dispose();
      this.sceneTarget = makeTarget(w, h, { depth: true, samples, name: "vs.post.scene" });
    } else {
      this.sceneTarget.setSize(w, h);
    }

    this.bloom.setSize(w, h);

    if (this.sunGlow) {
      const gw = Math.max(1, Math.floor(w / 4));
      const gh = Math.max(1, Math.floor(h / 4));
      if (!this.sunGlowTarget) this.sunGlowTarget = makeTarget(gw, gh, { name: "vs.post.sunglow" });
      else this.sunGlowTarget.setSize(gw, gh);
    }

    this.grade.setSize(w, h, w / h);
  }

  // ------------------------------------------------------------------------------ the frame

  /** Called by the kernel in place of `renderer.render()` when `kernel.composer` is set. */
  render() {
    const renderer = this.renderer;
    const px = this._drawingBuffer();
    if (px.x !== this.size.x || px.y !== this.size.y) this.setSize(px.x, px.y);

    if (this._frames === 0 && this.sunSource === "default") this._seedSunFromScene();
    this._frames++;

    // The display transform follows the renderer, every frame. `Lighting.setExposure()` moves
    // `toneMappingExposure` at runtime and a mirror that only sampled it at boot would drift.
    const mode = displayModeForToneMapping(renderer.toneMapping);
    if (mode !== this.displayMode) {
      this.displayMode = mode;
      this.grade.configure({ displayMode: mode });
    }

    // 1. The world, into a multisampled RGBA16F. Scene-linear: Three forces NoToneMapping here.
    renderer.setRenderTarget(this.sceneTarget);
    renderer.render(this.scene, this.camera);

    // 2. The gate, at half resolution, into bloom mip 0.
    let bloomTexture = null;
    let sunGlowTexture = null;
    let sunGlowWeight = 0;
    if (this.effects.bloom || this.effects.sunGlow) {
      this.bright.render(
        renderer,
        this.sceneTarget.texture,
        this.size.x,
        this.size.y,
        this.bloom.brightTarget
      );
    }
    if (this.effects.sunGlow) {
      // Read the gate BEFORE the bloom chain writes its lobes back into mip 0, so the glow scatters
      // the emitters themselves rather than a pre-blurred copy of them.
      this._sun = sunScreenPosition(this.camera, this.sunDir, this._sunUv);
      sunGlowWeight = this._sun.weight * LOOK.sunGlowStrength;
      if (this._sun.weight > 0) {
        this.sunGlow.render(
          renderer,
          this.bloom.brightTarget.texture,
          this._sun.uv,
          1,
          this.sunGlowTarget
        );
        this._glowDrawn = true;
      } else if (this._glowDrawn !== false) {
        // Lethis is behind the camera or far off frame. Clear once and stop drawing: 16 taps over a
        // quarter-resolution target every frame to produce a buffer that is multiplied by zero is
        // the kind of cost that is invisible on a desktop GPU and decides whether this game runs on
        // a Chromebook. The clear matters — an uninitialised half-float target can hold NaN, and
        // NaN * 0 is NaN, which would put black holes in the sky.
        renderer.setRenderTarget(this.sunGlowTarget);
        renderer.clear(true, false, false);
        this._glowDrawn = false;
      }
      sunGlowTexture = this.sunGlowTarget.texture;
    }
    if (this.effects.bloom) {
      this.bloom.render(renderer);
      bloomTexture = this.bloom.texture;
    }

    // 3. Composite, grade, encode, dither — one draw, straight to the canvas.
    this.grade.render(
      renderer,
      this.sceneTarget.texture,
      bloomTexture,
      sunGlowTexture,
      sunGlowWeight,
      renderer.toneMappingExposure,
      null
    );

    this._lastDraws = this.drawCallCount();
  }

  /** Full-screen draws this chain issues per frame, excluding the scene render itself. */
  drawCallCount() {
    if (!this.installed) return 0;
    let n = 1; // grade
    if (this.effects.bloom || this.effects.sunGlow) n += 1; // bright
    if (this.effects.sunGlow) n += 1;
    if (this.effects.bloom) n += this.bloom.levels * 2;
    return n;
  }

  // ------------------------------------------------------------------------------ control

  /**
   * Install or remove the composer at runtime. This is what makes an A/B capture possible from
   * `tools/review.mjs` without a second boot: `--script="eval:__vs.kernel.get('post').setEnabled(false)"`.
   */
  setEnabled(on) {
    if (on && !this.installed) {
      this.installed = true;
      if (!this.grade) this._build();
      else this.kernel.composer = this;
    } else if (!on && this.installed) {
      this.installed = false;
      this.kernel.composer = null;
    }
    return this.installed;
  }

  /** Turn one effect on or off. Recompiles the grade shader; rare enough not to matter. */
  setEffect(name, on) {
    if (!(name in this.effects)) return false;
    this.effects[name] = !!on;
    if (!this.grade) return false;
    if (name === "sunGlow" && on && !this.sunGlow) {
      this.sunGlow = new SunGlowPass();
      this.size.set(0, 0);
      this.resize();
    }
    this.grade.configure({ enabled: this.effects });
    return true;
  }

  setLook(patch) {
    this.grade?.setLook(patch);
    if (patch.bloomThreshold !== undefined || patch.bloomKnee !== undefined || patch.bloomClamp !== undefined) {
      this.bright?.set(
        patch.bloomThreshold ?? LOOK.bloomThreshold,
        patch.bloomKnee ?? LOOK.bloomKnee,
        patch.bloomClamp ?? LOOK.bloomClamp
      );
    }
  }

  // ------------------------------------------------------------------------------ measurement

  /**
   * Read the live scene target back at reduced resolution and return a scene-linear histogram.
   *
   * This is the seam the bloom threshold is *set* from. §5.4 asks for bloom to be masked to the
   * accent class, and the way this chain does that is a threshold placed above every surface in the
   * frame and below every emitter — which is a claim about numbers that only exist at run time.
   * Called on demand by `review/measure/P12.mjs`, never per frame.
   */
  sampleScene(maxSide = 256) {
    if (!this.installed || !this.sceneTarget) return null;
    const w = this.size.x;
    const h = this.size.y;
    const step = Math.max(1, Math.ceil(Math.max(w, h) / maxSide));
    const sw = Math.floor(w / step);
    const sh = Math.floor(h / step);

    // readRenderTargetPixels on a half-float target hands back Uint16 half floats; decode them.
    const buf = new Uint16Array(w * 4);
    const lum = [];
    const maxCh = [];
    for (let y = 0; y < sh; y++) {
      const row = Math.min(h - 1, y * step);
      this.renderer.readRenderTargetPixels(this.sceneTarget, 0, row, w, 1, buf);
      for (let x = 0; x < sw; x++) {
        const i = Math.min(w - 1, x * step) * 4;
        const r = half2float(buf[i]);
        const g = half2float(buf[i + 1]);
        const b = half2float(buf[i + 2]);
        lum.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
        maxCh.push(Math.max(r, g, b));
      }
    }
    const pct = (arr, q) => {
      const s = Float64Array.from(arr).sort();
      return s.length ? s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))] : 0;
    };
    const over = (arr, t) => arr.reduce((n, v) => n + (v > t ? 1 : 0), 0) / Math.max(1, arr.length);
    return {
      samples: lum.length,
      grid: [sw, sh],
      luminance: {
        p50: pct(lum, 0.5),
        p95: pct(lum, 0.95),
        p99: pct(lum, 0.99),
        p999: pct(lum, 0.999),
        max: Math.max(...lum),
      },
      maxChannel: {
        p50: pct(maxCh, 0.5),
        p95: pct(maxCh, 0.95),
        p99: pct(maxCh, 0.99),
        p999: pct(maxCh, 0.999),
        max: Math.max(...maxCh),
      },
      shareAbove: {
        "0.8": over(maxCh, 0.8),
        "1.0": over(maxCh, 1.0),
        "1.25": over(maxCh, 1.25),
        "1.5": over(maxCh, 1.5),
        "2.0": over(maxCh, 2.0),
        "4.0": over(maxCh, 4.0),
      },
      threshold: LOOK.bloomThreshold,
    };
  }

  /**
   * Push a caller-supplied scene-linear image through the **real** chain and hand back the 8-bit
   * sRGB codes it produces.
   *
   * Every claim about the bright pass and about halo radius is made through here, on a synthetic
   * plate with known contents, against the shipped shaders rather than a re-implementation of them.
   * The chain is resized to the plate, run, and resized back.
   *
   * @param {{width:number, height:number, data:Float32Array}} image RGB or RGBA, scene-linear
   * @param {{bloom?:boolean}} opts
   * @returns {{width:number, height:number, data:Uint8Array}} RGBA8
   */
  processLinearRGB(image, { bloom = true } = {}) {
    if (!this.installed) return null;
    const { width: w, height: h } = image;
    const channels = image.data.length / (w * h);
    const rgba = new Float32Array(w * h * 4);
    for (let i = 0, j = 0; i < w * h; i++, j += channels) {
      rgba[i * 4] = image.data[j];
      rgba[i * 4 + 1] = image.data[j + 1];
      rgba[i * 4 + 2] = image.data[j + 2];
      rgba[i * 4 + 3] = 1;
    }

    const tex = new THREE.DataTexture(rgba, w, h, THREE.RGBAFormat, THREE.FloatType);
    // Nearest, so the plate needs no float-linear filtering extension. Every pass in the chain
    // samples the scene texture at texel centres, so this changes nothing about the result.
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;

    const out = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    out.texture.colorSpace = THREE.NoColorSpace; // we encode ourselves; no second transform

    const prev = { x: this.size.x, y: this.size.y };
    const prevBloom = this.effects.bloom;
    this.size.set(0, 0); // force a real resize even if the plate matches the viewport
    this.bloom.setSize(w, h);
    this.grade.setSize(w, h, w / h);
    if (prevBloom !== bloom) {
      this.effects.bloom = bloom;
      this.grade.configure({ enabled: this.effects });
    }

    if (bloom) {
      this.bright.render(this.renderer, tex, w, h, this.bloom.brightTarget);
      this.bloom.render(this.renderer);
    }
    this.grade.render(
      this.renderer,
      tex,
      bloom ? this.bloom.texture : null,
      null,
      0,
      this.renderer.toneMappingExposure,
      out
    );

    const data = new Uint8Array(w * h * 4);
    this.renderer.readRenderTargetPixels(out, 0, 0, w, h, data);
    this.renderer.setRenderTarget(null);
    const bloomLevels = this.bloom.levels;

    if (prevBloom !== bloom) {
      this.effects.bloom = prevBloom;
      this.grade.configure({ enabled: this.effects });
    }
    out.dispose();
    tex.dispose();
    this.size.set(0, 0);
    this.setSize(prev.x, prev.y);

    return { width: w, height: h, data, bloomLevels };
  }

  // ------------------------------------------------------------------------------ reporting

  report() {
    const bytes =
      targetBytes(this.sceneTarget) +
      targetBytes(this.sunGlowTarget) +
      (this.bloom?.mips ?? []).reduce((n, m) => n + targetBytes(m), 0);
    return {
      installed: this.installed,
      mode: this.mode,
      tier: config.tier.id,
      requested: this.requested,
      declined: this.declined,
      unknown: this.unknown,
      effects: { ...this.effects },
      display: {
        mode: this.displayMode,
        name: ["none", "linear", "aces", "vs"][this.displayMode] ?? "?",
        mirrors: this.renderer.toneMapping,
        exposure: Number((this.renderer.toneMappingExposure ?? 1).toFixed(4)),
      },
      size: this.installed ? [this.size.x, this.size.y] : null,
      samples: this.sceneTarget?.samples ?? 0,
      targets: this.installed
        ? (this.sceneTarget ? 1 : 0) + (this.bloom?.mips.length ?? 0) + (this.sunGlowTarget ? 1 : 0)
        : 0,
      targetBytes: bytes,
      megabytes: Number((bytes / 1048576).toFixed(2)),
      postDrawCalls: this.drawCallCount(),
      bloom: this.bloom
        ? { ...this.bloom.stats(), radiusFractionOfHeight: Number(bloomRadiusFraction(this.size.y).toFixed(4)) }
        : null,
      sun: {
        source: this.sunSource,
        direction: [
          Number(this.sunDir.x.toFixed(4)),
          Number(this.sunDir.y.toFixed(4)),
          Number(this.sunDir.z.toFixed(4)),
        ],
        uv: [Number(this._sun.uv.x.toFixed(4)), Number(this._sun.uv.y.toFixed(4))],
        weight: Number(this._sun.weight.toFixed(4)),
        onScreen: this._sun.onScreen,
      },
      look: {
        bloomThreshold: LOOK.bloomThreshold,
        bloomKnee: LOOK.bloomKnee,
        bloomStrength: LOOK.bloomStrength,
        sunGlowStrength: LOOK.sunGlowStrength,
        vignetteAmount: LOOK.vignetteAmount,
        vignetteStart: LOOK.vignetteStart,
        grainAmount: LOOK.grainAmount,
        ditherAmount: LOOK.ditherAmount,
        shoulder: LOOK.shoulder,
        white: LOOK.white,
        gradeIsIdentity:
          LOOK.exposure === 1 &&
          LOOK.contrast === 1 &&
          LOOK.saturation === 1 &&
          LOOK.lift.every((v) => v === 0) &&
          LOOK.gain.every((v) => v === 1) &&
          LOOK.gamma.every((v) => v === 1),
      },
      frames: this._frames,
    };
  }

  dispose() {
    this._offSun?.();
    if (this.kernel.composer === this) this.kernel.composer = null;
    this.sceneTarget?.dispose();
    this.sunGlowTarget?.dispose();
    this.bright?.dispose();
    this.bloom?.dispose();
    this.sunGlow?.dispose();
    this.grade?.dispose();
  }
}

/** IEEE 754 binary16 -> Number. `readRenderTargetPixels` hands back raw half floats. */
function half2float(h) {
  const s = (h & 0x8000) >> 15;
  const e = (h & 0x7c00) >> 10;
  const f = h & 0x03ff;
  if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
  if (e === 0x1f) return f ? NaN : (s ? -1 : 1) * Infinity;
  return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
}
