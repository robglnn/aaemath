#!/usr/bin/env node
/**
 * review/measure/P34.mjs — does one complete learning cycle actually execute in the shipped game?
 *
 *   node review/measure/P34.mjs [--cycles=36] [--lang=en] [--shot]
 *
 * ==================================================================================================
 * WHAT THIS MEASURES AND WHY IT IS BUILT THIS WAY
 *
 * `tools/seams.mjs --signals` found the learning loop severed at both ends: `learn:present` and
 * `math:show` were listened for and never emitted, `learn:respond` / `learn:teach` / `learn:unlock`
 * were emitted and never heard, and `Scheduler.serve()` — the only API that pairs a request with a
 * bank item — had zero callers under `app/`. Driving the shipped engine through 600 scored items had
 * pulled zero item chunks.
 *
 * So this script refuses every shortcut that could make a severed loop look connected:
 *
 *   - IT RUNS THE PRODUCTION BUNDLE (`built: true`), not the dev server and not a harness scene.
 *   - IT NEVER EMITS A LEARNING SIGNAL. The only things it does to the page are press keys. Every
 *     signal in the trace was emitted by shipped code inside `app/src`.
 *   - IT OPENS THE LOOP THROUGH THE INPUT LAYER. `KeyE` is the `interact` verb in
 *     `app/src/play/bindings.js`; the presenter opens on `input:action`, which `play/Input.js` emits.
 *   - IT ANSWERS BY TYPING. The response is constructed character by character through real
 *     `keydown` events, exactly as a player would, and marked by the shipped `ItemBank.check`.
 *   - IT READS THE TRACE OFF THE BUS. `probe("teachtrace")` is an observer registered in
 *     `boot/92-teaching.js` that subscribes to eight signal names and records the order they arrive
 *     in. It consumes nothing and emits nothing.
 *
 * Game time moves through `__vs.advance()` with `render:false`, never through wall-clock sleeps:
 * headless SwiftShader renders at a couple of frames a second, so a wall-clock wait measures nothing
 * (`CLAUDE.md`), and the anti-guessing latency floor of 900 ms is measured on the fixed clock — which
 * is precisely what makes it mean the same thing here as in play.
 * ==================================================================================================
 */

import fs from "node:fs";
import path from "node:path";
import { openGame, ROOT, arg, has } from "../../tools/lib/session.mjs";
import { answerFromScreen } from "./lib/reader.mjs";
import { ItemBank, isTypeable } from "../../app/src/learn/ItemBank.js";

const CYCLES = Number(arg("cycles", 36));
const LANG = arg("lang", "en");
const WANT_SHOT = has("shot");

/** The shipped sentence table the reader comprehends with. Never an answer, only a phrasing. */
const STRINGS = (await import(`../../content/items/strings/items-${LANG}.mjs`)).default;

/* ==================================================================================================
 * PART 0 — THE BANK, OFFLINE. Two facts about the shipped content that are identical on every
 * machine and every page load, so they are computed here rather than driven through a browser.
 * ================================================================================================*/
const bankAudit = await (async () => {
  const bank = new ItemBank();
  const dir = new URL("../../content/items/groups/", import.meta.url);
  let items = 0;
  const outsideGrammar = [];
  const refused = [];
  const stemIsAnswer = { generate: 0, other: 0, total: 0 };
  const deTexStem = (s) =>
    String(s ?? "")
      .replace(/\\left|\\right/g, "")
      .replace(/\\cdot|\\times/g, "*")
      .replace(/\\div/g, "/")
      .replace(/\\quad|\\qquad|\\;|\\,|\\:|\\!/g, " ")
      .replace(/([A-Za-z0-9)])\^\{?(\d)\}?/g, (m, b, n) => (Number(n) >= 1 && Number(n) <= 4 ? Array(Number(n)).fill(b).join("*") : m))
      .replace(/[{}]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  let generateItems = 0;
  for (const f of fs.readdirSync(dir)) {
    if (f === "index.mjs") continue;
    const mod = await import(new URL(f, dir));
    for (const it of mod.default.items) {
      items += 1;
      const spelling = bank.accepts(it)[0];
      if (!isTypeable(spelling)) outsideGrammar.push({ id: it.id, spelling });
      let r = { correct: false };
      try {
        r = bank.check(it, spelling);
      } catch {
        r = { correct: false, reason: "threw" };
      }
      if (!r.correct) refused.push({ id: it.id, spelling, reason: r.reason });
      if (it.form === "generate") generateItems += 1;
      try {
        if (bank.check(it, deTexStem(it.stem)).correct) {
          stemIsAnswer.total += 1;
          if (it.form === "generate") stemIsAnswer.generate += 1;
          else stemIsAnswer.other += 1;
        }
      } catch {
        /* a stem that is not a response is the normal case */
      }
    }
  }
  return { items, outsideGrammar, refused, stemIsAnswer, generateItems };
})();

const KP_IDS = JSON.parse(fs.readFileSync(path.join(ROOT, "content/knowledge-graph.json"), "utf8")).nodes.map((n) => n.id);
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, "content/items/manifest.json"), "utf8"));
const lessonOf = (kpId) => MANIFEST.lessons.find((l) => l.kpIds.includes(kpId))?.id ?? null;

