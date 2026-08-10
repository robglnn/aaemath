#!/usr/bin/env node
// Review CLI — the only sanctioned way to look at this game.
//
//   node tools/review.mjs shot   review/shots/x.png [--width=1920] [--height=1080]
//                                [--lang=es] [--tier=high] [--scale=2] [--built]
//                                [--script="hold:KeyW:1.2;look:300:0;play:0.5"]
//   node tools/review.mjs verify [--langs=en,es,pl] [--built]
//   node tools/review.mjs probe  [--name=player]
//   node tools/review.mjs tour   review/shots/tour [--lang=en]
//   node tools/review.mjs perf   [--seconds=8]
//
// `shot` prints a JSON report next to the image: any reviewer that sees `ready:false`,
// console errors or failed requests must treat the picture as invalid, not as art.

import fs from "node:fs";
import path from "node:path";
import { openGame, arg, has, positional, ROOT } from "./lib/session.mjs";

const command = process.argv[2] ?? "shot";

const common = () => ({
  width: Number(arg("width", "1920")),
  height: Number(arg("height", "1080")),
  lang: arg("lang", null),
  tier: arg("tier", null),
  built: has("built"),
  scale: Number(arg("scale", "1")),
});

/**
 * Tiny scripting language for driving the game deterministically.
 *   play:1.5            advance 1.5 game seconds
 *   hold:KeyW:1.2       hold a key for 1.2 game seconds
 *   grip:KeyW:1.2       same, but leave the key down (captures mid-stride poses)
 *   tap:Space           press and release
 *   look:320:-40        relative mouse look
 *   click:960:540       click at viewport coords
 *   eval:<js>           run arbitrary JS in the page
 * Steps are separated by ";".
 */
async function runScript(d, script) {
  if (!script) return;
  for (const raw of script.split(";").map((s) => s.trim()).filter(Boolean)) {
    const [verb, ...rest] = raw.split(":");
    switch (verb) {
      case "play":
        await d.play(Number(rest[0]) || 0.5);
        break;
      case "hold":
        await d.hold(rest[0], Number(rest[1]) || 1);
        break;
      case "grip":
        await d.hold(rest[0], Number(rest[1]) || 1, { release: false });
        break;
      case "tap":
        await d.page.keyboard.press(rest[0]);
        await d.play(0.2);
        break;
      case "look":
        await d.look(Number(rest[0]) || 0, Number(rest[1]) || 0);
        break;
      case "click":
        await d.page.mouse.click(Number(rest[0]) || 0, Number(rest[1]) || 0);
        await d.play(0.3);
        break;
      case "eval":
        await d.run(new Function(rest.join(":")));
        await d.play(0.2);
        break;
      default:
        throw new Error(`unknown script verb "${verb}" in "${raw}"`);
    }
  }
}

function verdict(report, d) {
  const problems = [];
  if (report.fatal) problems.push(`FATAL BOOT ERROR: ${report.fatal.split("\n")[0]}`);
  if (!report.ready) problems.push("app never reported ready");
  for (const e of report.errors ?? []) problems.push(`runtime error: ${e.split("\n")[0]}`);
  for (const e of d.consoleErrors) problems.push(`console error: ${e}`);
  for (const f of d.failedRequests) problems.push(`request failed: ${f}`);
  if (report.katex?.failed) problems.push(`${report.katex.failed} KaTeX node(s) failed to typeset`);
  if (report.katex?.rawSourceLeak)
    problems.push(`raw TeX leaked into visible UI: ${report.katex.leakSample ?? "(sample n/a)"}`);
  return problems;
}

