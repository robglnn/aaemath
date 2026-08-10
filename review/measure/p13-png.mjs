// Minimal PNG reader for P13's measurements.
//
// Playwright writes 8-bit non-interlaced PNGs (colour type 6 = RGBA, occasionally 2 = RGB), which
// is a small enough subset that decoding it here beats taking a dependency: the whole point of the
// measure script is that a critic can run it from a clean checkout with nothing installed but what
// the repo already has.

import fs from "node:fs";
import zlib from "node:zlib";

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export function readPng(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`${file} is not a PNG`);
  let off = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colour = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colour = data[9];
      if (data[12] !== 0) throw new Error("interlaced PNG not supported");
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    off += 12 + len;
  }
  if (depth !== 8) throw new Error(`unsupported bit depth ${depth}`);
  const ch = CHANNELS[colour];
  if (!ch) throw new Error(`unsupported colour type ${colour}`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const out = Buffer.alloc(height * stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const line = raw.subarray(p, p + stride);
    p += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      switch (filter) {
        case 1:
          v += a;
          break;
        case 2:
          v += b;
          break;
        case 3:
          v += (a + b) >> 1;
          break;
        case 4: {
          const pa = Math.abs(b - c);
          const pb = Math.abs(a - c);
          const pc = Math.abs(a + b - 2 * c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
        default:
          break;
      }
      cur[i] = v & 0xff;
    }
  }
  return { width, height, channels: ch, data: out };
}

/** Rec.709 relative luminance of an sRGB triplet, in linear light. */
export function luminance(r, g, b) {
  const f = (v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** HSV with hue in degrees. Hue is never rounded — a mask predicate tests the float. */
export function hsv(r, g, b) {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const d = max - min;
  let h = 0;
  if (d > 1e-9) {
    if (max === rr) h = ((gg - bb) / d) % 6;
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max <= 0 ? 0 : d / max, v: max };
}

/** Walk every pixel of a box given in fractions of the frame. */
export function forBox(img, box, fn) {
  const { width, height, channels, data } = img;
  const x0 = Math.max(0, Math.floor(box[0] * width));
  const y0 = Math.max(0, Math.floor(box[1] * height));
  const x1 = Math.min(width, Math.ceil(box[2] * width));
  const y1 = Math.min(height, Math.ceil(box[3] * height));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * channels;
      fn(data[i], data[i + 1], data[i + 2], x, y);
    }
  }
  return (x1 - x0) * (y1 - y0);
}

/** Count pixels in a box passing a predicate on (r,g,b,hsv,Y). */
export function census(img, box, pred) {
  let n = 0;
  const total = forBox(img, box, (r, g, b) => {
    if (pred(r, g, b, hsv(r, g, b), luminance(r, g, b))) n++;
  });
  return { n, total, share: total ? n / total : 0 };
}

/** Per-channel median of the pixels in a box passing a predicate. */
export function median(img, box, pred = () => true) {
  const R = [];
  const G = [];
  const B = [];
  forBox(img, box, (r, g, b) => {
    if (!pred(r, g, b, hsv(r, g, b), luminance(r, g, b))) return;
    R.push(r);
    G.push(g);
    B.push(b);
  });
  if (!R.length) return null;
  const mid = (a) => {
    a.sort((x, y) => x - y);
    return a[a.length >> 1];
  };
  const r = mid(R);
  const g = mid(G);
  const b = mid(B);
  return { r, g, b, n: R.length, hex: `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()}`, Y: luminance(r, g, b) };
}
