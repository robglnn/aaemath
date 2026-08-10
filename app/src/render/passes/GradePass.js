import * as THREE from "three";
import { Blit, VERTEX } from "./FullScreenPass.js";
import { LUMINANCE, FILMIC, SRGB_ENCODE, BAYER, HASH } from "./glsl.js";

/**
 * The output pass: everything that happens between "linear light" and "an 8-bit sRGB code".
 *
 * Six of the brief's passes live in this one draw — bloom composite, god-ray composite,
 * chromatic aberration, colour grade, vignette, grain, plus the dither §10 makes binding — and
 * that is a deliberate architectural choice, not a shortcut. At 3840x2160 a full-screen pass
 * costs 8.3 M fragments; running vignette, grain and CA as three separate ping-pong passes
 * would cost three extra 16-bit round trips through memory for maybe twenty ALU operations of
 * work. Each effect is still an independently owned unit with its own `#define`, its own
 * uniforms and its own entry in `config.tier.postStack` — a tier that does not ask for grain
 * compiles a shader with no grain instructions in it at all, which is cheaper than any amount
 * of branching.
 *
 * ORDER MATTERS, and here is the order with the reason for each position:
 *
 *   1. chromatic aberration   scene fetch      a lens artefact; it happens to light before the
 *                                              sensor, so it must precede everything else
 *   2. + bloom, + god-rays    scene-linear     §8: the halo composites in linear, BEFORE the
 *                                              curve. Additive, never a lerp — a lerp would
 *                                              take brightness *away* from the emitter core
 *   3. vignette               scene-linear     it is lost light, i.e. an exposure falloff. Put
 *                                              after the curve it crushes corners instead of
 *                                              rolling them off
 *   4. exposure + contrast    scene-linear     contrast is applied around a log pivot at 0.18
 *                                              so it pivots on mid-grey and does not shift the
 *                                              black point
 *   5. FILMIC CURVE           -> display       the one non-linearity. See glsl.js
 *   6. lift / gamma / gain    display 0..1     the grade proper. Bounded input, bounded output
 *   7. saturation             display          restores what the shoulder took, no more
 *   8. grain                  display          fixed screen-space tile, luminance-windowed
 *   9. sRGB encode            display -> code  the ONLY encode in the frame (§12.19)
 *  10. ordered Bayer dither   code             §10: "the dither is the LAST operation"
 *
 * Nothing in this pass reads the clock, the frame index or the camera. Every screen-space
 * pattern is a pure function of `gl_FragCoord`, so §15.1's `M1a`/`M6` and §15.4's `M4` are
 * zero by construction rather than by tuning.
 */

/**
 * The look. Every value here is a decision with a document reference, not a taste.
 *
 * `lift` and `gain` are the split-tone, and they are pointed at two colours that already exist
 * in `design/palette.json`: the blacks go a whisper toward `rock.shadow` #55505E (§3(a) makes
 * sky shadow a desaturated violet-slate, and §13 check 2 ranks a warm shadow as the single
 * biggest still-frame tell that a render has no art direction), and the whites go a whisper
 * toward `sky.sun` #FFE8A0 (§2: the key is off the Planckian locus, green-lifted, blue-cut).
 *
 * The magnitudes are small on purpose. A grade is allowed to *support* the light rig; it is not
 * allowed to *be* the light rig. `review/measure/P12.mjs` claim C4 reports how far the grade
 * moves the shadow-cool share `X1` measures, so a critic can see the size of the thumb on the
 * scale rather than take a builder's word for it.
 */
export const LOOK = {
  exposure: 1.0,
  contrast: 1.06, // gentle S about a log pivot; 1.0 is a straight wire
  pivot: 0.18, // scene-linear mid-grey
  shoulder: 0.52, // S in the filmic curve
  white: 1.0, // W — the asymptote
  lift: [0.0035, 0.0, 0.009], // blacks toward rock.shadow's violet-slate
  gain: [1.0, 0.995, 0.973], // whites toward sky.sun's green-lifted, blue-cut warm
  gamma: [1.0, 1.0, 1.0],
  saturation: 1.06, // the shoulder desaturates; this gives a little of it back
  bloomStrength: 0.052,
  godRayStrength: 0.55,
  vignetteAmount: 0.14,
  vignetteStart: 0.55, // fraction of the corner radius where falloff begins
  grainAmount: 0.0085, // display-linear peak, ~2 code values in the mid-tones
  caAmount: 0.0022, // in frame HEIGHTS, not pixels — §12.29
  caStart: 0.68,
  ditherAmount: 1.0, // +-1 code value, §10
};

