#!/usr/bin/env node
/**
 * review/measure/P31.mjs — the proof that the item bank ships per lesson.
 *
 *   node review/measure/P31.mjs                    # human table + PASS/FAIL
 *   node review/measure/P31.mjs --json             # machine-readable
 *   node review/measure/P31.mjs --after=dist       # which built tree is "after"
 *
 * P31's claim is narrow and it has THREE halves now, and all three have to be measured or the
 * piece is a regression wearing a size reduction:
 *
 *   1. First load got materially smaller, in gzipped bytes, on the real build.
 *   2. The loader has a CALLER IN THE SHIPPED GAME. Round 2 failed exactly here: the byte win was
 *      real, but `ensure`, `ensureLesson` and `prefetchAround` were referenced nowhere under
 *      `app/` except their own definitions, the idle prefetch never ran, and the default path for
 *      the first item on every knowledge point was the degraded generator. So section E is a
 *      source-level check that the caller exists and a browser-level check that it fired, and
 *      section B now drives the boot module's own entry point rather than a lesson this script
 *      chose for itself.
 *   3. Nothing else changed. Same items, same order, same fingerprint, same coverage, and a
 *      session that runs end to end pulling only the groups it needs — including when a group
 *      never arrives at all, and including when it comes back.
 *
 * WHERE THE "BEFORE" COMES FROM. `review/measure/evidence/P31-baseline.json` is a real
 * `vite build` of the pre-split tree at the commit named inside it, produced with
 * `git archive <sha> | tar -x -C tmp && npx vite build`, same vite, same machine, and NOT by
 * mutating the working tree — a live playtest was running. Re-derive it the same way if you
 * doubt it; `ItemBank-B5q9etEn.js` is content-hashed, so a matching filename is a matching build.
 *
 * WHAT IS NOT CLAIMED HERE. Frame cost, memory and the rest of the build are other pieces'.
 * This file measures bytes-before-first-item and the integrity of the catalogue behind them.
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import { distKey } from "./_p31-distkey.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split("=")[1] : d;
};
const JSON_ONLY = process.argv.includes("--json");
const AFTER_DIR = path.resolve(ROOT, arg("after", "dist"));

const load = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
/** Vite reports kB as 1000 bytes; so does this, so the two tables can be read side by side. */
const kB = (n) => `${(n / 1000).toFixed(1)} kB`;

const results = [];
const detail = {};
function claim(id, what, pass, measured, threshold, notes = null) {
  results.push({ id, claim: what, pass: !!pass, measured, threshold, ...(notes ? { notes } : {}) });
}

/* ================================================================ the split, as loaded */

const kg = load("content/knowledge-graph.json");
const manifestJson = load("content/items/manifest.json");
const bankFiles = kg.nodes.map((n) => load(`content/items/bank/${n.id}.json`));

const ItemBankMod = await import(pathToFileURL(path.join(ROOT, "app/src/learn/ItemBank.js")).href);
const { ItemBank, __evictAllGroups, __faultGroup, __groupBytesLoaded, bankIssues } = ItemBankMod;
const itemsIndex = await import(pathToFileURL(path.join(ROOT, "content/items/index.mjs")).href);
const {
  BANK,
  MANIFEST,
  STRINGS,
  BANK_FINGERPRINT,
  BANK_FINGERPRINT_BASIS,
  bankFingerprintBasis,
  loadItemStrings,
} = itemsIndex;
const { Graph } = await import(pathToFileURL(path.join(ROOT, "app/src/learn/Graph.js")).href);
const Mast = await import(pathToFileURL(path.join(ROOT, "app/src/learn/Mastery.js")).href);
const { Mastery, bankAuditFingerprint } = Mast;
const { Scheduler, virtualClock, mulberry32 } = await import(pathToFileURL(path.join(ROOT, "app/src/learn/Scheduler.js")).href);

const bankAudit = load("app/src/learn/bank-audit.json");
const graph = new Graph(kg);

/* ================================================================ A — build sizes */

/** Vite's own reporter gzips at zlib's DEFAULT level, so this does too and the tables agree. */
const gz = (buf) => zlib.gzipSync(buf).length;

function measureDir(dir) {
  const assets = path.join(dir, "assets");
  if (!fs.existsSync(assets)) return null;
  const out = {};
  for (const f of fs.readdirSync(assets)) {
    if (!/\.(js|css)$/.test(f)) continue;
    const b = fs.readFileSync(path.join(assets, f));
    out[f] = { raw: b.length, gzip: gz(b) };
  }
  const html = path.join(dir, "index.html");
  if (fs.existsSync(html)) {
    const b = fs.readFileSync(html);
    out["index.html"] = { raw: b.length, gzip: gz(b) };
  }
  return out;
}

const KP_IDS = kg.nodes.map((n) => n.id);
/** A group chunk is named after its knowledge point, because its entry module is `<kpId>.mjs`. */
const isGroupChunk = (name) => KP_IDS.some((id) => name === `${id}.js` || name.startsWith(`${id}-`));
/**
 * i18n pulls exactly one locale bundle; the other two are never requested. Since round 3 the ITEM
 * text is split the same way (`items-<locale>-<hash>.js`), so the same rule covers both — and the
 * live probe in `_p31-live.mjs` confirms from the browser's own resource timings that exactly one
 * of each was fetched, so this is a filter over a measured fact rather than an assumption.
 */
const isOtherLocale = (name, locale) =>
  (/^(en|es|pl)-/.test(name) && !name.startsWith(`${locale}-`)) ||
  (/^items-(en|es|pl)-/.test(name) && !name.startsWith(`items-${locale}-`));
/** The identity spine. Never on the first-load path: the fingerprint ships as a scalar. */
const isSpineChunk = (name) => name === "spine.js" || /^spine-[A-Za-z0-9_-]+\.js$/.test(name);

const baseline = load("review/measure/evidence/P31-baseline.json");
const after = measureDir(AFTER_DIR);

const sum = (assets, keep) =>
  Object.entries(assets)
    .filter(([n]) => keep(n))
    .reduce((a, [, v]) => ({ raw: a.raw + v.raw, gzip: a.gzip + v.gzip }), { raw: 0, gzip: 0 });

{
  const beforeBank = Object.entries(baseline.assets).find(([n]) => n.startsWith("ItemBank-"));
  const afterBank = after && Object.entries(after).find(([n]) => n.startsWith("ItemBank-"));
  detail.catalogueChunk = {
    before: beforeBank ? { file: beforeBank[0], ...beforeBank[1] } : null,
    after: afterBank ? { file: afterBank[0], ...afterBank[1] } : null,
  };
  const saved = beforeBank && afterBank ? beforeBank[1].gzip - afterBank[1].gzip : 0;
  claim(
    "A1",
    "the eager item-bank chunk shrank on the real build (npm run build, gzipped at vite's own level)",
    !!afterBank && saved > 60 * 1024,
    beforeBank && afterBank
      ? `${beforeBank[0]} ${kB(beforeBank[1].raw)} / ${kB(beforeBank[1].gzip)} gz  ->  ${afterBank[0]} ${kB(afterBank[1].raw)} / ${kB(afterBank[1].gzip)} gz  (-${kB(saved)} gz)`
      : `after build missing — run npm run build (looked in ${AFTER_DIR})`,
    "> 60 kB gzipped removed from the eager chunk"
  );
}

