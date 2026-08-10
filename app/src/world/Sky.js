import * as THREE from "three";
import { publish, warn } from "../core/Introspect.js";
import { config } from "../core/Config.js";
import { signals } from "../core/Signals.js";

/**
 * Sky — P10.
 *
 * The sky is a third of every frame in `reference/brief-hero.png` and it is doing real work.
 * This file is the shader that has to do that work in real time, plus the star that the whole
 * product is named after.
 *
 * ## What is here
 *
 * 1. **A ray-reconstructed sky.** One full-screen triangle, `depthTest:false`, drawn first. The
 *    view ray is rebuilt per pixel from `camera.matrixWorld` and `projectionMatrixInverse`, both
 *    uploaded in `onBeforeRender` so the sky can never lag the camera by a frame no matter what
 *    order the systems' `after()` hooks run in. Costs **1 draw call and 1 triangle** — a dome
 *    mesh would cost the same fill and a lot more vertex work for nothing.
 *
 * 2. **A gradient with a real horizon falloff.** Not a lerp. The ramp is driven by relative
 *    airmass `1/(sin(elevation) + 0.055)`, which compresses ~70% of the travel into the bottom
 *    18° of sky exactly the way the reference does, and it passes through `sky.pivot`'s neutral
 *    crossover (S 0.075) — art-direction §9: "a zenith→horizon gradient that never drops below
 *    S 0.14 looks like a shader default."
 *
 *    **Where the palette's four sky stops actually live.** `palette.json` records them by *frame
 *    row* in the reference (y = 0.00 / 0.08 / 0.21 / 0.30) with the horizon at y = 0.31. Solving
 *    that framing for a pinhole camera puts them at elevations **18.1° / 13.9° / 6.3° / 0.9°** —
 *    the whole measured column is the bottom 18° of the sky, and none of it is the zenith. So a
 *    fifth stop is authored for the true zenith by continuing the measured trend (hue 203,
 *    S 0.343, V 0.663). Everything below 18° is the painting; above it is extrapolation, and this
 *    comment is where that is admitted.
 *
 * 3. **Lethis.** `world.md` §3: "its output is an unsolved function: it swells and dims on a
 *    period nobody has pinned." Implemented as art-direction §15.7 requires — key *intensity*
 *    only, 1.00 ± 0.12, driven by five sinusoids on **prime** periods (41/67/113/269/617 s) so
 *    the sum does not repeat inside a session. It is a closed-form function of `simTime`, not an
 *    integrator, which makes it deterministic (G4) *and* makes its rate limit provable rather
 *    than measured: |d/dt| ≤ 0.0081/s = 0.000134 per fixed step, against §15.7's 0.0015 ceiling.
 *
 * 4. **An aurora that is a curtain, not a gradient.** Three sheets, each with a folding lower
 *    edge, an exponential fade upward, and vertical striations that are a function of **azimuth
 *    only** — that independence from elevation is the entire reason a curtain reads as a curtain.
 *    Driven by a value-noise fBm written in this file, warped in a way that *deforms* rather than
 *    translates; `review/measure/P10.mjs` proves that with a residual-after-optimal-shift test.
 *
 * 5. **Clouds that are not a scrolling texture.** Two layers on separate altitudes, each
 *    domain-warped by a second noise field that itself moves, and each octave advected on its own
 *    velocity. Same shift-residual proof.
 *
 * 6. **The Errata** — `world.md` §3's "wandering storm of failed statements … a hole in the sky
 *    on the far horizon, moving." It erases sky, clouds and aurora alike, has a ragged edge that
 *    churns, and drifts at 0.12°/s so it is visibly somewhere else ten seconds later.
 *
 * 7. **A fixed 8×8 ordered Bayer dither**, applied after the tonemap and the colour-space
 *    transform, immediately before 8-bit quantisation, from `gl_FragCoord` alone — never from
 *    time, frame index or camera state. Art-direction §15.4 and `M4`.
 *
 * ## Which side of the tonemap
 *
 * Every colour in `palette.json` is **display-referred** — measured off a finished PNG. The sky
 * is written *before* `ACESFilmicToneMapping`, so feeding the palette's `linear` triplets
 * straight into the shader would land the frame a long way under the painting. `inverseToneMap()`
 * below solves ACES numerically for the scene-referred radiance that comes *out* at the palette
 * value, and the residual is published on the probe so the claim is checkable. Re-solved whenever
 * `renderer.toneMapping` or `toneMappingExposure` changes.
 *
 * ## The sun is published, not read
 *
 * The disc and the glow have to agree with the key light, so somebody has to own the bearing.
 * **P10 owns it and publishes `world:sun`** (see SIGNAL below); P11's rig should listen and point
 * its key, not set one. A payload arriving with `source:"lighting"` is adopted, which is the same
 * two-way pattern `camera:mode` uses, so a later lighting piece can take the bearing over without
 * either module importing the other.
 */

