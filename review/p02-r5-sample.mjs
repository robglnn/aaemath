// P02 round 5 — the measuring instrument for design/palette.json and design/art-direction.md.
//
// EVERY number published in those two files is produced here, from
// reference/target-lowpoly.png, with no hand-typed colours anywhere. Run:
//
//   node review/p02-r5-sample.mjs                 # print the whole measurement table
//   node review/p02-r5-sample.mjs --write-palette # regenerate design/palette.json in place
//
// Sampling rules, so a critic can check the method as well as the digits:
//  * Coordinates are FRACTIONS of frame width/height. The reference is 2752x1536.
//  * A "box" sample is the per-channel MEDIAN of every pixel in [x0,y0,x1,y1).
//    Median, not mean, because a flat-shaded facet is exactly one colour and the
//    median ignores the 1-2 px of antialiasing at its border.
//  * A "mask" sample is the per-channel median of every pixel inside a region
//    that passes a stated HSV/luminance predicate. Masks are used wherever a box
//    would be a guess about where an object is; the predicate is the evidence.
//  * hue/S/V are HSV of the 8-bit sRGB triplet. Y is Rec.709 relative luminance
//    of the LINEAR triplet: 0.2126R + 0.7152G + 0.0722B.
//  * `linear` on every palette entry is the exact sRGB->linear decode of `hex`.

import { readPNG, px, hex, lum, hsv, SRGB_TO_LINEAR as LIN } from './p02-png.mjs';
import { writeFileSync } from 'node:fs';

