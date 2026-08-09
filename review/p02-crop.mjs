#!/usr/bin/env node
/**
 * P02 scratch: crop labelled sub-rectangles out of the reference so they can be
 * eyeballed at high zoom, and print a per-crop colour census.
 * usage: node review/p02-crop.mjs name x0 y0 x1 y1 [scale]   (normalised coords)
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imgPath = path.join(root, 'reference', 'brief-hero.png');
const outDir = path.join(root, 'review', 'p02-crops');
mkdirSync(outDir, { recursive: true });
const b64 = readFileSync(imgPath).toString('base64');

const jobs = [];
for (let i = 2; i < process.argv.length; i += 6) {
  jobs.push({
    name: process.argv[i],
    box: [+process.argv[i + 1], +process.argv[i + 2], +process.argv[i + 3], +process.argv[i + 4]],
    scale: +(process.argv[i + 5] || 2)
  });
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<canvas id=c></canvas>');
const out = await page.evaluate(async ({ b64, jobs }) => {
  const img = new Image();
  img.src = 'data:image/png;base64,' + b64;
  await img.decode();
  const W = img.naturalWidth, H = img.naturalHeight;
  const c = document.getElementById('c');
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const res = [];
  for (const j of jobs) {
    const [x0, y0, x1, y1] = j.box;
    const sx = Math.floor(x0 * W), sy = Math.floor(y0 * H);
    const sw = Math.max(1, Math.ceil((x1 - x0) * W)), sh = Math.max(1, Math.ceil((y1 - y0) * H));
    c.width = Math.round(sw * j.scale); c.height = Math.round(sh * j.scale);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
    res.push({ name: j.name, px: [sx, sy, sw, sh], url: c.toDataURL('image/png') });
  }
  return res;
}, { b64, jobs });
await browser.close();

for (const r of out) {
  const f = path.join(outDir, r.name + '.png');
  writeFileSync(f, Buffer.from(r.url.split(',')[1], 'base64'));
  console.log(f, r.px.join(','));
}
