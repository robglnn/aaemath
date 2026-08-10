// Scratch: crop a region out of a PNG so it can be looked at closely.
import fs from "node:fs";
import zlib from "node:zlib";
import { readPng } from "./_scratch-ref.mjs";

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function writePng(file, w, h, rgb) {
  const stride = w * 3;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]));
}

const [, , src, out, sx, sy, sw, sh, scale = "1"] = process.argv;
const img = readPng(src);
const X = +sx, Y = +sy, W = +sw, H = +sh, S = +scale;
const dst = Buffer.alloc(W * S * H * S * 3);
for (let y = 0; y < H * S; y++) {
  for (let x = 0; x < W * S; x++) {
    const si = ((Y + Math.floor(y / S)) * img.width + (X + Math.floor(x / S))) * img.channels;
    const di = (y * W * S + x) * 3;
    dst[di] = img.data[si]; dst[di + 1] = img.data[si + 1]; dst[di + 2] = img.data[si + 2];
  }
}
writePng(out, W * S, H * S, dst);
console.log("wrote", out, W * S, "x", H * S);
