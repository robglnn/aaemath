#!/usr/bin/env node
/**
 * P02 round 4 — the edit script for design/palette.json.
 *
 * design/palette.json is the authoritative half of the art direction. It is no
 * longer regenerated wholesale (review/p02-make-palette.mjs was the round-1 seed
 * and has been superseded since round 2); it is amended, in place, by scripts
 * like this one so that every change is reproducible and reviewable.
 *
 *   node review/p02-r4-palette.mjs            # apply
 *   node review/p02-r4-palette.mjs --check    # exit 1 if the file is not already amended
 *
 * Round 4 does nine things:
 *   1. adds world.grey / world.grey.deep      — Grey is world.md's third material
 *   2. adds certainty.facet / .rim / .deep    — a certainty is not an emitter
 *   3. adds the `grey` class to §9's partition and the C12 budget
 *   4. adds the Lethis variability envelope to motion.timeOfDay
 *   5. renames motion.timeOfDay.keyAzimuthDeg (it describes the reference framing)
 *   6. renames exposure.middleGrey.linearY    (it is display-referred, not scene)
 *   7. fixes three stale-drift values (skin ratio, shadow hue, acutance)
 *   8. records the acutance boxes that were never written down
 *   9. adds materials.* and screenSpace.* — the numbers §5, §7 and §12 were missing
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'design', 'palette.json');
const src = readFileSync(FILE, 'utf8');
const P = JSON.parse(src);
const M = JSON.parse(readFileSync(path.join(ROOT, 'review', 'p02-r4-measurements.json'), 'utf8'));

const s2l = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const C = (hex, extra = {}) => {
  const N = parseInt(hex.slice(1), 16);
  const rgb = [(N >> 16) & 255, (N >> 8) & 255, N & 255];
  const linear = rgb.map(v => +s2l(v).toFixed(4));
  const [r, g, b] = rgb, mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 0) { if (mx === r) h = 60 * (((g - b) / d) % 6); else if (mx === g) h = 60 * ((b - r) / d + 2); else h = 60 * ((r - g) / d + 4); }
  if (h < 0) h += 360;
  return { hex, rgb, linear, hsv: [Math.round(h), +(d / mx).toFixed(3), +(mx / 255).toFixed(3)], luminance: +(0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]).toFixed(4), ...extra };
};
/** rebuild an object with `entries` spliced in immediately after key `after` */
const insertAfter = (obj, after, entries) => {
  const out = {};
  for (const [k, v] of Object.entries(obj)) { out[k] = v; if (k === after) for (const [k2, v2] of Object.entries(entries)) out[k2] = v2; }
  return out;
};

