/**
 * CRITIC: the strongest bot I can build that still knows no algebra — and it has NO success-rate
 * parameter. It maintains a tally of which of its stock strings has won on each (kp x form) so
 * far and plays the current leader. Its success is entirely an OUTPUT of the items the shipped
 * Scheduler + shipped ItemBank actually served it and of ItemBank.check()'s verdicts.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const { Graph } = await import(`file://${ROOT}/app/src/learn/Graph.js`);
const { Mastery, auditBlindGuessing, collectBankSample } = await import(`file://${ROOT}/app/src/learn/Mastery.js`);
const { Scheduler, virtualClock, mulberry32 } = await import(`file://${ROOT}/app/src/learn/Scheduler.js`);
const { ItemBank } = await import(`file://${ROOT}/app/src/learn/ItemBank.js`);
const { BANK } = await import(`file://${ROOT}/content/items/index.mjs`);
const { generateOne, TIERS } = await import(`file://${ROOT}/content/items/generators.mjs`);

const SRC = JSON.parse(fs.readFileSync(path.join(ROOT, "content/knowledge-graph.json"), "utf8"));
const GRAPH = new Graph(SRC);
const bank = new ItemBank();
const AUDIT = auditBlindGuessing(
  collectBankSample({ bankFiles: BANK, generateOne, tiers: TIERS, bandOf: (id) => GRAPH.difficulty(id) }),
  { mark: (i, r) => bank.check(i, r).correct === true, spell: (i) => bank.accepts(i)[0] }
);

const STOCK = ["0", "1", "2", "3", "4", "5", "6", "8", "-1", "-2", "10", "x", "x = 3", "always", "none",
  "-8x", "2: -9x", "9 - x", "x - 2 = 10", "4 + 3 \\cdot 2", "2: 14 - 14", "2: x = 16", "\\frac{48}{n}", "5n + 5"];

function bandTierFor(req) {
  const centre = GRAPH.centre(req.kpId);
  return Math.max(1, Math.min(5, GRAPH.difficulty(req.kpId) + Math.round((req.difficulty - centre) / 0.3)));
}

function run(seed, sessions = 24) {
  const rng = mulberry32(seed);
  const clock = virtualClock(0);
  const mastery = new Mastery(GRAPH, { bankAudit: AUDIT, now: () => clock.minutes(), emit: () => {}, storage: null });
  const sched = new Scheduler(mastery, { clock, rng: mulberry32(seed ^ 0x9e3779b9), sessionMinutes: 25 });
  /** what has worked so far, per (kp|form). Learned from verdicts alone. */
  const tally = new Map();
  let served = 0;
  let right = 0;
  let seq = 0;
  let peak = 0;
  for (let s = 0; s < sessions; s += 1) {
    clock.set(s * 1440);
    sched.beginSession();
    for (;;) {
      const req = sched.next();
      if (!req) break;
      const exclude = new Set(req.avoidItemIds ?? []);
      const avoid = req.avoidFamilies ?? [];
      let item = null;
      for (let t = 0; t < 8; t += 1) {
        const sel = bank.select({ kpId: req.kpId, form: req.form, difficulty: bandTierFor(req), seed: (seq * 2246822519 + 11 + t * 104729) >>> 0, exclude });
        if (!sel) break;
        item = sel.item;
        if (!avoid.includes(sel.item.family)) break;
        exclude.add(sel.item.id);
      }
      seq += 1;
      if (!item) break;

      const key = `${req.kpId}|${req.form}`;
      let rec = tally.get(key);
      if (!rec) tally.set(key, (rec = { wins: new Map(), tried: 0 }));
      // Exploit the current leader most of the time; otherwise explore a stock string, and always
      // remember the item's own answer shape it has seen work before.
      let response;
      const leader = [...rec.wins.entries()].sort((a, b) => b[1] - a[1])[0];
      if (leader && rng() < 0.8) response = leader[0];
      else response = STOCK[Math.floor(rng() * STOCK.length) % STOCK.length];

      let correct = false;
      try { correct = bank.check(item, response).correct === true; } catch { correct = false; }
      if (correct) rec.wins.set(response, (rec.wins.get(response) ?? 0) + 1);
      served += 1;
      if (correct) right += 1;
      sched.submit(req, { correct, latencyMs: 6000 + Math.floor(rng() * 4000), hinted: req.hinted, itemId: item.id, family: item.family, response });
      peak = Math.max(peak, mastery.summary().mastered);
    }
    sched.endSession();
  }
  const sum = mastery.summary();
  return { mastered: sum.mastered, peak, unlocked: sum.unlocked, gateOpens: mastery.stats.gateOpens, served, right, rate: right / served,
    maxM2: Math.max(...GRAPH.ids.map((id) => mastery.stateOf(id).scored)), maxP: Math.max(...GRAPH.ids.map((id) => mastery.stateOf(id).p)) };
}

const N = Number(process.env.N ?? 24);
const rows = [];
for (let i = 0; i < N; i += 1) rows.push(run((5150 + i * 7919) >>> 0));
const mean = (f) => rows.reduce((a, r) => a + f(r), 0) / rows.length;
console.log(`ADAPTIVE BLIND BOT — no rate parameter, ${N} runs x 24 sessions on the shipped Scheduler + ItemBank`);
console.log(`  raw item accuracy (an OUTPUT of ItemBank.check): ${(100 * mean((r) => r.rate)).toFixed(1)}%  on ${mean((r) => r.served).toFixed(0)} items/run`);
console.log(`  certified: mean ${mean((r) => r.mastered).toFixed(3)}/32, max ${Math.max(...rows.map((r) => r.mastered))}, peak ever ${Math.max(...rows.map((r) => r.peak))}`);
console.log(`  gate opens: mean ${mean((r) => r.gateOpens).toFixed(2)}   nodes unlocked mean ${mean((r) => r.unlocked).toFixed(2)}`);
console.log(`  highest M2 counter reached ${Math.max(...rows.map((r) => r.maxM2))} (needs 6)   highest posterior ${Math.max(...rows.map((r) => r.maxP)).toFixed(4)} (needs 0.95)`);
