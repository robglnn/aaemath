// Watch the learning loop run in the shipped app, as an ordered signal trace.
//
// The seam audit can only prove somebody wrote the call. This proves the call fires, in order, on a
// real playthrough — which is the claim that matters: does a complete learning cycle execute?
import { openGame } from "../../tools/lib/session.mjs";

const WATCH = [
  "learn:present",
  "learn:respond",
  "learn:mastery",
  "learn:teach",
  "learn:unlock",
  "learn:session",
  "math:show",
  "math:hide",
  "world:interact",
];

await openGame({ width: 1100, height: 700 }, async (d) => {
  await d.play(1.0);

  await d.run((names) => {
    window.__trace = [];
    const k = window.__vs.kernel;
    for (const n of names) {
      k.signals.on(n, (v) => {
        window.__trace.push({
          n,
          t: Number(k.simTime.toFixed(2)),
          // Keep one identifying field so the trace shows WHAT was presented, not just that
          // something was. A trace of bare names cannot tell a real cycle from a heartbeat.
          d: v && typeof v === "object" ? (v.itemId ?? v.kpId ?? v.id ?? v.phase ?? v.tex ?? "") : String(v ?? ""),
        });
      });
    }
    return true;
  }, WATCH);

  // Play for a while, moving and interacting, so the world has a chance to hand us something.
  for (let i = 0; i < 6; i++) {
    await d.hold("KeyW", 1.2);
    await d.page.keyboard.press("KeyE");
    await d.play(1.0);
  }
  await d.play(4);

  const trace = await d.run(() => window.__trace.slice(0, 80));
  const counts = {};
  for (const e of trace) counts[e.n] = (counts[e.n] ?? 0) + 1;

  console.log(JSON.stringify({ counts, firstEvents: trace.slice(0, 30) }, null, 2));

  const cycled = counts["learn:present"] > 0 && counts["learn:respond"] > 0;
  console.log(
    `\nlearn:present ${counts["learn:present"] ?? 0} · math:show ${counts["math:show"] ?? 0} · ` +
      `learn:respond ${counts["learn:respond"] ?? 0} · learn:mastery ${counts["learn:mastery"] ?? 0}`
  );
  console.log(cycled ? "A learning cycle FIRED." : "No complete cycle observed in this window.");
});
