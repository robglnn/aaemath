import * as THREE from "three";
import {
  LUMINANCE,
  FILMIC,
  ACES,
  DISPLAY,
  DISPLAY_MODE,
  SRGB_ENCODE,
  BAYER,
  HASH,
} from "./glsl.js";
import { Blit, VERTEX } from "./FullScreenPass.js";

/**
 * The output pass: everything between "scene-linear light" and "an 8-bit sRGB code".
 *
 * Five of the brief's effects live in this one draw — bloom composite, sun-glow composite, colour
 * grade, vignette, grain — plus the dither §3.5 makes binding. That is deliberate. At 3840x2160 a
 * full-screen pass costs 8.3 M fragments; running vignette, grain and grade as three ping-pong
 * passes would cost three extra RGBA16F round trips through memory for about twenty ALU ops of
 * work. Each effect is still independently owned, with its own `#define`, its own uniforms and its
 * own entry in `config.tier.postStack` — a tier that does not ask for grain compiles a shader with
 * no grain instructions in it at all, which is cheaper than any amount of branching.
 *
 * ORDER MATTERS. Each position has a reason:
 *
 *   1. + bloom, + sun glow   scene-linear     a halo is light arriving at the sensor, so it must
 *                                             composite BEFORE the display transform. Additive,
 *                                             never a lerp — a lerp takes brightness away from the
 *                                             emitter core it is supposed to be haloing, and §5.4
 *                                             needs the accent to stay the brightest thing in frame
 *   2. vignette              scene-linear     it is lost light, i.e. an exposure falloff. Applied
 *                                             after the transform it crushes corners instead of
 *                                             rolling them off
 *   3. exposure + contrast   scene-linear     contrast pivots on a log mid-grey so it cannot move
 *                                             the black point. Both ship at identity — see below
 *   4. DISPLAY TRANSFORM     -> display       the one non-linearity, and it is a *mirror* of
 *                                             `renderer.toneMapping`. See `glsl.js`
 *   5. lift / gamma / gain   display 0..1     the grade proper. Bounded in, bounded out
 *   6. saturation            display
 *   7. grain                 display          fixed screen-space tile, luminance-windowed
 *   8. sRGB encode           display -> code  the ONLY encode in the frame
 *   9. ordered Bayer dither  code             the last operation, at 8-bit quantisation
 *
 * Nothing in this pass reads the clock, the frame index or the camera. Every screen-space pattern
 * is a pure function of `gl_FragCoord`, so §11.6's budget — no more than 0.2% of pixels moving by
 * more than 0.05 of luminance with the camera static — is zero from post by construction rather
 * than by tuning.
 */

/**
 * The look. Every number is a decision with a measurement behind it, and the most important one is
 * that **the grade ships as the exact identity**.
 *
 * That is not an unfinished tuning pass. `design/art-direction.md` §3.5: *"The palette is the
 * grade."* §1.2: the lit facets of the foreground rock sit at Y 0.4435 / 0.3129 / 0.2720 / 0.2398
 * / 0.1192, which divided by the brightest is 1.00 / 0.71 / 0.61 / 0.54 / 0.27 — *"That is N·L,
 * undistorted. There is no tone curve in this picture."* §3.3 then requires each step to land
 * within ±0.03 of a plausible N·L. A lift of 0.0035 in blue moves the darkest step of that ladder
 * by 3% of its own value; a contrast of 1.06 about a 0.18 pivot moves the brightest by 2.6%. Both
 * are inside the noise of one measurement and outside the tolerance of five of them stacked, and
 * neither buys anything the palette has not already bought — every role in `design/palette.json`
 * was sampled off the target as a finished sRGB code, so a grade on top of them can only move them
 * away from the thing they were measured from.
 *
 * The knobs are live, uniform-driven and settable at runtime through `PostStack.setLook()`, because
 * a future HDR path or a story beat that wants a colour push should not have to rewrite a shader.
 * `review/measure/P12.mjs` claim B2 walks a 256-step ramp through the real GPU shader and fails if
 * any channel deviates from the CPU mirror of `renderer.toneMapping` by more than 1/512 — which is
 * the only kind of proof that "the grade does not touch the value ladder" can honestly have.
 *
 * What is *not* identity is the short list below, and each is bounded by a number in the bible.
 */
