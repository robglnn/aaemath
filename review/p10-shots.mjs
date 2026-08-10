// P10 scratch: framed captures with arbitrary query flags, plus a sky-column colour dump.
// node review/p10-shots.mjs --out=review/shots/p10/x --pitch=-320 [--q=post=off,haze=0] [--tier=high]
import { openGame, arg } from "../tools/lib/session.mjs";

const out = arg("out", "review/shots/p10/probe");
const pitch = Number(arg("pitch", "-300"));
const yaw = Number(arg("yaw", "0"));
const tier = arg("tier", "high");
const width = Number(arg("width", "1600"));
const height = Number(arg("height", "900"));
const play = Number(arg("play", "1"));
const query = Object.fromEntries(
  (arg("q", "") || "")
    .split(",")
    .filter(Boolean)
    .map((s) => s.split("="))
);

await openGame({ width, height, tier, query }, async (d) => {
  await d.play(0.4);
  if (yaw || pitch) await d.look(yaw, pitch);
  await d.play(play);
  await d.shoot(`${out}.png`);

  const rep = await d.report();
  console.log(
    JSON.stringify(
      {
        out: `${out}.png`,
        query,
        problems: [
          ...(rep.errors ?? []).slice(0, 3),
          ...d.consoleErrors.slice(0, 3),
          ...d.failedRequests.slice(0, 3),
        ],
        stats: rep.stats,
        skySun: rep.probes?.sky?.sun,
        exposure: rep.probes?.sky?.exposure,
        atmo: rep.probes?.atmosphere && {
          space: rep.probes.atmosphere.space,
          composer: rep.probes.atmosphere.composer,
          near: rep.probes.atmosphere.near,
          far: rep.probes.atmosphere.far,
          bakes: rep.probes.atmosphere.bakes,
        },
        post: rep.probes?.post && {
          installed: rep.probes.post.installed,
          effects: rep.probes.post.effects,
        },
        camera: rep.probes?.camera && {
          pitch: rep.probes.camera.pitchDeg ?? rep.probes.camera.pitch,
          yaw: rep.probes.camera.yawDeg ?? rep.probes.camera.yaw,
        },
      },
      null,
      1
    )
  );
});
