#!/usr/bin/env node
/**
 * Independent critic probe for P30 round 2. Regenerates every measurement from the shipped module.
 * No browser: every number here is derived from the real AutoTier/Config/Lighting source.
 */
globalThis.window = globalThis;
globalThis.location = { search: "" };
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.devicePixelRatio = 1;
globalThis.innerWidth = 1366;
globalThis.innerHeight = 768;

const { TierPolicy, POLICY, startingTier, AutoTier, NEUTRAL_START } = await import(
  new URL("../../app/src/core/AutoTier.js", import.meta.url).href
);
const { config, TIERS, TIER_ORDER } = await import(new URL("../../app/src/core/Config.js", import.meta.url).href);

const line = (s) => console.log(s);
const hdr = (s) => console.log(`\n=== ${s} ===`);

/* --------------------------------------------------------------- X1: what a tier step really moves */
hdr("X1  the actual runtime renderer delta of each tier, at the DPR school hardware reports");
// Lighting.js:322/337 — the shipped clamp on what the rig actually builds.
const builtCascades = (t) => Math.max(1, Math.min(2, TIERS[t].shadowCascades ?? 1));
const builtRes = (t) => Math.min(2048, Math.max(1024, TIERS[t].shadowResolution));
for (const dpr of [1, 1.5, 2]) {
  const rows = TIER_ORDER.map((t) => {
    const pr = Math.min(dpr, TIERS[t].maxPixelRatio);
    return `${t}: dpr ${pr} (${Math.round(1366 * pr)}x${Math.round(768 * pr)} = ${((1366 * pr * 768 * pr) / 1e6).toFixed(2)} MP) | shadow ${builtRes(t)}² x${builtCascades(t)} | post ${TIERS[t].postStack.length}`;
  });
  line(`devicePixelRatio ${dpr}:`);
  rows.forEach((r) => line(`   ${r}`));
}
line("");
line("TIER TABLE says high = 3072² x3; Lighting.js clamps to " + builtRes("high") + "² x" + builtCascades("high"));
line("=> high and medium build IDENTICAL shadow rigs: " + (builtRes("high") === builtRes("medium") && builtCascades("high") === builtCascades("medium")));
line("=> at devicePixelRatio 1 the pixel-ratio ladder is flat: " +
  JSON.stringify(TIER_ORDER.map((t) => Math.min(1, TIERS[t].maxPixelRatio))));

/* ------------------------------------------- X2: which tier fields reach the renderer after boot */
hdr("X2  tier fields carried by the quality:tier signal vs. fields anything re-reads");
const { signals } = await import(new URL("../../app/src/core/Signals.js", import.meta.url).href);
line(`signals.names() at import time: ${JSON.stringify(signals.names())}`);
line("Static grep result (recorded separately): zero subscribers to 'quality:tier' anywhere in app/src.");
line("Fields emitted but applied by nobody after boot: drawDistance, grassDensity, particleBudget, shadowCascades.");

/* ----------------------------------------------------- X3: forced oscillation, adversarial fuzz */
hdr("X3  forced oscillation — 600 randomised adversarial alternating streams");
let worstUps = 0, worstChanges = 0, anyUpAfterDown = 0, oscillations = 0;
const rnd = (s) => { let x = s; return () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); };
for (let seed = 1; seed <= 600; seed++) {
  const r = rnd(seed);
  const start = TIER_ORDER[1 + Math.floor(r() * 4)];
  const p = new TierPolicy(start, { ceiling: "ultra" });
  const fast = 4 + r() * 12;         // 4-16 ms
  const slow = 22 + r() * 200;       // 22-222 ms
  const period = 20 + Math.floor(r() * 900);
  let phase = 0;
  for (let i = 0; i < 8000; i++) {
    if (i % period === 0) phase ^= 1;
    p.sample(phase ? slow : fast);
  }
  const dirs = p.changes.map((c) => c.direction);
  const ups = dirs.filter((d) => d === "up").length;
  worstUps = Math.max(worstUps, ups);
  worstChanges = Math.max(worstChanges, p.changes.length);
  const firstDown = dirs.indexOf("down");
  if (firstDown >= 0 && dirs.slice(firstDown).includes("up")) anyUpAfterDown++;
  // a reversal of any kind = the picture moved back the way it came
  for (let i = 1; i < dirs.length; i++) if (dirs[i] !== dirs[i - 1]) oscillations++;
}
line(`max up-steps in any stream: ${worstUps} (budget ${POLICY.maxUpSteps})`);
line(`max total changes in any stream: ${worstChanges} (budget ${POLICY.maxChanges})`);
line(`streams with an up-step after a down-step: ${anyUpAfterDown}`);
line(`direction reversals across all 600 streams: ${oscillations}`);
line(`VERDICT hysteresis: ${anyUpAfterDown === 0 && worstChanges <= POLICY.maxChanges ? "HOLDS" : "BROKEN"}`);

