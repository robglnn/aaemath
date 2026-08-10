// Dump every quantity involved in facing, so no step is inferred.
import { openGame } from "../../tools/lib/session.mjs";

await openGame({ width: 900, height: 600 }, async (d) => {
  await d.play(1.2);
  await d.hold("KeyW", 1.5, { release: false });

  const out = await d.run(() => {
    const k = window.__vs?.kernel;
    const names = [...k.byName.keys()];
    const av = k.byName.get("avatar");
    if (!av) return { error: "no avatar system", names };

    const V = k.camera.position.constructor;
    const info = {
      names,
      avatarKeys: Object.keys(av).slice(0, 40),
      hasBody: !!av.body,
      hasRoot: !!av.root,
      _yaw: av._yaw,
      bodyRotY: av.body?.rotation?.y,
      rootRotY: av.root?.rotation?.y,
    };

    const loco = k.byName.get("locomotion");
    info.heading = loco?.heading ? { x: loco.heading.x, y: loco.heading.y } : null;

    const before = new V();
    const target = av.body ?? av.root;
    target.getWorldPosition(before);
    for (let i = 0; i < 15; i++) window.__vs.advance(1 / 60);
    const after = new V();
    target.getWorldPosition(after);

    const vx = after.x - before.x;
    const vz = after.z - before.z;
    const sp = Math.hypot(vx, vz);
    info.velocity = [Number(vx.toFixed(3)), Number(vz.toFixed(3))];

    target.updateMatrixWorld(true);
    const m = target.matrixWorld.elements;
    info.bodyAxisX = [Number(m[0].toFixed(3)), Number(m[2].toFixed(3))];
    info.bodyAxisZ = [Number(m[8].toFixed(3)), Number(m[10].toFixed(3))];
    info._yawAfter = av._yaw;
    info.bodyRotYAfter = av.body?.rotation?.y;

    if (sp > 0.01) {
      const nx = vx / sp;
      const nz = vz / sp;
      const fl = Math.hypot(m[8], m[10]) || 1;
      info.dotPlusZ = Number(((nx * m[8] + nz * m[10]) / fl).toFixed(3));
      const xl = Math.hypot(m[0], m[2]) || 1;
      info.dotPlusX = Number(((nx * m[0] + nz * m[2]) / xl).toFixed(3));
    }
    return info;
  });

  await d.page.keyboard.up("KeyW");
  console.log(JSON.stringify(out, null, 2));
});
