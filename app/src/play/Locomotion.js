import * as THREE from "three";
import { signals } from "../core/Signals.js";
import { publish } from "../core/Introspect.js";
import { config } from "../core/Config.js";

/**
 * Locomotion — the character controller. Everything authoritative runs in `fixed(step)` at
 * exactly 60 Hz, so the acceleration curve, the jump arc, the coyote window and the buffer
 * window are the same on a 30 fps laptop and a 240 Hz monitor.
 *
 * The model, in the order it decides things each step:
 *
 *  **Heading before velocity.** The character owns a *heading* — a unit facing direction that
 *  rotates toward the stick at a rate that falls off with speed. Velocity is then decomposed
 *  into the component along that heading and the component across it; the along component
 *  accelerates, the across component is bled off by lateral grip. That single choice is what
 *  gives a turn a radius: at full sprint the heading can only sweep ~180°/s, so an 8.3 m/s
 *  runner carves a ~2.6 m arc instead of teleporting its velocity vector. Recomposing along the
 *  new heading is then renormalised against the band cap, because a turn that hands back more
 *  speed than you had is not a turn, it is a boost.
 *
 *  **Momentum has to cost something.** The brake is judged against the *velocity*, never the
 *  heading — at sprint the heading can only sweep three degrees per step, so a heading-based
 *  reversal test can never fire and the character would carve a free constant-speed 180° arc.
 *  Oppose your own travel by more than `brakeAngleDeg` and the feet plant instead: steering
 *  stops dead, speed is scraped off at `groundBrake · reverseBoost`, and the body keeps sliding
 *  the way it was going while you watch. Only once speed falls to `pivotSpeed` does the skid
 *  release, and the pivot out of it is taxed for `pivotTime` at `pivotAccel` of normal
 *  authority. Measured: a full reversal from 8.3 m/s takes 0.333 s and 1.15 m to get moving
 *  the other way, 1.08 m of which is overshoot in the direction you no longer wanted, and
 *  0.633 s to be back at full speed. That is the commitment, and it is the reason a sprint is
 *  a decision rather than a speed setting.
 *
 *  **Acceleration with a soft top.** `a = groundAccel · (1 + launchBoost·(1 − v/target))`. The
 *  first metre is eager and the last metre per second is lazy, which reads as mass leaving the
 *  blocks rather than a number being assigned to a variable.
 *
 *  **A jump you are committed to.** Rise gravity is lighter than fall gravity, releasing early
 *  scales the remaining rise, and a short hang near the apex softens gravity. In flight the
 *  velocity is split about the takeoff direction: the along component is fenced into
 *  `[airAlongKeep·takeoff, takeoff]` and the across component is capped, so you may choose
 *  *where* you land and you may bleed speed, but you can never add forward momentum you did not
 *  leave the ground with and you can never turn a sprint jump into a sprint the other way.
 *  Measured: a sprint jump into full reverse input still lands travelling forward at 4.56 m/s,
 *  and a standing jump reaches 1.33 m against a running jump's 5.81 m — which is what makes the
 *  run-up worth doing.
 *
 *  **A landing that costs something.** Touchdown speed becomes an impact value: squash, a brief
 *  authority loss, a bite out of horizontal speed, and `player:land {impact}` for the avatar,
 *  the camera and audio to spend.
 *
 * Intent arrives as `input:move {x,y}` and `input:action {action, phase}`. If P07 has not
 * mounted, a minimal keyboard fallback stands in so this piece is reviewable alone; it disables
 * itself permanently the moment a real input signal arrives.
 *
 * For whoever animates the body: `lean` and `push` are signed −1..1 body accelerations, taken
 * from the real velocity change each step and normalised by `leanReference`. +lean is
 * acceleration toward the body's right, +push is gaining speed along the heading. They are
 * fields, not signals, because they change every step and a signal per step is spam — read them
 * off `kernel.get("locomotion")` or out of the probe. The stand-in proxy already banks and
 * pitches off them, which is the only reason a 2.55 m carve and a skid are visible before P08
 * lands; that is presentation only and lives in `frame`.
 */

const DEG = Math.PI / 180;