/* ----------------------------- X4: a boot hitch is indistinguishable from slow hardware, forever */
hdr("X4  a transient boot hitch, then a machine that is genuinely fine");
for (const hitchMs of [40, 60, 120, 250]) {
  for (const hitchSeconds of [3, 4, 6]) {
    const p = new TierPolicy("high", { ceiling: "high" });
    let t = 0;
    while (t < hitchSeconds * 1000) { p.sample(hitchMs); t += hitchMs; }
    const afterHitch = p.tier;
    const changesAtHitch = p.changes.length;
    for (let i = 0; i < 60 * 180; i++) p.sample(16.6); // three more minutes of flawless 60 Hz
    line(
      `${hitchMs} ms for ${hitchSeconds}s then 3 min of clean 60 Hz: ` +
        `tier after hitch ${afterHitch} (${changesAtHitch} change(s)), final ${p.tier}, ` +
        `recovered: ${p.tier === "high" ? "yes" : "NO"}`
    );
  }
}
line(`Earliest possible first decision = max(cooldownMs ${POLICY.cooldownMs}, firstWarmup + firstWindow) ms of wall clock.`);

/* ------------------------------------------------- X5: the starting heuristic on unknown hardware */
hdr("X5  starting tier on hardware that says nothing at all");
const blanks = [
  { name: "totally blank env", env: { renderer: "unknown", vendor: "unknown", maxTextureSize: 0, webgl2: false, devicePixelRatio: 1, cores: 0, memoryGB: 0, viewport: [0, 0] } },
  { name: "getContext threw (all defaults)", env: { renderer: "unknown", vendor: "unknown", maxTextureSize: 0, webgl2: false, devicePixelRatio: 1, cores: 0, memoryGB: 0, viewport: [1366, 768] } },
  { name: "masked, webgl2 true, 8 cores, no deviceMemory", env: { renderer: "unknown", vendor: "unknown", maxTextureSize: 16384, webgl2: true, devicePixelRatio: 1, cores: 8, memoryGB: 0, viewport: [1366, 768] } },
  { name: "UHD 600 Chromebook", env: { renderer: "ANGLE (Intel, Intel(R) UHD Graphics 600 Direct3D11 vs_5_0 ps_5_0, D3D11)", vendor: "Intel", maxTextureSize: 8192, webgl2: true, devicePixelRatio: 1, cores: 4, memoryGB: 4, viewport: [1366, 768] } },
  { name: "MT8183 Chromebook (Mali-G72, masked as ANGLE)", env: { renderer: "ANGLE (ARM, Mali-G72 MP3, OpenGL ES 3.2)", vendor: "ARM", maxTextureSize: 8192, webgl2: true, devicePixelRatio: 1, cores: 8, memoryGB: 4, viewport: [1366, 768] } },
  { name: "Chromebook Plus Iris Xe", env: { renderer: "ANGLE (Intel, Mesa Intel(R) Xe Graphics (TGL GT2), OpenGL ES 3.2)", vendor: "Intel", maxTextureSize: 16384, webgl2: true, devicePixelRatio: 1, cores: 8, memoryGB: 8, viewport: [1920, 1080] } },
  { name: "Chromebook, GPU string a brand new part nobody listed", env: { renderer: "ANGLE (Qualcomm, Adreno (TM) 740, OpenGL ES 3.2)", vendor: "Qualcomm", maxTextureSize: 16384, webgl2: true, devicePixelRatio: 1, cores: 8, memoryGB: 8, viewport: [1920, 1080] } },
];
for (const b of blanks) {
  const r = startingTier(b.env, "high");
  const t = TIERS[r.tier];
  line(
    `${b.name.padEnd(46)} → ${r.tier.padEnd(7)} ` +
      `(built shadow ${builtRes(r.tier)}² x${builtCascades(r.tier)}, post ${t.postStack.length}, ` +
      `dpr ${Math.min(b.env.devicePixelRatio, t.maxPixelRatio)}, draw ${t.drawDistance} m, grass ${t.grassDensity})`
  );
}

