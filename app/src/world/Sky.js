import * as THREE from "three";
import { publish, warn } from "../core/Introspect.js";
import { config } from "../core/Config.js";
import { signals } from "../core/Signals.js";

/**
 * Sky — P10, rebuilt against `reference/target-lowpoly.png`.
 *
 * The sky is roughly half the target frame, so it has to speak the target's language exactly:
 * a **banded warm dusk gradient**, **hard-edged stylised cloud slabs** with visible rectangular
 * steps, and a **low sun glow** that agrees with the light rig. Everything painterly the old
 * draft inherited from `brief-hero.png` — volumetric cloud fBm read straight to screen, a
 * four-curtain aurora, soft material richness — is gone. Where the two references disagreed the
 * low-poly target wins, and it disagreed about all of it.
 *
 * ## 1. One draw call, one triangle
 *
 * A full-screen triangle with `depthTest:false`, drawn first, view ray rebuilt per pixel from
 * `camera.matrixWorld` and `projectionMatrixInverse` uploaded in `onBeforeRender` so the sky can
 * never lag the camera by a frame whatever order the `after()` hooks run in. A dome mesh costs the
 * same fill and a lot more vertex work for nothing.
 *
 * ## 2. The gradient is BANDED ON PURPOSE, and that is not posterisation
 *
 * Two different things are easy to confuse and this file separates them deliberately.
 *
 * **Authored banding** is the art: the target's sky is not a two-colour lerp, it is a stack of
 * distinct horizontal *bands* — teal, sage, olive, gold, amber — each of which holds nearly one
 * value across a wide arc, with a quick turn between them. `SKY_BANDS` are seven colours measured
 * off the target (see the table below) at seven elevations, and `uBandSharp` controls how much of
 * each gap is spent turning: 1.0 is a plain smoothstep chain (smooth), 0.45 spends the middle 45%
 * of a gap turning and leaves 27.5% flat plateau at each end. That is what makes the sky read as
 * *bands* rather than as a shader default.
 *
 * **Posterisation** is the bug: an 8-bit framebuffer quantising a slow ramp into visible contour
 * stripes that nobody authored, in the wrong places, with the wrong step size. On a 1080-pixel
 * column running from #F5A85F to #4F8386 the green channel alone moves ~55 codes over ~600 px, so
 * without help every code holds for ~11 px and the eye reads eleven-pixel stripes.
 *
 * **The fix is an 8×8 ordered Bayer dither applied as the last operation in the shader** — after
 * the tonemap, after the colour-space transform, immediately before the framebuffer quantises —
 * at ±0.6 LSB. Sub-LSB modulation cannot change the intended colour; all it does is decide which
 * side of the rounding boundary each pixel falls on, which converts one hard 11-pixel step into a
 * dithered gradient. It is derived from `gl_FragCoord` alone — never time, never frame index,
 * never camera state — so it is deterministic (G4), it does not crawl, and two captures of the
 * same frame are bit-identical. `review/measure/P10.mjs` proves both halves: claim BAND measures
 * that the authored knees turn ≥2.5× faster than the plateaus, and claim DITHER measures the
 * longest run of identical 8-bit triplets down a sky column with the dither on and off.
 *
 * ## 3. Clouds: an ANGULAR block grid over a PERSPECTIVE deck
 *
 * The target's clouds are not soft. Their silhouettes are rectangular staircases — chunky slabs
 * with crisp boundaries, two or three flat values each, and steps of roughly constant size all
 * over the frame. Two separate ideas produce that:
 *
 *   * **Quantisation is angular.** The block grid is `floor` in (azimuth, dir.y). Blocks are
 *     therefore a constant angular size, which means a constant *screen* size — the steps near
 *     the horizon are as chunky as the ones overhead, exactly as in the target, and there is no
 *     aliasing to fight. The azimuth cell count is an integer per turn, so the grid wraps with no
 *     seam behind the player.
 *   * **Density is sampled on a flat deck.** Each cell's *centre direction* is projected onto a
 *     deck plane at `uDeckH` metres and the density field is evaluated there. That restores the
 *     perspective the angular grid threw away: cloud masses bunch up toward the horizon, open out
 *     overhead, advect on a real metres-per-second wind, and parallax if the camera moves.
 *
 * Shading is three flat values, chosen by looking at the two vertical neighbours in the block
 * grid: a cell whose neighbour toward the zenith is empty is the **lit top step**; one whose
 * neighbour toward the horizon is empty is the **shadowed under step**; everything else is body.
 * That is per-face flat shading done on a 2-D field, and it is why a slab reads as a solid with a
 * lit top and a dark underside rather than as a stain.
 *
 * Two decks. The low deck is the target's cumulus band; the high deck is stretched along its own
 * wind into streaks, drifts the other way, and lives higher. **Neither is a scrolling texture:**
 * a second slow noise field displaces each deck's domain, so slabs are born and die instead of
 * merely sliding, and the two decks move on different bearings at different speeds. Claim SCROLL
 * in the measure script finds the best rigid 2-D shift between two frames eight seconds apart and
 * checks how much residual survives it.
 *
 * ## 4. Where the colours come from
 *
 * Every number in `SKY_BANDS` and `CLOUD` was read off `reference/target-lowpoly.png` with
 * `review/p10-sample-target.mjs`. The frame's skyline sits at y = 0.447 and its vertical field of
 * view is ~50°, which converts an image row to an elevation:
 * `tan(elev) = (0.447 − y) · 2·tan(25°)`. The measured column is x = 56% (open sky, top to
 * skyline) cross-checked against x = 6% and x = 30% to separate the *base* sky from the sun's
 * glow — the base turns out to be azimuth-independent and the entire horizontal variation in the
 * target is the sun wash, which is why the glow here is a separate additive term and not a second
 * gradient. Above 22.6° the target frame has no sky left, so 27°/50°/90° are an authored
 * continuation of the measured trend and this comment is where that is admitted.
 *
 * ## 5. Which side of the tonemap
 *
 * Those measured colours are **display-referred** — they came off a finished PNG. The sky is
 * written before `ACESFilmicToneMapping`, so feeding them straight in would land the frame a long
 * way under the target. `inverseToneMap()` solves ACES numerically for the scene-referred
 * radiance that comes *out* at the measured value, and the residual is on the probe so the claim
 * is checkable. Re-solved whenever `renderer.toneMapping` or `toneMappingExposure` changes.
 * `Atmosphere.js` bakes the same measured colours *un*-inverted, because three applies
 * `<fog_fragment>` after the tonemap — so both files land on the same pixels from opposite sides.
 *
 * ## 6. The sun is consumed, then published
 *
 * The glow has to agree with the key light. P11's rig owns the bearing and emits `world:sun` with
 * a `toLight` unit vector; this file adopts it. Until the rig mounts (order 14, two after this
 * one) the sky publishes its own with `source:"sky"` so nothing downstream is ever without a
 * bearing, and it ignores its own echo. Same two-way handshake `camera:mode` uses.
 */

