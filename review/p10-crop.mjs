// P10 scratch: crop (and optionally scale) a PNG so a builder can LOOK at a region closely.
// Dependency-free encoder: zlib + the four chunks a viewer actually needs.
import { readPNG, px } from "./p02-png.mjs";
import zlib from "node:zlib";
import fs from "node:fs";

function crc32(buf) {
  let c,
    table = crc32.t;
  if (!table) {
    table = crc32.t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  c = -1;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(tag, body) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const td = Buffer.concat([Buffer.from(tag, "latin1"), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export function writePNG(file, w, h, rgb) {
  const stride = w * 3;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  fs.mkdirSync(require$dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
      chunk("IEND", Buffer.alloc(0)),
    ])
  );
}
function require$dirname(p) {
  return p.replace(/[\\/][^\\/]*$/, "") || ".";
}

// CLI: node review/p10-crop.mjs <src> <out> x0 y0 x1 y1 [outW]
const [src, out, ...rest] = process.argv.slice(2);
if (src) {
  const img = readPNG(src);
  const [fx0, fy0, fx1, fy1] = rest.slice(0, 4).map(Number);
  const outW = Number(rest[4] || 0);
  const x0 = Math.round(fx0 * img.width),
    y0 = Math.round(fy0 * img.height);
  const x1 = Math.round(fx1 * img.width),
    y1 = Math.round(fy1 * img.height);
  const cw = x1 - x0,
    ch = y1 - y0;
  const scale = outW ? outW / cw : 1;
  const W = Math.max(1, Math.round(cw * scale)),
    H = Math.max(1, Math.round(ch * scale));
  const buf = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const sx = Math.min(img.width - 1, x0 + Math.floor(x / scale));
      const sy = Math.min(img.height - 1, y0 + Math.floor(y / scale));
      const [r, g, b] = px(img, sx, sy);
      const i = (y * W + x) * 3;
      buf[i] = r;
      buf[i + 1] = g;
      buf[i + 2] = b;
    }
  writePNG(out, W, H, buf);
  console.log(`${out} ${W}x${H} from ${src} [${x0},${y0}]-[${x1},${y1}]`);
}
