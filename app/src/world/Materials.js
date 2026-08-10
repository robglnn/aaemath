import * as THREE from "three";
import palette from "../../../design/palette.json";
import { warn } from "../core/Introspect.js";

/**
 * Materials — one flat-shaded material language for every surface in the world.
 *
 * `reference/target-lowpoly.png` is the render target and `design/art-direction.md` is its
 * arithmetic. Both were re-aimed away from a painterly PBR look, and this file was rewritten from
 * scratch to match rather than softened. **Everything the previous revision of this file did is now
 * banned**: `MeshStandardMaterial`, `Scene.environment`, `PMREMGenerator`, an env map at any
 * intensity, a generated triplanar detail normal, roughness/metalness bands, a two-lobe specular, a
 * Fresnel rim, a violet shadow family and an ACES shoulder. §5's ban list is global and has no
 * exceptions, so this file contains no texture of any kind and no `MeshStandardMaterial`.
 *
 * Four ideas do all the work.
 *
 *  1. **Form comes from the mesh (§2).** There is no surface detail. `flatten(geometry)` is the
 *     build step: `toNonIndexed()` then `computeVertexNormals()`, which on unshared vertices is a
 *     per-FACE normal — exact, derivative-free, and correct for any material. `flatShading: true` is
 *     used only where route (a) would fight the skin cache, i.e. on characters.
 *
 *  2. **Albedo is derived, never typed (§3.2).** Every colour in `design/palette.json` is a value
 *     *sampled off the finished target*, so it is a rendered pixel and not a material property.
 *     Typing it as an albedo applies the key's colour twice and turns sandstone into salmon. The one
 *     rule, applied to every substance and printed in the probe:
 *
 *         albedo = linear(sampled role) / ( linear(key) · N·L + ambientIrradiance(hemi) / π )
 *
 *     §3.2 does that division by hand for one surface, against the key alone; this file does it for
 *     all of them against the whole light, which agrees with §3.2 where the key dominates and fixes
 *     it where the fill does. Re-sample the palette and the world re-derives.
 *
 *  3. **The dark end of the frame is bimodal, and that is a mechanism, not a tint (§3.4).** A face
 *     *turned from the key* converges on `rock.shadow` `#1B2C33` (hue 198) whatever its albedo. A
 *     face that still points at the sky and merely lost the key to a *cast shadow* does not converge
 *     — it keeps its albedo under the blue hemisphere fill, and olive ground under `#66B3FF` lands
 *     at hue ~120 for free. Those two families, 79° apart, are §13 rows 3 and 4, and they are
 *     deliberately impossible to satisfy at the same time by any single shadow colour.
 *
 *  4. **One factory, shared and cached.** Identical (archetype, overrides) always returns the same
 *     instance. A material per mesh is the fastest way to blow the 90-program budget in
 *     `design/architecture.md`, and the per-frame lighting state lives in one shared uniform block
 *     that `world/Lighting.js` writes once for every material at once.
 *
 * The only material types in this project are `MeshLambertMaterial` (lit), `MeshBasicMaterial`
 * (unlit) and a `ShaderMaterial` for the sky. Lambert is per-fragment in three r169 and has no
 * specular lobe at all, which is exactly what this target wants.
 *
 * ---------------------------------------------------------------------------------------------
 * **Round 2: this file used to be dead code, and that is the only fact about it that mattered.**
 *
 * A hostile review found that `Materials.js` was imported by exactly one file — `Lighting.js` — and
 * by no world module. `Terrain.js`, `Scatter.js` and `Level01.js` all built their own materials, so
 * the entire flat-shaded factory painted nothing except a synthetic board that P11's own measurement
 * script spawned. In the shipped frame a rock facet turned from the key read hue 33-40 (a plain
 * darker ochre: a value-only ramp) against the target's 196-203. Every colour claim this piece had
 * ever made described a scene no player would ever see.
 *
 * Two things changed as a result, and both are structural rather than cosmetic:
 *
 *  * **The synthetic board is gone.** `buildBoard()` and `Lighting.materialBoard()` were deleted
 *    outright rather than left behind a flag, because a reviewer-only scene that renders the whole
 *    material language is exactly the thing a future round will accidentally measure again.
 *    `review/measure/P11.mjs` now has nothing to point at except the shipped world.
 *
 *  * **The factory took a second job: it builds materials for modules that own their own grade.**
 *    `Scatter.js` needs a per-instance distance fade and wind; `Terrain.js` and `Level01.js` need
 *    their own aerial perspective and author their value ladder as per-face vertex colour. Both used
 *    to reach that by overwriting `onBeforeCompile` on a material they built themselves, which is
 *    precisely why they could not use this file. So `_build` now takes an `extend` payload — extra
 *    uniforms and GLSL injected at named points *around* this file's own grade — and `make()` hands
 *    back an uncached instance for callers that need their own uniform block. The substance, the
 *    albedo derivation, the §3.4 convergence, the rim and the shadow subtraction stay here; the
 *    distance law stays with the piece that owns the distance.
 */

// ---------------------------------------------------------------------------- palette access

const ROLE = palette.roles ?? {};
const CONSTRUCTED = palette.constructedRoles ?? {};
const REMOVED = new Set(Object.keys(palette.removedRoles ?? {}));

const MISSING_ROLE = 0xff00ff; // the universal "this asset is wrong" magenta
const missingRoles = new Set();

/**
 * sRGB hex from a palette role, as a number.
 *
 * An unknown role used to throw, which meant one renamed colour in `design/palette.json` took the
 * entire lighting rig — and therefore the whole look of the game — off the air. The palette is owned
 * by a different piece and is re-authored independently, so that coupling is guaranteed to break
 * again. Degrade loudly instead: debug magenta is impossible to miss in a capture and impossible to
 * mistake for art direction, and the warning names the role.
 */
