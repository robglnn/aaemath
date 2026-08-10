import * as THREE from "three";
import { publish } from "../core/Introspect.js";
import { config } from "../core/Config.js";
import { signals } from "../core/Signals.js";
import { SKY_BANDS, UNDER_HEX, SUN, hexToLinear, inverseToneMap } from "./Sky.js";

/**
 * Atmosphere — P10's depth law.
 *
 * ## Why this file exists at all
 *
 * In a detailed renderer, distance is carried by detail falloff: far things get blurrier, their
 * normal maps stop resolving, their specular breaks up. **A flat-shaded low-poly world has none of
 * that.** A cliff four hundred metres away is made of the same eight hard-edged facets as a cliff
 * four metres away and it will read as four metres away unless something else takes the job. In
 * `reference/target-lowpoly.png` that something is unmistakable: the towers of the far city sit at
 * roughly S 0.53 against a sky at S 0.50 and are lifted almost to the sky's own value — they are
 * *ghosts of themselves*, and the near rock beside them is a full-strength two-value ochre. **This
 * file is the entire difference between those two rocks.** Get it wrong and the world is a diorama.
 *
 * ## How it is applied — and why it is not an import
 *
 * A feature module may not import a sibling feature module, and P10 does not own `Materials.js`,
 * `Terrain.js` or `Scatter.js`. So the haze is installed by **replacing four of three's global
 * `ShaderChunk` entries** — `fog_pars_vertex`, `fog_vertex`, `fog_pars_fragment`, `fog_fragment` —
 * which every stock material already includes. Nothing anywhere else changes; a mesh opts in by
 * doing what it already does (`material.fog !== false`) and opts out with `fog:false`. The
 * original chunks are kept and restored on `dispose()`.
 *
 * The replacement chunks are careful about three things:
 *
 *   1. **They need a direction, not a depth.** The stock chunk carries `vFogDepth` (a scalar) and
 *      can therefore only ever lerp toward one flat colour. Ours carries the *view-space position*
 *      instead, and recovers the world direction in the fragment shader as
 *      `vpos * mat3(viewMatrix)` — the view matrix's rotation is orthonormal, so multiplying on
 *      the right is exactly multiplying by its inverse, with no `inverse()` call and no new
 *      uniform. `mvPosition` is in scope at `<fog_vertex>` in every stock vertex shader, which is
 *      what the stock chunk itself relies on.
 *   2. **They run on the far side of the tonemap.** three includes `<fog_fragment>` *after*
 *      `<tonemapping_fragment>` and `<colorspace_fragment>`, so the colour it is handed is already
 *      display-referred and already sRGB-encoded. That is not a problem, it is a gift: the haze
 *      colours can be the hexes measured straight off the target, with no round trip. `Sky.js`
 *      approaches the identical pixel from the other side by inverting ACES, so the sky beside a
 *      silhouette and the haze in front of it agree by construction rather than by tuning.
 *   3. **They carry no new uniforms.** Everything structural — the band colours, the sun bearing,
 *      the height falloff, the desaturation constant — is baked into the generated GLSL as
 *      literals. The two things that must move at runtime ride on `fogNear` and `fogFar`, which
 *      three already refreshes for every fogged material every frame and which are plain floats
 *      with no colour-space ambiguity. `scene.fog.color` is kept meaningful for anything else that
 *      reads it, but this shader deliberately does not depend on it, because three encodes it
 *      differently depending on whether a render target is bound.
 *
 * ## The law itself
 *
 *     t = (dist − near) / (far − near)
 *     h = exp(−max(worldY − H0, 0) / HSCALE)          haze is a slab, thicker low down
 *     f = 1 − exp(−t² · DENSITY · h)                  squared, so the near field stays clean
 *     colour = mix(colour, luminance(colour), DESAT · f)      chroma dies first …
 *     colour = mix(colour, skyBehind(dir), f · MAX)           … then value lifts into the sky
 *
 * Chroma dying *before* value lifts is the whole trick, and it is the order the target uses: a far
 * tower is not "the sky mixed with a rock", it is a *grey* rock mixed with the sky, which is why
 * it stays legible as a silhouette instead of turning into a coloured smear. `MAX` stops short of
 * 1 on purpose — the target's furthest towers are still a few codes darker than the sky beside
 * them, and a silhouette that reaches exactly zero contrast has stopped being a horizon question.
 *
 * ## Time of day
 *
 * `setTimeOfDay(t)` runs one long dusk, the only weather this world has (`world.md` §3, and the
 * light rig holds the key inside ±3° of elevation). It moves three things and nothing else:
 * how far you can see, how thick the air is, and how far the horizon has warmed. Rebaking the
 * GLSL recompiles fogged programs, so it is an explicit call, never a per-frame drift — the two
 * parameters that *do* move continuously ride the uniform path instead.
 */

