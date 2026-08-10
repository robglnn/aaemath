#!/usr/bin/env node
/**
 * critic-P31-r3.mjs — round-3 hostile review of per-lesson item loading.
 *
 * ONE browser session against the production build. Four questions:
 *   1. What does the page actually fetch before ready? (resource timings, not a disk heuristic)
 *   2. Does a REAL session — driven through Scheduler.serve(), the sanctioned picker, not through
 *      a bespoke bank.select() loop — pull only the groups it needs, and how many items does it
 *      serve from the DEGRADED generator path while it waits for chunks over real HTTP?
 *   3. When a group chunk 404s on the wire, does it degrade honestly or hang/blank?
 *   4. Does the boot warm actually land, and is the warning channel audible?
 */
import fs from "node:fs";
import path from "node:path";
import { openGame, ROOT } from "../../tools/lib/session.mjs";

const KP_IDS = JSON.parse(fs.readFileSync(path.join(ROOT, "content/knowledge-graph.json"), "utf8")).nodes.map((n) => n.id);
const LESSONS = JSON.parse(fs.readFileSync(path.join(ROOT, "content/items/manifest.json"), "utf8")).lessons;

const out = {};
const nameOf = (u) => u.split("/").pop().split("?")[0];
const isGroup = (n) => KP_IDS.some((id) => n === `${id}.js` || n.startsWith(`${id}-`));

await openGame({ built: true, width: 480, height: 270 }, async (d) => {
  const { page } = d;

  const snap = async (label) => {
    const rows = await page.evaluate(() =>
      performance.getEntriesByType("resource").map((r) => ({ n: r.name, e: r.encodedBodySize, dc: r.decodedBodySize, t: r.responseEnd }))
    );
    const js = rows.filter((r) => /\.(js|css)$/.test(nameOf(r.n)));
    return {
      label,
      requests: rows.length,
      encoded: rows.reduce((a, r) => a + r.e, 0),
      decoded: rows.reduce((a, r) => a + r.dc, 0),
      jsCssEncoded: js.reduce((a, r) => a + r.e, 0),
      names: js.map((r) => nameOf(r.n)).sort(),
      groups: js.map((r) => nameOf(r.n)).filter(isGroup).sort(),
      spine: js.map((r) => nameOf(r.n)).filter((n) => /^spine-/.test(n)),
      itemLocales: js.map((r) => nameOf(r.n)).filter((n) => /^items-/.test(n)),
      uiLocales: js.map((r) => nameOf(r.n)).filter((n) => /^(en|es|pl)-/.test(n)),
    };
  };

  out.ready = await page.evaluate(() => window.__vs.ready);
  out.fatal = await page.evaluate(() => window.__vs.fatal);
  out.atReady = await snap("at-ready");

  // Wait for the boot module's own warm promise, then two idle turns for the prefetch.
  out.warmResult = await page.evaluate(async () => {
    const ib = window.__vs.kernel?.get?.("itembank");
    if (!ib) return { error: "no itembank mounted" };
    const w = await (ib.warmed?.() ?? null);
    await new Promise((r) => requestIdleCallback(() => r(), { timeout: 2500 }));
    await new Promise((r) => requestIdleCallback(() => r(), { timeout: 2500 }));
    return w ?? null;
  });
  out.afterWarm = await snap("after-warm");
  out.probeAfterWarm = await page.evaluate(() => window.__vs.probe("itembank"));

  /* ---------------------------------------------------------------- 2: a real session */
  /**
   * The SHIPPED objects: the mounted learning system's own Scheduler, and the ItemBank singleton
   * reached through the very chunk URL the page loaded (ESM caches by URL, so this is the same
   * module instance the game holds — not a second copy).
   */
  const itemBankUrl = out.atReady.names.find((n) => /^ItemBank-/.test(n));
  out.itemBankChunk = itemBankUrl;

  const drive = async (label, items) =>
    page.evaluate(
      async ({ url, items }) => {
        const m = await import(new URL(`./assets/${url}`, location.href).href);
        const bank = Object.values(m).find((v) => v && typeof v.ensureLesson === "function" && typeof v.select === "function");
        const learning = window.__vs.kernel.get("learning");
        if (!bank || !learning) return { error: "missing bank or learning" };
        const sched = learning.scheduler;
        const rows = [];
        let nulls = 0;
        let noReq = 0;
        for (let i = 0; i < items; i += 1) {
          const req = sched.next();
          if (!req) {
            noReq += 1;
            learning.beginSession();
            continue;
          }
          // THE SANCTIONED PICKER, per Scheduler.js:664 — the path the shipped presenter must use.
          const sel = sched.serve(req, bank);
          if (!sel) {
            nulls += 1;
            sched.submit(req, { correct: false, latencyMs: 20000, itemId: `blank#${i}` });
            continue;
          }
          const mark = bank.check(sel.item, bank.accepts(sel.item)[0]);
          rows.push({
            kp: req.kpId,
            src: sel.source,
            rel: sel.relaxation,
            ok: mark.correct,
            id: sel.item.id,
          });
          sched.submit(req, {
            correct: i % 4 !== 0,
            latencyMs: 20000,
            itemId: sel.item.id,
            family: sel.family,
          });
          // Real reading time between items: let any in-flight chunk actually land over HTTP.
          await new Promise((r) => setTimeout(r, 12));
        }
        return {
          rows,
          nulls,
          noReq,
          kps: [...new Set(rows.map((r) => r.kp))],
          fromCatalogue: rows.filter((r) => r.src === "catalogue").length,
          generated: rows.filter((r) => r.src === "generated").length,
          degradedAbsent: rows.filter((r) => String(r.rel).startsWith("generated-group-")).length,
          uncheckable: rows.filter((r) => r.ok !== true).length,
          residency: bank.residency(),
          probe: bank.probe(),
        };
      },
      { url: itemBankUrl, items }
    );

  out.session = await drive("warm-session", 60);
  out.afterSession = await snap("after-session");

  /* ---------------------------------------------------------------- 3: break it on the wire */
  const resident = out.session.residency?.resident ?? [];
  // Break a group the session is ALREADY using, plus every not-yet-loaded group, so the next
  // knowledge point the scheduler reaches cannot arrive.
  const blocked = KP_IDS.filter((id) => !resident.includes(id));
  out.blocked = blocked;
  await page.route("**/assets/*.js", (route) => {
    const n = nameOf(route.request().url());
    if (blocked.some((id) => n === `${id}.js` || n.startsWith(`${id}-`))) return route.fulfill({ status: 404, body: "" });
    return route.continue();
  });

  // Force the scheduler onto a blocked knowledge point by asking the bank directly through the
  // sanctioned picker with a synthetic request, AND by opening a lesson made entirely of blocked
  // knowledge points.
  const brokenLesson = LESSONS.find((l) => l.kpIds.every((k) => blocked.includes(k)));
  out.brokenLesson = brokenLesson?.id ?? null;
  out.brokenEnsure = await page.evaluate(
    async ({ url, lessonId }) => {
      const m = await import(new URL(`./assets/${url}`, location.href).href);
      const bank = Object.values(m).find((v) => v && typeof v.ensureLesson === "function");
      const t = performance.now();
      const r = await bank.ensureLesson(lessonId);
      return { ...r, ms: Math.round(performance.now() - t) };
    },
    { url: itemBankUrl, lessonId: brokenLesson.id }
  );

  out.brokenSelect = await page.evaluate(
    async ({ url, kpId }) => {
      const m = await import(new URL(`./assets/${url}`, location.href).href);
      const bank = Object.values(m).find((v) => v && typeof v.ensureLesson === "function");
      const learning = window.__vs.kernel.get("learning");
      const rows = [];
      for (let i = 0; i < 16; i += 1) {
        const req = {
          kpId,
          form: "construct",
          difficulty: 3,
          seq: 1000 + i,
          avoidFamilies: learning.mastery.refusedFamilies(kpId, "construct"),
          avoidItemIds: [],
        };
        const sel = learning.scheduler.serve(req, bank);
        if (!sel) {
          rows.push(null);
          continue;
        }
        const mark = bank.check(sel.item, bank.accepts(sel.item)[0]);
        rows.push({ src: sel.source, rel: sel.relaxation, ok: mark.correct, kp: sel.item.kpId, std: (sel.item.standards || []).length, id: sel.item.id });
      }
      return { rows, blanks: rows.filter((r) => !r).length, probe: bank.probe() };
    },
    { url: itemBankUrl, kpId: brokenLesson.kpIds[0] }
  );

  out.warnings = await page.evaluate(() => window.__vs.report?.().warnings ?? null);
  out.consoleErrors = d.consoleErrors.slice(0, 12);
  out.failedRequests = d.failedRequests.slice(0, 12);
});

