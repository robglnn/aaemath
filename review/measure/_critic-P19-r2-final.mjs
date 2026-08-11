// Tight capture of the world's read + gamepad path.
import { openGame } from "../../tools/lib/session.mjs";
const log = (...a) => console.log(...a);
const SL = 1 / 8;

await openGame({ width: 1280, height: 720 }, async (d) => {
  const play = (s) => d.play(s, SL);
  await play(1.0);

  for (let i = 0; i < 4; i++) {
    await d.page.keyboard.down("KeyW"); await play(0.8); await d.page.keyboard.up("KeyW");
    await d.page.keyboard.press("KeyE"); await play(0.6);
    if ((await d.probe("verbs"))?.phase === "performing") break;
  }
  let v = await d.probe("verbs");
  log("item:", v?.item?.itemId, "given:", JSON.stringify(v?.item?.given), "mode:", v?.state?.mode);

  const take = async (n) => { for (let i = 0; i < n; i++) { await d.page.mouse.down(); await play(0.05); await d.page.mouse.up(); await play(0.03); } };
  await take(5);
  await d.page.keyboard.press("BracketRight"); await play(0.15);
  await take(6);
  log("built:", (await d.probe("verbs"))?.entry, "(tagged misconception var-must-differ -> fail.twin)");

  await d.page.keyboard.press("KeyE");
  await play(0.35);                       // well inside readSeconds 1.5
  v = await d.probe("verbs");
  log("read key:", v?.lastResponse?.read, "| misconception on wire:", v?.lastResponse?.misconception);
  log("ROWS STANDING IN THE WORLD:");
  for (const r of v?.rows ?? []) log("   ", r.id, "=", r.tex);
  await d.shoot("review/shots/critic-P19r2/read-standing-720.png");

  // how long does the whole claim stay up after commit?
  await play(1.4);
  const after = await d.probe("verbs");
  log("\n1.75s after commit — rows still standing:", (after?.rows ?? []).length, "phase:", after?.phase);

  // ---------------- GAMEPAD
  log("\n=== GAMEPAD ===");
  await d.run(() => window.__vsInput.connect({ style: "xbox" }));
  await play(0.5);
  log("device:", JSON.stringify(await d.run(() => window.__vs.probe("input")?.device ?? null)));
  await d.run(() => window.__vsInput.tap("X"));
  await play(1.2);
  v = await d.probe("verbs");
  log("after Pad:X — phase:", v?.phase, "verb:", v?.verb, "item:", v?.item?.itemId);
  await d.run(() => window.__vsInput.press("RT", 1));
  await play(1.2);
  await d.run(() => window.__vsInput.release("RT"));
  await play(0.2);
  v = await d.probe("verbs");
  log("after RT 1.2s — state:", JSON.stringify(v?.state), "entry:", v?.entry);
  log("rows:", JSON.stringify(v?.rows).slice(0, 300));
  await d.shoot("review/shots/critic-P19r2/pad-720.png");
  await d.run(() => window.__vsInput.tap("X"));
  await play(0.4);
  v = await d.probe("verbs");
  log("pad set down — lastResponse:", JSON.stringify(v?.lastResponse).slice(0, 400));
  log("errors:", d.consoleErrors.slice(0, 3));
});