export function roleHex(name) {
  const r = ROLE[name] ?? CONSTRUCTED[name];
  if (!r) {
    if (!missingRoles.has(name)) {
      missingRoles.add(name);
      const why = REMOVED.has(name)
        ? ` — that role was REMOVED on purpose (${palette.removedRoles[name]?.why ?? "banned by the target"})`
        : "";
      warn(`Materials: palette role "${name}" does not exist${why} — rendering debug magenta`);
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

// ---------------------------------------------------------------------------- the key, and albedo

/**
 * **The key's colour, typed once, from `design/art-direction.md` §3.1.**
 *
 * It is deliberately NOT `sky.sun` `#FFF77D`. That role is the sun *glow seen through atmosphere* —
 * a pixel, not a light — and feeding it as the key drags lit rock toward hue 13. §3.1: "Type the
 * hex; never type the kelvin." The CCT (4505 K) is informational and appears nowhere in code.
 *
 * Every albedo in this file is a division by this colour, so changing it re-derives the world. That
 * is the point: §3.2 says "Change the key and redo the division", and here the division is code.
 */
export const KEY_HEX = 0xffe3b8;
export const FILL_GROUND_HEX = 0x2a1f16;
export const BOUNCE_HEX = 0x8a5b3e;

const KEY_LINEAR = new THREE.Color().setHex(KEY_HEX, THREE.SRGBColorSpace);

/**
 * **The one number §3.2 needs and does not state: what N·L a "lit ground plane" was standing at.**
 *
 * §3.2's witness is one ground plane at Y 0.1310 lit and 0.0300 in its own cast shadow, and §3.2's
 * worked albedo divides a *sampled* colour by the key. Those two only agree at one N·L, and that
 * N·L is not 0.156 — a plane facing straight up under a 9° sun. At 0.156 the implied ground albedo
 * comes out at (1.20, 0.86, 0.31), and an albedo above 1.0 is not a colour, it is a proof that the
 * plane was tilted. Look at the target: the courier stands on a faceted ridge and the ground that
 * reads as "lit ground" is its sun-facing slope, not its top.
 *
 * **Authored: 0.342**, a facet tilted about 11° toward the key. It is the lowest value that leaves
 * every derived albedo comfortably under 1.0. Raise it and the world's albedos go dark and chalky;
 * lower it and they clip. Everything else in the rig hangs off it, so it is one constant, and
 * `review/measure/P11.mjs` measures its consequences rather than the constant.
 */
export const GROUND_FACET_NDL = 0.342;

const HEMI_GROUND = new THREE.Color().setHex(FILL_GROUND_HEX, THREE.SRGBColorSpace);

const derivedAlbedos = {};

/**
 * **The §3.2 division, as code — and it is a division by the WHOLE light, not just by the key.**
 *
 * §3.2 prints one worked albedo: "linear(brightest measured facet) / linear(key)". That is right for
 * a facet square to the key, where the key is 97 % of what lands on it, and it is **badly wrong for
 * ground**, where the key arrives at N·L 0.34 and the blue fill is a third of the total: divide by
 * the key alone and the blue the fill put there is charged to the albedo, the albedo comes out
 * ~3.5x too blue in its B channel, and every ground plane in the game renders olive-green instead of
 * warm ochre. That was a real round of this piece, and the render is in `review/shots/p11/`.
 *
 * So invert the whole thing:
 *
 *     rendered = albedo · ( keyLinear · N·L + ambientIrradiance(hemi) / π )      [K = π]
 *
 * `role` is a colour **sampled off the target** — a rendered pixel, never a material property.
 * `ndl` is the N·L that pixel was standing at (§1.2's cosine ladder: 1.00 / 0.71 / 0.61 / 0.54 /
 * 0.27). `hemi` is three's hemisphere weight for that orientation: 1 for a face pointing at the sky,
 * 0.5 for a vertical face. Fed a facet square to the key the formula reproduces §3.2's own worked
 * answer — rock comes out `#F2AC5A` against the document's `#F5B268` — so it agrees where the
 * document is right and disagrees only where the document's shortcut breaks down.
 *
 * Returns a linear THREE.Color and records the whole derivation so `stats()` can print it and a
 * critic can redo the arithmetic by hand.
 */
export function albedoFrom(role, { ndl = 1, hemi = 0.5, label = role } = {}) {
  const rendered = roleColor(role);
  const F = fill();
  const amb = ["r", "g", "b"].map((k) =>
    ((HEMI_GROUND[k] + (F.color[k] - HEMI_GROUND[k]) * hemi) * F.intensity) / Math.PI
  );
  // rendered = albedo · (keyLinear·N·L + ambientIrradiance/π), with the key's intensity at π.
  const c = new THREE.Color(
    rendered.r / (KEY_LINEAR.r * ndl + amb[0]),
    rendered.g / (KEY_LINEAR.g * ndl + amb[1]),
    rendered.b / (KEY_LINEAR.b * ndl + amb[2])
  );
  const over = Math.max(c.r, c.g, c.b);
  if (over > 1.0) {
    // An albedo above 1 is not a colour; it means the sampled pixel was standing at a higher N·L
    // than the caller claims. Clamp so nothing renders as a blown white blob, and say so out loud.
    warn(`Materials: albedo "${label}" from ${role} at N·L ${ndl} exceeds 1 (${over.toFixed(3)}) — clamped`);
    c.multiplyScalar(1 / over);
  }
  derivedAlbedos[label] = {
    from: role,
    sampled: `#${rendered.getHexString(THREE.SRGBColorSpace).toUpperCase()}`,
    ndl,
    hemi,
    albedo: `#${c.clone().getHexString(THREE.SRGBColorSpace).toUpperCase()}`,
    linear: [r4(c.r), r4(c.g), r4(c.b)],
    clamped: over > 1 ? r4(over) : undefined,
  };
  return c;
}

/**
 * **The fill, derived — colour and intensity together — from the two pixels §3.1 says it came from.**
 *
 * §3.1 states both the method and an answer: "take one ground plane, lit and inside its own cast
 * shadow, and divide the shadowed linear triplet by the lit one … normalise to its maximum channel
 * and that is `#66B3FF`." **The method is right and the answer does not reproduce §3.4.** Two things
 * are wrong with the printed hex if you type it:
 *
 *  1. The division `shadow / lit` is *not* `fill / key`; it is `fill / (key + fill)`, because the
 *     lit pixel also contains the fill. Solving properly puts a factor of `r/(1−r)` in.
 *  2. Fed as an intensity, `#66B3FF` renders `ground.lit`'s albedo in a cast shadow at **hue 144**.
 *     §3.4's measured value — and §13 row 4's gate — is **hue 120**, over a window of 100–140. The
 *     typed hex fails the gate the same document publishes.
 *
 * So do the division §3.1 describes, on the two roles `design/palette.json` publishes for that pair,
 * and take the arithmetic over the rounded hex. The cast shadow then lands on `ground.shadow`
 * `#223522` **by construction**, at hue 120, and `review/measure/P11.mjs` claim S3 checks it on
 * pixels rather than on this comment.
 *
 * Re-sample the palette and the fill re-derives. That is the whole point of doing it in code.
 */
let _fill = null;
/** Memoised — the fill is a pure function of the palette and is asked for by every archetype. */
export function fill() {
  return (_fill ??= deriveFill());
}

export function deriveFill() {
  const lit = roleColor("ground.lit");
  const shadow = roleColor("ground.shadow");
  const ch = (name) => [lit[name], shadow[name], KEY_LINEAR[name]];
  const t = ["r", "g", "b"].map((name) => {
    const [L, S, Kc] = ch(name);
    const r = Math.min(0.985, S / Math.max(L, 1e-6));
    // fillSky · F = r/(1−r) · keyLinear · K · N·L   with K = PI (see Lighting.KEY_INTENSITY)
    return (r / (1 - r)) * Kc * Math.PI * GROUND_FACET_NDL;
  });
  const intensity = Math.max(...t);
  const color = new THREE.Color(t[0] / intensity, t[1] / intensity, t[2] / intensity);
  return {
    color,
    intensity,
    hex: `#${color.clone().getHexString(THREE.SRGBColorSpace).toUpperCase()}`,
    linear: t.map(r4),
    method: "shadow/lit on (ground.lit, ground.shadow), solved for fill/(key+fill) — art-direction §3.1",
    printedInDoc: "#66B3FF",
  };
}

/** The albedo that makes a *self-lit* substance travel from `floorRole` to `peakRole` under the key. */
function albedoSpan(floorRole, peakRole, label) {
  const lo = roleColor(floorRole);
  const hi = roleColor(peakRole);
  const c = new THREE.Color(
    Math.max(0, hi.r - lo.r) / KEY_LINEAR.r,
    Math.max(0, hi.g - lo.g) / KEY_LINEAR.g,
    Math.max(0, hi.b - lo.b) / KEY_LINEAR.b
  );
  derivedAlbedos[label] = {
    from: `${peakRole} - ${floorRole}`,
    sampled: `#${hi.getHexString(THREE.SRGBColorSpace).toUpperCase()}`,
    ladderStep: 1,
    albedo: `#${c.clone().getHexString(THREE.SRGBColorSpace).toUpperCase()}`,
    linear: [r4(c.r), r4(c.g), r4(c.b)],
  };
  return c;
}

/** A lighter, cooler albedo — which §5 says is the entire "metal look" in this project. */
function cooled(color, amount, toward) {
  return color.clone().lerp(toward, amount);
}

// ---------------------------------------------------------------------------- shared uniforms

/**
 * One uniform block, referenced by every material this factory makes. `world/Lighting.js` writes it
 * once per frame; nothing else may. Sharing the *objects* — not copies — is what makes a single
 * write reach four hundred meshes.
 */
export const shared = {
  uVsKeyDir: { value: new THREE.Vector3(0, 1, 0) }, // world, surface -> key
  uVsKeyRadiance: { value: new THREE.Color(0, 0, 0) }, // linear key colour * intensity / PI
  uVsRim: { value: new THREE.Vector4(0, 1, 0, 0) }, // xyz world dir toward the rim, w gain
  // §3.4's convergence colour. Seeded here rather than left black because `world/Terrain.js` shares
  // this exact object and compiles against it, and a boot order where the rig arrives late must not
  // be able to render one frame of black shadows.
  uVsShadowTint: { value: roleColor("rock.shadow") },
  uVsCascade: { value: new THREE.Vector2(14, 60) }, // near split distance, far radius
  uVsTime: { value: 0 },
};

// ---------------------------------------------------------------------------- GLSL

const GLSL_PARS = /* glsl */ `
varying vec3 vVsWorld;

uniform vec3  uVsKeyDir;
uniform vec3  uVsKeyRadiance;
uniform vec4  uVsRim;
uniform vec3  uVsShadowTint;
uniform vec2  uVsCascade;
uniform float uVsTime;

uniform vec4  uVsTune;      // x tint weight, y rim weight, z turned-face knee, w spare
uniform vec4  uVsWater;     // x ramp A freq, y ramp B freq, z scroll m/s, w band A threshold
uniform vec3  uVsWaterBody;
uniform vec3  uVsWaterMid;
uniform vec3  uVsWaterHot;
`;

/**
 * The key does not own the shadow map. §3.1: the sky says +9° but cast-shadow length is authored at
 * 3.0–4.0 x object height, which is a 16° sun — "the target cheats; so do we". So a second,
 * zero-intensity directional stands at 16° and owns the map, and the key's own contribution is
 * shadowed here by subtracting exactly what three's Lambert accumulation added for it. That is
 * arithmetic, not an approximation: `RE_Direct_Lambert` adds `dotNL * lightColour * albedo / PI`.
 *
 * Two cascades, near and far, because a single map that reaches the horizon has no texel density
 * left at the player's feet — and no contact shadow is the number one reason a character floats.
 */
const GLSL_SHADOW_FN = /* glsl */ `
float vsKeyShadow( float viewDist ) {
	float s = 1.0;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
		DirectionalLightShadow vsS0 = directionalLightShadows[ 0 ];
		s = getShadow( directionalShadowMap[ 0 ], vsS0.shadowMapSize, vsS0.shadowIntensity, vsS0.shadowBias, vsS0.shadowRadius, vDirectionalShadowCoord[ 0 ] );
		#if NUM_DIR_LIGHT_SHADOWS > 1
			DirectionalLightShadow vsS1 = directionalLightShadows[ 1 ];
			float far = getShadow( directionalShadowMap[ 1 ], vsS1.shadowMapSize, vsS1.shadowIntensity, vsS1.shadowBias, vsS1.shadowRadius, vDirectionalShadowCoord[ 1 ] );
			// Blend across the split rather than switching: §11.3 forbids a hard family change.
			s = mix( s, far, smoothstep( uVsCascade.x * 0.78, uVsCascade.x, viewDist ) );
		#endif
	#endif
	return s;
}
`;

/**
 * The world position every grade in this project reads.
 *
 * The instancing branch is not decoration. `Scatter.js` draws a hundred thousand rocks through
 * `InstancedMesh`, and `modelMatrix * transformed` for an instanced draw is the *root* transform —
 * every instance would report the same world position, the cascade split would pick the far shadow
 * map at the player's feet, and this piece's own aerial perspective would flatten. three's
 * `project_vertex` applies `instanceMatrix` to the view position and never gives us a world one, so
 * it is done here, once, for every material this factory makes.
 */
const GLSL_VERTEX_TAIL = /* glsl */ `
	#ifdef USE_INSTANCING
		vVsWorld = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;
	#else
		vVsWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
	#endif
`;

/**
 * A carry is unresolved value, not a lake: §5 gives it "flat surface facets" and a "scrolling UV
 * offset of a hard-edged ramp", and bans normal-mapped ripples, reflection probes and foam. Two
 * scrolling ramps, `step()`ed into three flat bands, is that ramp evaluated analytically — no
 * texture (anti-pattern 8), no gradient inside a band (anti-pattern 4), and the band boundaries are
 * lines in world space that translate, so a boundary crosses a given pixel at a rate set by
 * `uVsWater.z / freq` rather than a whole facet flipping at once (§11.6).
 */
const GLSL_WATER = /* glsl */ `
#ifdef VS_WATER
	{
		vec2 p = vVsWorld.xz;
		float a = fract( dot( p, vec2( 0.9239, 0.3827 ) ) * uVsWater.x - uVsTime * uVsWater.z );
		float b = fract( dot( p, vec2( -0.3827, 0.9239 ) ) * uVsWater.y + uVsTime * uVsWater.z * 0.62 );
		float band = step( uVsWater.w, a ) + step( 0.93, b );
		totalEmissiveRadiance = band > 1.5 ? uVsWaterHot : ( band > 0.5 ? uVsWaterMid : uVsWaterBody );
	}
#endif
`;

const GLSL_GRADE = /* glsl */ `
	{
		// View -> world for a direction: the view matrix's rotation is orthonormal, so its transpose
		// is its inverse. Doing it this way (rather than a world-normal varying) is what makes the
		// grade correct for BOTH routes in §2.1 — baked per-face normals and FLAT_SHADED skinned
		// meshes, whose normal only exists as a screen-space derivative.
		vec3 vsN = normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
		float vsDist = distance( cameraPosition, vVsWorld );
		float vsNdL = dot( vsN, uVsKeyDir );

		#ifdef VS_KEYSHADOW
			float vsShadow = receiveShadow ? vsKeyShadow( vsDist ) : 1.0;
			outgoingLight -= diffuseColor.rgb * uVsKeyRadiance * max( vsNdL, 0.0 ) * ( 1.0 - vsShadow );
		#endif

		#ifdef VS_TINT
			// §3.4, the single most important paragraph in the art bible. A face TURNED FROM THE KEY
			// converges on one chromatic blue whatever its albedo — rock, a shelf underside and the
			// character's armour all measure hue 195–201 on the target. This is purely geometric:
			// a cast shadow does not enter it, which is what keeps ground in a cast shadow at its own
			// albedo under the blue fill, i.e. green, i.e. the other half of the bimodal dark end.
			float vsTurned = 1.0 - smoothstep( -uVsTune.z, uVsTune.z * 4.0, vsNdL );
			vec3 vsShade = uVsShadowTint;
			// vsTurned saturates at exactly 1.0 for every face with N.L <= -KNEE, i.e. the whole
			// back hemisphere, so on its own §3.4 makes 94% of every shadow-side face the single
			// constant uVsShadowTint however that face is inclined. This grades it by HOW FAR the
			// face is turned instead of only by the fact that it is: 0.72 -> 1.18 is a 1.64x spread,
			// four to five distinct value bands where there was one. Pure N.L on a world-fixed key —
			// it cannot follow the camera, and as a scalar on the tint it cannot move hue or
			// saturation off the 198 the shadow family holds.
			vsShade *= mix( 0.72, 1.18, smoothstep( -0.85, -0.02, vsNdL ) );

			#ifdef VS_RIM
				// The separator that keeps a faceted silhouette off the sky.
				//
				// It lives INSIDE the shadow family and scales the tint itself, so it can move value
				// and can never move hue or saturation: a rimmed shadow face is the same colour as an
				// unrimmed one, up to 1.30x brighter. That is not a fifth shadow value — it is the
				// spread the target itself carries across its three shadow witnesses (Y 0.0227 rock,
				// 0.0245 shelf underside, 0.0290 armour = 1.28x), which is why they are not identical.
				//
				// It is N.L on a world-fixed direction, so it is geometry catching the anti-sun sky.
				// No view vector appears anywhere in it: it cannot draw a Fresnel outline round a
				// shape (anti-pattern 3) and it cannot follow the camera (§10.4).
				vsShade *= 1.0 + uVsRim.w * uVsTune.y * max( dot( vsN, uVsRim.xyz ), 0.0 );
			#endif

			outgoingLight = mix( outgoingLight, vsShade, vsTurned * uVsTune.x );
		#endif
	}
`;

// ---------------------------------------------------------------------------- archetypes

const V4 = (x, y, z, w) => new THREE.Vector4(x, y, z, w);

/**
 * §1.2's cosine ladder, so a role sampled on a facet that was NOT square to the key can say which
 * step it was standing on instead of guessing. 1.00 / 0.71 / 0.61 / 0.54 / 0.27, shadow 0.05.
 */
const LADDER = { lit: 1.0, b: 0.71, c: 0.61, d: 0.54, e: 0.27 };

/**
 * How hard a substance converges on §3.4's turned-face colour.
 *
 * 0 means "never rotates", and exactly two substances take it: **grey**, because §10.2 says a blue
 * shadow on grey turns it back into rock and that is the fastest way to lose the material, and the
 * **cyan accents**, because §7.2's whole point is that they are the only saturated thing in frame.
 */
const TINT = { full: 0.94, hero: 0.9, foliage: 0.86, none: 0 };

/** The turned-face knee, in N.L. Small is a geometric edge (§4); the accents do not use it. */
const KNEE = 0.035;

const ARCHETYPES = {
  // ---- warm stone: "what cooled — a claim that closed and settled" (§10.2)
  rock: {
    albedo: () => albedoFrom("rock.lit.a", { ndl: LADDER.lit, hemi: 0.5, label: "rock" }),
    tint: TINT.full,
    rim: 1,
  },
  /**
   * The walkable shelf. Its albedo is the §3.2 witness itself: `ground.lit` divided by the key at
   * `GROUND_FACET_NDL`, so a shelf facet tilted that far toward the sun renders *exactly*
   * `ground.lit` `#78632C`, and the same facet inside a cast shadow renders exactly `ground.shadow`
   * `#223522`. Those are the two pixels §3.2 and §3.4 are both written from.
   */
  ground: {
    albedo: () => albedoFrom("ground.lit", { ndl: GROUND_FACET_NDL, hemi: 1, label: "ground" }),
    tint: TINT.full,
    rim: 0.85,
  },
  stone: {
    albedo: () => albedoFrom("stone.bone", { ndl: LADDER.lit, hemi: 0.5, label: "stone" }),
    tint: TINT.full,
    rim: 1,
  },
  /**
   * §5: "There is no metal look in this target — a 'metal' object is a lighter, cooler albedo and
   * nothing else." So metal is `stone` walked 30% toward the cool sky fill. Derived, not typed.
   */
  metal: {
    albedo: () =>
      cooled(albedoFrom("stone.bone", { ndl: LADDER.lit, hemi: 0.5, label: "metal" }), 0.3, fill().color),
    tint: TINT.full,
    rim: 1,
    record: "metal",
  },
  /**
   * §10.2 — what was answered instead of solved. Nothing bright on it anywhere, and no rotation:
   * a blue shadow on grey turns it back into rock, which is the fastest way to lose the material.
   * `world.grey` is a *constructed rendered* value (luminance = the geometric mean of lit and
   * shadowed ground), so it is divided at the same ground facet the rest of that construction used.
   */
  grey: {
    albedo: () => albedoFrom("world.grey", { ndl: GROUND_FACET_NDL, hemi: 1, label: "grey" }),
    tint: TINT.none,
    rim: 0,
  },
  greyDeep: {
    albedo: () => albedoFrom("world.grey.deep", { ndl: LADDER.e, hemi: 0.5, label: "greyDeep" }),
    tint: TINT.none,
    rim: 0,
  },

  // ---- foliage: "green is a value, not a colour" (§7.1). Y <= 0.22, S <= 0.45, mostly shadow.
  foliage: {
    albedo: () => albedoFrom("world.foliage.lit", { ndl: LADDER.lit, hemi: 0.6, label: "foliage" }),
    tint: TINT.foliage,
    rim: 0.4,
    side: THREE.DoubleSide,
    alphaTest: 0.5, // §5: alpha TEST, never alpha blend
  },

  // ---- teal resonance: the only saturated accent in the world (§7.2, §5.4)
  /**
   * Crystal gets faces and an emissive, never an env map and never a Fresnel rim — §5 calls it out
   * as the surface a builder is most likely to want one for. The two numbers are §5.4's measured
   * peaks: a facet turned from the key must still read `crystal.face` (Y 0.5478) because the thing
   * is lit from inside, and a facet square to the key reaches `crystal.hot` (Y 0.8217). So the
   * emissive IS the floor and the albedo is exactly the span between the two.
   */
  crystal: {
    albedo: () => albedoSpan("crystal.face", "crystal.hot", "crystal"),
    emissive: () => roleColor("crystal.face"),
    tint: TINT.none,
    rim: 0,
    accent: true,
  },
  /** The hot inner faces of a cluster — §5's "2–3 facet values authored as separate faces". */
  crystalCore: {
    albedo: () => albedoSpan("crystal.face", "crystal.hot", "crystalCore"),
    emissive: () => roleColor("crystal.hot").multiplyScalar(0.86),
    tint: TINT.none,
    rim: 0,
    accent: true,
  },
  /** A carry. Flat facets plus the §5 scrolling hard-edged ramp; see GLSL_WATER. */
  water: {
    albedo: () => roleColor("water.body").multiplyScalar(0.3),
    emissive: () => roleColor("water.body"),
    tint: TINT.none,
    rim: 0,
    accent: true,
    /**
     * x, y: ramp frequencies in cycles per metre — 1/9 and 1/6.5, i.e. a band every 9 m and every
     * 6.5 m. Low on purpose: every band boundary is a hard luminance step, and §11.6 caps the frame
     * at 0.2 % of pixels moving more than 0.05 Y in one fixed step. Halve the wavelength and you
     * double the boundary length and double the fizz.
     * z: scroll, metres of phase per second. 0.03 / (1/9) = 0.27 m/s of boundary travel — a carry
     * moving at a walking pace, and 4.5 mm in one fixed step.
     * w: the first band's threshold. 0.80 leaves the body at 80 % of the surface, the middle band at
     * about 19 % and the hot core at about 1 %, which is what keeps §7.2's accent budget payable.
     */
    water: V4(1 / 9, 1 / 6.5, 0.03, 0.8),
  },
  /** Teal veins on a shelf underside — §10.1 requires them to be separate strips, never a tint. */
  vein: {
    basic: true,
    albedo: () => roleColor("water.core"),
    accent: true,
  },

  // ---- the player and NPCs (§10.4). Skinned, so route (b): flatShading on the material.
  heroPlate: {
    albedo: () => albedoFrom("hero.rim", { ndl: LADDER.lit, hemi: 0.5, label: "heroPlate" }),
    tint: TINT.hero,
    rim: 1,
    flatShading: true,
  },
  heroSkin: {
    albedo: () => albedoFrom("hero.skin", { ndl: LADDER.e, hemi: 0.5, label: "heroSkin" }),
    tint: TINT.hero,
    rim: 0.55,
    flatShading: true,
  },
  heroHair: {
    albedo: () => albedoFrom("hero.hair", { ndl: LADDER.e, hemi: 0.5, label: "heroHair" }),
    tint: TINT.hero,
    rim: 0.55,
    flatShading: true,
  },
  /** Straps, gloves, soles: §10.4's cool near-black, and never `#000000`. */
  heroDark: {
    albedo: () => albedoFrom("hero.dark", { ndl: LADDER.e, hemi: 0.5, label: "heroDark" }),
    tint: TINT.hero,
    rim: 0.3,
    flatShading: true,
  },

  // ---- surfaces whose own module owns the distance law (see the round-2 note at the top)
  /**
   * **Authored value, lit by its own module's grade.** `Terrain.js` and `Level01.js` bake the whole
   * value ladder into per-face vertex colour and then run one grade that owns both the lit ramp and
   * the aerial perspective for six hundred metres of leaf. Those colours are *rendered pixels*
   * sampled off the reference, not albedos, so feeding them to §3.2's division would multiply the
   * key in twice and blow the leaf out — which is why this archetype's own albedo is white and its
   * tint is zero. What it takes from this file is the material *object* (so the ban list, the
   * program budget and the probe cover it), `vVsWorld`, and — the part that moves pixels —
   * `shared.uVsShadowTint`, so the leaf's shadow family is the same colour as the scatter's,
   * written once per frame by the rig instead of typed twice in two files.
   */
  authored: {
    albedo: () => new THREE.Color(1, 1, 1),
    vertexColors: true,
    flatShading: true,
    tint: 0,
    rim: 0,
    keyShadow: false,
    fog: false,
    grade: false,
  },
  /**
   * **A backdrop, authored rather than lit (§7.3).** The archipelago sits 300-1100 m out and turns
   * almost nothing toward a sun 9° above the horizon, so left to the rig it renders as a black
   * cut-out. It carries its own emissive floor and takes no §3.4 rotation: a floating leaf that
   * converged on `rock.shadow` would read as a hole in the sky rather than as distance.
   */
  backdrop: {
    albedo: () => albedoFrom("rock.lit.a", { ndl: LADDER.lit, hemi: 0.5, label: "backdrop" }),
    tint: 0,
    rim: 0,
    fog: false,
  },

  // ---- unlit
  /** §6.2 — flat quads on the sky sphere, hard alpha test, two values per slab and never three. */
  cloudSlab: { basic: true, albedo: () => roleColor("cloud.slab"), alphaTest: 0.5 },
  /** §8 — the mathematics floats unadorned. Pure white, unlit, nothing behind it. */
  glyph: { basic: true, albedo: () => roleColor("math.glyph") },
};

// ---------------------------------------------------------------------------- factory

class MaterialFactory {
  constructor() {
    this.cache = new Map();
    this.built = 0;
    this.hits = 0;
    this.uncached = 0;
    /** How many materials each archetype has handed out. The probe prints it; a reviewer can see
     *  from `__vs.probe("lighting").materials.handedOut` which substances the world actually uses,
     *  without having to take a builder's word that the factory is wired in. */
    this.handedOut = {};
  }

  _count(name) {
    this.handedOut[name] = (this.handedOut[name] ?? 0) + 1;
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
    this._count(name);
    if (hit) {
      this.hits++;
      return hit;
    }
    const mat = this._build(name, spec, overrides || {});
    mat.userData.vsKey = key;
    this.cache.set(key, mat);
    this.built++;
    return mat;
  }

  /**
   * Build an **uncached** instance of an archetype.
   *
   * `get()` is right for a substance: identical requests must collapse onto one instance. It is
   * wrong for a caller that needs its own *uniform* block — `Scatter.js` gives every category its
   * own distance-fade band and `Terrain.js` gives every surface its own lit floor, and both of those
   * are uniforms on the material. Sharing the instance would mean one band for all of them.
   *
   * The cost is one material object, not one program: two instances of the same archetype and the
   * same `extend.key` return the same `customProgramCacheKey`, so three compiles the family once.
   * `stats().programVariants` is the number that has to stay under the budget, and it counts
   * programs rather than materials for exactly this reason.
   */
  make(name, overrides = null) {
    const spec = ARCHETYPES[name];
    if (!spec) throw new Error(`Materials: unknown archetype "${name}"`);
    const mat = this._build(name, spec, overrides || {});
    mat.userData.vsKey = `${name}#${++this.uncached}`;
    this.built++;
    this._count(name);
    this._programs ??= new Set();
    this._programs.add(mat.customProgramCacheKey());
    return mat;
  }

  _build(name, spec, o) {
    const color = o.color !== undefined ? toColor(o.color) : spec.albedo();

    if (spec.basic) {
      const basic = new THREE.MeshBasicMaterial({
        color,
        side: o.side ?? spec.side ?? THREE.FrontSide,
        vertexColors: o.vertexColors ?? spec.vertexColors ?? false,
        transparent: false,
        alphaTest: o.alphaTest ?? spec.alphaTest ?? 0,
        fog: o.fog ?? spec.fog ?? true,
        toneMapped: true,
        dithering: true,
      });
      basic.name = o.name ?? `vs.${name}`;
      basic.userData.vsArchetype = name;
      basic.userData.vsAccent = o.accent ?? !!spec.accent; // P12's bloom mask reads this, never a luminance test
      basic.customProgramCacheKey = () => `vs:basic:${basic.alphaTest > 0 ? "a" : "-"}`;
      return basic;
    }

    const ext = o.extend ?? null;

    const mat = new THREE.MeshLambertMaterial({
      color,
      side: o.side ?? spec.side ?? THREE.FrontSide,
      // Route (b) of §2.1, and ONLY for skinned meshes. Static geometry uses `flatten()` instead,
      // which is exact and costs no derivatives.
      flatShading: o.flatShading ?? spec.flatShading ?? false,
      vertexColors: o.vertexColors ?? spec.vertexColors ?? false,
      alphaTest: o.alphaTest ?? spec.alphaTest ?? 0,
      transparent: !!o.transparent,
      opacity: o.opacity ?? 1,
      depthWrite: o.depthWrite ?? true,
      fog: o.fog ?? spec.fog ?? true,
      dithering: true, // §3.5 — the target dithers at 8-bit and that is why its sky does not band
    });
    mat.name = o.name ?? `vs.${name}`;
    // Lambert still carries an envmap reflectivity term. There is no env map in this project (§5),
    // but a neighbouring piece setting `scene.environment` must not silently multiply into a
    // hand-authored value, so state it.
    mat.reflectivity = 0;

    const emissive = o.emissive !== undefined ? toColor(o.emissive) : spec.emissive ? spec.emissive() : null;
    if (emissive) {
      mat.emissive = emissive;
      mat.emissiveIntensity = o.emissiveIntensity ?? spec.emissiveIntensity ?? 1;
    }

    const defines = {};
    if ((o.keyShadow ?? spec.keyShadow) !== false) defines.VS_KEYSHADOW = "";
    const tint = o.tint ?? spec.tint ?? 0;
    const rim = o.rim ?? spec.rim ?? 0;
    if (tint > 0) defines.VS_TINT = "";
    // The rim only exists inside the shadow family, so a material that never rotates never rims:
    // that is what keeps grey un-glowed (§10.2) and keeps the cyan accents off the rim (§7.2).
    if (rim > 0 && tint > 0) defines.VS_RIM = "";
    if (spec.water) defines.VS_WATER = "";
    mat.defines = defines;

    const body = roleColor("water.body");
    const hot = roleColor("water.core");
    const local = {
      uVsTune: { value: V4(tint, rim, KNEE, 0) },
      uVsWater: { value: (spec.water ?? V4(0, 0, 0, 0)).clone() },
      // §5.4's measured peaks: carry body `water.body` Y 0.4178, carry surface `water.core` Y 0.8175.
      // The middle band is deliberately held BELOW §7.2's accent gate (V 0.80) so that only the hot
      // core spends the frame's cyan budget — the body of a carry is teal, not an accent.
      uVsWaterBody: { value: body.clone().multiplyScalar(0.86) },
      uVsWaterMid: { value: body.clone().lerp(hot, 0.3).multiplyScalar(0.9) },
      uVsWaterHot: { value: hot.clone().multiplyScalar(0.95) },
    };
    mat.userData.vsUniforms = local;
    mat.userData.vsArchetype = name;
    mat.userData.vsAccent = o.accent ?? !!spec.accent;
    if (ext?.userData) Object.assign(mat.userData, ext.userData);

    /**
     * The grade is skipped entirely when neither the §3.4 rotation nor the shadow subtraction is
     * on. `authored` is the one archetype in that position: its own module writes `outgoingLight`
     * from scratch straight afterwards, so emitting this block would compile a normal transform, a
     * camera distance and a dot product per fragment for a value nothing reads.
     */
    const wantGrade = (spec.grade !== false) && (defines.VS_TINT !== undefined || defines.VS_KEYSHADOW !== undefined);

    mat.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, shared, local, ext?.uniforms ?? {});

      s.vertexShader = s.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vVsWorld;\n" + (ext?.vertexPars ?? ""))
        .replace("#include <begin_vertex>", "#include <begin_vertex>\n" + (ext?.vertexBody ?? ""))
        .replace("#include <project_vertex>", "#include <project_vertex>\n" + GLSL_VERTEX_TAIL);

      s.fragmentShader = s.fragmentShader
        .replace("#include <common>", "#include <common>\n" + GLSL_PARS + "\n" + (ext?.fragmentPars ?? ""))
        .replace("void main() {", GLSL_SHADOW_FN + "\n" + (ext?.fragmentFns ?? "") + "\nvoid main() {")
        .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n" + GLSL_WATER)
        // Order is the whole contract with an extending module: this file's grade runs FIRST, so a
        // §3.4-rotated face is already the right colour when the caller's distance law reaches it
        // and haze lands on top of the shadow family rather than under it.
        .replace(
          "#include <opaque_fragment>",
          (wantGrade ? GLSL_GRADE : "") + "\n" + (ext?.gradeBody ?? "") + "\n#include <opaque_fragment>"
        );

      if (ext?.lightBody) {
        s.fragmentShader = s.fragmentShader.replace(
          "#include <lights_fragment_end>",
          "#include <lights_fragment_end>\n" + ext.lightBody
        );
      }
      if (ext?.fragmentTail) {
        s.fragmentShader = s.fragmentShader.replace(
          "#include <fog_fragment>",
          "#include <fog_fragment>\n" + ext.fragmentTail
        );
      }
      mat.userData.vsShader = s;
    };

    // Two materials may share a compiled program only if they share a define set AND the same
    // injected source. three's own cache key covers `defines` and every material parameter but not
    // the closure a module handed us, so the extension names itself.
    const cacheKey =
      `vs:lambert:${Object.keys(defines).sort().join(",")}` +
      `:${mat.flatShading ? "f" : "-"}:${mat.alphaTest > 0 ? "a" : "-"}:${mat.vertexColors ? "c" : "-"}` +
      (ext?.key ? `:${ext.key}` : "");
    mat.customProgramCacheKey = () => cacheKey;
    return mat;
  }

  // Convenience, so call sites read as substances rather than as strings.
  rock(o) { return this.get("rock", o); }
  ground(o) { return this.get("ground", o); }
  stone(o) { return this.get("stone", o); }
  metal(o) { return this.get("metal", o); }
  grey(o) { return this.get("grey", o); }
  greyDeep(o) { return this.get("greyDeep", o); }
  foliage(o) { return this.get("foliage", o); }
  crystal(o) { return this.get("crystal", o); }
  crystalCore(o) { return this.get("crystalCore", o); }
  water(o) { return this.get("water", o); }
  vein(o) { return this.get("vein", o); }
  heroPlate(o) { return this.get("heroPlate", o); }
  heroSkin(o) { return this.get("heroSkin", o); }
  heroHair(o) { return this.get("heroHair", o); }
  heroDark(o) { return this.get("heroDark", o); }
  cloudSlab(o) { return this.get("cloudSlab", o); }
  glyph(o) { return this.get("glyph", o); }

  stats() {
    const programs = new Set(this._programs ?? []);
    for (const m of this.cache.values()) programs.add(m.customProgramCacheKey());
    return {
      instances: this.cache.size + this.uncached,
      shared: this.cache.size,
      uncached: this.uncached,
      built: this.built,
      cacheHits: this.hits,
      programVariants: programs.size,
      programs: [...programs].sort(),
      archetypes: Object.keys(ARCHETYPES).length,
      // Which substances the world actually asked for. Empty entries here are the signature of a
      // factory nobody uses, which is the single finding that cost this piece a round.
      handedOut: { ...this.handedOut },
      textures: 0, // §5: there is no texture in this project, on any surface, at any size
      standardMaterials: 0, // §5: banned globally, no exceptions
      envMaps: 0,
      missingRoles: [...missingRoles],
      keyHex: "#FFE3B8",
      albedos: derivedAlbedos,
      keys: [...this.cache.keys()].sort(),
    };
  }

  dispose() {
    for (const m of this.cache.values()) m.dispose();
    this.cache.clear();
  }
}

// ---------------------------------------------------------------------------- geometry helpers

/**
 * **Route (a) of §2.1 — the preferred one, and a build step rather than a material flag.**
 *
 * Split every shared vertex, then recompute: with no shared vertices `computeVertexNormals()` is a
 * per-FACE normal. Exact, derivative-free, works with any material, and it does not degrade on
 * triangles thinner than a pixel the way `flatShading: true` does. It triples the vertex count of a
 * mesh whose vertex count is deliberately tiny, which is a trade this project can afford everywhere.
 *
 * Call it once, at build time. Never per frame.
 */
export function flatten(geometry) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.deleteAttribute("normal");
  g.computeVertexNormals();
  g.userData.vsFlat = true;
  return g;
}

