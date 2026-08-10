#!/usr/bin/env node
/**
 * Critic re-run of P30 group C's apply path, with ONE thing changed: deviceScaleFactor 1.
 *
 * P30.mjs group C runs at `scale: 2` and says so — "at DPR 1 every tier from high down to potato
 * clamps to 1 — the pixel ratio claim would be unfalsifiable". That is exactly the point: a school
 * Chromebook at 1366x768 reports devicePixelRatio 1, so the pixel-ratio lever that supplied C3's
 * "1.5 → 1" and most of C7's "% cheaper per frame" does not exist on the target device. This run
 * measures what is left. No screenshots.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { openGame, ROOT } from "../../tools/lib/session.mjs";

execFileSync("npx", ["vite", "build", "--logLevel", "warn"], { cwd: ROOT, stdio: "inherit", shell: true });

const QUERY = {
  autotier: "force",
  autotierWarmup: "30",
  autotierWarmupMs: "600000",
  autotierWindow: "30",
  autotierWindowMs: "600000",
  autotierCooldown: "1000",
};

const out = await openGame(
  { width: 480, height: 270, scale: 1, built: true, query: QUERY },
  async (d) => {
    await d.page.waitForFunction(() => window.__vs && (window.__vs.ready || window.__vs.fatal), {
      timeout: 90000,
    });
    const probe0 = await d.probe("autotier");
    const post0 = await d.probe("post");
    const t0 = Date.now();
    let p = probe0;
    for (;;) {
      p = await d.probe("autotier");
      if (((p?.changes?.length ?? 0) >= 1 && (p.tier === "potato" || p.budget?.changesLeft === 0)) ||
          Date.now() - t0 > 150000) break;
      await d.page.waitForTimeout(500);
    }
    await d.page.waitForTimeout(10000);
    return {
      probe0,
      post0,
      settled: await d.probe("autotier"),
      post1: await d.probe("post"),
      errors: d.consoleErrors.slice(0, 6),
    };
  }
);

const OUT = path.join(ROOT, "review", "measure", "out", "P30");
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "critic-dpr1.json"), JSON.stringify(out, null, 2));

const s = out.settled;
const downs = (s?.changes ?? []).filter((c) => c.direction === "down" && c.applied);
console.log(`\nGPU: ${s?.heuristic?.env?.renderer}`);
console.log(`devicePixelRatio reported: ${s?.heuristic?.env?.devicePixelRatio}`);
console.log(`boot ${s?.bootTier} → start ${s?.startTier} → settled ${s?.tier}`);
for (const c of downs) {
  console.log(
    `\nSTEP ${c.from} → ${c.to} (${c.rungs} rung(s)) decided at median ${c.medianMs} ms (${c.fps} fps)`
  );
  console.log(`  before: ${JSON.stringify(c.before)}`);
  console.log(`  after : ${JSON.stringify(c.after)}`);
  const bp = c.before.drawingBuffer[0] * c.before.drawingBuffer[1];
  const ap = c.after.drawingBuffer[0] * c.after.drawingBuffer[1];
  console.log(`  drawing-buffer pixels: ${bp} → ${ap}  (${(ap / bp).toFixed(3)}x)`);
  console.log(`  shadow map: ${c.before.shadowMapSize}² → ${c.after.shadowMapSize}², enabled ${c.before.shadowMapEnabled} → ${c.after.shadowMapEnabled}`);
}
const before = downs[downs.length - 1]?.medianMs ?? 0;
const now = s?.measured?.medianMs ?? 0;
console.log(
  `\nFRAME COST ACROSS THE LAST STEP at DPR 1: ${before} ms → ${now} ms  ` +
    `(${before && now ? (100 * (1 - now / before)).toFixed(0) : "?"} % cheaper)`
);
console.log(`post: installed ${out.post0?.installed} → ${out.post1?.installed}, targets ${out.post0?.targets} → ${out.post1?.targets}, ${out.post0?.megabytes} → ${out.post1?.megabytes} MB`);
console.log(`errors: ${JSON.stringify(out.errors)}`);
