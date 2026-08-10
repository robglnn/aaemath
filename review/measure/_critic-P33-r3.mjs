/** CRITIC P33 part 3: phase mix, mid-session kill/resume, save corruption, overrun forensics. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Graph } from "../../app/src/learn/Graph.js";
import { Mastery } from "../../app/src/learn/Mastery.js";
import { Scheduler } from "../../app/src/learn/Scheduler.js";
import { Session } from "../../app/src/flow/Session.js";
import { Save } from "../../app/src/flow/Save.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const rj = (p) => JSON.parse(readFileSync(resolve(root, p), "utf8"));
const graphSource = rj("content/knowledge-graph.json");
const bankAudit = rj("app/src/learn/bank-audit.json");
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
function rngFrom(seed) { let a = (seed * 2654435761) >>> 0; return () => { a ^= a << 13; a >>>= 0; a ^= a >> 17; a ^= a << 5; a >>>= 0; return a / 4294967296; }; }
class Mem { constructor(m) { this.m = m ?? new Map(); } getItem(k) { return this.m.has(k) ? this.m.get(k) : null; } setItem(k, v) { this.m.set(k, String(v)); } removeItem(k) { this.m.delete(k); } }

function world(seed, startMs) {
  const t = { ms: startMs };
  const graph = new Graph(graphSource);
  const clock = { minutes: () => t.ms / 60000, advance() {}, real: true };
  const mastery = new Mastery(graph, { now: () => t.ms / 60000, storage: null, emit: () => {}, bankAudit });
  const scheduler = new Scheduler(mastery, { clock, seed, sessionMinutes: 25 });
  return { t, graph, mastery, scheduler, learning: { mastery, scheduler, graph, next: () => scheduler.next(), submit: (r, o) => scheduler.submit(r, o), beginSession: () => scheduler.beginSession(), endSession: () => scheduler.endSession() } };
}

// ---------------------------------------------------------------- A. phase mix
{
  const w = world(7, Date.UTC(2026, 2, 3, 15, 0, 0));
  const save = new Save({ storage: new Mem(), now: () => w.t.ms });
  save.load();
  const rng = rngFrom(11);
  const phases = new Map(), forms = new Map();
  let scoredCount = 0;
  const s = new Session({ learning: w.learning, save, now: () => w.t.ms, emit: () => {} });
  s.begin();
  for (let g = 0; g < 900; g += 1) {
    const req = s.next(); if (!req) break;
    phases.set(req.phase, (phases.get(req.phase) ?? 0) + 1);
    forms.set(req.form, (forms.get(req.form) ?? 0) + 1);
    const ms = 9000; w.t.ms += ms;
    const r = s.submit(req, { correct: rng() < 0.95, latencyMs: ms, itemId: `${req.kpId}#${req.seq}`, hinted: req.hinted });
    if (r && r.scored) scoredCount += 1;
    w.t.ms += 3000;
  }
  if (s.phase !== "closed") s.close("g");
  console.log("A. ONE SITTING, 95%-correct learner");
  console.log("   items:", s.itemsServed, " beats:", s.beats.length, " minutes:", s.probe().elapsed.minutes);
  console.log("   phases served:", [...phases].map(([k, v]) => `${k}=${v}`).join(" "));
  console.log("   forms served :", [...forms].map(([k, v]) => `${k}=${v}`).join(" "));
  console.log("   engine-scored responses:", scoredCount, " mastery-eligible (solo+eligible form):", w.mastery.stateOf("var-meaning").scored);
  console.log("   distinct KPs in the sitting:", new Set(s.beats.map((b) => b.kpId)).size, "->", [...new Set(s.beats.map((b) => b.kpId))].join(","));
  console.log("   closing lines:", JSON.stringify(s.closing.map((l) => l.source)));
  console.log("   opening lines:", JSON.stringify(s.opening.map((l) => l.source)));
}

// ------------------------------------------------- B. kill mid-way, then resume
{
  console.log("\nB. KILL MID-SITTING (simulated tab close), then a fresh page load");
  const store = new Map();
  const w = world(21, Date.UTC(2026, 2, 4, 15, 0, 0));
  const save = new Save({ storage: new Mem(store), now: () => w.t.ms });
  save.load();
  const rng = rngFrom(33);
  const s = new Session({ learning: w.learning, save, now: () => w.t.ms, emit: () => {} });
  s.begin();
  for (let g = 0; g < 40; g += 1) {
    const req = s.next(); if (!req) break;
    w.t.ms += 14000;
    s.submit(req, { correct: rng() < 0.9, latencyMs: 14000, itemId: `${req.kpId}#${req.seq}`, hinted: req.hinted });
    w.t.ms += 3000;
  }
  const beforeItems = s.itemsServed, beforeMin = s.probe().elapsed.minutes, beforePace = { ...s.pace };
  // The kill: no close(), no pagehide. The tab is gone.
  console.log(`   killed after ${beforeItems} items / ${beforeMin} min, rho=${beforePace.ratio.toFixed(3)} samples=${beforePace.samples}`);
  const keys = [...store.keys()];
  console.log("   storage keys written:", keys.join(",") || "(none)");

  // Fresh page load: new Save on the same storage, new Session.
  const w2 = world(21, w.t.ms + 3600 * 1000);
  const save2 = new Save({ storage: new Mem(store), now: () => w2.t.ms });
  const load2 = save2.load();
  console.log("   reload fault:", load2.fault ?? "none", " interrupted:", JSON.stringify(load2.interrupted ?? null));
  const s2 = new Session({ learning: w2.learning, save: save2, now: () => w2.t.ms, emit: () => {} });
  const plan = s2.begin();
  console.log("   pace recovered:", JSON.stringify({ ratio: +s2.pace.ratio.toFixed(3), samples: s2.pace.samples, slowRatio: +(s2.pace.slowRatio ?? 0).toFixed(3) }), "  (was ratio", +beforePace.ratio.toFixed(3), "samples", beforePace.samples + ")");
  console.log("   new plan minutes:", plan?.minutes, " opening:", JSON.stringify(s2.opening.map((l) => l.source)));
  console.log("   NOTE learner model: Mastery storage is null in this harness; in the game Mastery persists separately.");
}

// --------------------------------------------------- C. corrupt the save
{
  console.log("\nC. CORRUPT SAVE — does it degrade honestly?");
  const cases = [
    ["not json at all", "{{{{"],
    ["json but not an object", "42"],
    ["wrong version", JSON.stringify({ version: 999, pace: { ratio: 1, spread: 0.3, gapSeconds: 4, samples: 10 }, sessions: [] })],
    ["pace.ratio = NaN string", JSON.stringify({ version: 1, pace: { ratio: "banana", spread: 0.3, gapSeconds: 4, samples: 10 }, sessions: [] })],
    ["pace.ratio = -5", JSON.stringify({ version: 1, pace: { ratio: -5, spread: 0.3, gapSeconds: 4, samples: 10 }, sessions: [] })],
    ["pace.ratio = 1e9", JSON.stringify({ version: 1, pace: { ratio: 1e9, spread: 1e9, gapSeconds: 1e9, samples: 10 }, sessions: [] })],
    ["sessions is a string", JSON.stringify({ version: 1, pace: { ratio: 1, spread: 0.3, gapSeconds: 4, samples: 5 }, sessions: "nope" })],
    ["empty string", ""],
  ];
  for (const [name, body] of cases) {
    const store = new Map();
    // find the key Save uses
    const probeStore = new Map();
    const p = new Save({ storage: new Mem(probeStore), now: () => 0 });
    p.load(); p.savePace({ ratio: 1, spread: 0.3, gapSeconds: 4, samples: 1, slowRatio: 2 }); p.write?.();
    const key = [...probeStore.keys()][0];
    store.set(key, body);
    const w = world(5, Date.UTC(2026, 2, 5, 15, 0, 0));
    const warns = [];
    const save = new Save({ storage: new Mem(store), now: () => w.t.ms, onWarn: (m) => warns.push(m) });
    let res, err = null;
    try { res = save.load(); } catch (e) { err = String(e?.message || e); }
    let ok = "-", mins = "-";
    if (!err) {
      try {
        const s = new Session({ learning: w.learning, save, now: () => w.t.ms, emit: () => {} });
        s.begin();
        const rng = rngFrom(9);
        for (let g = 0; g < 400; g += 1) {
          const req = s.next(); if (!req) break;
          w.t.ms += 15000;
          s.submit(req, { correct: rng() < 0.9, latencyMs: 15000, itemId: `${req.kpId}#${req.seq}`, hinted: req.hinted });
          w.t.ms += 3000;
        }
        if (s.phase !== "closed") s.close("g");
        mins = s.probe().elapsed.minutes;
        ok = mins >= 15 && mins <= 25 ? "in-band" : `OUT-OF-BAND(${mins})`;
      } catch (e) { ok = "THREW: " + String(e?.message || e); }
    }
    console.log(`   ${name.padEnd(24)} fault=${String(res?.fault ?? err).padEnd(14)} warns=${warns.length} -> sitting ${ok} (${mins} min)`);
  }
}

// --------------------------------------------------- D. overrun forensics
{
  console.log("\nD. OVERRUN FORENSICS — bimodal learner, are >25 min sittings one long response?");
  const rows = [];
  for (let seed = 1; seed <= 12; seed += 1) {
    const w = world(seed * 31, Date.UTC(2026, 2, 6, 15, 0, 0));
    const save = new Save({ storage: new Mem(), now: () => w.t.ms });
    save.load();
    const rng = rngFrom(seed * 977);
    let session = null;
    for (let n = 0; n < 10; n += 1) {
      w.t.ms += Math.round(22 * 3600 * 1000);
      session = new Session({ learning: w.learning, save, now: () => w.t.ms, emit: () => {} });
      session.begin();
      for (let g = 0; g < 900; g += 1) {
        const req = session.next(); if (!req) break;
        const slow = rng() < 0.22;
        const base = slow ? 260 : 12;
        const ms = Math.round(clamp(base * (1 + 0.3 * req.difficulty) * Math.exp(0.35 * (rng() * 2 - 1)), 2, 900) * 1000);
        w.t.ms += ms;
        session.submit(req, { correct: rng() < 0.7, latencyMs: ms, itemId: `${req.kpId}#${req.seq}`, hinted: req.hinted });
        w.t.ms += 3000;
      }
      if (session.phase !== "closed") session.close("g");
      const p = session.probe();
      rows.push({ min: p.elapsed.minutes, excess: p.stats.worstResponseExcessSeconds, outside: p.stats.startsOutsideCeiling, reason: p.closeReason, win: p.closingWin });
    }
  }
  const over = rows.filter((r) => r.min > 25);
  const under = rows.filter((r) => r.min < 15);
  console.log(`   ${rows.length} sittings; >25: ${over.length}; <15: ${under.length}`);
  for (const r of over) {
    const overBy = (r.min - 25) * 60;
    console.log(`     ${r.min} min (over by ${overBy.toFixed(0)}s) worstResponseExcess=${r.excess.toFixed(0)}s startsOutsideCeiling=${r.outside} -> ${overBy <= r.excess ? "explained by ONE response" : "NOT EXPLAINED — layer under-reserved"}`);
  }
  const wins = new Map();
  for (const r of rows) wins.set(r.win, (wins.get(r.win) ?? 0) + 1);
  console.log("   closingWin:", [...wins].map(([k, v]) => `${k}=${v}`).join(" "));
}
