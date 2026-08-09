#!/usr/bin/env node
/**
 * P02 evidence: render a palette board so a critic can see every authored swatch
 * beside the region of the reference it was measured from, plus the value study,
 * the 64px thumbnail and the saturation map.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const b64 = readFileSync(path.join(root, 'reference', 'brief-hero.png')).toString('base64');
const pal = JSON.parse(readFileSync(path.join(root, 'design', 'palette.json'), 'utf8'));

// role -> the normalised patch of the reference it was measured from (null = authored, no source)
const SRC = {
  'sky.zenith': [0.230, 0.000, 0.260, 0.020], 'sky.upper': [0.230, 0.072, 0.260, 0.092],
  'sky.pivot': [0.230, 0.200, 0.260, 0.220], 'sky.horizon': [0.230, 0.292, 0.260, 0.312],
  'sky.sun': [0.918, 0.325, 0.945, 0.345],
  'aurora.mint': [0.236, 0.172, 0.262, 0.192], 'aurora.teal': [0.236, 0.132, 0.262, 0.152],
  'aurora.violet': null,
  'rock.warm.lit': [0.707, 0.723, 0.717, 0.733], 'rock.warm.mid': 'derived',
  'rock.warm.low': [0.472, 0.718, 0.486, 0.729], 'rock.shadow': [0.864, 0.602, 0.882, 0.618],
  'rock.shadow.deep': [0.690, 0.850, 0.712, 0.870], 'rock.albedo': null,
  'resonance.core': [0.3110, 0.4885, 0.3145, 0.4955], 'resonance.bloom': [0.596, 0.680, 0.612, 0.692],
  'resonance.hot': null, 'resonance.flow': [0.168, 0.696, 0.192, 0.714], 'resonance.deep': null,
  'hero.armour': 'derived', 'hero.undersuit': [0.3780, 0.6120, 0.3850, 0.6260],
  'hero.accent': [0.3110, 0.4885, 0.3145, 0.4955],
  'hero.skin': [0.3690, 0.3880, 0.3760, 0.3990], 'hero.hair': [0.3260, 0.3300, 0.3340, 0.3430],
  'hero.ink': [0.3760, 0.5960, 0.3782, 0.6040],
  'holo.veil': [0.700, 0.264, 0.735, 0.282], 'holo.stroke': [0.4995, 0.2720, 0.5075, 0.2850],
  'holo.glyph': [0.5290, 0.3440, 0.5370, 0.3530], 'holo.data': [0.6860, 0.3820, 0.6950, 0.3930],
  'ui.ink': null, 'ui.ink.dim': [0.4600, 0.9080, 0.4750, 0.9180],
  'ui.ink.accent': [0.4100, 0.8700, 0.4300, 0.8850],
  'ui.surface': [0.912, 0.055, 0.928, 0.075], 'ui.scrim': [0.240, 0.860, 0.270, 0.880],
  'ui.surface.raised': [0.150, 0.045, 0.162, 0.066], 'ui.stroke': [0.1000, 0.0445, 0.1300, 0.0467],
  'reward.gold': [0.070, 0.082, 0.100, 0.092],
  'danger': null, 'danger.deep': null, 'success': null, 'success.deep': null
};

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<canvas id=c></canvas>');
const url = await page.evaluate(async ({ b64, roles, SRC }) => {
  const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
  const IW = img.naturalWidth, IH = img.naturalHeight;
  const names = Object.keys(roles);
  const COLS = 4, ROWW = 470, ROWH = 62, PADT = 300, PADL = 24;
  const rowsN = Math.ceil(names.length / COLS);
  const W = PADL * 2 + COLS * ROWW, H = PADT + rowsN * ROWH + 46;
  const c = document.getElementById('c'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#15181a'; g.fillRect(0, 0, W, H);

  // header: the reference itself, scaled
  const hw = W - PADL * 2, hh = Math.round(hw * IH / IW);
  g.drawImage(img, PADL, 16, hw, Math.min(hh, PADT - 60));
  g.fillStyle = '#e8f1f0'; g.font = 'bold 22px system-ui, sans-serif';
  g.fillText('Variable Star — palette board (P02)', PADL, PADT - 22);
  g.font = '13px system-ui, sans-serif'; g.fillStyle = '#9aa6a8';
  g.fillText('left = authored swatch  ·  right = the patch of reference/brief-hero.png it was measured from  ·  grey hatch = authored, no source in the reference  ·  “ramp mid” = the working middle of a measured ramp, not a single sampled pixel  ·  ui.scrim shows its COMPOSITE over rock, the swatch is the plate', PADL, PADT - 5);

  names.forEach((nm, i) => {
    const col = i % COLS, row = (i / COLS) | 0;
    const x = PADL + col * ROWW, y = PADT + row * ROWH;
    const r = roles[nm];
    // authored swatch
    g.fillStyle = r.hex; g.fillRect(x, y, 62, 46);
    // measured source patch
    const src = SRC[nm];
    if (Array.isArray(src)) {
      g.drawImage(img, src[0] * IW, src[1] * IH, Math.max(1, (src[2] - src[0]) * IW), Math.max(1, (src[3] - src[1]) * IH), x + 64, y, 62, 46);
    } else if (src === 'derived') {
      g.fillStyle = '#1b2426'; g.fillRect(x + 64, y, 62, 46);
      g.fillStyle = '#6fb3bb'; g.font = 'bold 10px system-ui, sans-serif';
      g.fillText('ramp', x + 72, y + 22); g.fillText('mid', x + 74, y + 34);
    } else {
      g.fillStyle = '#23282a'; g.fillRect(x + 64, y, 62, 46);
      g.strokeStyle = '#3a4245'; g.lineWidth = 1;
      for (let k = -46; k < 62; k += 7) { g.beginPath(); g.moveTo(x + 64 + k, y + 46); g.lineTo(x + 64 + k + 46, y); g.stroke(); }
    }
    g.strokeStyle = '#000'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, 126, 46);
    g.fillStyle = '#e8f1f0'; g.font = 'bold 13px system-ui, sans-serif';
    g.fillText(nm, x + 134, y + 15);
    g.fillStyle = '#9aa6a8'; g.font = '11px ui-monospace, monospace';
    g.fillText(`${r.hex}  Y ${r.luminance}`, x + 134, y + 30);
    g.fillText(`hsv ${r.hsv[0]}° ${r.hsv[1]} ${r.hsv[2]}   lin ${r.linear.map(v => v.toFixed(2)).join(' ')}`, x + 134, y + 43);
  });
  return c.toDataURL('image/png');
}, { b64, roles: pal.roles, SRC });
await browser.close();
const f = path.join(root, 'review', 'shots', 'p02', 'palette-board.png');
const fs = await import('node:fs');
fs.mkdirSync(path.dirname(f), { recursive: true });
writeFileSync(f, Buffer.from(url.split(',')[1], 'base64'));
console.log(f);
