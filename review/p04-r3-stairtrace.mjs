#!/usr/bin/env node
// Per-frame trace of one stair flight. node review/p04-r3-stairtrace.mjs <z> <dir> <frames>
import { openGame } from "../tools/lib/session.mjs";

const z = Number(process.argv[2] ?? 4.5);
const dir = Number(process.argv[3] ?? -1);
const frames = Number(process.argv[4] ?? 160);

const fn = async ([z, dir, frames]) => {
  const K = window.__vs.kernel, loco = K.get("locomotion");
  const T = loco.tune, STEP = 1 / 60;
  const R4 = (v) => Math.round(v * 1e4) / 1e4;
  const STAND = 0.12 + T.capsuleHeight / 2 + 0.35;
  function intent(wx, wz) {
    const l = Math.hypot(wx, wz) || 1; wx /= l; wz /= l;
    const c = K.camera; c.updateMatrixWorld();
    const e = c.matrixWorld.elements; const y = Math.atan2(e[8], e[10]);
    const s = Math.sin(y), co = Math.cos(y);
    loco.moveX = wx * co - wz * s; loco.moveY = -wx * s - wz * co;
  }
  loco.teleport(19 * dir, STAND, z, { heading: [dir, 0] });
  for (let i = 0; i < 45; i++) K.advance(STEP, { render: false });
  loco.velocity.set(0, 0, 0);
  const rows = [];
  const y0 = loco.position.y;
  for (let i = 0; i < frames; i++) {
    intent(dir, 0);
    const yb = loco.position.y, xb = loco.position.x, bud = loco.stepBudget;
    K.advance(STEP, { render: false });
    const dy = loco.position.y - yb;
    if (dy > 0.001 || loco._moveOut.stepped || loco._moveOut.blocked) {
      rows.push({
        i, x: R4(xb), dx: R4(loco.position.x - xb), dy: R4(dy),
        rise: R4(loco.position.y - y0), budB: R4(bud), budA: R4(loco.stepBudget),
        stepped: !!loco._moveOut.stepped, sr: R4(loco._moveOut.stepRise || 0),
        blk: !!loco._moveOut.blocked, sp: R4(Math.hypot(loco.velocity.x, loco.velocity.z)),
        st: loco.state,
      });
    }
  }
  return { rows, rise: R4(loco.position.y - y0) };
};

const r = await openGame({ width: 900, height: 600 }, async (d) => await d.run(fn, [z, dir, frames]));
for (const q of r.rows) console.log(JSON.stringify(q));
console.log("total rise", r.rise);