const REF = new URL('../reference/target-lowpoly.png', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const OUT = new URL('../design/palette.json', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const img = readPNG(REF);
const W = img.width, H = img.height, NPX = W * H;

const r2 = n => Math.round(n * 100) / 100;
const r3 = n => Math.round(n * 1000) / 1000;
const r4 = n => Math.round(n * 10000) / 10000;
const linOf = p => [r4(LIN[p[0]]), r4(LIN[p[1]]), r4(LIN[p[2]])];
const medOf = a => { const f = c => { const s = a.map(p => p[c]).sort((u, v) => u - v); return s[s.length >> 1]; }; return [f(0), f(1), f(2)]; };

function boxPixels(x0, y0, x1, y1) {
  const o = [];
  for (let y = Math.round(y0 * H); y < Math.round(y1 * H); y++)
    for (let x = Math.round(x0 * W); x < Math.round(x1 * W); x++) o.push(px(img, x, y));
  return o;
}
/** median colour of a box, plus the method string that reproduces it. */
function box(x0, y0, x1, y1) {
  const p = medOf(boxPixels(x0, y0, x1, y1));
  return { rgb: p, method: `median of box [${x0},${y0},${x1},${y1}] of frame` };
}
/** median colour of every pixel in a region passing `pred(h,s,v,Y)`. */
function mask(x0, y0, x1, y1, pred, desc) {
  const o = [];
  for (let y = Math.round(y0 * H); y < Math.round(y1 * H); y++)
    for (let x = Math.round(x0 * W); x < Math.round(x1 * W); x++) {
      const p = px(img, x, y); const [h, s, v] = hsv(...p);
      if (pred(h, s, v, lum(...p))) o.push(p);
    }
  if (!o.length) throw new Error('empty mask: ' + desc);
  return { rgb: medOf(o), n: o.length, share: o.length / NPX, method: `median of {${desc}} inside box [${x0},${y0},${x1},${y1}]; n=${o.length} (${(100 * o.length / NPX).toFixed(4)}% of frame)` };
}
/** per-row median across an x span — the sky ramp sampler; median rejects clouds. */
function rowMedian(fy, x0 = 0.30, x1 = 0.70) {
  const o = []; const y = Math.round(fy * H);
  for (let x = Math.round(x0 * W); x < Math.round(x1 * W); x++) o.push(px(img, x, y));
  return { rgb: medOf(o), method: `per-row median over x [${x0},${x1}] at y=${fy}` };
}
function share(pred, desc) {
  let n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = px(img, x, y); const [h, s, v] = hsv(...p);
    if (pred(h, s, v, lum(...p), y / H)) n++;
  }
  return { n, share: r4(n / NPX), method: `frame-wide count of {${desc}}` };
}

/** turn a sample into a palette role. */
function role(sample, extra) {
  const p = sample.rgb, [h, s, v] = hsv(...p);
  return {
    hex: hex(...p), rgb: p, linear: linOf(p), hsv: [Math.round(h), r3(s), r3(v)],
    luminance: r4(lum(...p)),
    measured: sample.method,
    ...extra
  };
}

// ---------------------------------------------------------------- samples ----
const S = {};

// --- sky: a vertical ramp sampled by per-row median, plus its horizontal ends
S.skyZenith = rowMedian(0.000);
S.skyHigh = rowMedian(0.060);
S.skyPivot = rowMedian(0.140);     // saturation minimum of the whole column
S.skyWarm = rowMedian(0.220);
S.skyLow = rowMedian(0.280);
S.skyHorizon = rowMedian(0.340);
S.sunCore = box(0.965, 0.352, 0.995, 0.360);
S.horizonAntiSun = box(0.030, 0.352, 0.070, 0.360);
S.cloudSlab = mask(0.00, 0.00, 1.00, 0.22, (h, s, v, Y) => h >= 20 && h <= 60 && s >= 0.35 && Y >= 0.45, 'hue 20-60 & S>=0.35 & Y>=0.45');

// --- rock: flat facets of the foreground spire complex, brightest to dimmest.
// Boxes sit inside single facets; the sd of each is < 2/255, which is the proof.
S.rockLitA = box(0.302, 0.653, 0.312, 0.662);   // sunlit boulder crown
S.rockLitB = box(0.150, 0.205, 0.166, 0.260);   // spire upper plane
S.rockLitC = box(0.100, 0.235, 0.140, 0.262);   // spire main plane
S.rockLitD = box(0.196, 0.440, 0.216, 0.480);   // spire turning plane
S.rockLitE = box(0.150, 0.340, 0.166, 0.400);   // spire grazing plane
S.rockShadow = box(0.082, 0.240, 0.094, 0.300);   // spire plane turned from the key
S.rockShadowFar = box(0.885, 0.578, 0.905, 0.596); // same family, mid distance

// --- ground: one plane, lit and in its own cast shadow. The key:fill witness.
S.groundLit = box(0.545, 0.760, 0.575, 0.790);
S.groundBright = box(0.290, 0.930, 0.320, 0.960);
S.groundShadow = box(0.530, 0.920, 0.570, 0.950);

// --- foliage: green never leaves the low-value, low-saturation corner here
S.foliage = mask(0.28, 0.62, 0.78, 0.92, (h, s, v, Y) => h >= 60 && h <= 150 && s >= 0.25 && Y < 0.06, 'hue 60-150 & S>=0.25 & Y<0.06');
S.foliageLit = mask(0.00, 0.42, 0.20, 0.52, (h, s, v, Y) => h >= 50 && h <= 150 && s >= 0.25 && Y >= 0.06, 'hue 50-150 & S>=0.25 & Y>=0.06');

// --- the two saturated accents, and nothing else in the frame is allowed here
S.crystalHot = mask(0.00, 0.30, 1.00, 1.00, (h, s, v) => h >= 140 && h <= 200 && s >= 0.20 && v >= 0.92, 'hue 140-200 & S>=0.20 & V>=0.92');
S.crystalFace = mask(0.00, 0.30, 1.00, 1.00, (h, s, v) => h >= 140 && h <= 200 && s >= 0.25 && v >= 0.70 && v < 0.92, 'hue 140-200 & S>=0.25 & 0.70<=V<0.92');
S.waterCore = mask(0.55, 0.50, 0.80, 0.72, (h, s, v) => h >= 150 && h <= 195 && s >= 0.20 && v >= 0.78, 'hue 150-195 & S>=0.20 & V>=0.78');
S.waterBody = mask(0.55, 0.50, 0.80, 0.72, (h, s, v) => h >= 150 && h <= 195 && s >= 0.20 && v >= 0.55 && v < 0.78, 'hue 150-195 & S>=0.20 & 0.55<=V<0.78');

// --- character
S.heroShadow = mask(0.455, 0.520, 0.545, 0.700, (h, s, v, Y) => h >= 185 && h <= 225 && s >= 0.25 && Y < 0.12, 'hue 185-225 & S>=0.25 & Y<0.12');
S.heroRim = box(0.5275, 0.5730, 0.5295, 0.5790);
S.heroHair = box(0.5045, 0.4940, 0.5095, 0.5020);
S.heroDark = mask(0.455, 0.520, 0.545, 0.760, (h, s, v, Y) => Y < 0.012, 'Y<0.012');

S.heroSkin = mask(0.503, 0.518, 0.522, 0.534, (h, s, v, Y) => h >= 5 && h <= 40 && s >= 0.55 && Y >= 0.015 && Y < 0.20, 'hue 5-40 & S>=0.55 & 0.015<=Y<0.20');
S.stoneBone = mask(0.78, 0.310, 0.87, 0.400, (h, s, v, Y) => h >= 15 && h <= 60 && Y < 0.35, 'hue 15-60 & Y<0.35 — the distant city, i.e. built stone rather than terrain');

// --- mathematics
S.mathGlyph = mask(0.40, 0.25, 0.55, 0.33, (h, s, v, Y) => s <= 0.02 && Y >= 0.99, 'S<=0.02 & Y>=0.99');
S.mathBackdrop = mask(0.40, 0.25, 0.55, 0.33, (h, s, v, Y) => !(s <= 0.12 && Y > 0.75), 'everything that is not a glyph (NOT(S<=0.12 & Y>0.75))');

// --- UI
S.uiInk = mask(0.195, 0.030, 0.30, 0.115, (h, s, v, Y) => s <= 0.12 && Y >= 0.70, 'S<=0.12 & Y>=0.70');
S.uiOutline = mask(0.02, 0.030, 0.20, 0.125, (h, s, v, Y) => Y <= 0.006, 'Y<=0.006');
S.uiBarHealth = box(0.080, 0.048, 0.110, 0.062);
S.uiBarEnergy = box(0.080, 0.090, 0.110, 0.104);
S.uiPlateOverSky = box(0.130, 0.087, 0.180, 0.093);
S.uiWorldBehind = box(0.130, 0.0755, 0.180, 0.0800);
S.uiSlotFill = box(0.035, 0.920, 0.048, 0.935);
S.uiSlotBevel = mask(0.015, 0.895, 0.20, 0.955, (h, s, v, Y) => s <= 0.12 && Y >= 0.10 && Y < 0.30, 'S<=0.12 & 0.10<=Y<0.30');
S.uiBandOverSand = box(0.325, 0.860, 0.350, 0.872);
S.uiSandAboveBand = box(0.325, 0.833, 0.350, 0.843);
S.compassFill = box(0.930, 0.100, 0.950, 0.115);

// ------------------------------------------------------------------ laws ----
const transmission = (inside, outside) => [0, 1, 2].map(c => r4(LIN[inside[c]] / LIN[outside[c]]));

const LAW = {};
LAW.keyToFill = {
  witness: 'one ground plane, lit at [0.545,0.760,0.575,0.790] and inside its own cast shadow at [0.530,0.920,0.570,0.950]',
  lit: r4(lum(...S.groundLit.rgb)), shadow: r4(lum(...S.groundShadow.rgb)),
  ratio: r2(lum(...S.groundLit.rgb) / lum(...S.groundShadow.rgb))
};
LAW.facetContrastForeground = {
  witness: 'one rock mass: lit plane [0.100,0.235,0.140,0.262] vs plane turned from the key [0.082,0.240,0.094,0.300]',
  lit: r4(lum(...S.rockLitC.rgb)), shadow: r4(lum(...S.rockShadow.rgb)),
  ratio: r2(lum(...S.rockLitC.rgb) / lum(...S.rockShadow.rgb))
};
LAW.uiPlate = {
  witness: 'bar plate at [0.130,0.087,0.180,0.093] against the same world seen in the gap between the two bars at [0.130,0.0755,0.180,0.0800]',
  transmissionRGB: transmission(S.uiPlateOverSky.rgb, S.uiWorldBehind.rgb),
  alphaOverBlackPlate: r3(1 - transmission(S.uiPlateOverSky.rgb, S.uiWorldBehind.rgb).reduce((a, b) => a + b, 0) / 3)
};
LAW.subtitleBand = {
  witness: 'band at [0.325,0.860,0.350,0.872] against the same ground plane just above it at [0.325,0.833,0.350,0.843]',
  transmissionRGB: transmission(S.uiBandOverSand.rgb, S.uiSandAboveBand.rgb),
  alphaOverBlackPlate: r3(1 - transmission(S.uiBandOverSand.rgb, S.uiSandAboveBand.rgb).slice(0, 2).reduce((a, b) => a + b, 0) / 2)
};

// --- the light rig, DERIVED (a ratio of two measurements, not a sample) ------
{
  const lin = p => [LIN[p[0]], LIN[p[1]], LIN[p[2]]];
  const div = (a, b) => [0, 1, 2].map(c => a[c] / b[c]);
  const toS = v => { v = Math.max(0, Math.min(1, v)); const s = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; return Math.round(s * 255); };
  const asHex = t => { const m = Math.max(...t); return hex(toS(t[0] / m), toS(t[1] / m), toS(t[2] / m)); };

  const fillOverKey = div(lin(S.groundShadow.rgb), lin(S.groundLit.rgb));
  const turnedOverLit = div(lin(S.rockShadow.rgb), lin(S.rockLitC.rgb));
  // one worked albedo, for a stated key colour. Change the key and the albedo moves with it.
  const KEY_HEX = '#FFE3B8';
  const keyLin = [LIN[0xFF], LIN[0xE3], LIN[0xB8]];
  const albedoLin = div(lin(S.rockLitA.rgb), keyLin);
  const groundAlbedoLin = div(lin(S.groundBright.rgb), keyLin);

  const ladder = ['rockLitA', 'rockLitB', 'rockLitC', 'rockLitD', 'rockLitE', 'rockShadow']
    .map(k => ({ stop: k, hex: hex(...S[k].rgb), Y: r4(lum(...S[k].rgb)), impliedNdotL: r3(lum(...S[k].rgb) / lum(...S.rockLitA.rgb)) }));

  LAW.lightRig = {
    status: 'DERIVED, not sampled. Every number here is arithmetic on two measured colours; the arithmetic is printed so it can be redone.',
    fillOverKeyRGB: fillOverKey.map(r4),
    fillOverKeyLuminance: r3(lum(...S.groundShadow.rgb) / lum(...S.groundLit.rgb)),
    fillTintHex: asHex(fillOverKey),
    fillTintDerivation: 'linear(ground.shadow) / linear(ground.lit), normalised to its own maximum channel. One up-facing plane, lit and in its own cast shadow, so the albedo cancels and what is left is fill/(key+fill).',
    turnedFaceOverLitRGB: turnedOverLit.map(r4),
    turnedFaceOverLitLuminance: r3(lum(...S.rockShadow.rgb) / lum(...S.rockLitC.rgb)),
    turnedFaceDerivation: 'linear(rock.shadow) / linear(rock.lit.c). Same shape as fillOverKey (B >> G >> R) at ~3.7x less energy, which is what a vertical, partly self-occluded face receives from the same hemisphere.',
    workedCalibration: {
      keyHex: KEY_HEX,
      keyNote: 'A warm white, deliberately less yellow than the sun GLOW (sky.sun) — the glow is the key seen through atmosphere, not the key.',
      rockAlbedoLinear: albedoLin.map(r4), rockAlbedoHex: hex(toS(albedoLin[0]), toS(albedoLin[1]), toS(albedoLin[2])),
      groundAlbedoLinear: groundAlbedoLin.map(r4), groundAlbedoHex: hex(toS(groundAlbedoLin[0]), toS(groundAlbedoLin[1]), toS(groundAlbedoLin[2])),
      derivation: 'albedo = linear(brightest measured facet) / linear(key), i.e. the albedo that renders the measured facet at N.L = 1 under that key. Choose a different key and redo this division; do not copy the hex without the key it came from.'
    },
    valueLadder: ladder,
    valueLadderNote: 'The value ladder IS the cosine ladder. Divide each facet luminance by the brightest facet and you have N.L. A render whose facets do not sit on a cosine has either smooth normals or a tonemap doing the shading.'
  };
}

// --- cloud slab against the sky at its own altitude --------------------------
{
  const pairs = [
    { slab: box(0.795, 0.086, 0.815, 0.094), sky: box(0.795, 0.055, 0.815, 0.062) },
    { slab: box(0.295, 0.104, 0.320, 0.111), sky: box(0.295, 0.075, 0.320, 0.082) }
  ].map(p => {
    const [sh] = hsv(...p.slab.rgb), [kh] = hsv(...p.sky.rgb);
    return {
      slabHex: hex(...p.slab.rgb), slabY: r4(lum(...p.slab.rgb)), slabHue: Math.round(sh),
      skyHex: hex(...p.sky.rgb), skyY: r4(lum(...p.sky.rgb)), skyHue: Math.round(kh),
      luminanceRatio: r2(lum(...p.slab.rgb) / lum(...p.sky.rgb)), deltaHue: Math.round(Math.abs(kh - sh))
    };
  });
  // how hard is a cloud edge? vertical scans across slab silhouettes
  const w = [];
  for (let x = Math.round(0.735 * W); x < Math.round(0.855 * W); x += 3) {
    let run = null;
    for (let y = Math.round(0.040 * H); y < Math.round(0.130 * H); y++) {
      const a = lum(...px(img, x, y)), b = lum(...px(img, x, y + 1)), d = b - a;
      if (Math.abs(d) > 0.02) { if (!run) run = { dir: Math.sign(d), n: 0, y0: a }; if (Math.sign(d) === run.dir) run.n++; }
      else if (run) { if (Math.abs(lum(...px(img, x, y)) - run.y0) > 0.15) w.push(run.n); run = null; }
    }
  }
  w.sort((a, b) => a - b);
  LAW.cloudAgainstSky = {
    pairs,
    edgeWidthPx: { at2752: { n: w.length, median: w[Math.floor(.5 * (w.length - 1))], p90: w[Math.floor(.9 * (w.length - 1))] }, at1920Median: r2(w[Math.floor(.5 * (w.length - 1))] * 1920 / 2752) },
    method: 'a box inside a cloud slab against a box of clean sky directly above it at the same x; edge width from vertical scans across the slab silhouettes over x [0.735,0.855]'
  };
}

// --- compass disc: transmission of the world behind it -----------------------
{
  const rows = [0.045, 0.075, 0.105, 0.135].map(fy => {
    const inside = box(0.905, fy, 0.915, fy + 0.006), outside = box(0.855, fy, 0.865, fy + 0.006);
    return { y: fy, insideHex: hex(...inside.rgb), insideY: r4(lum(...inside.rgb)), outsideHex: hex(...outside.rgb), outsideY: r4(lum(...outside.rgb)), transmission: r3(lum(...inside.rgb) / lum(...outside.rgb)) };
  });
  LAW.compassDisc = {
    rows,
    transmissionRange: [Math.min(...rows.map(r => r.transmission)), Math.max(...rows.map(r => r.transmission))],
    method: 'a box inside the disc against a box of the same sky/cloud band immediately to its left, at four altitudes',
    caveat: 'SOFT. The disc also draws a view cone and tick marks, so this is a composite range, not a clean alpha solve. It is quoted as a range for that reason.'
  };
}

// --- distant silhouettes hold; distant ground planes do not ------------------
{
  const sil = [
    { name: 'right city tower', obj: box(0.8125, 0.330, 0.8175, 0.342), sky: box(0.8050, 0.330, 0.8090, 0.342) },
    { name: 'left city tower', obj: box(0.2500, 0.341, 0.2530, 0.350), sky: box(0.2420, 0.341, 0.2460, 0.350) }
  ].map(s => ({ name: s.name, objHex: hex(...s.obj.rgb), objY: r4(lum(...s.obj.rgb)), skyHex: hex(...s.sky.rgb), skyY: r4(lum(...s.sky.rgb)), ratio: r2(lum(...s.obj.rgb) / lum(...s.sky.rgb)) }));
  const litFar = box(0.360, 0.370, 0.390, 0.378), turnedFar = box(0.400, 0.378, 0.430, 0.386);
  LAW.distantSilhouette = {
    verticals: sil,
    groundPlaneConvergence: { litHex: hex(...litFar.rgb), litY: r4(lum(...litFar.rgb)), turnedHex: hex(...turnedFar.rgb), turnedY: r4(lum(...turnedFar.rgb)), ratio: r2(lum(...litFar.rgb) / lum(...turnedFar.rgb)) },
    note: 'Ground planes at the horizon lose all facet contrast (ratio ~0.94, i.e. gone). Verticals keep 0.3-0.4x the sky beside them and stay readable. That asymmetry is what lets a horizon pose a question.'
  };
}

// --- where the cool accent budget is actually spent ---------------------------
{
  const inGate = (h, s, v) => h >= 150 && h <= 200 && v >= 0.80 && s >= 0.25;
  const regions = [['carry / river', 0.55, 0.45, 0.82, 0.72], ['near crystal', 0.34, 0.44, 0.46, 0.60], ['foreground crystal', 0.74, 0.60, 0.90, 0.75], ['city window strips', 0.86, 0.38, 1.00, 0.52]];
  LAW.accentSplit = {
    method: 'the frame-wide accent gate (hue 150-200, V>=0.80, S>=0.25) counted inside each named region',
    caveat: 'THESE BOXES OVERLAP and therefore sum above the frame-wide total. The frame-wide census.coolAccent value is the one that governs.',
    regions: regions.map(([name, a, b, c, d]) => {
      let n = 0;
      for (let y = Math.round(b * H); y < Math.round(d * H); y++) for (let x = Math.round(a * W); x < Math.round(c * W); x++) {
        const p = px(img, x, y); const [h, s, v] = hsv(...p); if (inGate(h, s, v)) n++;
      }
      return { name, box: [a, b, c, d], n, shareOfFrame: r4(n / NPX) };
    })
  };
}

// --- facet census: how many countable planes does one rock mass resolve into? -
const facetCensus = (bx0, by0, bx1, by1, label) => {
  const x0 = Math.round(bx0 * W), x1 = Math.round(bx1 * W);
  const y0 = Math.round(by0 * H), y1 = Math.round(by1 * H);
  const bw = x1 - x0, bh = y1 - y0, n = bw * bh;
  const seen = new Uint8Array(n), stack = new Int32Array(n);
  const idx = (x, y) => (y - y0) * bw + (x - x0);
  const found = [];
  const TOL = 2, MIN = Math.round(0.0002 * NPX);   // 0.02% of frame
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = idx(x, y); if (seen[i]) continue;
    const seed = px(img, x, y);
    let sp = 0; stack[sp++] = i; seen[i] = 1; let area = 0, sr = 0, sg = 0, sb = 0;
    let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
    while (sp) {
      const j = stack[--sp], jx = x0 + (j % bw), jy = y0 + ((j / bw) | 0);
      if (jx < mnx) mnx = jx; if (jx > mxx) mxx = jx; if (jy < mny) mny = jy; if (jy > mxy) mxy = jy;
      const p = px(img, jx, jy); area++; sr += p[0]; sg += p[1]; sb += p[2];
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = jx + dx, ny = jy + dy;
        if (nx < x0 || nx >= x1 || ny < y0 || ny >= y1) continue;
        const k = idx(nx, ny); if (seen[k]) continue;
        const q = px(img, nx, ny);
        if (Math.abs(q[0] - seed[0]) <= TOL && Math.abs(q[1] - seed[1]) <= TOL && Math.abs(q[2] - seed[2]) <= TOL) { seen[k] = 1; stack[sp++] = k; }
      }
    }
    // A FACET is compact. A slice of a smooth gradient is a long thin ribbon that also
    // survives a +/-2 flood fill, and without this filter a gouraud sky scores as a cliff.
    const bbw = mxx - mnx + 1, bbh = mxy - mny + 1;
    const fill = area / (bbw * bbh), aspect = Math.max(bbw / bbh, bbh / bbw);
    if (area >= MIN && fill >= 0.25 && aspect <= 6) found.push({ area, shareOfFrame: r4(area / NPX), fill: r2(fill), aspect: r2(aspect), hex: hex(Math.round(sr / area), Math.round(sg / area), Math.round(sb / area)), Y: r4(lum(Math.round(sr / area), Math.round(sg / area), Math.round(sb / area))) });
  }
  found.sort((a, b) => b.area - a.area);
  return {
    region: `${label}, box [${bx0},${by0},${bx1},${by1}]`,
    method: `4-connected flood fill, per-channel tolerance ${TOL}/255 against the seed pixel; a region counts if it is >=0.02% of frame AND compact (bbox fill >=0.25, aspect <=6). The compactness filter is what separates a FACET from a slice of a smooth gradient, which also survives a +/-2 flood fill`,
    countablePlanes: found.length,
    largestPlaneShareOfFrame: found.length ? found[0].shareOfFrame : 0,
    planes: found.slice(0, 14)
  };
};
LAW.facetCensus = {
  rockMass: facetCensus(0.055, 0.120, 0.270, 0.600, 'the foreground rock mass'),
  character: (() => { const c = facetCensus(0.455, 0.470, 0.550, 0.780, 'the character'); c.method += '; minimum area lowered to 0.002% for a figure this size'; return c; })(),
  note: 'A cliff resolves into a countable number of planes. That is the whole geometry law in one measurement.'
};
// the character's facets are far smaller than 0.02% of frame, so recount at a lower floor
{
  const x0 = Math.round(0.455 * W), x1 = Math.round(0.550 * W), y0 = Math.round(0.470 * H), y1 = Math.round(0.780 * H);
  const bw = x1 - x0, n = bw * (y1 - y0);
  const seen = new Uint8Array(n), stack = new Int32Array(n);
  const idx = (x, y) => (y - y0) * bw + (x - x0);
  const TOL = 2, MIN = Math.round(0.0001 * NPX);   // 0.01% of frame ~ 21x21 px at 2752
  let count = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = idx(x, y); if (seen[i]) continue;
    const seed = px(img, x, y);
    let sp = 0; stack[sp++] = i; seen[i] = 1; let area = 0;
    while (sp) {
      const j = stack[--sp], jx = x0 + (j % bw), jy = y0 + ((j / bw) | 0); area++;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = jx + dx, ny = jy + dy;
        if (nx < x0 || nx >= x1 || ny < y0 || ny >= y1) continue;
        const k = idx(nx, ny); if (seen[k]) continue;
        const q = px(img, nx, ny);
        if (Math.abs(q[0] - seed[0]) <= TOL && Math.abs(q[1] - seed[1]) <= TOL && Math.abs(q[2] - seed[2]) <= TOL) { seen[k] = 1; stack[sp++] = k; }
      }
    }
    if (area >= MIN) count++;
  }
  LAW.facetCensus.character = { region: 'the character, box [0.455,0.470,0.550,0.780]', method: '4-connected flood fill, tolerance 2/255, regions of at least 0.01% of frame (~21x21 px at 2752) counted — a figure is far smaller than a cliff', countablePlanes: count };
}