const chunkName = (url) => String(url).split("/").pop().split("?")[0];
const groupOf = (name) => KP_IDS.find((id) => name === `${id}.js` || name.startsWith(`${id}-`)) ?? null;

/** Every resource the browser has fetched, by name. The browser's own record, not ours. */
const resources = () => performance.getEntriesByType("resource").map((e) => e.name);

/**
 * Advance exact game seconds without rendering.
 *
 * `Kernel._step` caps the catch-up burst at 8 fixed steps, so one `advance(2.5)` moves the
 * simulation by 0.13 s, not 2.5 s — the reason `session.mjs` slices. Slicing at 1/30 keeps every
 * call inside the budget; `render:false` keeps 100 slices from costing 100 SwiftShader frames.
 */
const sim = (d, seconds) =>
  d.run((s) => {
    const dt = 1 / 30;
    const n = Math.max(1, Math.round(s / dt));
    for (let i = 0; i < n; i += 1) window.__vs.advance(dt, { render: false });
    return window.__vs.stats().simTime;
  }, seconds);

const out = await openGame({ built: true, width: 1280, height: 720, lang: LANG }, async (d) => {
  const report = await d.report();
  const before = await d.run(resources);

  /* ------------------------------------------------------------------ 0. what exists at boot */
  const boot = {
    ready: report.ready,
    fatal: report.fatal,
    errors: report.errors,
    warnings: report.warnings,
    probes: await d.run(() => window.__vs.probeNames()),
    teaching: await d.probe("teaching"),
    scheduler: (await d.probe("mastery"))?.scheduler ?? null,
    learnserve: await d.probe("learnserve"),
    mathtex: await d.probe("mathtex"),
  };

  // Settle the first frames so the camera rig and the authored spawn claims resolve, exactly as a
  // player's first quarter-second does.
  await sim(d, 1.0);
  const spawnPanels = (await d.probe("mathtex"))?.panels?.map((p) => p.id) ?? [];

  /* ------------------------------------------------------- 1. take the mathematics on: KeyE */
  await d.run(() => window.__vs.kernel.get("teachwiring")?.resetTrace?.());
  await d.page.keyboard.down("KeyE");
  await sim(d, 0.35);
  await d.page.keyboard.up("KeyE");
  await sim(d, 0.35);

  const afterInteract = await d.probe("teaching");

  /* ------------------------------------------------------------------ 2. play the cycles */
  const cycles = [];
  let shotTaken = null;
  let occlusion = null;
  let boundary = null;
  let hinted = null;
  let framed = null;
  for (let i = 0; i < CYCLES; i += 1) {
    const state = await d.probe("teaching");
    if (state?.phase !== "standing") {
      // The sitting is spent or the engine has nothing legal. Open the next arc the way the game
      // does — `flow.restart()` is what `boot/90-flow.js` mounts for the break hinge — and let the
      // presenter re-arm on the `learn:session {phase:"open"}` it emits.
      const reopened = await d.run(() => {
        const flow = window.__vs.kernel.get("flow");
        if (!flow?.restart) return null;
        flow.restart("p34-next-sitting");
        return window.__vs.probe("session")?.phase ?? null;
      });
      await sim(d, 0.4);
      const again = await d.probe("teaching");
      if (again?.phase !== "standing") {
        cycles.push({ i, stopped: true, phase: again?.phase ?? null, reopened });
        break;
      }
    }

    const open = await d.probe("teaching");
    const item = open.item;

    /**
     * THE RESPONSE IS READ OFF THE SCREEN. THIS IS THE WHOLE PROOF.
     *
     * Round 2 typed `teachwiring.expected()` — the shipped bank's own accepted spelling, handed to
     * the harness through a hook. That measures the engine and nothing else: the presenter stood
     * `item.stem` alone, so on the bank's commonest opening item a player saw a floating `g` and was
     * required to type `8`, and the run passed anyway. The hook has been deleted from
     * `boot/92-teaching.js`, so there is no route to the key at all; every response below is derived
     * by `lib/reader.mjs` from `probe("mathtex").panels` — the rows the rasterizer actually drew —
     * and from the shipped sentence table it reads them with. A correct mark now means a human
     * being could have earned it.
     *
     * Every fifth item is answered deliberately wrong so the losing side of every gate is exercised
     * too; `-999` is a legal spelling of a wrong answer in the same grammar.
     */
    const panelsNow = (await d.probe("mathtex"))?.panels ?? [];
    const read = answerFromScreen({ panels: panelsNow, table: STRINGS });
    const intendCorrect = i % 5 !== 4;
    const typed = intendCorrect ? (read.response ?? "0") : "-999";

    /**
     * Did the question the bank produced reach the glass unchanged? `probe("teaching").prose.ask` is
     * `ItemBank.text()`'s own return value; `read.screen.askText` is that string recovered from the
     * `\text{}` the panels were rasterized from. Compared character for character, every cycle, in
     * whatever locale the run is in.
     */
    const askOnScreen = read.screen.askText ?? "";
    const askFromBank = String(open?.prose?.ask ?? "");
    const askMatches = askOnScreen.replace(/\s+/g, " ").trim() === askFromBank.replace(/\s+/g, " ").trim();

    await d.page.keyboard.type(typed, { delay: 0 });
    // Past the 900 ms anti-guessing floor, on the fixed clock. Below it a correct response is
    // refused upward and nothing this script claims about mastery would mean anything.
    await sim(d, 1.6);
    const standing = await d.probe("teaching");

    if (!occlusion && i === 1) {
      // One render, once: the proof that the item is on the SURFACE and not merely in a probe.
      await d.run(() => window.__vs.advance(1 / 60));
      if (WANT_SHOT) shotTaken = await d.shoot("review/shots/p34/standing.png");
      /**
       * P15's rule O1, applied to what the ENGINE stands rather than to what the level authored:
       * "a standing claim's ink is 0.0% occluded". Not "mostly visible" — a claim with world
       * geometry in front of it is a claim that may be read wrong, and the round-2 finding was a
       * compositor turning a true statement into a false one. The probe fires a camera-to-ink ray
       * per sample against every depth-writing mesh, so it is taken once, here, on the same frame
       * the capture was taken from.
       */
      occlusion = await d.probe("mathocclusion");
      /**
       * IS EVERY ROW ACTUALLY IN THE FRAME?
       *
       * 0% occluded says nothing has world geometry in front of it. It says nothing at all about a
       * row standing above the top of the screen, which is exactly what the said claim did at
       * `up 6.31` while it was above the stem — NDC y 1.04, ink cut off by the viewport, and every
       * other gate green. So the quad's four corners go through the live camera's own
       * projection * view matrix here, and the run fails if any of them leaves [-1, 1].
       */
      framed = await d.run(() => {
        const k = window.__vs.kernel;
        const cam = k.camera;
        const field = k.get("mathtex");
        if (!cam || !field) return null;
        cam.updateMatrixWorld();
        const vp = cam.projectionMatrix.clone().multiply(cam.matrixWorldInverse);
        const e = vp.elements;
        const proj = (x, y, z) => {
          const w = e[3] * x + e[7] * y + e[11] * z + e[15];
          return [(e[0] * x + e[4] * y + e[8] * z + e[12]) / w, (e[1] * x + e[5] * y + e[9] * z + e[13]) / w];
        };
        let fx = -cam.matrixWorld.elements[8];
        let fz = -cam.matrixWorld.elements[10];
        const L = Math.hypot(fx, fz) || 1;
        fx /= L;
        fz /= L;
        const rx = -fz;
        const rz = fx;
        const rows = [];
        for (const [id, p] of field.panels) {
          const mesh = p.mesh;
          mesh.updateWorldMatrix(true, false);
          const el = mesh.matrixWorld.elements;
          const hw = mesh.scale.x / 2;
          const hh = mesh.scale.y / 2;
          const pts = [];
          for (const sx of [-1, 1]) for (const sy of [-1, 1]) pts.push(proj(el[12] + rx * hw * sx, el[13] + hh * sy, el[14] + rz * hw * sx));
          const pr = p.probe();
          rows.push({
            id,
            x: [Math.min(...pts.map((v) => v[0])), Math.max(...pts.map((v) => v[0]))].map((v) => Number(v.toFixed(3))),
            y: [Math.min(...pts.map((v) => v[1])), Math.max(...pts.map((v) => v[1]))].map((v) => Number(v.toFixed(3))),
            legible: pr.legible,
            emScreenPx: pr.emScreenPx,
            strokeEms: pr.strokeEms,
            strokePx: pr.strokePx,
            floorPx: pr.legibleFloorPx,
            em: pr.em,
          });
        }
        return rows;
      });
    }

    /**
     * THE HINT LADDER, PULLED ONCE, THROUGH THE KEYBOARD.
     *
     * `ItemBank.present()` has returned three localized hints per item since P17 and until now
     * nothing drew one. `?` is a key `ENTRY_GRAMMAR` does not admit, so it cannot eat a character of
     * a response; the rung it stands is read back off `probe("mathtex")` like everything else.
     */
    if (!hinted && i === 2) {
      const beforeHint = (await d.probe("mathtex"))?.panels?.map((p) => p.id) ?? [];
      await d.page.keyboard.press("?");
      await sim(d, 0.3);
      const afterPanels = (await d.probe("mathtex"))?.panels ?? [];
      const t = await d.probe("teaching");
      hinted = {
        beforeHint,
        afterHint: afterPanels.map((p) => p.id),
        hintPanel: afterPanels.find((p) => p.id === "teach-hint")?.tex ?? null,
        hintFromBank: t?.prose?.hints?.[0] ?? null,
        hintIndex: t?.prose?.hintIndex ?? null,
        hintShown: t?.item?.hintShown ?? null,
        hintsShown: t?.stats?.hintsShown ?? 0,
      };
    }

    await d.page.keyboard.press("Enter");
    await sim(d, 2.6); // feedback (1.6) + gap (0.5), with margin for the next present
    const marked = await d.probe("teaching");

    /**
     * THE SITTING BOUNDARY, driven once, halfway through.
     *
     * `flow.restart()` is what `boot/90-flow.js` mounts for the break hinge, and it is the one thing
     * that can take the arc out from under a presenter mid-loop. The presenter re-arms on the
     * `learn:session {phase:"open"}` that `Session.begin()` emits — an untested branch is exactly
     * the kind of thing this wave exists to stop shipping, so it is driven here rather than reasoned
     * about.
     */
    if (i === Math.floor(CYCLES / 2)) {
      boundary = await d.run(() => {
        const flow = window.__vs.kernel.get("flow");
        const before = window.__vs.probe("session");
        flow.restart("p34-break");
        return { sittingsBefore: before?.cycle?.sittings ?? null, phaseAfter: window.__vs.probe("session")?.phase ?? null };
      });
      await sim(d, 3.0);
      const resumed = await d.probe("teaching");
      boundary.presenterPhase = resumed?.phase ?? null;
      boundary.presentedAfter = resumed?.stats?.presented ?? null;
      boundary.sittingsAfter = (await d.probe("session"))?.cycle?.sittings ?? null;
    }

    cycles.push({
      i,
      kpId: item?.kpId ?? null,
      lesson: lessonOf(item?.kpId ?? ""),
      itemId: item?.itemId ?? null,
      form: item?.form ?? null,
      phase: item?.phase ?? null,
      mode: item?.mode ?? null,
      family: item?.family ?? null,
      source: item?.source ?? null,
      relaxation: item?.relaxation ?? null,
      testOut: item?.testOut ?? false,
      typed,
      intendCorrect,
      responseOnScreen: standing?.response ?? null,
      standingIds: standing?.standing ?? [],
      /* what the reader could see, what it made of it, and whether the engine agreed */
      askKey: read.askKey,
      strategy: read.strategy,
      readResponse: read.response,
      askOnScreen,
      askFromBank,
      askMatches,
      askRows: read.screen.ask.length,
      givenRows: read.screen.given.length,
      workingRows: read.screen.working.length,
      saidRows: read.screen.said.length,
      entryStanding: read.screen.entry != null,
      // `learn/Teaching.js` ENTRY_RULE — deliberately decimal-free, see the constant's own comment.
      entryEmptyRule: read.screen.entry === "\\rule{2em}{1pt}",
      itemGiven: Array.isArray(open?.stood) ? open.stood.filter((r) => r.kind === "given").length : 0,
      correct: marked?.lastRespond?.correct ?? null,
      scored: marked?.lastRespond?.scored ?? null,
      respondItemId: marked?.lastRespond?.itemId ?? null,
    });
  }

  /* ------------------------------------------------------------------ 3. read everything back */
  // The FULL trace, not the tail `probe("teachtrace")` publishes: a truncated trace makes a complete
  // cycle look incomplete, and this script's whole job is to count complete cycles.
  const trace = await d.run(() => window.__vs.kernel.get("teachwiring")?.trace?.() ?? window.__vs.probe("teachtrace"));
  const teaching = await d.probe("teaching");
  const mastery = await d.probe("mastery");
  const session = await d.probe("session");
  const itembank = await d.probe("itembank");
  const learnserve = await d.probe("learnserve");
  const mathtex = await d.probe("mathtex");
  const finalReport = await d.report();
  const after = await d.run(resources);

  return {
    boot,
    spawnPanels,
    afterInteract,
    cycles,
    trace,
    teaching,
    mastery,
    session,
    itembank,
    learnserve,
    mathtex,
    finalReport,
    resourcesBefore: before,
    resourcesAfter: after,
    shot: shotTaken,
    occlusion,
    boundary,
    hinted,
    framed,
    bankAudit,
  };
});

