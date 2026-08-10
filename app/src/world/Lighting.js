import * as THREE from "three";
import { publish } from "../core/Introspect.js";
import { config } from "../core/Config.js";
import { signals } from "../core/Signals.js";
import {
  materials,
  shared,
  roleColor,
  roleHex,
  facetAudit,
  materialAudit,
  deriveFill,
  KEY_HEX,
  FILL_GROUND_HEX,
  BOUNCE_HEX,
  GROUND_FACET_NDL,
} from "./Materials.js";
import palette from "../../../design/palette.json";

/**
 * Lighting — the rig from `design/art-direction.md` §3, which is the section that decides whether
 * flat shading reads as a shipped stylised game or as a WebGL tutorial.
 *
 * **This file was rewritten for `reference/target-lowpoly.png`.** Everything the painterly revision
 * did is now banned by §5's global list and is gone rather than softened: no `PMREMGenerator`, no
 * `scene.environment`, no env map at any intensity, no ACES shoulder, no exposure control, no
 * violet shadow family. What is here instead:
 *
 *   key      #FFE3B8   1.00 x K   elevation +9deg, azimuth world-fixed        the low sun
 *   fill     sky #66B3FF / ground #2A1F16, derived below                      the sky
 *   bounce   #8A5B3E   0.05 x K   from -40deg, on the key's bearing           lit ground
 *   accent   crystal.hot          pooled PointLights, capped by §5.4          crystal and carries
 *
 * plus a **rim**, which is not a fifth light: it is a world-fixed N.L term inside `Materials.js`'s
 * shadow family that lifts the value of a shadowed face turned toward the anti-sun sky, without
 * moving its hue or saturation. It is what keeps a faceted silhouette off the sky, and §12.1's ban
 * is on a *Fresnel* rim — there is no view vector anywhere in it.
 *
 * Four things here are not obvious, and each of them is a first draft looking wrong:
 *
 *  * **The sun the sky draws and the sun the shadows come from are not the same sun.** §3.1 puts
 *    the key at +9deg but authors cast-shadow length at 3.0-4.0x object height, which is a 16deg
 *    sun. "The target cheats; so do we." So the shading key stands at +9deg and casts nothing, and
 *    two zero-intensity directionals at +16deg own the shadow maps. `Materials.js` reads their masks
 *    out of directional shadow slots 0 and 1 and subtracts exactly what three added for the key.
 *
 *  * **A contact shadow is a texel-density problem, not a bias problem.** No contact shadow is the
 *    number one reason a character looks like it is floating, and the reflex fix — a big constant
 *    `shadow.bias` — peter-pans the shadow off the feet and makes it worse. So the rig runs two
 *    cascades: a tight near one fitted around the player (about 1.5 cm per texel) and a far one for
 *    the world, both texel-snapped in WORLD space so shadows do not swim as the camera translates.
 *
 *  * **The intensities are calibrated against a measurement, not against a ratio in a table.** §3.2
 *    is explicit: "Calibrate by capturing and measuring, never by dividing two light intensities."
 *    See `_deriveRig()` — and see the note there about §3.1's "0.229 x key", which is a *measured
 *    shadow-to-lit ratio on a ground plane* and gives the wrong answer read as an intensity ratio.
 *
 *  * **There is no tonemap.** §3.5: the value ladder in §1.2 is an undistorted cosine, which is only
 *    possible with a linear path from N.L to the final linear value. A filmic shoulder compresses
 *    the top of that ladder and the facets stop reading as facets. The palette is the grade.
 *
 * Publishes `world:sun` so the sky, the post stack and anything else that must agree with the light
 * reads it instead of guessing.
 */

const TOD = palette.motion.timeOfDay;
const LETHIS = TOD.lethisVariability;

// The Lethis drive: mutually prime periods, none shorter than 40 s. A single sine is the one
// implementation the fiction forbids — a player with a stopwatch would pin the star's period in
// ninety seconds, and eleven thousand four hundred years of not pinning it is the joke.
const LETHIS_PERIODS = [41, 67, 113, 269, 617];

/**
 * **K = PI, and that is a derivation rather than a taste.**
 *
 * three's Lambert accumulates `dotNL * lightColour * intensity * albedo / PI`. §3.2 derives every
 * albedo in this project by dividing a facet's *rendered* colour by the key's colour, which is only
 * correct if a facet whose normal points straight at the key renders at exactly `albedo x keyColour`
 * — i.e. if `intensity / PI == 1`. So the key's intensity is PI, exactly, and `Materials.albedoFrom`
 * and this constant are two halves of one equation. Change either and both are wrong.
 */
const KEY_INTENSITY = Math.PI;

