#!/usr/bin/env node
/**
 * P02 scratch measurement, pass 2. Regions relocated after visually inspecting crops.
 * Also: ink-line census, depth-band contrast, thumbnail + value study renders.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imgPath = path.join(root, 'reference', 'brief-hero.png');
const outDir = path.join(root, 'review');
const b64 = readFileSync(imgPath).toString('base64');

// half-width of the sample box in normalised units
const R = (name, x, y, w = 0.004, h = 0.006) => [name, [x - w, y - h, x + w, y + h]];
const REGIONS = Object.fromEntries([
  // --- sky ---
  R('sky.zenith',            0.3314, 0.0100, 0.030, 0.008),
  R('sky.lavender',          0.4419, 0.1185, 0.020, 0.012),
  R('sky.horizon.cream',     0.1105, 0.2904, 0.025, 0.010),
  R('sky.horizon.gold',      0.9288, 0.3320, 0.015, 0.012),
  R('aurora.green.bright',   0.5338, 0.1517, 0.012, 0.012),
  R('aurora.green.soft',     0.3314, 0.1979, 0.015, 0.012),
  R('aurora.violet',         0.0900, 0.1000, 0.020, 0.020),
  // --- rock ---
  R('rock.lit.foreground',   0.5298, 0.7188, 0.012, 0.010),
  R('rock.lit.rim',          0.7133, 0.7253, 0.006, 0.006),
  R('rock.shadow.deep',      0.5484, 0.7611, 0.010, 0.008),
  R('rock.mid.lit',          0.1090, 0.4473, 0.010, 0.008),
  R('rock.mid.shadow',       0.0617, 0.5124, 0.010, 0.008),
  R('rock.far.hazed',        0.1817, 0.3887, 0.015, 0.008),
  R('rock.terrace.lit',      0.8907, 0.4850, 0.010, 0.008),
  R('rock.terrace.shadow',   0.8725, 0.6087, 0.008, 0.008),
  // --- resonance ---
  R('resonance.river.core',  0.2544, 0.7988, 0.006, 0.005),
  R('resonance.river.body',  0.2180, 0.7663, 0.008, 0.005),
  R('resonance.crystal.body',0.9197, 0.6803, 0.006, 0.008),
  R('resonance.crystal.core',0.9288, 0.6641, 0.004, 0.005),
  R('resonance.socket.core', 0.5959, 0.6953, 0.005, 0.004),
  R('resonance.socket.mid',  0.6123, 0.7018, 0.005, 0.004),
  R('resonance.ground.bounce',0.2253,0.5970, 0.010, 0.008),
  R('ruin.stone',            0.0908, 0.6621, 0.008, 0.008),
  R('ruin.inlay.cyan',       0.0218, 0.6100, 0.006, 0.010),
  // --- city ---
  R('city.mass.dark',        0.7653, 0.1628, 0.012, 0.015),
  R('city.face.warm',        0.7289, 0.2148, 0.010, 0.012),
  // --- hero ---
  R('hero.armour.lit',       0.4000, 0.6055, 0.004, 0.006),
  R('hero.armour.mid',       0.3800, 0.5300, 0.004, 0.006),
  R('hero.armour.shadow',    0.3423, 0.6380, 0.005, 0.008),
  R('hero.accent.slot',      0.3132, 0.4909, 0.002, 0.004),
  R('hero.accent.slot2',     0.3460, 0.4910, 0.002, 0.004),
  R('hero.accent.chevron',   0.3376, 0.5677, 0.002, 0.003),
  R('hero.hair.dark',        0.3260, 0.3360, 0.006, 0.008),
  R('hero.hair.lit',         0.3560, 0.3150, 0.004, 0.006),
  R('hero.skin',             0.3656, 0.3854, 0.003, 0.005),
  R('hero.glove',            0.3074, 0.6590, 0.003, 0.005),
  // --- UI ---
  R('ui.bar.health',         0.0480, 0.0620, 0.006, 0.006),
  R('ui.bar.track',          0.1450, 0.0620, 0.004, 0.006),
  R('ui.bar.xp',             0.0800, 0.0870, 0.010, 0.005),
  R('ui.banner.fill',        0.5298, 0.8665, 0.020, 0.008),
  R('minimap.fill',          0.9106, 0.0586, 0.010, 0.012),
  R('minimap.border',        0.8895, 0.1042, 0.0015,0.020)
]);

// scanlines used for the ink census: y positions crossing the hero and the plinth
const INK_SCANS = [0.52, 0.60, 0.68, 0.74, 0.82];

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<canvas id=c></canvas><canvas id=d></canvas>');
const out = await page.evaluate(async ({ b64, REGIONS, INK_SCANS }) => {
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
  const px = (x, y) => { const i = (y * W + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };

  const regions = {};
  for (const [name, [x0, y0, x1, y1]] of Object.entries(REGIONS)) {
    const X0 = Math.max(0, Math.floor(x0 * W)), X1 = Math.min(W, Math.ceil(x1 * W));
    const Y0 = Math.max(0, Math.floor(y0 * H)), Y1 = Math.min(H, Math.ceil(y1 * H));
    let Rr = 0, G = 0, B = 0, lr = 0, lg = 0, lb = 0, m = 0; const ls = [];
    for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) {
      const [r, g, b] = px(x, y);
      Rr += r; G += g; B += b; lr += s2l(r); lg += s2l(g); lb += s2l(b); m++; ls.push(lum(r, g, b));
    }
    ls.sort((a, b) => a - b);
    const mr = Math.round(Rr / m), mg = Math.round(G / m), mb = Math.round(B / m);
    const [h, s, v] = hsv(mr, mg, mb);
    regions[name] = {
      hex: '#' + [mr, mg, mb].map(z => z.toString(16).padStart(2, '0')).join(''),
      rgb: [mr, mg, mb],
      linear: [+(lr / m).toFixed(4), +(lg / m).toFixed(4), +(lb / m).toFixed(4)],
      hsv: [Math.round(h), +s.toFixed(3), +v.toFixed(3)],
      Y: +lum(mr, mg, mb).toFixed(4),
      spread: +(ls[Math.floor(m * 0.9)] - ls[Math.floor(m * 0.1)]).toFixed(4),
      box: [X0, Y0, X1 - X0, Y1 - Y0]
    };
  }

  // ---------- ink census: find local luminance minima that are narrow & dark ----------
  const ink = [];
  for (const yn of INK_SCANS) {
    const y = Math.floor(yn * H);
    const row = [];
    for (let x = 0; x < W; x++) { const [r, g, b] = px(x, y); row.push(lum(r, g, b)); }
    // detect runs where L < 0.4 * local median over +-24px
    const runs = [];
    let inRun = false, start = 0;
    for (let x = 24; x < W - 24; x++) {
      const win = [];
      for (let k = -24; k <= 24; k += 4) win.push(row[x + k]);
      win.sort((a, b) => a - b);
      const med = win[Math.floor(win.length / 2)];
      const dark = row[x] < med * 0.42 && row[x] < 0.10;
      if (dark && !inRun) { inRun = true; start = x; }
      else if (!dark && inRun) { inRun = false; if (x - start >= 1 && x - start <= 22) runs.push({ x: start, w: x - start, L: +row[start + Math.floor((x - start) / 2)].toFixed(4) }); }
    }
    ink.push({ y: yn, count: runs.length, widths: runs.map(r => r.w), minL: runs.length ? Math.min(...runs.map(r => r.L)) : null, runs: runs.slice(0, 24) });
  }

  // darkest pixel in the frame + its colour
  let dk = 1e9, dkc = null, br = -1, brc = null;
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
    const [r, g, b] = px(x, y); const L = lum(r, g, b);
    if (L < dk) { dk = L; dkc = [r, g, b, x, y]; }
    if (L > br) { br = L; brc = [r, g, b, x, y]; }
  }

  // ---------- depth-band local contrast (stddev of luminance in 32px tiles) ----------
  const bands = { foreground: [0.72, 1.00], midground: [0.50, 0.72], distance: [0.30, 0.50], sky: [0.00, 0.28] };
  const bandStats = {};
  for (const [nm, [a, b2]] of Object.entries(bands)) {
    const Y0 = Math.floor(a * H), Y1 = Math.floor(b2 * H);
    let sds = [], sats = [];
    for (let ty = Y0; ty + 32 < Y1; ty += 48) for (let tx = 0; tx + 32 < W; tx += 96) {
      let s = 0, s2 = 0, m = 0, sa = 0;
      for (let y = ty; y < ty + 32; y += 2) for (let x = tx; x < tx + 32; x += 2) {
        const [r, g, b] = px(x, y); const L = lum(r, g, b); s += L; s2 += L * L; m++; sa += hsv(r, g, b)[1];
      }
      const mean = s / m; sds.push(Math.sqrt(Math.max(0, s2 / m - mean * mean))); sats.push(sa / m);
    }
    sds.sort((x, y) => x - y); sats.sort((x, y) => x - y);
    bandStats[nm] = {
      medianTileContrast: +sds[Math.floor(sds.length / 2)].toFixed(4),
      p90TileContrast: +sds[Math.floor(sds.length * 0.9)].toFixed(4),
      medianSaturation: +sats[Math.floor(sats.length / 2)].toFixed(4)
    };
  }

  // ---------- thumbnail (64px tall) and a value study, returned as PNGs ----------
  const d = document.getElementById('d');
  const dc = d.getContext('2d');
  const outs = {};
  // thumbnail
  d.width = Math.round(64 * W / H); d.height = 64;
  dc.drawImage(img, 0, 0, d.width, d.height);
  outs.thumb64 = d.toDataURL('image/png');
  // upscaled thumbnail so it is inspectable
  const t = dc.getImageData(0, 0, d.width, d.height);
  const tw = d.width, th = d.height;
  d.width = tw * 8; d.height = th * 8;
  dc.imageSmoothingEnabled = false;
  const tmp = document.createElement('canvas'); tmp.width = tw; tmp.height = th;
  tmp.getContext('2d').putImageData(t, 0, 0);
  dc.drawImage(tmp, 0, 0, d.width, d.height);
  outs.thumb64x8 = d.toDataURL('image/png');
  // value study at 1/3 size
  const vw = Math.round(W / 3), vh = Math.round(H / 3);
  d.width = vw; d.height = vh; dc.imageSmoothingEnabled = true;
  dc.drawImage(img, 0, 0, vw, vh);
  const vd = dc.getImageData(0, 0, vw, vh);
  for (let i = 0; i < vd.data.length; i += 4) {
    const L = lum(vd.data[i], vd.data[i + 1], vd.data[i + 2]);
    const g = Math.round(255 * (L <= 0.0031308 ? L * 12.92 : 1.055 * Math.pow(L, 1 / 2.4) - 0.055));
    vd.data[i] = vd.data[i + 1] = vd.data[i + 2] = g;
  }
  dc.putImageData(vd, 0, 0);
  outs.valueStudy = d.toDataURL('image/png');
  // saturation map: show where saturation > 0.35
  d.width = vw; d.height = vh;
  dc.drawImage(img, 0, 0, vw, vh);
  const sd = dc.getImageData(0, 0, vw, vh);
  for (let i = 0; i < sd.data.length; i += 4) {
    const [h, s] = hsv(sd.data[i], sd.data[i + 1], sd.data[i + 2]);
    if (s < 0.30) { sd.data[i] = sd.data[i + 1] = sd.data[i + 2] = 24; }
    else if (h >= 150 && h <= 215) { sd.data[i] = 0; sd.data[i + 1] = 220; sd.data[i + 2] = 255; }
    else if (h > 90 && h < 150) { sd.data[i] = 60; sd.data[i + 1] = 255; sd.data[i + 2] = 120; }
    else if (h < 60 || h > 320) { sd.data[i] = 255; sd.data[i + 1] = 140; sd.data[i + 2] = 30; }
    else { sd.data[i] = 200; sd.data[i + 1] = 60; sd.data[i + 2] = 255; }
  }
  dc.putImageData(sd, 0, 0);
  outs.saturationMap = d.toDataURL('image/png');

  return {
    regions, ink,
    darkest: { L: +dk.toFixed(5), rgb: dkc.slice(0, 3), at: dkc.slice(3) },
    brightest: { L: +br.toFixed(5), rgb: brc.slice(0, 3), at: brc.slice(3) },
    bandStats, outs
  };
}, { b64, REGIONS, INK_SCANS });

await browser.close();
mkdirSync(path.join(outDir, 'p02-crops'), { recursive: true });
for (const [k, v] of Object.entries(out.outs)) {
  writeFileSync(path.join(outDir, 'p02-crops', k + '.png'), Buffer.from(v.split(',')[1], 'base64'));
}
delete out.outs;
writeFileSync(path.join(outDir, 'p02-reference-measurements-2.json'), JSON.stringify(out, null, 2));

for (const [k, v] of Object.entries(out.regions)) {
  console.log(k.padEnd(26), v.hex, 'hsv', JSON.stringify(v.hsv).padEnd(20), 'Y', String(v.Y).padEnd(8), 'lin', JSON.stringify(v.linear));
}
console.log('\ndarkest', JSON.stringify(out.darkest), '\nbrightest', JSON.stringify(out.brightest));
console.log('\nbands', JSON.stringify(out.bandStats, null, 1));
console.log('\nink', JSON.stringify(out.ink.map(i => ({ y: i.y, count: i.count, minL: i.minL, widths: i.widths.slice(0, 14) })), null, 1));
