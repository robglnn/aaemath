// Which of the five verbs does a real player ever actually MEET?
// Also: can garbage typed by walking be committed with Enter?
import { openGame } from "../../tools/lib/session.mjs";

await openGame({ width: 1280, height: 720 }, async (d) => {
  await d.play(1.0);

  // ---------------------------------------------------------------- the walk-commit test
  await d.page.keyboard.press("KeyE");
  await d.play(0.8);
  await d.hold("KeyW", 0.8);
  await d.hold("KeyA", 0.4);
  await d.hold("KeyS", 0.4);
  let t = await d.probe("teaching");
  console.log("response after walking WASD:", JSON.stringify(t?.response));
  await d.page.keyboard.press("Enter");
  await d.play(1.5);
  const v0 = await d.probe("verbs");
  console.log("lastResponse after ENTER-while-walking:", JSON.stringify(v0?.lastResponse));
  const m0 = await d.run(() => {
    const m = window.__vs.kernel.get("learning")?.mastery;
    return m ? { theta: m.probe().theta, responses: m.probe().responses } : null;
  });
  console.log("mastery after walk-commit:", JSON.stringify(m0));

  // ---------------------------------------------------------------- reachability sweep
  // Answer 20 items as badly/quickly as a bored player and record which verbs posed.
  const seen = {};
  await d.run(() => {
    window.__poses = [];
    window.__vs.kernel.signals.on("learn:present", () => {
      const p = window.__vs.probe("verbs");
      window.__poses.push({ verb: p?.verb ?? null, answerType: p?.item?.answerType ?? null, kp: p?.item?.kpId ?? null, stem: p?.item?.stem ?? null });
    });
    return true;
  });

  for (let i = 0; i < 24; i++) {
    await d.hold("KeyW", 0.7);
    await d.page.keyboard.press("KeyE");
    await d.play(1.4);
  }

  const poses = await d.run(() => window.__poses.slice());
  for (const p of poses) seen[`${p.verb}`] = (seen[`${p.verb}`] ?? 0) + 1;
  console.log("\nverbs actually posed over 24 attempts:", JSON.stringify(seen));
  console.log("answerTypes seen:", JSON.stringify([...new Set(poses.map((p) => p.answerType))]));
  console.log("kps seen:", JSON.stringify([...new Set(poses.map((p) => p.kp))]));
  console.log("sample stems:", JSON.stringify(poses.slice(0, 12).map((p) => p.stem)));

  const v = await d.probe("verbs");
  console.log("\nverbs.stats:", JSON.stringify(v?.stats));
  console.log("console errors:", d.consoleErrors.length, d.consoleErrors.slice(0, 3));
});
