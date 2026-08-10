#!/usr/bin/env node
/**
 * CRITIC-OWNED. Break a group chunk for REAL — rename the built file so `vite preview` 404s it —
 * and drive the SHIPPED gameplay path. No `__faultGroup`, no test hook, no harness-built bank.
 *
 *   node review/measure/_critic-P31-r4-break.mjs [kpToBreak]
 */
import fs from "node:fs";
import path from "node:path";
import { openGame, ROOT } from "../../tools/lib/session.mjs";

const VICTIM = process.argv[2] ?? "expr-anatomy";
const KP_IDS = JSON.parse(fs.readFileSync(path.join(ROOT, "content/knowledge-graph.json"), "utf8")).nodes.map(
  (n) => n.id
);
const ASSETS = path.join(ROOT, "dist/assets");
const BREAK = VICTIM !== "none";
const hit = BREAK ? fs.readdirSync(ASSETS).find((f) => f === `${VICTIM}.js` || f.startsWith(`${VICTIM}-`)) : null;
if (BREAK && !hit) throw new Error(`no built chunk for ${VICTIM}`);
const from = hit ? path.join(ASSETS, hit) : null;
const to = hit ? `${from}.hidden` : null;

const base = (u) => String(u).split("/").pop().split("?")[0];
const isGroup = (n) => KP_IDS.some((id) => n === `${id}.js` || n.startsWith(`${id}-`));

if (BREAK) fs.renameSync(from, to);
let out;
try {
  out = await openGame({ built: true, width: 640, height: 360 }, async (d) => {
    const rep0 = await d.report();

    // Let the boot warm + prefetch resolve, exactly as _p31-live does.
    const warm = await d.run(async () => {
      const sys = window.__vs?.kernel?.get?.("itembank");
      if (!sys?.warmed) return { error: "no warmed()" };
      return await sys.warmed();
    });
    await d.run(
      () =>
        new Promise((r) => {
          const t = (f) => (typeof requestIdleCallback === "function" ? requestIdleCallback(f, { timeout: 1500 }) : setTimeout(f, 30));
          t(() => t(() => setTimeout(r, 300)));
        })
    );

    // THE SHIPPED GAMEPLAY LOOP. Nothing here touches the bank; items arrive on `req.item`
    // through Scheduler.serve() -> ItemBank.select(), which is what boot/63-learnserve wires.
    const t0 = Date.now();
    const play = await d.run(async (victim) => {
      const L = window.__vs?.kernel?.get?.("learning");
      if (!L?.next) return { error: "no learning system" };
      const rows = [];
      let unserved = 0;
      const started = performance.now();
      L.beginSession?.();
      for (let i = 0; i < 200; i += 1) {
        if (performance.now() - started > 60000) break;
        const req = L.next?.();
        if (!req) {
          L.endSession?.();
          L.beginSession?.();
          continue;
        }
        const item = req.item ?? null;
        if (!item) {
          unserved += 1;
          L.submit?.(req, { correct: false, latencyMs: 20000, itemId: `blank#${i}` });
          continue;
        }
        // Is what the learner would SEE actually there? present() is what a presenter draws.
        let shown = null;
        try {
          const bank = window.__vs.kernel.get("itembank");
          shown = null;
        } catch {}
        const accepts = req.itemAccepts ?? null;
        rows.push({
          kpId: req.kpId,
          id: item.id,
          source: req.itemSource ?? null,
          relaxation: req.itemRelaxation ?? null,
          hasPrompt: !!(item.prompt || item.text || item.stem || item.tex),
          answer: item.answer?.canonical ?? null,
        });
        L.submit?.(req, { correct: i % 3 !== 0, latencyMs: 20000, itemId: item.id, family: req.family });
        if (i % 25 === 0) await new Promise((r) => setTimeout(r, 0));
      }
      L.endSession?.();
      const ib = window.__vs.kernel.get("itembank");
      return {
        rows,
        unserved,
        ms: Math.round(performance.now() - started),
        probe: window.__vs.probe?.("itembank") ?? null,
        resources: performance
          .getEntriesByType("resource")
          .map((e) => ({ n: e.name, enc: e.encodedBodySize, st: Math.round(e.startTime) })),
        victim,
      };
    }, VICTIM);
    const wall = Date.now() - t0;

    const rep = await d.report();
    return {
      victim: VICTIM,
      hiddenFile: hit,
      ready: rep?.ready ?? rep0?.ready ?? null,
      fatal: rep?.fatal ?? null,
      warnings: (rep?.warnings ?? []).filter((w) => /itembank|bank|group/i.test(String(w))),
      allWarningCount: (rep?.warnings ?? []).length,
      consoleErrors: d.consoleErrors.slice(0, 10),
      failedRequests: d.failedRequests.slice(0, 10),
      wallMs: wall,
      play: play?.error
        ? play
        : {
            items: play.rows.length,
            unserved: play.unserved,
            ms: play.ms,
            kps: [...new Set(play.rows.map((r) => r.kpId))].length,
            onVictim: play.rows.filter((r) => r.kpId === VICTIM).length,
            onVictimSources: [...new Set(play.rows.filter((r) => r.kpId === VICTIM).map((r) => `${r.source}/${r.relaxation}`))],
            relaxationMix: play.rows.reduce((a, r) => ((a[`${r.source}/${r.relaxation}`] = (a[`${r.source}/${r.relaxation}`] ?? 0) + 1), a), {}),
            firstTenPerKp: Object.fromEntries(
              [...new Set(play.rows.map((r) => r.kpId))].map((k) => [
                k,
                play.rows.filter((r) => r.kpId === k).slice(0, 6).map((r) => r.relaxation),
              ])
            ),
            noPrompt: play.rows.filter((r) => !r.hasPrompt).length,
            noAnswer: play.rows.filter((r) => r.answer == null).length,
            sources: play.rows.reduce((a, r) => ((a[r.source] = (a[r.source] ?? 0) + 1), a), {}),
            groupChunksFetched: [...new Set(play.resources.map((r) => base(r.n)).filter(isGroup))],
            victimChunkEntries: play.resources.filter((r) => base(r.n).startsWith(VICTIM)).map((r) => ({ n: base(r.n), enc: r.enc })),
            probeDegraded: play.probe?.degraded ?? null,
            probeResident: (play.probe?.residentGroups ?? []).length,
          },
    };
  });
} finally {
  if (BREAK) fs.renameSync(to, from);
}

console.log(JSON.stringify(out, null, 1));