const D2R = Math.PI / 180;

/** Distance behaviour per tier. Lower tiers get the same law with a cheaper evaluation. */
const TIER_ATMO = {
  potato: { flat: 1, near: 30, far: 220, density: 3.2, max: 0.9, desat: 0.55 },
  low: { flat: 1, near: 34, far: 300, density: 3.2, max: 0.92, desat: 0.6 },
  medium: { flat: 0, near: 38, far: 360, density: 3.0, max: 0.93, desat: 0.65 },
  high: { flat: 0, near: 42, far: 440, density: 3.0, max: 0.94, desat: 0.68 },
  ultra: { flat: 0, near: 46, far: 540, density: 3.0, max: 0.94, desat: 0.68 },
};

/**
 * The dusk band. `t` runs 0..1 and never leaves dusk; these are the ends of the range, and the
 * numbers are multipliers on the tier's distances plus a warmth pull toward the horizon colour.
 */
const TOD = {
  // t = 0: the clear end of the dusk — you can see Vantis and the Long Division is legible.
  clear: { rangeScale: 1.25, densityScale: 0.85, warmth: 0.0, lift: 0.0 },
  // t = 1: the thick end — the far leaves are barely there and the Errata is a rumour.
  thick: { rangeScale: 0.68, densityScale: 1.35, warmth: 0.35, lift: 0.06 },
};

/** World height above which the haze slab thins out, and the scale it thins on, in metres. */
const HEIGHT = { base: -40, scale: 420 };

// ---------------------------------------------------------------------------------------------
// GLSL generation
// ---------------------------------------------------------------------------------------------

const f3 = (v) => v.map((c) => c.toFixed(5)).join(", ");

/**
 * A measured display hex, expressed in whatever space the fog chunk will actually be handed.
 *
 * There are exactly two paths and they are a long way apart, which is why this function exists
 * instead of a constant:
 *
 *   * **Straight to the canvas** (`kernel.composer === null`, potato and low): three gives the
 *     material `toneMapping = renderer.toneMapping` and `outputColorSpace = SRGB`, so by the time
 *     `<fog_fragment>` runs the colour has already been through ACES and the sRGB transfer
 *     function. The measured hex *is* the number to blend toward, unchanged.
 *   * **Into the post stack's HDR target** (medium and up): `WebGLPrograms.getParameters` forces
 *     `toneMapping = NoToneMapping` and `outputColorSpace = LinearSRGB` for **any** non-null
 *     render target, so `<fog_fragment>` is handed raw scene-referred radiance and `GradePass`
 *     applies the curve later. Blending toward a display value there would wash the whole
 *     distance out. So the target colour is run back through the inverse of the same curve
 *     `Sky.js` uses, at the same exposure — which is precisely why the two files land on the same
 *     pixel from opposite sides of the tonemap.
 *
 * Getting this backwards is invisible on a low-tier capture and blows the frame out on a high-tier
 * one, which is exactly the sort of bug that ships. `report().space` says which path is live.
 */
