#!/usr/bin/env node
/**
 * CRITIC's own driver for P34. Independent of review/measure/P34.mjs and of boot/92-teaching.js's
 * `teachtrace` observer.
 *
 * How it differs from the builder's script, on purpose:
 *   - It records EVERY signal name by wrapping `kernel.signals.emit` itself, so nothing can be
 *     hidden by an allow-list of eight names.
 *   - It never calls `teachwiring.expected()`, `teachwiring.trace()` or `resetTrace()`.
 *   - It never emits a signal.
 *   - It reads p(known) out of `Mastery.snapshot()` before and after and diffs it.
 *   - It records `performance.getEntriesByType("resource")` with startTime, so a chunk that arrived
 *     DURING play can be distinguished from one that arrived at boot by its timestamp, not by a
 *     set difference the harness controls.
 */
import fs from "node:fs";
import path from "node:path";
import { openGame, ROOT, arg, has } from "../../tools/lib/session.mjs";
import { answerFromScreen } from "./lib/reader.mjs";

const CYCLES = Number(arg("cycles", 40));
/**
 * know   — read the shipped bank's own accepted spelling off the page and type it.
 * guess  — type `7` at everything.
 * screen — P34 round 3. THE ANSWER KEY IS NOT READ AT ALL: the response is derived from
 *          `probe("mathtex").panels` by `lib/reader.mjs`, which is the only mode that says anything
 *          about whether a human being could have answered. `know` is kept so the two runs can be
 *          compared: same driver, same bus recorder, one difference.
 */
const MODE = arg("mode", "know"); // know | guess | screen
const LANG = arg("lang", "en");
const STRINGS = (await import(`../../content/items/strings/items-${LANG}.mjs`)).default;
const SHOT = has("shot");

const sim = (d, seconds) =>
  d.run((s) => {
    const dt = 1 / 30;
    const n = Math.max(1, Math.round(s / dt));
    for (let i = 0; i < n; i += 1) window.__vs.advance(dt, { render: false });
    return window.__vs.stats().simTime;
  }, seconds);

