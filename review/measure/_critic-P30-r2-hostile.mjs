#!/usr/bin/env node
/**
 * CRITIC round 2 for P30. Written by the critic, not the builder. Every number below is regenerated
 * from the shipped module; nothing is taken from the builder's script or its output files.
 */
globalThis.window = globalThis;
globalThis.location = { search: "" };
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.devicePixelRatio = 2;
globalThis.innerWidth = 1366;
globalThis.innerHeight = 768;

const M = await import(new URL("../../app/src/core/AutoTier.js", import.meta.url).href);
const { TierPolicy, POLICY, startingTier, AutoTier, NEUTRAL_START } = M;
const { config, TIERS, TIER_ORDER } = await import(
  new URL("../../app/src/core/Config.js", import.meta.url).href
);

const line = (s) => console.log(s);
const hdr = (s) => console.log(`\n=== ${s} ===`);

/* ------------------------------------------------------------------ 1. oscillation, swept hard */
hdr("1  OSCILLATION SWEEP — alternating fast/slow at every phase length");
{
  const rows = [];
  for (const period of [1, 2, 3, 5, 10, 24, 45, 60, 90, 120, 121, 150, 200, 300, 500, 800, 1200, 2000]) {
    for (const [slow, fast] of [[40, 6], [40, 16.6], [60, 16.6], [120, 16.6], [25, 12], [22, 20]]) {
      const p = new TierPolicy("high", { ceiling: "high" });
      let phase = 0;
      const ch = [];
      for (let i = 0; i < 120000; i++) {
        if (i % period === 0) phase ^= 1;
        const c = p.sample(phase ? slow : fast);
        if (c) ch.push(c);
      }
      const ups = ch.filter((c) => c.direction !== "down").length;
      rows.push({
        period,
        slow,
        fast,
        n: ch.length,
        ups,
        seq: ch.map((c) => `${c.direction[0]}:${c.from}>${c.to}`).join(" "),
        end: p.tier,
      });
    }
  }
  const bad = rows.filter((r) => r.n > POLICY.maxChanges);
  const withUp = rows.filter((r) => r.ups > 0);
  line(`streams driven: ${rows.length}; any exceeding maxChanges=${POLICY.maxChanges}: ${bad.length}`);
  line(`streams containing a non-down change: ${withUp.length}`);
  for (const r of withUp)
    line(`  period ${r.period} ${r.slow}/${r.fast} ms → ${r.n} change(s): ${r.seq} → ${r.end}`);
  const maxN = Math.max(...rows.map((r) => r.n));
  line(`worst change count across the whole sweep: ${maxN}`);
  // tightest clustering in time
  let tightest = null;
  for (const period of [1, 5, 45, 120, 500]) {
    const p = new TierPolicy("high", { ceiling: "high" });
    let phase = 0;
    const ch = [];
    for (let i = 0; i < 120000; i++) {
      if (i % period === 0) phase ^= 1;
      const c = p.sample(phase ? 120 : 16.6);
      if (c) ch.push(c);
    }
    if (ch.length >= 2) {
      const span = ch[ch.length - 1].at - ch[0].at;
      if (!tightest || span < tightest.span)
        tightest = { period, span, n: ch.length, at: ch.map((c) => (c.at / 1000).toFixed(1)) };
    }
  }
  line(`tightest cluster of picture changes: ${JSON.stringify(tightest)}`);
}

