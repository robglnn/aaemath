/**
 * CRITIC-OWNED, round 2, second attempt — the first one was defeated by the frame moving on its
 * own (67% of pixels differ between two captures 0.5 s apart, because the app keeps its realtime
 * animation loop while a SwiftShader screenshot takes a minute).
 *
 * This halts the loop and renders with dt = 0, so nothing in the world advances between renders and
 * the ONLY difference between two frames is the thing under test. Same session, same camera, same
 * sim time, pixels read straight off the drawing buffer in the same JS task as the render.
 *
 *   control    two renders, accents live       -> renderer noise floor
 *   treatment  accents removed in place        -> what `world:resonance` is worth in pixels
 *   diagnostic one accent parked on the ground beside the body (NOT the shipped path) -> does the
 *              receiving rig light anything at all when something is inside the falloff
 *
 * usage: node review/measure/_critic-P36-r2-frame.mjs
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
    k.halt(); // stop the realtime loop: from here time only moves when this script says so
    const L = k.get("lighting");
    const gl = k.renderer.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;

    const snap = () => {
      k.advance(0); // renders; dt 0 so no system integrates anything
      const buf = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      return buf;
    };
    const diff = (a, b) => {
      let changed = 0;
      let maxd = 0;
      let sum = 0;
      let brighter = 0;
      for (let i = 0; i < a.length; i += 4) {
        const dr = a[i] - b[i];
        const dg = a[i + 1] - b[i + 1];
        const db = a[i + 2] - b[i + 2];
        const m = Math.max(Math.abs(dr), Math.abs(dg), Math.abs(db));
        if (m > 0) changed++;
        if (m > maxd) maxd = m;
        if (dr + dg + db > 0) brighter++;
        sum += m;
      }
      const px = a.length / 4;
      return {
        pixelsChanged: changed,
        percentChanged: +((100 * changed) / px).toFixed(4),
        maxChannelDelta: maxd,
        meanChannelDelta: +(sum / px).toFixed(5),
        pixelsBrighterInA: brighter,
      };
    };

    const accentState = () => {
      const rows = [];
      k.scene.traverse((o) => {
        if (o.isPointLight && /^vs\.accent\./.test(o.name ?? "")) {
          rows.push({ n: o.name, i: +o.intensity.toFixed(3), d: o.distance });
        }
      });
      return rows;
    };

    const A0 = snap();
    const A1 = snap();
    const accentsOn = accentState();

    const had = L._accents.size;
    const realAdd = L.addAccent;
    L.addAccent = () => {};
    L._accents.clear();
    const B = snap();
    const accentsOff = accentState();

    // restore, then the diagnostic: put one accent where a surface definitely IS
    L.addAccent = realAdd;
    const col = k.get("collision");
    const pos = window.__vs.probe("locomotion")?.position ?? [0, 0, 0];
    const g = col.groundAt(pos[0] + 1.5, pos[2] + 1.5);
    const at = [pos[0] + 1.5, (g.hit ? g.y : pos[1]) + 1.0, pos[2] + 1.5];
    L.addAccent("critic-diag", at, { radius: 6, strength: 1 });
    const D = snap();
    const accentsDiag = accentState();

    return {
      size: [w, h],
      simTime: k.simTime,
      accentsOn,
      accentsOff,
      accentsDiag,
      had,
      diagAt: at.map((v) => +v.toFixed(2)),
      diagGroundHit: !!g.hit,
      control: diff(A0, A1),
      treatment: diff(A1, B),
      diagnostic: diff(B, D),
    };
  });

  console.log(JSON.stringify(out, null, 2));
  const rep = await d.report();
  console.log("errors:", rep.errors.length, "| warnings:", rep.warnings.length);
});
