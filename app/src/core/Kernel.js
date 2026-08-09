import * as THREE from "three";
import { signals } from "./Signals.js";
import { config } from "./Config.js";

export const SIM_HZ = 60;
export const SIM_STEP = 1 / SIM_HZ;

/**
 * Kernel — renderer ownership plus a fixed-step simulation clock.
 *
 * Two properties matter more than anything else here:
 *
 *  1. **Fixed-step simulation.** Movement, physics and every timing-sensitive game feel
 *     value run at exactly 60 Hz regardless of render rate, with the leftover time carried
 *     in an accumulator. A 30 fps machine and a 144 fps machine therefore produce the same
 *     jump arc, the same acceleration curve and the same coyote window. Variable-dt physics
 *     is the single most common reason a browser game feels "floaty" on some machines.
 *
 *  2. **Drivable from outside.** Automated reviewers must be able to advance the world by an
 *     exact amount of game time and then look at the result. `kernel.advance(seconds)` runs
 *     the precise number of simulation steps and renders once. Headless software GL runs at a
 *     handful of frames per second, so anything that measured game time in wall-clock would
 *     report movement, animation and timers as far slower than they really are — a
 *     measurement artefact that reads exactly like a physics bug.
 *
 * Systems are plain objects registered with `mount()`. Recognised hooks:
 *   `fixed(step, simTime)`  — deterministic simulation, called 0..n times per frame
 *   `frame(dt, alpha)`      — per-render work (visual smoothing, UI); `alpha` is the
 *                             interpolation factor between the last two sim states
 *   `after(dt)`             — runs once all `frame` hooks are done (cameras, culling)
 *   `resize(w, h)` / `dispose()`
 */
export class Kernel {
  constructor(canvas) {
    this.canvas = canvas;
    this.signals = signals;
    this.config = config;

    this.systems = [];
    this.byName = new Map();

    this.simTime = 0;
    this.renderTime = 0;
    this.frameCount = 0;
    this.stepCount = 0;
    this.timeScale = 1;
    this.paused = false;
    this.mode = "idle"; // idle | realtime | manual

    this._accumulator = 0;
    this._lastWallClock = 0;
    this._fpsWindow = [];
    this.fps = 0;
    this.frameMs = 0;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      stencil: false,
      depth: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false,
    });
    this.renderer.setPixelRatio(config.pixelRatio());
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = config.tier.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = true;
    this.renderer.info.autoReset = false;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      config.get("fovBase"),
      1,
      0.08,
      config.tier.drawDistance
    );
    this.camera.position.set(0, 4, 12);

    /** Set by the post-processing system; when present it renders instead of the raw renderer. */
    this.composer = null;

    this._resize = this.resize.bind(this);
    addEventListener("resize", this._resize);
    if (window.visualViewport) visualViewport.addEventListener("resize", this._resize);
    this.resize();
  }

  mount(name, system) {
    if (this.byName.has(name)) throw new Error(`system "${name}" already mounted`);
    system.__name = name;
    this.systems.push(system);
    this.byName.set(name, system);
    if (system.root instanceof THREE.Object3D) this.scene.add(system.root);
    system.kernel = this;
    return system;
  }

  get(name) {
    return this.byName.get(name);
  }

  resize() {
    const w = Math.max(1, innerWidth);
    const h = Math.max(1, innerHeight);
    this.renderer.setPixelRatio(config.pixelRatio());
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    for (const s of this.systems) s.resize?.(w, h);
    signals.emit("kernel:resize", { width: w, height: h });
  }

  // ---------------------------------------------------------------- loop modes

  run() {
    if (this.mode === "realtime") return;
    this.mode = "realtime";
    this._lastWallClock = performance.now();
    this.renderer.setAnimationLoop((now) => this._realtimeFrame(now));
  }

  halt() {
    this.mode = "idle";
    this.renderer.setAnimationLoop(null);
  }

  _realtimeFrame(now) {
    const wall = (now - this._lastWallClock) / 1000;
    this._lastWallClock = now;
    // A long stall (tab switch, GC, breakpoint) must not be replayed as a burst of
    // simulation: clamp to a quarter second and let the world skip the missing time.
    const dt = Math.min(Math.max(wall, 0), 0.25);

    this._fpsWindow.push(wall);
    if (this._fpsWindow.length > 90) this._fpsWindow.shift();
    const mean = this._fpsWindow.reduce((a, b) => a + b, 0) / this._fpsWindow.length;
    this.fps = mean > 0 ? 1 / mean : 0;
    this.frameMs = mean * 1000;

    this._step(dt);
  }

  /**
   * Advance an exact amount of *game* time and render once. Deterministic: same input,
   * same result, on any machine at any render rate. This is what the review harness calls.
   */
  advance(seconds, { render = true } = {}) {
    const clamped = Math.max(0, Math.min(seconds, 60));
    this._step(clamped, { render });
    return { simTime: this.simTime, steps: this.stepCount };
  }

  _step(dt, { render = true } = {}) {
    const scaled = this.paused ? 0 : dt * this.timeScale;

    this._accumulator += scaled;
    // Cap the catch-up burst so a hitch can never spiral into a freeze.
    let budget = 8;
    while (this._accumulator >= SIM_STEP && budget-- > 0) {
      this._accumulator -= SIM_STEP;
      this.simTime += SIM_STEP;
      this.stepCount++;
      for (const s of this.systems) s.fixed?.(SIM_STEP, this.simTime);
    }
    if (budget <= 0) this._accumulator = 0;

    const alpha = this._accumulator / SIM_STEP;
    this.renderTime += dt;
    for (const s of this.systems) s.frame?.(dt, alpha);
    for (const s of this.systems) s.after?.(dt, alpha);

    if (render) {
      this.renderer.info.reset();
      if (this.composer) this.composer.render(dt);
      else this.renderer.render(this.scene, this.camera);
      this.frameCount++;
    }
    signals.emit("kernel:frame", { dt, alpha, simTime: this.simTime });
  }

  stats() {
    const r = this.renderer.info;
    return {
      fps: Math.round(this.fps),
      frameMs: Number(this.frameMs.toFixed(2)),
      simTime: Number(this.simTime.toFixed(3)),
      frames: this.frameCount,
      steps: this.stepCount,
      drawCalls: r.render.calls,
      triangles: r.render.triangles,
      programs: r.programs?.length ?? 0,
      textures: r.memory.textures,
      geometries: r.memory.geometries,
      pixelRatio: this.renderer.getPixelRatio(),
      tier: config.tier.id,
    };
  }

  dispose() {
    this.halt();
    removeEventListener("resize", this._resize);
    for (const s of this.systems) s.dispose?.();
    this.renderer.dispose();
  }
}
