// Sweep candidate qualifiers for the `resonance` class so the identity-colour
// budget stops being a coin flip on sky saturation.
//
// Criterion for a good qualifier:
//   (a) the reference still lands mid-band on resonance share and warm:resonance
//   (b) pushing sky saturation by +0.05 / +0.10 barely moves either number
//   (c) it is a property of the PIXEL, not of where the camera happens to point
//
//   node review/p02-r3-sweep.mjs

import { readPNG, lum, hsv, px } from './p02-png.mjs';

const img = readPNG(new URL('../reference/brief-hero.png', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const { width: W, height: H } = img;
const HORIZON = 0.31;

// Pre-decode once: [h, s, v, Y, aboveHorizon, inLowerTwoThirds]
const N = W * H;
const Hh = new Float32Array(N), Ss = new Float32Array(N), Vv = new Float32Array(N), Yy = new Float32Array(N);
for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) {
  const [r, g, b] = px(img, x, y); const [h, s, v] = hsv(r, g, b);
  Hh[i] = h; Ss[i] = s; Vv[i] = v; Yy[i] = lum(r, g, b);
}
const aboveIdx = y => y / H < HORIZON;

function run(qual, dSsky, dSall) {
  const c = { muted: 0, warm: 0, res: 0, bridge: 0, off: 0, hotRes: 0 };
  let m = 0, lowN = 0, lowRes = 0, lowWarm = 0;
  for (let y = 0, i = 0; y < H; y++) {
    const above = aboveIdx(y);
    const low = y / H >= 1 / 3;
    for (let x = 0; x < W; x++, i++) {
      let s = Ss[i] + (above ? dSsky : 0) + dSall;
      if (s > 1) s = 1;
      const h = Hh[i], v = Vv[i], Y = Yy[i];
      m++; if (low) lowN++;
      let k;
      if (s >= 0.55 && h >= 330 && h < 355 && Y > 0.10) k = 'warmState';
      else if (s >= 0.45 && h >= 95 && h < 125 && Y > 0.45) k = 'successState';
      else if (s < 0.30) k = 'muted';
      else if (h < 60 || h >= 320) k = 'warm';
      else if (h >= 150 && h <= 215) k = qual(s, v, Y) ? 'res' : 'muted';
      else if (h >= 90 && h < 150) k = 'bridge';
      else k = 'off';
      if (c[k] !== undefined) c[k]++;
      if (k === 'res' && s >= 0.55) c.hotRes++;
      if (low) { if (k === 'res') lowRes++; if (k === 'warm') lowWarm++; }
    }
  }
  return {
    res: +(c.res / m).toFixed(4),
    warm: +(c.warm / m).toFixed(4),
    wr: +(c.warm / c.res).toFixed(3),
    hotRes: +(c.hotRes / m).toFixed(4),
    lowRes: +(lowRes / lowN).toFixed(4),
    lowWR: +(lowWarm / lowRes).toFixed(3)
  };
}

const quals = {
  'none (current)': () => true,
  'V<=0.85': (s, v) => v <= 0.85,
  'V<=0.80': (s, v) => v <= 0.80,
  'V<=0.75': (s, v) => v <= 0.75,
  'S>=0.45 or V<=0.75': (s, v) => s >= 0.45 || v <= 0.75,
  'S>=0.45 or V<=0.70': (s, v) => s >= 0.45 || v <= 0.70,
  'S>=0.40 or V<=0.70': (s, v) => s >= 0.40 || v <= 0.70,
  'S>=0.35 or V<=0.65': (s, v) => s >= 0.35 || v <= 0.65,
  'S*V>=0.22': (s, v) => s * v >= 0.22,
  'S>=0.40': (s) => s >= 0.40
};

const cases = [
  ['reference', 0, 0],
  ['sky +0.05', 0.05, 0],
  ['sky +0.10', 0.10, 0],
  ['frame +0.05', 0, 0.05],
  ['frame +0.10', 0, 0.10]
];

const rows = [];
console.log('qualifier'.padEnd(22), cases.map(c => c[0].padEnd(30)).join(''));
for (const [name, q] of Object.entries(quals)) {
  const cells = cases.map(([, a, b]) => {
    const r = run(q, a, b);
    return `res ${r.res} wr ${r.wr}`.padEnd(30);
  });
  rows.push({ name, detail: cases.map(([nm, a, b]) => ({ case: nm, ...run(q, a, b) })) });
  console.log(name.padEnd(22), cells.join(''));
}
console.log('\nfull detail:');
for (const r of rows) { console.log(r.name); for (const d of r.detail) console.log('   ', JSON.stringify(d)); }
