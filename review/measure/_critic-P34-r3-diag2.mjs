#!/usr/bin/env node
import { openGame } from "../../tools/lib/session.mjs";

await openGame({ built: true, width: 1280, height: 720, lang: "en" }, async (d) => {
  const dump = () =>
    (() => {
      const v = window.__vs.kernel.get("verbs");
      const own = Object.getOwnPropertyNames(v).map((k) => `${k}:${v[k] === null ? "null" : typeof v[k]}`);
      const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(v));
      return { frame: v.frame === null ? "null" : typeof v.frame, frameVal: v.frame === null ? null : JSON.stringify(v.frame)?.slice(0, 200), own, proto };
    })();

  console.log("BOOT   ", JSON.stringify(await d.run(dump), null, 1));

  await d.run(() => {
    for (let i = 0; i < 30; i += 1) window.__vs.advance(1 / 30, { render: false });
  });
  await d.page.keyboard.down("KeyE");
  const r = await d.run(() => {
    const errs = [];
    for (let i = 0; i < 11; i += 1) {
      try {
        window.__vs.advance(1 / 30, { render: false });
      } catch (e) {
        errs.push(String(e));
      }
    }
    return { errs: errs.slice(0, 2), n: errs.length, simTime: window.__vs.stats().simTime, frames: window.__vs.stats().frames };
  });
  await d.page.keyboard.up("KeyE");
  console.log("AFTER E", JSON.stringify(r));
  console.log("VERBS  ", JSON.stringify(await d.run(dump), null, 1));
  console.log("verbs probe", JSON.stringify(await d.probe("verbs"))?.slice(0, 900));

  // does the REALTIME animation loop survive?
  const a = await d.run(() => window.__vs.kernel.stats().frames);
  await new Promise((res) => setTimeout(res, 6000));
  const b = await d.run(() => window.__vs.kernel.stats().frames);
  console.log(`realtime frames rendered over 6 wall-clock seconds AFTER the throw: ${a} -> ${b}`);

  const rep = await d.report();
  console.log("errors:", rep.errors.length);
  console.log("teaching:", JSON.stringify(await d.probe("teaching"))?.slice(0, 600));
  console.log("mathtex panels:", JSON.stringify(((await d.probe("mathtex"))?.panels ?? []).map((p) => p.id)));
  await d.shoot("review/shots/p34crit/after-interact.png");
  console.log("shot written");
});
