#!/usr/bin/env node
/**
 * P02 scratch: emit design/palette.json with exact linear-RGB triplets.
 * Hand-computing 40 linear triplets is how you get a bible full of wrong numbers.
 * Every `measured` field cites the sample that produced the value; see
 * review/p02-reference-measurements-*.json.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const s2l = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const lin = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => +s2l(v).toFixed(4));
};
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const Y = (hex) => { const l = lin(hex); return +(0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]).toFixed(4); };
const hsv = (hex) => {
  let [r, g, b] = rgb(hex).map(v => v / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 0) { if (mx === r) h = 60 * (((g - b) / d) % 6); else if (mx === g) h = 60 * ((b - r) / d + 2); else h = 60 * ((r - g) / d + 4); }
  if (h < 0) h += 360;
  return [Math.round(h), +(mx === 0 ? 0 : d / mx).toFixed(3), +mx.toFixed(3)];
};
const C = (hex, extra = {}) => ({ hex, rgb: rgb(hex), linear: lin(hex), hsv: hsv(hex), luminance: Y(hex), ...extra });

const roles = {

  // ─────────────────────────── SKY ───────────────────────────
  'sky.zenith': C('#8DACBC', {
    measured: 'reference y=0.00, x=0.245',
    allowed: 'Top of the sky dome only, above y=0.06 of the frame. The hemisphere-fill light colour.',
    forbidden: 'Never as an object albedo. Never as a UI surface — it is too close to sky.horizon in value and UI will vanish against it.'
  }),
  'sky.upper': C('#A9BAC7', {
    measured: 'reference y=0.08',
    allowed: 'Sky dome between y=0.06 and y=0.14.'
  }),
  'sky.pivot': C('#C7C3B8', {
    measured: 'reference y≈0.21 (#CAC1B5, S=0.104 — the saturation minimum of the whole sky column)',
    allowed: 'The neutral crossover band where the cool upper sky becomes the warm horizon. Must exist. It is the single feature that stops the sky reading as a two-colour lerp.',
    forbidden: 'Never skip it. A zenith→horizon gradient that does not pass through S<0.14 looks like a shader default.'
  }),
  'sky.horizon': C('#F1C9A6', {
    measured: 'reference y=0.30, x=0.245',
    allowed: 'Sky within 0.06 of the horizon line; the aerial-perspective target colour for all distant geometry.',
    forbidden: 'Never as a light colour — it is the *result* of the key through atmosphere, not the key.'
  }),
  'sky.sun': C('#FFE8A0', {
    measured: 'reference (0.93, 0.335); measured peak Y 0.815, highlight sample #FFFFB4',
    allowed: 'The sun disc/glow, off to camera-right at the horizon, and the key light colour. May exceed Y 0.95 in a region ≤0.6% of the frame.',
    forbidden: 'Never a lens flare with visible ghosts.'
  }),

  // ────────────────────────── AURORA ─────────────────────────
  'aurora.mint': C('#C1EACA', {
    measured: 'reference y=0.18, x=0.245 (hue 133, S 0.175, Y 0.745)',
    allowed: 'Primary aurora band. Additive over the sky, S must stay ≤0.22.',
    forbidden: 'Never above S 0.30. A saturated green aurora is the fastest way to look like a screensaver.'
  }),
  'aurora.teal': C('#B4D3C8', {
    measured: 'reference y=0.14 (hue 159, S 0.147)',
    allowed: 'Secondary aurora band, lower and cooler than aurora.mint; the vertical curtain striations.'
  }),
  'aurora.violet': C('#C6C2D4', {
    measured: 'NOT IN THE REFERENCE as an aurora. A magenta-cast hunt over the whole left sky found no rose band — the strongest "cast" sample was warm sky (#E3AB97). The reference\'s upper-left sky is a near-neutral cool blue-grey (#AFB1B4, hue 216, S 0.028). This colour is an authored third band at hue 253, S 0.085.',
    allowed: 'A third, weakest aurora band, opposite the sun, S ≤0.12. It exists to give a long session some sky variety the single reference frame does not have to show.',
    forbidden: 'Never strong enough for a viewer to name it. If somebody says "the purple aurora", it is too strong. Never near hue 346 — that arc belongs to `danger` and nothing else.'
  }),

  // ─────────────────────────── ROCK ──────────────────────────
  'rock.warm.lit': C('#FFAF5C', {
    measured: 'plinth face #FF914B (Y 0.420) and terrace top #FFC47F (Y 0.623); this is their working mid',
    allowed: 'Rock facets whose normal is within 35° of the key. The signature warm of the world.'
  }),
  'rock.warm.mid': C('#D0844F', {
    measured: 'between #B27250 (Y 0.221, grazing) and #FF914B (Y 0.420, full key)',
    allowed: 'The colour a player would name if asked "what colour is the rock". Terrain, cliffs, boulders, the plinth, mesa tops and faces at mid distance.',
    forbidden: 'Never on the hero, never on UI, never on anything the player can interact with — interactables are cyan-marked.'
  }),
  'rock.warm.low': C('#9E6244', {
    measured: 'grazing-angle lit rock',
    allowed: 'Rock facets at grazing key incidence, and the warm bounce-shadow family (see art-direction.md §3 shadow family b).'
  }),
  'rock.shadow': C('#55505E', {
    measured: 'terrace shadow at (0.872, 0.610) = #574F5C, hue 277, S 0.141, Y 0.085, against the same terrace lit at #FFC87F, hue 34, S 0.502, Y 0.641. Deep foreground shadow at (0.700, 0.860) = #1C151D, hue 293.',
    note: 'This is the most important colour in the palette. Rock shadow is a desaturated VIOLET-SLATE, not a dark orange. Lit→shadow on a sky-facing surface is hue +230…+245° (equivalently −115…−120°, which is the way the ramp actually travels), saturation ×0.28, luminance ×0.13.',
    rampPath: 'Verified by a vertical cut down the terrace face at x=0.885: hue 26 → 18 → 15 → 9 → 353 → 343 → 338 (mid shadow, S 0.29–0.32, Y 0.140) → 260 (deep shadow, S 0.13, Y 0.093). The hue rotates BACKWARDS through red and rose into violet. It does not pass through green. Metal does the opposite — see hero.armour.ramp.',
    allowed: 'Sky-facing rock surfaces turned away from the key, with no warm bounce and no nearby emitter.',
    forbidden: 'Never produced by multiplying the albedo. If your shadows are brown, the render is already losing.'
  }),
  'rock.shadow.deep': C('#221C28', {
    measured: 'deepest foreground shadow #1C151D (hue 293, Y 0.0087)',
    allowed: 'Occlusion cores, crevices, under-ledges, contact shadows. The darkest world value that is not ink.'
  }),
  'rock.bone': C('#AA9087', {
    measured: 'the ruin tower at x 0.175–0.215, y 0.230–0.290: shadow side #948382 / #968482 / #9D8984 / #978885 / #958A86 (hue 3–16, S 0.09–0.16), key-lit side #D1A38B / #C39B8D / #AA8F86 (hue 15–21, S 0.21–0.33). This role is the mid-tone of those two means.',
    note: 'The bone stone of the ruins, and the material §5 of art-direction.md gives roughness and ink rules for but round 1 never gave a colour. It is a DESATURATED warm grey — not the orange of rock.warm.*, and that difference is what makes ruins read as built rather than eroded. The samples sit at mid distance and therefore already carry the aerial wash of §7: bone stone standing in the FOREGROUND should be authored ~15% more saturated and a few degrees warmer, near #B08872.',
    allowed: 'Ruin masonry, fallen columns, the megacity\'s near towers, any cut stone. Cyan inlays on it are separate emissive strips, never a tint of this colour.',
    forbidden: 'Never on terrain — terrain is rock.warm.*. If the player can walk on it as ground, it is not bone stone.'
  }),
  'world.foliage': C('#A2D7A6', {
    measured: 'six ground-cover reads: #B7EDBA (0.170,0.440), #BBFBC6 (0.500,0.550), #BDF3BD (0.120,0.530), #ACE2A9 (0.165,0.575), #8CB592 (0.217,0.567), #8ACA82 (0.020,0.860). Hue 113–140, S 0.20–0.36, mean of the set hue 126 / S 0.25.',
    census: 'Hue 70–119° at S ≥ 0.06 is 4.0% of the frame (n = 42 428 at half-res). Its saturation histogram: 28.5% below S 0.10, 42.8% in 0.10–0.20, 23.8% in 0.20–0.30, only 4.8% above S 0.30 and 0.5% above S 0.40.',
    note: 'THE role that keeps `success` safe. World green and the success flash occupy the same hue arc — the reference carries ground cover at 117° and success is authored at 107° — so they are separated by SATURATION, exactly the way `danger` is separated from rose rock shadow. World green lives at S ≤ 0.30 (95% of it does); success is S 0.542 and is only ever counted above S 0.45.',
    allowed: 'Ground cover, moss on the river banks, low scrub, the green skirt of a mesa. Always below S 0.30.',
    forbidden: 'Never above S 0.35 — at that point it starts to be read as a success event. Never as an emissive; if it glows it is resonance.flow, not foliage.'
  }),
  'rock.albedo': C('#B4744C', {
    allowed: 'Material author input only — the diffuse albedo you type into Materials.js. It is never a pixel colour; it is what rock.warm.* and rock.shadow are rendered *from*.',
    note: 'Calibration: this albedo facing the key at the specified exposure must render at Y 0.42 ±0.05; facing away under open sky, at Y 0.07 ±0.02. That 6.2:1 ratio is the key:fill target — see solvedConstants.keyToFill, which records the boxes it was measured on.'
  }),

  // ──────────────────────── RESONANCE ────────────────────────
  'resonance.core': C('#2FE3D6', {
    measured: 'hero accent slot #19D7D0 (hue 178, S 0.884 — the most saturated pixel family in the reference); emitter socket #73E6E7',
    note: 'The identity colour of the project. It means exactly one thing: mathematics is live here.',
    allowed: 'Emitter cores, hologram data lines, hero accent channels, interactable markers, resonance crystals, the HUD accent.',
    forbidden: 'Never on rock, never on skin, never on terrain, never as a general "sci-fi" tint. Never on anything that is not either mathematics or the player\'s connection to it. Hard budget: pixels at S≥0.55 in hue 150–215 must be 2–5% of the frame.'
  }),
  'resonance.bloom': C('#9EF3F0', {
    measured: 'socket highlight sample #9EF3F0 (Y 0.737); crystal highlight #CAFFFF',
    allowed: 'The halo around any resonance emitter, the falloff of a light shaft, the Fresnel rim on crystal.',
    note: 'The halo is AUTHORED, not measured. Annular means about the true socket centre (0.634, 0.704) are flat — 0.396 / 0.402 / 0.410 / 0.376 / 0.383 / 0.325 / 0.257 at r = 1/2/3/4.6/6.5/9/12% of frame height — because every annulus crosses lit rock, cast light and shadow as well as glow, so a radial profile through this frame cannot isolate the bloom kernel. Round 1 published a falloff table (0.74/0.69/0.45/0.29) that no annular sampling reproduces; it is withdrawn. Author two lobes instead: a tight core at σ ≈ 0.6% of frame height and a wide halo whose half-intensity radius is 6% of frame height.'
  }),
  'resonance.hot': C('#E9FFFB', {
    measured: 'brightest pixel inside the socket\'s emissive mask (hue 150–215, or S ≤ 0.12 with Y > 0.60, searched over x 0.54–0.74, y 0.62–0.82): #E7FEFD, Y 0.9496, at (0.6344, 0.7038). Blown resonance (Y ≥ 0.90, hue 150–215) is 0.18% of the frame.',
    allowed: 'The blown centre of an emitter, ≤0.4% of the frame. Every emitter must have one — an emissive with no white-hot core reads as a painted decal, not a light.'
  }),
  'resonance.flow': C('#3FCFA0', {
    measured: 'river #399985 (hue 168, S 0.627) and #428164 under haze; the ribbon reads greener than the crystal',
    allowed: 'Liquid resonance: the river, flowing channels, spill from a solved equation. Greener than resonance.core by ~14° of hue so the fluid and the solid read as different substances.'
  }),
  'resonance.deep': C('#0E5F63', {
    allowed: 'Dormant/unsolved resonance — crystal that has not been charged, a hologram that has not been engaged. Same hue family, one third the luminance, no bloom, no core.'
  }),

  // ─────────────────────────── HERO ──────────────────────────
  'hero.armour': C('#B8874F', {
    measured: 'perceptual mid of the measured five-stop ramp; see `ramp`',
    note: 'Champagne-gold plate metal. Read at distance it is a warm mid; up close it is a five-stop ramp whose saturation PEAKS in the light band and DROPS in the specular.',
    ramp: [
      { stop: 'shadow', ...C('#34494C'), measuredAt: 'hero cut y=0.60, x=0.379 — hue 185, S 0.32' },
      { stop: 'terminator', ...C('#68704F'), measuredAt: 'x=0.388 — hue 68, S 0.26; the ramp travels through olive, it is not an RGB lerp' },
      { stop: 'mid', ...C('#AB804F'), measuredAt: 'x=0.3935 — hue 32, S 0.54' },
      { stop: 'light', ...C('#FDB755'), measuredAt: 'x=0.3972 — hue 35, S 0.67 — saturation maximum' },
      { stop: 'specular', ...C('#FFFCA0'), measuredAt: 'x=0.4001 — hue 60, S 0.37 — desaturates and shifts yellow' }
    ],
    allowed: 'Hero plate armour, ruin fittings, any crafted metal.',
    forbidden: 'Never on rock. Never as a UI colour except reward.gold.'
  }),
  'hero.undersuit': C('#2C4448', {
    measured: 'hero cut x=0.3783–0.3855: hue 180–189, S 0.18–0.32, Y 0.020–0.041',
    allowed: 'The soft suit under the plates, the inside of joints, anything on the hero that must recede. This is the hero\'s shadow value and it is TEAL, because the hero stands in resonance light.'
  }),
  'hero.accent': C('#1FD9D2', {
    measured: 'shoulder-blade slot #19D7D0 (hue 178, S 0.884, Y 0.534). Component census over the hero box at hue 150–215, S ≥ 0.45, V ≥ 0.62: 61 components, 21 of them ≥ 90 px on a 2752-wide frame, together 4.09% of the hero\'s silhouette area.',
    allowed: 'The emissive channels on the hero, by zone: two SHOULDER-BLADE slots, five spine chevrons, one band per forearm, one strip per shin, one strip per boot cuff. Those are the zones legible on the reference, which is a BACK view — whether the chest carries a matching pair is an inference, not a measurement, and is not authorised here.',
    forbidden: 'More than 4% of the hero\'s silhouette area (measured 4.09% at the threshold above, so 4% is the ceiling, not a target). The accents are punctuation, not a paint job.',
    note: 'Round 1 published a total of "eleven elements" and called the shoulder slots chest slots. Both were wrong: the reference is a back view, and no single count survives a change of threshold — the component census moves from 61 to 21 between a 1 px and a 90 px minimum area. Author by ZONE and hold the AREA budget; never code to a count.'
  }),
  'hero.skin': C('#E3A170', {
    measured: 'lit #FE964E (hue 25, S 0.69) / shadow #A4674B (hue 19, S 0.54, Y 0.181)',
    note: 'Skin is the one material that does NOT take the violet shadow rotation. Skin shadow keeps its hue (Δ ≤8°), loses only 22% saturation, and only drops to 0.42× luminance — a 2.4:1 key:fill against rock\'s 7:1. That is why the face still reads when the body is in shadow.',
    ramp: [{ stop: 'shadow', ...C('#A4674B') }, { stop: 'mid', ...C('#E3A170') }, { stop: 'rim', ...C('#FE964E') }]
  }),
  'hero.hair': C('#4A2E1E', {
    measured: 'dark #201C16 (Y 0.012) / lit #66341A (hue 21, S 0.745)',
    ramp: [{ stop: 'core', ...C('#201C16') }, { stop: 'mid', ...C('#4A2E1E') }, { stop: 'lit', ...C('#8A4A22') }, { stop: 'rim', ...C('#E0A050') }],
    allowed: 'Hair only. The near-black core is what carries the silhouette at thumbnail size.'
  }),
  'hero.ink': C('#140D0A', {
    measured: 'silhouette outline sampled across the hero cut: #100402, #0C0F0E, #280500 — Y 0.0016–0.0056, warm, never neutral black',
    note: 'Screen-space contour. Widths are THRESHOLD-DEPENDENT and are quoted with their threshold: horizontal runs at Y ≤ 0.012 inside the hero box on a 2752-wide frame give p25 = 2, median = 3, p75 = 4, p90 = 7 px (n = 8255); at Y ≤ 0.006, 2/3/4/6 (n = 6690); at Y ≤ 0.020, 2/4/5/10 (n = 8528). Median 3 px at 2752 = 0.11% of frame width ≈ 1.7 px at 1600×900. What survives every threshold is the TAPER — p90 is 2–2.5× the median — and that is what the auditor checks (I1).',
    allowed: 'Hero silhouette and interior breaks; foreground interactables; foreground terrain silhouettes inside ~18 m.',
    forbidden: 'Never beyond the foreground band — measured: no ink survives past the midground. Never uniform width. Never pure #000000.'
  }),

  // ────────────────────────── HOLOGRAM ───────────────────────
  'holo.veil': C('#6BBFC2', {
    measured: 'n = 116 paired inside/outside samples taken normal to all four edges of the panel quad, over four different backgrounds (bright sky above, hazy mesas left, the dark city right, the valley below), background range Y 0.19–0.79. Background is extrapolated across the edge from a four-sample line outside it, so a sloped backdrop cannot masquerade as transmission. Best fit at an interior offset of 0.008 of frame width: Y_in = 0.462·Y_bg + 0.240, r² 0.896, fixed point Y 0.446.',
    note: 'THE hologram rule: the panel is neither additive nor multiplicative. It COMPRESSES whatever is behind it toward a FIXED POINT. Measured deltas by side: over the bright sky above it darkens by 0.137, over the hazy mesas by 0.030; over the dark city it LIGHTENS by 0.062. That is why the panel never blows out and never goes muddy, on any background.',
    fixedPointY: 0.44,
    alpha: 0.50,
    solveConfidence: 'The FIXED POINT is hard, the ALPHA is soft. Sweeping the interior sample offset from 0.008 to 0.018 of frame width moves the fitted slope from 0.462 to 0.335 (alpha 0.54→0.67) while the fixed point only moves 0.446→0.417. Three further independent estimators — a naive no-extrapolation fit (slope 0.558), the four-edge extrapolated fit at offset 0.012 (0.423), and an eleven-pair left-edge-only fit (0.672) — all land inside slope 0.34–0.67 and fixed point 0.42–0.45. Author alpha 0.50 ± 0.08 and fixedPointY 0.44 ± 0.02; the auditor (V1) checks the LAW, not the digit.',
    allowed: 'The fill of any in-world mathematics panel.',
    forbidden: 'Never an additive quad — additive dies against a bright sky. Never a flat dark quad — that reads as a menu, not a projection. Never a constant-alpha black plate: the fixed point must be a MID luminance (0.44), which is what makes the panel lighten dark backdrops as well as darken bright ones.'
  }),
  'holo.stroke': C('#B4E1E0', {
    measured: 'corner bracket #B4E1E0 (hue 179, S 0.20, Y 0.689); border stroke #BFD4CE',
    allowed: 'The 1px rounded-rect border of a panel and its four inset corner brackets. The brackets are thinner and sit ~4% of panel width in from each corner.'
  }),
  'holo.glyph': C('#FFFFFF', {
    measured: 'glyph interior sampled at #FFFFFF, Y = 1.000 — the mathematics is the brightest thing in the frame',
    note: 'Non-negotiable: KaTeX glyphs render pure white. Chrome is cyan, mathematics is white. Contrast against the veil-compressed background is ≥2.2× luminance everywhere by construction.',
    allowed: 'Rendered KaTeX glyphs and axis lines only.',
    forbidden: 'Never tint the mathematics cyan. A cyan equation on a cyan panel is the single most common way this genre fails to be legible.'
  }),
  'holo.data': C('#41FEEA', {
    measured: 'plotted line #41FEEA (hue 174, S 0.744, Y 0.780)',
    allowed: 'Plotted functions, data curves, the moving parts of a graph — the things whose *value* the player is reading.',
    note: 'White = the statement. Cyan = the answer. That split is the whole visual grammar of the hologram.'
  }),

  // ──────────────────────────── UI ───────────────────────────
  'ui.ink': C('#E8F1F0', {
    allowed: 'Primary UI text and iconography. Cool near-white so it never competes with hero.armour or rock.warm.*.',
    note: 'Contrast floor: 4.5:1 against ui.surface at its composited alpha, at every viewport size in the gate list.'
  }),
  'ui.ink.dim': C('#B5BEBD', {
    measured: 'the "[Press E to Interact]" secondary line',
    allowed: 'Secondary text, keycap labels, disabled state.'
  }),
  'ui.ink.accent': C('#9DEAF0', {
    measured: 'the "ANALYZING DATA... (0%)" heading',
    allowed: 'One accented string per surface — the thing the player must read first. Never two.'
  }),
  'ui.surface': C('#2A3134', {
    measured: 'minimap fill composites to #393D3F–#45494C over a sky of Y≈0.70; that solves to this plate at alpha ≈0.94. Bar track measures #3A4247.',
    alpha: 0.94,
    allowed: 'Discrete UI panels: minimap, bar tracks, menu cards, tooltip bodies. Cool dark slate.',
    forbidden: 'Never fully opaque — the 6% of world that shows through is what stops a panel looking pasted on. Never warm.'
  }),
  'ui.scrim': C('#0B0B0B', {
    measured: 'The band spans y 0.8418–0.9577 (0.116 of frame height) with HARD top and bottom edges. Transmission was solved per column at both edges (samples 7 px either side, a second outside sample at 15 px vetoing columns where the facet is not locally smooth), then alpha and the plate colour recovered per column by regressing the three CHANNELS against each other — the three background channels differ by 4×, so that line is well conditioned where a regression across columns is not. Over x 0.40–0.60, n = 146 column solves: median alpha 0.908 (IQR 0.905–0.915), plate linear 0.0034 → #0B0B0B, median luminance transmission 0.110.',
    alphaPeak: 0.91,
    alphaProfile: {
      form: 'horizontal linear ramp, flat middle',
      xExtent: [0.24, 0.79],
      rampWidthFracOfFrameWidth: 0.16,
      note: 'alpha(x) = alphaPeak clamped by a linear ramp from 0 at each end of xExtent to alphaPeak 0.16 of frame width inboard. Constant in y. Reproduce with: a = alphaPeak * clamp(min(x - x0, x1 - x)/rampWidth, 0, 1).'
    },
    measuredProfile: 'Transmission along the band, median-smoothed, at 0.01 steps of x: 1.00 up to x 0.26, then 0.90 / 0.78 / 0.69 / 0.63 / 0.53 / 0.41 / 0.34 / 0.24 / 0.20 / 0.11 across x 0.2675→0.3625, plateau 0.107–0.124 over x 0.40→0.63, then 0.15 / 0.27 / 0.44 / 0.45 / 0.52 / 0.95 across x 0.6425→0.795, and 1.00 from x 0.80. Both band edges give the same profile independently.',
    witness: 'Two columns, the same rock facet, the same four rows, 0.17 of frame width apart. x = 0.30: above the band (y 0.836) #986448 Y 0.1626 → inside (y 0.848) #784D3B Y 0.0962 → inside (y 0.955) #764D3C Y 0.0949 → below (y 0.962) #936552 Y 0.1612. Transmission 0.59, alpha 0.41. x = 0.47: above #9D6549 Y 0.1696 → inside #32221A Y 0.0190 → inside #332018 Y 0.0180 → below #97654A Y 0.1638. Transmission 0.11, alpha 0.89. Both are correct; a single-alpha model of this surface is not.',
    note: 'The reference\'s subtitle band LOOKS like a warm brown bar. It is neither warm nor a bar. It is a NEUTRAL near-black plate — inside it the rock reads #794E3C (hue 18, S 0.51) against #9A644C (hue 21, S 0.52) outside, i.e. the hue and saturation are unchanged and all the warmth is transmitted rock — and its alpha RAMPS TO ZERO at both ends. The ramp is the whole reason it does not read as a black bar: the plate has no vertical edge anywhere in frame. Round 1 published a single alpha of 0.87 (the plateau value, measured on a partly-unidentifiable region) and a later reading of 0.41 (the ramp value at x = 0.30); the file no longer carries a bare `alpha` field for this role, because a builder who types one number gets the failure both readings were warning about.',
    allowed: 'Text bands over the world: subtitles, interaction prompts, the objective line.',
    forbidden: 'Never a coloured plate. Never a constant alpha across the band — the ends must ramp to zero. Never alphaPeak above 0.92; at that point the world stops reading through the middle as well.'
  }),
  'ui.surface.raised': C('#3A4247', {
    measured: 'bar track, sampled directly',
    allowed: 'Bar tracks, inset wells, the unfilled part of any meter.'
  }),
  'ui.stroke': C('#A8E0EC', {
    measured: 'the pale-cyan 2px outline on the portrait ring and both bars, with a soft outer glow',
    allowed: 'The outline on every UI plate. 2px at 1600×900, scaling with viewport height.'
  }),
  'reward.gold': C('#F0BE45', {
    measured: 'the XP bar fill #EFBB42 (hue 42, S 0.724)',
    allowed: 'Earned/permanent progress: XP, mastery marks, unlocks. Gold means "you keep this"; cyan means "this is live".'
  }),

  // ───────────────────────── STATE ───────────────────────────
  'danger': C('#FF3E6B', {
    note: 'Hue 346°. Chosen from the measured hue census: bins 250–349° contain 0.00% of the reference\'s saturated pixels and 350–359° contain 0.07%. Magenta-red is the one arc of the colour wheel this world never uses at strength.',
    caveat: 'The census hides one thing, and it matters. Rock in MID shadow passes through hue 338–353 on its way to violet (measured down the terrace face at x=0.885: 353 → 343 → 338 at S 0.29–0.32, Y 0.140). So danger is separated from the world by SATURATION as much as by hue. World rose-shadow never exceeds S 0.35; danger is S 0.757. Any danger element must be drawn above S 0.55, or it will read as a shadow.',
    minSaturation: 0.55,
    allowed: 'Failure, damage, an expiring timer, a wrong branch. Transient only.',
    forbidden: 'Never more than 0.5% of frame pixels. Never static for more than 1.2 s. Never below S 0.55. Never the only cue — see `accessibility`.'
  }),
  'danger.deep': C('#8C1436', { allowed: 'The dark half of a danger gradient, outlines and drop shadows on danger elements.' }),
  'success': C('#8AF06E', {
    note: 'Hue 107°. Chosen the same way as danger: the measured hue census puts bins 70–119° at 0.78% of the reference\'s saturated pixels — the second empty arc. A first draft placed success at 146°, and the auditor caught it colliding with the river and crystals (which live at 140–168°) at 0.81% of frame — over the 0.5% budget. 107° is 60–70° clear of the resonance arc. Luminance 0.689 against danger\'s 0.258 is a 2.67:1 split, which survives every colour-vision deficiency.',
    allowed: 'The EVENT of being right: a correct answer, a verb resolving, mastery gained. Transient only.',
    forbidden: 'Never more than 0.5% of frame pixels. Never persistent. Never in the world — success is feedback, not a substance. The permanent record of an achievement is reward.gold, which IS world-native (it is the armour highlight and the XP bar). Event = green flash, record = gold. Do not merge them.'
  }),
  'success.deep': C('#2A7A28', { allowed: 'The dark half of a success gradient, outlines and drop shadows on success elements.' })
};

const palette = {
  $schema: 'https://variable-star.local/palette-1',
  project: 'Variable Star',
  piece: 'P02',
  colourSpace: {
    authoring: 'sRGB IEC 61966-2-1 hex, D65',
    rendering: 'linear-sRGB. `linear` on every entry is the exact sRGB→linear decode of `hex`. Feed `linear` to the shader; never feed `hex` to a linear pipeline.',
    luminance: 'Rec.709 relative luminance of the linear triplet (0.2126 R + 0.7152 G + 0.0722 B). Every `luminance` field in this file is that number.',
    three: 'THREE.ColorManagement.enabled = true; renderer.outputColorSpace = SRGBColorSpace; new Color().setHex(0xRRGGBB, SRGBColorSpace).'
  },
  reference: {
    image: 'reference/brief-hero.png',
    size: [2752, 1536],
    aspect: 1.792,
    method: 'Every `measured` field cites a region sampled from that file by review/p02-measure*.mjs. Sample boxes were placed against the labelled grids in review/p02-crops/grid-*.png, not guessed.',
    caveat: 'The reference is a painted illustration. These are the values a real-time render must LAND ON, not values copied from a render.'
  },
  roles,

  exposure: {
    note: 'Targets are measured on the reference and are checkable on any capture with `node review/art-audit.mjs <shot.png>`.',
    tonemap: 'Filmic with a soft shoulder. Requirements, not a named curve: (a) the shoulder must desaturate as it compresses — the reference\'s hottest armour highlight sits at S 0.37 while its light band sits at S 0.67; (b) nothing may clip to pure white except emitter cores, the sun, and KaTeX glyphs; (c) the toe must not crush — 25% of the frame sits below Y 0.147 and still carries readable form.',
    forbidden: 'Reinhard applied to the whole frame (it flattens the mid plateau), and raw linear→sRGB with a hard clamp (highlights skew hue instead of desaturating).',
    middleGrey: { linearY: 0.35, note: 'median frame luminance; set exposure so the median lands here' },
    keyToFillRatio: { target: 6.2, tolerance: 1.6, measuredOn: 'marked boxes — lit [0.870,0.481,0.910,0.489] Y 0.6592 (#FEC67D) vs sky-shadowed face [0.872,0.598,0.902,0.612] Y 0.1066 (#555661) = 6.18. See solvedConstants.keyToFill for the spread across other facet pairs on the same terrace (4.4–6.2).' },
    skinKeyToFillRatio: { target: 2.4, tolerance: 0.5, note: 'skin is lit much flatter than rock, on purpose' },
    clipping: {
      maxFractionAbove_Y099: 0.02,
      maxFractionBelow_Y001: 0.04,
      measured: 'reference, at the auditor stride: 0.12% of pixels at Y >= 0.99 and 1.5% at Y <= 0.01'
    }
  },

  luminanceHistogram: {
    note: 'Linear Rec.709 luminance of every pixel. This is the shape the frame must have; the auditor checks the percentiles, not the bins.',
    shape: 'A broad, gently double-humped plateau. A dark lobe at Y 0.00–0.06 (14.2% — ink, deep shadow, the framing foreground mass), a dip at Y 0.22–0.30, a wide mid plateau Y 0.31–0.66 (the lit world and the sky), then a fast decay above Y 0.70 with a thin tail to 1.0 carrying only emitters, the sun and the glyphs. Neither end spikes.',
    percentileTargets: {
      p01: [0.000, 0.020], p05: [0.010, 0.040], p10: [0.025, 0.070],
      p25: [0.110, 0.190], p50: [0.300, 0.400], p75: [0.480, 0.600],
      p90: [0.600, 0.720], p95: [0.700, 0.810], p99: [0.900, 0.990]
    },
    measured: { p01: 0.0058, p05: 0.0206, p10: 0.0431, p25: 0.1471, p50: 0.3504, p75: 0.5409, p90: 0.6649, p95: 0.7569, p99: 0.956 },
    meanLuminance: { target: 0.354, tolerance: 0.05 },
    meanSaturation: { target: 0.313, tolerance: 0.05 }
  },

  colourBudget: {
    note: 'Fractions of frame pixels. Measured on the reference at half-resolution sampling; the auditor reproduces them exactly.',
    hueArcs: {
      note: 'THE partition, and the only one. review/art-audit.mjs classifies every pixel with these arcs and design/art-direction.md §9 prints this table verbatim — the prose is generated from this object, so the two cannot drift. Classification is in PRIORITY ORDER (danger, success, muted, then the hue arcs), because `success` at 107° sits inside the bridge arc and must not be scored against the bridge budget. Each class carries its own saturation gate.',
      order: ['danger', 'success', 'muted', 'warm', 'resonance', 'bridge', 'offLanguage'],
      classes: {
        danger: { hue: [[330, 355]], minS: 0.55, minY: 0.10, label: 'danger — reserved, transient only', referenceShare: 0.0 },
        success: { hue: [[95, 125]], minS: 0.45, minY: 0.45, label: 'success — reserved, transient only', referenceShare: 0.0 },
        muted: { hue: [[0, 360]], maxS: 0.30, label: 'muted — the quiet majority of the frame', referenceShare: 0.5355 },
        warm: { hue: [[0, 60], [320, 360]], minS: 0.30, label: 'warm rock — the mass of the world', referenceShare: 0.3092 },
        resonance: { hue: [[150, 215]], minS: 0.30, label: 'resonance cyan — mathematics is live here', referenceShare: 0.1373 },
        bridge: { hue: [[90, 150]], minS: 0.30, label: 'green bridge — river, foliage, ground cover', referenceShare: 0.0147 },
        offLanguage: { hue: [[60, 90], [215, 320]], minS: 0.30, label: 'off-language — must stay empty', referenceShare: 0.0033 }
      },
      emptyArcs: '250–349° is 0.00% of the reference\'s saturated pixels; 70–119° is 0.78%. Those two emptinesses are what `danger` and `success` were placed in.'
    },
    saturatedIsSGreaterEqual: 0.30,
    hotIsSGreaterEqual: 0.55,
    targets: {
      mutedShareOfFrame: [0.46, 0.62],
      warmShareOfFrame: [0.26, 0.36],
      resonanceShareOfFrame: [0.10, 0.18],
      bridgeShareOfFrame: [0.00, 0.04],
      hotShareOfFrame: [0.08, 0.16],
      hotResonanceShareOfFrame: [0.02, 0.05],
      warmToResonanceRatio: [1.8, 2.6],
      skyThirdMutedShare: [0.85, 1.00],
      bottomThirdResonanceShare: [0.18, 0.36],
      dangerShareOfFrame: [0.000, 0.005],
      successShareOfFrame: [0.000, 0.005]
    },
    measured: {
      mutedShareOfFrame: 0.5355, warmShareOfFrame: 0.3092, resonanceShareOfFrame: 0.1373,
      bridgeShareOfFrame: 0.0146, hotShareOfFrame: 0.1167, hotResonanceShareOfFrame: 0.0311,
      warmToResonanceRatio: 2.25, skyThirdMutedShare: 0.8906, bottomThirdResonanceShare: 0.2813
    }
  },

  shadingRamps: {
    note: 'Two ramps, two material classes. Both were sampled from the reference, not designed. Implementing either as an RGB lerp between a lit colour and a shadow colour produces the muddy grey midtone that reads as "shader default".',
    curvedMetalAndSkin: {
      appliesTo: 'anything with a smooth normal: hero plate, gauntlets, helmet forms, skin, hair, crystal bodies',
      transition: 'soft — a gradient roughly 0.004–0.006 of frame width wide at hero scale',
      huePath: 'FORWARD through olive/green: 185° → 68° → 32° → 35° → 59°',
      measuredOn: 'horizontal cut across the hero at y=0.60, x 0.372→0.415',
      stops: [
        { at: 'shadow', hex: '#34494C', hue: 185, S: 0.32, Y: 0.062 },
        { at: 'terminator', hex: '#68704F', hue: 68, S: 0.26, Y: 0.132 },
        { at: 'mid', hex: '#AB804F', hue: 32, S: 0.54, Y: 0.247 },
        { at: 'light', hex: '#FDB755', hue: 35, S: 0.67, Y: 0.556 },
        { at: 'specular', hex: '#FFFCA0', hue: 59, S: 0.37, Y: 0.953 }
      ],
      law: 'Saturation PEAKS in the light band (0.67) and DROPS in the specular (0.37) while value pins at 1.0. A highlight that gets more saturated as it gets brighter is the signature of an untonemapped render.'
    },
    facetedRock: {
      appliesTo: 'terrain, cliffs, boulders, the plinth, ruin masonry — anything authored as flat facets',
      transition: 'HARD. Rock has no terminator. Measured down the plinth at x=0.66: Y 0.223 → 0.293 → 0.424 in three samples spanning 0.006 of frame height (~9 px at 1536), with a separate ink break at y=0.757. The light/shadow boundary is a geometric edge, not a falloff.',
      huePath: 'BACKWARD through red and rose into violet: 26° → 15° → 9° → 353° → 338° → 260°',
      measuredOn: 'vertical cut down the terrace face at x=0.885, y 0.500→0.596',
      stops: [
        { at: 'lit', hex: '#FDA663', hue: 26, S: 0.61, Y: 0.491 },
        { at: 'turning', hex: '#A96F62', hue: 11, S: 0.42, Y: 0.207 },
        { at: 'midShadow', hex: '#865E6D', hue: 338, S: 0.30, Y: 0.140 },
        { at: 'deepShadow', hex: '#585460', hue: 260, S: 0.13, Y: 0.093 },
        { at: 'occlusion', hex: '#1C151D', hue: 293, S: 0.28, Y: 0.009 }
      ],
      law: 'Smooth forms and cut planes must not share a shading model. That contrast is most of why the hero reads as a character standing on a landscape rather than as another rock.'
    }
  },

  shadowChroma: {
    note: 'THE test for "did we actually author shadow colour, or did we just multiply the albedo". Census over mid-shadow pixels only: 0.02 ≤ Y ≤ 0.12 and S ≥ 0.10 (this excludes ink, which is below the floor, and excludes neutral gloom, which is below the saturation floor).',
    measured: { coolShare: 0.5062, warmShare: 0.2343, otherShare: 0.2594, peaks: '200° (13.2%), 180° (12.9%), 190° (10.7%), with a violet tail 220–280° carrying 13.6%' },
    coolIsHue: [185, 320],
    coolShareTarget: [0.38, 0.80],
    note2: 'A render that darkens the albedo instead of rotating it lands near 0.05–0.15 here and fails by a mile. More than half of this world\'s shadow pixels are COOL.'
  },

  depthCues: {
    note: 'Acutance = mean |4·L(x,y) − L(x±2,y) − L(x,y±2)| over a region, sampling every 2nd pixel. Unitless; only ratios are meaningful, and only between boxes on COMPARABLE CONTENT. Full-width screen bands do not work — a first draft used them and the hero, the hologram and the HUD text contaminated every band (all three came out at 0.033). The boxes below are hand-placed on rock at three depths.',
    acutanceMeasured: { hero: 0.1042, foregroundRock: 0.0457, midgroundValley: 0.0223, midCrystals: 0.0145, distanceRuins: 0.0127, cityFar: 0.0230, skyFlat: 0.0123 },
    acutanceBoxes: {
      foreground: [0.44, 0.70, 0.72, 0.92],
      midground: [0.06, 0.52, 0.30, 0.68],
      distance: [0.10, 0.36, 0.30, 0.46],
      note: 'Normalised, calibrated to the Level-1 hero framing. Re-place them for any other framing; they are arguments to review/art-audit.mjs, not constants of nature.'
    },
    acutanceRatioTargets: { heroOverMidground: [2.5, 8.0], foregroundOverDistance: [1.8, 6.0], foregroundOverMidground: [1.5, 5.0] },
    saturationByThird: { top: 0.1734, middle: 0.3165, bottom: 0.4499, note: 'Measured row means at the auditor\'s own stride (every 3rd pixel). Saturation must rise monotonically from horizon to the bottom of frame; the auditor checks bottom − top ≥ 0.15 (reference 0.277). Round 1 recorded 0.15 / 0.32 / 0.47 here, which matched neither the auditor nor the reference; these are the reproduced numbers.' },
    aerialPerspective: { target: 'sky.horizon', farPlaneMix: 0.75, note: 'distant geometry lerps toward sky.horizon in LINEAR space, reaching 0.75 at the far plane; measured far ruins sit at 0.35× the saturation of the same rock in the foreground' }
  },

  accessibility: {
    stateColourPairing: 'danger and success must differ by ≥2.5× in luminance. As authored: success #8AF06E Y 0.6885 against danger #FF3E6B Y 0.2577 = 2.67:1. They must ALSO always carry a second, non-colour cue — shape, motion or position. Colour alone never carries a learning outcome.',
    stateLuminanceRatio: 2.67,
    minTextContrast: 4.5,
    deuteranopiaNote: 'danger (346°) and success (107°) are the classic confusable pair under deuteranopia. The 2.67:1 luminance split and the mandatory second cue are what make them safe. Do not "fix" this by moving danger toward orange — orange is 30% of the frame. (Round 1 left this note reading "success (146°)" and "3.07:1" after §9 had already moved success to 107°; both are corrected here and both are derived from roles.success.luminance / roles.danger.luminance, which is where the number now comes from.)'
  },

  solvedConstants: {
    note: 'The constants that came from a FIT rather than from reading a pixel. These govern the two surfaces a player looks through on every interaction, and they are the numbers a builder actually types. Round 1 shipped them unverified and the frame-wide census auditor could not see them; review/art-audit.mjs now checks each one directly (U1, V1, B1, K1, I1) and reports which ones could not run on a given frame.',
    scrimTransmission: {
      id: 'U1',
      plateauTransmissionY: [0.06, 0.20],
      plateauAlpha: [0.80, 0.94],
      requireRamp: true,
      minRampWidth: 0.05,
      note: 'The interior of the band must transmit; the ends must ramp. A frame whose scrim plateau transmits < 0.06 is a black bar. RAMP WIDTH is the distance in frame widths over which transmission climbs from plateau+0.10 to 0.85 at each end; a hard-edged rectangle scores ~0.005 and fails. The reference ramps over 0.11 (left) and 0.15 (right).',
      referenceValue: { plateauTransmissionY: 0.110, plateauAlpha: 0.908, rampWidth: [0.11, 0.15] }
    },
    veilCompression: {
      id: 'V1',
      slope: [0.30, 0.72],
      fixedPointY: [0.40, 0.50],
      minPairs: 10,
      minBackgroundSpread: 0.20,
      searchBox: [0.45, 0.20, 0.81, 0.58],
      note: 'Y_inside = slope·Y_behind + intercept, fitted over paired samples across at least two panel edges with different backdrops. An additive quad gives slope ≈ 1 with a large intercept; a flat plate gives slope ≈ 0. Both fail. The fixed point is intercept/(1−slope) and must land near holo.veil.luminance.',
      referenceValue: { slope: 0.462, intercept: 0.240, fixedPointY: 0.446, n: 116, r2: 0.896 }
    },
    emitterPeak: {
      id: 'B1',
      minPeakY: 0.90,
      maskHue: [150, 215],
      note: 'The brightest pixel inside the emissive mask must be blown. An emitter whose peak is a mid value is a painted decal.',
      referenceValue: { peakY: 0.9496, hex: '#E7FEFD', at: [0.6344, 0.7038], blownShareOfFrame: 0.0018 }
    },
    keyToFill: {
      id: 'K1',
      target: 6.2, tolerance: 1.6,
      litBox: [0.870, 0.481, 0.910, 0.489],
      shadowBox: [0.872, 0.598, 0.902, 0.612],
      note: 'Two marked boxes on the same terrace: a top facing the key, and a vertical face turned away from it under open sky. Pass --lit / --shadow to art-audit.mjs to re-place them on our own framings. Round 1 stated 7.0 ± 1.5 in prose from a pair it did not record; on boxes that ARE recorded the reference gives 6.18 (lit Y 0.6592 #FEC67D, shadow Y 0.1066 #555661). The bounce-shadowed face of the same terrace gives 4.82 and the second lit band gives 4.38, which is the honest spread of this measurement.',
      referenceValue: { ratio: 6.18, litY: 0.6592, shadowY: 0.1066 }
    },
    inkWidth: {
      id: 'I1',
      threshold: 0.012,
      p50: [2, 6], p90: [4, 14],
      requireTaper: true,
      note: 'Horizontal runs of pixels at or below Y 0.012 inside the hero box, normalised to a 2752-wide frame. Absolute widths are threshold-dependent — that is why the threshold is stated here and passed to the auditor rather than assumed. What is NOT threshold-dependent is the taper: p90 must exceed p50.',
      referenceValue: { atY0006: { p25: 2, p50: 3, p75: 4, p90: 6, n: 6690 }, atY0012: { p25: 2, p50: 3, p75: 4, p90: 7, n: 8255 }, atY0020: { p25: 2, p50: 4, p75: 5, p90: 10, n: 8528 } },
      distanceGate: { foregroundBandDensity: 0.0230, distantBandDensity: 0.0101, note: 'density of pixels at Y ≤ 0.006 in a foreground band vs a distant band; ink must be denser in front' }
    }
  }
};

const outPath = path.join(root, 'design', 'palette.json');
writeFileSync(outPath, JSON.stringify(palette, null, 2) + '\n');
console.log('wrote', outPath);
console.log('roles:', Object.keys(roles).length);
for (const [k, v] of Object.entries(roles)) console.log('  ' + k.padEnd(22), v.hex, 'Y=' + String(v.luminance).padEnd(7), 'hsv=' + JSON.stringify(v.hsv));
