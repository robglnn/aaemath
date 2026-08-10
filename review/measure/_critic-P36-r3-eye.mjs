/**
 * CRITIC P36 r3 — two real frames, accents ON then OFF, same halted pose, plus a magnified crop of
 * the only region that changes. Order matters: shoot ON first, because retiring through the signal
 * is not undone by the emitter (measured).
 */
import { openGame } from "../../tools/lib/session.mjs";

const OUT = "review/measure/_p36crit/";

await openGame({ width: 960, height: 540 }, async (d) => {
  const boot = await d.report();
  if (boot.fatal || !boot.ready) { console.log("BOOT FAILED"); process.exitCode = 1; return; }
  await d.play(2);
  await d.run(() => { const k = window.__vs.kernel; k.halt(); k.advance(0); });
  console.log("ON ", JSON.stringify(await d.run(() => window.__vs.probe("lighting")?.accents)));
  await d.shoot(OUT + "r3-on.png");
  await d.run(() => {
    const k = window.__vs.kernel;
    for (const id of window.__vs.probe("lighting").accents.ids) k.signals.emit("world:resonance", { id, active: false });
    k.advance(0);
  });
  console.log("OFF", JSON.stringify(await d.run(() => window.__vs.probe("lighting")?.accents)));
  await d.shoot(OUT + "r3-off.png");
  // magnified crop of the changed box, screen top-left coords from the measured diff
  await d.run(() => { const k = window.__vs.kernel; for (const id of ["leaf9-span","leaf9-share","leaf9-working","leaf9-mark"]) void id; });
  console.log("errors:", (await d.report()).errors.length);
});
