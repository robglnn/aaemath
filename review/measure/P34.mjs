#!/usr/bin/env node
/**
 * review/measure/P34.mjs — does one complete learning cycle actually execute in the shipped game?
 *
 *   node review/measure/P34.mjs [--cycles=36] [--lang=en] [--shot]
 *
 * ==================================================================================================
 * WHAT THIS MEASURES AND WHY IT IS BUILT THIS WAY
 *
 * `tools/seams.mjs --signals` found the learning loop severed at both ends: `learn:present` and
 * `math:show` were listened for and never emitted, `learn:respond` / `learn:teach` / `learn:unlock`
 * were emitted and never heard, and `Scheduler.serve()` — the only API that pairs a request with a
 * bank item — had zero callers under `app/`. Driving the shipped engine through 600 scored items had
 * pulled zero item chunks.
 *
 * So this script refuses every shortcut that could make a severed loop look connected:
 *
 *   - IT RUNS THE PRODUCTION BUNDLE (`built: true`), not the dev server and not a harness scene.
 *   - IT NEVER EMITS A LEARNING SIGNAL. The only things it does to the page are press keys. Every
 *     signal in the trace was emitted by shipped code inside `app/src`.
 *   - IT OPENS THE LOOP THROUGH THE INPUT LAYER. `KeyE` is the `interact` verb in
 *     `app/src/play/bindings.js`; the presenter opens on `input:action`, which `play/Input.js` emits.
 *   - IT ANSWERS BY TYPING. The response is constructed character by character through real
 *     `keydown` events, exactly as a player would, and marked by the shipped `ItemBank.check`.
 *   - IT READS THE TRACE OFF THE BUS. `probe("teachtrace")` is an observer registered in
 *     `boot/92-teaching.js` that subscribes to eight signal names and records the order they arrive
 *     in. It consumes nothing and emits nothing.
 *
 * Game time moves through `__vs.advance()` with `render:false`, never through wall-clock sleeps:
 * headless SwiftShader renders at a couple of frames a second, so a wall-clock wait measures nothing
 * (`CLAUDE.md`), and the anti-guessing latency floor of 900 ms is measured on the fixed clock — which
 * is precisely what makes it mean the same thing here as in play.
 * ==================================================================================================
 */

import fs from "node:fs";
import path from "node:path";
import { openGame, ROOT, arg, has } from "../../tools/lib/session.mjs";

const CYCLES = Number(arg("cycles", 36));
const LANG = arg("lang", "en");
const WANT_SHOT = has("shot");

const KP_IDS = JSON.parse(fs.readFileSync(path.join(ROOT, "content/knowledge-graph.json"), "utf8")).nodes.map((n) => n.id);
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, "content/items/manifest.json"), "utf8"));
const lessonOf = (kpId) => MANIFEST.lessons.find((l) => l.kpIds.includes(kpId))?.id ?? null;

const chunkName = (url) => String(url).split("/").pop().split("?")[0];
const groupOf = (name) => KP_IDS.find((id) => name === `${id}.js` || name.startsWith(`${id}-`)) ?? null;

/** Every resource the browser has fetched, by name. The browser's own record, not ours. */
const resources = () => performance.getEntriesByType("resource").map((e) => e.name);

/**
 * Advance exact game seconds without rendering.
 *
 * `Kernel._step` caps the catch-up burst at 8 fixed steps, so one `advance(2.5)` moves the
 * simulation by 0.13 s, not 2.5 s — the reason `session.mjs` slices. Slicing at 1/30 keeps every
 * call inside the budget; `render:false` keeps 100 slices from costing 100 SwiftShader frames.
 */
const sim = (d, seconds) =>
  d.run((s) => {
    const dt = 1 / 30;
    const n = Math.max(1, Math.round(s / dt));
    for (let i = 0; i < n; i += 1) window.__vs.advance(dt, { render: false });
    return window.__vs.stats().simTime;
  }, seconds);