{
  // Everything the page pulls before it can serve an item. The boot glob is lazy, so every boot
  // module is a dynamic import that startup immediately performs; all of them count. What does
  // NOT count is the two locale bundles the learner is not using, and — the point of this piece —
  // the item groups, which are not requested until a lesson asks for one.
  const beforeFirst = sum(baseline.assets, (n) => !isOtherLocale(n, "en"));
  const afterFirst = after
    ? sum(after, (n) => !isGroupChunk(n) && !isSpineChunk(n) && !isOtherLocale(n, "en"))
    : null;
  const afterAll = after ? sum(after, () => true) : null;

  /**
   * The working tree is not the baseline commit — other pieces are building in parallel and their
   * boot modules are in the "after" build and not in the "before" one. Naming them, and their
   * cost, is the difference between a measurement and a flattering one. `stem` strips Vite's
   * content hash so a chunk that merely changed content is still recognised as the same chunk.
   */
  const stem = (n) => n.replace(/-[A-Za-z0-9_-]{8}\.(js|css)$/, "");
  const beforeStems = new Set(Object.keys(baseline.assets).map(stem));
  /**
   * P31's OWN new chunks are excluded from this handicap list on purpose. `items-en-*.js` did not
   * exist at the baseline, but it is not a parallel piece's cost — it is the eager locale table
   * moved out of `ItemBank`, and it is still counted in the after number above. Calling our own
   * replacement chunk "somebody else's" would be a flattering measurement, not a measurement.
   */
  const ours = (n) => isGroupChunk(n) || isSpineChunk(n) || /^items-(en|es|pl)-/.test(n);
  const newChunks = after ? Object.keys(after).filter((n) => !ours(n) && !beforeStems.has(stem(n))) : [];
  const newCost = after ? sum(after, (n) => newChunks.includes(n)) : { raw: 0, gzip: 0 };
  const likeForLike = afterFirst ? afterFirst.gzip - newCost.gzip : 0;

  detail.firstLoad = {
    before: beforeFirst,
    after: afterFirst,
    afterWholeBuild: afterAll,
    chunksNotInBaseline: { files: newChunks, ...newCost },
    likeForLikeAfterGzip: likeForLike,
  };
  const saved = afterFirst ? beforeFirst.gzip - afterFirst.gzip : 0;
  claim(
    "A2",
    "FIRST LOAD — every chunk the page pulls before the first item, one locale, gzipped",
    !!afterFirst && saved > 55_000,
    afterFirst
      ? `${kB(beforeFirst.gzip)} gz -> ${kB(afterFirst.gzip)} gz  (-${kB(saved)} gz, -${((100 * saved) / beforeFirst.gzip).toFixed(1)}%). Raw ${kB(beforeFirst.raw)} -> ${kB(afterFirst.raw)}.`
      : "after build missing",
    "> 55 kB gzipped off first load",
    [
      `The after-tree carries ${newChunks.length} chunks that did not exist at the baseline commit (${newChunks.map(stem).join(", ") || "none"}), ` +
        `costing ${kB(newCost.gzip)} gz — other pieces building in parallel. They ADD to the after number; the reduction is measured against that handicap.`,
      `Like for like — first load minus those new chunks — is ${kB(likeForLike)} gz, a reduction of ${kB(beforeFirst.gzip - likeForLike)} gz.`,
    ]
  );
}

{
  const groups = after ? Object.keys(after).filter(isGroupChunk) : [];
  const bytes = after ? sum(after, isGroupChunk) : { raw: 0, gzip: 0 };
  detail.groupChunks = { count: groups.length, ...bytes };
  claim(
    "A3",
    "the catalogue built as one chunk per knowledge point, none of them on the first-load path",
    groups.length === KP_IDS.length,
    `${groups.length} group chunks totalling ${kB(bytes.raw)} / ${kB(bytes.gzip)} gz, mean ${kB(bytes.gzip / Math.max(1, groups.length))} gz each`,
    `${KP_IDS.length} chunks`
  );
}

/**
 * The SHIPPED cost of one knowledge point: the built, minified, content-hashed chunk in `dist`,
 * not the source module the manifest estimated at build time. If those two ever disagree it is
 * the built one that a Chromebook downloads.
 */
const chunkFor = (kpId) => {
  if (!after) return null;
  const hit = Object.entries(after).find(([n]) => n === `${kpId}.js` || n.startsWith(`${kpId}-`));
  return hit ? hit[1] : null;
};
const lessonChunkBytes = (kpIds) =>
  kpIds.reduce(
    (a, id) => {
      const c = chunkFor(id) ?? { raw: 0, gzip: 0 };
      return { raw: a.raw + c.raw, gzip: a.gzip + c.gzip };
    },
    { raw: 0, gzip: 0 }
  );

{
  const lessons = MANIFEST.lessons;
  const costs = lessons.map((l) => lessonChunkBytes(l.kpIds).gzip);
  const median = [...costs].sort((a, b) => a - b)[Math.floor(costs.length / 2)];
  detail.lessons = lessons.map((l, i) => ({
    id: l.id,
    kps: l.kpIds,
    estMinutes: l.estMinutes,
    items: l.items,
    shippedGzip: costs[i],
    sourceGzip: l.sourceBytes.gzip,
  }));
  claim(
    "A4",
    "a single-lesson session's catalogue cost, measured on the SHIPPED chunks",
    costs.every((c) => c > 0) && Math.max(...costs) < 12_000,
    `${lessons.length} lessons, ${Math.min(...costs)}–${Math.max(...costs)} B gz (median ${median} B), ` +
      `each 10–${Math.max(...lessons.map((l) => l.estMinutes))} min of scored-item time — against ${kB(sum(after ?? {}, isGroupChunk).gzip)} gz for the whole course`,
    "every lesson under 12 kB gzipped"
  );
}

/**
 * The claims above are about files on disk. The ones below are about the REAL BUILT GAME: which
 * chunks the browser actually requested, and when, taken from `performance.getEntriesByType`
 * inside the page. `review/measure/evidence/P31-live-probe.json` is written by
 *
 *   node review/measure/_p31-live.mjs
 *
 * which boots `vite preview` in headless Chromium, snapshots the resource list at ready, awaits the
 * boot module's own warm promise, snapshots again, waits two idle turns for the prefetch and
 * snapshots a third time. It renders nothing and captures no pixels.
 */
/**
 * ROUND 4 — THE PROBE IS RE-RUN, NOT READ.
 *
 * Round 3 read this file from disk and printed 22/22 PASS while **all eighteen JS chunk names
 * inside it were absent from `dist/assets`**: `dist` is rebuilt by whichever piece is building in
 * parallel, so the cache went stale within the hour and every live claim was describing a build
 * that no longer existed. So the probe now records the identity of the tree it measured (the sorted
 * set of content-hashed asset names — any module change changes at least one name), this file
 * recomputes it, and on a mismatch it RE-RUNS `_p31-live.mjs` rather than reporting on a ghost.
 *
 * `--no-live` skips the re-run; every claim that depends on the browser then FAILS rather than
 * passing on stale evidence.
 */
const LIVE_PATH = "review/measure/evidence/P31-live-probe.json";
const NO_LIVE = process.argv.includes("--no-live");
const distNow = distKey(AFTER_DIR);
const readLive = () => (fs.existsSync(path.join(ROOT, LIVE_PATH)) ? load(LIVE_PATH) : null);
const isFresh = (p) => !!(p?.dist?.key && distNow?.key && p.dist.key === distNow.key && p.dist.files === distNow.files);

let live = readLive();
let liveRerun = null;
if (!isFresh(live) && !NO_LIVE) {
  const proc = await import("node:child_process");
  liveRerun = { was: live?.dist ?? null, want: distNow };
  if (!JSON_ONLY) console.log(`P31: the live probe does not match ${AFTER_DIR} — re-running _p31-live.mjs…`);
  proc.execFileSync(process.execPath, [path.join(HERE, "_p31-live.mjs")], {
    stdio: JSON_ONLY ? "ignore" : "inherit",
    cwd: ROOT,
  });
  live = readLive();
}
const liveFresh = isFresh(live);
/**
 * A live claim may only be evaluated against a probe of THIS build. `L(x)` is the gate: every
 * browser-derived claim below is `and`-ed with it, so a stale or missing probe fails them instead
 * of silently passing.
 */
const L = (x) => liveFresh && !!x;
/** A safe stand-in so a missing probe produces FAILs and not a crash on the first property access. */
const EMPTY_CLASS = { requests: 0, groupChunks: [], itemLocaleChunks: [], spineChunks: [], encodedBytes: 0 };
const cls = (name) => live?.classified?.[name] ?? EMPTY_CLASS;

detail.live = {
  fresh: liveFresh,
  distMeasured: live?.dist ?? null,
  distNow,
  rerun: liveRerun,
  generated: live?.generated ?? null,
  ready: live?.ready ?? null,
  errors: live?.errors ?? [],
  warm: live?.warm ?? null,
  frontier: live?.frontier ?? null,
  classified: live?.classified ?? null,
  bankAudit: live?.bankAudit ?? null,
  crossings: live?.crossings ?? null,
  play: live?.play ? { items: live.play.items, sources: live.play.sources, kps: live.play.kps } : null,
  coldWindow: live?.coldWindow ?? null,
  learnserve: live?.learnserve ?? null,
  probe: live?.probe ?? null,
};

claim(
  "A0",
  "every live claim below was measured in a browser against THE BUILD THAT IS IN dist RIGHT NOW",
  liveFresh,
  liveFresh
    ? `probe generated ${live.generated} against ${live.dist.files} built assets, key ${live.dist.key}; ${AFTER_DIR} is now ${distNow?.files} assets, key ${distNow?.key} — identical` +
      (liveRerun ? ` (the cached probe described ${JSON.stringify(liveRerun.was)}, so it was re-run)` : "")
    : `STALE: the probe describes ${JSON.stringify(live?.dist ?? null)} and ${AFTER_DIR} is ${JSON.stringify(distNow)}` +
      (NO_LIVE ? " — --no-live was passed, so it was not re-run" : ""),
  "the probe's dist identity equals the current dist's"
);

