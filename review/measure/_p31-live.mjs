#!/usr/bin/env node
/**
 * review/measure/_p31-live.mjs — what the REAL BUILT GAME actually downloads, and when.
 *
 *   node review/measure/_p31-live.mjs            # writes review/measure/evidence/P31-live-probe.json
 *
 * P31's round-2 critic drove the built app's scheduler for 117 items and it pulled 0 of the 32
 * group chunks. Round 3's critic drove it for 600 over 19 sessions and got the same answer. The
 * lesson both times: a claim about per-lesson loading is worth nothing measured on a bank the
 * measuring script constructed itself. So this file measures the shipped page and nothing else, and
 * `review/measure/P31.mjs` INVOKES it rather than reading a cache, so no claim can be made about a
 * `dist` that no longer exists.
 *
 * It reads `performance.getEntriesByType("resource")` — the browser's own record of every byte it
 * fetched — around five phases, in this order and for this reason:
 *
 *   AT READY      the app has reported `ready`. Every chunk here was on the critical path.
 *   AFTER WARM    `boot/62-itembank.js`'s idle warm has resolved; then two idle turns for prefetch.
 *   COLD WINDOW   FIRST, while most of the course is still cold: how many items a knowledge point
 *                 in an unwarmed lesson serves from the generator before its chunk lands, over a
 *                 real dynamic import. This cannot be measured in Node, where every group is
 *                 resident before the first statement runs.
 *   CROSSINGS     the learner finishes a lesson, twice, by two different routes — once through the
 *                 engine's own `certify()` (which emits) and once through `snapshot`/`restore`
 *                 (which does not, exactly like `drive()` and like a save being loaded). Round 3
 *                 warmed once at boot and never again; the chunks pulled here are the round-4 claim.
 *   GAMEPLAY      the SHIPPED `learning.next()` / `learning.submit()` loop, which since P32's
 *                 `boot/63-learnserve.js` goes through `Scheduler.serve()` into `ItemBank.select()`.
 *                 Anything new here was pulled by the ON-DEMAND half, by the game, unaided.
 *
 * WHY `learning.drive()` IS NOT USED TO MOVE THE FRONTIER. It cannot. `review/measure/_p31-drivelen.mjs`
 * runs the shipped self-drive offline at 600, 1,200, 2,000, 3,000 and 4,500 items and it parks on
 * `expr-anatomy` every time, so the frontier NEVER leaves `expressions-1` and no lesson boundary is
 * ever crossed. A harness built on it can only ever report "0 new chunks", whatever the loader does.
 * It also builds its own Scheduler with no bank attached, so it never touches the catalogue at all.
 * The crossings below use `Mastery.certify()` — the engine's own entry point, the one a passed
 * retention check calls — and `Mastery.snapshot()`/`restore()`, the shipped save path.
 *
 * Nothing is rendered and no screenshot is taken — a human is playtesting on this machine, and a
 * capture would cost them frames for a question that pixels cannot answer anyway.
 */

import fs from "node:fs";
import path from "node:path";
import { openGame, ROOT } from "../../tools/lib/session.mjs";
import { distKey } from "./_p31-distkey.mjs";

const KP_IDS = JSON.parse(fs.readFileSync(path.join(ROOT, "content/knowledge-graph.json"), "utf8")).nodes.map(
  (n) => n.id
);
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, "content/items/manifest.json"), "utf8"));
const LESSON_KPS = Object.fromEntries(MANIFEST.lessons.map((l) => [l.id, l.kpIds]));
const lessonOf = (kpId) => MANIFEST.lessons.find((l) => l.kpIds.includes(kpId))?.id ?? null;

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

const idleTurns = () =>
  new Promise((resolve) => {
    const turn = (fn) =>
      typeof requestIdleCallback === "function" ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 30);
    turn(() => turn(() => setTimeout(resolve, 150)));
  });