/** Every number that decides how this game feels, in SI units. Tuned against measurement. */
export const LOCOMOTION_TUNING = {
  // body
  capsuleRadius: 0.36,
  capsuleHeight: 1.82,

  // top speeds
  walkSpeed: 2.4,
  runSpeed: 5.6,
  sprintSpeed: 8.3,

  // ground acceleration / braking
  groundAccel: 16,      // m/s² at the top of the speed band
  launchBoost: 0.9,     // extra acceleration fraction at a standstill
  groundBrake: 26,      // m/s² when the target drops below current speed
  reverseBoost: 1.6,    // multiplier while the heading opposes the velocity
  idleFriction: 23,     // m/s² with no stick at all
  lateralGrip: 12,      // 1/s exponential bleed of sideways velocity

  // The skid. This is the only thing in the file that takes something from you for free, so
  // every number here is load-bearing: the brake decelerates at groundBrake · reverseBoost =
  // 41.6 m/s², about twice what coasting gives you, and while it runs you have no steering at
  // all. `brakeAngleDeg` is deliberately past 90° so that a hard carve is still a carve.
  brakeAngleDeg: 110,      // stick must oppose travel by more than this to plant the feet
  brakeHoldDeg: 99,        // hysteresis: once planted, it takes less to stay planted
  pivotSpeed: 3.3,         // m/s at which the skid releases into a pivot (0.4 × sprint)
  pivotTime: 0.14,         // s of reduced push-off after a skid — the recovery
  pivotAccel: 0.4,         // acceleration multiplier during that recovery

  // Air. Authority is small and fenced: `airAccel` is barely a third of the ground figure, and
  // the fences below are measured about the takeoff direction, not about the world.
  airAccel: 9,             // m/s² of steering authority in flight
  airDrag: 0.05,           // 1/s — momentum is kept, not donated
  airAlongKeep: 0.55,      // fraction of takeoff momentum you can never bleed past
  airAlongFloor: 2.6,      // m/s of forward authority a standing jump or a long fall still has
  airLateralK: 0.55,       // sideways cap as a fraction of takeoff speed…
  airLateralMin: 2.6,      // …with this floor, so a standing jump can still be aimed

  // turning
  turnRateSlow: 13.0,   // rad/s at a standstill
  turnRateFast: 3.2,    // rad/s at full sprint → 183°/s, a measured 2.55 m carve at 8.3 m/s
  turnRateAir: 2.6,     // rad/s of facing change in flight
  // Lateral acceleration that reads as a full lean. Peak available is ~48 m/s² in a run-speed
  // hairpin, so 34 lets a run hairpin saturate — it should — while a sprint carve, which pulls
  // 26.6, still reports 0.78 instead of clipping to the same number as everything else.
  leanReference: 34,

  // Jump. Sized against the body, not against the level: the measured arc is 1.337 m for a
  // 1.82 m capsule — 0.73 body heights, which is where Breath of the Wild and Fortnite both
  // sit — over 0.700 s, rising in 0.383 and falling in 0.317. A taller jump turns into a
  // balloon: at `apexSpeed: 2.0` the hang was 20 of 51 airborne steps and had stopped being a
  // beat and become the jump; at 1.2 it is 10 of 42.
  jumpSpeed: 7.45,
  gravityRise: 22,
  gravityFall: 33,
  apexSpeed: 1.2,          // |vy| under which the apex hang applies
  apexGravityScale: 0.55,
  apexAirControl: 1.2,
  jumpCut: 0.42,           // upward velocity kept when the button is released early
  minJumpHold: 0.055,      // s — below this the cut is not applied, so a tap is never eaten
  terminalSpeed: 45,

  // Forgiveness windows. Neither constant is the window a player gets, and the gap is not the
  // same for the two of them, so both are stated as measured rather than as intended. Coyote
  // loses one step: the step that arms the timer also spends a tick of it (0.16 s = 9.6 steps
  // → 9 usable = 0.150 s). The buffer loses two and a bit: on top of that, it cannot fire on
  // the touchdown step itself, because `grounded` is only assigned at the end of `fixed()`, so
  // the earliest it can fire is touchdown+1 (0.19 s = 11.4 steps → 9 of lead = 0.150 s).
  // Both swept trial-by-trial in review/p04-feel.mjs; both come out strictly monotonic.
  coyoteTime: 0.16,        // s of ground authority after walking off an edge  → 0.150 measured
  jumpBuffer: 0.19,        // s a jump press survives before touchdown          → 0.150 measured
  jumpCooldown: 0.09,

  // slopes
  slopeLimitDeg: 47,
  slideAccel: 16,
  slideControl: 0.22,
  uphillK: 0.85,           // speed scale uphill = 1/(1 + k·grade)
  downhillK: 0.18,

  // Ground contact. `stepHeight` is the assisted lift *and* the rise budget per ledge; a capsule
  // with a rounded bottom also rides an edge on its own, so the measured walk-up limit is about
  // 0.7 m and 0.9 m is a hard wall. Those are the numbers in the handoff table, not this one.
  stepHeight: 0.5,
  stepGraceSteps: 3,       // frames a step-up keeps you grounded while the body clears the edge
  snapDistance: 0.38,
  snapSuppress: 0.09,
  groundEpsilon: 0.05,

  // landings
  // Calibrated against measured descent speeds: a flat jump lands at 9.07 m/s and must be free,
  // a 3 m drop lands at 11.7 and should be just felt, a 12 m drop lands at 27 and takes 45% of
  // your horizontal speed plus 0.26 s of authority.
  landSoftSpeed: 10.2,     // m/s of descent below which a landing is free
  landHardSpeed: 24,       // m/s at which a landing costs the most
  landLockMin: 0.06,
  landLockMax: 0.26,
  landControlMin: 0.35,    // authority multiplier at maximum impact
  landSpeedKeep: 0.55,     // horizontal speed kept through the worst landing
  squashDecay: 0.22,

  // Housekeeping. The void limit is measured *down from the spawn surface*, not from world
  // zero: a terrain that puts its start plateau at y = 40 would otherwise never trigger it,
  // and one that starts below zero would trigger it on the first step.
  voidDrop: 30,
  strideLength: 2.1,
};

const FALLBACK_CODES = new Set([
  "KeyW", "KeyA", "KeyS", "KeyD",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "Space", "ShiftLeft", "ShiftRight", "ControlLeft", "AltLeft",
]);

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const r4 = (v) => Math.round(v * 1e4) / 1e4;

export class Locomotion {
  constructor(kernel, opts = {}) {
    this.kernel = kernel;
    this.collision = opts.collision ?? kernel.get("collision");
    this.tune = { ...LOCOMOTION_TUNING, ...(opts.tune || {}) };

    const T = this.tune;
    this.radius = T.capsuleRadius;
    this.halfSeg = Math.max(0.01, T.capsuleHeight / 2 - T.capsuleRadius);
    this.slopeCos = Math.cos(T.slopeLimitDeg * DEG);

    // --- state
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.heading = new THREE.Vector2(0, -1); // (x, z), unit
    this.grounded = false;
    this.sliding = false;
    this.state = "idle";
    this.groundNormal = new THREE.Vector3(0, 1, 0);
    this.slopeDeg = 0;

    this.coyote = 0;
    this.jumpBuffer = 0;
    this.jumpCooldown = 0;
    this.snapSuppress = 0;
    this.landLock = 0;
    this.landLockTotal = 0;
    this.landControl = 1;
    this.squash = 0;
    this.airtime = 0;
    this.jumpActive = false;
    this.braking = false;
    this.pivot = 0;
    this.takeoffSpeed = 0;
    this.takeoffDir = new THREE.Vector2(0, -1);
    // Signed body accelerations, published for whoever animates this thing. P08 cannot lean a
    // body into a 2.6 m carve without a number to lean on, and the controller is the only
    // thing that knows it. +lean = accelerating to the body's right; +push = gaining speed.
    this.lean = 0;
    this.push = 0;
    this._visLean = 0;   // frame-smoothed copies, for the stand-in proxy only
    this._visPush = 0;
    this.stride = 0;
    this._liftoff = false;
    this._jumpAirborne = false;
    this.stepBudget = T.stepHeight + 0.02;
    this._stepGrace = 0;

    this.lastLand = { impact: 0, severity: 0, hard: false, at: -1 };
    this.lastJump = { apex: 0, height: 0, airtime: 0, at: -1 };
    this._jumpStartY = 0;
    this._apexY = 0;

    // --- intent
    this.moveX = 0;
    this.moveY = 0;
    this.jumpHeld = false;
    this.sprintHeld = false;
    this.walkHeld = false;
    this.externalInput = false;
    this._keys = new Set();

    this.simTime = 0;
    this._prevPos = new THREE.Vector3();
    this._renderPos = new THREE.Vector3();
    this._spawnPoint = null;
    this.voidLimit = -T.voidDrop;
    this._voidFalls = 0;
    this.brakeDot = Math.cos((180 - T.brakeAngleDeg) * DEG);
    this.brakeHoldDot = Math.cos((180 - T.brakeHoldDeg) * DEG);

    // --- scratch (fixed step must not allocate)
    this._delta = new THREE.Vector3();
    this._moveOut = {};
    this._probe = {};
    this._camYaw = Math.PI;
    this._camPos = new THREE.Vector3();
    this._lastBasisYaw = 0;

    this.root = new THREE.Group();
    this.root.name = "locomotion";
    // The camera boom must never collide with the player it is framing.
    this.root.userData.noCameraCollide = true;
    this._buildProxy();

    this._offs = [
      signals.on("input:move", (v) => this._onMove(v)),
      signals.on("input:action", (v) => this._onAction(v)),
      signals.on("player:spawn", (v) => this._onSpawnSignal(v)),
    ];

    this.fallbackInput = !kernel.byName.has("input");
    if (this.fallbackInput) this._bindKeyboard();

    this._spawn();

    publish("locomotion", () => this.snapshot());
  }

