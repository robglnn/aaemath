#!/usr/bin/env node
/**
 * CRITIC: what does the shipped presenter put on screen, against what the shipped bank hands it?
 * `ItemBank.present()` returns `tex.given`, a localised `ask`, `framing`, `spoken` and three
 * `hints`. This prints them next to the panels that actually stand in the world.
 */
import { openGame } from "../../tools/lib/session.mjs";

const sim = (d, s) =>
  d.run((sec) => {
    const dt = 1 / 30;
    for (let i = 0; i < Math.max(1, Math.round(sec / dt)); i += 1) window.__vs.advance(dt, { render: false });
    return window.__vs.stats().simTime;
  }, s);

const rows = await openGame({ built: true, width: 1280, height: 720 }, async (d) => {
  await sim(d, 1.0);
  await d.page.keyboard.down("KeyE");
  await sim(d, 0.3);
  await d.page.keyboard.up("KeyE");
  await sim(d, 0.6);

  const rows = [];
  for (let i = 0; i < 8; i += 1) {
    const row = await d.run(() => {
      const t = window.__vs.kernel.get("teaching");
      const p = t?.presented ?? null;
      const panels = (window.__vs.probe("mathtex")?.panels ?? []).map((x) => ({ id: x.id, tex: x.tex }));
      return {
        phase: t?.phase ?? null,
        itemId: t?.item?.id ?? null,
        form: t?.item?.form ?? null,
        stem: p?.tex?.stem ?? null,
        given: p?.tex?.given ?? null,
        working: p?.tex?.working ?? null,
        ask: p?.ask ?? null,
        framing: p?.framing ?? null,
        spoken: p?.spoken ?? null,
        hints: p?.hints ?? null,
        answerType: p?.answerType ?? null,
        accepted: (() => {
          try {
            return t.bank.accepts(t.item)[0];
          } catch {
            return null;
          }
        })(),
        onScreen: panels,
      };
    });
    rows.push(row);
    // answer it so the loop advances to a different item
    const ans = await d.run(() => {
      const t = window.__vs.kernel.get("teaching");
      try {
        return t.bank.accepts(t.item)[0] ?? "7";
      } catch {
        return "7";
      }
    });
    await d.page.keyboard.type(String(ans), { delay: 0 });
    await sim(d, 1.6);
    await d.page.keyboard.press("Enter");
    await sim(d, 2.6);
  }
  return rows;
});

for (const r of rows) {
  console.log("=".repeat(92));
  console.log(`item ${r.itemId}  (${r.form}, ${r.answerType})`);
  console.log(`  ASK      (localised, produced by ItemBank.present) : ${JSON.stringify(r.ask)}`);
  console.log(`  GIVEN    (produced)                                : ${JSON.stringify(r.given)}`);
  console.log(`  FRAMING  (produced)                                : ${JSON.stringify(r.framing)}`);
  console.log(`  HINTS    (produced)                                : ${JSON.stringify(r.hints)}`);
  console.log(`  ACCEPTED answer                                    : ${JSON.stringify(r.accepted)}`);
  console.log(`  ON SCREEN (world panels standing)                  : ${JSON.stringify(r.onScreen)}`);
}
