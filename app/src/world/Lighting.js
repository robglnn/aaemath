import * as THREE from "three";
import { publish } from "../core/Introspect.js";
import { config } from "../core/Config.js";
import { signals } from "../core/Signals.js";
import { materials, shared, roleColor, roleHex, MAX_RES, MAX_GROUND } from "./Materials.js";
import palette from "../../../design/palette.json";
import { section } from "../core/paletteCompat.js";

/**
 * Lighting — the rig from `design/art-direction.md` §2, and the one job a renderer will not do
 * for you: making things look *lit* rather than *illuminated*.
 *
 * Four lights, and anything past four is a failure to commit:
 *
 *   key      `sky.sun`      #FFE8A0   1.00   world-fixed bearing, elevation +8°
 *   fill     `sky.zenith`   #8DACBC   0.14   hemisphere, up
 *   bounce   lit rock       #8A5B3E   0.06   from below, −35°
 *   kick     `resonance.core` #2FE3D6 0.08   opposite the key, low, −15° — the rim that
 *                                            separates a silhouette from the background
 *
 * Three things here are not obvious and are the reason a first draft looks wrong:
 *
 *  * **The sun the sky draws and the sun the shadows come from are not the same sun.** §2: the key
 *    sits at elevation +8°, and cast shadows are authored at 3.0–4.0× object height — which is a
 *    16° sun. "The painting cheats and so should we." So the *shading* key is at +8° and a second,
 *    zero-intensity directional at +16° owns the shadow map. It is the only shadow caster in the
 *    scene, which is also what lets `Materials.js` read its mask out of directional shadow slot 0.
 *
 *  * **A contact shadow is a separate mechanism from a cast shadow.** Anti-pattern 4 is the number
 *    one reason a character floats, and anti-pattern 20 is the reflex fix for anti-pattern 4 making
 *    it worse: a big constant `shadow.bias` peter-pans the shadow off the feet. So this rig uses a
 *    tightly fitted, texel-snapped shadow camera with a *normal-offset* bias, and adds an explicit
 *    grounder occlusion field (`palette.json → materials.contactAO`: ≥45% darkening at the contact,
 *    recovering over 0.35 m) that any piece can feed with one signal or one `userData` flag.
 *
 *  * **Ambient is an environment probe, not a constant.** Anti-pattern 2 (uniform ambient) kills
 *    §3 outright and anti-pattern 18 (metal with no IBL) turns the hero into a black hole. The sky
 *    gradient is built here from `palette.json`, PMREM'd in-engine at boot, and installed as
 *    `scene.environment`.
 *
 * Publishes `world:sun` so the sky, the post stack and anything else that needs to agree with the
 * light can read it instead of guessing.
 */

const TOD = section(palette, "motion").timeOfDay;
const LETHIS = TOD.lethisVariability;
const CONTACT = section(palette, "materials").contactAO;

// The Lethis drive: mutually prime periods, none shorter than 40 s (§15.7). A single sine is the
// one implementation the fiction forbids — a player with a stopwatch would pin the star's period
// in ninety seconds, and eleven thousand four hundred years of not pinning it is the joke.
const LETHIS_PERIODS = [41, 67, 113, 269, 617];

const RELATIVE = {
  key: 1.0,
  fill: 0.14,
  bounce: 0.06,
  kick: 0.08,
};

/** Base scene-referred key intensity. Calibrated by capture — see review/measure/P11.mjs. */
const KEY_INTENSITY = 3.1;
/** ACES exposure. `rock.albedo` under full key must land at display Y 0.42 ± 0.05 (§2). */
const EXPOSURE = 0.92;

const BOUNCE_HEX = 0x8a5b3e; // §2's warm bounce; the only rig colour with no palette role
const SHADOW_ELEVATION_DEG = 16.0; // cot(16°) = 3.49 x object height — inside §2's 3.0–4.0 band

function dirFromAngles(elevationDeg, azimuthDeg, out = new THREE.Vector3()) {
  const e = THREE.MathUtils.degToRad(elevationDeg);
  const a = THREE.MathUtils.degToRad(azimuthDeg);
  // Unit vector pointing FROM the world TOWARD the light.
  return out.set(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)).normalize();
}

// ---------------------------------------------------------------------------- sky gradient

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
	vDir = normalize( position );
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

