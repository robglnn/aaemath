// Can a pair of hands BUILD the objects the bank asks for? Offline, over every generate item.
// The planner replays the item's own committed witness through the act's PUBLIC input surface —
// the same acts a stick and four buttons produce — and the shipped checker marks the result.
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { VERBS } from "../../app/src/learn/verbs/Verbs.js";
import Forge from "../../app/src/learn/verbs/Forge.js";
import { ItemBank } from "../../app/src/learn/ItemBank.js";
import { R, isBundle, parseClaim } from "../../app/src/learn/verbs/Claim.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dir = path.join(ROOT, "content", "items", "bank");
let all = []; for (const f of fs.readdirSync(dir)) all = all.concat(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")).items);
const bank = new ItemBank();
const open = (it) => ({ itemId: it.id, kpId: it.kpId, form: it.form, stem: it.stem ?? "", given: it.given ?? [], working: it.working ?? [], unknown: it.unknown ?? "x", answerType: it.answerType ?? null, objectClass: it.objectClass ?? null });
const BARE = { held: new Set() };
const FINE = { held: new Set(["crouch"]) };

const tap = (act, dir, fine) => { if (fine) act.act("hold", FINE); act.fixed(1/60, { move: { x: 0, y: dir }, held: fine ? FINE.held : BARE.held }); act.fixed(1/60, { move: { x: 0, y: 0 }, held: BARE.held }); if (fine) act.act("release", BARE); };
const dial = (act, n, d) => {
  const cur = act.blank.n; const dir = n > cur ? 1 : -1;
  for (let i = 0; i < Math.abs(n - cur) && i < 220; i += 1) tap(act, dir, false);
  for (let i = 1; i < d && i < 14; i += 1) tap(act, 1, true);
};
const setKind = (act, v) => { const want = act.kinds.indexOf(v ?? null); if (want < 0) return false; let guard = 0; while (act.blank.kind % act.kinds.length !== want && guard++ < 20) act.act("stepNext", FINE); return true; };
const place = (act, t) => {
  if (isBundle(t)) {
    dial(act, t.k.n, t.k.d);
    act.act("take", FINE);              // second grip + near grip: strap a lock open
    for (const w of t.inner) place(act, w);
    act.act("take", FINE);              // strap it shut
    return;
  }
  if (!setKind(act, t.v)) return;
  dial(act, t.c.n, t.c.d);
  act.act("take", BARE);
};
const walk = (act, to) => { let guard = 0; while (act.station !== to && guard++ < 8) act.act("stepNext", BARE); };
const setRel = (act, rel) => { let guard = 0; while (act.rel !== rel && guard++ < 8) act.act("take", BARE); };

let n = 0, ok = 0; const miss = new Map();
for (const it of all) {
  let posed = null; for (const v of VERBS) { let a=null; try{a=v.pose(open(it));}catch{a=null;} if(a){posed={id:v.id,act:a};break;} }
  if (posed?.id !== "forge") continue;
  n += 1;
  const act = posed.act;
  const witness = it.answer?.tex ?? it.answer?.canonical ?? "";
  const claim = parseClaim(witness);
  let response = null;
  if (claim) {
    walk(act, 1); setRel(act, claim.rel ? ({ "=":"=", ">=":">=", "<=":"<=", ">":">", "<":"<" })[claim.rel] : null);
    walk(act, 0); for (const t of claim.near) place(act, t);
    if (claim.far) { walk(act, 2); for (const t of claim.far) place(act, t); }
    try { response = act.response(); } catch { response = null; }
  }
  let m = null; try { m = response ? bank.check(it, response) : null; } catch (e) { m = { correct: false, reason: String(e.message||e) }; }
  if (m?.correct) ok += 1;
  else {
    const k = `${it.kpId}|${it.check?.kind}`;
    if (!miss.has(k)) miss.set(k, { n: 0, s: `witness=${JSON.stringify(witness)} built=${JSON.stringify(response)} reason=${m?.reason}` });
    miss.get(k).n += 1;
  }
}
console.log(`forge posed ${n} · the committed witness is buildable by hand in ${ok} (${(ok/n*100).toFixed(1)}%)`);
for (const [k,v] of [...miss.entries()].sort((a,b)=>b[1].n-a[1].n).slice(0,14)) console.log(`  ${String(v.n).padStart(3)} ${k}\n      ${v.s}`);