// ---------------------------------------------------------------------------------------------
// Palette — measured off reference/target-lowpoly.png. Type the hex, never the kelvin.
// ---------------------------------------------------------------------------------------------

/**
 * The banded dusk. `el` is elevation in degrees, `hex` is the target's colour at that elevation.
 * Ascending. The first entry is the horizon ring; the last is the zenith.
 *
 *   el     hex       where it was measured
 *    0.0   #F7A75C   extrapolated one band below 3.5° (the skyline row itself is terrain)
 *    6.0   #EDA05E   x=6% y=0.350 (#EF9F5A) / x=30% y=0.350 (#F2A35E), 5.2°
 *   10.5   #BC9968   x=6% y=0.250 (#BE9763) / x=30% y=0.250 (#BB9768), 10.4°
 *   15.0   #929576   x=6% y=0.188 (#A3936D) / x=56% y=0.163 (#89967C), 13.6°/15.9°
 *   20.0   #6D8E81   x=42% y=0.100 (#6C8D81) / x=56% y=0.100 (#6F8F81), 19.9°
 *   27.0   #4F8386   continuation of the trend past the top of the target frame (22.6°)
 *   90.0   #407D8D   authored zenith: the ramp flattens, it does not keep falling
 */
export const SKY_BANDS = [
  { el: 0.0, hex: "#F7A75C" },
  { el: 6.0, hex: "#EDA05E" },
  { el: 10.5, hex: "#BC9968" },
  { el: 15.0, hex: "#929576" },
  { el: 20.0, hex: "#6D8E81" },
  { el: 27.0, hex: "#4F8386" },
  { el: 90.0, hex: "#407D8D" },
];

/**
 * Below the skyline there is no ground — `world.md` §2.3: "below the leaves is not a lower level".
 * The sky keeps going and gets brighter and warmer downward, because a gap between two leaves is
 * lit from the far side.
 */
export const UNDER_HEX = "#FFD6A0";
/** Degrees below the horizon over which the under-sky reaches `UNDER_HEX`. */
const UNDER_SPAN_DEG = 42;

/** Cloud slabs. Census of the target's upper 20%: H36 S0.48 V1.00 dominant, H32 S0.48 V0.88 next. */
export const CLOUD = {
  top: "#FFD891", // lit top step   — target #FDD78C / #FFCE82
  body: "#FFCA84", // body           — target #FFCC83 / #FCCC86 (the dominant bucket)
  under: "#DFAE74", // shadowed under — target #E3B177 / #E0B075
  sunward: "#FFF6E0", // near the sun the slabs wash out toward white
};

/** Lethis, and the light it throws. `sky.sun` from the palette; the disc core is hotter. */
export const SUN = {
  hex: "#FFE8A0",
  coreHex: "#FFFDF2",
  elevationDeg: 8, // the rig's bearing; adopted from world:sun the moment P11 mounts
  azimuthDeg: 118,
  discRadiusDeg: 1.15,
  glowTightDeg: 3.2, // measured: white within ~3° of the disc
  glowWideDeg: 17.0, // measured: still visibly lifted 14.5° out
};

