import * as THREE from "three";
import palette from "../../../design/palette.json";
import { section } from "../core/paletteCompat.js";
import { warn } from "../core/Introspect.js";

/**
 * Materials — one material language for every surface in the world.
 *
 * Three jobs, in the order they matter:
 *
 *  1. **Shadow is a colour decision, not a multiplication.** `design/art-direction.md` §3 is the
 *     single most important section in the art bible and it is the one a PBR renderer cannot
 *     satisfy by itself: warm ochre rock (hue ~23°) lit by a blue sky fill renders a *browner*
 *     orange, not the violet-slate `rock.shadow` `#55505E` the reference measures. Over half the
 *     reference's mid-shadow pixels are cool. So the shadow end of every ramp is **authored** —
 *     the shading normal picks a shadow *family* (sky / bounce / resonance), the family rotates
 *     the hue and rescales saturation and value, and the lit→shadow blend travels the measured
 *     hue *path* (§4) instead of lerping RGB into mud.
 *
 *  2. **One factory, shared and cached.** A `MeshStandardMaterial` per mesh is the fastest way to
 *     blow the 90-program budget in `design/architecture.md`. Everything here is keyed, cached and
 *     handed out by reference; the per-frame lighting state lives in one shared uniform block that
 *     `world/Lighting.js` writes once per frame for every material at once.
 *
 *  3. **Substances, not tints.** Rock, bone, grey, certainty crystal, live resonance, plate metal,
 *     matte metal, skin, hair and foliage each get the roughness/metalness band, the specular
 *     behaviour, the detail and the rim rule §5 gives them — including the two rules §5 states as
 *     prohibitions, because they are the ones that get broken: rock never gets a Fresnel rim
 *     (anti-pattern 16) and a certainty never emits (anti-pattern 32).
 *
 * Everything scene-referred is read from `design/palette.json`, which the art bible declares the
 * only place a colour may live.
 */

// ---------------------------------------------------------------------------- palette access

const ROLE = palette.roles;

const MISSING_ROLE = 0xff00ff; // the universal "this asset is wrong" magenta
const missingRoles = new Set();

/**
 * sRGB hex from a palette role, as a number.
 *
 * An unknown role used to throw, which meant one renamed colour in `design/palette.json` took the
 * entire lighting rig — and therefore the whole look of the game — off the air. The palette is
 * owned by a different piece than this file and is re-authored independently, so that coupling is
 * guaranteed to break again. Degrade loudly instead: debug magenta is impossible to miss in a
 * capture and impossible to mistake for art direction, and the warning names the role.
 */
export function roleHex(name) {
  const r = ROLE[name];
  if (!r) {
    if (!missingRoles.has(name)) {
      missingRoles.add(name);
      warn(`Materials: palette role "${name}" no longer exists — rendering debug magenta`);
    }
    return MISSING_ROLE;
  }
  return parseInt(r.hex.slice(1), 16);
}

/** Roles this session asked for and did not find. Reviewers read this through the probe. */
export function missingRoleNames() {
  return [...missingRoles];
}

/** A THREE.Color in the renderer's linear working space, decoded from the role's sRGB hex. */
export function roleColor(name) {
  return new THREE.Color().setHex(roleHex(name), THREE.SRGBColorSpace);
}

// ---------------------------------------------------------------------------- shared uniforms

const MAX_RES = 4; // resonance sources fed to the shader
const MAX_GROUND = 4; // contact-AO occluders fed to the shader

const vec4Array = (n) => Array.from({ length: n }, () => new THREE.Vector4(0, 0, 0, 0));

/**
 * One uniform block, referenced by every material this factory makes. `world/Lighting.js` writes
 * it once per frame; nothing else may. Sharing the *objects* (not copies) is what makes a single
 * write reach four hundred meshes.
 */
export const shared = {
  uVsKeyDir: { value: new THREE.Vector3(0, 1, 0) }, // world, surface -> sun
  uVsKeyTint: { value: new THREE.Color(1, 1, 1) }, // linear: key colour x intensity / PI
  uVsSkyTint: { value: new THREE.Color(1, 1, 1) },
  uVsBounceTint: { value: new THREE.Color(1, 1, 1) },
  uVsRes: { value: vec4Array(MAX_RES) }, // xyz world position, w radius
  uVsResPower: { value: new THREE.Vector4(0, 0, 0, 0) },
  uVsGround: { value: vec4Array(MAX_GROUND) }, // xyz world position, w radius
  uVsGroundPower: { value: new THREE.Vector4(0, 0, 0, 0) },
  uVsMotion: { value: 0 }, // 0..1 camera/object movement, drives the roughness floor
  uVsTime: { value: 0 },
};

