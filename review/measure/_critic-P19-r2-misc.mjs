// Answer wrongly with the item's OWN tagged misconception (var-must-differ -> fail.twin).
// Item: var-meaning.seat/generate, given t = 5, answer "two sockets, different names, SAME value".
// The tagged distractor is a=7;b=8 — different names, DIFFERENT values. Build p=5,q=6.
import { openGame } from "../../tools/lib/session.mjs";
const log = (...a) => console.log(...a);
const SL = 1 / 8;

await openGame({ width: 1280, height: 720 }, async (d) => {
  const play = (s) => d.play(s, SL);
  await play(1.0);
  await d.run(() => {
    window.__r = [];
    window.__vs.kernel.signals.on("learn:respond", (v) =>
      window.__r.push({ family: v?.family, form: v?.form, correct: v?.correct, scored: v?.scored, credited: v?.credited, misconception: v?.misconception, response: v?.response })
    );
    return true;
  });

  for (let i = 0; i < 4; i++) {
    await d.page.keyboard.down("KeyW"); await play(0.8); await d.page.keyboard.up("KeyW");
    await d.page.keyboard.press("KeyE"); await play(0.6);
    const p = await d.probe("verbs");
    if (p?.phase === "performing") break;
  }
  let v = await d.probe("verbs");
  log("item:", JSON.stringify(v?.item));
  log("mode:", v?.state?.mode, "sockets:", JSON.stringify(v?.state?.sockets));

  const take = async (n) => { for (let i = 0; i < n; i++) { await d.page.mouse.down(); await play(0.05); await d.page.mouse.up(); await play(0.03); } };

  // socket p -> 5 ; socket q -> 6.  DIFFERENT names, DIFFERENT values == var-must-differ
  await take(5);
  await d.page.keyboard.press("BracketRight"); await play(0.15);
  await take(6);
  v = await d.probe("verbs");
  log("built:", v?.entry, "| rows:", JSON.stringify(v?.rows).slice(0, 220));

  await d.page.keyboard.press("KeyE");
  await play(1.6);
  v = await d.probe("verbs");
  log("\nlastResponse:", JSON.stringify(v?.lastResponse));
  log("WHAT THE WORLD SAID:", JSON.stringify((v?.rows ?? []).filter((r) => r.id.includes("read"))));
  log("on the wire:", JSON.stringify(await d.run(() => window.__r)));
  await d.shoot("review/shots/critic-P19r2/misconception-720.png");
  log("errors:", d.consoleErrors.slice(0, 3));
});
