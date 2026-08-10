#!/usr/bin/env node
/**
 * P35 — auto-tier: trust the measurement, not the guess. The proof.
 *
 *   node review/measure/P35.mjs                 # every claim, PASS/FAIL, exit 1 on any failure
 *   node review/measure/P35.mjs --only=A,B      # the offline groups only — no browser at all
 *   node review/measure/P35.mjs --only=C        # the live game only
 *   node review/measure/P35.mjs --json          # machine-readable only
 *
 * ## What round 2 got wrong, and what these claims have to show
 *
 * Round 2 scored 7.5/100 on one logic error: *"'corroborated' is currently implemented as 'a GPU
 * family was named', not 'the measurement matches the prediction'."* A UHD 600 capped at `medium`
 * was marked corroborated, so a 4.8 s boot storm bought a single 3-rung leap medium → potato, and
 * 3.3 minutes of flawless 16.6 ms frames afterwards restored nothing — `recoveryState()` answered
 * "corroborated by hardware evidence" for ever. The cliff was one second wide, and the two machines
 * that *did* recover were an RTX 4070 and a masked browser: the two that never needed help.
 *
 * So the claims below are written against machines, not against thresholds:
 *
 *   A  the policy, offline and deterministic, driven by **tier-responsive** frame streams
 *   B  the corroboration relation itself, and the one-rung invariant, under fuzz
 *   C  the seam: the real game, real measured frames, `quality:tier` reaching a real subscriber and
 *      the real renderer moving
 *
 * ## Why the simulated machines respond to the tier
 *
 * A stream that returns 40 ms no matter what tier is set cannot tell "this machine needs help" from
 * "this reading was never render cost" — which is precisely the distinction the whole round is
 * about. Every machine here is a cost *table*: `cost[tier]` ms per frame, and the driver advances
 * its own clock by the frame period it just produced, so a slow machine really does produce fewer
 * samples per second exactly as a real one does. A boot storm is then an additive term that decays,
 * and the machine underneath it is unchanged — which is the whole hypothesis under test.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { openGame, arg, has, ROOT } from "../../tools/lib/session.mjs";

const ONLY = (arg("only", "A,B,C") || "").split(",").map((s) => s.trim().toUpperCase());
const JSON_ONLY = has("json");
const OUT = path.join(ROOT, "review", "measure", "out", "P35");
fs.mkdirSync(OUT, { recursive: true });

const results = [];
function claim(id, title, ok, detail) {
  results.push({ id, title, pass: !!ok, detail });
  if (!JSON_ONLY) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${id}  ${title}`);
    if (detail) console.log(`        ${String(detail).split("\n").join("\n        ")}`);
  }
}
const note = (s) => {
  if (!JSON_ONLY) console.log(`        ${s}`);
};

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

const { TierPolicy, POLICY, startingTier, AutoTier, NEUTRAL_START } = await import(
  new URL("../../app/src/core/AutoTier.js", import.meta.url).href
);
const { config, TIERS, TIER_ORDER } = await import(
  new URL("../../app/src/core/Config.js", import.meta.url).href
);

const idx = (t) => TIER_ORDER.indexOf(t);

/* ------------------------------------------------------------------------------- the machines
 *
 * ms per frame at each tier. Each is a claim about a real class of hardware, and each is the number
 * the policy has to get right without ever being told which machine it is on.
 */
const MACHINES = {
  /** A genuinely weak part: misses at medium, misses at low, only `potato` is comfortable. */
  weak: { ultra: 130, high: 84, medium: 52, low: 31, potato: 18 },
  /**
   * Weak, but one rung of relief is enough — the case a multi-rung leap over-corrects.
   * 38 ms at medium is a real miss; 18.5 ms at low is 54 fps, inside the dead band and inside the
   * 21 ms floor. Round 2 would have read the 38 ms as `ceil(log2(38/21))` = 1 rung here, but a
   * marginally worse machine (45 ms) crossed to 2 and a storm on top of it crossed to 3.
   */
  marginal: { ultra: 95, high: 60, medium: 38, low: 18.5, potato: 14 },
  /** A vsync-locked desktop. Nothing should ever move. */
  fast: { ultra: 16.7, high: 16.6, medium: 16.6, low: 16.6, potato: 16.6 },
  /**
   * The UHD 600 / Iris Xe Chromebook the heuristic caps at `medium` — and which is *fine* at medium.
   * The heuristic's prediction is correct; a storm on top of it is not evidence against the part.
   */
  chromebook: { ultra: 61, high: 34, medium: 16.6, low: 14, potato: 12 },
};

