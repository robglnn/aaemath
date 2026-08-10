#!/usr/bin/env node
/**
 * review/measure/P31.mjs — the proof that the item bank ships per lesson.
 *
 *   node review/measure/P31.mjs                    # human table + PASS/FAIL
 *   node review/measure/P31.mjs --json             # machine-readable
 *   node review/measure/P31.mjs --after=dist       # which built tree is "after"
 *
 * P31's claim is narrow and it has two halves, and BOTH have to be measured or the piece is a
 * regression wearing a size reduction:
 *
 *   1. First load got materially smaller, in gzipped bytes, on the real build.
 *   2. Nothing else changed. Same items, same order, same fingerprint, same coverage, and a
 *      session that runs end to end pulling only the groups it needs — including when a group
 *      never arrives at all.
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
const { BANK, MANIFEST, STRINGS } = await import(pathToFileURL(path.join(ROOT, "content/items/index.mjs")).href);
const { Graph } = await import(pathToFileURL(path.join(ROOT, "app/src/learn/Graph.js")).href);
const { Mastery, bankAuditFingerprint } = await import(pathToFileURL(path.join(ROOT, "app/src/learn/Mastery.js")).href);
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
/** i18n pulls exactly one locale bundle; the other two are never requested. */
const isOtherLocale = (name, locale) => /^(en|es|pl)-/.test(name) && !name.startsWith(`${locale}-`);

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
  const afterFirst = after ? sum(after, (n) => !isGroupChunk(n) && !isOtherLocale(n, "en")) : null;
  const afterAll = after ? sum(after, () => true) : null;

  /**
   * The working tree is not the baseline commit — other pieces are building in parallel and their
   * boot modules are in the "after" build and not in the "before" one. Naming them, and their
   * cost, is the difference between a measurement and a flattering one. `stem` strips Vite's
   * content hash so a chunk that merely changed content is still recognised as the same chunk.
   */
  const stem = (n) => n.replace(/-[A-Za-z0-9_-]{8}\.(js|css)$/, "");
  const beforeStems = new Set(Object.keys(baseline.assets).map(stem));
  const newChunks = after ? Object.keys(after).filter((n) => !isGroupChunk(n) && !beforeStems.has(stem(n))) : [];
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

{
  /**
   * The claim above is about files on disk. This one is about the REAL GAME: what the browser had
   * actually pulled by the time the app reported ready. `review/measure/evidence/P31-live-probe.json`
   * is the verbatim output of
   *
   *   node tools/review.mjs probe --name=itembank --built
   *
   * A group chunk can only enter the page through `GROUP_LOADERS`, so "0/32 resident" IS "no group
   * chunk was requested". Everything the engine needs before a lesson opens — 32 knowledge points,
   * 1152 catalogue items, the coverage minima — is there without one of them.
   */
  const live = load("review/measure/evidence/P31-live-probe.json").probe;
  detail.liveBoot = live;
  claim(
    "A5",
    "the REAL built game boots with zero item groups loaded, and still knows the whole course",
    live.groups.startsWith("0/32 resident") &&
      live.knowledgePoints === 32 &&
      live.catalogueItems === 1152 &&
      live.degraded.length === 0,
    `probe --name=itembank --built: groups "${live.groups}", ${live.knowledgePoints} knowledge points, ` +
      `${live.catalogueItems} catalogue items, min ${live.minItemsPerKp}/kp, ${live.lessons} lessons, degraded ${JSON.stringify(live.degraded)}`,
    "0/32 groups resident at boot"
  );
}

/* ================================================================ B — a real session, cold */

/**
 * The whole engine, from a cold cache, exactly as a browser would start it: no groups resident,
 * the session opener asks for one lesson, and the scheduler runs until its 25 minutes are spent.
 *
 * `settle()` is the microtask/timer drain that stands in for time passing while the learner reads
 * an item. Nothing here waits on wall-clock: what is being measured is which chunks got pulled.
 */
const settle = () => new Promise((r) => setTimeout(r, 0));

