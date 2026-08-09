// Isolates the determinism question: is the drift ours, or is it the camera basis?
import { execFileSync } from "node:child_process";
import { openGame, has, ROOT } from "../tools/lib/session.mjs";

const seq = [
  { step: 0, code: "KeyW", down: true }, { step: 0, code: "ShiftLeft", down: true },
  { step: 30, code: "Space", down: true }, { step: 42, code: "Space", down: false },
  { step: 60, code: "KeyD", down: true }, { step: 90, code: "KeyW", down: false },
];
const spawn = { x: 20, y: 1.04, z: 6 };

const body = ({ spawn, events, steps, group }) => {
  const vs = window.__vs, S = vs.kernel.signals;
  const ALL = ["KeyW", "KeyA", "KeyS", "KeyD", "ShiftLeft", "Space"];
  const key = (c, d) => window.dispatchEvent(new KeyboardEvent(d ? "keydown" : "keyup", { code: c, key: c, bubbles: true, cancelable: true }));
  for (const c of ALL) key(c, false);
  vs.advance(1 / 60, { render: false });
  S.emit("player:spawn", { position: spawn });
  vs.advance(1 / 60, { render: false });
  const byStep = new Map();
  for (const e of events) { if (!byStep.has(e.step)) byStep.set(e.step, []); byStep.get(e.step).push(e); }
  let maxBasis = 0;
  for (let i = 0; i < steps; i += group) {
    for (let k = 0; k < group; k++) { const es = byStep.get(i + k); if (es) for (const e of es) key(e.code, e.down); }
    vs.advance(group / 60, { render: false });
    const b = vs.probe("locomotion").basisYawDeg;
    maxBasis = Math.max(maxBasis, Math.min(Math.abs(b), Math.abs(360 - b)));
  }
  const p = vs.probe("locomotion");
  for (const c of ALL) key(c, false);
  return { pos: p.position, maxBasisDeviationDeg: maxBasis };
};

async function main() {
  if (!has("dev")) execFileSync("npm", ["run", "build"], { cwd: ROOT, stdio: "ignore", shell: true });
  for (const q of [{}, { reduceMotion: "1" }]) {
    await openGame({ width: 800, height: 600, built: !has("dev"), query: q }, async (d) => {
      await d.play(0.8);
      const a = await d.run(body, { spawn, events: seq, steps: 150, group: 1 });
      const b = await d.run(body, { spawn, events: seq, steps: 150, group: 1 });
      const c = await d.run(body, { spawn, events: seq, steps: 150, group: 2 });
      const e = await d.run(body, { spawn, events: seq, steps: 150, group: 3 });
      const dist = (u, v) => Math.hypot(u[0] - v[0], u[1] - v[1], u[2] - v[2]).toFixed(6);
      console.log(JSON.stringify({
        query: q,
        repeatDrift: dist(a.pos, b.pos),
        drift2x: dist(a.pos, c.pos),
        drift3x: dist(a.pos, e.pos),
        maxBasisDeviationDeg: [a, b, c, e].map((x) => x.maxBasisDeviationDeg.toFixed(3)),
        finalA: a.pos,
      }));
    });
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
