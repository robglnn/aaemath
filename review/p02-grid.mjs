#!/usr/bin/env node
/** P02 scratch: draw a labelled normalised grid over the reference so sample boxes can be placed exactly. */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const b64 = readFileSync(path.join(root, 'reference', 'brief-hero.png')).toString('base64');
const boxes = JSON.parse(process.argv[2] || '{}');
const crop = process.argv[3] ? process.argv[3].split(',').map(Number) : [0, 0, 1, 1];
const name = process.argv[4] || 'grid';

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<canvas id=c></canvas>');
const url = await page.evaluate(async ({ b64, boxes, crop }) => {
  const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
  const W = img.naturalWidth, H = img.naturalHeight;
  const [cx0, cy0, cx1, cy1] = crop;
  const sx = cx0 * W, sy = cy0 * H, sw = (cx1 - cx0) * W, sh = (cy1 - cy0) * H;
  const c = document.getElementById('c');
  const OW = 1600, OH = Math.round(OW * sh / sw);
  c.width = OW; c.height = OH;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, OW, OH);
  const nx = (u) => (u - cx0) / (cx1 - cx0) * OW;
  const ny = (v) => (v - cy0) / (cy1 - cy0) * OH;
  ctx.font = '13px monospace'; ctx.lineWidth = 1;
  for (let u = 0; u <= 1.0001; u += 0.05) {
    if (u < cx0 || u > cx1) continue;
    const X = nx(u);
    ctx.strokeStyle = (Math.round(u * 100) % 10 === 0) ? 'rgba(255,0,255,0.85)' : 'rgba(255,0,255,0.30)';
    ctx.beginPath(); ctx.moveTo(X, 0); ctx.lineTo(X, OH); ctx.stroke();
    ctx.fillStyle = '#000'; ctx.fillRect(X + 1, 0, 30, 15);
    ctx.fillStyle = '#0ff'; ctx.fillText(u.toFixed(2), X + 2, 12);
  }
  for (let v = 0; v <= 1.0001; v += 0.05) {
    if (v < cy0 || v > cy1) continue;
    const Y = ny(v);
    ctx.strokeStyle = (Math.round(v * 100) % 10 === 0) ? 'rgba(255,0,255,0.85)' : 'rgba(255,0,255,0.30)';
    ctx.beginPath(); ctx.moveTo(0, Y); ctx.lineTo(OW, Y); ctx.stroke();
    ctx.fillStyle = '#000'; ctx.fillRect(0, Y + 1, 34, 15);
    ctx.fillStyle = '#0ff'; ctx.fillText(v.toFixed(2), 2, Y + 13);
  }
  ctx.lineWidth = 2;
  for (const [nm, b] of Object.entries(boxes)) {
    ctx.strokeStyle = '#ff0'; ctx.strokeRect(nx(b[0]), ny(b[1]), nx(b[2]) - nx(b[0]), ny(b[3]) - ny(b[1]));
    ctx.fillStyle = '#000'; const w = ctx.measureText(nm).width + 4;
    ctx.fillRect(nx(b[0]), ny(b[1]) - 15, w, 15);
    ctx.fillStyle = '#ff0'; ctx.fillText(nm, nx(b[0]) + 2, ny(b[1]) - 3);
  }
  return c.toDataURL('image/png');
}, { b64, boxes, crop });
await browser.close();
const f = path.join(root, 'review', 'p02-crops', name + '.png');
writeFileSync(f, Buffer.from(url.split(',')[1], 'base64'));
console.log(f);
