// Scratch: isolate why page.screenshot() stalls with the composer installed.
import { openGame, arg } from "../tools/lib/session.mjs";

const width = Number(arg("width", "1920"));
const height = Number(arg("height", "1080"));
const post = arg("post", null);
const msaa = arg("msaa", null);

const query = {};
if (post) query.post = post;
if (msaa !== null) query.postMsaa = msaa;

await openGame({ width, height, query }, async (d) => {
  await d.play(0.5);
  const t0 = Date.now();
  let shot = "ok";
  try {
    await d.page.screenshot({ path: `review/shots/p12/tmp-${post ?? "tier"}.png`, timeout: 25000 });
  } catch (e) {
    shot = e.name;
  }
  const t1 = Date.now();
  const rep = await d.report();
  console.log(
    JSON.stringify({
      size: [width, height],
      post,
      msaa,
      installed: rep.probes?.post?.installed,
      samples: rep.probes?.post?.samples,
      shot,
      shotMs: t1 - t0,
      errors: rep.errors.slice(0, 3),
    })
  );
});
