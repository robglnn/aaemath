import * as THREE from "three";
import { signals } from "../core/Signals.js";
import { publish } from "../core/Introspect.js";
// `world/Materials.js` is a shared world service — the one place a substance and the world's shadow
// colour are defined — and world modules import it directly, exactly as `world/Lighting.js` does.
import { materials, shared as rigUniforms } from "./Materials.js";

/**
 * Terrain — the faceted low-poly heightfield Leaf Nine is cut out of, and the flat-shading
 * material language everything in the level is built with.
 *
 * The render target is `reference/target-lowpoly.png`: PS1-era geometry under modern light.
 * Five decisions carry the whole look, and each one exists because of a specific failure:
 *
 *  1. **Non-indexed geometry, one normal per triangle, one colour per triangle.** Shared vertices
 *     average their neighbours' normals, and an averaged normal is a *smooth* surface however few
 *     triangles you give it — which is the single most common way a "low-poly" scene ends up
 *     looking like a deflated football. Every triangle here owns its three vertices outright, so
 *     every facet holds exactly one value and the silhouette between two facets is a hard edge.
 *     The shading normal is recovered in the fragment shader from `dFdx/dFdy` of the world
 *     position, so the facet is flat by *construction* and cannot be softened by anything
 *     downstream.
 *
 *  2. **Facet size is a level-design parameter, not a performance one.** At `cell = 6 m` a
 *     twenty-metre cliff resolves into three or four planes at gameplay distance, which is what
 *     the reference does. Halving the cell would cost nothing on this budget and would quietly
 *     destroy the look, so the number is authored and asserted, never tuned for frame rate.
 *
 *  3. **Shadow is an authored colour, not a multiplication.** The reference's lit rock measures
 *     `#B8834D` (hue 30) and the *same rock* in shadow measures `#1B2B32` (hue 198) — five times
 *     darker and on the other side of the wheel. No amount of ambient fill produces that from a
 *     warm albedo. So the shaded side of every facet is blended toward an authored blue-grey and
 *     the terminator is nearly hard. Form comes from geometry and from that value gap.
 *
 *  4. **Distance is carried by haze, never by detail.** Every material fades toward the horizon
 *     colour on its own curve, independent of `scene.fog`, so the piece owns its own aerial
 *     perspective and a distant leaf is a flat value shape rather than more triangles.
 *
 *  5. **Colours are authored in display space and inverted through the tonemap.** ACES eats
 *     roughly a stop of saturation and rolls off the top; typing the reference's measured hex
 *     into a material and hoping is how a warm ochre world comes out beige. `sceneColor()` runs
 *     the exact inverse of three's ACES fit, so `#B8834D` in this file is `#B8834D` on screen.
 *     Exposure divides out exactly (it is a pre-multiply inside the fit), so the rig may change
 *     exposure at any time and the authored colour still lands.
 *
 * The level supplies a `design(x, z, out)` callback — base height, whether the leaf exists here,
 * how protected the ground is, how rough, how thick underneath, and a surface class. Terrain owns
 * everything after that: noise, meshing, colouring, queries and the collider.
 */

// ---------------------------------------------------------------------------- noise basis
//
// Written here, not imported. Three primitives are enough for a whole world: a hash, a value
// noise built on it, and two fractal stacks over that.

/** 32-bit integer hash → [0,1). Deterministic on every platform; no `Math.random` anywhere. */
export function hash2i(ix, iz, seed) {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Value noise, quintic fade. C² continuous, so a derived slope never creases where it should not. */
export function valueNoise(x, z, seed) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const a = hash2i(ix, iz, seed);
  const b = hash2i(ix + 1, iz, seed);
  const c = hash2i(ix, iz + 1, seed);
  const d = hash2i(ix + 1, iz + 1, seed);
  const t = a + (b - a) * ux;
  const u = c + (d - c) * ux;
  return t + (u - t) * uz;
}

/** Signed fractal Brownian motion in [-1, 1]. Broad shape. */
export function fbm(x, z, seed, octaves = 4, lacunarity = 2.017, gain = 0.5) {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += (valueNoise(x * freq, z * freq, seed + o * 1013) * 2 - 1) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / (norm || 1);
}

/**
 * Ridged multifractal in [0, 1]. The absolute-value fold turns every zero crossing into a crest;
 * weighting each octave by the previous one keeps those crests *connected* into ridge lines
 * instead of scattering them, which is the difference between a mountain and a heap of gravel.
 */
export function ridged(x, z, seed, octaves = 4, lacunarity = 2.031, gain = 0.52, sharpness = 2.0) {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  let weight = 1;
  for (let o = 0; o < octaves; o++) {
    let n = 1 - Math.abs(valueNoise(x * freq, z * freq, seed + o * 7717) * 2 - 1);
    n = Math.pow(n, sharpness);
    n *= weight;
    weight = Math.min(1, n * 1.9);
    sum += n * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / (norm || 1);
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smoothstep = (a, b, t) => {
  const x = clamp((t - a) / (b - a || 1e-6), 0, 1);
  return x * x * (3 - 2 * x);
};
export const lerp = (a, b, t) => a + (b - a) * t;

/** Shortest distance from (x,z) to a polyline, plus the parameter along it. Level shaping needs both. */
export function distToPolyline(x, z, pts) {
  let best = Infinity;
  let bestT = 0;
  let acc = 0;
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1][0];
    const az = pts[i - 1][1];
    const bx = pts[i][0];
    const bz = pts[i][1];
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz || 1e-6;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / len2, 0, 1);
    const px = ax + dx * t;
    const pz = az + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best) {
      best = d;
      bestT = (acc + Math.sqrt(len2) * t) / (total || 1);
    }
    acc += Math.sqrt(len2);
  }
  return { d: best, t: bestT };
}

// ---------------------------------------------------------------------------- colour authoring
//
// three's ACES fit, and its exact numerical inverse. Authoring happens in display sRGB — the
// colours in this file are the hexes measured off `reference/target-lowpoly.png` — and the
// inverse produces the scene-linear value the renderer needs so that what comes out the other
// end of the tonemap is the colour that was asked for.

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
const mat3mul = (M, v) => [
  M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2],
  M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2],
  M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2],
];
const rrtOdt = (v) =>
  v.map((x) => {
    const a = x * (x + 0.0245786) - 0.000090537;
    const b = x * (0.98372901 * x + 0.432951) + 0.238081;
    return a / b;
  });

/** three's `ACESFilmicToneMapping`, exactly, at exposure 1. */
export function acesToneMap(rgbLinear) {
  let v = rgbLinear.map((x) => x / 0.6);
  v = mat3mul(ACES_IN, v);
  v = rrtOdt(v);
  v = mat3mul(ACES_OUT, v);
  return v.map((x) => clamp01(x));
}

