import { readPNG, writePNG, crop, scale } from './p09-imglib.mjs';
const img = readPNG(process.argv[2]);
console.log('size', img.width, img.height);
const [x,y,w,h,s] = process.argv.slice(4).map(Number);
const c = crop(img, x, y, w, h);
writePNG(process.argv[3], scale(c, Math.round(w*s), Math.round(h*s)));
