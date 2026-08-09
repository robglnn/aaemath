#!/usr/bin/env node
/**
 * P02 scratch measurement, pass 3 — the numbers that go into design/palette.json
 * and design/art-direction.md. Boxes verified against review/p02-crops/grid-*.png.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const b64 = readFileSync(path.join(root, 'reference', 'brief-hero.png')).toString('base64');

const P = (name, x, y, w, h) => [name, [x - w, y - h, x + w, y + h]];
const REGIONS = Object.fromEntries([
  P('sky.zenith',             0.331, 0.010, 0.030, 0.008),
  P('sky.upper',              0.300, 0.060, 0.030, 0.012),
  P('sky.lavender',           0.250, 0.140, 0.030, 0.014),
  P('sky.mid',                0.300, 0.220, 0.030, 0.014),
  P('sky.horizon.cream',      0.230, 0.320, 0.025, 0.010),
  P('sky.horizon.gold',       0.930, 0.335, 0.014, 0.010),
  P('aurora.mint.bright',     0.560, 0.075, 0.012, 0.010),
  P('aurora.mint.mid',        0.470, 0.085, 0.014, 0.010),
  P('aurora.mint.low',        0.640, 0.120, 0.014, 0.010),
  P('aurora.violet',          0.100, 0.075, 0.020, 0.020),
  P('rock.lit.top',           0.479, 0.723, 0.008, 0.006),
  P('rock.lit.hot',           0.712, 0.728, 0.005, 0.005),
  P('rock.lit.plinthface',    0.660, 0.780, 0.008, 0.008),
  P('rock.shadow.cast',       0.560, 0.775, 0.010, 0.008),
  P('rock.shadow.form',       0.700, 0.860, 0.012, 0.012),
  P('rock.mid.lit',           0.120, 0.470, 0.010, 0.008),
  P('rock.mid.shadow',        0.085, 0.520, 0.008, 0.008),
  P('rock.far.hazed',         0.180, 0.390, 0.014, 0.008),
  P('rock.terrace.lit',       0.890, 0.485, 0.008, 0.006),
  P('rock.terrace.shadow',    0.872, 0.610, 0.008, 0.006),
  P('resonance.river',        0.230, 0.640, 0.014, 0.010),
  P('resonance.river.hot',    0.300, 0.560, 0.008, 0.006),
  P('resonance.crystal',      0.930, 0.690, 0.008, 0.010),
  P('resonance.socket.core',  0.605, 0.685, 0.004, 0.004),
  P('resonance.socket.pool',  0.586, 0.681, 0.006, 0.004),
  P('ruin.stone',             0.090, 0.660, 0.008, 0.008),
  P('city.mass',              0.760, 0.150, 0.014, 0.020),
  P('hero.armour.hot',        0.389, 0.645, 0.003, 0.005),
  P('hero.armour.lit',        0.404, 0.618, 0.003, 0.004),
  P('hero.armour.base',       0.350, 0.474, 0.004, 0.005),
  P('hero.armour.shadow',     0.330, 0.618, 0.004, 0.006),
  P('hero.armour.shadow2',    0.345, 0.690, 0.004, 0.006),
  P('hero.accent.slot',       0.3126,0.492, 0.0016,0.0035),
  P('hero.accent.chevron',    0.3378,0.570, 0.0016,0.0030),
  P('hero.accent.band',       0.3051,0.600, 0.0018,0.0035),
  P('hero.hair.dark',         0.330, 0.336, 0.005, 0.006),
  P('hero.hair.lit',          0.3554,0.309, 0.0035,0.0045),
  P('hero.skin',              0.3721,0.393, 0.0025,0.0040),
  P('hero.skin.shadow',       0.3604,0.417, 0.0020,0.0030),
  P('hero.glove',             0.3101,0.660, 0.0025,0.0040),
  P('ui.bar.health',          0.0560,0.0625,0.0040,0.0045),
  P('ui.bar.track',           0.1520,0.0625,0.0030,0.0045),
  P('ui.bar.xp',              0.0750,0.0880,0.0080,0.0035),
  P('ui.banner.overrock',     0.4700,0.8700,0.0150,0.0060),
  P('ui.text.cyan',           0.4180,0.8800,0.0030,0.0035),
  P('minimap.fill',           0.9200,0.0700,0.0080,0.0120),
  P('holo.fill.oversky',      0.5350,0.2000,0.0120,0.0140),
  P('holo.fill.overcity',     0.7000,0.2400,0.0100,0.0120),
  P('holo.stroke',            0.4960,0.2000,0.0012,0.0250),
  P('holo.glyph',             0.5170,0.2450,0.0030,0.0060),
  P('holo.plotline',          0.6700,0.2400,0.0018,0.0018)
]);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<canvas id=c></canvas>');
const out = await page.evaluate(async ({ b64, REGIONS }) => {
  const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
  const W = img.naturalWidth, H = img.naturalHeight;
  const c = document.getElementById('c'); c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, W, H).data;
  const s2l = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = (r, g, b) => 0.2126 * s2l(r) + 0.7152 * s2l(g) + 0.0722 * s2l(b);
  const hsv = (r, g, b) => {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d > 0) { if (mx === r) h = 60 * (((g - b) / d) % 6); else if (mx === g) h = 60 * ((b - r) / d + 2); else h = 60 * ((r - g) / d + 4); }
    if (h < 0) h += 360;
    return [h, mx === 0 ? 0 : d / mx, mx];
  };
  const at = (x, y) => { const i = (y * W + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };
  const fmt = (r, g, b) => {
    const [h, s, v] = hsv(r, g, b);
    return {
      hex: '#' + [r, g, b].map(z => Math.round(z).toString(16).padStart(2, '0')).join(''),
      rgb: [r, g, b].map(Math.round),
      linear: [s2l(r), s2l(g), s2l(b)].map(z => +z.toFixed(4)),
      hsv: [Math.round(h), +s.toFixed(3), +v.toFixed(3)],
      Y: +lum(r, g, b).toFixed(4)
    };
  };

  // regions: report median-luminance pixel colour (robust), plus the 90th-pct-luminance pixel (core/highlight)
  const regions = {};
  for (const [name, [x0, y0, x1, y1]] of Object.entries(REGIONS)) {
    const X0 = Math.max(0, Math.floor(x0 * W)), X1 = Math.min(W, Math.ceil(x1 * W));
    const Y0 = Math.max(0, Math.floor(y0 * H)), Y1 = Math.min(H, Math.ceil(y1 * H));
    const list = [];
    for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) { const p = at(x, y); list.push([lum(...p), ...p]); }
    list.sort((a, b) => a[0] - b[0]);
    const pick = q => list[Math.min(list.length - 1, Math.floor(list.length * q))];
    const med = pick(0.5), hi = pick(0.92), lo = pick(0.08);
    regions[name] = {
      median: fmt(med[1], med[2], med[3]),
      high: fmt(hi[1], hi[2], hi[3]),
      low: fmt(lo[1], lo[2], lo[3]),
      box: [X0, Y0, X1 - X0, Y1 - Y0], n: list.length
    };
  }

  // ---------- saturation family census, by vertical third ----------
  const fam = (h, s) => {
    if (s < 0.30) return 'muted';
    if (h >= 150 && h <= 215) return 'cyan';
    if (h > 90 && h < 150) return 'green';
    if (h < 60 || h > 320) return 'warm';
    return 'other';
  };
  const census = { all: {}, top: {}, mid: {}, bottom: {}, hot: {} };
  for (const k of Object.keys(census)) for (const f of ['muted', 'cyan', 'green', 'warm', 'other']) census[k][f] = 0;
  let n = 0, nt = 0, nm = 0, nb = 0, nh = 0;
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
    const [r, g, b] = at(x, y); const [h, s] = hsv(r, g, b);
    const f = fam(h, s);
    census.all[f]++; n++;
    const t = y / H;
    if (t < 1 / 3) { census.top[f]++; nt++; } else if (t < 2 / 3) { census.mid[f]++; nm++; } else { census.bottom[f]++; nb++; }
    if (s >= 0.55) { census.hot[f]++; nh++; }
  }
  const pct = (o, d) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, +(100 * v / d).toFixed(2)]));
  const censusPct = { all: pct(census.all, n), top: pct(census.top, nt), mid: pct(census.mid, nm), bottom: pct(census.bottom, nb), hotShareOfFrame: +(100 * nh / n).toFixed(2), hotBreakdown: pct(census.hot, Math.max(1, nh)) };

  // ---------- sky ramp: a clean vertical column through empty sky ----------
  const skyRamp = [];
  const colX = Math.floor(0.245 * W);
  for (let t = 0; t <= 0.34; t += 0.02) {
    const y = Math.floor(t * H); const p = at(colX, y);
    skyRamp.push({ y: +t.toFixed(2), ...fmt(...p) });
  }
  // second column through the aurora to isolate its delta
  const auroraRamp = [];
  const colX2 = Math.floor(0.56 * W);
  for (let t = 0; t <= 0.24; t += 0.02) {
    const y = Math.floor(t * H); const p = at(colX2, y), q = at(colX, y);
    auroraRamp.push({ y: +t.toFixed(2), aurora: fmt(...p).hex, plainSky: fmt(...q).hex, dY: +(lum(...p) - lum(...q)).toFixed(4), dHue: Math.round(hsv(...p)[0] - hsv(...q)[0]), dSat: +(hsv(...p)[1] - hsv(...q)[1]).toFixed(3) });
  }

  // ---------- ink: width distribution over the hero + plinth silhouettes ----------
  const widths = [];
  for (let yn = 0.30; yn <= 0.95; yn += 0.01) {
    const y = Math.floor(yn * H);
    const row = []; for (let x = 0; x < W; x++) { const p = at(x, y); row.push(lum(...p)); }
    let inRun = false, start = 0;
    for (let x = 30; x < W - 30; x++) {
      const win = []; for (let k = -30; k <= 30; k += 5) win.push(row[x + k]);
      win.sort((a, b) => a - b); const med = win[Math.floor(win.length / 2)];
      const dark = row[x] < 0.06 && row[x] < med * 0.35;
      if (dark && !inRun) { inRun = true; start = x; }
      else if (!dark && inRun) { inRun = false; const w = x - start; if (w >= 1 && w <= 24) widths.push(w); }
    }
  }
  widths.sort((a, b) => a - b);
  const wq = q => widths[Math.floor(widths.length * q)];

  // ---------- vignette: mean luminance in a centre disc vs the four corners ----------
  const meanIn = (x0, y0, x1, y1) => {
    let s = 0, m = 0;
    for (let y = Math.floor(y0 * H); y < Math.floor(y1 * H); y += 3) for (let x = Math.floor(x0 * W); x < Math.floor(x1 * W); x += 3) { s += lum(...at(x, y)); m++; }
    return +(s / m).toFixed(4);
  };
  const vign = {
    centre: meanIn(0.40, 0.40, 0.60, 0.60),
    topLeft: meanIn(0.0, 0.0, 0.10, 0.12),
    topRight: meanIn(0.90, 0.0, 1.0, 0.12),
    bottomLeft: meanIn(0.0, 0.88, 0.10, 1.0),
    bottomRight: meanIn(0.90, 0.88, 1.0, 1.0),
    leftEdgeMid: meanIn(0.0, 0.44, 0.06, 0.56),
    rightEdgeMid: meanIn(0.94, 0.44, 1.0, 0.56)
  };

  // ---------- horizon / composition: row luminance profile and the sky-ground boundary ----------
  const rows = [];
  for (let y = 0; y < H; y += 8) {
    let s = 0, m = 0, sat = 0;
    for (let x = 0; x < W; x += 8) { const p = at(x, y); s += lum(...p); sat += hsv(...p)[1]; m++; }
    rows.push({ y: +(y / H).toFixed(3), Y: +(s / m).toFixed(4), S: +(sat / m).toFixed(4) });
  }
  // ---------- column profile: where is the visual weight ----------
  const cols = [];
  for (let x = 0; x < W; x += 16) {
    let s = 0, m = 0;
    for (let y = 0; y < H; y += 8) { s += lum(...at(x, y)); m++; }
    cols.push({ x: +(x / W).toFixed(3), Y: +(s / m).toFixed(4) });
  }

  // ---------- lit vs shadow hue delta on rock (the painterly move) ----------
  const pairs = [
    ['foreground', [0.479, 0.723], [0.560, 0.775]],
    ['terrace', [0.890, 0.485], [0.872, 0.610]],
    ['mid', [0.120, 0.470], [0.085, 0.520]]
  ];
  const litShadow = pairs.map(([nm, a, b]) => {
    const pa = at(Math.floor(a[0] * W), Math.floor(a[1] * H));
    const pb = at(Math.floor(b[0] * W), Math.floor(b[1] * H));
    const [ha, sa, va] = hsv(...pa), [hb, sb, vb] = hsv(...pb);
    return {
      name: nm, lit: fmt(...pa).hex, shadow: fmt(...pb).hex,
      hueLit: Math.round(ha), hueShadow: Math.round(hb), hueShift: Math.round(((hb - ha) + 540) % 360 - 180),
      satLit: +sa.toFixed(3), satShadow: +sb.toFixed(3),
      Ylit: +lum(...pa).toFixed(4), Yshadow: +lum(...pb).toFixed(4),
      ratio: +(lum(...pa) / Math.max(1e-4, lum(...pb))).toFixed(2)
    };
  });

  return { size: [W, H], regions, censusPct, skyRamp, auroraRamp,
    ink: { samples: widths.length, p10: wq(0.10), p25: wq(0.25), median: wq(0.5), p75: wq(0.75), p90: wq(0.90), max: widths[widths.length - 1] },
    vignette: vign, rows, cols, litShadow };
}, { b64, REGIONS });
await browser.close();
writeFileSync(path.join(root, 'review', 'p02-reference-measurements-3.json'), JSON.stringify(out, null, 2));
console.log('REGIONS (median / high / low)');
for (const [k, v] of Object.entries(out.regions)) {
  console.log(k.padEnd(24), v.median.hex, JSON.stringify(v.median.hsv).padEnd(20), 'Y', String(v.median.Y).padEnd(8), '| hi', v.high.hex, '| lo', v.low.hex);
}
console.log('\nCENSUS', JSON.stringify(out.censusPct, null, 1));
console.log('\nINK', JSON.stringify(out.ink));
console.log('\nVIGNETTE', JSON.stringify(out.vignette));
console.log('\nLIT vs SHADOW', JSON.stringify(out.litShadow, null, 1));
console.log('\nSKY RAMP'); for (const s of out.skyRamp) console.log(' ', s.y, s.hex, JSON.stringify(s.hsv), 'Y', s.Y);
console.log('\nAURORA DELTA'); for (const a of out.auroraRamp) console.log(' ', a.y, a.aurora, 'vs', a.plainSky, 'dY', a.dY, 'dHue', a.dHue, 'dSat', a.dSat);
