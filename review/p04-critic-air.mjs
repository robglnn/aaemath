// How much authority does the player have in the air? "Commitment" is a quality-bar word.
import { openGame } from "../tools/lib/session.mjs";

await openGame({ width: 800, height: 450 }, async (d) => {
  const out = await d.run(`(() => {
    const K = window.__vs.kernel; K.halt();
    const L = K.get("locomotion"), C = K.get("collision");
    const S = 1/60;
    const step = (n) => { const o=[]; for(let i=0;i<n;i++){ K.advance(S,{render:false});
      o.push({y:+L.position.y.toFixed(4), x:+L.position.x.toFixed(4), z:+L.position.z.toFixed(4),
              sp:+Math.hypot(L.velocity.x,L.velocity.z).toFixed(4), vz:+L.velocity.z.toFixed(4),
              vy:+L.velocity.y.toFixed(4), g:L.grounded}); } return o; };
    const intent = (x,y,o={}) => { L.externalInput=true; L.moveX=x; L.moveY=y; L.sprintHeld=!!o.sprint; };
    const deck = C.groundAt(0,0,400).y;
    const reset = () => { L.teleport(0, deck+0.93, 12, {heading:[0,-1]}); intent(0,0); step(12); };
    const R = {};

    // 1. standing jump, then full forward input in the air
    reset();
    L._pressJump(); step(1);
    intent(0, 1, {sprint:true});
    const a = step(60);
    R.standingJumpThenSteer = {
      speedAfter0_25s: a[14].sp, speedAfter0_5s: a[29].sp, peakAirSpeed: Math.max(...a.map(s=>s.sp)),
      horizontalTravelWhileAirborne: +Math.abs(a.filter(s=>!s.g).at(-1).z - 12).toFixed(3),
    };

    // 2. full sprint jump, then full REVERSE input in the air
    reset();
    intent(0,1,{sprint:true}); step(180);
    const entryVz = L.velocity.z;
    L._pressJump(); step(1);
    intent(0,-1,{sprint:true});
    const b = step(70);
    const air = b.filter(s=>!s.g);
    R.sprintJumpThenReverse = {
      entryVz:+entryVz.toFixed(3),
      vzAtLanding:+air.at(-1).vz.toFixed(3),
      reversedInAir: air.some(s=>s.vz>0),
      minAbsSpeedInAir:+Math.min(...air.map(s=>s.sp)).toFixed(3),
      airtimeSteps: air.length,
    };

    // 3. sprint jump with NO air input: how far does momentum carry?
    reset();
    intent(0,1,{sprint:true}); step(180);
    L._pressJump(); step(1);
    intent(0,0);
    const c = step(70);
    const cair = c.filter(s=>!s.g);
    R.sprintJumpNoInput = {
      distance:+Math.abs(cair.at(-1).z - c[0].z).toFixed(3),
      speedKept:+cair.at(-1).sp.toFixed(3),
    };

    // 4. downhill: does gravity give you anything back?
    // run down the 30 deg ramp from the terrace
    L.teleport(-0.4, 3.12+0.93+0.2, 29, {heading:[0,-1]});
    intent(0,0); step(20);
    intent(0,1,{sprint:true});
    const dsteps = step(150);
    R.downhill = {
      maxSpeed:+Math.max(...dsteps.map(s=>s.sp)).toFixed(3),
      speedOnRamp: dsteps.slice(20,50).map(s=>s.sp).reduce((p,q)=>p+q,0)/30,
      endedY: dsteps.at(-1).y,
    };

    // 5. does a landing actually cost anything at sprint from a big drop?
    L.teleport(0, deck+12, 12, {heading:[0,-1]});
    intent(0,1,{sprint:true});
    const e = step(150);
    const landIdx = e.findIndex((s,i)=> i>5 && s.g);
    R.hardLanding = {
      impact: L.lastLand.impact, severity: L.lastLand.severity,
      speedJustBefore: e[landIdx-1].sp, speedJustAfter: e[landIdx].sp,
      speedRecoveredAfter0_5s: e[Math.min(landIdx+30, e.length-1)].sp,
      landLockSeconds: +(L.tune.landLockMin + (L.tune.landLockMax-L.tune.landLockMin)*L.lastLand.severity).toFixed(3),
    };
    return R;
  })()`);
  console.log(JSON.stringify(out, null, 2));
});
