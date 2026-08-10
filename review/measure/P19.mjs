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
  await d.play(1.0);
  await installTrace(d);

  // ---------------------------------------------------------------- keyboard
  // Exactly the vocabulary `review/measure/loop-trace.mjs` uses: walk, take the claim on, walk the
  // deck out, set it down. No key here does anything a player's key would not.
  await d.page.keyboard.press("KeyE"); // take the mathematics on
  await d.play(0.6);
  for (let i = 0; i < 7; i += 1) {
    await d.hold("KeyW", 1.1); // walk the deck out / carry the term
    await d.page.keyboard.press("KeyE"); // set it down
    await d.play(2.6); // the mark stands, then the next claim
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
  await d.play(0.4);
  await d.run(() => window.__vsInput.tap("X")); // interact — take the claim on
  await d.play(0.8);
  for (let i = 0; i < 6; i += 1) {
    await d.run(() => window.__vsInput.stick("left", 0, -1)); // ly is negative forward, W3C standard
    await d.play(1.1);
    await d.run(() => window.__vsInput.stick("left", 0, 0));
    await d.play(0.2);
    await d.run(() => window.__vsInput.tap("X"));
    await d.play(2.6);
  }
  const pad = await d.run(() => ({
    trace: window.__p19.slice(),
    verbs: window.__vs.probe("verbs"),
    input: window.__vs.probe("input"),
  }));
  const padCounts = {};
  for (const e of pad.trace) padCounts[e.n] = (padCounts[e.n] ?? 0) + 1;
  evidence.pad = {
    counts: padCounts,
    cycles: orderedCycle(pad.trace),
    device: pad.input?.device ?? pad.input?.deviceKind ?? null,
    padConnected: pad.input?.pad?.connected ?? pad.input?.padConnected ?? null,
    move: pad.verbs?.hand?.move ?? null,
    verbs: pad.verbs,
  };
  await d.shoot("review/shots/P19/02-gamepad-cycle.png");

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
    await d.play(0.3);

    // Perform the act with the stick, part-way, and stop: a capture of a verb that has finished is a
    // capture of a result. What has to be legible is the ACT.
    await d.run(() => window.__vsInput.connect({ style: "xbox" }));
    await d.play(0.2);
    await d.run(() => window.__vsInput.stick("left", 0, -1));
    await d.play(verb === "span" ? 0.75 : 1.15);
    await d.run(() => window.__vsInput.stick("left", 0, 0));
    await d.play(0.25);

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

  evidence.captureConsoleErrors = d.consoleErrors.slice(0, 8);
});

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
  (padc["learn:respond"] ?? 0) > 0,
  `synthetic Standard Gamepad only: learn:present ${padc["learn:present"] ?? 0} · learn:respond ${padc["learn:respond"] ?? 0} · ` +
    `learn:mastery ${padc["learn:mastery"] ?? 0} · device "${evidence.pad?.device}" · stick reached the verb as ${JSON.stringify(evidence.pad?.move)}`
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
