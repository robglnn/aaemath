#!/usr/bin/env node
/**
 * CRITIC — round 3. Independent driver. Does NOT import the builder's reader or measure script.
 * Step 1: who has a non-function `frame`, and when does it appear?
 */
import { openGame } from "../../tools/lib/session.mjs";

const dumpSystems = () =>
  window.__vs.kernel.systems.map((s) => ({
    name: s.__name ?? "?",
    frame: typeof s.frame,
    fixed: typeof s.fixed,
    after: typeof s.after,
  }));

await openGame({ built: true, width: 1280, height: 720, lang: "en" }, async (d) => {
  const before = await d.run(dumpSystems);
  console.log("SYSTEMS AT BOOT");
  for (const s of before) console.log(`  ${s.name.padEnd(16)} frame=${s.frame} fixed=${s.fixed} after=${s.after}`);

  // one settle tick, exactly like P34.mjs
  const t1 = await d.run(() => {
    try {
      for (let i = 0; i < 30; i += 1) window.__vs.advance(1 / 30, { render: false });
      return { ok: true, simTime: window.__vs.stats().simTime };
    } catch (e) {
      return { ok: false, err: String(e) };
    }
  });
  console.log("\nsettle 1.0s:", JSON.stringify(t1));

  await d.page.keyboard.down("KeyE");
  const t2 = await d.run(() => {
    try {
      for (let i = 0; i < 11; i += 1) window.__vs.advance(1 / 30, { render: false });
      return { ok: true, simTime: window.__vs.stats().simTime };
    } catch (e) {
      return { ok: false, err: String(e) };
    }
  });
  await d.page.keyboard.up("KeyE");
  console.log("after KeyE:", JSON.stringify(t2));

  const after = await d.run(dumpSystems);
  console.log("\nSYSTEMS AFTER KeyE");
  for (const s of after) console.log(`  ${s.name.padEnd(16)} frame=${s.frame} fixed=${s.fixed} after=${s.after}`);

  const bad = after.filter((s) => s.frame !== "undefined" && s.frame !== "function");
  console.log("\nNON-FUNCTION frame:", JSON.stringify(bad));

  const rep = await d.report();
  console.log("\nready", rep.ready, "fatal", rep.fatal, "errors", rep.errors.length);
  for (const e of rep.errors.slice(0, 6)) console.log("  ERR " + String(e).slice(0, 300));
  console.log("probes:", JSON.stringify(await d.run(() => window.__vs.probeNames())));
});
