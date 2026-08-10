/**
 * CRITIC harness for P33. Independent of review/measure/P33.mjs: own RNG stream, own latency
 * model (a mixture the estimator was never told about, with a different shape from the builder's),
 * own archetypes, own band arithmetic. Offline; no browser.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { Graph } from "../../app/src/learn/Graph.js";
import { Mastery } from "../../app/src/learn/Mastery.js";
import { Scheduler } from "../../app/src/learn/Scheduler.js";
import { Session, ARC, LEVERAGE } from "../../app/src/flow/Session.js";
import { Save } from "../../app/src/flow/Save.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const readJson = (p) => JSON.parse(readFileSync(resolve(root, p), "utf8"));
const graphSource = readJson("content/knowledge-graph.json");
const bankAudit = readJson("app/src/learn/bank-audit.json");

const arg = (n, d) => {
  const h = process.argv.find((a) => a.startsWith(`--${n}=`));
  return h === undefined ? d : h.split("=").slice(1).join("=");
};
const SESSIONS = Number(arg("sessions", 10));
const SEEDS = Number(arg("seeds", 25));
const ONLY = arg("only", null);

// --------------------------------------------------------------------------- rng / stats
function xorshift(seed) {
  let x = (seed >>> 0) || 0x9e3779b9;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5; x >>>= 0;
    return x / 4294967296;
  };
}
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const r2 = (v) => Math.round(v * 100) / 100;
function q(sorted, p) { return sorted[clamp(Math.round(p * (sorted.length - 1)), 0, sorted.length - 1)]; }
function dist(vals) {
  const s = [...vals].sort((a, b) => a - b);
  return { n: s.length, min: r2(s[0]), p05: r2(q(s, 0.05)), p25: r2(q(s, 0.25)), med: r2(q(s, 0.5)),
    p75: r2(q(s, 0.75)), p95: r2(q(s, 0.95)), max: r2(s[s.length - 1]) };
}

class Mem {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  clone() { const m = new Mem(); m.map = new Map(this.map); return m; }
}

// --------------------------------------------------------------------- my latency model
/**
 * Deliberately NOT the design's per-phase table and NOT the builder's. Thinking time is a sum of
 * three exponentials (Erlang-3, unimodal with a real right tail), scaled by a phase factor that
 * puts `model` ABOVE `solo` for a learner who actually watches the demonstration, plus a reading
 * term that scales with difficulty, plus a distraction spike.
 */
const PHASE_FACTOR = { model: 1.05, "guided-1": 0.7, "guided-2": 0.75, "guided-3": 0.9, solo: 1.0 };

const ARCH = [
  { id: "impatient", mean: 7, tail: 0.03, tailX: 3, ability: 1.5, note: "taps through fast" },
  { id: "typical", mean: 27, tail: 0.07, tailX: 3.5, ability: 0.6, note: "" },
  { id: "distracted", mean: 21, tail: 0.18, tailX: 6, ability: 0.4, note: "one item in five is a long stare" },
  { id: "grinder", mean: 92, tail: 0.05, tailX: 2.5, ability: -0.5, note: "works it out on paper" },
];

function erlang3(rng, mean) {
  const l = 3 / mean;
  return -(Math.log(Math.max(1e-9, rng())) + Math.log(Math.max(1e-9, rng())) + Math.log(Math.max(1e-9, rng()))) / l;
}
function latencyMs(a, req, rng) {
  let s = erlang3(rng, a.mean) * (PHASE_FACTOR[req.phase] ?? 1);
  s += 2 + 1.6 * Math.max(0, req.difficulty + 2);          // reading the thing
  if (rng() < a.tail) s *= a.tailX;                         // a stare
  return Math.round(clamp(s, 1.2, 900) * 1000);
}
const gapMs = (rng) => Math.round(1800 + 5200 * rng());