/** Deterministic ±jitter so p10/p99 are real percentiles rather than a single repeated value. */
function lcg(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/**
 * Drive a policy with a machine, advancing the clock by each frame period it produces.
 *
 * @param policy      the TierPolicy under test
 * @param seconds     wall-clock seconds to simulate
 * @param machine     cost table, ms per frame per tier
 * @param opts.storm  `{ untilMs, addMs }` — an additive boot storm, gone after `untilMs`
 * @param opts.stallEveryMs / stallMs — an isolated multi-second freeze (tab switch, GC)
 */
function run(policy, seconds, machine, opts = {}) {
  const rnd = lcg(opts.seed ?? 12345);
  const jitter = opts.jitter ?? 0.45;
  const changes = [];
  const limit = seconds * 1000;
  let t = 0;
  let nextStall = opts.stallEveryMs ?? Infinity;
  let guard = 0;
  while (t < limit && guard++ < 4e6) {
    let ms;
    if (t >= nextStall) {
      ms = opts.stallMs ?? 4000; // an isolated freeze: real elapsed time, no render cost in it
      nextStall += opts.stallEveryMs;
    } else {
      const base = machine[policy.tier];
      ms = base + (rnd() - 0.5) * 2 * jitter;
      if (opts.storm && t < opts.storm.untilMs) ms += opts.storm.addMs;
    }
    const c = policy.sample(ms);
    if (c) changes.push({ ...c, atS: Number((t / 1000).toFixed(2)) });
    t += ms;
  }
  return changes;
}

/** The policy a real Chromebook boot produces: heuristic capped at medium, so that is the prediction. */
const cappedAtMedium = (over = {}) =>
  new TierPolicy("medium", { ceiling: "medium", predictedTier: "medium", ...over });

const line = (ch) =>
  ch.length
    ? ch
        .map(
          (c) =>
            `${(c.atS ?? c.at / 1000).toFixed(2)}s ${c.from}→${c.to}(${c.direction},${c.rungs}r,${c.medianMs}ms)`
        )
        .join(" · ")
    : "no changes";

/* ================================================================== A — machines, end to end */

if (ONLY.includes("A")) {
  // A1 — a genuinely weak machine settles DOWN and stays there.
  {
    const p = cappedAtMedium();
    const ch = run(p, 600, MACHINES.weak);
    const settledAt = ch.length ? ch[ch.length - 1].atS : 0;
    const afterSettle = ch.filter((c) => c.atS > settledAt);
    claim(
      "A1",
      "a genuinely weak machine steps down and stays down (10 min)",
      p.tier === "potato" &&
        ch.every((c) => c.direction === "down") &&
        p.recoveries === 0 &&
        afterSettle.length === 0,
      `${line(ch)} — final ${p.tier}, recoveries ${p.recoveries}, budget ${JSON.stringify(p.budget())}\n` +
        `why no revocation: ${p.recoveryState(p.lastStats).gate}`
    );
  }

  // A2 — a machine that only needed ONE rung takes one rung and stops. Round 2 leapt three.
  {
    const p = cappedAtMedium();
    const ch = run(p, 600, MACHINES.marginal);
    claim(
      "A2",
      "a machine one rung over budget takes exactly one rung",
      p.tier === "low" && ch.length === 1 && ch[0].rungs === 1,
      `${line(ch)} — final ${p.tier}; at low this machine measures ${MACHINES.marginal.low} ms, inside the ${POLICY.downMs} ms floor\n` +
        `revocation gate: ${p.recoveryState(p.lastStats).gate}`
    );
  }

  // A3 — a fast machine at its ceiling never moves.
  {
    const p = new TierPolicy("high", { ceiling: "high", predictedTier: "high" });
    const ch = run(p, 600, MACHINES.fast);
    claim(
      "A3",
      "a fast machine stays high for ten minutes",
      ch.length === 0 && p.tier === "high",
      `${line(ch)} — median ${p.lastStats.median.toFixed(2)} ms, p10 ${p.lastStats.p10.toFixed(2)}, p99 ${p.lastStats.p99.toFixed(2)}, ${p.accepted} frames scored`
    );
  }

  // A4 — THE round-2 scenario. The Chromebook capped at medium, a 5 s boot storm, then flawless.
  {
    const p = cappedAtMedium();
    const ch = run(p, 300, MACHINES.chromebook, { storm: { untilMs: 5000, addMs: 103 } });
    const ok = p.tier === "medium" && ch.every((c) => c.rungs === 1);
    claim(
      "A4",
      "a 5 s boot storm does not decide the session — the Chromebook ends at medium",
      ok,
      `${line(ch)} — final ${p.tier} (started medium). Route: ${ch.length === 0 ? "never stepped down at all" : "stepped down and recovered"}\n` +
        `storm was 120 ms frames for 5 s; the first window is ${POLICY.firstWindowMs} ms of rendered time and the tail is ${POLICY.tailMs} ms`
    );
  }

  // A5 — a storm long enough to genuinely buy a step down must then be GIVEN BACK.
  //      This is the claim round 2 failed outright: recovery unreachable on the machine that needed it.
  {
    const p = cappedAtMedium();
    const ch = run(p, 300, MACHINES.chromebook, { storm: { untilMs: 20000, addMs: 103 } });
    const downs = ch.filter((c) => c.direction === "down");
    const recs = ch.filter((c) => c.direction === "recover");
    claim(
      "A5",
      "a 20 s storm costs one rung and the rung is handed back once the machine is quiet",
      downs.length >= 1 && recs.length >= 1 && p.tier === "medium",
      `${line(ch)} — final ${p.tier}\n` +
        `descent: ${JSON.stringify(p.descent && { from: p.descent.from, to: p.descent.to, atMs: p.descent.at, medianMs: p.descent.medianMs, corroborated: p.descent.corroborated })}\n` +
        `recovery reason: ${recs[0]?.why ?? "—"}`
    );
  }

  // A6 — the round-2 cliff was ONE SECOND wide. Sweep the storm length and show there is no cliff.
  {
    const rows = [];
    for (let s = 0; s <= 24; s += 2) {
      const p = cappedAtMedium();
      run(p, 300, MACHINES.chromebook, { storm: { untilMs: s * 1000, addMs: 103 }, seed: 900 + s });
      rows.push({
        stormS: s,
        end: p.tier,
        changes: p.changes.length,
        maxRungs: p.changes.reduce((m, c) => Math.max(m, c.rungs), 0),
        downs: p.downSteps,
        recovered: p.recoveries,
      });
    }
    const allBack = rows.every((r) => r.end === "medium");
    const oneRung = rows.every((r) => r.maxRungs <= 1);
    claim(
      "A6",
      "no storm length between 0 s and 24 s ends the session below medium, and none leaps",
      allBack && oneRung,
      rows
        .map((r) => `${String(r.stormS).padStart(2)}s storm → ${r.end} (${r.changes} change(s), ${r.downs} down, ${r.recovered} recovered, max ${r.maxRungs} rung)`)
        .join("\n")
    );
  }

  // A7 — an isolated multi-second freeze is a stall, not a machine. It must be worth nothing.
  {
    const p = new TierPolicy("high", { ceiling: "high", predictedTier: "high" });
    const ch = run(p, 300, MACHINES.fast, { stallEveryMs: 12000, stallMs: 4200 });
    claim(
      "A7",
      "a 4.2 s freeze every 12 s changes nothing — a stall is not evidence about the GPU",
      ch.length === 0 && p.excursions >= 20 && p.stalledMs > 80000,
      `${p.excursions} excursions discarded (${(p.stalledMs / 1000).toFixed(1)} s of stall), ${p.accepted} frames scored, median ${p.lastStats.median.toFixed(2)} ms, ${ch.length} changes`
    );
  }

  // A8 — …but a *sustained* run of over-long frames is a machine at 2 fps and must get relief fast.
  {
    const p = cappedAtMedium();
    const ch = run(p, 240, { ultra: 500, high: 500, medium: 500, low: 480, potato: 60 });
    const firstAt = ch.length ? ch[0].atS : Infinity;
    claim(
      "A8",
      "a machine at 2 fps is not mistaken for a stall and gets relief inside 30 s",
      ch.length >= 1 && firstAt < 30 && p.tier === "potato",
      `${line(ch)} — first relief at ${firstAt} s, final ${p.tier}; ${p.excursions} periods over ${POLICY.sampleMaxMs} ms were winsorised rather than discarded`
    );
  }

  // A9 — the dead band. 54 fps forever must produce nothing at all.
  {
    const p = new TierPolicy("high", { ceiling: "high", predictedTier: "high" });
    const ch = run(p, 900, { ultra: 18.5, high: 18.5, medium: 18.5, low: 18.5, potato: 18.5 }, { jitter: 1.2 });
    claim(
      "A9",
      "no change anywhere in the dead band (54 fps, 15 minutes)",
      ch.length === 0,
      `median ${p.lastStats.median.toFixed(2)} ms, p10 ${p.lastStats.p10.toFixed(2)} ms, ${p.accepted} frames, ${ch.length} changes`
    );
  }

  // A10 — a borderline improvement is NOT a revocation. This is what keeps A1/A2 from bouncing.
  {
    const p = cappedAtMedium();
    run(p, 600, MACHINES.marginal);
    const st = p.recoveryState(p.lastStats);
    claim(
      "A10",
      "an improvement a tier step can explain never arms a revocation",
      p.recoveries === 0 && /consistent with the tier step/.test(st.gate ?? ""),
      `at ${p.tier}: ${st.gate}`
    );
  }
}

/* ============================================ B — the corroboration relation, and the invariants */

if (ONLY.includes("B")) {
  // B1 — the exact logic error the critic named. A miss measured AT the predicted tier falsifies.
  {
    const p = cappedAtMedium();
    const falsifiesAtMedium = p.corroboratesAt("medium");
    const falsifiesAtLow = p.corroboratesAt("low");
    const corroboratesAtHigh = p.corroboratesAt("high");
    claim(
      "B1",
      "corroboration is a relation: a miss AT the predicted tier falsifies it, a miss ABOVE it confirms",
      falsifiesAtMedium === false && falsifiesAtLow === false && corroboratesAtHigh === true,
      `predicted "medium" → corroboratesAt(medium)=${falsifiesAtMedium}, (low)=${falsifiesAtLow}, (high)=${corroboratesAtHigh}\n` +
        `round 2 answered this once at boot from the GPU string and got "true" for all three`
    );
  }

  // B2 — and it is wired: the descent record carries the verdict, and it gates the revocation.
  {
    const falsified = cappedAtMedium();
    run(falsified, 120, MACHINES.chromebook, { storm: { untilMs: 20000, addMs: 103 } });

    // The same machine, but the up-path put it ABOVE the prediction first: now a miss corroborates.
    const promoted = new TierPolicy("medium", { ceiling: "high", predictedTier: "medium" });
    // Headroom at medium buys one promotion to high; at high this part measures 34 ms, so the same
    // stream then takes it straight back down — and *that* descent is the prediction coming true.
    run(promoted, 300, MACHINES.chromebook);
    const wasPromoted = promoted.changes.some((c) => c.direction === "up" && c.to === "high");
    const d = promoted.descent;
    claim(
      "B2",
      "the same part: a miss at the capped tier is revocable, a miss above it is final",
      falsified.descent?.corroborated === false &&
        wasPromoted &&
        d?.corroborated === true &&
        promoted.budget().recoveriesLeft === 0,
      `falsified: ${falsified.descent?.from}→${falsified.descent?.to} corroborated=${falsified.descent?.corroborated}, recoveries used ${falsified.recoveries}\n` +
        `promoted: medium→high→${promoted.tier}, descent corroborated=${d?.corroborated}, recoveriesLeft ${promoted.budget().recoveriesLeft}\n` +
        `promoted gate: ${promoted.recoveryState(promoted.lastStats).gate}`
    );
  }

  // B3 — the one-rung invariant, under fuzz. No stream may ever produce a multi-rung change.
  {
    const bad = [];
    let totalChanges = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const rnd = lcg(seed * 7919);
      const start = TIER_ORDER[1 + Math.floor(rnd() * 4)];
      const p = new TierPolicy(start, {
        ceiling: start,
        predictedTier: TIER_ORDER[Math.max(0, idx(start) - Math.floor(rnd() * 3))],
      });
      // A hostile machine: random cost per tier, random storm, random freezes, random jitter.
      const scale = 6 + rnd() * 120;
      const machine = Object.fromEntries(
        TIER_ORDER.map((t, i) => [t, Math.max(3, scale * (1 - i * 0.12) * (0.55 + rnd() * 1.1))])
      );
      const ch = run(p, 240, machine, {
        seed: seed * 31,
        jitter: rnd() * 6,
        storm: rnd() < 0.6 ? { untilMs: rnd() * 30000, addMs: rnd() * 250 } : null,
        stallEveryMs: rnd() < 0.4 ? 3000 + rnd() * 20000 : Infinity,
        stallMs: 300 + rnd() * 6000,
      });
      totalChanges += ch.length;
      for (const c of ch) {
        if (c.rungs !== 1 || Math.abs(idx(c.to) - idx(c.from)) !== 1) {
          bad.push(`seed ${seed}: ${c.from}→${c.to} (${c.rungs} rungs)`);
        }
      }
      if (p.changes.length > POLICY.maxChanges) bad.push(`seed ${seed}: ${p.changes.length} changes`);
      if (idx(p.tier) > idx(p.ceiling)) bad.push(`seed ${seed}: ended ${p.tier} above ceiling ${p.ceiling}`);
    }
    claim(
      "B3",
      "400 hostile streams: every change is exactly one rung, inside budget, under the ceiling",
      bad.length === 0,
      bad.length ? bad.slice(0, 8).join("\n") : `${totalChanges} changes across 400 sessions, all single-rung`
    );
  }

  // B4 — no oscillation: a down-step is never followed by an ordinary up-step, and a revocation
  //      that is followed by a down-step locks the ratchet for good.
  {
    const bad = [];
    for (let seed = 1; seed <= 400; seed++) {
      const rnd = lcg(seed * 104729);
      const p = cappedAtMedium();
      const scale = 8 + rnd() * 60;
      const machine = Object.fromEntries(
        TIER_ORDER.map((t, i) => [t, Math.max(3, scale * (1 - i * 0.15) * (0.6 + rnd() * 0.9))])
      );
      const ch = run(p, 400, machine, {
        seed: seed * 13,
        jitter: rnd() * 4,
        storm: rnd() < 0.7 ? { untilMs: rnd() * 40000, addMs: rnd() * 200 } : null,
      });
      let sawDown = false;
      for (const c of ch) {
        if (c.direction === "down") sawDown = true;
        if (c.direction === "up" && sawDown) bad.push(`seed ${seed}: up-step after a down-step`);
      }
      if (p.recoveries > POLICY.maxRecoveries) bad.push(`seed ${seed}: ${p.recoveries} recoveries`);
      if (p.recoveries > 0 && ch.some((c, i) => c.direction === "down" && ch.slice(0, i).some((x) => x.direction === "recover")) && !p.locked) {
        bad.push(`seed ${seed}: a down-step followed a revocation and the ratchet is not locked`);
      }
    }
    claim(
      "B4",
      "400 streams: no up-step ever follows a down-step, and a failed revocation locks the ratchet",
      bad.length === 0,
      bad.length ? bad.slice(0, 8).join("\n") : "no oscillation in 400 sessions"
    );
  }

  // B5 — the heuristic still predicts the machines it exists for.
  {
    const cases = [
      ["ANGLE (Intel, Intel(R) UHD Graphics 600 Direct3D11 vs_5_0 ps_5_0)", 8, 4, 16384, true, "medium"],
      ["ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)", 8, 8, 16384, true, "medium"],
      ["ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11)", 16, 32, 16384, true, "high"],
      ["WebKit WebGL", 8, 8, 16384, true, NEUTRAL_START],
      ["Mali-G57 MC2", 8, 4, 8192, true, "medium"],
      ["Mali-T860", 4, 4, 4096, false, "low"],
      // …and the same part in a 2 GB netbook: memory caps below everything else. The heuristic is
      // a *minimum* over its rules, so the weakest legible signal wins.
      ["Mali-T860", 4, 2, 4096, false, "potato"],
    ];
    const rows = cases.map(([renderer, cores, memoryGB, maxTextureSize, webgl2, want]) => {
      const got = startingTier(
        { renderer, vendor: "x", cores, memoryGB, maxTextureSize, webgl2, devicePixelRatio: 1, viewport: [1366, 768] },
        "high"
      );
      return { renderer: renderer.slice(0, 46), want, got: got.tier, caps: got.caps.length, ok: got.tier === want };
    });
    claim(
      "B5",
      "the first-frame heuristic predicts the tier for the fleet this game is for",
      rows.every((r) => r.ok),
      rows.map((r) => `${r.ok ? "ok " : "NO "} ${r.renderer.padEnd(48)} → ${r.got} (want ${r.want}, ${r.caps} cap(s))`).join("\n")
    );
  }

  // B6 — an explicit choice stands the module down, at boot and mid-session, against the real class.
  {
    const scene = { traverse() {} };
    const stub = () => {
      let resizes = 0;
      return {
        renderer: {
          getPixelRatio: () => 1,
          shadowMap: { enabled: true, needsUpdate: false },
          domElement: { width: 100, height: 100 },
          getContext: () => {
            throw new Error("no gl");
          },
          capabilities: {},
        },
        scene,
        resize() {
          resizes++;
        },
        mount() {},
        get: () => undefined,
        resizes: () => resizes,
      };
    };

    // (a) at boot: ?tier=low
    globalThis.location = { search: "?tier=low" };
    config.values.tier = "low";
    config.values.autoTier = false;
    const k1 = stub();
    const bootChoice = new AutoTier(k1);
    for (let i = 0; i < 2000; i++) bootChoice.frame();

    // (b) mid-session: measuring, then a settings screen calls config.set("tier", …).
    //     The tier chosen here is deliberately the one the *heuristic already applied* — that is the
    //     common case (a player agreeing with the measurement) and it is the case `Config.set`'s
    //     equality guard used to swallow, leaving auto-tiering running under a player who had just
    //     told it to stop.
    globalThis.location = { search: "?autotier=force" };
    config.values.tier = "high";
    config.values.autoTier = true;
    const k2 = stub();
    const mid = new AutoTier(k2);
    for (let i = 0; i < 40; i++) mid.frame();
    const enabledBefore = mid.enabled;
    const agreedWith = config.get("tier"); // whatever the heuristic just applied
    config.set("tier", agreedWith);
    for (let i = 0; i < 400; i++) mid.frame();

    claim(
      "B6",
      "an explicit ?tier= stands auto-tiering down, at boot and mid-session",
      bootChoice.enabled === false &&
        bootChoice.history.length === 0 &&
        bootChoice.policy.changes.length === 0 &&
        enabledBefore === true &&
        mid.enabled === false &&
        mid.standDown?.applied === true &&
        config.get("autoTier") === false,
      `boot: enabled=${bootChoice.enabled}, "${bootChoice.reason}", ${bootChoice._frames} frames, ${bootChoice.history.length} changes\n` +
        `mid: player chose "${agreedWith}", the tier the heuristic had already applied — enabled ${enabledBefore} → ${mid.enabled} at frame ${mid.standDown?.atFrame}, player tier ${mid.standDown?.playerTier}, renderer re-applied=${mid.standDown?.applied}, autoTier now ${config.get("autoTier")}`
    );
    // leave the singleton where the browser group expects it
    config.values.tier = "high";
    config.values.autoTier = true;
  }

  // B7 — the budget a session can actually spend. Round 2 ended "changesLeft 2, recoveriesLeft 0".
  {
    const p = cappedAtMedium();
    run(p, 120, MACHINES.chromebook, { storm: { untilMs: 20000, addMs: 103 } });
    const afterDown = p.budget();
    claim(
      "B7",
      "after a falsified descent the revocation budget is spendable, not decorative",
      p.downSteps >= 1 && afterDown.recoveriesLeft > 0,
      `after the storm: tier ${p.tier}, ${JSON.stringify(afterDown)}\n` +
        `round 2 reported recoveriesLeft 0 here because "provisional" was false on any capped machine`
    );
  }

  /**
   * B8 — the two invariants `review/measure/P30.mjs` D1 and A21 carried, restated here because that
   * file encodes the round-2 policy this round replaced and its numbers no longer describe anything.
   *
   *  (a) the heuristic's cap is the measurement's ceiling: holding vsync at `medium` is not evidence
   *      that `high` is affordable, and a correctly-capped Chromebook must never be promoted past it;
   *  (b) a descent that keeps going past `recoveryArmMs` is a machine walking itself down, not one
   *      early episode, and it must lose the revocation permanently.
   */
  {
    // (a) the capped Chromebook holds 60 Hz at medium for ten minutes, then the scene gets heavy.
    const capped = cappedAtMedium();
    run(capped, 600, MACHINES.chromebook);
    const promotedPastCap = capped.changes.some((c) => c.direction === "up");
    const afterVsync = capped.tier;
    const changesAfterVsync = capped.changes.length;
    run(capped, 300, { ...MACHINES.chromebook, medium: 40 });

    // (b) a weak part from ultra: four one-rung steps walk it to the floor, and the last is late.
    const walking = new TierPolicy("ultra", { ceiling: "ultra", predictedTier: "ultra" });
    run(walking, 240, MACHINES.weak);
    const lastDown = walking.changes.filter((c) => c.direction === "down").pop();
    run(walking, 300, MACHINES.fast); // …and then it is flawless, which must buy nothing

    claim(
      "B8",
      "the heuristic's cap is the ceiling, and a descent past the arming window loses its revocation",
      !promotedPastCap &&
        afterVsync === "medium" &&
        capped.tier === "low" &&
        walking.descent?.late === true &&
        walking.budget().recoveriesLeft === 0 &&
        walking.recoveries === 0,
      `(a) capped at medium: 10 min of vsync → ${afterVsync} (${changesAfterVsync} change(s), ups ${capped.upSteps}); then heavy → ${capped.tier} (${capped.changes.length} total), ceiling ${capped.ceiling}\n` +
        `(b) walking down: ${line(walking.changes)}\n` +
        `    last down-step at ${lastDown?.at} ms vs arm window ${POLICY.recoveryArmMs} ms → late=${walking.descent?.late}; ` +
        `after 5 min of flawless frames: ${walking.recoveries} recoveries, gate "${walking.recoveryState(walking.lastStats).gate}"`
    );
  }

  /**
   * B9 — a revocation that turns out to be wrong is caught by the ordinary down path, costs one
   * further change, and **locks the ratchet for the session**. Without this the revocation path
   * would be exactly the promote/demote oscillation the `downSteps` lock exists to prevent.
   */
  {
    const p = cappedAtMedium();
    run(p, 120, MACHINES.chromebook, { storm: { untilMs: 20000, addMs: 103 } });
    const recovered = p.tier === "medium" && p.recoveries === 1;
    // The revocation was wrong: this part is genuinely 40 ms at medium from here on.
    run(p, 200, { ...MACHINES.chromebook, medium: 40 });
    const caughtAt = p.tier;
    // …and now it goes quiet again. It must never be handed the rung back a second time.
    run(p, 400, MACHINES.chromebook);
    claim(
      "B9",
      "a wrong revocation is caught, locks the ratchet, and is never repeated",
      recovered && caughtAt === "low" && p.locked === true && p.recoveries === 1 && p.tier === "low",
      `${line(p.changes)}\n` +
        `after the wrong revocation: locked=${p.locked}, recoveries ${p.recoveries}/${POLICY.maxRecoveries}, final ${p.tier}\n` +
        `gate now: ${p.recoveryState(p.lastStats).gate}`
    );
  }
}