/* ---------------------------------------------- 2. the school Chromebook + a boot storm, end to end */
hdr("2  A LEGIBLE SCHOOL CHROMEBOOK THAT HAS A BOOT STORM");
{
  const stub = (rendererString, maxTex) => {
    const k = {
      resizes: 0,
      pixelRatio: config.pixelRatio(),
      scene: { traverse() {} },
      renderer: {
        getContext: () => ({
          getExtension: () => null,
          getParameter: (p) => (p === 1 ? rendererString : p === 2 ? "stub" : maxTex),
          RENDERER: 1,
          VENDOR: 2,
          MAX_TEXTURE_SIZE: 3,
        }),
        capabilities: { isWebGL2: true },
        getPixelRatio: () => k.pixelRatio,
        shadowMap: { enabled: true, needsUpdate: false },
        domElement: { width: 1366, height: 768 },
      },
      resize() {
        k.resizes++;
        k.pixelRatio = config.pixelRatio();
      },
      get: () => null,
    };
    return k;
  };
  const clock = { t: 1000 };
  const drive = (at, n, ms) => {
    const real = globalThis.performance;
    Object.defineProperty(globalThis, "performance", {
      value: { now: () => clock.t },
      configurable: true,
      writable: true,
    });
    for (let i = 0; i < n; i++) {
      clock.t += typeof ms === "function" ? ms() : ms;
      at.frame();
    }
    Object.defineProperty(globalThis, "performance", { value: real, configurable: true, writable: true });
  };

  const run = (label, str, tex, stormMs, stormFrames) => {
    config.reset();
    clock.t = 1000;
    const k = stub(str, tex);
    const at = new AutoTier(k);
    const bootTier = config.tier.id;
    drive(at, stormFrames, stormMs);
    const stormed = config.tier.id;
    // …and then the machine is exactly what a UHD 600 at `medium` really is: a locked 60 Hz.
    drive(at, 12000, 16.6); // 3.3 real minutes
    const auto = at.history.filter((c) => c.direction !== "heuristic");
    line(
      `${label}\n  heuristic → ${at.heuristic.tier} (caps ${JSON.stringify(at.heuristic.caps)}), corroborated=${at.corroborated}, ceiling ${at.policy.ceiling}\n` +
        `  boot ${bootTier} → after ${((stormMs * stormFrames) / 1000).toFixed(1)} s storm: ${stormed} → after 3.3 min of flawless 16.6 ms: ${config.tier.id}\n` +
        `  auto changes: ${auto.map((c) => `${c.from}→${c.to}(${c.direction},${c.rungs}r,@${(c.at / 1000).toFixed(1)}s)`).join(", ") || "none"}\n` +
        `  budget ${JSON.stringify(at.policy.budget())}; shadows now ${TIERS[config.tier.id].shadows}; postStack ${JSON.stringify(TIERS[config.tier.id].postStack)}; pixelRatio ${k.pixelRatio}\n` +
        `  revocation gate: ${JSON.stringify(at.policy.recoveryState(at.policy.lastStats))}`
    );
    return { at, final: config.tier.id };
  };

  const cb = run(
    "UHD 600 school Chromebook, 4.8 s classroom-Wi-Fi storm (legible renderer string)",
    "ANGLE (Intel, Intel(R) UHD Graphics 600 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    8192,
    120,
    40
  );
  const xe = run(
    "Chromebook Plus (Iris Xe), same storm",
    "ANGLE (Intel, Mesa Intel(R) Xe Graphics (TGL GT2), OpenGL ES 3.2)",
    16384,
    120,
    40
  );
  const rtx = run(
    "RTX 4070 desktop, same storm (the machine that does NOT need help)",
    "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    16384,
    120,
    40
  );
  const masked = run(
    "masked browser (Chrome without WEBGL_debug_renderer_info), same storm",
    "WebKit WebGL",
    16384,
    120,
    40
  );
  line(
    `\n  VERDICT ROW: Chromebook ends "${cb.final}", Xe ends "${xe.final}", masked ends "${masked.final}", RTX ends "${rtx.final}"`
  );

  // shorter storms, to find where the tail gate saves the Chromebook and where it does not
  line("\n  storm-length sweep on the UHD 600 (final tier after 3.3 min of perfect 60 Hz):");
  for (const frames of [8, 12, 16, 20, 24, 30, 40, 60, 100]) {
    config.reset();
    clock.t = 1000;
    const k = stub("ANGLE (Intel, Intel(R) UHD Graphics 600 Direct3D11 vs_5_0 ps_5_0, D3D11)", 8192);
    const at = new AutoTier(k);
    drive(at, frames, 120);
    drive(at, 12000, 16.6);
    const auto = at.history.filter((c) => c.direction !== "heuristic");
    line(
      `    storm ${(frames * 0.12).toFixed(1)} s → ${config.tier.id.padEnd(6)} (${auto.length} change(s): ${auto.map((c) => `${c.from}→${c.to}`).join(",") || "none"}), shadows ${TIERS[config.tier.id].shadows}`
    );
  }
  config.reset();
}

