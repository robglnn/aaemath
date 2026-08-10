// Is the mathematics ON SCREEN during the seconds the verb is being performed?
// Work the verb with the trigger (body still) and with the stick (body walks), and measure
// where every standing row projects to in a 1280x720 frame.
import { openGame } from "../../tools/lib/session.mjs";

const project = () => {
  const k = window.__vs.kernel;
  const cam = k.camera;
  cam.updateMatrixWorld(true);
  const p = window.__vs.probe("verbs");
  const w = innerWidth, h = innerHeight;
  const out = [];
  const scene = k.scene;
  const inv = cam.projectionMatrix.clone().multiply(cam.matrixWorldInverse);
  scene.traverse((o) => {
    if (!o.userData?.vsTex) return;
    o.updateWorldMatrix(true, false);
    const e = o.matrixWorld.elements;
    const x = e[12], y = e[13], z = e[14];
    const m = inv.elements;
    const cw = m[3]*x + m[7]*y + m[11]*z + m[15];
    const cx = (m[0]*x + m[4]*y + m[8]*z + m[12]) / cw;
    const cy = (m[1]*x + m[5]*y + m[9]*z + m[13]) / cw;
    const sx = Math.round((cx*0.5+0.5)*w), sy = Math.round((-cy*0.5+0.5)*h);
    out.push({ id: o.userData.vsTex.id, at: [Math.round(x*10)/10, Math.round(y*10)/10, Math.round(z*10)/10], sx, sy, behind: cw <= 0, onScreen: cw > 0 && sx >= 0 && sx <= w && sy >= 0 && sy <= h, visible: o.visible });
  });
  return { verb: p?.verb, phase: p?.phase, camY: Math.round(cam.position.y*10)/10, w, h, panels: out };
};

await openGame({ width: 1280, height: 720 }, async (d) => {
  await d.play(1.0);
  await d.run(() => { window.__vs.THREE = window.__THREE ?? null; });

  await d.page.keyboard.press("KeyE");
  await d.play(0.8);

  console.log("== A: posed, body has not moved ==");
  console.log(JSON.stringify(await d.run(project), null, 1));
  await d.shoot("review/shots/P19-crit/A-posed-still.png");

  console.log("\n== B: verb worked with the TRIGGER (Mouse0 held) — body does not walk ==");
  await d.page.mouse.down({ button: "left" });
  await d.play(1.6);
  console.log(JSON.stringify(await d.run(project), null, 1));
  await d.shoot("review/shots/P19-crit/B-trigger-worked.png");
  await d.page.mouse.up({ button: "left" });

  console.log("\n== C: verb worked with the STICK (KeyW) — body walks ==");
  await d.hold("KeyW", 1.6);
  console.log(JSON.stringify(await d.run(project), null, 1));
  await d.shoot("review/shots/P19-crit/C-stick-worked.png");

  console.log("\nconsole errors:", d.consoleErrors.length, d.consoleErrors.slice(0, 3));
});