/* ============================================================== C — the seam, in the real game */

let browser = null;
if (ONLY.includes("C")) {
  const BUILT = !has("dev");
  if (BUILT && !has("no-build")) {
    execFileSync("npx", ["vite", "build", "--logLevel", "warn"], { cwd: ROOT, stdio: "inherit", shell: true });
  }

  // Small viewport, 2x device scale factor: `config.pixelRatio()` is `min(devicePixelRatio,
  // tier.maxPixelRatio)`, so at DPR 1 every tier from high down to potato clamps to 1 and the pixel
  // ratio claim would be unfalsifiable. At DPR 2 the ladder is 1.5 / 1.25 / 1 / 1 and visible.
  const W = 480;
  const H = 270;

  const QUERY = {
    // Opt back in on the software rasteriser: this run *wants* the apply path exercised.
    autotier: "force",
    // The shipped windows are 6 s / 12 s of rendered time. SwiftShader renders this scene at a few
    // frames per second, so the shipped numbers would need minutes per decision; these are the same
    // *shape* (first window half the steady one) compressed to fit a review session. The frame
    // count knobs are left alone — time is what decides now, which is the point of the round.
    autotierWindowMs: "4000",
    autotierWarmupMs: "1500",
    autotierWarmup: "20",
    autotierCooldown: "2000",
  };

  browser = await openGame({ width: W, height: H, scale: 2, built: BUILT, query: QUERY }, async (d) => {
    const ready = () =>
      d.page.waitForFunction(() => window.__vs && (window.__vs.ready || window.__vs.fatal), {
        timeout: 90000,
      });

    /** A dozen agents write to `app/` while this runs; an HMR reload restarts the phase. */
    let reloads = 0;
    async function phase(fn, attempts = 4) {
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
     * The one measurement in this project that must not use `__vs.advance()`: the quantity under
     * test IS wall-clock frame cost, and `advance()` never presents a frame, so an advance-driven
     * loop reports sub-millisecond "frames" on a rasteriser really running at 5 fps.
     */
    async function driveUntil(done, maxMs) {
      const t0 = Date.now();
      for (;;) {
        const p = await d.probe("autotier");
        if (done(p) || Date.now() - t0 > maxMs) return p;
        await d.page.waitForTimeout(500);
      }
    }

    const measured = await phase(async () => {
      const boot = await d.report();
      const probe0 = await d.probe("autotier");
      const post0 = await d.probe("post");
      const signalNames = await d.page.evaluate(() =>
        window.__vs.kernel.signals ? window.__vs.kernel.signals.names() : null
      );
      const after = await driveUntil(
        (p) => (p?.changes?.filter((c) => c.direction !== "heuristic").length ?? 0) >= 1,
        150000
      );
      await d.page.waitForTimeout(6000);
      return {
        boot,
        probe0,
        post0,
        signalNames,
        after,
        settled: await d.probe("autotier"),
        post1: await d.probe("post"),
      };
    });

    // Second load: an explicit choice at boot must stand the module down entirely.
    const chosen = await phase(async () => {
      const u = new URL(d.url);
      u.search = "?tier=low";
      await d.page.goto(u.toString(), { waitUntil: "load", timeout: 90000 });
      await ready();
      await d.page.waitForTimeout(6000);
      return { explicit: await d.probe("autotier"), explicitPost: await d.probe("post") };
    });

    return { ...measured, ...chosen, reloads, consoleErrors: d.consoleErrors.slice(0, 10) };
  });

  fs.writeFileSync(path.join(OUT, "session.json"), JSON.stringify(browser, null, 2));

  const { boot, probe0, post0, post1, settled, signalNames, explicit } = browser;

  /** Errors other pieces are answerable for; `main.js` isolates a failing boot module by design. */
  const FOREIGN = /itembank|62-learning|63-learnserve|content\/items\/groups/i;
  const mine = (errors) => (errors ?? []).filter((e) => !FOREIGN.test(String(e)));

  claim(
    "C1",
    "the game boots with auto-tiering mounted and no errors of its own",
    !boot.fatal && mine(boot.errors).length === 0 && probe0?.enabled === true,
    `fatal=${boot.fatal ?? "null"}, errors mine=${mine(boot.errors).length} foreign=${(boot.errors?.length ?? 0) - mine(boot.errors).length}, HMR reloads survived=${browser.reloads}\n` +
      `start ${probe0?.startTier}, ceiling ${probe0?.ceiling} (${probe0?.ceilingSource}), predicted ${probe0?.prediction?.predictedTier}, GPU "${probe0?.heuristic?.env?.renderer}"`
  );

  // C2 — THE SEAM. `quality:tier` has a real subscriber in the shipped app.
  const subscribed = probe0?.signal?.subscribed === true;
  const postSubscribed = post0?.tierSignal?.subscribed === true;
  claim(
    "C2",
    "quality:tier has a listener in the shipped app (it had none — tools/seams.mjs)",
    subscribed && postSubscribed && Array.isArray(signalNames) && signalNames.includes("quality:tier"),
    `autotier probe: signal.subscribed=${subscribed}; post probe: tierSignal.subscribed=${postSubscribed}\n` +
      `live signal registry contains "quality:tier": ${Array.isArray(signalNames) ? signalNames.includes("quality:tier") : "registry not exposed"}`
  );

  const changes = (settled?.changes ?? []).filter((c) => c.direction !== "heuristic");
  const downs = changes.filter((c) => c.direction === "down" && c.applied);
  claim(
    "C3",
    "real measured frame cost steps the tier down in the real game, one rung",
    downs.length >= 1 &&
      downs.every((c) => c.rungs === 1) &&
      downs.every((c) => c.medianMs > settled.thresholds.downMs) &&
      // Guard: a non-presenting loop reports sub-millisecond "frames". Under 5 ms here means the
      // instrument, not the machine.
      downs.every((c) => c.medianMs > 5),
    downs.length
      ? downs.map((c) => `${c.from}→${c.to} (${c.rungs} rung) at ${c.medianMs} ms median (${c.fps} fps) over ${c.frames} frames / ${(c.spanMs / 1000).toFixed(1)} s rendered`).join("; ")
      : `no applied down step; tier ${settled?.tier}, measured ${JSON.stringify(settled?.measured)}`
  );

  const first = downs[0];
  const last = downs[downs.length - 1];
  const pixelMoved = first && last && last.after.pixelRatio < first.before.pixelRatio;
  const bufferShrank =
    first && last && last.after.drawingBuffer[0] * last.after.drawingBuffer[1] <
      first.before.drawingBuffer[0] * first.before.drawingBuffer[1];
  const shadowShrank = first && last && last.after.shadowMapSize < first.before.shadowMapSize;
  claim(
    "C4",
    "the RENDERER moved, not a config value: pixel ratio, drawing buffer and shadow maps",
    pixelMoved && bufferShrank && shadowShrank && last.after.shadowCasters > 0,
    first && last
      ? `renderer.getPixelRatio() ${first.before.pixelRatio} → ${last.after.pixelRatio}; drawing buffer ${first.before.drawingBuffer.join("x")} → ${last.after.drawingBuffer.join("x")}; shadow map ${first.before.shadowMapSize}² → ${last.after.shadowMapSize}² across ${last.after.shadowCasters} caster(s); shadowMap.enabled ${first.before.shadowMapEnabled} → ${last.after.shadowMapEnabled}`
      : "no applied change to inspect"
  );

  // C5 — the post stack followed the tier THROUGH THE SIGNAL, not through the private bridge.
  const viaSignal = changes.filter((c) => c.applied).every((c) => c.post === "signal");
  const postFollowed =
    post0 && post1 && JSON.stringify(post0.effects) !== JSON.stringify(post1.effects);
  claim(
    "C5",
    "the post stack followed the tier down, and it arrived on the signal",
    viaSignal && postFollowed && post1?.tierSignal?.applied?.tier === settled?.tier,
    `route on every applied change: ${changes.filter((c) => c.applied).map((c) => c.post).join(", ") || "—"}\n` +
      `post effects ${JSON.stringify(post0?.effects)} → ${JSON.stringify(post1?.effects)}; installed ${post0?.installed} → ${post1?.installed}; passes ${post0?.postDrawCalls} → ${post1?.postDrawCalls}\n` +
      `PostStack recorded: ${JSON.stringify(post1?.tierSignal?.applied)}`
  );

  claim(
    "C6",
    "no multi-rung leap and no oscillation in the live session",
    changes.length > 0 &&
      changes.every((c) => c.rungs === 1) &&
      changes.filter((c) => c.direction === "up").length === 0 &&
      changes.length <= settled.thresholds.maxChanges,
    `${changes.length} change(s): ${changes.map((c) => `${c.from}→${c.to}(${c.direction},${c.rungs}r,post=${c.post})`).join(", ")}\n` +
      `budget ${JSON.stringify(settled.budget)}; final tier ${settled.tier}; window ${settled.thresholds.firstWindowMs}/${settled.thresholds.windowMs} ms; excursions ${settled.samples?.excursions}, stalled ${settled.samples?.stalledMs} ms`
  );

  claim(
    "C7",
    "?tier=low stands the module down in the real game",
    explicit?.enabled === false &&
      explicit?.autoTierSetting === false &&
      (explicit?.changes?.length ?? 0) === 0 &&
      explicit?.tier === "low",
    `enabled=${explicit?.enabled}, autoTier=${explicit?.autoTierSetting}, tier=${explicit?.tier}, ${explicit?.frames} frames observed, ${explicit?.changes?.length ?? 0} changes, reason "${explicit?.reason}"`
  );
}

/* ------------------------------------------------------------------------------------- summary */

const failed = results.filter((r) => !r.pass);
fs.writeFileSync(
  path.join(OUT, "P35.json"),
  JSON.stringify({ at: new Date().toISOString(), only: ONLY, results }, null, 2)
);
if (JSON_ONLY) console.log(JSON.stringify({ results, failed: failed.length }, null, 2));
else {
  console.log(`\n${results.length - failed.length}/${results.length} claims pass`);
  if (failed.length) console.log(`FAILED: ${failed.map((r) => r.id).join(", ")}`);
}
process.exit(failed.length ? 1 : 0);