function encodeFor(hex, space, exposure, toneMapping) {
  if (space === "scene") return inverseToneMap(hexToLinear(hex), exposure, toneMapping).rgb;
  if (space === "linear") return hexToLinear(hex);
  const n = parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Warm a colour toward the horizon band, in whatever space it is already in. */
function warmToward(rgb, horizon, k) {
  return rgb.map((c, i) => c + (horizon[i] - c) * k);
}

/**
 * Build the four replacement chunks. Everything structural is a literal, so a fogged material
 * gains exactly zero uniforms and exactly one `varying vec3`.
 */
function buildChunks(o) {
  const {
    space,
    exposure,
    toneMapping,
    sunDir,
    warmth,
    lift,
    density,
    max,
    desat,
    flat,
    heightBase,
    heightScale,
    glowWideDeg,
  } = o;

  const enc = (hex) => encodeFor(hex, space, exposure, toneMapping);
  const ceiling = space === "scene" ? 24 : 1;
  const horizon = enc(SKY_BANDS[0].hex);
  const stops = SKY_BANDS.map((b) => ({
    el: b.el * D2R,
    c: warmToward(enc(b.hex), horizon, warmth).map((c) => Math.min(ceiling, c * (1 + lift))),
  }));
  const under = warmToward(enc(UNDER_HEX), horizon, warmth);
  // The sun's pale patch, held one stop under the disc so the haze never out-shines the star.
  const sunWash = enc(SUN.hex).map((c) => Math.min(ceiling, c * 1.05));

  // The band chain, fully unrolled: no arrays, no loops, no const-array syntax that only exists
  // in GLSL ES 3.00. It is generated, so unrolling costs nothing to maintain.
  let chain = `  vec3 c = vec3(${f3(stops[0].c)});\n`;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i].el;
    const b = stops[i + 1].el;
    const mid = 0.5 * (a + b);
    const half = Math.max(1e-6, 0.5 * (b - a) * o.bandSharp);
    chain += `  c = mix(c, vec3(${f3(stops[i + 1].c)}), smoothstep(${(mid - half).toFixed(6)}, ${(
      mid + half
    ).toFixed(6)}, el));\n`;
  }

  const sky = flat
    ? `vec3 vsAtmoSky(vec3 dir) { return vec3(${f3(stops[0].c)}); }`
    : /* glsl */ `
vec3 vsAtmoSky(vec3 dir) {
  float el = asin(clamp(dir.y, -1.0, 1.0));
  if (el <= ${stops[0].el.toFixed(6)}) {
    float d = clamp((${stops[0].el.toFixed(6)} - el) / ${(50 * D2R).toFixed(6)}, 0.0, 1.0);
    return mix(vec3(${f3(stops[0].c)}), vec3(${f3(under)}), d * d * (3.0 - 2.0 * d));
  }
${chain}  // The sun wash, in the same shape Sky.js gives it, so the haze near the sun goes pale
  // instead of going orange — which is what the target does and what a rule that only knew
  // about elevation could never produce.
  float ang = acos(clamp(dot(dir, vec3(${f3(sunDir)})), -1.0, 1.0));
  c = mix(c, vec3(${f3(sunWash)}), exp(-ang / ${(glowWideDeg * D2R).toFixed(6)}) * 0.62);
  return c;
}`;

  const parsFragment = /* glsl */ `
#ifdef USE_FOG

	uniform vec3 fogColor;
	varying vec3 vVsFogView;

	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif

${sky}

	// P10's depth law. Runs in the renderer's OUTPUT space (three includes this chunk after the
	// tonemap and the colour-space transform), which is why every constant above is a measured
	// display value rather than a scene-referred one.
	vec3 vsAerial(vec3 col, vec3 vpos, float near_, float far_) {
		float dist = length(vpos);
		vec3 w = vpos * mat3(viewMatrix);            // orthonormal rotation: right-multiply = inverse
		float wy = cameraPosition.y + w.y;
		vec3 dir = normalize(w + vec3(0.0, 1e-6, 0.0));

		float hk = exp(-max(wy - (${heightBase.toFixed(2)}), 0.0) / ${heightScale.toFixed(2)});
		float t = max(dist - near_, 0.0) / max(far_ - near_, 1.0);
		float f = 1.0 - exp(-t * t * ${density.toFixed(4)} * hk);
		f = clamp(f, 0.0, 1.0) * ${max.toFixed(4)};

		// Chroma dies first, then value lifts into the sky. That order is what keeps a far
		// silhouette a silhouette instead of a coloured smear.
		float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
		col = mix(col, vec3(l), ${desat.toFixed(4)} * f);
		return mix(col, vsAtmoSky(dir), f);
	}

#endif
`;

  return {
    fog_pars_vertex: `
#ifdef USE_FOG
	varying vec3 vVsFogView;
#endif
`,
    fog_vertex: `
#ifdef USE_FOG
	vVsFogView = mvPosition.xyz;
#endif
`,
    fog_pars_fragment: parsFragment,
    fog_fragment: `
#ifdef USE_FOG
	#ifdef FOG_EXP2
		gl_FragColor.rgb = vsAerial(gl_FragColor.rgb, vVsFogView, 1.0 / max(fogDensity, 1e-5), 2.0 / max(fogDensity, 1e-5));
	#else
		gl_FragColor.rgb = vsAerial(gl_FragColor.rgb, vVsFogView, fogNear, fogFar);
	#endif
#endif
`,
  };
}