// ---------------------------------------------------------------------------------------------
// Palette — display-referred linear triplets, copied from design/palette.json with the role name.
// These are what must come OUT of the frame; inverseToneMap() turns them into what goes in.
// ---------------------------------------------------------------------------------------------

export const SKY_ROLES = {
  zenithDeep: [0.1589, 0.2831, 0.4019], // AUTHORED #6F91A9 — the true zenith, see header note 2
  zenith: [0.2664, 0.4125, 0.5029], // sky.zenith   #8DACBC @ 18.1° elevation
  upper: [0.3968, 0.491, 0.5711], // sky.upper    #A9BAC7 @ 13.9°
  pivot: [0.5711, 0.5457, 0.4793], // sky.pivot    #C7C3B8 @  6.3°  (S 0.075 — the crossover)
  horizon: [0.8796, 0.5841, 0.3813], // sky.horizon  #F1C9A6 @  0.9°
  under: [0.92, 0.66, 0.47], // AUTHORED — below the horizon there is more sky, and it
  //            gets brighter downward: world.md §2.3 / art-direction §0.1 W2
  sun: [1.0, 0.807, 0.3515], // sky.sun      #FFE8A0
  auroraMint: [0.5333, 0.8228, 0.5906], // aurora.mint   #C1EACA
  auroraTeal: [0.4564, 0.6514, 0.5776], // aurora.teal   #B4D3C8
  auroraViolet: [0.5647, 0.5395, 0.6584], // aurora.violet #C6C2D4
  erasure: [0.016, 0.0116, 0.0212], // rock.shadow.deep #221C28 — the Errata is a hole
  resonance: [0.0284, 0.7682, 0.6724], // resonance.core #2FE3D6 — the Errata's cut edge
};

/** The world bearing of Lethis. Fixed for the session; art-direction §2 / §15.7. */
export const SUN = {
  elevationDeg: 8, // art-direction §2, non-negotiable
  azimuthDeg: 118, // AUTHORED HERE. palette.json's 62° is "in reference framing only".
  colorHex: "#FFE8A0", // sky.sun — type the hex, never the kelvin (art-direction §2)
};

/** Lethis's aperiodic swell. art-direction §15.7 / palette.json motion.timeOfDay. */
const LETHIS = {
  mean: 1.0,
  swing: 0.12,
  periods: [41, 67, 113, 269, 617], // all prime => the sum does not repeat in a session
  phases: [0.0, 1.31, 2.62, 4.11, 5.5],
};

/** Per-tier shader cost. Everything expensive here is a loop bound baked as a #define. */
const TIER_SKY = {
  potato: { cloudOct: 2, curtains: 1, aurOct: 1, errata: 0, cirrus: 0 },
  low: { cloudOct: 3, curtains: 2, aurOct: 2, errata: 1, cirrus: 1 },
  medium: { cloudOct: 4, curtains: 3, aurOct: 2, errata: 1, cirrus: 1 },
  high: { cloudOct: 5, curtains: 3, aurOct: 3, errata: 1, cirrus: 1 },
  ultra: { cloudOct: 5, curtains: 4, aurOct: 3, errata: 1, cirrus: 1 },
};

// ---------------------------------------------------------------------------------------------
// ACES, in JS, and its inverse.
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

