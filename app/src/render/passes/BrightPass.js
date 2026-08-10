import * as THREE from "three";
import { Blit, VERTEX } from "./FullScreenPass.js";
import { LUMINANCE, SOFT_KNEE } from "./glsl.js";

/**
 * Bright pass — the prefilter that decides what is allowed to glow.
 *
 * Three jobs, all in one half-resolution draw:
 *
 *  1. **Threshold with a soft knee.** See `SOFT_KNEE` in glsl.js for why a high scene-linear
 *     threshold *is* §8's emissive mask rather than the "global luminance threshold" §8
 *     forbids: after §10's exposure the brightest surface in the world sits near scene-linear
 *     0.63 and the threshold ships at 1.35, so rock and sky cannot reach it and only the three
 *     things §10 reserves pure white for can.
 *
 *  2. **Karis luminance weighting.** Four texels are averaged with weight 1/(1 + L), which is
 *     the standard fix for a single blindingly bright texel throwing a giant halo. It matters
 *     here for a reason specific to this project: §8 drives KaTeX glyphs ≥ 4x above the
 *     curve's Y 0.99 point, so an unweighted average would let a two-pixel glyph stroke inject
 *     ten times a large emitter's energy per pixel and fill in the counters of the equation.
 *     `review/measure/P12.mjs` claim B4 measures exactly that and holds the panel to §8's
 *     2.2 : 1 glyph-to-veil floor.
 *
 *  3. **Clamp.** After weighting, the result is capped. An emitter is allowed to be very
 *     bright; its *bloom* is not allowed to be unbounded, or the halo's radius becomes a
 *     function of how hot the emitter is and §15.5's `M5` (≤ 3% emissive energy change per
 *     fixed step) turns into a coin flip whenever anything dims.
 *
 * The guard band that §8 requires against bloom popping at the frame edge is not a border in
 * this texture — it is `ClampToEdgeWrapping` plus the edge weight applied in `GradePass`,
 * which smoothsteps an emitter's contribution over the outer 6% of frame. A mask built from a
 * larger-than-frame render would cost a second scene pass; the smoothstep costs nothing and
 * §15.5 measures the same thing either way.
 */
export class BrightPass {
  constructor({ threshold, knee, clamp }) {
    this.material = new THREE.ShaderMaterial({
      name: "vs.post.bright",
      uniforms: {
        tScene: { value: null },
        uTexel: { value: new THREE.Vector2() },
        uThreshold: { value: threshold },
        uKnee: { value: knee },
        uClamp: { value: clamp },
      },
      vertexShader: VERTEX,
      fragmentShader: /* glsl */ `
        uniform sampler2D tScene;
        uniform vec2 uTexel;      // one source texel, in UV
        uniform float uThreshold;
        uniform float uKnee;
        uniform float uClamp;
        varying vec2 vUv;
        ${LUMINANCE}
        ${SOFT_KNEE}

        vec4 tap(vec2 uv) {
          vec3 c = max(texture2D(tScene, uv).rgb, 0.0);
          c = vsSoftKnee(c, uThreshold, uKnee);
          // Karis: weight by inverse luminance so one hot texel cannot dominate the average.
          float w = 1.0 / (1.0 + vsLum(c));
          return vec4(c * w, w);
        }

        void main() {
          vec2 o = uTexel * 0.5;
          vec4 s = tap(vUv + vec2(-o.x, -o.y))
                 + tap(vUv + vec2( o.x, -o.y))
                 + tap(vUv + vec2(-o.x,  o.y))
                 + tap(vUv + vec2( o.x,  o.y));
          vec3 c = s.rgb / max(s.a, 1e-5);
          float br = max(c.r, max(c.g, c.b));
          if (br > uClamp) c *= uClamp / br;   // clamp preserves hue; a per-channel min does not
          gl_FragColor = vec4(c, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.blit = new Blit(this.material);
  }

  /** @param {THREE.Texture} source full-resolution linear scene colour */
  render(renderer, source, sourceWidth, sourceHeight, target) {
    this.material.uniforms.tScene.value = source;
    this.material.uniforms.uTexel.value.set(1 / sourceWidth, 1 / sourceHeight);
    this.blit.render(renderer, target);
  }

  set(threshold, knee, clamp) {
    this.material.uniforms.uThreshold.value = threshold;
    this.material.uniforms.uKnee.value = knee;
    this.material.uniforms.uClamp.value = clamp;
  }

  dispose() {
    this.blit.dispose();
  }
}
