#!/usr/bin/env node
/**
 * Critic round 4 for P31. Two page loads against ONE `vite preview` of the CURRENT dist:
 *
 *   CLEAN  — regenerate the live evidence P31.mjs reads from a cached file, and assert the
 *            chunk names observed actually exist in dist/ (the cached file's did not).
 *   BROKEN — abort one frontier-lesson group chunk at the network layer (a real transport
 *            failure, not the FAULT test hook) and see whether the shipped game degrades
 *            honestly: reaches ready, names the failure in warnings and probe, no hang.
 *
 * No pixels are captured. A human is playtesting.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"), "../..");
const DIST = new Set(fs.readdirSync(path.join(ROOT, "dist/assets")));
const KP_IDS = JSON.parse(fs.readFileSync(path.join(ROOT, "content/knowledge-graph.json"), "utf8")).nodes.map((n) => n.id);
const base = (u) => String(u).split("/").pop().split("?")[0];
const isGroup = (n) => KP_IDS.some((id) => n === `${id}.js` || n.startsWith(`${id}-`));
const isSpine = (n) => n === "spine.js" || n.startsWith("spine-");
const isItemLocale = (n) => /^items-(en|es|pl)[-.]/.test(n);

const freePort = () =>
  new Promise((res) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
  });

const snapshot = () =>
  performance.getEntriesByType("resource").map((e) => ({ name: e.name, t: Math.round(e.startTime), enc: e.encodedBodySize }));

const idleTurns = () =>
  new Promise((resolve) => {
    const turn = (fn) => (typeof requestIdleCallback === "function" ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 30));
    turn(() => turn(() => setTimeout(resolve, 200)));
  });

const port = await freePort();
const server = spawn("npx", ["vite", "preview", "--port", String(port), "--strictPort"], { cwd: ROOT, stdio: "pipe", shell: true });
let log = "";
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));
const deadline = Date.now() + 60000;
for (;;) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/`);
    if (r.ok) break;
  } catch {}
  if (Date.now() > deadline) throw new Error(`preview did not start: ${log}`);
  await new Promise((r) => setTimeout(r, 200));
}

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--hide-scrollbars"],
});

async function run({ abortPattern = null } = {}) {
  const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
  const consoleErrors = [];
  const aborted = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  page.on("pageerror", (e) => consoleErrors.push(String(e.stack || e)));
  if (abortPattern) {
    await page.route(abortPattern, (route) => {
      aborted.push(base(route.request().url()));
      route.abort("failed");
    });
  }
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load", timeout: 90000 });
  await page.waitForFunction(() => window.__vs && (window.__vs.ready || window.__vs.fatal), { timeout: 90000 }).catch(() => {});
  const readyMs = Date.now() - t0;
  const atReady = await page.evaluate(snapshot);
  const report0 = await page.evaluate(() => window.__vs.report());

  // Await the boot module's own warm promise — the shipped caller, not one this script invented.
  const warmT0 = Date.now();
  const warm = await page.evaluate(async () => {
    const sys = window.__vs?.kernel?.get?.("itembank");
    if (!sys?.warmed) return { error: "no warmed()" };
    return await sys.warmed();
  });
  const warmWaitMs = Date.now() - warmT0;
  const afterWarm = await page.evaluate(snapshot);
  await page.evaluate(idleTurns);
  const afterIdle = await page.evaluate(snapshot);
  const report = await page.evaluate(() => window.__vs.report());
  const probe = await page.evaluate(() => window.__vs.report().probes?.itembank ?? null);
  const mastery = await page.evaluate(() => window.__vs.report().probes?.mastery ?? null);
  const frontier = await page.evaluate(() => window.__vs?.kernel?.get?.("learning")?.frontier?.().slice(0, 4) ?? null);
  await page.close();

  const names = (l) => l.map((r) => base(r.name));
  const at = names(atReady);
  const seenA = new Set(at);
  const warmNew = [...new Set(names(afterWarm).filter((n) => !seenA.has(n)))];
  const seenB = new Set(names(afterWarm));
  const idleNew = [...new Set(names(afterIdle).filter((n) => !seenB.has(n)))];
  const encOf = new Map(afterIdle.map((r) => [base(r.name), r.enc]));
  const cls = (l) => ({
    requests: l.length,
    groupChunks: l.filter(isGroup),
    spineChunks: l.filter(isSpine),
    itemLocaleChunks: l.filter(isItemLocale),
    enc: l.reduce((a, n) => a + (encOf.get(n) ?? 0), 0),
  });
  return {
    readyMs,
    warmWaitMs,
    ready: report.ready === true,
    fatal: report.fatal ?? null,
    consoleErrors,
    aborted,
    warnings: report.warnings ?? [],
    warningsAtReady: report0.warnings ?? [],
    warm,
    frontier,
    probe,
    bankAudit: mastery?.bankAudit ?? null,
    criticalPath: cls(at),
    warmPulled: cls(warmNew),
    idlePrefetched: cls(idleNew),
    encodedAtReady: {
      js: atReady.filter((r) => /\.js$/.test(base(r.name))).reduce((a, r) => a + r.enc, 0),
      css: atReady.filter((r) => /\.css$/.test(base(r.name))).reduce((a, r) => a + r.enc, 0),
      font: atReady.filter((r) => /\.(woff2?|ttf)$/.test(base(r.name))).reduce((a, r) => a + r.enc, 0),
    },
    /** THE CHECK THE BUILDER'S HARNESS LACKS: do the observed chunks exist in the dist on disk? */
    chunkIdentity: {
      jsAtReady: at.filter((n) => /\.js$/.test(n)),
      notInDist: at.filter((n) => /\.(js|css)$/.test(n) && !DIST.has(n)),
    },
  };
}

