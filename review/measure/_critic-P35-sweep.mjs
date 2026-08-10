/**
 * CRITIC's own offline sweep for P35. Independent of review/measure/P35.mjs:
 * my own driver, my own machine model, my own seeds, my own granularity.
 *
 * Q1  the round-2 scenario verbatim: chromebook capped at medium, 4.8 s storm, then 3+ min clean.
 * Q2  storm sweep 0.0 -> 10.0 s in 0.2 s steps, across 12 seeds. Any storm length whose END TIER
 *     differs from its neighbours' by a rung is a cliff.
 * Q3  multi-rung check across everything driven here.
 */
globalThis.window = globalThis;
globalThis.location = { search: "" };
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.devicePixelRatio = 1;
globalThis.innerWidth = 1920;
globalThis.innerHeight = 1080;

const { TierPolicy, POLICY } = await import(new URL("../../app/src/core/AutoTier.js", import.meta.url).href);
const { TIER_ORDER } = await import(new URL("../../app/src/core/Config.js", import.meta.url).href);

// A UHD 600 Chromebook: comfortable at medium, which is exactly what the heuristic predicts.
const CHROMEBOOK = { ultra: 61, high: 34, medium: 16.6, low: 14, potato: 12 };

function rng(seed) {
  let s = (seed >>> 0) || 7;
  return () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
}

/** Drive a policy in wall-clock ms; returns the full timeline of applied changes. */
function drive(policy, seconds, machine, { stormMs = 0, stormAdd = 103, seed = 1, jitter = 0.5 } = {}) {
  const r = rng(seed);
  const timeline = [];
  const limitMs = seconds * 1000;
  let t = 0;
  let guard = 0;
  while (t < limitMs && guard++ < 8e6) {
    let ms = machine[policy.tier] + (r() - 0.5) * 2 * jitter;
    if (t < stormMs) ms += stormAdd;
    const c = policy.sample(ms);
    if (c) timeline.push({ atS: +(t / 1000).toFixed(2), from: c.from, to: c.to, dir: c.direction, rungs: c.rungs, medianMs: c.medianMs });
    t += ms;
  }
  return timeline;
}

const idx = (t) => TIER_ORDER.indexOf(t);
const cap = () => new TierPolicy("medium", { ceiling: "medium", predictedTier: "medium" });

let fails = 0;

/* -------------------------------------------------------------- Q1 the round-2 scenario, verbatim */
console.log("== Q1  Chromebook capped at medium · 4.8 s boot storm · 200 s of clean frames after");
for (const seed of [1, 2, 3, 4, 5]) {
  const p = cap();
  const tl = drive(p, 205, CHROMEBOOK, { stormMs: 4800, seed });
  const bad = p.tier !== "medium" || tl.some((c) => c.rungs !== 1);
  if (bad) fails++;
  console.log(
    `  seed ${seed}: t=0s medium (heuristic cap)` +
      tl.map((c) => ` -> t=${c.atS}s ${c.to} (${c.dir}, ${c.rungs} rung, ${c.medianMs} ms)`).join("") +
      ` | END ${p.tier} ${bad ? "FAIL" : "OK"}  [clock ${(p.clock / 1000).toFixed(0)}s, accepted ${p.accepted}]`
  );
}

/* --------------------------------------------------------------- Q2 the cliff sweep, 0.2 s steps */
console.log("\n== Q2  storm sweep 0.0-10.0 s in 0.2 s steps x 12 seeds (300 s sessions)");
const rows = [];
for (let ms = 0; ms <= 10000; ms += 200) {
  const ends = new Map();
  let maxRungs = 0;
  let anyDown = 0;
  let anyRec = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const p = cap();
    drive(p, 300, CHROMEBOOK, { stormMs: ms, seed: seed * 977 });
    ends.set(p.tier, (ends.get(p.tier) ?? 0) + 1);
    maxRungs = Math.max(maxRungs, p.changes.reduce((m, c) => Math.max(m, c.rungs), 0));
    anyDown += p.downSteps;
    anyRec += p.recoveries;
  }
  rows.push({ ms, ends: [...ends.entries()], maxRungs, anyDown, anyRec });
}
for (const r of rows) {
  const endStr = r.ends.map(([t, n]) => `${t}x${n}`).join(",");
  const bad = r.ends.some(([t]) => t !== "medium") || r.maxRungs > 1;
  if (bad) fails++;
  console.log(
    `  ${String(r.ms / 1000).padStart(4)}s storm -> ${endStr.padEnd(12)} downs ${String(r.anyDown).padStart(2)} recovers ${String(r.anyRec).padStart(2)} maxRungs ${r.maxRungs} ${bad ? " <-- FAIL" : ""}`
  );
}

// A cliff is a storm length where the END distribution is worse than a neighbour's.
const worst = rows.map((r) => Math.min(...r.ends.map(([t]) => idx(t))));
let cliffs = 0;
for (let i = 1; i < worst.length; i++) {
  if (worst[i] !== worst[i - 1]) {
    cliffs++;
    console.log(`  CLIFF between ${rows[i - 1].ms / 1000}s and ${rows[i].ms / 1000}s: ${TIER_ORDER[worst[i - 1]]} -> ${TIER_ORDER[worst[i]]}`);
  }
}
console.log(`  cliffs in end-tier across the whole 0-10 s sweep: ${cliffs}`);

/* ---------------------------------------------- Q3 a genuinely weak part still gets its relief */
console.log("\n== Q3  control: a part that really is too slow at medium must NOT end at medium");
{
  const p = cap();
  const tl = drive(p, 300, { ultra: 130, high: 84, medium: 52, low: 31, potato: 18 }, { seed: 11 });
  console.log(`  weak part: ${tl.map((c) => `${c.atS}s ${c.from}->${c.to}(${c.rungs}r)`).join(" · ")} | END ${p.tier}`);
  if (p.tier === "medium") { fails++; console.log("  FAIL: no relief for a genuinely weak part"); }
}

console.log(`\n${fails === 0 ? "SWEEP CLEAN" : `SWEEP FAILURES: ${fails}`}`);
process.exit(fails ? 1 : 0);