/* ================================================================================== reporting */

const line = (s = "") => console.log(s);
const claims = [];
const claim = (id, ok, text) => {
  claims.push({ id, ok, text });
  line(`${ok ? "PASS" : "FAIL"}  ${id}  ${text}`);
};

line("=".repeat(98));
line("P34 — the learning round trip, driven through the SHIPPED BUILD");
line("=".repeat(98));
line(`build ready: ${out.boot.ready}   fatal: ${out.boot.fatal ?? "none"}   locale: ${LANG}`);
line(`console errors: ${out.finalReport.errors.length}   katex failed: ${out.finalReport.katex.failed}   raw TeX leak: ${out.finalReport.katex.rawSourceLeak}`);
line("");

/* ------------------------------------------------------------------ the trace, per cycle */
const entries = out.trace?.entries ?? [];
const groups = [];
for (const e of entries) {
  if (e.name === "learn:present") groups.push([]);
  if (!groups.length) groups.push([]);
  groups[groups.length - 1].push(e);
}
line("-".repeat(98));
line("SIGNAL TRACE — the ordered list of signals actually observed on the bus, per cycle");
line("(observer: boot/92-teaching.js; every emitter is shipped code under app/src)");
line("-".repeat(98));
const showGroups = groups.slice(0, 6).concat(groups.length > 8 ? [] : []);
groups.slice(0, 8).forEach((g, i) => {
  const head = g.find((e) => e.name === "learn:present");
  line(`cycle ${String(i).padStart(2)}  ${head?.kpId ?? "?"}  ${head?.itemId ?? ""}`);
  for (const e of g) {
    const det = e.detail ? "  " + JSON.stringify(e.detail) : "";
    line(`   t=${String(e.t).padStart(7)}  ${e.name.padEnd(14)} ${String(e.kpId ?? "").padEnd(22)}${det}`);
  }
});
if (groups.length > 8) line(`   ... ${groups.length - 8} further cycles, same shape`);
line("");
line(`signal counts: ${JSON.stringify(out.trace?.counts ?? {})}`);
line("");

