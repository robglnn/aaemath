import { signals } from "../core/Signals.js";
import { publish } from "../core/Introspect.js";

/**
 * P08 — procedural animation.
 *
 * There is no skeletal data in this project and there is not going to be any. Every angle below is
 * a function of two numbers: **how far the body has travelled** and **how fast it is going**. That
 * is not a shortcut around an animator; it is the only formulation in which the feet cannot skate.
 *
 * ## The phase accumulator
 *
 * A clip player advances a cycle by *time*: `phase += dt / clipLength`. The instant the character
 * accelerates, decelerates, is pushed by a slope or clips a wall, the ground moves under the foot
 * at a rate the clip knows nothing about and the contact slides. Here the cycle is advanced by
 * *distance*:
 *
 *     phase += metresTravelledThisFrame / strideLength(speed)
 *
 * so one stride is one stride of ground, at any speed, through any acceleration, including the
 * frame where a collision eats 80% of the intended motion. Stride length itself grows with speed
 * (`STRIDE_BASE + STRIDE_GAIN * speed`), which is what real gait does and is why a run does not
 * look like a fast walk: cadence rises, but reach rises faster.
 *
 * ## What the signal is for
 *
 * `player:state {grounded, speed, action}` is the *discrete* channel — it fires on state changes,
 * not every step, and it is the only thing this file takes from the controller. Locomotion is never
 * imported (`design/architecture.md`). The continuous channel — position and therefore distance —
 * comes from the Avatar, which reads the interpolated render transform. Speed used for amplitude is
 * measured from that same distance rather than trusted from the signal, because the signal's value
 * is a snapshot from whenever the state last changed and would freeze amplitudes mid-acceleration.
 *
 * ## Four poses, blended by weight
 *
 *   `stride`  hips/knees/ankles/arms on the phase, amplitude scaled walk -> sprint
 *   `idle`    breathing, a slow weight shift, micro head motion — never fully still
 *   `air`     trailing legs, one knee tucked, arms up: reads as "falling" in one frame
 *   `land`    a compression spring on the knees and the hips, released over ~0.34 s
 *
 * Weights are smoothed, so a landing does not pop out of the airborne pose, and `skid`/`blocked`
 * (which Locomotion emits and most listeners ignore) get their own tells rather than falling back
 * to idle while the body is clearly doing something.
 */

const TAU = Math.PI * 2;

/** Stride length in metres per full two-step cycle. */
const STRIDE_BASE = 1.16;
const STRIDE_GAIN = 0.15;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
/** Frame-rate independent approach: the only correct way to smooth in a variable-dt hook. */
const approach = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

export class Animator {
  constructor(kernel, { avatar } = {}) {
    this.kernel = kernel;
    this.avatar = avatar;
    this.j = avatar?.joints || {};

    this.phase = 0; // 0..1, one full two-step cycle
    this.time = 0;
    this.state = "idle";
    this.grounded = true;
    this.signalSpeed = 0;
    this.speed = 0;

    this.wStride = 0;
    this.wAir = 0;
    this.wLand = 0;
    this.landTimer = 999;
    this.landImpact = 0;
    this.airTime = 0;

    this._lastTravelled = avatar?.travelled ?? 0;
    this._rest = new Map();
    for (const [name, joint] of Object.entries(this.j)) {
      this._rest.set(name, joint.rotation.clone());
    }
    this._hipsRestY = this.j.hips?.position.y ?? 0.94;

    this._offs = [
      signals.on("player:state", (p) => {
        if (!p) return;
        if (typeof p.action === "string") this.state = p.action;
        if (typeof p.grounded === "boolean") this.grounded = p.grounded;
        if (typeof p.speed === "number") this.signalSpeed = p.speed;
      }),
      signals.on("player:land", (p) => {
        // The compression is scaled by the impact the controller reports, so a step down off a
        // kerb and a two-storey drop are not the same animation.
        this.landImpact = clamp((p?.impact ?? 6) / 14, 0.22, 1);
        this.landTimer = 0;
      }),
      signals.on("player:jump", () => {
        this.landTimer = 999;
        this.airTime = 0;
      }),
    ];

    publish("animator", () => ({
      phase: Number(this.phase.toFixed(4)),
      strideMetres: Number(this.stride().toFixed(3)),
      speed: Number(this.speed.toFixed(3)),
      state: this.state,
      grounded: this.grounded,
      weights: {
        stride: Number(this.wStride.toFixed(3)),
        air: Number(this.wAir.toFixed(3)),
        land: Number(this.wLand.toFixed(3)),
        idle: Number(Math.max(0, 1 - this.wStride - this.wAir).toFixed(3)),
      },
      // The proof that the phase is distance-driven and not a clock: cycles completed should equal
      // metres travelled / stride length, and both are reported.
      travelled: Number((this.avatar?.travelled ?? 0).toFixed(2)),
      cycles: Number(this.cycles.toFixed(3)),
      joints: Object.keys(this.j).length,
      landImpact: Number(this.landImpact.toFixed(3)),
    }));
    this.cycles = 0;
  }

