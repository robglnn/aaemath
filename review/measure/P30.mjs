#!/usr/bin/env node
/**
 * P30 — measured Chromebook auto-tiering. The proof.
 *
 *   node review/measure/P30.mjs                 # every claim, PASS/FAIL, exit 1 on any failure
 *   node review/measure/P30.mjs --only=A,B      # the offline groups only — no browser at all
 *   node review/measure/P30.mjs --json          # machine-readable only
 *   node review/measure/P30.mjs --dev           # measure the dev server instead of a fresh build
 *
 * ## Why most of this runs with no browser
 *
 * The claims that matter here are about *policy under adversarial frame-time streams*: that a noisy
 * machine sitting on the threshold does not oscillate, that a step up can never follow a step down,
 * that the session budget binds. Those need thousands of frames of specific shapes — hundreds of
 * headless renders to observe once, and a human is playtesting on this machine right now. So the
 * decision half of `core/AutoTier.js` is written as a pure class with its own clock, and groups A
 * and B drive it directly in Node: deterministic, exhaustive, and free.
 *
 * The browser half then proves the one thing a pure class cannot: that a decision *lands* — that
 * `renderer.getPixelRatio()`, `renderer.shadowMap.enabled`, the lights' `shadow.mapSize` and the
 * post stack really moved, on real measured frames, in the real game. Group C boots once, drives
 * real renders through the software rasteriser (which genuinely cannot hold 60 Hz, so the load is
 * not simulated at all), and reads the probe. **No screenshots are taken** — every claim here is a
 * number, and a picture would only cost the playtest CPU.
 *
 * Groups:
 *   A  the policy: hysteresis, no oscillation, budgets, ceilings   (offline, pure)
 *   B  the first-frame hardware heuristic                          (offline, pure)
 *   C  a decision lands in the real renderer, and stands down for an explicit choice (one session)
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { openGame, arg, has, ROOT } from "../../tools/lib/session.mjs";

const ONLY = (arg("only", "A,B,C") || "").split(",").map((s) => s.trim().toUpperCase());
const JSON_ONLY = has("json");
const OUT = path.join(ROOT, "review", "measure", "out", "P30");
fs.mkdirSync(OUT, { recursive: true });

const results = [];
function claim(id, title, ok, detail) {
  results.push({ id, title, pass: !!ok, detail });
  if (!JSON_ONLY) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${id}  ${title}`);
    if (detail) console.log(`        ${String(detail).split("\n").join("\n        ")}`);
  }
}

/* ------------------------------------------------------------------ importing the module offline
 *
 * `core/Config.js` builds its singleton at module-evaluation time and reads `location.search` and
 * `localStorage` while doing it. Both are shimmed here rather than refactored: the module under
 * test must be the exact one the game ships, not a Node-friendly variant of it.
 */
globalThis.window = globalThis;
globalThis.location = { search: "" };
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.devicePixelRatio = 1;
globalThis.innerWidth = 1920;
globalThis.innerHeight = 1080;
// Node ships a read-only `navigator`; `inspectDevice` only ever reads from it, and group B feeds
// its environment in explicitly, so whatever Node reports here is inert.

const { TierPolicy, POLICY, startingTier, isSoftwareRaster } = await import(
  new URL("../../app/src/core/AutoTier.js", import.meta.url).href
);

/** Feed a policy `n` frames produced by `gen(i)`, collecting every change it makes. */
function drive(policy, n, gen) {
  const changes = [];
  for (let i = 0; i < n; i++) {
    const c = policy.sample(gen(i));
    if (c) changes.push(c);
  }
  return changes;
}

/* ============================================================================ A — the policy */