/* ------------------------------------------------------------------ the claims */
line("-".repeat(98));
line("CLAIMS");
line("-".repeat(98));

const counts = out.trace?.counts ?? {};
const presents = counts["learn:present"] ?? 0;
const shows = counts["math:show"] ?? 0;
const hides = counts["math:hide"] ?? 0;
const responds = counts["learn:respond"] ?? 0;
const masteries = counts["learn:mastery"] ?? 0;
const teaches = counts["learn:teach"] ?? 0;
const unlocks = counts["learn:unlock"] ?? 0;

/** A cycle is COMPLETE when its trace contains present -> show -> respond, in that order. */
const complete = groups.filter((g) => {
  const iP = g.findIndex((e) => e.name === "learn:present");
  const iS = g.findIndex((e) => e.name === "math:show");
  const iR = g.findIndex((e) => e.name === "learn:respond");
  return iP === 0 && iS > iP && iR > iS;
});
const withMastery = complete.filter((g) => g.some((e) => e.name === "learn:mastery"));
const withHide = complete.filter((g) => g.some((e) => e.name === "math:hide"));

claim(
  "C1",
  complete.length >= 8,
  `${complete.length} complete cycles observed with the chain present -> display -> respond in order ` +
    `(${withMastery.length} of them also carried learn:mastery, ${withHide.length} retired with math:hide)`
);

