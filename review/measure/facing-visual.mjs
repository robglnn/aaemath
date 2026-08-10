// Look at the character the way the PLAYER sees them.
//
// An earlier version parked a camera manually and rendered a frame from inside a rock. Worse, the
// round before that diagnosed this bug from probe numbers alone and declared it fixed while a player
// could still see it was wrong. So: use the game's real gameplay camera, find where the avatar lands
// on screen, and crop tightly around it. No custom framing, no assumptions — a magnified view of
// exactly what is on the player's monitor.
import { openGame } from "../../tools/lib/session.mjs";

const locate = () => {
  const vs = window.__vs;
  const k = vs?.kernel;
  if (!k) return { error: "no kernel" };
  const av = k.byName.get("avatar");
  const body = av?.root ?? av?.body;
  if (!body) return { error: "no avatar mounted", systems: [...k.byName.keys()] };

  const v = new k.camera.position.constructor();
  body.getWorldPosition(v);
  v.y += 0.9; // chest height, so the crop centres on torso and arms
  v.project(k.camera);

  const w = k.renderer.domElement.clientWidth;
  const h = k.renderer.domElement.clientHeight;
  return {
    x: ((v.x + 1) / 2) * w,
    y: ((1 - v.y) / 2) * h,
    onScreen: v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2,
    yawDeg: Number((((av._yaw ?? body.rotation.y) * 180) / Math.PI).toFixed(1)),
    viewport: [w, h],
  };
};

const W = 1100;
const H = 700;

await openGame({ width: W, height: H }, async (d) => {
  await d.play(1.2);

  const shots = [];
  for (const [name, key, secs] of [
    ["run-forward", "KeyW", 1.4],
    ["strafe-right", "KeyD", 1.2],
    ["strafe-left", "KeyA", 1.2],
  ]) {
    await d.hold(key, secs, { release: false });
    const loc = await d.run(locate);
    if (loc.error || !loc.onScreen) {
      shots.push({ name, ...loc, note: "avatar not on screen — full frame captured instead" });
      await d.shoot(`review/shots/look-${name}.png`);
    } else {
      const size = 340;
      const clip = {
        x: Math.max(0, Math.min(W - size, loc.x - size / 2)),
        y: Math.max(0, Math.min(H - size, loc.y - size / 2)),
        width: size,
        height: size,
      };
      await d.shoot(`review/shots/look-${name}.png`, { clip });
      shots.push({ name, screen: [Math.round(loc.x), Math.round(loc.y)], yawDeg: loc.yawDeg });
    }
    await d.page.keyboard.up(key);
    await d.play(0.4);
  }

  console.log(JSON.stringify(shots, null, 2));
  console.log(
    "\nrun-forward   : the camera is behind, so we must see the character's BACK.\n" +
      "strafe-right  : holding D. The body should slide toward the RIGHT of the image.\n" +
      "strafe-left   : holding A. The body should slide toward the LEFT of the image."
  );
});
