// Perform BALANCE deliberately: what do the hands actually do on the verb that claims to BE algebra?
import { openGame } from "../../tools/lib/session.mjs";
const log = (...a) => console.log(...a);
const SL = 1 / 8;

await openGame({ width: 1280, height: 720 }, async (d) => {
  const play = (s) => d.play(s, SL);
  await play(1.0);
  const V = () => d.probe("verbs");

  // skip items until BALANCE poses
  let v = null;
  for (let round = 0; round < 8; round++) {
    for (let i = 0; i < 3; i++) {
      await d.page.keyboard.down("KeyW"); await play(0.6); await d.page.keyboard.up("KeyW");
      await d.page.keyboard.press("KeyE"); await play(0.5);
      v = await V();
      if (v?.phase === "performing") break;
    }
    v = await V();
    if (v?.verb === "balance") break;
    log(`round ${round}: posed ${v?.verb} (${v?.item?.itemId}) — setting it down unanswered`);
    await d.page.keyboard.press("KeyE"); await play(1.0);
  }

  v = await V();
  if (v?.verb !== "balance") { log("never reached BALANCE"); return; }

  log("\n=== BALANCE POSED ===");
  log("item:", JSON.stringify(v?.item));
  log("state:", JSON.stringify(v?.state).slice(0, 900));
  log("rows:", JSON.stringify(v?.rows));

  const st = async (label, fn) => {
    await fn(); await play(0.22);
    const q = await V();
    log(`[${label}]`);
    for (const r of q?.rows ?? []) log("     ", r.id, "=", r.tex);
    log("      held:", JSON.stringify(q?.state?.holding ?? q?.state).slice(0, 260));
  };

  log("\n=== MY HANDS ON BALANCE ===");
  await st("] stepNext (walk along the claim)", () => d.page.keyboard.press("BracketRight"));
  await st("] stepNext", () => d.page.keyboard.press("BracketRight"));
  await st("Mouse0 take (grip the term)", async () => { await d.page.mouse.down(); await play(0.1); await d.page.mouse.up(); });
  await st("] stepNext (walk to the Sill)", () => d.page.keyboard.press("BracketRight"));
  await st("Mouse0 take (carry it over)", async () => { await d.page.mouse.down(); await play(0.1); await d.page.mouse.up(); });
  await st("KeyC hold (second grip)", async () => { await d.page.keyboard.down("KeyC"); await play(0.25); await d.page.keyboard.up("KeyC"); });
  await st("W 0.4s (work axis)", async () => { await d.page.keyboard.down("KeyW"); await play(0.4); await d.page.keyboard.up("KeyW"); });
  await d.shoot("review/shots/critic-P19r2/balance-720.png");

  await d.page.keyboard.press("KeyE"); await play(0.35);
  v = await V();
  log("\nlastResponse:", JSON.stringify(v?.lastResponse).slice(0, 500));
  log("WORLD SAID:"); for (const r of (v?.rows ?? []).filter((r) => r.id.includes("read"))) log("   ", r.tex);
  log("errors:", d.consoleErrors.slice(0, 3));
});