// ── 1 + 2 · the roles world.md needs and the file did not have ──────────────
P.roles = insertAfter(P.roles, 'world.foliage', {
  'world.grey': C('#7C7A72', {
    measured: 'AUTHORED, not sampled. There is no grey material anywhere in reference/brief-hero.png — the reference is a hero vista of a world that has not been given world.md yet. This colour is placed by construction: a dead neutral carrying the residual warm bias of stone that used to be lit, positioned to be measurably distinct from the two roles it would otherwise be confused with.',
    separation: `vs rock.bone #AA9087: Δhue ${M.greySeparation.vsRockBone.dHue}°, ΔS ${M.greySeparation.vsRockBone.dS}, ΔY ${M.greySeparation.vsRockBone.dY}. vs rock.shadow #55505E: Δhue ${M.greySeparation.vsRockShadow.dHue}°, ΔS ${M.greySeparation.vsRockShadow.dS}, ΔY ${M.greySeparation.vsRockShadow.dY}. Bone stone is warmer and twice as saturated; rock shadow is violet and half as bright. Grey is neither, and it is the only role in the file whose saturation is below 0.10.`,
    note: 'world.md Law 5: a claim shut with a supplied value works, sags, and never sets. Grey is the THIRD material class of this world, alongside warm stone (what cooled) and teal resonance (what has not resolved yet), and it is the antagonist rendered as a surface. It must read sad-but-functional: the thing still holds the roof up. Roughness 0.88–0.95, no specular lobe worth the name, no rim, no emissive, no bloom, and it is the one material that gets ink in the foreground *because* it is what the player is meant to notice.',
    allowed: 'Any object emitted by a supplied value: a sagging span, a propped roof, an approximate wall, a greyed floor. The props and stacked certainties a sagsmith puts under them stay their own colours — the prop is not grey, the thing it is holding up is. Ink on foreground grey.',
    forbidden: 'Never cyan-tinted, never bloomed, never emissive — a grey object has no live claim in it and therefore nothing to glow with. Never used as a neutral for anything that is merely dark or dusty: if it is not the result of an approximation, it is rock.shadow or rock.bone, and calling it grey spends the word.'
  }),
  'world.grey.deep': C('#4A4945', {
    measured: 'AUTHORED. The shadow end of world.grey, held at the same hue and saturation so grey is the one material whose shadow does NOT rotate — see the note.',
    note: 'Grey is the exception to §3. Warm rock rotates to violet in shadow, skin holds its hue, resonance pulls everything near it to teal — and grey does none of it, because a hue rotation is what a surface does when it is being lit by a coloured world, and grey reads as a surface the world has partly stopped talking to. Δhue 0°, saturation ×0.84, luminance ×0.34. A builder who gives grey a violet shadow has made it into rock.',
    allowed: 'Unlit faces, undersides and contact shadows of grey objects.'
  })
});
P.roles = insertAfter(P.roles, 'resonance.deep', {
  'certainty.facet': C('#5AA5A0', {
    measured: 'AUTHORED. reference/brief-hero.png carries crystal (the pale cyan clusters right of frame) but nothing in it is a certainty in world.md\'s sense, so this colour is placed by construction against two constraints: it must sit inside §9\'s resonance arc (hue 150–215, S ≥ 0.30) and it must NOT reach the hot gate at S 0.55.',
    note: 'world.md §2.2 Law 4: a claim re-closed enough times, spaced far enough apart, SETS — it crystallises and drifts no more. That crystal is a certainty, and it is the second most beautiful object class in this world; the most beautiful is a live claim, and that ordering is a rule, not a preference (art-direction.md §0.4). A certainty is faceted crystal that REFRACTS: roughness 0.06–0.14, specular AA required, a Fresnel rim in certainty.rim, and NO emissive, NO blown core, NO bloom. It does not glow because it does not drift; it holds. That is the whole read, and it is what makes a certainty legible at a glance against a live claim two metres away.',
    allowed: 'Set certainties: the certainty field, crystal along old claim lines, a cut certainty in the player\'s hands, the stacked certainties under a sagsmith\'s prop, the crystal a construction is stood on.',
    forbidden: 'Never emissive. Never at S ≥ 0.55 — the hot-resonance budget (C5, 0.02–0.05 of frame) belongs to live claims and carries alone, and a field of certainties must move C4 without moving C5. Never grey-tinted: a certainty cannot be faked and must never look as though it could have been.'
  }),
  'certainty.rim': C('#8FE8DF', {
    measured: 'AUTHORED. Y 0.6888 — deliberately below the 0.72 ceiling that §0.4 sets for any non-live object, which is 0.18 under the 0.90 floor B1a puts on a live emitter core.',
    note: 'The refracted edge and internal caustic of set crystal. This is the brightest a certainty is ever allowed to be, and the gap between it and an emitter core is the two-tier rule made measurable: a live claim always out-brightens every certainty in frame by at least 0.18 of luminance.',
    allowed: 'Fresnel rim, facet edges and internal caustics on certainty geometry.',
    forbidden: 'Never above Y 0.72. Never bloomed — bloom is an emitter\'s signature and a certainty is not one.'
  }),
  'certainty.deep': C('#26514F', {
    measured: 'AUTHORED. The unlit facet: same hue, S ×1.17, Y ×0.22 against certainty.facet.',
    note: 'Crystal in shadow keeps its hue and GAINS saturation, which is the opposite of rock and is why a certainty reads as transmissive rather than as a painted stone.',
    allowed: 'Unlit facets, crystal interiors, the underside of a certainty seam.'
  })
});

