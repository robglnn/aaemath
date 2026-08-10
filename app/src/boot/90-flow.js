import { publish, warn } from "../core/Introspect.js";
import { signals } from "../core/Signals.js";
import { Save } from "../flow/Save.js";
import { Session } from "../flow/Session.js";

/**
 * P33 — the Pomodoro session layer.
 *
 * Mounts `flow/Save.js` and `flow/Session.js`, adopts the sitting `boot/62-learning.js` already
 * opened, and publishes the `session` probe. It renders nothing and it presents nothing: a
 * session layer that drew a quiz box would be the exact failure `CLAUDE.md` names ("the math is
 * the mechanic"). When P18/P19 land, they drive it:
 *
 * ```js
 * const flow = kernel.get("flow");
 * await flow.session.run(async (req) => presentInTheWorld(req));   // resolves with the outcome
 * ```
 *
 * or step by step with `flow.session.next()` / `flow.session.submit(req, outcome)`. Until then
 * this layer plans the sitting, holds the arc, and answers the probe — which is exactly what it
 * should do with no presenter mounted, and is why nothing here can black out a capture.
 *
 * **Away time is not session time.** A learner who alt-tabs for two minutes has not spent two
 * minutes of their twenty; a learner who alt-tabs for ten *past the fifteen-minute floor* has taken
 * their break, and the sitting ends at the next beat boundary rather than resuming at minute
 * fourteen. Both are handled here because visibility is a document concern, not a session-arc
 * concern.
 *
 * **And the break is a hinge, not a terminus.** One `visibilitychange` carries both halves of the
 * cycle: on the way OUT it reports the gap, and on the way BACK IN it opens the next sitting if the
 * last one ended on a break. Round 1 shipped `restart()` here with zero callers anywhere in
 * `app/src`, which meant a page reload was the only way to get a second sitting — the work half of
 * work -> break -> work. The decision itself lives in `Session.resumable` / `Session.resume()`
 * rather than in this file, so `review/measure/P33.mjs` can drive the same code path offline and
 * the DOM wiring is three lines that cannot hide a bug.
 */
export default {
  id: "flow",
  order: 90,

  async setup(kernel) {
    const learning = kernel.get("learning") ?? null;
    if (!learning) warn("flow: no learning system mounted — the session layer is dormant");

    const save = new Save({ onWarn: warn });
    const load = save.load();
    // `absent` is a first run and is not a fault. Everything else is announced, because a save
    // that quietly reset is a support conversation nobody can answer.
    if (load.fault && load.fault !== "absent") warn(`flow: save fault "${load.fault}"`);
    if (load.interrupted)
      warn(
        `flow: the previous sitting (#${load.interrupted.number ?? "?"}) was never closed and has been ` +
          `recorded as interrupted. The learner model is stored separately and was not affected.`
      );
    // The sitting did not survive; the CALIBRATION did. Announced because a ρ that arrived from a
    // dead sitting is a different provenance from one a clean close wrote, and a reviewer reading
    // `probe().pace` should not have to infer which happened. See `Save._adoptInterruptedPace`.
    if (load.paceSource === "recovered")
      warn(
        `flow: the pace calibration was recovered from the interrupted sitting ` +
          `(rho ${Math.round((load.pace?.ratio ?? 1) * 100) / 100} over ${load.pace?.samples ?? 0} items) rather than ` +
          `re-measured from the design's seconds.`
      );

    const session = new Session({ learning, save, emit: (name, value) => signals.emit(name, value) });
    try {
      // Adopt: the engine's own `beginSession()` already ran at order 62 for this page load.
      session.begin({ adopt: true });
    } catch (err) {
      // Planning reads the whole learner model. If that model is in a state this layer cannot
      // read, the right answer is a named warning and a mounted-but-idle session layer — not a
      // boot module that throws and takes the probe down with it.
      warn(`flow: could not plan a sitting — ${String(err?.message || err)}`);
    }

    /**
     * BREADTH, ANNOUNCED. `Session` emits `learn:session {phase:"starved"}` when the engine's whole
     * legal supply is one knowledge point and that node has already taken `STARVE_REPS` items of
     * this sitting. It is surfaced through `Introspect.warn` so it lands in `__vs.report().warnings`
     * where `tools/review.mjs` and a critic both read it — the round-2 defect was a corpus of
     * forty-six repetitions of one node that nothing anywhere said a word about, and a signal with
     * no listener would have been the same silence with an extra step.
     */
    signals.on("learn:session", (e) => {
      if (e?.phase !== "starved") return;
      const s = e.summary ?? {};
      warn(
        `flow: the sitting has served "${s.kpId}" ${s.reps} times and the engine has no other legal ` +
          `knowledge point to offer (supply ${s.supply}). That is a curriculum-supply limit, not a session-arc one.`
      );
    });

    // ---------------------------------------------------------------- attention

    let hiddenAt = null;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        save.write();
        return;
      }
      if (hiddenAt != null) {
        session.noteAway(Date.now() - hiddenAt);
        hiddenAt = null;
      }
      // The break, ending. A sitting that closed because the learner took one is not the end of the
      // day: the next time this tab is looked at, the next arc opens. `learn:session {phase:"break"}`
      // fired when it closed, so a HUD that wants to offer this rather than take it can hold the
      // resume itself — `flow.restart()` is the same call.
      if (session.resumable) session.resume("returned");
    };
    const onHide = () => {
      // A browser game is closed, not exited. The live record is what makes the next load able to
      // say honestly that the last sitting was interrupted rather than pretending it ended.
      save.checkpoint({ elapsedSeconds: Math.round(session.elapsedSeconds), items: session.itemsServed });
    };
    addEventListener("visibilitychange", onVisibility);
    addEventListener("pagehide", onHide);

    kernel.mount("flow", {
      session,
      save,
      /** End the current sitting and open a fresh arc — what a break, or a menu, asks for. */
      restart(reason = "restarted") {
        if (session.phase !== "closed" && session.phase !== "dormant") session.close(reason);
        return session.resume(reason);
      },
      dispose() {
        removeEventListener("visibilitychange", onVisibility);
        removeEventListener("pagehide", onHide);
        if (session.phase !== "closed" && session.phase !== "dormant") session.close("dispose");
      },
    });

    publish("session", () => session.probe());
  },
};
