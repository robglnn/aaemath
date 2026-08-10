import { openGame } from "../../tools/lib/session.mjs";
import { installToolkit } from "./p11-toolkit.mjs";
await openGame({ width: 1280, height: 720, tier: "medium" }, async (d) => {
  d.page.on("crash", () => console.log("PAGE CRASH"));
  d.page.on("framenavigated", (f) => console.log("NAV", f.url()));
  await d.play(0.6);
  await d.run(() => { const K = window.__vs.kernel; K.composer = null; return K.byName.get("lighting").materialBoard({ view: "wide" }); });
  console.log("board ok");
  await d.page.evaluate(installToolkit);
  console.log("toolkit ok");
  await d.play(0.4);
  console.log("play ok");
  console.log("grab", JSON.stringify(await d.run(() => window.__p11.grab())));
  console.log("rig", JSON.stringify(await d.run(() => window.__p11.rig())).slice(0,300));
  console.log("faces", JSON.stringify(await d.run(() => window.__p11.faces("vs.board.spire").length)));
  console.log("regions", JSON.stringify(await d.run(() => window.__p11.regions(2,0.0002).length)));
  console.log("errors", JSON.stringify(d.consoleErrors.slice(0,8)));
});
