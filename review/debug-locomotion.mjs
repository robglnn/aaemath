#!/usr/bin/env node
// Scratch trace tool for P04. Prints per-step state for one scripted trial so a suspicious
// number from measure-locomotion.mjs can be traced to the step where it goes wrong.
//
//   node review/debug-locomotion.mjs turn|corner|step|slope
import { execFileSync } from "node:child_process";
import { openGame, has, ROOT } from "../tools/lib/session.mjs";

const which = process.argv.slice(2).find((a) => !a.startsWith("--")) || "turn";
const DECK = 0.12, STAND = 0.92;
const at = (x, z, up = 0) => ({ x, y: DECK + STAND + up, z });

const CASES = {
  turn: { spawn: at(20, -5), steps: 200, events: [
    { step: 0, code: "KeyW", down: true }, { step: 0, code: "ShiftLeft", down: true },
    { step: 110, code: "KeyW", down: false }, { step: 110, code: "KeyD", down: true },
  ] },
  corner: { spawn: at(-34, 20), steps: 110, events: [
    { step: 0, code: "KeyS", down: true }, { step: 0, code: "KeyA", down: true },
    { step: 0, code: "ShiftLeft", down: true },
  ] },
  step: { spawn: at(-19, 4.5), steps: 200, events: [{ step: 0, code: "KeyA", down: true }] },
  slope: { spawn: at(0, 19.8), steps: 200, events: [
    { step: 0, code: "KeyS", down: true }, { step: 0, code: "ShiftLeft", down: true },
  ] },
};

async function main() {
  const c = CASES[which];
  if (!c) throw new Error(`unknown case ${which}`);
  if (!has("dev")) execFileSync("npm", ["run", "build"], { cwd: ROOT, stdio: "ignore", shell: true });
  await openGame({ width: 900, height: 600, built: !has("dev") }, async (d) => {
    await d.play(0.8);
    const rows = await d.run(({ spawn, steps, events }) => {
      const vs = window.__vs;
      const S = vs.kernel.signals;
      const ALL = ["KeyW", "KeyA", "KeyS", "KeyD", "ShiftLeft", "Space"];
      const key = (code, down) =>
        window.dispatchEvent(new KeyboardEvent(down ? "keydown" : "keyup", { code, key: code, bubbles: true, cancelable: true }));
      for (const k of ALL) key(k, false);
      vs.advance(1 / 60, { render: false });
      S.emit("player:spawn", { position: spawn });
      vs.advance(1 / 60, { render: false });
      const byStep = new Map();
      for (const e of events) { if (!byStep.has(e.step)) byStep.set(e.step, []); byStep.get(e.step).push(e); }
      const out = [];
      for (let i = 0; i < steps; i++) {
        const es = byStep.get(i);
        if (es) for (const e of es) key(e.code, e.down);
        vs.advance(1 / 60, { render: false });
        const p = vs.probe("locomotion");
        out.push({
          i, x: p.position[0], y: p.position[1], z: p.position[2],
          sp: p.speed, vy: p.velocity[1], g: p.grounded ? 1 : 0, st: p.state,
          hdg: p.headingDeg, basis: p.basisYawDeg, intent: p.intent,
          slope: p.slopeDeg, sl: p.sliding ? 1 : 0, budget: p.stepBudget,
          dir: Math.round((Math.atan2(p.velocity[0], -p.velocity[2]) * 180) / Math.PI),
        });
      }
      for (const k of ALL) key(k, false);
      return out;
    }, c);

    const every = Number(process.env.EVERY || 5);
    for (const r of rows) {
      if (r.i % every !== 0 && r.i < 105) continue;
      if (r.i > 104 && r.i < 150 && r.i % 2 !== 0) continue;
      if (r.i >= 150 && r.i % every !== 0) continue;
      console.log(
        `${String(r.i).padStart(3)} p=(${r.x.toFixed(2)},${r.y.toFixed(2)},${r.z.toFixed(2)}) ` +
        `sp=${r.sp.toFixed(2)} vy=${r.vy.toFixed(2)} g=${r.g} ${r.st.padEnd(8)} ` +
        `hdg=${r.hdg.toFixed(0).padStart(4)} dir=${String(r.dir).padStart(4)} basis=${r.basis.toFixed(1)} ` +
        `intent=[${r.intent[0].toFixed(2)},${r.intent[1].toFixed(2)}] budget=${r.budget.toFixed(3)}${r.sl ? " SLIDE" : ""}`
      );
    }
    if (d.consoleErrors.length) console.log("ERRORS", d.consoleErrors.slice(0, 5));
  });
}
main().catch((e) => { console.error(e); process.exit(1); });
