import { openGame } from "../tools/lib/session.mjs";

await openGame({ width: 960, height: 540 }, async (d) => {
  await d.play(2.5);
  const out = await d.run(() => {
    const s = window.__vs.kernel.get("scatter");
    const eye = s._eye;
    const rows = {};
    for (const cat of s.categories) {
      let n = 0;
      let inRange = 0;
      let minD = Infinity;
      let maxD = 0;
      const tiles = [];
      for (const t of cat.tiles.values()) {
        tiles.push({ c: t.count, d: Math.sqrt(t._d ?? -1) });
        for (let i = 0; i < t.count; i++) {
          const o = i * 16;
          const dx = t.mat[o + 12] - eye.x;
          const dy = t.mat[o + 13] - eye.y;
          const dz = t.mat[o + 14] - eye.z;
          const dd = Math.sqrt(dx * dx + dy * dy + dz * dz);
          n++;
          minD = Math.min(minD, dd);
          maxD = Math.max(maxD, dd);
          if (dd <= cat.gather) inRange++;
        }
      }
      rows[cat.id] = {
        n,
        inRange,
        gather: cat.gather,
        minD: Number(minD.toFixed(1)),
        maxD: Number(maxD.toFixed(1)),
        drawn: cat.lods.map((l) => l.drawn),
        cap: cat.lods.map((l) => l.capacity),
        tilesWithContent: tiles.filter((t) => t.c > 0).length,
        tiles: tiles.length,
      };
    }
    return { eye: [eye.x, eye.y, eye.z], rows };
  });
  console.log(JSON.stringify(out, null, 1));
});
