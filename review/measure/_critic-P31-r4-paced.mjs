#!/usr/bin/env node
/**
 * CRITIC-OWNED. The question P31's own live probe does not answer: of the items a learner is
 * actually served during play in the BUILT game, how many came from the generator BECAUSE THE
 * CHUNK HAD NOT ARRIVED (`generated-group-absent` / `-failed`) rather than because the catalogue
 * had nothing matching (`generated`)?
 *
 * Two passes, same page, same shipped `learning.next()/submit()` loop:
 *   TIGHT  — no gap between items (the shape of P31's own E7 probe).
 *   PACED  — a gap between items, so requestIdleCallback actually gets to run, which is the only
 *            way the speculative load in `ItemBank.touch()` can ever fire. A real learner is
 *            20-40 s per item, so PACED is the generous, learner-like case.
 * Then a settle, and residency is read again — so "never requested" and "requested, had not
 * landed" are told apart instead of guessed at.
 */
import fs from "node:fs";
import path from "node:path";
import { openGame, ROOT } from "../../tools/lib/session.mjs";

const KP_IDS = JSON.parse(fs.readFileSync(path.join(ROOT, "content/knowledge-graph.json"), "utf8")).nodes.map(
  (n) => n.id
);
const base = (u) => String(u).split("/").pop().split("?")[0];
const isGroup = (n) => KP_IDS.some((id) => n === `${id}.js` || n.startsWith(`${id}-`));

const out = await openGame({ built: true, width: 640, height: 360 }, async (d) => {
  await d.run(async () => {
    const s = window.__vs?.kernel?.get?.("itembank");
    if (s?.warmed) await s.warmed();
  });
  await d.run(() => new Promise((r) => setTimeout(r, 600)));

  const drive = (gapMs, n) =>
    d.run(
      async ([gap, count]) => {
        const L = window.__vs.kernel.get("learning");
        const rows = [];
        let unserved = 0;
        L.beginSession?.();
        for (let i = 0; i < count; i += 1) {
          const req = L.next?.();
          if (!req) {
            L.endSession?.();
            L.beginSession?.();
            continue;
          }
          if (!req.item) {
            unserved += 1;
            L.submit?.(req, { correct: false, latencyMs: 20000, itemId: `blank#${i}` });
            continue;
          }
          rows.push({ kpId: req.kpId, source: req.itemSource, relaxation: req.itemRelaxation });
          L.submit?.(req, { correct: i % 3 !== 0, latencyMs: 20000, itemId: req.item.id, family: req.family });
          if (gap > 0) await new Promise((r) => setTimeout(r, gap));
        }
        L.endSession?.();
        return { rows, unserved };
      },
      [gapMs, n]
    );

  const settle = () => d.run(() => new Promise((r) => setTimeout(r, 2500)));
  const state = () =>
    d.run(() => ({
      probe: window.__vs.probe("itembank"),
      groups: performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .filter(Boolean),
    }));

  const tight = await drive(0, 120);
  await settle();
  const afterTight = await state();
  const paced = await drive(60, 90);
  await settle();
  const afterPaced = await state();

  const mix = (rows) =>
    rows.reduce((a, r) => ((a[`${r.source}/${r.relaxation}`] = (a[`${r.source}/${r.relaxation}`] ?? 0) + 1), a), {});

  return {
    tight: { items: tight.rows.length, unserved: tight.unserved, kps: [...new Set(tight.rows.map((r) => r.kpId))].length, mix: mix(tight.rows) },
    afterTight: {
      resident: afterTight.probe.residentGroups?.length ?? null,
      chunksFetched: [...new Set(afterTight.groups.map(base).filter(isGroup))].length,
      loads: afterTight.probe.loads ?? null,
    },
    paced: { items: paced.rows.length, unserved: paced.unserved, kps: [...new Set(paced.rows.map((r) => r.kpId))].length, mix: mix(paced.rows) },
    afterPaced: {
      resident: afterPaced.probe.residentGroups?.length ?? null,
      residentGroups: afterPaced.probe.residentGroups,
      chunksFetched: [...new Set(afterPaced.groups.map(base).filter(isGroup))],
      loads: afterPaced.probe.loads ?? null,
      degraded: afterPaced.probe.degraded,
    },
    consoleErrors: d.consoleErrors.slice(0, 5),
  };
});

console.log(JSON.stringify(out, null, 1));
