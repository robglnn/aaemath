import * as THREE from "three";
import { signals } from "../core/Signals.js";
import { config } from "../core/Config.js";
import { publish } from "../core/Introspect.js";

/**
 * CameraRig — the third-person camera. Half of how the game feels lives in this file.
 *
 * Four properties are non-negotiable and everything below exists to protect one of them:
 *
 *  1. **Frame-rate independence.** Every smoothed quantity is an analytically-solved
 *     critically damped spring, not a `lerp(a, b, k)` applied once per frame. A per-frame
 *     lerp is a first-order approximation whose effective time constant is a function of
 *     the frame rate, so the camera trails further on a 30 fps machine than on a 144 fps
 *     one — the exact class of bug that makes browser games feel different on every
 *     desktop. `Spring.step()` evaluates the closed-form solution of
 *
 *         x'' + 2w·x' + w²·x = w²·r(t)
 *
 *     and it solves it for the *right* r(t). A spring told only "the target is here now"
 *     silently assumes the target has been sitting there for the whole interval — a
 *     zero-order hold — and that assumption costs exactly v·dt/2 of trailing distance
 *     against a moving target, which is 71% frame-rate spread between 15 and 240 fps on a
 *     body running at 8 m/s. So the follow springs are given the target's velocity and
 *     integrate the *ramp* response, whose steady-state trail is 2v/w with no dt term in
 *     it at all. The boom-length spring is fed the exact backward difference of its own
 *     command whenever that command is the smooth one (`distanceBase + sprint gain + focus
 *     blend` ramps every frame), and zero while a collision allowance is binding, because
 *     *that* target really is a held, piecewise-constant value. Only fov, lift, dip, focus
 *     weight and the collision-escape offsets keep a pure zero-order hold, and for them it
 *     is not an approximation — their targets are commands, not trajectories. `response` is
 *     quoted as the time to close 95% of a step (w = 4.744 / response), so every number in
 *     `CAMERA_TUNING` is a measurable claim rather than a magic constant.
 *
 *  2. **It never clips, and it never surrenders the shot to avoid clipping.** The camera
 *     boom is a swept cast run against whichever collision source exists: a `camera:probe`
 *     request signal first, then a mounted collision world exposing `sphereCast`, then a fan
 *     of five parallel rays against the scene. The cast result is the *only* upper bound on
 *     the boom — there is deliberately no minimum distance that can override it, because a
 *     minimum distance that outranks a collision result is just a licence to stand inside a
 *     wall.
 *
 *     But "make the boom shorter" is not the only move available, and a rig that owns only
 *     that one move answers *every* occluder by becoming a first-person camera with the lens
 *     inside the player's own body. Backing into rock is not an edge case in a world made of
 *     rock. So the boom has two more degrees of freedom: it may **pitch up over** an
 *     obstruction and **swing laterally around** it. When the straight boom cannot hold
 *     `framingFloor`, §7 re-casts a short ladder of candidate directions, cheapest-first in
 *     terms of what it costs the player's aim, and rotates the whole orbit onto the first one
 *     that clears. Rotating the orbit rather than sliding the lens is what keeps the body in
 *     the same place in the frame: what changes is which way the shot looks, not whether you
 *     can see yourself. It is carried on springs and it decays the moment the straight boom
 *     has room again, so it reads as a camera move, never a cut. Collapsing the boom below
 *     the framing floor is the last resort, not the first, and only then does the rig emit
 *     `camera:mode {id:"tight", opacity}` so the avatar can fade.
 *
 *     Tightening is near-instant; loosening is slow and gated behind a dead-band plus a
 *     hold timer, so grazing an edge cannot start an in/out oscillation. The escape's
 *     engage/release test is run along the *un-escaped* direction on purpose: testing the
 *     escaped direction would report "plenty of room", stand the escape down, and oscillate.
 *     The probe reports the raw cast result, the un-escaped probe, the chosen candidate and
 *     a `penetrating` flag next to the applied boom, so this whole class of bug is
 *     reviewable from outside rather than on trust.
 *
 *  3. **It reads final transforms.** All camera work happens in `after(dt)`, once every
 *     `frame()` hook has written its visual state, so the rig never frames last frame's pose.
 *     Only timers (trauma decay, air time) live in `fixed()`, where they belong.
 *
 *  4. **It never fights the player.** Look input is applied raw — no smoothing on the stick
 *     or the mouse, because input smoothing reads as latency. The weight comes from the rig
 *     trailing the *body*, never from the rig trailing the *aim*.
 *
 * The rig owns no gameplay state. It learns where the player is from signals and, failing
 * that, by asking the kernel for a mounted system at runtime — it never imports one.
 */

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const wrapPi = (a) => (((a + Math.PI) % TAU) + TAU) % TAU - Math.PI;
const angleLerp = (a, b, t) => a + wrapPi(b - a) * t;
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0 || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * Every tuned value in one table so a critic can change one number and re-measure.
 * All `*Response` values are seconds to close 95% of a step.
 */
