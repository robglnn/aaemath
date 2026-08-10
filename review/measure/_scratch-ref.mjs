// Scratch: measure how the art target actually draws its floating mathematics.
import fs from "node:fs";
import zlib from "node:zlib";

export function readPng(file) {
  const buf = fs.readFileSync(file);
  let p = 8;
  let w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString("ascii", p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  if (bitDepth !== 8) throw new Error("bit depth " + bitDepth + " unsupported");
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!ch) throw new Error("color type " + colorType + " unsupported");
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[pos++];
    const line = raw.subarray(pos, pos + stride); pos += stride;
    const cur = out.subarray(y * stride, y * stride + stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, (y - 1) * stride + stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      switch (filter) {
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: {
          const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
      }
      cur[i] = v & 255;
    }
  }
  return { width: w, height: h, channels: ch, data: out };
}

const img = readPng("reference/target-lowpoly.png");
console.log("image", img.width, img.height, "ch", img.channels);

// The equation block in the target sits around x 1120-1470, y 380-660 at 2752x1536.
const x0 = 1100, x1 = 1500, y0 = 380, y1 = 680;
const px = (x, y) => {
  const i = (y * img.width + x) * img.channels;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
};

// Find bright (near-white) ink and look at what is immediately around it.
let ink = 0;
let inkMin = [255, 255, 255], inkMax = [0, 0, 0];
const ring = []; // pixels 3-5px from ink
const far = [];  // pixels >12px from any ink, inside the box
const isInk = (x, y) => { const [r, g, b] = px(x, y); return r > 235 && g > 235 && b > 235; };
const mask = [];
for (let y = y0; y < y1; y++) {
  const row = [];
  for (let x = x0; x < x1; x++) row.push(isInk(x, y));
  mask.push(row);
}
const W = x1 - x0, H = y1 - y0;
const dist = new Int32Array(W * H).fill(9999);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mask[y][x]) dist[y * W + x] = 0;
// crude multi-pass chamfer
for (let it = 0; it < 24; it++) {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let d = dist[y * W + x];
    if (x > 0) d = Math.min(d, dist[y * W + x - 1] + 1);
    if (y > 0) d = Math.min(d, dist[(y - 1) * W + x] + 1);
    dist[y * W + x] = d;
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    let d = dist[y * W + x];
    if (x < W - 1) d = Math.min(d, dist[y * W + x + 1] + 1);
    if (y < H - 1) d = Math.min(d, dist[(y + 1) * W + x] + 1);
    dist[y * W + x] = d;
  }
}
const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const buckets = new Map();
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const d = dist[y * W + x];
  const key = d === 0 ? 0 : d <= 2 ? 2 : d <= 4 ? 4 : d <= 8 ? 8 : d <= 16 ? 16 : 32;
  const p = px(x0 + x, y0 + y);
  if (!buckets.has(key)) buckets.set(key, []);
  buckets.get(key).push(p);
  if (d === 0) { ink++; for (let i = 0; i < 3; i++) { inkMin[i] = Math.min(inkMin[i], p[i]); inkMax[i] = Math.max(inkMax[i], p[i]); } }
}
console.log("ink pixels", ink, "ink range", inkMin, inkMax);
for (const k of [0, 2, 4, 8, 16, 32]) {
  const arr = buckets.get(k) || [];
  if (!arr.length) continue;
  const mean = [0, 1, 2].map((i) => arr.reduce((s, p) => s + p[i], 0) / arr.length);
  console.log(`dist<=${String(k).padStart(2)}  n=${String(arr.length).padStart(6)}  mean rgb ${mean.map((v) => v.toFixed(1)).join(",")}  lum ${lum(mean).toFixed(1)}`);
}
