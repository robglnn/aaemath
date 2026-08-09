#!/usr/bin/env node
/**
 * Capture a TEMPORAL sequence from the real app, for design/art-direction.md §15.
 *
 * The art bible's numbers were all measured on one still frame. A still frame
 * cannot show dither fizz, specular shimmer, ink crawl, bloom pop or exposure
 * pumping — every one of which is a per-frame difference. This produces the
 * frame pairs those checks need, through the app's own fixed-step clock, so the
 * interval between two captured frames is exactly one simulation step and not a
 * wall-clock accident of how slow software GL happens to be.
 *
 *   node review/p02-motion-capture.mjs --mode=static --frames=6 --out=review/shots/p02/motion-static
 *   node review/p02-motion-capture.mjs --mode=pan --degPerSec=60 --frames=6 --out=review/shots/p02/motion-pan
 *   node review/p02-motion-capture.mjs --mode=run --frames=6 --out=review/shots/p02/motion-run
 *
 * `pan` self-calibrates: it measures the yaw the rig actually produces for a
 * trial mouse delta and solves for the pixels-per-step that give the requested
 * angular rate, then reports the rate it achieved. Nothing here assumes a
 * sensitivity constant that a later piece is free to change.
 */
import fs from 'node:fs';
import path from 'node:path';
import { openGame, arg, ROOT } from '../tools/lib/session.mjs';

const mode = arg('mode', 'static');
const frames = Number(arg('frames', '6'));
const outDir = arg('out', `review/shots/p02/motion-${mode}`);
const degPerSec = Number(arg('degPerSec', '60'));
const width = Number(arg('width', '1600'));
const height = Number(arg('height', '900'));
const STEP = 1 / 60; // the kernel's fixed step — one captured frame apart

fs.mkdirSync(path.resolve(ROOT, outDir), { recursive: true });

const meta = { mode, frames, step: STEP, width, height, files: [], yaw: [], simTime: [], problems: [] };

await openGame({ width, height, tier: arg('tier', null) }, async (d) => {
  await d.play(1.2); // settle

  const camYaw = async () => (await d.probe('camera'))?.yaw ?? null;

  let pxPerStep = 0;
  if (mode === 'pan') {
    // ── calibrate: how many radians of yaw does one pixel of mouse travel buy?
    const box = d.page.viewportSize();
    await d.page.mouse.move(box.width / 2, box.height / 2);
    await d.advance(STEP);
    const y0 = await camYaw();
    const TRIAL = 40;
    await d.page.mouse.move(box.width / 2 + TRIAL, box.height / 2);
    await d.advance(STEP);
    const y1 = await camYaw();
    const radPerPx = Math.abs(((y1 - y0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI) / TRIAL;
    if (!(radPerPx > 1e-6)) {
      meta.problems.push('look calibration produced no yaw change — cannot drive a pan');
    } else {
      pxPerStep = (degPerSec * Math.PI / 180) * STEP / radPerPx;
      meta.calibration = { radPerPx: +radPerPx.toFixed(6), pxPerStep: +pxPerStep.toFixed(3) };
    }
    // re-centre the pointer with room to travel
    await d.page.mouse.move(60, box.height / 2);
    await d.advance(STEP);
  }
  if (mode === 'run') {
    await d.page.keyboard.down('KeyW');
    await d.play(0.9); // reach steady-state speed before the first capture
  }

  const box = d.page.viewportSize();
  let mx = mode === 'pan' ? 60 : box.width / 2;
  const my = box.height / 2;

  for (let i = 0; i < frames; i++) {
    if (i > 0) {
      if (mode === 'pan') { mx += pxPerStep; await d.page.mouse.move(mx, my); }
      await d.advance(STEP);
    }
    const file = path.join(outDir, `f${String(i).padStart(2, '0')}.png`);
    await d.shoot(file);
    meta.files.push(file.replace(/\\/g, '/'));
    const cam = await d.probe('camera');
    meta.yaw.push(cam ? +cam.yaw.toFixed(6) : null);
    meta.simTime.push(+(await d.page.evaluate(() => window.__vs.kernel.simTime)).toFixed(5));
  }
  if (mode === 'run') await d.page.keyboard.up('KeyW');

  // achieved angular rate, measured rather than assumed
  const ys = meta.yaw.filter(v => v !== null);
  if (ys.length > 1) {
    const d0 = ys.slice(1).map((v, i) => Math.abs(((v - ys[i] + Math.PI * 3) % (Math.PI * 2)) - Math.PI));
    const mean = d0.reduce((a, b) => a + b, 0) / d0.length;
    meta.achievedDegPerSec = +(mean * 180 / Math.PI / STEP).toFixed(2);
  }
  // simTime must advance by exactly one step between captures
  const dts = meta.simTime.slice(1).map((v, i) => +(v - meta.simTime[i]).toFixed(5));
  meta.stepDeltas = dts;
  if (dts.some(v => Math.abs(v - STEP) > 1e-4)) meta.problems.push(`simTime did not advance by exactly ${STEP} between captures: ${dts.join(', ')}`);

  const report = await d.report();
  if (!report.ready) meta.problems.push('app never reported ready');
  for (const e of report.errors ?? []) meta.problems.push('runtime error: ' + String(e).split('\n')[0]);
  for (const e of d.consoleErrors) meta.problems.push('console error: ' + e);
  for (const f of d.failedRequests) meta.problems.push('request failed: ' + f);
});

fs.writeFileSync(path.resolve(ROOT, outDir, 'sequence.json'), JSON.stringify(meta, null, 2));
console.log(JSON.stringify(meta, null, 2));
if (meta.problems.length) { console.error('\nSEQUENCE IS NOT REVIEWABLE — fix the problems above first.'); process.exit(1); }
