import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Graph } from "./app/src/learn/Graph.js";
import { Mastery } from "./app/src/learn/Mastery.js";
import { Scheduler } from "./app/src/learn/Scheduler.js";
import { Session } from "./app/src/flow/Session.js";
const root = "C:/dev/math/aaemath";
const readJson = (p) => JSON.parse(readFileSync(resolve(root, p), "utf8"));
const graphSource = readJson("content/knowledge-graph.json");
const bankAudit = readJson("app/src/learn/bank-audit.json");
function mulberry32(seed){let a=seed>>>0;return function(){a=(a+0x6d2b79f5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return ((t^(t>>>14))>>>0)/4294967296;};}
const clamp=(v,lo,hi)=>(v<lo?lo:v>hi?hi:v);
function lognormal(rng,s){const u1=Math.max(1e-9,rng());const u2=rng();const z=Math.sqrt(-2*Math.log(u1))*Math.cos(2*Math.PI*u2);return Math.exp(s*z-(s*s)/2);}
const PHASE_WORK={model:0.55,"guided-1":0.8,"guided-2":0.85,"guided-3":1.15,solo:1.0};
const arch={id:"steady",medianSeconds:26,sigma:0.45,ability:0.5};
function itemLatencyMs(a,req,rng){const w=PHASE_WORK[req.phase]??1;const hard=clamp(1+0.22*(req.difficulty+0.8),0.5,2.2);let s=a.medianSeconds*w*hard*lognormal(rng,a.sigma);if(rng()<0.08)s*=2.4;return Math.round(clamp(s,1.5,420)*1000);}
const gapMs=(rng)=>Math.round(2500+3500*rng());

const miss = new Map();
for (let seed=1; seed<=8; seed++) {
  const rng=mulberry32(seed);
  const t={ms:Date.UTC(2026,1,2,16,30,0)};
  const graph=new Graph(graphSource);
  const clock={minutes:()=>t.ms/60000,advance(){},real:true};
  const mastery=new Mastery(graph,{now:()=>t.ms/60000,storage:null,emit:()=>{},bankAudit});
  const scheduler=new Scheduler(mastery,{clock,seed:seed^0x5eed,sessionMinutes:25});
  const learning={mastery,scheduler,graph,beginSession:()=>scheduler.beginSession(),endSession:()=>scheduler.endSession()};
  for(let n=0;n<10;n++){
    t.ms+=Math.round((20+8*rng())*3600*1000);
    const session=new Session({learning,now:()=>t.ms,emit:()=>{}});
    session.begin();
    for(let g=0;g<600;g++){
      const fc = session._nextForecast;
      const req=session.next();
      if(!req)break;
      if(fc && session.beat && session.beat.served===1){
        const ok = fc.kind===req.mode && fc.kpId===req.kpId;
        if(!ok){
          const key=`${fc.kind}->${req.mode}` + (fc.kind===req.mode? " (same kind, wrong node)":"");
          miss.set(key,(miss.get(key)??0)+1);
          if(fc.kind==="consolidate"&&req.mode==="acquire"&&(miss.get("SHOWN")??0)<6){
            miss.set("SHOWN",(miss.get("SHOWN")??0)+1);
            const w=session.candidates();
            console.log("MISS", "fc",JSON.stringify(fc), "got",req.mode,req.kpId,
              "| sch items",scheduler.itemsThisSession,"rev",scheduler.reviewItemsThisSession,
              "| sess items",session.itemsServed,"eventItems",session.beats.filter(b=>b.kind!=="acquire").reduce((a,b)=>a+b.served,0),
              "| dueHead",w.due[0]&&w.due[0].kind+"/"+w.due[0].kpId,"acq",w.acquire.length,
              "| schEvent",JSON.stringify(scheduler.probe().event),
              "| schDue",JSON.stringify(scheduler._dueQueue(clock.minutes()).slice(0,3)),
              "| myDue",JSON.stringify(w.due.slice(0,3)),
              "| st",JSON.stringify(mastery.stateOf("var-meaning").status),
              mastery.stateOf("var-meaning").nextEventAt, clock.minutes(), mastery.now(),
              "| probe",JSON.stringify(scheduler.probe().probe));
          }
        }
      }
      const lat=itemLatencyMs(arch,req,rng); t.ms+=lat;
      session.submit(req,{correct:rng()<1/(1+Math.exp(-(arch.ability-req.difficulty))),latencyMs:lat,itemId:`${req.kpId}#${req.seq}`,hinted:req.hinted});
      t.ms+=gapMs(rng);
    }
  }
}
console.log([...miss.entries()].sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}=${v}`).join("\n"));
