// Minimal, dependency-free PNG reader for P02's measurement scripts.
//
// The auditor's census path decodes through a browser canvas. Everything that
// judges a TEMPORAL claim decodes here instead, so a motion number and a census
// number never share a decoder bug. Handles the two things this project ever
// produces: 8-bit truecolour (type 2) and 8-bit truecolour+alpha (type 6),
// non-interlaced, with all five scanline filters.

import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';

export function readPNG(file) {
  const buf = readFileSync(file);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`not a PNG: ${file}`);
  let p = 8, W = 0, H = 0, depth = 0, type = 0, interlace = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const tag = buf.toString('latin1', p + 4, p + 8);
    const body = buf.subarray(p + 8, p + 8 + len);
    if (tag === 'IHDR') {
      W = body.readUInt32BE(0); H = body.readUInt32BE(4);
      depth = body[8]; type = body[9]; interlace = body[12];
    } else if (tag === 'IDAT') idat.push(body);
    else if (tag === 'IEND') break;
    p += 12 + len;
  }
  if (depth !== 8) throw new Error(`unsupported bit depth ${depth} in ${file}`);
  if (type !== 2 && type !== 6) throw new Error(`unsupported colour type ${type} in ${file}`);
  if (interlace !== 0) throw new Error(`interlaced PNG unsupported: ${file}`);

  const bpp = type === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = W * bpp;
  const out = Buffer.allocUnsafe(H * stride);
  let q = 0;
  for (let y = 0; y < H; y++) {
    const f = raw[q++];
    const line = raw.subarray(q, q + stride); q += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev ? prev[i] : 0;
      const c = (prev && i >= bpp) ? prev[i - bpp] : 0;
      let v = line[i];
      switch (f) {
        case 0: break;
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: {
          const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
          v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`bad filter ${f} on row ${y} of ${file}`);
      }
      cur[i] = v & 255;
    }
  }
  return { width: W, height: H, bpp, data: out };
}

const LUT = new Float32Array(256);
for (let i = 0; i < 256; i++) { const v = i / 255; LUT[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
export const SRGB_TO_LINEAR = LUT;

/** Rec.709 relative luminance of an 8-bit sRGB triplet. Matches palette.json. */
export const lum = (r, g, b) => 0.2126 * LUT[r] + 0.7152 * LUT[g] + 0.0722 * LUT[b];

/** [hue 0..360, saturation 0..1, value 0..1] from 8-bit sRGB. */
export function hsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d !== 0) {
    if (mx === r) h = 60 * (((g - b) / d) % 6);
    else if (mx === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
    if (h < 0) h += 360;
  }
  return [h, mx === 0 ? 0 : d / mx, mx / 255];
}

/** Whole-image luminance plane as Float32Array, row-major. */
export function lumPlane(img) {
  const { width: W, height: H, bpp, data } = img;
  const out = new Float32Array(W * H);
  for (let i = 0, j = 0; i < W * H; i++, j += bpp) out[i] = lum(data[j], data[j + 1], data[j + 2]);
  return out;
}

export const px = (img, x, y) => {
  const i = (y * img.width + x) * img.bpp;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
};

export const hex = (r, g, b) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0').toUpperCase()).join('');
