// Can the HANDS reach the right reading? Offline, over the whole committed bank.
// The answer key is used ONLY to mark the responses the hands produced — never as an input to them.
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { VERBS } from "../../app/src/learn/verbs/Verbs.js";
import { ItemBank } from "../../app/src/learn/ItemBank.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dir = path.join(ROOT, "content", "items", "bank");
let all = []; for (const f of fs.readdirSync(dir)) all = all.concat(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")).items);
const bank = new ItemBank();

const open = (it) => ({ itemId: it.id, kpId: it.kpId, form: it.form, stem: it.stem ?? "", given: it.given ?? [], working: it.working ?? [], unknown: it.unknown ?? "x", answerType: it.answerType ?? null, objectClass: it.objectClass ?? null });
const poseOf = (ctx) => { for (const v of VERBS) { let a=null; try{a=v.pose(ctx);}catch{a=null;} if(a) return {id:v.id, verb:v}; } return {id:null}; };

const ACTIONS = ["take","stepNext","stepPrev","back","take5","take10","dial"];
const HANDS = { held: new Set() };
const HANDS_FINE = { held: new Set(["crouch"]) };

function explore(verb, ctx, maxStates = 2500) {
  // Breadth-first over discrete acts. Continuous drive is the same act performed with the body,
  // so a discrete cover is a lower bound on what a pair of hands can reach.
  const seen = new Set();
  const responses = new Set();
  const queue = [[]];
  let states = 0;
  while (queue.length && states < maxStates) {
    const seq = queue.shift();
    let act = null;
    try { act = verb.pose(ctx); } catch { act = null; }
    if (!act) return responses;
    let ok = true;
    for (const s of seq) {
      try {
        if (s.fine) act.act("hold", HANDS_FINE);
        if (s.name === "take5" || s.name === "take10") {
          const n = s.name === "take5" ? 5 : 10;
          for (let i = 0; i < n; i += 1) act.act("take", s.fine ? HANDS_FINE : HANDS);
        } else if (s.name === "dial") {
          // The share dial is driven by the body at a Sill, not by a button. Walk it one notch.
          for (let i = 0; i < 24; i += 1) act.fixed?.(1 / 60, { move: { x: 0, y: 1 }, held: new Set() });
        } else act.act(s.name, s.fine ? HANDS_FINE : HANDS);
        if (s.fine) act.act("release", HANDS);
      } catch { ok = false; break; }
    }
    if (!ok) continue;
    states += 1;
    let sig = null;
    try { sig = JSON.stringify(act.state?.() ?? seq.length); } catch { sig = String(seq.length); }
    if (seen.has(sig)) continue;
    seen.add(sig);
    try { const r = act.response?.(); if (r) responses.add(r); } catch { /* */ }
    if (seq.length >= 7) continue;
    for (const name of ACTIONS) queue.push([...seq, { name }]);
    if (seq.length < 4) for (const name of ["take"]) queue.push([...seq, { name, fine: true }]);
  }
  return responses;
}

const only = process.argv[2] ?? null;
const rows = all.filter((i) => !only || i.form === only);
let posed = 0, reach = 0;
const missByCell = new Map();
const hitByVerb = new Map();
for (const it of rows) {
  const ctx = open(it);
  const { id, verb } = poseOf(ctx);
  if (!id) continue;
  posed += 1;
  const responses = explore(verb, ctx);
  let good = false;
  for (const r of responses) {
    let m = null; try { m = bank.check(it, r); } catch { m = null; }
    if (m?.correct) { good = true; break; }
  }
  if (good) { reach += 1; hitByVerb.set(id, (hitByVerb.get(id)??0)+1); }
  else {
    const k = `${id}|${it.kpId}|${it.form}|${it.answerType}`;
    if (!missByCell.has(k)) missByCell.set(k, { n: 0, sample: null });
    const e = missByCell.get(k); e.n += 1;
    if (!e.sample) e.sample = `stem=${JSON.stringify(it.stem)} working=${JSON.stringify(it.working)} ans=${JSON.stringify(it.answer.canonical)} got=${JSON.stringify([...responses].slice(0,4))}`;
  }
}
console.log(`posed ${posed} · a correct reading is reachable by hand in ${reach} (${(reach/posed*100).toFixed(1)}%)`);
console.log("reached, by verb:", JSON.stringify(Object.fromEntries([...hitByVerb.entries()].sort((a,b)=>b[1]-a[1]))));
console.log("\nnot reached:");
for (const [k,v] of [...missByCell.entries()].sort((a,b)=>b[1].n-a[1].n).slice(0,20)) console.log(`  ${String(v.n).padStart(3)} ${k}\n      ${v.sample}`);