// --- the dark end is BIMODAL, and section 3.4 requires it to be ----------------
// This is the evidence behind section 13 rows 3 and 4. Two populations, both dark,
// both chromatic, ~79 degrees apart: faces TURNED from the key (which converge on
// rock.shadow whatever their albedo) and up-facing ground inside a CAST shadow
// (which keeps its own albedo and rotates only part-way). A median taken over the
// union of the two lands in the trough between them, at a hue no surface here is.
{
  const pop = (h0, h1) => {
    const hs = [], ss = [], ys = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = px(img, x, y); const Y = lum(...p); if (Y > 0.06) continue;
      const [h, s] = hsv(...p); if (h < h0 || h > h1) continue;
      hs.push(h); ss.push(s); ys.push(Y);
    }
    hs.sort((a, b) => a - b); ss.sort((a, b) => a - b); ys.sort((a, b) => a - b);
    return { n: hs.length, shareOfFrame: r4(hs.length / NPX), medianHue: r2(hs[hs.length >> 1]), medianS: r3(ss[ss.length >> 1]), medianY: r4(ys[ys.length >> 1]) };
  };
  const hist = {};
  { let tot = 0; const bins = new Array(36).fill(0);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const p = px(img, x, y); if (lum(...p) > 0.06) continue; bins[Math.min(35, Math.floor(hsv(...p)[0] / 10))]++; tot++; }
    bins.forEach((b, i) => { if (b / tot >= 0.03) hist[`${i * 10}-${i * 10 + 10}`] = r3(b / tot); });
    hist.totalDarkPixels = tot; hist.totalDarkShareOfFrame = r4(tot / NPX);
  }
  const turned = pop(170, 220), cast = pop(60, 150), all = pop(0, 360);
  LAW.darkPopulations = {
    method: 'every pixel at Y<=0.06, split by hue window. Medians are of the exact float hue, never a rounded one (see howToRegenerate.samplingRules).',
    turnedFromKey: { hueWindow: [170, 220], ...turned, meaning: 'section 13 row 3. A face turned from the key, any albedo, converges here — rock #1B2C33 hue 198, shelf underside #202C30 hue 195, armour #1F323C hue 201.' },
    castShadowOnGround: { hueWindow: [60, 150], ...cast, meaning: 'section 13 row 4. An UP-FACING plane inside a cast shadow still sees the whole sky, so it keeps its albedo and rotates only part-way: ground.shadow #223522, hue 120.' },
    separationDeg: r2(turned.medianHue - cast.medianHue),
    unionIsMeaningless: { ...all, why: `A median over ALL dark pixels returns hue ${r2(all.medianHue)}, which sits in the trough BETWEEN the two modes and describes no surface in this picture. Any gate written on the union punishes section 3.4 and can only be passed by breaking it.` },
    hueHistogram10Deg: hist
  };
}

