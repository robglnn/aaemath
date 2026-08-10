// Big, clear portraits of the character from behind and from the front, taken with the real
// gameplay camera, out in open light. Purpose: settle "the arms are backwards" by looking, not by
// reasoning about phase maths that reads correct on the page.
import { openGame } from "../../tools/lib/session.mjs";

const W = 1200;
const H = 760;
const CROP = 560;

const locate = () => {
  const k = window.__vs?.kernel;
  const av = k?.byName.get("avatar");
  const body = av?.root ?? av?.body;
  if (!body) return { error: "no avatar" };
  const v = new k.camera.position.constructor();
  body.getWorldPosition(v);
  v.y += 0.95;
  v.project(k.camera);
  return {
    x: ((v.x + 1) / 2) * k.renderer.domElement.clientWidth,
    y: ((1 - v.y) / 2) * k.renderer.domElement.clientHeight,
    onScreen: v.z < 1,
    yawDeg: Number((((av._yaw ?? body.rotation.y) * 180) / Math.PI).toFixed(1)),
  };
};

await openGame({ width: W, height: H }, async (d) => {
  await d.play(1.0);

  // Run well clear of the spawn spire so the character is in open light, not silhouetted.
  await d.hold("KeyW", 3.0, { release: false });

  const shots = [];
  const grab = async (name) => {
    const loc = await d.run(locate);
    if (loc.error || !loc.onScreen) {
      await d.shoot(`review/shots/arms-${name}.png`);
      shots.push({ name, ...loc, note: "full frame" });
      return;
    }
    const clip = {
      x: Math.max(0, Math.min(W - CROP, loc.x - CROP / 2)),
      y: Math.max(0, Math.min(H - CROP, loc.y - CROP / 2)),
      width: CROP,
      height: CROP,
    };
    await d.shoot(`review/shots/arms-${name}.png`, { clip });
    shots.push({ name, yawDeg: loc.yawDeg, screen: [Math.round(loc.x), Math.round(loc.y)] });
  };

  await grab("behind");

  // Orbit the real rig around to the character's front while they keep running.
  await d.look(1400, -60);
  await d.play(0.5);
  await grab("front");

  await d.look(700, 0);
  await d.play(0.5);
  await grab("side");

  await d.page.keyboard.up("KeyW");
  console.log(JSON.stringify(shots, null, 2));
});