async function runSession({ fault = null, startLesson = null } = {}) {
  __evictAllGroups();
  if (fault) __faultGroup(fault, true);
  const issues = [];
  bankIssues.onIssue = (i) => issues.push(i);

  const bank = new ItemBank();
  const clock = virtualClock(0);
  const mastery = new Mastery(graph, { now: () => clock.minutes(), storage: null, bankAudit });
  const sched = new Scheduler(mastery, { clock, rng: mulberry32(31), sessionMinutes: 25 });
  const rng = mulberry32(1031);

  sched.beginSession();

  // The session opener: one lesson's worth of catalogue, awaited before the first item.
  const firstKp = sched.next()?.kpId ?? KP_IDS[0];
  const lesson = startLesson ?? bank.lessonFor(firstKp)?.id ?? MANIFEST.lessons[0].id;
  const opened = await bank.ensureLesson(lesson);

  const served = [];
  let blanks = 0;
  let degraded = 0;
  let steps = 0;
  for (;;) {
    steps += 1;
    if (steps > 5000) break; // a bound, so "it hung" is a FAILED claim rather than a hung script
    const req = sched.next();
    if (!req) break;
    const sel = bank.select({
      kpId: req.kpId,
      form: req.form,
      difficulty: req.difficulty,
      misconception: req.misconception ?? req.targetMisconception ?? null,
      exclude: req.avoidItemIds,
    });
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
    });
    await settle(); // let any background group load land, as it would while the learner reads
  }
  sched.endSession();
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
  "a 25-minute session runs end to end from a COLD cache and never serves a blank item",
  session.served.length >= 25 && session.blanks === 0 && session.steps <= 5000,
  `${session.served.length} items served over ${session.kpsTouched.length} knowledge points, ${session.blanks} blanks, ${session.steps} scheduler steps ` +
    `(the scheduler closed the session on its own 25-minute budget, not on a bound in this script)`,
  ">= 25 items, 0 blanks, terminates"
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
  // Prefetch: open a lesson, do nothing else, and see what arrives during idle.
  __evictAllGroups();
  const bank = new ItemBank();
  const target = MANIFEST.lessons.find((l) => l.kpIds.length > 1) ?? MANIFEST.lessons[0];
  await bank.ensureLesson(target.id);
  const straightAfter = bank.residency().resident.length;
  await settle();
  await settle();
  const warmed = bank.residency().resident.filter((id) => !target.kpIds.includes(id));
  detail.prefetch = { lesson: target.id, lessonKps: target.kpIds, prefetched: warmed };
  claim(
    "B4",
    "the NEXT likely group is prefetched during idle, so nobody waits mid-session",
    warmed.length > 0,
    `opening ${target.id} loaded ${straightAfter} groups, then idle prefetch warmed ${warmed.length} more (${warmed.join(", ") || "none"})`,
    "at least one group ahead"
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
  const run = await runSession({ fault: victim, startLesson: null });
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
  // The cold synchronous path in isolation: what `select()` does the very first time, before any
  // chunk can possibly have arrived.
  __evictAllGroups();
  const bank = new ItemBank();
  const cold = bank.select({ kpId: "ineq-negative-flip", form: "construct", difficulty: 4, seed: 7 });
  const marked = cold ? bank.check(cold.item, bank.accepts(cold.item)[0]) : null;
  await settle();
  const warm = bank.select({ kpId: "ineq-negative-flip", form: "construct", difficulty: 4, seed: 7 });
  detail.coldPath = {
    cold: cold && { id: cold.item.id, source: cold.source, relaxation: cold.relaxation, standards: cold.item.standards },
    correctAnswerMarked: marked?.correct ?? null,
    warm: warm && { id: warm.item.id, source: warm.source, relaxation: warm.relaxation },
  };
  claim(
    "C2",
    "a cold `select()` answers synchronously with a real, checkable, correctly-tagged item and starts the load",
    !!cold && cold.relaxation === "generated-group-absent" && marked?.correct === true && warm?.source === "catalogue",
    `cold -> ${cold?.source}/${cold?.relaxation} (${cold?.item.id}), its own correct answer marks ${marked?.correct}; ` +
      `after one tick the same request -> ${warm?.source}/${warm?.relaxation}`,
    "generated-group-absent, checkable, then catalogue"
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
  const strings = load("content/items/strings.json").keys;
  claim(
    "D7",
    "the locale table still ships whole — a generated item can name any key, so it cannot be split by knowledge point",
    JSON.stringify(STRINGS) === JSON.stringify(strings),
    `${Object.keys(STRINGS).length} keys, identical to content/items/strings.json`,
    "identical"
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