function mul3(m, v) {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

/** Bit-exact port of three's `ACESFilmicToneMapping` GLSL. Scene-referred in, display-linear out. */
export function acesFilmic(rgb, exposure = 1) {
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

/**
 * Solve ACES for the scene-referred radiance that lands on `target` (a display-referred linear
 * triplet). Damped fixed-point; the curve is monotone per channel so it converges in a few
 * iterations even though the two matrices mix channels. Returns `{rgb, residual, iterations}`
 * and the residual is published — a claim nobody can check is a hope.
 */
export function inverseToneMap(target, exposure = 1, toneMapping = THREE.ACESFilmicToneMapping) {
  if (toneMapping !== THREE.ACESFilmicToneMapping) {
    // No curve (or somebody else's curve): the honest answer is "pass it through" — the sky is
    // then display-referred, which is what a NoToneMapping pipeline expects.
    return { rgb: target.slice(), residual: 0, iterations: 0 };
  }
  let s = target.slice();
  let residual = 1;
  let i = 0;
  for (; i < 64; i++) {
    const f = acesFilmic(s, exposure);
    residual = Math.max(...f.map((x, c) => Math.abs(x - target[c])));
    if (residual < 1e-5) break;
    for (let c = 0; c < 3; c++) {
      const ratio = (target[c] + 1e-5) / (f[c] + 1e-5);
      s[c] = Math.max(0, s[c] * Math.pow(ratio, 0.75));
    }
  }
  return { rgb: s, residual, iterations: i };
}

/** Lethis's intensity at a game time. Pure, deterministic, closed form. */
export function lethisAt(simTime) {
  let sum = 0;
  for (let i = 0; i < LETHIS.periods.length; i++) {
    sum += Math.sin((2 * Math.PI * simTime) / LETHIS.periods[i] + LETHIS.phases[i]);
  }
  return LETHIS.mean + LETHIS.swing * (sum / LETHIS.periods.length);
}

/** The largest |d/dt| the swell can ever reach — proved, not sampled. */
export function lethisMaxRatePerSecond() {
  let s = 0;
  for (const p of LETHIS.periods) s += (2 * Math.PI) / p;
  return (LETHIS.swing / LETHIS.periods.length) * s;
}

/** Unit vector from the world origin toward Lethis. Azimuth measured from +Z toward +X. */
export function sunDirection(elevationDeg = SUN.elevationDeg, azimuthDeg = SUN.azimuthDeg) {
  const e = (elevationDeg * Math.PI) / 180;
  const a = (azimuthDeg * Math.PI) / 180;
  return new THREE.Vector3(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a));
}

// ---------------------------------------------------------------------------------------------
// GLSL. Shared with Atmosphere.js (same piece), which reuses the noise and the gradient so the
// aerial-perspective target colour and the sky behind it are literally the same function.
// ---------------------------------------------------------------------------------------------

/** Value-noise toolkit. Authored here: no trig, no textures, no dependence on derivatives. */
export const GLSL_NOISE = /* glsl */ `
float vsHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.20219, 0.16843, 0.27547));
  q += dot(q, q.yzx + 47.109);
  return fract((q.x + q.y) * (q.z + q.x));
}

float vsNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = vsHash(i);
  float b = vsHash(i + vec2(1.0, 0.0));
  float c = vsHash(i + vec2(0.0, 1.0));
  float d = vsHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Rotate-and-scale between octaves so the field has no axis-aligned grain.
const mat2 VS_OCT = mat2(1.6598, 0.9834, -0.9834, 1.6598);
`;

/**
 * The sky gradient, as a function of world direction. Exported so Atmosphere.js can ask the sky
 * what colour is behind a distant surface instead of guessing.
 * Requires the uniforms `uZenithDeep uZenith uUpper uPivot uHorizon uUnder` (scene-referred).
 */
export const GLSL_GRADIENT = /* glsl */ `
uniform vec3 uZenithDeep;
uniform vec3 uZenith;
uniform vec3 uUpper;
uniform vec3 uPivot;
uniform vec3 uHorizon;
uniform vec3 uUnder;

// Relative airmass through a slab atmosphere. 0.055 is a horizon-limiting constant: it caps the
// path length at ~18 airmasses instead of letting 1/sin blow up, which is what a real atmosphere
// with curvature does and what a naive 1/sin(elev) sky gets visibly wrong at the skyline.
float vsAirmass(float sinElev) {
  return 1.0 / (max(sinElev, 0.0) + 0.055);
}

// x runs 0 at the zenith to 1 at the skyline, non-linearly, driven by airmass. The five stops
// sit at the elevations palette.json's sky column was actually sampled at (see file header).
float vsSkyRampX(float sinElev) {
  float m = vsAirmass(sinElev);
  return clamp((m - 0.94787) / (18.1818 - 0.94787), 0.0, 1.0);
}

vec3 vsSkyGradient(vec3 dir) {
  if (dir.y >= 0.0) {
    float x = vsSkyRampX(dir.y);
    vec3 c = mix(uZenithDeep, uZenith, smoothstep(0.0, 0.1043, x));
    c = mix(c, uUpper, smoothstep(0.1043, 0.1403, x));
    c = mix(c, uPivot, smoothstep(0.1403, 0.2970, x));
    c = mix(c, uHorizon, smoothstep(0.2970, 0.7650, x));
    return c;
  }
  // There is no ground under this world. Below the skyline the sky keeps going and gets
  // BRIGHTER downward, because a gap between two leaves is lit from the far side.
  float d = clamp(-dir.y, 0.0, 1.0);
  return mix(uHorizon, uUnder, smoothstep(0.0, 0.55, d));
}
`;

// ---------------------------------------------------------------------------------------------

const VERT = /* glsl */ `
uniform mat4 uCamWorld;
uniform mat4 uProjInv;
varying vec3 vRay;

void main() {
  // A full-screen triangle whose vertices are already in NDC. z = 1 puts it on the far plane;
  // depthTest is off so nothing about the depth buffer matters, and nothing is ever culled.
  vec4 clip = vec4(position.xy, 1.0, 1.0);
  vec4 eye = uProjInv * clip;
  vRay = (uCamWorld * vec4(eye.xyz / eye.w, 0.0)).xyz;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

function fragmentShader(knobs) {
  return /* glsl */ `
precision highp float;

#define CLOUD_OCT ${knobs.cloudOct}
#define AUR_CURTAINS ${knobs.curtains}
#define AUR_OCT ${knobs.aurOct}
#define ERRATA ${knobs.errata}
#define CIRRUS ${knobs.cirrus}

uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uLethis;
uniform float uTime;
uniform float uMotion;
uniform vec3 uAurMint;
uniform vec3 uAurTeal;
uniform vec3 uAurViolet;
uniform vec3 uErasure;
uniform vec3 uCutEdge;
uniform float uAurGain;
uniform float uCloudGain;
uniform float uDither;

varying vec3 vRay;

${GLSL_NOISE}
${GLSL_GRADIENT}

float vsFbm(vec2 p, int octaves) {
  float a = 0.5;
  float s = 0.0;
  float n = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    s += a * vsNoise(p);
    n += a;
    p = VS_OCT * p;
    a *= 0.52;
  }
  return s / max(n, 1e-4);
}