const clean = await run();
// Break a chunk the SHIPPED warm actually pulls, chosen from what the clean run observed.
const victim = clean.warmPulled.groupChunks[1] ?? clean.warmPulled.groupChunks[0];
const broken = victim ? await run({ abortPattern: `**/assets/${victim}` }) : null;

await browser.close();
server.kill();

const out = { generated: new Date().toISOString(), distAssets: DIST.size, clean, victim, broken };
fs.writeFileSync(path.join(ROOT, "review/measure/_critic-P31-r4.json"), JSON.stringify(out, null, 1) + "\n");

const say = console.log;
say("");
say("=== CLEAN RUN, current dist ===");
say(`ready ${clean.ready} in ${clean.readyMs} ms; console errors ${clean.consoleErrors.length}; fatal ${clean.fatal}`);
say(`critical path: ${clean.criticalPath.requests} requests, groups ${clean.criticalPath.groupChunks.length}, spine ${clean.criticalPath.spineChunks.length}, itemLocale ${JSON.stringify(clean.criticalPath.itemLocaleChunks)}`);
say(`encoded at ready: js ${clean.encodedAtReady.js} + css ${clean.encodedAtReady.css} + fonts ${clean.encodedAtReady.font}`);
say(`CHUNK IDENTITY — js at ready not present in dist/assets: ${JSON.stringify(clean.chunkIdentity.notInDist)}`);
say(`warm: ${JSON.stringify(clean.warm)} (waited ${clean.warmWaitMs} ms)`);
say(`warm pulled: ${JSON.stringify(clean.warmPulled.groupChunks)} ${clean.warmPulled.enc} B`);
say(`idle prefetched: ${JSON.stringify(clean.idlePrefetched.groupChunks)} ${clean.idlePrefetched.enc} B`);
say(`frontier ${JSON.stringify(clean.frontier)}; probe.degraded ${JSON.stringify(clean.probe?.degraded)}`);
say(`bankAudit ${JSON.stringify(clean.bankAudit)}`);
say("");
say(`=== BROKEN RUN — network abort on ${victim} ===`);
if (!broken) say("no victim chunk; warm pulled nothing");
else {
  say(`ready ${broken.ready} in ${broken.readyMs} ms; warm wait ${broken.warmWaitMs} ms; fatal ${broken.fatal}`);
  say(`requests aborted: ${JSON.stringify(broken.aborted)}`);
  say(`console errors (${broken.consoleErrors.length}): ${broken.consoleErrors.slice(0, 3).join(" | ")}`);
  say(`warm: ${JSON.stringify(broken.warm)}`);
  say(`probe.degraded: ${JSON.stringify(broken.probe?.degraded)}`);
  say(`probe.residency/failed: ${JSON.stringify(broken.probe?.failed ?? broken.probe?.residency ?? null)}`);
  say(`warnings mentioning itembank: ${JSON.stringify((broken.warnings || []).filter((w) => /itembank/i.test(w)))}`);
  say(`warm pulled groups: ${JSON.stringify(broken.warmPulled.groupChunks)}`);
}
say("");
say(`wrote review/measure/_critic-P31-r4.json`);