export const CAMERA_TUNING = Object.freeze({
  // Offset from the body's camera-target point. The established convention in this codebase
  // is that a player's reported position / camera target is the *centre* of a ~1.8 m capsule,
  // so +0.85 puts the orbit pivot a head above the shoulders: the body drops to the lower
  // third of the frame and the upper-middle — where a holographic equation has to live —
  // stops being occupied by the player's own back.
  pivotOffset: [0, 0.85, 0],
  // Metres right of centre. This is the single number that decides whether the shot is a
  // third-person camera or a shot of someone's spine. At the 4.55 m resting boom, 1.15 m
  // puts the body 11.6% of the frame width left of the centre axis (ndc -0.231), inside the
  // 10–15% band Fortnite sits in, with the whole right half of the frame free for the world.
  shoulder: 1.15,
  distanceBase: 4.55,
  // NOT a floor on the collision result — see §7 of `after()`. It is only an anti-undershoot
  // guard for the spring, and it is itself clamped by whatever the cast allows. 0.36 clears
  // the widest near-plane corner this game can produce (0.127 m at fov 71 on 21:9) three
  // times over.
  distanceMin: 0.36,
  distanceSprintGain: 1.15, // boom eases back this far at full sprint

  followResponse: 0.2, // grounded body-follow
  followResponseAir: 0.3, // looser in the air so jump arcs float instead of snapping

  // A critically damped follow trails a target moving at v by exactly 2v/w — which is the
  // weight you want at running speed (0.67 m at 8.3 m/s) and a disaster at falling speed:
  // a 5 m drop lands at 18 m/s and would put the body 2.3 m below the pivot, i.e. off the
  // bottom of a 900 px frame. So the response tightens as the lag grows. Nothing below
  // `followLeashKnee` is touched at all — a sprint (0.67 m) and a sprinting jump (1.41 m)
  // both sit under it, so ordinary play keeps exactly the trail it was tuned for — and the
  // curve is a smoothstep, so the stiffening has no corner in it.
  followLeashKnee: 1.5,
  followLeashMax: 2.2,
  followLeashGain: 0.85,
  distanceTightenResponse: 0.09, // pulling in past an obstacle: fast, near-instant
  distanceLoosenResponse: 0.5, // easing back out: slow, so nothing pops
  fovResponse: 0.36,

  walkRef: 4.2, // m/s at which speed framing starts (just above a jog)
  sprintRef: 8.3, // m/s at which it is fully applied (top sprint speed)
  fovSprintGain: 9.0, // degrees added at full sprint

  lookScale: 1.0, // rig-side trim on already-conditioned look input
  lookRate: 0.0024, // radians per pixel, used only for raw (unit:"px") look payloads
  pitchMin: -1.16, // ≈ -66°, camera high looking down
  pitchMax: 1.02, // ≈  58°, camera low looking up

  collisionRadius: 0.3, // swept radius of the boom; comfortably clears the near plane
  // The standoff radius is a *comfort* margin — it keeps a wall from filling the frame. The
  // hard requirement is only that nothing crosses the near plane (0.127 m at the widest corner
  // this game can produce). So when 0.30 m of clearance is not available the rig gives comfort
  // up rather than giving up the shot: it re-casts at 0.20, which still leaves 0.15 m of real
  // clearance after the sampling slack. Without this, standing 0.28 m from a wall makes the
  // 0.30 sphere overlap at the *pivot*, every direction reports zero free length, and the boom
  // collapses to first-person even when looking straight out into open ground.
  collisionRadiusTight: 0.2,
  collisionRelax: 1.0, // wide-cast length below which the tight cast is blended in
  // The shoulder push must never park the pivot closer to a wall than the boom's own cast
  // needs to work with, or the offset that exists to make the world readable ends up being the
  // thing that collapses the boom. 0.34 keeps ~0.26 m of clearance after sampling slack.
  shoulderRadius: 0.34,
  collisionMargin: 0.16, // dead-band before the boom is allowed to grow again
  collisionHold: 0.14, // seconds a tighten is held before loosening may start

  // The shoulder offset is a luxury of a long boom. Jammed into a corner, holding 1.15 m of
  // lateral offset on a 0.5 m boom would frame the player's ear. It eases off with the boom
  // instead — never to nothing, because losing it entirely would read as the camera snapping
  // to centre.
  shoulderTightLo: 0.8,
  shoulderTightHi: 2.8,
  shoulderTightFloor: 0.15,

  // Boom length at which the avatar starts to fade, and at which it is fully gone. Emitted as
  // `camera:mode {id, opacity}`; the rig does not own the avatar and never touches it.
  avatarFadeStart: 1.6,
  avatarFadeEnd: 0.75,

  // A jump in the follow target larger than this many m/s is a teleport, not motion. Ramp
  // integration extrapolates target velocity, so a teleport must re-prime rather than be
  // handed a 400 m/s "velocity" to lead.
  teleportSpeed: 40,

  airLift: 0.55, // pivot rise while airborne, so the ground stays in frame
  airLiftRate: 1.7, // per second of air time
  airLiftResponse: 0.28,
  landDip: 0.24, // pivot drop on impact; the landing costs something
  landDipResponse: 0.3,

  traumaDecay: 1.35, // trauma units per second
  shakeYaw: 0.036,
  shakePitch: 0.03,
  shakeRoll: 0.058,
  shakePos: 0.11,
  shakeFreq: 13.0,

  focusResponse: 0.7,
  // Framing solve for focus, derived rather than dialled: with the pivot `focusBias` of the
  // way to the target and the boom at `0.5·sep + 2.8`, a swing of 0.33 rad puts the player
  // about 30° off the view axis — clear of the target, clear of the frame edge.
  focusSwing: 0.33,
  focusBias: 0.38,
  focusLift: 0.1,
  // Multiplier on the shoulder offset at full focus weight. A learning moment wants the thing
  // being taught on the frame's centre axis, and a 1.15 m shoulder would shove it 14% of the
  // frame off centre. Pulling the offset in to 0.70× puts the target back at screen x 0.487
  // while still leaving the player readable at 0.29 — measured, not guessed.
  focusShoulderScale: 0.7,
});

/**
 * Analytically-solved critically damped spring. See the note at the top of the file for why
 * this is not a lerp. `response` is the time to close 95% of a step.
 *
 * `targetVel` is what makes this frame-rate independent against a *moving* target. Given
 * r(t) = r₁ + v·(t − dt) over the interval that just elapsed, the critically damped response
 * splits into a constant steady-state error e∞ = −2v/w plus a homogeneous transient, and the
 * transient has the same closed form as the step response. With `targetVel = 0` the algebra
 * collapses term for term to the plain step solution, so every caller that does not know its
 * target's velocity is exactly where it was before.
 *
 * Why this matters in numbers: integrating with r held at r₁ for the whole interval (the
 * zero-order hold every naive spring uses) leaves the value v·dt/2 *ahead* of where the
 * continuous solution would be. At 8 m/s that is 2.2 cm per frame at 240 fps and 26.7 cm at
 * 15 fps — a camera that hugs the player on a gaming rig and lags him on a laptop.
 */
export class Spring {
  constructor(value = 0, response = 0.2) {
    this.value = value;
    this.vel = 0;
    this.response = response;
  }