if (ONLY.includes("A")) {
  // A1 — a machine that sustains 25 fps steps down, and keeps stepping until the budget stops it.
  {
    const p = new TierPolicy("high", { ceiling: "high" });
    const ch = drive(p, 4000, () => 40); // 40 ms == 25 fps, flat
    const down = ch.filter((c) => c.direction === "down");
    claim(
      "A1",
      "sustained 25 fps steps the tier down",
      down.length >= 1 && ch.every((c) => c.direction === "down") && p.tier !== "high",
      `high → ${p.tier} in ${ch.length} changes: ${ch.map((c) => `${c.from}→${c.to} @${c.medianMs}ms/${c.fps}fps`).join(", ")}`
    );
  }

  // A2 — the dead band. A machine sitting between the up and down thresholds must do nothing, ever.
  {
    const p = new TierPolicy("high", { ceiling: "high" });
    // Median ~18.5 ms (54 fps): below the 21 ms down threshold, above the 13.5 ms up threshold, and
    // its p10 (17.2) is above `cadenceMaxMs` so the vsync path cannot fire either.
    const ch = drive(p, 20000, (i) => 18 + (i % 5) * 0.5);
    claim(
      "A2",
      "no change anywhere in the dead band (54 fps, 20 000 frames)",
      ch.length === 0 && p.tier === "high",
      `median ${p.lastStats.median.toFixed(2)} ms, p10 ${p.lastStats.p10.toFixed(2)} ms, changes ${ch.length}`
    );
  }

  // A3 — a hitchy 60 fps is not headroom. p95 blown by 1 frame in 40 must block the up path.
  {
    const p = new TierPolicy("medium", { ceiling: "high" });
    const ch = drive(p, 20000, (i) => (i % 40 === 0 ? 44 : 16.6));
    claim(
      "A3",
      "a 1-in-40 stutter buys no step up (the p99 jitter gate)",
      ch.length === 0,
      `median ${p.lastStats.median.toFixed(2)} ms, p95 ${p.lastStats.p95.toFixed(2)} ms, p99 ${p.lastStats.p99.toFixed(2)} ms, max ${p.lastStats.max.toFixed(2)} ms → changes ${ch.length}`
    );
  }

  // A4 — clean headroom buys exactly one step up, and never a second.
  {
    const p = new TierPolicy("low", { ceiling: "high" });
    const ch = drive(p, 40000, () => 8); // 125 fps, unlocked
    claim(
      "A4",
      "clean headroom buys exactly one step up, forever",
      ch.length === 1 && ch[0].direction === "up" && ch[0].from === "low" && ch[0].to === "medium",
      `40 000 frames at 8 ms → ${ch.length} change(s): ${ch.map((c) => `${c.from}→${c.to}`).join(", ") || "none"}; tier ${p.tier}`
    );
  }

  // A5 — a vsync-locked 60 Hz display: the cadence path, not the raw-ms path.
  {
    const p = new TierPolicy("low", { ceiling: "high" });
    const ch = drive(p, 20000, (i) => 16.6 + (i % 7) * 0.05);
    claim(
      "A5",
      "vsync-locked 60 Hz reads as headroom through the cadence path",
      ch.length === 1 && ch[0].direction === "up",
      `p10 ${p.lastStats.p10.toFixed(2)} ms, median ${p.lastStats.median.toFixed(2)} ms, p99 ${p.lastStats.p99.toFixed(2)} ms → ${ch.length} change(s)`
    );
  }

  // A6 — the anti-oscillation lock. Slow enough to step down, then fast forever: never comes back.
  {
    const p = new TierPolicy("high", { ceiling: "high" });
    const first = drive(p, 2000, () => 40);
    const after = drive(p, 40000, () => 5);
    claim(
      "A6",
      "no step up after a step down, for the rest of the session",
      first.length > 0 && after.length === 0 && p.upSteps === 0,
      `${first.length} down step(s) then 40 000 frames at 5 ms (200 fps) → ${after.length} further change(s)`
    );
  }

  // A7 — the worst case for an oscillator: load that alternates side of the threshold every window.
  {
    const p = new TierPolicy("high", { ceiling: "high" });
    let phase = 0;
    const ch = drive(p, 60000, (i) => {
      if (i % 500 === 0) phase ^= 1;
      return phase ? 40 : 6;
    });
    const ups = ch.filter((c) => c.direction === "up").length;
    const monotone = ch.every((c, i) => i === 0 || c.direction === "down");
    claim(
      "A7",
      "load alternating across the threshold produces no oscillation",
      ups === 0 && monotone && ch.length <= POLICY.maxChanges,
      `${ch.length} change(s), all downward (${ch.map((c) => c.direction).join(",") || "none"}); tier ended ${p.tier}`
    );
  }

  // A8 — the session budget binds: at most `maxChanges`, whatever the machine does.
  {
    const p = new TierPolicy("ultra", { ceiling: "ultra" });
    const ch = drive(p, 100000, () => 200);
    claim(
      "A8",
      `at most ${POLICY.maxChanges} tier changes per session`,
      ch.length === POLICY.maxChanges && p.tier === "low",
      `100 000 frames at 200 ms → ${ch.length} change(s), ultra → ${p.tier} (potato is reachable but the budget stops first)`
    );
  }

  // A9 — the cooldown really separates decisions in measured time.
  {
    const p = new TierPolicy("ultra", { ceiling: "ultra" });
    const ch = drive(p, 100000, () => 40);
    const gaps = ch.slice(1).map((c, i) => c.at - ch[i].at);
    claim(
      "A9",
      `consecutive decisions are ≥ ${POLICY.cooldownMs} ms of measured time apart`,
      gaps.length > 0 && gaps.every((g) => g >= POLICY.cooldownMs),
      `gaps: ${gaps.map((g) => `${Math.round(g)} ms`).join(", ")}`
    );
  }

  // A10 — a stall is not a frame. A tab switch must not be scored as load.
  {
    const p = new TierPolicy("high", { ceiling: "high" });
    const ch = drive(p, 20000, (i) => (i % 300 === 0 ? 4000 : 16.6));
    claim(
      "A10",
      "multi-second stalls are rejected as samples but still advance the clock",
      ch.length === 0 && p.rejected > 0 && p.clock > 300000,
      `${p.rejected} rejected, ${p.accepted} accepted, clock ${(p.clock / 1000).toFixed(0)} s, changes ${ch.length}`
    );
  }

  // A11 — the ceiling. Auto-tiering hands work back; it never promotes past what was configured.
  {
    const p = new TierPolicy("high", { ceiling: "high" });
    const ch = drive(p, 40000, () => 4);
    claim(
      "A11",
      "never promotes above the configured tier",
      ch.length === 0 && p.tier === "high",
      `40 000 frames at 4 ms (250 fps) at the ceiling → ${ch.length} change(s)`
    );
  }

  // A12 — potato is the floor.
  {
    const p = new TierPolicy("medium", { ceiling: "medium", maxChanges: 99 });
    const ch = drive(p, 100000, () => 200);
    claim(
      "A12",
      "potato is the floor — no change is attempted below it",
      p.tier === "potato" && ch.length === 2,
      `medium → ${p.tier} in ${ch.length} change(s), then the remaining frames at 200 ms produced none`
    );
  }

  // A13 — the gap A12 exposed on its first run: at 2 fps *every* period exceeds `sampleMaxMs`, so
  // the worst hardware in the range was the one hardware that could never be tiered down.
  {
    const p = new TierPolicy("high", { ceiling: "high" });
    const ch = drive(p, 4000, () => 500); // 2 fps, sustained
    claim(
      "A13",
      "a sustained 2 fps machine is tiered down; an isolated 4 s stall (A10) still is not",
      ch.length >= 1 && ch.every((c) => c.direction === "down") && p.tier === "potato",
      `4 000 frames at 500 ms → ${ch.length} change(s), high → ${p.tier}; ${p.rejected} rejected before the ${POLICY.stallRun}-frame run tripped`
    );
  }
}