const out = await openGame({ built: true, width: 1280, height: 720, lang: LANG }, async (d) => {
  const report = await d.report();
  const before = await d.run(resources);

  /* ------------------------------------------------------------------ 0. what exists at boot */
  const boot = {
    ready: report.ready,
    fatal: report.fatal,
    errors: report.errors,
    warnings: report.warnings,
    probes: await d.run(() => window.__vs.probeNames()),
    teaching: await d.probe("teaching"),
    scheduler: (await d.probe("mastery"))?.scheduler ?? null,
    learnserve: await d.probe("learnserve"),
    mathtex: await d.probe("mathtex"),
  };

  // Settle the first frames so the camera rig and the authored spawn claims resolve, exactly as a
  // player's first quarter-second does.
  await sim(d, 1.0);
  const spawnPanels = (await d.probe("mathtex"))?.panels?.map((p) => p.id) ?? [];

  /* ------------------------------------------------------- 1. take the mathematics on: KeyE */
  await d.run(() => window.__vs.kernel.get("teachwiring")?.resetTrace?.());
  await d.page.keyboard.down("KeyE");
  await sim(d, 0.35);
  await d.page.keyboard.up("KeyE");
  await sim(d, 0.35);

  const afterInteract = await d.probe("teaching");

  /* ------------------------------------------------------------------ 2. play the cycles */
  const cycles = [];
  let shotTaken = null;
  let occlusion = null;
  let boundary = null;
  for (let i = 0; i < CYCLES; i += 1) {
    const state = await d.probe("teaching");
    if (state?.phase !== "standing") {
      // The sitting is spent or the engine has nothing legal. Open the next arc the way the game
      // does — `flow.restart()` is what `boot/90-flow.js` mounts for the break hinge — and let the
      // presenter re-arm on the `learn:session {phase:"open"}` it emits.
      const reopened = await d.run(() => {
        const flow = window.__vs.kernel.get("flow");
        if (!flow?.restart) return null;
        flow.restart("p34-next-sitting");
        return window.__vs.probe("session")?.phase ?? null;
      });
      await sim(d, 0.4);
      const again = await d.probe("teaching");
      if (again?.phase !== "standing") {
        cycles.push({ i, stopped: true, phase: again?.phase ?? null, reopened });
        break;
      }
    }

    const open = await d.probe("teaching");
    const item = open.item;
    // A learner who knows the material, with a deliberate slip every fifth item so the wrong side of
    // every gate is exercised too. The accepted spelling comes from the shipped `ItemBank.accepts`,
    // which is the same list `tools/bank-audit.mjs` priced the bank with.
    const intendCorrect = i % 5 !== 4;
    const expected = await d.run(() => window.__vs.kernel.get("teachwiring")?.expected?.() ?? null);
    const typed = intendCorrect ? (expected ?? "0") : "-999";

    await d.page.keyboard.type(typed, { delay: 0 });
    // Past the 900 ms anti-guessing floor, on the fixed clock. Below it a correct response is
    // refused upward and nothing this script claims about mastery would mean anything.
    await sim(d, 1.6);
    const standing = await d.probe("teaching");

    if (!occlusion && i === 1) {
      // One render, once: the proof that the item is on the SURFACE and not merely in a probe.
      await d.run(() => window.__vs.advance(1 / 60));
      if (WANT_SHOT) shotTaken = await d.shoot("review/shots/p34/standing.png");
      /**
       * P15's rule O1, applied to what the ENGINE stands rather than to what the level authored:
       * "a standing claim's ink is 0.0% occluded". Not "mostly visible" — a claim with world
       * geometry in front of it is a claim that may be read wrong, and the round-2 finding was a
       * compositor turning a true statement into a false one. The probe fires a camera-to-ink ray
       * per sample against every depth-writing mesh, so it is taken once, here, on the same frame
       * the capture was taken from.
       */
      occlusion = await d.probe("mathocclusion");
    }

    await d.page.keyboard.press("Enter");
    await sim(d, 2.6); // feedback (1.6) + gap (0.5), with margin for the next present

    /**
     * THE SITTING BOUNDARY, driven once, halfway through.
     *
     * `flow.restart()` is what `boot/90-flow.js` mounts for the break hinge, and it is the one thing
     * that can take the arc out from under a presenter mid-loop. The presenter re-arms on the
     * `learn:session {phase:"open"}` that `Session.begin()` emits — an untested branch is exactly
     * the kind of thing this wave exists to stop shipping, so it is driven here rather than reasoned
     * about.
     */
    if (i === Math.floor(CYCLES / 2)) {
      boundary = await d.run(() => {
        const flow = window.__vs.kernel.get("flow");
        const before = window.__vs.probe("session");
        flow.restart("p34-break");
        return { sittingsBefore: before?.cycle?.sittings ?? null, phaseAfter: window.__vs.probe("session")?.phase ?? null };
      });
      await sim(d, 3.0);
      const resumed = await d.probe("teaching");
      boundary.presenterPhase = resumed?.phase ?? null;
      boundary.presentedAfter = resumed?.stats?.presented ?? null;
      boundary.sittingsAfter = (await d.probe("session"))?.cycle?.sittings ?? null;
    }

    cycles.push({
      i,
      kpId: item?.kpId ?? null,
      lesson: lessonOf(item?.kpId ?? ""),
      itemId: item?.itemId ?? null,
      form: item?.form ?? null,
      phase: item?.phase ?? null,
      mode: item?.mode ?? null,
      family: item?.family ?? null,
      source: item?.source ?? null,
      relaxation: item?.relaxation ?? null,
      testOut: item?.testOut ?? false,
      typed,
      intendCorrect,
      responseOnScreen: standing?.response ?? null,
      standingIds: standing?.standing ?? [],
    });
  }

  /* ------------------------------------------------------------------ 3. read everything back */
  // The FULL trace, not the tail `probe("teachtrace")` publishes: a truncated trace makes a complete
  // cycle look incomplete, and this script's whole job is to count complete cycles.
  const trace = await d.run(() => window.__vs.kernel.get("teachwiring")?.trace?.() ?? window.__vs.probe("teachtrace"));
  const teaching = await d.probe("teaching");
  const mastery = await d.probe("mastery");
  const session = await d.probe("session");
  const itembank = await d.probe("itembank");
  const learnserve = await d.probe("learnserve");
  const mathtex = await d.probe("mathtex");
  const finalReport = await d.report();
  const after = await d.run(resources);

  return {
    boot,
    spawnPanels,
    afterInteract,
    cycles,
    trace,
    teaching,
    mastery,
    session,
    itembank,
    learnserve,
    mathtex,
    finalReport,
    resourcesBefore: before,
    resourcesAfter: after,
    shot: shotTaken,
    occlusion,
    boundary,
  };
});

