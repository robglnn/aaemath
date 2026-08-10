#!/usr/bin/env node
// Throwaway: crop + upscale a region of a PNG so it can be looked at, and print pixel stats.
import fs from "node:fs";
import zlib from "node:zlib";

function readPng(file) {
  const buf = fs.readFileSync(file);
  let p = 8, w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString("ascii", p + 4, p + 8);
    const cd = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") { w = cd.readUInt32BE(0); h = cd.readUInt32BE(4); bitDepth = cd[8]; colorType = cd[9]; }
    else if (type === "IDAT") idat.push(cd);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[pos++];
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
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
        case 4: { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; break; }
      }
      cur[i] = v & 255;
    }
  }
  return { width: w, height: h, channels: ch, data: out };
}
function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function pngChunk(t, b) { const l = Buffer.alloc(4); l.writeUInt32BE(b.length); const td = Buffer.concat([Buffer.from(t, "ascii"), b]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); }
function writePng(file, w, h, rgb) {
  const stride = w * 3; const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (stride + 1)] = 0; rgb.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", ihdr), pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })), pngChunk("IEND", Buffer.alloc(0))]));
}

const [src, dst, X0, Y0, X1, Y1, SC] = process.argv.slice(2);
const img = readPng(src);
const x0 = Math.max(0, Math.round(Number(X0))), y0 = Math.max(0, Math.round(Number(Y0)));
const x1 = Math.min(img.width, Math.round(Number(X1))), y1 = Math.min(img.height, Math.round(Number(Y1)));
const s = Math.max(1, Math.round(Number(SC) || 1));
const w = (x1 - x0) * s, h = (y1 - y0) * s;
const out = Buffer.alloc(w * h * 3);
let ink = 0, maxL = 0;
for (let y = 0; y < y1 - y0; y++) for (let x = 0; x < x1 - x0; x++) {
  const i = ((y0 + y) * img.width + (x0 + x)) * img.channels;
  const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (L > maxL) maxL = L;
  if (Math.min(r, g, b) >= 232 && Math.max(r, g, b) - Math.min(r, g, b) <= 14) ink++;
  for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) {
    const di = ((y * s + dy) * w + (x * s + dx)) * 3;
    out[di] = r; out[di + 1] = g; out[di + 2] = b;
  }
}
writePng(dst, w, h, out);
console.log(JSON.stringify({ src, box: [x0, y0, x1, y1], inkPx: ink, maxLuminance: Number(maxL.toFixed(1)) }));
