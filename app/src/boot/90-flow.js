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
 * minutes of their twenty; a learner who alt-tabs for ten has taken their break, and the sitting
 * ends at the next beat boundary rather than resuming at minute fourteen. Both are handled here
 * because visibility is a document concern, not a session-arc concern.
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

    const session = new Session({ learning, save, emit: (name, value) => signals.emit(name, value) });
    // Adopt: the engine's own `beginSession()` already ran at order 62 for this page load.
    session.begin({ adopt: true });

    // ---------------------------------------------------------------- attention

    let hiddenAt = null;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        save.write();
      } else if (hiddenAt != null) {
        session.noteAway(Date.now() - hiddenAt);
        hiddenAt = null;
      }
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
        session.close(reason);
        session.phase = "idle";
        return session.begin();
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
