// P10 scratch: is the screenshot path healthy at this size/tier?
import { openGame, arg } from "../tools/lib/session.mjs";

const width = Number(arg("width", "1280"));
const height = Number(arg("height", "720"));
const tier = arg("tier", "high");

await openGame({ width, height, tier }, async (d) => {
  console.log("loaded");
  await d.page.evaluate(() => window.__vs.advance(1 / 30));
  console.log("advanced once");
  const t = Date.now();
  try {
    await d.page.screenshot({ path: "review/shots/p10/_check.png", timeout: 120000 });
    console.log("screenshot ok in", Date.now() - t, "ms");
  } catch (e) {
    console.log("screenshot FAILED in", Date.now() - t, "ms:", String(e).slice(0, 160));
  }
  console.log("errors:", d.consoleErrors.slice(0, 4));
  console.log("stats:", JSON.stringify(await d.page.evaluate(() => window.__vs.stats())));
});
