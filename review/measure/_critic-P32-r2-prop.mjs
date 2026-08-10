/** Propagation attack with a POSITIVE CONTROL: hammer leaves only, watch the whole ancestor cone. */
import { readFileSync } from "node:fs";
import { Graph } from "../../app/src/learn/Graph.js";
import { Mastery, PROPAGATION } from "../../app/src/learn/Mastery.js";
import { virtualClock } from "../../app/src/learn/Scheduler.js";
const R="C:/dev/math/aaemath/";
const GRAPH=new Graph(JSON.parse(readFileSync(R+"content/knowledge-graph.json","utf8")));
const AUDIT=JSON.parse(readFileSync(R+"app/src/learn/bank-audit.json","utf8"));

const deep=[...GRAPH.ids].sort((a,b)=>GRAPH.depth(b)-GRAPH.depth(a)).slice(0,3);
console.log("hammered leaves:",deep.join(", "),"| their ancestor cones:",deep.map(d=>GRAPH.ancestorDistances(d).size).join("/"));

const scenarios={
 "A. engine default (direct prereqs)":            null,
 "B. declare ALL 31 other nodes":                 (id)=>GRAPH.ids.filter(x=>x!==id),
 "C. declare DESCENDANTS only":                   (id)=>[...GRAPH.descendants(id)],
 "D. declare the whole ancestor cone at once":    (id)=>[...GRAPH.ancestorDistances(id).keys()],
 "E. alternate correct/incorrect (BKT ratchet)":  (id)=>[...GRAPH.ancestorDistances(id).keys()],
 "F. ceiling REMOVED (my own leak control)":      (id)=>[...GRAPH.ancestorDistances(id).keys()],
};
for(const [name,fn] of Object.entries(scenarios)){
 const clock=virtualClock(0);
 const opts={bankAudit:AUDIT,storage:null,now:()=>clock.minutes()};
 if(name.startsWith("F.")) opts.propagation={ceiling:1};
 const m=new Mastery(GRAPH,opts);
 const cone=new Set(); for(const d of deep) for(const a of GRAPH.ancestorDistances(d).keys()) cone.add(a);
 for(const d of deep) cone.delete(d);
 let t=0;
 for(let i=0;i<6000;i++){
  const src=deep[i%deep.length];
  const forms=m.deliverableMasteryForms(src); if(!forms.length) continue;
  const form=forms[i%forms.length];
  const fam=Object.entries(m.cell(src,form)?.families??{}).find(([,r])=>r.priceable)?.[0]??null;
  clock.set(t+=3);
  const correct = name.startsWith("E.") ? (i%2===0) : true;
  m.respond({kpId:src,form,phase:"solo",difficulty:GRAPH.centre(src)+0.3,mode:"acquire",correct,latencyMs:6000,hinted:false,family:fam,...(fn?{exercises:fn(src)}:{})});
 }
 const untouched=[...cone].filter(id=>m.stateOf(id).scored===0&&m.stateOf(id).attempts===0);
 const maxP=untouched.length?Math.max(...untouched.map(id=>m.stateOf(id).p)):0;
 const moved=untouched.filter(id=>m.stateOf(id).p>GRAPH.band(id).prior+1e-9).length;
 const cert=untouched.filter(id=>m.status(id)!=="learning");
 const counters=untouched.filter(id=>(m.stateOf(id).scored??0)>0||(m.stateOf(id).atBand??0)>0||(m.stateOf(id).forms?.size??0)>0);
 const offered=untouched.filter(id=>m.testOutOffered(id));
 console.log(`${name.padEnd(46)} cone=${String(untouched.length).padEnd(3)} moved=${String(moved).padEnd(3)} maxP=${maxP.toFixed(4)} certified=${cert.length} counters=${counters.length} probeOffers=${offered.length} offCone=${m.stats.offConeSeeds} ceilingHits=${m.stats.ceilingHits}`);
}