{
  const cp = cls("criticalPath");
  claim(
    "A5",
    "the REAL built game reaches `ready` having requested ZERO item groups, ZERO spine and ONE locale — and still knows the whole course",
    L(live?.ready === true) &&
      live.errors.length === 0 &&
      cp.groupChunks.length === 0 &&
      cp.spineChunks.length === 0 &&
      cp.itemLocaleChunks.length === 1 &&
      live.probe.knowledgePoints === 32 &&
      live.probe.catalogueItems === 1152,
    `at ready the page had made ${cp.requests} requests (${kB(cp.encodedBytes)} encoded): ` +
      `${cp.groupChunks.length} group chunks, ${cp.spineChunks.length} spine chunks, ` +
      `item locale ${JSON.stringify(cp.itemLocaleChunks)}; the bank still reports ` +
      `${live.probe.knowledgePoints} knowledge points, ${live.probe.catalogueItems} catalogue items, ` +
      `min ${live.probe.minItemsPerKp}/kp, ${live.probe.lessons} lessons`,
    "0 group chunks, 0 spine chunks, exactly 1 item locale chunk on the critical path"
  );
}

/* ================================================================ B — a real session, cold */

/**
 * The whole engine, from a cold cache, exactly as a browser starts it.
 *
 * ROUND 3 CHANGE, and the reason for it. Round 2 opened the session by picking a lesson HERE — the
 * script asked the scheduler for a knowledge point, looked its lesson up and called `ensureLesson`
 * itself. So B1, B2 and B4 measured a code path that only this file executed, which is precisely
 * what the critic caught. The opener below is now `bank.warmFrontier(learning)`: the same method,
 * with the same argument shape, that `app/src/boot/62-itembank.js` calls on every page load. If
 * that method stopped working, or the boot module stopped calling it, section E fails and these
 * claims are measuring the thing the game actually does.
 *
 * `settle()` is the microtask/timer drain that stands in for time passing while the learner reads
 * an item. Nothing here waits on wall-clock: what is being measured is which chunks got pulled.
 */
const settle = () => new Promise((r) => setTimeout(r, 0));

async function runSession({ fault = null } = {}) {
  __evictAllGroups();
  if (fault) __faultGroup(fault, true);
  const issues = [];
  bankIssues.onIssue = (i) => issues.push(i);

  const bank = new ItemBank();
  const clock = virtualClock(0);
  const mastery = new Mastery(graph, { now: () => clock.minutes(), storage: null, bankAudit });
  const sched = new Scheduler(mastery, { clock, rng: mulberry32(31), sessionMinutes: 25 });
  const rng = mulberry32(1031);

  /**
   * ROUND 4 CHANGE. Round 3's session did `sched.next()` and then called `bank.select()` itself —
   * a Scheduler-to-bank loop that existed only in this file, which is exactly what the critic
   * caught. `Scheduler.attachBank(bank)` is the line `app/src/boot/63-learnserve.js` runs in the
   * shipped game: from here `next()` draws every item through `Scheduler.serve(req, bank)` into
   * `ItemBank.select()` and publishes it as `req.item` / `req.itemSource` / `req.itemRelaxation`.
   * So this loop now touches the bank in exactly one place — the same place the game does — and
   * B1/B2/C1 measure the shipped path rather than a private one.
   *
   * It is also load-bearing for the session to run at all: without a bank the engine cannot know
   * which generator family it handed out, refuses to score the 24 filtered (kp x form) cells, and
   * the curriculum deadlocks after twenty items.
   */
  sched.attachBank(bank);
  sched.beginSession();

  // The session opener, through the boot module's entry point. `62-learning.js` mounts
  // `frontier: () => system.mastery.frontier()`; this is that object.
  const learning = { frontier: () => mastery.frontier() };
  const opened = await bank.warmFrontier(learning);
  const lesson = opened.lesson;

  const served = [];
  let blanks = 0;
  let degraded = 0;
  let steps = 0;
  for (;;) {
    steps += 1;
    if (steps > 5000) break; // a bound, so "it hung" is a FAILED claim rather than a hung script
    const req = sched.next();
    if (!req) break;
    // What the SHIPPED Scheduler drew, through `serve()` -> `select()`. Nothing here reaches into
    // the bank; `req.unserved` is the Scheduler's own word for "the bank came back empty".
    const sel = req.item ? { item: req.item, source: req.itemSource, relaxation: req.itemRelaxation } : null;
    if (!sel || !sel.item) {
      blanks += 1;
      sched.submit(req, { correct: false, latencyMs: 20000, itemId: `blank#${steps}` });
      continue;
    }
    if (String(sel.relaxation).startsWith("generated-group-")) degraded += 1;
    // A real string, marked by the real checker — so "the session ran" means items were answerable,
    // not that a loop counted to seventy-five.
    const right = rng() < 0.72;
    const response = right ? bank.accepts(sel.item)[0] : `${bank.accepts(sel.item)[0]}zz`;
    const verdict = bank.check(sel.item, response);
    served.push({ kpId: req.kpId, itemId: sel.item.id, source: sel.source, relaxation: sel.relaxation, correct: verdict.correct });
    sched.submit(req, {
      correct: verdict.correct,
      latencyMs: 20000,
      itemId: sel.item.id,
      misconception: verdict.misconception,
      family: req.family,
    });
    await settle(); // let any background group load land, as it would while the learner reads
  }
  sched.endSession();
  /**
   * A faulted group gives up only after three attempts spaced 250 ms and 750 ms apart. This loop
   * compresses twenty-five minutes into about forty milliseconds, so without waiting for that the
   * probe would be read before the bank had finished deciding — and "the failure is announced"
   * would be measuring the script's impatience. In play the second item is twenty seconds later.
   */
  if (fault) await new Promise((r) => setTimeout(r, 1600));
  bankIssues.onIssue = null;

  const res = bank.residency();
  return {
    lesson,
    opened,
    served,
    blanks,
    degraded,
    steps,
    issues,
    residency: res,
    bytes: __groupBytesLoaded(),
    probe: bank.probe(),
    kpsTouched: [...new Set(served.map((s) => s.kpId))],
  };
}

const session = await runSession();
detail.session = {
  lesson: session.lesson,
  itemsServed: session.served.length,
  kpsTouched: session.kpsTouched,
  groupsPulled: session.residency.resident,
  bytes: session.bytes,
  fromCatalogue: session.served.filter((s) => s.source === "catalogue").length,
  fromGenerator: session.served.filter((s) => s.source === "generated").length,
  degradedSelects: session.degraded,
  blanks: session.blanks,
};

claim(
  "B1",
  "a 25-minute session runs end to end from a COLD cache, opened through the BOOT MODULE's own warm, and never serves a blank item",
  session.served.length >= 25 &&
    session.blanks === 0 &&
    session.steps <= 5000 &&
    session.opened.reason === "ok" &&
    session.opened.lesson !== null,
  `warmFrontier() -> frontier "${session.opened.kpId}" -> lesson "${session.opened.lesson}" ` +
    `(${session.opened.groups} groups, ${session.opened.failed.length} failed, reason "${session.opened.reason}"); ` +
    `then ${session.served.length} items served over ${session.kpsTouched.length} knowledge points, ${session.blanks} blanks, ${session.steps} scheduler steps ` +
    `(the scheduler closed the session on its own 25-minute budget, not on a bound in this script)`,
  ">= 25 items, 0 blanks, terminates, and the lesson came from the engine's frontier"
);

const sessionShipped = lessonChunkBytes(session.residency.resident);
detail.session.shippedBytes = sessionShipped;
claim(
  "B2",
  "the session pulled ONLY the groups it needed — not the course",
  session.residency.resident.length <= session.kpsTouched.length + 4 && session.residency.resident.length < KP_IDS.length,
  `${session.residency.resident.length}/${KP_IDS.length} groups resident (${session.residency.resident.join(", ")}); ` +
    `${kB(sessionShipped.gzip)} gz of shipped catalogue for the whole session, against ${kB(sum(after ?? {}, isGroupChunk).gzip)} gz for all thirty-two`,
  "groups touched + at most 4 prefetched, and strictly fewer than 32"
);

claim(
  "B3",
  "every item the session served came back checkable and on the right knowledge point",
  session.served.every((s) => s.itemId && s.kpId) && session.served.some((s) => s.correct),
  `${session.served.filter((s) => s.source === "catalogue").length} from the catalogue, ${session.served.filter((s) => s.source === "generated").length} generated, ` +
    `${session.served.filter((s) => s.correct).length} marked correct by the shipped checker`,
  "every item identified and marked"
);

