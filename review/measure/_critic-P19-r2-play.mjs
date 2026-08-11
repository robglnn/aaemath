// P19 round 2 critic — PLAY IT. Record every keystroke and the world state it produced.
import { openGame } from "../../tools/lib/session.mjs";

const log = (...a) => console.log(...a);

await openGame({ width: 1280, height: 720 }, async (d) => {
  await d.play(1.5);

  // ---- instrument: record every present/respond with the verb that posed it
  await d.run(() => {
    const k = window.__vs.kernel;
    window.__hist = [];
    k.signals.on("learn:present", (v) => {
      // read the verb AFTER the runtime poses (it poses inside its own learn:present handler)
      setTimeout(() => {}, 0);
      window.__hist.push({ t: "present", kpId: v?.kpId, form: v?.form, itemId: v?.itemId });
    });
    k.signals.on("learn:respond", (v) =>
      window.__hist.push({
        t: "respond", kpId: v?.kpId, family: v?.family, form: v?.form,
        correct: v?.correct, scored: v?.scored, credited: v?.credited,
        misconception: v?.misconception, response: v?.response,
      })
    );
    k.signals.on("learn:mastery", (v) => window.__hist.push({ t: "mastery", kpId: v?.kpId, p: v?.pKnown }));
    return true;
  });

  const probe = () => d.probe("verbs");

  // ---- get a claim in our hands
  for (let i = 0; i < 5; i++) {
    await d.hold("KeyW", 1.0);
    await d.page.keyboard.press("KeyE");
    await d.play(0.8);
    const p = await probe();
    if (p?.act || p?.phase === "performing") break;
  }

  let p = await probe();
  log("=== AFTER TAKING A CLAIM ON ===");
  log(JSON.stringify({ phase: p?.phase, verb: p?.verb ?? p?.act?.id, stats: p?.stats, ctx: p?.ctx, rows: p?.rows }, null, 2).slice(0, 2500));

  // ---- literal hands: press one key at a time, read the state after each
  const step = async (label, fn) => {
    await fn();
    await d.play(0.25);
    const q = await probe();
    log(`  [${label}] -> ${JSON.stringify({ read: q?.read, rows: q?.rows, entry: q?.entry, hand: q?.hand?.holding ?? q?.holding, value: q?.value })}`.slice(0, 700));
    return q;
  };

  log("\n=== MY HANDS ON THE CLAIM ===");
  await step("press W 0.5s (work axis fwd)", () => d.hold("KeyW", 0.5));
  await step("press W 0.5s again", () => d.hold("KeyW", 0.5));
  await step("Mouse0 down/up (take)", async () => { await d.page.mouse.down(); await d.play(0.1); await d.page.mouse.up(); });
  await step("BracketRight (stepNext)", () => d.page.keyboard.press("BracketRight"));
  await step("KeyC hold (second grip)", async () => { await d.page.keyboard.down("KeyC"); await d.play(0.3); await d.page.keyboard.up("KeyC"); });
  await step("Mouse2 (back)", async () => { await d.page.mouse.down({ button: "right" }); await d.play(0.1); await d.page.mouse.up({ button: "right" }); });

  await d.shoot("review/shots/critic-P19r2/midverb-720.png");
  log("shot: review/shots/critic-P19r2/midverb-720.png");

  // ---- p(known) before commit
  const before = await d.run(() => {
    const m = window.__vs.kernel.get("learning") ?? window.__vs.kernel.get("mastery");
    try { return m?.probe?.() ?? m?.snapshot?.() ?? null; } catch { return null; }
  });
  log("\nlearning probe before commit:", JSON.stringify(before).slice(0, 900));

  // ---- commit via interact
  await d.page.keyboard.press("KeyE");
  await d.play(1.5);
  p = await probe();
  log("\n=== AFTER SETTING IT DOWN ===");
  log(JSON.stringify({ phase: p?.phase, lastResponse: p?.lastResponse, stats: p?.stats }, null, 2).slice(0, 1800));

  // ---- long session: what does a player ACTUALLY meet?
  log("\n=== A REAL SESSION: 40 rounds ===");
  for (let i = 0; i < 40; i++) {
    await d.hold("KeyW", 0.6);
    await d.page.keyboard.press("KeyE");
    await d.play(0.5);
    await d.hold("KeyW", 0.7);
    await d.page.mouse.down(); await d.play(0.1); await d.page.mouse.up();
    await d.page.keyboard.press("KeyE");
    await d.play(0.6);
  }
  const fin = await probe();
  log("verb distribution:", JSON.stringify(fin?.stats?.byVerb));
  log("unposed:", fin?.stats?.unposed, "byType:", JSON.stringify(fin?.stats?.unposedByType).slice(0, 600));
  log("posed:", fin?.stats?.posed, "respondHeard:", fin?.stats?.respondHeard, "masteryHeard:", fin?.stats?.masteryHeard, "correct:", fin?.stats?.correct);

  const hist = await d.run(() => window.__hist.slice(0, 120));
  const kps = {};
  for (const h of hist) if (h.t === "present") kps[h.kpId] = (kps[h.kpId] ?? 0) + 1;
  log("knowledge points presented:", JSON.stringify(kps));
  log("responses:", JSON.stringify(hist.filter((h) => h.t === "respond").slice(0, 12), null, 1).slice(0, 2000));
  log("mastery events:", JSON.stringify(hist.filter((h) => h.t === "mastery")).slice(0, 600));

  log("\nconsole errors:", d.consoleErrors.slice(0, 5));
});
