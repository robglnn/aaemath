import fs from "node:fs"; import path from "node:path"; import { pathToFileURL } from "node:url";
const ROOT = process.cwd();
const L = (r) => JSON.parse(fs.readFileSync(path.join(ROOT, r), "utf8"));
const { Graph } = await import(pathToFileURL(path.join(ROOT, "app/src/learn/Graph.js")).href);
const { Mastery } = await import(pathToFileURL(path.join(ROOT, "app/src/learn/Mastery.js")).href);
const { Scheduler, virtualClock, mulberry32 } = await import(pathToFileURL(path.join(ROOT, "app/src/learn/Scheduler.js")).href);
const graph = new Graph(L("content/knowledge-graph.json"));
const bankAudit = L("app/src/learn/bank-audit.json");
const MAN = L("content/items/manifest.json");
const lessonOf = (kp) => MAN.lessons.find(l => l.kpIds.includes(kp))?.id ?? null;

function drive(items, seed) {
  const clock = virtualClock(0);
  const m = new Mastery(graph, { now: () => clock.minutes(), storage: null, bankAudit, emit: () => {} });
  const s = new Scheduler(m, { clock, rng: mulberry32(seed ^ 0x9e3779b9), sessionMinutes: 25 });
  const rng = mulberry32(seed);
  let served = 0;
  for (let session = 0; served < items && session < 400; session += 1) {
    clock.set(session * 1440); s.beginSession();
    for (;;) {
      if (served >= items) break;
      const req = s.next(); if (!req) break;
      const base = 1 / (1 + Math.exp(-(0.9 - req.difficulty)));
      const floor = m.trueGuess(req.kpId, req.form, req.phase);
      s.submit(req, { correct: rng() < base + (1 - base) * floor, latencyMs: 4000, itemId: `${req.kpId}#${req.seq}` });
      served += 1;
    }
    s.endSession();
  }
  return { items: served, sessions: m.session, frontier: m.frontier().slice(0,3) };
}
for (const n of [600, 1200, 2000, 3000, 4500]) {
  const r = drive(n, 7);
  console.log(n, "->", JSON.stringify(r.frontier), "lesson", lessonOf(r.frontier[0]), "sessions", r.sessions, "served", r.items);
}