  // ------------------------------------------------------------------ spawn / world

  /**
   * Put the body on the ground, wherever the ground turns out to be.
   *
   * The signature is `groundAt(x, z, fromY)` — three positional numbers, two of which are a
   * horizontal coordinate. Getting the order wrong is silent: the ray starts *z* metres up,
   * misses the world entirely, reports no hit, and the spawn quietly keeps whatever guess it
   * arrived with. Against the stand-in proving ground that guess happens to be right, so the
   * bug hides until a real world registers a collider on a plateau and the character spawns
   * under it and falls forever. Hence the second half of this method: a spawn never trusts a
   * hint it has not confirmed against the collision world.
   */
  _spawn() {
    const c = this.collision;
    c?.ensureFallbackGround?.();
    const fb = c?.fallbackSpawn;
    const hint = this._spawnPoint ?? (fb ? { x: fb.x, y: fb.y, z: fb.z } : null);

    let surface = null;
    if (hint) {
      const g = c?.groundAt?.(hint.x, hint.z, hint.y + 500);
      if (g?.hit) surface = { x: hint.x, y: g.y, z: hint.z };
    }
    surface ??= this._findSpawnSurface(hint?.x ?? 0, hint?.z ?? 0);
    if (!surface) {
      surface = hint ?? { x: 0, y: 0, z: 0 };
      if (!this._warnedSpawn) {
        this._warnedSpawn = true;
        console.warn(
          "[locomotion] no world surface found near the spawn point — dropping the player at " +
          `(${surface.x}, ${surface.y}, ${surface.z}). Register a collider with ` +
          "'world:collider' or emit 'player:spawn' with a position on solid ground."
        );
      }
    }

    this._spawnPoint = surface;
    this.voidLimit = surface.y - this.tune.voidDrop;
    const x = surface.x;
    const z = surface.z;
    const y = surface.y + this.halfSeg + this.radius + 0.01;
    this.teleport(x, y, z, { heading: [0, -1] });
    this._emittingSpawn = true;
    signals.emit("player:spawn", { position: { x, y, z } });
    this._emittingSpawn = false;
  }