// depth: luminance spread inside horizontal bands. The x window is PART OF THE PREDICATE
// and is published on every row: the left and right 25%/15% of the frame are the foreground
// spire and the right-hand shelf, which are near objects sitting inside a far band's rows.
// Sampling full width mixes them in and the numbers move a long way (far 3.08 -> 8.79,
// midfar 12.05 -> 25.27), so a table quoting only "band (y)" is not reproducible.
const DEPTH_X = [0.25, 0.85];
LAW.depthBandsMethod = `per-band luminance/saturation percentiles over the pixel rectangle y in [y0,y1) AND x in [${DEPTH_X[0]},${DEPTH_X[1]}) of frame. The x window is part of the predicate, not a detail: it excludes the foreground spire (x<0.25) and the right-hand floating shelf (x>0.85), which are NEAR objects occupying rows that belong to FAR bands. Sampling full width instead gives far 8.79 / midfar 25.27 / mid 31.99 / near 22.84 and far medianS 0.575 — different numbers for a different question.`;
LAW.depthBands = [];
for (const [name, y0, y1] of [['far', 0.36, 0.42], ['midfar', 0.42, 0.52], ['mid', 0.52, 0.64], ['near', 0.64, 0.78]]) {
  const ys = [], ss = [];
  for (let y = Math.round(y0 * H); y < Math.round(y1 * H); y++)
    for (let x = Math.round(DEPTH_X[0] * W); x < Math.round(DEPTH_X[1] * W); x++) { const p = px(img, x, y); ys.push(lum(...p)); ss.push(hsv(...p)[1]); }
  ys.sort((a, b) => a - b); ss.sort((a, b) => a - b);
  const q = (a, p) => a[Math.floor(p * (a.length - 1))];
  LAW.depthBands.push({ band: name, y: [y0, y1], x: DEPTH_X, n: ys.length, p05: r4(q(ys, .05)), p50: r4(q(ys, .50)), p95: r4(q(ys, .95)), contrast: r2(q(ys, .95) / q(ys, .05)), medianS: r3(q(ss, .50)) });
}
// same-object facet contrast at three depths
LAW.facetContrastByDepth = [
  { depth: 'foreground', ratio: r2(lum(...S.rockLitC.rgb) / lum(...S.rockShadow.rgb)) },
  { depth: 'mid', ratio: r2(lum(...box(0.880, 0.525, 0.920, 0.535).rgb) / lum(...S.rockShadowFar.rgb)) },
  { depth: 'horizon', ratio: r2(lum(...box(0.360, 0.370, 0.390, 0.378).rgb) / lum(...box(0.400, 0.378, 0.430, 0.386).rgb)) }
];

// facet-edge transition width: how many px a >0.15 luminance step takes to finish
{
  const widths = [];
  for (let y = Math.round(0.20 * H); y < Math.round(0.60 * H); y += 7) {
    let run = null;
    for (let x = Math.round(0.05 * W); x < Math.round(0.30 * W); x++) {
      const a = lum(...px(img, x, y)), b = lum(...px(img, x + 1, y)), d = b - a;
      if (Math.abs(d) > 0.02) { if (!run) run = { dir: Math.sign(d), n: 0, y0: a }; if (Math.sign(d) === run.dir) run.n++; }
      else if (run) { if (Math.abs(lum(...px(img, x, y)) - run.y0) > 0.15) widths.push(run.n); run = null; }
    }
  }
  widths.sort((a, b) => a - b);
  const q = p => widths[Math.floor(p * (widths.length - 1))];
  LAW.facetEdgeWidthPx = { at2752: { n: widths.length, p25: q(.25), median: q(.5), p75: q(.75), p90: q(.9) }, at1920Median: r2(q(.5) * 1920 / 2752), method: 'horizontal scans every 7 rows over x [0.05,0.30], y [0.20,0.60]; width of a monotone run that completes a >0.15 luminance step' };
}
// acutance by depth: how many px a hard edge takes to complete, near vs far
{
  const measure = (x0, y0, x1, y1, step) => {
    const w = [];
    for (let y = Math.round(y0 * H); y < Math.round(y1 * H); y += step) {
      let run = null;
      for (let x = Math.round(x0 * W); x < Math.round(x1 * W); x++) {
        const a = lum(...px(img, x, y)), b = lum(...px(img, x + 1, y)), d = b - a;
        if (Math.abs(d) > 0.015) { if (!run) run = { dir: Math.sign(d), n: 0, y0: a }; if (Math.sign(d) === run.dir) run.n++; }
        else if (run) { if (Math.abs(lum(...px(img, x, y)) - run.y0) > 0.12) w.push(run.n); run = null; }
      }
    }
    w.sort((a, b) => a - b);
    return { n: w.length, p25: w[Math.floor(.25 * (w.length - 1))], median: w[Math.floor(.5 * (w.length - 1))], p90: w[Math.floor(.9 * (w.length - 1))] };
  };
  LAW.acutanceByDepth = {
    method: 'width in px (frame is 2752 wide) of a monotone run that completes a >0.12 luminance step, on horizontal scans inside each band',
    foreground: { box: [0.05, 0.20, 0.30, 0.60], ...measure(0.05, 0.20, 0.30, 0.60, 7) },
    near: { box: [0.44, 0.62, 0.60, 0.80], ...measure(0.44, 0.62, 0.60, 0.80, 5) },
    mid: { box: [0.33, 0.44, 0.52, 0.60], ...measure(0.33, 0.44, 0.52, 0.60, 5) },
    midFar: { box: [0.55, 0.44, 0.85, 0.58], ...measure(0.55, 0.44, 0.85, 0.58, 5) },
    far: { box: [0.76, 0.30, 0.90, 0.40], ...measure(0.76, 0.30, 0.90, 0.40, 3) },
    note: 'The near field is sharp and the far field is soft: median edge width goes 2 -> 5 -> 6 -> 7 px across the depth range. That is a far-only depth of field, not a symmetric one.'
  };
}

// within-facet flatness: the largest luminance excursion along a 140 px scan inside one facet
{
  const ys = [];
  for (let x = Math.round(0.1000 * W); x < Math.round(0.1400 * W); x++) ys.push(lum(...px(img, x, Math.round(0.24 * H))));
  const ys2 = [];
  for (let y = Math.round(0.3410 * H); y < Math.round(0.3960 * H); y++) ys2.push(lum(...px(img, Math.round(0.155 * W), y)));
  LAW.withinFacetFlatness = {
    horizontalScan: { scan: 'y=0.24, x 0.1000->0.1400, inside one lit plane', n: ys.length, minY: r4(Math.min(...ys)), maxY: r4(Math.max(...ys)), spread: r4(Math.max(...ys) - Math.min(...ys)) },
    verticalScan: { scan: 'x=0.155, y 0.3410->0.3960, inside one grazing plane', n: ys2.length, minY: r4(Math.min(...ys2)), maxY: r4(Math.max(...ys2)), spread: r4(Math.max(...ys2) - Math.min(...ys2)) },
    note: 'A facet is EXACTLY one colour. Any shading gradient across a single face is a bug, not a nicety.'
  };
}
// sky is a smooth ramp, not a posterised one
{
  const seen = new Set(); let prev = null, changes = 0, run = 0, longest = 0;
  for (let y = 0; y < Math.round(0.30 * H); y++) {
    const k = hex(...px(img, Math.round(0.63 * W), y));
    seen.add(k); if (prev && k !== prev) { changes++; longest = Math.max(longest, run); run = 1; } else run++;
    prev = k;
  }
  LAW.skySmoothness = { column: 0.63, rows: Math.round(0.30 * H), distinctColours: seen.size, changes, longestConstantRun: longest };
}
// horizontal sky gradient across frame at the horizon
LAW.skyHorizontal = {
  antiSun: r4(lum(...S.horizonAntiSun.rgb)), sunSide: r4(lum(...S.sunCore.rgb)),
  ratio: r2(lum(...S.sunCore.rgb) / lum(...S.horizonAntiSun.rgb)),
  method: 'box [0.030,0.352,0.070,0.360] vs box [0.965,0.352,0.995,0.360]'
};
// glyph legibility
{
  const runs = [];
  for (let y = Math.round(0.26 * H); y < Math.round(0.32 * H); y++) {
    let n = 0;
    for (let x = Math.round(0.40 * W); x < Math.round(0.55 * W); x++) {
      const p = px(img, x, y);
      if (p[0] > 245 && p[1] > 245 && p[2] > 240) n++; else { if (n) runs.push(n); n = 0; }
    }
  }
  runs.sort((a, b) => a - b);
  const q = p => runs[Math.floor(p * (runs.length - 1))];
  const bg = [];
  for (let y = Math.round(0.25 * H); y < Math.round(0.33 * H); y++)
    for (let x = Math.round(0.40 * W); x < Math.round(0.55 * W); x++) {
      const p = px(img, x, y); const [, s] = hsv(...p);
      if (!(s <= 0.12 && lum(...p) > 0.75)) bg.push(lum(...p));
    }
  bg.sort((a, b) => a - b);
  LAW.glyph = {
    strokeRunsPx: { at2752: { n: runs.length, p25: q(.25), median: q(.5), p90: q(.9) }, at1920Median: r2(q(.5) * 1920 / 2752) },
    backdropY: { median: r4(bg[Math.floor(0.5 * bg.length)]), p99: r4(bg[Math.floor(0.99 * bg.length)]) },
    contrastMedian: r2(1 / bg[Math.floor(0.5 * bg.length)]),
    contrastWorst: r2(1 / bg[Math.floor(0.99 * bg.length)]),
    method: 'pure-white horizontal runs and non-glyph backdrop luminance inside box [0.40,0.25,0.55,0.33]'
  };
}
// UI geometry, read off luminance edges rather than guessed
{
  const rows = []; let prev = false;
  for (let y = Math.round(0.010 * H); y < Math.round(0.130 * H); y++) {
    const dark = lum(...px(img, Math.round(0.15 * W), y)) < 0.030;
    if (dark && !prev) rows.push([r4(y / H), null]); if (!dark && prev) rows[rows.length - 1][1] = r4(y / H); prev = dark;
  }
  const band = []; prev = false;
  for (let y = Math.round(0.80 * H); y < Math.round(0.95 * H); y++) {
    const dark = lum(...px(img, Math.round(0.31 * W), y)) < 0.045;
    if (dark && !prev) band.push([r4(y / H), null]); if (!dark && prev) band[band.length - 1][1] = r4(y / H); prev = dark;
  }
  // horizontal extent of the bar plate: scan ALONG the lower bar's bottom outline row,
  // which is below the numerals and therefore contains nothing but the plate edge.
  const outlineRow = Math.round(((rows[3][0] + rows[3][1]) / 2) * H);
  let left = null, right = null;
  for (let x = Math.round(0.005 * W); x < Math.round(0.30 * W); x++) {
    if (lum(...px(img, x, outlineRow)) < 0.030) { if (left === null) left = x / W; right = x / W; }
  }
  LAW.uiGeometry = {
    barOutlineRows: rows,
    barPlateXExtentFracW: [r4(left), r4(right)],
    barPlateWidthFracW: r4(right - left),
    barHeightFracH: r4(rows[1][0] - rows[0][0]),
    outlineThicknessFracH: r4(rows[0][1] - rows[0][0]),
    gapBetweenBarsFracH: r4(rows[2][0] - rows[1][1]),
    subtitleBandRows: band,
    subtitleBandHeightFracH: r4(band[0][1] - band[0][0]),
    method: 'vertical luminance-threshold scans: bars at x=0.15 with Y<0.030, subtitle band at x=0.31 with Y<0.045'
  };
}

