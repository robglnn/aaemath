// P19 round-1 critique — a hostile designer actually plays the verbs.
// Not a report generator: every number below is read off the shipped app after real key presses.
import { openGame } from "../../tools/lib/session.mjs";

const log = (...a) => console.log(...a);

await openGame({ width: 1280, height: 720 }, async (d) => {
  await d.play(1.2);

  // ------------------------------------------------------------------ instrument
  await d.run(() => {
    window.__t = [];
    const k = window.__vs.kernel;
    for (const n of ["learn:present", "learn:respond", "learn:mastery", "math:show", "math:hide"]) {
      k.signals.on(n, (v) => window.__t.push({ n, t: +k.simTime.toFixed(2), v: n === "learn:respond" || n === "learn:mastery" ? v : (v?.kpId ?? v?.id ?? "") }));
    }
    return true;
  });

  const pk = () => d.run(() => {
    const m = window.__vs.kernel.get("learning")?.mastery ?? window.__vs.kernel.get("mastery");
    if (!m) return null;
    try {
      const p = m.probe?.();
      return p ? JSON.stringify(p).slice(0, 400) : null;
    } catch { return null; }
  });

  // ------------------------------------------------------------------ open a claim
  await d.page.keyboard.press("KeyE");
  await d.play(1.5);

  let v = await d.probe("verbs");
  let t = await d.probe("teaching");
  log("=== AFTER FIRST E ===");
  log("verbs.phase:", v?.phase, "verb:", v?.verb);
  log("verbs.item:", JSON.stringify(v?.item));
  log("verbs.state:", JSON.stringify(v?.state));
  log("verbs.rows:", JSON.stringify(v?.rows));
  log("teaching.open:", t?.open, "phase:", t?.phase, "response:", JSON.stringify(t?.response));

  // ------------------------------------------------------------------ THE WALK TEST
  // Hold W — the same key that walks the body and works the verb — and see what
  // lands in the presenter's typed answer slot.
  log("\n=== HOLD W FOR 1.5s (walking forward while a claim stands) ===");
  await d.hold("KeyW", 1.5);
  t = await d.probe("teaching");
  v = await d.probe("verbs");
  log("teaching.response AFTER WALKING:", JSON.stringify(t?.response));
  log("verbs.state:", JSON.stringify(v?.state));
  log("verbs.rows:", JSON.stringify(v?.rows));

  log("\n=== HOLD A, then D, then SPACE (strafe + jump) ===");
  await d.hold("KeyA", 0.6);
  await d.hold("KeyD", 0.6);
  await d.page.keyboard.press("Space");
  await d.play(0.4);
  t = await d.probe("teaching");
  log("teaching.response AFTER STRAFE+JUMP:", JSON.stringify(t?.response));
  log("presenter stood rows:", JSON.stringify((t?.stood ?? []).map((r) => r.tex ?? r.id)));

  await d.shoot("review/shots/P19-crit/01-walked.png");

  // ------------------------------------------------------------------ perform the verb properly
  log("\n=== PERFORM THE VERB: primary(Mouse0) taps, work axis, set down with E ===");
  const before = await pk();
  log("mastery probe BEFORE:", before);

  // slide the grip, take, carry
  for (const k of ["BracketRight", "BracketRight"]) { await d.page.keyboard.press(k); await d.play(0.2); }
  await d.page.mouse.down({ button: "left" }); await d.play(0.3); await d.page.mouse.up({ button: "left" });
  await d.play(0.3);
  await d.hold("KeyW", 1.0);
  v = await d.probe("verbs");
  log("after take+carry, state:", JSON.stringify(v?.state));
  log("after take+carry, rows:", JSON.stringify(v?.rows));

  await d.shoot("review/shots/P19-crit/02-midperform.png");

  // set it down
  await d.page.keyboard.press("KeyE");
  await d.play(2.0);
  v = await d.probe("verbs");
  log("\n=== AFTER SET DOWN ===");
  log("lastResponse:", JSON.stringify(v?.lastResponse));
  log("stats:", JSON.stringify(v?.stats));
  log("rows now:", JSON.stringify(v?.rows));
  const after = await pk();
  log("mastery probe AFTER:", after);

  await d.shoot("review/shots/P19-crit/03-read.png");

  // ------------------------------------------------------------------ trace
  const trace = await d.run(() => window.__t.slice());
  const counts = {};
  for (const e of trace) counts[e.n] = (counts[e.n] ?? 0) + 1;
  log("\n=== TRACE COUNTS ===", JSON.stringify(counts));
  log("respond events:", JSON.stringify(trace.filter((e) => e.n === "learn:respond").map((e) => e.v)));
  log("mastery events:", JSON.stringify(trace.filter((e) => e.n === "learn:mastery").map((e) => e.v)));

  log("\nconsole errors:", d.consoleErrors.length, d.consoleErrors.slice(0, 3));
});
