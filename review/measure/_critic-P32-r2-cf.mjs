// Counterfactual: same replay, but ask the bank for the node's OWN tier (correct units).
import { readFileSync } from "node:fs";
import { Graph } from "../../app/src/learn/Graph.js";
import { Mastery } from "../../app/src/learn/Mastery.js";
import { Scheduler, mulberry32, virtualClock } from "../../app/src/learn/Scheduler.js";
import { itemBank } from "../../app/src/learn/ItemBank.js";
const GRAPH = new Graph(JSON.parse(readFileSync("C:/dev/math/aaemath/content/knowledge-graph.json","utf8")));
const AUDIT = JSON.parse(readFileSync("C:/dev/math/aaemath/app/src/learn/bank-audit.json","utf8"));
const clock = virtualClock(0);
const m = new Mastery(GRAPH,{bankAudit:AUDIT,storage:null,now:()=>clock.minutes()});
const sch = new Scheduler(m,{clock,rng:mulberry32(7),sessionMinutes:25,bank:itemBank});
const mark=(i,r)=>{try{return itemBank.check(i,r).correct===true;}catch{return false;}};
const spell=(i)=>{try{return itemBank.accepts(i)[0];}catch{return null;}};
let seq=1;
const draw=(kp,f,d,ex)=>sch.serve({kpId:kp,form:f,difficulty:d,seq:seq++,avoidFamilies:m.refusedFamilies(kp,f),avoidItemIds:[...ex]},itemBank,{dry:true});
function memo(kp,f,d){const it=[],ex=new Set();for(let i=0;i<80;i++){const s=draw(kp,f,d,ex);if(!s)break;it.push(s.item);}
 if(!it.length)return{answer:"0",rate:0};const c=new Set(["0","1","x","always","none"]);for(const x of it){const s=spell(x);if(s!=null)c.add(String(s));}
 let b=0,a="0";for(const s of c){let h=0;for(const x of it)if(mark(x,s))h++;if(h>b){b=h;a=s;}}return{answer:a,rate:b/it.length};}
const TRIALS=2000;
const targets=["distribute-variable","ineq-negative-flip","simplify-expression","eq-distribute","props-equality","eval-formula","var-meaning"];
console.log("kp".padEnd(23)+"probeLogit->tier   nodeTier   measured@shippedDiff  measured@nodeTier   priced");
for(const kp of targets){
 const plan=m.testOutPlan(kp); if(!plan.eligible) continue;
 const shippedD=m.testOutDifficulty(kp), nodeD=GRAPH.difficulty(kp);
 const out=[];
 for(const d of [shippedD,nodeD]){
  const M=new Map(); for(const f of new Set(plan.forms)) M.set(f,memo(kp,f,d));
  let pass=0;
  for(let t=0;t<TRIALS;t++){const ex=new Set();let ok=true;
   for(const f of plan.forms){const s=draw(kp,f,d,ex);if(!s){ok=false;break;}ex.add(s.item.id);if(!mark(s.item,M.get(f).answer)){ok=false;break;}}
   if(ok)pass++;}
  out.push(pass/TRIALS);
 }
 console.log(`${kp.padEnd(23)}${String(shippedD).slice(0,5).padEnd(6)}->${String(Math.max(1,Math.min(5,Math.round(shippedD)))).padEnd(11)}${String(nodeD).padEnd(11)}${out[0].toExponential(3).padEnd(22)}${out[1].toExponential(3).padEnd(20)}${plan.blindPass.toExponential(2)}`);
}
