#!/usr/bin/env node
/**
 * P30 — measured Chromebook auto-tiering. The proof.
 *
 *   node review/measure/P30.mjs                 # every claim, PASS/FAIL, exit 1 on any failure
 *   node review/measure/P30.mjs --only=A,B,D    # the offline groups only — no browser at all
 *   node review/measure/P30.mjs --json          # machine-readable only
 *   node review/measure/P30.mjs --dev           # measure the dev server instead of a fresh build
 *
 * ## Why most of this runs with no browser
 *
 * The claims that matter here are about *policy under adversarial frame-time streams*: that a noisy
 * machine sitting on the threshold does not oscillate, that a step up can never follow a step down,
 * that the session budget binds, that a machine at 2 fps gets relief in seconds rather than in
 * minutes. Those need thousands of frames of specific shapes — hundreds of headless renders to
 * observe once, and a human is playtesting on this machine right now. So the decision half of
 * `core/AutoTier.js` is written as a pure class with its own clock, and groups A, B and D drive it
 * directly in Node: deterministic, exhaustive, and free.
 *
 * The browser half then proves the one thing a pure class cannot: that a decision *lands* — that
 * `renderer.getPixelRatio()`, `renderer.shadowMap.enabled`, the lights' `shadow.mapSize` and the
 * post stack really moved, on real measured frames, in the real game. Group C boots once, drives
 * real renders through the software rasteriser (which genuinely cannot hold 60 Hz, so the load is
 * not simulated at all), and reads the probe. **No screenshots are taken** — every claim here is a
 * number, and a picture would only cost the playtest CPU.
 *
 * Groups:
 *   A  the policy: hysteresis, no oscillation, budgets, ceilings, time-to-relief  (offline, pure)
 *   B  the first-frame hardware heuristic                                         (offline, pure)
 *   D  the wiring: the real `AutoTier` against a stub kernel — ceiling source and
 *      the mid-session stand-down                                                 (offline)
 *   C  a decision lands in the real renderer, and an explicit choice — at boot *and mid-session* —
 *      stands the module down                                                     (one session)
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { openGame, arg, has, ROOT } from "../../tools/lib/session.mjs";

const ONLY = (arg("only", "A,B,C,D") || "").split(",").map((s) => s.trim().toUpperCase());
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
// Node ships a read-only `navigator`; `inspectDevice` only ever reads from it, and group B feeds
// its environment in explicitly, so whatever Node reports here is inert.

const { TierPolicy, POLICY, startingTier, isSoftwareRaster, AutoTier, NEUTRAL_START } = await import(
  new URL("../../app/src/core/AutoTier.js", import.meta.url).href
);
const { config, TIERS } = await import(new URL("../../app/src/core/Config.js", import.meta.url).href);

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

  // A3 — a hitchy 60 fps is not headroom. p99 blown by 1 frame in 40 must block the up path.
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

  // A8 — the session budget binds: at most `maxChanges`, whatever the machine does. 40 ms is 1.9x
  // the floor, which is inside the leap threshold, so this is the one-rung-at-a-time path.
  {
    const p = new TierPolicy("ultra", { ceiling: "ultra" });
    const ch = drive(p, 100000, () => 40);
    claim(
      "A8",
      `at most ${POLICY.maxChanges} tier changes per session`,
      ch.length === POLICY.maxChanges &&
        p.tier === "low" &&
        ch.every((c) => c.rungs === 1) &&
        p.budget().changesLeft === 0,
      `100 000 frames at 40 ms (1.9x the floor — one rung each) → ${ch.length} change(s), ultra → ${p.tier}; budget ${JSON.stringify(p.budget())}`
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

  // A11 — the ceiling. Auto-tiering hands work back; it never promotes past what it was given.
  {
    const p = new TierPolicy("high", { ceiling: "high" });
    const ch = drive(p, 40000, () => 4);
    claim(
      "A11",
      "never promotes above the ceiling it was given",
      ch.length === 0 && p.tier === "high",
      `40 000 frames at 4 ms (250 fps) at the ceiling → ${ch.length} change(s)`
    );
  }

  // A12 — potato is the floor. Corroborated hardware (`provisional: false`), so the leap is on.
  {
    const p = new TierPolicy("medium", { ceiling: "medium", maxChanges: 99, provisional: false });
    const ch = drive(p, 100000, () => 200);
    claim(
      "A12",
      "potato is the floor — no change is attempted below it",
      p.tier === "potato" && ch.length === 1 && ch[0].rungs === 3,
      `medium → ${p.tier} in ${ch.length} change(s) of ${ch[0]?.rungs} rung(s) (a 3-rung leap clamped at the floor), then 100 000 further frames at 200 ms produced none`
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

  /**
   * A14 — the leap, on hardware that corroborates it. Round 1 stepped exactly one rung per decision
   * and then waited a whole window to learn what the median already said, so `maxChanges: 3` could
   * not carry `ultra` to `potato` at all. At 100 ms the policy knows `medium` will not save this
   * machine.
   *
   * `provisional: false` is what `AutoTier` passes when the heuristic capped the tier on a renderer
   * string or a capability number: on that machine a catastrophic median is the *predicted* result,
   * so it is acted on at full size and immediately.
   */
  {
    const rows = [
      { ms: 30, want: 1 },
      { ms: 45, want: 2 },
      { ms: 100, want: 3 },
      { ms: 250, want: 3 },
    ];
    const got = rows.map((r) => {
      const p = new TierPolicy("ultra", { ceiling: "ultra", provisional: false });
      const ch = drive(p, 3000, () => r.ms);
      const q = new TierPolicy("ultra", { ceiling: "ultra" }); // uncorroborated: the same stream
      const qch = drive(q, 3000, () => r.ms);
      return {
        ...r,
        rungs: ch[0]?.rungs ?? 0,
        first: ch[0] ? `${ch[0].from}→${ch[0].to}` : "none",
        provisionalRungs: qch[0]?.rungs ?? 0,
      };
    });
    claim(
      "A14",
      "a corroborated, catastrophically over-budget median leaps more than one rung, in one change",
      got.every((g) => g.rungs === g.want) &&
        got.every((g) => g.provisionalRungs === POLICY.firstMaxLeap),
      got
        .map(
          (g) =>
            `${g.ms} ms (${(g.ms / POLICY.downMs).toFixed(1)}x floor) → ${g.rungs} rung(s) ${g.first}, uncorroborated ${g.provisionalRungs}`
        )
        .join("; ")
    );
  }

  /**
   * A15 — the claim the whole round is about: **time to first relief**.
   *
   * Round 1 shipped `warmupFrames 90 + windowFrames 120`, so the first down-step could not fire
   * until 210 scored frames had elapsed — 21.0 s at 10 fps, 42.0 s at 5 fps, 107.0 s at 2 fps, and
   * reaching `low` took 42 / 84 / 212 s. The slower the machine, the longer it sat at the tier it
   * could not afford, which inverts the whole purpose of the module.
   */
  {
    const rows = [10, 5, 2].map((fps) => {
      const p = new TierPolicy("high", { ceiling: "high" });
      let firstAt = null;
      let settledAt = null;
      for (let i = 0; i < 200000; i++) {
        const c = p.sample(1000 / fps);
        if (c) {
          if (firstAt === null) firstAt = p.clock;
          settledAt = p.clock;
        }
        if (p.tier === "potato") break;
      }
      return { fps, firstAt, settledAt, tier: p.tier, changes: p.changes.length };
    });
    claim(
      "A15",
      "first relief inside 10 s at 10, 5 and 2 fps (round 1: 21 s / 42 s / 107 s)",
      rows.every((r) => r.firstAt !== null && r.firstAt <= 10000),
      rows
        .map(
          (r) =>
            `${r.fps} fps → first step at ${(r.firstAt / 1000).toFixed(1)} s, ${r.tier} at ${(r.settledAt / 1000).toFixed(1)} s in ${r.changes} change(s)`
        )
        .join("; ")
    );
  }

  /**
   * A16 — the other half of the trade. The conservative starting tier is only affordable because
   * the up-path buys `high` back quickly on a machine that can hold it.
   */
  {
    const rows = [
      { hz: 60, ms: 16.6 },
      { hz: 144, ms: 6.94 },
    ].map((r) => {
      const p = new TierPolicy(NEUTRAL_START, { ceiling: "high" });
      const ch = drive(p, 40000, (i) => r.ms + (i % 7) * 0.05);
      return { ...r, at: ch[0]?.at ?? null, to: ch[0]?.to ?? null, n: ch.length };
    });
    claim(
      "A16",
      `a display-locked machine is promoted ${NEUTRAL_START} → high inside 4 s`,
      rows.every((r) => r.to === "high" && r.n === 1 && r.at <= 4000),
      rows.map((r) => `${r.hz} Hz → ${NEUTRAL_START}→${r.to} at ${(r.at / 1000).toFixed(1)} s (${r.n} change total)`).join("; ")
    );
  }

  /**
   * A17 — the short first window is down-only. Promotion always waits for the full steady-state
   * window, because the p99 jitter gate cannot see a 1-in-40 stutter in 45 samples (A3 is that
   * failure, and it bought a step up nothing had earned when the short window was let near it).
   */
  {
    const p = new TierPolicy("low", { ceiling: "high" });
    const ch = drive(p, 40000, () => 8);
    claim(
      "A17",
      "no up-step is ever taken on the short first window",
      ch.length === 1 && ch[0].frames === POLICY.windowFrames && ch[0].frames > POLICY.firstWindowFrames,
      `the one promotion was decided on ${ch[0]?.frames} frames (steady window ${POLICY.windowFrames}, first window ${POLICY.firstWindowFrames})`
    );
  }

  /* ------------------------------------------------------ the boot storm, and revoking a descent
   *
   * A18-A23 are this round's group. The failure they exist for, measured on the round-2 policy:
   * four seconds of 120 ms frames at boot — thirty Chromebooks finishing their downloads on one
   * classroom access point — bought a single 3-rung leap to `potato` at 4.1 s, and because
   * `downSteps > 0` blocks every promotion, three minutes of flawless 60 Hz afterwards still ended
   * the session at `potato`. No claim in the round-2 script drove a transient at all.
   */

  /** The exact stream from the verdict: 120 ms for 4 s, then 60 Hz for three minutes. */
  {
    const p = new TierPolicy("high", { ceiling: "high" });
    const ch = [];
    for (let t = 0; t < 4000; t += 120) {
      const c = p.sample(120);
      if (c) ch.push(c);
    }
    ch.push(...drive(p, 12000, (i) => 16.6 + (i % 7) * 0.05)); // ~3.4 minutes of vsync
    const down = ch.find((c) => c.direction === "down");
    const back = ch.find((c) => c.direction === "recover");
    claim(
      "A18",
      "a 4 s boot storm costs one rung for 24 s, not the session (round 2: potato, for ever)",
      ch.length === 2 &&
        down?.rungs === 1 &&
        down?.to === "medium" &&
        back?.to === "high" &&
        p.tier === "high" &&
        p.budget().changesLeft === 1,
      `${ch.map((c) => `${c.from}→${c.to}(${c.direction},${c.rungs}r) at ${(c.at / 1000).toFixed(1)} s`).join("; ")}; ` +
        `final ${p.tier}, budget ${JSON.stringify(p.budget())}. Round 2 on this exact stream: high→potato (3 rungs) at 4.1 s and no way back.`
    );
    note(`the revocation's own reason: ${back?.why ?? "—"}`);
  }

  /**
   * A19 — the storm that decays before the window fills costs nothing at all. The control is the
   * same stream with `tailFraction: 1`, which makes the tail *be* the median — i.e. the round-2
   * policy — and it steps down.
   */
  {
    const stormy = (endMs, opts) => {
      const p = new TierPolicy("high", { ceiling: "high", ...opts });
      const ch = [];
      let t = 0;
      for (let i = 0; i < 20000; i++) {
        const ms = t < endMs ? 40 : 16.6 + (i % 7) * 0.05;
        t += ms;
        const c = p.sample(ms);
        if (c) ch.push(c);
      }
      return { tier: p.tier, n: ch.length };
    };
    const gated = stormy(2600, {});
    const control = stormy(2600, { tailFraction: 1, tailMinFrames: 1 });
    claim(
      "A19",
      "a storm already over when the window fills produces no change (the tail gate)",
      gated.n === 0 && gated.tier === "high" && control.n === 1 && control.tier === "medium",
      `40 ms until 2.6 s then vsync: with the tail gate ${gated.n} change(s), tier ${gated.tier}; with the tail disabled (tail = median, the round-2 rule) ${control.n} change(s), tier ${control.tier}`
    );
  }

  /**
   * A20 — the discriminator, stated as the case it must *refuse*. A machine that genuinely costs
   * 30 ms at `high` and hits vsync at `medium` improved by exactly as much as a rung is worth. It is
   * not a storm, and it must never be probed back up — that would be the oscillation loop.
   */
  {
    const p = new TierPolicy("high", { ceiling: "high" });
    const ch = drive(p, 60000, () => (p.tier === "high" ? 30 : 16.6 + (p.accepted % 7) * 0.05));
    const state = p.recoveryState(p.lastStats);
    claim(
      "A20",
      "a borderline machine is never probed back up — the improvement is what a rung is worth",
      ch.length === 1 && ch[0].direction === "down" && p.recoveries === 0 && p.tier === "medium",
      `${ch.length} change(s) in 60 000 frames, ending ${p.tier}; revocation refused: ${state.gate}`
    );
  }

  /** A21 — a machine that keeps missing is a machine, not a storm: the descent disarms the revocation. */
  {
    const ORDER = ["potato", "low", "medium", "high", "ultra"];
    const p = new TierPolicy("high", { ceiling: "high" });
    // Closed loop: each rung really buys 1.8x, and this machine costs 120 ms at high.
    const ch = drive(p, 40000, () => 120 / 1.8 ** (3 - ORDER.indexOf(p.tier)));
    claim(
      "A21",
      "a real 8 fps machine descends and stays down — the second down-step disarms the revocation",
      ch.length === 2 &&
        ch.every((c) => c.direction === "down") &&
        p.tier === "potato" &&
        p.recoveries === 0 &&
        p.descent.late === true,
      `${ch.map((c) => `${c.from}→${c.to}(${c.rungs}r) at ${(c.at / 1000).toFixed(1)} s, median ${c.medianMs} ms`).join("; ")}; ` +
        `recoveries ${p.recoveries}, descent marked late=${p.descent.late} (arm window ${POLICY.recoveryArmMs} ms)`
    );
  }

  /** A22 — and when a revocation is wrong, it costs one change and locks the ratchet for good. */
  {
    const p = new TierPolicy("high", { ceiling: "high" });
    const ch = [];
    for (let t = 0; t < 4000; t += 120) {
      const c = p.sample(120);
      if (c) ch.push(c);
    }
    ch.push(...drive(p, 3000, (i) => 16.6 + (i % 7) * 0.05)); // quiet: buys the revocation
    ch.push(...drive(p, 60000, () => 60)); // …and then the machine is genuinely slow, for ever
    const after = drive(p, 60000, (i) => 16.6 + (i % 7) * 0.05); // a second quiet stretch buys nothing
    claim(
      "A22",
      "a wrong revocation is caught once, costs one change, and locks the ratchet",
      p.recoveries === 1 &&
        p.locked === true &&
        ch.length === 3 &&
        after.length === 0 &&
        ch.length <= POLICY.maxChanges &&
        p.budget().recoveriesLeft === 0,
      `${ch.map((c) => `${c.from}→${c.to}(${c.direction})`).join("; ")}; then 60 000 further vsync frames → ${after.length} change(s); ` +
        `locked ${p.locked}, budget ${JSON.stringify(p.budget())}`
    );
  }

  /**
   * A23 — the other side of the trade, and the reason corroboration is tied to *both* the leap and
   * the revocation. Hardware that predicted the slowness leaps at once and never looks back: a
   * multi-rung leap explains a large improvement, so the inconsistency test could not discriminate
   * after one anyway. Time to a settled tier for the machine this game is for is unchanged.
   */
  {
    const rows = [10, 5, 2].map((fps) => {
      const p = new TierPolicy("medium", { ceiling: "medium", provisional: false });
      let at = null;
      for (let i = 0; i < 200000 && p.tier !== "potato"; i++) if (p.sample(1000 / fps)) at = p.clock;
      return { fps, at, tier: p.tier, n: p.changes.length, rec: p.budget().recoveriesLeft };
    });
    claim(
      "A23",
      "corroborated hardware still settles in one leap inside 10 s, and never revokes",
      rows.every((r) => r.tier === "potato" && r.n === 1 && r.at <= 10000 && r.rec === 0),
      rows
        .map((r) => `${r.fps} fps → ${r.tier} at ${(r.at / 1000).toFixed(1)} s in ${r.n} change(s), revocations available ${r.rec}`)
        .join("; ")
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
  /**
   * The case round 1 got backwards, and the reason the default is inverted. None of these four
   * machines is *weak*; the point is that nothing about them is legible, and "I could not tell"
   * was being answered with 3072² x3 shadow cascades at a 1.5x pixel ratio and a 5-pass post stack.
   * Chrome is removing `WEBGL_debug_renderer_info`, Firefox's `resistFingerprinting` returns
   * "Mozilla", Safari has never shipped `deviceMemory` — this is a growing share of real browsers,
   * not an edge case.
   */
  const MASKED = [
    { name: "legacy Chrome mask", renderer: "WebKit WebGL", vendor: "WebKit", maxTextureSize: 16384, webgl2: true, devicePixelRatio: 1, cores: 8, memoryGB: 0, viewport: [1920, 1080] },
    { name: "Firefox resistFingerprinting", renderer: "Mozilla", vendor: "Mozilla", maxTextureSize: 16384, webgl2: true, devicePixelRatio: 1, cores: 8, memoryGB: 0, viewport: [1920, 1080] },
    { name: "extension removed, no deviceMemory", renderer: "unknown", vendor: "unknown", maxTextureSize: 16384, webgl2: true, devicePixelRatio: 1, cores: 8, memoryGB: 0, viewport: [1366, 768] },
  ];
  const IRIS_XE = {
    renderer: "ANGLE (Intel, Mesa Intel(R) Xe Graphics (TGL GT2), OpenGL ES 3.2)",
    vendor: "Intel",
    maxTextureSize: 16384,
    webgl2: true,
    devicePixelRatio: 1,
    cores: 8,
    memoryGB: 8,
    viewport: [1920, 1080],
  };
  const AMD_APU = {
    renderer: "ANGLE (AMD, AMD Radeon Graphics (renoir, LLVM 15.0.6, DRM 3.49, 5.15), OpenGL ES 3.2)",
    vendor: "AMD",
    maxTextureSize: 16384,
    webgl2: true,
    devicePixelRatio: 1,
    cores: 8,
    memoryGB: 8,
    viewport: [1366, 768],
  };
  const AMD_DISCRETE = {
    renderer: "ANGLE (AMD, AMD Radeon RX 7600 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    vendor: "AMD",
    maxTextureSize: 16384,
    webgl2: true,
    devicePixelRatio: 1,
    cores: 12,
    memoryGB: 8,
    viewport: [1920, 1080],
  };

  const cb = startingTier(CHROMEBOOK, "high");
  claim(
    "B1",
    "a Gemini-Lake school Chromebook does not start at high",
    cb.tier === "medium" && !cb.standDown && cb.caps.length >= 2,
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
    desk.tier === "high" && desk.caps.length === 0 && desk.strengths.length === 1,
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

  /** B8 — the inverted default. This is the round-2 fix, stated as a claim. */
  {
    const got = MASKED.map((m) => ({ name: m.name, r: startingTier(m, "high") }));
    claim(
      "B8",
      `hardware with no legible signal starts at ${NEUTRAL_START}, not at the configured high`,
      got.every((g) => g.r.tier === NEUTRAL_START && g.r.caps.length === 0 && g.r.strengths.length === 0),
      got.map((g) => `${g.name} ("${g.r.notes[0].slice(0, 48)}…") → ${g.r.tier}`).join("; ")
    );
    const t = TIERS[got[0].r.tier];
    const h = TIERS.high;
    // The shipped surfaces only. `Lighting.js` clamps every tier's cascades into 1024-2048² x≤2, so
    // quoting the tier table's shadow numbers here would be quoting a rig no machine builds; the
    // real shadow movement is this module's own ratio ladder and C3 measures it (2048² → 512²).
    note(
      `what the default is worth per frame: dpr ${h.maxPixelRatio} (${(h.maxPixelRatio ** 2).toFixed(2)}x screen pixels) and ` +
        `${h.postStack.length}-pass post → dpr ${t.maxPixelRatio} (${(t.maxPixelRatio ** 2).toFixed(2)}x) and ${t.postStack.length}-pass, ` +
        `i.e. ${(100 * (1 - t.maxPixelRatio ** 2 / h.maxPixelRatio ** 2)).toFixed(0)} % fewer pixels shaded before post`
    );
  }

  /** B9/B10/B11 — the GPU families the table missed, and the discrete parts it must not swallow. */
  {
    const xe = startingTier(IRIS_XE, "high");
    claim(
      "B9",
      "Intel Iris/Xe/Arc integrated is named as integrated, not left to the capability caps",
      xe.tier === "medium" && xe.caps.length >= 1 && /Iris\/Xe\/Arc/.test(xe.notes.join(" ")),
      `Chromebook Plus (Xe, 16384 textures, 8 cores, 8 GB — every capability cap misses it) → ${xe.tier}; ${xe.notes.slice(1).join(" · ")}`
    );

    const apu = startingTier(AMD_APU, "high");
    claim(
      "B10",
      "an 8-core / 8 GB AMD APU Chromebook is capped by its GPU family, not by nothing",
      apu.tier === "medium" && apu.caps.length >= 1 && /AMD APU/.test(apu.notes.join(" ")),
      `Ryzen "renoir" APU → ${apu.tier}; ${apu.notes.slice(1).join(" · ")}`
    );

    const rx = startingTier(AMD_DISCRETE, "high");
    claim(
      "B11",
      "a discrete Radeon is not caught by the integrated-Radeon rule",
      rx.tier === "high" && rx.caps.length === 0 && rx.strengths.length === 1,
      `Radeon RX 7600 → ${rx.tier}; ${rx.notes.join(" · ")}`
    );
  }
}

/* ============================================ D — the wiring, with the real AutoTier and no browser
 *
 * Groups A and B test the two halves in isolation, which is exactly how round 1 shipped two bugs
 * that lived only in the seam between them: the policy ceiling was taken from the config instead of
 * from the heuristic's cap, and the stand-down switch was read once in the constructor. Both halves
 * were individually correct. So this group instantiates the *real* `AutoTier` against a stub kernel
 * and drives its `frame()` loop against a stub clock.
 */
if (ONLY.includes("D")) {
  const stubKernel = (renderer, maxTextureSize) => {
    const k = {
      resizes: 0,
      pixelRatio: config.pixelRatio(),
      scene: { traverse() {} },
      renderer: {
        getContext: () => ({
          getExtension: () => null,
          getParameter: (p) => (p === 1 ? renderer : p === 2 ? "stub" : maxTextureSize),
          RENDERER: 1,
          VENDOR: 2,
          MAX_TEXTURE_SIZE: 3,
        }),
        capabilities: { isWebGL2: true },
        getPixelRatio: () => k.pixelRatio,
        shadowMap: { enabled: true, needsUpdate: false },
        domElement: { width: 1366, height: 768 },
      },
      // The one behaviour of the real kernel this group depends on: `resize()` re-reads the tier's
      // pixel-ratio clamp. That is what makes "the player's choice reached the renderer" testable.
      resize() {
        k.resizes++;
        k.pixelRatio = config.pixelRatio();
      },
      get: () => null,
    };
    return k;
  };

  /**
   * Drive `n` frames through a stubbed `performance.now()`. `ms` may be a function, which is what
   * makes the loop *closed*: a tier step really does buy frame time on a real machine, and a stream
   * that ignores that would keep stepping down for ever and prove nothing about settling.
   */
  const clock = { t: 1000 };
  const driveFrames = (at, n, ms) => {
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

  // Group B fixtures are passed in explicitly; `inspectDevice` reads these globals instead.
  globalThis.innerWidth = 1366;
  globalThis.innerHeight = 768;
  globalThis.devicePixelRatio = 2; // so the tier's pixel-ratio ladder (1.5 / 1.25 / 1 / 1) is visible

  /**
   * D1 — the heuristic's cap is the measurement's ceiling.
   *
   * Round 1 passed `{ ceiling: this.bootTier }`, so a Gemini-Lake Chromebook the heuristic had
   * correctly capped at `medium` was promoted straight back to `high` the moment it held vsync at
   * `medium` — then fell high → medium → low and ended the session at `low` with all three changes
   * spent and three visible picture changes on the way.
   */
  {
    config.reset();
    const k = stubKernel("ANGLE (Intel, Intel(R) UHD Graphics 600 Direct3D11 vs_5_0 ps_5_0, D3D11)", 8192);
    const at = new AutoTier(k);
    const bootTier = config.tier.id;
    driveFrames(at, 5000, 16.6); // holds vsync at medium — round 1 read this as "high is affordable"
    const afterVsync = config.tier.id;
    // …and then the scene gets heavier: medium costs it 25 fps, and anything below medium is fine.
    // Closed loop, so the run can actually settle rather than falling for ever.
    driveFrames(at, 12000, () => (config.tier.id === "medium" ? 40 : 16.6));
    const ups = at.history.filter((c) => c.direction === "up").length;
    const auto = at.history.filter((c) => c.direction !== "heuristic");
    claim(
      "D1",
      "measurement never promotes past the heuristic's hardware cap",
      at.policy.ceiling === "medium" &&
        at.ceilingSource === "heuristic cap" &&
        ups === 0 &&
        auto.length === 1 &&
        config.tier.id === "low" &&
        at.policy.budget().changesLeft === 2,
      `heuristic ${at.heuristic.tier} (caps ${JSON.stringify(at.heuristic.caps)}) → policy ceiling "${at.policy.ceiling}" from the ${at.ceilingSource}; ` +
        `boot ${bootTier}, after 5 000 vsync frames still ${afterVsync}, after 12 000 loaded frames ${config.tier.id}; ` +
        `changes ${JSON.stringify(at.history.map((c) => `${c.from}→${c.to}(${c.direction})`))}; budget ${JSON.stringify(at.policy.budget())}. ` +
        `Round 1 on this exact stream: medium→high(up), high→medium, medium→low — 3 changes, budget spent, two tiers below the cap.`
    );
  }

  /**
   * D2 — the stand-down switch is re-read every frame.
   *
   * Round 1 captured `config.get("autoTier")` in the constructor. A settings screen calling
   * `Config.set("tier","low")` mid-session flipped the switch and `AutoTier` never noticed: 2 000
   * slow frames later it had walked the picture high → medium → low → potato underneath a student
   * who had explicitly asked for `low`.
   */
  {
    config.reset();
    const k = stubKernel("ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)", 16384);
    const at = new AutoTier(k);
    const bootPixelRatio = k.pixelRatio;
    driveFrames(at, 40, 40); // measuring, nothing decided yet
    const enabledBefore = at.enabled;

    config.set("tier", "low"); // THE PLAYER OPENS SETTINGS — exactly what Config.set documents
    driveFrames(at, 4000, 40); // …and the machine keeps missing its budget for another 4 000 frames
    const probe = at.report();

    claim(
      "D2",
      "an explicit choice mid-session stands the module down and reaches the renderer",
      enabledBefore === true &&
        at.enabled === false &&
        at.history.length === 0 &&
        config.tier.id === "low" &&
        at.standDown?.applied === true &&
        k.pixelRatio === Math.min(2, TIERS.low.maxPixelRatio) &&
        probe.frames > 4000,
      `enabled ${enabledBefore} → ${at.enabled} at frame ${at.standDown?.atFrame}; auto changes ${at.history.length} across ${probe.frames} frames; ` +
        `config.tier "${config.tier.id}"; pixelRatio ${bootPixelRatio} → ${k.pixelRatio}; reason "${at.reason}". ` +
        `Round 1 on this exact stream: 3 changes, high→medium→low→potato, ending at "potato" while the player had asked for "low".`
    );
    config.reset();
  }

  /**
   * D3 — the boot storm, through the *whole* module: heuristic → corroboration → policy → renderer.
   *
   * A18 proves the policy revokes; this proves the revocation is not an entry in a JavaScript array.
   * The drawing buffer really shrinks and really comes back, and the module reports which of the two
   * hardware stories it believed. Same storm on a Chromebook string is D3's control: corroborated,
   * so it leaps and stays down, and nothing about "it later held vsync" is allowed to undo it.
   */
  {
    const storm = (rendererString, maxTex) => {
      config.reset();
      const k = stubKernel(rendererString, maxTex);
      const at = new AutoTier(k);
      const boot = { tier: config.tier.id, pixelRatio: k.pixelRatio };
      // ~4.8 s of a classroom access point finishing thirty downloads. `AutoTier.frame()` scores the
      // *interval* between calls, so it needs one more frame than the policy needs samples.
      driveFrames(at, 40, 120);
      const stormed = { tier: config.tier.id, pixelRatio: k.pixelRatio };
      driveFrames(at, 4000, 16.6); // …and then the machine is exactly what it always was
      return {
        at,
        boot,
        stormed,
        settled: { tier: config.tier.id, pixelRatio: k.pixelRatio },
        auto: at.history.filter((c) => c.direction !== "heuristic"),
      };
    };

    const desktop = storm("ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)", 16384);
    const chromebook = storm("ANGLE (Intel, Intel(R) UHD Graphics 600 Direct3D11 vs_5_0 ps_5_0, D3D11)", 8192);

    claim(
      "D3",
      "a boot storm is revoked in the real renderer when nothing corroborates it, and kept when something does",
      desktop.at.corroborated === false &&
        desktop.auto.length === 2 &&
        desktop.auto[1].direction === "recover" &&
        desktop.auto[1].applied === true &&
        desktop.stormed.pixelRatio < desktop.boot.pixelRatio &&
        desktop.settled.pixelRatio === desktop.boot.pixelRatio &&
        desktop.settled.tier === "high" &&
        chromebook.at.corroborated === true &&
        chromebook.auto.length === 1 &&
        chromebook.auto[0].rungs > 1 &&
        chromebook.settled.tier === "potato" &&
        chromebook.at.policy.budget().recoveriesLeft === 0,
      `RTX 4070 (uncorroborated): tier ${desktop.boot.tier} → ${desktop.stormed.tier} → ${desktop.settled.tier}, ` +
        `pixelRatio ${desktop.boot.pixelRatio} → ${desktop.stormed.pixelRatio} → ${desktop.settled.pixelRatio}, ` +
        `changes ${desktop.auto.map((c) => `${c.from}→${c.to}(${c.direction},applied=${c.applied})`).join(", ")}. ` +
        `UHD 600 Chromebook (corroborated by "${chromebook.at.heuristic.caps.length}" caps): ${chromebook.boot.tier} → ${chromebook.settled.tier} ` +
        `in ${chromebook.auto.length} change of ${chromebook.auto[0]?.rungs} rungs, pixelRatio ${chromebook.boot.pixelRatio} → ${chromebook.settled.pixelRatio}, revocations available ${chromebook.at.policy.budget().recoveriesLeft}`
    );
    config.reset();
  }
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

  const QUERY = {
    // Opt back in on the software rasteriser: this run *wants* the apply path exercised.
    autotier: "force",
    // Shorter windows than the shipped 90/120, so a decision fits in ~60 real SwiftShader frames
    // instead of ~210. The *wall-clock* halves of the window shape are pushed out of the way
    // instead of shortened: at ~10 fps here they would end the warm-up after 15 frames, and this
    // run needs the scene fully assembled before it is judged (a decision taken 1 s in once
    // measured 37.8 ms on a rasteriser that settled at 93 ms). Frames bind; time does not.
    autotierWarmup: "30",
    autotierWarmupMs: "600000",
    autotierWindow: "30",
    autotierWindowMs: "600000",
    autotierCooldown: "1000",
  };

  const browser = await openGame(
    { width: W, height: H, scale: 2, built: BUILT, query: QUERY },
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
        // Settled = the change budget is spent, or the floor is reached and nothing more *can*
        // move. A fixed target of three changes would idle out the timeout now that one decision
        // can leap several rungs.
        const after = await driveUntil(
          (p) => (p?.changes?.length ?? 0) >= 1 && (p.tier === "potato" || p.budget?.changesLeft === 0),
          120000
        );
        // …and then keep watching, to prove nothing further moves once it has settled.
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

      // Second load, same browser: an explicit choice at boot must stand the module down.
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

      /**
       * Third load: the half C8 never tested. Boot *measuring*, then make the choice the way a
       * settings screen makes it — `config.set("tier", …)` on the live kernel — and keep rendering.
       */
      const midSession = await phase(async () => {
        await d.page.evaluate(() => localStorage.clear());
        await d.page.goto(d.url, { waitUntil: "load", timeout: 90000 });
        await ready();
        const before = await d.probe("autotier");
        const set = await d.page.evaluate(() => {
          window.__vs.kernel.config.set("tier", "low");
          return { tier: window.__vs.kernel.config.get("tier"), autoTier: window.__vs.kernel.config.get("autoTier") };
        });
        // Drive well past the ~60 frames the measuring run needed for its first decision.
        const mid = await driveUntil((p) => (p?.frames ?? 0) > 220, 90000);
        return { midBefore: before, midSet: set, mid, midStats: await d.report() };
      });

      return { ...measured, ...chosen, ...midSession, reloads, consoleErrors: d.consoleErrors.slice(0, 10) };
    }
  );

  fs.writeFileSync(path.join(OUT, "session.json"), JSON.stringify(browser, null, 2));

  const { boot, probe0, settled, settledStats, explicit, explicitStats, midBefore, midSet, mid, midStats } =
    browser;

  /**
   * Errors this piece is answerable for. Other waves are mid-edit on their own modules while this
   * runs, and `main.js` isolates a failing boot module by design. Those are reported below rather
   * than hidden, but they are not P30's.
   */
  const FOREIGN = /itembank|62-learning|content\/items\/groups/i;
  const mine = (errors) => (errors ?? []).filter((e) => !FOREIGN.test(String(e)));

  claim(
    "C1",
    "the game boots with auto-tiering mounted and no errors of its own",
    !boot.fatal && mine(boot.errors).length === 0 && !!probe0 && probe0.enabled === true,
    `fatal=${boot.fatal ?? "null"}, errors mine=${mine(boot.errors).length} foreign=${(boot.errors?.length ?? 0) - mine(boot.errors).length}, HMR reloads survived=${browser.reloads}, probe enabled=${probe0?.enabled}, reason="${probe0?.reason}", start tier ${probe0?.startTier}, ceiling ${probe0?.ceiling} (${probe0?.ceilingSource}), GPU "${probe0?.heuristic?.env?.renderer}"`
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
      ? downs.map((c) => `${c.from}→${c.to} (${c.rungs} rung(s)) at ${c.medianMs} ms median (${c.fps} fps) over ${c.frames} frames`).join("; ")
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
      changes.filter((c) => c.applied && c.direction !== "heuristic").length <= settled.thresholds.maxChanges &&
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
    "nothing moves once it has settled (8 s of further frames)",
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
    "?tier=low at boot stands auto-tiering down completely",
    explicit?.enabled === false &&
      /explicit/.test(explicit?.reason ?? "") &&
      (explicit?.changes?.length ?? -1) === 0 &&
      explicit?.tier === "low" &&
      !explicitStats.fatal,
    `enabled=${explicit?.enabled}, tier=${explicit?.tier}, autoTier=${explicit?.autoTierSetting}, changes=${explicit?.changes?.length}, reason="${explicit?.reason}"`
  );

  /**
   * C9 — the half C8 never tested, and the one that was broken: a choice made *mid-session*.
   * `?tier=low` is honoured because `Config`'s constructor sets `autoTier` before `AutoTier`'s
   * constructor reads it. A settings screen has no such luck.
   */
  const autoChanges = (mid?.changes ?? []).filter((c) => c.direction === "down" || c.direction === "up");
  claim(
    "C9",
    "a settings-screen choice mid-session stands auto-tiering down and reaches the renderer",
    midBefore?.enabled === true &&
      midSet?.autoTier === false &&
      mid?.enabled === false &&
      mid?.tier === "low" &&
      autoChanges.length === 0 &&
      mid?.standDown?.applied === true &&
      mid?.renderer?.pixelRatio === Math.min(2, 1) &&
      (mid?.frames ?? 0) > 220 &&
      mine(midStats.errors).length === 0,
    `booted measuring (enabled=${midBefore?.enabled}, tier ${midBefore?.tier}, pixelRatio ${midBefore?.renderer?.pixelRatio}) → config.set("tier","low") → ` +
      `enabled=${mid?.enabled} after ${mid?.standDown?.atFrame} frames, ${mid?.frames} real frames rendered in total, ` +
      `auto changes ${autoChanges.length}, tier "${mid?.tier}", pixelRatio ${mid?.renderer?.pixelRatio}, shadow ${mid?.renderer?.shadowMapSize}², reason "${mid?.reason}"`
  );
}

/* ------------------------------------------------------------------------------------- verdict */

const failed = results.filter((r) => !r.pass);

/**
 * Merge, don't clobber. This script is *designed* to be run one group at a time — the offline
 * groups are free and the browser group costs a live playtest CPU time — so a `--only=A,B,D` run
 * writing a file that erases group C's evidence would quietly turn the record into a lie.
 */
const RESULTS = path.join(OUT, "P30.json");
const prior = (() => {
  try {
    return JSON.parse(fs.readFileSync(RESULTS, "utf8")).results ?? [];
  } catch {
    return [];
  }
})();
const merged = [...prior.filter((p) => !results.some((r) => r.id === p.id)), ...results].sort((a, b) =>
  a.id.localeCompare(b.id, "en", { numeric: true })
);
fs.writeFileSync(
  RESULTS,
  JSON.stringify(
    { when: new Date().toISOString(), ran: ONLY, policy: POLICY, results: merged },
    null,
    2
  )
);
if (JSON_ONLY) console.log(JSON.stringify({ results, failed: failed.length }, null, 2));
else console.log(`\n${results.length - failed.length}/${results.length} claims pass`);
process.exit(failed.length ? 1 : 0);