// ---------------------------------------------------------------- census ----
const CENSUS = {
  warmLitSubstance: share((h, s, v, Y) => h >= 20 && h <= 50 && s >= 0.40 && Y >= 0.08, 'hue 20-50 & S>=0.40 & Y>=0.08'),
  coolShadow: share((h, s, v, Y) => h >= 170 && h <= 220 && Y <= 0.06, 'hue 170-220 & Y<=0.06'),
  coolAccent: share((h, s, v) => h >= 150 && h <= 200 && v >= 0.80 && s >= 0.25, 'hue 150-200 & V>=0.80 & S>=0.25'),
  coolAccentAboveHorizon: share((h, s, v, Y, fy) => h >= 150 && h <= 200 && v >= 0.80 && s >= 0.25 && fy < 0.30, 'hue 150-200 & V>=0.80 & S>=0.25 & y<0.30'),
  green: share((h, s, v) => h >= 60 && h <= 150 && s >= 0.25, 'hue 60-150 & S>=0.25'),
  nearNeutral: share((h, s) => s <= 0.08, 'S<=0.08'),
  blown: share((h, s, v, Y) => Y >= 0.90, 'Y>=0.90'),
  pureWhite: share((h, s, v, Y) => Y >= 0.9999, 'Y>=0.9999 (pure #FFFFFF)'),
  crushed: share((h, s, v, Y) => Y <= 0.004, 'Y<=0.004')
};
{
  const ys = [];
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) ys.push(lum(...px(img, x, y)));
  ys.sort((a, b) => a - b);
  const q = p => r4(ys[Math.floor(p * (ys.length - 1))]);
  CENSUS.luminancePercentiles = { p01: q(.01), p05: q(.05), p25: q(.25), p50: q(.50), p75: q(.75), p95: q(.95), p99: q(.99), method: 'every 2nd pixel in x and y of the whole frame' };
}

// --------------------------------------------------------- --check <shot> ----
// Runs the arithmetic half of art-direction.md section 13 against one of OUR captures.
// Same code path, same predicates, same decoder as the numbers the target produced.
{
  const ci = process.argv.indexOf('--check');
  if (ci >= 0 && process.argv[ci + 1]) {
    const shot = readPNG(process.argv[ci + 1]);
    const sw = shot.width, sh = shot.height, snp = sw * sh;
    const sp = (x, y) => px(shot, x, y);
    const rows = [];
    const add = (n, name, got, ok, want) => rows.push({ n, name, got, want, verdict: ok ? 'PASS' : 'FAIL' });

    // shares
    const cnt = pred => { let c = 0; for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) { const p = sp(x, y); const [h, s, v] = hsv(...p); if (pred(h, s, v, lum(...p), y / sh)) c++; } return c / snp; };
    const accent = cnt((h, s, v) => h >= 150 && h <= 200 && v >= 0.80 && s >= 0.25);
    add(5, 'cool accent share', (100 * accent).toFixed(3) + '%', accent >= 0.004 && accent <= 0.018, '0.4-1.8%');

    // --- rows 3 and 4: the two dark populations, measured SEPARATELY on purpose ---------
    //
    // The dark end of this picture is BIMODAL and section 3.4 REQUIRES it to be. Histogram
    // the target's Y<=0.06 pixels in 10-degree hue bins and 41.3% land at hue 180-210 (faces
    // turned from the key, which converge on rock.shadow at hue ~198) while 29.4% land at
    // hue 100-140 (ground inside a cast shadow, which keeps its own albedo and rotates only
    // part-way, to hue ~120). Median over BOTH populations at once returns hue 147 — a hue
    // no surface in the target actually is, sitting in the trough between the two modes.
    // A row written that way punishes the exact behaviour section 3.4 mandates, and the only
    // way to pass it is to blue-shift the ground shadows, i.e. to break section 3.4.
    //
    // So row 3 gates the TURNED-FACE population using section 7.1's own published predicate
    // (hue 170-220, Y<=0.06), and row 4 gates the COMPLEMENTARY cast-shadow population
    // (hue 60-150, Y<=0.06) and computes their separation. Passing both is only possible if
    // the render has BOTH families, at the right hues, at the right distance apart.
    const darkPop = (h0, h1) => {
      const hs = [], ss = [];
      for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
        const p = sp(x, y); if (lum(...p) > 0.06) continue;
        const [h, s] = hsv(...p); if (h < h0 || h > h1) continue;
        hs.push(h); ss.push(s);
      }
      hs.sort((a, b) => a - b); ss.sort((a, b) => a - b);
      return { n: hs.length, share: hs.length / snp, hue: hs.length ? hs[hs.length >> 1] : NaN, s: ss.length ? ss[ss.length >> 1] : NaN };
    };
    const turned = darkPop(170, 220);   // target: n 389254, 9.21% of frame, hue 199.2, S 0.446
    const cast = darkPop(60, 150);      // target: n 298607, 7.06% of frame, hue 120.0, S 0.370

    // Row 3 also gates the population's SIZE, using section 7.1's already-published band
    // (0.05-0.16). Without that, a frame containing forty blue pixels and no shadow at all
    // would score a perfect median hue. The hue window makes the row correct; the share
    // window is what stops it being vacuous.
    add(3, 'turned-face shadow hue', Number.isNaN(turned.hue) ? 'no such pixels' : `hue ${turned.hue.toFixed(0)} S ${turned.s.toFixed(2)} at ${(100 * turned.share).toFixed(2)}% of frame`,
      turned.share >= 0.05 && turned.share <= 0.16 && turned.hue >= 190 && turned.hue <= 206 && turned.s >= 0.30,
      'hue 190-206, S>=0.30, over 5-16% of frame');

    // Row 4 is the anti-gaming clamp on row 3. AUTHORED floor: 2% of frame, because below
    // that there is not enough ground-in-shadow for a median to mean anything; the target
    // measures 7.06%, more than three times it.
    const dHue = (Number.isNaN(turned.hue) || Number.isNaN(cast.hue)) ? NaN : turned.hue - cast.hue;
    add(4, 'cast-shadow hue, and the split', Number.isNaN(cast.hue) ? 'no such pixels' : `hue ${cast.hue.toFixed(0)} at ${(100 * cast.share).toFixed(2)}% of frame, dHue ${Number.isNaN(dHue) ? '--' : dHue.toFixed(0)}`,
      cast.share >= 0.02 && cast.hue >= 100 && cast.hue <= 140 && dHue >= 50,
      'hue 100-140 over >=2% of frame, and dHue vs row 3 >= 50');

    // sky column saturation minimum + banding
    { let minS = 1, longest = 0, run = 0, prev = null;
      for (let y = 0; y < Math.round(0.30 * sh); y++) { const p = sp(Math.round(0.63 * sw), y); const [, s] = hsv(...p); if (s < minS) minS = s;
        const k = hex(...p); if (k === prev) run++; else { longest = Math.max(longest, run); run = 1; } prev = k; }
      longest = Math.max(longest, run);
      add(7, 'sky column min saturation', minS.toFixed(3), minS <= 0.16, '<=0.16');
      add(8, 'longest constant sky run', longest + ' rows', longest <= 6, '<=6 rows'); }

    // depth bands — SAME x window as LAW.depthBands (x 0.25-0.85), which is part of the
    // predicate and is published on every row of section 7.3 and of laws.depthBands.
    { const band = (y0, y1) => { const ys = [], ss = []; for (let y = Math.round(y0 * sh); y < Math.round(y1 * sh); y++) for (let x = Math.round(DEPTH_X[0] * sw); x < Math.round(DEPTH_X[1] * sw); x++) { const p = sp(x, y); ys.push(lum(...p)); ss.push(hsv(...p)[1]); } ys.sort((a, b) => a - b); ss.sort((a, b) => a - b); const q = (a, p) => a[Math.floor(p * (a.length - 1))]; return { c: q(ys, .95) / Math.max(1e-6, q(ys, .05)), s: q(ss, .5) }; };
      const far = band(0.36, 0.42), mid = band(0.52, 0.64);
      add(10, 'band contrast far / mid', `${far.c.toFixed(1)} / ${mid.c.toFixed(1)}`, far.c <= 5 && mid.c >= 15, 'far<=5, mid>=15');
      add(11, 'median S in the far band', far.s.toFixed(3), far.s >= 0.45, '>=0.45'); }

    // exposure
    { const ys = []; for (let y = 0; y < sh; y += 2) for (let x = 0; x < sw; x += 2) ys.push(lum(...sp(x, y))); ys.sort((a, b) => a - b);
      const p50 = ys[ys.length >> 1];
      const blown = ys.filter(v => v >= 0.90).length / ys.length, crushed = ys.filter(v => v <= 0.004).length / ys.length;
      add(12, 'frame Y p50', p50.toFixed(4), p50 >= 0.18 && p50 <= 0.32, '0.18-0.32');
      add(13, 'share Y>=0.90', (100 * blown).toFixed(3) + '%', blown >= 0.002 && blown <= 0.020, '0.2-2.0%');
      add(14, 'share Y<=0.004', (100 * crushed).toFixed(3) + '%', crushed <= 0.012, '<=1.2%'); }

    // edge hardness in the foreground
    { const w = []; for (let y = Math.round(0.20 * sh); y < Math.round(0.80 * sh); y += 7) { let run = null;
        for (let x = 1; x < sw - 1; x++) { const a = lum(...sp(x, y)), b = lum(...sp(x + 1, y)), d = b - a;
          if (Math.abs(d) > 0.015) { if (!run) run = { dir: Math.sign(d), n: 0, y0: a }; if (Math.sign(d) === run.dir) run.n++; }
          else if (run) { if (Math.abs(lum(...sp(x, y)) - run.y0) > 0.12) w.push(run.n); run = null; } } }
      w.sort((a, b) => a - b);
      const med = w.length ? w[w.length >> 1] : 999;
      add(2, 'foreground edge width', w.length ? `${med} px @${sw}` : 'no hard edges found', w.length > 20 && med * 1920 / sw <= 3, '<=3 px at 1920, and hard edges must EXIST'); }

    // countable planes across the whole frame
    { const seen = new Uint8Array(snp), stack = new Int32Array(snp); let planes = 0;
      const MIN = Math.round(0.0002 * snp);
      for (let i = 0; i < snp; i++) { if (seen[i]) continue; const seed = sp(i % sw, (i / sw) | 0);
        let s2 = 0; stack[s2++] = i; seen[i] = 1; let area = 0, mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
        while (s2) { const j = stack[--s2], jx = j % sw, jy = (j / sw) | 0; area++;
          if (jx < mnx) mnx = jx; if (jx > mxx) mxx = jx; if (jy < mny) mny = jy; if (jy > mxy) mxy = jy;
          for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) { const nx = jx + dx, ny = jy + dy;
            if (nx < 0 || nx >= sw || ny < 0 || ny >= sh) continue; const k = ny * sw + nx; if (seen[k]) continue;
            const q = sp(nx, ny);
            if (Math.abs(q[0] - seed[0]) <= 2 && Math.abs(q[1] - seed[1]) <= 2 && Math.abs(q[2] - seed[2]) <= 2) { seen[k] = 1; stack[s2++] = k; } } }
        const bbw = mxx - mnx + 1, bbh = mxy - mny + 1;
        if (area >= MIN && area / (bbw * bbh) >= 0.25 && Math.max(bbw / bbh, bbh / bbw) <= 6) planes++; }
      add(1, 'countable flat planes in frame', String(planes), planes >= 25, '>=25 (compact regions only)'); }

    rows.sort((a, b) => a.n - b.n);
    console.log(`\nSECTION 13 CHECK — ${process.argv[ci + 1]} (${sw}x${sh})`);
    for (const r of rows) console.log(`  ${String(r.n).padStart(2)}. ${r.verdict}  ${r.name.padEnd(30)} got ${String(r.got).padEnd(22)} want ${r.want}`);
    const fails = rows.filter(r => r.verdict === 'FAIL').length;
    console.log(`  ${rows.length - fails}/${rows.length} pass`);
    process.exit(0);
  }
}

