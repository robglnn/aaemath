import * as THREE from "three";
import { Blit, VERTEX, makeTarget } from "./FullScreenPass.js";
import { LUMINANCE } from "./glsl.js";

/**
 * Progressive-downsample bloom.
 *
 * Not a Gaussian, and not a two-tap blur pretending to be one. A chain of half-resolution
 * steps, each filtered with the 13-tap kernel that keeps a mip from aliasing into the next,
 * then walked back up with a 9-tap tent and accumulated additively. The result is a sum of
 * lobes at every octave — which is precisely what §8 asks for when it specifies "a tight core
 * (sigma ~= 0.6% of frame height) and a wide halo whose half-intensity radius is 6% of frame
 * height", because a single Gaussian cannot be both.
 *
 * ---------------------------------------------------------------------------------------
 * Why the level count is a fractional function of frame height, and why that is the whole
 * resolution-independence story
 * ---------------------------------------------------------------------------------------
 *
 * A mip chain with a fixed number of levels has a blur radius that is a fixed number of
 * *pixels*, so the halo shrinks to half its size on screen when the player moves from 1080p to
 * 4K. §8's spec is in per-cent of frame height, and `quality-bar.md` G7 demands the frame read
 * at 1280x720 *and* 3840x2160, so the level count has to grow with resolution.
 *
 * Doing that with `round(log2(h))` produces a 2x jump in halo radius the moment the viewport
 * crosses a power of two, which is anti-pattern 27 (something snapping on a threshold) with a
 * window-resize as the trigger. Instead:
 *
 *     fl        = log2(height) - ANCHOR        (fractional level count)
 *     levels    = ceil(fl)                     (how many targets we actually allocate)
 *     lastWeight= 1 - (levels - fl)            (how much the newest one contributes)
 *
 * so the extra level fades in from zero exactly as it is allocated and the *effective* radius
 * is a continuous function of viewport height. ANCHOR is set so the coarsest level is ~17
 * device pixels tall at 1080p, which puts a one-texel tent at 5.9% of frame height — §8's wide
 * lobe, measured rather than asserted. `review/measure/P12.mjs` claim R1 captures the halo's
 * half-intensity radius at 720p, 1080p and 2160p and fails if they disagree by more than 20%.
 */
const ANCHOR = 5.09;
const MIN_LEVELS = 3;
const MAX_LEVELS = 8;

/** Contribution of mip[i] when it is added back into mip[i-1]. Index 0 is unused. */
const LEVEL_WEIGHTS = [1.0, 1.0, 0.92, 0.8, 0.68, 0.58, 0.5, 0.44, 0.4];

export function bloomLevels(height) {
  const fl = Math.log2(Math.max(2, height)) - ANCHOR;
  const levels = Math.min(MAX_LEVELS, Math.max(MIN_LEVELS, Math.ceil(fl)));
  const lastWeight = Math.min(1, Math.max(0, 1 - (levels - fl)));
  return { levels, lastWeight: levels >= MAX_LEVELS || levels <= MIN_LEVELS ? 1 : lastWeight };
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
          // 13 taps: a 3x3 grid at +-2 texels plus a 2x2 at +-1. The inner quad carries half
          // the weight, which is what stops the chain from aliasing a bright single texel into
          // a flickering blob two levels down.
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

  /** The bright-pass target — also the source the god-ray pass scatters. */
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