function makeWorld(seed, startMs, storage = null) {
  const t = { ms: startMs };
  const graph = new Graph(graphSource);
  const clock = { minutes: () => t.ms / 60000, advance() {}, real: true };
  const mastery = new Mastery(graph, { now: () => t.ms / 60000, storage, emit: () => {}, bankAudit });
  const scheduler = new Scheduler(mastery, { clock, seed: seed ^ 0x1234, sessionMinutes: 25 });
  const learning = { mastery, scheduler, graph,
    next: () => scheduler.next(), submit: (r, o) => scheduler.submit(r, o),
    beginSession: () => scheduler.beginSession(), endSession: () => scheduler.endSession() };
  return { t, graph, mastery, scheduler, learning };
}
function respond(w, a, req, rng) {
  const base = 1 / (1 + Math.exp(-(a.ability - req.difficulty)));
  const floor = w.mastery.trueGuess(req.kpId, req.form, req.phase);
  return rng() < base + (1 - base) * floor;
}
function openEvents(w) {
  const out = [];
  for (const id of w.graph.ids) {
    const ev = w.mastery.eventOf(id);
    if (ev && ev.served > 0 && ev.served < ev.items) out.push({ kpId: id, ...ev });
  }
  return out;
}

// -------------------------------------------------------------- one learner, N sittings
function playLearner(a, seed, sessions, opts = {}) {
  const rng = xorshift(seed * 2654435761);
  const store = opts.store ?? new Mem();
  const world = makeWorld(seed, Date.UTC(2026, 2, 3, 15, 45, 0), opts.masteryStore ?? null);
  const save = new Save({ storage: store, now: () => world.t.ms });
  save.load();
  const rows = [];
  for (let n = 0; n < sessions; n += 1) {
    world.t.ms += Math.round((19 + 10 * rng()) * 3600 * 1000);
    const s = new Session({ learning: world.learning, save, now: () => world.t.ms, emit: () => {} });
    s.begin();
    const planned = s.plan;
    const wallStart = world.t.ms;
    let awayMs = 0;
    let servedKps = [];
    for (let g = 0; g < 900; g += 1) {
      const req = s.next();
      if (!req) break;
      servedKps.push(`${req.mode}|${req.kpId}`);
      // AWAY: the builder never exercises this at all. A learner alt-tabs.
      if (opts.away && rng() < opts.away.p) {
        const ms = Math.round(opts.away.minMs + rng() * (opts.away.maxMs - opts.away.minMs));
        world.t.ms += ms; awayMs += ms; s.noteAway(ms);
      }
      const lat = latencyMs(a, req, rng);
      world.t.ms += lat;
      s.submit(req, { correct: respond(world, a, req, rng), latencyMs: lat,
        itemId: `${req.kpId}#${req.seq}`, hinted: req.hinted });
      world.t.ms += gapMs(rng);
    }
    const guarded = s.phase !== "closed";
    if (guarded) s.close("critic-guard");
    const last = s.beats[s.beats.length - 1] ?? null;
    const pr = s.probe();
    rows.push({
      n: n + 1,
      minutes: s.elapsedSeconds / 60,
      wallMinutes: (world.t.ms - wallStart) / 60000,
      awayMinutes: awayMs / 60000,
      items: s.itemsServed, beats: s.beats.length,
      close: s.closeReason, win: s.closingWin,
      lastBeat: last ? `${last.kind}/${last.end}` : "none",
      midItem: s._servedAt != null,
      midEvent: openEvents(world).length > 0,
      guarded,
      rho: r2(s.pace.ratio), spread: r2(s.pace.spread),
      startsOutside: s.stats.startsOutsideCeiling,
      carried: s.stats.eventsCarried,
      plannedBeats: pr.adherence.plannedBeats, matched: pr.adherence.matched, servedBeats: pr.adherence.servedBeats,
      certified: s.tally.certified.length, set: s.tally.set.length,
      level1: world.mastery.summary().level1Percent,
      openLines: s.opening.map((l) => l.source), closeLines: s.closing.map((l) => l.source),
      servedKps,
    });
  }
  return { rows, world, save, store };
}

const say = console.log;
const band = (r) => r.minutes >= ARC.minMinutes && r.minutes <= ARC.maxMinutes;

function report(title, all) {
  const d = dist(all.map((r) => r.minutes));
  const out = all.filter((r) => !band(r));
  say(`${title.padEnd(26)} n=${String(d.n).padStart(4)}  min ${String(d.min).padStart(6)}  p05 ${String(d.p05).padStart(6)}  med ${String(d.med).padStart(6)}  p95 ${String(d.p95).padStart(6)}  max ${String(d.max).padStart(6)}   inband ${all.length - out.length}/${all.length}   midItem ${all.filter((r) => r.midItem).length}   guard ${all.filter((r) => r.guarded).length}`);
  return { d, out };
}

