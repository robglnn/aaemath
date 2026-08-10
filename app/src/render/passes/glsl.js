/**
 * Shared GLSL for the post chain (piece P12).
 *
 * Everything here is written for this project. The constants are not decoration — each one
 * is tied to a number in `design/art-direction.md`, and the comment says which.
 *
 * The single most important rule in this file: **there is exactly one place in the whole
 * frame where linear light becomes an 8-bit sRGB code**, and it is `encodeSRGB()` at the
 * bottom of `GradePass`. Three.js only inserts its own `linearToOutputTexel()` when a shader
 * contains `#include <colorspace_fragment>`; none of ours does, and none of ours may, because
 * a second encode is anti-pattern 19 (`design/art-direction.md` §12.19) and it silently moves
 * every colour in `design/palette.json`.
 */

/** Rec.709 relative luminance of a *linear* triplet — the same number `palette.json` uses. */
export const LUMINANCE = /* glsl */ `
float vsLum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;

/**
 * The Variable Star filmic curve. Scene-linear in, display-linear out, applied per channel.
 *
 *   f(x) = x                                        for x <= S
 *   f(x) = W - (W - S) * exp(-(x - S) / (W - S))    for x >  S
 *
 * Three properties, and each is a requirement from §10 rather than a taste:
 *
 *  1. **The toe does not crush.** Below S the curve is the identity, so every scene-linear
 *     value under S survives to the display with its contrast intact. §10 budgets ≤ 4% of
 *     pixels at Y ≤ 0.01 and wants 25% of frame below Y 0.147 still carrying form; a curve
 *     that is literally linear down there cannot fail that for a reason of its own.
 *  2. **The shoulder is soft and it desaturates.** It is C1-continuous at x = S (both sides
 *     have slope 1) and asymptotes to W, so a bright saturated colour has its channels
 *     compressed at different rates and converges toward white — §10(a), which measured the
 *     armour's light band at S 0.67 and its specular at S 0.373. A hard clamp does the
 *     opposite and skews hue: anti-pattern 15.
 *  3. **Pure white is reachable, but only from far away.** f(x) = 0.99 at x = 2.378 with the
 *     shipped constants, so §8's rule — drive the KaTeX glyph emissive ≥ 4× the linear value
 *     that maps to Y 0.99 and let it clip *through* the shoulder — lands on 1.000, while a
 *     sunlit rock facet at scene-linear 0.5 lands at 0.500 and never approaches it.
 *
 * It is deliberately not Reinhard (forbidden by §10: it flattens the mid plateau) and
 * deliberately not a hard clamp. It is a constant: no auto-exposure, no histogram, no
 * adaptation, so §15.1's `M6` (median frame Y step ≤ 0.005) is zero by construction.
 */
export const FILMIC = /* glsl */ `
uniform float uShoulder;   // S — scene-linear value where compression begins
uniform float uWhite;      // W — the asymptote the curve approaches but never reaches

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
 * §10 makes this binding and explains why it is a rule rather than a preference: a builder who
 * reaches the same distinct-code count with per-frame white noise passes `S1` and `S2` on every
 * individual frame and ships a sky that fizzes. The same screen pixel must get the same offset
 * on every frame for as long as that pixel exists — so this is a pure function of
 * `gl_FragCoord`, with no time, no frame index and no camera term anywhere in it. §15.4's `M4`
 * is the check, and a fixed tile scores 0.
 *
 * Indexing by `gl_FragCoord` rather than by a UV is the other half: on a 2× DPR display a
 * CSS-pixel UV resamples the tile and it stops being fixed, which is anti-pattern 23 arriving
 * through the back door (anti-pattern 29).
 */
export const BAYER = /* glsl */ `
// The 2x2 seed [[0,2],[3,1]]/4, written without bitwise operators because ShaderMaterial
// compiles as GLSL ES 1.00 and integer bit ops do not exist there.
float vsBayer2(vec2 p) {
  p = floor(p);
  return fract(p.x * 0.5 + p.y * p.y * 0.75);
}
// Two recursions of M(2n) = M(n)/4 + M(2), which yields 16 then 64 distinct levels, each
// occurring exactly once per tile. Verified as a strict permutation by review/measure/P12.mjs.
float vsBayer4(vec2 p) { return vsBayer2(p * 0.5) * 0.25 + vsBayer2(p); }
float vsBayer8(vec2 p) { return vsBayer4(p * 0.5) * 0.25 + vsBayer2(p); }
`;

/**
 * Static value hash for the film grain. No time term, for exactly the reason `vsBayer8` has
 * none: §10 extends §15.4's fixed-pattern rule to "every other screen-space noise source in
 * the frame". Animated grain is a whole-frame `M1a` failure wearing a film-stock costume.
 */
export const HASH = /* glsl */ `
float vsHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
`;

/**
 * Soft-knee bright pass.
 *
 * §8 forbids a *global luminance threshold* — "the sky and the sunlit rock bloom too and the
 * frame turns to soup" — and requires an emissive mask. This threshold is the emissive mask,
 * expressed in the only domain where the two are the same thing: **scene-linear light, above
 * the shoulder**. §10 exposes the world so a lit rock facet renders near display-linear 0.42
 * and the sky's brightest band near 0.63; with the shipped curve those are scene-linear 0.42
 * and 0.63. The threshold ships at 1.35 — more than twice the brightest *surface* in the
 * frame — so the only things that clear it are the objects §10 reserves pure white for:
 * emitter cores, the sun, and KaTeX glyphs. `review/measure/P12.mjs` claim B2 measures the
 * leak on a synthetic sky/rock plate and fails above 1%.
 *
 * The knee is quadratic and C1-continuous at both ends, so an emitter crossing the threshold
 * as it dims fades in instead of switching (anti-pattern 27).
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
