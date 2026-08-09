// P04 — captures of the states that matter, framed to the exact simulation step.
//
// The review CLI's script language cannot release a key, and the skid this round adds is eight
// steps long at sprint, so it needs step-accurate framing rather than "hold W for 2 seconds".
// Same rule as the measurement rig: halt the realtime loop first, then every frame is mine.
//
//   node review/p04-shots.mjs [--built] [--width=1600] [--height=900]

import fs from "node:fs";
import path from "node:path";
import { openGame, ROOT, arg, has } from "../tools/lib/session.mjs";

const W = Number(arg("width", "1600"));
const H = Number(arg("height", "900"));
const DIR = arg("dir", "review/shots/p04");

const PRELUDE = `(() => {
  const K = window.__vs.kernel;
  K.halt();
  const L = K.get("locomotion");
  window.__p4s = {
    step(n){ for (let i=0;i<n;i++) K.advance(1/60); },
    reset(x,y,z){ L.teleport(x,y,z,{heading:[0,-1]}); },
    intent(x,y,sprint){ L.externalInput=true; L.moveX=x; L.moveY=y; L.sprintHeld=!!sprint; },
    jump(){ L._pressJump(); },
    release(){ L.jumpHeld=false; },
    state(){ const p=L.snapshot(); const r=L._proxy.rotation; return { state:p.state, speed:p.speed,
      grounded:p.grounded, braking:p.braking, lean:p.lean, push:p.push, y:p.position[1],
      vy:p.verticalSpeed, proxyPitchDeg:+(r.x*180/Math.PI).toFixed(2), proxyBankDeg:+(r.z*180/Math.PI).toFixed(2) }; },
    // Render one frame from a fixed offset without advancing anything. The follow camera sits
    // dead behind the body, where a pitch about the body's right axis is invisible; a skid you
    // cannot see from the only angle the game offers is worth checking from another one.
    sideRender(dx,dy,dz){
      const p = L._renderPos, cam = K.camera;
      cam.position.set(p.x+dx, p.y+dy, p.z+dz);
      cam.lookAt(p.x, p.y, p.z);
      cam.updateMatrixWorld();
      if (K.composer) K.composer.render(1/60); else K.renderer.render(K.scene, cam);
    },
  };
  return true;
})()`;

async function main() {
  const shots = [];
  await openGame({ width: W, height: H, built: has("built") }, async (d) => {
    await d.run(PRELUDE);
    const step = (n) => d.run((n) => window.__p4s.step(n), n);
    const reset = (x, y, z) => d.run(([x, y, z]) => window.__p4s.reset(x, y, z), [x, y, z]);
    const intent = (x, y, s) => d.run(([x, y, s]) => window.__p4s.intent(x, y, s), [x, y, s]);
    const state = () => d.run(() => window.__p4s.state());

    const shoot = async (name, note) => {
      const s = await state();
      const p = `${DIR}/${name}.png`;
      await d.shoot(p);
      shots.push({ image: p, note, ...s });
    };
    /** Same instant, seen from the side. Nothing advances; only the camera moves. */
    const shootSide = async (name, note, off = [7.5, 2.2, 0]) => {
      await d.run((o) => window.__p4s.sideRender(o[0], o[1], o[2]), off);
      const s = await state();
      const p = `${DIR}/${name}.png`;
      await d.shoot(p);
      shots.push({ image: p, note, ...s });
    };

    // 1 — full sprint, grounded. The reference frame everything else is judged against.
    await reset(0, 1.05, 26);
    await intent(0, 1, true);
    await step(150);
    await shoot("c01-sprint", "8.3 m/s, grounded, camera settled behind");
    await shootSide("c01b-sprint-side", "the same instant from the side: leaning into the run");

    // 2 — the skid. Four steps into an eight-step plant: heading still forward, body still
    //     sliding forward, speed already down a third. This is the beat round 1 did not have.
    await intent(0, -1, true);
    await step(4);
    await shoot("c02-skid", "4 steps into a full reversal: planted, no steering, speed bleeding");
    await shootSide("c02b-skid-side", "the same instant from the side: planted, pitched back");

    // 3 — the pivot out of the skid, 10 steps later: heading swung, speed still low.
    await step(10);
    await shoot("c03-pivot", "skid released, heading swinging, push-off still taxed");

    // 4 — mid-carve at sprint: a 2.55 m turning circle.
    await reset(0, 1.05, 26);
    await intent(0, 1, true);
    await step(150);
    await intent(-1, 0, true);
    await step(15);
    await shoot("c04-carve", "mid-carve at 8.3 m/s, ~45 deg through a 2.55 m radius turn");

    // 5 — apex of a running jump.
    await reset(0, 1.05, 26);
    await intent(0, 1, true);
    await step(150);
    await d.run(() => window.__p4s.jump());
    await step(23);
    await shoot("c05-apex", "apex of a sprint jump: 1.34 m up, 0.70 s airtime");

    // 6 — the landing, one step after touchdown.
    await step(21);
    await shoot("c06-land", "touchdown from the sprint jump");

    const report = await d.report();
    shots.push({
      report: {
        ready: report.ready,
        errors: report.errors,
        katex: report.katex,
        consoleErrors: d.consoleErrors,
        failedRequests: d.failedRequests,
      },
    });
  });

  fs.mkdirSync(path.resolve(ROOT, DIR), { recursive: true });
  fs.writeFileSync(path.resolve(ROOT, DIR, "shots.json"), JSON.stringify(shots, null, 2));
  console.log(JSON.stringify(shots, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
