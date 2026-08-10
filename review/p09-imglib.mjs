// P09 image helpers: a minimal PNG writer plus crop / scale / compose, so the builder and any
// critic can put our render next to reference/target-lowpoly.png in one file and look at both.
// Decoding is reused from review/p02-png.mjs; nothing here needs a dependency.
import zlib from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { readPNG } from './p02-png.mjs';

export { readPNG };

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return (buf) => {
    let c = ~0;
    for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return ~c >>> 0;
  };
})();

function chunk(tag, body) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const td = Buffer.concat([Buffer.from(tag, 'latin1'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(CRC(td));
  return Buffer.concat([len, td, crc]);
}

/** img = {width, height, bpp, data} with bpp 3 or 4. Writes 8-bit truecolour PNG. */
export function writePNG(file, img) {
  const { width: W, height: H, bpp, data } = img;
  const raw = Buffer.alloc(H * (1 + W * 3));
  let q = 0;
  for (let y = 0; y < H; y++) {
    raw[q++] = 0;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * bpp;
      raw[q++] = data[i];
      raw[q++] = data[i + 1];
      raw[q++] = data[i + 2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]));
  return file;
}

export function blank(W, H, rgb = [0, 0, 0]) {
  const data = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) { data[i * 3] = rgb[0]; data[i * 3 + 1] = rgb[1]; data[i * 3 + 2] = rgb[2]; }
  return { width: W, height: H, bpp: 3, data };
}

export function crop(img, x0, y0, w, h) {
  const out = blank(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.min(img.width - 1, Math.max(0, x0 + x));
    const sy = Math.min(img.height - 1, Math.max(0, y0 + y));
    const s = (sy * img.width + sx) * img.bpp;
    const d = (y * w + x) * 3;
    out.data[d] = img.data[s]; out.data[d + 1] = img.data[s + 1]; out.data[d + 2] = img.data[s + 2];
  }
  return out;
}

/** Box-filtered resize — good enough to judge silhouette and value at thumbnail size. */
export function scale(img, W, H) {
  const out = blank(W, H);
  for (let y = 0; y < H; y++) {
    const sy0 = Math.floor((y * img.height) / H);
    const sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) * img.height) / H));
    for (let x = 0; x < W; x++) {
      const sx0 = Math.floor((x * img.width) / W);
      const sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) * img.width) / W));
      let r = 0, g = 0, b = 0, n = 0;
      for (let sy = sy0; sy < sy1; sy++) for (let sx = sx0; sx < sx1; sx++) {
        const s = (sy * img.width + sx) * img.bpp;
        r += img.data[s]; g += img.data[s + 1]; b += img.data[s + 2]; n++;
      }
      const d = (y * W + x) * 3;
      out.data[d] = r / n; out.data[d + 1] = g / n; out.data[d + 2] = b / n;
    }
  }
  return out;
}

export function paste(dst, src, x0, y0) {
  for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) {
    const dy = y0 + y, dx = x0 + x;
    if (dy < 0 || dy >= dst.height || dx < 0 || dx >= dst.width) continue;
    const s = (y * src.width + x) * src.bpp;
    const d = (dy * dst.width + dx) * 3;
    dst.data[d] = src.data[s]; dst.data[d + 1] = src.data[s + 1]; dst.data[d + 2] = src.data[s + 2];
  }
  return dst;
}

/** Stack images vertically at a common width. */
export function stack(images, width, gap = 8, bg = [16, 16, 18]) {
  const scaled = images.map((im) => scale(im, width, Math.round((im.height / im.width) * width)));
  const H = scaled.reduce((a, im) => a + im.height, 0) + gap * (scaled.length - 1);
  const out = blank(width, H, bg);
  let y = 0;
  for (const im of scaled) { paste(out, im, 0, y); y += im.height + gap; }
  return out;
}