fs.writeFileSync(path.join(ROOT, "review/measure/out/critic-P31-r3.json"), JSON.stringify(out, null, 1));
const s = out.session ?? {};
console.log(JSON.stringify(
  {
    ready: out.ready,
    fatal: out.fatal,
    atReady: { requests: out.atReady.requests, encoded: out.atReady.encoded, decoded: out.atReady.decoded, groups: out.atReady.groups, spine: out.atReady.spine, itemLocales: out.atReady.itemLocales, uiLocales: out.atReady.uiLocales },
    warmResult: out.warmResult,
    afterWarmGroups: out.afterWarm.groups,
    session: { served: s.rows?.length, kps: s.kps, fromCatalogue: s.fromCatalogue, generated: s.generated, degradedAbsent: s.degradedAbsent, nulls: s.nulls, noReq: s.noReq, uncheckable: s.uncheckable, resident: s.residency?.resident },
    afterSessionGroups: out.afterSession.groups,
    blockedCount: out.blocked?.length,
    brokenLesson: out.brokenLesson,
    brokenEnsure: out.brokenEnsure,
    brokenSelect: { blanks: out.brokenSelect?.blanks, sample: out.brokenSelect?.rows?.slice(0, 4), degraded: out.brokenSelect?.probe?.degraded },
    warningsWithBank: (out.warnings ?? []).filter((w) => /itembank/i.test(String(w))).slice(0, 6),
    consoleErrors: out.consoleErrors,
  },
  null,
  1
));
