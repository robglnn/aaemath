/**
 * P36 round 3 — where, along the line from the body out to a claim's socket, does an accent stop
 * buying pixels?
 *
 * Removing three of the four shipped accents changes 0 pixels even though their sockets are in
 * frame and unoccluded, while the critic's diagnostic accent beside the body was worth 7,491. One
 * of those two facts is misleading and a sweep settles which: park a single accent at a series of
 * points from the body's own ground out to the claim's socket, and price each one with the same
 * zero-time A/B.
 *
 * usage: node review/measure/P36-r3-sweep.mjs
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
      const b = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, b);
      return b;
    };
    const diff = (a, b) => {
      let c = 0;
      let m = 0;
      for (let i = 0; i < a.length; i += 4) {
        const v = Math.max(
          Math.abs(a[i] - b[i]),
          Math.abs(a[i + 1] - b[i + 1]),
          Math.abs(a[i + 2] - b[i + 2])
        );
        if (v > 0) c++;
        if (v > m) m = v;
      }
      return { pixelsChanged: c, maxChannelDelta: m };
    };

    // clear the shipped accents so each sample is measured on its own
    const saved = new Map(L._accents);
    L._accents.clear();
    const base = snap();

    const body = window.__vs.probe("locomotion").position;
    const target = window.__vs.probe("mathresonance").claims.find((c) => c.id === "leaf9-share");
    const rows = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const x = body[0] + (target.socket[0] - body[0]) * t;
      const z = body[2] + (target.socket[2] - body[2]) * t;
      const g = col.groundAt(x, z, 500);
      const at = [x, (g.hit ? g.y : body[1]) + 1, z];
      L._accents.set("sweep", {
        object: null,
        position: new k.camera.position.constructor(at[0], at[1], at[2]),
        radius: 5,
        strength: 0.6,
        color: "crystal.hot",
      });
      const B = snap();
      rows.push({
        t,
        at: at.map((v) => +v.toFixed(2)),
        groundHit: !!g.hit,
        metresFromBody: +Math.hypot(at[0] - body[0], at[1] - body[1], at[2] - body[2]).toFixed(2),
        ...diff(base, B),
      });
      L._accents.delete("sweep");
      snap();
    }
    for (const [id, e] of saved) L._accents.set(id, e);
    return { body: body.map((v) => +v.toFixed(2)), socket: target.socket, rows };
  });
  console.log(JSON.stringify(out, null, 2));
});