// ---------------------------------------------------------------------------- detail texture

let detailTexture = null;

/**
 * A tiling detail normal, generated in-engine. Deterministic value noise -> height -> normal by
 * central difference. §5: "subtle normal detail so surfaces are not matte plastic" — it is applied
 * triplanar on everything the player walks on, so a cliff and a floor share one texture and no
 * surface ever shows a UV seam.
 */
function makeDetailNormal(size = 128) {
  if (detailTexture) return detailTexture;

  const rand = (x, y, s) => {
    // Integer hash — deterministic across machines, which G4 requires of anything that ships.
    let h = (x * 374761393 + y * 668265263 + s * 2246822519) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const smooth = (t) => t * t * (3 - 2 * t);
  const value = (x, y, freq, seed) => {
    const fx = x * freq;
    const fy = y * freq;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = smooth(fx - ix);
    const ty = smooth(fy - iy);
    const w = (a, b, t) => a + (b - a) * t;
    const m = freq; // wrap so the tile is seamless
    const wrap = (v) => ((v % m) + m) % m;
    const a = rand(wrap(ix), wrap(iy), seed);
    const b = rand(wrap(ix + 1), wrap(iy), seed);
    const c = rand(wrap(ix), wrap(iy + 1), seed);
    const d = rand(wrap(ix + 1), wrap(iy + 1), seed);
    return w(w(a, b, tx), w(c, d, tx), ty);
  };

  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      // Three octaves: broad form, medium grain, fine tooth.
      const h =
        value(u, v, 4, 1) * 0.55 + value(u, v, 8, 2) * 0.3 + value(u, v, 16, 3) * 0.15;
      height[y * size + x] = h;
    }
  }

  const data = new Uint8Array(size * size * 4);
  const at = (x, y) => height[(((y % size) + size) % size) * size + (((x % size) + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 2.4;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 2.4;
      const nx = -dx;
      const ny = -dy;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const i = (y * size + x) * 4;
      data[i] = Math.round(((nx / len) * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round(((ny / len) * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round(((nz / len) * 0.5 + 0.5) * 255);
      data[i + 3] = 255;
    }
  }

  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.NoColorSpace; // a normal map is data, never sRGB
  tex.needsUpdate = true;
  detailTexture = tex;
  return tex;
}

// ---------------------------------------------------------------------------- GLSL

const GLSL_PARS = /* glsl */ `
varying vec3 vVsWorldPos;
varying vec3 vVsWorldNrm;

uniform vec3  uVsKeyDir;
uniform vec3  uVsKeyTint;
uniform vec3  uVsSkyTint;
uniform vec3  uVsBounceTint;
uniform vec4  uVsRes[ ${MAX_RES} ];
uniform vec4  uVsResPower;
uniform vec4  uVsGround[ ${MAX_GROUND} ];
uniform vec4  uVsGroundPower;
uniform float uVsMotion;
uniform float uVsTime;

uniform vec3  uVsSkyFamily;     // hue rotation (turns), saturation x, value x
uniform vec3  uVsBounceFamily;
uniform vec3  uVsResFamily;     // absolute hue (turns), saturation x, value x
uniform vec4  uVsRamp;          // terminator half width, hue travel sign, terminator sat dip, shadow specular
uniform vec4  uVsDetail;        // world scale, normal strength, slope tint, top-plane bias
uniform vec3  uVsSlopeTint;
uniform vec4  uVsRim;           // strength, exponent, roughness floor under motion, unused
uniform vec3  uVsRimColor;
uniform vec4  uVsLobe;          // narrow roughness, narrow intensity, N.V gate, gate feather
uniform vec3  uVsCore;          // emissive edge multiplier, core multiplier, core exponent
uniform vec2  uVsContact;       // min darkening (0..1), radius in metres

vec3 vsRgb2Hsv( vec3 c ) {
	float mx = max( c.r, max( c.g, c.b ) );
	float mn = min( c.r, min( c.g, c.b ) );
	float d = mx - mn;
	float h = 0.0;
	if ( d > 1e-7 ) {
		if ( mx == c.r ) h = mod( ( c.g - c.b ) / d, 6.0 );
		else if ( mx == c.g ) h = ( c.b - c.r ) / d + 2.0;
		else h = ( c.r - c.g ) / d + 4.0;
		h /= 6.0;
	}
	return vec3( h, mx > 1e-7 ? d / mx : 0.0, mx );
}

vec3 vsHsv2Rgb( vec3 c ) {
	float h = fract( c.x ) * 6.0;
	float f = fract( h );
	float p = c.z * ( 1.0 - c.y );
	float q = c.z * ( 1.0 - c.y * f );
	float t = c.z * ( 1.0 - c.y * ( 1.0 - f ) );
	int i = int( h );
	if ( i == 0 ) return vec3( c.z, t, p );
	if ( i == 1 ) return vec3( q, c.z, p );
	if ( i == 2 ) return vec3( p, c.z, t );
	if ( i == 3 ) return vec3( p, q, c.z );
	if ( i == 4 ) return vec3( t, p, c.z );
	return vec3( c.z, p, q );
}

// Blend two HSV colours making the hue travel in ONE named direction. art-direction.md §4:
// faceted rock travels BACKWARD through rose into violet, curved metal and skin travel FORWARD
// through olive. An RGB lerp between the two ends produces the grey midtone that reads instantly
// as "shader default", and it is the same mistake in both cases.
vec3 vsRampHsv( vec3 a, vec3 b, float t, float dir, float satDip ) {
	float d = b.x - a.x;
	if ( dir > 0.0 ) { if ( d < 0.0 ) d += 1.0; } else { if ( d > 0.0 ) d -= 1.0; }
	float h = a.x + d * t;
	float s = mix( a.y, b.y, t ) * ( 1.0 - satDip * 4.0 * t * ( 1.0 - t ) );
	float v = mix( a.z, b.z, t );
	return vec3( fract( h ), clamp( s, 0.0, 1.0 ), v );
}
`;

const GLSL_SHADOW_FN = /* glsl */ `
// The key is the ONLY shadow caster in this rig, so directional shadow slot 0 is the key's.
// (three sorts shadow-casting lights first, and packs directionalShadow* by directional index.)
float vsKeyShadow() {
	float s = 1.0;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
		DirectionalLightShadow vsDLS = directionalLightShadows[ 0 ];
		s = receiveShadow ? getShadow( directionalShadowMap[ 0 ], vsDLS.shadowMapSize, vsDLS.shadowIntensity, vsDLS.shadowBias, vsDLS.shadowRadius, vDirectionalShadowCoord[ 0 ] ) : 1.0;
	#endif
	return s;
}

float vsContactAO( vec3 wp, vec3 n ) {
	float ao = 1.0;
	#ifdef VS_CONTACT
	for ( int i = 0; i < ${MAX_GROUND}; i ++ ) {
		vec4 g = uVsGround[ i ];
		if ( g.w <= 0.0 ) continue;
		float power = ( i == 0 ) ? uVsGroundPower.x : ( i == 1 ) ? uVsGroundPower.y : ( i == 2 ) ? uVsGroundPower.z : uVsGroundPower.w;
		vec3 toG = g.xyz - wp;
		float dist = max( length( toG ) - g.w, 0.0 );
		float facing = clamp( dot( n, normalize( toG + vec3( 0.0, 1e-4, 0.0 ) ) ), 0.0, 1.0 );
		float fall = smoothstep( 0.0, uVsContact.y, dist );
		ao *= mix( 1.0 - uVsContact.x * power * facing, 1.0, fall );
	}
	#endif
	return ao;
}

float vsResonance( vec3 wp ) {
	float w = 0.0;
	#ifdef VS_GRADE
	for ( int i = 0; i < ${MAX_RES}; i ++ ) {
		vec4 e = uVsRes[ i ];
		if ( e.w <= 0.0 ) continue;
		float power = ( i == 0 ) ? uVsResPower.x : ( i == 1 ) ? uVsResPower.y : ( i == 2 ) ? uVsResPower.z : uVsResPower.w;
		w = max( w, power * ( 1.0 - smoothstep( 0.0, e.w, distance( wp, e.xyz ) ) ) );
	}
	#endif
	return clamp( w, 0.0, 1.0 );
}
`;

const GLSL_VERTEX_TAIL = /* glsl */ `
	vVsWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
	vVsWorldNrm = normalize( mat3( modelMatrix ) * objectNormal );
`;

const GLSL_DETAIL = /* glsl */ `
#ifdef VS_TRIPLANAR
	{
		vec3 bw = pow( abs( vVsWorldNrm ), vec3( 4.0 ) );
		bw /= max( bw.x + bw.y + bw.z, 1e-4 );
		float sc = uVsDetail.x;
		vec3 dxs = texture2D( uVsDetailMap, vVsWorldPos.zy * sc ).rgb * 2.0 - 1.0;
		vec3 dys = texture2D( uVsDetailMap, vVsWorldPos.xz * sc ).rgb * 2.0 - 1.0;
		vec3 dzs = texture2D( uVsDetailMap, vVsWorldPos.xy * sc ).rgb * 2.0 - 1.0;
		vec3 bump = vec3( 0.0, dxs.y, dxs.x ) * bw.x
		          + vec3( dys.x, 0.0, dys.y ) * bw.y
		          + vec3( dzs.x, dzs.y, 0.0 ) * bw.z;
		normal = normalize( normal + bump * uVsDetail.y );
	}
#endif
`;

const GLSL_SPEC_AA = /* glsl */ `
#ifdef VS_SPECAA
	{
		// Geometric specular antialiasing (§5, mandatory): widen roughness by the screen-space
		// variance of the shading normal. §4 requires rock to have a hard, geometric light/shadow
		// edge and §5 puts the hero in near-mirror plate; together those alias, and no amount of
		// TAA substitutes for fixing it at the source.
		vec3 dnx = dFdx( normal );
		vec3 dny = dFdy( normal );
		float variance = 0.5 * ( dot( dnx, dnx ) + dot( dny, dny ) );
		float kernel = min( 2.0 * variance, 0.18 );
		roughnessFactor = sqrt( clamp( roughnessFactor * roughnessFactor + kernel, 0.0, 1.0 ) );
		roughnessFactor = max( roughnessFactor, uVsRim.z * uVsMotion );
	}
#endif
`;

const GLSL_GRADE = /* glsl */ `
	{
		vec3 vsN = normalize( vVsWorldNrm );
		vec3 vsV = normalize( cameraPosition - vVsWorldPos );
		float vsNdV = clamp( dot( vsN, vsV ), 0.0, 1.0 );
		float vsShadow = vsKeyShadow();
		float vsAO = vsContactAO( vVsWorldPos, vsN );

		#ifdef VS_GRADE
			float vsNdL = dot( vsN, uVsKeyDir );
			// A hard half-width is a geometric edge (rock, §4); a wide one is a soft terminator
			// that travels through olive (skin and plate, §4).
			float vsKeyLit = smoothstep( -uVsRamp.x, uVsRamp.x, vsNdL ) * vsShadow;

			vec3 vsLitRef = diffuseColor.rgb * uVsKeyTint;
			vec3 vsHsvRef = vsRgb2Hsv( max( vsLitRef, vec3( 1e-5 ) ) );

			vec3 vsSky = vsHsv2Rgb( vec3(
				fract( vsHsvRef.x + uVsSkyFamily.x ),
				clamp( vsHsvRef.y * uVsSkyFamily.y, 0.0, 1.0 ),
				vsHsvRef.z * uVsSkyFamily.z ) ) * uVsSkyTint;
			vec3 vsBnc = vsHsv2Rgb( vec3(
				fract( vsHsvRef.x + uVsBounceFamily.x ),
				clamp( vsHsvRef.y * uVsBounceFamily.y, 0.0, 1.0 ),
				vsHsvRef.z * uVsBounceFamily.z ) ) * uVsBounceTint;
			vec3 vsRes = vsHsv2Rgb( vec3(
				uVsResFamily.x,
				clamp( max( vsHsvRef.y, 0.45 ) * uVsResFamily.y, 0.0, 1.0 ),
				vsHsvRef.z * uVsResFamily.z ) );

			// Family by SITUATION, not by material (§3). A surface with open sky above it takes the
			// violet sky family; one turned down toward lit rock takes the warm bounce family; and
			// anything close to a live emitter is pulled to teal. The resonance weight is a smooth
			// function of distance, so a player walking past a socket never sees a family switch.
			float vsSkyness = clamp( vsN.y * 0.5 + 0.5 + uVsDetail.w, 0.0, 1.0 );
			float vsResW = vsResonance( vVsWorldPos );
			vec3 vsShadowRgb = mix( mix( vsBnc, vsSky, vsSkyness ), vsRes, vsResW );

			vec3 vsHsvShadow = vsRgb2Hsv( max( vsShadowRgb, vec3( 1e-5 ) ) );
			vec3 vsHsvLit = vsRgb2Hsv( max( totalDiffuse, vec3( 1e-5 ) ) );
			totalDiffuse = vsHsv2Rgb( vsRampHsv( vsHsvShadow, vsHsvLit, vsKeyLit, uVsRamp.y, uVsRamp.z ) );
			totalSpecular *= mix( uVsRamp.w, 1.0, vsKeyLit );
		#else
			float vsKeyLit = vsShadow;
		#endif

		#ifdef VS_TWOLOBE
			{
				// §5's narrow champagne streak: a second, much tighter lobe gated to grazing view
				// angles (N.V < gate, feathered) so the hot line lands on the silhouette rather
				// than as a blob in the middle of a panel.
				vec3 vsH = normalize( vsV + uVsKeyDir );
				float vsNdH = clamp( dot( vsN, vsH ), 0.0, 1.0 );
				float a = max( uVsLobe.x * uVsLobe.x, mix( 0.0, 0.1225, uVsMotion ) );
				float a2 = a * a;
				float den = vsNdH * vsNdH * ( a2 - 1.0 ) + 1.0;
				float D = a2 / max( 3.141592653589793 * den * den, 1e-4 );
				float gate = 1.0 - smoothstep( uVsLobe.z - uVsLobe.w, uVsLobe.z + uVsLobe.w, vsNdV );
				totalSpecular += uVsKeyTint * diffuseColor.rgb * D * uVsLobe.y * gate * vsKeyLit * 0.05;
			}
		#endif

		#ifdef VS_RIM
			totalSpecular += uVsRimColor * pow( 1.0 - vsNdV, uVsRim.y ) * uVsRim.x;
		#endif

		#ifdef VS_CORE
			// Every emitter has a blown white core and a cooler edge (§5). Driving it off N.V makes
			// the core a small connected component instead of a flat emissive field, whatever the
			// geometry is.
			totalEmissiveRadiance *= mix( uVsCore.x, uVsCore.y, pow( vsNdV, uVsCore.z ) );
		#endif

		outgoingLight = ( totalDiffuse + totalSpecular ) * vsAO + totalEmissiveRadiance;
	}
`;

// ---------------------------------------------------------------------------- archetypes

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const V4 = (x, y, z, w) => new THREE.Vector4(x, y, z, w);

/**
 * The measured shadow families, expressed in the LINEAR HSV the shader works in.
 *
 * `design/art-direction.md` §3 quotes hue/saturation/value multipliers off the finished 8-bit
 * frame. Those are display-referred and cannot be typed into a shader — this file's own warning.
 * The triplets below are the same three families re-derived from the *linear* decode of the
 * reference's measured lit/shadow pairs, which is the side of the tonemap the shader lives on:
 *
 *   sky      #FFC87F -> #574F5C   hue +0.667 turns, sat x0.36, value x0.112
 *   bounce   #B47251 -> #68554D   hue +0.010 turns, sat x0.58, value x0.303
 *   resonance                     hue pinned to 0.505 (182 deg), sat x0.62, value x0.13
 *
 * The display-referred numbers are what has to come *out*; `review/measure/P11.mjs` measures them
 * on a real capture (`X1`, `K1`) rather than trusting the arithmetic.
 */
const FAMILY = {
  sky: V3(0.667, 0.36, 0.112),
  bounce: V3(0.01, 0.58, 0.303),
  resonance: V3(0.505, 0.62, 0.13),
  // Skin keeps its hue and loses only a fifth of its saturation (2.4:1 against rock's 6.2:1).
  skinSky: V3(-0.017, 1.03, 0.483),
  skinBounce: V3(0.0, 1.0, 0.62),
  // Plate metal's shadow is teal — the hero stands in resonance light (`hero.undersuit`).
  metalSky: V3(0.453, 0.579, 0.0736),
  metalBounce: V3(0.2, 0.62, 0.2),
  // Grey is the one material that does NOT rotate: a violet shadow turns it back into rock (§0.2).
  greySky: V3(0.0, 0.84, 0.34),
  greyBounce: V3(0.0, 0.84, 0.42),
};

// Read through the compat seam: the palette is owned by the art-direction piece and its shape
// changes between revisions. See app/src/core/paletteCompat.js.
const MATERIALS = section(palette, "materials");
const CONTACT = MATERIALS.contactAO;

/**
 * Every substance in the world, with the bands `design/art-direction.md` §5 gives it.
 * `defines` decide the shader variant and therefore the program; two archetypes with the same
 * define set share one program and differ only by uniform values.
 */
const ARCHETYPES = {
  rock: {
    color: "rock.albedo",
    roughness: 0.87, // §5: 0.82-0.92
    metalness: 0,
    grade: { sky: FAMILY.sky, bounce: FAMILY.bounce, ramp: V4(0.035, 1, 0, 0.12) },
    detail: V4(0.55, 0.75, 0, 0.05),
    triplanar: true,
    specAA: true,
    contact: true,
    slopeTint: "rock.warm.mid",
  },
  boneStone: {
    color: "rock.bone",
    roughness: 0.78, // §5: 0.70-0.85
    metalness: 0,
    grade: { sky: FAMILY.sky, bounce: FAMILY.bounce, ramp: V4(0.05, 1, 0, 0.14) },
    detail: V4(0.9, 0.55, 0, 0.0),
    triplanar: true,
    specAA: true,
    contact: true,
    slopeTint: "rock.bone",
  },
  grey: {
    color: "world.grey",
    roughness: 0.92, // §5: 0.88-0.95, and nothing bright on it anywhere
    metalness: 0,
    grade: { sky: FAMILY.greySky, bounce: FAMILY.greyBounce, ramp: V4(0.09, -1, 0, 0.02) },
    detail: V4(1.1, 0.45, 0, 0.0),
    triplanar: true,
    specAA: false,
    contact: true,
    slopeTint: "world.grey",
  },
  certainty: {
    color: "certainty.facet",
    roughness: 0.1, // §5: 0.06-0.14 — the highest specular density in the world
    metalness: 0,
    grade: { sky: FAMILY.resonance, bounce: FAMILY.resonance, ramp: V4(0.06, -1, 0, 0.85) },
    specAA: true,
    contact: true,
    rim: { color: "certainty.rim", strength: 0.34, exponent: 4 },
    envMapIntensity: 1.25,
    // NEVER emissive, never bloomed, peak Y <= 0.72 (§0.3, anti-pattern 32).
  },
  resonanceLive: {
    color: "resonance.deep",
    roughness: 0.16, // §5: 0.10-0.20
    metalness: 0,
    emissive: "resonance.core",
    emissiveIntensity: 7.5,
    core: V3(0.22, 1.0, 3.0),
    rim: { color: "resonance.bloom", strength: 0.5, exponent: 3 },
    specAA: true,
    grade: null, // an unlit emitter is not graded; the light is the surface
    envMapIntensity: 0.6,
    bloom: true,
  },
  resonanceFlow: {
    color: "resonance.flow",
    roughness: 0.22,
    metalness: 0,
    emissive: "resonance.flow",
    emissiveIntensity: 1.6,
    core: V3(0.6, 1.0, 2.0),
    specAA: true,
    grade: null,
    envMapIntensity: 0.5,
    bloom: true,
  },
  plateMetal: {
    color: "hero.armour",
    roughness: 0.36, // §5: 0.22-0.38, floor 0.35 under motion — satisfied by construction
    metalness: 0.95, // §5: 0.90-1.0 — REQUIRES an environment map (anti-pattern 18)
    grade: { sky: FAMILY.metalSky, bounce: FAMILY.metalBounce, ramp: V4(0.42, -1, 0.24, 0.2) },
    twoLobe: V4(
      MATERIALS.plateMetal.specularTwoLobe.narrow.roughness,
      MATERIALS.plateMetal.specularTwoLobe.narrow.intensity,
      0.35,
      MATERIALS.plateMetal.specularTwoLobe.narrow.gateFeatherWidth
    ),
    rim: { color: "sky.sun", strength: 0.12, exponent: 4 },
    roughFloor: MATERIALS.plateMetal.roughnessFloorUnderMotion,
    specAA: true,
    contact: true,
    envMapIntensity: 1.4,
  },
  matteMetal: {
    color: "hero.undersuit",
    roughness: 0.52, // §5: 0.45-0.60
    metalness: 0.7, // §5: 0.60-0.80
    grade: { sky: FAMILY.metalSky, bounce: FAMILY.metalBounce, ramp: V4(0.38, -1, 0.15, 0.25) },
    rim: { color: "sky.sun", strength: 0.05, exponent: 5 },
    specAA: true,
    contact: true,
    envMapIntensity: 0.9,
  },
  skin: {
    color: "hero.skin",
    roughness: 0.5, // §5: 0.45-0.55
    metalness: 0,
    grade: { sky: FAMILY.skinSky, bounce: FAMILY.skinBounce, ramp: V4(0.45, -1, 0.1, 0.45) },
    rim: { color: "hero.skin", strength: 0.1, exponent: 4 },
    contact: true,
  },
  hair: {
    color: "hero.hair",
    roughness: 0.42, // §5: 0.35-0.50
    metalness: 0,
    grade: { sky: FAMILY.skinSky, bounce: FAMILY.skinBounce, ramp: V4(0.4, -1, 0.1, 0.4) },
    rim: { color: "sky.sun", strength: 0.22, exponent: 3 },
    contact: true,
  },
  foliage: {
    color: "world.foliage",
    roughness: 0.82, // §5: 0.70-0.90
    metalness: 0,
    grade: { sky: FAMILY.sky, bounce: FAMILY.bounce, ramp: V4(0.3, -1, 0, 0.1) },
    contact: true,
    side: THREE.DoubleSide,
  },
};

// ---------------------------------------------------------------------------- factory

class MaterialFactory {
  constructor() {
    this.cache = new Map();
    this.built = 0;
    this.hits = 0;
    this.env = null;
    this.detail = null;
    this._motionTarget = 0;
  }

  /** Called by Lighting once the environment probe exists. */
  setEnvironment(texture) {
    this.env = texture;
    for (const m of this.cache.values()) {
      m.envMap = null; // scene.environment supplies it; keep per-material override off
      m.needsUpdate = false;
    }
  }

  /**
   * Get a shared material. Identical (name, overrides) always returns the SAME instance — a new
   * material per mesh is the fastest way to blow the program budget, and it is the thing this
   * factory exists to make impossible.
   */
  get(name, overrides = null) {
    const spec = ARCHETYPES[name];
    if (!spec) throw new Error(`Materials: unknown archetype "${name}"`);
    const key = overrides ? `${name}|${stableKey(overrides)}` : name;
    const hit = this.cache.get(key);
    if (hit) {
      this.hits++;
      return hit;
    }
    const mat = this._build(name, spec, overrides);
    mat.userData.vsKey = key;
    this.cache.set(key, mat);
    this.built++;
    return mat;
  }

  _build(name, spec, overrides) {
    const o = overrides || {};
    const mat = new THREE.MeshStandardMaterial({
      color: o.color ? new THREE.Color().setHex(o.color, THREE.SRGBColorSpace) : roleColor(spec.color),
      roughness: o.roughness ?? spec.roughness,
      metalness: o.metalness ?? spec.metalness,
      side: o.side ?? spec.side ?? THREE.FrontSide,
      flatShading: o.flatShading ?? false,
      transparent: o.transparent ?? false,
      opacity: o.opacity ?? 1,
      dithering: true,
    });
    mat.name = `vs.${name}`;
    if (spec.emissive) {
      mat.emissive = roleColor(o.emissive ?? spec.emissive);
      mat.emissiveIntensity = o.emissiveIntensity ?? spec.emissiveIntensity;
    }
    mat.envMapIntensity = o.envMapIntensity ?? spec.envMapIntensity ?? 1;

    const defines = {};
    if (spec.grade) defines.VS_GRADE = "";
    if (spec.triplanar) defines.VS_TRIPLANAR = "";
    if (spec.specAA) defines.VS_SPECAA = "";
    if (spec.contact) defines.VS_CONTACT = "";
    if (spec.twoLobe) defines.VS_TWOLOBE = "";
    if (spec.rim) defines.VS_RIM = "";
    if (spec.core) defines.VS_CORE = "";
    mat.defines = defines;

    const detailMap = spec.triplanar ? makeDetailNormal() : null;
    if (detailMap) this.detail = detailMap;

    const local = {
      uVsSkyFamily: { value: (spec.grade?.sky ?? FAMILY.sky).clone() },
      uVsBounceFamily: { value: (spec.grade?.bounce ?? FAMILY.bounce).clone() },
      uVsResFamily: { value: FAMILY.resonance.clone() },
      uVsRamp: { value: (spec.grade?.ramp ?? V4(0.1, 1, 0, 0.2)).clone() },
      uVsDetail: { value: (spec.detail ?? V4(1, 0, 0, 0)).clone() },
      uVsSlopeTint: { value: roleColor(spec.slopeTint ?? spec.color) },
      uVsRim: {
        value: V4(spec.rim?.strength ?? 0, spec.rim?.exponent ?? 3, spec.roughFloor ?? 0, 0),
      },
      uVsRimColor: { value: roleColor(spec.rim?.color ?? "sky.sun") },
      uVsLobe: { value: (spec.twoLobe ?? V4(0.12, 0, 0.35, 0.1)).clone() },
      uVsCore: { value: (spec.core ?? V3(1, 1, 1)).clone() },
      uVsContact: { value: new THREE.Vector2(CONTACT.minDarkening, CONTACT.radiusMetres) },
      uVsDetailMap: { value: detailMap },
    };
    mat.userData.vsUniforms = local;
    mat.userData.vsEmissive = !!spec.bloom; // P12's bloom mask reads this, never a luminance threshold
    mat.userData.vsArchetype = name;

    mat.onBeforeCompile = (shaderObj) => {
      Object.assign(shaderObj.uniforms, shared, local);

      shaderObj.vertexShader = shaderObj.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying vec3 vVsWorldPos;\nvarying vec3 vVsWorldNrm;"
        )
        .replace("#include <project_vertex>", "#include <project_vertex>\n" + GLSL_VERTEX_TAIL);

      let fs = shaderObj.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\n" +
            (detailMap ? "uniform sampler2D uVsDetailMap;\n" : "") +
            GLSL_PARS
        )
        .replace("void main() {", GLSL_SHADOW_FN + "\nvoid main() {")
        .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\n" + GLSL_DETAIL)
        .replace("#include <lights_physical_fragment>", GLSL_SPEC_AA + "\n#include <lights_physical_fragment>")
        .replace("#include <opaque_fragment>", GLSL_GRADE + "\n#include <opaque_fragment>");
      shaderObj.fragmentShader = fs;
    };

    // Two materials share a program iff they share a define set. Without this the renderer keys
    // only on the parameters it knows about and would happily hand a graded material somebody
    // else's compiled shader.
    const cacheKey = `vs:${Object.keys(defines).sort().join(",")}:${detailMap ? "d" : "-"}`;
    mat.customProgramCacheKey = () => cacheKey;
    return mat;
  }

  // Convenience, so call sites read as substances rather than as strings.
  rock(o) { return this.get("rock", o); }
  boneStone(o) { return this.get("boneStone", o); }
  grey(o) { return this.get("grey", o); }
  certainty(o) { return this.get("certainty", o); }
  resonance(o) { return this.get("resonanceLive", o); }
  carry(o) { return this.get("resonanceFlow", o); }
  plate(o) { return this.get("plateMetal", o); }
  matteMetal(o) { return this.get("matteMetal", o); }
  skin(o) { return this.get("skin", o); }
  hair(o) { return this.get("hair", o); }
  foliage(o) { return this.get("foliage", o); }

  stats() {
    const byProgram = new Set();
    for (const m of this.cache.values()) byProgram.add(m.customProgramCacheKey());
    return {
      instances: this.cache.size,
      built: this.built,
      cacheHits: this.hits,
      variants: byProgram.size,
      archetypes: Object.keys(ARCHETYPES).length,
      keys: [...this.cache.keys()].sort(),
    };
  }

  /**
   * The reviewer contract for this piece: one object of every substance, at one scale, on one
   * ground slab, lit by the real rig. `review/measure/P11.mjs` builds this and measures whether
   * rock, crystal and metal read as three different substances instead of three tints.
   *
   * Not used by the game. Nothing calls it unless a reviewer does.
   */
  sampleBoard({ spacing = 2.6, radius = 0.85 } = {}) {
    const group = new THREE.Group();
    group.name = "vs.materialBoard";

    const slab = new THREE.Mesh(new THREE.BoxGeometry(spacing * 8, 0.9, 5.2), this.rock());
    slab.position.y = -0.45 - radius;
    slab.receiveShadow = true;
    slab.castShadow = true;
    group.add(slab);

    const faceted = new THREE.IcosahedronGeometry(radius, 1);
    const smooth = new THREE.SphereGeometry(radius, 32, 24);
    const crystal = new THREE.OctahedronGeometry(radius * 1.05, 0);

    const entries = [
      ["rock", this.rock(), faceted],
      ["boneStone", this.boneStone(), faceted],
      ["grey", this.grey(), faceted],
      ["certainty", this.certainty(), crystal],
      ["resonanceLive", this.resonance(), crystal],
      ["plateMetal", this.plate(), smooth],
      ["matteMetal", this.matteMetal(), smooth],
      ["skin", this.skin(), smooth],
      ["foliage", this.foliage(), smooth],
    ];

    const n = entries.length;
    group.userData.samples = [];
    entries.forEach(([name, material, geo], i) => {
      const mesh = new THREE.Mesh(geo, material);
      mesh.position.set((i - (n - 1) / 2) * spacing, 0, 0);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `vs.sample.${name}`;
      group.add(mesh);
      group.userData.samples.push({ name, x: mesh.position.x, radius });
    });
    return group;
  }

  dispose() {
    for (const m of this.cache.values()) m.dispose();
    this.cache.clear();
    detailTexture?.dispose();
    detailTexture = null;
  }
}

function stableKey(o) {
  return Object.keys(o)
    .sort()
    .map((k) => `${k}=${typeof o[k] === "number" ? o[k].toFixed(4) : String(o[k])}`)
    .join(",");
}

export const materials = new MaterialFactory();
export { ARCHETYPES, FAMILY, MAX_RES, MAX_GROUND };
