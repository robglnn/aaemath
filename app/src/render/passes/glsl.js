/**
 * Shared GLSL for the post chain (piece P12).
 *
 * The binding render target is `reference/target-lowpoly.png`: flat-shaded low-poly, hard
 * silhouette edges, one value per facet. Everything in this file exists to serve one rule that
 * `design/art-direction.md` states three separate times, and which post-processing is the single
 * easiest way to break:
 *
 *   > **Post may not soften the picture.** §4 — "Antialias, do not soften". §12.10 — "A bloom that
 *   > touches everything". §12.19 — "Soft gradients everywhere". §3.3 — a facet holds exactly one
 *   > value, measured spread 0.0096, and anything above 0.02 across a face means smoothing leaked in.
 *
 * Two consequences run through every chunk below.
 *
 * **1. The display transform is a mirror, not an opinion.** §3.5 is explicit: *"the value ladder in
 * §1.2 is an undistorted cosine, which is only possible with a linear path from N·L to the final
 * linear value… The palette is the grade"*, and §12.6 names a filmic tonemap as an anti-pattern
 * because *"it compresses the value ladder and the facets stop reading as facets"*. So this chain's
 * grade does not invent a look. It reproduces, exactly, whatever transform `renderer.toneMapping`
 * is set to — because Three.js silently switches scene materials to `NoToneMapping` the moment you
 * render into a render target (`three.module.js`, `WebGLPrograms.getParameters`: `if (material
 * .toneMapped) { if (currentRenderTarget === null …) toneMapping = renderer.toneMapping }`), and a
 * composer that did not put the transform back would change the entire world's exposure just by
 * existing. `VS_DISPLAY_VS` is the curve §3.5 actually asks for, and with the shipped constants it
 * is the identity below 1.0 to the last bit — measured, not asserted, by `review/measure/P12.mjs`
 * claim B2.
 *
 * **2. Every screen-space pattern is a pure function of `gl_FragCoord`.** No time term, no frame
 * index, no camera term, anywhere in this file. §11.6 budgets *"no more than 0.2% of pixels may
 * change by more than 0.05 of luminance"* with the camera static and one fixed step advanced, and
 * animated grain or temporal dither fails that on its own without a single triangle moving.
 */

/** Rec.709 relative luminance of a *linear* triplet — the same number `palette.json` uses. */
export const LUMINANCE = /* glsl */ `
float vsLum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;

/**
 * Display-transform modes. The first three reproduce Three.js exactly so that inserting the
 * composer is a no-op on the base image; the fourth is this project's own curve.
 */
export const DISPLAY_MODE = { none: 0, linear: 1, aces: 2, vs: 3 };

/** Map a `THREE.*ToneMapping` constant onto a mode id. Unknown curves fall back to a mirror-safe none. */
export function displayModeForToneMapping(toneMapping) {
  // THREE.NoToneMapping = 0, LinearToneMapping = 1, ReinhardToneMapping = 2, CineonToneMapping = 3,
  // ACESFilmicToneMapping = 4, CustomToneMapping = 5, AgXToneMapping = 6, NeutralToneMapping = 7.
  if (toneMapping === 4) return DISPLAY_MODE.aces;
  if (toneMapping === 1) return DISPLAY_MODE.linear;
  return DISPLAY_MODE.none;
}

/**
 * The Variable Star curve, and the reason it is shipped as the identity.
 *
 *   f(x) = x                                        for x <= S
 *   f(x) = W - (W - S) * exp(-(x - S) / (W - S))    for x >  S
 *
 * C1-continuous at S (both sides have slope 1) and asymptotic to W. **Shipped at S = 1.0,
 * W = 1.0**, which makes it exactly `min(x, 1)`: identity across the whole displayable range and a
 * clean per-channel clip above it.
 *
 * That is not a curve that failed to get tuned. It is what §3.5 and §12.6 require, and §3.5 says
 * what happens at the top too: *"Emitters clip; they do not roll off"* — measured at 0.69% of frame
 * at Y >= 0.90 and 0.11% at pure `#FFFFFF`, which is the crystal cores, the sun and the KaTeX
 * clipping through, exactly as a per-channel clip produces. A saturated cyan emitter driven to
 * (1.8, 3.0, 2.7) lands on pure white by clipping, which is the behaviour the target shows.
 *
 * Lowering S below 1.0 compresses §1.2's cosine ladder (Y 1.00 / 0.71 / 0.61 / 0.54 / 0.27 / 0.05,
 * which must sit within ±0.03 of a plausible N·L) and is a §13-row-1 failure. The knob exists
 * because HDR output or a future tier may want it; the shipped value is the measured one.
 */