// ================================================================ A: the distribution
if (!ONLY || ONLY === "A") {
  say("=".repeat(140));
  say("A  SESSION-LENGTH DISTRIBUTION — critic's own latency model, attended minutes");
  say("=".repeat(140));
  const failures = [];
  for (const a of ARCH) {
    const all = [];
    for (let s = 1; s <= SEEDS; s += 1) all.push(...playLearner(a, s, SESSIONS).rows);
    const { out } = report(a.id, all);
    failures.push(...out.map((o) => ({ arch: a.id, ...o })));
  }
  say("");
  say(`out-of-band total: ${failures.length}`);
  for (const f of failures.slice(0, 12))
    say(`   ${f.arch} #${f.n} ${r2(f.minutes)} min close=${f.close} items=${f.items} beats=${f.beats} lastBeat=${f.lastBeat}`);
}

// ================================================================ B: long horizon
if (!ONLY || ONLY === "B") {
  say("");
  say("=".repeat(140));
  say("B  LONG HORIZON — 30 consecutive sittings. The product goal is a student who TESTS OUT.");
  say("   Does the arc still hold once the graph starts running dry?");
  say("=".repeat(140));
  for (const a of ARCH) {
    const all = [];
    for (let s = 1; s <= 8; s += 1) all.push(...playLearner(a, s, 30).rows);
    const late = all.filter((r) => r.n > 12);
    const { out } = report(`${a.id} (all 30)`, all);
    const lateOut = late.filter((r) => !band(r));
    say(`   sittings 13-30 only: ${late.length - lateOut.length}/${late.length} in band; ` +
        `closes: ${[...new Set(late.map((r) => r.close))].join(",")}`);
    if (out.length) {
      const byClose = new Map();
      for (const o of out) byClose.set(o.close, (byClose.get(o.close) ?? 0) + 1);
      say(`   out-of-band closes: ${[...byClose].map(([k, v]) => `${k}=${v}`).join("  ")}   worst ${r2(Math.min(...out.map((o) => o.minutes)))}–${r2(Math.max(...out.map((o) => o.minutes)))} min`);
      for (const o of out.slice(0, 5)) say(`     e.g. #${o.n} ${r2(o.minutes)} min close=${o.close} items=${o.items} level1=${o.level1}`);
    }
  }
}

// ================================================================ C: away / the break
if (!ONLY || ONLY === "C") {
  say("");
  say("=".repeat(140));
  say("C  AWAY AND THE BREAK — noteAway() is NEVER called anywhere in review/measure/P33.mjs.");
  say("   A Pomodoro layer whose break path is unmeasured has not measured the Pomodoro.");
  say("=".repeat(140));
  const cases = [
    ["short alt-tabs (p=.12, 20-90s)", { p: 0.12, minMs: 20000, maxMs: 90000 }],
    ["one real break (p=.02, 5-12min)", { p: 0.02, minMs: 300000, maxMs: 720000 }],
    ["classroom churn (p=.08, 2-9min)", { p: 0.08, minMs: 120000, maxMs: 540000 }],
  ];
  for (const [label, away] of cases) {
    say("");
    say(`-- ${label}`);
    for (const a of ARCH) {
      const all = [];
      for (let s = 1; s <= 10; s += 1) all.push(...playLearner(a, s, SESSIONS, { away }).rows);
      const wall = dist(all.map((r) => r.wallMinutes));
      const { out } = report(`   ${a.id}`, all);
      const breaks = all.filter((r) => r.close === "break").length;
      say(`      wall-clock: med ${wall.med}  p95 ${wall.p95}  max ${wall.max} min   closes=break: ${breaks}   ` +
          `away med ${dist(all.map((r) => r.awayMinutes)).med} min` + (out.length ? `   OUT:${out.length}` : ""));
    }
  }
}