// ------------------------------------------------------------------ clouds
// Two decks on different altitudes. The domain warp is itself a moving noise field, and every
// octave is advected on its own velocity, so the shape DEFORMS. A texture that scrolls can be
// undone by one 2-D shift; this cannot, and review/measure/P10.mjs measures exactly that.
float vsCloudLayer(vec2 base, float t, float warpAmp, float warpFreq, vec2 vel, int oct) {
  vec2 w = vec2(
    vsNoise(base * warpFreq + vec2(t * 0.021, -t * 0.013)),
    vsNoise(base * warpFreq * 1.17 + vec2(31.7 - t * 0.017, 11.3 + t * 0.011))
  ) - 0.5;
  vec2 p = base + w * warpAmp + vel * t;
  float a = 0.5;
  float s = 0.0;
  float n = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    // Per-octave drift: fine detail runs faster than the mass it sits on, which is what stops
    // a stack of octaves reading as one sliding sheet.
    s += a * vsNoise(p + vel * t * float(i) * 0.85);
    n += a;
    p = VS_OCT * p;
    a *= 0.55;
  }
  return s / max(n, 1e-4);
}

// ------------------------------------------------------------------ aurora
// One curtain. `c` is the unit HORIZONTAL direction, so every noise lookup is on a circle and
// there is no seam at the back of the world.
//
// The three parts, and each one is doing a specific job:
//   fold  — a slow field that moves the sheet's lower edge up and down along its length
//   prof  — hard lower edge, exponential fade upward: the profile of an emitting sheet
//   rays  — high frequency in AZIMUTH ONLY. Constant in elevation. This is the curtain.
float vsCurtain(vec3 dir, vec2 c, float t, float seed, float baseY, float thick,
                float striFreq, float foldFreq, float driftA, float driftB, out float up) {
  vec2 fp = c * foldFreq + vec2(seed * 13.7, seed * 7.1);
  float fold = vsFbm(fp + vec2(t * driftA, t * driftA * 0.37), AUR_OCT);
  float edge = baseY + (fold - 0.5) * thick * 2.1;
  float d = dir.y - edge;
  up = clamp(d / (thick * 3.2), 0.0, 1.0);

  float prof = smoothstep(-thick * 0.55, thick * 0.16, d) * exp(-max(d, 0.0) / (thick * 1.9));

  vec2 sp = c * striFreq + vec2(seed * 3.3, -seed * 5.9);
  float rays = vsNoise(sp + vec2(t * driftB, t * driftB * 0.21));
  rays *= vsNoise(sp * 2.31 + vec2(-t * driftB * 1.7, seed));
  rays = 0.22 + 1.55 * rays * rays;

  // Where the sheet exists at all. Also moving, so curtains fade in and out along their length.
  float pres = smoothstep(0.30, 0.74, vsFbm(c * 1.15 + vec2(seed * 21.0, t * driftA * 0.62), 2));

  return prof * rays * pres;
}