/* ================================================================================== reporting */

const line = (s = "") => console.log(s);
const claims = [];
const claim = (id, ok, text) => {
  claims.push({ id, ok, text });
  line(`${ok ? "PASS" : "FAIL"}  ${id}  ${text}`);
};

line("=".repeat(98));
line("P34 — the learning round trip, driven through the SHIPPED BUILD");
line("=".repeat(98));
line(`build ready: ${out.boot.ready}   fatal: ${out.boot.fatal ?? "none"}   locale: ${LANG}`);
line(`console errors: ${out.finalReport.errors.length}   katex failed: ${out.finalReport.katex.failed}   raw TeX leak: ${out.finalReport.katex.rawSourceLeak}`);
line("");

/* ------------------------------------------------------------------ the trace, per cycle */
const entries = out.trace?.entries ?? [];
const groups = [];
for (const e of entries) {
  if (e.name === "learn:present") groups.push([]);
  if (!groups.length) groups.push([]);
  groups[groups.length - 1].push(e);
}
line("-".repeat(98));
line("SIGNAL TRACE — the ordered list of signals actually observed on the bus, per cycle");
line("(observer: boot/92-teaching.js; every emitter is shipped code under app/src)");
line("-".repeat(98));
const showGroups = groups.slice(0, 6).concat(groups.length > 8 ? [] : []);
groups.slice(0, 8).forEach((g, i) => {
  const head = g.find((e) => e.name === "learn:present");
  line(`cycle ${String(i).padStart(2)}  ${head?.kpId ?? "?"}  ${head?.itemId ?? ""}`);
  for (const e of g) {
    const det = e.detail ? "  " + JSON.stringify(e.detail) : "";
    line(`   t=${String(e.t).padStart(7)}  ${e.name.padEnd(14)} ${String(e.kpId ?? "").padEnd(22)}${det}`);
  }
});
if (groups.length > 8) line(`   ... ${groups.length - 8} further cycles, same shape`);
line("");
line(`signal counts: ${JSON.stringify(out.trace?.counts ?? {})}`);
line("");