/** §3.2's first witness: one ground plane, lit vs its own cast shadow, Y 0.1310 vs 0.0300. */
const GROUND_SHADOW_RATIO = 4.36;

const BOUNCE_RELATIVE = 0.05; // §3.1
const BOUNCE_ELEVATION_DEG = -40; // §3.1: "up, from -40deg"

/**
 * How far the rim may lift a shadowed face, as a multiple of `rock.shadow`.
 *
 * Capped at the spread the target itself carries across its three §3.4 shadow witnesses:
 * rock Y 0.0227, shelf underside 0.0245, character armour 0.0290 -> 0.0290 / 0.0227 = **1.28**.
 * Anything above that and the shadow family stops being one family, which §3.3 forbids.
 */
const RIM_GAIN = 0.28;
const RIM_ELEVATION_DEG = 11;
const RIM_AZIMUTH_OFFSET_DEG = 180;

/** §5.4 — every emitter carries a real PointLight, capped at 6 m so the accent marks and never lights. */
const ACCENT_RADIUS_MAX = 6;
const ACCENT_POOL = { potato: 0, low: 2, medium: 4, high: 6, ultra: 8 };

function dirFromAngles(elevationDeg, azimuthDeg, out = new THREE.Vector3()) {
  const e = THREE.MathUtils.degToRad(elevationDeg);
  const a = THREE.MathUtils.degToRad(azimuthDeg);
  // Unit vector pointing FROM the world TOWARD the light.
  return out.set(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)).normalize();
}

// ---------------------------------------------------------------------------- stand-in sky

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
	vDir = normalize( position );
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

/**
 * §6.1's ramp, evaluated analytically and dithered — never a gradient texture, which bands at 8 bits.
 * Six stops from `sky.zenith` through the near-neutral `sky.pivot` (S 0.149, the saturation minimum
 * of the whole column and the single feature that stops a sky reading as a two-colour lerp) down to
 * `sky.horizon`, plus §6.1's horizontal run: 2.03 : 1 from the sun end of frame to the far end.
 *
 * **P10 owns the real sky, with its cloud slabs.** This stands in only when no sky system is
 * mounted, so that a capture of the light is never a black frame, and it steps aside the moment P10
 * lands. It carries no cloud slabs on purpose — those are P10's and guessing at them here would
 * fight the piece that owns them.
 */
const SKY_FRAG = /* glsl */ `
varying vec3 vDir;
uniform vec3 uZenith, uHigh, uPivot, uWarm, uLow, uHorizon, uAntisun, uSun;
uniform vec3 uSunDir;
uniform float uLevel;

vec3 ramp( float t ) {
	// t: 1 at zenith, 0 at the horizon. The stops are §6.1's per-row medians, re-expressed as
	// fractions of the sky's own height so the ramp does not depend on the camera's framing.
	if ( t > 0.72 ) return mix( uHigh, uZenith, smoothstep( 0.72, 1.0, t ) );
	if ( t > 0.55 ) return mix( uPivot, uHigh, smoothstep( 0.55, 0.72, t ) );
	if ( t > 0.38 ) return mix( uWarm, uPivot, smoothstep( 0.38, 0.55, t ) );
	if ( t > 0.20 ) return mix( uLow, uWarm, smoothstep( 0.20, 0.38, t ) );
	return mix( uHorizon, uLow, smoothstep( 0.0, 0.20, t ) );
}

void main() {
	vec3 d = normalize( vDir );
	float h = clamp( d.y, -1.0, 1.0 );
	vec3 c = ramp( clamp( pow( max( h, 0.0 ), 0.62 ), 0.0 , 1.0 ) );

	// The sky also runs horizontally: a sky authored as a function of altitude alone loses half the
	// drama and all of the direction (§6.1).
	float toSun = clamp( dot( normalize( vec3( d.x, 0.0, d.z ) ), normalize( vec3( uSunDir.x, 0.0, uSunDir.z ) ) ) * 0.5 + 0.5, 0.0, 1.0 );
	c = mix( mix( uAntisun, c, 0.55 ), c, smoothstep( 0.0, 0.85, toSun ) );
	c += uSun * pow( toSun, 26.0 ) * ( 1.0 - smoothstep( 0.0, 0.36, h ) ) * 0.55;

	// There is no ground under the leaves (world.md §2.3): below the horizon the sky keeps going.
	c = mix( c, uHorizon * 0.72, smoothstep( 0.0, -0.45, h ) );

	// §3.5 / §12.12 — dither at 8-bit quantisation or a 1536-tall ramp bands visibly.
	float dither = fract( sin( dot( gl_FragCoord.xy, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
	gl_FragColor = vec4( c * uLevel + ( dither - 0.5 ) * 0.0022, 1.0 );
}
`;

// ---------------------------------------------------------------------------- system

