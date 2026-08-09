// Second sweep: apply the pale-bright exclusion SYMMETRICALLY to warm and
// resonance, on the argument §9 already makes — "the sky carries hue, not
// saturation". A pale bright pixel is atmosphere, not substance, whichever arc
// it sits in. Reports every budget the auditor scores, under a sky-saturation
// stress and a whole-frame stress.
//
//   node review/p02-r3-sweep2.mjs

import { readPNG, lum, hsv, px } from './p02-png.mjs';

const img = readPNG(new URL('../reference/brief-hero.png', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const { width: W, height: H } = img;
const HORIZON = 0.31;
const N = W * H;
const Hh = new Float32Array(N), Ss = new Float32Array(N), Vv = new Float32Array(N), Yy = new Float32Array(N);
for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) {
  const [r, g, b] = px(img, x, y); const [h, s, v] = hsv(r, g, b);
  Hh[i] = h; Ss[i] = s; Vv[i] = v; Yy[i] = lum(r, g, b);
}

// substance(s, v) — true if this pixel is a SURFACE, false if it is atmosphere.
function score(substance, dSsky, dSall) {
  const c = { muted: 0, warm: 0, res: 0, bridge: 0, off: 0, hot: 0, hotRes: 0 };
  let m = 0, topN = 0, topMuted = 0, botN = 0, botRes = 0;
  for (let y = 0, i = 0; y < H; y++) {
    const above = y / H < HORIZON;
    const third = y / H < 1 / 3 ? 0 : (y / H < 2 / 3 ? 1 : 2);
    for (let x = 0; x < W; x++, i++) {
      let s = Math.min(1, Ss[i] + (above ? dSsky : 0) + dSall);
      const h = Hh[i], v = Vv[i], Y = Yy[i];
      m++; if (third === 0) topN++; if (third === 2) botN++;
      let k;
      if (s >= 0.55 && h >= 330 && h < 355 && Y > 0.10) k = 'state';
      else if (s >= 0.45 && h >= 95 && h < 125 && Y > 0.45) k = 'state';
      else if (s < 0.30 || !substance(s, v)) k = 'muted';
      else if (h < 60 || h >= 320) k = 'warm';
      else if (h >= 150 && h <= 215) k = 'res';
      else if (h >= 90 && h < 150) k = 'bridge';
      else k = 'off';
      if (c[k] !== undefined) c[k]++;
      if (k !== 'muted' && k !== 'state' && s >= 0.55) { c.hot++; if (k === 'res') c.hotRes++; }
      if (third === 0 && k === 'muted') topMuted++;
      if (third === 2 && k === 'res') botRes++;
    }
  }
  return {
    muted: +(c.muted / m).toFixed(4), warm: +(c.warm / m).toFixed(4), res: +(c.res / m).toFixed(4),
    bridge: +(c.bridge / m).toFixed(4), off: +(c.off / m).toFixed(4),
    hot: +(c.hot / m).toFixed(4), hotRes: +(c.hotRes / m).toFixed(4),
    wr: +(c.warm / c.res).toFixed(3),
    skyThirdMuted: +(topMuted / topN).toFixed(4), botThirdRes: +(botRes / botN).toFixed(4)
  };
}

const rules = {
  'current (none)': () => true,
  'not(V>0.70 & S<0.45)': (s, v) => !(v > 0.70 && s < 0.45),
  'not(V>0.75 & S<0.45)': (s, v) => !(v > 0.75 && s < 0.45),
  'not(V>0.70 & S<0.40)': (s, v) => !(v > 0.70 && s < 0.40),
  'not(V>0.80 & S<0.45)': (s, v) => !(v > 0.80 && s < 0.45),
  'not(V>0.75 & S<0.40)': (s, v) => !(v > 0.75 && s < 0.40)
};
const cases = [['reference', 0, 0], ['sky+0.05', 0.05, 0], ['sky+0.10', 0.10, 0], ['frame+0.05', 0, 0.05], ['frame+0.10', 0, 0.10]];

for (const [name, sub] of Object.entries(rules)) {
  console.log('\n=== ' + name);
  for (const [cn, a, b] of cases) console.log('  ' + cn.padEnd(11), JSON.stringify(score(sub, a, b)));
}