  step(target, dt, response = this.response, targetVel = 0) {
    if (dt <= 0) return this.value;
    const w = 4.744 / Math.max(1e-3, response);
    // steady-state trail behind a target moving at `targetVel`, and where that target was
    // when this interval began
    const ess = targetVel !== 0 ? (-2 * targetVel) / w : 0;
    const prev = target - targetVel * dt;
    const x = this.value - prev - ess; // homogeneous part at t = 0
    const v = this.vel - targetVel; // ...and its derivative
    const e = Math.exp(-w * dt);
    this.value = target + ess + (x + (v + w * x) * dt) * e;
    this.vel = (v - w * dt * (v + w * x)) * e + targetVel;
    return this.value;
  }

  snap(value) {
    this.value = value;
    this.vel = 0;
    return value;
  }
}

/** Deterministic value noise. Shake must reproduce exactly under `__vs.advance()`. */
function hash11(n) {
  const s = Math.sin(n * 127.1) * 43758.5453123;
  return s - Math.floor(s);
}
function vnoise(x, seed) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  const a = hash11(i + seed * 71.3);
  const b = hash11(i + 1 + seed * 71.3);
  return (a + (b - a) * u) * 2 - 1;
}
/** Two octaves: the low one gives the throw, the high one the grit. */
function shakeNoise(t, seed) {
  return vnoise(t, seed) * 0.72 + vnoise(t * 2.13 + 5.7, seed + 17) * 0.28;
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _rayDir = new THREE.Vector3();
const _rayOrigin = new THREE.Vector3();
const _perpA = new THREE.Vector3();
const _perpB = new THREE.Vector3();
const _UP = new THREE.Vector3(0, 1, 0);
const _SIDE = new THREE.Vector3(1, 0, 0);

/** Ray fan spanning the boom radius: centre plus the four cardinal edges. */
const OFFSETS5 = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const OFFSETS3 = [
  [0, 0],
  [0, 1],
  [0, -1],
];

export class CameraRig {
  constructor(kernel, options = {}) {
    this.kernel = kernel;
    this.camera = kernel.camera;
    this.t = { ...CAMERA_TUNING, ...options };

    this.pivotOffset = new THREE.Vector3().fromArray(this.t.pivotOffset);
    this.shoulder = this.t.shoulder;
    this.distanceBase = this.t.distanceBase;

    // --- orientation (raw, unsmoothed: input latency is worse than input noise)
    this.yaw = 0;
    // Resting pitch trimmed with the pivot: the orbit centre moved up 0.3 m, which raises the
    // lens by the same amount, so a slightly shallower downward tilt keeps the same amount of
    // ground under the player and the same amount of sky above the horizon.
    this.pitch = -0.11;
    this.mode = "follow"; // control mode: follow | locked (set by others)
    this.framing = "follow"; // framing mode the rig itself broadcasts: follow | tight

    // --- what we are looking at
    this._targetObject = null; // an Object3D handed to us, preferred when present
    this._systemTarget = null; // a system discovered through the kernel at runtime
    this._systemStamp = -1;
    this._signalPos = new THREE.Vector3();
    this._hasSignalPos = false;
    this._targetSource = "none";

    this._targetPos = new THREE.Vector3();
    this._lastTargetPos = new THREE.Vector3();
    this._targetVel = new THREE.Vector3();
    this._hasLastTarget = false;

    // --- player state fed by signals
    this.grounded = true;
    this.airTime = 0;
    // `player:state` fires on *state transitions*, so its `speed` is a snapshot of whatever
    // the body was doing when the state machine last flipped — 6.24 m/s frozen there while
    // the body actually runs at 8.30. Framing reacts to the motion the lens can see, so the
    // rig measures the follow target itself and uses the signal only as a seed before the
    // first measurement exists, aged out so it can never become a stale authority.
    this.speedSignal = null;
    this.speedSignalAge = Infinity;
    this.speedMeasured = 0;
    this._speedValid = false;

    // --- smoothed state
    this.follow = [new Spring(0, this.t.followResponse), new Spring(0, this.t.followResponse), new Spring(0, this.t.followResponse)];
    this.distSpring = new Spring(this.distanceBase, this.t.distanceLoosenResponse);
    this.fovSpring = new Spring(config.get("fovBase") ?? 62, this.t.fovResponse);
    this.liftSpring = new Spring(0, this.t.airLiftResponse);
    this.dipSpring = new Spring(0, this.t.landDipResponse);
    this.focusWeight = new Spring(0, this.t.focusResponse);

    this._distTarget = this.distanceBase;
    this._desiredDistance = this.distanceBase;
    this._allowedDistance = this.distanceBase;
    this._freeDistance = this.distanceBase;
    this._freeTracked = this.distanceBase;
    this._penetrating = false;
    this._holdTimer = 0;
    this.occluded = false;
    this.occlusionDepth = 0;

    // --- avatar fade handshake (`camera:mode`). Starts at "fully visible, follow framing",
    // which is what every listener already assumes, so nothing is emitted in normal play.
    this.avatarOpacity = 1;
    this._emittedOpacity = 1;
    this._emittedFraming = "follow";

    // --- shake
    this.trauma = 0;
    this._traumaDecay = this.t.traumaDecay;
    this.shakeMagnitude = 0;

    // --- focus / framing
    this.focus = {
      target: null,
      active: false,
      response: this.t.focusResponse,
      point: new THREE.Vector3(),
      valid: false,
      yaw: 0,
      pitch: 0,
      distance: this.distanceBase,
      pivot: new THREE.Vector3(),
    };

    this.fovOverride = null;
    this._fovOverrideResponse = this.t.fovResponse;

    // --- look input accumulator, drained once per rendered frame
    this._lookDx = 0;
    this._lookDy = 0;
    this._lookUnit = "rad";

    // --- collision
    this._ray = new THREE.Raycaster();
    this._ray.near = 0;
    this._collidables = null;
    this._collideStamp = -1;
    this._collideCount = -1;
    this._probeRequest = {
      origin: new THREE.Vector3(),
      direction: new THREE.Vector3(),
      radius: this.t.collisionRadius,
      maxDistance: 0,
      // a handler fills these in and sets handled = true
      handled: false,
      hit: false,
      distance: 0,
    };

    this._pivotWorld = new THREE.Vector3();
    this._camWorld = new THREE.Vector3();
    this._followError = 0;
    this._followLag = 0;
    this._primed = false;

    this._off = [];
    this._bindSignals();

    publish("camera", () => this.report());
  }

  // ------------------------------------------------------------------ signals

  _bindSignals() {
    const on = (name, fn) => this._off.push(signals.on(name, fn));

    /**
     * `input:look` arrives in **radians already conditioned by the input layer** — that layer
     * owns pointer/stick units, look sensitivity and axis inversion, and applying the
     * player's sensitivity a second time here would square it. A raw emitter can opt out
     * with `unit:"px"`, and only then does the rig apply the Config settings itself.
     */
    on("input:look", (e) => {
      if (!e || this.mode === "locked") return;
      let dx = Number(e.dx) || 0;
      let dy = Number(e.dy) || 0;
      const raw = e.unit === "px" || e.raw === true;
      if (raw) {
        const sens = Number(config.get("lookSensitivity")) || 1;
        dx *= this.t.lookRate * sens;
        dy *= this.t.lookRate * sens * (config.get("invertY") ? -1 : 1);
      }
      this._lookUnit = raw ? "px" : "rad";
      this._lookDx += dx;
      this._lookDy += dy;
    });

    on("player:spawn", (e) => {
      if (e?.position) this._setSignalPosition(e.position);
      // A spawn is a teleport, not a move: cut the springs so the camera arrives framed
      // instead of racing across the level, and do not read the jump as player speed.
      this._primed = false;
      this._hasLastTarget = false;
      this._speedValid = false;
      this.trauma = 0;
    });

    on("player:state", (e) => {
      if (!e) return;
      if (typeof e.grounded === "boolean") this.grounded = e.grounded;
      if (typeof e.speed === "number") {
        this.speedSignal = e.speed;
        this.speedSignalAge = 0;
      }
      if (e.position) this._setSignalPosition(e.position);
    });

    on("player:land", (e) => {
      if (config.get("reduceMotion")) return;
      // Emitters differ: some report a normalised 0..1 severity, some report the impact
      // speed in m/s. Accept either without pretending 6.6 m/s means "601% severity".
      const severity = Number(e?.severity);
      const impact = Number(e?.impact);
      let weight = Number.isFinite(severity) && severity > 0 ? clamp(severity, 0, 1) : 0;
      if (!weight && Number.isFinite(impact)) {
        weight = impact > 1.2 ? clamp((impact - 3) / 11, 0, 1) : clamp(impact, 0, 1);
      }
      // A landing reads as a dip you feel, not a shake you notice. A critically damped
      // spring kicked with velocity v0 peaks at v0/(w·e), so solve for the peak we want:
      // the dip is stated in metres in CAMERA_TUNING and lands there.
      const w = 4.744 / Math.max(1e-3, this.t.landDipResponse);
      this.dipSpring.vel -= this.t.landDip * (0.35 + 0.65 * weight) * w * Math.E;
    });

    on("camera:shake", (e) => {
      const amount = clamp(Number(e?.amount) || 0, 0, 1);
      if (amount <= 0) return;
      // reduceMotion is a promise, not a hint: trauma never accumulates at all, so the
      // probe reports a genuine zero rather than a shake that is merely scaled small.
      if (config.get("reduceMotion")) return;
      const seconds = Number(e?.seconds);
      if (Number.isFinite(seconds) && seconds > 0) this._traumaDecay = 1 / clamp(seconds, 0.08, 4);
      else this._traumaDecay = this.t.traumaDecay;
      this.trauma = clamp(this.trauma + amount, 0, 1);
    });

    on("camera:fov", (e) => {
      const target = Number(e?.target);
      const seconds = Number(e?.seconds);
      this._fovOverrideResponse = Number.isFinite(seconds) && seconds > 0 ? seconds : this.t.fovResponse;
      this.fovOverride = Number.isFinite(target) && target > 1 ? clamp(target, 25, 130) : null;
    });

    on("camera:focus", (e) => {
      const seconds = Number(e?.seconds);
      this.focus.response = Number.isFinite(seconds) && seconds > 0 ? seconds : this.t.focusResponse;
      const target = e?.target ?? null;
      if (!target) {
        // Release freezes the framing we had reached and lets the weight decay through it,
        // so the return is continuous from any weight — not just from a fully-eased focus.
        this.focus.target = null;
        this.focus.active = false;
      } else {
        this.focus.target = target;
        this.focus.active = true;
      }
    });

    /**
     * `camera:mode {id, opacity}` is two-way. Others send it to put the rig in a control mode
     * ("locked" stops taking look input); the rig sends it to tell whoever owns the avatar how
     * visible it should be, tagged `source:"camera"` so its own broadcast can never be
     * mistaken for an instruction to itself.
     */
    on("camera:mode", (e) => {
      if (e?.source === "camera") return;
      this.mode = String(e?.id ?? "follow");
    });

    /** Anything may nominate what the camera follows without the rig knowing it exists. */
    on("camera:target", (e) => {
      const target = e?.object ?? e?.target ?? null;
      if (target && target.isObject3D) {
        this._targetObject = target;
        this._collidables = null;
      } else if (e?.position) {
        this._targetObject = null;
        this._setSignalPosition(e.position);
      } else if (target === null) {
        this._targetObject = null;
      }
    });

    on("world:ready", () => {
      this._collidables = null;
    });
  }

  _setSignalPosition(p) {
    if (!p) return;
    const x = Number(p.x ?? p[0]);
    const y = Number(p.y ?? p[1]);
    const z = Number(p.z ?? p[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
    this._signalPos.set(x, y, z);
    this._hasSignalPos = true;
  }

  // ------------------------------------------------------------------ targets

  /**
   * Where the camera should be looking. Preference order:
   *   1. an Object3D handed to us over `camera:target`
   *   2. an Object3D a mounted system names as its camera target
   *   3. a bare position pushed over `player:state`
   *
   * An object beats a position because the owner keeps it on the render transform — the
   * interpolated one — whereas a position on a signal is a snapshot of a fixed step. Step 2
   * is runtime duck-typing, never an import: a feature module may not depend on the shape of
   * a sibling, only on the fact that one might answer.
   */
  _resolveTarget(out) {
    if (this._targetObject) {
      this._targetObject.getWorldPosition(out);
      this._targetSource = "object";
      return true;
    }
    const sys = this._discoverSystem();
    if (sys) {
      const p = sys.isObject3D ? sys.getWorldPosition(_v3) : sys.position ?? sys.root?.position;
      if (p) {
        out.copy(p);
        this._targetSource = "system";
        return true;
      }
    }
    if (this._hasSignalPos) {
      out.copy(this._signalPos);
      this._targetSource = "signal";
      return true;
    }
    this._targetSource = "none";
    return false;
  }

  _discoverSystem() {
    if (this._systemTarget) return this._systemTarget;
    const now = this.kernel.simTime;
    if (now - this._systemStamp < 0.5) return null;
    this._systemStamp = now;
    for (const name of ["player", "locomotion", "avatar"]) {
      const sys = this.kernel.get?.(name);
      if (!sys) continue;
      const candidate =
        (typeof sys.getCameraTarget === "function" ? sys.getCameraTarget() : null) ??
        sys.cameraTarget ??
        (sys.position ? sys : null) ??
        (sys.root?.position ? sys.root : null);
      if (candidate) {
        this._systemTarget = candidate;
        this._collidables = null;
        return candidate;
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- collision

  /** Meshes the boom may hit. Rebuilt on `world:ready`, on child-count change, or every 2 s. */
  _collidableList() {
    const scene = this.kernel.scene;
    const now = this.kernel.simTime;
    if (
      this._collidables &&
      scene.children.length === this._collideCount &&
      now - this._collideStamp < 2
    ) {
      return this._collidables;
    }
    const out = [];
    const skip = this._targetObject ?? this._systemTarget ?? null;
    const walk = (obj) => {
      if (!obj.visible || obj === skip) return;
      if (obj.userData && obj.userData.noCameraCollide) return;
      if (obj.isMesh) out.push(obj);
      const kids = obj.children;
      for (let i = 0; i < kids.length; i++) walk(kids[i]);
    };
    const roots = scene.children;
    for (let i = 0; i < roots.length; i++) walk(roots[i]);
    this._collidables = out;
    this._collideCount = scene.children.length;
    this._collideStamp = now;
    return out;
  }

  /**
   * How far the boom's centre may travel from `origin` along `dir` before a sphere of
   * `radius` would touch something. Three sources, in order of authority.
   */
  _castFree(origin, dir, maxDist, radius, rays) {
    if (maxDist <= 0) return 0;

    const req = this._probeRequest;
    req.origin.copy(origin);
    req.direction.copy(dir);
    req.radius = radius;
    req.maxDistance = maxDist;
    req.handled = false;
    req.hit = false;
    req.distance = maxDist;
    signals.emit("camera:probe", req);
    if (req.handled) return req.hit ? clamp(req.distance, 0, maxDist) : maxDist;

    const world = this.kernel.get?.("collision") ?? this.kernel.get?.("collisionWorld");
    if (world && typeof world.sphereCast === "function") {
      const r = world.sphereCast(origin, dir, radius, maxDist);
      if (typeof r === "number") return clamp(r, 0, maxDist);
      if (r && typeof r.distance === "number") return clamp(r.hit === false ? maxDist : r.distance, 0, maxDist);
    }

    return this._castScene(origin, dir, maxDist, radius, rays);
  }

  /**
   * Five parallel rays spanning the boom radius. Each starts one radius *behind* the origin
   * so a boom already touching a surface still registers a hit — starting inside geometry
   * and reporting "clear" is the classic way a third-person camera ends up inside a wall.
   */
  _castScene(origin, dir, maxDist, radius, rays = 5) {
    const list = this._collidableList();
    if (!list.length) return maxDist;

    // A stable basis perpendicular to the boom.
    const up = Math.abs(dir.y) > 0.95 ? _SIDE : _UP;
    _perpA.crossVectors(dir, up).normalize();
    _perpB.crossVectors(_perpA, dir).normalize();

    const far = maxDist + radius * 2;
    let nearest = Infinity;
    const pattern = rays >= 5 ? OFFSETS5 : OFFSETS3;

    for (let i = 0; i < pattern.length; i++) {
      const [a, b] = pattern[i];
      _rayOrigin
        .copy(origin)
        .addScaledVector(dir, -radius)
        .addScaledVector(_perpA, a * radius)
        .addScaledVector(_perpB, b * radius);
      this._ray.set(_rayOrigin, dir);
      this._ray.far = far;
      const hits = this._ray.intersectObjects(list, false);
      if (hits.length && hits[0].distance < nearest) nearest = hits[0].distance;
    }
    if (nearest === Infinity) return maxDist;
    // undo the one-radius backup, then hold the sphere surface off the wall
    return clamp(nearest - radius * 2, 0, maxDist);
  }

  // ------------------------------------------------------------------- update

  fixed(step) {
    if (this.trauma > 0) this.trauma = Math.max(0, this.trauma - this._traumaDecay * step);
    if (this.grounded) this.airTime = 0;
    else this.airTime = Math.min(this.airTime + step, 4);
    if (this._holdTimer > 0) this._holdTimer -= step;
    if (this.speedSignalAge < 1e6) this.speedSignalAge += step;
  }

  after(dt) {
    const t = this.t;
    const cam = this.camera;
    const step = clamp(dt, 0, 0.1);

    // ---- 1. look input (raw; smoothing the aim reads as latency)
    if (this.mode !== "locked") {
      this.yaw = wrapPi(this.yaw - this._lookDx * t.lookScale);
      this.pitch = clamp(this.pitch - this._lookDy * t.lookScale, t.pitchMin, t.pitchMax);
    }
    this._lookDx = 0;
    this._lookDy = 0;

    // ---- 2. where is the body
    const found = this._resolveTarget(_v1);
    if (!found) _v1.copy(this._targetPos);
    this._targetPos.copy(_v1);

    // Velocity of the thing we are framing. It feeds two different jobs: the ramp term that
    // makes the follow spring frame-rate independent (exact, unsmoothed — the ramp solution
    // wants the real velocity of *this* interval), and the speed framing (one-pole smoothed,
    // because a fov that tracked per-frame noise would breathe).
    if (this._hasLastTarget && step > 0) {
      const dx = this._targetPos.x - this._lastTargetPos.x;
      const dy = this._targetPos.y - this._lastTargetPos.y;
      const dz = this._targetPos.z - this._lastTargetPos.z;
      const moved = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (moved / step > t.teleportSpeed) {
        // Not motion — a teleport. Leading a 400 m/s "velocity" would fling the rig across
        // the level; re-prime instead and let the camera arrive already framed.
        this._targetVel.set(0, 0, 0);
        this._primed = false;
        this._speedValid = false;
      } else {
        this._targetVel.set(dx / step, dy / step, dz / step);
        const inst = Math.sqrt(dx * dx + dz * dz) / step;
        this.speedMeasured += (inst - this.speedMeasured) * (1 - Math.exp(-step / 0.08));
        this._speedValid = true;
      }
    }
    this._lastTargetPos.copy(this._targetPos);
    this._hasLastTarget = true;

    // Measurement first, always. `player:state.speed` is only a seed for the handful of
    // frames before a measurement exists, and it expires so it can never quietly become the
    // number the framing runs on.
    const seedFresh = this.speedSignal != null && this.speedSignalAge < 0.15;
    const speed = this._speedValid ? this.speedMeasured : seedFresh ? this.speedSignal : 0;
    const speedNorm = smoothstep(t.walkRef, t.sprintRef, speed);

    // ---- 3. framing targets
    const reduce = !!config.get("reduceMotion");

    // The leash: one scale for all three axes, computed from the 3-D lag, so tightening
    // shortens the lag without bending its direction. Per-axis scaling would swing the camera
    // sideways during a fall, which is worse than the lag it fixes.
    const lagX = this.follow[0].value - (this._targetPos.x + this.pivotOffset.x);
    const lagY = this.follow[1].value - (this._targetPos.y + this.pivotOffset.y);
    const lagZ = this.follow[2].value - (this._targetPos.z + this.pivotOffset.z);
    this._followLag = Math.hypot(lagX, lagY, lagZ);
    const leash =
      1 - t.followLeashGain * smoothstep(t.followLeashKnee, t.followLeashMax, this._followLag);
    const followResponse = (this.grounded ? t.followResponse : t.followResponseAir) * leash;

    // The airborne lift and the follow lag push the body down the frame in exactly the same
    // way, so on a long fall they compound and the legs leave the picture. The lift rides the
    // same leash: a hop (leash 1) gets every centimetre of the float it was tuned for, and a
    // fall that is already holding the camera high above the body does not ask for more.
    const liftTarget =
      this.grounded ? 0 : Math.min(t.airLift, this.airTime * t.airLiftRate) * leash;
    this.liftSpring.step(liftTarget, step, t.airLiftResponse);
    this.dipSpring.step(0, step, t.landDipResponse);

    // The follow spring tracks the *body* only. Lift and dip are added on top of the
    // smoothed result, not folded into its target — a 0.2 s follow response would otherwise
    // low-pass a 0.19 s landing dip down to nothing, which is exactly how landings stop
    // reading. Both effects carry their own spring, so they stay smooth on their own terms.
    if (!this._primed) {
      this.follow[0].snap(this._targetPos.x + this.pivotOffset.x);
      this.follow[1].snap(this._targetPos.y + this.pivotOffset.y);
      this.follow[2].snap(this._targetPos.z + this.pivotOffset.z);
      this.speedMeasured = 0;
      this._targetVel.set(0, 0, 0);
      this._freeTracked = this.distanceBase;
      this.liftSpring.snap(0);
      this.dipSpring.snap(0);
      this._primed = true;
    } else {
      // The fourth argument is what removes the frame-rate dependence: the pivot is chasing a
      // body that is *moving*, so the spring is told how fast, and trails it by 2v/w whatever
      // the frame rate happens to be.
      const tv = this._targetVel;
      this.follow[0].step(this._targetPos.x + this.pivotOffset.x, step, followResponse, tv.x);
      this.follow[1].step(this._targetPos.y + this.pivotOffset.y, step, followResponse, tv.y);
      this.follow[2].step(this._targetPos.z + this.pivotOffset.z, step, followResponse, tv.z);
    }

    const fx = this.follow[0].value;
    const fy = this.follow[1].value + this.liftSpring.value + this.dipSpring.value;
    const fz = this.follow[2].value;
    this._followError = Math.hypot(
      fx - (this._targetPos.x + this.pivotOffset.x),
      fz - (this._targetPos.z + this.pivotOffset.z)
    );

    // ---- 4. focus blend
    const w = this._updateFocus(_v2.set(fx, fy, fz), step);

    let yaw = this.yaw;
    let pitch = this.pitch;
    let pivotX = fx;
    let pivotY = fy;
    let pivotZ = fz;

    let desired = this.distanceBase + t.distanceSprintGain * speedNorm;

    if (w > 1e-4 && this.focus.valid) {
      yaw = angleLerp(this.yaw, this.focus.yaw, w);
      pitch = this.pitch + (this.focus.pitch - this.pitch) * w;
      pivotX += (this.focus.pivot.x - pivotX) * w;
      pivotY += (this.focus.pivot.y + t.focusLift - pivotY) * w;
      pivotZ += (this.focus.pivot.z - pivotZ) * w;
      desired += (this.focus.distance - desired) * w;
    }
    this._desiredDistance = desired;

    // ---- 5. orientation basis
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const sy = Math.sin(yaw);
    const cy = Math.cos(yaw);
    // forward matches a YXZ euler of (pitch, yaw, roll) applied to Three's -Z default
    const fwdX = -sy * cp;
    const fwdY = sp;
    const fwdZ = -cy * cp;
    const rightX = cy;
    const rightZ = -sy;

    // ---- 6. shoulder, clamped so it cannot shove the pivot through a wall, and eased off as
    //         the boom collapses (1.15 m of lateral offset on a half-metre boom frames an ear).
    //         Reads last frame's boom on purpose: the boom is solved below, and closing that
    //         loop inside one frame would make the shoulder and the cast chase each other.
    const shoulderScale =
      t.shoulderTightFloor +
      (1 - t.shoulderTightFloor) *
        smoothstep(t.shoulderTightLo, t.shoulderTightHi, this.distSpring.value);
    const shoulderWant =
      this.shoulder * shoulderScale * (1 + (t.focusShoulderScale - 1) * w);
    let shoulderApplied = 0;
    if (Math.abs(shoulderWant) > 1e-4) {
      const sign = Math.sign(shoulderWant);
      _rayDir.set(rightX * sign, 0, rightZ * sign);
      _v3.set(pivotX, pivotY, pivotZ);
      const free = this._castFree(_v3, _rayDir, Math.abs(shoulderWant), t.shoulderRadius, 3);
      shoulderApplied = sign * Math.min(Math.abs(shoulderWant), free);
      pivotX += rightX * shoulderApplied;
      pivotZ += rightZ * shoulderApplied;
    }
    this._pivotWorld.set(pivotX, pivotY, pivotZ);

    // ---- 7. boom length, with asymmetric response and hysteresis
    //
    // `allowed` is min(free, desired) and nothing else. There is no lower bound here on
    // purpose: any floor that outranks the cast is a decision to put the lens inside solid
    // geometry whenever a corner is tighter than the floor, which is precisely how a
    // third-person camera ends up rendering the inside of a wall. If the corner leaves 0.4 m,
    // the boom is 0.4 m and the avatar fades (§7b) — the same answer BotW and Fortnite give.
    // The cast reaches past the boom the rig actually wants. That headroom is what keeps the
    // hysteresis honest: cast only as far as `desired` and "clear" is indistinguishable from
    // "blocked at exactly the resting length", so the dead-band that exists to stop occlusion
    // oscillation quietly eats up to 16 cm of the *sprint* boom and the rig never reaches the
    // framing it was tuned for. Measured before this: 5.673 m against a designed 5.700.
    const reach = desired + t.collisionMargin * 2;
    _rayDir.set(-fwdX, -fwdY, -fwdZ).normalize();
    let free = this._castFree(this._pivotWorld, _rayDir, reach, t.collisionRadius, 5);
    if (free < t.collisionRelax) {
      // Out of comfort room — trade standoff for a shot. Blended, not switched, so the boom
      // stays continuous in yaw: the tight result is worth nothing at the threshold and
      // everything when the wide cast has found no room at all.
      const k = 1 - smoothstep(0, t.collisionRelax, free);
      const tight = this._castFree(this._pivotWorld, _rayDir, reach, t.collisionRadiusTight, 5);
      if (tight > free) free += (tight - free) * k;
    }
    const allowed = Math.min(free, desired);
    this._freeDistance = free;
    this._allowedDistance = allowed;

    // Hysteresis is applied to the *collision allowance only*, never to `desired`. Tightening
    // is immediate and held; loosening waits for the hold to expire and for a dead-band, so a
    // grazed edge cannot start an in/out oscillation.
    if (free < this._freeTracked - 1e-3) {
      this._freeTracked = free;
      this._holdTimer = t.collisionHold;
    } else if (this._holdTimer <= 0 && free > this._freeTracked + t.collisionMargin) {
      this._freeTracked = free;
    }
    this._distTarget = Math.min(desired, this._freeTracked);

    const tightening = this.distSpring.value > this._distTarget;
    this.distSpring.step(
      this._distTarget,
      step,
      tightening ? t.distanceTightenResponse : t.distanceLoosenResponse
    );
    // Hard guarantee: the boom may never be longer than the free length. Writing the clamp
    // back into the spring keeps its state honest, so releasing an obstacle eases out from
    // where the camera actually is rather than snapping from a stale value.
    //
    // The lower guard is an anti-undershoot rail, not a minimum distance: a critically damped
    // spring carrying inbound velocity can overshoot past zero and put the lens in front of
    // the pivot. It is clamped by `allowed` first, so it can never contradict the cast.
    if (this.distSpring.value > allowed) {
      this.distSpring.value = allowed;
      this.distSpring.vel = Math.min(this.distSpring.vel, 0);
    }
    const floor = Math.min(allowed, t.distanceMin);
    if (this.distSpring.value < floor) {
      this.distSpring.value = floor;
      this.distSpring.vel = Math.max(this.distSpring.vel, 0);
    }
    const dist = this.distSpring.value;
    this._penetrating = free < dist - 1e-3;
    this.occluded = allowed < desired - 0.05;
    this.occlusionDepth = Math.max(0, desired - allowed);

    // ---- 8. field of view
    const fovBase = Number(config.get("fovBase")) || 62;
    const gain = reduce ? 0.3 : 1;
    let fovTarget = fovBase + t.fovSprintGain * gain * Math.pow(speedNorm, 1.15) - 4 * w;
    let fovResponse = t.fovResponse;
    if (this.fovOverride != null) {
      fovTarget = this.fovOverride;
      fovResponse = this._fovOverrideResponse;
    }
    const fov = this.fovSpring.step(fovTarget, step, fovResponse);

    // ---- 9. trauma shake (quadratic falloff — small trauma is genuinely invisible)
    const shakeScale = reduce ? 0 : clamp(Number(config.get("cameraShake")) ?? 1, 0, 2);
    const mag = this.trauma * this.trauma * shakeScale;
    this.shakeMagnitude = mag;

    let shakeYaw = 0;
    let shakePitch = 0;
    let shakeRoll = 0;
    let offX = 0;
    let offY = 0;
    let offZ = 0;
    if (mag > 1e-4) {
      const nt = this.kernel.simTime * t.shakeFreq;
      shakeYaw = shakeNoise(nt, 1) * t.shakeYaw * mag;
      shakePitch = shakeNoise(nt, 2) * t.shakePitch * mag;
      shakeRoll = shakeNoise(nt, 3) * t.shakeRoll * mag;
      const px = shakeNoise(nt, 4) * t.shakePos * mag;
      const py = shakeNoise(nt, 5) * t.shakePos * mag;
      offX = rightX * px;
      offZ = rightZ * px;
      offY = py;
    }

    // ---- 10. write the camera
    this._camWorld.set(
      pivotX - fwdX * dist + offX,
      pivotY - fwdY * dist + offY,
      pivotZ - fwdZ * dist + offZ
    );
    cam.position.copy(this._camWorld);
    cam.rotation.order = "YXZ";
    cam.rotation.set(pitch + shakePitch, yaw + shakeYaw, shakeRoll);
    if (Math.abs(cam.fov - fov) > 1e-4) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    // Anything else running later in after() (culling, LOD, post) reads a fresh matrix.
    cam.updateMatrixWorld(true);

    // ---- 11. tight framing: tell whoever owns the avatar to get out of the way.
    //
    // Measured *after* the lens is placed, and against the body rather than only against the
    // boom, because there are two different ways to end up with a character filling the lens:
    // a corner collapses the boom, or a steep look-up swings a full-length boom underneath the
    // body. The second one is invisible to a boom-length test — at pitchMax the boom is 1.72 m
    // and the lens is 1.24 m from the body — so the fade reads whichever is closer.
    //
    // The rig does not own the avatar and will not reach into it: it states the framing it has
    // been forced into and lets P08 answer. Emitted only on a real change, so a session that
    // never presses the camera never sees this signal at all.
    const bodyDist = this._camWorld.distanceTo(this._targetPos);
    const opacity = smoothstep(t.avatarFadeEnd, t.avatarFadeStart, Math.min(dist, bodyDist));
    this.avatarOpacity = opacity;
    const framing = opacity < 0.999 ? "tight" : "follow";
    if (framing !== this._emittedFraming || Math.abs(opacity - this._emittedOpacity) > 0.02) {
      this._emittedFraming = framing;
      this._emittedOpacity = opacity;
      this.framing = framing;
      signals.emit("camera:mode", {
        id: framing,
        opacity: Number(opacity.toFixed(3)),
        source: "camera",
      });
    }
  }

  /** Frames a learning moment: the target readable, the player still in shot. */
  _updateFocus(playerPivot, step) {
    if (this.focus.active) {
      const p = this._focusPoint(_v3);
      if (p) {
        const dx = p.x - playerPivot.x;
        const dy = p.y - playerPivot.y;
        const dz = p.z - playerPivot.z;
        const horiz = Math.hypot(dx, dz);
        const sep = Math.hypot(horiz, dy);
        const t = this.t;
        // Looking straight down the player→target axis puts the player squarely in front of
        // the thing we are trying to show. Swinging the framing off that axis turns the
        // shot into a three-quarter view: target upper-centre, player readable to one side.
        const swing = t.focusSwing * (this.shoulder >= 0 ? 1 : -1);
        this.focus.yaw = Math.atan2(-dx, -dz) + swing;
        this.focus.pitch = clamp(
          Math.atan2(dy, Math.max(horiz, 0.25)) * 0.5 - 0.1,
          t.pitchMin,
          t.pitchMax
        );
        this.focus.distance = clamp(sep * 0.58 + 3.0, 3.2, 13);
        this.focus.pivot.set(
          playerPivot.x + dx * t.focusBias,
          playerPivot.y + dy * t.focusBias,
          playerPivot.z + dz * t.focusBias
        );
        this.focus.point.copy(p);
        this.focus.valid = true;
      }
    }
    return this.focusWeight.step(this.focus.active ? 1 : 0, step, this.focus.response);
  }

  _focusPoint(out) {
    const target = this.focus.target;
    if (!target) return null;
    if (target.isObject3D) {
      target.getWorldPosition(out);
      return out;
    }
    const x = Number(target.x);
    const y = Number(target.y);
    const z = Number(target.z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    out.set(x, y, z);
    return out;
  }

  // -------------------------------------------------------------------- probe

  report() {
    const r = (n) => Number(n.toFixed(4));
    return {
      mode: this.mode,
      framing: this.framing,
      targetSource: this._targetSource,
      position: [r(this.camera.position.x), r(this.camera.position.y), r(this.camera.position.z)],
      target: [r(this._pivotWorld.x), r(this._pivotWorld.y), r(this._pivotWorld.z)],
      player: [r(this._targetPos.x), r(this._targetPos.y), r(this._targetPos.z)],
      yaw: r(this.yaw),
      pitch: r(this.pitch),
      distance: r(this.distSpring.value),
      desiredDistance: r(this._desiredDistance),
      // The raw cast result, reported next to the applied one so a reviewer can catch the rig
      // overriding its own collision answer without having to reproduce the geometry. If
      // `penetrating` is ever true the camera is inside something and that is a bug, full stop.
      freeDistance: r(this._freeDistance),
      allowedDistance: r(this._allowedDistance),
      penetrating: this._penetrating,
      avatarOpacity: r(this.avatarOpacity),
      fov: r(this.camera.fov),
      occluded: this.occluded,
      occlusionDepth: r(this.occlusionDepth),
      trauma: r(this.trauma),
      shake: r(this.shakeMagnitude),
      shakeEnabled: !config.get("reduceMotion") && (Number(config.get("cameraShake")) || 0) > 0,
      reduceMotion: !!config.get("reduceMotion"),
      grounded: this.grounded,
      airTime: r(this.airTime),
      pivotLift: r(this.liftSpring.value),
      pivotDip: r(this.dipSpring.value),
      // `speed` is the number the framing actually runs on. `speedSignal` is shown beside it
      // with its age so the difference between the two is visible rather than hidden.
      speed: r(this._speedValid ? this.speedMeasured : this.speedSignal ?? 0),
      speedMeasured: r(this.speedMeasured),
      speedSignal: this.speedSignal == null ? null : r(this.speedSignal),
      speedSignalAge: Number.isFinite(this.speedSignalAge) ? r(this.speedSignalAge) : null,
      followError: r(this._followError),
      followLag: r(this._followLag),
      focus: {
        active: this.focus.active,
        weight: r(this.focusWeight.value),
        point: this.focus.valid
          ? [r(this.focus.point.x), r(this.focus.point.y), r(this.focus.point.z)]
          : null,
      },
      lookUnit: this._lookUnit,
      lookScale: this.t.lookScale,
      // Reported for transparency: for conditioned (radian) look input these are applied by
      // the input layer, not here, so that the player's setting is applied exactly once.
      sensitivity: Number(config.get("lookSensitivity")) || 1,
      invertY: !!config.get("invertY"),
      cameraShake: Number(config.get("cameraShake")) ?? 1,
    };
  }

  dispose() {
    for (const off of this._off) off();
    this._off.length = 0;
    this._collidables = null;
  }
}