/**
 * Lethis's aperiodic swell — `world.md` §3, "its output is an unsolved function". Five *prime*
 * periods so the sum does not repeat inside a session; a closed form of simTime, not an
 * integrator, so it is deterministic (G4) and its rate limit is provable rather than sampled.
 * The same five periods P11 uses, so the sky and the key breathe together.
 */
const LETHIS = {
  mean: 1.0,
  swing: 0.1,
  periods: [41, 67, 113, 269, 617],
  phases: [0.0, 1.31, 2.62, 4.11, 5.5],
};

/**
 * Cloud geometry. Angular cell size decides the on-screen block size; at a 50° vertical field of
 * view over 1080 px that is 21.6 px/deg, so 0.55° ≈ 12 px — the target's step size at 1920 wide.
 */
const CLOUDS = {
  azCells: 656, // integer cells per turn => the grid wraps with no seam. 360/656 = 0.549°
  elCell: 0.0096, // in dir.y. 0.55° near the horizon, where every cloud in the target lives.

  low: {
    deckH: 1250, // metres above the camera
    scale: 0.00042, // deck metres -> noise units
    aniso: 1.0,
    wind: [0.0135, -0.0062], // noise units per second (~32 / ~15 m/s on the deck)
    driftDegPerSec: 0.0, // the low deck's motion is entirely wind on the deck
    cover: 0.505,
    core: 0.60,
    elLow: 0.055, // fade in from 3.2°
    elHigh: 0.62, // and out by 38°
    evo: 0.019, // domain-displacement rate: slabs are born and die
  },
  high: {
    deckH: 3400,
    scale: 0.00021,
    aniso: 3.4, // stretched along the wind => streaks, not stretched blobs
    wind: [0.0295, 0.004],
    driftDegPerSec: 0.0,
    cover: 0.545,
    core: 0.625,
    elLow: 0.12,
    elHigh: 0.9,
    evo: 0.011,
  },
};

/** The Errata — `world.md` §3: "a hole in the sky on the far horizon, moving." Blocky, not soft. */
const ERRATA = {
  azimuthDeg: 302, // well away from the sun's 118°
  driftDegPerSec: 0.12, // visibly somewhere else ten seconds later
  elevationDeg: 4.6,
  halfAzDeg: 5.2,
  halfElDeg: 2.4,
  hex: "#241D2A", // rock.shadow.deep — the Errata is a hole, not a cloud
  edgeHex: "#2FE3D6", // resonance.core — the cut edge
};

/** Per-tier shader cost. Everything expensive is a loop bound baked as a #define. */
const TIER_SKY = {
  potato: { lowOct: 2, highOct: 0, deck2: 0, rim: 0, errata: 0 },
  low: { lowOct: 3, highOct: 2, deck2: 1, rim: 0, errata: 1 },
  medium: { lowOct: 3, highOct: 2, deck2: 1, rim: 1, errata: 1 },
  high: { lowOct: 4, highOct: 3, deck2: 1, rim: 1, errata: 1 },
  ultra: { lowOct: 5, highOct: 3, deck2: 1, rim: 1, errata: 1 },
};

// ---------------------------------------------------------------------------------------------
// Colour helpers. Measured hex -> display-referred linear -> (inverse ACES) -> scene-referred.
// ---------------------------------------------------------------------------------------------

/** sRGB 8-bit hex to a display-referred *linear* triplet. */
export function hexToLinear(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  const f = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)];
}

/** The other direction, for probes and for the measure script's expectations. */
export function linearToHex(rgb) {
  const f = (v) => {
    const c = Math.min(1, Math.max(0, v));
    const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    return Math.round(s * 255);
  };
  return "#" + rgb.map((c) => f(c).toString(16).padStart(2, "0").toUpperCase()).join("");
}

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
 * Solve ACES for the scene-referred radiance that lands on `target` (display-referred linear).
 * Damped fixed point; the curve is monotone per channel so it converges in a few iterations even
 * though the two matrices mix channels. Returns the residual, which is published — a claim
 * nobody can check is a hope.
 */
export function inverseToneMap(target, exposure = 1, toneMapping = THREE.ACESFilmicToneMapping) {
  if (toneMapping !== THREE.ACESFilmicToneMapping) {
    return { rgb: target.slice(), residual: 0, iterations: 0 };
  }
  const s = target.slice();
  let residual = 1;
  let i = 0;
  for (; i < 96; i++) {
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

/**
 * The banded gradient, in JS, on the same maths as the shader. `Atmosphere.js` bakes GLSL from
 * this so the haze behind a silhouette and the sky beside it are literally the same function, and
 * `review/measure/P10.mjs` predicts pixels from it. Returns a display-referred linear triplet.
 */
export function bandGradient(elevationRad, sharp = 0.45) {
  const stops = SKY_BANDS.map((b) => ({ el: (b.el * Math.PI) / 180, c: hexToLinear(b.hex) }));
  if (elevationRad <= stops[0].el) {
    const span = (UNDER_SPAN_DEG * Math.PI) / 180;
    const d = Math.min(1, Math.max(0, (stops[0].el - elevationRad) / span));
    const s = d * d * (3 - 2 * d);
    const u = hexToLinear(UNDER_HEX);
    return stops[0].c.map((c, i) => c + (u[i] - c) * s);
  }
  let c = stops[0].c.slice();
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i].el;
    const b = stops[i + 1].el;
    const mid = 0.5 * (a + b);
    const half = Math.max(1e-6, 0.5 * (b - a) * sharp);
    let t = (elevationRad - (mid - half)) / (2 * half);
    t = Math.min(1, Math.max(0, t));
    t = t * t * (3 - 2 * t);
    c = c.map((v, k) => v + (stops[i + 1].c[k] - v) * t);
  }
  return c;
}