/**
 * The sky as a photometric source, not as wallpaper. It has to pass through `sky.pivot`'s
 * near-neutral crossover (S < 0.14) or it reads as a two-colour lerp — art-direction.md §9 calls
 * that "the single feature that stops the sky reading as a shader default".
 *
 * P10 owns the real sky. This is the lighting piece's probe source, and it doubles as a stand-in
 * backdrop only when no sky system is mounted, so a capture is never a black frame.
 */
const SKY_FRAG = /* glsl */ `
varying vec3 vDir;
uniform vec3 uZenith;
uniform vec3 uUpper;
uniform vec3 uPivot;
uniform vec3 uHorizon;
uniform vec3 uUnder;
uniform vec3 uSunColor;
uniform vec3 uAurora;
uniform vec3 uSunDir;
uniform float uLevel;

void main() {
	vec3 d = normalize( vDir );
	float h = clamp( d.y, -1.0, 1.0 );
	vec3 c;
	if ( h >= 0.0 ) {
		float t = pow( h, 0.55 );
		c = t > 0.62 ? mix( uUpper, uZenith, smoothstep( 0.62, 1.0, t ) )
		  : t > 0.30 ? mix( uPivot, uUpper, smoothstep( 0.30, 0.62, t ) )
		  :            mix( uHorizon, uPivot, smoothstep( 0.0, 0.30, t ) );
	} else {
		// There is no ground under the leaves (world.md §2.3). Below the horizon the sky keeps
		// going and only warms slightly, which is the light a leaf's underside is lit by.
		c = mix( uHorizon, uUnder, smoothstep( 0.0, -0.55, h ) );
	}
	// Aurora: a TINT, never a colour. S <= 0.22 by construction.
	float band = exp( -pow( ( h - 0.42 ) / 0.16, 2.0 ) ) * 0.55
	           + exp( -pow( ( h - 0.24 ) / 0.09, 2.0 ) ) * 0.30;
	c = mix( c, uAurora, band * 0.16 );
	// The sun's glow. The disc itself is P10's; this is the halo the probe needs to be warm.
	float sd = max( dot( d, normalize( uSunDir ) ), 0.0 );
	c += uSunColor * pow( sd, 220.0 ) * 5.0 + uSunColor * pow( sd, 6.0 ) * 0.32;
	gl_FragColor = vec4( c * uLevel, 1.0 );
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
    this.timeOfDay = clamp01(Number(q.get("tod") ?? opts.timeOfDay ?? 0.18));
    this.autoTime = !(q.has("tod") || opts.timeOfDay !== undefined);
    this.lethisEnabled = q.get("lethis") !== "0";

    this.exposure = Number(q.get("exposure") ?? opts.exposure ?? EXPOSURE);
    this.keyBase = Number(q.get("keyIntensity") ?? opts.keyIntensity ?? KEY_INTENSITY);
    this.keyScale = 1;
    this._keyScaleTarget = 1;

    this.elevationDeg = TOD.keyElevationDeg;
    this.azimuthDeg = this.baseAzimuth;

    this._keyDir = new THREE.Vector3();
    this._shadowDir = new THREE.Vector3();
    this._resonance = new Map();
    this._grounders = new Map();
    this._scanTimer = 0;
    this._sunTimer = 0;
    this._motion = 0;
    this._lastCamPos = new THREE.Vector3();
    this._lastCamQuat = new THREE.Quaternion();
    this._removedPlaceholders = 0;
    this._offs = [];

    this._buildLights();
    this._takeOverPlaceholders();
    this._buildSky();
    this._buildEnvironment();
    this._bindSignals();

    kernel.renderer.toneMappingExposure = this.exposure;

    this._apply(0);
    this._emitSun();

    publish("lighting", () => this.report());
  }

  // -------------------------------------------------------------------------- construction

  _buildLights() {
    const tier = config.tier;

    // 1. The shadow sun. Zero intensity: it exists only to own the shadow map, at the steeper
    //    elevation §2 authors cast-shadow length from. It is added FIRST and is the only shadow
    //    caster, so it holds directional shadow slot 0 for Materials.js.
    this.shadowSun = new THREE.DirectionalLight(0xffffff, 0);
    this.shadowSun.name = "vs.shadowSun";
    this.shadowSun.castShadow = tier.shadows;
    const res = Math.min(4096, tier.shadowResolution);
    this.shadowSun.shadow.mapSize.set(res, res);
    this.shadowSun.shadow.bias = -0.00012;
    this.shadowSun.shadow.normalBias = 0.035; // normal-offset, NOT a big constant bias (§12.20)
    this.shadowSun.shadow.radius = 2.2;
    this.shadowSun.shadow.camera.near = 1;
    this.shadowSun.shadow.camera.far = 420;
    this.shadowRadius = 30;
    this.root.add(this.shadowSun, this.shadowSun.target);

    // 2. The key.
    this.key = new THREE.DirectionalLight(roleColor("sky.sun"), this.keyBase * RELATIVE.key);
    this.key.name = "vs.key";
    this.key.castShadow = false;
    this.root.add(this.key, this.key.target);

    // 3. The hemisphere fill: cool sky above, warm bounce below. Anti-pattern 2 is a constant
    //    ambient, which flattens §3's shadow families into one grey.
    this.fill = new THREE.HemisphereLight(
      roleColor("sky.zenith"),
      new THREE.Color().setHex(BOUNCE_HEX, THREE.SRGBColorSpace),
      this.keyBase * RELATIVE.fill
    );
    this.fill.name = "vs.fill";
    this.root.add(this.fill);

    // 4. The warm bounce off lit rock, from below.
    this.bounce = new THREE.DirectionalLight(
      new THREE.Color().setHex(BOUNCE_HEX, THREE.SRGBColorSpace),
      this.keyBase * RELATIVE.bounce
    );
    this.bounce.name = "vs.bounce";
    this.root.add(this.bounce, this.bounce.target);

    // 5. The resonance kick — opposite the key, low. This is the rim that keeps a dark silhouette
    //    off a dark background, and it is why `hero.undersuit` measures teal.
    this.kick = new THREE.DirectionalLight(
      roleColor("resonance.core"),
      this.keyBase * RELATIVE.kick
    );
    this.kick.name = "vs.kick";
    this.root.add(this.kick, this.kick.target);
  }

  /**
   * `boot/10-scaffold.js` is explicitly temporary and adds placeholder lights so that early
   * captures are not black. The lighting piece is what replaces them; two rigs in one scene is
   * two key lights and no art direction. Its geometry stays — something has to be lit.
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

  _buildSky() {
    const uniforms = {
      uZenith: { value: roleColor("sky.zenith") },
      uUpper: { value: roleColor("sky.upper") },
      uPivot: { value: roleColor("sky.pivot") },
      uHorizon: { value: roleColor("sky.horizon") },
      uUnder: { value: roleColor("rock.warm.low") },
      uSunColor: { value: roleColor("sky.sun") },
      uAurora: { value: roleColor("aurora.mint") },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uLevel: { value: 1 },
    };
    this.skyUniforms = uniforms;

    const make = () =>
      new THREE.Mesh(
        new THREE.SphereGeometry(10, 32, 20),
        new THREE.ShaderMaterial({
          vertexShader: SKY_VERT,
          fragmentShader: SKY_FRAG,
          uniforms,
          side: THREE.BackSide,
          depthWrite: false,
          depthTest: false,
          fog: false,
          toneMapped: true,
        })
      );

    // The probe source always exists; the visible dome only stands in when P10's sky is absent.
    this.probeScene = new THREE.Scene();
    this.probeScene.add(make());

    const skyMounted = this.kernel.byName.has("sky") || this.scene.background?.isTexture;
    this.standIn = !skyMounted;
    if (this.standIn) {
      this.dome = make();
      this.dome.name = "vs.skyStandIn";
      this.dome.renderOrder = -1000;
      this.dome.frustumCulled = false;
      this.root.add(this.dome);
      this.scene.background = null;
      // Anti-pattern 10: distance lerps toward `sky.horizon`, never toward grey.
      this.scene.fog = new THREE.Fog(roleColor("sky.horizon"), 55, config.tier.drawDistance * 0.85);
    }
  }

  /** The environment probe, generated in-engine — never a loaded HDR (§12.18). */
  _buildEnvironment() {
    try {
      const pmrem = new THREE.PMREMGenerator(this.kernel.renderer);
      pmrem.compileEquirectangularShader();
      this._envTarget = pmrem.fromScene(this.probeScene, 0, 0.1, 100);
      this.scene.environment = this._envTarget.texture;
      this.scene.environmentIntensity = 0.55;
      materials.setEnvironment(this._envTarget.texture);
      pmrem.dispose();
      this.envReady = true;
    } catch (err) {
      this.envReady = false;
      this.envError = String(err?.message || err);
    }
  }

  _bindSignals() {
    const on = (name, fn) => this._offs.push(signals.on(name, fn));

    // Anything unresolved — an open socket, a live claim, a carry — pulls nearby shadows to teal
    // (§3 family c) and must go out when the claim closes (§0.2).
    on("world:resonance", (p) => {
      if (!p || p.id === undefined) return;
      if (p.active === false) this._resonance.delete(p.id);
      else
        this._resonance.set(p.id, {
          position: toVec3(p.position),
          radius: Number(p.radius ?? 6),
          strength: Number(p.strength ?? 1),
          eased: this._resonance.get(p.id)?.eased ?? 0,
        });
    });

    // Contact occlusion. One signal, or one `userData.vsGrounder = true` on a mesh.
    on("world:grounder", (p) => {
      if (!p || p.id === undefined) return;
      if (p.active === false) this._grounders.delete(p.id);
      else
        this._grounders.set(p.id, {
          object: null,
          position: toVec3(p.position),
          radius: Number(p.radius ?? 0.45),
          strength: Number(p.strength ?? 1),
        });
    });

    on("player:spawn", (p) => {
      if (p?.position) this.addGrounder("player:spawn", toVec3(p.position), 0.5, 1);
    });
  }

  // -------------------------------------------------------------------------- public API

  /** Register a contact-shadow occluder. `target` may be an Object3D (tracked) or a position. */
  addGrounder(id, target, radius = 0.45, strength = 1) {
    const isObject = !!target?.isObject3D;
    this._grounders.set(id, {
      object: isObject ? target : null,
      position: isObject ? new THREE.Vector3() : toVec3(target),
      radius,
      strength,
    });
  }

  removeGrounder(id) {
    this._grounders.delete(id);
  }

  /** Register a live resonance source; anything within `radius` takes §3's teal shadow family. */
  addResonance(id, target, radius = 6, strength = 1) {
    const isObject = !!target?.isObject3D;
    this._resonance.set(id, {
      object: isObject ? target : null,
      position: isObject ? new THREE.Vector3() : toVec3(target),
      radius,
      strength,
      eased: this._resonance.get(id)?.eased ?? 0,
    });
  }

  removeResonance(id) {
    const e = this._resonance.get(id);
    if (e) e.strength = 0; // let it ease out — a family that switches hard is a colour pop (§15.5)
  }

  /**
   * Time of day, 0..1 over `palette.json → motion.timeOfDay.periodMinutes`. The world is one long
   * dusk and stays one: this moves the key inside ±3° of elevation and ±8° of azimuth and moves
   * nothing else. Night, noon and a colour-temperature ramp are forbidden by §15.7.
   */
  setTimeOfDay(t, { auto = false } = {}) {
    this.timeOfDay = clamp01(t);
    this.autoTime = auto;
    this._apply(0);
    this._emitSun();
  }

  setExposure(e) {
    this.exposure = e;
    this.kernel.renderer.toneMappingExposure = e;
  }

  // -------------------------------------------------------------------------- simulation

  fixed(step, simTime) {
    if (this.autoTime) {
      const period = Math.max(60, TOD.periodMinutes * 60);
      this.timeOfDay = (this.timeOfDay + step / period) % 1;
    }

    // Lethis. Deterministic in simTime, aperiodic in practice, rate limited so it can never
    // become a flicker: this is a star breathing, not a lamp failing.
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

    // Family weights blend over >= 0.25 s on distance, never per frame (§15.5).
    const ease = Math.min(1, step / 0.28);
    for (const [id, e] of this._resonance) {
      e.eased += (e.strength - e.eased) * ease;
      if (e.strength <= 0 && e.eased < 0.002) this._resonance.delete(id);
    }

    this._apply(step);
  }

  frame(dt) {
    const cam = this.kernel.camera;
    const moved = cam.position.distanceTo(this._lastCamPos);
    const turned = 1 - Math.abs(this._lastCamQuat.dot(cam.quaternion));
    this._lastCamPos.copy(cam.position);
    this._lastCamQuat.copy(cam.quaternion);
    // Ramp to the motion roughness floor over 0.15 s and back out; never switch it (§5).
    const target = moved > 0.004 || turned > 2e-5 ? 1 : 0;
    const rate = Math.min(1, Math.max(dt, 1 / 240) / 0.15);
    this._motion += (target - this._motion) * rate;
    shared.uVsMotion.value = this._motion;

    if (this.dome) this.dome.position.copy(cam.position);

    this._scanTimer -= dt;
    if (this._scanTimer <= 0) {
      this._scanTimer = 0.5;
      this._scanForGrounders();
    }

    this._fitShadowCamera();
  }

  // -------------------------------------------------------------------------- internals

  _apply(step) {
    const drift = Math.sin(this.timeOfDay * Math.PI * 2);
    this.elevationDeg = TOD.keyElevationDeg + drift * TOD.elevationDriftDeg;
    this.azimuthDeg = this.baseAzimuth + Math.cos(this.timeOfDay * Math.PI * 2) * TOD.azimuthDriftDeg;

    dirFromAngles(this.elevationDeg, this.azimuthDeg, this._keyDir);
    dirFromAngles(
      SHADOW_ELEVATION_DEG + drift * TOD.elevationDriftDeg,
      this.azimuthDeg,
      this._shadowDir
    );

    const D = 260;
    this.key.position.copy(this._keyDir).multiplyScalar(D);
    this.key.target.position.set(0, 0, 0);
    this.key.intensity = this.keyBase * RELATIVE.key * this.keyScale;

    // Bounce comes from below, from lit rock: −35° elevation, on the key's bearing.
    dirFromAngles(-35, this.azimuthDeg, this.bounce.position).multiplyScalar(D);
    this.bounce.target.position.set(0, 0, 0);
    this.bounce.intensity = this.keyBase * RELATIVE.bounce * this.keyScale;

    // Kick: opposite the key, low.
    dirFromAngles(-15, this.azimuthDeg + 180, this.kick.position).multiplyScalar(D);
    this.kick.target.position.set(0, 0, 0);
    this.kick.intensity = this.keyBase * RELATIVE.kick;

    this.fill.intensity = this.keyBase * RELATIVE.fill;

    if (this.skyUniforms) {
      this.skyUniforms.uSunDir.value.copy(this._keyDir);
      this.skyUniforms.uLevel.value = this.keyScale;
    }

    // Feed the material language.
    shared.uVsKeyDir.value.copy(this._keyDir);
    shared.uVsKeyTint.value
      .copy(this.key.color)
      .multiplyScalar((this.keyBase * RELATIVE.key * this.keyScale) / Math.PI);
    shared.uVsSkyTint.value.copy(this.fill.color).multiplyScalar(1);
    shared.uVsBounceTint.value.copy(this.bounce.color).multiplyScalar(1);
    shared.uVsTime.value += step;

    this._packSources();

    this._sunTimer -= step;
    if (this._sunTimer <= 0) {
      this._sunTimer = 0.1;
      this._emitSun();
    }
  }

  _packSources() {
    let i = 0;
    const power = shared.uVsResPower.value.set(0, 0, 0, 0);
    for (const e of this._resonance.values()) {
      if (i >= MAX_RES) break;
      if (e.object) e.object.getWorldPosition(e.position);
      const slot = shared.uVsRes.value[i];
      slot.set(e.position.x, e.position.y, e.position.z, e.radius);
      power.setComponent(i, e.eased ?? e.strength);
      i++;
    }
    for (let k = i; k < MAX_RES; k++) shared.uVsRes.value[k].set(0, 0, 0, 0);

    let j = 0;
    const gpower = shared.uVsGroundPower.value.set(0, 0, 0, 0);
    for (const g of this._grounders.values()) {
      if (j >= MAX_GROUND) break;
      if (g.object) {
        if (!g.object.parent) continue;
        g.object.getWorldPosition(g.position);
      }
      const slot = shared.uVsGround.value[j];
      slot.set(g.position.x, g.position.y, g.position.z, g.radius);
      gpower.setComponent(j, g.strength);
      j++;
    }
    for (let k = j; k < MAX_GROUND; k++) shared.uVsGround.value[k].set(0, 0, 0, 0);
    this._activeGrounders = j;
    this._activeResonance = i;
  }

  /** Any mesh can opt into contact occlusion with `userData.vsGrounder = true`, no import. */
  _scanForGrounders() {
    this.scene.traverse((o) => {
      if (!o.userData || o.userData.vsGrounder !== true) return;
      const id = `scan:${o.uuid}`;
      if (this._grounders.has(id)) return;
      const radius = Number(o.userData.vsGrounderRadius ?? 0.45);
      this.addGrounder(id, o, radius, Number(o.userData.vsGrounderStrength ?? 1));
    });
  }

  /**
   * Fit the shadow camera to what the player can actually see, and snap its centre to whole
   * shadow texels in WORLD space so the shadow does not swim as the camera moves (§15.6).
   */
  _fitShadowCamera() {
    if (!this.shadowSun.castShadow) return;
    const cam = this.kernel.camera;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const centre = forward.multiplyScalar(this.shadowRadius * 0.72).add(cam.position);

    const dir = this._shadowDir;
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up, dir).normalize();
    const upL = new THREE.Vector3().crossVectors(dir, right).normalize();

    const texel = (this.shadowRadius * 2) / this.shadowSun.shadow.mapSize.x;
    const x = Math.round(centre.dot(right) / texel) * texel;
    const y = Math.round(centre.dot(upL) / texel) * texel;
    const z = centre.dot(dir);
    const snapped = right.multiplyScalar(x).add(upL.multiplyScalar(y)).add(dir.clone().multiplyScalar(z));

    this.shadowSun.position.copy(snapped).addScaledVector(dir, 170);
    this.shadowSun.target.position.copy(snapped);
    this.shadowSun.target.updateMatrixWorld();

    const c = this.shadowSun.shadow.camera;
    if (c.right !== this.shadowRadius) {
      c.left = -this.shadowRadius;
      c.right = this.shadowRadius;
      c.top = this.shadowRadius;
      c.bottom = -this.shadowRadius;
      c.updateProjectionMatrix();
    }
  }

  _emitSun() {
    signals.emit("world:sun", this.sun());
  }

  /** The published contract. Everything that has to agree with the light reads this. */
  sun() {
    const c = this.key.color;
    return {
      // Unit vector from the world toward the sun, and the direction light travels.
      toLight: [r4(this._keyDir.x), r4(this._keyDir.y), r4(this._keyDir.z)],
      direction: [r4(-this._keyDir.x), r4(-this._keyDir.y), r4(-this._keyDir.z)],
      color: [r4(c.r), r4(c.g), r4(c.b)],
      hex: `#${roleHex("sky.sun").toString(16).toUpperCase().padStart(6, "0")}`,
      intensity: r4(this.key.intensity),
      relativeIntensity: r4(this.keyScale),
      elevationDeg: r3(this.elevationDeg),
      azimuthDeg: r3(this.azimuthDeg),
      // The visible disc sits where §2 measures it; the shadows come from the steeper cheat.
      discElevationDeg: r3(this.elevationDeg),
      shadowElevationDeg: r3(SHADOW_ELEVATION_DEG),
      shadowLengthRatio: r3(1 / Math.tan(THREE.MathUtils.degToRad(SHADOW_ELEVATION_DEG))),
      worldFixedBearing: true,
      timeOfDay: r4(this.timeOfDay),
      exposure: r3(this.exposure),
      fill: { hex: palette.roles["sky.zenith"].hex, relative: RELATIVE.fill },
      bounce: { hex: "#8A5B3E", relative: RELATIVE.bounce },
      kick: { hex: palette.roles["resonance.core"].hex, relative: RELATIVE.kick },
    };
  }

  report() {
    return {
      sun: this.sun(),
      lights: {
        key: { hex: hexOfColor(this.key.color), intensity: r4(this.key.intensity) },
        fill: { sky: hexOfColor(this.fill.color), ground: hexOfColor(this.fill.groundColor), intensity: r4(this.fill.intensity) },
        bounce: { hex: hexOfColor(this.bounce.color), intensity: r4(this.bounce.intensity) },
        kick: { hex: hexOfColor(this.kick.color), intensity: r4(this.kick.intensity) },
        shadowCasters: this.shadowSun.castShadow ? 1 : 0,
        contributing: 4,
      },
      shadow: {
        enabled: this.shadowSun.castShadow,
        mapSize: this.shadowSun.shadow.mapSize.x,
        radius: this.shadowRadius,
        texelMetres: r4((this.shadowRadius * 2) / this.shadowSun.shadow.mapSize.x),
        bias: this.shadowSun.shadow.bias,
        normalBias: this.shadowSun.shadow.normalBias,
      },
      contact: {
        minDarkening: CONTACT.minDarkening,
        radiusMetres: CONTACT.radiusMetres,
        active: this._activeGrounders ?? 0,
      },
      resonance: { active: this._activeResonance ?? 0, tracked: this._resonance.size },
      environment: { ready: !!this.envReady, error: this.envError ?? null, intensity: this.scene.environmentIntensity },
      standInSky: !!this.standIn,
      removedPlaceholderLights: this._removedPlaceholders,
      motion: r3(this._motion),
      materials: materials.stats(),
    };
  }

  dispose() {
    for (const off of this._offs) off();
    this._offs.length = 0;
    this._envTarget?.dispose();
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