const out = await openGame({ built: true, width: 1280, height: 720 }, async (d) => {
  // ---------------------------------------------------------------- 0. my own bus recorder
  const installed = await d.run(() => {
    const k = window.__vs.kernel;
    const s = k.signals;
    window.__crit = { log: [], counts: {} };
    const orig = s.emit.bind(s);
    s.emit = (name, value) => {
      const L = window.__crit.log;
      window.__crit.counts[name] = (window.__crit.counts[name] ?? 0) + 1;
      if (L.length < 20000) {
        L.push({
          seq: L.length,
          t: Number((k.simTime ?? 0).toFixed(2)),
          n: name,
          kpId: value?.kpId ?? null,
          itemId: value?.itemId ?? value?.id ?? null,
          v:
            name === "learn:respond"
              ? { correct: value?.correct === true, scored: value?.scored === true, credited: value?.credited === true, family: value?.family ?? null, latencyMs: value?.latencyMs ?? null, reason: value?.reason ?? null }
              : name === "learn:mastery"
                ? { p: value?.p ?? null, delta: value?.delta ?? null, status: value?.status ?? null }
                : name === "math:show"
                  ? { id: value?.id ?? null, tex: value?.tex ?? null }
                  : name === "math:hide"
                    ? { id: value?.id ?? null }
                    : name === "learn:present"
                      ? { form: value?.form ?? null, phase: value?.phase ?? null, family: value?.family ?? null, source: value?.source ?? null, relaxation: value?.relaxation ?? null }
                      : name === "learn:teach"
                        ? { phase: value?.phase ?? null }
                        : name === "learn:session"
                          ? { phase: value?.phase ?? null }
                          : null,
        });
      }
      return orig(name, value);
    };
    return typeof s.emit === "function";
  });

  const res = () =>
    d.run(() => performance.getEntriesByType("resource").map((e) => ({ n: e.name.split("/").pop().split("?")[0], t: Math.round(e.startTime) })));

  const snap = () =>
    d.run(() => {
      const sys = window.__vs.kernel.get("learning");
      const m = sys?.mastery;
      if (!m?.snapshot) return null;
      const s = m.snapshot();
      return { keys: Object.keys(s), raw: JSON.stringify(s).slice(0, 400), nodes: s.nodes ?? s.cells ?? s.state ?? null };
    });

  const beliefs = () =>
    d.run(() => {
      const sys = window.__vs.kernel.get("learning");
      const m = sys?.mastery;
      if (!m) return null;
      const s = m.snapshot();
      // Find whatever structure carries per-knowledge-point belief and flatten to {id: p}.
      const flat = {};
      const walk = (obj, key) => {
        if (!obj || typeof obj !== "object") return;
        for (const [k, v] of Object.entries(obj)) {
          if (v && typeof v === "object") {
            const p = v.p ?? v.pKnown ?? v.belief ?? null;
            if (typeof p === "number") flat[k] = p;
            else walk(v, k);
          }
        }
      };
      walk(s, "");
      return flat;
    });

  const report0 = await d.report();
  const beliefsBefore = await beliefs();
  const snapShape = await snap();
  const resBefore = await res();
  const schedBefore = (await d.probe("mastery"))?.scheduler ?? null;
  const bankBefore = await d.probe("itembank");

  await sim(d, 1.0);
  const spawn = (await d.probe("mathtex"))?.panels?.map((p) => ({ id: p.id, tex: p.tex })) ?? [];

  // ---------------------------------------------------------------- 1. a player takes it on
  await d.page.keyboard.down("KeyE");
  await sim(d, 0.3);
  await d.page.keyboard.up("KeyE");
  await sim(d, 0.5);
  const afterE = await d.probe("teaching");

  // ---------------------------------------------------------------- 2. play
  const cycles = [];
  let firstShot = null;
  let shotContext = null;
  for (let i = 0; i < CYCLES; i += 1) {
    let st = await d.probe("teaching");
    if (st?.phase !== "standing") {
      // A player who finds nothing standing presses interact again. No flow.restart() here:
      // the builder's script reopens the sitting for the presenter; a player cannot.
      await d.page.keyboard.down("KeyE");
      await sim(d, 0.3);
      await d.page.keyboard.up("KeyE");
      await sim(d, 2.0);
      st = await d.probe("teaching");
      if (st?.phase !== "standing") {
        cycles.push({ i, stalled: true, phase: st?.phase ?? null, session: (await d.probe("session"))?.phase ?? null });
        break;
      }
    }

    const open = await d.probe("teaching");
    const item = open.item ?? null;
    // The learner's answer. In "know" mode it is the shipped bank's own accepted spelling, read
    // from the bank object the presenter was injected with — NOT from the builder's
    // `teachwiring.expected()` harness hook.
    const ans =
      MODE === "screen"
        ? null
        : await d.run(() => {
            const t = window.__vs.kernel.get("teaching");
            try {
              return t?.bank?.accepts ? (t.bank.accepts(t.item)[0] ?? null) : null;
            } catch {
              return null;
            }
          });

    // the mathematics on screen at the moment of answering
    const panelsNow = (await d.probe("mathtex"))?.panels ?? [];
    const onScreen = panelsNow.map((p) => ({ id: p.id, tex: p.tex }));
    const read = MODE === "screen" ? answerFromScreen({ panels: panelsNow, table: STRINGS }) : null;
    const typed = MODE === "guess" ? "7" : MODE === "screen" ? (read?.response ?? "0") : (ans ?? "7");

    await d.page.keyboard.type(typed, { delay: 0 });
    await sim(d, 1.8); // past the 900 ms latency floor on the fixed clock

    if (i === 2) {
      await d.run(() => window.__vs.advance(1 / 60));
      if (SHOT) firstShot = await d.shoot("review/shots/p34/critic-standing.png");
      shotContext = {
        item,
        typed,
        panels: (await d.probe("mathtex"))?.panels?.map((p) => ({ id: p.id, tex: p.tex, pos: p.position ?? null })) ?? [],
        teaching: await d.probe("teaching"),
      };
    }

    await d.page.keyboard.press("Enter");
    await sim(d, 2.6);

    cycles.push({
      i,
      kpId: item?.kpId ?? null,
      itemId: item?.itemId ?? null,
      form: item?.form ?? null,
      phase: item?.phase ?? null,
      family: item?.family ?? null,
      source: item?.source ?? null,
      relaxation: item?.relaxation ?? null,
      typed,
      onScreen,
      askKey: read?.askKey ?? null,
      strategy: read?.strategy ?? null,
      readFromScreen: read?.response ?? null,
    });
  }

  // ---------------------------------------------------------------- 3. read back
  const log = await d.run(() => window.__crit.log);
  const counts = await d.run(() => window.__crit.counts);
  const beliefsAfter = await beliefs();
  const resAfter = await res();
  const finalReport = await d.report();

  return {
    installed,
    report0,
    snapShape,
    spawn,
    afterE,
    cycles,
    log,
    counts,
    beliefsBefore,
    beliefsAfter,
    resBefore,
    resAfter,
    schedBefore,
    schedAfter: (await d.probe("mastery"))?.scheduler ?? null,
    mastery: await d.probe("mastery"),
    session: await d.probe("session"),
    itembankBefore: bankBefore,
    itembank: await d.probe("itembank"),
    learnserve: await d.probe("learnserve"),
    mathtex: await d.probe("mathtex"),
    finalReport,
    firstShot,
    shotContext,
    simEnd: await d.run(() => window.__vs.stats().simTime),
  };
});

