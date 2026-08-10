/**
 * P36 round 3 — does `world:resonance` buy any pixels, and where?
 *
 * Round 2 closed the seam as a string pairing: the signal was emitted, heard, and lit four real
 * PointLights that illuminated nothing, because a claim stands 10.7-21.2 m above the ground and
 * §5.4 caps an accent at 6 m. The critic's zero-time A/B priced that at 0 of 518,400 pixels.
 *
 * This is the same instrument, per accent, plus the reach cast that says whether a surface is
 * inside each falloff at all:
 *
 *   control      two renders, nothing touched            -> the renderer's noise floor (must be 0)
 *   treatment    every accent removed in place           -> what the seam is worth in pixels
 *   per accent   one accent removed in place             -> where those pixels come from
 *   reach        26 sphere casts from each accent        -> is there a surface inside the falloff
 *
 * Everything happens with the realtime loop halted and `advance(0)` between reads, so the only
 * difference between two frames is the thing under test.
 *
 * usage: node review/measure/P36-r3.mjs
 */
import { openGame } from "../../tools/lib/session.mjs";

await openGame({ width: 960, height: 540 }, async (d) => {
  const boot = await d.report();
  if (boot.fatal || !boot.ready) {
    console.log("BOOT FAILED", boot.fatal ?? "not ready");
    process.exitCode = 1;
    return;
  }
  await d.play(2);

  const out = await d.run(() => {
    const k = window.__vs.kernel;
    k.halt();
    const L = k.get("lighting");
    const col = k.get("collision");
    const gl = k.renderer.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;

    const snap = () => {
      k.advance(0);
      const buf = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      return buf;
    };
    const diff = (a, b) => {
      let changed = 0;
      let maxd = 0;
      let maxAt = -1;
      let sum = 0;
      let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
      for (let i = 0; i < a.length; i += 4) {
        const m = Math.max(
          Math.abs(a[i] - b[i]),
          Math.abs(a[i + 1] - b[i + 1]),
          Math.abs(a[i + 2] - b[i + 2])
        );
        if (m > maxd) maxAt = i;
        if (m > 0) {
          changed++;
          const p = i / 4;
          const x = p % w;
          const y = Math.floor(p / w);
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
        if (m > maxd) maxd = m;
        sum += m;
      }
      const px = a.length / 4;
      return {
        pixelsChanged: changed,
        percentChanged: +((100 * changed) / px).toFixed(4),
        maxChannelDelta: maxd,
        meanChannelDelta: +(sum / px).toFixed(5),
        // The brightest changed pixel, in both frames. §5.4's cap is stated as an absolute facet
        // luminance, so the delta alone cannot say whether an accent is marking or lighting.
        brightest:
          maxAt >= 0
            ? { withAccents: [a[maxAt], a[maxAt + 1], a[maxAt + 2]], without: [b[maxAt], b[maxAt + 1], b[maxAt + 2]] }
            : null,
        // y measured from the BOTTOM of the drawing buffer, which is how readPixels indexes.
        box: changed ? [minX, minY, maxX, maxY] : null,
      };
    };

    // --- where the emitter says each claim's light goes
    const resonance = window.__vs.probe("mathresonance");
    const lighting = window.__vs.probe("lighting")?.accents;

    // --- is there anything inside each falloff, in view or not
    const dirs = [];
    for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) {
      if (!x && !y && !z) continue;
      const l = Math.hypot(x, y, z);
      dirs.push([x / l, y / l, z / l]);
    }
    const reach = [];
    k.scene.traverse((o) => {
      if (!o.isPointLight || !/^vs\.accent\./.test(o.name ?? "") || o.intensity <= 0) return;
      const p = o.getWorldPosition(new o.position.constructor());
      let nearest = Infinity;
      let hits = 0;
      for (const [dx, dy, dz] of dirs) {
        const r = col.sphereCast({ x: p.x, y: p.y, z: p.z }, { x: dx, y: dy, z: dz }, 0.05, o.distance);
        if (r?.hit) {
          hits++;
          if (r.distance < nearest) nearest = r.distance;
        }
      }
      reach.push({
        light: o.name,
        falloff: o.distance,
        at: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)],
        directionsHit: hits,
        ofDirections: dirs.length,
        nearestSurfaceMetres: nearest === Infinity ? null : +nearest.toFixed(2),
      });
    });

    // --- the A/B
    const A0 = snap();
    const A1 = snap();
    const ids = [...L._accents.keys()];
    const saved = new Map(L._accents);

    const perAccent = [];
    for (const id of ids) {
      L._accents.delete(id);
      const B = snap();
      perAccent.push({ id, ...diff(A1, B) });
      L._accents.set(id, saved.get(id));
      snap(); // put the pool back before the next measurement
    }

    const realAdd = L.addAccent;
    L.addAccent = () => {};
    L._accents.clear();
    const B = snap();
    const treatment = diff(A1, B);
    L.addAccent = realAdd;
    for (const [id, e] of saved) L._accents.set(id, e);
    snap();

    return {
      size: [w, h],
      simTime: k.simTime,
      resonance,
      lighting,
      reach,
      control: diff(A0, A1),
      treatment,
      perAccent,
    };
  });

  console.log(JSON.stringify(out, null, 2));
  const rep = await d.report();
  console.log("errors:", rep.errors.length, "| warnings:", rep.warnings.length);
});