/* ------------------------------------------------- 3. what the conservative start actually buys */
hdr("3  IS THE STARTING TIER CONSERVATIVE, ON THE SURFACES THAT COST FRAMES?");
{
  // What Lighting.js really builds, read out of its own source rather than out of the tier table.
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../../app/src/world/Lighting.js", import.meta.url), "utf8");
  const casc = src.match(/Math\.max\(1,\s*Math\.min\((\d+),\s*tier\.shadowCascades[^)]*\)\)/);
  const res = src.match(/Math\.min\((\d+),\s*Math\.max\((\d+),\s*tier\.shadowResolution\)\)/);
  line(`Lighting.js cascade clamp: ${casc?.[0]}`);
  line(`Lighting.js resolution clamp: ${res?.[0]}`);
  const built = (t) => ({
    cascades: Math.max(1, Math.min(Number(casc[1]), TIERS[t].shadowCascades ?? 1)),
    res: Math.min(Number(res[1]), Math.max(Number(res[2]), TIERS[t].shadowResolution)),
    shadows: TIERS[t].shadows,
  });
  line("\ntier   table-res  BUILT rig            dpr(@dpr2)  post passes");
  for (const t of ["ultra", "high", "medium", "low", "potato"]) {
    const b = built(t);
    line(
      `${t.padEnd(7)}${String(TIERS[t].shadowResolution).padEnd(11)}${(b.shadows ? `${b.res}² x${b.cascades}` : "off").padEnd(21)}${String(Math.min(2, TIERS[t].maxPixelRatio)).padEnd(12)}${TIERS[t].postStack.length}`
    );
  }
  const h = built("high");
  const m = built("medium");
  line(
    `\nhigh → medium at BOOT changes the shadow rig by: ${h.res === m.res && h.cascades === m.cascades ? "NOTHING (identical rig)" : "a real step"}`
  );
  line(
    `high → medium at BOOT changes pixels shaded by: ${(100 * (1 - TIERS.medium.maxPixelRatio ** 2 / TIERS.high.maxPixelRatio ** 2)).toFixed(0)} %, post passes ${TIERS.high.postStack.length} → ${TIERS.medium.postStack.length}`
  );
  line(
    `The first frame a masked school Chromebook draws therefore carries ${m.res}²x${m.cascades} shadow cascades — the SAME rig a gaming desktop gets.`
  );
  line(
    `AutoTier's own shadow ladder (_applyShadows) only runs after a MEASURED decision, i.e. no earlier than ~4 s in.`
  );
}

/* ---------------------------------------------------------------- 4. stand-down, both directions */
hdr("4  STAND-DOWN");
{
  // (a) ?tier=low at boot — through Config's own constructor, not a hand-set flag.
  const saved = globalThis.location.search;
  globalThis.location = { search: "?tier=low" };
  const { Config } = await import(new URL("../../app/src/core/Config.js", import.meta.url).href);
  const c2 = new Config();
  line(`?tier=low → config.tier="${c2.get("tier")}", config.autoTier=${c2.get("autoTier")}`);
  globalThis.location = { search: saved };

  // (b) the module's own branch, with the real singleton
  config.reset();
  config.set("tier", "low");
  const k = {
    pixelRatio: config.pixelRatio(),
    scene: { traverse() {} },
    renderer: {
      getContext: () => ({
        getExtension: () => null,
        getParameter: () => "ANGLE (Intel, Intel(R) UHD Graphics 600 Direct3D11, D3D11)",
        RENDERER: 1,
        VENDOR: 2,
        MAX_TEXTURE_SIZE: 3,
      }),
      capabilities: { isWebGL2: true },
      getPixelRatio: () => k.pixelRatio,
      shadowMap: { enabled: true, needsUpdate: false },
      domElement: { width: 1366, height: 768 },
    },
    resize() {
      k.pixelRatio = config.pixelRatio();
    },
    get: () => null,
  };
  const at = new AutoTier(k);
  const real = globalThis.performance;
  Object.defineProperty(globalThis, "performance", {
    value: { now: () => (t += 200) },
    configurable: true,
    writable: true,
  });
  let t = 0;
  for (let i = 0; i < 5000; i++) at.frame();
  Object.defineProperty(globalThis, "performance", { value: real, configurable: true, writable: true });
  line(
    `explicit choice at construction: enabled=${at.enabled}, reason="${at.reason}", frames=${at._frames}, ` +
      `policy samples accepted=${at.policy.accepted}, changes=${at.history.length}, tier still "${config.tier.id}"`
  );
  config.reset();
}

/* ------------------------------------- 5. can a genuine descent be revoked? the rung-gain model */
hdr("5  THE REVOCATION GATE AGAINST A REAL RUNG GAIN");
{
  line(
    `gate: measured <= ${POLICY.recoveryInconsistency} x (preMedian / ${POLICY.recoveryRungGain}^rungs) → for a 1-rung descent, the machine must get ${(1 / (POLICY.recoveryInconsistency / POLICY.recoveryRungGain)).toFixed(2)}x faster`
  );
  for (const gain of [1.3, 1.6, 2, 2.5, 3, 3.34, 4, 6]) {
    const p = new TierPolicy("high", { ceiling: "high" });
    const ORDER = TIER_ORDER;
    const base = 45; // ms at `high`
    let ch = [];
    for (let i = 0; i < 60000; i++) {
      const cost = base / gain ** (3 - ORDER.indexOf(p.tier));
      const c = p.sample(cost);
      if (c) ch.push(c);
    }
    line(
      `  a rung really worth ${gain}x, 45 ms at high → changes ${ch.map((c) => `${c.from}→${c.to}(${c.direction})`).join(",") || "none"} → ends ${p.tier}, recoveries ${p.recoveries}, locked ${p.locked}`
    );
  }
}
