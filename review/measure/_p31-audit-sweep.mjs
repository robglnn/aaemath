#!/usr/bin/env node
/**
 * review/measure/_p31-audit-sweep.mjs — the stale-bank-audit cliff, measured twice.
 *
 *   node review/measure/_p31-audit-sweep.mjs <root>      # prints JSON, read by P31.mjs F1/F2
 *
 * `app/src/boot/62-learning.js` recomputes the blind-guess audit live whenever `bank-audit.json` is
 * stale, by driving `collectBankSample` through `itemBank.select()` across every knowledge point and
 * every form. Splitting the catalogue per knowledge point put a cliff under that fallback: every
 * cold `select()` speculates that the learner will come back to that knowledge point, and a sweep
 * that visits all thirty-two would drag the entire catalogue onto the critical path.
 *
 * This runs the real sweep on the real bank, twice — with the guard and with it disabled — and
 * records the one fact that makes bounding it free: the sweep is a single synchronous block, so
 * **no chunk it requests can resolve while it runs**. `residentDuringSweep` is 0 in both arms, and
 * the sample's catalogue/generator mix is identical, so the guard removes requests that could never
 * have influenced a single price.
 *
 * It runs as its own process because `ItemBank.js` eagerly loads the whole catalogue under Node, and
 * measuring a cold browser requires evicting it — which no other claim in P31 should have to live
 * next to.
 *
 * `perCell` and `tailDraws` are reduced. That shrinks the DRAW COUNT, not the shape: the sweep still
 * visits 32 knowledge points x 3 forms, which is all that chunk counting depends on. At the shipped
 * constants the identical sweep takes 282 s of blocking arithmetic and asks for the same groups.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.argv[2] ?? process.cwd();
const load = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

const IB = await imp("app/src/learn/ItemBank.js");
const { Graph } = await imp("app/src/learn/Graph.js");
const Mast = await imp("app/src/learn/Mastery.js");
const { Scheduler, virtualClock, mulberry32 } = await imp("app/src/learn/Scheduler.js");
const gens = await imp("content/items/generators.mjs");
const idx = await imp("content/items/index.mjs");

const graph = new Graph(load("content/knowledge-graph.json"));
const bankAudit = load("app/src/learn/bank-audit.json");
const settle = () => new Promise((r) => setTimeout(r, 8));

/**
 * One arm of the A/B. `recent` is the guard's window: the real value guards, `Infinity` is the
 * unguarded control (every knowledge point stays "current" forever, so nothing is ever dropped).
 */
async function sweepOnce({ guard }) {
  IB.__evictAllGroups();
  if (!guard) IB.__setSpeculationRecent(Infinity);
  const bank = new IB.ItemBank();
  const t0 = Date.now();
  const sample = Mast.collectBankSample({
    select: (o) => bank.select(o),
    kpIds: graph.ids,
    bandOf: (id) => graph.difficulty(id),
    bankFiles: idx.BANK,
    generateOne: gens.generateOne,
    tiers: gens.TIERS,
    perCell: 8,
    tailDraws: 2,
  });
  const ms = Date.now() - t0;
  // Read BEFORE yielding: this is the state the audit itself computed its prices in.
  const residentDuringSweep = bank.residency().resident.length;
  const mix = sample.reduce((a, s) => ((a[s.source] = (a[s.source] ?? 0) + 1), a), {});
  const digest = sample.map((s) => `${s.kpId}|${s.form}|${s.item.id}|${s.source}`).join("\n");
  await settle();
  await settle();
  await settle();
  const stats = IB.__loadStats();
  IB.__setSpeculationRecent(null); // back to the shipped value
  return {
    ms,
    sampled: sample.length,
    mix,
    digest,
    residentDuringSweep,
    requested: stats.demand,
    suppressed: stats.suppressed,
    residentAfterIdle: bank.residency().resident.length,
  };
}

const guarded = await sweepOnce({ guard: true });
const unguarded = await sweepOnce({ guard: false });

/* ------------------------------------------------------------------ and a real session, guarded */

IB.__evictAllGroups();
const bank = new IB.ItemBank();
const clock = virtualClock(0);
const mastery = new Mast.Mastery(graph, { now: () => clock.minutes(), storage: null, bankAudit, emit: () => {} });
const sched = new Scheduler(mastery, { clock, rng: mulberry32(31), sessionMinutes: 25 });
sched.attachBank(bank);
sched.beginSession();
const t0 = Date.now();
const kps = new Set();
let items = 0;
for (;;) {
  const req = sched.next();
  if (!req) break;
  items += 1;
  kps.add(req.kpId);
  sched.submit(req, { correct: items % 4 !== 0, latencyMs: 20000, itemId: req.itemId ?? `x#${items}`, family: req.family });
  await new Promise((r) => setTimeout(r, 0));
  if (items > 400) break;
}
const sessionMs = Date.now() - t0;
await settle();
const sessionStats = IB.__loadStats();

console.log(
  JSON.stringify({
    guarded: { ...guarded, digest: undefined },
    unguarded: { ...unguarded, digest: undefined },
    sameSample:
      guarded.digest === unguarded.digest && JSON.stringify(guarded.mix) === JSON.stringify(unguarded.mix),
    session: {
      items,
      kps: kps.size,
      ms: sessionMs,
      demandLoads: sessionStats.demand,
      suppressed: sessionStats.suppressed,
      recentWindow: sessionStats.recentWindow,
      resident: bank.residency().resident.length,
    },
  })
);