export const FILMIC = /* glsl */ `
uniform float uShoulder;   // S — value where compression begins. Shipped 1.0 = no compression.
uniform float uWhite;      // W — the asymptote. Shipped 1.0.

float vsFilmicCh(float x) {
  x = max(x, 0.0);
  if (x <= uShoulder) return x;
  float span = max(uWhite - uShoulder, 1e-4);
  return uWhite - span * exp(-(x - uShoulder) / span);
}
vec3 vsFilmic(vec3 c) {
  return vec3(vsFilmicCh(c.r), vsFilmicCh(c.g), vsFilmicCh(c.b));
}
`;

/**
 * ACES filmic, reproducing `THREE.ACESFilmicToneMapping` term for term.
 *
 * This is not a look choice and it is not lifted work — it is the RRT/ODT fit, a published
 * transfer function, transcribed so the composite can be *transparent*: `Sky.js` numerically
 * inverts this exact curve to place every palette stop, and if the composer applied a different
 * one every colour in `design/palette.json` would land somewhere else. When the renderer is moved
 * to `NoToneMapping` per §3.5, `displayModeForToneMapping()` follows it and this function stops
 * being compiled in at all.
 */
export const ACES = /* glsl */ `
vec3 vsRRTAndODTFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 vsACES(vec3 color, float exposure) {
  const mat3 IN = mat3(
    vec3(0.59719, 0.07600, 0.02840),
    vec3(0.35458, 0.90834, 0.13383),
    vec3(0.04823, 0.01566, 0.83777));
  const mat3 OUT = mat3(
    vec3( 1.60475, -0.10208, -0.00327),
    vec3(-0.53108,  1.10813, -0.07276),
    vec3(-0.07367, -0.00605,  1.07602));
  color *= exposure / 0.6;
  color = IN * color;
  color = vsRRTAndODTFit(color);
  color = OUT * color;
  return clamp(color, 0.0, 1.0);
}
`;

/**
 * The one place scene-linear light becomes display-linear.
 *
 * `VS_DISPLAY` is a compile-time integer, so a tier running the linear path carries no ACES
 * matrices in its binary at all. `uDisplayExposure` mirrors `renderer.toneMappingExposure`, which
 * `world/Lighting.js` drives at runtime — under `NoToneMapping` Three.js applies no exposure, so
 * neither do we, or the mirror would stop being a mirror.
 */
export const DISPLAY = /* glsl */ `
uniform float uDisplayExposure;

vec3 vsDisplay(vec3 c) {
  #if VS_DISPLAY == 1
    return clamp(c * uDisplayExposure, 0.0, 1.0);
  #elif VS_DISPLAY == 2
    return vsACES(c, uDisplayExposure);
  #elif VS_DISPLAY == 3
    return vsFilmic(c * uDisplayExposure);
  #else
    return c;
  #endif
}
`;

/** The sRGB opto-electronic transfer function. The one and only encode in the frame. */
export const SRGB_ENCODE = /* glsl */ `
vec3 vsEncodeSRGB(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(0.41666667)) - 0.055, step(vec3(0.0031308), c));
}
`;

/**
 * 8x8 ordered Bayer, indexed in **device pixels**.
 *
 * §3.5 makes this binding, and gives the measurement it is there to reproduce: the target carries
 * *"378 distinct colours down a 461-row sky column, longest constant run 4 rows"*, and §13 row 8
 * fails a render whose longest constant run exceeds 6. That is a dithered analytic ramp, and 8 bits
 * without dither cannot do it.
 *
 * It is a pure function of `gl_FragCoord` — no time, no frame index — because per-frame noise
 * reaches the same distinct-colour count and ships a sky that fizzes under §11.6. Indexing by
 * `gl_FragCoord` rather than a UV is the other half: on a 2x DPR display a CSS-pixel UV resamples
 * the tile and it stops being a fixed pattern.
 */
export const BAYER = /* glsl */ `
// The 2x2 seed [[0,2],[3,1]]/4, written without bitwise operators because ShaderMaterial compiles
// as GLSL ES 1.00 and integer bit ops do not exist there.
float vsBayer2(vec2 p) {
  p = floor(p);
  return fract(p.x * 0.5 + p.y * p.y * 0.75);
}
// Two recursions of M(2n) = M(n)/4 + M(2), which yields 16 then 64 distinct levels, each occurring
// exactly once per tile. Verified as a strict permutation by review/measure/P12.mjs claim B3.
float vsBayer4(vec2 p) { return vsBayer2(p * 0.5) * 0.25 + vsBayer2(p); }
float vsBayer8(vec2 p) { return vsBayer4(p * 0.5) * 0.25 + vsBayer2(p); }
`;