const CHUNK_KEYS = ["fog_pars_vertex", "fog_vertex", "fog_pars_fragment", "fog_fragment"];

// ---------------------------------------------------------------------------------------------

export class Atmosphere {
  constructor(kernel) {
    this.kernel = kernel;
    this.scene = kernel.scene;

    const q = new URLSearchParams(location.search);
    this.tier = TIER_ATMO[config.tier.id] ?? TIER_ATMO.high;

    this.timeOfDay = clamp01(Number(q.get("tod") ?? 0.18));
    this.densityScale = Number(q.get("haze") ?? 1);
    this.rangeScale = Number(q.get("hazeRange") ?? 1);
    this.enabled = q.get("haze") !== "0";

    this.sunDir = new THREE.Vector3(
      Math.cos(SUN.elevationDeg * D2R) * Math.sin(SUN.azimuthDeg * D2R),
      Math.sin(SUN.elevationDeg * D2R),
      Math.cos(SUN.elevationDeg * D2R) * Math.cos(SUN.azimuthDeg * D2R)
    );
    this.sunElevationDeg = SUN.elevationDeg;
    this.sunAzimuthDeg = SUN.azimuthDeg;
    this._bakedSunAzimuth = this.sunAzimuthDeg;

    this._original = {};
    for (const k of CHUNK_KEYS) this._original[k] = THREE.ShaderChunk[k];

    // The fog object is ours. Its colour is kept meaningful for anything else that reads
    // `scene.fog` (a future post pass, a minimap), but the shader above does not consume it.
    const horizon = new THREE.Color().setStyle(SKY_BANDS[0].hex, THREE.SRGBColorSpace);
    this.fog = new THREE.Fog(horizon, this.tier.near, this.tier.far);
    this.scene.fog = this.fog;

    this._bake();
    this._applyRange();

    // The rig owns the sun; adopt its bearing so the haze's pale patch sits under the same star
    // the sky's glow does. A bearing change of more than a couple of degrees rebakes.
    this._offSun = signals.on("world:sun", (p) => this._adoptSun(p));

    publish("atmosphere", () => this.report());
  }

  // -------------------------------------------------------------------------- baking

  /**
   * Everything that changes what the fog chunk is handed. When this string moves, the baked
   * constants are wrong and the chunks have to be regenerated — which is a shader recompile, so
   * it is checked once a frame and acted on only when it actually changes. In practice it moves
   * twice in a session: once when P11 sets the exposure at boot order 14, and once when P12
   * installs its composer at order 52.
   */
  _pathSignature() {
    const r = this.kernel.renderer;
    return [
      this.kernel.composer ? "hdr" : "canvas",
      r.toneMapping,
      (r.toneMappingExposure ?? 1).toFixed(4),
      r.outputColorSpace,
      this.timeOfDay.toFixed(4),
      Math.round(this.sunAzimuthDeg / 4),
    ].join("|");
  }