/** The two knowledge points used for the cold-select window: the far end of the course. */
const LAST_LESSON = MANIFEST.lessons[MANIFEST.lessons.length - 1];
const SECOND_LAST = MANIFEST.lessons[MANIFEST.lessons.length - 2];

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
  // next one through `requestIdleCallback`.
  await d.run(idleTurns);
  const afterPrefetch = await d.run(snapshot);
  const probe = await d.probe("itembank");
  const mastery = await d.probe("mastery");
  const learnserve = await d.probe("learnserve");
  const frontier = await d.run(() => window.__vs?.kernel?.get?.("learning")?.frontier?.().slice(0, 4) ?? null);

  /* ---------------------------------------------------- the cold-select window, in a browser */
  const coldWindow = {
    immediate: await d.run(
      (kp) => window.__vs.kernel.get("itembank").coldSelectWindow(kp, { tries: 10, gapMs: 0 }),
      LAST_LESSON.kpIds[0]
    ),
    spaced: await d.run(
      (kp) => window.__vs.kernel.get("itembank").coldSelectWindow(kp, { tries: 5, gapMs: 400 }),
      SECOND_LAST.kpIds[0]
    ),
  };
  await d.run(idleTurns);
  const afterCold = await d.run(snapshot);

  /* ------------------------------------------------------------- crossing 1: the signal route */
  /**
   * The learner finishes the lesson they are on, through `Mastery.certify()` — the engine's own
   * entry point, the one a passed retention check calls, and the one that emits `learn:mastery`.
   * `boot/62-itembank.js` listens to that signal, sees the frontier is in a different lesson, and
   * re-warms.
   */
  const crossing1 = await d.run((kpsByLesson) => {
    const L = window.__vs.kernel.get("learning");
    const lessonOfKp = (kp) => Object.keys(kpsByLesson).find((id) => kpsByLesson[id].includes(kp)) ?? null;
    const before = L.frontier()[0];
    const lesson = lessonOfKp(before);
    for (const kp of kpsByLesson[lesson]) L.mastery.certify(kp, { intervalDays: 90, dueAtMinutes: 1e9 });
    const after = L.frontier()[0];
    return { before, lessonBefore: lesson, after, lessonAfter: lessonOfKp(after) };
  }, LESSON_KPS);
  await d.run(() => new Promise((r) => setTimeout(r, 900)));
  await d.run(idleTurns);
  const afterCross1 = await d.run(snapshot);
  const probeAfterCross1 = await d.probe("itembank");

  /* --------------------------------------------------------- crossing 2: the idle-recheck route */
  /**
   * The same move with NO signal at all. `Mastery.snapshot()` / `restore()` is the shipped save
   * path; it emits nothing, exactly like `learning.drive()`'s swap. If the warm only followed
   * signals, this crossing would be missed and the learner would meet the next lesson cold. The
   * boot module's bounded idle re-check is what catches it, and `warmLog[].trigger` says so.
   */
  const crossing2 = await d.run((kpsByLesson) => {
    const L = window.__vs.kernel.get("learning");
    const lessonOfKp = (kp) => Object.keys(kpsByLesson).find((id) => kpsByLesson[id].includes(kp)) ?? null;
    const before = L.frontier()[0];
    const lesson = lessonOfKp(before);
    const snap = L.mastery.snapshot();
    const carriedScheduler = !!snap.scheduler;
    for (const kp of kpsByLesson[lesson]) {
      const s = snap.kps[kp];
      if (!s) continue;
      s.status = "mastered";
      s.everMastered = true;
      s.everUnlocked = true;
      s.event = null;
      s.nextEventAt = 1e9;
    }
    const restored = L.mastery.restore(snap);
    const after = L.frontier()[0];
    return { before, lessonBefore: lesson, after, lessonAfter: lessonOfKp(after), restored, carriedScheduler };
  }, LESSON_KPS);
  // Past the boot module's idle re-check period (5 s) plus margin, then let the loads land.
  await d.run(() => new Promise((r) => setTimeout(r, 7000)));
  await d.run(idleTurns);
  const afterCross2 = await d.run(snapshot);
  const probeAfterCross2 = await d.probe("itembank");
  const warmStateAfterCrossings = await d.run(() => window.__vs.kernel.get("itembank").warmState());

  /* ------------------------------------------------------------- the 50% next-lesson lookahead */
  /**
   * Half a lesson later, not a whole one. `prefetchAround` only ever took the HEAD of the next
   * lesson, so its second knowledge point was cold at the boundary. Certifying one knowledge point
   * of the lesson the learner is now on puts them at or past halfway; the boot module's frontier
   * check sees the lesson has NOT changed and evaluates the lookahead instead, which queues the
   * whole next lesson during idle. Nothing here touches the bank.
   */
  const lookahead = await d.run((kpsByLesson) => {
    const L = window.__vs.kernel.get("learning");
    const lessonOfKp = (kp) => Object.keys(kpsByLesson).find((id) => kpsByLesson[id].includes(kp)) ?? null;
    const head = L.frontier()[0];
    const lesson = lessonOfKp(head);
    const ids = kpsByLesson[lesson];
    const order = Object.keys(kpsByLesson);
    const nextLesson = order[order.indexOf(lesson) + 1] ?? null;
    // Certify up to half of this lesson, so the learner is at the halfway mark and not past its end.
    const half = Math.max(1, Math.floor(ids.length / 2));
    for (const kp of ids.slice(0, half)) L.mastery.certify(kp, { intervalDays: 90, dueAtMinutes: 1e9 });
    return { lesson, certified: ids.slice(0, half), nextLesson, nextLessonKps: kpsByLesson[nextLesson] ?? [], frontier: L.frontier().slice(0, 3) };
  }, LESSON_KPS);
  await d.run(() => new Promise((r) => setTimeout(r, 6500)));
  await d.run(idleTurns);
  const afterLookahead = await d.run(snapshot);
  const warmStateAfterLookahead = await d.run(() => window.__vs.kernel.get("itembank").warmState());
  const probeAfterLookahead = await d.probe("itembank");

  /* ------------------------------------------------- the on-demand half, driven by the game */
  /**
   * `learning.next()` is `Scheduler.next()`, which draws every item through
   * `Scheduler.serve(req, bank)` -> `ItemBank.select()`. Nothing in this loop reaches into the
   * bank, so every group chunk that appears afterwards was pulled by `select()`'s own cold path.
   */
  const played = await d.run(async ({ sessions, perSession }) => {
    const L = window.__vs?.kernel?.get?.("learning");
    if (!L) return { error: "no learning system" };
    let items = 0;
    let unserved = 0;
    const sources = {};
    const kps = new Set();
    for (let s = 0; s < sessions; s += 1) {
      L.beginSession();
      for (let i = 0; i < perSession; i += 1) {
        const req = L.next();
        if (!req) break;
        items += 1;
        kps.add(req.kpId);
        if (req.unserved) unserved += 1;
        const src = req.itemSource ?? "none";
        sources[src] = (sources[src] ?? 0) + 1;
        L.submit(req, { correct: true, latencyMs: 9000, itemId: req.itemId ?? `x#${items}`, family: req.family });
        if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0));
      }
      L.endSession();
      // A sitting boundary. Long enough for `requestIdleCallback` to run, which is what the bank's
      // speculative loads are queued behind — in play this gap is a five-minute break.
      await new Promise((r) => setTimeout(r, 250));
    }
    return { items, unserved, sources, kps: [...kps], frontier: L.frontier().slice(0, 4) };
  }, { sessions: 6, perSession: 30 });

  await d.run(idleTurns);
  const afterPlay = await d.run(snapshot);
  const probeAfterPlay = await d.probe("itembank");
  const finalReport = await d.report();

  return {
    generated: new Date().toISOString(),
    dist: distKey(path.join(ROOT, "dist")),
    ready: report.ready === true,
    fatal: report.fatal ?? null,
    errors: finalReport.errors ?? [],
    warnings: finalReport.warnings ?? [],
    warm,
    probeAfterWarm,
    probe,
    learnserve,
    bankAudit: mastery?.bankAudit ?? null,
    frontier,
    coldWindow: {
      immediateKp: LAST_LESSON.kpIds[0],
      spacedKp: SECOND_LAST.kpIds[0],
      ...coldWindow,
    },
    crossings: {
      one: { ...crossing1, probe: probeAfterCross1 },
      two: { ...crossing2, probe: probeAfterCross2 },
      warmState: warmStateAfterCrossings,
      warms: probeAfterCross2?.warms ?? null,
      warmLog: probeAfterCross2?.warmLog ?? null,
    },
    lookahead: { ...lookahead, warmState: warmStateAfterLookahead, probe: probeAfterLookahead },
    play: { ...played, lessonAtStart: lessonOf(frontier?.[0] ?? ""), probeAfterPlay },
    resources: { atReady, afterWarm, afterPrefetch, afterCold, afterCross1, afterCross2, afterLookahead, afterPlay },
  };
});

