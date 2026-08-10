/** Crop + nearest-neighbour zoom a capture so a critic can read facets. */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const [, , src, dst, cropArg, zoomArg] = process.argv;
const [cx, cy, cw, ch] = cropArg.split(",").map(Number);
const zoom = Number(zoomArg || 3);
const b64 = fs.readFileSync(path.resolve(src)).toString("base64");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: cw * zoom, height: ch * zoom } });
await page.setContent(`<style>html,body{margin:0;padding:0;overflow:hidden}canvas{display:block;image-rendering:pixelated}</style><canvas id=c width=${cw * zoom} height=${ch * zoom}></canvas>`);
await page.evaluate(async ({ b64, cx, cy, cw, ch, zoom }) => {
  const img = new Image();
  img.src = "data:image/png;base64," + b64;
  await img.decode();
  const g = document.getElementById("c").getContext("2d");
  g.imageSmoothingEnabled = false;
  g.drawImage(img, cx, cy, cw, ch, 0, 0, cw * zoom, ch * zoom);
}, { b64, cx, cy, cw, ch, zoom });
await page.locator("#c").screenshot({ path: path.resolve(dst) });
await browser.close();
console.log("wrote", dst, cw * zoom, "x", ch * zoom);
