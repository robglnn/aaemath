#!/usr/bin/env node
/**
 * CRITIC's own P30 probe. Regenerates every claim independently and adds the attacks the
 * builder's script did not run. No browser, no captures.
 */
globalThis.window = globalThis;
globalThis.location = { search: "" };
const store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => (store[k] = String(v)),
  removeItem: (k) => delete store[k],
};
globalThis.devicePixelRatio = 1;
globalThis.innerWidth = 1366;
globalThis.innerHeight = 768;
globalThis.performance = globalThis.performance || { now: () => Date.now() };

const A = await import(new URL("../../app/src/core/AutoTier.js", import.meta.url).href);
const C = await import(new URL("../../app/src/core/Config.js", import.meta.url).href);
const { TierPolicy, POLICY, startingTier, AutoTier, inspectDevice } = A;
const { config, TIERS, TIER_ORDER } = C;

const line = (s) => console.log(s);
const out = [];
const K = (id, ok, msg) => { out.push({ id, ok }); line(`${ok ? "ok  " : "GAP "} ${id}  ${msg}`); };

function drive(p, n, gen) {
  const ch = [];
  for (let i = 0; i < n; i++) { const c = p.sample(gen(i)); if (c) ch.push(c); }
  return ch;
}

line("=== 1. does the heuristic guess from a device string alone? ===");
{
  // Same string, four different machines. If only the string mattered these would be equal.
  const base = { renderer: "ANGLE (Intel, Intel(R) UHD Graphics 600, D3D11)", vendor: "i", maxTextureSize: 8192, webgl2: true, devicePixelRatio: 1, cores: 4, memoryGB: 4, viewport: [1366, 768] };
  const variants = {
    "string only": startingTier({ ...base, maxTextureSize: 16384, cores: 16, memoryGB: 8 }, "high").tier,
    "chromebook": startingTier(base, "high").tier,
    "no webgl2": startingTier({ ...base, webgl2: false }, "high").tier,
    "2GB": startingTier({ ...base, memoryGB: 2 }, "high").tier,
  };
  K("H1", new Set(Object.values(variants)).size >= 2,
    `same renderer string, differing caps → ${JSON.stringify(variants)}`);
}

line("");
line("=== 2. UNKNOWN hardware: what does a machine with no legible signal boot into? ===");
{
  const cases = {
    "everything unknown (extension removed, non-Chrome)": { renderer: "unknown", vendor: "unknown", maxTextureSize: 0, webgl2: false, devicePixelRatio: 1, cores: 0, memoryGB: 0, viewport: [1366, 768] },
    "unknown string, webgl2, no deviceMemory API (Firefox/Safari)": { renderer: "unknown", vendor: "unknown", maxTextureSize: 16384, webgl2: true, devicePixelRatio: 1, cores: 8, memoryGB: 0, viewport: [1366, 768] },
    "privacy-masked string (Firefox RFP)": { renderer: "Mozilla", vendor: "Mozilla", maxTextureSize: 16384, webgl2: true, devicePixelRatio: 1, cores: 8, memoryGB: 0, viewport: [1920, 1080] },
    "WebKit WebGL (legacy Chrome mask)": { renderer: "WebKit WebGL", vendor: "WebKit", maxTextureSize: 16384, webgl2: true, devicePixelRatio: 1, cores: 8, memoryGB: 0, viewport: [1920, 1080] },
    "AMD Chromebook (Ryzen 3 3250C, raven)": { renderer: "ANGLE (AMD, AMD Radeon Graphics (raven, LLVM 15.0.6, DRM 3.49, 5.15), OpenGL ES 3.2)", vendor: "AMD", maxTextureSize: 16384, webgl2: true, devicePixelRatio: 1, cores: 4, memoryGB: 4, viewport: [1366, 768] },
    "Intel Iris Xe Chromebook Plus": { renderer: "ANGLE (Intel, Mesa Intel(R) Xe Graphics (TGL GT2), OpenGL ES 3.2)", vendor: "Intel", maxTextureSize: 16384, webgl2: true, devicePixelRatio: 1, cores: 8, memoryGB: 8, viewport: [1920, 1080] },
    "Intel UHD 620 8GB laptop": { renderer: "ANGLE (Intel, Intel(R) UHD Graphics 620, D3D11)", vendor: "Intel", maxTextureSize: 16384, webgl2: true, devicePixelRatio: 1, cores: 8, memoryGB: 8, viewport: [1920, 1080] },
    "MediaTek Kompanio Mali-G57": { renderer: "ANGLE (ARM, Mali-G57 MC2, OpenGL ES 3.2)", vendor: "ARM", maxTextureSize: 8192, webgl2: true, devicePixelRatio: 1, cores: 8, memoryGB: 8, viewport: [1920, 1080] },
  };
  for (const [name, env] of Object.entries(cases)) {
    const r = startingTier(env, "high");
    const t = TIERS[r.tier];
    K(`U:${name}`, r.tier !== "high",
      `→ ${r.tier}  (shadow ${t.shadowResolution}px x${t.shadowCascades}, dpr ${t.maxPixelRatio}, post ${t.postStack.length}) :: ${r.notes.join(" · ")}`);
  }
}

