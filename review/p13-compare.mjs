// Scratch: compare a capture's census against the reference target's, to steer tuning.
import { readPng, census, median, hsv, luminance } from "./measure/p13-png.mjs";

const files = process.argv.slice(2);
const FULL = [0, 0, 1, 1];

for (const f of files) {
  const img = readPng(f);
  const acc = census(img, FULL, (r, g, b, c) => c.h >= 150 && c.h <= 200 && c.v >= 0.8 && c.s >= 0.25);
  const warm = census(img, FULL, (r, g, b, c, Y) => c.h >= 20 && c.h <= 50 && c.s >= 0.4 && Y >= 0.08);
  const coolShadow = census(img, FULL, (r, g, b, c, Y) => c.h >= 170 && c.h <= 220 && Y <= 0.06);
  const green = census(img, FULL, (r, g, b, c) => c.h >= 60 && c.h <= 150 && c.s >= 0.25);
  const blown = census(img, FULL, (r, g, b, c, Y) => Y >= 0.9);
  const crushed = census(img, FULL, (r, g, b, c, Y) => Y <= 0.004);
  const crystalHot = median(img, FULL, (r, g, b, c) => c.h >= 140 && c.h <= 200 && c.s >= 0.2 && c.v >= 0.92);
  const crystalFace = median(img, FULL, (r, g, b, c) => c.h >= 140 && c.h <= 200 && c.s >= 0.25 && c.v >= 0.7 && c.v < 0.92);
  const pct = [];
  const lum = [];
  for (let y = 0; y < img.height; y += 2)
    for (let x = 0; x < img.width; x += 2) {
      const i = (y * img.width + x) * img.channels;
      lum.push(luminance(img.data[i], img.data[i + 1], img.data[i + 2]));
    }
  lum.sort((a, b) => a - b);
  for (const p of [0.05, 0.25, 0.5, 0.75, 0.95]) pct.push(Number(lum[Math.floor(lum.length * p)].toFixed(4)));

  console.log(
    JSON.stringify(
      {
        file: f,
        size: [img.width, img.height],
        coolAccent: Number(acc.share.toFixed(4)),
        warmLit: Number(warm.share.toFixed(4)),
        coolShadow: Number(coolShadow.share.toFixed(4)),
        green: Number(green.share.toFixed(4)),
        blown: Number(blown.share.toFixed(4)),
        crushed: Number(crushed.share.toFixed(4)),
        crystalHot: crystalHot && { hex: crystalHot.hex, n: crystalHot.n, Y: Number(crystalHot.Y.toFixed(3)) },
        crystalFace: crystalFace && { hex: crystalFace.hex, n: crystalFace.n, Y: Number(crystalFace.Y.toFixed(3)) },
        lumPercentiles: pct,
      },
      null,
      1
    )
  );
}
