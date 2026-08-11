// P19 round 2 critic — hands on the claim. Lean: coarse slices, short session.
import { openGame } from "../../tools/lib/session.mjs";
const log = (...a) => console.log(...a);
const SL = 1 / 8; // coarse slice: fewer rendered frames per game second

await openGame({ width: 1280, height: 720 }, async (d) => {
  await d.play(1.0, SL);
  const probe = () => d.probe("verbs");
  const hold = (k, s) => d.hold(k, s); // uses default slice internally
  const play = (s) => d.play(s, SL);

  await d.run(() => {
    const k = window.__vs.kernel;
    window.__hist = [];
    k.signals.on("learn:respond", (v) => window.__hist.push({ t: "respond", kpId: v?.kpId, family: v?.family, form: v?.form, correct: v?.correct, scored: v?.scored, credited: v?.credited, misconception: v?.misconception, response: v?.response }));
    k.signals.on("learn:mastery", (v) => window.__hist.push({ t: "mastery", kpId: v?.kpId, p: v?.pKnown ?? v?.p }));
    return true;
  });

  // take a claim on
  for (let i = 0; i < 4; i++) {
    await d.page.keyboard.down("KeyW"); await play(0.8); await d.page.keyboard.up("KeyW");
    await d.page.keyboard.press("KeyE");
    await play(0.6);
    const p = await probe();
    if (p?.phase === "performing") break;
  }

  let p = await probe();
  log("=== POSED ===");
  log(JSON.stringify(p, null, 1).slice(0, 3000));

  const st = async (label, fn) => {
    await fn();
    await play(0.2);
    const q = await probe();
    log(`[${label}] ${JSON.stringify({ verb: q?.verb ?? q?.act, read: q?.read, rows: q?.rows, value: q?.value, entry: q?.entry }).slice(0, 500)}`);
  };

  log("\n=== HANDS ===");
  await st("W 0.4s", async () => { await d.page.keyboard.down("KeyW"); await play(0.4); await d.page.keyboard.up("KeyW"); });
  await st("W 0.4s", async () => { await d.page.keyboard.down("KeyW"); await play(0.4); await d.page.keyboard.up("KeyW"); });
  await st("Mouse0 take", async () => { await d.page.mouse.down(); await play(0.1); await d.page.mouse.up(); });
  await st("Mouse0 take", async () => { await d.page.mouse.down(); await play(0.1); await d.page.mouse.up(); });
  await st("Mouse2 back", async () => { await d.page.mouse.down({ button: "right" }); await play(0.1); await d.page.mouse.up({ button: "right" }); });
  await st("BracketRight", async () => { await d.page.keyboard.press("BracketRight"); });

  await d.shoot("review/shots/critic-P19r2/midverb-720.png");
  log("shot written");

  const learnBefore = await d.probe("learning");
  log("\nlearning BEFORE:", JSON.stringify(learnBefore).slice(0, 800));

  await d.page.keyboard.press("KeyE");
  await play(1.2);
  p = await probe();
  log("\n=== AFTER SET DOWN ===");
  log(JSON.stringify({ phase: p?.phase, lastResponse: p?.lastResponse, read: p?.read, stats: p?.stats }, null, 1).slice(0, 2000));
  await d.shoot("review/shots/critic-P19r2/afterset-720.png");

  const learnAfter = await d.probe("learning");
  log("learning AFTER:", JSON.stringify(learnAfter).slice(0, 800));

  // short session
  log("\n=== 8 more rounds ===");
  for (let i = 0; i < 8; i++) {
    await d.page.keyboard.down("KeyW"); await play(0.5); await d.page.keyboard.up("KeyW");
    await d.page.keyboard.press("KeyE");
    await play(0.4);
    await d.page.keyboard.down("KeyW"); await play(0.5); await d.page.keyboard.up("KeyW");
    await d.page.mouse.down(); await play(0.1); await d.page.mouse.up();
    await d.page.keyboard.press("KeyE");
    await play(0.5);
  }
  const fin = await probe();
  log("byVerb:", JSON.stringify(fin?.stats?.byVerb), "posed:", fin?.stats?.posed, "unposed:", fin?.stats?.unposed);
  log("unposedByType:", JSON.stringify(fin?.stats?.unposedByType).slice(0, 500));
  log("respondHeard:", fin?.stats?.respondHeard, "masteryHeard:", fin?.stats?.masteryHeard, "familyOnWire:", fin?.stats?.familyOnWire);
  const hist = await d.run(() => window.__hist.slice(0, 40));
  log("responses:", JSON.stringify(hist, null, 1).slice(0, 2500));
  log("errors:", d.consoleErrors.slice(0, 4));
});