/* -------------------------------------------------- X6: ?tier=low and an explicit settings choice */
hdr("X6  stand-down paths, against the real AutoTier");
const stubKernel = (rendererName) => {
  const k = {
    resizes: 0, pixelRatio: config.pixelRatio(), applied: [],
    scene: { traverse() {} },
    renderer: {
      getContext: () => ({ getExtension: () => null, getParameter: (p) => (p === 1 ? rendererName : p === 2 ? "stub" : 8192), RENDERER: 1, VENDOR: 2, MAX_TEXTURE_SIZE: 3 }),
      capabilities: { isWebGL2: true },
      getPixelRatio: () => k.pixelRatio,
      shadowMap: { enabled: true, needsUpdate: false },
      domElement: { width: 1366, height: 768 },
    },
    resize() { k.resizes++; k.pixelRatio = config.pixelRatio(); },
    get: () => null,
  };
  return k;
};
const clock = { t: 1000 };
const driveFrames = (at, n, ms) => {
  const real = globalThis.performance;
  Object.defineProperty(globalThis, "performance", { value: { now: () => clock.t }, configurable: true, writable: true });
  for (let i = 0; i < n; i++) { clock.t += typeof ms === "function" ? ms() : ms; at.frame(); }
  Object.defineProperty(globalThis, "performance", { value: real, configurable: true, writable: true });
};

// ?tier=low — exactly the state Config's constructor leaves behind for that query string.
config.reset();
config.values.tier = "low";
config.values.autoTier = false;
{
  const k = stubKernel("ANGLE (Intel, Intel(R) UHD Graphics 600 Direct3D11 vs_5_0 ps_5_0, D3D11)");
  const at = new AutoTier(k);
  driveFrames(at, 8000, 120); // catastrophically slow for 16 minutes
  const rep = at.report();
  line(`?tier=low  → enabled=${rep.enabled} reason="${rep.reason}" tier=${rep.tier} changes=${rep.changes.length} frames=${rep.frames} heuristicApplied=${rep.startTier}`);
  line(`           VERDICT: ${rep.enabled === false && rep.changes.length === 0 && rep.tier === "low" ? "STANDS DOWN" : "DOES NOT STAND DOWN"}`);
}

// A settings screen, mid-session.
config.reset();
{
  const k = stubKernel("ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)");
  const at = new AutoTier(k);
  driveFrames(at, 30, 40);
  const wasEnabled = at.enabled;
  config.set("tier", "ultra"); // a player asking for MORE than measurement would allow
  driveFrames(at, 6000, 120);
  const rep = at.report();
  line(`settings→ultra mid-session (machine at 8 fps) → enabled ${wasEnabled}→${rep.enabled}, tier=${rep.tier}, auto changes=${rep.changes.length}, standDown.applied=${rep.standDown?.applied}, pixelRatio ${rep.standDown?.renderer?.pixelRatio}`);
  line(`           VERDICT: ${rep.enabled === false && rep.changes.length === 0 && rep.tier === "ultra" ? "STANDS DOWN, player wins" : "OVERRODE THE PLAYER"}`);
}
config.reset();

/* ------------------------------------ X7: does the measured path help a DPR-1 Chromebook at all? */
hdr("X7  what a full high→potato walk buys a DPR-1 Chromebook at runtime");
const stepDelta = (from, to, dpr) => ({
  pixels: `${(1366 * Math.min(dpr, TIERS[from].maxPixelRatio) * 768 * Math.min(dpr, TIERS[from].maxPixelRatio) / 1e6).toFixed(2)} MP → ${(1366 * Math.min(dpr, TIERS[to].maxPixelRatio) * 768 * Math.min(dpr, TIERS[to].maxPixelRatio) / 1e6).toFixed(2)} MP`,
  postPasses: `${TIERS[from].postStack.length} → ${TIERS[to].postStack.length}`,
  builtShadow: `${builtRes(from)}²x${builtCascades(from)} → ${builtRes(to)}²x${builtCascades(to)} (boot only)`,
  drawDistance: `${TIERS[from].drawDistance} → ${TIERS[to].drawDistance} m (NOT re-read after boot)`,
  grass: `${TIERS[from].grassDensity} → ${TIERS[to].grassDensity} (NOT re-read after boot)`,
});
line("at devicePixelRatio 1 (the school Chromebook case):");
console.log(stepDelta("high", "potato", 1));
line("at devicePixelRatio 2 (what review/measure/P30.mjs group C configures):");
console.log(stepDelta("high", "potato", 2));