async function cmdShot() {
  const out = positional(0) || "review/shots/shot.png";
  const script = arg("script", "");
  const settle = Number(arg("settle", "0.75"));

  await openGame(common(), async (d) => {
    await d.play(settle);
    await runScript(d, script);
    await d.shoot(out);

    const report = await d.report();
    const problems = verdict(report, d);
    const summary = {
      image: out,
      bytes: fs.existsSync(path.resolve(ROOT, out)) ? fs.statSync(path.resolve(ROOT, out)).size : 0,
      lang: arg("lang", "en"),
      ready: report.ready,
      stats: report.stats,
      katex: report.katex,
      probes: report.probes,
      problems,
    };
    console.log(JSON.stringify(summary, null, 2));
    if (problems.length) {
      console.error("\nIMAGE IS NOT REVIEWABLE — fix the problems above first.");
      process.exitCode = 1;
    }
  });
}

async function cmdVerify() {
  const langs = (arg("langs", "en,es,pl") || "").split(",").filter(Boolean);
  const failures = [];
  const lines = [];

  for (const lang of langs) {
    await openGame({ ...common(), lang, width: 1600, height: 900 }, async (d) => {
      await d.play(1.5);
      const report = await d.report();
      failures.push(...verdict(report, d).map((p) => `[${lang}] ${p}`));

      // Determinism contract: the same advance from the same state must reproduce.
      const before = await d.probe("scaffold");
      await d.advance(1.0);
      const afterA = await d.probe("scaffold");
      if (before && afterA && JSON.stringify(before) === JSON.stringify(afterA)) {
        failures.push(`[${lang}] advance() did not move the simulation`);
      }

      // Does the character face where it is going?
      //
      // This shipped broken and a player found it, not the tooling. The avatar sat at yaw 180 while
      // travelling at heading 0 — facing backwards down its own line of travel — which a player reads
      // as two unrelated bugs: swapped arms (you are seeing the character's front) and reversed
      // strafing (the body slides toward its own left while facing you). Every automated check passed,
      // because they all measured the *input* against the camera basis, which was correct throughout.
      // Nothing compared the body's facing to its motion, so nothing could see it.
      // Compare the body's actual world-space forward axis against the direction it is travelling.
      //
      // The first version of this check compared the `headingDeg` and `yawDeg` probes, which differ
      // by 180 degrees BY CONSTRUCTION — `headingDeg` negates z to read as a compass bearing and
      // `yawDeg` does not. That made a correct avatar look broken, and "fixing" it to satisfy the
      // gate turned the character around. Read the transform, not two probes that were never in the
      // same convention.
      await d.hold("KeyW", 1.0, { release: false });
      const facing = await d.run(() => {
        const k = window.__vs?.kernel;
        const av = k?.byName.get("avatar");
        // `body` holds the yaw; `root` only holds position. Reading `root` here made this gate
        // blind — it always reported the same answer regardless of the avatar's actual facing.
        const body = av?.body ?? av?.root;
        if (!body) return null;
        const before = body.getWorldPosition(new k.camera.position.constructor()).clone();
        for (let i = 0; i < 12; i++) window.__vs.advance(1 / 60);
        const after = body.getWorldPosition(new k.camera.position.constructor());
        const vx = after.x - before.x;
        const vz = after.z - before.z;
        const speed = Math.hypot(vx, vz);
        if (speed < 0.05) return { moved: speed };
        // Local +Z of the body, in world space — the direction the authored model faces.
        const m = body.matrixWorld.elements;
        const fLen = Math.hypot(m[8], m[10]) || 1;
        const dot = ((vx / speed) * m[8] + (vz / speed) * m[10]) / fLen;
        return { moved: speed, alignment: dot };
      });
      await d.page.keyboard.up("KeyW");

      if (facing && typeof facing.alignment === "number") {
        const deg = (Math.acos(Math.max(-1, Math.min(1, facing.alignment))) * 180) / Math.PI;
        if (facing.alignment < 0.5) {
          failures.push(
            `[${lang}] avatar's front points ${deg.toFixed(0)}deg away from its direction of travel — ` +
              `it is running sideways or backwards`
          );
        }
        lines.push(`[${lang}] facing: front is ${deg.toFixed(0)}deg off the travel direction`);
      } else if (facing) {
        lines.push(`[${lang}] facing: not checked (avatar moved only ${(facing.moved ?? 0).toFixed(3)}m)`);
      }

      const i18n = report.probes?.i18n;
      if (i18n?.missing?.length) {
        failures.push(`[${lang}] ${i18n.missing.length} missing strings: ${i18n.missing.slice(0, 6).join(", ")}`);
      }
      if (i18n && i18n.locale !== lang) {
        failures.push(`[${lang}] locale did not apply (got "${i18n.locale}")`);
      }

      lines.push(
        `[${lang}] ready=${report.ready} fps~${report.stats.fps} draws=${report.stats.drawCalls} ` +
          `tris=${report.stats.triangles} katex=${report.katex.rendered}/${report.katex.failed}f`
      );
    });
  }

  console.log(lines.join("\n"));
  if (failures.length) {
    console.error("\nVERIFY FAILED");
    for (const f of failures) console.error("  x " + f);
    process.exit(1);
  }
  console.log("\nVERIFY PASSED");
}

