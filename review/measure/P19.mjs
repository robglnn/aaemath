/**
 * P19 — the in-world learning verbs, measured on the shipped game.
 *
 * `RESUME.md` §6d is the claim this script exists to close:
 *
 *     learn:present  1 · math:show 11 · learn:respond 0 · learn:mastery 0
 *     "Screen -> engine does not exist... Nothing can emit `learn:respond` because P19 was never
 *      built. There is no way for a player to answer."
 *
 * Two sessions, and the difference between them is stated out loud because §6a's meta-lesson is that
 * a green proof script is worth nothing until someone confirms what scene it is measuring:
 *
 *   SESSION 1 — UNASSISTED PLAY. The real app, the real scheduler, the real presenter. The harness
 *     presses keys and moves a synthetic Standard Gamepad through `window.__vsInput` (the same
 *     `_samplePad`/`_ingest` path real hardware takes) and nothing else. Every claim in the trace
 *     block comes from here. Nothing is injected, nothing is stubbed, and no answer is read.
 *
 *   SESSION 2 — VERB CAPTURES. Level 1 opens on `var-meaning` and the scheduler will not reach a
 *     threshold or a bundle inside a capture's worth of play, so for the other four verbs the
 *     CHOOSER is stood in for: a real committed catalogue item is put on the real `learn:present`
 *     bus in the real running game. The runtime, the algebra, the renderer, the camera and the frame
 *     are all the shipped ones — only the decision about which claim to stand is the harness's. No
 *     count in the trace block comes from this session and no response is committed in it.
 *
 * Run `node review/measure/P19-unit.mjs` beside this: it drives all five verbs over all 1,152
 * committed items offline, which is the coverage this script cannot get to in a browser.
 */
import fs from "node:fs";
import path from "node:path";
import { openGame, ROOT } from "../../tools/lib/session.mjs";

const OUT = path.join(ROOT, "review", "shots", "P19");
fs.mkdirSync(OUT, { recursive: true });