/* ================================================================================================
 * THE ROUND-2 GAP: could a human being have answered any of this?
 * ==============================================================================================*/
const played = out.cycles.filter((c) => !c.stopped);
const meantToBeRight = played.filter((c) => c.intendCorrect);
const readIt = meantToBeRight.filter((c) => c.readResponse != null);
const earned = meantToBeRight.filter((c) => c.readResponse != null && c.correct === true);
const wrongOnPurpose = played.filter((c) => !c.intendCorrect);
claim(
  "R1",
  earned.length >= 5 && earned.length === readIt.length,
  `THE ANSWER KEY IS GONE AND THE LOOP STILL CLOSES: teachwiring.expected() no longer exists, and ` +
    `${earned.length} of ${meantToBeRight.length} cycles were answered from probe("mathtex").panels alone ` +
    `and marked CORRECT by the shipped ItemBank.check (${readIt.length} were readable at all; ` +
    `${wrongOnPurpose.length} more were answered deliberately wrong to exercise the losing side). ` +
    `Strategies used: ${JSON.stringify(played.reduce((a, c) => ({ ...a, [c.strategy ?? "?"]: (a[c.strategy ?? "?"] ?? 0) + 1 }), {}))}`
);

const askShown = played.filter((c) => c.askRows > 0);
const askSame = played.filter((c) => c.askMatches);
claim(
  "R2",
  askShown.length === played.length && askSame.length === played.length,
  `the localized question reaches the glass in ${LANG}: ${askShown.length}/${played.length} cycles stood an ask ` +
    `row, and on ${askSame.length}/${played.length} the string recovered from the rasterized \\text{} was ` +
    `character-for-character what ItemBank.text() returned — no ⟨ask.reading⟩, no partial render ` +
    `(e.g. ${JSON.stringify(played[0]?.askOnScreen ?? null)})`
);

const needGiven = played.filter((c) => c.itemGiven > 0);
const gotGiven = needGiven.filter((c) => c.givenRows === c.itemGiven);
claim(
  "R3",
  (out.teaching?.stats?.givenRows ?? 0) > 0 && gotGiven.length === needGiven.length,
  `the charge in the socket is on screen: ${out.teaching?.stats?.givenRows} given rows stood this run, and ` +
    `${gotGiven.length}/${needGiven.length} of the cycles that carry a given showed every line of it — the ` +
    `difference between a floating "t" and "t" with "t = 5" under it`
);

const entryAlways = played.filter((c) => c.entryStanding);
claim(
  "R4",
  entryAlways.length === played.length,
  `the response slot stands from _present() onward, empty or not: ${entryAlways.length}/${played.length} cycles ` +
    `had a teach-entry row standing before a key was pressed (${played.filter((c) => c.entryEmptyRule).length} of ` +
    `them showing the empty rule)`
);

const h = out.hinted ?? null;
claim(
  "R5",
  !!h && h.hintPanel != null && h.hintFromBank != null && h.hintsShown > 0,
  `the item's own graded hint ladder reaches the world: "?" stood teach-hint carrying ` +
    `${JSON.stringify(h?.hintPanel)} against ItemBank.present().hints[0] = ${JSON.stringify(h?.hintFromBank)} ` +
    `(rung ${h?.hintIndex} of the ladder; the response was then priced as hinted=${h?.hintShown})`
);

const ba = out.bankAudit;
claim(
  "R6",
  ba.outsideGrammar.length === 0 && ba.refused.length === 0,
  `the untypeable canonical answer is fixed at the bank: all ${ba.items} committed items now have an ` +
    `accepts()[0] inside ENTRY_GRAMMAR (${ba.outsideGrammar.length} outside) and the shipped check() marks ` +
    `every one of them correct (${ba.refused.length} refused). Round 2: "x = 8,\\; y = 8" for a pair, ` +
    `"2: 4 \\cdot 30" for a repair, 241 items untypeable in total`
);

