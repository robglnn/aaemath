// P19 scratch: are the verb's rows actually standing where the camera can see them?
import { openGame } from "../../tools/lib/session.mjs";

await openGame({ width: 1280, height: 720 }, async (d) => {
  await d.play(1.0, 1 / 10);
  const wire = {
    itemId: "probe/1",
    kpId: "eq-two-step",
    form: "construct",
    item: { id: "probe/1", stem: "5x + 1 = 21", given: [], working: [], unknown: "x", answerType: "rational", objectClass: "Span", form: "construct" },
  };
  await d.run((p) => {
    window.__vs.kernel.signals.emit("learn:present", p);
    return true;
  }, wire);
  await d.play(0.4, 1 / 10);

  const out = await d.run(() => {
    const cam = window.__vs.kernel.camera;
    cam.updateMatrixWorld();
    const m = cam.matrixWorld.elements;
    return {
      camera: { pos: [m[12], m[13], m[14]], fwd: [-m[8], -m[9], -m[10]], fov: cam.fov, near: cam.near, far: cam.far },
      verbs: window.__vs.probe("verbs"),
      mathtex: window.__vs.probe("mathtex"),
      tex: window.__vs.probe("tex"),
    };
  });
  console.log(JSON.stringify({ camera: out.camera, rows: out.verbs?.rows, standing: out.verbs?.standing, phase: out.verbs?.phase }, null, 1));
  console.log("mathtex:", JSON.stringify(out.mathtex, null, 1).slice(0, 3000));
  console.log("tex failures:", JSON.stringify(out.tex?.failures ?? null).slice(0, 2000));
  console.log("console:", d.consoleErrors.slice(0, 5), d.consoleWarnings.slice(-6));
});