// ---------------------------------------------------------------------------------------------
// GLSL
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

// Rotate-and-scale between octaves so the field has no axis-aligned grain of its own — the only
// axis alignment in the finished cloud must come from the block grid.
const mat2 VS_OCT = mat2(1.6598, 0.9834, -0.9834, 1.6598);
`;

/**
 * 8×8 ordered Bayer from `gl_FragCoord` alone. Fixed for the life of the pixel: never time, never
 * frame index, never camera state. See the header, §2 — this is the anti-posterisation half.
 */
export const GLSL_BAYER = /* glsl */ `
float vsBayer8(vec2 fc) {
  vec2 p = floor(mod(fc, 8.0));
  float x0 = mod(p.x, 2.0), x1 = mod(floor(p.x * 0.5), 2.0), x2 = mod(floor(p.x * 0.25), 2.0);
  float y0 = mod(p.y, 2.0), y1 = mod(floor(p.y * 0.5), 2.0), y2 = mod(floor(p.y * 0.25), 2.0);
  float v = abs(x2 - y2) + y2 * 2.0
          + abs(x1 - y1) * 4.0 + y1 * 8.0
          + abs(x0 - y0) * 16.0 + y0 * 32.0;
  return v * (1.0 / 64.0);
}
`;

const NBANDS = SKY_BANDS.length;

/**
 * The banded gradient as a function of elevation. Exported so `Atmosphere.js` can ask the sky what
 * colour stands behind a distant surface instead of guessing at it.
 * Requires `uBandCol[NBANDS] uBandEl[NBANDS] uBandSharp uUnder uUnderSpan`.
 */
export const GLSL_GRADIENT = /* glsl */ `
#define VS_NBANDS ${NBANDS}
uniform vec3  uBandCol[VS_NBANDS];
uniform float uBandEl[VS_NBANDS];
uniform float uBandSharp;
uniform vec3  uUnder;
uniform float uUnderSpan;

vec3 vsSkyGradient(float el) {
  if (el <= uBandEl[0]) {
    // No ground under this world: below the skyline the sky keeps going and gets brighter.
    float d = clamp((uBandEl[0] - el) / uUnderSpan, 0.0, 1.0);
    return mix(uBandCol[0], uUnder, d * d * (3.0 - 2.0 * d));
  }
  vec3 c = uBandCol[0];
  for (int i = 0; i < VS_NBANDS - 1; i++) {
    float a = uBandEl[i];
    float b = uBandEl[i + 1];
    float mid = 0.5 * (a + b);
    float half_ = max(1e-6, 0.5 * (b - a) * uBandSharp);
    // Plateau, knee, plateau. uBandSharp = 1 degenerates to a plain smoothstep chain.
    c = mix(c, uBandCol[i + 1], smoothstep(mid - half_, mid + half_, el));
  }
  return c;
}
`;

const VERT = /* glsl */ `
uniform mat4 uCamWorld;
uniform mat4 uProjInv;
varying vec3 vRay;