  /** Metres of ground per full cycle. Reach grows with speed faster than cadence does. */
  stride() {
    return STRIDE_BASE + STRIDE_GAIN * this.speed;
  }

  frame(dt) {
    if (!this.avatar || !this.j.hips) return;
    const d = Math.min(Math.max(dt, 0), 0.1);
    this.time += d;

    // ---- clock ------------------------------------------------------------
    const travelled = this.avatar.travelled;
    const step = Math.max(0, travelled - this._lastTravelled);
    this._lastTravelled = travelled;
    this.speed = this.avatar.groundSpeed;

    const grounded = this.grounded && this.state !== "airborne";
    const moving = this.speed > 0.35;

    if (grounded && moving) {
      const advance = step / this.stride();
      this.phase = (this.phase + advance) % 1;
      this.cycles += advance;
    } else if (!grounded) {
      // Freeze the cycle in the air so the legs come back down where they left, rather than
      // snapping a half-stride on touchdown.
    } else {
      // Settle to a clean stand (phase 0 = feet together) instead of stopping mid-scissor.
      const to = this.phase < 0.25 || this.phase > 0.75 ? (this.phase > 0.5 ? 1 : 0) : 0.5;
      this.phase = approach(this.phase, to, 9, d) % 1;
    }

    // ---- pose weights -----------------------------------------------------
    this.airTime = grounded ? 0 : this.airTime + d;
    this.landTimer += d;
    const LAND = 0.34;
    const landW = this.landTimer < LAND ? Math.pow(1 - this.landTimer / LAND, 1.6) * this.landImpact : 0;

    this.wStride = approach(this.wStride, grounded && moving ? 1 : 0, 13, d);
    this.wAir = approach(this.wAir, grounded ? 0 : 1, 14, d);
    this.wLand = approach(this.wLand, landW, 26, d);
    const wIdle = clamp(1 - this.wStride - this.wAir, 0, 1);

    // gait blend: 0 = walk, 1 = sprint. Everything about the shape of the cycle rides on this.
    const g = clamp((this.speed - 1.1) / 5.2, 0, 1);

    const p = this.phase * TAU;
    const pose = this._blank();

    this._stride(pose, p, g);
    this._idle(pose, wIdle);
    this._air(pose);
    this._land(pose, landW);

    this._commit(pose, d);
  }

  _blank() {
    return {
      hipY: 0,
      hipRoll: 0,
      hipYaw: 0,
      hipPitch: 0,
      chestPitch: 0,
      chestYaw: 0,
      chestRoll: 0,
      chestScale: 1,
      headPitch: 0,
      headYaw: 0,
      thigh: [0, 0],
      knee: [0, 0],
      ankle: [0, 0],
      hipSplay: [0, 0],
      shoulder: [0, 0],
      shoulderSplay: [0, 0],
      elbow: [0, 0],
    };
  }

  // ------------------------------------------------------------------ stride