// ── 3 · the `grey` class in the partition, and its budget ───────────────────
const arcs = P.colourBudget.hueArcs;
const greyShare = M.grey.candidates.find(c => c.name === 'hue20-80 S<0.14 noY').share;
arcs.order = ['danger', 'success', 'atmosphere', 'grey', 'muted', 'warm', 'resonance', 'bridge', 'offLanguage'];
arcs.classes = insertAfter(arcs.classes, 'atmosphere', {
  grey: {
    hue: [[20, 80]], maxS: 0.14,
    label: 'grey — a claim closed with a supplied value',
    referenceShare: greyShare
  }
});
const MUTED_INCLUDING_GREY = 0.2479;   // the round-3 published value, grey still inside it
arcs.classes.muted.referenceShare = +(MUTED_INCLUDING_GREY - greyShare).toFixed(4);
arcs.classes.muted.label = 'muted — surfaces that are neither warm, resonant nor grey';
arcs.note = arcs.note.replace('(danger, success, atmosphere, muted, then the hue arcs)', '(danger, success, atmosphere, grey, muted, then the hue arcs)');
arcs.greyNote = 'Grey is a MATERIAL, not a tint, and until round 4 §9 scored it as anonymous `muted` — 24.79% of the frame described as "the quiet majority of surfaces" and given no direction at all. world.md Law 5 makes grey the visible surface of the antagonist, so it gets a class and a budget of its own. The class is a strict subset of what `muted` already held (hue 20–80° at S < 0.14 is inside S < 0.30), so nothing else in the partition moves and `quiet` still counts atmosphere + muted + grey. Reference share ' + greyShare + ' — BELOW the 0.02 floor, and that is the finding: the reference is a hero vista of a world with no grey in it. C12 is the first check in this file that reference/brief-hero.png fails, and it fails it for a reason that is about what the world is made of rather than how it is photographed.';

P.colourBudget.targets.greyShareOfFrame = [0.02, 0.08];
P.colourBudget.measured.greyShareOfFrame = greyShare;
P.colourBudget.measured.mutedShareOfFrame = arcs.classes.muted.referenceShare;