line("");
line("=== 3. how long before measurement rescues a machine that booted too high? ===");
{
  for (const fps of [60, 30, 20, 10, 5, 2]) {
    const ms = 1000 / fps;
    const p = new TierPolicy("high", { ceiling: "high" });
    let frames = 0, firstAt = null, lastAt = null;
    for (let i = 0; i < 200000 && p.tier !== "low"; i++) {
      frames++;
      const c = p.sample(ms);
      if (c) { if (firstAt === null) firstAt = p.clock; lastAt = p.clock; }
    }
    line(`   ${String(fps).padStart(3)} fps: first step down at ${firstAt === null ? "never" : (firstAt / 1000).toFixed(1) + " s"}; reached ${p.tier} at ${lastAt === null ? "-" : (lastAt / 1000).toFixed(1) + " s"} (${p.changes.length} steps)`);
  }
  const p10 = new TierPolicy("high", { ceiling: "high" });
  let t = null;
  for (let i = 0; i < 100000 && t === null; i++) { const c = p10.sample(100); if (c) t = p10.clock; }
  K("T1", t !== null && t <= 10000, `a 10 fps machine gets its FIRST relief at ${(t / 1000).toFixed(1)} s (want ≤ 10 s)`);
}

line("");
line("=== 4. forced oscillation: alternate fast and slow at several periods ===");
{
  for (const period of [40, 130, 250, 400, 1000]) {
    const p = new TierPolicy("medium", { ceiling: "high" });
    const ch = drive(p, 60000, (i) => (Math.floor(i / period) % 2 ? 40 : 16.6));
    const ups = ch.filter((c) => c.direction === "up").length;
    line(`   period ${String(period).padStart(4)} frames: ${ch.length} change(s) [${ch.map((c) => `${c.from}→${c.to}`).join(", ") || "none"}] ups=${ups} final=${p.tier}`);
  }
  // The interleaved worst case: alternate EVERY frame around the threshold.
  const p = new TierPolicy("high", { ceiling: "high" });
  const ch = drive(p, 60000, (i) => (i % 2 ? 8 : 34)); // median lands ~21
  line(`   per-frame alternation 8/34 ms: ${ch.length} change(s) [${ch.map((c) => `${c.from}→${c.to}`).join(", ")}] final=${p.tier} median=${p.lastStats.median}`);
  const anyUpAfterDown = (list) => { let d = false; for (const c of list) { if (c.direction === "down") d = true; else if (d) return true; } return false; };
  K("O1", !anyUpAfterDown(ch), "no up-step ever follows a down-step under per-frame alternation");
}