// ------------------------------------------------------------------ dither
// 8x8 ordered Bayer from gl_FragCoord alone. Fixed for the life of the pixel: never time,
// never frame index, never camera state. art-direction §15.4 / M4.
float vsBayer8(vec2 fc) {
  vec2 p = floor(mod(fc, 8.0));
  float x0 = mod(p.x, 2.0), x1 = mod(floor(p.x * 0.5), 2.0), x2 = mod(floor(p.x * 0.25), 2.0);
  float y0 = mod(p.y, 2.0), y1 = mod(floor(p.y * 0.5), 2.0), y2 = mod(floor(p.y * 0.25), 2.0);
  float v = abs(x2 - y2) + y2 * 2.0
          + abs(x1 - y1) * 4.0 + y1 * 8.0
          + abs(x0 - y0) * 16.0 + y0 * 32.0;
  return v * (1.0 / 64.0);
}

void main() {
  vec3 dir = normalize(vRay);
  float t = uTime * uMotion;

  vec3 col = vsSkyGradient(dir) * uLethis;

  vec2 flat2 = dir.xz;
  float flatLen = max(length(flat2), 1e-4);
  vec2 c = flat2 / flatLen;

  // ---- clouds ------------------------------------------------------------------------------
  if (dir.y > -0.03) {
    float lift = max(dir.y, 0.004);

    // A mid deck, banded and warm, sitting on the horizon: the reference's brightest band.
    vec2 deckP = flat2 / (lift + 0.055) * 0.42;
    float deck = vsCloudLayer(deckP, t, 1.35, 0.55, vec2(0.0125, -0.0072), CLOUD_OCT);
    deck = smoothstep(0.44, 0.86, deck);
    deck *= smoothstep(0.0, 0.06, dir.y) * (1.0 - smoothstep(0.16, 0.62, dir.y));

    float cir = 0.0;
    #if CIRRUS
      // High cirrus, stretched along the wind. Anisotropy is applied in the wind frame, which
      // is why these read as drawn-out streaks rather than as stretched blobs.
      vec2 wp = flat2 / (lift + 0.16) * 1.55;
      wp = vec2(wp.x * 0.94 + wp.y * 0.34, -wp.x * 0.34 + wp.y * 0.94);
      wp.x *= 0.26;
      cir = vsCloudLayer(wp, t, 0.85, 0.7, vec2(0.055, 0.008), CLOUD_OCT);
      cir = smoothstep(0.47, 0.83, cir);
      cir *= smoothstep(0.02, 0.20, dir.y) * (1.0 - smoothstep(0.55, 0.95, dir.y));
    #endif

    float sunFacing = max(dot(dir, uSunDir), 0.0);

    // Cloud colour: pale, lit from a low sun, warm on the sunward face. Stays inside §9's
    // `atmosphere` class (bright, low saturation) so it never spends the resonance budget.
    vec3 deckCol = mix(uPivot, uHorizon, 0.62) * (0.86 + 0.85 * pow(sunFacing, 2.4));
    vec3 cirCol = mix(uUpper, uPivot, 0.5) * (0.94 + 1.35 * pow(sunFacing, 3.2));

    col = mix(col, deckCol * uLethis, clamp(deck * 0.60 * uCloudGain, 0.0, 1.0));
    col = mix(col, cirCol * uLethis, clamp(cir * 0.46 * uCloudGain, 0.0, 1.0));
  }

  // ---- aurora ------------------------------------------------------------------------------
  // Additive, because an aurora is emission. Held to a TINT: art-direction §9 puts aurora.mint
  // at S 0.175 and says "push it past S 0.30 and it becomes a screensaver."
  if (dir.y > -0.02 && dir.y < 0.86) {
    vec3 aur = vec3(0.0);
    float up;
    float a0 = vsCurtain(dir, c, t, 1.0, 0.115, 0.085, 27.0, 2.15, 0.085, 0.34, up);
    aur += a0 * mix(mix(uAurMint, uAurTeal, up), uAurViolet, smoothstep(0.45, 1.0, up)) * 1.00;

    #if AUR_CURTAINS > 1
      float a1 = vsCurtain(dir, c, t, 5.7, 0.205, 0.115, 19.0, 1.65, 0.062, -0.25, up);
      // The colour itself travels along the curtain: a slow field decides where along its
      // length this sheet is green and where it has gone violet.
      float travel = vsNoise(c * 1.9 + vec2(t * 0.045, 3.1));
      vec3 c1 = mix(uAurTeal, uAurMint, travel);
      aur += a1 * mix(c1, uAurViolet, smoothstep(0.30, 0.95, up * 0.7 + travel * 0.45)) * 0.78;
    #endif

    #if AUR_CURTAINS > 2
      float a2 = vsCurtain(dir, c, t, 11.3, 0.325, 0.155, 12.0, 1.15, 0.041, 0.17, up);
      float travel2 = vsNoise(c * 1.15 + vec2(-t * 0.033, 8.4));
      aur += a2 * mix(uAurViolet, uAurTeal, travel2 * 0.75) * 0.52;
    #endif

    #if AUR_CURTAINS > 3
      float a3 = vsCurtain(dir, c, t, 17.9, 0.455, 0.185, 8.0, 0.85, 0.029, -0.12, up);
      aur += a3 * mix(uAurViolet, uAurMint, 0.35) * 0.34;
    #endif

    // Aurora is a high-altitude emission: it dies into the skyline haze rather than running
    // under it, and it is weakest where the sun already owns the sky.
    float horizonFade = smoothstep(-0.02, 0.075, dir.y);
    float sunWash = 1.0 - 0.55 * pow(max(dot(dir, uSunDir), 0.0), 2.0);
    col += aur * uAurGain * horizonFade * sunWash * uLethis;
  }

  // ---- Lethis ------------------------------------------------------------------------------
  {
    float cosT = dot(dir, uSunDir);
    float ang2 = 1.0 - cosT;                       // ~= theta^2 / 2 near the disc
    float airmass = vsAirmass(max(uSunDir.y, 0.0));

    float disc = 1.0 - smoothstep(1.374e-4, 2.60e-4, ang2);   // ~0.95 deg radius, soft limb
    float tight = exp(-ang2 * 2600.0);
    float wide = exp(-ang2 * (46.0 - 1.4 * airmass));

    vec3 sunLin = uSunColor * uLethis;
    col += sunLin * (wide * 0.30 + tight * 1.5);
    col = mix(col, sunLin * 46.0, disc);
  }

  // ---- the Errata --------------------------------------------------------------------------
  #if ERRATA
  {
    float az = 2.36 + t * 0.0021;                  // 0.12 deg/s: visibly elsewhere in 10 s
    vec2 ec = vec2(sin(az), cos(az));
    float dd = length(c - ec) * (0.35 + 0.65 * step(0.0, dot(c, ec)));
    float ey = dir.y - 0.055;
    float r = length(vec2(dd / 0.098, ey / 0.052));
    r += 0.30 * (vsFbm(c * 26.0 + vec2(t * 0.05, 0.0), 2) - 0.5);
    float hole = smoothstep(1.06, 0.80, r);
    float rim = smoothstep(0.80, 1.02, r) * smoothstep(1.30, 1.02, r);
    col = mix(col, uErasure, hole);
    col += uCutEdge * rim * hole * 0.55;
  }
  #endif

  gl_FragColor = vec4(max(col, 0.0), 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>

  // Last operation in this shader, after the curve and after the colour-space transform,
  // immediately before 8-bit quantisation. Fixed pattern, so M4 reads exactly zero.
  gl_FragColor.rgb += (vsBayer8(gl_FragCoord.xy) - 0.5) * uDither;
}
`;
}

// ---------------------------------------------------------------------------------------------

export class Sky {
  constructor(kernel) {
    this.kernel = kernel;
    this.root = new THREE.Group();
    this.root.name = "sky";

    const tierId = config.tier.id;
    this.knobs = TIER_SKY[tierId] ?? TIER_SKY.high;

    this.sunDir = sunDirection();
    this.sunAdopted = null; // set if a lighting rig takes the bearing over
    this.lethis = 1;
    this.simTime = 0;

    // art-direction §15: comfort settings damp the world's motion, they never freeze it —
    // a still sky is wallpaper, which is the thing this piece exists not to be.
    this.motion = config.get("reduceMotion") ? 0.35 : 1;

    this.exposure = kernel.renderer.toneMappingExposure;
    this.toneMapping = kernel.renderer.toneMapping;

    if (THREE.ColorManagement.enabled !== true) {
      warn("Sky: THREE.ColorManagement is disabled — palette linear triplets will not land.");
    }

    this.tone = {}; // role -> {rgb, residual}
    const U = (role) => new THREE.Vector3();
    this.uniforms = {
      uCamWorld: { value: new THREE.Matrix4() },
      uProjInv: { value: new THREE.Matrix4() },
      uSunDir: { value: this.sunDir.clone() },
      uSunColor: { value: U() },
      uLethis: { value: 1 },
      uTime: { value: 0 },
      uMotion: { value: this.motion },
      uZenithDeep: { value: U() },
      uZenith: { value: U() },
      uUpper: { value: U() },
      uPivot: { value: U() },
      uHorizon: { value: U() },
      uUnder: { value: U() },
      uAurMint: { value: U() },
      uAurTeal: { value: U() },
      uAurViolet: { value: U() },
      uErasure: { value: U() },
      uCutEdge: { value: U() },
      uAurGain: { value: 0.4 },
      uCloudGain: { value: 1.0 },
      uDither: { value: 1.6 / 255 },
    };
    this._solveTone();

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3)
    );
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: fragmentShader(this.knobs),
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: true,
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = "sky-dome";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10000;
    // Uploaded at draw time, not in a hook: whatever order the camera rig's `after()` runs in,
    // the sky is reconstructed from the matrices the renderer is about to use.
    this.mesh.onBeforeRender = (renderer, scene, camera) => {
      this.uniforms.uCamWorld.value.copy(camera.matrixWorld);
      this.uniforms.uProjInv.value.copy(camera.projectionMatrixInverse);
    };
    this.root.add(this.mesh);

    // The sky IS the background. Anything else drawn behind it is wasted fill.
    kernel.scene.background = null;

    this._offSun = signals.on("world:sun", (p) => {
      if (!p || p.source === "sky" || !p.direction) return;
      // A later lighting rig may take the bearing over; this is the same two-way handshake
      // `camera:mode` uses, and it is the only inbound path.
      this.sunAdopted = new THREE.Vector3(p.direction.x, p.direction.y, p.direction.z).normalize();
      this.uniforms.uSunDir.value.copy(this.sunAdopted);
    });

    publish("sky", () => ({
      tier: tierId,
      cloudOctaves: this.knobs.cloudOct,
      curtains: this.knobs.curtains,
      motionScale: this.motion,
      simTime: Number(this.simTime.toFixed(4)),
      lethis: Number(this.lethis.toFixed(5)),
      lethisMaxRatePerStep: Number((lethisMaxRatePerSecond() / 60).toFixed(7)),
      lethisRateBudgetPerStep: 0.0015,
      sun: {
        x: Number(this.uniforms.uSunDir.value.x.toFixed(5)),
        y: Number(this.uniforms.uSunDir.value.y.toFixed(5)),
        z: Number(this.uniforms.uSunDir.value.z.toFixed(5)),
        elevationDeg: SUN.elevationDeg,
        azimuthDeg: SUN.azimuthDeg,
        adopted: this.sunAdopted !== null,
      },
      toneMapping: this.toneMapping,
      exposure: this.exposure,
      // The proof that the palette lands: max |ACES(scene) - paletteDisplayLinear| over the stops.
      toneSolveResidual: Number(this.maxResidual.toFixed(6)),
      drawCalls: 1,
      triangles: 1,
    }));

    signals.emit("world:sun", this._sunPayload());
  }

  _sunPayload() {
    const d = this.uniforms.uSunDir.value;
    return {
      source: "sky",
      direction: { x: d.x, y: d.y, z: d.z },
      elevationDeg: SUN.elevationDeg,
      azimuthDeg: SUN.azimuthDeg,
      colorHex: SUN.colorHex,
      colorLinear: SKY_ROLES.sun.slice(),
      intensity: this.lethis,
      intensityMean: LETHIS.mean,
      intensitySwing: LETHIS.swing,
    };
  }

  /** Re-solve every palette stop for the current tonemap. Cheap; runs on setup and on change. */
  _solveTone() {
    const e = this.exposure;
    const tm = this.toneMapping;
    this.maxResidual = 0;
    const put = (uniform, role) => {
      const solved = inverseToneMap(SKY_ROLES[role], e, tm);
      this.tone[role] = solved;
      this.maxResidual = Math.max(this.maxResidual, solved.residual);
      this.uniforms[uniform].value.set(solved.rgb[0], solved.rgb[1], solved.rgb[2]);
    };
    put("uZenithDeep", "zenithDeep");
    put("uZenith", "zenith");
    put("uUpper", "upper");
    put("uPivot", "pivot");
    put("uHorizon", "horizon");
    put("uUnder", "under");
    put("uSunColor", "sun");
    put("uAurMint", "auroraMint");
    put("uAurTeal", "auroraTeal");
    put("uAurViolet", "auroraViolet");
    put("uErasure", "erasure");
    put("uCutEdge", "resonance");
    if (this.maxResidual > 0.004) {
      warn(`Sky: tonemap inversion residual ${this.maxResidual.toFixed(4)} — sky will be off-palette`);
    }
  }

  fixed(step, simTime) {
    this.simTime = simTime;
    this.lethis = lethisAt(simTime);
    this.uniforms.uLethis.value = this.lethis;
    this.uniforms.uTime.value = simTime;

    // 20 Hz is plenty for a star whose fastest legal excursion is 0.8% per second, and it keeps
    // this off the per-step allocation path.
    if (Math.round(simTime * 60) % 3 === 0) signals.emit("world:sun", this._sunPayload());
  }

  frame() {
    const r = this.kernel.renderer;
    if (r.toneMappingExposure !== this.exposure || r.toneMapping !== this.toneMapping) {
      this.exposure = r.toneMappingExposure;
      this.toneMapping = r.toneMapping;
      this._solveTone();
    }
  }

  dispose() {
    this._offSun?.();
    this.material.dispose();
    this.mesh.geometry.dispose();
  }
}