  _space() {
    const r = this.kernel.renderer;
    // A composer means the scene goes into a render target, and three forces NoToneMapping +
    // LinearSRGB for any render target — so the fog chunk sees scene-referred radiance.
    if (this.kernel.composer) return "scene";
    if (r.outputColorSpace === THREE.SRGBColorSpace) return "srgb";
    return "linear";
  }

  _bake() {
    const c = TOD.clear;
    const k = TOD.thick;
    const t = this.timeOfDay;
    const warmth = c.warmth + (k.warmth - c.warmth) * t;
    const lift = c.lift + (k.lift - c.lift) * t;
    const r = this.kernel.renderer;
    this.space = this._space();

    const chunks = buildChunks({
      space: this.space,
      exposure: r.toneMappingExposure ?? 1,
      toneMapping: r.toneMapping,
      sunDir: [this.sunDir.x, this.sunDir.y, this.sunDir.z],
      bandSharp: 0.45, // must match Sky.js's default, or the join is visible
      warmth,
      lift,
      density: this.tier.density,
      max: this.tier.max,
      desat: this.tier.desat,
      flat: this.tier.flat,
      heightBase: HEIGHT.base,
      heightScale: HEIGHT.scale,
      glowWideDeg: SUN.glowWideDeg,
    });

    for (const key of CHUNK_KEYS) THREE.ShaderChunk[key] = chunks[key];
    this._bakedSunAzimuth = this.sunAzimuthDeg;
    this._bakeCount = (this._bakeCount ?? 0) + 1;
    this._bakedSignature = this._pathSignature();

    // Anything already compiled has the previous chunks baked in. Materials created before this
    // point exist (Terrain mounts at order 10, two before us), so they are told to recompile.
    // This is a one-per-bake cost, not a per-frame one.
    let touched = 0;
    this.scene.traverse((o) => {
      const m = o.material;
      if (!m) return;
      for (const mat of Array.isArray(m) ? m : [m]) {
        if (mat.fog !== false) {
          mat.needsUpdate = true;
          touched++;
        }
      }
    });
    this._touchedOnBake = touched;
  }

  _applyRange() {
    const c = TOD.clear;
    const k = TOD.thick;
    const t = this.timeOfDay;
    const range = (c.rangeScale + (k.rangeScale - c.rangeScale) * t) * this.rangeScale;
    // Thicker air is expressed as a shorter distance to saturation, because `fogNear`/`fogFar`
    // are the only two channels three refreshes for us without a recompile (see the header).
    const dens = c.densityScale + (k.densityScale - c.densityScale) * t;
    const span = ((this.tier.far - this.tier.near) * range) / Math.max(0.05, dens * this.densityScale);
    this.fog.near = this.enabled ? this.tier.near * range : 1e7;
    this.fog.far = this.enabled ? this.fog.near + Math.max(20, span) : 1e7 + 1;
  }

  _adoptSun(p) {
    if (!p) return;
    const t = p.toLight;
    if (!t) return;
    const v = Array.isArray(t)
      ? new THREE.Vector3(t[0], t[1], t[2])
      : new THREE.Vector3(t.x, t.y, t.z);
    if (v.lengthSq() < 1e-6) return;
    this.sunDir.copy(v.normalize());
    this.sunElevationDeg = Number.isFinite(p.elevationDeg)
      ? p.elevationDeg
      : (Math.asin(this.sunDir.y) * 180) / Math.PI;
    this.sunAzimuthDeg = Number.isFinite(p.azimuthDeg)
      ? p.azimuthDeg
      : (Math.atan2(this.sunDir.x, this.sunDir.z) * 180) / Math.PI;
    // The bearing feeds `_pathSignature()` on a 4° detent, so the drift the rig applies over a
    // long dusk cannot turn into a recompile every frame. The haze's pale patch is 17° wide and
    // could not tell the difference anyway.
  }

  /**
   * The only per-frame work this system does: notice when the render path underneath it changed
   * and rebake. No allocation, one string compare in the common case.
   */
  frame() {
    if (this._pathSignature() !== this._bakedSignature) {
      this._bake();
      this._applyRange();
    }
  }

