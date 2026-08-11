import { openGame } from "../../tools/lib/session.mjs";
await openGame({ width: 1280, height: 720 }, async (d) => {
  await d.play(1.0);
  for (let turn = 0; turn < 3; turn += 1) {
    await d.page.keyboard.press("KeyE");
    await d.play(0.5);
    let v = await d.probe("verbs");
    console.log(`\n--- turn ${turn}: phase=${v?.phase} verb=${v?.verb} item=${v?.item?.itemId} form=${v?.item?.form} at=${v?.item?.answerType}`);
    console.log("   stem:", JSON.stringify(v?.item?.stem), "state:", JSON.stringify(v?.state)?.slice(0,240));
    for (let k = 0; k < 3; k += 1) {
      await d.page.mouse.down({ button: "left" }); await d.play(0.12);
      await d.page.mouse.up({ button: "left" }); await d.play(0.1);
    }
    v = await d.probe("verbs");
    console.log("   after 3 clicks — state:", JSON.stringify(v?.state)?.slice(0,300));
    console.log("   entry:", JSON.stringify(v?.entry), "teaching.open:", JSON.stringify((await d.probe("teaching"))?.open), "phase:", JSON.stringify((await d.probe("teaching"))?.phase));
    await d.page.keyboard.press("KeyE");
    await d.play(2.0);
    v = await d.probe("verbs");
    console.log("   after set down — letGos:", v?.letGos, "committed:", v?.stats?.committed, "last:", JSON.stringify(v?.lastResponse)?.slice(0,200));
  }
});
