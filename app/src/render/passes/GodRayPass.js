import * as THREE from "three";
import { Blit, VERTEX } from "./FullScreenPass.js";

/**
 * God-rays — a radial scatter of the bright buffer away from the sun's screen position.
 *
 * It reads the *bright pass*, not the scene, and that single choice is what makes it correct
 * rather than decorative:
 *
 *  - **Occlusion is free and it is real.** Anything that is not above the bright threshold
 *    contributes nothing, so a mesa standing in front of the sun casts a true shadow through
 *    the shafts without a second depth pass, a stencil or an occlusion render. §0.6 wants the
 *    gap between the player's lip and Vantis to read as sky all the way down; shafts that stop
 *    dead at a leaf's silhouette are what sell that.
 *  - **It costs one quarter-resolution pass**, because the buffer it walks is already half
 *    resolution and already blurred.
 *
 * The sun position comes from `PostStack`, which prefers `scene.userData.sunDirection` (set by
 * whichever piece owns the light rig) and falls back to the strongest `DirectionalLight` in the
 * scene. §2 fixes the key at elevation +8 degrees on a world bearing, so the sun is frequently
 * just off frame — and §15.5 forbids an emitter's screen energy from moving more than 3% per
 * fixed step, which means the shafts may not switch off when it crosses the edge. The weight
 * is therefore a smoothstep on both the facing dot product and the sun's distance from the
 * frame centre, so the effect fades over roughly a second of a 60 deg/s pan instead of popping
 * (anti-pattern 25 and 27). `review/measure/P12.mjs` claim G2 measures that fade.
 */
export class GodRayPass {
  constructor({ samples = 24 } = {}) {
    this.samples = samples;
    this.material = new THREE.ShaderMaterial({
      name: "vs.post.godrays",
      defines: { SAMPLES: samples },
      uniforms: {
        tBright: { value: null },
        uSun: { value: new THREE.Vector2(0.5, 0.5) },
        uDensity: { value: 0.62 },
        uDecay: { value: 0.955 },
        uWeight: { value: 0.0 },
      },
      vertexShader: VERTEX,
      fragmentShader: /* glsl */ `
        uniform sampler2D tBright;
        uniform vec2 uSun;
        uniform float uDensity;
        uniform float uDecay;
        uniform float uWeight;
        varying vec2 vUv;

        void main() {
          if (uWeight <= 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
          vec2 delta = (vUv - uSun) * (uDensity / float(SAMPLES));
          vec2 p = vUv;
          float w = 1.0;
          vec3 acc = vec3(0.0);
          for (int i = 0; i < SAMPLES; i++) {
            p -= delta;
            acc += texture2D(tBright, p).rgb * w;
            w *= uDecay;
          }
          gl_FragColor = vec4(acc * (uWeight / float(SAMPLES)), 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.blit = new Blit(this.material);
  }

  /**
   * @param {THREE.Vector2} sunUv    sun position in screen UV (may be outside 0..1)
   * @param {number} weight          0 when the sun is behind the camera or far off frame
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
 * Returns `{ uv, weight, onScreen }`. `weight` is the product of two smoothsteps — one on how
 * far the sun is from the camera's forward axis, one on how far its projection is from the
 * frame centre — so nothing about the shafts changes discontinuously as the player turns.
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
  const edgeFade = 1 - smoothstep(1.0, 2.2, r);
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
