import { openGame } from "../tools/lib/session.mjs";
const fn = async () => {
  const K = window.__vs.kernel, loco = K.get("locomotion");
  const T = loco.tune, STEP = 1/60, R4 = v => Math.round(v*1e4)/1e4;
  const STAND = 0.12 + T.capsuleHeight/2 + 0.35;
  const sp = () => Math.hypot(loco.velocity.x, loco.velocity.z);
  function intent(wx,wz){const l=Math.hypot(wx,wz)||1;wx/=l;wz/=l;const c=K.camera;c.updateMatrixWorld();
    const e=c.matrixWorld.elements;const y=Math.atan2(e[8],e[10]);const s=Math.sin(y),co=Math.cos(y);
    loco.moveX=wx*co-wz*s;loco.moveY=-wx*s-wz*co;}
  function reset(){loco.moveX=0;loco.moveY=0;loco.sprintHeld=false;loco.walkHeld=false;loco.jumpHeld=false;loco.jumpBuffer=0;
    loco.teleport(0,STAND,6,{heading:[0,-1]});for(let i=0;i<45;i++)K.advance(STEP,{render:false});
    loco.velocity.set(0,0,0);for(let i=0;i<3;i++)K.advance(STEP,{render:false});}
  const res={};
  for (const band of ["run","sprint"]) {
    reset(); loco.sprintHeld = band==="sprint";
    for(let i=0;i<150;i++){intent(0,-1);K.advance(STEP,{render:false});}
    const v0=sp(); const rows=[]; let brakeSteps=0;
    for(let i=0;i<90;i++){
      const hx=loco.heading.x, hz=loco.heading.y;
      intent(-hz,hx);
      K.advance(STEP,{render:false});
      if(loco.braking) brakeSteps++;
      const v=loco.velocity; const s=Math.hypot(v.x,v.z);
      const lag = s>0.01 ? Math.acos(Math.max(-1,Math.min(1,(v.x*loco.heading.x+v.z*loco.heading.y)/s)))*180/Math.PI : 0;
      if(i%6===0) rows.push({i, sp:R4(s), lagDeg:R4(lag), braking:loco.braking, state:loco.state});
    }
    res[band]={v0:R4(v0), brakeSteps, finalSpeed:R4(sp()), rows};
  }
  return res;
};
const r = await openGame({width:900,height:600}, async d => await d.run(fn));
console.log(JSON.stringify(r,null,1));