const fr = out.framed ?? [];
const teachFrames = fr.filter((r) => String(r.id).startsWith("teach-"));
const outside = teachFrames.filter((r) => r.x[0] < -1 || r.x[1] > 1 || r.y[0] < -1 || r.y[1] > 1);
const illegible = teachFrames.filter((r) => !r.legible);

/**
 * NO ROW MAY STAND ON ANOTHER ROW.
 *
 * `TexPanel.js`'s header calls world geometry in front of a claim "the ninth way to lose a claim";
 * two of this presenter's own rows overlapping is the same loss with the compositor doing it to
 * itself, and every other gate is blind to it. It was not hypothetical: the Polish build stood a
 * `\rule` whose decimals `Tex.localizeTex` had rewritten, KaTeX accepted the result without
 * complaint, and the entry row covered two lines of working while occlusion read 0%, legibility read
 * true, NDC read inside the frame and `katex.failed` read 0. Every row shares `forward: 14` and is
 * yaw-billboarded, so they are coplanar and an NDC box intersection is exact.
 */
const overlaps = [];
for (let i = 0; i < teachFrames.length; i += 1) {
  for (let j = i + 1; j < teachFrames.length; j += 1) {
    const a = teachFrames[i];
    const b = teachFrames[j];
    const dx = Math.min(a.x[1], b.x[1]) - Math.max(a.x[0], b.x[0]);
    const dy = Math.min(a.y[1], b.y[1]) - Math.max(a.y[0], b.y[0]);
    if (dx > 0 && dy > 0) overlaps.push(`${a.id} x ${b.id} (${dx.toFixed(3)} x ${dy.toFixed(3)} NDC)`);
  }
}
claim(
  "R8",
  teachFrames.length > 1 && overlaps.length === 0,
  `no row the presenter stands covers another: ${teachFrames.length} rows compared pairwise in the ` +
    `billboard plane, ${overlaps.length} overlapping${overlaps.length ? ` — ${overlaps.join("; ")}` : ""}`
);

claim(
  "R7",
  teachFrames.length > 0 && outside.length === 0 && illegible.length === 0,
  `every row the presenter stands is inside the frame and above the legibility floor: ` +
    `${teachFrames.length} rows projected through the live camera, ${outside.length} outside NDC [-1,1], ` +
    `${illegible.length} standing in as the solid mark ` +
    `(${teachFrames.map((r) => `${r.id} y[${r.y[0]},${r.y[1]}]`).join(" ")})`
);

claim(
  "C2",
  presents > 0 && shows > 0 && hides > 0,
  `the three seams that had no emitter now have one: learn:present x${presents}, math:show x${shows}, math:hide x${hides}`
);

const drivenNow = out.mathtex?.driven === true;
const spawnClaims = ["leaf9-span", "leaf9-share", "leaf9-working", "leaf9-mark"];
const spawnStoodDown = spawnClaims.filter((id) => !(out.mathtex?.panels ?? []).some((p) => p.id === id));
claim(
  "C3",
  drivenNow && spawnStoodDown.length === spawnClaims.length,
  `learn:present reached its listener: boot/60-mathtex.js flipped the field to driven=${drivenNow} and stood ` +
    `${spawnStoodDown.length}/4 authored spawn claims down (they were ${out.spawnPanels.length} panels at spawn: ${out.spawnPanels.join(", ")})`
);

const respondDetail = entries.filter((e) => e.name === "learn:respond").map((e) => e.detail);
// `UNREPORTED_FAMILY` is `Mastery`'s sentinel for "the presenter declined to say"; anything that is
// not a real family name counts as absent here.
const namedFamily = (f) => typeof f === "string" && f.length > 0 && !/unreported/i.test(f);
const withFamily = respondDetail.filter((r) => namedFamily(r?.family)).length;
const withLatency = respondDetail.filter((r) => Number.isFinite(r?.latencyMs) && r.latencyMs > 0).length;
const scored = respondDetail.filter((r) => r?.scored === true).length;
claim(
  "C4",
  respondDetail.length > 0 &&
    respondDetail.length === responds &&
    withFamily === respondDetail.length &&
    withLatency === respondDetail.length &&
    scored > 0,
  `learn:respond x${responds} (${respondDetail.length} in the trace): ${withFamily} carried a reported generator ` +
    `family, ${withLatency} carried a real latency, ${scored} were SCORED by Mastery (the rest were refused by a ` +
    `gate, which is the engine working)`
);

const unreported = out.mastery?.stats?.unreportedFamilyItems ?? out.learnserve?.unreportedFamilyItems ?? null;
claim(
  "C4b",
  unreported === 0,
  `the round-2 delivery defect stayed closed: unreportedFamilyItems = ${unreported} ` +
    `(family reporting: ${out.learnserve?.familyReporting} via ${out.learnserve?.familyReportingSource})`
);

