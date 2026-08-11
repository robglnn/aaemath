// Requirement 6: can the verb be performed on a gamepad at all?
import { openGame } from "../../tools/lib/session.mjs";

await openGame({ width: 1280, height: 720 }, async (d) => {
  await d.play(1.0);
  await d.run(() => window.__vsInput.connect({ style: "xbox" }));
  await d.play(0.4);
  console.log("device:", JSON.stringify(await d.run(() => window.__vs.probe("input")?.device ?? null)));

  // Pad:X = interact -> take the claim on
  await d.run(() => window.__vsInput.tap("X"));
  await d.play(1.0);
  let v = await d.probe("verbs");
  console.log("after Pad:X — phase:", v?.phase, "verb:", v?.verb, "item:", v?.item?.itemId);
  console.log("state:", JSON.stringify(v?.state));

  // Work with RIGHT TRIGGER (Pad:RT = primary) so the body stays put
  await d.run(() => window.__vsInput.press("RT", 1));
  await d.play(1.4);
  await d.run(() => window.__vsInput.release("RT"));
  await d.play(0.2);
  v = await d.probe("verbs");
  console.log("after RT held 1.4s — state:", JSON.stringify(v?.state));
  console.log("rows:", JSON.stringify(v?.rows));
  await d.shoot("review/shots/P19-crit/D-pad-trigger.png");

  // Second grip: Pad:B = crouch, held
  await d.run(() => window.__vsInput.press("B"));
  await d.run(() => window.__vsInput.press("RT", 1));
  await d.play(1.0);
  await d.run(() => { window.__vsInput.release("RT"); window.__vsInput.release("B"); });
  await d.play(0.2);
  v = await d.probe("verbs");
  console.log("after B+RT (second grip) — state:", JSON.stringify(v?.state));

  // Left stick forward — this both walks the body and works the verb
  await d.run(() => window.__vsInput.stick("left", 0, -1));
  await d.play(1.4);
  await d.run(() => window.__vsInput.stick("left", 0, 0));
  v = await d.probe("verbs");
  console.log("after LEFT STICK forward 1.4s — state:", JSON.stringify(v?.state));
  const t = await d.probe("teaching");
  console.log("teaching.response (pad player cannot type):", JSON.stringify(t?.response));
  await d.shoot("review/shots/P19-crit/E-pad-stick.png");

  // Set down: Pad:X
  await d.run(() => window.__vsInput.tap("X"));
  await d.play(2.0);
  v = await d.probe("verbs");
  console.log("\nafter Pad:X set down — lastResponse:", JSON.stringify(v?.lastResponse));
  console.log("stats:", JSON.stringify(v?.stats));
  console.log("console errors:", d.consoleErrors.length, d.consoleErrors.slice(0, 3));
});