const L = (s = "") => console.log(s);
L("=".repeat(96));
L(`CRITIC DRIVER — built bundle, own bus recorder (emit wrapper installed: ${out.installed}), mode=${MODE}`);
L("=".repeat(96));
L(`sim seconds of play: ${out.simEnd}   cycles driven: ${out.cycles.length}   console errors: ${out.finalReport.errors.length}`);
L("");
L("ALL SIGNAL COUNTS SEEN ON THE BUS (every name, not an allow-list):");
L(JSON.stringify(out.counts, null, 1));
L("");
L("ORDERED TRACE (learning + math signals only, first 90 entries):");
const KEEP = /^(learn:|math:)/;
const tr = out.log.filter((e) => KEEP.test(e.n));
for (const e of tr.slice(0, 90)) {
  L(`  t=${String(e.t).padStart(7)}  ${e.n.padEnd(14)} ${String(e.kpId ?? "").padEnd(20)} ${e.v ? JSON.stringify(e.v).slice(0, 150) : ""}`);
}
L(`  ... ${Math.max(0, tr.length - 90)} more`);
L("");

// cycle-chain analysis, computed here from my own log
const groups = [];
for (const e of tr) {
  if (e.n === "learn:present") groups.push([]);
  if (groups.length) groups[groups.length - 1].push(e);
}
const chain = groups.filter((g) => {
  const iS = g.findIndex((e) => e.n === "math:show");
  const iR = g.findIndex((e) => e.n === "learn:respond");
  const iM = g.findIndex((e) => e.n === "learn:mastery");
  return iS > 0 && iR > iS && iM > iR;
});
L(`CHAIN present -> math:show -> learn:respond -> learn:mastery, in order: ${chain.length} of ${groups.length} presentations`);
const responded = tr.filter((e) => e.n === "learn:respond");
L(
  `RESPONSES: ${responded.length}, marked CORRECT by the shipped checker: ${responded.filter((e) => e.v?.correct).length}` +
    (MODE === "screen" ? "   (every one derived from probe(\"mathtex\").panels — the answer key was never read)" : "")
);
if (MODE === "screen") {
  L("");
  L("WHAT THE SCREEN SAID AND WHAT THE READER MADE OF IT:");
  for (const c of out.cycles.filter((x) => !x.stalled).slice(0, 16)) {
    L(
      `  ${String(c.i).padStart(2)} ${String(c.kpId).padEnd(16)} ${String(c.form).padEnd(9)} ${String(c.askKey).padEnd(22)} ` +
        `${String(c.strategy).padEnd(18)} rows ${JSON.stringify(c.onScreen.map((p) => p.id))}`
    );
    L(`       typed ${JSON.stringify(c.typed)}`);
  }
}
L("");

const bB = out.beliefsBefore ?? {};
const bA = out.beliefsAfter ?? {};
const moved = Object.keys(bA).filter((k) => (bB[k] ?? null) !== bA[k]);
L("p(known) BEFORE -> AFTER (only keys that moved):");
for (const k of moved.slice(0, 25)) L(`  ${k.padEnd(28)} ${String(bB[k] ?? "-").padStart(10)} -> ${String(bA[k]).padStart(10)}`);
L(`  (${moved.length} moved of ${Object.keys(bA).length} tracked)`);
L("");
L(`scheduler BEFORE: ${JSON.stringify(out.schedBefore ?? {}).slice(0, 300)}`);
L("");
L(`scheduler AFTER : served ${out.schedAfter?.served}  serveMisses ${out.schedAfter?.serveMisses}  bySource ${JSON.stringify(out.schedAfter?.servedBySource)}  byRelaxation ${JSON.stringify(out.schedAfter?.servedByRelaxation)}`);
L(`session delivery: ${JSON.stringify(out.session?.delivery ?? {})}`);
L(`mastery stats   : ${JSON.stringify(out.mastery?.stats ?? {}).slice(0, 500)}`);
L(`itembank loads  : ${JSON.stringify(out.itembank?.loads ?? {})}  (at boot: ${JSON.stringify(out.itembankBefore?.loads ?? {})})`);
L("");

// resource arrival by timestamp
const known = new Set(out.resBefore.map((r) => r.n));
const late = out.resAfter.filter((r) => !known.has(r.n));
L("JS CHUNKS THAT ARRIVED AFTER THE BASELINE SNAPSHOT (name @ startTime ms):");
for (const r of late.filter((r) => r.n.endsWith(".js"))) L(`  ${String(r.t).padStart(8)} ms   ${r.n}`);
L("");
L(`spawn panels: ${JSON.stringify(out.spawn.map((p) => p.id))}`);
L(`final panels: ${JSON.stringify((out.mathtex?.panels ?? []).map((p) => p.id))}`);
L("");
L("SHOT CONTEXT (what the engine chose vs what stood in the world):");
L(JSON.stringify(out.shotContext, null, 1).slice(0, 2500));
if (out.firstShot) L(`capture: ${out.firstShot}`);

fs.mkdirSync(path.join(ROOT, "review/measure/evidence"), { recursive: true });
fs.writeFileSync(path.join(ROOT, `review/measure/evidence/_critic-P34-${MODE}.json`), JSON.stringify(out, null, 1));
L(`evidence: review/measure/evidence/_critic-P34-${MODE}.json`);
