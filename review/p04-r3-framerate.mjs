#!/usr/bin/env node
// P04 round 3 — G4, settled.
//
// Two runs of the SAME input schedule at 1, 2, 4 and 8 simulation steps per rendered frame.
//
//   aligned   — every transition, including the jump press, lands on a multiple of 8 steps, so
//               the schedule is representable at every cadence. Gameplay must be byte-identical.
//   unaligned — the jump press is asked for at step 121, which a 4-step slice cannot honour: the
//               button is pressed at the top of the slice that *contains* 121, i.e. at step 120
//               at every cadence but 1. The script prints the step the jump actually fired on,
//               so the divergence can be read as what it is — a different input, not a
//               different simulation.
//
// If the aligned rows differ, the controller reads something that is not the fixed step.

import fs from "node:fs";
import { openGame } from "../tools/lib/session.mjs";

const fn = async () => {
  const K = window.__vs.kernel;
  K.halt();
  const L = K.get("locomotion");
  const STEP = 1 / 60;
  const R = (v) => Math.round(v * 1e6) / 1e6;
  const STAND = 0.12 + L.tune.capsuleHeight / 2 + 0.35;

  const intent = (wx, wz) => {
    const l = Math.hypot(wx, wz) || 1;
    L.externalInput = true; L.moveX = wx / l; L.moveY = -wz / l; L.sprintHeld = true;
  };
  function reset() {
    L.moveX = 0; L.moveY = 0; L.sprintHeld = false; L.jumpHeld = false; L.jumpBuffer = 0;
    L.teleport(0, STAND, 10, { heading: [0, -1] });
    for (let i = 0; i < 48; i++) K.advance(STEP, { render: false });
    L.velocity.set(0, 0, 0);
    for (let i = 0; i < 3; i++) K.advance(STEP, { render: false });
  }
  const plan = [[[0, -1], 88], [[1, 0], 56], [[0, 1], 56], [[0, -1], 56]];

  const run = (slice, jumpAt) => {
    reset();
    const base = K.stepCount;
    let firedAt = null;
    const marks = [];
    let total = 0;
    for (const [dir, n] of plan) {
      let left = n;
      while (left > 0) {
        const k = Math.min(slice, left);
        intent(dir[0], dir[1]);
        // A real rendered frame can only act on input at its own boundary. This is the honest
        // model of that: the press happens at the top of the slice that contains `jumpAt`.
        if (total <= jumpAt && total + k > jumpAt && firedAt === null) {
          L._pressJump(); L.jumpHeld = true; firedAt = total;
        }
        K.advance(k * STEP, { render: false });
        left -= k; total += k;
      }
      const p = L.position, v = L.velocity;
      marks.push([R(p.x), R(p.y), R(p.z), R(v.x), R(v.y), R(v.z), L.state]);
    }
    return { firedAt, steps: K.stepCount - base, marks };
  };

  const out = {};
  for (const [name, jumpAt] of [["aligned", 120], ["unaligned", 121]]) {
    const rows = {};
    for (const slice of [1, 2, 4, 8]) rows[slice] = run(slice, jumpAt);
    const ref = JSON.stringify(rows[1].marks);
    out[name] = {
      pressedAtStep: Object.fromEntries([1, 2, 4, 8].map((s) => [s, rows[s].firedAt])),
      totalSteps: Object.fromEntries([1, 2, 4, 8].map((s) => [s, rows[s].steps])),
      identical: Object.fromEntries([1, 2, 4, 8].map((s) => [s, JSON.stringify(rows[s].marks) === ref])),
      marks: Object.fromEntries([1, 2, 4, 8].map((s) => [s, rows[s].marks])),
    };
  }
  // and the plainest determinism check there is: the same script twice in one session
  const a = run(1, 120), b = run(1, 120);
  out.sameScriptTwice = JSON.stringify(a.marks) === JSON.stringify(b.marks);
  out.signature = a.marks;
  return out;
};

const once = () => openGame({ width: 1024, height: 640 }, async (d) => ({
  errors: d.consoleErrors, out: await d.run(fn),
}));

const first = await once();
const second = await once();
const crossSession = JSON.stringify(first.out.signature) === JSON.stringify(second.out.signature);
fs.writeFileSync("review/p04-r3-framerate.json",
  JSON.stringify({ first, secondSignature: second.out.signature, crossSession }, null, 2));

const o = first.out;
console.log("console errors:", first.errors.length);
for (const name of ["aligned", "unaligned"]) {
  console.log(`\n-- ${name} --`);
  console.log("  jump pressed at sim step:", JSON.stringify(o[name].pressedAtStep));
  console.log("  total sim steps run     :", JSON.stringify(o[name].totalSteps));
  console.log("  identical to 1-step run :", JSON.stringify(o[name].identical));
  for (const s of [1, 4, 8]) console.log(`  slice ${s}:`, JSON.stringify(o[name].marks[s]));
}
console.log("\nsame script twice, one session:", o.sameScriptTwice);
console.log("same script, two browser launches:", crossSession);
console.log("\nwrote review/p04-r3-framerate.json");
