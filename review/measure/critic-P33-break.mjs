/** Minimal, unambiguous proof of the break latch and of what happens after a sitting closes. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Graph } from "../../app/src/learn/Graph.js";
import { Mastery } from "../../app/src/learn/Mastery.js";
import { Scheduler } from "../../app/src/learn/Scheduler.js";
import { Session } from "../../app/src/flow/Session.js";
import { Save } from "../../app/src/flow/Save.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const rj = (p) => JSON.parse(readFileSync(resolve(root, p), "utf8"));
const graph = new Graph(rj("content/knowledge-graph.json"));
const bankAudit = rj("app/src/learn/bank-audit.json");
class Mem { constructor(){this.m=new Map();} getItem(k){return this.m.has(k)?this.m.get(k):null;} setItem(k,v){this.m.set(k,String(v));} removeItem(k){this.m.delete(k);} }

const t = { ms: Date.UTC(2026, 2, 3, 15, 45, 0) };
const clock = { minutes: () => t.ms / 60000, advance() {}, real: true };
const mastery = new Mastery(graph, { now: () => t.ms / 60000, storage: null, emit: () => {}, bankAudit });
const scheduler = new Scheduler(mastery, { clock, seed: 3, sessionMinutes: 25 });
const learning = { mastery, scheduler, graph, next: () => scheduler.next(), submit: (r, o) => scheduler.submit(r, o),
  beginSession: () => scheduler.beginSession(), endSession: () => scheduler.endSession() };
const save = new Save({ storage: new Mem(), now: () => t.ms });
save.load();

const s = new Session({ learning, save, now: () => t.ms, emit: () => {} });
s.begin();
console.log(`ARC floor=${s.arc.minMinutes} target=${s.arc.targetMinutes} ceiling=${s.arc.maxMinutes} breakMinutes=${s.arc.breakMinutes}`);

let served = 0;
for (let i = 0; i < 400; i += 1) {
  const req = s.next();
  if (!req) break;
  served += 1;
  t.ms += 20000;
  s.submit(req, { correct: true, latencyMs: 20000, itemId: `${req.kpId}#${req.seq}` });
  t.ms += 4000;
  // ONE five-minute absence, 3 items into a twenty-minute Pomodoro.
  if (served === 3) {
    console.log(`\n  ...at ${(s.elapsedSeconds / 60).toFixed(2)} min, after ${served} items, the learner leaves for 5 min 1 s.`);
    t.ms += 301000;
    s.noteAway(301000);
  }
}
console.log(`\n  sitting ended: phase=${s.phase} closeReason=${s.closeReason} attended=${(s.elapsedSeconds / 60).toFixed(2)} min items=${s.itemsServed} beats=${s.beats.length}`);
console.log(`  closingWin=${s.closingWin}   closing copy: ${s.closing.map((l) => JSON.stringify(l.source)).join(" ")}`);
console.log(`  next() now returns: ${s.next()}`);
console.log(`  and it will keep returning that: ${s.next()}, ${s.next()}`);
console.log(`\n  callers of restart()/begin() anywhere in app/src outside Session.js: boot/90-flow.js defines restart(), nothing calls it.`);

// The same absence, but taken as a genuine end-of-Pomodoro break at minute 20.
const t2 = { ms: Date.UTC(2026, 2, 4, 15, 45, 0) };
const clock2 = { minutes: () => t2.ms / 60000, advance() {}, real: true };
const m2 = new Mastery(graph, { now: () => t2.ms / 60000, storage: null, emit: () => {}, bankAudit });
const sc2 = new Scheduler(m2, { clock: clock2, seed: 3, sessionMinutes: 25 });
const l2 = { mastery: m2, scheduler: sc2, graph, next: () => sc2.next(), submit: (r, o) => sc2.submit(r, o),
  beginSession: () => sc2.beginSession(), endSession: () => sc2.endSession() };
const sv2 = new Save({ storage: new Mem(), now: () => t2.ms });
sv2.load();
const s2 = new Session({ learning: l2, save: sv2, now: () => t2.ms, emit: () => {} });
s2.begin();
for (let i = 0; i < 400; i += 1) {
  const req = s2.next();
  if (!req) break;
  t2.ms += 20000;
  s2.submit(req, { correct: true, latencyMs: 20000, itemId: `${req.kpId}#${req.seq}` });
  t2.ms += 4000;
}
console.log(`\n  control (no absence): ${(s2.elapsedSeconds / 60).toFixed(2)} min, ${s2.itemsServed} items, close=${s2.closeReason}, win=${s2.closingWin}`);

// Does mashing F5 manufacture §3 intervening sessions?  A real page load: hydrate -> beginSession -> ... -> pagehide persist.
const store = new Mem();
const t3 = { ms: Date.UTC(2026, 2, 5, 9, 0, 0) };
const load = () => {
  const m = new Mastery(graph, { now: () => t3.ms / 60000, storage: store, emit: () => {}, bankAudit });
  const sc = new Scheduler(m, { clock: { minutes: () => t3.ms / 60000, advance() {}, real: true }, seed: 3, sessionMinutes: 25 });
  m.hydrate();          // boot/62
  sc.beginSession();    // boot/62
  return { m, sc };
};
let w = load();
const start = w.m.session;
for (let i = 0; i < 5; i += 1) { w = load(); t3.ms += 10000; w.m.persist(); }   // pagehide flush, zero items answered
console.log(`\n  five reloads, zero items answered, ten seconds apart: Mastery.session ${start} -> ${w.m.session}`);
console.log(`  §3 retention gate reads exactly this counter (minInterveningSessions).`);
