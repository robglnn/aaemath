import * as THREE from "three";
import { Blit, VERTEX, makeTarget } from "./FullScreenPass.js";
import { LUMINANCE } from "./glsl.js";

/**
 * Progressive-downsample bloom.
 *
 * A chain of half-resolution steps, each filtered with the 13-tap kernel that keeps a mip from
 * aliasing into the next, then walked back up with a 9-tap tent and accumulated additively. The
 * result is a sum of lobes at every octave: a tight core on the emitter and a short tail, rather
 * than one wide Gaussian that would put the same energy everywhere and read as haze.
 *
 * `design/art-direction.md` §5.4 gives the size budget — *"Radius <= 4% of frame height"* — and
 * §12.10 gives the failure mode it is guarding against. On this art direction that budget is much
 * more binding than it sounds: the picture is made of hard facet edges holding one value each
 * (§3.3, measured within-facet spread 0.0096), so a halo wide enough to cross a silhouette does not
 * read as "glow", it reads as the renderer having lost the edge.
 *
 * ---------------------------------------------------------------------------------------
 * Why the level count is a fractional function of frame height
 * ---------------------------------------------------------------------------------------
 *
 * One texel at mip level `i` covers `2^(i+1)` device pixels, so with a *fixed* level count the halo
 * is a fixed number of pixels and therefore halves as a fraction of the picture when the player
 * moves from 1080p to 4K. §5.4's budget is in per cent of frame height and `quality-bar.md` G7
 * requires the frame to read at 1280x720 *and* 3840x2160, so the level count has to track
 * `log2(height)`.
 *
 * Doing that with `round(log2(h))` makes the halo double the instant the viewport crosses a power
 * of two — a visible pop with a window resize as its trigger. Instead:
 *
 *     fl         = log2(height) - ANCHOR       (fractional level count)
 *     levels     = ceil(fl)                    (targets actually allocated)
 *     lastWeight = 1 - (levels - fl)           (how much the newest one contributes)
 *
 * so the extra level fades in from zero exactly as it is allocated and the *effective* radius is a
 * continuous function of viewport height. `ANCHOR` solves `2^(1 - ANCHOR) = 0.031`, which places
 * the widest fully-weighted tent at **3.1% of frame height** — inside §5.4's 4% ceiling with room
 * for the fractional level above it. `review/measure/P12.mjs` claim R1 pushes an identical point
 * emitter through the real chain at 720p, 1080p and 2160p and fails if the measured half-intensity
 * radii, expressed as a fraction of frame height, disagree by more than 20%.
 */
const ANCHOR = 6.012;
const MIN_LEVELS = 2;
const MAX_LEVELS = 7;

/** Contribution of mip[i] when it is added back into mip[i-1]. Index 0 is unused. */
const LEVEL_WEIGHTS = [1.0, 1.0, 0.92, 0.8, 0.68, 0.58, 0.5, 0.44, 0.4];

export function bloomLevels(height) {
  const fl = Math.log2(Math.max(2, height)) - ANCHOR;
  const levels = Math.min(MAX_LEVELS, Math.max(MIN_LEVELS, Math.ceil(fl)));
  const lastWeight = Math.min(1, Math.max(0, 1 - (levels - fl)));
  return { levels, lastWeight: levels >= MAX_LEVELS || levels <= MIN_LEVELS ? 1 : lastWeight };
}

/** The widest fully-weighted tent, as a fraction of frame height. Published on the probe. */
export function bloomRadiusFraction(height) {
  const { levels, lastWeight } = bloomLevels(height);
  const wide = Math.pow(2, levels + 1) / height;
  const narrow = Math.pow(2, levels) / height;
  return narrow + (wide - narrow) * lastWeight;
}