// ── 4 + 5 · Lethis, and the azimuth that describes a camera ─────────────────
const tod = P.motion.timeOfDay;
delete tod.keyAzimuthDeg;
P.motion.timeOfDay = {
  policy: 'one authored hour, held — with an aperiodic intensity swing, because the star is the title',
  keyBearingIsWorldFixed: true,
  keyAzimuthDegInReferenceFramingOnly: 62,
  keyElevationDeg: 8,
  elevationDriftDeg: 3,
  azimuthDriftDeg: 8,
  periodMinutes: 20,
  lethisVariability: {
    what: 'world.md §3: "Its output is an unsolved function: it swells and dims on a period nobody has pinned." world.md §9 puts the cosmic stake in "the sky, every frame, doing real work", and §11 hands P10 "Lethis is a *character* — it swells and dims on no schedule and the sky must visibly not be on a loop." Round 3 forbade exactly that. This envelope is what replaces the ban: it is the only quantity in the light rig that is allowed to vary, and every constant measured in this file survives it.',
    varies: 'key INTENSITY only',
    intensityMean: 1.0,
    intensitySwing: 0.12,
    maxRatePerFixedStep: 0.0015,
    drive: 'a sum of at least four sinusoids whose periods are mutually prime and none shorter than 40 s (e.g. 41 s, 67 s, 113 s, 269 s, 617 s), normalised to unit peak. Aperiodic in practice: the sum does not repeat inside a session, which is the requirement — the sky must visibly not be on a loop. It runs in fixed(), from simTime, so it is deterministic and G4-safe.',
    held: 'sky.sun #FFE8A0 exactly; key elevation +8° ± 3°; the key\'s world bearing; the sky gradient; every colour in this file.',
    clamps: 'The envelope is clamped by two checks that already exist and were measured on the reference: K1 (key : fill on the marked rock boxes) must stay inside 6.2 ± 1.6, and L1 (median frame luminance) must stay inside 0.30–0.40. Those two are what make the swell MEASURABLE rather than a re-derivation of the document: a swing that pushes either of them out of band is too big, whatever the sky looks like.',
    whyThatRate: '±12% about 1.00 at ≤ 0.0015 per fixed step is 0.15% of full intensity per step, i.e. 9% per second at the fastest — a swell takes at least 1.6 s to cross its whole range and typically much longer. That is comfortably under M5 (emissive energy ≤ 3% per step) and under M6 (median frame Y ≤ 0.005 per step static), and it is far slower than the 3 Hz accessibility floor. The one thing it must never become is a flicker: this is a star breathing, not a lamp failing.',
    forbidden: 'A day/night cycle, a colour-temperature ramp, a moving sun, a periodic loop, or any drive a player could time with a stopwatch. Lethis has been under review for eleven thousand four hundred years precisely because nobody has pinned its period; a sine wave with one period is the one implementation that contradicts the fiction.'
  },
  note: 'The world is a long dusk and it stays one. The key holds ONE WORLD BEARING for the whole session — keyAzimuthDegInReferenceFramingOnly is a fact about the camera in reference/brief-hero.png (the shot looks 62° off that bearing, which is why the sun sits camera-right and just off frame) and is NOT a light offset from the camera. Round 2 wrote it as "azimuth +62° (camera right)", which read literally is a light bolted to the camera boom; round 3 fixed the prose and left this key unchanged, and this file is the authoritative half. The slow elevation/azimuth drift lets a returning player feel time pass without any frame pair being able to resolve it (8° over 20 min is 0.00011° per fixed step). What varies is Lethis\'s brightness, and only its brightness — see lethisVariability.'
};

// ── 6 · the exposure key that named the wrong side of the tonemap ───────────
delete P.exposure.middleGrey;
P.exposure.medianFrameLuminanceDisplayY = {
  value: 0.35,
  range: [0.30, 0.40],
  pipelineStage: 'display-referred',
  note: 'The median luminance of the FINISHED 8-bit sRGB frame, after the tonemap. Auditor L1. This key used to be called `middleGrey.linearY`, which named a scene-referred quantity — and conventional middle grey is 0.18 linear, so a builder reading the old name saw a number about twice as large as they expected and had every reason to type it into a shader. That is this file\'s own "most expensive mistake available" (art-direction.md, Which side of the tonemap). Set exposure by capturing a frame and measuring, never by feeding 0.35 to anything.'
};

// ── 7 · three stale-drift values ───────────────────────────────────────────
P.roles['hero.skin'].note = P.roles['hero.skin'].note.replace('a 2.4:1 key:fill against rock\'s 7:1', 'a 2.4:1 key:fill against rock\'s 6.2:1 (K1)');
P.roles['rock.shadow'].note = P.roles['rock.shadow'].note.replace('hue +230…+245°', 'hue +240…+245°');
P.depthCues.acutanceMeasured = {
  hero: M.acutance.heroCore.value, foregroundRock: M.acutance.foreground.value,
  midgroundValley: M.acutance.midground.value, midCrystals: M.acutance.midCrystals.value,
  distanceRuins: M.acutance.distance.value, cityFar: M.acutance.cityFar.value, skyFlat: M.acutance.skyFlat.value,
  note: 'Re-derived at FULL resolution by review/p02-r4-measure.mjs with the auditor\'s own algorithm, on the boxes recorded in acutanceBoxes — every one of them, which was not true before. Round 3 carried hero 0.1042 here, 0.0961 in the prose and 0.09612 from the live auditor: three values for one measurement, which is the rampWidth defect one object away. The auditor\'s value is the one that is checkable, so it is the one that is recorded. `skyFlat` was previously an unrecorded 0.0123; the obvious box for it (x 0.10–0.30, y 0.03–0.09) scores 0.082 because the HUD portrait and health bar sit inside it, so the box now used is clean sky right of the HUD.'
};
P.depthCues.acutanceBoxes = {
  hero: M.acutance.heroCore.box,
  foreground: M.acutance.foreground.box,
  midground: M.acutance.midground.box,
  distance: M.acutance.distance.box,
  midCrystals: M.acutance.midCrystals.box,
  cityFar: M.acutance.cityFar.box,
  skyFlat: M.acutance.skyFlat.box,
  note: 'Normalised, calibrated to the Level-1 hero framing. Re-place them for any other framing; they are arguments to review/art-audit.mjs, not constants of nature. `hero` is the inset core the auditor derives from --hero=0.276,0.276,0.425,0.960 (15% in x, 20% in y) and is recorded here so the number can be reproduced without re-deriving the inset.'
};