void main() {
  // A full-screen triangle whose vertices are already in NDC. z = 1 is the far plane; depthTest
  // is off so nothing about the depth buffer matters and nothing is ever culled.
  vec4 clip = vec4(position.xy, 1.0, 1.0);
  vec4 eye = uProjInv * clip;
  vRay = (uCamWorld * vec4(eye.xyz / eye.w, 0.0)).xyz;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

function fragmentShader(knobs) {
  return /* glsl */ `
precision highp float;

#define LOW_OCT ${knobs.lowOct}
#define HIGH_OCT ${knobs.highOct}
#define DECK2 ${knobs.deck2}
#define RIM ${knobs.rim}
#define ERRATA ${knobs.errata}

uniform vec3  uCamPos;
uniform vec3  uSunDir;
uniform vec3  uSunGlow;
uniform vec3  uSunCore;
uniform float uGlowTight;   // radians
uniform float uGlowWide;    // radians
uniform float uGlowTightAmp;
uniform float uGlowWideAmp;
uniform float uDiscRadius;  // radians
uniform float uDiscGain;

uniform float uLethis;
uniform float uTime;
uniform float uMotion;

uniform float uCellAz;      // radians per azimuth cell
uniform float uCellEl;      // dir.y per elevation cell

uniform vec4  uDeckLow;     // deckH, scale, aniso, cover
uniform vec4  uDeckLow2;    // core, elLow, elHigh, evo
uniform vec2  uWindLow;
uniform vec4  uDeckHigh;
uniform vec4  uDeckHigh2;
uniform vec2  uWindHigh;

uniform vec3  uCloudTop;
uniform vec3  uCloudBody;
uniform vec3  uCloudUnder;
uniform vec3  uCloudSunward;
uniform float uCloudGain;

uniform vec3  uErrataCol;
uniform vec3  uErrataEdge;
uniform vec4  uErrata;      // azimuth0, driftRadPerSec, elevation, halfAz
uniform float uErrataHalfEl;

uniform float uDither;

varying vec3 vRay;

${GLSL_NOISE}
${GLSL_GRADIENT}
${GLSL_BAYER}

float vsFbm(vec2 p, int octaves) {
  float a = 0.5;
  float s = 0.0;
  float n = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    s += a * vsNoise(p);
    n += a;
    p = VS_OCT * p;
    a *= 0.53;
  }
  return s / max(n, 1e-4);
}

// ------------------------------------------------------------------ cloud decks
//
// idx is the INTEGER block address in (azimuth, dir.y). The density is sampled once, at the
// cell's centre projected onto the deck plane, so the value is constant across the whole block
// and every boundary in the finished frame is a hard rectangular step.

vec3 vsCellDir(vec2 idx) {
  float az = (idx.x + 0.5) * uCellAz;
  float y  = (idx.y + 0.5) * uCellEl;
  float r  = sqrt(max(1.0 - y * y, 1e-6));
  return vec3(sin(az) * r, y, cos(az) * r);
}

float vsDeck(vec2 idx, vec4 d, vec4 d2, vec2 wind, float yFloor, int oct) {
  vec3 cd = vsCellDir(idx);
  float y = max(cd.y, yFloor);
  vec2 P = uCamPos.xz + cd.xz * (d.x / y);
  vec2 q = P * d.y;
  q.y *= d.z;
  q -= wind * uTime;
  // Shapes are BORN AND DIE: a slow second field displaces the domain, so no rigid 2-D shift can
  // reproduce a later frame from an earlier one. review/measure/P10.mjs measures exactly that.
  float e = d2.w * uTime;
  vec2 disp = vec2(vsNoise(q * 0.23 + vec2(e, 3.7)), vsNoise(q * 0.19 + vec2(-e * 0.8, 9.1)));
  q += (disp - 0.5) * 2.6;
  return vsFbm(q, oct);
}

// One deck, returned as (coverage, shadeSelect) where shadeSelect is 0 under-step, 1 body,
// 2 core, 3 lit top step.
vec2 vsDeckShade(vec2 idx, vec4 d, vec4 d2, vec2 wind, float yFloor, int oct) {
  float dens = vsDeck(idx, d, d2, wind, yFloor, oct);
  float body = step(d.w, dens);
  if (body < 0.5) return vec2(0.0, 1.0);
  float sel = 1.0 + step(d2.x, dens);              // body -> core
  #if RIM
    float below = vsDeck(idx + vec2(0.0, -1.0), d, d2, wind, yFloor, oct);
    float above = vsDeck(idx + vec2(0.0,  1.0), d, d2, wind, yFloor, oct);
    // A block with nothing beyond it toward the horizon is the slab's underside; a block with
    // nothing above it is the slab's lit top. Per-face flat shading on a 2-D field.
    if (below < d.w) sel = 0.0;
    else if (above < d.w) sel = 3.0;
  #endif
  return vec2(1.0, sel);
}

vec3 vsCloudColour(float sel, float sunFacing) {
  vec3 c = uCloudBody;
  if (sel < 0.5) c = uCloudUnder;
  else if (sel > 2.5) c = uCloudTop;
  else if (sel > 1.5) c = mix(uCloudBody, uCloudTop, 0.45);
  // Near the sun the slabs wash out toward white, exactly as they do in the target.
  return mix(c, uCloudSunward, pow(max(sunFacing, 0.0), 5.0) * 0.85) * uLethis;
}

void main() {
  vec3 dir = normalize(vRay);
  float el = asin(clamp(dir.y, -1.0, 1.0));
  float az = atan(dir.x, dir.z);

  vec3 col = vsSkyGradient(el) * uLethis;

  float sunFacing = dot(dir, uSunDir);
  float ang = acos(clamp(sunFacing, -1.0, 1.0));

  // ---- clouds --------------------------------------------------------------------------------
  vec2 idxAz = vec2(floor(az / uCellAz), 0.0);

  if (dir.y > uDeckLow2.y - 0.02) {
    vec2 idx = vec2(idxAz.x, floor(dir.y / uCellEl));
    vec2 sh = vsDeckShade(idx, uDeckLow, uDeckLow2, uWindLow, uDeckLow2.y * 0.72, LOW_OCT);
    float cover = sh.x
      * smoothstep(uDeckLow2.y, uDeckLow2.y + 0.045, dir.y)
      * (1.0 - smoothstep(uDeckLow2.z, uDeckLow2.z + 0.22, dir.y));
    col = mix(col, vsCloudColour(sh.y, sunFacing), clamp(cover * uCloudGain, 0.0, 1.0));
  }

  #if DECK2
  if (dir.y > uDeckHigh2.y - 0.02) {
    vec2 idx = vec2(idxAz.x, floor(dir.y / uCellEl));
    vec2 sh = vsDeckShade(idx, uDeckHigh, uDeckHigh2, uWindHigh, uDeckHigh2.y * 0.72, HIGH_OCT);
    float cover = sh.x
      * smoothstep(uDeckHigh2.y, uDeckHigh2.y + 0.06, dir.y)
      * (1.0 - smoothstep(uDeckHigh2.z, uDeckHigh2.z + 0.20, dir.y));
    col = mix(col, vsCloudColour(sh.y, sunFacing) * 1.02, clamp(cover * uCloudGain * 0.92, 0.0, 1.0));
  }
  #endif

  // ---- Lethis --------------------------------------------------------------------------------
  // A low sun: a tight white core, a warm wide wash. The target's entire horizontal variation is
  // this term — the base gradient is azimuth-independent (see the header, §4).
  {
    float tight = exp(-ang / uGlowTight);
    float wide  = exp(-ang / uGlowWide);
    col += uSunGlow * (uGlowTightAmp * tight + uGlowWideAmp * wide) * uLethis;
    float disc = 1.0 - smoothstep(uDiscRadius * 0.82, uDiscRadius, ang);
    col = mix(col, uSunCore * uDiscGain * uLethis, disc);
  }

  // ---- the Errata ----------------------------------------------------------------------------
  // world.md §3: "a hole in the sky on the far horizon, moving." A HOLE, so it erases whatever it
  // crosses; and it is quantised on the same block grid, so it belongs to the same language.
  #if ERRATA
  {
    float eAz = uErrata.x + uErrata.y * uTime * uMotion;
    float qAz = (floor(az / uCellAz) + 0.5) * uCellAz;
    float qEl = (floor(dir.y / uCellEl) + 0.5) * uCellEl;
    float dAz = atan(sin(qAz - eAz), cos(qAz - eAz));
    // Ragged, but ragged in whole blocks.
    float ragged = 0.30 * (vsNoise(vec2(qAz * 34.0 + uTime * 0.05 * uMotion, qEl * 60.0)) - 0.5);
    float r = length(vec2(dAz / uErrata.w, (qEl - uErrata.z) / uErrataHalfEl)) + ragged;
    float hole = step(r, 1.0);
    float rim  = step(r, 1.22) - hole;
    col = mix(col, uErrataCol, hole);
    col = mix(col, uErrataEdge * 0.55 + col * 0.45, rim * 0.8);
  }
  #endif

  gl_FragColor = vec4(max(col, 0.0), 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>

  // LAST. After the curve, after the colour-space transform, immediately before the framebuffer
  // quantises to 8 bits. Fixed pattern from gl_FragCoord alone, so it is deterministic and it
  // does not crawl. See the header, §2.
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

    const q = new URLSearchParams(location.search);
    const tierId = config.tier.id;
    this.knobs = TIER_SKY[tierId] ?? TIER_SKY.high;

    this.sunDir = sunDirection();
    this.sunAdopted = null;
    this.sunElevationDeg = SUN.elevationDeg;
    this.sunAzimuthDeg = SUN.azimuthDeg;
    this.lethis = 1;
    this.simTime = 0;

    // Comfort settings damp the world's motion, they never freeze it — a still sky is wallpaper,
    // which is the thing this piece exists not to be.
    this.motion = config.get("reduceMotion") ? 0.4 : 1;

    this.bandSharp = Number(q.get("skyBandSharp") ?? 0.45);
    this.ditherLsb = Number(q.get("skyDither") ?? 1.25);

    this.exposure = kernel.renderer.toneMappingExposure;
    this.toneMapping = kernel.renderer.toneMapping;

    if (THREE.ColorManagement.enabled !== true) {
      warn("Sky: THREE.ColorManagement is disabled — measured sky colours will not land.");
    }

    const D2R = Math.PI / 180;
    const V = () => new THREE.Vector3();

    this.uniforms = {
      uCamWorld: { value: new THREE.Matrix4() },
      uProjInv: { value: new THREE.Matrix4() },
      uCamPos: { value: new THREE.Vector3() },

      uBandCol: { value: SKY_BANDS.map(() => new THREE.Vector3()) },
      uBandEl: { value: SKY_BANDS.map((b) => b.el * D2R) },
      uBandSharp: { value: this.bandSharp },
      uUnder: { value: V() },
      uUnderSpan: { value: UNDER_SPAN_DEG * D2R },

      uSunDir: { value: this.sunDir.clone() },
      uSunGlow: { value: V() },
      uSunCore: { value: V() },
      uGlowTight: { value: SUN.glowTightDeg * D2R },
      uGlowWide: { value: SUN.glowWideDeg * D2R },
      uGlowTightAmp: { value: 1.35 },
      uGlowWideAmp: { value: 0.42 },
      uDiscRadius: { value: SUN.discRadiusDeg * D2R },
      uDiscGain: { value: 7.5 },

      uLethis: { value: 1 },
      uTime: { value: 0 },
      uMotion: { value: this.motion },

      uCellAz: { value: (2 * Math.PI) / CLOUDS.azCells },
      uCellEl: { value: CLOUDS.elCell },

      uDeckLow: {
        value: new THREE.Vector4(
          CLOUDS.low.deckH,
          CLOUDS.low.scale,
          CLOUDS.low.aniso,
          CLOUDS.low.cover
        ),
      },
      uDeckLow2: {
        value: new THREE.Vector4(
          CLOUDS.low.core,
          CLOUDS.low.elLow,
          CLOUDS.low.elHigh,
          CLOUDS.low.evo
        ),
      },
      uWindLow: { value: new THREE.Vector2(...CLOUDS.low.wind) },
      uDeckHigh: {
        value: new THREE.Vector4(
          CLOUDS.high.deckH,
          CLOUDS.high.scale,
          CLOUDS.high.aniso,
          CLOUDS.high.cover
        ),
      },
      uDeckHigh2: {
        value: new THREE.Vector4(
          CLOUDS.high.core,
          CLOUDS.high.elLow,
          CLOUDS.high.elHigh,
          CLOUDS.high.evo
        ),
      },
      uWindHigh: { value: new THREE.Vector2(...CLOUDS.high.wind) },

      uCloudTop: { value: V() },
      uCloudBody: { value: V() },
      uCloudUnder: { value: V() },
      uCloudSunward: { value: V() },
      uCloudGain: { value: Number(q.get("skyClouds") ?? 1) },

      uErrataCol: { value: V() },
      uErrataEdge: { value: V() },
      uErrata: {
        value: new THREE.Vector4(
          ERRATA.azimuthDeg * D2R,
          ERRATA.driftDegPerSec * D2R,
          Math.sin(ERRATA.elevationDeg * D2R),
          ERRATA.halfAzDeg * D2R
        ),
      },
      uErrataHalfEl: { value: Math.sin(ERRATA.halfElDeg * D2R) },

      uDither: { value: this.ditherLsb / 255 },
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
    this.mesh.name = "sky-plate";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10000;
    this.mesh.onBeforeRender = (renderer, scene, camera) => {
      this.uniforms.uCamWorld.value.copy(camera.matrixWorld);
      this.uniforms.uProjInv.value.copy(camera.projectionMatrixInverse);
      camera.getWorldPosition(this.uniforms.uCamPos.value);
    };
    this.root.add(this.mesh);

    // The sky IS the background. Anything drawn behind it is wasted fill.
    kernel.scene.background = null;

    this._offSun = signals.on("world:sun", (p) => this._adoptSun(p));

    publish("sky", () => this.report());

    // Publish a bearing immediately so nothing downstream is ever without one; P11 mounts two
    // orders later and its payload is adopted the moment it arrives.
    signals.emit("world:sun", this._sunPayload());
  }

  // -------------------------------------------------------------------------- sun handshake

  _adoptSun(p) {
    if (!p || p.source === "sky") return;
    // P11 publishes `toLight` (unit vector from the world TOWARD the sun) plus `direction`
    // (the direction light travels, i.e. the negative). Only `toLight` is unambiguous, so that
    // is the only field adopted; a payload without one is ignored rather than guessed at.
    const t = p.toLight;
    if (!t) return;
    const v = Array.isArray(t)
      ? new THREE.Vector3(t[0], t[1], t[2])
      : new THREE.Vector3(t.x, t.y, t.z);
    if (v.lengthSq() < 1e-6) return;
    v.normalize();
    this.sunAdopted = v;
    this.uniforms.uSunDir.value.copy(v);
    this.sunElevationDeg = Number.isFinite(p.elevationDeg)
      ? p.elevationDeg
      : (Math.asin(v.y) * 180) / Math.PI;
    this.sunAzimuthDeg = Number.isFinite(p.azimuthDeg)
      ? p.azimuthDeg
      : (Math.atan2(v.x, v.z) * 180) / Math.PI;
  }

  _sunPayload() {
    const d = this.uniforms.uSunDir.value;
    return {
      source: "sky",
      toLight: [r4(d.x), r4(d.y), r4(d.z)],
      direction: [r4(-d.x), r4(-d.y), r4(-d.z)],
      hex: SUN.hex,
      elevationDeg: r3(this.sunElevationDeg),
      azimuthDeg: r3(this.sunAzimuthDeg),
      relativeIntensity: r4(this.lethis),
    };
  }

  // -------------------------------------------------------------------------- palette

  /** Re-solve every measured stop for the current tonemap. Cheap; runs at setup and on change. */
  _solveTone() {
    const e = this.exposure;
    const tm = this.toneMapping;
    this.maxResidual = 0;
    const solve = (hex) => {
      const s = inverseToneMap(hexToLinear(hex), e, tm);
      this.maxResidual = Math.max(this.maxResidual, s.residual);
      return s.rgb;
    };
    const put = (target, hex) => {
      const rgb = solve(hex);
      target.set(rgb[0], rgb[1], rgb[2]);
    };
    SKY_BANDS.forEach((b, i) => put(this.uniforms.uBandCol.value[i], b.hex));
    put(this.uniforms.uUnder.value, UNDER_HEX);
    put(this.uniforms.uCloudTop.value, CLOUD.top);
    put(this.uniforms.uCloudBody.value, CLOUD.body);
    put(this.uniforms.uCloudUnder.value, CLOUD.under);
    put(this.uniforms.uCloudSunward.value, CLOUD.sunward);
    put(this.uniforms.uSunGlow.value, SUN.hex);
    put(this.uniforms.uSunCore.value, SUN.coreHex);
    put(this.uniforms.uErrataCol.value, ERRATA.hex);
    put(this.uniforms.uErrataEdge.value, ERRATA.edgeHex);
    if (this.maxResidual > 0.004) {
      warn(`Sky: tonemap inversion residual ${this.maxResidual.toFixed(4)} — sky is off-palette`);
    }
  }

  // -------------------------------------------------------------------------- controls

  /** Dither amplitude in 8-bit LSBs. 0 disables it; the measure script uses that to prove it. */
  setDither(lsb) {
    this.ditherLsb = Math.max(0, Number(lsb) || 0);
    this.uniforms.uDither.value = this.ditherLsb / 255;
  }

  /** How much of each band gap is spent turning. 1 = a plain smoothstep chain, 0.3 = hard bands. */
  setBandSharpness(v) {
    this.bandSharp = Math.min(1, Math.max(0.05, Number(v) || 0.45));
    this.uniforms.uBandSharp.value = this.bandSharp;
  }

  setClouds(gain) {
    this.uniforms.uCloudGain.value = Math.min(1, Math.max(0, Number(gain) || 0));
  }

  // -------------------------------------------------------------------------- simulation

  fixed(step, simTime) {
    this.simTime = simTime;
    this.lethis = lethisAt(simTime);
    this.uniforms.uLethis.value = this.lethis;
    // Everything time-driven in the shader reads uTime, and uTime is simTime — so two captures at
    // the same simTime are the same frame no matter how the browser scheduled them.
    this.uniforms.uTime.value = simTime * this.motion;
  }

  frame() {
    const r = this.kernel.renderer;
    if (r.toneMappingExposure !== this.exposure || r.toneMapping !== this.toneMapping) {
      this.exposure = r.toneMappingExposure;
      this.toneMapping = r.toneMapping;
      this._solveTone();
    }
  }

  // -------------------------------------------------------------------------- probe

  report() {
    const d = this.uniforms.uSunDir.value;
    return {
      tier: config.tier.id,
      knobs: this.knobs,
      drawCalls: 1,
      triangles: 1,
      simTime: r4(this.simTime),
      motionScale: this.motion,

      lethis: r4(this.lethis),
      lethisMaxRatePerStep: Number((lethisMaxRatePerSecond() / 60).toFixed(7)),
      lethisRateBudgetPerStep: 0.0015,

      sun: {
        toLight: [r4(d.x), r4(d.y), r4(d.z)],
        elevationDeg: r3(this.sunElevationDeg),
        azimuthDeg: r3(this.sunAzimuthDeg),
        adopted: this.sunAdopted !== null,
        discRadiusDeg: SUN.discRadiusDeg,
      },

      // Everything the measure script needs to predict a pixel without trusting this file's prose.
      bands: SKY_BANDS.map((b) => ({ elevationDeg: b.el, hex: b.hex })),
      bandSharp: r3(this.bandSharp),
      underHex: UNDER_HEX,
      cloud: {
        ...CLOUD,
        azCells: CLOUDS.azCells,
        cellAzDeg: r4((360 / CLOUDS.azCells) * 1),
        cellElDirY: CLOUDS.elCell,
        cellElDegNearHorizon: r4((Math.asin(CLOUDS.elCell) * 180) / Math.PI),
        gain: r3(this.uniforms.uCloudGain.value),
        decks: this.knobs.deck2 ? 2 : 1,
        lowElevationBandDeg: [
          r3((Math.asin(CLOUDS.low.elLow) * 180) / Math.PI),
          r3((Math.asin(CLOUDS.low.elHigh) * 180) / Math.PI),
        ],
        rimShading: !!this.knobs.rim,
      },
      errata: {
        enabled: !!this.knobs.errata,
        azimuthDeg: r3(ERRATA.azimuthDeg + ERRATA.driftDegPerSec * this.simTime * this.motion),
        driftDegPerSec: ERRATA.driftDegPerSec,
      },

      dither: {
        lsb: r3(this.ditherLsb),
        pattern: "bayer8x8",
        source: "gl_FragCoord",
        appliedAfter: "tonemapping+colorspace",
      },

      toneMapping: this.toneMapping,
      exposure: r3(this.exposure),
      toneSolveResidual: Number(this.maxResidual.toFixed(6)),
    };
  }

  dispose() {
    this._offSun?.();
    this.material.dispose();
    this.mesh.geometry.dispose();
  }
}

const r3 = (v) => Number((Number(v) || 0).toFixed(3));
const r4 = (v) => Number((Number(v) || 0).toFixed(4));
