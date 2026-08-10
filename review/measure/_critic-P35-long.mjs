/**
 * CRITIC round 1, part 2 — hunting a cliff OUTSIDE the window the builder swept.
 *
 * L1  contiguous storms 10 s -> 120 s in 2 s steps. Where does the descent go `late` (past
 *     recoveryArmMs = 45 s) and become permanently unrecoverable? Is that boundary a cliff?
 * L2  the realistic classroom case: an INTERMITTENT storm — Wi-Fi hitches sprinkled over a minute —
 *     which is what actually walks a descent past the arming window.
 * L3  the same machine, storm ending, then 5 full minutes of clean frames. Does it come back?
 */
globalThis.window = globalThis;
globalThis.location = { search: "" };
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.devicePixelRatio = 1;
globalThis.innerWidth = 1920;
globalThis.innerHeight = 1080;

const { TierPolicy, POLICY } = await import(new URL("../../app/src/core/AutoTier.js", import.meta.url).href);
const { TIER_ORDER } = await import(new URL("../../app/src/core/Config.js", import.meta.url).href);

const CHROMEBOOK = { ultra: 61, high: 34, medium: 16.6, low: 14, potato: 12 };
const rng = (seed) => { let s = (seed >>> 0) || 7; return () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296); };
const cap = () => new TierPolicy("medium", { ceiling: "medium", predictedTier: "medium" });
const idx = (t) => TIER_ORDER.indexOf(t);

function drive(policy, seconds, machine, { storm = () => 0, seed = 1, jitter = 0.5 } = {}) {
  const r = rng(seed);
  const tl = [];
  const limit = seconds * 1000;
  let t = 0, guard = 0;
  while (t < limit && guard++ < 1e7) {
    const ms = machine[policy.tier] + (r() - 0.5) * 2 * jitter + storm(t, r);
    const c = policy.sample(ms);
    if (c) tl.push({ atS: +(t / 1000).toFixed(1), from: c.from, to: c.to, dir: c.direction, rungs: c.rungs });
    t += ms;
  }
  return tl;
}

console.log("== L1  contiguous storm 10-120 s, then 300 s clean. End tier + descent.late");
const l1 = [];
for (let s = 10; s <= 120; s += 2) {
  const p = cap();
  drive(p, s + 300, CHROMEBOOK, { storm: (t) => (t < s * 1000 ? 103 : 0), seed: 4242 });
  l1.push({ s, end: p.tier, late: !!p.descent?.late, corr: !!p.descent?.corroborated, downs: p.downSteps, recs: p.recoveries, maxR: p.changes.reduce((m, c) => Math.max(m, c.rungs), 0), locked: p.locked });
}
for (const r of l1) {
  console.log(`  ${String(r.s).padStart(3)}s -> END ${r.end.padEnd(7)} downs ${r.downs} recovers ${r.recs} late=${String(r.late).padEnd(5)} corroborated=${r.corr} locked=${r.locked} maxRungs ${r.maxR}`);
}
let cliffs = 0;
for (let i = 1; i < l1.length; i++) {
  if (idx(l1[i].end) !== idx(l1[i - 1].end)) { cliffs++; console.log(`  *** END-TIER CLIFF between ${l1[i-1].s}s and ${l1[i].s}s: ${l1[i-1].end} -> ${l1[i].end}`); }
}
console.log(`  end-tier transitions across 10-120 s: ${cliffs}`);

console.log("\n== L2  intermittent classroom Wi-Fi: a 400 ms hitch every N ms, for the first 90 s");
for (const everyMs of [200, 400, 800, 1500, 3000]) {
  const p = cap();
  const tl = drive(p, 400, CHROMEBOOK, {
    seed: 99,
    storm: (t, r) => (t < 90000 && (t % everyMs) < 60 ? 300 + r() * 200 : 0),
  });
  console.log(`  hitch every ${String(everyMs).padStart(4)} ms -> ${tl.map((c) => `${c.atS}s ${c.from}->${c.to}(${c.dir},${c.rungs}r)`).join(" · ") || "no changes"} | END ${p.tier}, late=${!!p.descent?.late}, recovers ${p.recoveries}, excursions ${p.excursions}, stalled ${(p.stalledMs/1000).toFixed(1)}s`);
}

console.log("\n== L3  worst contiguous storm found in L1, then 5 full minutes of clean frames");
const worstRow = l1.reduce((w, r) => (idx(r.end) < idx(w.end) ? r : w), l1[0]);
{
  const p = cap();
  const tl = drive(p, worstRow.s + 600, CHROMEBOOK, { storm: (t) => (t < worstRow.s * 1000 ? 103 : 0), seed: 4242 });
  console.log(`  storm ${worstRow.s}s: ${tl.map((c) => `${c.atS}s ${c.from}->${c.to}(${c.dir})`).join(" · ") || "no changes"}`);
  console.log(`  after 10 clean minutes: END ${p.tier}, gate "${p.recoveryState(p.lastStats).gate}"`);
}
