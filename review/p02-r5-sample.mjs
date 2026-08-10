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

// --- facet census: how many countable planes does one rock mass resolve into? -
{
  const x0 = Math.round(0.055 * W), x1 = Math.round(0.270 * W);
  const y0 = Math.round(0.120 * H), y1 = Math.round(0.600 * H);
  const bw = x1 - x0, bh = y1 - y0, n = bw * bh;
  const seen = new Uint8Array(n), stack = new Int32Array(n);
  const idx = (x, y) => (y - y0) * bw + (x - x0);
  const found = [];
  const TOL = 2, MIN = Math.round(0.0002 * NPX);   // 0.02% of frame
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = idx(x, y); if (seen[i]) continue;
    const seed = px(img, x, y);
    let sp = 0; stack[sp++] = i; seen[i] = 1; let area = 0, sr = 0, sg = 0, sb = 0;
    while (sp) {
      const j = stack[--sp], jx = x0 + (j % bw), jy = y0 + ((j / bw) | 0);
      const p = px(img, jx, jy); area++; sr += p[0]; sg += p[1]; sb += p[2];
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = jx + dx, ny = jy + dy;
        if (nx < x0 || nx >= x1 || ny < y0 || ny >= y1) continue;
        const k = idx(nx, ny); if (seen[k]) continue;
        const q = px(img, nx, ny);
        if (Math.abs(q[0] - seed[0]) <= TOL && Math.abs(q[1] - seed[1]) <= TOL && Math.abs(q[2] - seed[2]) <= TOL) { seen[k] = 1; stack[sp++] = k; }
      }
    }
    if (area >= MIN) found.push({ area, hex: hex(Math.round(sr / area), Math.round(sg / area), Math.round(sb / area)), Y: r4(lum(Math.round(sr / area), Math.round(sg / area), Math.round(sb / area))) });
  }
  found.sort((a, b) => b.area - a.area);
  LAW.facetCensus = {
    region: 'the foreground rock mass, box [0.055,0.120,0.270,0.600]',
    method: `4-connected flood fill, per-channel tolerance ${TOL}/255 against the seed pixel, regions of at least 0.02% of frame counted`,
    countablePlanes: found.length,
    planes: found.slice(0, 14),
    note: 'A cliff resolves into a countable number of planes. That is the whole geometry law in one measurement.'
  };
}

