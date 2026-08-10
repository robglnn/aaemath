// Settle the facing question with two independent, convention-free measurements plus a picture.
//
// Every previous attempt reasoned from a convention (probe names, source comments, rotation maths)
// and got it wrong. These three do not care about conventions:
//
//   A. Does the model's authored front (+Z local) point the same way the player is MOVING?
//   B. Does it point the same way the CAMERA is LOOKING? (running forward with a follow camera,
//      the camera looks where you run — so a correct avatar shows us its back, i.e. dot > 0)
//   C. A cropped picture taken at that exact instant, to be looked at.
import { openGame } from "../../tools/lib/session.mjs";

const W = 1000;
const H = 700;

const probe = () => {
  const k = window.__vs?.kernel;
  const av = k?.byName.get("avatar");
  // `body` carries the yaw; `root` carries only position and never rotates. Reading `root` first
  // meant every "facing" number measured an object that cannot turn — which is why three rounds of
  // measurement all returned the same value no matter what the code did.
  const body = av?.body ?? av?.root;
  if (!body) return { error: "no avatar" };

  const V = k.camera.position.constructor;
  const before = body.getWorldPosition(new V());
  for (let i = 0; i < 15; i++) window.__vs.advance(1 / 60);
  const after = body.getWorldPosition(new V());

  const vx = after.x - before.x;
  const vz = after.z - before.z;
  const sp = Math.hypot(vx, vz);

  const bm = body.matrixWorld.elements;
  const fx = bm[8];
  const fz = bm[10]; // body local +Z in world
  const fl = Math.hypot(fx, fz) || 1;

  const cm = k.camera.matrixWorld.elements;
  const cx = -cm[8];
  const cz = -cm[10]; // camera looks down its local -Z
  const cl = Math.hypot(cx, cz) || 1;

  const screen = new V();
  body.getWorldPosition(screen);
  screen.y += 0.9;
  screen.project(k.camera);

  return {
    speed: Number(sp.toFixed(3)),
    frontVsMotion: sp > 0.05 ? Number((((vx / sp) * fx + (vz / sp) * fz) / fl).toFixed(3)) : null,
    frontVsCameraLook: Number((((cx / cl) * fx + (cz / cl) * fz) / fl).toFixed(3)),
    screenX: ((screen.x + 1) / 2) * k.renderer.domElement.clientWidth,
    screenY: ((1 - screen.y) / 2) * k.renderer.domElement.clientHeight,
    onScreen: screen.z < 1,
  };
};

await openGame({ width: W, height: H }, async (d) => {
  await d.play(1.2);
  await d.hold("KeyW", 1.8, { release: false });
  const r = await d.run(probe);

  const CROP = 420;
  if (r.onScreen) {
    await d.shoot("review/shots/truth-running.png", {
      clip: {
        x: Math.max(0, Math.min(W - CROP, r.screenX - CROP / 2)),
        y: Math.max(0, Math.min(H - CROP, r.screenY - CROP / 2)),
        width: CROP,
        height: CROP,
      },
    });
  } else {
    await d.shoot("review/shots/truth-running.png");
  }
  await d.page.keyboard.up("KeyW");

  console.log(JSON.stringify(r, null, 2));
  console.log(
    "\nfrontVsMotion      +1 = model's front leads the movement (correct), -1 = running backwards" +
      "\nfrontVsCameraLook  +1 = front points where the camera looks, so we see its BACK (correct)" +
      "\n                   -1 = front points at the camera, so we see its FACE (wrong)" +
      "\nreview/shots/truth-running.png — look at it and settle any disagreement."
  );
});
