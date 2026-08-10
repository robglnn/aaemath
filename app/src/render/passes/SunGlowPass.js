import * as THREE from "three";
import { Blit, VERTEX } from "./FullScreenPass.js";

/**
 * The sun glow — a short radial scatter of the bright buffer away from Lethis's screen position.
 *
 * `config.tier.postStack` calls this pass `godrays`, and the name is the only thing about it that
 * survived contact with the render target. `design/art-direction.md` §6.1 is unambiguous:
 * *"The sun is a glow, not a disc. `sky.sun` #FFF77D, Y 0.8926 — no hard rim, no ghosts, no
 * anamorphic streak, no lens dirt."* Long crepuscular shafts are a volumetric-atmosphere look;
 * this world is made of hard steps (§12.19) and its distance cue is contrast collapse, not a veil
 * (§12.20, "fog soup"). So the pass ships with a **reach of 0.26 of the distance to the sun over 16
 * taps**, which is a halo that hugs the horizon rather than a set of rays crossing the picture.
 *
 * It reads the *bright pass*, not the scene, and that single choice is what makes it correct rather
 * than decorative:
 *
 *  - **Occlusion is free and it is real.** Anything below the bright threshold contributes nothing,
 *    so a spire standing in front of the sun cuts a true hole in the glow with no depth pass, no
 *    stencil and no second render. §2.3 says silhouette carries every read in this art direction;
 *    a glow that ignored silhouettes would be the one effect in the frame that softens them.
 *  - **It costs one quarter-resolution draw**, because the buffer it walks is already half
 *    resolution and already gated.
 *
 * The weight is the product of two smoothsteps — one on how far the sun is from the camera's
 * forward axis, one on how far its projection sits from the frame centre — so nothing about the
 * glow changes discontinuously as the player turns. §11.4 caps an emitter's screen energy change at
 * 3% per fixed step and a hard on/off at the frame edge would be a whole-screen version of exactly
 * that failure. `review/measure/P12.mjs` claim G1 measures the fade across a pan.
 */
export class SunGlowPass {
  constructor({ samples = 16 } = {}) {
    this.samples = samples;
    this.material = new THREE.ShaderMaterial({
      name: "vs.post.sunglow",
      defines: { SAMPLES: samples },
      uniforms: {
        tBright: { value: null },
        uSun: { value: new THREE.Vector2(0.5, 0.5) },
        uReach: { value: 0.26 },
        uDecay: { value: 0.9 },
        uWeight: { value: 0.0 },
      },
      vertexShader: VERTEX,
      fragmentShader: /* glsl */ `
        uniform sampler2D tBright;
        uniform vec2 uSun;
        uniform float uReach;
        uniform float uDecay;
        uniform float uWeight;
        varying vec2 vUv;

        void main() {
          if (uWeight <= 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
          vec2 delta = (vUv - uSun) * (uReach / float(SAMPLES));
          vec2 p = vUv;
          float w = 1.0;
          float norm = 0.0;
          vec3 acc = vec3(0.0);
          for (int i = 0; i < SAMPLES; i++) {
            p -= delta;
            acc += texture2D(tBright, p).rgb * w;
            norm += w;
            w *= uDecay;
          }
          // Normalised by the weight sum, not by the tap count: the pass redistributes the bright
          // buffer's energy along a short radius, it does not manufacture any.
          gl_FragColor = vec4(acc * (uWeight / max(norm, 1e-4)), 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.blit = new Blit(this.material);
  }

  /**
   * @param {THREE.Vector2} sunUv sun position in screen UV (may be outside 0..1)
   * @param {number} weight       0 when the sun is behind the camera or far off frame
   */
  render(renderer, brightTexture, sunUv, weight, target) {
    const u = this.material.uniforms;
    u.tBright.value = brightTexture;
    u.uSun.value.copy(sunUv);
    u.uWeight.value = weight;
    this.blit.render(renderer, target);
  }

  dispose() {
    this.blit.dispose();
  }
}

/**
 * Screen-space sun position and a smooth on/off weight.
 *
 * Returns `{ uv, weight, onScreen }`. `weight` is continuous in the camera's orientation, which is
 * the §11.4 requirement above; `onScreen` is reported on the probe so a reviewer can tell a glow
 * that is off because the sun is behind them from a glow that is off because it is broken.
 */
const _p = new THREE.Vector3();
const _forward = new THREE.Vector3();

export function sunScreenPosition(camera, sunDirection, out) {
  _forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
  const facing = _forward.dot(sunDirection);

  _p.copy(camera.position).addScaledVector(sunDirection, 1e4).project(camera);
  out.set(_p.x * 0.5 + 0.5, _p.y * 0.5 + 0.5);

  // How far outside the frame the sun sits, in half-frames. 0 at the centre, 1 at the edge.
  const r = Math.max(Math.abs(_p.x), Math.abs(_p.y));
  const facingFade = smoothstep(0.05, 0.35, facing);
  const edgeFade = 1 - smoothstep(1.0, 1.9, r);
  return {
    uv: out,
    weight: facing > 0 ? facingFade * edgeFade : 0,
    onScreen: facing > 0 && Math.abs(_p.x) <= 1 && Math.abs(_p.y) <= 1,
  };
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
