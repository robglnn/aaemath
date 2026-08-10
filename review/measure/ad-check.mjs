// Is D actually screen-right?
//
// The binding table is not the answer: bindings.js maps KeyD to move.x = +1, but "+x" only means
// "right" if the controller projects it onto the camera's right vector with the correct sign. This
// drives the real game, holds each key, and dots the resulting displacement against the camera's
// own right vector. Positive dot for D and negative for A is correct; the reverse is the bug.
import { openGame } from "../../tools/lib/session.mjs";

const read = (d) =>
  d.run(() => {
    const p = window.__vs.probe("locomotion") || {};
    const c = window.__vs.probe("camera") || {};
    const k = window.__vs.kernel;
    // Camera right in world space, straight off the camera matrix.
    const m = k.camera.matrixWorld.elements;
    return {
      pos: p.position || p.pos || null,
      camRight: [m[0], m[1], m[2]],
      camPos: [m[12], m[13], m[14]],
    };
  });

await openGame({ width: 900, height: 520 }, async (d) => {
  await d.play(1.2);

  const out = {};
  for (const key of ["KeyD", "KeyA"]) {
    const before = await read(d);
    await d.hold(key, 1.0);
    await d.play(0.1);
    const after = await read(d);

    if (!before.pos || !after.pos) {
      console.log(JSON.stringify({ error: "locomotion probe has no position", before, after }, null, 2));
      return;
    }
    const dx = after.pos[0] - before.pos[0];
    const dz = after.pos[2] - before.pos[2];
    const r = before.camRight;
    const dot = dx * r[0] + dz * r[2];
    out[key] = {
      displacement: [Number(dx.toFixed(3)), Number(dz.toFixed(3))],
      distance: Number(Math.hypot(dx, dz).toFixed(3)),
      dotWithCameraRight: Number(dot.toFixed(3)),
      reads: dot > 0.05 ? "SCREEN-RIGHT" : dot < -0.05 ? "SCREEN-LEFT" : "no lateral movement",
    };
  }

  const verdict =
    out.KeyD?.reads === "SCREEN-RIGHT" && out.KeyA?.reads === "SCREEN-LEFT"
      ? "CORRECT — D moves right, A moves left"
      : out.KeyD?.reads === "SCREEN-LEFT" && out.KeyA?.reads === "SCREEN-RIGHT"
        ? "REVERSED — D moves left, A moves right. Flip the sign where move.x meets the camera basis."
        : "INCONCLUSIVE — see the per-key numbers";

  console.log(JSON.stringify({ ...out, verdict }, null, 2));
});