{
  /**
   * Prefetch, through the boot path: warm the frontier lesson, do nothing else, and see what
   * arrives during idle. Then check the SAME thing happened in the real browser — the round-2
   * criticism was not "prefetchAround is wrong", it was "prefetchAround never runs", and only the
   * live half of this answers that.
   */
  __evictAllGroups();
  const bank = new ItemBank();
  const mastery = new Mastery(graph, { now: () => 0, storage: null, bankAudit });
  const opened = await bank.warmFrontier({ frontier: () => mastery.frontier() });
  const target = MANIFEST.lessons.find((l) => l.id === opened.lesson);
  const straightAfter = bank.residency().resident.length;
  await settle();
  await settle();
  const warmed = bank.residency().resident.filter((id) => !target.kpIds.includes(id));
  const livePrefetch = cls("idlePrefetched");
  detail.prefetch = {
    lesson: target.id,
    lessonKps: target.kpIds,
    prefetched: warmed,
    liveGroupChunks: livePrefetch.groupChunks,
  };
  claim(
    "B4",
    "the NEXT likely group is prefetched during idle — offline AND in the real built game",
    warmed.length > 0 && L(livePrefetch.groupChunks.length > 0),
    `offline: warming ${target.id} loaded ${straightAfter} groups, then idle prefetch warmed ${warmed.length} more (${warmed.join(", ") || "none"}). ` +
      `live built game: after the warm resolved, two idle turns pulled ${livePrefetch.groupChunks.length} further group chunk(s) ` +
      `(${livePrefetch.groupChunks.join(", ") || "none"}, ${livePrefetch.encodedBytes} B encoded)`,
    "at least one group ahead, in both"
  );
}

{
  /**
   * THE LESSON BOUNDARY. `prefetchAround` walks forward inside the current lesson and takes only
   * the HEAD of the next one, so the second knowledge point after a boundary was still cold — and
   * the boundary is exactly where the product goal puts the learner who tests out in two minutes.
   * Once the learner is at or past halfway, the WHOLE next lesson is queued.
   */
  __evictAllGroups();
  const bank = new ItemBank();
  const lessons = bank.lessons();
  const here = lessons[0];
  const next = lessons[1];
  // A learner one knowledge point from the end of lesson 1: two of three behind them.
  const late = { frontier: () => [here.kpIds[here.kpIds.length - 1]] };
  const early = { frontier: () => [here.kpIds[0]] };
  await bank.ensureLesson(here.id);
  const atStart = bank.lookaheadFrom(here.id, early);
  const atHalf = bank.lookaheadFrom(here.id, late);
  await settle();
  await settle();
  await settle();
  const residentNext = next.kpIds.filter((id) => bank.residency().resident.includes(id));
  const cost = lessonChunkBytes(next.kpIds);
  detail.lookahead = { lesson: here.id, next: next.id, atStart, atHalf, residentNext, cost };
  claim(
    "B5",
    "at the halfway mark of a lesson the WHOLE next lesson is queued, so the boundary is never cold — and not before",
    atStart.queued.length === 0 &&
      atHalf.nextLesson === next.id &&
      atHalf.queued.length === next.kpIds.length &&
      residentNext.length === next.kpIds.length,
    `frontier on "${here.kpIds[0]}" (${(atStart.progress * 100).toFixed(0)}% through "${here.id}") queues ${atStart.queued.length}; ` +
      `frontier on "${here.kpIds[here.kpIds.length - 1]}" (${(atHalf.progress * 100).toFixed(0)}%) queues all ${atHalf.queued.length} of "${next.id}" ` +
      `(${atHalf.queued.join(", ")}) and they are resident after idle: ${residentNext.length}/${next.kpIds.length}. ` +
      `Cost of the lookahead: ${cost.gzip} B gz, against ${kB(sum(after ?? {}, isGroupChunk).gzip)} gz for the course`,
    "nothing at 0%, the whole next lesson at >=50%"
  );
}

/* ================================================================ C — the failure case */

{
  /**
   * Break a group the session ACTUALLY reaches, not a convenient one it never asks for. The
   * victim is the knowledge point the clean run above served the second-most items on: breaking
   * the very first one would be a different (and easier) test, because the session opener awaits
   * it and could be argued to have never really started.
   */
  const load = new Map();
  for (const s of session.served) load.set(s.kpId, (load.get(s.kpId) ?? 0) + 1);
  const ranked = [...load].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const victim = ranked[1] ?? ranked[0];
  const run = await runSession({ fault: victim });
  const onVictim = run.served.filter((s) => s.kpId === victim);
  const spoke = run.probe.degraded.some((d) => d.startsWith(`${victim}:`)) && run.issues.some((i) => i.kpId === victim);
  detail.failure = {
    kpId: victim,
    itemsServed: run.served.length,
    blanks: run.blanks,
    onVictim: onVictim.length,
    onVictimAllGenerated: onVictim.every((s) => s.source === "generated"),
    probeDegraded: run.probe.degraded,
    issues: run.issues,
  };
  claim(
    "C1",
    "a group that never arrives degrades to a playable session AND says so — no hang, no blank item",
    run.blanks === 0 && run.served.length >= 25 && spoke && onVictim.length > 0 && onVictim.every((s) => s.source === "generated"),
    `group "${victim}" made to fail (it carried ${load.get(victim)} of the clean run's ${session.served.length} items): ` +
      `${run.served.length} items still served, ${run.blanks} blanks, ` +
      `${onVictim.length} of them on the failed knowledge point, all generated: ${onVictim.every((s) => s.source === "generated")}; ` +
      `probe().degraded = ${JSON.stringify(run.probe.degraded)}`,
    "session completes, >=1 item still served on the failed knowledge point, 0 blanks, the failure named in the probe"
  );
  __faultGroup(victim, false);
}

{
  /**
   * ONE BLIP MUST NOT BE FOREVER.
   *
   * Round 2's `touch()` returned early on any `FAILED` entry and nothing in the shipped game ever
   * called `ensure()` a second time, so a single dropped chunk downgraded that knowledge point —
   * every item on it generated instead of authored — for the life of the page. On school wifi that
   * is not an exotic case. The window is `RETRY_AFTER_MS`; this drives it by faking the clock
   * rather than by waiting thirty seconds, then confirms the group actually comes back.
   */
  __evictAllGroups();
  const victim = "eq-two-step";
  const issues = [];
  bankIssues.onIssue = (i) => issues.push(i);
  const bank = new ItemBank();
  __faultGroup(victim, true);

  const first = bank.select({ kpId: victim, form: "construct", difficulty: 3, seed: 11 });
  await new Promise((r) => setTimeout(r, 1200)); // three attempts with 250 ms / 750 ms backoff
  const whileDown = bank.select({ kpId: victim, form: "construct", difficulty: 3, seed: 11 });
  const failedEntry = bank.residency().failed[victim];

  // The chunk becomes reachable again. `__FAULT` is cleared directly rather than through
  // `__faultGroup(..., false)`, which also evicts — and evicting would delete the `FAILED` entry
  // that is the entire subject of this claim. The timestamp is then moved rather than slept
  // through: thirty real seconds inside a proof script measures patience, not code.
  ItemBankMod.__FAULT.delete(victim);
  const res = ItemBankMod.__ageFailure(victim, 31_000);
  const stillCold = bank.select({ kpId: victim, form: "construct", difficulty: 3, seed: 11 });
  await settle();
  await settle();
  const recovered = bank.select({ kpId: victim, form: "construct", difficulty: 3, seed: 11 });
  bankIssues.onIssue = null;

  detail.retry = {
    kpId: victim,
    attempts: failedEntry?.attempts ?? null,
    duringOutage: [first?.relaxation, whileDown?.relaxation],
    aged: res,
    afterWindow: [stillCold?.relaxation, recovered?.source],
    issueKinds: issues.map((i) => i.kind),
  };
  claim(
    "C3",
    "a group that failed ONCE is retried after the backoff window instead of being degraded for the life of the page",
    (failedEntry?.attempts ?? 0) >= 3 &&
      whileDown?.relaxation === "generated-group-failed" &&
      stillCold?.relaxation === "generated-group-failed" &&
      recovered?.source === "catalogue" &&
      issues.some((i) => i.kind === "group-retry"),
    `"${victim}" made to fail: ${failedEntry?.attempts} attempts inside one load (250 ms then 750 ms apart), ` +
      `selects during the outage relaxed "${whileDown?.relaxation}"; after the ${res.retryAfterMs / 1000}s window the next select ` +
      `still answered "${stillCold?.relaxation}" synchronously but started a retry (issues: ${issues.map((i) => i.kind).join(", ")}), ` +
      `and the following select came from the ${recovered?.source}`,
    "3 attempts, retried after the window, back on the catalogue, and the retry announced"
  );
}