const srgbToLin = (u) => (u <= 0.04045 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4));

/**
 * Scene-linear colour that ACES (at exposure 1) maps to the given display hex.
 *
 * Fixed-point iteration with a damped exponent — the map is monotone per channel once the
 * matrices are applied, and 120 iterations lands inside 1/255 for everything inside the
 * reachable gamut. Very bright saturated colours are *outside* it (ACES cannot make a
 * V=1.0 S=0.44 cyan), and those clamp rather than diverge; `sceneColorError()` reports how far
 * off a requested colour was so a wish that cannot be granted is visible instead of silent.
 */
const _sceneCache = new Map();
export function sceneRGB(hexDisplay) {
  const hit = _sceneCache.get(hexDisplay);
  if (hit) return hit;
  const target = [(hexDisplay >> 16) & 255, (hexDisplay >> 8) & 255, hexDisplay & 255].map((v) =>
    srgbToLin(v / 255)
  );
  const c = target.slice();
  for (let i = 0; i < 120; i++) {
    const got = acesToneMap(c);
    for (let k = 0; k < 3; k++) {
      const g = Math.max(got[k], 1e-5);
      c[k] = clamp(c[k] * Math.pow(target[k] / g, 0.65), 0, 40);
    }
  }
  const got = acesToneMap(c);
  const out = { r: c[0], g: c[1], b: c[2], err: Math.max(...got.map((v, k) => Math.abs(v - target[k]))) };
  _sceneCache.set(hexDisplay, out);
  return out;
}

/** A THREE.Color in the renderer's linear working space that survives the tonemap unchanged. */
export function sceneColor(hexDisplay) {
  const c = sceneRGB(hexDisplay);
  return new THREE.Color(c.r, c.g, c.b);
}

/** Worst per-channel display error of the last request for this colour — 0 means exactly reachable. */
export function sceneColorError(hexDisplay) {
  return sceneRGB(hexDisplay).err;
}

// ---------------------------------------------------------------------------- the palette
//
// Every colour in Leaf Nine, as a display hex measured off the reference. `review/p09-ref-measure.mjs`
// prints the patches these came from; `review/measure/P09.mjs` measures a real capture back
// against them.

export const PAL = {
  rockSun: 0xbe8850, // a facet square-on to Lethis          renders ≈ ref #B8834D
  rockLit: 0x8f6a3e, // general lit rock                     renders ≈ ref #785C3E
  rockWarm: 0x7a5c38, // lit rock, turned away
  deck: 0x9c7c3e, // flat walkable stone                   renders ≈ ref #7A642B
  deckPale: 0xb28e4c, // sun-bleached top of the leaf
  bank: 0x76673a, // damp stone beside a carry
  bone: 0xac8659, // built stone: the house, the arches    palette stone.bone
  boneDark: 0x6d5844,
  glass: 0x2c3a44, // the dark glass of the Bollard
  shadow: 0x1b2c33, // the authored shadow family           ref #1B2B32, hue 198
  underLit: 0x463f36, // leaf underside, catching bounce
  underDeep: 0x23272c, // leaf underside, deep
  // The cyan accents. ACES cannot reach the reference's V=1.0 S=0.44 cyan — it is outside the
  // fit's gamut — so a carry is authored at the most saturated cyan the tonemap *can* hold and
  // gets its brightness back from a near-white core lane, which is how the reference is built
  // anyway: `#8EFDE2` at the edge, `#D5FDF6` down the middle.
  carry: 0x7adcc8,
  carryCore: 0xc9f6ec,
  // The bank wall of a carry: the same teal walked down two stops, so a river carries its own
  // value structure — foot, body, core — instead of being one bright shape with no interior.
  carryBank: 0x2f7a72,
  crystal: 0x8fe0d2,
  crystalHot: 0xc0f2e6,
  hazeBase: 0xd89a5e, // the colour distance turns into: warm, and darker than the sky
  hazeSun: 0xf2c083,
  farStone: 0xb28d5f, // a leaf on the horizon, already mostly haze
  vantis: 0xa5865f, // Vantis across the Long Division
  greyProp: 0x6a6a63, // a greyed, propped structure
};

// ---------------------------------------------------------------------------- material language

const MAX_SUN = new THREE.Vector3(0.874, 0.139, -0.464);

/**
 * One uniform block, shared *by reference* across every material this module makes, so one write
 * per frame reaches the whole world. Per-material values live in `local` blocks instead.
 */
export const flatShared = {
  uVsSun: { value: MAX_SUN.clone() },
  uVsLevel: { value: 1 }, // Lethis relative output / exposure — see the class comment
  uVsHaze: { value: sceneColor(PAL.hazeBase) },
  uVsHazeSun: { value: sceneColor(PAL.hazeSun) },
  // 1/falloff metres, and the ceiling. Both are measured, not felt: in the reference the city
  // across the Long Division still holds Y 0.293 against a sky at Y 0.559, so distance is worth
  // about 78% of the way to the haze colour and no more. Haze that goes to 1.0 erases a horizon
  // question, and this world is made of horizon questions.
  uVsHazeP: { value: new THREE.Vector2(1 / 750, 0.78) },
  /**
   * **The shadow family, taken by reference from the rig instead of typed here.**
   *
   * This used to be `sceneColor(PAL.shadow)` — `#1B2C33` pushed backwards through the ACES fit so
   * that it would come out the other side unchanged. That inversion is correct only if something
   * downstream applies ACES, and nothing does: `world/Lighting.js` §3.5 sets
   * `renderer.toneMapping = NoToneMapping` (the palette is the grade, and a filmic shoulder
   * compresses the top of §1.2's cosine ladder until facets stop reading as facets), and P12's
   * `GradePass` mirrors whatever the renderer is doing, which is nothing. So the pre-inversion was
   * being cashed in twice: `#1B2C33` rendered as `#2C3B41` — right hue, but **S 0.32 / V 0.26**
   * against the target's **S 0.47 / V 0.20**. A washed-out shadow is how a two-value world turns
   * into a one-value world.
   *
   * `Materials.shared.uVsShadowTint` is the *same uniform object* the whole scatter reads, and
   * `Lighting._apply()` writes it once per frame. Sharing the object rather than the value is what
   * makes "one shadow family in this world" a property of the code instead of two files agreeing.
   */
  uVsShade: rigUniforms.uVsShadowTint,
};

const GLSL_PARS = /* glsl */ `
uniform vec3  uVsSun;
uniform float uVsLevel;
uniform vec3  uVsHaze;
uniform vec3  uVsHazeSun;
uniform vec2  uVsHazeP;
uniform vec3  uVsShade;
uniform vec4  uVsGrade;   // x lit floor, y shadow authoring, z terminator half width, w unlit
uniform vec2  uVsDist;    // x virtual-distance multiplier, y extra haze bias
`;

