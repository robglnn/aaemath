// P19 scratch: what does the shipped app actually put in front of a player, item by item?
// Reads the presenter's probe after each response so the verb layer is built against the real
// serving order, not against the catalogue's average.
import { openGame } from "../../tools/lib/session.mjs";

await openGame({ width: 900, height: 600 }, async (d) => {
  await d.play(1.0);
  await d.page.keyboard.press("KeyE");
  await d.play(0.6);

  const rows = [];
  for (let i = 0; i < 8; i++) {
    const p = await d.probe("teaching");
    rows.push({
      i,
      phase: p?.phase,
      item: p?.item,
      stood: (p?.stood ?? []).map((r) => `${r.kind}:${r.tex}`),
      ask: p?.prose?.ask,
    });
    // Answer with the empty string is refused; type something so the cycle advances.
    await d.page.keyboard.press("Digit1");
    await d.play(0.4);
    await d.page.keyboard.press("Enter");
    await d.play(2.6);
  }
  console.log(JSON.stringify(rows, null, 1));
  console.log("console errors:", d.consoleErrors.slice(0, 5));
});