{
  // The cold synchronous path in isolation: what `select()` does the very first time, before any
  // chunk can possibly have arrived.
  __evictAllGroups();
  const bank = new ItemBank();
  const cold = bank.select({ kpId: "ineq-negative-flip", form: "construct", difficulty: 4, seed: 7 });
  const marked = cold ? bank.check(cold.item, bank.accepts(cold.item)[0]) : null;
  // Two turns: the speculative fetch is queued for idle (`idle` is `setTimeout(fn, 0)` in Node)
  // and the dynamic import then resolves on the turn after that. See the SWEEP GUARD note.
  await settle();
  await settle();
  const warm = bank.select({ kpId: "ineq-negative-flip", form: "construct", difficulty: 4, seed: 7 });

  /**
   * AND THE SAME THING IN A REAL BROWSER, because the offline half of this claim is an artefact.
   * Node loads every group at module init, so after `__evictAllGroups()` a `loadGroup` is one
   * already-resolved microtask and "one tick later it is catalogue" measures the module cache. The
   * live probe runs `coldSelectWindow` on a knowledge point in the LAST lesson of the course over a
   * real dynamic import — back to back, and at a 400 ms gap. A real session is 20-40 SECONDS
   * between items, so the back-to-back figure is a hard upper bound on what a learner could see.
   */
  const cw = live?.coldWindow ?? null;
  detail.coldPath = {
    cold: cold && { id: cold.item.id, source: cold.source, relaxation: cold.relaxation, standards: cold.item.standards },
    correctAnswerMarked: marked?.correct ?? null,
    warm: warm && { id: warm.item.id, source: warm.source, relaxation: warm.relaxation },
    live: cw,
  };
  claim(
    "C2",
    "a cold `select()` answers synchronously with a real, checkable, correctly-tagged item and starts the load",
    !!cold && cold.relaxation === "generated-group-absent" && marked?.correct === true && warm?.source === "catalogue",
    `cold -> ${cold?.source}/${cold?.relaxation} (${cold?.item.id}), its own correct answer marks ${marked?.correct}; ` +
      `after the idle turn the same request -> ${warm?.source}/${warm?.relaxation}`,
    "generated-group-absent, checkable, then catalogue"
  );
  claim(
    "C4",
    "in a REAL BROWSER, over a real dynamic import, the cold window costs a learner ONE generated item — and never a blank or an unmarkable one",
    L(cw) &&
      cw.immediate.blanks === 0 &&
      cw.immediate.uncheckable === 0 &&
      cw.spaced.blanks === 0 &&
      cw.spaced.uncheckable === 0 &&
      cw.spaced.degraded <= 1 &&
      cw.immediate.degraded <= 3 &&
      cw.immediate.msToCatalogue != null,
    cw
      ? `"${cw.immediateKp}" (last lesson of the course, never warmed): back to back, ${cw.immediate.degraded} of ${cw.immediate.tries} items came from the generator ` +
        `and the catalogue answered from ${cw.immediate.msToCatalogue} ms. At a 400 ms gap on "${cw.spacedKp}": ${cw.spaced.degraded} of ${cw.spaced.tries}, ` +
        `catalogue from ${cw.spaced.msToCatalogue} ms. Blanks ${cw.immediate.blanks + cw.spaced.blanks}, unmarkable ${cw.immediate.uncheckable + cw.spaced.uncheckable}. ` +
        `An item in play is 20-40 s, so a learner sees the first one degraded and nothing after it.`
      : "no live probe",
    "<=1 degraded at a realistic gap, <=3 back to back, 0 blanks, 0 unmarkable"
  );
}

/* ================================================================ D — nothing else changed */

{
  const want = bankAuditFingerprint({ bankFiles: BANK, model: graph.model });
  claim(
    "D1",
    "the catalogue fingerprint is UNCHANGED by the split, so the committed pricing table still describes the bank it prices",
    want === bankAudit.fingerprint,
    `computed ${want}, committed in bank-audit.json ${bankAudit.fingerprint}`,
    "identical"
  );
}

{
  // The identity spine must reproduce `bank/*.json` exactly as P17's C18 reads it.
  const key = (files) =>
    JSON.stringify(files.map((f) => [f.kpId, f.items.map((i) => i.id)]).sort((x, y) => (x[0] < y[0] ? -1 : 1)));
  const sameForms = BANK.every((f, i) =>
    f.items.every((it, j) => it.form === bankFiles[i].items[j].form && it.family === bankFiles[i].items[j].family && it.difficulty === bankFiles[i].items[j].difficulty)
  );
  claim(
    "D2",
    "the eager spine carries every item's id, form, family and band, in the committed order (P17 C18 shape)",
    key(BANK) === key(bankFiles) && sameForms,
    `${BANK.length} files, ${BANK.reduce((a, f) => a + f.items.length, 0)} items, ids ${key(BANK) === key(bankFiles) ? "identical" : "DIFFERENT"}, forms/families/bands ${sameForms ? "identical" : "DIFFERENT"}`,
    "identical"
  );
}

{
  // Every loaded item, field for field, against the readable artefact. `text` is the English
  // snapshot the game never renders (it resolves through STRINGS and the learner's locale — G3);
  // `kpId`, `objectClass` and `standards` were repeated on every item and are re-attached on load.
  __evictAllGroups();
  const bank = new ItemBank();
  await bank.ensure(KP_IDS);
  const norm = (v) => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === "object") {
      const o = {};
      for (const k of Object.keys(v).sort()) {
        if (k === "text" && typeof v[k] === "string") continue;
        o[k] = norm(v[k]);
      }
      return o;
    }
    return v;
  };
  let compared = 0;
  const differing = [];
  for (const f of bankFiles) {
    for (const src of f.items) {
      compared += 1;
      const got = bank.item(src.id);
      if (!got || JSON.stringify(norm(src)) !== JSON.stringify(norm(got))) differing.push(src.id);
    }
  }
  claim(
    "D3",
    "every item served from a group chunk is field-for-field the item in content/items/bank/*.json",
    differing.length === 0 && compared === 1152,
    `${compared} items compared, ${differing.length} differ (English "text" snapshots excluded — the game never renders them)`,
    "0 differ"
  );
}

{
  const sweep = load("review/measure/evidence/P31-select-sweep.json");
  const proc = await import("node:child_process");
  const out = proc.execFileSync(process.execPath, [path.join(HERE, "_p31-sweep.mjs"), ROOT], { encoding: "utf8" });
  const now = JSON.parse(out);
  detail.selectSweep = { baseline: sweep, now };
  claim(
    "D4",
    "the split changed DELIVERY and nothing else: 5,088 seeded selections come back byte-identical to the pre-split tree",
    now.digest === sweep.digest && now.rows === sweep.rows && now.nullRows === 0,
    `digest ${now.digest} over ${now.rows} selections (${now.catalogueRows} catalogue / ${now.generatedRows} generated / ${now.nullRows} null); ` +
      `pre-split tree at ${sweep.commit.slice(0, 10)} gave ${sweep.digest}`,
    "identical digest"
  );
}

{
  const same = JSON.stringify(manifestJson) === JSON.stringify(MANIFEST);
  const inALesson = new Map();
  for (const l of MANIFEST.lessons) for (const id of l.kpIds) inALesson.set(id, (inALesson.get(id) ?? 0) + 1);
  const orphans = KP_IDS.filter((id) => !inALesson.has(id));
  const doubled = [...inALesson].filter(([, n]) => n > 1).map(([id]) => id);
  const overLong = MANIFEST.lessons.filter((l) => l.estMinutes > MANIFEST.lessonMinutes);
  const countsAgree = KP_IDS.every((id) => MANIFEST.kps[id].count === bankFiles.find((f) => f.kpId === id).items.length);
  claim(
    "D5",
    "the manifest is complete, single-valued and Pomodoro-shaped, and the shipped copy equals the readable one",
    same && orphans.length === 0 && doubled.length === 0 && overLong.length === 0 && countsAgree,
    `manifest.mjs == manifest.json: ${same}; ${MANIFEST.lessons.length} lessons cover ${inALesson.size}/${KP_IDS.length} knowledge points, ` +
      `${orphans.length} orphans, ${doubled.length} in two lessons, ${overLong.length} over ${MANIFEST.lessonMinutes} min, item counts agree: ${countsAgree}`,
    "0 orphans, 0 doubled, 0 over-long, counts agree"
  );
}