async function cmdProbe() {
  await openGame(common(), async (d) => {
    await d.play(Number(arg("settle", "1.2")));
    const name = arg("name", null);
    const value = name ? await d.probe(name) : await d.report();
    console.log(JSON.stringify(value, null, 2));
  });
}

/** A fixed set of framings so successive rounds are compared like with like. */
const TOUR = [
  { id: "01-arrival", script: "play:1.2" },
  { id: "02-run", script: "grip:KeyW:1.6" },
  { id: "03-turn", script: "look:420:0;play:0.4" },
  { id: "04-jump", script: "tap:Space;play:0.35" },
  { id: "05-vista", script: "look:-260:-120;play:0.6" },
];

async function cmdTour() {
  const dir = positional(0) || "review/shots/tour";
  fs.mkdirSync(path.resolve(ROOT, dir), { recursive: true });
  const results = [];
  for (const stop of TOUR) {
    await openGame(common(), async (d) => {
      await d.play(0.8);
      await runScript(d, stop.script);
      const file = path.join(dir, `${stop.id}.png`);
      await d.shoot(file);
      const report = await d.report();
      results.push({ id: stop.id, file, problems: verdict(report, d), stats: report.stats });
    });
  }
  console.log(JSON.stringify(results, null, 2));
  if (results.some((r) => r.problems.length)) process.exitCode = 1;
}

async function cmdPerf() {
  const seconds = Number(arg("seconds", "6"));
  await openGame(common(), async (d) => {
    await d.play(1);
    const samples = await d.run((s) => {
      const out = [];
      const n = Math.round(s * 30);
      for (let i = 0; i < n; i++) {
        const t0 = performance.now();
        window.__vs.advance(1 / 30);
        out.push(performance.now() - t0);
      }
      return out;
    }, seconds);
    samples.sort((a, b) => a - b);
    const pick = (p) => Number(samples[Math.floor(samples.length * p)]?.toFixed(2));
    const stats = await d.report();
    console.log(
      JSON.stringify(
        {
          note: "headless software GL — treat as a relative regression signal, not a real-hardware fps",
          frames: samples.length,
          medianMs: pick(0.5),
          p95Ms: pick(0.95),
          worstMs: Number(samples.at(-1)?.toFixed(2)),
          drawCalls: stats.stats.drawCalls,
          triangles: stats.stats.triangles,
          programs: stats.stats.programs,
        },
        null,
        2
      )
    );
  });
}

const table = {
  shot: cmdShot,
  verify: cmdVerify,
  probe: cmdProbe,
  tour: cmdTour,
  perf: cmdPerf,
};

const fn = table[command];
if (!fn) {
  console.error(`unknown command "${command}". Try: ${Object.keys(table).join(", ")}`);
  process.exit(2);
}
fn().catch((err) => {
  console.error(err);
  process.exit(1);
});