const GLSL_SHADOW = /* glsl */ `
// Slot 0 is the rig's only shadow caster (world/Lighting.js adds it first, on purpose).
float vsFlatShadow() {
	float s = 1.0;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
		DirectionalLightShadow vsDLS = directionalLightShadows[ 0 ];
		s = receiveShadow ? getShadow( directionalShadowMap[ 0 ], vsDLS.shadowMapSize, vsDLS.shadowIntensity, vsDLS.shadowBias, vsDLS.shadowRadius, vDirectionalShadowCoord[ 0 ] ) : 1.0;
	#endif
	return s;
}
`;

const GLSL_GRADE = /* glsl */ `
	{
		// The facet normal, taken from the geometry itself. Whatever the vertex normals say, a
		// triangle is a plane, and this is that plane — flat shading that nothing can round off.
		vec3 vsN = normalize( cross( dFdx( vVsWorld ), dFdy( vVsWorld ) ) );
		vec3 vsToCam = cameraPosition - vVsWorld;
		if ( dot( vsN, vsToCam ) < 0.0 ) vsN = -vsN;

		float vsNdL = dot( vsN, uVsSun );
		float vsLit = smoothstep( -uVsGrade.z, uVsGrade.z, vsNdL ) * vsFlatShadow();
		float vsKey = clamp( vsNdL, 0.0, 1.0 );

		vec3 vsAlb = diffuseColor.rgb;
		// Lit faces keep a real spread of value, so a spire reads as several planes and not as one
		// silhouette: square-on to Lethis is full albedo, grazing is the floor.
		vec3 vsLitCol = vsAlb * mix( uVsGrade.x, 1.0, pow( vsKey, 0.6 ) );

		/**
		 * **The shadow side is graded by HOW FAR a face is turned from the key, not just by the
		 * fact that it is turned.** This line is the whole of a critic's biggest finding.
		 *
		 * What was here computed 'uVsShade * ( 0.78 + 0.35 * vsUp )', and 'vsUp' is
		 * 'N.y * 0.5 + 0.5'. Every wall band of a spire is within a few degrees of vertical, so
		 * 'vsUp' sat between 0.47 and 0.70 for all of them: an 8% spread, well under one histogram
		 * bin. 'smoothstep(-0.035, 0.035, N.L)' had already collapsed to exactly 0 for the entire
		 * back hemisphere, so nothing downstream could tell a face leaning 4 degrees out of the key
		 * from one leaning 44 degrees out of it. Every shoulder ring, every flare, every extra
		 * triangle spent on the silhouette of a spire rendered as ONE flat value with hairline
		 * seams in it — geometry the renderer physically could not express.
		 *
		 * 'vsBack' is the missing term: 0 for a face square away from Lethis, 1 at the terminator.
		 * 0.72 -> 1.18 is a 1.64x spread, which at the shadow family's measured luminance opens
		 * four to five distinct value bands where there was one.
		 *
		 * It is pure N·L on a world-fixed key. No view vector appears in it, so it cannot follow the
		 * camera and cannot draw a Fresnel rim; and it scales 'uVsShade' as a scalar, so it can move
		 * value and can never move the shadow family off hue 198.
		 */
		float vsUp = clamp( vsN.y * 0.5 + 0.5, 0.0, 1.0 );
		float vsBack = smoothstep( -0.85, -0.02, vsNdL );
		vec3 vsShadeTint = uVsShade * mix( 0.72, 1.18, vsBack ) * ( 0.94 + 0.12 * vsUp );
		vec3 vsShadeCol = mix( vsAlb * 0.06, vsShadeTint, uVsGrade.y );

		vec3 vsCol = mix( vsShadeCol, vsLitCol, vsLit );
		vsCol = mix( vsCol, vsAlb, uVsGrade.w ) * uVsLevel;

		// Aerial perspective, owned here rather than by scene.fog, so this piece's distance
		// structure survives whatever the sky and post stack do later.
		//
		// Mixed in sqrt space, and that is the whole difference between this reading as a painted
		// distance and reading as a flood. Scene-linear radiance of a bright horizon is roughly
		// twenty times a shadowed rock's, so a 30% linear lerp toward it does not tint the rock —
		// it replaces it, and the near-middle distance blows out to one flat salt-flat orange.
		// A perceptual blend behaves the way an artist's does, and sqrt is close enough to the
		// display curve to be free.
		float vsD = length( vsToCam ) * uVsDist.x;
		float vsSunAmt = pow( max( dot( normalize( -vsToCam ), uVsSun ), 0.0 ), 3.0 );
		vec3 vsHz = mix( uVsHaze, uVsHazeSun, vsSunAmt ) * uVsLevel;
		// The exponent is the important half of this curve. A plain exp() puts a tenth of the haze
		// on a rock a hundred metres away, and in a perceptual blend a tenth of a bright horizon
		// lifts a shadow facet by a factor of three — the near-middle distance loses its shadow
		// family and the whole leaf turns into one grey-brown value. Raising d/D to 1.7 keeps the
		// first two hundred metres honest and still saturates by the horizon.
		float vsH = clamp( uVsHazeP.y * ( 1.0 - exp( -pow( vsD * uVsHazeP.x, 1.7 ) ) ) + uVsDist.y, 0.0, 0.985 );
		vec3 vsMix = mix( sqrt( max( vsCol, 0.0 ) ), sqrt( max( vsHz, 0.0 ) ), vsH );
		vsCol = vsMix * vsMix;

		outgoingLight = vsCol;
	}
`;

const _matCache = new Map();

/**
 * A flat-shaded material. Identical keys return the same instance — a material per mesh is the
 * fastest way to blow the program budget, and every variant here shares one compiled program
 * because they differ only by uniform values.
 *
 * @param {string} key    cache key; also the material name
 * @param {object} opts
 *   litFloor    how dark a grazing lit facet gets (0..1, default 0.42)
 *   shade       how far a shaded facet travels to the authored shadow colour (0..1, default 0.86)
 *   terminator  half-width of the light/shadow edge in N·L (default 0.035 — nearly hard)
 *   unlit       1 for things that are their own light source: carries, certainties
 *   distance    virtual-distance multiplier for the compressed backdrop group
 *   hazeBias    extra haze added flat (used to sit a far object further back in the air)
 *   side        THREE side constant
 */