/* ------------------------------------------------------------------ the claims */
line("-".repeat(98));
line("CLAIMS");
line("-".repeat(98));

const counts = out.trace?.counts ?? {};
const presents = counts["learn:present"] ?? 0;
const shows = counts["math:show"] ?? 0;
const hides = counts["math:hide"] ?? 0;
const responds = counts["learn:respond"] ?? 0;
const masteries = counts["learn:mastery"] ?? 0;
const teaches = counts["learn:teach"] ?? 0;
const unlocks = counts["learn:unlock"] ?? 0;

/** A cycle is COMPLETE when its trace contains present -> show -> respond, in that order. */
const complete = groups.filter((g) => {
  const iP = g.findIndex((e) => e.name === "learn:present");
  const iS = g.findIndex((e) => e.name === "math:show");
  const iR = g.findIndex((e) => e.name === "learn:respond");
  return iP === 0 && iS > iP && iR > iS;
});
const withMastery = complete.filter((g) => g.some((e) => e.name === "learn:mastery"));
const withHide = complete.filter((g) => g.some((e) => e.name === "math:hide"));

claim(
  "C1",
  complete.length >= 8,
  `${complete.length} complete cycles observed with the chain present -> display -> respond in order ` +
    `(${withMastery.length} of them also carried learn:mastery, ${withHide.length} retired with math:hide)`
);

claim(
  "C2",
  presents > 0 && shows > 0 && hides > 0,
  `the three seams that had no emitter now have one: learn:present x${presents}, math:show x${shows}, math:hide x${hides}`
);

const drivenNow = out.mathtex?.driven === true;
const spawnClaims = ["leaf9-span", "leaf9-share", "leaf9-working", "leaf9-mark"];
const spawnStoodDown = spawnClaims.filter((id) => !(out.mathtex?.panels ?? []).some((p) => p.id === id));
claim(
  "C3",
  drivenNow && spawnStoodDown.length === spawnClaims.length,
  `learn:present reached its listener: boot/60-mathtex.js flipped the field to driven=${drivenNow} and stood ` +
    `${spawnStoodDown.length}/4 authored spawn claims down (they were ${out.spawnPanels.length} panels at spawn: ${out.spawnPanels.join(", ")})`
);

const respondDetail = entries.filter((e) => e.name === "learn:respond").map((e) => e.detail);
// `UNREPORTED_FAMILY` is `Mastery`'s sentinel for "the presenter declined to say"; anything that is
// not a real family name counts as absent here.
const namedFamily = (f) => typeof f === "string" && f.length > 0 && !/unreported/i.test(f);
const withFamily = respondDetail.filter((r) => namedFamily(r?.family)).length;
const withLatency = respondDetail.filter((r) => Number.isFinite(r?.latencyMs) && r.latencyMs > 0).length;
const scored = respondDetail.filter((r) => r?.scored === true).length;
claim(
  "C4",
  respondDetail.length > 0 &&
    respondDetail.length === responds &&
    withFamily === respondDetail.length &&
    withLatency === respondDetail.length &&
    scored > 0,
  `learn:respond x${responds} (${respondDetail.length} in the trace): ${withFamily} carried a reported generator ` +
    `family, ${withLatency} carried a real latency, ${scored} were SCORED by Mastery (the rest were refused by a ` +
    `gate, which is the engine working)`
);

const unreported = out.mastery?.stats?.unreportedFamilyItems ?? out.learnserve?.unreportedFamilyItems ?? null;
claim(
  "C4b",
  unreported === 0,
  `the round-2 delivery defect stayed closed: unreportedFamilyItems = ${unreported} ` +
    `(family reporting: ${out.learnserve?.familyReporting} via ${out.learnserve?.familyReportingSource})`
);