const WATCH = ["learn:present", "learn:respond", "learn:mastery", "learn:teach", "learn:unlock", "math:show", "math:hide"];
const claims = [];
const claim = (id, pass, detail) => {
  claims.push({ id, pass: !!pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${id}  —  ${detail}`);
};

/**
 * Advance game time in coarse slices.
 *
 * The kernel runs simulation at a fixed 60 Hz no matter how big the slice is, so every verb, every
 * input edge and every timer sees exactly the same steps — only the number of RENDERS changes, and a
 * SwiftShader render of this scene costs about a fifth of a second. At the harness's default slice
 * this script spends nine minutes of wall clock drawing frames nobody reads. Captures still render
 * normally, because a capture is the one place a frame matters.
 */
const fast = (d, seconds) => d.play(seconds, 1 / 10);
const holdFast = async (d, key, seconds) => {
  await d.page.keyboard.down(key);
  await fast(d, seconds);
  await d.page.keyboard.up(key);
};
/** Tap a pad button n times, in batches the one-transition-per-step queue can actually absorb. */
const tapN = async (d, btn, n) => {
  for (let i = 0; i < n; i += 3) {
    const k = Math.min(3, n - i);
    await d.run(([b, c]) => {
      for (let j = 0; j < c; j += 1) window.__vsInput.tap(b);
      return true;
    }, [btn, k]);
    await fast(d, 0.14);
  }
};

const installTrace = (d) =>
  d.run((names) => {
    window.__p19 = [];
    const k = window.__vs.kernel;
    for (const n of names)
      k.signals.on(n, (v) =>
        window.__p19.push({
          n,
          t: Number((k.simTime ?? 0).toFixed(2)),
          id: v?.itemId ?? v?.id ?? null,
          kpId: v?.kpId ?? null,
          correct: v?.correct ?? null,
          scored: v?.scored ?? null,
          family: typeof v?.family === "string" ? v.family : v?.family === undefined ? null : String(v.family),
          hinted: v?.hinted ?? null,
          p: v?.p ?? null,
          delta: v?.delta ?? null,
        })
      );
    return true;
  }, WATCH);

/** present -> show -> respond -> mastery, in that order, at least once. */
function orderedCycle(trace) {
  const cycles = [];
  for (let i = 0; i < trace.length; i += 1) {
    if (trace[i].n !== "learn:present") continue;
    let show = -1;
    let respond = -1;
    let mastery = -1;
    for (let j = i + 1; j < trace.length; j += 1) {
      if (trace[j].n === "learn:present") break;
      if (show < 0 && trace[j].n === "math:show") show = j;
      if (show >= 0 && respond < 0 && trace[j].n === "learn:respond") respond = j;
      if (respond >= 0 && mastery < 0 && trace[j].n === "learn:mastery") mastery = j;
    }
    if (show >= 0 && respond >= 0)
      cycles.push({
        item: trace[i].id,
        kpId: trace[i].kpId,
        at: trace[i].t,
        show: trace[show].t,
        respond: trace[respond].t,
        correct: trace[respond].correct,
        scored: trace[respond].scored,
        family: trace[respond].family,
        mastery: mastery >= 0 ? { t: trace[mastery].t, p: trace[mastery].p, delta: trace[mastery].delta } : null,
      });
  }
  return cycles;
}

// ==================================================================== session 1: unassisted play

const evidence = { keyboard: null, pad: null, captures: [] };

await openGame({ width: 1280, height: 720 }, async (d) => {
  await fast(d, 1.0);
  await installTrace(d);

  // ---------------------------------------------------------------- keyboard
  // Exactly the vocabulary `review/measure/loop-trace.mjs` uses: walk, take the claim on, walk the
  // deck out, set it down. No key here does anything a player's key would not.
  /**
   * TWENTY-FOUR ITEMS, and the number is the round-2 critic's.
   *
   * "Every item a real player meets poses SPAN — 20 out of 20 presented items in a 24-attempt
   * session, and span/span/span/span across all four independent sessions I ran... today it would
   * read {span: 20} and pass silently." Their second demanded action is that this script stop being
   * able to do that, so the session is now their length and claim P19.12 reads the distribution.
   */
  await d.page.keyboard.press("KeyE"); // take the mathematics on
  await fast(d, 0.6);
  /**
   * It looks at its hands before it presses anything. `interact` both takes a claim on and sets it
   * down, so a driver that presses it a fixed number of times per item falls out of phase with the
   * presenter after the first commit and then puts down claims it never touched — measured, on the
   * first round-3 run: 52 presses, 4 items, 21 claims dropped. A player is not blind, and neither is
   * this loop.
   */
  let items = 0;
  for (let i = 0; i < 96 && items < 24; i += 1) {
    if ((await d.probe("verbs"))?.phase !== "performing") {
      await d.page.keyboard.press("KeyE"); // take the claim on
      await fast(d, 0.45);
      continue;
    }
    // Walk the grip along the object a different distance each time: a harness that performs one
    // fixed act on twenty-four claims measures the act, not the game.
    for (let s = 0; s < items % 4; s += 1) {
      await d.page.keyboard.press("BracketRight");
      await fast(d, 0.1);
    }
    await holdFast(d, "KeyW", 0.9); // work the claim — the feet are planted while it is held
    await d.page.keyboard.press("KeyE"); // set it down
    await fast(d, 1.5); // the mark stands, then the next claim
    items += 1;
  }

  const kb = await d.run(() => ({ trace: window.__p19.slice(), verbs: window.__vs.probe("verbs"), teaching: window.__vs.probe("teaching") }));
  const counts = {};
  for (const e of kb.trace) counts[e.n] = (counts[e.n] ?? 0) + 1;
  evidence.keyboard = { counts, cycles: orderedCycle(kb.trace), verbs: kb.verbs, trace: kb.trace.filter((e) => e.n !== "math:show" && e.n !== "math:hide") };

  await d.shoot("review/shots/P19/01-keyboard-cycle.png");

  // ---------------------------------------------------------------- gamepad
  // The whole game is playable on a pad and these must not be the exception. `__vsInput` feeds the
  // same `_samplePad`/`_ingest` the hardware path uses, so what is exercised here is `input:move`
  // off the left stick and `input:action {action:"interact"}` off Pad:X — the real bindings.
  await d.run(() => {
    window.__p19.length = 0;
    window.__vsInput.connect({ style: "xbox" });
    return true;
  });
  await fast(d, 0.4);
  await d.run(() => window.__vsInput.tap("X")); // interact — take the claim on
  await fast(d, 0.8);
  for (let i = 0; i < 4; i += 1) {
    await d.run(() => window.__vsInput.stick("left", 0, -1)); // ly is negative forward, W3C standard
    await fast(d, 1.2);
    await d.run(() => window.__vsInput.stick("left", 0, 0));
    await fast(d, 0.2);
    await d.run(() => window.__vsInput.tap("X"));
    await fast(d, 2.4);
  }
  const midPush = await d.run(async () => {
    window.__vsInput.stick("left", 0, -1);
    window.__vs.advance(0.3);
    const v = window.__vs.probe("verbs");
    window.__vsInput.stick("left", 0, 0);
    return { move: v?.hand?.move ?? null, state: v?.state ?? null };
  });
  await fast(d, 0.3);

  const pad = await d.run(() => ({
    trace: window.__p19.slice(),
    verbs: window.__vs.probe("verbs"),
    input: window.__vs.probe("input"),
  }));
  evidence.padMidPush = midPush;
  const padCounts = {};
  for (const e of pad.trace) padCounts[e.n] = (padCounts[e.n] ?? 0) + 1;
  evidence.pad = {
    counts: padCounts,
    cycles: orderedCycle(pad.trace),
    device: pad.input?.device?.active ?? null,
    style: pad.input?.device?.style ?? null,
    padConnected: pad.input?.pad?.connected ?? null,
    padEdges: pad.input?.pad?.edges ?? null,
    midPush,
    verbs: pad.verbs,
  };
  await d.shoot("review/shots/P19/02-gamepad-cycle.png");

  // ---------------------------------------------------------------- the deliberate close
  /**
   * EVERYTHING ABOVE PROVES THE LOOP TURNS. THIS PROVES IT CAN BE TURNED THE RIGHT WAY.
   *
   * The two runs above hold a direction and set the deck down wherever it got to, which is honest
   * play and produces honest wrong answers. It is not evidence that a player who does the algebra
   * can be right, and a verb layer that can only ever be wrong would pass every count in this file.
   *
   * So this phase reads the claim OFF THE SCREEN — the stem and the given from `probe("verbs")`, the
   * said claim from `probe("teaching").prose.spoken`, all three of which are standing in world space
   * at the moment it reads them — does the algebra HERE, in the harness, and then drives the verb to
   * that value using nothing but the pad. `learn/Teaching.js` deleted its `expected()` hook in round
   * 3 for exactly this reason: "a run that reads the answer key measures the harness". There is no
   * answer key in this block. There is a stem, a said claim, and arithmetic.
   */
  const deliberate = [];
  for (let attempt = 0; attempt < 5 && !deliberate.some((r) => r.correct); attempt += 1) {
    const seen = await d.run(() => ({
      verbs: window.__vs.probe("verbs"),
      spoken: window.__vs.probe("teaching")?.prose?.spoken ?? null,
      phase: window.__vs.probe("teaching")?.phase ?? null,
    }));
    if (seen.phase !== "standing" || !seen.verbs?.verb) {
      await fast(d, 1.2);
      continue;
    }
    const st = seen.verbs.state ?? {};
    const item = seen.verbs.item ?? {};
    /** Solve what is on the screen. Three shapes, and every input is a row the player can read. */
    let plan = null;
    if (st.mode === "cut") {
      const g = /=\s*(-?\d+)/.exec(String((item.given ?? [])[0] ?? ""));
      if (g) plan = { charges: [Number(g[1]), Number(g[1])], why: `both sockets hold what ${item.stem} holds: ${g[1]}` };
    } else if (st.mode === "pair") {
      // `x + y = S,  x - y = 0` -> the two names hold the same thing, and two of it is S.
      const sum = /\+\s*[a-zA-Z]\s*=\s*(-?\d+)/.exec(String(item.stem ?? ""));
      const diff = /-\s*[a-zA-Z]\s*=\s*(-?\d+)/.exec(String(item.stem ?? ""));
      if (sum && diff && Number(diff[1]) === 0) {
        const half = Number(sum[1]) / 2;
        if (Number.isInteger(half)) plan = { charges: [half, half], why: `two of it is ${sum[1]}, and the difference is 0` };
      }
    } else if (st.mode === "ratio") {
      const n = /(-?\d+)/.exec(String(seen.spoken ?? ""));
      if (n) plan = { ratio: Number(n[1]), why: `the said claim counts ${n[1]} for every one` };
    }
    if (!plan) {
      // Not a shape this reader solves. Set it down as it stands and take the next claim.
      await d.run(() => window.__vsInput.tap("X"));
      await fast(d, 2.4);
      continue;
    }

    const before = await d.run(() => window.__p19.length);
    if (plan.ratio != null) {
      await tapN(d, plan.ratio > 0 ? "RT" : "LT", Math.abs(plan.ratio));
    } else {
      for (let s = 0; s < plan.charges.length; s += 1) {
        if (s > 0) {
          await d.run(() => window.__vsInput.tap("RB")); // cycleNext — the next socket
          await fast(d, 0.14);
        }
        const v = plan.charges[s];
        await tapN(d, v > 0 ? "RT" : "LT", Math.abs(v));
      }
    }
    // The latency floor is 900 ms and a correct response under it is refused upward by design.
    await fast(d, 1.2);
    const built = await d.probe("verbs");
    await d.run(() => window.__vsInput.tap("X"));
    await fast(d, 2.4);
    const after = await d.run((n) => window.__p19.slice(n), before);
    const resp = after.find((e) => e.n === "learn:respond");
    deliberate.push({
      verb: seen.verbs.verb,
      mode: st.mode ?? null,
      stem: item.stem,
      given: item.given,
      spoken: seen.spoken,
      reasoning: plan.why,
      built: built?.state ?? null,
      response: built ? null : null,
      sent: (await d.probe("verbs"))?.lastResponse?.response ?? null,
      correct: resp?.correct === true,
      scored: resp?.scored === true,
      family: resp?.family ?? null,
    });
  }
  evidence.deliberate = deliberate;
  await d.shoot("review/shots/P19/03-deliberate-close.png");

  evidence.consoleErrors = d.consoleErrors.slice(0, 8);
});

// ==================================================================== session 2: the five verbs

/** One committed item per verb, drawn from the shipped catalogue, chosen by object class. */
function pickItems() {
  const dir = path.join(ROOT, "content", "items", "bank");
  const all = [];
  for (const f of fs.readdirSync(dir)) all.push(...JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")).items);
  const find = (fn) => all.find(fn);
  const open = (it) =>
    it && {
      itemId: it.id,
      kpId: it.kpId,
      form: it.form,
      // Exactly the payload `learn/Teaching.js` puts on the wire — the open reading and nothing else.
      item: {
        id: it.id,
        stem: it.stem,
        given: it.given ?? [],
        working: it.working ?? [],
        unknown: it.unknown ?? "x",
        answerType: it.answerType,
        objectClass: it.objectClass,
        form: it.form,
      },
      _answer: it.answer?.canonical ?? null, // printed for the reader; never sent into the page
    };
  return {
    span: open(find((i) => i.kpId === "eq-model-context" && i.form === "construct" && i.answerType === "integer")),
    balance: open(find((i) => i.kpId === "eq-two-step" && i.form === "construct" && /^\d?x [+-] \d+ = \d+$/.test(i.stem))),
    combine: open(find((i) => i.kpId === "like-terms-combine" && i.form === "construct" && i.answerType === "expression")),
    distribute: open(find((i) => i.kpId === "distribute-variable" && i.form === "construct" && i.answerType === "expression")),
    tilt: open(find((i) => i.kpId === "ineq-negative-flip" && i.form === "construct" && i.answerType === "inequality")),
  };
}

const picks = pickItems();

await openGame({ width: 1280, height: 720 }, async (d) => {
  await d.play(1.0);

  for (const [verb, payload] of Object.entries(picks)) {
    if (!payload) {
      claim(`capture.${verb}`, false, "no committed item of this shape in the catalogue");
      continue;
    }
    const { _answer, ...wire } = payload;
    await d.run((p) => {
      window.__vs.kernel.signals.emit("learn:present", p);
      return true;
    }, wire);
    await fast(d, 0.3);

    /**
     * Perform the act part-way and stop. A capture of a verb that has finished is a capture of a
     * result; what has to be legible is the ACT — a deck half walked out, a lock half open, a term
     * in the air over the Sill.
     *
     * The right trigger, not the stick: `primary` is the work axis that does not also walk the
     * player, which is the whole point of it existing (see `learn/verbs/Verbs.js`). Round 1 drove
     * these with the left stick, walked eleven metres in the process, and captured five frames of
     * scenery with the mathematics standing behind the camera.
     */
    await d.run(() => window.__vsInput.connect({ style: "xbox" }));
    await fast(d, 0.2);
    await d.run(() => window.__vsInput.press("RT"));
    await fast(d, { span: 0.95, distribute: 0.15, combine: 0.62, balance: 0.2, tilt: 0.2 }[verb] ?? 0.6);
    await d.run(() => window.__vsInput.release("RT"));
    if (verb === "tilt") {
      await fast(d, 0.2);
      await d.run(() => window.__vsInput.tap("RB")); // walk the grip along to the Sill
      await fast(d, 0.2);
      await d.run(() => window.__vsInput.tap("RB"));
    }
    await d.play(0.3);

    const probe = await d.probe("verbs");
    const shot = `review/shots/P19/verb-${verb}.png`;
    await d.shoot(shot);
    evidence.captures.push({
      verb,
      shot,
      posed: probe?.verb ?? null,
      item: probe?.item ?? null,
      state: probe?.state ?? null,
      rows: (probe?.rows ?? []).map((r) => `${r.id}=${r.tex}`),
      wouldRespond: null,
      answerForTheReader: _answer,
    });
  }

  /**
   * THE WORLD ANSWERING A MISCONCEPTION — gate L7, in the frame.
   *
   * A lock left half open IS `distributed-to-first-only`, and the read for it is
   * `fail.partial.open`: "The bracket opened onto one thing and shut on the other." The read is
   * stood by the shipped `_stand(false)` — the same method `learn:respond` calls — driven directly,
   * because a claim that falls onto a TAGGED distractor cannot be arranged out of the `var-meaning`
   * items the scheduler serves in the first minute of Level 1. Everything downstream of the call is
   * the game: the verb's own read of the object it was holding, `ItemBank.text` in the live locale,
   * `Tex.validate` at `strict: "error"`, and the same world-space renderer as every other row.
   * `review/measure/P19-unit.mjs` runs the same path over 170 misconception performances offline.
   */
  const fell = picks.distribute;
  if (fell) {
    const { _answer, ...wire } = fell;
    void _answer;
    await d.run((p) => {
      window.__vs.kernel.signals.emit("learn:present", p);
      return true;
    }, wire);
    await fast(d, 0.3);
    await d.run(() => window.__vsInput.press("RT"));
    await fast(d, 0.15);
    await d.run(() => window.__vsInput.release("RT"));
    await fast(d, 0.3);
    const read = await d.run(() => {
      const v = window.__vs.kernel.get("verbs");
      v._stand(false);
      const p = window.__vs.probe("verbs");
      return { rows: p.rows, state: p.state, reads: p.stats.reads, refused: p.stats.readsRefused };
    });
    await d.play(0.3);
    await d.shoot("review/shots/P19/04-the-world-answers.png");
    evidence.read = read;
  }

  evidence.captureConsoleErrors = d.consoleErrors.slice(0, 8);
});

/** The same key, in the three shipped locales, straight off the content files. */
function localeReads(key) {
  const out = {};
  for (const lang of ["en", "es", "pl"]) {
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, "content", "locales", `${lang}.json`), "utf8"));
    out[lang] = key.split(".").reduce((o, k) => (o == null ? null : o[k]), j);
  }
  return out;
}

// ==================================================================== claims

const kbc = evidence.keyboard?.counts ?? {};
const padc = evidence.pad?.counts ?? {};

claim(
  "P19.1 the return half of the loop exists",
  (kbc["learn:present"] ?? 0) > 0 && (kbc["math:show"] ?? 0) > 0 && (kbc["learn:respond"] ?? 0) > 0 && (kbc["learn:mastery"] ?? 0) > 0,
  `unassisted keyboard play: learn:present ${kbc["learn:present"] ?? 0} · math:show ${kbc["math:show"] ?? 0} · ` +
    `learn:respond ${kbc["learn:respond"] ?? 0} · learn:mastery ${kbc["learn:mastery"] ?? 0} (was 1 / 11 / 0 / 0)`
);

const full = (evidence.keyboard?.cycles ?? []).filter((c) => c.mastery);
claim(
  "P19.2 the cycle is ordered, not merely counted",
  full.length > 0,
  `${(evidence.keyboard?.cycles ?? []).length} present->show->respond cycles, ${full.length} of them reaching learn:mastery; ` +
    `first: ${full[0] ? `${full[0].kpId} present ${full[0].at}s -> show ${full[0].show}s -> respond ${full[0].respond}s -> mastery ${full[0].mastery.t}s (p ${full[0].mastery.p})` : "none"}`
);

claim(
  "P19.3 the verbs are playable on a pad",
  (padc["learn:respond"] ?? 0) > 0 && evidence.pad?.padConnected === true && Math.abs(evidence.pad?.midPush?.move?.y ?? 0) > 0.5,
  `synthetic Standard Gamepad only: learn:present ${padc["learn:present"] ?? 0} · learn:respond ${padc["learn:respond"] ?? 0} · ` +
    `learn:mastery ${padc["learn:mastery"] ?? 0} · device "${evidence.pad?.device}/${evidence.pad?.style}" · pad edges ${evidence.pad?.padEdges} · ` +
    `left stick reached the verb as ${JSON.stringify(evidence.pad?.midPush?.move)}`
);

const won = (evidence.deliberate ?? []).find((r) => r.correct);
claim(
  "P19.10 a player who does the algebra closes the claim",
  !!won,
  won
    ? `${won.verb}/${won.mode} on ${JSON.stringify(won.stem)}${won.spoken ? ` + said "${won.spoken}"` : ""} — read off the screen, solved in the harness ` +
      `(${won.reasoning}), built with the pad, sent ${JSON.stringify(won.sent)} · correct=${won.correct} scored=${won.scored} family=${won.family}`
    : `${(evidence.deliberate ?? []).length} deliberate attempts, none marked correct: ` +
      JSON.stringify((evidence.deliberate ?? []).map((r) => ({ mode: r.mode, sent: r.sent, correct: r.correct })))
);

const vs = evidence.keyboard?.verbs?.stats ?? {};
claim(
  "P19.4 every response reached Mastery with its family",
  (vs.respondHeard ?? 0) > 0 && (vs.familyOnWire ?? 0) === (vs.respondHeard ?? -1),
  `familyOnWire ${vs.familyOnWire} of respondHeard ${vs.respondHeard} — Mastery refuses a response whose family it was never told`
);

claim(
  "P19.5 no character of a response was mangled on the way in",
  (vs.refusedChars ?? 1) === 0,
  `ItemBank.ENTRY_GRAMMAR refused ${vs.refusedChars} characters of ${vs.committed} committed responses`
);

const lr = evidence.keyboard?.verbs?.lastResponse ?? null;
claim(
  "P19.6 the verb reports no scaffold and the engine agrees",
  lr && lr.scaffoldLevel === 0,
  lr
    ? `last response: verb "${lr.verb}" response ${JSON.stringify(lr.response)} scaffoldLevel ${lr.scaffoldLevel} ` +
      `correct ${lr.correct} scored ${lr.scored} family ${lr.family} misconception ${lr.misconception}`
    : "no response recorded"
);

/**
 * P19.12 — the claim the round-2 critic asked for by name, in the words they asked for it in.
 *
 * "ROUTE ITEMS TO MORE THAN ONE VERB... Then add an assertion to `review/measure/P19.mjs` that a
 * 24-item session poses at least three distinct verb ids; today it would read `{span: 20}` and pass
 * silently."
 *
 * The session above is now their 24 items. `byVerb` is the runtime's own count of what it posed, so
 * this reads the shipped scheduler's real service through the shipped router — not a survey of the
 * catalogue, which would say nothing about what a player actually meets at level 1.
 */
const posedBy = vs.byVerb ?? {};
claim(
  "P19.12 a 24-item session poses at least three distinct verbs",
  Object.keys(posedBy).length >= 3,
  `${Object.keys(posedBy).length} distinct over ${vs.presented ?? 0} presented items: ${JSON.stringify(posedBy)} ` +
    `(round 2: {span: 20} of 20) · unposed ${vs.unposed ?? 0} ${JSON.stringify(vs.unposedByType ?? {})}`
);

/**
 * P19.13 — the off-screen failure, as the one number that shows it cannot recur.
 *
 * The critic's first action: after 1.6 s of `KeyW` the mathematics was gone. The session above holds
 * `KeyW` for nine tenths of a second on every one of twenty-four claims, which is fourteen times the
 * move that lost it. `plantedSteps` counts the simulation steps the body was held still because the
 * hands were on a claim; `probe("verbs").stance` in `boot/64-verbs.js` reads the body back to check
 * the stance actually took. `review/measure/P19-r3.mjs` section A is the frame measurement itself.
 */
claim(
  "P19.13 the body is planted for as long as a claim is held",
  (evidence.keyboard?.verbs?.plantedSteps ?? 0) > 0 && (evidence.keyboard?.verbs?.stance?.planted === false || evidence.keyboard?.verbs?.phase !== "performing"),
  `${evidence.keyboard?.verbs?.plantedSteps ?? 0} simulation steps planted across the session; ` +
    `${evidence.keyboard?.verbs?.restands ?? 0} restands; ` +
    `${evidence.keyboard?.verbs?.letGos ?? 0} claims put back down unanswered; feet free again at the end (${JSON.stringify(evidence.keyboard?.verbs?.stance ?? null)})`
);

/**
 * P19.14 — the answer slot belongs to the hands.
 *
 * "boot/92-teaching.js's raw keydown handler feeds every character ENTRY_GRAMMAR admits... straight
 * to teaching.type(). Measured on the shipped app: holding W then A then S puts the string `was` in
 * the world-space answer slot... Mastery scored it and theta went to −1.173476." The session above
 * holds W on every claim; `strayChars` counts every character that reached the slot and was not the
 * build, and the runtime overwrites the slot with the build every simulation step.
 */
claim(
  "P19.14 no stray keystroke reached the engine",
  (vs.commitMismatch ?? 1) === 0 && (vs.committed ?? 0) > 0,
  `${vs.committed ?? 0} commits, ${vs.commitMismatch ?? "?"} of them with an entry slot that disagreed with what the hands built, ` +
    `after ${vs.strayChars ?? 0} characters were intercepted and removed across ${vs.presented ?? 0} items of holding KeyW ` +
    `(round 2: "was", committed, scored, theta to -1.173476)`
);

claim(
  "P19.7 the runtime is wired to the presenter it commits through",
  !!evidence.keyboard?.verbs?.presenter,
  `probe("verbs").presenter = ${JSON.stringify(evidence.keyboard?.verbs?.presenter)} · posed ${vs.posed} · unposed ${vs.unposed}`
);

const captured = evidence.captures.filter((c) => c.posed);
claim(
  "P19.8 all five verbs pose and perform in the running game",
  captured.length === 5 && new Set(captured.map((c) => c.posed)).size === 5,
  captured.map((c) => `${c.posed}: ${c.rows.length} rows standing`).join(" · ")
);

const readRows = (evidence.read?.rows ?? []).filter((r) => r.id.startsWith("verb-read"));
const readRow = readRows[0] ?? null;
const partial = localeReads("fail.partial.open");
claim(
  "P19.11 the world answers the misconception, in the player's language",
  !!readRow && (evidence.read?.readsRefused ?? 0) === 0,
  readRow
    ? `a lock left open at ward ${evidence.read.state?.reached}/${evidence.read.state?.wards} stood ${readRows.length} row(s): ` +
      `${readRows.map((r) => JSON.stringify(r.tex)).join(" + ")} ` +
      `— the same key in three locales: ${JSON.stringify(partial)}`
    : `no read row stood (${JSON.stringify(evidence.read ?? null)})`
);

claim(
  "P19.9 nothing on the console",
  (evidence.consoleErrors?.length ?? 0) === 0 && (evidence.captureConsoleErrors?.length ?? 0) === 0,
  `${evidence.consoleErrors?.length ?? 0} + ${evidence.captureConsoleErrors?.length ?? 0} console errors`
);

console.log("\n---- verb captures ----");
for (const c of evidence.captures)
  console.log(
    `${c.verb.padEnd(11)} posed=${String(c.posed).padEnd(11)} ${c.item?.stem ?? ""}\n   state ${JSON.stringify(c.state)}\n   rows  ${c.rows.join(" | ")}\n   shot  ${c.shot}`
  );

console.log("\n---- unassisted keyboard trace (math:show/hide elided) ----");
for (const e of evidence.keyboard?.trace ?? [])
  console.log(`${String(e.t).padStart(7)}  ${e.n.padEnd(14)} ${e.kpId ?? ""} ${e.id ?? ""} ${e.correct == null ? "" : `correct=${e.correct} scored=${e.scored} family=${e.family}`}`);

fs.writeFileSync(path.join(ROOT, "review", "measure", "evidence", "P19.json"), JSON.stringify({ claims, evidence }, null, 1));
console.log(`\n${claims.filter((c) => c.pass).length}/${claims.length} claims pass · evidence review/measure/evidence/P19.json`);
process.exitCode = claims.every((c) => c.pass) ? 0 : 1;