export const LOOK = {
  // --- the grade proper: identity, on purpose (§3.5).
  exposure: 1.0,
  contrast: 1.0,
  pivot: 0.18,
  lift: [0, 0, 0],
  gain: [1, 1, 1],
  gamma: [1, 1, 1],
  saturation: 1.0,

  // --- the display transform. Shoulder 1.0 / white 1.0 makes the VS curve exactly min(x, 1):
  //     §3.5's linear path, with §3.5's "emitters clip; they do not roll off" at the top.
  shoulder: 1.0,
  white: 1.0,

  // --- bloom. §5.4 permits "one pass… tightly gated" and §12.10 names the failure. Threshold is in
  //     scene-linear light and is set from a measured histogram of the live scene target, not from
  //     taste: the brightest *surface* in the frame after §3.2's calibration sits under 1.0 and
  //     every emitter carries an emissive on top of its lit value.
  bloomThreshold: 1.25,
  bloomKnee: 0.35,
  bloomClamp: 8.0,
  bloomStrength: 0.055,

  // --- the sun glow. §6.1: "a glow, not a disc". Weight is multiplied by the screen-space fade in
  //     SunGlowPass, so this is the ceiling rather than the usual value.
  sunGlowStrength: 0.42,

  // --- vignette. Measured on the target: sky at the top-left corner is Y 0.1953 against Y 0.2251
  //     at top-centre and Y 0.4043 at top-right — an 80% swing the *other* way. There is no
  //     vignette in `target-lowpoly.png`; the falloff it appears to have is §6.1's 2.03:1
  //     horizontal sun gradient, which is content. So this is a whisper: 8% at the extreme corner,
  //     exactly 1.0 across the central 72% of the corner radius, and it may never be composition.
  vignetteAmount: 0.08,
  vignetteStart: 0.72,

  // --- grain. Budgeted against §3.3's hard limit rather than chosen: the target's own within-facet
  //     luminance spread measures 0.0096 and anything above 0.02 "means smooth normals leaked in".
  //     One 8-bit code near the mid-tones is already ~0.0045 of luminance, so the dither below
  //     spends about half the budget on its own and the grain gets the rest.
  grainAmount: 0.0018,

  // --- dither. §3.5 makes it binding and gives the witness: the target carries 384 distinct
  //     colours down a 461-row sky column with a longest constant run of 4 rows. 0.5 is ±0.5 of a
  //     code, i.e. exactly one LSB peak to peak — the correct amplitude for an ordered quantiser,
  //     and half the noise of the ±1 code a naive implementation reaches for.
  ditherAmount: 0.5,
};