  /**
   * One cycle, two contacts. `s` runs over the two legs with a half-cycle offset; the arms take
   * the opposite leg's phase, which is the counter-rotation that makes a walk look like walking
   * rather than like a wind-up toy.
   */
  _stride(pose, p, g) {
    const w = this.wStride;
    if (w < 0.001) return;

    const thighA = lerp(0.34, 0.78, g); // hip swing amplitude
    const kneeA = lerp(0.72, 1.5, g); // peak knee flexion in swing
    const armA = lerp(0.3, 0.86, g);
    const bobA = lerp(0.026, 0.072, g);
    const rollA = lerp(0.035, 0.09, g);

    for (let i = 0; i < 2; i++) {
      const ph = p + (i === 0 ? 0 : Math.PI); // left leg leads
      // Hip: a clean sine is the swing. Contact at ph = pi/2 (leg forward), toe-off at -pi/2.
      pose.thigh[i] += w * (Math.sin(ph) * thighA - lerp(0.04, 0.16, g));
      // Knee: flexes hard through the swing (leg is off the ground and must clear it) and takes a
      // small compliance dip just after contact, which is where a run gets its weight from.
      const swing = Math.max(0, Math.sin(ph - 1.15));
      const absorb = Math.max(0, Math.sin(ph + 1.9)) * lerp(0.1, 0.34, g);
      pose.knee[i] += w * (swing * swing * kneeA + absorb + 0.06);
      // Ankle: keeps the sole roughly parallel to the ground through stance, toes down at push-off.
      pose.ankle[i] += w * (-Math.sin(ph) * 0.22 - Math.max(0, -Math.sin(ph + 0.4)) * lerp(0.2, 0.5, g) + 0.06);
      // Arms take the opposite leg.
      const ap = ph + Math.PI;
      pose.shoulder[i] += w * (Math.sin(ap) * armA - lerp(0.05, 0.34, g));
      pose.elbow[i] += w * -(lerp(0.28, 0.95, g) + Math.max(0, Math.sin(ap + 0.8)) * lerp(0.22, 0.6, g));
      pose.shoulderSplay[i] += w * lerp(0.02, 0.1, g);
      pose.hipSplay[i] += w * 0.02;
    }

    // The body falls twice per cycle — once per contact — and that vertical is most of what reads
    // as weight. Lowest just after each foot plant, so it is `-cos(2*phase)` shifted, not a hover.
    pose.hipY += w * (-bobA * (0.5 - 0.5 * Math.cos(2 * p + 0.6)));
    pose.hipRoll += w * Math.sin(p) * rollA;
    pose.hipYaw += w * Math.sin(p) * lerp(0.04, 0.13, g);
    pose.chestYaw += w * -Math.sin(p) * lerp(0.06, 0.2, g); // counter-rotation through the spine
    pose.chestRoll += w * -Math.sin(p) * rollA * 0.5;
    // Forward pitch with speed: a sprint is a controlled fall and standing upright kills it.
    pose.hipPitch += w * lerp(0.05, 0.19, g);
    pose.chestPitch += w * lerp(0.04, 0.16, g);
    pose.headPitch += w * -lerp(0.06, 0.24, g); // eyes stay on the horizon
    pose.chestScale = lerp(pose.chestScale, 1 + 0.02 * g, w);
  }

  // -------------------------------------------------------------------- idle

  _idle(pose, w) {
    if (w < 0.001) return;
    const t = this.time;
    // Breathing: 3.4 s period, in the chest scale and a matching shoulder rise. Small — 1.5% — but
    // its absence is exactly what makes a standing character look like a prop.
    const breath = Math.sin((t / 3.4) * TAU);
    pose.chestScale = lerp(pose.chestScale, 1 + breath * 0.015, w);
    pose.chestPitch += w * (breath * 0.014 - 0.02);
    pose.hipY += w * breath * 0.006;
    // A slow weight shift on a different, non-harmonic period so the loop never announces itself.
    const shift = Math.sin((t / 7.3) * TAU);
    pose.hipRoll += w * shift * 0.03;
    pose.hipYaw += w * shift * 0.035;
    pose.chestYaw += w * -shift * 0.03;
    pose.headYaw += w * Math.sin((t / 5.1) * TAU + 1.1) * 0.13;
    pose.headPitch += w * Math.sin((t / 4.3) * TAU) * 0.04;
    for (let i = 0; i < 2; i++) {
      pose.shoulder[i] += w * (breath * 0.02 - 0.03);
      pose.elbow[i] += w * -(0.2 + breath * 0.03);
      pose.shoulderSplay[i] += w * 0.03;
      pose.knee[i] += w * 0.07; // never lock a knee straight
      pose.hipSplay[i] += w * 0.03;
    }

    // Two extra tells the controller emits that nothing else listens for.
    if (this.state === "skid") {
      pose.hipPitch -= w * 0.2;
      pose.chestPitch -= w * 0.16;
      pose.knee[0] += w * 0.5;
      pose.knee[1] += w * 0.3;
      pose.thigh[0] += w * 0.34;
      pose.thigh[1] -= w * 0.2;
      pose.shoulder[0] -= w * 0.5;
      pose.shoulder[1] -= w * 0.35;
    } else if (this.state === "blocked") {
      pose.chestPitch += w * 0.22;
      pose.shoulder[0] -= w * 0.9;
      pose.shoulder[1] -= w * 0.9;
      pose.elbow[0] -= w * 0.8;
      pose.elbow[1] -= w * 0.8;
      pose.knee[0] += w * 0.25;
      pose.knee[1] += w * 0.25;
    }
  }

  // --------------------------------------------------------------------- air