// ------------------------------------------------------------------ print ----
const line = (n, s) => {
  const p = s.rgb, [h, sat, v] = hsv(...p);
  console.log(`  ${n.padEnd(22)} ${hex(...p)}  hue ${String(Math.round(h)).padStart(3)}  S ${sat.toFixed(3)}  V ${v.toFixed(3)}  Y ${lum(...p).toFixed(4)}   ${s.method}`);
};
console.log(`P02 r5 — measured from ${REF} (${W}x${H})\n`);
console.log('ROLES');
for (const [k, v] of Object.entries(S)) line(k, v);
console.log('\nLAWS'); console.log(JSON.stringify(LAW, null, 2));
console.log('\nCENSUS'); console.log(JSON.stringify(CENSUS, null, 2));

// ------------------------------------------------------------- palette.json --
if (process.argv.includes('--write-palette')) {
  const palette = {
    $schema: 'https://variable-star.local/palette-2',
    project: 'Variable Star',
    piece: 'P02',
    round: 5,
    target: {
      image: 'reference/target-lowpoly.png',
      size: [W, H],
      look: 'flat-shaded low-poly. Faceted solids, per-face flat shading, hard silhouette edges, banded warm dusk sky with hard-edged cloud slabs, warm rock in light against a chromatic blue-grey in shadow, cyan crystal and cyan water as the only saturated accents, hard-edged blocky UI, bare white KaTeX unframed in world space.',
      supersedes: 'reference/brief-hero.png is retained as a MOOD artefact only (colour feeling, sense of wonder). Every constant in this file is measured from target-lowpoly.png. Where the two disagree, the low-poly target wins.'
    },
    howToRegenerate: {
      command: 'node review/p02-r5-sample.mjs --write-palette',
      guarantee: 'This file is machine-written. No colour in it was typed by hand. Every `measured` field names the exact box or predicate that produced it; re-run the command and the file is byte-identical.',
      samplingRules: [
        'Coordinates are fractions of frame width/height.',
        'A box sample is the per-channel MEDIAN of the box - median, because a flat-shaded facet is exactly one colour and the median ignores the 1-2 px of antialiasing at its border.',
        'A mask sample is the per-channel median of every pixel passing a stated HSV/luminance predicate inside a stated box. The predicate is the evidence; a box would be a guess.',
        'A sky-ramp sample is the per-row median across x 0.30-0.70, which rejects cloud slabs without having to locate them.',
        'HUE IS NEVER ROUNDED INSIDE A PREDICATE. hue/S/V come from review/p02-png.mjs `hsv()` as exact floats, and a mask predicate such as `h >= 50 && h <= 150` tests the float. Rounding first is a different mask: `world.foliage.lit` is the one role where it shows, and it moves from #585939 (n=2912, Y 0.0951) to #595A3A (n=3065, Y 0.0974) — 1-2/255 per channel, enough to break this file\'s byte-identical guarantee. Hue is rounded ONLY for display, in the published `hsv` field of each role.',
        'A band or census predicate publishes its x window as well as its y window. laws.depthBands carries x 0.25-0.85 on every row because the frame edges hold NEAR objects standing inside FAR rows; full width answers a different question and returns different numbers (see laws.depthBandsMethod).'
      ]
    },
    colourSpace: {
      authoring: 'sRGB IEC 61966-2-1 hex, D65',
      rendering: 'linear-sRGB. `linear` is the exact sRGB->linear decode of `hex`. Feed `linear` to a shader; never feed `hex` to a linear pipeline.',
      luminance: 'Rec.709 relative luminance of the linear triplet (0.2126R + 0.7152G + 0.0722B).',
      three: 'THREE.ColorManagement.enabled = true; renderer.outputColorSpace = SRGBColorSpace; new THREE.Color().setHex(0xRRGGBB, SRGBColorSpace).'
    },
    roles: {
      'sky.zenith': role(S.skyZenith, { allowed: 'Top of the sky dome. Also the colour of the hemisphere fill light — this is the only light in the rig that touches a shadowed face.', forbidden: 'Never an object albedo.' }),
      'sky.high': role(S.skyHigh, { allowed: 'Sky dome around y 0.06 of frame.' }),
      'sky.pivot': role(S.skyPivot, { allowed: 'The neutral crossover band where the cool upper sky becomes the warm horizon. It is the saturation minimum of the whole column and it MUST exist.', forbidden: 'A zenith->horizon ramp that never drops below S 0.16 reads as a two-colour lerp.' }),
      'sky.warm': role(S.skyWarm, { allowed: 'Sky dome around y 0.22.' }),
      'sky.low': role(S.skyLow, { allowed: 'Sky dome around y 0.28.' }),
      'sky.horizon': role(S.skyHorizon, { allowed: 'Sky at the horizon line away from the sun; also the aerial-perspective target colour that all distant geometry converges to.', forbidden: 'Never a light colour — it is the result of the key through atmosphere, not the key.' }),
      'sky.horizon.antisun': role(S.horizonAntiSun, { allowed: 'The horizon on the side of frame away from the sun. The sky is 2x brighter at the sun end than at this end.' }),
      'sky.sun': role(S.sunCore, { allowed: 'The sun glow at the horizon, and the key light colour.', forbidden: 'Never a lens flare with ghosts. Never a visible disc with a hard rim.' }),
      'cloud.slab': role(S.cloudSlab, { allowed: 'The hard-edged stylised cloud slabs. Warm, flat, roughly 2x the luminance of the sky at the same altitude, and 60-110 degrees of hue away from it.', forbidden: 'Never volumetric. Never soft-edged. Never a noise texture.' }),
      'rock.lit.a': role(S.rockLitA, { allowed: 'A rock facet whose normal is within ~15 degrees of the key. The brightest warm value on any solid.' }),
      'rock.lit.b': role(S.rockLitB, { allowed: 'Rock facet at moderate key incidence.' }),
      'rock.lit.c': role(S.rockLitC, { allowed: 'The value a player would name if asked what colour the rock is. The mass of the foreground.' }),
      'rock.lit.d': role(S.rockLitD, { allowed: 'Rock facet turning away from the key.' }),
      'rock.lit.e': role(S.rockLitE, { allowed: 'Rock facet at grazing key incidence — the last step before a face is in shadow.' }),
      'rock.shadow': role(S.rockShadow, { allowed: 'Any facet TURNED AWAY from the key with sky above it. THE most important colour in this palette, and the witness for laws.darkPopulations.turnedFromKey and for art-direction.md section 13 row 3.', forbidden: 'Never produced by multiplying the albedo. It is not a dark orange and it is not black: it is a chromatic blue at hue ~198 that a shadowed face of ANY albedo converges to. And never painted onto an UP-FACING plane inside a cast shadow — that is ground.shadow, hue 120, a different family.' }),
      'rock.shadow.far': role(S.rockShadowFar, { allowed: 'The same shadow family at mid distance — slightly lighter and less saturated, which is the whole of aerial perspective on a shadowed plane.' }),
      'ground.lit': role(S.groundLit, { allowed: 'The walkable ground plane in full key. Warmer and yellower than cliff rock (hue ~43 against ~30) so the floor and the walls are different materials.' }),
      'ground.bright': role(S.groundBright, { allowed: 'Ground plane closest to the key.' }),
      'ground.shadow': role(S.groundShadow, { allowed: 'The ground plane inside a cast shadow. It keeps its own albedo and rotates toward the fill: hue 43 -> 120, not to the blue of a turned face. It is the witness for laws.darkPopulations.castShadowOnGround and for art-direction.md section 13 row 4.', forbidden: 'Never the same colour as rock.shadow. An up-facing surface still sees the whole sky; a turned face does not. That difference is the only reason a cast shadow reads as a shadow rather than as a hole — and section 13 rows 3 and 4 now measure BOTH families separately, so a render cannot pass the shadow gate by collapsing them into one.' }),
      'world.foliage': role(S.foliage, { allowed: 'Ground cover, scrub, the green skirt of a shelf. Green in this world is a VALUE, not a colour.', forbidden: 'Never above S 0.45 and never above Y 0.22. A bright green reads as a UI success state, not as a plant.' }),
      'world.foliage.lit': role(S.foliageLit, { allowed: 'The brightest foliage in frame — a canopy or a shelf top catching the key.' }),
      'crystal.hot': role(S.crystalHot, { allowed: 'The bright facets of a certainty crystal. One of only two saturated cool materials in the world.', forbidden: 'Never on rock, never on terrain, never as a general sci-fi tint.' }),
      'crystal.face': role(S.crystalFace, { allowed: 'The turned facets of the same crystal. A crystal shows two or three values, never a gradient.' }),
      'water.core': role(S.waterCore, { allowed: 'The lit surface of a carry — the cyan river. Greener than crystal by ~3 degrees and slightly more saturated.' }),
      'water.body': role(S.waterBody, { allowed: 'The shaded or deeper part of a carry, and its spill onto the bank.' }),
      'hero.shadow': role(S.heroShadow, { allowed: 'The character seen from the shadow side. The player is mostly THIS colour: hue ~201, the same family as rock.shadow.', forbidden: 'Never desaturate the character to grey. The blue is what makes a low-poly figure read against warm ground.' }),
      'hero.rim': role(S.heroRim, { allowed: 'The key-lit edge of the character — one or two facets on the sun side, warm and bright. This single strip is what separates the character from the ground.' }),
      'hero.hair': role(S.heroHair, { allowed: 'Hair, leather, and any warm dark on the character.' }),
      'hero.skin': role(S.heroSkin, { allowed: 'Skin. Warm and dark — the character is lit from behind, so skin is a small warm note and never a bright passage.', forbidden: 'No subsurface term. No specular. No rim.' }),
      'stone.bone': role(S.stoneBone, { allowed: 'Built stone: ruin masonry, cut blocks, the distant city. Cooler and much less saturated than terrain rock, which is what makes it read as built rather than eroded.', forbidden: 'Never on terrain. If the player can walk on it as ground, it is rock.lit.*.' }),
      'hero.dark': role(S.heroDark, { allowed: 'Straps, gloves, boot soles — the near-black accents that carry the silhouette at thumbnail size.', forbidden: 'Never pure #000000; it is a cool near-black and it keeps a hue.' }),
      'math.glyph': role(S.mathGlyph, { allowed: 'Rendered KaTeX glyphs, axis lines and plotted curves in world space. Pure white, Y 1.000, no outline, no panel, no glass.', forbidden: 'Never tinted. Never on a plate. Never given a soft glow.' }),
      'math.backdrop': role(S.mathBackdrop, { allowed: 'Not a colour to author — the measured backdrop the reference chose to hang its equation against. It is the legibility budget: see laws.glyph.' }),
      'ui.ink': role(S.uiInk, { allowed: 'HUD numerals and labels. Near-white, carried by a hard dark outline rather than by a plate.' }),
      'ui.outline': role(S.uiOutline, { allowed: 'The outline on every UI plate, slot and glyph. Uniform width, hard, no glow, no rounding.', forbidden: 'Never a soft shadow. Never a gradient stroke.' }),
      'ui.bar.health': role(S.uiBarHealth, { allowed: 'The health meter fill. Flat, square-ended, no gradient, no gloss.' }),
      'ui.bar.energy': role(S.uiBarEnergy, { allowed: 'The energy meter fill. Note it sits at hue ~197, the same family as rock.shadow — the HUD borrows the world palette rather than importing a UI blue.' }),
      'ui.plate.composite': role(S.uiPlateOverSky, { allowed: 'Not an authored colour: the measured RESULT of the plate over the world. Author the plate as black at the alpha in laws.uiPlate and this is what must come out.' }),
      'ui.slot.fill': role(S.uiSlotFill, { allowed: 'Item-slot interior. Warm near-black, translucent over the world.' }),
      'ui.slot.bevel': role(S.uiSlotBevel, { allowed: 'The chunky neutral bevel around an item slot. Neutral grey on purpose — the one place in the frame permitted to be uncoloured.' }),
      'ui.band.composite': role(S.uiBandOverSand, { allowed: 'Not an authored colour: the measured RESULT of the subtitle band over lit ground. See laws.subtitleBand.' }),
      'ui.compass.composite': role(S.compassFill, { allowed: 'Not an authored colour: the measured RESULT of the compass disc over the sky.' })
    },
    constructedRoles: (() => {
      // Three roles world.md needs that the target simply does not contain. They are
      // CONSTRUCTED from sampled roles by a printed formula, never typed by hand — so a
      // critic regenerates them the same way as everything else.
      const toS = v => { v = Math.max(0, Math.min(1, v)); const s = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; return Math.round(s * 255); };
      const linToHexTriplet = t => [toS(t[0]), toS(t[1]), toS(t[2])];
      // grey: the geometric mean luminance of lit and shadowed ground, held at the
      // ground's own hue, with saturation crushed to 0.08 — the only role in the file
      // below S 0.10, which is exactly what makes "approximate" legible as a material.
      const yLit = lum(...S.groundLit.rgb), ySh = lum(...S.groundShadow.rgb);
      const yGrey = Math.sqrt(yLit * ySh);
      const [gh] = hsv(...S.groundLit.rgb);
      const hsvToRgb = (h, s, v) => { const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c; const t = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]; return t.map(q => Math.round((q + m) * 255)); };
      // solve V so the result lands on yGrey
      let v = 0.5; for (let i = 0; i < 40; i++) { const p = hsvToRgb(gh, 0.08, v); v *= (lum(...p) > 0 ? Math.sqrt(yGrey / lum(...p)) : 1); v = Math.min(1, Math.max(0.01, v)); }
      const grey = hsvToRgb(gh, 0.08, v);
      let v2 = v * 0.5; for (let i = 0; i < 40; i++) { const p = hsvToRgb(gh, 0.068, v2); v2 *= (lum(...p) > 0 ? Math.sqrt((yGrey * 0.34) / lum(...p)) : 1); v2 = Math.min(1, Math.max(0.01, v2)); }
      const greyDeep = hsvToRgb(gh, 0.068, v2);
      // success: the health bar's own saturation and value, rotated to the one hue arc
      // the world never occupies at strength. hue 107 sits 47 deg off world.foliage's 120
      // and is only ever drawn above S 0.45, where no foliage pixel in the target reaches.
      const [, hs, hv] = hsv(...S.uiBarHealth.rgb);
      const success = hsvToRgb(107, hs, hv);
      return {
        'world.grey': role({ rgb: grey, method: 'CONSTRUCTED. The target contains no grey material. hue = hue(ground.lit); S = 0.08; V solved so luminance = sqrt(Y(ground.lit) * Y(ground.shadow)) = ' + r4(yGrey) + '. It is the only role in this file below S 0.10.' },
          { allowed: 'Anything emitted by a supplied value: a sagging span, a propped roof, an approximate wall (world.md Law 5). Flat-shaded like everything else, and it is the one material with nothing bright on it anywhere.', forbidden: 'Never cyan-tinted, never bloomed, never emissive. And grey does NOT take the shadow rotation: a violet or blue shadow on grey turns it back into rock.' }),
        'world.grey.deep': role({ rgb: greyDeep, method: 'CONSTRUCTED. Same hue and S 0.068; V solved so luminance = 0.34 x Y(world.grey). Grey is the one material whose shadow does not rotate hue.' },
          { allowed: 'Unlit faces, undersides and contact shadows of grey objects.' }),
        'ui.success': role({ rgb: success, method: 'CONSTRUCTED. hue 107; S and V copied from ui.bar.health (the one saturated UI colour the target does contain), so success and danger carry equal weight on screen.' },
          { allowed: 'A closure landing, a claim setting, a mastery mark. Transient only.', forbidden: 'Never below S 0.45 — under that it is indistinguishable from world.foliage, which never exceeds S 0.45 in the target.' })
      };
    })(),
    // AUTHORED. A still frame cannot be measured for any of this; every number here is a
    // judgement, and art-direction.md sections 3.1 and 11 give the reasoning. It lives in the
    // palette because app/src/world/Lighting.js reads it, and because the key's elevation and
    // its variability envelope are art direction rather than gameplay.
    motion: {
      status: 'AUTHORED — see art-direction.md sections 3.1 and 11.',
      fixedStepSeconds: 1 / 60,
      timeOfDay: {
        periodMinutes: 20,
        keyElevationDeg: 9,
        keyBearingIsWorldFixed: true,
        elevationDriftDeg: 2,
        azimuthDriftDeg: 8,
        note: 'The key holds ONE world bearing for the whole session. The drift figures are the total excursion permitted across a 20-minute cycle, not a per-minute rate. A camera-relative key would swing the world every time the player turned and would make the shadow law meaningless.',
        shadowElevationDeg: 16,
        shadowElevationNote: 'Cast-shadow length is authored at 3.0-4.0x object height for legibility, which implies a steeper sun than the sky shows. The target cheats the same way.',
        lethisVariability: {
          intensitySwing: 0.12,
          maxRatePerFixedStep: 0.0015,
          note: 'Lethis is a variable star and its output breathes. Deterministic in simTime, aperiodic in practice, rate limited so it can never become a flicker: this is a star breathing, not a lamp failing. 0.0015 per fixed step is a full swing in about 1.3 s.'
        }
      },
      budgets: {
        shadowFamilyBlendSeconds: 0.25,
        emitterEnergyChangePerFixedStep: 0.03,
        dofRadiusChangePxPerFixedStep: 0.5,
        cloudDriftFracWidthPerSecond: 0.004,
        temporalNoiseCeiling: { fractionOfPixels: 0.002, luminanceDelta: 0.05, note: 'camera static, one fixed step advanced' }
      }
    },
    laws: LAW,
    census: CENSUS,
    // filled in below — every role name the painterly palette had that the app still asks for
    deprecatedRoles: {},
    removedRoles: {},
    budgets: {
      coolAccentShareOfFrame: { measured: CENSUS.coolAccent.share, allowed: [0.004, 0.018], note: 'Pixels at hue 150-200, V>=0.80, S>=0.25. The reference spends 0.94% of frame on saturated cyan and NOTHING ELSE in the frame is allowed into that gate. Below 0.4% the world stops having a subject; above 1.8% the accent stops being an accent.' },
      warmLitShareOfFrame: { measured: CENSUS.warmLitSubstance.share, allowed: [0.35, 0.60], note: 'Pixels at hue 20-50, S>=0.40, Y>=0.08. Warm rock is the mass of the picture.' },
      coolShadowShareOfFrame: { measured: CENSUS.coolShadow.share, allowed: [0.05, 0.16], note: 'Pixels at hue 170-220, Y<=0.06. If this is near zero the render has no shadow direction; if it is over 0.16 the frame has gone gloomy.' },
      blownShareOfFrame: { measured: CENSUS.blown.share, allowed: [0.002, 0.020], note: 'Y>=0.90. In the reference this is the sun glow plus the KaTeX plus crystal cores, and nothing else.' },
      crushedShareOfFrame: { measured: CENSUS.crushed.share, allowed: [0.0, 0.012], note: 'Y<=0.004. Shadows are chromatic; a render that crushes more than 1.2% of frame to near-black has lost the palette.' },
      greenShareOfFrame: { measured: CENSUS.green.share, allowed: [0.04, 0.16], note: 'hue 60-150, S>=0.25. Almost all of it is dark ground cover and cast shadow.' }
    }
  };
  // ------------------------------------------------------- migration seam ----
  // The painterly palette's role names are still referenced by app/src (Lighting.js,
  // Materials.js, Sky.js, Scatter.js, Terrain.js, GradePass.js), which are owned by other
  // pieces. Renaming them out from under those modules took the whole boot down —
  // `palette.roles["resonance.core"].hex` threw and every feature in the build died with it.
  //
  // So each old name is MATERIALISED inside `roles`, carrying the NEW measured colour and a
  // `deprecated` field naming its replacement. The app keeps booting, it gets low-poly colour
  // rather than stale painterly colour, and the rename stays discoverable.
  //
  // THIS BLOCK IS A SEAM, NOT A PALETTE. When the owning pieces have moved to the new names it
  // should be deleted. Anything in `removedRoles` has no replacement on purpose: the surface it
  // described is banned by the low-poly target, and asking for it should fail loudly.
  const ALIAS = {
    'sky.upper': ['sky.high', 'renamed'],
    'aurora.mint': ['sky.pivot', 'THE TARGET HAS NO AURORA. Delete the aurora rather than recolour it; this alias only exists so a stale reference does not paint magenta across the sky'],
    'rock.warm.lit': ['rock.lit.a', 'the warm ladder is now five measured facet values, rock.lit.a..e'],
    'rock.warm.mid': ['rock.lit.c', 'the warm ladder is now five measured facet values, rock.lit.a..e'],
    'rock.warm.low': ['rock.lit.e', 'the warm ladder is now five measured facet values, rock.lit.a..e'],
    'rock.shadow.deep': ['hero.dark', 'there is no separate deep-shadow role: shadowed faces converge on rock.shadow, and the darkest chromatic near-black in the world is hero.dark'],
    'rock.bone': ['stone.bone', 'renamed — built stone is its own class and it is now sampled from the distant city'],
    'resonance.core': ['crystal.hot', 'the saturated cool accent is now split by SUBSTANCE (crystal vs water) rather than by intensity'],
    'resonance.hot': ['crystal.hot', 'see resonance.core'],
    'resonance.bloom': ['crystal.hot', 'bloom is a post pass gated at Y 0.62 and masked to the accent class; it is not a colour role'],
    'resonance.flow': ['water.core', 'flowing resonance is water'],
    'resonance.deep': ['water.body', 'flowing resonance is water'],
    'certainty.facet': ['crystal.face', 'renamed'],
    'certainty.rim': ['crystal.hot', 'a crystal shows 2-3 flat facet values; there is no Fresnel rim in this target'],
    'certainty.deep': ['crystal.face', 'a crystal shows 2-3 flat facet values'],
    'hero.armour': ['hero.shadow', 'the character is mostly its shadow-side value; the lit side is one or two facets, hero.rim'],
    'hero.undersuit': ['hero.dark', 'renamed'],
    'hero.accent': ['crystal.hot', 'the target hero carries no emissive accent; if one is authored it obeys the cool-accent budget like everything else'],
    'hero.ink': ['hero.dark', 'THERE IS NO INK PASS. Anti-pattern 14. This alias exists only so a stale reference does not throw'],
    'holo.glyph': ['math.glyph', 'renamed'],
    'holo.data': ['crystal.hot', 'plotted curves are drawn in math.glyph white; a cyan data line is the accent colour and counts against its budget'],
    'ui.ink.dim': ['ui.slot.bevel', 'the only neutral in the frame'],
    'ui.stroke': ['ui.outline', 'the outline is a hard near-black, not a pale cyan with a glow'],
    'ui.surface': ['ui.plate.composite', 'plates are black at alpha 0.78; this role is the measured composite, not an authored fill'],
    'ui.surface.raised': ['ui.slot.fill', 'renamed'],
    'ui.scrim': ['ui.band.composite', 'renamed'],
    'reward.gold': ['rock.lit.a', 'the target has no gold; the brightest warm in the world is a lit rock facet'],
    'danger': ['ui.bar.health', 'the one saturated red in the target is the health meter'],
    'danger.deep': ['hero.dark', 'no separate deep-danger value is measurable here'],
    'success': ['ui.success', 'renamed; ui.success is constructed, see constructedRoles'],
    'success.deep': ['ui.success', 'no separate deep-success value is measurable here']
  };
  const REMOVED = {
    'holo.veil': 'The hologram panel is BANNED (section 8). Mathematics floats bare and unframed. There is no fill, no glass and no compression quad, and a module asking for this role is asking for a surface that must not exist.',
    'holo.stroke': 'The panel border and corner brackets are BANNED (section 8).',
    'aurora.teal': 'The target has no aurora.',
    'aurora.violet': 'The target has no aurora, and violet is the painterly shadow hue this round deleted.'
  };
  for (const [oldName, [newName, why]] of Object.entries(ALIAS)) {
    const src = palette.roles[newName] ?? palette.constructedRoles[newName];
    if (!src) throw new Error(`alias target missing: ${newName}`);
    palette.roles[oldName] = { ...src, deprecated: { use: newName, why } };
    palette.deprecatedRoles[oldName] = { use: newName, why };
  }
  palette.removedRoles = REMOVED;
  palette.migration = {
    what: 'Round 5 re-aimed this palette at reference/target-lowpoly.png and renamed every role. app/src still asks for the old names.',
    how: 'Each old name in `deprecatedRoles` is also present in `roles`, carrying the NEW measured colour plus a `deprecated` field. Nothing throws, and nothing gets a stale painterly colour.',
    thenWhat: 'Owning pieces move to the new names; this block is deleted. It is a seam, not a palette.',
    removed: 'Names in `removedRoles` have no replacement on purpose — the surface they described is banned by the target. Asking for one should fail loudly (Materials.roleHex already paints debug magenta and warns).'
  };

  writeFileSync(OUT, JSON.stringify(palette, null, 2) + '\n');
  console.log('\nwrote', OUT);
  console.log(`  ${Object.keys(palette.roles).length} roles (of which ${Object.keys(ALIAS).length} are deprecated aliases), ${Object.keys(palette.constructedRoles).length} constructed, ${Object.keys(REMOVED).length} removed`);
}
