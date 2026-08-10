#!/usr/bin/env node
// Critic captures: real pixels at known simulation states.
import { openGame } from "../tools/lib/session.mjs";
import fs from "node:fs";

const setup = `
  window.__crit = (() => {
    const K = window.__vs.kernel, loco = K.get("locomotion");
    const STEP = 1/60;
    function yaw(){ const c=K.camera; c.updateMatrixWorld(); const e=c.matrixWorld.elements;
      const fx=-e[8], fz=-e[10]; return Math.hypot(fx,fz)<1e-4 ? (loco._lastBasisYaw||0) : Math.atan2(-fx,-fz); }
    function intent(wx,wz){ const l=Math.hypot(wx,wz)||1; wx/=l; wz/=l; const y=yaw(), s=Math.sin(y), c=Math.cos(y);
      loco.moveX = wx*c - wz*s; loco.moveY = -wx*s - wz*c; }
    return {
      reset(x,z,h){ loco.moveX=0;loco.moveY=0;loco.sprintHeld=false;loco.jumpHeld=false;loco.jumpBuffer=0;
        loco.teleport(x, 0.12+loco.tune.capsuleHeight/2+0.35, z, {heading:h||[0,-1]});
        for(let i=0;i<45;i++) K.advance(STEP); loco.velocity.set(0,0,0); },
      go(n, dir, sprint, render){ loco.sprintHeld=!!sprint;
        for(let i=0;i<n;i++){ if(dir) intent(dir[0],dir[1]); K.advance(STEP, {render: render!==false}); } },
      jump(){ loco._pressJump(); },
      state(){ const v=loco.velocity; return { y:loco.position.y, sp:Math.hypot(v.x,v.z), vy:v.y,
        grounded:loco.grounded, state:loco.state, airtime:loco.airtime, lean:loco.lean, push:loco.push,
        squash:loco.squash, slope:loco.slopeDeg }; },
    };
  })();
`;

const shots = [];
await openGame({ width: 1600, height: 900 }, async (d) => {
  await d.play(1.0);
  await d.run(new Function(setup));

  const cap = async (name, body) => {
    const st = await d.run(new Function(`return (${body})()`));
    await d.run(() => { for (let i = 0; i < 3; i++) window.__vs.kernel.advance(0, { render: true }); });
    await d.shoot(`review/shots/p04crit/${name}.png`);
    shots.push({ name, state: st });
    console.log(name, JSON.stringify(st));
  };

  await cap("a-sprint-run", `() => { __crit.reset(25, 14); __crit.go(150,[0,-1],true); return __crit.state(); }`);
  await cap("b-midair-rise", `() => { __crit.reset(25, 14); __crit.go(150,[0,-1],true); __crit.jump(); __crit.go(12,[0,-1],true); return __crit.state(); }`);
  await cap("c-midair-apex", `() => { __crit.reset(25, 14); __crit.go(150,[0,-1],true); __crit.jump(); __crit.go(22,[0,-1],true); return __crit.state(); }`);
  await cap("d-skid", `() => { __crit.reset(25, 14); __crit.go(150,[0,-1],true); __crit.go(5,[0,1],true); return __crit.state(); }`);
  await cap("e-carve", `() => { __crit.reset(25, 14); __crit.go(150,[0,-1],true); __crit.go(25,[1,0],true); return __crit.state(); }`);
  await cap("f-landing", `() => { __crit.reset(31, 33, [0,1]); __crit.go(6,[0,1],false); __crit.go(40,[0,1],false); return __crit.state(); }`);
  await cap("g-slope", `() => { __crit.reset(-14, -14); __crit.go(200,[0,-1],true); return __crit.state(); }`);
  await cap("h-runband-turn", `() => { __crit.reset(25, 14); __crit.go(150,[0,-1],false); __crit.go(14,[1,0],false); return __crit.state(); }`);

  const rep = await d.report();
  console.log("problems:", rep.errors.length, d.consoleErrors.length, d.failedRequests.length);
});
fs.writeFileSync("review/p04-critic-r2-shots.json", JSON.stringify(shots, null, 2));
