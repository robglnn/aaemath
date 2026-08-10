#!/usr/bin/env node
/**
 * Does per-lesson loading follow the LEARNER, or only the page load?
 *
 * `boot/62-itembank.js` warms the frontier lesson once, inside setup(). The product goal is a
 * student who tests out of a lesson in ~2 minutes and moves to the next one. So: advance mastery
 * inside the real built game until the frontier leaves the warmed lesson, then ask the browser's
 * own resource timings whether the next lesson's chunks were ever requested.
 *
 * No pixels.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"), "../..");
const KP_IDS = JSON.parse(fs.readFileSync(path.join(ROOT, "content/knowledge-graph.json"), "utf8")).nodes.map((n) => n.id);
const MAN = JSON.parse(fs.readFileSync(path.join(ROOT, "content/items/manifest.json"), "utf8"));
const base = (u) => String(u).split("/").pop().split("?")[0];
const isGroup = (n) => KP_IDS.some((id) => n === `${id}.js` || n.startsWith(`${id}-`));
const lessonOf = (kp) => MAN.lessons.find((l) => l.kpIds.includes(kp))?.id ?? null;

const port = await new Promise((res) => {
  const s = net.createServer();
  s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); });
});
const server = spawn("npx", ["vite", "preview", "--port", String(port), "--strictPort"], { cwd: ROOT, stdio: "pipe", shell: true });
const dl = Date.now() + 60000;
for (;;) { try { if ((await fetch(`http://127.0.0.1:${port}/`)).ok) break; } catch {} if (Date.now() > dl) throw new Error("no preview"); await new Promise((r) => setTimeout(r, 200)); }

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load", timeout: 90000 });
await page.waitForFunction(() => window.__vs && (window.__vs.ready || window.__vs.fatal), { timeout: 90000 });
await page.evaluate(async () => { await window.__vs.kernel.get("itembank").warmed(); });
await page.evaluate(() => new Promise((r) => { const t = (f) => requestIdleCallback(f, { timeout: 1500 }); t(() => t(() => setTimeout(r, 200))); }));

const snap = () =>
  performance.getEntriesByType("resource").map((e) => String(e.name).split("/").pop().split("?")[0]);
const before = await page.evaluate(snap);
const frontier0 = await page.evaluate(() => window.__vs.kernel.get("learning").frontier().slice(0, 4));

// Drive the REAL engine forward: the shipped deterministic self-drive, 600 items.
const drove = await page.evaluate(() => window.__vs.kernel.get("learning").drive(600, 7));
await page.evaluate(() => new Promise((r) => { const t = (f) => requestIdleCallback(f, { timeout: 1500 }); t(() => t(() => setTimeout(r, 400))); }));
const frontier1 = await page.evaluate(() => window.__vs.kernel.get("learning").frontier().slice(0, 4));
const after = await page.evaluate(snap);
const probe = await page.evaluate(() => window.__vs.report().probes?.itembank ?? null);

const seen = new Set(before);
const newGroups = [...new Set(after.filter((n) => !seen.has(n) && isGroup(n)))];

await browser.close();
server.kill();

console.log(JSON.stringify({
  drove,
  frontierAtBoot: frontier0,
  lessonAtBoot: lessonOf(frontier0[0]),
  frontierAfterDrive: frontier1,
  lessonAfterDrive: lessonOf(frontier1[0]),
  groupChunksBefore: before.filter(isGroup),
  groupChunksPulledAfterFrontierMoved: newGroups,
  probeWarm: probe?.warm ?? null,
  residentGroups: probe?.residentGroups ?? null,
}, null, 1));