// ── 8 · §7's missing landmark rule, with its boxes ─────────────────────────
P.depthCues.landmarkContrast = {
  id: 'D5',
  rule: 'A distant landmark that is meant to READ AS A SILHOUETTE must have a mean luminance no more than 0.70× the sky directly behind it.',
  maxRatio: 0.70,
  measured: {
    cityMass: M.landmark.cityMass, skyBehindCity: M.landmark.skyBehindCity, skyAboveCity: M.landmark.skyAboveCity,
    ratioCityOverSkyBehind: M.landmark.ratios.cityOverSkyBehind,
    ratioCityOverSkyAbove: M.landmark.ratios.cityOverSkyAbove
  },
  counterExamples: {
    ruinClusterLeft: { box: M.landmark.ruinLeft.box, mean: M.landmark.ruinLeft.mean, skyBehind: M.landmark.skyBehindRuinLeft.mean, ratio: M.landmark.ratios.ruinOverSkyBehind },
    midMesas: { box: M.landmark.mesaMid.box, mean: M.landmark.mesaMid.mean, skyAbove: M.landmark.skyAboveMesaMid.mean, ratio: M.landmark.ratios.mesaOverSkyAbove },
    note: 'Both sit at 0.76–0.78 and both FAIL the 0.70 rule, correctly. They are not silhouettes; they are haze, and they are supposed to be. The rule is not "everything distant must be dark" — it is that a frame gets ONE silhouetted landmark and everything else recedes by aerial perspective. In the reference that one is the city. In Level 1 it is Vantis, and Vantis is the horizon question.'
  },
  note: '§7 said "Detail is not what makes a landmark read; value contrast against sky is" and gave no number, which makes it advice rather than a rule. Boxes are arguments and are recorded. Pass --landmark=x0,y0,x1,y1 --skybehind=x0,y0,x1,y1 to re-place them.'
};