const namesOf = (list) => list.map((r) => base(r.name));
const stage = (list) => new Set(namesOf(list));
const namesAt = namesOf(out.resources.atReady);
const newIn = (list, seen) => [...new Set(namesOf(list).filter((n) => !seen.has(n)))];

const newlyPulled = newIn(out.resources.afterWarm, stage(out.resources.atReady));
const prefetched = newIn(out.resources.afterPrefetch, stage(out.resources.afterWarm));
const coldPulled = newIn(out.resources.afterCold, stage(out.resources.afterPrefetch));
const cross1Pulled = newIn(out.resources.afterCross1, stage(out.resources.afterCold));
const cross2Pulled = newIn(out.resources.afterCross2, stage(out.resources.afterCross1));
const lookaheadPulled = newIn(out.resources.afterLookahead, stage(out.resources.afterCross2));
const playPulled = newIn(out.resources.afterPlay, stage(out.resources.afterLookahead));

const byName = new Map(out.resources.afterPlay.map((r) => [base(r.name), r.encoded]));
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
  coldSelectPulled: classify(coldPulled),
  crossing1Pulled: classify(cross1Pulled),
  crossing2Pulled: classify(cross2Pulled),
  lookaheadPulled: classify(lookaheadPulled),
  gameplayPulled: classify(playPulled),
};

