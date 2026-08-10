import { openGame } from "../tools/lib/session.mjs";

await openGame({ width: 960, height: 540 }, async (d) => {
  await d.play(2.5);
  const out = await d.run(() => {
    const s = window.__vs.kernel.get("scatter");
    const loco = window.__vs.kernel.get("locomotion");
    const eye = s._eye;
    const rows = {};
    for (const cat of s.categories) {
      let n = 0;
      let inRange = 0;
      let minD = Infinity;
      let maxD = 0;
      for (const t of cat.tiles.values()) {
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
      rows[cat.id] = `n=${n} inRange=${inRange} tiles=${cat.tiles.size} drawn=${cat.lods.map((l) => l.drawn)} d=${minD.toFixed(0)}..${maxD.toFixed(0)}`;
    }
    return {
      surface: s.surface.mode,
      queries: s.surface.queries,
      genCalls: s._genCalls,
      genMs: Number(s._genMs.toFixed(1)),
      outstanding: s._outstanding,
      clearings: s._clearings.length,
      solids: s._solidCount,
      eye: [eye.x.toFixed(1), eye.y.toFixed(1), eye.z.toFixed(1)],
      player: loco ? [loco.position.x.toFixed(1), loco.position.y.toFixed(1), loco.position.z.toFixed(1)] : null,
      islands: s.islands.stats,
      rows,
    };
  });
  console.log(JSON.stringify(out, null, 1));
});
