/**
 * END TO END on the SHIPPED path (RESUME 6b standing gate): does the measured probe leak convert
 * into an actual test-out unlock for a learner who does not know the node?
 *
 * Adversary: genuinely competent on band 1-2 (so it reaches the deeper frontier at all), and on
 * band >= 3 it types ONE memorised string per (kp x form) — the audit's own threat model — with
 * zero knowledge. Nothing is stubbed: real Scheduler.next()/submit(), real ItemBank, real check().
 */
import { readFileSync } from "node:fs";
import { Graph } from "../../app/src/learn/Graph.js";
import { Mastery } from "../../app/src/learn/Mastery.js";
import { Scheduler, mulberry32, virtualClock } from "../../app/src/learn/Scheduler.js";
import { itemBank } from "../../app/src/learn/ItemBank.js";
const R="C:/dev/math/aaemath/";
const GRAPH=new Graph(JSON.parse(readFileSync(R+"content/knowledge-graph.json","utf8")));
const AUDIT=JSON.parse(readFileSync(R+"app/src/learn/bank-audit.json","utf8"));
const N=Number((process.argv.find(a=>a.startsWith("--n="))??"--n=150").split("=")[1]);
const mark=(i,r)=>{try{return itemBank.check(i,r).correct===true;}catch{return false;}};
const spell=(i)=>{try{return itemBank.accepts(i)[0];}catch{return null;}};
const sig=x=>1/(1+Math.exp(-x));

// ---- the adversary's homework, computed once, on the first-encounter stream of each cell.
const clock0=virtualClock(0);
const m0=new Mastery(GRAPH,{bankAudit:AUDIT,storage:null,now:()=>clock0.minutes()});
const s0=new Scheduler(m0,{clock:clock0,rng:mulberry32(3),sessionMinutes:25,bank:itemBank});
const MEMO=new Map(); let seq=1;
for(const kp of GRAPH.ids){ if(!["distribute-variable","simplify-expression","ineq-negative-flip"].includes(kp)) continue;
 for(const form of ["construct","repair","generate"]){
  const items=[]; for(let i=0;i<70;i++){const s=s0.serve({kpId:kp,form,difficulty:m0.testOutDifficulty(kp),seq:seq++,avoidFamilies:m0.refusedFamilies(kp,form),avoidItemIds:[]},itemBank,{dry:true}); if(!s)break; items.push(s.item);}
  if(!items.length) continue;
  const cand=new Set(["0","1","x","always","none"]); for(const it of items){const s=spell(it); if(s!=null)cand.add(String(s));}
  let best=0,ans="0"; for(const c of cand){let h=0;for(const it of items)if(mark(it,c))h++; if(h>best){best=h;ans=c;}}
  MEMO.set(`${kp}|${form}`,ans);
 }}
console.log(`memorised ${MEMO.size} strings across band>=3 cells\n`);

const BYBAND={},PERKP={};
let offered=0,passed=0,unlocked=0,certifiedUnearned=0,runsWithUnlock=0,items=0;
const unlockedNodes=new Map();
for(let r=0;r<N;r++){
 const rng=mulberry32(90210+r*7919);
 const clock=virtualClock(0);
 const mastery=new Mastery(GRAPH,{bankAudit:AUDIT,storage:null,now:()=>clock.minutes()});
 const sch=new Scheduler(mastery,{clock,rng:mulberry32(r^0xabc),sessionMinutes:25,bank:itemBank});
 const GAP=new Set(["distribute-variable","simplify-expression","ineq-negative-flip"]); const easy=(kp)=>!GAP.has(kp);
 for(let s=0;s<26;s++){
  clock.set(s*1440); sch.beginSession();
  for(;;){ const req=sch.next(); if(!req) break; items++;
   let correct;
   if(easy(req.kpId)) correct = rng() < 0.05+0.95*sig(1.7*(2.2+(req.hinted?1.1:0)-req.difficulty));
   else { const a=MEMO.get(`${req.kpId}|${req.form}`); correct = req.item? mark(req.item,a??"0") : false; }
   sch.submit(req,{correct,latencyMs:4000+Math.floor(rng()*6000),hinted:req.hinted});
  }
  sch.endSession();
 }
 offered+=mastery.stats.testOutsOffered; passed+=mastery.stats.testOutsPassed;
 const via=GRAPH.ids.filter(id=>mastery.stateOf(id).unlockedVia==="test-out");
 const hard=via.filter(id=>GAP.has(id));
 unlocked+=hard.length; if(hard.length) runsWithUnlock++;
 for(const id of hard) unlockedNodes.set(id,(unlockedNodes.get(id)??0)+1);
 certifiedUnearned+=hard.filter(id=>mastery.status(id)==="mastered").length;
 for(const id of GRAPH.ids){const t=mastery.stateOf(id).testOut; if(!t) continue; const b=GRAPH.difficulty(id); BYBAND[b]??={off:0,pass:0}; BYBAND[b].off++; if(t.passed)BYBAND[b].pass++; PERKP[id]??={off:0,pass:0}; PERKP[id].off++; if(t.passed)PERKP[id].pass++;}
}
console.log(`${N} adversaries x 26 sessions, ${items} items answered on the shipped path`);
console.log(`probes offered ${offered}  passed ${passed}  (${(passed/Math.max(1,offered)).toExponential(3)} per offer)`);
console.log(`TEST-OUT UNLOCKS on band>=3 nodes the adversary does NOT know: ${unlocked}  (${runsWithUnlock}/${N} runs = ${(100*runsWithUnlock/N).toFixed(1)}% of adversaries)`);
console.log(`...of which went on to be CERTIFIED (mastered): ${certifiedUnearned}`);
console.log("offers by band:",JSON.stringify(BYBAND));
console.log("band>=3 per-kp offers/passes:",Object.entries(PERKP).filter(([k])=>["distribute-variable","simplify-expression","ineq-negative-flip"].includes(k)).map(([k,v])=>k+" "+v.off+"/"+v.pass).join(", "));
console.log(`nodes: ${[...unlockedNodes].map(([k,v])=>`${k}x${v}`).join(", ")||"(none)"}`);
