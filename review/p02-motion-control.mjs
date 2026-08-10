#!/usr/bin/env node
/**
 * Two synthetic 6-frame sequences, so the §15 motion checks can be shown to
 * REJECT as well as accept. A temporal gate that only ever passes proves
 * nothing — the same argument that produced review/p02-negative-control.mjs for
 * the still-frame checks.
 *
 *   review/p02-crops/motion-good/  fixed 8x8 Bayer dither in screen space,
 *                                  constant ink width, an emitter whose core
 *                                  pulses on a 2 s period (an AUTHORED change,
 *                                  which is what a motion budget must tolerate)
 *
 *   review/p02-crops/motion-bad/   the same frame committing §15's temporal
 *                                  anti-patterns: dither re-randomised every
 *                                  frame, ink width alternating 3 px / 6 px,
 *                                  emitter core radius jumping 40% every other
 *                                  frame, and specular sparkles that reseed.
 *
 *   node review/p02-motion-control.mjs
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<canvas id=c></canvas>');

const urls = await page.evaluate(async () => {
  const W = 1600, H = 900, N = 6;
  const c = document.getElementById('c'); c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });

  // 8x8 ordered Bayer, the pattern §10 mandates: fixed in SCREEN space, so it
  // is the same integer at the same pixel on every frame.
  const BAYER = [
    [0, 32, 8, 40, 2, 34, 10, 42], [48, 16, 56, 24, 50, 18, 58, 26],
    [12, 44, 4, 36, 14, 46, 6, 38], [60, 28, 52, 20, 62, 30, 54, 22],
    [3, 35, 11, 43, 1, 33, 9, 41], [51, 19, 59, 27, 49, 17, 57, 25],
    [15, 47, 7, 39, 13, 45, 5, 37], [63, 31, 55, 23, 61, 29, 53, 21]
  ];

  const out = { good: [], bad: [] };

  for (const kind of ['good', 'bad']) {
    for (let f = 0; f < N; f++) {
      const t = f / 60;                                   // one fixed step apart
      let seed = kind === 'bad' ? 1234 + f * 7919 : 1234; // bad reseeds per frame
      const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

      // ── sky: a shallow gradient that MUST be dithered to survive 8 bits ────
      const img = g.createImageData(W, H);
      const D = img.data;
      const skyH = Math.floor(H * 0.31);
      for (let y = 0; y < skyH; y++) {
        const u = y / skyH;
        // ~0.006 Y per 1% of frame height — the reference's rate, which is under
        // one code value every three pixels, i.e. banding without dither.
        const r0 = 141 + u * 58, g0 = 172 + u * 29, b0 = 188 - u * 22;
        for (let x = 0; x < W; x++) {
          const d = kind === 'good'
            ? (BAYER[y & 7][x & 7] / 64 - 0.5)             // fixed screen-space pattern
            : (rnd() - 0.5);                                // per-frame white noise
          const i = (y * W + x) * 4;
          D[i] = Math.max(0, Math.min(255, Math.round(r0 + d)));
          D[i + 1] = Math.max(0, Math.min(255, Math.round(g0 + d)));
          D[i + 2] = Math.max(0, Math.min(255, Math.round(b0 + d)));
          D[i + 3] = 255;
        }
      }
      // ── ground: warm rock, static ─────────────────────────────────────────
      for (let y = skyH; y < H; y++) {
        const u = (y - skyH) / (H - skyH);
        const r0 = 208 - u * 60, g0 = 132 - u * 40, b0 = 79 - u * 20;
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          const facet = ((x * 7 + y * 3) % 211) < 60 ? -26 : 0; // hard facets, no falloff
          D[i] = r0 + facet; D[i + 1] = g0 + facet; D[i + 2] = b0 + facet; D[i + 3] = 255;
        }
      }
      g.putImageData(img, 0, 0);

      // ── hero: a dark mass with an ink contour ─────────────────────────────
      const hx0 = Math.round(W * 0.288), hx1 = Math.round(W * 0.415);
      const hy0 = Math.round(H * 0.280), hy1 = Math.round(H * 0.955);
      g.fillStyle = 'rgb(58,60,66)';
      g.beginPath();
      g.moveTo(hx0 + 18, hy1); g.lineTo(hx0, hy0 + 120); g.lineTo((hx0 + hx1) / 2, hy0);
      g.lineTo(hx1, hy0 + 120); g.lineTo(hx1 - 18, hy1); g.closePath(); g.fill();
      g.fillStyle = 'rgb(31,217,210)';
      for (let k = 0; k < 5; k++) g.fillRect((hx0 + hx1) / 2 - 7, hy0 + 190 + k * 34, 14, 18);
      // ink: warm near-black. GOOD holds 3 px; BAD alternates 3 px / 6 px — the
      // classic crawl, which a static frame cannot see at all.
      g.strokeStyle = '#140D0A';
      g.lineWidth = kind === 'good' ? 3 : (f % 2 ? 6 : 3);
      g.beginPath();
      g.moveTo(hx0 + 18, hy1); g.lineTo(hx0, hy0 + 120); g.lineTo((hx0 + hx1) / 2, hy0);
      g.lineTo(hx1, hy0 + 120); g.lineTo(hx1 - 18, hy1); g.closePath(); g.stroke();

      // ── emitter: blown core + halo ────────────────────────────────────────
      const ex = W * 0.6344, ey = H * 0.7038;
      // GOOD: a 2 s pulse — 0.8% of its amplitude per fixed step.
      // BAD: the core radius jumps 40% every other frame (bloom pop).
      const base = 26;
      const rCore = kind === 'good' ? base * (1 + 0.10 * Math.sin(2 * Math.PI * t / 2))
        : base * (f % 2 ? 1.4 : 1.0);
      const halo = g.createRadialGradient(ex, ey, 0, ex, ey, rCore * 6);
      halo.addColorStop(0, 'rgba(158,243,240,0.95)');
      halo.addColorStop(0.35, 'rgba(47,227,214,0.45)');
      halo.addColorStop(1, 'rgba(47,227,214,0)');
      g.fillStyle = halo; g.beginPath(); g.arc(ex, ey, rCore * 6, 0, 7); g.fill();
      g.fillStyle = '#E9FFFB'; g.beginPath(); g.arc(ex, ey, rCore, 0, 7); g.fill();

      // ── specular: BAD sparkles reseed every frame (no specular AA) ────────
      if (kind === 'bad') {
        g.fillStyle = 'rgba(255,252,160,0.95)';
        for (let i = 0; i < 900; i++) {
          const x = rnd() * W, y = skyH + rnd() * (H - skyH);
          g.fillRect(x, y, 2, 2);
        }
      } else {
        // a stable, geometry-locked highlight band — the same pixels every frame
        g.fillStyle = 'rgba(255,252,160,0.75)';
        for (let i = 0; i < 900; i++) {
          const x = ((i * 733) % W), y = skyH + ((i * 397) % (H - skyH));
          g.fillRect(x, y, 2, 2);
        }
      }

      out[kind].push(c.toDataURL('image/png'));
    }
  }
  return out;
});
await browser.close();

for (const kind of ['good', 'bad']) {
  const dir = path.join(root, 'review', 'p02-crops', `motion-${kind}`);
  mkdirSync(dir, { recursive: true });
  urls[kind].forEach((u, i) => {
    writeFileSync(path.join(dir, `f${String(i).padStart(2, '0')}.png`), Buffer.from(u.split(',')[1], 'base64'));
  });
  writeFileSync(path.join(dir, 'sequence.json'), JSON.stringify({
    mode: 'static', frames: urls[kind].length, step: 1 / 60, width: 1600, height: 900,
    synthetic: true, kind,
    files: urls[kind].map((_, i) => `review/p02-crops/motion-${kind}/f${String(i).padStart(2, '0')}.png`),
    problems: []
  }, null, 2));
  console.log(`wrote review/p02-crops/motion-${kind}/ (${urls[kind].length} frames)`);
}
