#!/usr/bin/env node
/**
 * P04 capture rig. `review.mjs shot` is the right tool for a framing, but it cannot stop the
 * world on a specific *state* — and the frames that prove this piece are exactly the transient
 * ones: the apex of a jump, the instant of a hard landing, the middle of a slide. Each capture
 * below steps the fixed clock until its condition holds, pauses the kernel, shoots, resumes.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { openGame, has, ROOT } from "../tools/lib/session.mjs";

const DIR = "review/shots/p04";

const driveFn = ({ spawn, keys, maxSteps, until, yaw }) => {
  const vs = window.__vs;
  const S = vs.kernel.signals;
  const ALL = ["KeyW", "KeyA", "KeyS", "KeyD", "ShiftLeft", "Space"];
  const key = (c, d) =>
    window.dispatchEvent(new KeyboardEvent(d ? "keydown" : "keyup", { code: c, key: c, bubbles: true, cancelable: true }));
  for (const c of ALL) key(c, false);
  vs.pause(false);
  vs.advance(1 / 60);
  S.emit("player:spawn", { position: spawn, yaw: yaw ?? 0 });
  vs.advance(1 / 60);
  for (const c of keys) key(c, true);
  const test = new Function("p", `return ${until};`);
  let hit = false;
  for (let i = 0; i < maxSteps; i++) {
    vs.advance(1 / 60);
    const p = vs.probe("locomotion");
    if (i > 2 && test(p)) { hit = true; break; }
  }
  for (const c of ALL) key(c, false);
  const p = vs.probe("locomotion");
  vs.pause(true);
  return { hit, p, cam: vs.probe("camera") };
};

const SHOTS = [
  { file: "01-sprint.png", spawn: { x: 20, y: 1.04, z: 20 }, keys: ["ShiftLeft", "KeyW"],
    until: "p.speed >= 8.29 && p.position[2] < 5", maxSteps: 300, note: "full sprint, flat deck" },
  { file: "02-ramp.png", spawn: { x: 0, y: 1.04, z: 18 }, keys: ["ShiftLeft", "KeyS"],
    until: "p.slopeDeg > 25 && p.position[1] > 2.4", maxSteps: 400, note: "climbing the 30° ramp" },
  { file: "03-stairs.png", spawn: { x: -19, y: 1.04, z: -11.5 }, keys: ["KeyA"],
    until: "p.position[1] > 0.75", maxSteps: 400, note: "0.25 m stair flight" },
  { file: "04-air.png", spawn: { x: 20, y: 1.04, z: 14 }, keys: ["ShiftLeft", "KeyW", "Space"],
    until: "!p.grounded && p.velocity[1] < 0.9 && p.velocity[1] > -0.9", maxSteps: 400, note: "apex hang of a sprint jump" },
  { file: "05-slide.png", spawn: { x: -14, y: 1.04, z: -14 }, keys: ["ShiftLeft", "KeyW"],
    until: "p.sliding && p.slopeDeg > 50 && p.position[1] > 4.5", maxSteps: 500, note: "45° apron run-up, 54° crown refuses — sliding back" },
  { file: "06-landing.png", spawn: { x: 31, y: 6.1, z: 31 }, keys: ["ShiftLeft", "KeyW"],
    until: "p.grounded && p.squash > 0.55 && p.position[1] < 2", maxSteps: 500, note: "5 m drop off the block, squash frame" },
  { file: "07-corner.png", spawn: { x: -30, y: 1.04, z: 30 }, keys: ["ShiftLeft", "KeyW", "KeyA"],
    until: "p.position[0] < -37 && p.speed < 8.5", maxSteps: 400, note: "sprinting into a 90° inside corner" },
];

async function main() {
  if (!has("dev")) execFileSync("npm", ["run", "build"], { cwd: ROOT, stdio: "ignore", shell: true });
  fs.mkdirSync(path.resolve(ROOT, DIR), { recursive: true });
  const summary = [];
  await openGame({ width: 1600, height: 900, built: !has("dev") }, async (d) => {
    await d.play(0.9);
    for (const s of SHOTS) {
      const r = await d.run(driveFn, s);
      const out = path.posix.join(DIR, s.file);
      await d.shoot(out);
      summary.push({
        file: out,
        note: s.note,
        conditionMet: r.hit,
        bytes: fs.statSync(path.resolve(ROOT, out)).size,
        state: r.p.state,
        position: r.p.position,
        speed: r.p.speed,
        verticalSpeed: r.p.verticalSpeed,
        grounded: r.p.grounded,
        sliding: r.p.sliding,
        slopeDeg: r.p.slopeDeg,
        squash: r.p.squash,
        cameraDistance: r.cam?.distance,
      });
      await d.run(() => window.__vs.pause(false));
    }
    const report = await d.report();
    summary.push({
      problems: [
        ...(report.errors ?? []),
        ...d.consoleErrors,
        ...d.failedRequests,
      ],
      stats: report.stats,
    });
  });
  console.log(JSON.stringify(summary, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
