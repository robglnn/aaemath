// P09 framing sheet. Boots the game once and captures every framing this piece has to answer
// for, driving a free camera through `eval` so a whole round of composition review costs one
// browser launch instead of eight.
//
//   node review/p09-shots.mjs [--out=review/shots/p09/r6] [--width=1280] [--height=720]
import fs from "node:fs";
import path from "node:path";
import { openGame, arg, ROOT } from "../tools/lib/session.mjs";

const OUT = arg("out", "review/shots/p09/round");
const W = Number(arg("width", "1280"));
const H = Number(arg("height", "720"));
const ONLY = arg("only", null);

const SHOTS = [
  // id, eye (leaf space aX,aZ,lift), look-at (leaf space aX,aZ,y-offset), fov
  ["01-arrival", [-216, 10, 1.75], [140, 26, -12], 62],
  ["02-arrival-low", [-208, -4, 1.75], [200, 40, -20], 62],
  ["03-leaf-aerial", [-470, -60, 300], [30, 10, -10], 55],
  ["04-standing-house", [-150, -50, 14], [-88, -66, 4], 55],
  ["05-ravine", [96, 20, 12], [230, 22, -14], 60],
  ["06-certainty-field", [176, 96, 26], [286, -40, 2], 60],
  ["07-head-bowl", [-236, 26, 12], [-310, 36, 4], 60],
  ["08-crest", [-120, 60, 26], [-250, -120, 20], 60],
  ["09-down-leaf-far", [-40, 6, 30], [330, 40, -14], 55],
  ["10-carry-low", [-120, -12, 12], [40, -40, -6], 60],
  ["11-carry-uphill", [40, 40, 14], [-150, 20, 6], 60],
];

const W2 = (aX, aZ) => [aZ, -aX];

await openGame({ width: W, height: H }, async (d) => {
  // Other agents are editing this repo while this runs, and every save triggers a Vite reload
  // that destroys the execution context mid-capture. Re-settle before every framing.
  const settle = async () => {
    await d.page.waitForFunction(() => window.__vs && (window.__vs.ready || window.__vs.fatal), { timeout: 90000 });
    await d.play(0.8);
  };
  await settle();
  fs.mkdirSync(path.resolve(ROOT, OUT), { recursive: true });
  const rows = [];
  for (const [id, eye, look, fov] of SHOTS) {
    if (ONLY && !id.includes(ONLY)) continue;
    const [ex, ez] = W2(eye[0], eye[1]);
    const [lx, lz] = W2(look[0], look[1]);
    await settle();
    const info = await d.run(
      ([ex, ez, lift, lx, lz, ly, fov, free]) => {
        const K = window.__vs.kernel;
        if (free) {
          const cam = K.get("camera");
          if (cam) { cam.after = () => {}; cam.frame = () => {}; }
          const t = K.get("terrain");
          const gy = t.groundAt(ex, ez);
          const y = (Number.isFinite(gy) ? gy : 0) + lift;
          const ty = t.groundAt(lx, lz);
          K.camera.fov = fov;
          K.camera.updateProjectionMatrix();
          K.camera.position.set(ex, y, ez);
          K.camera.lookAt(lx, (Number.isFinite(ty) ? ty : 0) + ly, lz);
          K.camera.updateMatrixWorld();
          return { eye: [ex, Number(y.toFixed(1)), ez], groundFound: Number.isFinite(gy) };
        }
        return { eye: K.camera.position.toArray().map((v) => Number(v.toFixed(1))), groundFound: true };
      },
      [ex, ez, eye[2], lx, lz, look[2], fov, true]
    );
    await d.play(0.1);
    const file = path.join(OUT, `${id}.png`);
    // Headless software GL under a machine running several of these at once will occasionally
    // stall a screenshot past its timeout. That is a measurement failure, not a render failure,
    // so retry rather than losing the whole sheet.
    let shot = false;
    for (let attempt = 0; attempt < 3 && !shot; attempt++) {
      try {
        await d.shoot(file);
        shot = true;
      } catch (err) {
        process.stderr.write(`  retry ${id} (${attempt + 1}): ${String(err).split("\n")[0]}\n`);
        await d.play(0.2);
      }
    }
    process.stderr.write(`  ${shot ? "ok" : "FAILED"} ${id}\n`);
    rows.push({ id, file: shot ? file : null, ...info });
  }
  const report = await d.report();
  const problems = [];
  if (report.fatal) problems.push(String(report.fatal).split("\n")[0]);
  for (const e of report.errors ?? []) problems.push(e.split("\n")[0]);
  for (const e of d.consoleErrors) problems.push(e);
  console.log(JSON.stringify({ out: OUT, shots: rows, problems, stats: report.stats }, null, 2));
});