export class GradePass {
  /**
   * @param {object} enabled  which effects this tier asked for: {bloom, sunGlow, grain, vignette}
   * @param {number} displayMode  one of `DISPLAY_MODE` — mirrors `renderer.toneMapping`
   */
  constructor(enabled, displayMode = DISPLAY_MODE.none) {
    this.enabled = { bloom: false, sunGlow: false, grain: false, vignette: false, ...enabled };
    this.displayMode = displayMode;

    this.material = new THREE.ShaderMaterial({
      name: "vs.post.grade",
      defines: this._defines(),
      uniforms: {
        tScene: { value: null },
        tBloom: { value: null },
        tSunGlow: { value: null },
        uAspect: { value: 16 / 9 },
        uResolution: { value: new THREE.Vector2(1920, 1080) },
        uGrainCell: { value: 1 },
        uDisplayExposure: { value: 1 },
        uExposure: { value: LOOK.exposure },
        uContrast: { value: LOOK.contrast },
        uPivot: { value: LOOK.pivot },
        uShoulder: { value: LOOK.shoulder },
        uWhite: { value: LOOK.white },
        uLift: { value: new THREE.Vector3(...LOOK.lift) },
        uGain: { value: new THREE.Vector3(...LOOK.gain) },
        uGamma: { value: new THREE.Vector3(...LOOK.gamma) },
        uSaturation: { value: LOOK.saturation },
        uBloom: { value: LOOK.bloomStrength },
        uSunGlow: { value: 0 },
        uVignette: { value: LOOK.vignetteAmount },
        uVignetteStart: { value: LOOK.vignetteStart },
        uGrain: { value: LOOK.grainAmount },
        uDither: { value: LOOK.ditherAmount },
      },
      vertexShader: VERTEX,
      fragmentShader: /* glsl */ `
        uniform sampler2D tScene;
        uniform sampler2D tBloom;
        uniform sampler2D tSunGlow;
        uniform float uAspect;
        uniform vec2 uResolution;
        uniform float uGrainCell;
        uniform float uExposure;
        uniform float uContrast;
        uniform float uPivot;
        uniform vec3 uLift;
        uniform vec3 uGain;
        uniform vec3 uGamma;
        uniform float uSaturation;
        uniform float uBloom;
        uniform float uSunGlow;
        uniform float uVignette;
        uniform float uVignetteStart;
        uniform float uGrain;
        uniform float uDither;
        varying vec2 vUv;

        ${LUMINANCE}
        ${FILMIC}
        ${ACES}
        ${DISPLAY}
        ${SRGB_ENCODE}
        ${BAYER}
        ${HASH}

        // Radius normalised so 0 is the frame centre and 1.0 is a corner, measured in frame
        // HEIGHTS so a 21:9 window and a 4:3 window get the same falloff along the short axis.
        float cornerRadius(vec2 uv) {
          vec2 d = (uv - 0.5) * vec2(uAspect, 1.0);
          float corner = length(vec2(uAspect, 1.0) * 0.5);
          return length(d) / corner;
        }

        void main() {
          vec2 uv = vUv;
          vec3 c = max(texture2D(tScene, uv).rgb, 0.0);

          #ifdef VS_BLOOM
            c += texture2D(tBloom, uv).rgb * uBloom;
          #endif
          #ifdef VS_SUNGLOW
            c += texture2D(tSunGlow, uv).rgb * uSunGlow;
          #endif

          #ifdef VS_VIGNETTE
            float v = 1.0 - uVignette * smoothstep(uVignetteStart, 1.0, cornerRadius(uv));
            c *= v;
          #endif

          c *= uExposure;

          // Contrast about a log pivot at mid-grey. In linear this is a power law that leaves 0 at
          // 0 and uPivot at uPivot, so it adds mid-tone separation without moving the black point
          // or the exposure. Ships at 1.0, which is an exact wire.
          if (uContrast != 1.0) {
            c = uPivot * exp2(log2(max(c, 1e-5) / uPivot) * uContrast);
          }

          c = vsDisplay(c);                       // -> display-linear. A mirror, not a look.

          // Lift / gamma / gain, the classic three-way, on bounded values. All identity as shipped.
          c = clamp(c, 0.0, 1.0);
          c = uLift + c * (uGain - uLift);
          c = pow(max(c, 0.0), 1.0 / uGamma);

          if (uSaturation != 1.0) {
            c = mix(vec3(vsLum(c)), c, uSaturation);
          }
          c = clamp(c, 0.0, 1.0);

          #ifdef VS_GRAIN
            // Static tile in DEVICE pixels, with a cell size that grows with resolution so the
            // grain is the same apparent size at 720p and at 4K. Windowed by luminance: none in
            // the blacks, where §7.4 budgets only 0.44% of frame below Y 0.004 and noise would
            // read as a broken shadow, and none in the highlights, where §5.4 needs the accent
            // clean.
            float y = vsLum(c);
            float g = vsHash(floor(gl_FragCoord.xy / uGrainCell)) - 0.5;
            float gw = smoothstep(0.02, 0.14, y) * (1.0 - smoothstep(0.55, 0.95, y));
            c = clamp(c + g * uGrain * gw, 0.0, 1.0);
          #endif

          vec3 s = vsEncodeSRGB(c);

          // The last operation in the frame, at 8-bit quantisation, from a fixed tile indexed in
          // device pixels. No time term: see BAYER in glsl.js.
          s += (vsBayer8(gl_FragCoord.xy) - 0.5) * (uDither * 2.0 / 255.0);

          gl_FragColor = vec4(clamp(s, 0.0, 1.0), 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

    this.blit = new Blit(this.material);
  }

  _defines() {
    const d = { VS_DISPLAY: String(this.displayMode) };
    if (this.enabled.bloom) d.VS_BLOOM = "";
    if (this.enabled.sunGlow) d.VS_SUNGLOW = "";
    if (this.enabled.grain) d.VS_GRAIN = "";
    if (this.enabled.vignette) d.VS_VIGNETTE = "";
    return d;
  }

  /** Recompile with a different effect set or display transform. Rare: a tier or a debug toggle. */
  configure({ enabled, displayMode } = {}) {
    if (enabled) this.enabled = { ...this.enabled, ...enabled };
    if (displayMode !== undefined) this.displayMode = displayMode;
    this.material.defines = this._defines();
    this.material.needsUpdate = true;
  }

  /** Apply a subset of `LOOK`. Every key is a live uniform; nothing here recompiles. */
  setLook(patch) {
    const u = this.material.uniforms;
    const map = {
      exposure: "uExposure",
      contrast: "uContrast",
      pivot: "uPivot",
      shoulder: "uShoulder",
      white: "uWhite",
      saturation: "uSaturation",
      bloomStrength: "uBloom",
      vignetteAmount: "uVignette",
      vignetteStart: "uVignetteStart",
      grainAmount: "uGrain",
      ditherAmount: "uDither",
    };
    for (const [k, name] of Object.entries(map)) {
      if (patch[k] !== undefined) u[name].value = patch[k];
    }
    for (const k of ["lift", "gain", "gamma"]) {
      if (patch[k]) u[`u${k[0].toUpperCase()}${k.slice(1)}`].value.set(...patch[k]);
    }
  }

  setSize(width, height, aspect) {
    const u = this.material.uniforms;
    u.uResolution.value.set(width, height);
    u.uAspect.value = aspect;
    // One grain cell per device pixel at 1080p, 2x2 at 4K: constant apparent grain size.
    u.uGrainCell.value = Math.max(1, Math.round(height / 1080));
  }

  render(renderer, sceneTexture, bloomTexture, sunGlowTexture, sunGlowWeight, exposure, target) {
    const u = this.material.uniforms;
    u.tScene.value = sceneTexture;
    u.tBloom.value = bloomTexture;
    u.tSunGlow.value = sunGlowTexture;
    u.uSunGlow.value = sunGlowWeight;
    u.uDisplayExposure.value = exposure;
    this.blit.render(renderer, target);
  }

  dispose() {
    this.blit.dispose();
  }
}

export { DISPLAY_MODE };
