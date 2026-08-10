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
 * The halo is a fixed fraction of the picture, not a fixed number of pixels
 * ---------------------------------------------------------------------------------------
 *
 * One texel at mip level `i` covers `2^(i+1)` device pixels. So a chain with a fixed number of
 * levels produces a halo that is a fixed number of *pixels*, and therefore halves as a fraction of
 * the picture between 1080p and 4K. §5.4 budgets in per cent of frame height and `quality-bar.md`
 * G7 requires the frame to read at 1280x720 *and* 3840x2160, so a fixed level count is wrong.
 *
 * Letting the level count grow with `log2(height)` fixes the *widest* lobe and breaks the rest: the
 * extra octave a 4K frame gains is a new *fine* level, which adds energy to the core and pulls the
 * halo in. Measured on the first version of this file: the 90%-energy radius ran 6.25% / 4.51% /
 * 2.95% of frame height across a 4x change in pixel count. Same code, three different looks.
 *
 * What is actually resolution-independent is a **window of octaves anchored to the frame, not to
 * the pixel grid**. The chain still descends from half resolution — that is where the sampling
 * quality is — but only the top `LOBES + 1` levels are accumulated, and the composite reads the
 * level where that window starts:
 *
 *     baseExact = log2(FINEST * height) - 1     the level whose texel is FINEST of frame height
 *     base      = round(baseExact)              the level the composite reads
 *     top       = base + LOBES                  the coarsest level accumulated
 *     radius    = 2^(baseExact - base)          the rounding residual, given to the tent
 *
 * Every accumulated lobe then sits at `FINEST * 2^k` of frame height for k = 0..LOBES, at *any*
 * resolution — 0.4%, 0.8%, 1.6% and 3.2%, inside §5.4's 4% ceiling. At an octave step the agreement
 * is exact (1440 rows uses base 2 where 720 uses base 1, with the same residual radius); between
 * octaves the residual is carried by the tent width, which corrects most but not all of it.
 *
 * Two things fall out of this for free. The accumulated buffer is **the same size at every
 * resolution** — 270 rows at 1080p and 270 rows at 4K — so the composite's cost does not grow with
 * the viewport, and the chain issues `top + LOBES` draws (7 at 1080p, 8 at 4K) instead of `2 *
 * levels` (10 and 12). `review/measure/P12.mjs` claim B4 pushes an identical point emitter through
 * the real chain at 360, 720 and 1440 rows and fails if the measured 90%-energy radii, as a
 * fraction of frame height, disagree by more than 20% or exceed 4%.
 */
const FINEST = 0.004; // finest accumulated lobe, as a fraction of frame height
const LOBES = 3; // accumulation steps above it: 0.4% -> 0.8% -> 1.6% -> 3.2%
const MAX_TOP = 8;

/**
 * Attenuation applied at each upsample step, **indexed from the coarsest level down**, not from mip
 * 1 up. That indexing is the whole resolution-independence story and it is easy to get backwards.
 *
 * The chain is nested — `mip[i-1] += tent(mip[i]) * w(i)` — so the energy a given lobe finally
 * contributes at mip 0 is the product of every weight below it. Index the weights from the bottom
 * and doubling the viewport inserts a brand new *fine* level carrying the largest weight, which
 * tightens the halo and puts more energy in the core: the bloom visibly changes character between
 * 1080p and 4K, which `quality-bar.md` G7 forbids. Indexed from the top, the coarse lobes — the
 * ones that carry the halo's apparent size — keep the same product at every resolution, and the
 * extra fine level a 4K frame gains arrives at weight 1.0, which is correct: at 4K there genuinely
 * is another octave of detail in the core and it should pass through unattenuated.
 *
 * Measured: the effective weight of the three coarsest lobes is 0.327 / 0.595 / 0.850 at 3 levels
 * and 0.311 / 0.565 / 0.808 at 5 levels — inside 5% across a 4x change in pixel count.
 * `review/measure/P12.mjs` claim B4 re-measures it as the 90%-energy radius of a real halo.
 */
const TOP_WEIGHTS = [0.55, 0.7, 0.85, 0.95, 1.0, 1.0, 1.0, 1.0];

/** Which levels this viewport allocates, accumulates and composites. Pure; exported for tests. */
export function bloomLevels(height) {
  const baseExact = Math.log2(FINEST * Math.max(8, height)) - 1;
  const base = Math.max(0, Math.min(MAX_TOP - LOBES, Math.round(baseExact)));
  const top = Math.min(MAX_TOP, base + LOBES);
  return { base, top, radius: Math.pow(2, baseExact - base) };
}

/** The widest accumulated lobe, as a fraction of frame height. Published on the probe. */
export function bloomRadiusFraction(height) {
  const { top, radius } = bloomLevels(height);
  return (Math.pow(2, top + 1) * radius) / Math.max(8, height);
}

export class BloomPass {
  constructor() {
    this.mips = [];
    this.base = 0;
    this.top = 0;
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

  /** The texture the composite reads: the base of the accumulation window. */
  get texture() {
    return this.mips[this.base]?.texture ?? null;
  }

  /** The bright-pass target — also the source the sun-glow pass scatters. */
  get brightTarget() {
    return this.mips[0] ?? null;
  }

  /** Full-screen draws this chain issues: one downsample per level, one upsample per lobe. */
  get drawCalls() {
    return this.top + (this.top - this.base);
  }

  setSize(width, height) {
    const { base, top, radius } = bloomLevels(height);
    this.radius = radius;
    this.base = base;

    if (this.top !== top) {
      for (const m of this.mips) m.dispose();
      this.mips = [];
      this.top = top;
      for (let i = 0; i <= top; i++) this.mips.push(makeTarget(1, 1, { name: `vs.bloom.${i}` }));
    }
    for (let i = 0; i <= top; i++) {
      const w = Math.max(1, Math.floor(width / Math.pow(2, i + 1)));
      const h = Math.max(1, Math.floor(height / Math.pow(2, i + 1)));
      this.mips[i].setSize(w, h);
    }
  }

  /** Runs the chain. `mips[0]` must already hold the bright pass output. */
  render(renderer) {
    for (let i = 1; i <= this.top; i++) {
      const src = this.mips[i - 1];
      this.downMaterial.uniforms.tSrc.value = src.texture;
      this.downMaterial.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
      this.down.render(renderer, this.mips[i]);
    }
    for (let i = this.top; i > this.base; i--) {
      const src = this.mips[i];
      this.upMaterial.uniforms.tSrc.value = src.texture;
      this.upMaterial.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
      this.upMaterial.uniforms.uRadius.value = this.radius;
      this.upMaterial.uniforms.uWeight.value = TOP_WEIGHTS[this.top - i] ?? 1;
      this.up.render(renderer, this.mips[i - 1], { clear: false });
    }
  }

  stats() {
    return {
      base: this.base,
      top: this.top,
      lobes: this.top - this.base,
      tentRadius: Number(this.radius.toFixed(3)),
      compositeSize: this.mips[this.base] ? [this.mips[this.base].width, this.mips[this.base].height] : null,
      mipSizes: this.mips.map((m) => [m.width, m.height]),
      drawCalls: this.drawCalls,
    };
  }

  dispose() {
    for (const m of this.mips) m.dispose();
    this.mips = [];
    this.down.dispose();
    this.up.dispose();
  }
}
