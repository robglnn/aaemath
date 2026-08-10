/**
 * CRITIC-OWNED, round 2. Does `world:resonance` change a single pixel a player sees?
 *
 * The builder proves the signal arrives and the pool lights up. That is message passing. This asks
 * the only question that decides the piece: with the accents on and with the accents gone, is the
 * SHIPPED frame different? Four captures from ONE session so the camera, the clock and the claims
 * are identical:
 *
 *   A   accents live, settled
 *   A2  accents live, +0.5 s        (control: how much the frame moves on its own)
 *   B   accents removed, +0.5 s     (treatment)
 *   D   diagnostic: one accent parked 1.2 m above the ground the player is standing on — NOT the
 *       shipped path, and never counted as wiring evidence. It separates "wired, composition wrong"
 *       from "wired to a shader that discards it".
 *
 * usage: node review/measure/_critic-P36-r2-pixels.mjs
 */
import { openGame, ROOT } from "../../tools/lib/session.mjs";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const OUT = "review/shots/_critic-p36";
fs.mkdirSync(path.join(ROOT, OUT), { recursive: true });

const shots = {};

await openGame({ width: 960, height: 540 }, async (d) => {
  const boot = await d.report();
  if (boot.fatal || !boot.ready) {
    console.log("BOOT FAILED", boot.fatal ?? "not ready");
    process.exitCode = 1;
    return;
  }

  await d.play(2);

  const before = await d.probe("lighting");
  console.log("=== probe('lighting').accents, shipped boot, no signal emitted by this script ===");
  console.log(JSON.stringify(before?.accents));

  // ---- how close is ANY renderable surface to a lit accent? (the builder only cast straight down)
  const geo = await d.run(() => {
    const THREE = window.__vs.three ?? null;
    const k = window.__vs.kernel;
    const lights = [];
    k.scene.traverse((o) => {
      if (o.isPointLight && /^vs\.accent\./.test(o.name ?? "") && o.intensity > 0) lights.push(o);
    });
    const meshes = [];
    k.scene.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      if (/sky|Sky|dome|glyph|tex|Tex/.test(o.name ?? "")) return;
      if (!o.geometry?.boundingBox) o.geometry?.computeBoundingBox?.();
      if (!o.geometry?.boundingBox) return;
      meshes.push(o);
    });
    const rows = [];
    for (const L of lights) {
      const p = L.getWorldPosition(new L.position.constructor());
      let best = Infinity;
      let bestName = null;
      for (const m of meshes) {
        const bb = m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld);
        const cx = Math.max(bb.min.x, Math.min(p.x, bb.max.x));
        const cy = Math.max(bb.min.y, Math.min(p.y, bb.max.y));
        const cz = Math.max(bb.min.z, Math.min(p.z, bb.max.z));
        const dsq = (cx - p.x) ** 2 + (cy - p.y) ** 2 + (cz - p.z) ** 2;
        if (dsq < best) {
          best = dsq;
          bestName = m.name || m.type;
        }
      }
      rows.push({
        light: L.name,
        falloff: L.distance,
        intensity: +L.intensity.toFixed(4),
        nearestMeshBoundsMetres: +Math.sqrt(best).toFixed(2),
        nearestMesh: bestName,
        meshesConsidered: meshes.length,
      });
    }
    return rows;
  });
  console.log("\n=== nearest renderable mesh (bounding-box distance) to each lit accent ===");
  for (const r of geo) console.log(JSON.stringify(r));

  shots.A = await d.shoot(`${OUT}/A-accents-on.png`);
  await d.play(0.5);
  shots.A2 = await d.shoot(`${OUT}/A2-accents-on-plus.png`);

  // ---- treatment: take the accents away, leave everything else alone
  const killed = await d.run(() => {
    const L = window.__vs.kernel.get("lighting");
    const had = L._accents.size;
    L.addAccent = () => {};
    L._accents.clear();
    return { had, now: L._accents.size };
  });
  await d.play(0.5);
  const after = await d.probe("lighting");
  console.log("\n=== accents removed in place ===", JSON.stringify(killed), JSON.stringify(after?.accents));
  shots.B = await d.shoot(`${OUT}/B-accents-off.png`);

  // ---- diagnostic only: can this rig light anything at all, at any distance?
  const diag = await d.run(() => {
    const k = window.__vs.kernel;
    const L = k.get("lighting");
    const col = k.get("collision");
    const pos = window.__vs.probe("locomotion")?.position ?? [0, 0, 0];
    const g = col.groundAt(pos[0], pos[2]);
    const at = [pos[0] + 1.5, (g.hit ? g.y : pos[1]) + 1.2, pos[2] + 1.5];
    delete L.addAccent; // restore the prototype method
    L.addAccent("critic-diag", at, { radius: 6, strength: 1 });
    return { at, ground: g.hit ? +g.y.toFixed(2) : null, player: pos };
  });
  await d.play(0.5);
  const diagProbe = await d.probe("lighting");
  console.log("\n=== DIAGNOSTIC (not the shipped path): accent parked on the ground beside the body ===");
  console.log(JSON.stringify(diag), JSON.stringify(diagProbe?.accents));
  shots.D = await d.shoot(`${OUT}/D-diagnostic-near.png`);

  const rep = await d.report();
  console.log("\nerrors:", rep.errors.length, "| warnings:", rep.warnings.length);
});

// ------------------------------------------------------------------ decode and diff, out of process
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 64, height: 64 } });
await page.setContent("<canvas id=c></canvas>");
const load = async (p) => {
  const b64 = fs.readFileSync(path.join(ROOT, p)).toString("base64");
  return page.evaluate(async (b) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b;
    await img.decode();
    const c = document.getElementById("c");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.clearRect(0, 0, img.width, img.height);
    g.drawImage(img, 0, 0);
    return { w: img.width, h: img.height, data: [...g.getImageData(0, 0, img.width, img.height).data] };
  }, b64);
};
const imgs = {};
for (const [k, p] of Object.entries(shots)) imgs[k] = await load(p);
await browser.close();

function diff(a, b) {
  let changed = 0;
  let maxd = 0;
  let sum = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const d = Math.max(
      Math.abs(a.data[i] - b.data[i]),
      Math.abs(a.data[i + 1] - b.data[i + 1]),
      Math.abs(a.data[i + 2] - b.data[i + 2])
    );
    if (d > 0) changed++;
    if (d > maxd) maxd = d;
    sum += d;
  }
  const px = a.data.length / 4;
  return {
    pixelsChanged: changed,
    percentChanged: +((100 * changed) / px).toFixed(4),
    maxChannelDelta: maxd,
    meanChannelDelta: +(sum / px).toFixed(4),
  };
}

console.log("\n=== PIXEL VERDICT (shipped frame, 960x540) ===");
console.log("control  A  vs A2 (accents on both) :", JSON.stringify(diff(imgs.A, imgs.A2)));
console.log("treatment A2 vs B  (accents removed) :", JSON.stringify(diff(imgs.A2, imgs.B)));
console.log("diagnostic B vs D  (near accent, NOT shipped path) :", JSON.stringify(diff(imgs.B, imgs.D)));
