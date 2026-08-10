import { readFileSync } from "node:fs";
import { Graph } from "../../app/src/learn/Graph.js";
import { Mastery } from "../../app/src/learn/Mastery.js";
import { Scheduler } from "../../app/src/learn/Scheduler.js";
import { Session } from "../../app/src/flow/Session.js";
import { Save, SAVE_KEY } from "../../app/src/flow/Save.js";
const rj=(p)=>JSON.parse(readFileSync(new URL("../../"+p,import.meta.url),"utf8"));
class Mem{constructor(){this.m=new Map()}getItem(k){return this.m.has(k)?this.m.get(k):null}setItem(k,v){this.m.set(k,String(v))}removeItem(k){this.m.delete(k)}}
const store=new Mem();
const t={ms:Date.UTC(2026,2,3,15,0,0)};
function world(){const g=new Graph(rj("content/knowledge-graph.json"));
 const m=new Mastery(g,{now:()=>t.ms/60000,storage:null,emit:()=>{},bankAudit:rj("app/src/learn/bank-audit.json")});
 const sch=new Scheduler(m,{clock:{minutes:()=>t.ms/60000,advance(){},real:true},seed:7,sessionMinutes:25});
 return {g,m,sch,learning:{mastery:m,scheduler:sch,graph:g,next:()=>sch.next(),submit:(r,o)=>sch.submit(r,o),beginSession:()=>sch.beginSession(),endSession:()=>sch.endSession()}};}

// ---------- PAGE LOAD 1: run to ~minute 12, then KILL (no close) ----------
const w1=world(); const save1=new Save({storage:store,now:()=>t.ms}); save1.load();
const s1=new Session({learning:w1.learning,save:save1,now:()=>t.ms,emit:()=>{}}); s1.begin();
let n=0;
while(s1.elapsedSeconds<12*60){const req=s1.next(); if(!req)break; t.ms+=30000; s1.submit(req,{correct:true,latencyMs:30000,itemId:`x${n}`,hinted:req.hinted}); t.ms+=3000; n++;}
console.log(`PAGE 1 killed at ${(s1.elapsedSeconds/60).toFixed(2)} min, ${n} items, phase=${s1.phase}, rho=${s1.pace.ratio.toFixed(3)}`);
const rawAfterKill=store.getItem(SAVE_KEY);
console.log("  save blob keys:", Object.keys(JSON.parse(rawAfterKill)).join(","));
console.log("  live record:", JSON.stringify(JSON.parse(rawAfterKill).live ?? JSON.parse(rawAfterKill).session ?? null).slice(0,240));

// ---------- PAGE LOAD 2: fresh objects, same storage ----------
t.ms += 30*1000; // 30 seconds later — a crash and an immediate reload
const w2=world(); const save2=new Save({storage:store,now:()=>t.ms}); const load=save2.load();
console.log(`PAGE 2 load(): fault=${load.fault} interrupted=${JSON.stringify(load.interrupted)}`);
const s2=new Session({learning:w2.learning,save:save2,now:()=>t.ms,emit:()=>{}}); s2.begin();
console.log(`  resumed pace rho=${s2.pace.ratio.toFixed(3)} samples=${s2.pace.samples}  (page1 ended rho=${s1.pace.ratio.toFixed(3)} samples=${s1.pace.samples})`);
console.log(`  new arc elapsed at open = ${(s2.elapsedSeconds/60).toFixed(2)} min ; plan minutes=${s2.plan.minutes}`);
let n2=0; while(true){const req=s2.next(); if(!req)break; t.ms+=30000; s2.submit(req,{correct:true,latencyMs:30000,itemId:`y${n2}`,hinted:req.hinted}); t.ms+=3000; n2++;}
console.log(`  PAGE 2 sitting ran ${(s2.elapsedSeconds/60).toFixed(2)} min, ${n2} items, close=${s2.closeReason}`);
console.log(`  >>> TOTAL uninterrupted work across the reload: ${((s1.elapsedSeconds+s2.elapsedSeconds)/60).toFixed(2)} min of a 15-25 promise`);

// ---------- repeated reload abuse ----------
let tot=s1.elapsedSeconds/60; let cycles=1;
for(let i=0;i<4;i++){
  const w=world(); const sv=new Save({storage:store,now:()=>t.ms}); sv.load();
  const s=new Session({learning:w.learning,save:sv,now:()=>t.ms,emit:()=>{}}); s.begin();
  while(s.elapsedSeconds<12*60){const req=s.next(); if(!req)break; t.ms+=30000; s.submit(req,{correct:true,latencyMs:30000,itemId:`z${i}`,hinted:req.hinted}); t.ms+=3000;}
  tot+=s.elapsedSeconds/60; cycles++;
}
console.log(`\nRELOAD ABUSE: ${cycles} kills at minute 12 -> ${tot.toFixed(1)} minutes of continuous work, no break ever offered.`);

// ---------- corrupt the save ----------
console.log("\nCORRUPTION:");
for (const [name, blob] of [
  ["truncated json", '{"version":1,"pace":{"ratio":0.7'],
  ["wrong version", JSON.stringify({version:99,pace:{ratio:1}})],
  ["hostile pace", JSON.stringify({version:1,pace:{ratio:-5,spread:NaN,gapSeconds:1e9,samples:-3,slowRatio:0},sessions:[]})],
  ["pace is a string", JSON.stringify({version:1,pace:"nope",sessions:"nope"})],
  ["huge ratio", JSON.stringify({version:1,pace:{ratio:1e9,spread:1e9,gapSeconds:0,samples:5,slowRatio:1e9},sessions:[]})],
]) {
  store.setItem(SAVE_KEY, blob);
  const w=world(); const sv=new Save({storage:store,now:()=>t.ms}); const L=sv.load();
  const s=new Session({learning:w.learning,save:sv,now:()=>t.ms,emit:()=>{}});
  let out="";
  try { s.begin();
    let k=0; while(k<400){const req=s.next(); if(!req)break; t.ms+=25000; s.submit(req,{correct:true,latencyMs:25000,itemId:`c${k}`,hinted:req.hinted}); t.ms+=3000; k++;}
    if(s.phase!=="closed") s.close("g");
    out=`ran ${(s.elapsedSeconds/60).toFixed(2)} min, ${k} items, close=${s.closeReason}`;
  } catch(e){ out="THREW: "+e.message; }
  console.log(`  ${name.padEnd(18)} fault=${String(L.fault).padEnd(16)} repaired=${JSON.stringify(L.repaired??null).padEnd(24)} -> ${out}`);
}