// ================================================================ D: kill and resume
if (!ONLY || ONLY === "D") {
  say("");
  say("=".repeat(140));
  say("D  KILL MID-SITTING AND RESUME — full state round-trip through storage, as a page reload is");
  say("=".repeat(140));
  const checks = [];
  const store = new Mem();
  const mstore = new Mem();
  const t = { ms: Date.UTC(2026, 2, 3, 15, 45, 0) };
  const graph = new Graph(graphSource);
  const build = () => {
    const clock = { minutes: () => t.ms / 60000, advance() {}, real: true };
    const mastery = new Mastery(graph, { now: () => t.ms / 60000, storage: mstore, emit: () => {}, bankAudit });
    const scheduler = new Scheduler(mastery, { clock, seed: 0x77, sessionMinutes: 25 });
    const learning = { mastery, scheduler, graph, next: () => scheduler.next(),
      submit: (r, o) => scheduler.submit(r, o), beginSession: () => scheduler.beginSession(),
      endSession: () => scheduler.endSession() };
    return { mastery, scheduler, learning };
  };
  const rng = xorshift(99);
  const a = ARCH[1];

  // ---- Sitting 1..k: play far enough that a retention check is genuinely reachable.
  let w = build();
  w.mastery.hydrate();
  w.scheduler.beginSession();
  let save = new Save({ storage: store, now: () => t.ms });
  save.load();
  let killedAt = null;
  let openEv = null;
  for (let n = 0; n < 14 && !killedAt; n += 1) {
    t.ms += Math.round((20 + 6 * rng()) * 3600 * 1000);
    const s = new Session({ learning: w.learning, save, now: () => t.ms, emit: () => {} });
    s.begin({ adopt: n === 0 });
    for (let g = 0; g < 900; g += 1) {
      const req = s.next();
      if (!req) break;
      const lat = latencyMs(a, req, rng);
      t.ms += lat;
      s.submit(req, { correct: respond({ mastery: w.mastery }, a, req, rng), latencyMs: lat, itemId: `${req.kpId}#${req.seq}`, hinted: req.hinted });
      t.ms += gapMs(rng);
      // KILL: the tab closes in the middle of a multi-item certification event.
      if (n >= 5 && s.beat && s.beat.atomic && !s.beat.done && s.beat.served >= 2) {
        killedAt = { kpId: s.beat.kpId, kind: s.beat.kind, served: s.beat.served, items: s.beat.items,
          minutes: r2(s.elapsedSeconds / 60), sessionNo: s.number,
          lapses: w.mastery.stateOf(s.beat.kpId).lapses, p: w.mastery.stateOf(s.beat.kpId).p,
          status: w.mastery.status(s.beat.kpId) };
        // what a real pagehide does, and only that
        save.checkpoint({ elapsedSeconds: Math.round(s.elapsedSeconds), items: s.itemsServed });
        w.mastery.persist();
        break;
      }
    }
    if (!killedAt && s.phase !== "closed") s.close("critic-guard");
    if (!killedAt) openEv = openEvents({ graph, mastery: w.mastery });
  }
  say(killedAt ? `killed mid-${killedAt.kind} on ${killedAt.kpId} at item ${killedAt.served}/${killedAt.items}, ${killedAt.minutes} min in, session #${killedAt.sessionNo}`
                : "COULD NOT REACH a mid-event kill in 14 sittings — that itself is a finding");
  checks.push(["reached a mid-certification kill", !!killedAt]);

  if (killedAt) {
    // ---- RELOAD: everything in memory is gone. Rebuild exactly as boot/62 then boot/90 do.
    t.ms += 45 * 60 * 1000; // 45 minutes later, same afternoon
    const w2 = build();
    const resumed = w2.mastery.hydrate();
    w2.scheduler.beginSession();                              // boot/62
    const save2 = new Save({ storage: store, now: () => t.ms });   // boot/90
    const load2 = save2.load();
    const s2 = new Session({ learning: w2.learning, save: save2, now: () => t.ms, emit: () => {} });
    s2.begin({ adopt: true });

    const ev2 = w2.mastery.eventOf(killedAt.kpId);
    const st2 = w2.mastery.stateOf(killedAt.kpId);
    checks.push(["mastery model rehydrated", resumed === true || resumed?.restored === true || !!resumed]);
    checks.push([`open ${killedAt.kind} event survived the reload (${ev2 ? `${ev2.served}/${ev2.items}` : "GONE"})`,
      !!ev2 && ev2.served === killedAt.served]);
    checks.push([`no lapse charged for the kill (${killedAt.lapses} -> ${st2.lapses})`, st2.lapses === killedAt.lapses]);
    checks.push([`status unchanged (${killedAt.status} -> ${w2.mastery.status(killedAt.kpId)})`, w2.mastery.status(killedAt.kpId) === killedAt.status]);
    checks.push([`save reports the sitting as interrupted (${load2.fault ?? "clean"} / ${load2.interrupted ? "interrupted" : "none"})`, !!load2.interrupted]);
    checks.push([`pace carried across the reload (rho ${r2(save2.pace.ratio)}, ${save2.pace.samples} samples)`, save2.pace.samples > 0 && Math.abs(save2.pace.ratio - 1) > 1e-9]);
    checks.push([`fresh arc, not a resumed clock (elapsed ${r2(s2.elapsedSeconds / 60)} min)`, s2.elapsedSeconds < 1]);
    // the first thing served must be the rest of the carried check
    const first = s2.next();
    checks.push([`first item after reload finishes the carried check (${first ? `${first.mode} ${first.kpId}` : "null"})`,
      !!first && first.kpId === killedAt.kpId && first.mode === killedAt.kind]);
    say(`   session counter: killed during #${killedAt.sessionNo}, reload opened #${s2.number} ` +
        `(a page reload increments Mastery.session, which is §3's "intervening session")`);
    // ---- how many free intervening sessions does mashing F5 buy?
    let n0 = w2.mastery.session;
    for (let i = 0; i < 5; i += 1) { const w3 = build(); w3.mastery.hydrate(); w3.scheduler.beginSession(); }
    const w4 = build(); w4.mastery.hydrate();
    say(`   five reloads with zero items answered moved Mastery.session ${n0} -> ${w4.mastery.session}`);
    checks.push([`reloads do NOT manufacture intervening sessions (${n0} -> ${w4.mastery.session})`, w4.mastery.session === n0]);
  }
  say("");
  for (const [n, ok] of checks) say(`  ${ok ? "PASS" : "FAIL"}  ${n}`);
}