  /**
   * Widening ring search for something to stand on. A real world is not obliged to put solid
   * ground under the origin, and "no hit" must not silently mean "y = 0".
   */
  _findSpawnSurface(x0, z0) {
    const c = this.collision;
    if (!c?.groundAt) return null;
    const RINGS = [0, 1.5, 4, 9, 18, 36, 72, 144];
    const SEGS = 12;
    for (const r of RINGS) {
      const n = r === 0 ? 1 : SEGS;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const x = x0 + Math.cos(a) * r;
        const z = z0 + Math.sin(a) * r;
        const g = c.groundAt(x, z, 4000, 8000);
        if (g?.hit) return { x, y: g.y, z };
      }
    }
    return null;
  }

  _onSpawnSignal(v) {
    if (this._emittingSpawn || !v?.position) return;
    const p = v.position;
    const x = p.x ?? 0, y = p.y ?? 0, z = p.z ?? 0;
    // An external spawn re-bases the void guard too, otherwise a world that starts at y = 40
    // never triggers it and one that starts at y = −40 triggers it on the first step.
    this._spawnPoint = { x, y: y - this.halfSeg - this.radius, z };
    this.voidLimit = y - this.tune.voidDrop;
    this.teleport(x, y, z, v);
  }

  /**
   * Hard reset of the body. Used by spawn, by the void guard and by the measurement rig.
   *
   * Facing resets too, and that is deliberate: leaving the heading alone made two identical
   * scripted runs diverge by a third of a metre, because the second one began already turned
   * from the end of the first. A spawn that leaves *any* state behind is a determinism hole.
   * `yaw` (radians, 0 = world −Z) or `heading` [x, z] in the payload override the default.
   */
  teleport(x, y, z, opts = {}) {
    this.position.set(x, y, z);
    this._prevPos.copy(this.position);
    this._renderPos.copy(this.position);
    this.velocity.set(0, 0, 0);
    if (opts.heading) this.heading.set(opts.heading[0], opts.heading[1]).normalize();
    else if (Number.isFinite(opts.yaw)) this.heading.set(Math.sin(opts.yaw), -Math.cos(opts.yaw));
    else this.heading.set(0, -1);
    this.groundNormal.set(0, 1, 0);
    this.slopeDeg = 0;
    this.stride = 0;
    this.takeoffSpeed = 0;
    this.takeoffDir.copy(this.heading);
    this.braking = false;
    this.pivot = 0;
    this.lean = 0;
    this.push = 0;
    this.landControl = 1;
    this.landLockTotal = 0;
    this.lastLand = { impact: 0, severity: 0, hard: false, at: -1 };
    this.lastJump = { apex: 0, height: 0, airtime: 0, at: -1 };
    this.grounded = false;
    this.sliding = false;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.jumpCooldown = 0;
    this.snapSuppress = 0;
    this.landLock = 0;
    this.squash = 0;
    this.airtime = 0;
    this.jumpActive = false;
    this._liftoff = false;
    this._jumpAirborne = false;
    this.stepBudget = this.tune.stepHeight + 0.02;
    this._stepGrace = 0;
    this._setState("idle", true);
  }

  // ------------------------------------------------------------------ intent

  _onMove(v) {
    this.externalInput = true;
    this.moveX = clamp(Number(v?.x) || 0, -1, 1);
    this.moveY = clamp(Number(v?.y) || 0, -1, 1);
  }

  _onAction(v) {
    if (!v?.action) return;
    this.externalInput = true;
    const down = v.phase !== "up";
    switch (v.action) {
      case "jump":
        // A key-repeat is not a new press; re-arming the buffer from one would fire a second
        // jump the instant you touched down.
        if (down && !v.repeat) this._pressJump();
        else if (!down) this.jumpHeld = false;
        break;
      case "sprint":
        if (config.get("holdToSprint") === false) {
          if (down) this.sprintHeld = !this.sprintHeld;
        } else this.sprintHeld = down;
        break;
      case "walk":
        this.walkHeld = down;
        break;
      default:
        break;
    }
  }

  _pressJump() {
    this.jumpHeld = true;
    this.jumpBuffer = this.tune.jumpBuffer;
  }

  _bindKeyboard() {
    const down = (e) => {
      if (this.externalInput || !FALLBACK_CODES.has(e.code)) return;
      if (e.code === "Space") e.preventDefault();
      if (e.repeat) return;
      this._keys.add(e.code);
      if (e.code === "Space") this._pressJump();
    };
    const up = (e) => {
      if (this.externalInput || !FALLBACK_CODES.has(e.code)) return;
      this._keys.delete(e.code);
      if (e.code === "Space") this.jumpHeld = false;
    };
    addEventListener("keydown", down, { capture: true });
    addEventListener("keyup", up, { capture: true });
    this._offs.push(() => removeEventListener("keydown", down, { capture: true }));
    this._offs.push(() => removeEventListener("keyup", up, { capture: true }));
  }

  _readFallbackKeys() {
    const k = this._keys;
    let x = 0, y = 0;
    if (k.has("KeyW") || k.has("ArrowUp")) y += 1;
    if (k.has("KeyS") || k.has("ArrowDown")) y -= 1;
    if (k.has("KeyD") || k.has("ArrowRight")) x += 1;
    if (k.has("KeyA") || k.has("ArrowLeft")) x -= 1;
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    this.moveX = x;
    this.moveY = y;
    this.sprintHeld = k.has("ShiftLeft") || k.has("ShiftRight");
    this.walkHeld = k.has("ControlLeft") || k.has("AltLeft");
  }

  /**
   * Movement intent is camera-relative — but only once something actually owns the camera.
   * Standing alone the basis is the world, which is what keeps the measurement rig honest.
   */
  _cameraOwned() {
    const b = this.kernel.byName;
    return b.has("camera") || b.has("camerarig") || b.has("cameraRig");
  }

  /**
   * Yaw of the camera's forward axis, read out of its world matrix rather than its euler.
   * A rig is free to author its rotation in any euler order it likes; the third column of the
   * world matrix is the only description of "which way is forward" that cannot be misread.
   */
  _basisYaw() {
    if (!this._cameraOwned()) return 0;
    const cam = this.kernel.camera;
    cam.updateMatrixWorld();
    const e = cam.matrixWorld.elements;
    const fx = -e[8], fz = -e[10];
    if (Math.hypot(fx, fz) < 1e-4) return this._lastBasisYaw;
    this._lastBasisYaw = Math.atan2(-fx, -fz);
    return this._lastBasisYaw;
  }

  // ------------------------------------------------------------------ simulation

  fixed(step) {
    const T = this.tune;
    const col = this.collision;
    this.simTime += step;
    this._prevPos.copy(this.position);
    if (this.fallbackInput && !this.externalInput) this._readFallbackKeys();

    // ---- timers
    if (this.jumpBuffer > 0) this.jumpBuffer = Math.max(0, this.jumpBuffer - step);
    if (this.jumpCooldown > 0) this.jumpCooldown = Math.max(0, this.jumpCooldown - step);
    if (this.snapSuppress > 0) this.snapSuppress = Math.max(0, this.snapSuppress - step);
    if (this.landLock > 0) this.landLock = Math.max(0, this.landLock - step);
    if (this.squash > 0) this.squash = Math.max(0, this.squash - step / T.squashDecay);
    this.coyote = this.grounded && !this.sliding
      ? T.coyoteTime
      : Math.max(0, this.coyote - step);
    this.airtime = this.grounded ? 0 : this.airtime + step;

    // Authority recovers across the landing lock rather than snapping back at the end of it.
    const control = this.landLock > 0 && this.landLockTotal > 0
      ? lerp(this.landControl, 1, 1 - this.landLock / this.landLockTotal)
      : 1;

    // ---- intent in world space
    const yaw = this._basisYaw();
    const sinY = Math.sin(yaw), cosY = Math.cos(yaw);
    let wx = this.moveX * cosY - this.moveY * sinY;
    let wz = -this.moveX * sinY - this.moveY * cosY;
    let wishMag = Math.hypot(wx, wz);
    if (wishMag > 1e-4) { wx /= wishMag; wz /= wishMag; }
    wishMag = clamp(wishMag, 0, 1);

    const v = this.velocity;
    const vx0 = v.x, vz0 = v.z;
    let planar = Math.hypot(v.x, v.z);

    // ---- the brake ------------------------------------------------------------------------
    // Judged against the velocity, never the heading, and evaluated before the steer for the
    // same reason: at sprint the heading can only sweep three degrees per step, so by the time
    // a heading test could notice a reversal the character has already carved a free 180° arc
    // at constant speed. Opposing your own travel by more than `brakeAngleDeg` plants the feet:
    // steering stops, speed is scraped off at groundBrake · reverseBoost, and you keep sliding
    // the way you were going. The skid releases at `pivotSpeed`, and `pivot` then taxes the
    // push-off out of it — a start, a commitment and a recovery, in that order.
    let braking = false;
    if (this.grounded && !this.sliding && wishMag > 0.35 && planar > T.pivotSpeed) {
      const opp = -(wx * v.x + wz * v.z) / planar;
      braking = opp > (this.braking ? this.brakeHoldDot : this.brakeDot);
    }
    if (braking) {
      if (!this.braking) {
        signals.emit("audio:cue", { id: "skid", params: { speed: r4(planar) } });
      }
      const next = Math.max(0, planar - T.groundBrake * T.reverseBoost * control * step);
      const s = next / planar;
      v.x *= s; v.z *= s;
      planar = next;
      this.pivot = T.pivotTime;
    } else if (this.pivot > 0) {
      this.pivot = Math.max(0, this.pivot - step);
    }
    this.braking = braking;

    // ---- heading steering (this is the turn radius)
    if (wishMag > 0.02 && !braking) {
      const t = clamp(planar / Math.max(T.sprintSpeed, 0.001), 0, 1);
      let rate = this.grounded
        ? lerp(T.turnRateSlow, T.turnRateFast, t * t)
        : T.turnRateAir;
      rate *= control;
      this._steer(wx, wz, rate * step);
    }
    const hx = this.heading.x, hz = this.heading.y;

    // ---- slope reading
    const n = this.groundNormal;
    const ny = Math.max(n.y, 0.1);
    const grade = this.grounded ? -(n.x * hx + n.z * hz) / ny : 0;

    if (this.grounded && !this.sliding) {
      // ------------------------------------------------ ground control
      let base = this.sprintHeld ? T.sprintSpeed : this.walkHeld ? T.walkSpeed : T.runSpeed;
      let accelScale = 1;
      if (grade > 0) { const k = 1 / (1 + T.uphillK * grade); base *= k; accelScale = k; }
      else base *= 1 + T.downhillK * Math.min(-grade, 1.2);
      const target = base * wishMag;

      // While the skid runs the feet are dug in: nothing accelerates and nothing steers. The
      // only thing left to do on the ground is stay glued to the surface, at the bottom.
      if (!braking && wishMag > 0.02) {
        let fwd = v.x * hx + v.z * hz;
        const latX = v.x - hx * fwd;
        const latZ = v.z - hz * fwd;
        if (fwd < target) {
          const boost = 1 + T.launchBoost * clamp(1 - Math.max(fwd, 0) / Math.max(target, 0.001), 0, 1);
          let a = T.groundAccel * boost * accelScale * control;
          // The last scraps of the old momentum die fast; the new momentum is slow to build.
          // Those are different things and they must not share a multiplier.
          if (fwd < 0) a *= T.reverseBoost;
          else if (this.pivot > 0) a *= T.pivotAccel;
          fwd = Math.min(target, fwd + a * step);
        } else {
          fwd = Math.max(target, fwd - T.groundBrake * step);
        }
        const grip = Math.exp(-T.lateralGrip * step);
        v.x = hx * fwd + latX * grip;
        v.z = hz * fwd + latZ * grip;
        // A turn must never hand back more speed than it was given. Recomposing along the new
        // heading leaves |v| = hypot(fwd, lat), which is larger than either — without this a
        // walk-speed carve peaks 18% over `walkSpeed` and the speed bands stop meaning
        // anything. The cap is the band, or the speed you entered the step with if that is
        // higher, so easing off the stick still decelerates rather than snapping.
        const cap = Math.max(target, planar);
        const m = Math.hypot(v.x, v.z);
        if (m > cap + 1e-6) { const s = cap / m; v.x *= s; v.z *= s; }
      } else if (!braking) {
        const dec = T.idleFriction * step;
        const next = Math.max(0, planar - dec);
        if (planar > 1e-6) { const s = next / planar; v.x *= s; v.z *= s; }
        else { v.x = 0; v.z = 0; }
      }
      // glue to the surface: follow the slope exactly instead of ballistically leaving it
      v.y = -(n.x * v.x + n.z * v.z) / ny;
    } else if (this.grounded && this.sliding) {
      // ------------------------------------------------ too steep to stand on
      let tx = n.x, tz = n.z;
      const tl = Math.hypot(tx, tz);
      if (tl > 1e-6) { tx /= tl; tz /= tl; }
      v.x += tx * T.slideAccel * step;
      v.z += tz * T.slideAccel * step;
      if (wishMag > 0.02) {
        const a = T.groundAccel * T.slideControl * control * step;
        v.x += wx * a;
        v.z += wz * a;
      }
      v.y -= T.gravityFall * step;
      const vn = v.x * n.x + v.y * n.y + v.z * n.z;
      if (vn < 0) { v.x -= n.x * vn; v.y -= n.y * vn; v.z -= n.z * vn; }
    } else {
      // ------------------------------------------------ air
      //
      // A jump is a decision you have already made. Air control is measured about the *takeoff
      // direction*, not about the world: the component along it is fenced into
      // [airAlongKeep·takeoff, takeoff] and the component across it is capped, then the whole
      // vector is held to the takeoff speed. So you may aim where you land and you may bleed
      // momentum, but you can never buy forward speed you did not leave the ground with, and a
      // sprint jump can never become a sprint the other way. That last one is not a detail: a
      // controller you can turn around in mid-air has no jump, only a hover with a graph.
      if (wishMag > 0.02) {
        const apex = Math.abs(v.y) < T.apexSpeed ? T.apexAirControl : 1;
        const A = T.airAccel * apex * control * step * wishMag;
        const tx = this.takeoffDir.x, tz = this.takeoffDir.y;
        const along = v.x * tx + v.z * tz;
        const aAlong = (wx * tx + wz * tz) * A;
        const latX = v.x - tx * along + (wx * A - tx * aAlong);
        const latZ = v.z - tz * along + (wz * A - tz * aAlong);

        const top = Math.max(T.airAlongFloor, this.takeoffSpeed);
        const floor = T.airAlongKeep * this.takeoffSpeed;
        const newAlong = clamp(along + aAlong, floor, Math.max(top, along));

        const latCap = Math.max(T.airLateralMin, T.airLateralK * this.takeoffSpeed);
        const latMag = Math.hypot(latX, latZ);
        const latScale = latMag > latCap ? latCap / latMag : 1;

        v.x = tx * newAlong + latX * latScale;
        v.z = tz * newAlong + latZ * latScale;
        // Aiming trades against travelling. Without this the lateral cap is free speed and a
        // sprint jump lands faster than it took off.
        const m = Math.hypot(v.x, v.z);
        if (m > top + 1e-6) { const s = top / m; v.x *= s; v.z *= s; }
      }
      const drag = Math.exp(-T.airDrag * step);
      v.x *= drag;
      v.z *= drag;

      let g = v.y > 0 ? T.gravityRise : T.gravityFall;
      if (Math.abs(v.y) < T.apexSpeed) g *= T.apexGravityScale;
      v.y -= g * step;
      if (v.y < -T.terminalSpeed) v.y = -T.terminalSpeed;

      // variable height: releasing early trims the remaining rise
      if (this.jumpActive && v.y > 0 && !this.jumpHeld && this.airtime > T.minJumpHold) {
        v.y *= T.jumpCut;
        this.jumpActive = false;
      }
      if (v.y <= 0) this.jumpActive = false;
      if (this.position.y > this._apexY) this._apexY = this.position.y;
    }

    // ---- jump (buffered, with coyote authority)
    this._liftoff = false;
    if (this.jumpBuffer > 0 && this.jumpCooldown <= 0 && (this.grounded || this.coyote > 0)) {
      v.y = T.jumpSpeed;
      this.jumpBuffer = 0;
      this.jumpCooldown = T.jumpCooldown;
      this.coyote = 0;
      this.snapSuppress = T.snapSuppress;
      this.jumpActive = true;
      this.grounded = false;
      this.sliding = false;
      this._liftoff = true;
      this._jumpAirborne = true;
      this.braking = false;
      this._setTakeoff();
      this._jumpStartY = this.position.y;
      this._apexY = this.position.y;
      this.airtime = 0;
      this.lastJump = { apex: 0, height: 0, airtime: 0, at: r4(this.simTime) };
      signals.emit("player:jump", { charged: false });
      signals.emit("audio:cue", { id: "jump", params: { speed: r4(planar) } });
    }

    // ---- integrate through the world
    this._delta.set(v.x * step, v.y * step, v.z * step);
    const wasGrounded = this.grounded;
    if (col) {
      // The step budget is what makes `stepHeight` an honest number. A capsule with a rounded
      // bottom can ride up over a ledge a couple of centimetres per frame, so a per-frame limit
      // alone lets a patient player walk up anything. Spending a shared budget per ledge — and
      // only re-arming it after a frame of clean, unobstructed contact — turns the constant into
      // the real thing: 0.45 m is a step, taller is a wall for P06's mantle to answer.
      const canStep = wasGrounded && !this._liftoff && this.stepBudget > 0.01;
      col.moveCapsule(this.position, this._delta, {
        radius: this.radius,
        halfSeg: this.halfSeg,
        stepHeight: canStep ? Math.min(T.stepHeight, this.stepBudget) : 0,
        slopeCos: this.slopeCos,
        grounded: wasGrounded && !this._liftoff,
        out: this._moveOut,
      });
      if (this._moveOut.stepped) this.stepBudget -= this._moveOut.stepRise;
      // A wall took the component of velocity that pointed into it; keep the rest.
      if (this._moveOut.blocked) {
        const wn = this._moveOut;
        const into = v.x * wn.wnx + v.y * wn.wny + v.z * wn.wnz;
        if (into < 0) { v.x -= wn.wnx * into; v.y -= wn.wny * into; v.z -= wn.wnz * into; }
      }
    } else {
      this.position.add(this._delta);
    }

    // ---- ground resolution
    const impactVy = v.y;
    const stepped = Boolean(this._moveOut.stepped);
    let grounded = false;
    let sliding = false;
    let planted = false; // standing squarely on a surface, not perched on an edge
    if (col && !this._liftoff) {
      const p = col.groundProbe(
        this.position, this.radius, this.halfSeg, T.snapDistance + 0.15, this._probe
      );
      if (p.hit) {
        const walkable = p.ny >= this.slopeCos;
        const perpGap = p.gap * p.ny;
        if (perpGap <= T.groundEpsilon) {
          grounded = true;
          planted = true;
        } else if (
          // A step-up must never be undone by the snap: mid-climb the capsule is perched on a
          // ledge edge, where a downward ray still reports the floor it came from. Snapping to
          // that floor cancels the climb, and the character spends forever bouncing off a stair.
          !stepped && wasGrounded && walkable && this.snapSuppress <= 0 &&
          v.y <= 0.6 && p.gap <= T.snapDistance
        ) {
          this.position.y -= p.gap - 0.002;
          grounded = true;
          planted = true;
        }
        if (grounded) {
          this.groundNormal.set(p.nx, p.ny, p.nz);
          sliding = !walkable;
          this.slopeDeg = Math.acos(clamp(p.ny, -1, 1)) / DEG;
        }
      }
      // A step-up leaves the body perched on the ledge edge for two or three frames while it
      // clears. The solver only accepts a step onto something solid, so that is contact — and
      // without this grace the state machine flickers to `airborne` on every single stair.
      if (stepped) this._stepGrace = T.stepGraceSteps;
      else if (this._stepGrace > 0) this._stepGrace--;
      if (!grounded && this._stepGrace > 0) {
        grounded = true;
        this.groundNormal.set(0, 1, 0);
        this.slopeDeg = 0;
      }
    }
    if (!grounded) { this.slopeDeg = 0; this.groundNormal.set(0, 1, 0); }
    // Re-arm the step budget only from a planted stance. Refilling while perched mid-climb would
    // let a patient player walk up a cliff a few centimetres at a time.
    if (!stepped && planted && !this._moveOut.blocked) this.stepBudget = T.stepHeight + 0.02;

    // ---- landing
    if (grounded && !wasGrounded) {
      if (this._jumpAirborne) {
        this.lastJump = {
          apex: r4(this._apexY),
          height: r4(this._apexY - this._jumpStartY),
          airtime: r4(this.airtime),
          at: this.lastJump.at,
        };
        this._jumpAirborne = false;
      }
      this._land(-impactVy);
    }
    // Walking off an edge is a takeoff too, and it is the takeoff that fences air control.
    if (!grounded && wasGrounded) this._setTakeoff();
    if (!grounded && this.position.y > this._apexY) this._apexY = this.position.y;

    this.grounded = grounded;
    this.sliding = sliding;
    if (grounded) this._voidFalls = 0;

    // ---- void guard: a stand-in world has edges, and falling forever is not a review.
    // The limit is relative to the spawn surface, not to world zero — see `voidDrop`.
    if (this.position.y < this.voidLimit) {
      this._voidFalls++;
      if (this._voidFalls === 3 && !this._warnedVoid) {
        this._warnedVoid = true;
        console.warn(
          "[locomotion] respawned into the void three times in a row — the spawn point at " +
          `(${r4(this._spawnPoint?.x ?? 0)}, ${r4(this._spawnPoint?.y ?? 0)}, ` +
          `${r4(this._spawnPoint?.z ?? 0)}) is not standing on anything.`
        );
      }
      this._spawn();
      return;
    }

    // ---- footfalls
    planar = Math.hypot(v.x, v.z);
    if (grounded && planar > 0.6 && !braking) {
      this.stride += planar * step;
      const len = T.strideLength * clamp(planar / T.runSpeed, 0.55, 1.4);
      if (this.stride >= len) {
        this.stride = 0;
        signals.emit("audio:cue", { id: "step", params: { speed: r4(planar), surface: "rock" } });
      }
    } else if (!grounded) this.stride = T.strideLength * 0.6;

    // ---- body accelerations, for whoever animates this thing.
    // A 2.6 m carve at sprint is invisible on a dead-upright capsule; P08 needs the number.
    // Taken from the actual velocity change over the step, so a wall you clipped and a skid
    // you started both show up without either of them needing a special case.
    const ax = (v.x - vx0) / step, az = (v.z - vz0) / step;
    this.lean = clamp((ax * -this.heading.y + az * this.heading.x) / T.leanReference, -1, 1);
    this.push = clamp((ax * this.heading.x + az * this.heading.y) / T.leanReference, -1, 1);

    this._setState(this._resolveState(planar));
  }

  /**
   * Latch the takeoff frame. Air control is fenced about this direction, so it has to be the
   * direction the body is actually travelling — the heading only stands in when there is no
   * travel to speak of, which is exactly the standing-jump case.
   */
  _setTakeoff() {
    const v = this.velocity;
    const planar = Math.hypot(v.x, v.z);
    this.takeoffSpeed = planar;
    if (planar > 0.2) this.takeoffDir.set(v.x / planar, v.z / planar);
    else this.takeoffDir.copy(this.heading);
  }

  _steer(tx, tz, maxRad) {
    const hx = this.heading.x, hz = this.heading.y;
    const dot = clamp(hx * tx + hz * tz, -1, 1);
    const cross = hx * tz - hz * tx;
    const ang = Math.atan2(cross, dot);
    const turn = clamp(ang, -maxRad, maxRad);
    const c = Math.cos(turn), s = Math.sin(turn);
    const nx = hx * c - hz * s;
    const nz = hx * s + hz * c;
    const l = Math.hypot(nx, nz) || 1;
    this.heading.set(nx / l, nz / l);
  }

  _land(impact) {
    const T = this.tune;
    const severity = clamp(
      (impact - T.landSoftSpeed) / Math.max(T.landHardSpeed - T.landSoftSpeed, 0.001), 0, 1
    );
    const hard = severity > 0.45;
    this.landLockTotal = impact > 3 ? lerp(T.landLockMin, T.landLockMax, severity) : 0;
    this.landLock = this.landLockTotal;
    this.landControl = lerp(1, T.landControlMin, severity);
    this.squash = Math.max(this.squash, clamp(impact / T.landHardSpeed, 0, 1));
    if (severity > 0) {
      const keep = lerp(1, T.landSpeedKeep, severity);
      this.velocity.x *= keep;
      this.velocity.z *= keep;
    }
    this.velocity.y = 0;
    this.jumpActive = false;
    this.lastLand = { impact: r4(impact), severity: r4(severity), hard, at: r4(this.simTime) };
    // A settle of a few centimetres is not an event; broadcasting it would make every listener
    // (audio, camera, avatar) fire on spawn and on every stair tread.
    if (impact < 1.5) return;
    signals.emit("player:land", {
      impact: r4(impact),
      severity: r4(severity),
      hard,
      position: { x: r4(this.position.x), y: r4(this.position.y), z: r4(this.position.z) },
    });
    signals.emit("audio:cue", { id: "land", params: { impact: r4(impact), hard } });
    if (severity > 0.25 && config.get("cameraShake") > 0) {
      signals.emit("camera:shake", { amount: r4(severity * 0.55), seconds: 0.22 });
    }
  }

  _resolveState(planar) {
    if (!this.grounded) return "airborne";
    if (this.landLock > 0) return "landing";
    // `skid` is an addition to the idle/walk/run/sprint/airborne/landing set, not a
    // replacement: a listener that does not know it simply never sees it, and one that does
    // gets the plant-and-slide beat it needs to animate.
    if (this.braking) return "skid";
    const T = this.tune;
    if (planar < 0.35) return "idle";
    if (planar < T.walkSpeed * 1.25) return "walk";
    if (planar < T.runSpeed * 1.06) return "run";
    return "sprint";
  }

  _setState(next, force = false) {
    if (!force && next === this.state) return;
    this.state = next;
    signals.emit("player:state", {
      grounded: this.grounded,
      speed: r4(Math.hypot(this.velocity.x, this.velocity.z)),
      action: next,
      sliding: this.sliding,
      position: { x: r4(this.position.x), y: r4(this.position.y), z: r4(this.position.z) },
    });
  }

  // ------------------------------------------------------------------ presentation

  _buildProxy() {
    const T = this.tune;
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(T.capsuleRadius, T.capsuleHeight - T.capsuleRadius * 2, 6, 18),
      new THREE.MeshStandardMaterial({
        color: 0x9ecbe8,
        emissive: 0x1c4c6e,
        emissiveIntensity: 0.7,
        roughness: 0.42,
        metalness: 0.15,
      })
    );
    body.castShadow = true;
    const nose = new THREE.Mesh(
      new THREE.ConeGeometry(0.16, 0.42, 10),
      new THREE.MeshStandardMaterial({ color: 0xffd7a0, emissive: 0x6a3a10, roughness: 0.5 })
    );
    nose.rotation.x = -Math.PI / 2; // cone tip forward, along the heading
    nose.position.set(0, 0.34, -T.capsuleRadius - 0.14);
    nose.castShadow = true;
    this._proxy = new THREE.Group();
    // YXZ so the bank and the pitch are applied *inside* the yaw: with the default XYZ order
    // `rotation.x` is a world-axis tilt and the body pitches sideways whenever it faces east.
    this._proxy.rotation.order = "YXZ";
    this._proxy.add(body, nose);
    this.root.add(this._proxy);

    // A camera rig that reads a system's `position` gets the fixed-step value and judders
    // between simulation ticks. Hand it a node that lives on the interpolated position instead.
    this._camTarget = new THREE.Object3D();
    this.root.add(this._camTarget);
  }

  /** Duck-typed contract for any camera rig: the node it should frame. */
  getCameraTarget() {
    return this._camTarget;
  }

  frame(dt, alpha) {
    // Nominate the follow node once, on the first rendered frame — by then every boot module is
    // mounted and a camera rig, if there is one, is listening. Without this a rig that latches
    // the position carried on `player:spawn` keeps framing the spawn point forever after any
    // later teleport, because `player:state` fires on state changes, not every step.
    if (!this._announcedTarget) {
      this._announcedTarget = true;
      signals.emit("camera:target", { object: this._camTarget });
    }
    // The proxy body and the stand-in camera both stand down the moment their owning piece
    // mounts; until then they are the only reason this piece can be looked at at all.
    this._proxy.visible = !this.kernel.byName.has("avatar");
    this._renderPos.lerpVectors(this._prevPos, this.position, clamp(alpha, 0, 1));
    this._proxy.position.copy(this._renderPos);
    this._camTarget.position.copy(this._renderPos);
    const yaw = Math.atan2(this.heading.x, this.heading.y);
    // Bank into the carve, pitch back into the skid. Purely visual, purely in `frame` — the
    // simulation never reads these, so the variable delta here cannot reach gameplay. It is
    // here because a 2.55 m turning circle on a dead-upright capsule is communicated only by
    // the path it leaves, and the same is true of a skid. P08's avatar will do this properly
    // off `lean` and `push`; until then the proxy has to carry it.
    const k = 1 - Math.exp(-Math.max(dt, 0) * 20);
    this._visLean += (this.lean - this._visLean) * k;
    this._visPush += (this.push - this._visPush) * k;
    this._proxy.rotation.set(-this._visPush * 0.26, yaw + Math.PI, -this._visLean * 0.28, "YXZ");
    const sq = this.squash;
    this._proxy.scale.set(1 + sq * 0.22, 1 - sq * 0.34, 1 + sq * 0.22);
  }

  after(dt) {
    if (this._cameraOwned()) return;
    const cam = this.kernel.camera;
    const p = this._renderPos;
    const targetYaw = Math.atan2(this.heading.x, this.heading.y);
    let d = targetYaw - this._camYaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this._camYaw += d * Math.min(1, dt * 2.4);
    const dist = 7.2;
    this._camPos.set(
      p.x - Math.sin(this._camYaw) * dist,
      p.y + 2.9,
      p.z - Math.cos(this._camYaw) * dist
    );
    cam.position.lerp(this._camPos, Math.min(1, dt * 6));
    cam.lookAt(p.x, p.y + 0.7, p.z);
  }

  // ------------------------------------------------------------------ reviewer contract

  snapshot() {
    const v = this.velocity;
    return {
      position: [r4(this.position.x), r4(this.position.y), r4(this.position.z)],
      velocity: [r4(v.x), r4(v.y), r4(v.z)],
      speed: r4(Math.hypot(v.x, v.z)),
      verticalSpeed: r4(v.y),
      grounded: this.grounded,
      sliding: this.sliding,
      braking: this.braking,
      pivotRemaining: r4(this.pivot),
      state: this.state,
      lean: r4(this.lean),
      push: r4(this.push),
      takeoff: [r4(this.takeoffSpeed), r4(this.takeoffDir.x), r4(this.takeoffDir.y)],
      intent: [r4(this.moveX), r4(this.moveY)],
      basisYawDeg: r4((this._lastBasisYaw / DEG + 360) % 360),
      headingDeg: r4((Math.atan2(this.heading.x, -this.heading.y) / DEG + 360) % 360),
      slopeDeg: r4(this.slopeDeg),
      groundNormal: [r4(this.groundNormal.x), r4(this.groundNormal.y), r4(this.groundNormal.z)],
      coyoteRemaining: r4(this.coyote),
      stepBudget: r4(this.stepBudget),
      bufferRemaining: r4(this.jumpBuffer),
      airtime: r4(this.airtime),
      squash: r4(this.squash),
      landLock: r4(this.landLock),
      lastLand: this.lastLand,
      lastJump: this.lastJump,
      simTime: r4(this.simTime),
      spawnPoint: this._spawnPoint
        ? [r4(this._spawnPoint.x), r4(this._spawnPoint.y), r4(this._spawnPoint.z)]
        : null,
      voidLimit: r4(this.voidLimit),
      inputSource: this.externalInput ? "signals" : this.fallbackInput ? "keyboard-fallback" : "idle",
      cameraBasis: this._cameraOwned(),
      tunables: this.tune,
    };
  }

  dispose() {
    for (const off of this._offs) off?.();
    this._offs.length = 0;
  }
}
