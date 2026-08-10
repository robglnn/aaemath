#!/usr/bin/env node
/**
 * CRITIC round 3 — my own driver. Records every traced signal in order across a stretch of play in
 * the SHIPPED BUILD, and measures:
 *   (2) Scheduler.serve() on the path + itemRelaxation recorded at runtime
 *   (3) Mastery p(known) before vs after, and the item-family refusal
 *   (4) a lazily-loaded item group arriving DURING play
 *
 * It swallows the per-step TypeError the shipped build throws out of Kernel._step so that the rest
 * of the loop can still be measured; the throw itself is reported separately.
 */
import fs from "node:fs";
import { openGame, ROOT, arg } from "../../tools/lib/session.mjs";
import { answerFromScreen } from "./lib/reader.mjs";

const CYCLES = Number(arg("cycles", 14));
const LANG = arg("lang", "en");
const STRINGS = (await import(`../../content/items/strings/items-${LANG}.mjs`)).default;

/** advance game time; count how many steps threw out of the kernel */
const sim = (d, seconds) =>
  d.run((s) => {
    const dt = 1 / 30;
    const n = Math.max(1, Math.round(s / dt));
    let threw = 0;
    for (let i = 0; i < n; i += 1) {
      try {
        window.__vs.advance(dt, { render: false });
      } catch {
        threw += 1;
      }
    }
    return { threw, steps: n, simTime: window.__vs.stats().simTime, frames: window.__vs.stats().frames };
  }, seconds);

const res = () => performance.getEntriesByType("resource").map((e) => e.name);
const pKnown = () => {
  const m = window.__vs.probe("mastery");
  const out = {};
  for (const c of m?.cells ?? m?.nodes ?? []) out[c.id ?? c.kpId ?? "?"] = c.p ?? c.pKnown ?? null;
  return { raw: m, map: out };
};

const out = await openGame({ built: true, width: 1280, height: 720, lang: LANG }, async (d) => {
  const resBefore = await d.run(res);
  const masteryBefore = await d.probe("mastery");
  await sim(d, 1.0);

  await d.run(() => window.__vs.kernel.get("teachwiring")?.resetTrace?.());
  await d.page.keyboard.down("KeyE");
  const kickTiming = await sim(d, 0.35);
  await d.page.keyboard.up("KeyE");
  await sim(d, 0.35);

  const cycles = [];
  let throwsTotal = kickTiming.threw;
  for (let i = 0; i < CYCLES; i += 1) {
    const st = await d.probe("teaching");
    if (st?.phase !== "standing") {
      const re = await d.run(() => {
        const f = window.__vs.kernel.get("flow");
        f?.restart?.("critic-next");
        return window.__vs.probe("session")?.phase ?? null;
      });
      const t = await sim(d, 0.5);
      throwsTotal += t.threw;
      const again = await d.probe("teaching");
      if (again?.phase !== "standing") {
        cycles.push({ i, stopped: true, phase: again?.phase ?? null, reopened: re });
        break;
      }
    }
    const open = await d.probe("teaching");
    const panels = (await d.probe("mathtex"))?.panels ?? [];
    const read = answerFromScreen({ panels, table: STRINGS });
    const typed = read.response ?? "0";
    await d.page.keyboard.type(typed, { delay: 0 });
    let t = await sim(d, 1.6);
    throwsTotal += t.threw;
    await d.page.keyboard.press("Enter");
    t = await sim(d, 2.6);
    throwsTotal += t.threw;
    const marked = await d.probe("teaching");
    cycles.push({
      i,
      kpId: open.item?.kpId ?? null,
      itemId: open.item?.itemId ?? null,
      family: open.item?.family ?? null,
      source: open.item?.source ?? null,
      relaxation: open.item?.relaxation ?? null,
      strategy: read.strategy,
      typed,
      correct: marked?.lastRespond?.correct ?? null,
      scored: marked?.lastRespond?.scored ?? null,
    });
  }

  const trace = await d.run(() => window.__vs.kernel.get("teachwiring")?.trace?.());
  const masteryAfter = await d.probe("mastery");
  const session = await d.probe("session");
  const itembank = await d.probe("itembank");
  const learnserve = await d.probe("learnserve");
  const mathtex = await d.probe("mathtex");
  const verbs = await d.probe("verbs");
  const report = await d.report();
  const resAfter = await d.run(res);
  const stats = await d.run(() => window.__vs.kernel.stats());
  await d.shoot("review/shots/p34crit/mid-loop.png");
  return { cycles, trace, masteryBefore, masteryAfter, session, itembank, learnserve, mathtex, verbs, report, resBefore, resAfter, throwsTotal, stats };
});

const L = (s = "") => console.log(s);
L("=".repeat(96));
L("CRITIC P34 r3 — independent driver, shipped build");
L("=".repeat(96));
L(`kernel steps that THREW out of Kernel._step: ${out.throwsTotal}`);
L(`frames RENDERED for the whole run: ${out.stats.frames}   simTime ${out.stats.simTime}`);
L(`console errors: ${out.report.errors.length}`);
for (const e of out.report.errors.slice(0, 3)) L("  ERR " + String(e).split("\n")[0]);
L("");
L("---- FULL ORDERED SIGNAL TRACE ----");
for (const e of out.trace?.entries ?? []) {
  L(`  t=${String(e.t).padStart(7)}  #${String(e.seq).padStart(3)}  ${e.name.padEnd(14)} ${String(e.kpId ?? "").padEnd(18)} ${e.detail ? JSON.stringify(e.detail) : ""}`);
}
L("");
L(`counts: ${JSON.stringify(out.trace?.counts ?? {})}`);
L("");
L("---- cycles ----");
for (const c of out.cycles) L("  " + JSON.stringify(c));
L("");
L(`scheduler:  ${JSON.stringify(out.masteryAfter?.scheduler ?? null)}`);
L(`learnserve: ${JSON.stringify(out.learnserve ?? null)}`);
L(`session.delivery: ${JSON.stringify(out.session?.delivery ?? null)}`);
L(`itembank loads: ${JSON.stringify(out.itembank?.loads ?? null)}  warms ${out.itembank?.warms}`);
L(`itembank warmLog: ${JSON.stringify(out.itembank?.warmLog ?? null)}`);
const newRes = out.resAfter.filter((u) => !out.resBefore.includes(u)).map((u) => u.split("/").pop());
L(`NEW network resources DURING play (${newRes.length}): ${JSON.stringify(newRes)}`);
L("");
L(`mastery BEFORE: ${JSON.stringify(out.masteryBefore).slice(0, 1200)}`);
L("");
L(`mastery AFTER : ${JSON.stringify(out.masteryAfter).slice(0, 1600)}`);
L("");
L(`mathtex panels at end: ${JSON.stringify((out.mathtex?.panels ?? []).map((p) => p.id))}`);
L(`verbs stats: ${JSON.stringify(out.verbs?.stats ?? null)}`);
fs.writeFileSync(`${ROOT}/review/measure/_critic-P34-r3-loop.json`, JSON.stringify(out, null, 1));
L("json: review/measure/_critic-P34-r3-loop.json");