// ================================================================ E: corrupt saves
if (!ONLY || ONLY === "E") {
  say("");
  say("=".repeat(140));
  say("E  CORRUPTION — beyond the builder's five cases");
  say("=".repeat(140));
  const checks = [];
  const K = "vs.flow.save.v1";
  const mk = (v) => { const s = new Mem(); s.setItem(K, typeof v === "string" ? v : JSON.stringify(v)); return s; };

  let st = mk("{}{}{}"); let s = new Save({ storage: st }); let r = s.load();
  checks.push([`garbage json -> ${r.fault}, quarantined=${!!st.getItem(K + ".corrupt")}`, r.fault === "corrupt-json" && !!st.getItem(K + ".corrupt")]);

  st = mk([1, 2, 3]); r = new Save({ storage: st }).load();
  checks.push([`top-level array -> ${r.fault}`, r.fault === "not-an-object"]);

  st = mk({ version: 1, pace: { ratio: 1e9, spread: -5, gapSeconds: 1e9, samples: -3 } });
  s = new Save({ storage: st }); r = s.load();
  checks.push([`absurd pace clamped/named (${r.repaired.join(",")}) ratio=${s.state.pace.ratio}`,
    r.fault === "repaired" && s.state.pace.ratio === 1 && s.state.pace.spread === 0 && s.state.pace.samples === 0]);

  st = mk({ version: 1, pace: { ratio: null, spread: NaN } });
  s = new Save({ storage: st }); r = s.load();
  checks.push([`null/NaN pace named (${r.repaired.join(",") || "NOTHING NAMED"})`, r.repaired.includes("pace.ratio")]);

  // A `live` block of pure garbage is accepted verbatim and re-published as history.
  st = mk({ version: 1, live: { number: "🐛", plannedItems: { nope: true }, openedAt: "yesterday" } });
  s = new Save({ storage: st }); r = s.load();
  checks.push([`garbage \`live\` block validated (fault=${r.fault ?? "none"}, repaired=${r.repaired.join(",") || "none"})`,
    r.fault === "repaired" || r.fault === "not-an-object"]);
  say(`     -> history now contains: ${JSON.stringify(s.state.sessions[0])}`);

  // A session pushed into a Session that then reads pace out of it.
  st = mk({ version: 1, pace: { ratio: 0.1, spread: 6, gapSeconds: 120, samples: 999999 } });
  s = new Save({ storage: st }); s.load();
  const w = makeWorld(5, Date.UTC(2026, 2, 3, 15, 0, 0));
  const sess = new Session({ learning: w.learning, save: s, now: () => w.t.ms, emit: () => {} });
  sess.begin();
  say(`     legal-but-extreme pace {ratio .1, spread 6, samples 1e6}: perItem ${r2(sess.itemSeconds())}s ` +
      `high ${r2(sess.itemSecondsHigh())}s ceiling ${r2(sess.itemSecondsCeiling())}s target ${r2(sess.targetSeconds() / 60)} min ` +
      `plannedBeats ${sess.plan.events} shortfall=${sess.plan.shortfall}`);
  checks.push([`extreme-but-legal pace still plans a sitting inside the arc`,
    sess.targetSeconds() / 60 >= ARC.minMinutes && sess.targetSeconds() / 60 <= ARC.maxMinutes]);

  // storage that accepts reads and refuses writes (quota)
  const hostile = { getItem: () => null, setItem() { throw new Error("QuotaExceededError"); }, removeItem() {} };
  const warns = [];
  const hs = new Save({ storage: hostile, onWarn: (m) => warns.push(m) });
  hs.load(); hs.openSession({ number: 1 }); hs.checkpoint({ items: 3 }); hs.closeSession({ number: 1 });
  checks.push([`write-refused storage warns once, not per beat (${warns.length} warn, ${hs.writeFailures} failures)`,
    warns.length === 1 && hs.writeFailures === 4]);

  for (const [n, ok] of checks) say(`  ${ok ? "PASS" : "FAIL"}  ${n}`);
}