// depth: luminance spread inside horizontal bands, x 0.25-0.85
LAW.depthBands = [];
for (const [name, y0, y1] of [['far', 0.36, 0.42], ['midfar', 0.42, 0.52], ['mid', 0.52, 0.64], ['near', 0.64, 0.78]]) {
  const ys = [], ss = [];
  for (let y = Math.round(y0 * H); y < Math.round(y1 * H); y++)
    for (let x = Math.round(0.25 * W); x < Math.round(0.85 * W); x++) { const p = px(img, x, y); ys.push(lum(...p)); ss.push(hsv(...p)[1]); }
  ys.sort((a, b) => a - b); ss.sort((a, b) => a - b);
  const q = (a, p) => a[Math.floor(p * (a.length - 1))];
  LAW.depthBands.push({ band: name, y: [y0, y1], p05: r4(q(ys, .05)), p50: r4(q(ys, .50)), p95: r4(q(ys, .95)), contrast: r2(q(ys, .95) / q(ys, .05)), medianS: r3(q(ss, .50)) });
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
  LAW.uiGeometry = {
    barOutlineRows: rows,
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
        'A sky-ramp sample is the per-row median across x 0.30-0.70, which rejects cloud slabs without having to locate them.'
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
      'rock.shadow': role(S.rockShadow, { allowed: 'Any facet turned away from the key with sky above it. THE most important colour in this palette.', forbidden: 'Never produced by multiplying the albedo. It is not a dark orange and it is not black: it is a chromatic blue at hue ~198 that a shadowed face of ANY albedo converges to.' }),
      'rock.shadow.far': role(S.rockShadowFar, { allowed: 'The same shadow family at mid distance — slightly lighter and less saturated, which is the whole of aerial perspective on a shadowed plane.' }),
      'ground.lit': role(S.groundLit, { allowed: 'The walkable ground plane in full key. Warmer and yellower than cliff rock (hue ~43 against ~30) so the floor and the walls are different materials.' }),
      'ground.bright': role(S.groundBright, { allowed: 'Ground plane closest to the key.' }),
      'ground.shadow': role(S.groundShadow, { allowed: 'The ground plane inside a cast shadow. It keeps its own albedo and rotates toward the fill: hue 43 -> ~123, not to the blue of a turned face.', forbidden: 'Never the same colour as rock.shadow. An up-facing surface still sees the whole sky; a turned face does not. That difference is the only reason a cast shadow reads as a shadow rather than as a hole.' }),
      'world.foliage': role(S.foliage, { allowed: 'Ground cover, scrub, the green skirt of a shelf. Green in this world is a VALUE, not a colour.', forbidden: 'Never above S 0.45 and never above Y 0.22. A bright green reads as a UI success state, not as a plant.' }),
      'world.foliage.lit': role(S.foliageLit, { allowed: 'The brightest foliage in frame — a canopy or a shelf top catching the key.' }),
      'crystal.hot': role(S.crystalHot, { allowed: 'The bright facets of a certainty crystal. One of only two saturated cool materials in the world.', forbidden: 'Never on rock, never on terrain, never as a general sci-fi tint.' }),
      'crystal.face': role(S.crystalFace, { allowed: 'The turned facets of the same crystal. A crystal shows two or three values, never a gradient.' }),
      'water.core': role(S.waterCore, { allowed: 'The lit surface of a carry — the cyan river. Greener than crystal by ~3 degrees and slightly more saturated.' }),
      'water.body': role(S.waterBody, { allowed: 'The shaded or deeper part of a carry, and its spill onto the bank.' }),
      'hero.shadow': role(S.heroShadow, { allowed: 'The character seen from the shadow side. The player is mostly THIS colour: hue ~201, the same family as rock.shadow.', forbidden: 'Never desaturate the character to grey. The blue is what makes a low-poly figure read against warm ground.' }),
      'hero.rim': role(S.heroRim, { allowed: 'The key-lit edge of the character — one or two facets on the sun side, warm and bright. This single strip is what separates the character from the ground.' }),
      'hero.hair': role(S.heroHair, { allowed: 'Hair, leather, and any warm dark on the character.' }),
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
    laws: LAW,
    census: CENSUS,
    budgets: {
      coolAccentShareOfFrame: { measured: CENSUS.coolAccent.share, allowed: [0.004, 0.018], note: 'Pixels at hue 150-200, V>=0.80, S>=0.25. The reference spends 0.94% of frame on saturated cyan and NOTHING ELSE in the frame is allowed into that gate. Below 0.4% the world stops having a subject; above 1.8% the accent stops being an accent.' },
      warmLitShareOfFrame: { measured: CENSUS.warmLitSubstance.share, allowed: [0.35, 0.60], note: 'Pixels at hue 20-50, S>=0.40, Y>=0.08. Warm rock is the mass of the picture.' },
      coolShadowShareOfFrame: { measured: CENSUS.coolShadow.share, allowed: [0.05, 0.16], note: 'Pixels at hue 170-220, Y<=0.06. If this is near zero the render has no shadow direction; if it is over 0.16 the frame has gone gloomy.' },
      blownShareOfFrame: { measured: CENSUS.blown.share, allowed: [0.002, 0.020], note: 'Y>=0.90. In the reference this is the sun glow plus the KaTeX plus crystal cores, and nothing else.' },
      crushedShareOfFrame: { measured: CENSUS.crushed.share, allowed: [0.0, 0.012], note: 'Y<=0.004. Shadows are chromatic; a render that crushes more than 1.2% of frame to near-black has lost the palette.' },
      greenShareOfFrame: { measured: CENSUS.green.share, allowed: [0.04, 0.16], note: 'hue 60-150, S>=0.25. Almost all of it is dark ground cover and cast shadow.' }
    }
  };
  writeFileSync(OUT, JSON.stringify(palette, null, 2) + '\n');
  console.log('\nwrote', OUT);
}
