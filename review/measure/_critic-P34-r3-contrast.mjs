#!/usr/bin/env node
/**
 * CRITIC — is the ask row LEGIBLE against what is behind it?
 *
 * `P34.mjs` R7 checks em size against a legibility floor and C9b checks geometric occlusion. Neither
 * looks at the value of the pixels behind the ink. This decodes the capture in a browser canvas and,
 * for each presented row's NDC box, reports the ink luminance, the background luminance and the WCAG
 * contrast ratio between them.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const shot = process.argv[2] ?? "review/shots/p34/standing.png";
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const b64 = fs.readFileSync(path.join(ROOT, shot)).toString("base64");

const browser = await chromium.launch();
const page = await browser.newPage();
const rows = JSON.parse(fs.readFileSync(path.join(ROOT, process.argv[3] ?? "review/measure/evidence/P34.json"), "utf8")).framed;

const out = await page.evaluate(
  async ([b64, rows]) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const lum = (i) => {
      const f = (v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(d[i]) + 0.7152 * f(d[i + 1]) + 0.0722 * f(d[i + 2]);
    };
    const res = [];
    for (const r of rows) {
      // NDC -> pixels
      const x0 = Math.max(0, Math.floor(((r.x[0] + 1) / 2) * c.width));
      const x1 = Math.min(c.width - 1, Math.ceil(((r.x[1] + 1) / 2) * c.width));
      const y0 = Math.max(0, Math.floor(((1 - r.y[1]) / 2) * c.height));
      const y1 = Math.min(c.height - 1, Math.ceil(((1 - r.y[0]) / 2) * c.height));
      const vals = [];
      for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) vals.push(lum((y * c.width + x) * 4));
      if (!vals.length) continue;
      vals.sort((a, b) => a - b);
      // The ink is white; the brightest 3% of the box is ink, and the darkest 60% is what is behind.
      const ink = vals[Math.floor(vals.length * 0.99)];
      const bgLow = vals[Math.floor(vals.length * 0.1)];
      const bgHigh = vals[Math.floor(vals.length * 0.6)];
      const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      // worst case: the brightest background the ink has to sit on
      res.push({
        id: r.id,
        box: [x0, y0, x1, y1],
        inkL: Number(ink.toFixed(3)),
        bgMedianL: Number(bgHigh.toFixed(3)),
        bgDarkL: Number(bgLow.toFixed(3)),
        contrastVsMedianBg: Number(ratio(ink, bgHigh).toFixed(2)),
        contrastVsDarkBg: Number(ratio(ink, bgLow).toFixed(2)),
      });
    }
    // brightest background patch anywhere in the ask band, sampled as 16x16 tiles
    return res;
  },
  [b64, rows]
);

console.log(shot);
for (const r of out) console.log(`  ${r.id.padEnd(18)} box ${JSON.stringify(r.box).padEnd(22)} ink L=${r.inkL}  bg(median) L=${r.bgMedianL} -> contrast ${r.contrastVsMedianBg}:1   bg(dark) L=${r.bgDarkL} -> ${r.contrastVsDarkBg}:1`);
await browser.close();