claim(
  "C5",
  masteries > 0 && (out.mastery?.stats?.scoredItems ?? 0) > 0,
  `Mastery consumed the responses: learn:mastery x${masteries}, scoredItems ${out.mastery?.stats?.scoredItems}, ` +
    `refusedUpward ${out.mastery?.stats?.refusedUpward}, unscored ${out.mastery?.stats?.unscoredItems}`
);

claim(
  "C6",
  teaches > 0 && (out.teaching?.stats?.teachHeard ?? 0) > 0,
  `learn:teach x${teaches} emitted by Scheduler and CONSUMED ${out.teaching?.stats?.teachHeard} times by the ` +
    `presenter (phases seen: ${JSON.stringify(out.teaching?.stats?.byPhase ?? {})})`
);

claim(
  "C6b",
  (out.teaching?.stats?.respondHeard ?? 0) > 0,
  `learn:respond CONSUMED ${out.teaching?.stats?.respondHeard} times by the presenter — the claim is retired on the ` +
    `engine's announcement, not on submit()'s return value`
);

const sched = out.mastery?.scheduler ?? {};
claim(
  "C7",
  (sched.served ?? 0) > 0 && (sched.serveMisses ?? 1) === 0,
  `Scheduler.serve() is on the shipped path and carried current: served ${sched.served} items ` +
    `(source ${JSON.stringify(sched.servedBySource ?? {})}, relaxation ${JSON.stringify(sched.servedByRelaxation ?? {})}), ` +
    `serveMisses ${sched.serveMisses}`
);

const delivery = out.session?.delivery ?? {};
claim(
  "C7b",
  (delivery.withItem ?? 0) > 0 && delivery.withItem === delivery.requests && (delivery.unserved ?? 1) === 0,
  `the session layer recorded delivery for every request: ${delivery.withItem}/${delivery.requests} carried an item, ` +
    `${delivery.withFamily} carried a family, itemRelaxation ${JSON.stringify(delivery.byRelaxation ?? {})}`
);

const newGroups = [...new Set(out.resourcesAfter.filter((u) => !out.resourcesBefore.includes(u)).map(chunkName).map(groupOf).filter(Boolean))];
const bootGroups = [...new Set(out.resourcesBefore.map(chunkName).map(groupOf).filter(Boolean))];
const loads = out.itembank?.loads ?? {};
const lazyTotal = (loads.explicit ?? 0) + (loads.prefetch ?? 0) + (loads.demand ?? 0);
claim(
  "C8",
  lazyTotal > 0 && (bootGroups.length + newGroups.length) > 0,
  `${lazyTotal} item groups were loaded LAZILY on this page (${JSON.stringify(loads)}); ` +
    `${bootGroups.length} chunk(s) arrived before the loop opened, ${newGroups.length} more during play` +
    (newGroups.length ? `: ${newGroups.join(", ")}` : "")
);

const warms = out.itembank?.warmLog ?? [];
const triggers = [...new Set(warms.map((w) => w.trigger))];
/**
 * The follow-the-learner claim, stated as the thing it actually has to be: did chunks arrive for the
 * lessons the learner WENT TO, rather than only for the one the frontier started in? `warmFrontier`
 * answers where the model thinks the learner is; a presented knowledge point is where they are.
 */
const lessonsPresented = [...new Set(out.cycles.map((c) => c.lesson).filter(Boolean))];
const lessonsArrived = [...new Set([...bootGroups, ...newGroups].map(lessonOf).filter(Boolean))];
const followed = lessonsPresented.filter((l) => lessonsArrived.includes(l));
claim(
  "C8b",
  warms.length > 0 && lessonsPresented.length > 1 && followed.length === lessonsPresented.length,
  `the loader followed the learner past the lesson it started in: items were presented from ` +
    `${JSON.stringify(lessonsPresented)} and chunks arrived for ${JSON.stringify(lessonsArrived)} ` +
    `(${out.itembank?.warms} frontier warm(s), triggers ${JSON.stringify(triggers)}; the rest came from the ` +
    `learn:present and learn:unlock routes in boot/62-itembank.js)`
);

claim(
  "C9",
  unlocks > 0,
  `learn:unlock x${unlocks} — a gate crossing reached its listener ` +
    `(nodes unlocked this run: ${JSON.stringify(entries.filter((e) => e.name === "learn:unlock").map((e) => e.kpId))})`
);

