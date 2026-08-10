/**
 * CRITIC: what population is the player ACTUALLY served, and what does one fixed string get on it?
 *
 * The exclusion set is the game's own rule — `req.avoidItemIds`, which the Scheduler fills from
 * `recentItemIds` capped at `antiGuessing.noRepeatWithinItems` (40) — not an ever-growing set.
 * Items come from `ItemBank.select()`, which answers from the committed catalogue first.
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

console.log("catalogue size per (kp x form), committed items only:");
for (const f of BANK.slice(0, 8)) {
  const c = (form) => f.items.filter((i) => i.form === form).length;
  console.log(`  ${f.kpId.padEnd(22)} construct ${String(c("construct")).padStart(3)}  repair ${String(c("repair")).padStart(3)}  generate ${String(c("generate")).padStart(3)}`);
}

// The engine's audit sample composition, for comparison.
const sample = collectBankSample({ bankFiles: BANK, generateOne, tiers: TIERS, bandOf: (id) => GRAPH.difficulty(id) });
const cat = sample.filter((r) => r.source === "catalogue").length;
console.log(`\nengine audit sample: ${cat} catalogue + ${sample.length - cat} generated  ->  catalogue is ${(100 * cat / sample.length).toFixed(1)}% of what the PRICE is measured on`);

// ---------------------------------------------------------------- what a real run serves
const STAPLES = ["0", "1", "2", "3", "4", "5", "6", "-1", "-2", "10", "1/2", "x", "x = 3", "always", "none", "-8x", "2: -9x"];

function bandTierFor(req) {
  const centre = GRAPH.centre(req.kpId);
  return Math.max(1, Math.min(5, GRAPH.difficulty(req.kpId) + Math.round((req.difficulty - centre) / 0.3)));
}

/** Drive the real Scheduler with a median learner and record every item actually served. */
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
      // EXACTLY the game's rule: exclude only the ids in req.avoidItemIds (last 40 served).
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
        if (!avoid.includes(sel.item.family)) { log.push({ kpId: req.kpId, form: req.form, phase: req.phase, item, source: sel.source }); break; }
        exclude.add(sel.item.id);
      }
      seq += 1;
      if (!item) break;
      if (!known.get(req.kpId) && rng() < GRAPH.band(req.kpId).learn) known.set(req.kpId, true);
      const correct = known.get(req.kpId) ? rng() > GRAPH.band(req.kpId).slip : false;
      sched.submit(req, { correct, latencyMs: 6000, itemId: item.id, family: item.family, response: "-" });
    }
    sched.endSession();
  }
  return log;
}

const log = [];
for (let i = 0; i < 8; i += 1) log.push(...servedLog(20260810 + i * 7919));
console.log(`\nserved log: ${log.length} items over 8 median-learner runs of 20 sessions`);
const fromCat = log.filter((r) => r.source === "catalogue").length;
console.log(`  ${fromCat} catalogue (${(100 * fromCat / log.length).toFixed(1)}%) + ${log.length - fromCat} generated`);

const pricing = new Mastery(GRAPH, { bankAudit: AUDIT, storage: null, emit: () => {} });
const byCell = new Map();
for (const r of log) {
  const k = `${r.kpId}|${r.form}`;
  if (!byCell.has(k)) byCell.set(k, []);
  byCell.get(k).push(r.item);
}

console.log(`\nbest single fixed string on the ACTUALLY-SERVED multiset, per cell (n >= 40 only):`);
console.log(`${"cell".padEnd(32)} ${"n".padEnd(6)} ${"served".padEnd(8)} ${"engine".padEnd(8)} ${"modelled".padEnd(9)} scorable  string`);
const over = [];
for (const [k, items] of [...byCell].sort((a, b) => b[1].length - a[1].length)) {
  if (items.length < 40) continue;
  const [kpId, form] = k.split("|");
  const cands = new Set(STAPLES);
  for (const it of items) for (const s of bank.accepts(it).slice(0, 2)) if (s != null) cands.add(String(s));
  let best = { a: null, h: 0 };
  for (const c of cands) {
    let h = 0;
    for (const it of items) { try { if (bank.check(it, c).correct) h += 1; } catch { /**/ } }
    if (h > best.h) best = { a: c, h };
  }
  const rate = best.h / items.length;
  const p = pricing.price(kpId, form, "solo");
  const flag = p.scorable && rate > GRAPH.model.bkt.identifiabilityCaps.maxTrueGuess ? "  <-- OVER maxTrueGuess AND SCORED" : "";
  console.log(
    `${k.padEnd(32)} ${String(items.length).padEnd(6)} ${rate.toFixed(3).padEnd(8)} ${(p.bankBlindRate ?? 0).toFixed(3).padEnd(8)} ${(p.modelledGuess == null ? "-" : p.modelledGuess.toFixed(3)).padEnd(9)} ${String(p.scorable).padEnd(9)} ${JSON.stringify(best.a)}${flag}`
  );
  if (p.scorable && rate > GRAPH.model.bkt.identifiabilityCaps.maxTrueGuess) over.push({ cell: k, served: rate, engine: p.bankBlindRate, modelled: p.modelledGuess, string: best.a });
}
console.log(`\n${over.length} SCORED cells measure above maxTrueGuess ${GRAPH.model.bkt.identifiabilityCaps.maxTrueGuess} on the served population:`);
for (const o of over) console.log("  " + JSON.stringify(o));
