#!/usr/bin/env node
// P04 critic, pass 6 — can the jump button cancel the controller's commitments?
// The bar: "every action has a start, a commitment and a recovery". This asks whether the two
// costs the model does charge (the reversal skid, the landing lock) can be bought out with Space.
import { openGame } from "../tools/lib/session.mjs";
import fs from "node:fs";

const fn = async () => {
  const vs = window.__vs, K = vs.kernel, loco = K.get("locomotion");
  const T = loco.tune, STEP = 1 / 60;
  const R4 = (v) => Math.round(v * 1e4) / 1e4;
  const STAND = 0.12 + T.capsuleHeight / 2 + 0.35;
  const sp = () => Math.hypot(loco.velocity.x, loco.velocity.z);
  function intent(wx, wz) {
    const l = Math.hypot(wx, wz) || 1; wx /= l; wz /= l;
    const cam = K.camera; cam.updateMatrixWorld();
    const e = cam.matrixWorld.elements;
    const y = Math.atan2(e[8], e[10]); const s = Math.sin(y), c = Math.cos(y);
    loco.moveX = wx * c - wz * s; loco.moveY = -wx * s - wz * c;
  }
  function reset(x, z, y = STAND) {
    loco.moveX = 0; loco.moveY = 0; loco.sprintHeld = false; loco.walkHeld = false;
    loco.jumpHeld = false; loco.jumpBuffer = 0;
    loco.teleport(x, y, z, { heading: [0, -1] });
    for (let i = 0; i < 45; i++) K.advance(STEP, { render: false });
    loco.velocity.set(0, 0, 0);
    for (let i = 0; i < 3; i++) K.advance(STEP, { render: false });
  }
  const out = {};

  // ---- 1. skid cancelled by a jump -------------------------------------------------------
  function reversal(jumpAfterSkidSteps) {
    reset(0, 8);
    loco.sprintHeld = true;
    for (let i = 0; i < 150; i++) { intent(0, -1); K.advance(STEP, { render: false }); }
    const v0 = sp(), z0 = loco.position.z;
    let n = 0, skid = 0, minZ = z0, tRev = null, tFull = null, jumped = false;
    while (n < 240) {
      intent(0, 1);
      if (jumpAfterSkidSteps !== null && skid === jumpAfterSkidSteps && !jumped) {
        loco._pressJump(); jumped = true;
      }
      K.advance(STEP, { render: false }); n++;
      if (loco.braking) skid++;
      minZ = Math.min(minZ, loco.position.z);
      if (tRev === null && loco.velocity.z > 0.2) tRev = n / 60;
      if (tRev !== null && tFull === null && loco.velocity.z > v0 * 0.9) { tFull = n / 60; break; }
    }
    return { jumpAfterSkidSteps, v0: R4(v0), skidSteps: skid, overshoot: R4(z0 - minZ),
      timeToReverse: tRev && R4(tRev), timeToFullSpeedBack: tFull && R4(tFull) };
  }
  out.skidNoJump = reversal(null);
  out.skidJump1 = reversal(1);
  out.skidJump3 = reversal(3);

  // ---- 2. landing lock cancelled by a buffered jump ---------------------------------------
  function landing(bufferJump) {
    reset(0, 8);
    // sprint up to speed then teleport high while keeping velocity
    loco.sprintHeld = true;
    for (let i = 0; i < 150; i++) { intent(0, -1); K.advance(STEP, { render: false }); }
    const vx = loco.velocity.x, vz = loco.velocity.z;
    loco.teleport(0, STAND + 12, 20, { heading: [0, -1] });
    loco.velocity.set(vx, 0, vz);
    loco.takeoffSpeed = Math.hypot(vx, vz);
    loco.takeoffDir.set(vx / loco.takeoffSpeed, vz / loco.takeoffSpeed);
    let air = 0;
    while (!loco.grounded && air < 400) { intent(0, -1); K.advance(STEP, { render: false }); air++; }
    const impact = loco.lastLand.impact, sev = loco.lastLand.severity;
    const lock = loco.landLock, speedAfterLand = sp();
    let jumpHeight = null, jumpAt = null;
    if (bufferJump) {
      loco._pressJump();
      const y0 = loco.position.y;
      let apex = y0;
      for (let i = 0; i < 120; i++) {
        intent(0, -1); K.advance(STEP, { render: false });
        if (!loco.grounded) apex = Math.max(apex, loco.position.y);
        else if (i > 3) break;
      }
      jumpHeight = R4(apex - y0);
      jumpAt = R4(loco.lastJump.at);
    }
    // how long until horizontal authority is back
    let recover = null;
    for (let i = 0; i < 120; i++) {
      intent(0, -1); K.advance(STEP, { render: false });
      if (sp() >= T.sprintSpeed * 0.98) { recover = R4((i + 1) / 60); break; }
    }
    return { impact, severity: sev, landLock: R4(lock), speedAfterLand: R4(speedAfterLand),
      jumpHeightOutOfLanding: jumpHeight, recoverSeconds: recover, finalSpeed: R4(sp()) };
  }
  out.landNoJump = landing(false);
  out.landJump = landing(true);

  // ---- 3. can the jump fire while the landing lock is running? ----------------------------
  {
    reset(0, 8);
    loco.teleport(0, STAND + 12, 8, { heading: [0, -1] });
    while (!loco.grounded) K.advance(STEP, { render: false });
    const lock = loco.landLock;
    loco._pressJump();
    K.advance(STEP, { render: false });
    out.jumpDuringLandLock = { landLockWas: R4(lock), vyAfterPress: R4(loco.velocity.y),
      jumpSpeedTuned: T.jumpSpeed, fired: loco.velocity.y > T.jumpSpeed * 0.9 };
  }

  // ---- 4. can the jump fire while the skid is running? ------------------------------------
  {
    reset(0, 8);
    loco.sprintHeld = true;
    for (let i = 0; i < 150; i++) { intent(0, -1); K.advance(STEP, { render: false }); }
    intent(0, 1); K.advance(STEP, { render: false });
    intent(0, 1); K.advance(STEP, { render: false });
    const braking = loco.braking, spBefore = sp();
    loco._pressJump();
    intent(0, 1); K.advance(STEP, { render: false });
    out.jumpDuringSkid = { wasBraking: braking, speedBefore: R4(spBefore),
      vyAfter: R4(loco.velocity.y), fired: loco.velocity.y > T.jumpSpeed * 0.9,
      speedAfter: R4(sp()) };
  }

  // ---- 5. bunny hop: hold jump forever, does anything ever cost? ---------------------------
  {
    reset(0, 8);
    loco.sprintHeld = true;
    let hops = 0, minSpeed = Infinity, groundedSteps = 0;
    for (let i = 0; i < 600; i++) {
      loco._pressJump();
      intent(0, -1);
      K.advance(STEP, { render: false });
      if (loco.grounded) groundedSteps++;
      if (loco.lastJump.at !== undefined && loco._liftoff) hops++;
      if (i > 120) minSpeed = Math.min(minSpeed, sp());
    }
    out.bunnyHop = { hops, groundedStepsOf600: groundedSteps, minSpeedAfterSettle: R4(minSpeed),
      finalSpeed: R4(sp()), sprintSpeed: T.sprintSpeed };
  }

  // ---- 6. exact walk-up ledge limit, on a purpose-built collider ---------------------------
  {
    const THREE = loco.root.constructor === undefined ? null : null;
    out.stepLimit = { note: "measured on the proving ground stair flights only", tuned: T.stepHeight };
  }
  return out;
};

const res = await openGame({ width: 1280, height: 720 }, async (d) => ({
  errors: d.consoleErrors, out: await d.run(fn),
}));
fs.writeFileSync("review/p04-critic-r2f.json", JSON.stringify(res, null, 2));
const o = res.out;
const L = (k, v) => console.log(String(k).padEnd(22), JSON.stringify(v));
console.log("errors:", res.errors.length);
console.log("\n-- reversal skid, with and without a jump --");
L("no jump", o.skidNoJump); L("jump @skid step1", o.skidJump1); L("jump @skid step3", o.skidJump3);
console.log("\n-- 12 m landing --");
L("no jump", o.landNoJump); L("buffered jump", o.landJump);
console.log("\n-- gates --");
L("jump during landLock", o.jumpDuringLandLock);
L("jump during skid", o.jumpDuringSkid);
L("bunny hop", o.bunnyHop);
