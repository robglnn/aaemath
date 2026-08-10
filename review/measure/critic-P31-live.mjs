#!/usr/bin/env node
/**
 * critic-P31-live.mjs — what the REAL built game actually pulls over HTTP.
 *
 * One browser session, production build (`vite preview`), answering four questions P31's own
 * script answers only in Node:
 *
 *   1. Which assets does the page fetch before it reports ready? (resource timing, not a heuristic)
 *   2. Are any item-group chunks among them?
 *   3. If a learner PLAYS — the shipped Scheduler, driven for real — do groups get pulled?
 *   4. When a group chunk is 404'd on the wire, does per-lesson loading degrade or hang?
 */
import fs from "node:fs";
import path from "node:path";
import { openGame, ROOT } from "../../tools/lib/session.mjs";

const KP_IDS = JSON.parse(fs.readFileSync(path.join(ROOT, "content/knowledge-graph.json"), "utf8")).nodes.map((n) => n.id);
const LESSONS = JSON.parse(fs.readFileSync(path.join(ROOT, "content/items/manifest.json"), "utf8")).lessons;

const out = {};

await openGame({ built: true, width: 640, height: 360 }, async (d) => {
  const { page } = d;

  /* ---------------------------------------------------------------- 1 + 2: the boot fetch set */
  const boot = await page.evaluate(() =>
    performance.getEntriesByType("resource").map((r) => ({
      url: r.name,
      type: r.initiatorType,
      enc: r.encodedBodySize,
      dec: r.decodedBodySize,
    }))
  );
  const nameOf = (u) => u.split("/").pop().split("?")[0];
  const isGroup = (n) => KP_IDS.some((id) => n === `${id}.js` || n.startsWith(`${id}-`));
  out.bootAssets = boot.map((r) => nameOf(r.url));
  out.bootJsCss = out.bootAssets.filter((n) => /\.(js|css)$/.test(n)).sort();
  out.bootGroupChunks = out.bootJsCss.filter(isGroup);
  out.bootProbe = await page.evaluate(() => window.__vs.probe("itembank"));
  out.ready = await page.evaluate(() => window.__vs.ready);
  out.fatal = await page.evaluate(() => window.__vs.fatal);

  /* ---------------------------------------------------------------- 3: play, then look again */
  out.play = await page.evaluate(() => {
    const learning = window.__vs.kernel?.get?.("learning");
    if (!learning) return { error: "no learning system mounted" };
    let served = 0;
    let nulls = 0;
    for (let i = 0; i < 120; i += 1) {
      const req = learning.next();
      if (!req) {
        nulls += 1;
        learning.beginSession();
        continue;
      }
      learning.submit(req, { correct: i % 3 !== 0, latencyMs: 9000, itemId: `${req.kpId}#${i}` });
      served += 1;
    }
    return { served, nulls };
  });
  await d.play(30);
  await page.waitForTimeout(400);
  out.afterPlayProbe = await page.evaluate(() => window.__vs.probe("itembank"));
  const after = await page.evaluate(() => performance.getEntriesByType("resource").map((r) => r.name));
  out.groupChunksAfterPlay = after.map(nameOf).filter(isGroup);

  /* -------------------------------------------- 4: per-lesson loading over the wire, and broken */
  const itemBankUrl = boot.map((r) => r.url).find((u) => /\/ItemBank-/.test(u));
  out.itemBankChunk = itemBankUrl ? nameOf(itemBankUrl) : null;

  const goodLesson = LESSONS[0];
  const handle = await page.evaluate(async (url) => {
    const m = await import(url);
    const bank = Object.values(m).find((v) => v && typeof v.ensureLesson === "function");
    window.__critic = { bank };
    return { found: !!bank, keys: Object.keys(m) };
  }, itemBankUrl);
  out.moduleHandle = handle;

  if (handle.found) {
    out.goodLesson = await page.evaluate(async (id) => {
      const t = performance.now();
      const r = await window.__critic.bank.ensureLesson(id);
      return { ...r, ms: Math.round(performance.now() - t), residency: window.__critic.bank.residency() };
    }, goodLesson.id);
    const fetched = await page.evaluate(() => performance.getEntriesByType("resource").map((r) => r.name));
    out.groupChunksAfterEnsure = fetched.map(nameOf).filter(isGroup).sort();

    // Break the wire for the NEXT lesson's chunks and open it.
    const broken = LESSONS.find((l) => l.kpIds.every((k) => !goodLesson.kpIds.includes(k)));
    out.brokenLesson = broken.id;
    out.brokenKps = broken.kpIds;
    await page.route("**/assets/*.js", (route) => {
      const n = route.request().url().split("/").pop();
      if (broken.kpIds.some((id) => n === `${id}.js` || n.startsWith(`${id}-`))) return route.fulfill({ status: 404, body: "" });
      return route.continue();
    });
    out.brokenResult = await page.evaluate(async (id) => {
      const t = performance.now();
      const r = await window.__critic.bank.ensureLesson(id);
      const ms = Math.round(performance.now() - t);
      return { ...r, ms };
    }, broken.id);
    out.brokenSelect = await page.evaluate((kpId) => {
      const b = window.__critic.bank;
      const rows = [];
      for (let i = 0; i < 12; i += 1) {
        const sel = b.select({ kpId, form: "construct", difficulty: 3, seed: i });
        if (!sel) {
          rows.push(null);
          continue;
        }
        const mark = b.check(sel.item, b.accepts(sel.item)[0]);
        rows.push({ src: sel.source, rel: sel.relaxation, ok: mark.correct, kp: sel.item.kpId, std: (sel.item.standards || []).length });
      }
      return { rows, blanks: rows.filter((r) => !r).length, probe: b.probe() };
    }, broken.kpIds[0]);
  }

  out.consoleErrors = d.consoleErrors.slice(0, 10);
  out.failedRequests = d.failedRequests.slice(0, 10);
  out.finalReadyStats = await page.evaluate(() => window.__vs.stats());
});

console.log(JSON.stringify(out, null, 1));