{
  // The coverage gates L4 leans on must be computed over the WHOLE catalogue, not over whatever
  // is in memory — otherwise a thin knowledge point passes by being absent.
  __evictAllGroups();
  const cold = new ItemBank().probe();
  const bank2 = new ItemBank();
  await bank2.ensure(KP_IDS);
  const warm = bank2.probe();
  const stable =
    cold.knowledgePoints === warm.knowledgePoints &&
    cold.minItemsPerKp === warm.minItemsPerKp &&
    cold.minItemsPerMisconception === warm.minItemsPerMisconception &&
    JSON.stringify(cold.formsPerKp) === JSON.stringify(warm.formsPerKp) &&
    cold.catalogueItems === warm.catalogueItems;
  detail.probeStability = { cold, warm };
  claim(
    "D6",
    "the coverage numbers a reviewer reads do not depend on what happens to be loaded",
    stable && cold.knowledgePoints === 32 && cold.minItemsPerKp === 36,
    `with 0 groups resident: ${cold.knowledgePoints} kps, min ${cold.minItemsPerKp} items/kp, min ${cold.minItemsPerMisconception} items/misconception, ${cold.catalogueItems} catalogue items — ` +
      `identical with all 32 resident: ${stable}`,
    "identical cold and warm"
  );
}

{
  /**
   * The locale table is split by LANGUAGE, not by knowledge point — a generated item can name any
   * key, so a per-knowledge-point split of the strings would be wrong. The test is that splitting
   * it lost nothing: the three chunks reassembled must be `content/items/strings.json`, key for
   * key, locale for locale, IN ORDER, and every key must resolve through `ItemBank.text()` in
   * every language with no English leaking into a Spanish or Polish session (G3).
   */
  const strings = load("content/items/strings.json").keys;
  const keys = Object.keys(strings);
  const perLocale = {};
  for (const l of ["en", "es", "pl"]) perLocale[l] = await loadItemStrings(l);
  const bank = new ItemBank();
  let mismatched = 0;
  let englishLeaks = 0;
  for (const l of ["en", "es", "pl"]) {
    await bank.loadLocale(l);
    for (const k of keys) {
      if (perLocale[l][k] !== strings[k][l]) mismatched += 1;
      // A key whose translation differs from English must not come back as the English string.
      if (strings[k][l] !== strings[k].en && bank.text(k, {}, l) === strings[k].en) englishLeaks += 1;
    }
  }
  await bank.loadLocale("en");
  detail.localeSplit = {
    keys: keys.length,
    chunkKeys: Object.fromEntries(Object.entries(perLocale).map(([l, t]) => [l, Object.keys(t).length])),
    mismatched,
    englishLeaks,
    liveLocaleChunks: cls("criticalPath").itemLocaleChunks,
  };
  claim(
    "D7",
    "the item locale table is one chunk per language and the three reassemble to strings.json exactly — and the page pulls ONE",
    JSON.stringify(STRINGS) === JSON.stringify(strings) &&
      mismatched === 0 &&
      englishLeaks === 0 &&
      L(cls("criticalPath").itemLocaleChunks.length === 1),
    `${keys.length} keys x 3 locales; ${mismatched} strings differ from strings.json, ${englishLeaks} English leaks through text() in es/pl; ` +
      `the reassembled table is byte-identical to strings.json; the live built game pulled ${JSON.stringify(cls("criticalPath").itemLocaleChunks)}`,
    "0 differences, 0 leaks, exactly 1 locale chunk fetched"
  );
}

/* ================================================================ E — the loader has a caller */

/**
 * ROUND 2 DIED HERE, so these claims are written to fail in exactly the way it failed.
 *
 * The critic's finding was not that per-lesson loading was broken; it was that nothing in the
 * shipped game ran it. `ensure`, `ensureLesson` and `prefetchAround` appeared nowhere under `app/`
 * except their own definitions, so the byte win was real and the delivery was fiction. E1 is that
 * grep, executed. E2 is the browser's own record that the caller fired. A delivery mechanism with
 * no caller must not be able to report PASS.
 */

function sourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...sourceFiles(rel));
    else if (/\.(js|mjs)$/.test(entry.name)) out.push(rel);
  }
  return out;
}