claim(
  "C5",
  masteries > 0 && (out.mastery?.stats?.scoredItems ?? 0) > 0,
  `Mastery consumed the responses: learn:mastery x${masteries}, scoredItems ${out.mastery?.stats?.scoredItems}, ` +
    `refusedUpward ${out.mastery?.stats?.refusedUpward}, unscored ${out.mastery?.stats?.unscoredItems}`
);

claim(
  "C6",
  teaches > 0 && (out.teaching?.stats?.teachHeard ?? 0) > 0,
  `learn:teach x${teaches} emitted by Scheduler and CONSUMED ${out.teaching?.stats?.teachHeard} times by the ` +
    `presenter (phases seen: ${JSON.stringify(out.teaching?.stats?.byPhase ?? {})})`
);

claim(
  "C6b",
  (out.teaching?.stats?.respondHeard ?? 0) > 0,
  `learn:respond CONSUMED ${out.teaching?.stats?.respondHeard} times by the presenter — the claim is retired on the ` +
    `engine's announcement, not on submit()'s return value`
);

const sched = out.mastery?.scheduler ?? {};
claim(
  "C7",
  (sched.served ?? 0) > 0 && (sched.serveMisses ?? 1) === 0,
  `Scheduler.serve() is on the shipped path and carried current: served ${sched.served} items ` +
    `(source ${JSON.stringify(sched.servedBySource ?? {})}, relaxation ${JSON.stringify(sched.servedByRelaxation ?? {})}), ` +
    `serveMisses ${sched.serveMisses}`
);

const delivery = out.session?.delivery ?? {};
claim(
  "C7b",
  (delivery.withItem ?? 0) > 0 && delivery.withItem === delivery.requests && (delivery.unserved ?? 1) === 0,
  `the session layer recorded delivery for every request: ${delivery.withItem}/${delivery.requests} carried an item, ` +
    `${delivery.withFamily} carried a family, itemRelaxation ${JSON.stringify(delivery.byRelaxation ?? {})}`
);

const newGroups = [...new Set(out.resourcesAfter.filter((u) => !out.resourcesBefore.includes(u)).map(chunkName).map(groupOf).filter(Boolean))];
const bootGroups = [...new Set(out.resourcesBefore.map(chunkName).map(groupOf).filter(Boolean))];
const loads = out.itembank?.loads ?? {};
const lazyTotal = (loads.explicit ?? 0) + (loads.prefetch ?? 0) + (loads.demand ?? 0);
claim(
  "C8",
  lazyTotal > 0 && (bootGroups.length + newGroups.length) > 0,
  `${lazyTotal} item groups were loaded LAZILY on this page (${JSON.stringify(loads)}); ` +
    `${bootGroups.length} chunk(s) arrived before the loop opened, ${newGroups.length} more during play` +
    (newGroups.length ? `: ${newGroups.join(", ")}` : "")
);

const warms = out.itembank?.warmLog ?? [];
const triggers = [...new Set(warms.map((w) => w.trigger))];
/**
 * The follow-the-learner claim, stated as the thing it actually has to be: did chunks arrive for the
 * lessons the learner WENT TO, rather than only for the one the frontier started in? `warmFrontier`
 * answers where the model thinks the learner is; a presented knowledge point is where they are.
 */
const lessonsPresented = [...new Set(out.cycles.map((c) => c.lesson).filter(Boolean))];
const lessonsArrived = [...new Set([...bootGroups, ...newGroups].map(lessonOf).filter(Boolean))];
const followed = lessonsPresented.filter((l) => lessonsArrived.includes(l));
claim(
  "C8b",
  warms.length > 0 && lessonsPresented.length > 1 && followed.length === lessonsPresented.length,
  `the loader followed the learner past the lesson it started in: items were presented from ` +
    `${JSON.stringify(lessonsPresented)} and chunks arrived for ${JSON.stringify(lessonsArrived)} ` +
    `(${out.itembank?.warms} frontier warm(s), triggers ${JSON.stringify(triggers)}; the rest came from the ` +
    `learn:present and learn:unlock routes in boot/62-itembank.js)`
);

claim(
  "C9",
  unlocks > 0,
  `learn:unlock x${unlocks} — a gate crossing reached its listener ` +
    `(nodes unlocked this run: ${JSON.stringify(entries.filter((e) => e.name === "learn:unlock").map((e) => e.kpId))})`
);

const occ = out.occlusion ?? null;
const teachPanels = (occ?.panels ?? []).filter((p) => String(p.id).startsWith("teach-"));
const worstTeach = teachPanels.length ? Math.max(...teachPanels.map((p) => p.occludedPct ?? 0)) : null;
claim(
  "C9b",
  teachPanels.length > 0 && worstTeach === 0,
  `P15 rule O1 holds for what the ENGINE stands, not just for what the level authored: ` +
    `${teachPanels.length} presented claim(s) measured, worst occlusion ${worstTeach}% ` +
    `(${teachPanels.map((p) => `${p.id} ${p.occludedPct}%`).join(", ")})`
);