// ================================================================ F: leverage
if (!ONLY || ONLY === "F") {
  say("");
  say("=".repeat(140));
  say("F  DOES THE LEVERAGE RANKING REACH THE LEARNER?");
  say("=".repeat(140));
  const src = readFileSync(resolve(root, "app/src/flow/Session.js"), "utf8");
  const reaches = /scheduler\.(focus|prefer|require|setNext|queue)/.test(src);
  say(`  Session.js calls a Scheduler selection affordance: ${reaches ? "YES" : "NO"}`);
  say(`  Session.js writes to the Scheduler: ${[...src.matchAll(/sch(?:eduler)?\.(\w+)\s*=/g)].map((m) => m[1]).join(", ") || "nothing"}`);
  let plannedBeats = 0, matched = 0, served = 0;
  const firstMatch = [];
  for (const a of ARCH) {
    for (let s = 1; s <= 10; s += 1) {
      for (const r of playLearner(a, s, SESSIONS).rows) {
        plannedBeats += r.plannedBeats; matched += r.matched; served += r.servedBeats;
        firstMatch.push(r.matched / Math.max(1, r.servedBeats));
      }
    }
  }
  say(`  adherence over ${firstMatch.length} sittings: planned ${plannedBeats} beats, served ${served}, matched ${matched}` +
      `  => ${r2((100 * matched) / Math.max(1, served))}% of served beats were in the plan`);
  say(`  per-sitting match fraction: ${JSON.stringify(dist(firstMatch))}`);
}

// ================================================================ G: what ends a sitting
if (!ONLY || ONLY === "G") {
  say("");
  say("=".repeat(140));
  say("G  WHAT ACTUALLY ENDS A SITTING — is the budget beats, or is it a clock?");
  say("=".repeat(140));
  const closes = new Map(), wins = new Map(), lastB = new Map();
  let n = 0;
  for (const a of ARCH)
    for (let s = 1; s <= 12; s += 1)
      for (const r of playLearner(a, s, SESSIONS).rows) {
        n += 1;
        closes.set(r.close, (closes.get(r.close) ?? 0) + 1);
        wins.set(r.win, (wins.get(r.win) ?? 0) + 1);
        lastB.set(r.lastBeat, (lastB.get(r.lastBeat) ?? 0) + 1);
      }
  const pct = (m) => [...m].sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k}=${v} (${r2((100 * v) / n)}%)`).join("  ");
  say(`  n=${n}`);
  say(`  close reason: ${pct(closes)}`);
  say(`  closing win : ${pct(wins)}`);
  say(`  last beat   : ${pct(lastB)}`);
}
