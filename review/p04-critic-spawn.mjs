// Proves the consequence of Locomotion._spawn()'s groundAt() argument order when a REAL world
// registers a collider (which deletes the stand-in proving ground and its fallbackSpawn).
import { openGame } from "../tools/lib/session.mjs";

await openGame({ width: 800, height: 450 }, async (d) => {
  const out = await d.run(`(() => {
    const K = window.__vs.kernel; K.halt();
    const L = K.get("locomotion"), C = K.get("collision");
    const THREE = L.root.constructor;
    const before = { pos: L.position.toArray(), fallback: !!C.fallbackSpawn };

    // Stand in for P09: a 200x200 plateau whose surface is 40 m up, centred on the origin.
    const g = new (Object.getPrototypeOf(L.root.children[0].children[0].geometry).constructor)();
    const pos = new Float32Array([
      -100, 40, -100,  -100, 40, 100,  100, 40, 100,
      -100, 40, -100,   100, 40, 100,  100, 40, -100,
    ]);
    g.setAttribute("position", new (Object.getPrototypeOf(
      L.root.children[0].children[0].geometry.getAttribute("position")).constructor)(pos, 3));
    C.registerCollider({ id: "p09:fake-terrain", geometry: g });
    const afterRegister = { fallback: !!C.fallbackSpawn, colliders: C.colliders.size };

    L._spawn();
    const spawned = { pos: L.position.toArray().map(v => +v.toFixed(3)) };

    // let it settle for two seconds of game time
    for (let i = 0; i < 120; i++) K.advance(1/60, { render: false });
    const settled = {
      pos: L.position.toArray().map(v => +v.toFixed(3)),
      grounded: L.grounded, y: +L.position.y.toFixed(3), state: L.state,
      terrainSurfaceY: 40,
    };
    return { before, afterRegister, spawned, settled };
  })()`);
  console.log(JSON.stringify(out, null, 2));
});