/* ================================================================== B — the first-frame heuristic */

if (ONLY.includes("B")) {
  const CHROMEBOOK = {
    renderer: "ANGLE (Intel, Intel(R) UHD Graphics 600 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    vendor: "Google Inc. (Intel)",
    maxTextureSize: 8192,
    webgl2: true,
    devicePixelRatio: 1,
    cores: 4,
    memoryGB: 4,
    viewport: [1366, 768],
  };
  const ARM_CHROMEBOOK = {
    renderer: "ANGLE (ARM, Mali-G72 MP3, OpenGL ES 3.2)",
    vendor: "ARM",
    maxTextureSize: 8192,
    webgl2: true,
    devicePixelRatio: 1.5,
    cores: 8,
    memoryGB: 4,
    viewport: [1920, 1080],
  };
  const DESKTOP = {
    renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    vendor: "Google Inc. (NVIDIA)",
    maxTextureSize: 16384,
    webgl2: true,
    devicePixelRatio: 1,
    cores: 16,
    memoryGB: 8,
    viewport: [1920, 1080],
  };
  const NETBOOK = {
    renderer: "ANGLE (Intel, Intel(R) HD Graphics 3000, OpenGL 3.1)",
    vendor: "Intel",
    maxTextureSize: 4096,
    webgl2: false,
    devicePixelRatio: 1,
    cores: 2,
    memoryGB: 2,
    viewport: [1366, 768],
  };
  const HEADLESS = {
    renderer: "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))",
    vendor: "Google Inc.",
    maxTextureSize: 8192,
    webgl2: true,
    devicePixelRatio: 1,
    cores: 8,
    memoryGB: 8,
    viewport: [1920, 1080],
  };

  const cb = startingTier(CHROMEBOOK, "high");
  claim(
    "B1",
    "a Gemini-Lake school Chromebook does not start at high",
    cb.tier === "medium" && !cb.standDown && cb.notes.length >= 2,
    `→ ${cb.tier}; keyed on: ${cb.notes.join(" · ")}`
  );

  const arm = startingTier(ARM_CHROMEBOOK, "high");
  claim(
    "B2",
    "an ARM Chromebook at 1080p starts at or below medium",
    ["potato", "low", "medium"].includes(arm.tier),
    `→ ${arm.tier}; keyed on: ${arm.notes.join(" · ")}`
  );

  const desk = startingTier(DESKTOP, "high");
  claim(
    "B3",
    "a discrete-GPU desktop starts at the configured tier and lets measurement decide",
    desk.tier === "high" && desk.caps.length === 0,
    `→ ${desk.tier}; ${desk.notes.join(" · ")}`
  );

  const net = startingTier(NETBOOK, "high");
  claim(
    "B4",
    "a 2 GB, no-WebGL2, 4096-texture machine starts at potato",
    net.tier === "potato",
    `→ ${net.tier}; keyed on: ${net.notes.join(" · ")}`
  );

  const sw = startingTier(HEADLESS, "high");
  claim(
    "B5",
    "a software rasteriser stands the whole module down instead of being tiered",
    sw.standDown === true && sw.tier === "high" && isSoftwareRaster(HEADLESS.renderer),
    `→ standDown=${sw.standDown}, tier ${sw.tier}; ${sw.notes.join(" · ")}`
  );

  const capped = startingTier(DESKTOP, "low");
  claim(
    "B6",
    "the heuristic can only lower, never raise, the configured tier",
    capped.tier === "low",
    `a RTX 4070 with ceiling "low" → ${capped.tier}`
  );

  const hidpi = startingTier({ ...DESKTOP, viewport: [3840, 2160], devicePixelRatio: 2 }, "high");
  claim(
    "B7",
    "fill rate counts as evidence on its own — a 4K panel is capped",
    hidpi.tier === "medium",
    `→ ${hidpi.tier}; ${hidpi.notes.join(" · ")}`
  );
}