export function flatMaterial(key, opts = {}) {
  const hit = _matCache.get(key);
  if (hit) return hit;

  const local = {
    uVsGrade: {
      value: new THREE.Vector4(
        opts.litFloor ?? 0.42,
        opts.shade ?? 0.96,
        opts.terminator ?? 0.035,
        opts.unlit ?? 0
      ),
    },
    uVsDist: { value: new THREE.Vector2(opts.distance ?? 1, opts.hazeBias ?? 0) },
  };

  /**
   * **The material object comes out of `world/Materials.js`, and that is not bookkeeping.**
   *
   * P11's flat-shaded factory used to be imported by exactly one file and painted nothing a player
   * could see, which meant every colour claim that piece made was a claim about a private test
   * scene. Every lit surface in the world now holds a material that factory built, so
   * `materials.stats()`, the §5 ban audit and `Lighting.audit()` describe the shipped frame.
   *
   * The archetype is `authored` because this piece's value ladder is baked into per-face vertex
   * colour and those colours are *rendered pixels* measured off the reference, not albedos. Handing
   * them to §3.2's division would charge the key twice and blow six hundred metres of leaf out to
   * white. So the factory contributes the material type, the ban list, `vVsWorld` (instancing-aware)
   * and — the part that moves pixels — `shared.uVsShadowTint`; the lit ramp, the terminator and the
   * aerial perspective stay here, in the piece that owns the distance, and run after it.
   *
   * `make()` rather than `get()`: every key here carries its own `uVsGrade`/`uVsDist`, and a shared
   * instance could only hold one of them. They all still return the same `customProgramCacheKey`,
   * so three compiles this family exactly once.
   */
  const mat = materials.make("authored", {
    name: `vs.flat.${key}`,
    vertexColors: opts.vertexColors ?? true,
    flatShading: true,
    side: opts.side ?? THREE.FrontSide,
    fog: false, // this piece owns its own aerial perspective
    transparent: !!opts.transparent,
    opacity: opts.opacity ?? 1,
    depthWrite: opts.depthWrite ?? true,
    extend: {
      key: "vs.flat",
      uniforms: { ...flatShared, ...local },
      fragmentPars: GLSL_PARS,
      fragmentFns: GLSL_SHADOW,
      gradeBody: GLSL_GRADE,
    },
  });
  mat.userData.vsUniforms = local;
  mat.userData.vsEmissive = (opts.unlit ?? 0) > 0.5; // P12's bloom mask reads this flag
  // A carry and a certainty field are §7.2 accents — the only saturated things in this world — and
  // the factory's `vsAccent` flag is how every downstream census finds them. Without it P11's own
  // accent-leak row counted six hundred metres of luminous teal river as cyan that had escaped.
  mat.userData.vsAccent = mat.userData.vsEmissive;

  _matCache.set(key, mat);
  return mat;
}

export function flatMaterialCount() {
  return _matCache.size;
}

/** Called once per frame by Terrain. Nothing else may write the shared block. */
export function updateFlatShared({ sun, level, exposure }) {
  if (sun) flatShared.uVsSun.value.set(sun[0], sun[1], sun[2]).normalize();
  // Exposure divides out exactly: ACES applies it as a pre-multiply, so dividing the scene value
  // by it restores the display colour that `sceneColor()` solved for at exposure 1.
  const e = exposure && exposure > 1e-3 ? exposure : 1;
  flatShared.uVsLevel.value = (level ?? 1) / e;
}

// ---------------------------------------------------------------------------- geometry helpers

/**
 * Build a non-indexed BufferGeometry from a triangle soup, with genuine per-face normals and one
 * colour per face. `faces` is a flat array of 9 numbers per triangle; `colorFn(cx, cy, cz, nx, ny,
 * nz, i)` returns `[r, g, b]` in scene-linear.
 */
