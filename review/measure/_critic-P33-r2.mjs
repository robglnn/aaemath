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
class Mem { constructor() { this.m = new Map(); } getItem(k) { return this.m.has(k) ? this.m.get(k) : null; } setItem(k, v) { this.m.set(k, String(v)); } removeItem(k) { this.m.delete(k); } }

const t = { ms: Date.UTC(2026, 2, 3, 15, 0, 0) };
const graph = new Graph(graphSource);
const clock = { minutes: () => t.ms / 60000, advance() {}, real: true };
const mastery = new Mastery(graph, { now: () => t.ms / 60000, storage: null, emit: () => {}, bankAudit });
const scheduler = new Scheduler(mastery, { clock, seed: 99, sessionMinutes: 25 });
const learning = { mastery, scheduler, graph, next: () => scheduler.next(), submit: (r, o) => scheduler.submit(r, o), beginSession: () => scheduler.beginSession(), endSession: () => scheduler.endSession() };
const save = new Save({ storage: new Mem(), now: () => t.ms });
save.load();
const rng = rngFrom(4242);

// a very strong learner: near-perfect, fast. If ANYTHING certifies, it is this one.
const ability = 3.0;
let session = null;
const kpSeen = new Map();
for (let n = 0; n < 10; n += 1) {
  t.ms += Math.round((22 + 6 * rng()) * 3600 * 1000);
  session = new Session({ learning, save, now: () => t.ms, emit: () => {} });
  session.begin();
  for (let g = 0; g < 900; g += 1) {
    const req = session.next();
    if (!req) break;
    kpSeen.set(req.kpId, (kpSeen.get(req.kpId) ?? 0) + 1);
    const ms = Math.round(clamp(8 * (1 + 0.3 * req.difficulty), 3, 40) * 1000);
    t.ms += ms;
    const p = 1 / (1 + Math.exp(-(ability - req.difficulty)));
    session.submit(req, { correct: rng() < p, latencyMs: ms, itemId: `${req.kpId}#${req.seq}`, hinted: req.hinted });
    t.ms += 3000;
  }
  if (session.phase !== "closed") session.close("g");
  const pr = session.probe();
  const sm = mastery.summary();
  console.log(`sit ${n + 1}: ${pr.elapsed.minutes}min items=${pr.elapsed.items} beats=${pr.elapsed.beats} reason=${pr.closeReason} win=${pr.closingWin} certified=${pr.tally.certified.length} set=${pr.tally.set.length} lvl1=${sm.level1Percent} mastered=${sm.mastered} prov=${sm.provisional ?? "?"} rho=${pr.pace.ratio}`);
}
console.log("\nsummary:", JSON.stringify(mastery.summary()));
console.log("distinct KPs touched:", kpSeen.size, "of", graph.ids.length);
console.log("top KPs by items:", [...kpSeen].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}:${v}`).join(" "));
const st = [...kpSeen.keys()].map((id) => ({ id, ...mastery.stateOf(id) }));
for (const s of st.slice(0, 6)) {
  console.log(` state ${s.id}: status=${s.status} attempts=${s.attempts} consolidated=${s.consolidated} provisionalAt=${s.provisionalAt} nextEventAt=${s.nextEventAt} phase=${s.phase ?? "-"} streak=${s.streak ?? "-"}`);
}
console.log("\nfrontier now:", mastery.frontier().slice(0, 6).join(", "));
console.log("masteryFormsFor(first frontier):", JSON.stringify(mastery.masteryFormsFor(mastery.frontier()[0] ?? "")));
const anyOffer = graph.ids.filter((id) => mastery.testOutOffered(id));
console.log("testOutOffered count:", anyOffer.length, anyOffer.slice(0, 5).join(","));

console.log("\ngateDetail var-meaning:", JSON.stringify(mastery.gateDetail("var-meaning")));
const s = mastery.stateOf("var-meaning");
console.log("state:", JSON.stringify({p:s.p, scored:s.scored, atBand:s.atBand, forms:s.forms, fastUp:s.fastUpwardInWindow, attempts:s.attempts}));
console.log("bkt:", JSON.stringify(mastery.M.bkt));
console.log("theta:", mastery.theta);
