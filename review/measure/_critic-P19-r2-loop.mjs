// P19 r2 critic — commit, mastery movement, deliberate misconception, session distribution.
import { openGame } from "../../tools/lib/session.mjs";
const log = (...a) => console.log(...a);
const SL = 1 / 8;

await openGame({ width: 1280, height: 720 }, async (d) => {
  const play = (s) => d.play(s, SL);
  await play(1.0);

  await d.run(() => {
    const k = window.__vs.kernel;
    window.__hist = [];
    k.signals.on("learn:present", (v) => window.__hist.push({ t: "present", kpId: v?.kpId, form: v?.form, itemId: v?.itemId }));
    k.signals.on("learn:respond", (v) => window.__hist.push({ t: "respond", kpId: v?.kpId, family: v?.family, form: v?.form, correct: v?.correct, scored: v?.scored, credited: v?.credited, misconception: v?.misconception, response: v?.response }));
    k.signals.on("learn:mastery", (v) => window.__hist.push({ t: "mastery", kpId: v?.kpId, ...v }));
    return true;
  });

  const mastery = async () => {
    const m = await d.probe("mastery");
    return m;
  };

  // take a claim
  for (let i = 0; i < 4; i++) {
    await d.page.keyboard.down("KeyW"); await play(0.8); await d.page.keyboard.up("KeyW");
    await d.page.keyboard.press("KeyE");
    await play(0.6);
    const p = await d.probe("verbs");
    if (p?.phase === "performing") break;
  }

  let v = await d.probe("verbs");
  log("POSED:", JSON.stringify({ verb: v?.verb, item: v?.item }).slice(0, 400));

  const mBefore = await mastery();
  log("\nMASTERY BEFORE:", JSON.stringify(mBefore).slice(0, 1200));

  // ---- DELIBERATELY WRONG: leave the sockets at a value that is NOT the given charge.
  // given t = 5 -> correct is p=5,q=5. Build p=2,q=2 (a charge that is not the one that went in).
  const bump = async (n) => { for (let i = 0; i < n; i++) { await d.page.mouse.down(); await play(0.06); await d.page.mouse.up(); } };
  await bump(2);
  await d.page.keyboard.press("BracketRight");
  await play(0.15);
  await bump(2);
  v = await d.probe("verbs");
  log("built (deliberately wrong):", JSON.stringify(v?.rows).slice(0, 300), "entry:", v?.entry);

  await d.page.keyboard.press("KeyE");
  await play(1.5);
  v = await d.probe("verbs");
  log("\nAFTER WRONG COMMIT:");
  log(" lastResponse:", JSON.stringify(v?.lastResponse).slice(0, 700));
  log(" rows now standing:", JSON.stringify(v?.rows).slice(0, 800));
  log(" reads:", v?.stats?.reads, "readsRefused:", v?.stats?.readsRefused);
  await d.shoot("review/shots/critic-P19r2/wrong-720.png");

  const mAfter = await mastery();
  log("\nMASTERY AFTER:", JSON.stringify(mAfter).slice(0, 1200));

  // ---- session
  log("\n=== 10 rounds ===");
  for (let i = 0; i < 10; i++) {
    await d.page.keyboard.down("KeyW"); await play(0.5); await d.page.keyboard.up("KeyW");
    await d.page.keyboard.press("KeyE"); await play(0.4);
    await d.page.keyboard.down("KeyW"); await play(0.6); await d.page.keyboard.up("KeyW");
    await bump(3);
    await d.page.keyboard.press("KeyE"); await play(0.5);
  }
  const fin = await d.probe("verbs");
  log("byVerb:", JSON.stringify(fin?.stats?.byVerb));
  log("posed:", fin?.stats?.posed, "unposed:", fin?.stats?.unposed, "unposedByType:", JSON.stringify(fin?.stats?.unposedByType));
  log("respondHeard:", fin?.stats?.respondHeard, "masteryHeard:", fin?.stats?.masteryHeard, "familyOnWire:", fin?.stats?.familyOnWire, "reads:", fin?.stats?.reads);

  const hist = await d.run(() => window.__hist);
  const kps = {}; for (const h of hist) if (h.t === "present") kps[h.kpId] = (kps[h.kpId] ?? 0) + 1;
  log("KPs presented:", JSON.stringify(kps));
  log("responses:", JSON.stringify(hist.filter((h) => h.t === "respond"), null, 1).slice(0, 2500));
  log("mastery events:", JSON.stringify(hist.filter((h) => h.t === "mastery")).slice(0, 800));
  log("MASTERY END:", JSON.stringify(await mastery()).slice(0, 1200));
  log("errors:", d.consoleErrors.slice(0, 4));
});