line("");
line("=== 5. does measurement promote back past the heuristic's hardware cap? ===");
{
  // A Gemini-Lake Chromebook: heuristic capped it at medium. Policy ceiling is bootTier, not the cap.
  const p = new TierPolicy("medium", { ceiling: "high" });
  const up = drive(p, 5000, (i) => 16.6 + (i % 7) * 0.05); // holds vsync at medium
  const down = drive(p, 60000, () => 40); // high costs it 25 fps
  const all = [...up, ...down];
  K("P1", up.length === 0,
    `heuristic said "Intel UHD → ≤ medium"; policy ceiling was "${p.ceiling}" → ${all.map((c) => `${c.from}→${c.to}(${c.direction})`).join(", ")}; final ${p.tier}, budget ${JSON.stringify(p.budget())}`);
  K("P2", p.tier !== "low" && p.tier !== "potato",
    `after the promotion + fallback the student ends at "${p.tier}" — the heuristic's own answer was "medium"`);
}

line("");
line("=== 6. does an explicit settings choice mid-session stand autoTier down? ===");
{
  // A minimal kernel that is enough for AutoTier's constructor and frame loop.
  const scene = { traverse() {} };
  const renderer = {
    getContext: () => ({
      getExtension: () => null,
      getParameter: (p) => (p === 1 ? "NVIDIA GeForce RTX 4070" : p === 2 ? "NVIDIA" : 16384),
      RENDERER: 1, VENDOR: 2, MAX_TEXTURE_SIZE: 3,
    }),
    capabilities: { isWebGL2: true },
    getPixelRatio: () => 1.5,
    shadowMap: { enabled: true },
    domElement: { width: 1366, height: 768 },
  };
  const kernel = { renderer, scene, resize() {}, get: () => null };

  const at = new AutoTier(kernel);
  const before = { enabled: at.enabled, tier: config.get("tier"), autoTier: config.get("autoTier") };

  // THE PLAYER OPENS SETTINGS AND PICKS "low" — exactly what Config.set documents.
  config.set("tier", "low");
  const midAutoTier = config.get("autoTier");

  // Now feed it slow frames, as a loaded machine would.
  let t = 0;
  const realPerf = globalThis.performance;
  Object.defineProperty(globalThis, "performance", { value: { now: () => t }, configurable: true, writable: true });
  let appliedAfterChoice = 0;
  for (let i = 0; i < 2000; i++) { t += 40; const n = at.history.length; at.frame(); if (at.history.length > n) appliedAfterChoice++; }
  Object.defineProperty(globalThis, "performance", { value: realPerf, configurable: true, writable: true });

  K("S1", midAutoTier === false, `Config.set("tier","low") flipped autoTier to ${midAutoTier}`);
  K("S2", at.enabled === false,
    `AutoTier.enabled after the player's explicit choice = ${at.enabled} (constructor captured it at boot: "${at.reason}")`);
  K("S3", appliedAfterChoice === 0,
    `tier changes autoTier made AFTER the player chose "low": ${appliedAfterChoice} → config.tier is now "${config.get("tier")}" (player asked for "low")`);
  line(`   boot state: ${JSON.stringify(before)}`);
  line(`   history: ${JSON.stringify(at.history.map((h) => `${h.from}→${h.to}`))}`);
}

line("");
line("=== 7. ?tier=low at boot ===");
{
  // Config's singleton already read location.search at import; re-instantiate with the query set.
  globalThis.location = { search: "?tier=low" };
  const fresh = new C.Config();
  K("Q1", fresh.get("tier") === "low" && fresh.get("autoTier") === false,
    `?tier=low → tier=${fresh.get("tier")}, autoTier=${fresh.get("autoTier")}`);
  globalThis.location = { search: "" };
}

line("");
const gaps = out.filter((o) => !o.ok);
line(`${out.length - gaps.length}/${out.length} of the critic's checks hold; ${gaps.length} gap(s): ${gaps.map((g) => g.id).join(", ")}`);