  _air(pose) {
    const w = this.wAir;
    if (w < 0.001) return;
    // Rise vs fall: early in the arc the legs are still tucked from the push; later they reach for
    // the ground. `airTime` is the cheapest available proxy and it reads correctly at a glance.
    const fall = clamp((this.airTime - 0.22) / 0.5, 0, 1);
    pose.thigh[0] = lerp(pose.thigh[0], lerp(0.85, 0.34, fall), w);
    pose.thigh[1] = lerp(pose.thigh[1], lerp(0.1, -0.3, fall), w);
    pose.knee[0] = lerp(pose.knee[0], lerp(1.35, 0.55, fall), w);
    pose.knee[1] = lerp(pose.knee[1], lerp(0.55, 0.28, fall), w);
    pose.ankle[0] = lerp(pose.ankle[0], lerp(0.3, -0.16, fall), w);
    pose.ankle[1] = lerp(pose.ankle[1], 0.22, w);
    pose.shoulder[0] = lerp(pose.shoulder[0], lerp(-1.0, -0.55, fall), w);
    pose.shoulder[1] = lerp(pose.shoulder[1], lerp(-0.55, -0.9, fall), w);
    pose.elbow[0] = lerp(pose.elbow[0], -0.95, w);
    pose.elbow[1] = lerp(pose.elbow[1], -0.7, w);
    pose.shoulderSplay[0] = lerp(pose.shoulderSplay[0], 0.34, w);
    pose.shoulderSplay[1] = lerp(pose.shoulderSplay[1], 0.34, w);
    pose.hipSplay[0] = lerp(pose.hipSplay[0], 0.1, w);
    pose.hipSplay[1] = lerp(pose.hipSplay[1], 0.08, w);
    pose.chestPitch = lerp(pose.chestPitch, lerp(0.16, -0.06, fall), w);
    pose.hipPitch = lerp(pose.hipPitch, 0.1, w);
    pose.headPitch = lerp(pose.headPitch, lerp(-0.1, 0.14, fall), w);
    pose.hipY = lerp(pose.hipY, 0.03, w);
  }

  // ------------------------------------------------------------------- land

  /**
   * Landing compression. Not a pose to blend to — an *additive* squat on top of whatever the legs
   * are already doing, so a landing straight into a sprint keeps running while it absorbs.
   */
  _land(pose, w) {
    if (w < 0.001) return;
    const drop = 0.19 * w;
    pose.hipY -= drop;
    pose.hipPitch += 0.3 * w;
    pose.chestPitch += 0.24 * w;
    pose.headPitch -= 0.2 * w;
    for (let i = 0; i < 2; i++) {
      pose.knee[i] += 1.25 * w;
      pose.thigh[i] += 0.5 * w;
      pose.ankle[i] += 0.42 * w;
      pose.shoulder[i] -= 0.4 * w;
      pose.elbow[i] -= 0.5 * w;
      pose.shoulderSplay[i] += 0.22 * w;
      pose.hipSplay[i] += 0.06 * w;
    }
  }

  // ------------------------------------------------------------------ commit

  _commit(pose, dt) {
    const j = this.j;
    const R = (name) => this._rest.get(name);

    // Everything is written as rest + delta, so the rest pose authored in Avatar.js (the A-stance,
    // the relaxed elbows) survives instead of being overwritten by pose zero.
    const set = (name, dx, dy, dz) => {
      const node = j[name];
      if (!node) return;
      const r = R(name);
      node.rotation.set(r.x + dx, r.y + dy, r.z + dz);
    };

    j.hips.position.y = this._hipsRestY + pose.hipY;
    set("hips", pose.hipPitch, pose.hipYaw, pose.hipRoll);
    set("chest", pose.chestPitch, pose.chestYaw, pose.chestRoll);
    set("neck", pose.headPitch * 0.35, pose.headYaw * 0.3, 0);
    set("head", pose.headPitch * 0.65, pose.headYaw * 0.7, 0);

    // The chest scale is the breath. Y only — a uniform scale reads as the character inflating.
    const cs = j.chest;
    if (cs) cs.scale.set(1, pose.chestScale, 1);

    for (let i = 0; i < 2; i++) {
      const tag = i === 0 ? "L" : "R";
      const sign = i === 0 ? -1 : 1;
      set(`hip${tag}`, pose.thigh[i], 0, sign * pose.hipSplay[i]);
      set(`knee${tag}`, pose.knee[i], 0, 0);
      set(`ankle${tag}`, pose.ankle[i], 0, 0);
      set(`shoulder${tag}`, pose.shoulder[i], 0, sign * pose.shoulderSplay[i]);
      set(`elbow${tag}`, pose.elbow[i], 0, 0);
    }

    // Squash from the controller's own landing/jump impulse, applied to the whole body rather than
    // to a joint, because it is a scale and joints only carry rotation here.
    const sq = this.avatar?._squash ?? 0;
    const body = this.avatar?.body;
    if (body) {
      const s = clamp(sq, -0.6, 0.6);
      body.scale.set(1 + s * 0.14, 1 - s * 0.22, 1 + s * 0.14);
    }
    void dt;
  }

  dispose() {
    for (const off of this._offs) off?.();
  }
}