/* ================================================================== C — it lands in the renderer */

if (ONLY.includes("C")) {
  // Measure the built bundle by default: a dozen agents write to `app/` at once and a dev-server
  // session can be reloaded by HMR half way through a measurement, which looks exactly like a bug
  // in the thing being measured.
  const BUILT = !has("dev");
  if (BUILT && !has("no-build")) {
    execFileSync("npx", ["vite", "build", "--logLevel", "warn"], { cwd: ROOT, stdio: "inherit", shell: true });
  }

  // A deliberately small viewport with a 2x device scale factor. Small, because every pixel here is
  // stolen from a live playtest; 2x, because `config.pixelRatio()` is `min(devicePixelRatio,
  // tier.maxPixelRatio)` and at DPR 1 every tier from high down to potato clamps to 1 — the pixel
  // ratio claim would be unfalsifiable. At DPR 2 the ladder is 1.5 / 1.25 / 1 / 1 and visible.
  const W = 480;
  const H = 270;

  const browser = await openGame(
    {
      width: W,
      height: H,
      scale: 2,
      built: BUILT,
      query: {
        // Opt back in on the software rasteriser: this run *wants* the apply path exercised.
        autotier: "force",
        // Shorter windows than the shipped 90/120, so three decisions fit in ~180 real SwiftShader
        // frames instead of ~630. Still 30 warm-up frames — enough, at ~10 fps here, for the scene
        // to finish assembling before it is judged — and 30 frames of evidence per decision.
        autotierWarmup: "30",
        autotierWindow: "30",
        autotierCooldown: "1000",
      },
    },
    async (d) => {
      const ready = () =>
        d.page.waitForFunction(() => window.__vs && (window.__vs.ready || window.__vs.fatal), {
          timeout: 90000,
        });

      /**
       * A dozen agents write to `app/` while this runs, and every save is an HMR full reload that
       * destroys the execution context mid-measurement. A reload resets `AutoTier` completely, so
       * the only correct response is to start the phase again — not to stitch two halves of two
       * different sessions together and call it one measurement.
       */
      let reloads = 0;
      async function phase(fn, attempts = 5) {
        for (let a = 0; a < attempts; a++) {
          try {
            return await fn();
          } catch (err) {
            if (!/Execution context was destroyed|Target closed|navigat/i.test(String(err))) throw err;
            reloads++;
            await ready();
          }
        }
        throw new Error(`the dev server reloaded the page on all ${attempts} attempts`);
      }

      /**
       * Wait on the game's own rAF loop, in wall clock.
       *
       * This is the one measurement in the project that must not use `__vs.advance()`. Everywhere
       * else, wall-clock waits are forbidden because they measure *game* time badly; here the
       * quantity under test **is** wall-clock frame cost, and `advance()` is the wrong instrument
       * for it precisely because it never presents a frame — `renderer.render()` returns as soon as
       * the commands are queued, so an advance-driven loop reports 0.5 ms per frame on a rasteriser
       * that is really running at 5 fps. `kernel.run()`'s animation loop is throttled by the
       * compositor, which is what makes its intervals the real number.
       */
      async function driveUntil(want, maxMs) {
        const t0 = Date.now();
        for (;;) {
          const p = await d.probe("autotier");
          if ((p?.changes?.length ?? 0) >= want || Date.now() - t0 > maxMs) return p;
          await d.page.waitForTimeout(500);
        }
      }

      const measured = await phase(async () => {
        const boot = await d.report();
        const probe0 = await d.probe("autotier");
        const post0 = await d.probe("post");
        const after = await driveUntil(3, 120000);
        // …and then keep watching, to prove nothing further moves once the budget is spent.
        await d.page.waitForTimeout(8000);
        return {
          boot,
          probe0,
          post0,
          after,
          settled: await d.probe("autotier"),
          settledStats: await d.report(),
          post1: await d.probe("post"),
        };
      });

      // Second load, same browser: an explicit choice must stand the module down completely.
      const chosen = await phase(async () => {
        const u = new URL(d.url);
        u.search = "?tier=low";
        await d.page.goto(u.toString(), { waitUntil: "load", timeout: 90000 });
        await ready();
        await d.page.evaluate(() => {
          for (let i = 0; i < 40; i++) window.__vs.advance(1 / 60);
        });
        return { explicit: await d.probe("autotier"), explicitStats: await d.report() };
      });

      return { ...measured, ...chosen, reloads, consoleErrors: d.consoleErrors.slice(0, 10) };
    }
  );

  fs.writeFileSync(path.join(OUT, "session.json"), JSON.stringify(browser, null, 2));

  const { boot, probe0, settled, settledStats, explicit, explicitStats } = browser;

  /**
   * Errors this piece is answerable for. At the time of writing another wave is mid-edit on
   * `learn/ItemBank.js` (it imports a `content/items/groups/index.mjs` that does not exist yet),
   * which fails that boot module and only that boot module — the isolation in `main.js` working as
   * designed. Those are reported below rather than hidden, but they are not P30's.
   */
  const FOREIGN = /itembank|62-learning|content\/items\/groups/i;
  const mine = (errors) => (errors ?? []).filter((e) => !FOREIGN.test(String(e)));

  claim(
    "C1",
    "the game boots with auto-tiering mounted and no errors of its own",
    !boot.fatal && mine(boot.errors).length === 0 && !!probe0 && probe0.enabled === true,
    `fatal=${boot.fatal ?? "null"}, errors mine=${mine(boot.errors).length} foreign=${(boot.errors?.length ?? 0) - mine(boot.errors).length}, HMR reloads survived=${browser.reloads}, probe enabled=${probe0?.enabled}, reason="${probe0?.reason}", start tier ${probe0?.startTier}, GPU "${probe0?.heuristic?.env?.renderer}"`
  );

  const changes = settled?.changes ?? [];
  const downs = changes.filter((c) => c.direction === "down" && c.applied);
  claim(
    "C2",
    "real measured frame cost steps the tier down in the real game",
    downs.length >= 1 &&
      downs.every((c) => c.medianMs > settled.thresholds.downMs) &&
      // Guard against the failure this claim caught on its first run: a non-presenting loop reports
      // sub-millisecond "frames". A number under 5 ms here means the instrument, not the machine.
      downs.every((c) => c.medianMs > 5),
    downs.length
      ? downs.map((c) => `${c.from}→${c.to} at ${c.medianMs} ms median (${c.fps} fps) over ${c.frames} frames`).join("; ")
      : `no applied down step; tier ${settled?.tier}, measured ${JSON.stringify(settled?.measured)}`
  );

  const first = downs[0];
  const last = downs[downs.length - 1];
  const pixelMoved = first && last && last.after.pixelRatio < first.before.pixelRatio;
  const shadowMoved = first && last && last.after.shadowMapSize < first.before.shadowMapSize;
  const shadowsOff = changes.some((c) => c.after && c.before && c.before.shadowMapEnabled && !c.after.shadowMapEnabled);
  claim(
    "C3",
    "the renderer really changed: pixel ratio and shadow map size",
    pixelMoved && shadowMoved,
    first && last
      ? `pixelRatio ${first.before.pixelRatio} → ${last.after.pixelRatio}; shadow map ${first.before.shadowMapSize}² → ${last.after.shadowMapSize}² across ${last.after.shadowCasters} caster(s); drawing buffer ${first.before.drawingBuffer.join("x")} → ${last.after.drawingBuffer.join("x")}; shadowMap.enabled turned off: ${shadowsOff}`
      : "no applied change to inspect"
  );

  claim(
    "C4",
    "every change is monotone downward and inside the session budget",
    changes.length > 0 &&
      changes.filter((c) => c.direction === "up").length === 0 &&
      changes.filter((c) => c.applied).length <= settled.thresholds.maxChanges &&
      changes.every((c) => !c.applied || c.post),
    `${changes.length} change(s): ${changes.map((c) => `${c.from}→${c.to}(${c.direction},post=${c.post ?? "-"})`).join(", ")}; budget left ${JSON.stringify(settled.budget)}; final tier ${settled.tier}; cap ${settled.thresholds.maxChanges}`
  );

  const { post0, post1 } = browser;
  claim(
    "C5",
    "the post stack really followed the tier down",
    !!post0 &&
      !!post1 &&
      post0.installed === true &&
      post1.installed === false &&
      Object.values(post1.effects).every((v) => v === false),
    post0 && post1
      ? `installed ${post0.installed} → ${post1.installed}; effects ${JSON.stringify(post0.effects)} → ${JSON.stringify(post1.effects)}; targets ${post0.targets} → ${post1.targets}, ${post0.megabytes} MB → ${post1.megabytes} MB`
      : "post probe unavailable"
  );

  claim(
    "C6",
    "nothing moves once the budget is spent (8 s of further frames)",
    settled.changes.length === browser.after.changes.length && mine(settledStats.errors).length === 0,
    `changes ${browser.after.changes.length} → ${settled.changes.length}; own errors ${mine(settledStats.errors).length}; final measured ${JSON.stringify(settled.measured)}`
  );

  /**
   * The claim the whole piece exists for: the tiering bought the student frame time.
   *
   * The comparison is the *last* decision's window against the settled window — two back-to-back
   * measurements of the same fully-built scene, one either side of one tier step. Comparing against
   * the first decision instead would be dishonest: that window is taken seconds after boot while
   * the world is still assembling, and P30 measured it at 37.8 ms on a machine that settled at 93.
   */
  const before = downs[downs.length - 1]?.medianMs ?? 0;
  const now = settled.measured?.medianMs ?? 0;
  claim(
    "C7",
    "tiering actually bought frame time on a machine that could not hold the tier",
    before > 0 && now > 0 && now < before * 0.85,
    `median frame cost across the last step ${downs[downs.length - 1]?.from} → ${settled.tier}: ${before} ms (${downs[downs.length - 1]?.fps} fps) → ${now} ms (${settled.measured?.fps} fps), ${(100 * (1 - now / before)).toFixed(0)} % cheaper per frame`
  );

  claim(
    "C8",
    "?tier=low stands auto-tiering down completely",
    explicit?.enabled === false &&
      /explicit/.test(explicit?.reason ?? "") &&
      (explicit?.changes?.length ?? -1) === 0 &&
      explicit?.tier === "low" &&
      !explicitStats.fatal,
    `enabled=${explicit?.enabled}, tier=${explicit?.tier}, autoTier=${explicit?.autoTierSetting}, changes=${explicit?.changes?.length}, reason="${explicit?.reason}"`
  );
}

/* ------------------------------------------------------------------------------------- verdict */

const failed = results.filter((r) => !r.pass);
fs.writeFileSync(
  path.join(OUT, "P30.json"),
  JSON.stringify({ when: new Date().toISOString(), policy: POLICY, results }, null, 2)
);
if (JSON_ONLY) console.log(JSON.stringify({ results, failed: failed.length }, null, 2));
else console.log(`\n${results.length - failed.length}/${results.length} claims pass`);
process.exit(failed.length ? 1 : 0);