  // -------------------------------------------------------------------------- public API

  /**
   * One long dusk, 0 (clear) to 1 (thick). Recompiles fogged programs, so call it on a settings
   * change or a scripted beat — never from a per-frame drift.
   */
  setTimeOfDay(t) {
    this.timeOfDay = clamp01(t);
    this._bake();
    this._applyRange();
  }

  /** Multiplier on how thick the air is. Uniform-only: no recompile. */
  setDensity(scale) {
    this.densityScale = Math.max(0, Number(scale) || 0);
    this._applyRange();
  }

  /** Multiplier on how far you can see before the haze saturates. Uniform-only: no recompile. */
  setRange(scale) {
    this.rangeScale = Math.max(0.05, Number(scale) || 1);
    this._applyRange();
  }

  /** Off means `scene.fog` is pushed out past any geometry — the law is still installed. */
  setEnabled(on) {
    this.enabled = !!on;
    this._applyRange();
  }

  /**
   * The law, in JS, on the same constants the shader was generated from. `review/measure/P10.mjs`
   * uses it to predict a pixel instead of trusting this file's prose.
   */
  hazeFactor(distance, worldY) {
    const hk = Math.exp(-Math.max(worldY - HEIGHT.base, 0) / HEIGHT.scale);
    const t = Math.max(distance - this.fog.near, 0) / Math.max(this.fog.far - this.fog.near, 1);
    const f = 1 - Math.exp(-t * t * this.tier.density * hk);
    return Math.min(1, Math.max(0, f)) * this.tier.max;
  }

  // -------------------------------------------------------------------------- probe

  report() {
    return {
      installed: THREE.ShaderChunk.fog_fragment.includes("vsAerial"),
      tier: config.tier.id,
      enabled: this.enabled,
      flatFallback: !!this.tier.flat,
      // Which side of the tonemap the haze constants were baked for. "scene" means a composer is
      // installed and the chunk sees scene-referred radiance; "srgb" means straight to the canvas.
      space: this.space,
      composer: !!this.kernel.composer,
      timeOfDay: r3(this.timeOfDay),
      near: r3(this.fog.near),
      far: r3(this.fog.far),
      densityScale: r3(this.densityScale),
      rangeScale: r3(this.rangeScale),
      law: {
        density: this.tier.density,
        max: this.tier.max,
        desaturation: this.tier.desat,
        heightBase: HEIGHT.base,
        heightScale: HEIGHT.scale,
        shape: "f = 1 - exp(-t^2 * density * exp(-(y-h0)/hscale)), t = (d-near)/(far-near)",
        appliedIn: "renderer output space, after tonemap + colorspace",
      },
      sun: {
        toLight: [r4(this.sunDir.x), r4(this.sunDir.y), r4(this.sunDir.z)],
        elevationDeg: r3(this.sunElevationDeg),
        azimuthDeg: r3(this.sunAzimuthDeg),
        bakedAzimuthDeg: r3(this._bakedSunAzimuth),
      },
      // A table the measure script can check against pixels without re-deriving the maths.
      sample: [40, 120, 260, 500, 900, 1600].map((d) => ({
        distance: d,
        f: r4(this.hazeFactor(d, 0)),
      })),
      bakes: this._bakeCount ?? 0,
      materialsTouchedOnBake: this._touchedOnBake ?? 0,
    };
  }

  dispose() {
    this._offSun?.();
    for (const k of CHUNK_KEYS) THREE.ShaderChunk[k] = this._original[k];
    if (this.scene.fog === this.fog) this.scene.fog = null;
    this.scene.traverse((o) => {
      const m = o.material;
      if (!m) return;
      for (const mat of Array.isArray(m) ? m : [m]) mat.needsUpdate = true;
    });
  }
}

const clamp01 = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
const r3 = (v) => Number((Number(v) || 0).toFixed(3));
const r4 = (v) => Number((Number(v) || 0).toFixed(4));

function angleDelta(a, b) {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}