// ── 9 · the numbers §5, §11 and §12 were missing ───────────────────────────
P.materials = {
  note: 'Scene-referred material constants that art-direction.md §5 and §12 state as rules. AUTHORED — the reference is a painting and cannot be measured for a specular lobe width or an occlusion radius. They are here because a shader author cannot type prose.',
  plateMetal: {
    metalness: [0.90, 1.0],
    roughness: [0.22, 0.38],
    roughnessFloorUnderMotion: 0.35,
    specularTwoLobe: {
      broad: { roughness: 0.45, intensity: 0.25 },
      narrow: { roughness: 0.12, intensity: 1.0, gate: 'N·V < 0.35', gateFeatherWidth: 0.10 },
      note: 'The "broad soft gradient plus a narrow hot streak on edges" of §5, with numbers. The broad lobe is the form-reading one and is always on. The narrow lobe is the champagne-gold streak and is gated to grazing view angles — N·V < 0.35 is what "edges" means, feathered over 0.10 of N·V so the streak does not switch on across a threshold (anti-pattern 27). Both lobes obey the motion roughness floor: under motion the narrow lobe widens to 0.35 like everything else, which is the price §5 charges for hard facets.'
    }
  },
  certainty: {
    metalness: 0.0, roughness: [0.06, 0.14], emissive: false, bloom: false,
    rim: 'certainty.rim, Fresnel, exponent 3–5',
    note: 'A certainty refracts and never emits. See roles["certainty.facet"].'
  },
  grey: {
    metalness: 0.0, roughness: [0.88, 0.95], emissive: false, bloom: false, rim: false,
    note: 'Grey is the only material in the file with no highlight worth authoring. See roles["world.grey"].'
  },
  contactAO: {
    minDarkening: 0.45,
    radiusMetres: 0.35,
    falloff: 'smoothstep, full strength at contact, zero at radiusMetres, applied in linear before the tonemap',
    maxRadiusMetres: 1.2,
    note: 'Anti-pattern 4 said "every object needs a dark contact where it meets ground" and gave no darkness, no radius and no falloff, so it could not be built or checked. The number: at the contact line the surface must lose at least 45% of its unoccluded linear luminance, recovering to zero over 0.35 m for ordinary props (up to 1.2 m under something the size of a grounded barge). Below ~30% the object still floats; above ~70% it reads as a painted shadow decal. Verify by eye at the contact, never at the shadow\'s far end (anti-pattern 20).'
  }
};
P.screenSpace = {
  note: 'Every screen-space width in this document, expressed the one way that survives a device pixel ratio. This block exists because §5 quotes ink as "1.7 px at 1600×900" and §11 quotes the UI stroke as "2 px at 1600×900": on a 2× DPR display the drawing buffer is 3200×1800, those constants silently double or halve depending on which side of the pixel-ratio boundary they are applied, and quality-bar.md G7 demands legibility at both 1280×720 and 3840×2160.',
  rule: 'Author every screen-space width as a fraction of FRAME HEIGHT and multiply by the drawing buffer height at use. Never author in CSS pixels. Never author in device pixels.',
  inkMedianWidthFracOfFrameHeight: 0.00189,
  uiStrokeWidthFracOfFrameHeight: 0.00222,
  maxPixelRatio: 2.0,
  ditherAppliedIn: 'device pixels — the Bayer tile indexes gl_FragCoord in the drawing buffer, so the pattern is one tile per device pixel at every DPR. A tile authored in CSS pixels resamples and stops being a fixed pattern, which is anti-pattern 23 arriving through the back door.',
  derivation: 'ink: median 3 px on a 2752-wide reference = 1.7 px at 1600×900 = 1.7/900 = 0.00189 of frame height. ui stroke: 2 px at 1600×900 = 0.00222. At 3840×2160 those are 4.1 px and 4.8 px, which is what "scales with viewport height" has always meant and what §11 already says in words.',
  renderTarget: 'half-float (RGBA16F) or better for every pass before the tonemap. §8 requires the hologram quad and the bloom to composite in LINEAR, before the curve; an 8-bit unorm target quantises linear values and clips everything above 1.0, which makes §8 impossible and makes the >1.0 glyph drive of "Which side of the tonemap" impossible as well.'
};

// ── provenance ─────────────────────────────────────────────────────────────
P.reference.roundFourNote = 'Round 4 amends this file in place with review/p02-r4-palette.mjs from measurements in review/p02-r4-measurements.json. review/p02-make-palette.mjs is the round-1 seed generator and has been superseded since round 2 — do not run it, it does not know about the substance gate, the motion block or anything added since.';

const next = JSON.stringify(P, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (next !== src) { console.error('design/palette.json is NOT round-4 amended — run node review/p02-r4-palette.mjs'); process.exit(1); }
  console.log('palette.json is round-4 amended'); process.exit(0);
}
writeFileSync(FILE, next);
console.log('amended', path.relative(ROOT, FILE));
console.log('roles:', Object.keys(P.roles).length, '| grey reference share:', greyShare, '| partition order:', arcs.order.join(' > '));
