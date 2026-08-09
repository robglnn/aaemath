// Focused: how long does a pad press stay buffered, step by step, versus a keyboard press.
import { openGame } from "../tools/lib/session.mjs";

await openGame({ width: 800, height: 600, query: { bindings: "default" } }, async (d) => {
  const run = (fn, a) => d.page.evaluate(fn, a);
  const step = () => d.advance(1 / 60);

  const trace = async (label, down, up) => {
    await run(() => window.__vs.kernel.get("input").clearAllBuffers());
    await down();
    const rows = [];
    for (let i = 0; i < 20; i++) {
      await step();
      rows.push(
        await run(() => {
          const p = window.__vs.probe("input");
          const j = p.actions.jump;
          return { s: p.step, b: j ? j.buffered : null, h: j ? j.held : null, hold: j ? j.hold : null };
        })
      );
    }
    await up();
    await d.play(0.4);
    const first = rows.findIndex((r) => r.b);
    const last = rows.map((r) => r.b).lastIndexOf(true);
    console.log(label, JSON.stringify({ first, last, steps: last - first + 1, seconds: (last - first + 1) / 60 }));
    console.log("  ", JSON.stringify(rows));
  };

  await run(() => window.__vsInput.connect({ style: "xbox" }));
  await d.play(0.5);

  await trace(
    "PAD  ",
    () => run(() => window.__vsInput.press("A")),
    () => run(() => window.__vsInput.release("A"))
  );
  await trace(
    "KBD  ",
    () => d.page.keyboard.down("Space"),
    () => d.page.keyboard.up("Space")
  );
});
