import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { VERBS } from "../../app/src/learn/verbs/Verbs.js";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
let all=[]; for (const f of fs.readdirSync(path.join(ROOT,"content/items/bank"))) all=all.concat(JSON.parse(fs.readFileSync(path.join(ROOT,"content/items/bank",f),"utf8")).items);
const open=(it)=>({itemId:it.id,kpId:it.kpId,form:it.form,stem:it.stem??"",given:it.given??[],working:it.working??[],unknown:it.unknown??"x",answerType:it.answerType??null,objectClass:it.objectClass??null});
const posed=(ctx)=>{for(const v of VERBS){let a=null;try{a=v.pose(ctx);}catch{a=null;} if(a)return v.id;}return null;};
const groups=new Map();
for(const it of all){ if(posed(open(it)))continue; const k=`${it.kpId}|${it.form}|${it.answerType}`; if(!groups.has(k))groups.set(k,[]); groups.get(k).push(it); }
for(const [k,v] of [...groups.entries()].sort((a,b)=>b[1].length-a[1].length)){
  const it=v[0];
  console.log(`${String(v.length).padStart(3)} ${k}\n     working=${JSON.stringify(it.working)} given=${JSON.stringify(it.given)} stem=${JSON.stringify(it.stem)} ans=${JSON.stringify(it.answer.canonical)}`);
}