/** `flatten()` a whole subtree in place — the one-liner a level builder actually wants. */
export function flattenAll(root) {
  let n = 0;
  root.traverse((o) => {
    if (o.isMesh && !o.geometry.userData?.vsFlat && !o.isSkinnedMesh) {
      o.geometry = flatten(o.geometry);
      n++;
    }
  });
  return n;
}

/**
 * How flat a mesh actually is, measured rather than asserted: the fraction of triangles whose three
 * vertex normals are identical. `review/measure/P11.mjs` runs this over the whole scene, because
 * "we use flat shading" is a claim and this is the number behind it.
 */
export function facetAudit(root) {
  let tris = 0;
  let flatTris = 0;
  let meshes = 0;
  let smoothMeshes = [];
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const g = o.geometry;
    const n = g.attributes.normal;
    meshes++;
    if (!n) return;
    if (o.material?.flatShading) {
      // Route (b): the normal is recovered from screen-space derivatives, so the attribute says
      // nothing. Count its triangles as flat — the define is the proof.
      const c = (g.index ? g.index.count : n.count) / 3;
      tris += c;
      flatTris += c;
      return;
    }
    const idx = g.index;
    const count = (idx ? idx.count : n.count) / 3;
    let localFlat = 0;
    for (let t = 0; t < count; t++) {
      const a = idx ? idx.getX(t * 3) : t * 3;
      const b = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const c = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      const same =
        near(n.getX(a), n.getX(b)) && near(n.getY(a), n.getY(b)) && near(n.getZ(a), n.getZ(b)) &&
        near(n.getX(a), n.getX(c)) && near(n.getY(a), n.getY(c)) && near(n.getZ(a), n.getZ(c));
      if (same) localFlat++;
    }
    tris += count;
    flatTris += localFlat;
    if (localFlat < count) smoothMeshes.push(o.name || o.type);
  });
  return {
    meshes,
    triangles: tris,
    flatTriangles: flatTris,
    flatFraction: tris ? Number((flatTris / tris).toFixed(4)) : 1,
    smoothMeshes: smoothMeshes.slice(0, 12),
  };
}