/** Static value hash for the film grain. No time term, for the same reason `vsBayer8` has none. */
export const HASH = /* glsl */ `
float vsHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
`;

/**
 * Soft-knee bright pass — the gate that decides what is allowed to glow.
 *
 * §5.4 is the law: *"Bloom is permitted and tightly gated… applied only to the accent class: crystal,
 * carry, city strips, the sun glow, KaTeX. Bloom must never touch rock, ground, foliage, character
 * or UI. A bloom that leaks onto a lit rock facet destroys the flatness in a single frame."*
 *
 * The threshold is expressed in **scene-linear** light, upstream of the display transform, and that
 * is what turns a luminance threshold into the class mask §5.4 asks for. §3.2 calibrates the
 * brightest lit rock facet at Y 0.4435 and §6.1 the hottest sky pixel at Y 0.8926 — those are
 * *surfaces*, and a surface cannot exceed the light falling on it. An emitter is not a surface:
 * §5.4 gives crystal cores and carry surfaces their own `emissive` on top of the lit result and
 * §10.2 drives KaTeX above white on purpose. Only the second group crosses 1.0. The shipped
 * threshold is set from a measured histogram of the live scene target rather than from taste —
 * `review/measure/P12.mjs` claim B1 re-measures the leak onto a synthetic rock/sky plate and fails
 * above 1% of the emitter's own energy.
 *
 * The knee is quadratic and C1-continuous at both ends, so an emitter crossing the threshold as it
 * dims fades in instead of switching — §11.4 caps an emitter's screen energy change at 3% per fixed
 * step and a hard threshold turns that into a coin flip.
 */
export const SOFT_KNEE = /* glsl */ `
vec3 vsSoftKnee(vec3 c, float threshold, float knee) {
  float br = max(c.r, max(c.g, c.b));
  float soft = clamp(br - threshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-5);
  float weight = max(soft, br - threshold) / max(br, 1e-5);
  return c * weight;
}
`;

/** Vertex shader shared by every full-screen pass. One triangle, no matrices, no varyings but uv. */
export const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// ---------------------------------------------------------------------------------------------
// CPU mirrors. `review/measure/P12.mjs` runs these against a GPU readback of the real shader, so a
// drift between the two is caught rather than argued about.
// ---------------------------------------------------------------------------------------------

const ACES_IN = [
  [0.59719, 0.35458, 0.04823],
  [0.076, 0.90834, 0.01566],
  [0.0284, 0.13383, 0.83777],
];
const ACES_OUT = [
  [1.60475, -0.53108, -0.07367],
  [-0.10208, 1.10813, -0.00605],
  [-0.00327, -0.07276, 1.07602],
];

const mul3 = (m, v) => m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);

/** CPU twin of `vsDisplay`. Same arithmetic, same order, same clamps. */
export function displayTransformCPU(mode, rgb, { exposure = 1, shoulder = 1, white = 1 } = {}) {
  if (mode === DISPLAY_MODE.linear) {
    return rgb.map((c) => Math.min(1, Math.max(0, c * exposure)));
  }
  if (mode === DISPLAY_MODE.aces) {
    let v = rgb.map((c) => c * (exposure / 0.6));
    v = mul3(ACES_IN, v);
    v = v.map((x) => {
      const a = x * (x + 0.0245786) - 0.000090537;
      const b = x * (0.983729 * x + 0.432951) + 0.238081;
      return a / b;
    });
    v = mul3(ACES_OUT, v);
    return v.map((x) => Math.min(1, Math.max(0, x)));
  }
  if (mode === DISPLAY_MODE.vs) {
    const span = Math.max(white - shoulder, 1e-4);
    return rgb.map((c) => {
      const x = Math.max(0, c * exposure);
      return x <= shoulder ? x : white - span * Math.exp(-(x - shoulder) / span);
    });
  }
  return rgb.slice();
}

/** CPU twin of `vsEncodeSRGB`. */
export function encodeSRGBCPU(rgb) {
  return rgb.map((c) => {
    const x = Math.min(1, Math.max(0, c));
    return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  });
}