export class Lighting {
  constructor(kernel, opts = {}) {
    this.kernel = kernel;
    this.scene = kernel.scene;
    this.root = new THREE.Group();
    this.root.name = "vs.lighting";

    const q = new URLSearchParams(location.search);
    this.baseAzimuth = Number(q.get("sunAzimuth") ?? opts.azimuthDeg ?? 118);
    this.timeOfDay = clamp01(Number(q.get("tod") ?? opts.timeOfDay ?? 0.25));
    this.autoTime = !(q.has("tod") || opts.timeOfDay !== undefined);
    this.lethisEnabled = q.get("lethis") !== "0";

    this.keyBase = Number(q.get("keyIntensity") ?? opts.keyIntensity ?? KEY_INTENSITY);
    this.keyScale = 1;
    this._keyScaleTarget = 1;

    this.elevationDeg = TOD.keyElevationDeg;
    this.azimuthDeg = this.baseAzimuth;

    this._keyDir = new THREE.Vector3();
    this._shadowDir = new THREE.Vector3();
    this._rimDir = new THREE.Vector3();
    this._accents = new Map();
    this._sunTimer = 0;
    this._removedPlaceholders = 0;
    this._offs = [];
    this._shadowTint = roleColor("rock.shadow"); // §3.4's convergence colour, decoded once
    this._accentColours = new Map();

    this.rig = this._deriveRig();

    this._takeOverRenderer();
    this._buildLights();
    this._takeOverPlaceholders();
    this._buildStandInSky();
    this._bindSignals();

    this._apply(0);
    this._emitSun();

    publish("lighting", () => this.report());
  }

  // -------------------------------------------------------------------------- derivation

  /**
   * The rig, derived from measurements rather than typed. Two numbers do all the work and both come
   * out of `Materials.deriveFill()`, which does §3.1's own division on the two ground pixels §3.2
   * and §3.4 are written from. The consequences, which `review/measure/P11.mjs` checks on pixels:
   *
   *   - an up-facing ground facet inside a cast shadow renders `ground.shadow` `#223522`, hue 120,
   *     Y 0.030 — §3.4's second family and §13 row 4;
   *   - the same facet, tilted `GROUND_FACET_NDL` toward the key and lit, renders `ground.lit`
   *     `#78632C`, Y 0.131 — §3.2's first witness, and their ratio is 4.36 by construction.
   *
   * **§3.1's "fill = 0.229 x key" is not an intensity ratio and must not be typed as one.** 0.229 is
   * the measured *shadow-to-lit ratio on that ground plane* (0.0300 / 0.1310), i.e. the 4.36 witness
   * written the other way up. Used as an intensity ratio it lands the plane at a lit-to-shadow ratio
   * of 2.29 — half what the target measures, and a visibly gloomy frame. §3.2 is explicit about
   * which to trust: "Calibrate by capturing and measuring, never by dividing two light intensities."
   */
  _deriveRig() {
    const key = new THREE.Color().setHex(KEY_HEX, THREE.SRGBColorSpace);
    const bounce = new THREE.Color().setHex(BOUNCE_HEX, THREE.SRGBColorSpace);
    const derived = deriveFill();
    const K = this.keyBase;
    return {
      keyIntensity: K,
      fillIntensity: derived.intensity,
      fillRelative: derived.intensity / K,
      fillDerivation: derived,
      bounceIntensity: K * BOUNCE_RELATIVE,
      colours: { key, fillSky: derived.color, bounce },
      groundFacetNdL: GROUND_FACET_NDL,
      groundShadowRatioTarget: GROUND_SHADOW_RATIO,
    };
  }

  // -------------------------------------------------------------------------- construction

  /**
   * §3.5 and §4, and they belong to the light rig rather than to the kernel: a filmic shoulder and a
   * soft shadow kernel are lighting decisions, and the kernel ships neutral defaults for whoever
   * boots first. Surgical, three properties, no restructuring of a shared file.
   */
  _takeOverRenderer() {
    const r = this.kernel.renderer;
    r.toneMapping = THREE.NoToneMapping; // §3.5 — the palette is the grade
    r.toneMappingExposure = 1;
    r.outputColorSpace = THREE.SRGBColorSpace;
    // PCFSoft ignores `shadow.radius` and blurs by a fixed kernel; §4 wants a hard edge with 1-2 px
    // of antialiasing on it, so take the radius back.
    r.shadowMap.type = THREE.PCFShadowMap;
    r.shadowMap.enabled = config.tier.shadows;
  }

