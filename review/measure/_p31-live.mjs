#!/usr/bin/env node
/**
 * review/measure/_p31-live.mjs — what the REAL BUILT GAME actually downloads, and when.
 *
 *   node review/measure/_p31-live.mjs            # writes review/measure/evidence/P31-live-probe.json
 *
 * P31's round-2 critic drove the built app's scheduler for 117 items and it pulled 0 of the 32
 * group chunks. The lesson: a claim about per-lesson loading is worth nothing measured on a bank
 * the measuring script constructed itself. So this file measures the shipped page and nothing else.
 *
 * It reads `performance.getEntriesByType("resource")` — the browser's own record of every byte it
 * fetched — at two moments:
 *
 *   AT READY     the app has reported `ready`. Every chunk here was on the critical path.
 *   AFTER WARM   `boot/62-itembank.js`'s idle warm has resolved. The difference is exactly what
 *                per-lesson loading pulled, and it must be non-empty or the loader has no caller.
 *
 * Nothing is rendered and no screenshot is taken — a human is playtesting on this machine, and a
 * capture would cost them frames for a question that pixels cannot answer anyway.
 */

import fs from "node:fs";
import path from "node:path";
import { openGame, ROOT } from "../../tools/lib/session.mjs";

const KP_IDS = JSON.parse(fs.readFileSync(path.join(ROOT, "content/knowledge-graph.json"), "utf8")).nodes.map(
  (n) => n.id
);

const base = (url) => String(url).split("/").pop().split("?")[0];
const isGroupChunk = (name) => KP_IDS.some((id) => name === `${id}.js` || name.startsWith(`${id}-`));
const isItemLocale = (name) => /^items-(en|es|pl)-/.test(name) || /^items-(en|es|pl)\.js$/.test(name);
const isSpine = (name) => name === "spine.js" || name.startsWith("spine-");

const snapshot = () =>
  performance.getEntriesByType("resource").map((e) => ({
    name: e.name,
    startTime: Math.round(e.startTime),
    // `transferSize` is 0 for a memory-cache hit; `encodedBodySize` is the wire size either way.
    encoded: e.encodedBodySize,
  }));

const out = await openGame({ built: true, width: 960, height: 540 }, async (d) => {
  const atReady = await d.run(snapshot);
  const report = await d.report();

  // The idle warm is scheduled inside `requestIdleCallback` during boot. Awaiting the promise the
  // boot module hands back is what makes this deterministic instead of a race against a settle
  // time — and `d.play()` cannot be used here, because it advances the fixed clock inside ONE
  // synchronous page.evaluate and therefore never yields to the browser's idle queue at all.
  const warm = await d.run(async () => {
    const sys = window.__vs?.kernel?.get?.("itembank");
    if (!sys?.warmed) return { error: "boot/62-itembank.js mounted no `warmed()` — the warm has no caller" };
    return await sys.warmed();
  });

  const afterWarm = await d.run(snapshot);
  const probeAfterWarm = await d.probe("itembank");

  // `ensure()` chains `prefetchAround()`, which queues the rest of the lesson and the head of the
  // next one through `requestIdleCallback`. Two idle turns and a tick is what it takes for those
  // to be requested and indexed; without waiting for them the round-2 criticism — "the idle
  // prefetch never runs" — would be answered with "we did not look".
  await d.run(
    () =>
      new Promise((resolve) => {
        const turn = (fn) =>
          typeof requestIdleCallback === "function" ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 30);
        turn(() => turn(() => setTimeout(resolve, 120)));
      })
  );
  const afterPrefetch = await d.run(snapshot);
  const probe = await d.probe("itembank");
  const mastery = await d.probe("mastery");

  return {
    generated: new Date().toISOString(),
    ready: report.ready === true,
    fatal: report.fatal ?? null,
    errors: report.errors ?? [],
    warnings: report.warnings ?? [],
    warm,
    probeAfterWarm,
    probe,
    bankAudit: mastery?.bankAudit ?? null,
    frontier: await d.run(() => window.__vs?.kernel?.get?.("learning")?.frontier?.().slice(0, 4) ?? null),
    resources: { atReady, afterWarm, afterPrefetch },
  };
});

const namesOf = (list) => list.map((r) => base(r.name));
const namesAt = namesOf(out.resources.atReady);
const seenAtReady = new Set(namesAt);
const seenAfterWarm = new Set(namesOf(out.resources.afterWarm));
const newlyPulled = [...new Set(namesOf(out.resources.afterWarm).filter((n) => !seenAtReady.has(n)))];
const prefetched = [...new Set(namesOf(out.resources.afterPrefetch).filter((n) => !seenAfterWarm.has(n)))];

const byName = new Map(out.resources.afterPrefetch.map((r) => [base(r.name), r.encoded]));
const bytes = (names) => names.reduce((a, n) => a + (byName.get(n) ?? 0), 0);
const classify = (names) => ({
  requests: names.length,
  groupChunks: names.filter(isGroupChunk),
  itemLocaleChunks: names.filter(isItemLocale),
  spineChunks: names.filter(isSpine),
  encodedBytes: bytes(names),
});
out.classified = {
  criticalPath: classify(namesAt),
  warmPulled: classify(newlyPulled),
  idlePrefetched: classify(prefetched),
};

const dest = path.join(ROOT, "review/measure/evidence/P31-live-probe.json");
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, JSON.stringify(out, null, 1) + "\n");
console.log(
  JSON.stringify(
    { wrote: path.relative(ROOT, dest), ready: out.ready, warm: out.warm, classified: out.classified },
    null,
    2
  )
);