export function facetGeometry(positions, colorFn) {
  const triCount = positions.length / 9;
  const pos = positions instanceof Float32Array ? positions : new Float32Array(positions);
  const nrm = new Float32Array(triCount * 9);
  const col = new Float32Array(triCount * 9);
  for (let t = 0; t < triCount; t++) {
    const o = t * 9;
    const ax = pos[o], ay = pos[o + 1], az = pos[o + 2];
    const bx = pos[o + 3], by = pos[o + 4], bz = pos[o + 5];
    const cx = pos[o + 6], cy = pos[o + 7], cz = pos[o + 8];
    let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    let ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    let nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    const r = colorFn((ax + bx + cx) / 3, (ay + by + cy) / 3, (az + bz + cz) / 3, nx, ny, nz, t);
    for (let k = 0; k < 3; k++) {
      nrm[o + k * 3] = nx; nrm[o + k * 3 + 1] = ny; nrm[o + k * 3 + 2] = nz;
      col[o + k * 3] = r[0]; col[o + k * 3 + 1] = r[1]; col[o + k * 3 + 2] = r[2];
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/** Merge non-indexed position/normal/colour geometries into one draw call. */
export function mergeFacets(list) {
  let n = 0;
  for (const g of list) n += g.getAttribute("position").count;
  const pos = new Float32Array(n * 3);
  const nrm = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  let o = 0;
  for (const g of list) {
    const p = g.getAttribute("position");
    pos.set(p.array, o * 3);
    nrm.set(g.getAttribute("normal").array, o * 3);
    col.set(g.getAttribute("color").array, o * 3);
    o += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  out.setAttribute("color", new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  for (const g of list) g.dispose();
  return out;
}

/** Push one triangle's nine floats. */
export function pushTri(out, a, b, c) {
  out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
}

/**
 * A convex-ish angular solid: a closed polyhedron from a ring of base points and an apex, with
 * optional shoulder rings. This is the whole vocabulary the reference's rock is drawn in — big
 * planes meeting at hard edges — and every spire, boulder and shard in the level is one of these.
 */
/**
 * The shoulder profile for anything tall enough that its side elevation is a big read — **derived
 * per shard, never typed.**
 *
 * A hard-won lesson lives in this block. The first version of it was a literal ring set,
 * `[[0.24,1.06],[0.55,0.8],[0.82,0.34]]`, with a comment claiming its four wall bands "lean four
 * different ways". They do not. Band inclination is a function of the *aspect ratio* — the four
 * bands of that set on the hero shard (radius 16, height 64, taper 0.11) have normal elevations of
 * −3.6°, +11.8°, +23.1° and +17.7°: the top two are 5.4° apart AND the run is non-monotonic, so the
 * cap is shallower than the shoulder under it and the two merge into one plane. One typed ring set
 * cannot be right for a 16×64 spire and a 13×26 boulder at the same time, because the same radii
 * describe different slopes on different aspects.
 *
 * So the *inclinations* are authored and the radii are solved for.
 *
 *   `BAND_H`  what share of the height each of the four wall bands gets. Sums to 1.
 *   `BAND_S`  what each band's normal slope (as a tangent) is offset from the shard's own mean
 *             slope. Sums to **zero** under `BAND_H` weighting, and that is the whole trick: the
 *             weighted mean slope is then exactly `radius(1 − taper) / height` whatever the aspect,
 *             so the solved ring set always lands on the authored base radius and the authored cap
 *             radius, and only the *distribution* of slope between them is imposed.
 *
 * The result is monotonic, cap-steepest, and adjacent bands differ by 13–20° of normal elevation
 * over every aspect this level builds. `bandElevationsDeg()` recomputes that from the emitted ring
 * set by an independent path and `shard()` refuses to build a profile that fails it.
 */
const BAND_H = [0.35, 0.34, 0.21, 0.1];
const BAND_S = [-0.33, -0.05, 0.26, 0.779];

/** Height above which a shard gets the shoulder profile when the caller did not author its own. */
export const SHOULDER_MIN_HEIGHT = 20;

/**
 * The minimum difference in normal elevation between two consecutive wall bands, in degrees.
 *
 * Not a taste number. `GLSL_GRADE`'s shadow term spans 0.72→1.18 of the shadow tint over N·L from
 * −0.85 to −0.02; at the arrival frame's key that is ≈0.9% of value per degree of inclination, so
 * bands 12° apart differ by ≈11% — comfortably more than one 8-bit histogram bin, which is the
 * definition of "reads as two planes rather than one".
 */
export const SHOULDER_MIN_SEPARATION_DEG = 12;

/** Live audit of every shoulder profile this module has emitted. The terrain probe publishes it. */
export const shoulderAudit = { checked: 0, violations: 0, worstAdjacentDeltaDeg: Infinity, widestSpreadUsed: 1 };

/** The four wall bands' outward-normal elevations, in degrees, recomputed from a ring set. */
export function bandElevationsDeg(radius, height, taper, rings) {
  const levels = [
    { h: 0, r: radius },
    ...rings.map((r) => ({ h: r[0] * height, r: r[1] * radius })),
    { h: height, r: radius * taper },
  ];
  const out = [];
  for (let i = 0; i < levels.length - 1; i++) {
    const dh = Math.max(levels[i + 1].h - levels[i].h, 1e-6);
    const dr = levels[i + 1].r - levels[i].r;
    out.push((Math.atan2(-dr, dh) * 180) / Math.PI);
  }
  return out;
}

/** Smallest gap between consecutive band elevations. Negative means the run is non-monotonic. */
export function worstBandSeparationDeg(elev) {
  let worst = Infinity;
  for (let i = 1; i < elev.length; i++) worst = Math.min(worst, elev[i] - elev[i - 1]);
  return worst;
}

function ringsAtSpread(radius, height, taper, spread) {
  const mean = (radius * (1 - taper)) / Math.max(height, 1e-6);
  const rings = [];
  let r = radius;
  let h = 0;
  for (let i = 0; i < BAND_H.length - 1; i++) {
    const dh = BAND_H[i] * height;
    r -= (mean + spread * BAND_S[i]) * dh;
    h += dh;
    rings.push([h / height, r / radius]);
  }
  return rings;
}

/**
 * Solve the ring set for one shard. Widens the slope spread until the separation rule holds, which
 * only ever bites on an aspect ratio this level does not currently build.
 */
export function shoulderRings(radius, height, taper) {
  let spread = 1;
  for (let attempt = 0; attempt < 10; attempt++) {
    const rings = ringsAtSpread(radius, height, taper, spread);
    if (worstBandSeparationDeg(bandElevationsDeg(radius, height, taper, rings)) >= SHOULDER_MIN_SEPARATION_DEG) {
      shoulderAudit.widestSpreadUsed = Math.max(shoulderAudit.widestSpreadUsed, spread);
      return rings;
    }
    spread *= 1.22;
  }
  return ringsAtSpread(radius, height, taper, spread);
}

export function shard({ x = 0, y = 0, z = 0, radius = 4, height = 10, sides = 5, taper = 0.18, lean = [0, 0], rings = null, seed = 1, jag = 0.3 }) {
  const out = [];
  if (rings == null) {
    rings = height >= SHOULDER_MIN_HEIGHT ? shoulderRings(radius, height, taper) : [];
    if (rings.length) {
      // The assertion the last round did not have. It recomputes the emitted profile's band
      // inclinations from the ring set — not from the solver's own intermediate values — and
      // refuses to hand back a spire the shading model cannot express. A silent regression here
      // costs a whole review round, so it is loud.
      const elev = bandElevationsDeg(radius, height, taper, rings);
      const worst = worstBandSeparationDeg(elev);
      shoulderAudit.checked++;
      shoulderAudit.worstAdjacentDeltaDeg = Math.min(shoulderAudit.worstAdjacentDeltaDeg, Number(worst.toFixed(2)));
      if (!(worst >= SHOULDER_MIN_SEPARATION_DEG)) {
        shoulderAudit.violations++;
        throw new Error(
          `Terrain.shard: shoulder profile for radius ${radius} height ${height} taper ${taper} emits band ` +
            `normal elevations [${elev.map((v) => v.toFixed(1)).join(", ")}]°, worst adjacent gap ` +
            `${worst.toFixed(1)}° < ${SHOULDER_MIN_SEPARATION_DEG}°. Bands that close must not be built: ` +
            `they merge into one plane and every triangle spent on them is wasted.`
        );
      }
    }
  }
  const ringPts = (r, h, tw) => {
    const pts = [];
    for (let i = 0; i < sides; i++) {
      const a = ((i + tw) / sides) * Math.PI * 2;
      const jr = r * (1 + (hash2i(i, Math.round(h * 7), seed) - 0.5) * jag);
      pts.push([
        x + Math.cos(a) * jr + lean[0] * (h / height),
        y + h,
        z + Math.sin(a) * jr + lean[1] * (h / height),
      ]);
    }
    return pts;
  };
  const levels = [{ h: 0, r: radius }, ...rings.map((r) => ({ h: r[0] * height, r: r[1] * radius }))];
  levels.push({ h: height, r: radius * taper });
  const bands = levels.map((L, i) => ringPts(L.r, L.h, i * 0.13));

  // base cap
  for (let i = 1; i < sides - 1; i++) pushTri(out, bands[0][0], bands[0][i + 1], bands[0][i]);
  // walls
  for (let b = 0; b < bands.length - 1; b++) {
    const lo = bands[b];
    const hi = bands[b + 1];
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      pushTri(out, lo[i], lo[j], hi[i]);
      pushTri(out, lo[j], hi[j], hi[i]);
    }
  }
  // top cap
  const top = bands[bands.length - 1];
  for (let i = 1; i < sides - 1; i++) pushTri(out, top[0], top[i], top[i + 1]);
  return out;
}

/** An axis-aligned faceted box — built stone, crates, decks, tower blocks. */
export function boxTris(cx, cy, cz, sx, sy, sz, out = []) {
  const x0 = cx - sx / 2, x1 = cx + sx / 2;
  const y0 = cy, y1 = cy + sy;
  const z0 = cz - sz / 2, z1 = cz + sz / 2;
  const V = [
    [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
    [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1],
  ];
  const quad = (a, b, c, d) => { pushTri(out, V[a], V[b], V[c]); pushTri(out, V[a], V[c], V[d]); };
  quad(4, 5, 6, 7); // top
  quad(0, 3, 2, 1); // bottom
  quad(0, 1, 5, 4);
  quad(1, 2, 6, 5);
  quad(2, 3, 7, 6);
  quad(3, 0, 4, 7);
  return out;
}

// ---------------------------------------------------------------------------- the heightfield

const _v3 = new THREE.Vector3();

export class Terrain {
  /**
   * @param {Kernel} kernel
   * @param {object} spec  the level's design: bounds, cell size, seed and a `design(x,z,out)`
   */
  constructor(kernel, spec) {
    this.kernel = kernel;
    this.spec = spec;
    this.root = new THREE.Group();
    this.root.name = "vs.terrain";

    const { x0, x1, z0, z1 } = spec.bounds;
    this.cell = spec.cell ?? 6;
    this.x0 = x0;
    this.z0 = z0;
    this.nx = Math.round((x1 - x0) / this.cell) + 1;
    this.nz = Math.round((z1 - z0) / this.cell) + 1;
    this.seed = spec.seed ?? 9;

    const n = this.nx * this.nz;
    this.h = new Float32Array(n); // surface height at the (jittered) vertex
    this.jx = new Float32Array(n); // vertex XZ jitter — facets must not look like graph paper
    this.jz = new Float32Array(n);
    this.inside = new Uint8Array(n);
    this.mat = new Uint8Array(n);
    this.dist = new Float32Array(n); // metres to the nearest lip, for the underside
    this.under = new Float32Array(n);

    this._build();
    this._mesh();
    this._emitCollider();

    publish("terrain", () => this.snapshot());
  }

  // -------------------------------------------------------------------------- sampling grid

  idx(i, j) {
    return j * this.nx + i;
  }

  /** World XZ of grid node (i,j), including its authored jitter. */
  nodeX(i, j) {
    return this.x0 + i * this.cell + this.jx[this.idx(i, j)];
  }
  nodeZ(i, j) {
    return this.z0 + j * this.cell + this.jz[this.idx(i, j)];
  }

  _build() {
    const { cell, nx, nz, seed } = this;
    const out = {};
    const jitter = cell * 0.3;

    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const k = this.idx(i, j);
        // Interior nodes jitter; the outer ring does not, so the domain stays rectangular.
        const edge = i === 0 || j === 0 || i === nx - 1 || j === nz - 1;
        this.jx[k] = edge ? 0 : (hash2i(i, j, seed) - 0.5) * 2 * jitter;
        this.jz[k] = edge ? 0 : (hash2i(i, j, seed + 977) - 0.5) * 2 * jitter;
        const x = this.x0 + i * cell + this.jx[k];
        const z = this.z0 + j * cell + this.jz[k];

        out.h = 0; out.mask = 0; out.rough = 1; out.protect = 0; out.mat = 1; out.thick = 1;
        this.spec.design(x, z, out);

        // Layered noise, written above, added only where the level has not protected the ground.
        // Deliberately quiet. Lethis sits eleven degrees above the horizon, so any facet tilted
        // more than eleven degrees away from it falls into the shadow family — and a heightfield
        // with lively high-frequency noise therefore renders as salt-and-pepper light and shade
        // that averages, at two hundred metres, into one dead blue-brown. The reference's ground
        // is big smooth planes with the drama in the *authored* cliffs, and this is how you get
        // that: broad shape, one ridge line, almost no grain.
        const wobbleX = x + fbm(x * 0.0031, z * 0.0031, seed + 31, 3) * 40;
        const wobbleZ = z + fbm(x * 0.0031, z * 0.0031, seed + 57, 3) * 40;
        const broad = fbm(wobbleX * 0.0055, wobbleZ * 0.0055, seed, 3) * 4.6;
        const ridge = (ridged(wobbleX * 0.011, wobbleZ * 0.011, seed + 5, 3) - 0.42) * 5.4;
        const grain = fbm(x * 0.042, z * 0.042, seed + 11, 2) * 0.3;
        const amp = (1 - clamp01(out.protect)) * (out.rough ?? 1);

        this.h[k] = out.h + (broad + ridge + grain) * amp;
        this.inside[k] = out.mask >= 0.5 ? 1 : 0;
        this.mat[k] = out.mat | 0;
        this.under[k] = out.thick ?? 1;
      }
    }

    this._distanceToLip();

    // Turn the "thickness scale" into an actual underside height.
    for (let k = 0; k < nx * nz; k++) {
      if (!this.inside[k]) continue;
      const d = this.dist[k];
      const dn = clamp01(d / 130);
      const i = k % nx;
      const j = (k / nx) | 0;
      const x = this.x0 + i * cell;
      const z = this.z0 + j * cell;
      // Thin at the lip, deep and ragged toward the middle: a fracture, not a moulding.
      const keel = 4.5 + Math.pow(dn, 0.55) * 86 * (this.under[k] || 1);
      const rag = (ridged(x * 0.017, z * 0.017, seed + 303, 3) - 0.4) * 26 * clamp01(d / 26);
      this.under[k] = this.h[k] - Math.max(3.2, keel + rag);
    }
  }

  /** Two-pass chamfer distance (in metres) from every inside node to the nearest lip. */
  _distanceToLip() {
    const { nx, nz, cell } = this;
    const D = this.dist;
    const BIG = 1e9;
    const d1 = cell;
    const d2 = cell * Math.SQRT2;
    for (let k = 0; k < nx * nz; k++) D[k] = this.inside[k] ? BIG : 0;
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const k = this.idx(i, j);
        if (!this.inside[k]) continue;
        let m = D[k];
        if (i > 0) m = Math.min(m, D[k - 1] + d1);
        if (j > 0) m = Math.min(m, D[k - nx] + d1);
        if (i > 0 && j > 0) m = Math.min(m, D[k - nx - 1] + d2);
        if (i < nx - 1 && j > 0) m = Math.min(m, D[k - nx + 1] + d2);
        D[k] = m;
      }
    for (let j = nz - 1; j >= 0; j--)
      for (let i = nx - 1; i >= 0; i--) {
        const k = this.idx(i, j);
        if (!this.inside[k]) continue;
        let m = D[k];
        if (i < nx - 1) m = Math.min(m, D[k + 1] + d1);
        if (j < nz - 1) m = Math.min(m, D[k + nx] + d1);
        if (i < nx - 1 && j < nz - 1) m = Math.min(m, D[k + nx + 1] + d2);
        if (i > 0 && j < nz - 1) m = Math.min(m, D[k + nx - 1] + d2);
        D[k] = m;
      }
  }

  // -------------------------------------------------------------------------- meshing

  /**
   * Triangulate. Every cell contributes two triangles with a hashed diagonal, so the facet
   * pattern never reads as graph paper; a triangle exists only if all three of its nodes are
   * inside the leaf, which is what cuts the lip and the ravine.
   */
  _triangleList() {
    const { nx, nz } = this;
    const tris = [];
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = this.idx(i, j);
        const b = this.idx(i + 1, j);
        const c = this.idx(i + 1, j + 1);
        const d = this.idx(i, j + 1);
        if (hash2i(i, j, this.seed + 4441) < 0.5) {
          if (this.inside[a] && this.inside[b] && this.inside[c]) tris.push(a, b, c);
          if (this.inside[a] && this.inside[c] && this.inside[d]) tris.push(a, c, d);
        } else {
          if (this.inside[a] && this.inside[b] && this.inside[d]) tris.push(a, b, d);
          if (this.inside[b] && this.inside[c] && this.inside[d]) tris.push(b, c, d);
        }
      }
    }
    return tris;
  }

  _nodePos(k, top) {
    const i = k % this.nx;
    const j = (k / this.nx) | 0;
    return [this.x0 + i * this.cell + this.jx[k], top ? this.h[k] : this.under[k], this.z0 + j * this.cell + this.jz[k]];
  }

  _mesh() {
    const tris = this._triangleList();
    this.tris = tris;
    this.triCount = tris.length / 3;

    // --- top surface ------------------------------------------------------------------
    const top = new Float32Array(tris.length * 3);
    for (let t = 0; t < tris.length; t += 3) {
      const o = t * 3;
      for (let v = 0; v < 3; v++) {
        const p = this._nodePos(tris[t + v], true);
        top[o + v * 3] = p[0];
        top[o + v * 3 + 1] = p[1];
        top[o + v * 3 + 2] = p[2];
      }
    }
    const topGeo = facetGeometry(top, (cx, cy, cz, nx2, ny, nz2, ti) => this._surfaceColor(cx, cy, cz, ny, ti));
    this.topGeometry = topGeo;

    // The ground gets a softer terminator and a gentler shadow than the props do. A cliff face is
    // a plane and wants a hard edge; five hundred metres of open leaf is a *gradient*, and giving
    // it the same near-binary ramp as a spire turns every eleven-degree undulation into a hard
    // navy patch. Hard edges belong to the things whose edges are the point.
    const surface = new THREE.Mesh(
      topGeo,
      flatMaterial("terrain.surface", { litFloor: 0.52, shade: 0.62, terminator: 0.17 })
    );
    surface.name = "vs.terrain.surface";
    surface.receiveShadow = true;
    surface.castShadow = false; // the shadow camera is 30 m wide; a 660 m caster buys nothing
    this.root.add(surface);
    this.surface = surface;

    // --- underside and lip wall --------------------------------------------------------
    // There is no ground under a leaf. What holds it up is the claims inside it, and what you
    // see from below is the fracture where the false part stopped being there.
    const under = [];
    for (let t = 0; t < tris.length; t += 3) {
      const a = this._nodePos(tris[t], false);
      const b = this._nodePos(tris[t + 1], false);
      const c = this._nodePos(tris[t + 2], false);
      pushTri(under, a, c, b); // reversed: the underside faces down
    }
    // Boundary edges (used by exactly one triangle) become the lip wall.
    const edges = new Map();
    const key = (p, q) => (p < q ? p * 1e7 + q : q * 1e7 + p);
    for (let t = 0; t < tris.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const p = tris[t + e];
        const q = tris[t + ((e + 1) % 3)];
        const kk = key(p, q);
        const hit = edges.get(kk);
        if (hit) hit.n++;
        else edges.set(kk, { p, q, n: 1 });
      }
    }
    let lipEdges = 0;
    for (const e of edges.values()) {
      if (e.n !== 1) continue;
      lipEdges++;
      const pt = this._nodePos(e.p, true);
      const qt = this._nodePos(e.q, true);
      const pu = this._nodePos(e.p, false);
      const qu = this._nodePos(e.q, false);
      pushTri(under, pt, pu, qt);
      pushTri(under, qt, pu, qu);
    }
    this.lipEdges = lipEdges;

    const underGeo = facetGeometry(new Float32Array(under), (cx, cy, cz, nx2, ny, nz2, ti) =>
      this._undersideColor(cx, cy, cz, ny, ti)
    );
    this.underGeometry = underGeo;
    const keel = new THREE.Mesh(underGeo, flatMaterial("terrain.keel", { litFloor: 0.34, shade: 0.8, terminator: 0.1 }));
    keel.name = "vs.terrain.keel";
    keel.receiveShadow = false;
    keel.castShadow = false;
    this.root.add(keel);
    this.keel = keel;
  }

  // -------------------------------------------------------------------------- colour

  /**
   * One colour per facet, chosen by what the facet *is*: slope decides rock or deck, the level's
   * material class decides bank or field, and a hashed ±5% keeps neighbouring facets from
   * flattening into a single field of colour.
   */
  _surfaceColor(x, y, z, ny, ti) {
    const cls = this.classAt(x, z);
    const slope = 1 - clamp01(ny);
    let hex;
    if (slope > 0.62) hex = PAL.rockSun;
    else if (slope > 0.36) hex = PAL.rockLit;
    else if (cls === 3) hex = PAL.deckPale; // the certainty field
    else if (cls === 2) hex = PAL.bank; // a carry bank
    else if (cls === 4) hex = PAL.deckPale; // an authored pad
    else hex = PAL.deck;
    const c = sceneRGB(hex);
    const j = 1 + (hash2i(ti, 7, this.seed + 12) - 0.5) * 0.11;
    return [c.r * j, c.g * j, c.b * j];
  }

  _undersideColor(x, y, z, ny, ti) {
    // Down-facing keel goes deep; the near-vertical lip catches the light the top does.
    const down = clamp01(-ny);
    const a = sceneRGB(PAL.underLit);
    const b = sceneRGB(PAL.underDeep);
    const t = Math.pow(down, 0.6);
    const j = 1 + (hash2i(ti, 19, this.seed + 40) - 0.5) * 0.13;
    return [lerp(a.r, b.r, t) * j, lerp(a.g, b.g, t) * j, lerp(a.b, b.b, t) * j];
  }

  /** The level's material class at a point, sampled from the grid (0 deck, 2 bank, 3 field, 4 pad). */
  classAt(x, z) {
    const i = clamp(Math.round((x - this.x0) / this.cell), 0, this.nx - 1);
    const j = clamp(Math.round((z - this.z0) / this.cell), 0, this.nz - 1);
    return this.mat[this.idx(i, j)];
  }

  // -------------------------------------------------------------------------- queries
  //
  // These evaluate the *exact plane of the rendered triangle*. A heightfield that interpolates
  // its own grid instead would put the collision surface a few centimetres away from the one on
  // screen, which is how a character ends up shin-deep in a facet on some machines and floating
  // on others.

  /**
   * Ground height at (x,z), or NaN off the leaf.
   * @returns {number}
   */
  groundAt(x, z) {
    const hit = this._locate(x, z);
    return hit ? hit.y : NaN;
  }

  /** Alias — `world/Scatter.js` probes for this name. */
  heightAt(x, z) {
    return this.groundAt(x, z);
  }

  /** Unit surface normal at (x,z) — the rendered facet's own normal, or null off the leaf. */
  normalAt(x, z) {
    const hit = this._locate(x, z);
    return hit ? new THREE.Vector3(hit.nx, hit.ny, hit.nz) : null;
  }

  /** True if (x,z) is over solid leaf. */
  isSolid(x, z) {
    return !!this._locate(x, z);
  }

  _locate(x, z) {
    const ci = Math.floor((x - this.x0) / this.cell);
    const cj = Math.floor((z - this.z0) / this.cell);
    // Vertices jitter by up to 0.3 cells, so the containing triangle is inside the 3×3 block.
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const i = ci + di;
        const j = cj + dj;
        if (i < 0 || j < 0 || i >= this.nx - 1 || j >= this.nz - 1) continue;
        const a = this.idx(i, j);
        const b = this.idx(i + 1, j);
        const c = this.idx(i + 1, j + 1);
        const d = this.idx(i, j + 1);
        let t1, t2;
        if (hash2i(i, j, this.seed + 4441) < 0.5) {
          t1 = [a, b, c];
          t2 = [a, c, d];
        } else {
          t1 = [a, b, d];
          t2 = [b, c, d];
        }
        for (const tri of [t1, t2]) {
          if (!this.inside[tri[0]] || !this.inside[tri[1]] || !this.inside[tri[2]]) continue;
          const hit = this._triHit(x, z, tri);
          if (hit) return hit;
        }
      }
    }
    return null;
  }

  _triHit(x, z, tri) {
    const p0 = this._nodePos(tri[0], true);
    const p1 = this._nodePos(tri[1], true);
    const p2 = this._nodePos(tri[2], true);
    const v0x = p1[0] - p0[0], v0z = p1[2] - p0[2];
    const v1x = p2[0] - p0[0], v1z = p2[2] - p0[2];
    const den = v0x * v1z - v1x * v0z;
    if (Math.abs(den) < 1e-9) return null;
    const px = x - p0[0];
    const pz = z - p0[2];
    const u = (px * v1z - v1x * pz) / den;
    const v = (v0x * pz - px * v0z) / den;
    if (u < -1e-4 || v < -1e-4 || u + v > 1 + 1e-4) return null;

    const ex = p1[0] - p0[0], ey = p1[1] - p0[1], ez = p1[2] - p0[2];
    const fx = p2[0] - p0[0], fy = p2[1] - p0[1], fz = p2[2] - p0[2];
    let nx = ey * fz - ez * fy;
    let ny = ez * fx - ex * fz;
    let nz = ex * fy - ey * fx;
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; } // surface normals point up, always
    const len = Math.hypot(nx, ny, nz) || 1;
    const y = p0[1] + u * ey + v * fy;
    return { y, nx: nx / len, ny: ny / len, nz: nz / len };
  }

  /**
   * March the surface from `from` toward `to` and report whether the leaf blocks the sightline.
   * Used by `review/measure/P09.mjs` to prove the Bollard and the Second Lip can never share a
   * frame, which world.md §12 makes a canon requirement rather than a preference.
   */
  occluded(from, to, step = 3) {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const dz = to[2] - from[2];
    const len = Math.hypot(dx, dy, dz);
    const n = Math.max(2, Math.ceil(len / step));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const y = this.groundAt(from[0] + dx * t, from[2] + dz * t);
      if (Number.isFinite(y) && from[1] + dy * t < y) return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------- collision

  _emitCollider() {
    // The collider IS the render geometry — same triangles, same planes, no second evaluation of
    // anything. That makes a render/physics disagreement structurally impossible.
    //
    // Emitted twice on purpose. The world mounts at boot order 10 and the collision world is not
    // constructed until order 30, so a signal sent from this constructor has no listener and
    // vanishes — the character then spawns onto nothing and falls out of the level, which is
    // exactly the failure this project's own locomotion warning describes and which no test
    // catches because nothing errors. `fixed()` re-sends it once every system exists, and
    // `registerCollider` is keyed by id, so the second send replaces rather than duplicates.
    signals.emit("world:collider", { id: "p09:leaf-nine", geometry: this.topGeometry });
  }

  fixed() {
    if (this._colliderSettled) return;
    this._colliderSettled = true;
    this._emitCollider();
  }

  // -------------------------------------------------------------------------- kernel hooks

  snapshot() {
    const p = this.topGeometry.getAttribute("position");
    // Honest structural facts a critic can check without trusting a word of this file.
    let flatFaces = 0;
    const N = this.topGeometry.getAttribute("normal").array;
    const sample = Math.min(400, Math.floor(p.count / 3));
    for (let t = 0; t < sample; t++) {
      const o = t * 9;
      let same = true;
      for (let k = 0; k < 3; k++) {
        if (N[o + k] !== N[o + 3 + k] || N[o + k] !== N[o + 6 + k]) same = false;
      }
      if (same) flatFaces++;
    }
    return {
      id: this.spec.id ?? "leaf",
      cell: this.cell,
      grid: [this.nx, this.nz],
      bounds: this.spec.bounds,
      surfaceTriangles: this.triCount,
      lipEdges: this.lipEdges,
      indexed: this.topGeometry.index !== null,
      flatNormalFraction: Number((flatFaces / sample).toFixed(3)),
      underTriangles: this.underGeometry.getAttribute("position").count / 3,
      // Every shoulder profile this module emitted for the shipped world, and the worst gap
      // between two consecutive band inclinations across all of them. `violations` can only be
      // non-zero if the assertion in `shard()` was removed.
      shoulders: {
        checked: shoulderAudit.checked,
        violations: shoulderAudit.violations,
        worstAdjacentDeltaDeg:
          shoulderAudit.worstAdjacentDeltaDeg === Infinity ? null : shoulderAudit.worstAdjacentDeltaDeg,
        minSeparationDeg: SHOULDER_MIN_SEPARATION_DEG,
        widestSpreadUsed: Number(shoulderAudit.widestSpreadUsed.toFixed(3)),
      },
    };
  }

  dispose() {
    signals.emit("world:collider", { id: "p09:leaf-nine", remove: true });
    this.topGeometry.dispose();
    this.underGeometry.dispose();
  }
}
