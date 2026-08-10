// Throwaway: how many DISTINCT groups does the shipped Scheduler's servability probing +
// serve() path touch, and how fast? Offline, no browser.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const ROOT = process.cwd();
const L = (r) => JSON.parse(fs.readFileSync(path.join(ROOT, r), "utf8"));
const IB = await import(pathToFileURL(path.join(ROOT, "app/src/learn/ItemBank.js")).href);
const { Graph } = await import(pathToFileURL(path.join(ROOT, "app/src/learn/Graph.js")).href);
const { Mastery } = await import(pathToFileURL(path.join(ROOT, "app/src/learn/Mastery.js")).href);
const { Scheduler, virtualClock, mulberry32 } = await import(pathToFileURL(path.join(ROOT, "app/src/learn/Scheduler.js")).href);
const graph = new Graph(L("content/knowledge-graph.json"));
const bankAudit = L("app/src/learn/bank-audit.json");

IB.__evictAllGroups();
const bank = new IB.ItemBank();
// count loadGroup calls by watching residency growth over time
const clock = virtualClock(0);
const mastery = new Mastery(graph, { now: () => clock.minutes(), storage: null, bankAudit, emit: () => {} });
const sched = new Scheduler(mastery, { clock, rng: mulberry32(31), sessionMinutes: 25 });
sched.attachBank(bank);
sched.beginSession();
const t0 = Date.now();
const marks = [];
let n = 0;
for (;;) {
  const req = sched.next();
  if (!req) break;
  n += 1;
  marks.push({ n, ms: Date.now() - t0, resident: bank.residency().resident.length });
  sched.submit(req, { correct: Math.random() < 0.8, latencyMs: 20000, itemId: req.itemId ?? `x#${n}` });
  await new Promise((r) => setTimeout(r, 0));
  if (n > 400) break;
}
console.log(JSON.stringify({
  items: n,
  elapsedMs: Date.now() - t0,
  residentAfter: bank.residency().resident.length,
  residentIds: bank.residency().resident,
  first10: marks.slice(0, 10),
  at: [marks[0], marks[4], marks[9], marks[24], marks[marks.length - 1]],
}, null, 1));
