/**
 * CRITIC: split-half validation, so "best fixed string" cannot be a winner's curse.
 *
 * The string is CHOSEN on the odd-indexed half of the served multiset and SCORED on the
 * even-indexed half. A rate that survives that is an honest out-of-sample blind rate.
 * Population = every item the real Scheduler + real ItemBank served to median learners.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const { Graph } = await import(`file://${ROOT}/app/src/learn/Graph.js`);
const { Mastery, auditBlindGuessing, collectBankSample, wilsonUpper } = await import(`file://${ROOT}/app/src/learn/Mastery.js`);
const { Scheduler, virtualClock, mulberry32 } = await import(`file://${ROOT}/app/src/learn/Scheduler.js`);
const { ItemBank } = await import(`file://${ROOT}/app/src/learn/ItemBank.js`);
const { BANK } = await import(`file://${ROOT}/content/items/index.mjs`);
const { generateOne, TIERS } = await import(`file://${ROOT}/content/items/generators.mjs`);

const SRC = JSON.parse(fs.readFileSync(path.join(ROOT, "content/knowledge-graph.json"), "utf8"));
const GRAPH = new Graph(SRC);
const CAPS = GRAPH.model.bkt.identifiabilityCaps;
const bank = new ItemBank();
const AUDIT = auditBlindGuessing(
  collectBankSample({ bankFiles: BANK, generateOne, tiers: TIERS, bandOf: (id) => GRAPH.difficulty(id) }),
  { mark: (i, r) => bank.check(i, r).correct === true, spell: (i) => bank.accepts(i)[0] }
);
const pricing = new Mastery(GRAPH, { bankAudit: AUDIT, storage: null, emit: () => {} });

const STAPLES = ["0", "1", "2", "3", "4", "5", "6", "-1", "-2", "10", "x", "always", "none"];

function bandTierFor(req) {
  const centre = GRAPH.centre(req.kpId);
  return Math.max(1, Math.min(5, GRAPH.difficulty(req.kpId) + Math.round((req.difficulty - centre) / 0.3)));
}

function servedLog(seed, sessions = 20) {
  const rng = mulberry32(seed);
  const clock = virtualClock(0);
  const mastery = new Mastery(GRAPH, { bankAudit: AUDIT, now: () => clock.minutes(), emit: () => {}, storage: null });
  const sched = new Scheduler(mastery, { clock, rng: mulberry32(seed ^ 0x9e3779b9), sessionMinutes: 25 });
  const known = new Map();
  for (const id of GRAPH.ids) known.set(id, rng() < GRAPH.band(id).prior);
  const log = [];
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
      for (let t = 0; t < 8; t += 1) {
        const sel = bank.select({
          kpId: req.kpId, form: req.form, difficulty: bandTierFor(req),
          misconception: t === 0 ? (req.targetMisconception ?? null) : null,
          seed: (seq * 2246822519 + 11 + t * 104729) >>> 0, exclude,
        });
        if (!sel) break;
        item = sel.item;
        if (!avoid.includes(sel.item.family)) { log.push({ kpId: req.kpId, form: req.form, item }); break; }
        exclude.add(sel.item.id);
      }
      seq += 1;
      if (!item) break;
      if (!known.get(req.kpId) && rng() < GRAPH.band(req.kpId).learn) known.set(req.kpId, true);
      sched.submit(req, { correct: known.get(req.kpId) && rng() > GRAPH.band(req.kpId).slip, latencyMs: 6000, itemId: item.id, family: item.family, response: "-" });
    }
    sched.endSession();
  }
  return log;
}

const log = [];
for (let i = 0; i < 24; i += 1) log.push(...servedLog(777000 + i * 7919));
const byCell = new Map();
for (const r of log) {
  const k = `${r.kpId}|${r.form}`;
  if (!byCell.has(k)) byCell.set(k, []);
  byCell.get(k).push(r.item);
}
console.log(`served log: ${log.length} items over 24 median-learner runs; ${byCell.size} cells\n`);
console.log(`${"cell".padEnd(32)} ${"nFit".padEnd(6)} ${"nTest".padEnd(6)} ${"HOLDOUT".padEnd(9)} ${"w95lo".padEnd(7)} ${"engine".padEnd(8)} ${"modelled".padEnd(9)} string`);

const over = [];
for (const [k, items] of [...byCell].sort((a, b) => b[1].length - a[1].length)) {
  if (items.length < 120) continue;
  const [kpId, form] = k.split("|");
  const p = pricing.price(kpId, form, "solo");
  if (!p.scorable) continue;
  const fit = items.filter((_, i) => i % 2 === 1);
  const test = items.filter((_, i) => i % 2 === 0);
  const cands = new Set(STAPLES);
  for (const it of fit) for (const s of bank.accepts(it).slice(0, 2)) if (s != null) cands.add(String(s));
  let best = { a: null, h: 0 };
  for (const c of cands) {
    let h = 0;
    for (const it of fit) { try { if (bank.check(it, c).correct) h += 1; } catch { /**/ } }
    if (h > best.h) best = { a: c, h };
  }
  let th = 0;
  for (const it of test) { try { if (bank.check(it, best.a).correct) th += 1; } catch { /**/ } }
  const rate = th / test.length;
  // Wilson 95% LOWER bound: what the rate is at least, out of sample.
  const z = 1.959964, n = test.length, ph = rate;
  const d = 1 + (z * z) / n, c0 = ph + (z * z) / (2 * n);
  const sd = z * Math.sqrt((ph * (1 - ph)) / n + (z * z) / (4 * n * n));
  const lo = Math.max(0, (c0 - sd) / d);
  const flag = lo > CAPS.maxTrueGuess ? "  <-- LOWER BOUND ABOVE maxTrueGuess, STILL SCORED" : rate > p.modelledGuess ? "  <- above modelled guess" : "";
  console.log(
    `${k.padEnd(32)} ${String(fit.length).padEnd(6)} ${String(test.length).padEnd(6)} ${rate.toFixed(3).padEnd(9)} ${lo.toFixed(3).padEnd(7)} ${(p.bankBlindRate ?? 0).toFixed(3).padEnd(8)} ${p.modelledGuess.toFixed(3).padEnd(9)} ${JSON.stringify(best.a)}${flag}`
  );
  if (lo > CAPS.maxTrueGuess) over.push({ cell: k, holdout: rate, lower95: lo, engine: p.bankBlindRate, modelled: p.modelledGuess, string: best.a });
}
console.log(`\n${over.length} SCORED cells whose out-of-sample blind rate's 95% LOWER bound exceeds maxTrueGuess ${CAPS.maxTrueGuess}:`);
for (const o of over) console.log("  " + JSON.stringify(o));
