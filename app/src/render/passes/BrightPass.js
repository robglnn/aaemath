import * as THREE from "three";
import { Blit, VERTEX } from "./FullScreenPass.js";
import { LUMINANCE, SOFT_KNEE } from "./glsl.js";

/**
 * Bright pass — the prefilter that decides what is allowed to glow.
 *
 * `design/art-direction.md` §5.4 names the whole guest list: *"crystal, carry, city strips, the sun
 * glow, KaTeX"*, and then the exclusion, which is the sentence this pass exists to obey:
 * *"Bloom must never touch rock, ground, foliage, character or UI. A bloom that leaks onto a lit
 * rock facet destroys the flatness in a single frame."*
 *
 * Three jobs, all in one half-resolution draw:
 *
 *  1. **Threshold with a soft knee**, in scene-linear light. See `SOFT_KNEE` in `glsl.js` for why a
 *     scene-linear threshold *is* the class mask §5.4 asks for rather than the global luminance
 *     threshold §12.10 forbids: surfaces are bounded by the light landing on them and top out well
 *     under 1.0 after §3.2's calibration; emitters carry an `emissive` term on top of that and are
 *     the only things in the frame that exceed it.
 *
 *  2. **Karis luminance weighting.** Four texels averaged with weight 1/(1 + L) — the standard fix
 *     for one blinding texel throwing a halo the size of the screen. It matters here because a
 *     crystal core sits at §5.4's measured peak while a two-pixel specular sliver of the same
 *     material can be far hotter for one frame; unweighted, that sliver would inject more energy
 *     per pixel than the whole cluster.
 *
 *  3. **Clamp.** After weighting, the result is capped so an emitter's *halo radius* stops being a
 *     function of how hot the emitter is. §11.4 caps an emitter's screen energy change at 3% per
 *     fixed step; an unbounded bright buffer turns any dimming into a visible pulse of halo size.
 *
 * At the frame edge the bright buffer is `ClampToEdgeWrapping`, so an emitter sitting against the
 * border smears its own value outward instead of fading into black — which is what keeps a crystal
 * cluster at the edge of frame from developing a dark rim as the player pans past it. There is
 * deliberately no extra edge falloff on top of that: any such weight is a vignette applied to one
 * class of object only, and it would show as a soft band exactly where §4 wants a hard edge.
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

  /** @param {THREE.Texture} source full-resolution scene-linear colour */
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