const dest = path.join(ROOT, "review/measure/evidence/P31-live-probe.json");
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, JSON.stringify(out, null, 1) + "\n");
console.log(
  JSON.stringify(
    {
      wrote: path.relative(ROOT, dest),
      ready: out.ready,
      dist: out.dist,
      errors: out.errors.length,
      warm: { lesson: out.warm?.lesson, groups: out.warm?.groups, ms: out.warm?.ms },
      warms: out.crossings.warms,
      warmLog: out.crossings.warmLog,
      crossings: {
        one: { from: out.crossings.one.lessonBefore, to: out.crossings.one.lessonAfter },
        two: { from: out.crossings.two.lessonBefore, to: out.crossings.two.lessonAfter, restored: out.crossings.two.restored },
      },
      classified: out.classified,
      lookahead: {
        lesson: out.lookahead.lesson,
        nextLesson: out.lookahead.nextLesson,
        warmState: out.lookahead.warmState,
      },
      play: { items: out.play.items, sources: out.play.sources, kps: out.play.kps?.length },
      coldWindow: {
        immediate: { degraded: out.coldWindow.immediate.degraded, msToCatalogue: out.coldWindow.immediate.msToCatalogue },
        spaced: { degraded: out.coldWindow.spaced.degraded, msToCatalogue: out.coldWindow.spaced.msToCatalogue },
      },
    },
    null,
    2
  )
);