  _buildLights() {
    const tier = config.tier;
    const rig = this.rig;

    // 1. The shadow sun, in two cascades. Zero intensity: these exist only to own the shadow maps,
    //    at the steeper elevation §3.1 authors cast-shadow length from. They are added FIRST and are
    //    the only shadow casters in the scene, which is what lets Materials.js read their masks out
    //    of directional shadow slots 0 (near) and 1 (far) — three sorts shadow-casting lights first
    //    and its sort is stable, so scene order decides the slots.
    const cascades = Math.max(1, Math.min(2, tier.shadowCascades ?? 1));
    this.cascades = [];
    const plan = cascades === 1 ? [{ radius: 34, res: 1 }] : [
      { radius: 13, res: 1 }, // near: the player's own contact shadow lives here
      { radius: 58, res: 1 }, // far: the world
    ];
    plan.forEach((c, i) => {
      const light = new THREE.DirectionalLight(0xffffff, 0);
      light.name = `vs.shadowSun.${i === 0 && cascades > 1 ? "near" : cascades > 1 ? "far" : "single"}`;
      light.castShadow = tier.shadows;
      const res = Math.min(2048, Math.max(1024, tier.shadowResolution));
      light.shadow.mapSize.set(res, res);
      // Normal-offset bias, not a big constant depth bias: a constant bias peter-pans the shadow off
      // the feet, which is the exact failure this rig is built to avoid (§12.1 no.5's neighbour).
      light.shadow.bias = -0.00016;
      light.shadow.normalBias = (c.radius * 2) / res * 1.1; // ~1.1 texels, in metres
      light.shadow.radius = 1.1;
      light.shadow.camera.near = 0.5;
      light.shadow.camera.far = c.radius * 8 + 60;
      light.shadow.camera.left = -c.radius;
      light.shadow.camera.right = c.radius;
      light.shadow.camera.top = c.radius;
      light.shadow.camera.bottom = -c.radius;
      light.shadow.camera.updateProjectionMatrix();
      this.root.add(light, light.target);
      this.cascades.push({ light, radius: c.radius });
    });
    this.shadowSun = this.cascades[0].light;
    shared.uVsCascade.value.set(
      this.cascades.length > 1 ? this.cascades[0].radius * 0.92 : 1e9,
      this.cascades[this.cascades.length - 1].radius
    );

    // 2. The key. It casts nothing; Materials.js applies the shadow mask to it by subtraction.
    this.key = new THREE.DirectionalLight(rig.colours.key.clone(), rig.keyIntensity);
    this.key.name = "vs.key";
    this.key.castShadow = false;
    this.root.add(this.key, this.key.target);

    // 3. The sky, as a photometric source. §3.4: the fill tint #66B3FF is derived from the target by
    //    dividing a shadowed ground triplet by its lit one, sits nowhere near the Planckian locus,
    //    and that is exactly why the shadows are a colour instead of a darkness. A grey ambient
    //    here would kill §3.4 outright (anti-pattern 5).
    this.fill = new THREE.HemisphereLight(
      rig.colours.fillSky.clone(),
      new THREE.Color().setHex(FILL_GROUND_HEX, THREE.SRGBColorSpace),
      rig.fillIntensity
    );
    this.fill.name = "vs.fill";
    this.fill.position.set(0, 1, 0); // three takes the hemisphere axis from the light's position
    this.root.add(this.fill);

    // 4. The warm bounce off lit ground, from below.
    this.bounce = new THREE.DirectionalLight(rig.colours.bounce.clone(), rig.bounceIntensity);
    this.bounce.name = "vs.bounce";
    this.root.add(this.bounce, this.bounce.target);

    // 5. The accent pool (§5.4). Fixed size, allocated once: NUM_POINT_LIGHTS is baked into every
    //    compiled program, so a pool that grows at runtime recompiles the entire world mid-play.
    this.accentPool = [];
    const poolSize = ACCENT_POOL[tier.id] ?? 4;
    for (let i = 0; i < poolSize; i++) {
      const p = new THREE.PointLight(roleColor("crystal.hot"), 0, ACCENT_RADIUS_MAX, 2);
      p.name = `vs.accent.${i}`;
      p.castShadow = false;
      this.root.add(p);
      this.accentPool.push(p);
    }
  }

  /**
   * `boot/10-scaffold.js` is explicitly temporary and adds placeholder lights so early captures are
   * not black. This piece is what replaces them; two rigs in one scene is two key lights and no art
   * direction. Its geometry stays — something has to be lit.
   */
  _takeOverPlaceholders() {
    const strays = [];
    this.scene.traverse((o) => {
      if (o.isLight && !this.root.getObjectById(o.id)) strays.push(o);
    });
    for (const light of strays) {
      light.parent?.remove(light);
      this._removedPlaceholders++;
    }
  }