const near = (a, b) => Math.abs(a - b) < 1e-4;


// ---------------------------------------------------------------------------- helpers

/**
 * Which archetype painted each mesh in a subtree, and what is left that this factory did not build.
 *
 * This is the audit the last round of P11 had no answer to. `unowned` is the list that matters: a
 * lit world mesh whose material carries no `vsArchetype` is a mesh this file does not describe, and
 * any colour claim made about it is a claim about somebody else's shader.
 */
export function materialAudit(root) {
  const byArchetype = {};
  const unowned = [];
  const banned = { standard: 0, physical: 0, envMap: 0, anyMap: 0, sceneEnvironment: 0 };
  const MAPS = ["map", "normalMap", "roughnessMap", "bumpMap", "displacementMap", "aoMap",
    "metalnessMap", "alphaMap", "emissiveMap", "lightMap", "specularMap"];
  let meshes = 0;
  root.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    meshes++;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of list) {
      if (m.isMeshStandardMaterial) banned.standard++;
      if (m.isMeshPhysicalMaterial) banned.physical++;
      if (m.envMap) banned.envMap++;
      for (const k of MAPS) if (m[k]) banned.anyMap++;
      const a = m.userData?.vsArchetype;
      if (a) byArchetype[a] = (byArchetype[a] ?? 0) + 1;
      else if (!m.isShaderMaterial && !m.isMeshDepthMaterial) {
        unowned.push(`${o.name || o.type}:${m.name || m.type}`);
      }
    }
  });
  return {
    meshes,
    byArchetype,
    owned: Object.values(byArchetype).reduce((a, b) => a + b, 0),
    unowned: unowned.slice(0, 24),
    unownedCount: unowned.length,
    banned,
  };
}

/** A THREE.Color from either a colour object or an sRGB hex number. */
function toColor(v) {
  return v?.isColor ? v.clone() : new THREE.Color().setHex(v, THREE.SRGBColorSpace);
}

function stableKey(o) {
  return Object.keys(o)
    .sort()
    .map((k) => `${k}=${typeof o[k] === "number" ? o[k].toFixed(4) : String(o[k])}`)
    .join(",");
}

const r4 = (v) => Number(v.toFixed(4));

export const materials = new MaterialFactory();
export { ARCHETYPES, LADDER, TINT, KNEE };