{
  /**
   * COMMENTS ARE STRIPPED FIRST. Round 2's file talked about `ensureLesson` in a doc comment and
   * never called it; a grep that counts prose would have reported PASS on exactly the state the
   * critic rejected. Only executable text is searched here.
   */
  const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
  const files = sourceFiles("app/src");
  const DEFINITION = "app/src/learn/ItemBank.js";
  const code = new Map(
    files.map((f) => [f, stripComments(fs.readFileSync(path.join(ROOT, f), "utf8"))])
  );
  const where = (re) => files.filter((f) => f !== DEFINITION && re.test(code.get(f)));

  const warmCallers = where(/\.\s*warmFrontier(WhenIdle)?\s*\(/);
  const subscribers = where(/bankIssues\s*\.\s*onIssue\s*=/);
  /**
   * The signal subscriptions that make the warm FOLLOW the learner, and the bounded idle re-check
   * that does not depend on anyone else's emit. Round 3 had neither: one `warm()` inside `setup()`.
   */
  const signalFollowers = where(/signals\s*\.\s*on\s*\(\s*["'](learn:mastery|learn:session)["']/);
  const lookaheadCallers = where(/\.\s*lookaheadFrom\s*\(/);

  /**
   * The static half cannot see through `warmFrontier` into `ensureLesson` and `prefetchAround`,
   * which live in the same file as their caller. So the chain is exercised: patch the two methods
   * to count, run the boot module's entry point, and put the counts in the claim. A grep can be
   * satisfied by a mention; this cannot.
   */
  __evictAllGroups();
  const spy = { ensureLesson: 0, ensure: 0, prefetchAround: 0 };
  const proto = ItemBank.prototype;
  const original = {
    ensureLesson: proto.ensureLesson,
    ensure: proto.ensure,
    prefetchAround: proto.prefetchAround,
  };
  for (const name of Object.keys(spy)) {
    proto[name] = function patched(...args) {
      spy[name] += 1;
      return original[name].apply(this, args);
    };
  }
  const spyBank = new ItemBank();
  const spyMastery = new Mastery(graph, { now: () => 0, storage: null, bankAudit });
  const spyWarm = await spyBank.warmFrontier({ frontier: () => spyMastery.frontier() });
  for (const name of Object.keys(spy)) proto[name] = original[name];

  detail.callers = { warmCallers, signalFollowers, lookaheadCallers, subscribers, chain: spy, spyWarm };
  const bootWarms = warmCallers.some((f) => f.startsWith("app/src/boot/"));
  const bootFollows = signalFollowers.some((f) => f.startsWith("app/src/boot/"));
  const chained = spy.ensureLesson >= 1 && spy.ensure >= 1 && spy.prefetchAround >= 1;
  /**
   * ROUND 3 FAILED ON THIS CLAIM'S WORDING. It printed "`ensure`/`ensureLesson` in [NOTHING]" and
   * still reported PASS, because the grep was decoration next to a pass condition that did not use
   * it. It is gone. `ensure` and `ensureLesson` are NOT called from outside `ItemBank.js` and never
   * were meant to be: they are reached THROUGH `warmFrontier`, which is the one entry point the
   * boot module holds, and the spy counters below execute that chain rather than asserting it.
   * Every list printed here is now part of the pass condition.
   */
  claim(
    "E1",
    "the per-lesson loader is CALLED from the shipped game — executable code, not a doc comment — it FOLLOWS the learner, and the degradation channel has a subscriber",
    bootWarms && bootFollows && lookaheadCallers.length > 0 && subscribers.length > 0 && chained,
    `with comments stripped: \`warmFrontier\`/\`warmFrontierWhenIdle\` is CALLED in [${warmCallers.join(", ") || "NOTHING"}]; ` +
      `the frontier is FOLLOWED by \`signals.on("learn:mastery"/"learn:session")\` in [${signalFollowers.join(", ") || "NOTHING"}]; ` +
      `\`lookaheadFrom\` is called in [${lookaheadCallers.join(", ") || "NOTHING"}]; ` +
      `\`bankIssues.onIssue\` is assigned in [${subscribers.join(", ") || "NOTHING"}]. ` +
      `\`ensure\`/\`ensureLesson\`/\`prefetchAround\` are deliberately NOT called from outside ItemBank.js — they are reached through ` +
      `\`warmFrontier\`, and driving that one entry point executed ensureLesson x${spy.ensureLesson}, ensure x${spy.ensure}, ` +
      `prefetchAround x${spy.prefetchAround}, opening "${spyWarm.lesson}"`,
    "a boot module calls warmFrontier AND subscribes to the frontier's signals AND calls lookaheadFrom; the chain reaches ensureLesson and prefetchAround; onIssue has a subscriber"
  );
}

{
  const w = live?.warm ?? null;
  const pulled = cls("warmPulled");
  claim(
    "E2",
    "in the REAL built game the warm ran, off the critical path, on the lesson the ENGINE named — and pulled that lesson's chunks",
    L(w) &&
      w.reason === "ok" &&
      !!w.lesson &&
      w.kpId === (live.frontier?.[0] ?? null) &&
      w.failed.length === 0 &&
      pulled.groupChunks.length === w.groups &&
      pulled.groupChunks.length > 0,
    `learning.frontier() = ${JSON.stringify(live.frontier)}; the warm resolved lesson "${w?.lesson}" from "${w?.kpId}" ` +
      `in ${w?.ms} ms and loaded ${w?.groups} groups. The browser's resource timings show those exact ${pulled.groupChunks.length} chunks ` +
      `(${pulled.groupChunks.join(", ")}, ${pulled.encodedBytes} B encoded) requested AFTER ready, none before it.`,
    "warm ok, frontier-derived lesson, >0 group chunks, all after ready"
  );
}

{
  /**
   * The fingerprint scalar, and the hole it could have opened. The build precomputes
   * `bankAuditFingerprint` so the 1152-item identity spine does not have to ship; that is only safe
   * because the constants it was folded over are keyed and rechecked at runtime. This runs the
   * SHIPPED basis function over the LIVE constants — if the build's copy and the barrel's copy ever
   * drift, this is where it shows.
   */
  const liveBasis = bankFingerprintBasis({
    version: Mast.BANK_AUDIT_VERSION,
    perCell: Mast.BANK_AUDIT_PER_CELL,
    window: Mast.BANK_AUDIT_WINDOW,
    candidates: Mast.EXECUTED_CANDIDATES,
    sampleCap: Mast.EXECUTED_SAMPLE_CAP,
    forms: Mast.EXECUTED_FORMS,
    caps: graph.model?.bkt?.identifiabilityCaps ?? {},
  });
  const recomputed = bankAuditFingerprint({ bankFiles: BANK, model: graph.model });
  const liveAudit = live?.bankAudit ?? {};
  detail.fingerprint = {
    scalar: BANK_FINGERPRINT,
    recomputedFromSpine: recomputed,
    committed: bankAudit.fingerprint,
    basisAtBuild: BANK_FINGERPRINT_BASIS,
    basisLive: liveBasis,
    liveAudit,
  };
  claim(
    "E3",
    "the audit fingerprint ships as a SCALAR, matches a full recomputation, and the identity spine is never requested by the page",
    BANK_FINGERPRINT !== null &&
      BANK_FINGERPRINT === recomputed &&
      BANK_FINGERPRINT === bankAudit.fingerprint &&
      liveBasis === BANK_FINGERPRINT_BASIS &&
      L(liveAudit.fingerprintSource === "build-time") &&
      cls("criticalPath").spineChunks.length === 0 &&
      cls("warmPulled").spineChunks.length === 0,
    `BANK_FINGERPRINT ${BANK_FINGERPRINT} == recomputed over all 1152 items ${recomputed} == committed ${bankAudit.fingerprint}; ` +
      `basis key ${BANK_FINGERPRINT_BASIS} recomputed from the live Mastery constants gives ${liveBasis}; ` +
      `the live game reports fingerprintSource "${liveAudit.fingerprintSource}" and resolved the price in ${liveAudit.setupMs} ms, ` +
      `having requested 0 spine chunks`,
    "identical, basis agrees, spine never fetched"
  );
}

/* ============================================== E4-E6 — does it FOLLOW the learner, and who calls it */

/**
 * ROUND 3 DIED HERE.
 *
 * The byte win was real and the boot warm did fire — once, inside `setup()`, and never again. The
 * critic drove the shipped engine through 600 scored items over 19 sessions and it pulled ZERO
 * further group chunks, so the learner the whole product goal is about — the one who tests out of
 * `expressions-1` in two minutes — walked into a lesson nothing had warmed.
 *
 * E4/E5 are that finding, executed: the frontier is moved across a lesson boundary IN THE BUILT
 * GAME, twice, by two different mechanisms, and the browser's own resource timings say what was
 * fetched. E6 answers the other half — whether the ON-DEMAND path (a cold `select()` during play)
 * has a caller in the shipped game at all.
 *
 * `learning.drive()` is deliberately NOT the instrument. Measured offline, the shipped self-drive
 * parks on `expr-anatomy` and stays there at 600, 1,200, 2,000, 3,000 and 4,500 items, so the
 * frontier NEVER leaves `expressions-1` and no harness built on it can observe a crossing however
 * the loader behaves. The crossings below use `Mastery.certify()` — the engine's own entry point,
 * the one a passed retention check calls — and `Mastery.snapshot()`/`restore()`, the shipped save
 * path, which moves the frontier while emitting nothing at all.
 */
{
  const x = live?.crossings ?? null;
  const log = x?.warmLog ?? [];
  const c1 = cls("crossing1Pulled");
  const c2 = cls("crossing2Pulled");
  const bySeq = (n) => log.find((r) => r.seq === n) ?? null;
  detail.crossings = { crossings: x, crossing1Pulled: c1, crossing2Pulled: c2 };

  claim(
    "E4",
    "the warm FOLLOWS THE LEARNER: crossing a lesson boundary in the built game re-warms on the ENGINE's signal and pulls the new lesson's chunks",
    L(x) &&
      x.one.lessonBefore !== x.one.lessonAfter &&
      x.warms >= 2 &&
      bySeq(2)?.trigger === "mastery-signal" &&
      bySeq(2)?.lesson === x.one.lessonAfter &&
      bySeq(2)?.reason === "ok" &&
      c1.groupChunks.length >= bySeq(2).groups &&
      c1.groupChunks.length > 0,
    x
      ? `the learner certified "${x.one.lessonBefore}" through Mastery.certify(); the frontier moved "${x.one.before}" -> "${x.one.after}", ` +
        `i.e. "${x.one.lessonBefore}" -> "${x.one.lessonAfter}". probe().warms went 1 -> ${x.warms}; warm #2 records trigger ` +
        `"${bySeq(2)?.trigger}", lesson "${bySeq(2)?.lesson}", ${bySeq(2)?.groups} groups, reason "${bySeq(2)?.reason}". ` +
        `The browser fetched ${c1.groupChunks.length} new group chunks (${c1.groupChunks.join(", ")}, ${c1.encodedBytes} B encoded) ` +
        `— round 3 fetched 0 here.`
      : "no live probe",
    "lesson changed, warms >= 2, trigger mastery-signal, >0 chunks pulled"
  );

  claim(
    "E5",
    "and it follows the learner even when NOTHING emits: a silent frontier move is caught by the bounded idle re-check",
    L(x) &&
      x.two.restored === true &&
      x.two.lessonBefore !== x.two.lessonAfter &&
      x.warms >= 3 &&
      bySeq(3)?.trigger === "idle-recheck" &&
      bySeq(3)?.lesson === x.two.lessonAfter &&
      c2.groupChunks.length > 0,
    x
      ? `Mastery.snapshot() -> mark "${x.two.lessonBefore}" mastered -> Mastery.restore() (restored: ${x.two.restored}, carried a scheduler block: ${x.two.carriedScheduler}) ` +
        `emits no signal at all — this is the shape of learning.drive()'s swap and of a save being loaded. The frontier moved ` +
        `"${x.two.lessonBefore}" -> "${x.two.lessonAfter}" silently, and ${(live.crossings.warmState?.recheckMs ?? 0) / 1000}s later warm #3 recorded ` +
        `trigger "${bySeq(3)?.trigger}" on lesson "${bySeq(3)?.lesson}" and the browser fetched ${c2.groupChunks.length} chunks ` +
        `(${c2.groupChunks.join(", ")}, ${c2.encodedBytes} B encoded). A delivery mechanism that depended on another piece's emit would have missed this.`
      : "no live probe",
    "silent move caught, warms >= 3, trigger idle-recheck, >0 chunks pulled"
  );

  const la = live?.lookahead ?? null;
  const lap = cls("lookaheadPulled");
  const residentAfter = new Set(la?.probe?.residentGroups ?? []);
  detail.liveLookahead = { lookahead: la && { ...la, probe: undefined }, pulled: lap };
  claim(
    "E6",
    "halfway through a lesson the built game pulls the WHOLE next lesson, so the boundary itself is never cold",
    L(la) &&
      la.warmState?.lookedAheadFrom === la.lesson &&
      !!la.nextLesson &&
      la.nextLessonKps.length > 0 &&
      la.nextLessonKps.every((id) => residentAfter.has(id)),
    la
      ? `certifying ${JSON.stringify(la.certified)} put the learner halfway through "${la.lesson}"; the boot module saw the lesson had NOT changed ` +
        `and evaluated the lookahead instead, recording lookedAheadFrom "${la.warmState?.lookedAheadFrom}" and queueing "${la.nextLesson}" ` +
        `(${la.nextLessonKps.join(", ")}). The browser fetched ${lap.groupChunks.length} further group chunk(s) (${lap.groupChunks.join(", ") || "none — already resident"}, ` +
        `${lap.encodedBytes} B) and all ${la.nextLessonKps.length} of the next lesson's groups are resident BEFORE the learner reaches it.`
      : "no live probe",
    "lookahead fired mid-lesson, whole next lesson resident"
  );
}

{
  /**
   * THE ON-DEMAND HALF'S CALLER.
   *
   * Round 3's critic: *"`Scheduler.serve()` — the one API that pairs a scheduler request with a
   * bank item — has ZERO callers under `app/`"*. P32 has since closed that: `Scheduler.next()`
   * draws every item through `serve(req, this.bank)`, and `app/src/boot/63-learnserve.js` attaches
   * the bank. This measures the consequence for P31 rather than restating it — driving the SHIPPED
   * `learning.next()` / `learning.submit()` loop in the built page, with nothing in the loop
   * touching the bank, and asking the browser what got fetched.
   */
  const p = live?.play ?? null;
  const pulled = cls("gameplayPulled");
  const ls = live?.learnserve ?? null;
  detail.gameplay = { play: p && { items: p.items, sources: p.sources, kps: p.kps, unserved: p.unserved }, pulled, learnserve: ls };
  claim(
    "E7",
    "the ON-DEMAND half has a caller in the shipped game: playing the built app pulls group chunks that no script asked for",
    L(p) &&
      !p.error &&
      ls?.attached === true &&
      p.items >= 100 &&
      p.unserved === 0 &&
      (p.sources?.catalogue ?? 0) > 0 &&
      pulled.groupChunks.length > 0,
    p
      ? `boot/63-learnserve.js reports attached=${ls?.attached} (familyReporting via "${ls?.familyReportingSource}", serveMisses ${ls?.serveMisses}); ` +
        `driving learning.next()/submit() for ${p.items} items over ${p.kps?.length} knowledge points served ` +
        `${p.sources?.catalogue ?? 0} from the catalogue and ${p.sources?.generated ?? 0} generated, ${p.unserved} unserved. ` +
        `Scheduler.serve() -> ItemBank.select() pulled ${pulled.groupChunks.length} group chunks (${kB(pulled.encodedBytes)} encoded) with nothing in the ` +
        `driving loop touching the bank. Round 3 measured 0 here.`
      : "no live probe",
    "learnserve attached, >=100 items, 0 unserved, >0 catalogue items, >0 chunks pulled by gameplay"
  );
}

/* ============================================ F — the cliff nobody had bounded: a stale bank audit */

{
  /**
   * `app/src/boot/62-learning.js` recomputes the blind-guess audit live whenever `bank-audit.json`
   * is stale, by driving `collectBankSample` through `itemBank.select()` across every knowledge
   * point and every form. Splitting the catalogue put a cliff under that fallback and nobody had
   * measured it. Both halves are measured here, on the real code, with the real sweep.
   *
   * The reduced `perCell`/`tailDraws` below shrink the DRAW COUNT, not the shape: the sweep still
   * visits all 32 knowledge points x 3 forms, which is the only thing chunk counting depends on.
   * At the shipped constants the same sweep takes 282 s of blocking arithmetic and asks for the
   * same groups.
   */
  const proc = await import("node:child_process");
  const raw = proc.execFileSync(process.execPath, [path.join(HERE, "_p31-audit-sweep.mjs"), ROOT], {
    encoding: "utf8",
    maxBuffer: 1 << 24,
  });
  const sweep = JSON.parse(raw);
  const groupGz = sum(after ?? {}, isGroupChunk).gzip;
  const wouldCost = Math.round((groupGz * sweep.guarded.requested) / Math.max(1, KP_IDS.length));
  detail.staleAudit = { ...sweep, courseGzip: groupGz, boundGzip: wouldCost };
  claim(
    "F1",
    "a STALE bank audit cannot pull the whole catalogue onto the critical path — the sweep is bounded, and bounding it costs the audit nothing",
    sweep.guarded.requested < KP_IDS.length &&
      sweep.guarded.requested <= 12 &&
      sweep.guarded.residentDuringSweep === 0 &&
      sweep.unguarded.residentDuringSweep === 0 &&
      sweep.sameSample === true,
    `the live-recompute sweep drew ${sweep.guarded.sampled} items across all ${KP_IDS.length} knowledge points. ` +
      `Unguarded it requests ${sweep.unguarded.requested}/${KP_IDS.length} group chunks (${kB(groupGz)} gz, the whole course) on the critical path; ` +
      `guarded it requests ${sweep.guarded.requested} (~${kB(wouldCost)} gz). ` +
      `Bounding it is free because the sweep is ONE synchronous block: with and without the guard it ends with ` +
      `${sweep.guarded.residentDuringSweep} groups resident, so not one requested chunk could have reached the sample — ` +
      `the source mix is ${JSON.stringify(sweep.guarded.mix)} either way (identical: ${sweep.sameSample}).`,
    "< 32 chunks requested, 0 could have arrived in time, and the sample is unchanged"
  );

  claim(
    "F2",
    "the same guard is invisible to a session: nothing a learner does is ever suppressed",
    sweep.session.suppressed === 0 && sweep.session.demandLoads > 0 && sweep.session.items >= 25,
    `a full scheduler-driven session (${sweep.session.items} items over ${sweep.session.kps} knowledge points, compressed into ` +
      `${sweep.session.ms} ms of wall clock — a learner takes 20-40 s per item) started ${sweep.session.demandLoads} speculative loads and had ` +
      `${sweep.session.suppressed} suppressed. The guard is relevance, not rate: a knowledge point stays eligible while it is one of the ` +
      `last ${sweep.session.recentWindow} a cold select asked for, and a session works on ${sweep.session.kps}.`,
    "0 suppressed in a session, >0 speculative loads still made"
  );
}

/* ================================================================ report */

const passed = results.filter((r) => r.pass).length;
const verdict = passed === results.length;

if (JSON_ONLY) {
  console.log(JSON.stringify({ piece: "P31", pass: verdict, passed, of: results.length, results, detail }, null, 1));
} else {
  const say = (s) => console.log(s);
  say("");
  say("P31 — per-lesson item loading. Measured against a real vite build, not a description of one.");
  say("=".repeat(100));
  for (const r of results) {
    say(`${r.pass ? "PASS" : "FAIL"}  ${r.id}  ${r.claim}`);
    say(`        measured : ${r.measured}`);
    say(`        threshold: ${r.threshold}`);
    for (const n of r.notes ?? []) say(`        note     : ${n}`);
    say("");
  }
  say("-".repeat(100));
  const c = detail.catalogueChunk;
  if (c.before && c.after) {
    say(`catalogue chunk : ${kB(c.before.raw)} / ${kB(c.before.gzip)} gz  ->  ${kB(c.after.raw)} / ${kB(c.after.gzip)} gz`);
  }
  const f = detail.firstLoad;
  if (f.after) {
    say(`first load      : ${kB(f.before.gzip)} gz  ->  ${kB(f.after.gzip)} gz   (-${kB(f.before.gzip - f.after.gzip)} gz)`);
  }
  const lc = detail.lessons.map((l) => l.shippedGzip);
  say(`one lesson      : ${Math.min(...lc)}–${Math.max(...lc)} B gz of catalogue (22 lessons, whole course ${kB(detail.groupChunks.gzip)} gz)`);
  say(`cold session    : ${detail.session.itemsServed} items, ${detail.session.groupsPulled.length} groups pulled, ${kB(detail.session.shippedBytes.gzip)} gz`);
  say("-".repeat(100));
  say(`${passed}/${results.length} claims pass — P31 ${verdict ? "PASSES" : "FAILS"}`);
  say("");
}

fs.mkdirSync(path.join(ROOT, "review/measure/out/P31"), { recursive: true });
fs.writeFileSync(
  path.join(ROOT, "review/measure/out/P31/P31.json"),
  JSON.stringify({ piece: "P31", pass: verdict, passed, of: results.length, results, detail }, null, 1) + "\n"
);

process.exit(verdict ? 0 : 1);
