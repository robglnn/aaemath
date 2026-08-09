#!/usr/bin/env node
/**
 * P02 scratch: synthesize the "cheap WebGL demo" frame the art-direction doc warns
 * about, so the auditor's thresholds can be shown to REJECT something as well as
 * accept the reference. A gate that only ever passes proves nothing.
 *
 * Deliberate sins, one per anti-pattern in design/art-direction.md §9:
 *   flat matte Lambert; uniform grey ambient (shadow = albedo x 0.35, so shadows go
 *   BROWN); no depth of field; two-stop banded sky with no dither; horizon dead
 *   centre; hero dead centre with no value separation; saturated cyan everywhere;
 *   no dark framing mass.
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<canvas id=c></canvas>');
const url = await page.evaluate(async () => {
  const W = 1600, H = 900;
  const c = document.getElementById('c'); c.width = W; c.height = H;
  const g = c.getContext('2d');

  // sky: two-stop lerp, quantised to 12 steps => banding, no neutral pivot
  for (let y = 0; y < H / 2; y++) {
    const t = Math.floor((y / (H / 2)) * 12) / 12;
    const r = Math.round(110 + t * 90), gg = Math.round(150 + t * 60), b = Math.round(210 - t * 40);
    g.fillStyle = `rgb(${r},${gg},${b})`; g.fillRect(0, y, W, 1);
  }
  // ground: flat matte lit + BROWN shadow (albedo x 0.35) — the cardinal sin
  const lit = [214, 132, 79], shadow = lit.map(v => Math.round(v * 0.35));
  g.fillStyle = `rgb(${lit.join(',')})`; g.fillRect(0, H / 2, W, H / 2);
  // faceted ground, all in focus, uniform ambient
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 260; i++) {
    const x = rnd() * W, y = H / 2 + rnd() * (H / 2), s = 30 + rnd() * 110;
    g.fillStyle = rnd() > 0.5 ? `rgb(${lit.join(',')})` : `rgb(${shadow.join(',')})`;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + s, y + s * 0.4); g.lineTo(x - s * 0.5, y + s * 0.7); g.closePath(); g.fill();
  }
  // saturated cyan everywhere, no budget
  for (let i = 0; i < 150; i++) {
    const x = rnd() * W, y = H / 2 + rnd() * (H / 2), s = 14 + rnd() * 60;
    g.fillStyle = 'rgb(31,217,210)';
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + s * 0.4, y - s); g.lineTo(x + s * 0.8, y); g.closePath(); g.fill();
  }
  // hero: dead centre, mid-value, no separation, no contact shadow, and a
  // UNIFORM-WIDTH pure-black outline (§12.11) so the ink taper check has
  // something to reject.
  g.fillStyle = 'rgb(150,140,120)';
  g.fillRect(W / 2 - 40, H / 2 - 120, 80, 240);
  g.fillStyle = 'rgb(31,217,210)'; g.fillRect(W / 2 - 14, H / 2 - 80, 28, 90);
  g.strokeStyle = '#000000'; g.lineWidth = 4;
  g.strokeRect(W / 2 - 40, H / 2 - 120, 80, 240);
  g.beginPath(); g.moveTo(W / 2 - 14, H / 2 - 80); g.lineTo(W / 2 - 14, H / 2 + 10); g.stroke();

  // ── the solved-constant sins ──────────────────────────────────────────
  // (a) an OPAQUE, HARD-EDGED subtitle scrim: alpha 1.0 with vertical ends.
  //     U1a sees zero transmission; U1b sees no ramp.
  g.fillStyle = 'rgba(0,0,0,1)';
  g.fillRect(Math.round(W * 0.25), Math.round(H * 0.84), Math.round(W * 0.50), Math.round(H * 0.11));
  g.fillStyle = '#9DEAF0'; g.font = '28px sans-serif';
  g.fillText('ANALYZING DATA... (0%)', Math.round(W * 0.36), Math.round(H * 0.90));

  // (b) an ADDITIVE hologram quad — the §8 failure. Over a bright background it
  //     blows out; the fit sees slope ≈ 1 with a big intercept, so V1 rejects it.
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.fillStyle = 'rgb(60,120,120)';
  g.fillRect(Math.round(W * 0.52), Math.round(H * 0.30), Math.round(W * 0.26), Math.round(H * 0.32));
  g.restore();
  g.strokeStyle = '#B4E1E0'; g.lineWidth = 2;
  g.strokeRect(Math.round(W * 0.52), Math.round(H * 0.30), Math.round(W * 0.26), Math.round(H * 0.32));
  return c.toDataURL('image/png');
});
await browser.close();
const f = path.join(root, 'review', 'p02-crops', 'negative-control.png');
writeFileSync(f, Buffer.from(url.split(',')[1], 'base64'));
console.log(f);