export class BloomPass {
  constructor() {
    this.mips = [];
    this.levels = 0;
    this.lastWeight = 1;
    this.radius = 1.0;

    this.downMaterial = new THREE.ShaderMaterial({
      name: "vs.post.bloom.down",
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } },
      vertexShader: VERTEX,
      fragmentShader: /* glsl */ `
        uniform sampler2D tSrc;
        uniform vec2 uTexel;
        varying vec2 vUv;
        ${LUMINANCE}
        vec3 T(vec2 o) { return texture2D(tSrc, vUv + o * uTexel).rgb; }
        void main() {
          // 13 taps: a 3x3 grid at +-2 texels plus a 2x2 at +-1. The inner quad carries half the
          // weight, which is what stops the chain from aliasing a bright single texel into a
          // flickering blob two levels down — §11.4's 3%-per-step emitter budget, upstream.
          vec3 a = T(vec2(-2.0, -2.0)), b = T(vec2(0.0, -2.0)), c = T(vec2(2.0, -2.0));
          vec3 d = T(vec2(-2.0,  0.0)), e = T(vec2(0.0,  0.0)), f = T(vec2(2.0,  0.0));
          vec3 g = T(vec2(-2.0,  2.0)), h = T(vec2(0.0,  2.0)), i = T(vec2(2.0,  2.0));
          vec3 j = T(vec2(-1.0, -1.0)), k = T(vec2(1.0, -1.0));
          vec3 l = T(vec2(-1.0,  1.0)), m = T(vec2(1.0,  1.0));
          vec3 o = e * 0.125;
          o += (a + c + g + i) * 0.03125;
          o += (b + d + f + h) * 0.0625;
          o += (j + k + l + m) * 0.125;
          gl_FragColor = vec4(o, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

    this.upMaterial = new THREE.ShaderMaterial({
      name: "vs.post.bloom.up",
      uniforms: {
        tSrc: { value: null },
        uTexel: { value: new THREE.Vector2() },
        uRadius: { value: 1.0 },
        uWeight: { value: 1.0 },
      },
      vertexShader: VERTEX,
      fragmentShader: /* glsl */ `
        uniform sampler2D tSrc;
        uniform vec2 uTexel;
        uniform float uRadius;
        uniform float uWeight;
        varying vec2 vUv;
        vec3 T(vec2 o) { return texture2D(tSrc, vUv + o * uTexel * uRadius).rgb; }
        void main() {
          // 9-tap tent — 1 2 1 / 2 4 2 / 1 2 1, normalised.
          vec3 o = T(vec2(-1.0, -1.0)) + T(vec2(0.0, -1.0)) * 2.0 + T(vec2(1.0, -1.0));
          o += T(vec2(-1.0, 0.0)) * 2.0 + T(vec2(0.0, 0.0)) * 4.0 + T(vec2(1.0, 0.0)) * 2.0;
          o += T(vec2(-1.0, 1.0)) + T(vec2(0.0, 1.0)) * 2.0 + T(vec2(1.0, 1.0));
          gl_FragColor = vec4(o * (0.0625 * uWeight), 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
    });

    this.down = new Blit(this.downMaterial);
    this.up = new Blit(this.upMaterial);
  }

  /** The texture the composite reads: mip 0, holding the bright pass plus every lobe above it. */
  get texture() {
    return this.mips[0]?.texture ?? null;
  }

  /** The bright-pass target — also the source the sun-glow pass scatters. */
  get brightTarget() {
    return this.mips[0] ?? null;
  }

  setSize(width, height) {
    const { levels, lastWeight } = bloomLevels(height);
    this.lastWeight = lastWeight;

    if (this.levels !== levels) {
      for (const m of this.mips) m.dispose();
      this.mips = [];
      this.levels = levels;
      for (let i = 0; i <= levels; i++) this.mips.push(makeTarget(1, 1, { name: `vs.bloom.${i}` }));
    }
    for (let i = 0; i <= levels; i++) {
      const w = Math.max(1, Math.floor(width / Math.pow(2, i + 1)));
      const h = Math.max(1, Math.floor(height / Math.pow(2, i + 1)));
      this.mips[i].setSize(w, h);
    }
  }

  /** Runs the chain. `mips[0]` must already hold the bright pass output. */
  render(renderer) {
    const n = this.levels;
    for (let i = 1; i <= n; i++) {
      const src = this.mips[i - 1];
      this.downMaterial.uniforms.tSrc.value = src.texture;
      this.downMaterial.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
      this.down.render(renderer, this.mips[i]);
    }
    for (let i = n; i >= 1; i--) {
      const src = this.mips[i];
      const weight = (LEVEL_WEIGHTS[i] ?? 0.4) * (i === n ? this.lastWeight : 1);
      this.upMaterial.uniforms.tSrc.value = src.texture;
      this.upMaterial.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
      this.upMaterial.uniforms.uRadius.value = this.radius;
      this.upMaterial.uniforms.uWeight.value = weight;
      this.up.render(renderer, this.mips[i - 1], { clear: false });
    }
  }

  stats() {
    return {
      levels: this.levels,
      lastWeight: Number(this.lastWeight.toFixed(3)),
      mipSizes: this.mips.map((m) => [m.width, m.height]),
      drawCalls: this.levels * 2,
    };
  }

  dispose() {
    for (const m of this.mips) m.dispose();
    this.mips = [];
    this.down.dispose();
    this.up.dispose();
  }
}