const b = out.boundary ?? null;
claim(
  "C11",
  !!b && b.presenterPhase === "standing" && b.sittingsAfter > b.sittingsBefore && (out.teaching?.stats?.dropped ?? 1) === 0,
  `the loop survives a sitting boundary: flow.restart() closed sitting ${b?.sittingsBefore} and opened ` +
    `${b?.sittingsAfter}, the presenter re-armed on learn:session{open} and was ${b?.presenterPhase} again, and ` +
    `the in-flight response was scored through the engine rather than lost ` +
    `(rescued ${out.teaching?.stats?.rescued}, dropped ${out.teaching?.stats?.dropped})`
);

claim(
  "C10",
  out.finalReport.errors.length === 0 && out.finalReport.katex.failed === 0 && out.finalReport.katex.rawSourceLeak === false,
  `the shipped page stayed clean while the loop ran: ${out.finalReport.errors.length} console errors, ` +
    `${out.finalReport.katex.failed} KaTeX failures, raw TeX leak ${out.finalReport.katex.rawSourceLeak}`
);

/* ------------------------------------------------------------------ the run, in numbers */
line("");
line("-".repeat(98));
line("THE RUN");
line("-".repeat(98));
line(`cycles driven            ${out.cycles.length}`);
line(`presenter               ${JSON.stringify(out.teaching?.stats ?? {})}`);
line(`knowledge points seen   ${JSON.stringify([...new Set(out.cycles.map((c) => c.kpId).filter(Boolean))])}`);
line(`lessons seen            ${JSON.stringify([...new Set(out.cycles.map((c) => c.lesson).filter(Boolean))])}`);
line(`forms x phases          ${JSON.stringify(out.cycles.reduce((a, c) => ({ ...a, [`${c.form}|${c.phase}`]: (a[`${c.form}|${c.phase}`] ?? 0) + 1 }), {}))}`);
line(`item source             ${JSON.stringify(out.cycles.reduce((a, c) => ({ ...a, [c.source ?? "?"]: (a[c.source ?? "?"] ?? 0) + 1 }), {}))}`);
line(`mastery summary         level1 ${out.mastery?.level1Percent ?? "?"}%  scored ${out.mastery?.stats?.scoredItems}  certifications ${out.mastery?.stats?.certifications}`);
line(`session                 phase ${out.session?.phase}  items ${out.session?.elapsed?.items}  beats ${out.session?.elapsed?.beats}  close ${out.session?.closeReason}`);
line(`field                   ${out.mathtex?.panels?.length ?? 0} panels standing: ${JSON.stringify((out.mathtex?.panels ?? []).map((p) => p.id))}`);
if (out.shot) line(`capture                 ${out.shot}`);
line("");
line("-".repeat(98));
line("WHAT THE READER SAW, PER CYCLE — the response, and where it came from");
line("-".repeat(98));
for (const c of out.cycles.filter((x) => !x.stopped).slice(0, 14)) {
  line(
    `  ${String(c.i).padStart(2)} ${String(c.kpId).padEnd(16)} ${String(c.form).padEnd(9)} ask=${String(c.askKey).padEnd(22)} ` +
      `rows[ask ${c.askRows} said ${c.saidRows} given ${c.givenRows} working ${c.workingRows} entry ${c.entryStanding ? 1 : 0}] ` +
      `-> ${String(c.strategy).padEnd(17)} typed ${JSON.stringify(c.typed).padEnd(20)} ${c.correct ? "CORRECT" : "wrong"}`
  );
}

line("");
line("-".repeat(98));
line("OPEN FINDING FOR THE CONTENT PIECES — not fixed here, measured here");
line("-".repeat(98));
line(
  `  ${out.bankAudit.stemIsAnswer.generate} of the bank's ${out.bankAudit.generateItems} generate items are marked ` +
    `CORRECT by the shipped checker when the response is the stem the presenter is standing.`
);
line(
  `  "Author a claim that closes at 35" is asked with an accepted answer already in the frame. The presenter cannot`
);
line(
  `  drop the stem safely — 'reshape' and 'partitionWitness' items are ABOUT the stem — so this is a content or a`
);
line(`  checker decision (P17/P18), and it is why lib/reader.mjs answers every ask.gen.* from the ask and never by`);
line(`  copying the stem: a proof that leaned on the leak would be measuring the leak.`);
line(
  `  Also seen: ask.gen.sealCan / ask.gen.gathersTo interpolate the checker's machine spelling into player prose ` +
    `("... comes to 24*n^-1").`
);

if (out.finalReport.warnings.length) {
  line("");
  line("warnings from the running page:");
  for (const w of out.finalReport.warnings.slice(0, 8)) line(`   ${w}`);
}

const failed = claims.filter((c) => !c.ok);
line("");
line("=".repeat(98));
line(`${claims.length - failed.length}/${claims.length} claims pass${failed.length ? ` — FAILING: ${failed.map((c) => c.id).join(", ")}` : ""}`);
line("=".repeat(98));

fs.mkdirSync(path.join(ROOT, "review/measure/evidence"), { recursive: true });
// One file per locale: the three-language run is the evidence for R2, and a shared filename would
// leave only the last one on disk.
const evidenceFile = LANG === "en" ? "review/measure/evidence/P34.json" : `review/measure/evidence/P34-${LANG}.json`;
fs.writeFileSync(path.join(ROOT, evidenceFile), JSON.stringify({ claims, ...out }, null, 1));
line(`evidence: ${evidenceFile}`);
process.exit(failed.length ? 1 : 0);