export class GradePass {
  /**
   * @param {object} enabled  which effects this tier asked for: {bloom, godrays, grain, vignette, ca}
   */
  constructor(enabled) {
    const defines = {};
    if (enabled.bloom) defines.VS_BLOOM = "";
    if (enabled.godrays) defines.VS_GODRAYS = "";
    if (enabled.grain) defines.VS_GRAIN = "";
    if (enabled.vignette) defines.VS_VIGNETTE = "";
    if (enabled.ca) defines.VS_CA = "";
    this.enabled = { ...enabled };

    this.material = new THREE.ShaderMaterial({
      name: "vs.post.grade",
      defines,
      uniforms: {
        tScene: { value: null },
        tBloom: { value: null },
        tGodRay: { value: null },
        uAspect: { value: 16 / 9 },
        uResolution: { value: new THREE.Vector2(1920, 1080) },
        uGrainCell: { value: 1 },
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
        uGodRay: { value: 0 },
        uVignette: { value: LOOK.vignetteAmount },
        uVignetteStart: { value: LOOK.vignetteStart },
        uGrain: { value: LOOK.grainAmount },
        uCa: { value: LOOK.caAmount },
        uCaStart: { value: LOOK.caStart },
        uDither: { value: LOOK.ditherAmount },
      },
      vertexShader: VERTEX,
      fragmentShader: /* glsl */ `
        uniform sampler2D tScene;
        uniform sampler2D tBloom;
        uniform sampler2D tGodRay;
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
        uniform float uGodRay;
        uniform float uVignette;
        uniform float uVignetteStart;
        uniform float uGrain;
        uniform float uCa;
        uniform float uCaStart;
        uniform float uDither;
        varying vec2 vUv;

        ${LUMINANCE}
        ${FILMIC}
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
          float r = cornerRadius(uv);

          vec3 scene;
          #ifdef VS_CA
            // Extreme edge only. k is zero for the whole central region and rises as the square
            // of a smoothstep, so the transition has no visible onset. uCa is in frame heights,
            // so the split is the same fraction of the picture at 720p and at 4K (§12.29).
            float k = smoothstep(uCaStart, 1.0, r);
            k *= k;
            vec2 dir = (uv - 0.5) * vec2(uAspect, 1.0);
            dir = dir / max(length(dir), 1e-4);
            vec2 off = dir * (uCa * k) * vec2(1.0 / uAspect, 1.0);
            scene = vec3(
              texture2D(tScene, uv - off).r,
              texture2D(tScene, uv).g,
              texture2D(tScene, uv + off).b
            );
          #else
            scene = texture2D(tScene, uv).rgb;
          #endif
          scene = max(scene, 0.0);

          vec3 c = scene;

          #ifdef VS_BLOOM
            // Additive, in linear, before the curve — §8. A lerp here would dim the emitter
            // core it is supposed to be haloing, and §0.4 requires the live claim to stay the
            // brightest thing in frame that is not the sun.
            c += texture2D(tBloom, uv).rgb * uBloom;
          #endif
          #ifdef VS_GODRAYS
            c += texture2D(tGodRay, uv).rgb * uGodRay;
          #endif

          #ifdef VS_VIGNETTE
            // Lost light, so it multiplies scene-linear radiance and then goes through the
            // curve like everything else. Anti-pattern 13 is a vignette used AS composition;
            // this one is 14% at the corner and exactly 1.0 across the central half of frame.
            float v = 1.0 - uVignette * smoothstep(uVignetteStart, 1.0, r);
            c *= v;
          #endif

          c *= uExposure;

          // Contrast about a log pivot at mid-grey. In linear this is a power law that leaves
          // 0 at 0 and 0.18 at 0.18, so it adds mid-tone separation without moving the black
          // point or the exposure — which is the legibility half of "grade", as opposed to the
          // mood half below.
          c = uPivot * exp2(log2(max(c, 1e-5) / uPivot) * uContrast);

          c = vsFilmic(c);                 // -> display-linear, per channel

          // Lift / gamma / gain, the classic three-way, on bounded values.
          c = clamp(c, 0.0, 1.0);
          c = uLift + c * (uGain - uLift);
          c = pow(max(c, 0.0), 1.0 / uGamma);

          float y = vsLum(c);
          c = mix(vec3(y), c, uSaturation);
          c = clamp(c, 0.0, 1.0);

          #ifdef VS_GRAIN
            // Static tile in DEVICE pixels, with a cell size that grows with resolution so the
            // grain is the same apparent size at 720p and 4K. Windowed by luminance: none in
            // the blacks (where it would read as noise in §10's dark lobe) and none in the
            // highlights (where §0.4 needs the live claim clean).
            float g = vsHash(floor(gl_FragCoord.xy / uGrainCell)) - 0.5;
            float gw = smoothstep(0.02, 0.14, y) * (1.0 - smoothstep(0.55, 0.95, y));
            c += g * uGrain * gw;
          #endif

          vec3 s = vsEncodeSRGB(c);

          // The last operation in the frame, at 8-bit quantisation, from a fixed tile indexed
          // in device pixels. §10 and §15.4; `M4` is zero because there is no time term.
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

  setSize(width, height, aspect) {
    const u = this.material.uniforms;
    u.uResolution.value.set(width, height);
    u.uAspect.value = aspect;
    // One grain cell per device pixel at 1080p, 2x2 at 4K: constant apparent grain size.
    u.uGrainCell.value = Math.max(1, Math.round(height / 1080));
  }

  render(renderer, sceneTexture, bloomTexture, godRayTexture, godRayStrength, target) {
    const u = this.material.uniforms;
    u.tScene.value = sceneTexture;
    u.tBloom.value = bloomTexture;
    u.tGodRay.value = godRayTexture;
    u.uGodRay.value = godRayStrength;
    this.blit.render(renderer, target);
  }

  dispose() {
    this.blit.dispose();
  }
}