  _buildStandInSky() {
    const mounted = this.kernel.byName.has("sky") || this.scene.background?.isTexture;
    this.standIn = !mounted;
    if (!this.standIn) return;

    this.skyUniforms = {
      uZenith: { value: roleColor("sky.zenith") },
      uHigh: { value: roleColor("sky.high") },
      uPivot: { value: roleColor("sky.pivot") },
      uWarm: { value: roleColor("sky.warm") },
      uLow: { value: roleColor("sky.low") },
      uHorizon: { value: roleColor("sky.horizon") },
      uAntisun: { value: roleColor("sky.horizon.antisun") },
      uSun: { value: roleColor("sky.sun") },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uLevel: { value: 1 },
    };
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(10, 40, 24),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        uniforms: this.skyUniforms,
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        fog: false,
        toneMapped: true,
      })
    );
    this.dome.name = "vs.skyStandIn";
    this.dome.renderOrder = -1000;
    this.dome.frustumCulled = false;
    this.root.add(this.dome);
    this.scene.background = null;

    // §7.3 — aerial perspective is "a lerp of the lit value toward sky.horizon while the shadow
    // value rises to meet it", which is exactly a linear fog to #FFB260. Never toward grey
    // (anti-pattern 20: fog soup) and never as desaturation (§13 row 11).
    this.scene.fog = new THREE.Fog(roleColor("sky.horizon"), 42, config.tier.drawDistance * 0.7);
  }

  _bindSignals() {
    const on = (name, fn) => this._offs.push(signals.on(name, fn));

    // Anything unresolved — an open socket, a live claim, a carry — is an emitter, and §5.4 says an
    // emitter with no spill is a painted decal (anti-pattern 15).
    on("world:resonance", (p) => {
      if (!p || p.id === undefined) return;
      if (p.active === false) this.removeAccent(p.id);
      else this.addAccent(p.id, p.position, { radius: p.radius, strength: p.strength });
    });
  }

  // -------------------------------------------------------------------------- public API

  /**
   * Register a live emitter so it spills onto the ground. `target` may be an Object3D (tracked) or a
   * position. §5.4 caps the radius at 6 m and caps intensity so the spill never lifts a neighbouring
   * rock facet above Y 0.10 — above that the accent starts lighting the world instead of marking it.
   */
  addAccent(id, target, { radius = 4, strength = 1, color = "crystal.hot" } = {}) {
    const isObject = !!target?.isObject3D;
    this._accents.set(id, {
      object: isObject ? target : null,
      position: isObject ? new THREE.Vector3() : toVec3(target),
      radius: Math.min(ACCENT_RADIUS_MAX, Number(radius) || 4),
      strength: THREE.MathUtils.clamp(Number(strength) || 0, 0, 1),
      color,
    });
  }

  removeAccent(id) {
    this._accents.delete(id);
  }

  /**
   * Time of day, 0..1 over `palette.motion.timeOfDay.periodMinutes`. The world is one long dusk and
   * stays one: this moves the key inside +-2deg of elevation and +-8deg of azimuth and moves nothing
   * else. Night, noon and a colour-temperature ramp are not in this product.
   */
  setTimeOfDay(t, { auto = false } = {}) {
    this.timeOfDay = clamp01(t);
    this.autoTime = auto;
    this._apply(0);
    this._emitSun();
  }

  // -------------------------------------------------------------------------- simulation

  fixed(step, simTime) {
    if (this.autoTime) {
      const period = Math.max(60, TOD.periodMinutes * 60);
      this.timeOfDay = (this.timeOfDay + step / period) % 1;
    }

    // Lethis. Deterministic in simTime, aperiodic in practice, rate limited so it can never become a
    // flicker: this is a star breathing, not a lamp failing.
    if (this.lethisEnabled) {
      let sum = 0;
      for (const p of LETHIS_PERIODS) sum += Math.sin((2 * Math.PI * simTime) / p);
      this._keyScaleTarget = 1 + (sum / LETHIS_PERIODS.length) * LETHIS.intensitySwing;
    } else {
      this._keyScaleTarget = 1;
    }
    const maxRate = LETHIS.maxRatePerFixedStep;
    const delta = THREE.MathUtils.clamp(this._keyScaleTarget - this.keyScale, -maxRate, maxRate);
    this.keyScale = THREE.MathUtils.clamp(
      this.keyScale + delta,
      1 - LETHIS.intensitySwing,
      1 + LETHIS.intensitySwing
    );

    this._apply(step);
  }

  frame(dt) {
    if (this.dome) this.dome.position.copy(this.kernel.camera.position);
    this._assignAccents();
    this._fitShadowCameras();
  }

  // -------------------------------------------------------------------------- internals

  _apply(step) {
    const drift = Math.sin(this.timeOfDay * Math.PI * 2);
    this.elevationDeg = TOD.keyElevationDeg + drift * TOD.elevationDriftDeg;
    this.azimuthDeg = this.baseAzimuth + Math.cos(this.timeOfDay * Math.PI * 2) * TOD.azimuthDriftDeg;

    dirFromAngles(this.elevationDeg, this.azimuthDeg, this._keyDir);
    dirFromAngles(
      TOD.shadowElevationDeg + drift * TOD.elevationDriftDeg,
      this.azimuthDeg,
      this._shadowDir
    );
    dirFromAngles(RIM_ELEVATION_DEG, this.azimuthDeg + RIM_AZIMUTH_OFFSET_DEG, this._rimDir);

    const D = 260;
    this.key.position.copy(this._keyDir).multiplyScalar(D);
    this.key.target.position.set(0, 0, 0);
    this.key.intensity = this.rig.keyIntensity * this.keyScale;

    dirFromAngles(BOUNCE_ELEVATION_DEG, this.azimuthDeg, this.bounce.position).multiplyScalar(D);
    this.bounce.target.position.set(0, 0, 0);
    this.bounce.intensity = this.rig.bounceIntensity * this.keyScale;

    this.fill.intensity = this.rig.fillIntensity;

    if (this.skyUniforms) {
      this.skyUniforms.uSunDir.value.copy(this._keyDir);
      this.skyUniforms.uLevel.value = this.keyScale;
    }

    // Feed the material language. One write reaches every material in the world.
    shared.uVsKeyDir.value.copy(this._keyDir);
    shared.uVsKeyRadiance.value
      .copy(this.key.color)
      .multiplyScalar(this.key.intensity / Math.PI);
    shared.uVsRim.value.set(this._rimDir.x, this._rimDir.y, this._rimDir.z, RIM_GAIN);
    shared.uVsShadowTint.value.copy(this._shadowTint);
    shared.uVsTime.value += step;

    this._sunTimer -= step;
    if (this._sunTimer <= 0) {
      this._sunTimer = 0.1;
      this._emitSun();
    }
  }

  /**
   * The accent pool is assigned by distance to the camera every frame. A fixed pool means the point
   * light count never changes, so no program in the world is ever recompiled mid-play — the single
   * most expensive avoidable hitch a renderer can have.
   */
  _assignAccents() {
    if (!this.accentPool.length) return;
    const cam = this.kernel.camera.position;
    const live = [];
    for (const e of this._accents.values()) {
      if (e.object) {
        if (!e.object.parent) continue;
        e.object.getWorldPosition(e.position);
      }
      live.push({ e, d: e.position.distanceToSquared(cam) });
    }
    live.sort((a, b) => a.d - b.d);
    this.accentPool.forEach((light, i) => {
      const hit = live[i];
      if (!hit) {
        light.intensity = 0;
        return;
      }
      light.position.copy(hit.e.position);
      light.distance = hit.e.radius;
      let col = this._accentColours.get(hit.e.color);
      if (!col) this._accentColours.set(hit.e.color, (col = roleColor(hit.e.color)));
      light.color.copy(col);
      // §5.4's cap, stated as physics: at `radius` the spill is zero, and the peak is set so a rock
      // facet one metre away cannot pass Y 0.10. rock albedo Y ~ 0.52, so I <= 0.10 * PI / 0.52 / 1.
      light.intensity = hit.e.strength * 0.58;
    });
    this._activeAccents = Math.min(live.length, this.accentPool.length);
  }

  /**
   * Fit each cascade to what the player can actually see, and snap its centre to whole shadow texels
   * in WORLD space so the shadow does not swim as the camera translates (§11.2).
   *
   * The near cascade is what produces the character's contact shadow, so it is deliberately small:
   * 13 m across 2048 texels is 1.3 cm per texel, and a boot is twenty of them.
   */
  _fitShadowCameras() {
    if (!this.cascades.length || !this.cascades[0].light.castShadow) return;
    const cam = this.kernel.camera;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const dir = this._shadowDir;
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up, dir).normalize();
    const upL = new THREE.Vector3().crossVectors(dir, right).normalize();

    for (const c of this.cascades) {
      const centre = forward
        .clone()
        .multiplyScalar(c.radius * 0.6)
        .add(cam.position);
      const texel = (c.radius * 2) / c.light.shadow.mapSize.x;
      const x = Math.round(centre.dot(right) / texel) * texel;
      const y = Math.round(centre.dot(upL) / texel) * texel;
      const z = centre.dot(dir);
      const snapped = right
        .clone()
        .multiplyScalar(x)
        .add(upL.clone().multiplyScalar(y))
        .add(dir.clone().multiplyScalar(z));
      c.light.position.copy(snapped).addScaledVector(dir, c.radius * 4 + 40);
      c.light.target.position.copy(snapped);
      c.light.target.updateMatrixWorld();
    }
  }

  _emitSun() {
    signals.emit("world:sun", this.sun());
  }

  /** The published contract. Everything that must agree with the light reads this. */
  sun() {
    const c = this.key.color;
    return {
      // Unit vector from the world toward the sun, and the direction light travels.
      toLight: [r4(this._keyDir.x), r4(this._keyDir.y), r4(this._keyDir.z)],
      direction: [r4(-this._keyDir.x), r4(-this._keyDir.y), r4(-this._keyDir.z)],
      color: [r4(c.r), r4(c.g), r4(c.b)],
      hex: "#FFE3B8",
      intensity: r4(this.key.intensity),
      relativeIntensity: r4(this.keyScale),
      elevationDeg: r3(this.elevationDeg),
      azimuthDeg: r3(this.azimuthDeg),
      // The visible disc sits where §3.1 measures it; the shadows come from the steeper cheat.
      discElevationDeg: r3(this.elevationDeg),
      shadowElevationDeg: r3(TOD.shadowElevationDeg),
      shadowLengthRatio: r3(1 / Math.tan(THREE.MathUtils.degToRad(TOD.shadowElevationDeg))),
      worldFixedBearing: true,
      timeOfDay: r4(this.timeOfDay),
      exposure: 1,
      tonemap: "none",
      fill: {
        hex: this.rig.fillDerivation.hex,
        ground: "#2A1F16",
        relative: r4(this.rig.fillRelative),
        derivation: this.rig.fillDerivation.method,
        docPrinted: "#66B3FF",
      },
      bounce: { hex: "#8A5B3E", relative: BOUNCE_RELATIVE },
      rim: {
        toRim: [r4(this._rimDir.x), r4(this._rimDir.y), r4(this._rimDir.z)],
        gain: RIM_GAIN,
        tint: `#${roleHex("rock.shadow").toString(16).toUpperCase().padStart(6, "0")}`,
      },
      // Deprecated alias: the painterly rig called the rim a "kick". Kept so nothing breaks.
      kick: { hex: palette.roles["rock.shadow"].hex, relative: RIM_GAIN },
    };
  }

  report() {
    const r = this.kernel.renderer;
    return {
      sun: this.sun(),
      lights: {
        key: { hex: hexOfColor(this.key.color), intensity: r4(this.key.intensity) },
        fill: {
          sky: hexOfColor(this.fill.color),
          ground: hexOfColor(this.fill.groundColor),
          intensity: r4(this.fill.intensity),
          relativeToKey: r4(this.rig.fillRelative),
        },
        bounce: { hex: hexOfColor(this.bounce.color), intensity: r4(this.bounce.intensity) },
        rim: { gain: RIM_GAIN, elevationDeg: RIM_ELEVATION_DEG, insideShadowFamily: true },
        accentPool: this.accentPool.length,
        accentsActive: this._activeAccents ?? 0,
        shadowCasters: this.cascades.filter((c) => c.light.castShadow).length,
        contributingLights: 3 + (this._activeAccents ?? 0), // key, fill, bounce, + accents
        zeroIntensityShadowOwners: this.cascades.length,
      },
      shadow: {
        enabled: !!this.cascades[0]?.light.castShadow,
        cascades: this.cascades.map((c) => ({
          radius: c.radius,
          mapSize: c.light.shadow.mapSize.x,
          texelMetres: r4((c.radius * 2) / c.light.shadow.mapSize.x),
          bias: c.light.shadow.bias,
          normalBias: r4(c.light.shadow.normalBias),
        })),
        splitMetres: r3(shared.uVsCascade.value.x),
        type: "PCF",
      },
      renderer: {
        toneMapping: r.toneMapping, // must be 0 (NoToneMapping) — §3.5
        toneMappingExposure: r.toneMappingExposure,
        outputColorSpace: r.outputColorSpace,
        shadowMapEnabled: r.shadowMap.enabled,
      },
      standInSky: !!this.standIn,
      fog: this.scene.fog
        ? { hex: hexOfColor(this.scene.fog.color), near: this.scene.fog.near, far: this.scene.fog.far }
        : null,
      removedPlaceholderLights: this._removedPlaceholders,
      materials: materials.stats(),
      // Which archetype painted which mesh IN THE SHIPPED SCENE. Cheap (one traverse, no per-triangle
      // work) and cached for a second, because it is the answer to the only question that mattered
      // last round: is this file's output actually on screen?
      world: this._census(),
    };
  }

  /** A one-second-cached scene walk. `facetAudit` is per-triangle and is NOT in here on purpose. */
  _census(maxAgeMs = 1000) {
    const now = (globalThis.performance ?? Date).now();
    if (!this._censusAt || now - this._censusAt > maxAgeMs) {
      this._censusAt = now;
      this._censusValue = materialAudit(this.scene);
    }
    return this._censusValue;
  }

  // -------------------------------------------------------------------------- reviewer only

  /**
   * **Reviewer-only. There is no synthetic scene here and there must never be one again.**
   *
   * The previous revision of this file could build a `materialBoard()` — a private shelf with one of
   * every substance on it — and `review/measure/P11.mjs` measured that instead of the game. Every
   * colour this piece claimed was therefore true of a scene no player could reach, while a real rock
   * facet turned from the key measured 160° of hue away from the target. The board is deleted, not
   * flagged off, because a flag is an invitation.
   *
   * What is left is the smallest thing a measurement legitimately needs and cannot get any other
   * way: **a camera it controls, pointed at the shipped world.** Nothing is added, nothing is
   * hidden, no material is swapped. The systems that would fight for the camera are detached for the
   * life of the run and the world underneath is exactly the one the player walks on.
   */
  reviewCamera({ pos, look, fov = 50, detach = ["camera"] } = {}) {
    // Only the camera rig by default. Locomotion and the avatar stay mounted on purpose: a claim
    // about where a body meets the ground is worth nothing if the body has been frozen out of the
    // simulation that decides where its feet are.
    for (const name of detach === true ? ["camera", "locomotion", "traversal"] : detach || []) {
      const sys = this.kernel.byName.get(name);
      const i = sys ? this.kernel.systems.indexOf(sys) : -1;
      if (i >= 0) {
        this.kernel.systems.splice(i, 1);
        (this._detached ??= []).push(name);
      }
    }
    const cam = this.kernel.camera;
    if (pos) cam.position.set(pos[0], pos[1], pos[2]);
    cam.fov = fov;
    cam.updateProjectionMatrix();
    if (look) cam.lookAt(look[0], look[1], look[2]);
    cam.updateMatrixWorld(true);
    this._fitShadowCameras();
    return {
      scene: "shipped",
      detachedSystems: this._detached ?? [],
      position: [cam.position.x, cam.position.y, cam.position.z],
      fov: cam.fov,
    };
  }

  /** **Reviewer-only.** Which archetype paints which mesh, right now, in the live scene. */
  audit() {
    return { ...materialAudit(this.scene), facets: facetAudit(this.scene) };
  }

  /**
   * **Reviewer-only.** Swap the sky for a flat neutral backdrop.
   *
   * The sky is pure backdrop in this rig — there is no env map and no image-based lighting, so
   * hiding it changes not one lit pixel. What it does change is which pixels belong to P11: §7.2
   * puts the sky's cyan contribution at zero *by law*, so measuring this piece's accent budget and
   * its temporal-noise budget against a neutral backdrop measures P11's surfaces instead of P10's
   * clouds. `review/measure/P11.mjs` reports both numbers.
   */
  neutralSky(on = true) {
    this._skyRoots ??= ["sky", "atmosphere", "weather"]
      .map((n) => this.kernel.byName.get(n)?.root)
      .filter(Boolean);
    for (const r of this._skyRoots) r.visible = !on;
    if (this.dome) this.dome.visible = !on;
    this._savedBackground = this._savedBackground ?? this.scene.background ?? null;
    this.scene.background = on ? new THREE.Color(0x6e6e6e) : this._savedBackground;
    return { neutral: on, skyRoots: this._skyRoots.length };
  }

  /** Reviewer-only: project a world point to viewport pixels, so a script can name the feet. */
  projectPoint(p) {
    const v = new THREE.Vector3(p[0], p[1], p[2]).project(this.kernel.camera);
    const w = this.kernel.renderer.domElement.clientWidth;
    const h = this.kernel.renderer.domElement.clientHeight;
    return [Math.round(((v.x + 1) / 2) * w), Math.round(((1 - v.y) / 2) * h)];
  }

  dispose() {
    for (const off of this._offs) off();
    this._offs.length = 0;
    this.dome?.geometry.dispose();
    this.dome?.material.dispose();
  }
}

// ---------------------------------------------------------------------------- helpers

const clamp01 = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
const r3 = (v) => Number(v.toFixed(3));
const r4 = (v) => Number(v.toFixed(4));
const hexOfColor = (c) => `#${c.getHexString(THREE.SRGBColorSpace).toUpperCase()}`;

function toVec3(p) {
  if (!p) return new THREE.Vector3();
  if (p.isVector3) return p.clone();
  if (Array.isArray(p)) return new THREE.Vector3(p[0] || 0, p[1] || 0, p[2] || 0);
  return new THREE.Vector3(p.x || 0, p.y || 0, p.z || 0);
}
