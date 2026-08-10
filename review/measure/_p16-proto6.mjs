/** Does a median learner still reach 80% of Level 1 under the re-priced bank? Live bank, no rate parameter. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const { Graph } = await import(`file://${ROOT}/app/src/learn/Graph.js`);
const { Mastery } = await import(`file://${ROOT}/app/src/learn/Mastery.js`);
const { Scheduler, virtualClock, mulberry32 } = await import(`file://${ROOT}/app/src/learn/Scheduler.js`);
const { ItemBank } = await import(`file://${ROOT}/app/src/learn/ItemBank.js`);
const GRAPH = new Graph(JSON.parse(fs.readFileSync(path.join(ROOT, "content/knowledge-graph.json"), "utf8")));
const AUDIT = JSON.parse(fs.readFileSync(path.join(ROOT, "app/src/learn/bank-audit.json"), "utf8"));
const bank = new ItemBank();
const M = GRAPH.model;
const scoredCells = [];
{
  const m = new Mastery(GRAPH, { bankAudit: AUDIT, storage: null, emit: () => {} });
  for (const kp of GRAPH.ids) for (const f of ["construct", "repair", "generate"]) if (m.isScorable(kp, f, "solo")) scoredCells.push(`${kp}|${f}`);
  console.log(`scored cells: ${scoredCells.length} of 96`);
}
const bandTierFor = (req) => Math.max(1, Math.min(5, GRAPH.difficulty(req.kpId) + Math.round((req.difficulty - GRAPH.centre(req.kpId)) / 0.3)));

function run({ seed, kind, sessions = 22 }) {
  const rng = mulberry32(seed);
  const clock = virtualClock(0);
  const mastery = new Mastery(GRAPH, { bankAudit: AUDIT, now: () => clock.minutes(), emit: () => {}, storage: null });
  const sched = new Scheduler(mastery, { clock, rng: mulberry32(seed ^ 0x9e3779b9), sessionMinutes: 25 });
  const bot = kind !== "median";
  const known = new Map();
  for (const id of GRAPH.ids) known.set(id, !bot && rng() < GRAPH.band(id).prior);
  const served = [];
  let seq = 0;
  for (let s = 0; s < sessions; s += 1) {
    clock.set(s * 1440);
    sched.beginSession();
    for (;;) {
      const req = sched.next();
      if (!req) break;
      const exclude = new Set(req.avoidItemIds ?? []);
      const avoid = req.avoidFamilies ?? [];
      let item = null;
      for (let t = 0; t < 10; t += 1) {
        const sel = bank.select({
          kpId: req.kpId, form: req.form, difficulty: bandTierFor(req),
          misconception: t === 0 ? (req.targetMisconception ?? null) : null,
          seed: (seq * 2246822519 + 11 + t * 104729) >>> 0, exclude,
        });
        if (!sel) break;
        item = sel.item;
        if (!avoid.includes(sel.item.family)) break;
        exclude.add(sel.item.id);
      }
      seq += 1;
      if (!item) break;
      served.push({ kpId: req.kpId, form: req.form, item, source: item.id.includes("/") && !item.id.includes("#") ? "?" : "?" });
      if (!bot && !known.get(req.kpId) && rng() < GRAPH.band(req.kpId).learn) known.set(req.kpId, true);
      let correct;
      let hinted = req.hinted;
      let latency = 5000 + Math.floor(rng() * 6000);
      if (bot) {
        correct = rng() < 0.25; // generous stand-in; the real live bots live in P16.mjs
        if (kind === "hintAbuser") { correct = true; hinted = true; latency = M.antiGuessing.hintSurfaceMs + 2000; }
      } else {
        correct = known.get(req.kpId) ? rng() > GRAPH.band(req.kpId).slip : rng() < 0.12;
      }
      sched.submit(req, { correct, latencyMs: latency, hinted, itemId: item.id, family: item.family, response: "-" });
    }
    sched.endSession();
  }
  const mastered = GRAPH.ids.filter((id) => mastery.status(id) === "mastered").length;
  return { mastered, total: GRAPH.ids.length, items: served.length, served };
}

const N = Number(process.argv[2] ?? 60);
const res = [];
for (let i = 0; i < N; i += 1) res.push(run({ seed: 5150 + i * 7919, kind: "median" }));
const shares = res.map((r) => r.mastered / r.total).sort((a, b) => a - b);
const med = shares[Math.floor(shares.length / 2)];
console.log(`median learner: median mastery ${(100 * med).toFixed(1)}% of ${res[0].total}; items/run median ${res.map((r) => r.items).sort((a, b) => a - b)[Math.floor(N / 2)]}`);
console.log(`  share of runs at >=80%: ${(100 * shares.filter((s) => s >= 0.8).length / N).toFixed(0)}%`);
const bots = [];
for (let i = 0; i < 20; i += 1) bots.push(run({ seed: 99991 + i * 7919, kind: "guesser" }));
console.log(`guesser: mean certified ${(bots.reduce((a, b) => a + b.mastered, 0) / bots.length).toFixed(3)}`);
const ha = [];
for (let i = 0; i < 20; i += 1) ha.push(run({ seed: 515151 + i * 7919, kind: "hintAbuser" }));
console.log(`hint-abuser (always correct, always hinted): mean certified ${(ha.reduce((a, b) => a + b.mastered, 0) / ha.length).toFixed(3)}`);