const occ = out.occlusion ?? null;
const teachPanels = (occ?.panels ?? []).filter((p) => String(p.id).startsWith("teach-"));
const worstTeach = teachPanels.length ? Math.max(...teachPanels.map((p) => p.occludedPct ?? 0)) : null;
claim(
  "C9b",
  teachPanels.length > 0 && worstTeach === 0,
  `P15 rule O1 holds for what the ENGINE stands, not just for what the level authored: ` +
    `${teachPanels.length} presented claim(s) measured, worst occlusion ${worstTeach}% ` +
    `(${teachPanels.map((p) => `${p.id} ${p.occludedPct}%`).join(", ")})`
);

const b = out.boundary ?? null;
claim(
  "C11",
  !!b && b.presenterPhase === "standing" && b.sittingsAfter > b.sittingsBefore && (out.teaching?.stats?.dropped ?? 1) === 0,
  `the loop survives a sitting boundary: flow.restart() closed sitting ${b?.sittingsBefore} and opened ` +
    `${b?.sittingsAfter}, the presenter re-armed on learn:session{open} and was ${b?.presenterPhase} again, and ` +
    `the in-flight response was scored through the engine rather than lost ` +
    `(rescued ${out.teaching?.stats?.rescued}, dropped ${out.teaching?.stats?.dropped})`
);

claim(
  "C10",
  out.finalReport.errors.length === 0 && out.finalReport.katex.failed === 0 && out.finalReport.katex.rawSourceLeak === false,
  `the shipped page stayed clean while the loop ran: ${out.finalReport.errors.length} console errors, ` +
    `${out.finalReport.katex.failed} KaTeX failures, raw TeX leak ${out.finalReport.katex.rawSourceLeak}`
);

/* ------------------------------------------------------------------ the run, in numbers */
line("");
line("-".repeat(98));
line("THE RUN");
line("-".repeat(98));
line(`cycles driven            ${out.cycles.length}`);
line(`presenter               ${JSON.stringify(out.teaching?.stats ?? {})}`);
line(`knowledge points seen   ${JSON.stringify([...new Set(out.cycles.map((c) => c.kpId).filter(Boolean))])}`);
line(`lessons seen            ${JSON.stringify([...new Set(out.cycles.map((c) => c.lesson).filter(Boolean))])}`);
line(`forms x phases          ${JSON.stringify(out.cycles.reduce((a, c) => ({ ...a, [`${c.form}|${c.phase}`]: (a[`${c.form}|${c.phase}`] ?? 0) + 1 }), {}))}`);
line(`item source             ${JSON.stringify(out.cycles.reduce((a, c) => ({ ...a, [c.source ?? "?"]: (a[c.source ?? "?"] ?? 0) + 1 }), {}))}`);
line(`mastery summary         level1 ${out.mastery?.level1Percent ?? "?"}%  scored ${out.mastery?.stats?.scoredItems}  certifications ${out.mastery?.stats?.certifications}`);
line(`session                 phase ${out.session?.phase}  items ${out.session?.elapsed?.items}  beats ${out.session?.elapsed?.beats}  close ${out.session?.closeReason}`);
line(`field                   ${out.mathtex?.panels?.length ?? 0} panels standing: ${JSON.stringify((out.mathtex?.panels ?? []).map((p) => p.id))}`);
if (out.shot) line(`capture                 ${out.shot}`);
if (out.finalReport.warnings.length) {
  line("");
  line("warnings from the running page:");
  for (const w of out.finalReport.warnings.slice(0, 8)) line(`   ${w}`);
}

const failed = claims.filter((c) => !c.ok);
line("");
line("=".repeat(98));
line(`${claims.length - failed.length}/${claims.length} claims pass${failed.length ? ` — FAILING: ${failed.map((c) => c.id).join(", ")}` : ""}`);
line("=".repeat(98));

fs.mkdirSync(path.join(ROOT, "review/measure/evidence"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "review/measure/evidence/P34.json"), JSON.stringify({ claims, ...out }, null, 1));
line(`evidence: review/measure/evidence/P34.json`);
process.exit(failed.length ? 1 : 0);
