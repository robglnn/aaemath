import { publish, warn } from "../core/Introspect.js";
import { signals } from "../core/Signals.js";
import { itemBank, ENTRY_GRAMMAR } from "../learn/ItemBank.js";
import { Teaching, TEACH } from "../learn/Teaching.js";
import { validate, getLocale } from "../math/Tex.js";

/**
 * P34 — the presenter, mounted. The assembly point where the engine, the bank and the surface meet.
 *
 * Order 92, after `90-flow.js`, because the presenter drives `flow.session` and the session layer has
 * to exist before it can be driven. `62-learning.js` (engine), `62-itembank.js` (bank) and
 * `63-learnserve.js` (`Scheduler.attachBank`, which puts `serve()` on the path) have all run by now,
 * so `session.next()` returns a request with `req.item`, `req.family` and `req.itemRelaxation`
 * already on it.
 *
 * Five things are wired here and nowhere else, because every one of them crosses a boundary a
 * feature module is not allowed to cross:
 *
 *   1. THE BANK IS INJECTED. `app/src/learn/ItemBank.js` is P17/P31's; `Teaching.js` never imports it.
 *      Same reason and same shape as `boot/63-learnserve.js`.
 *   2. THE SOCKETS ARE RESOLVED AGAINST THE LIVE CAMERA. `TexField._resolveAnchors` resolves view
 *      anchors exactly once, at the quarter-second mark, so a claim standing later in the session
 *      cannot use one. The camera basis is read here instead — the boot module is where `kernel` is
 *      in scope — and the arithmetic is deliberately the same as `_resolveAnchors`': flatten the
 *      camera's forward onto the ground plane, take right as forward x up, and offset from the
 *      camera's own world position.
 *   3. TYPING IS A DOM EVENT. `play/Input.js` maps physical chords to game verbs and is right not to
 *      know about text; a constructed response is characters, not actions. So `input:action`
 *      supplies the one VERB this presenter needs (`interact`, to take the mathematics on) and a
 *      plain `keydown` supplies the characters.
 */
export default {
  id: "teaching",
  order: 92,

  async setup(kernel) {
    const learning = kernel.get("learning") ?? null;
    const flow = kernel.get("flow") ?? null;
    if (!learning) {
      warn("teaching: no learning system is mounted — nothing can be presented");
      publish("teaching", () => ({ phase: "dormant", reason: "no-learning-system" }));
      return;
    }
    if (!flow?.session) warn("teaching: no session layer — presenting straight off the engine, with no sitting arc");

    /**
     * A socket, in metres right / up / ahead of the camera, resolved to a world position.
     *
     * No `three` import: a camera's world matrix is a basis, and the three columns of it are exactly
     * the vectors needed. Columns 0/1/2 are the camera's right, up and BACKWARD axes, so forward is
     * the negation of column 2, and the translation is column 3.
     */
    const place = (socket) => {
      const cam = kernel.camera;
      if (!cam?.matrixWorld) return null;
      cam.updateMatrixWorld();
      const m = cam.matrixWorld.elements;
      let fx = -m[8];
      let fz = -m[10];
      const len = Math.hypot(fx, fz);
      if (len < 1e-6) {
        fx = 0;
        fz = -1;
      } else {
        fx /= len;
        fz /= len;
      }
      // right = forward x worldUp, for forward flattened onto the ground plane.
      const rx = -fz;
      const rz = fx;
      const f = socket.forward ?? 12;
      const r = socket.right ?? 0;
      return [m[12] + fx * f + rx * r, m[13] + (socket.up ?? 0), m[14] + fz * f + rz * r];
    };

    const teaching = new Teaching({
      session: flow?.session ?? null,
      learning,
      bank: itemBank,
      place,
      emit: (name, value) => signals.emit(name, value),
      on: (name, fn) => signals.on(name, fn),
      /**
       * 4. THE STRICT PIPELINE GATES THE PROSE. `math/Tex.js` is a sibling piece, so `Teaching.js`
       *    cannot import it any more than it can import the bank; this is where the two are allowed
       *    to meet. Every localized sentence the presenter stands is typeset here first, in the
       *    LIVE locale — `getLocale()` and not a captured one, because `ui:locale` can change it
       *    mid-sitting — and a sentence KaTeX will not set is refused whole rather than standing as
       *    a hollow mark beside a live question.
       * 5. THE ACCEPTANCE SET AND THE KEYBOARD ARE ONE OBJECT. `ItemBank.ENTRY_GRAMMAR` is what
       *    `accepts()[0]` is guaranteed to satisfy; injecting it here is what makes "the bank's own
       *    first accepted spelling is typeable" a fact about the shipped surface rather than about
       *    two constants that happen to match today.
       */
      validateTex: (tex) => validate(tex, { locale: getLocale(), displayMode: true }).ok,
      entryChars: ENTRY_GRAMMAR,
    }).attach();

    kernel.mount("teaching", teaching);

    // ------------------------------------------------------------------ taking the claim on

    /**
     * The `interact` verb opens the loop.
     *
     * It does not open at boot on purpose: the first `math:show` retires the claims P09 stands at
     * spawn, and four other pieces' review baselines are measured on that frame. See the header of
     * `learn/Teaching.js`.
     */
    const offAction = signals.on("input:action", (e) => {
      if (e?.action !== "interact" || e.phase !== "down") return;
      if (!teaching.open) teaching.begin("interact");
    });

    // ------------------------------------------------------------------ the constructed response

    const onKey = (e) => {
      if (!teaching.open) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName ?? ""))) return;
      if (e.key === "Enter") {
        teaching.commit();
        return;
      }
      if (e.key === "Backspace") {
        teaching.erase();
        return;
      }
      /**
       * THE HINT LADDER, PULLED.
       *
       * `?` and `Tab` are the two keys a keyboard offers that `ENTRY_GRAMMAR` does not admit, so
       * neither can ever eat a character of a response. The rungs themselves are the item's own
       * three localized hints, which `ItemBank.present()` has returned since P17 and nothing has
       * ever drawn. Asking marks the response `hinted`, which is what the engine prices.
       */
      if (e.key === "?" || e.key === "Tab") {
        e.preventDefault();
        teaching.hint();
        return;
      }
      teaching.type(e.key);
    };
    addEventListener("keydown", onKey);

    // ------------------------------------------------------------------ the instrument

    /**
     * THE SIGNAL TRACE. An observer, never a consumer.
     *
     * Deliberately separate from every listener that does work, so that "the chain executed" is read
     * off the bus rather than off the thing being measured. Every name below is emitted by shipped
     * code — `learn/Teaching.js` (present/show/hide), `learn/Scheduler.js` (teach) and
     * `learn/Mastery.js` (respond/mastery/unlock/session) — so a trace that shows the chain is a
     * trace of the game, not of the harness. `review/measure/P34.mjs` prints it verbatim.
     */
    const TRACE_NAMES = [
      "learn:present",
      "math:show",
      "math:hide",
      "learn:teach",
      "learn:respond",
      "learn:mastery",
      "learn:unlock",
      "learn:session",
    ];
    /**
     * The buffer is long enough to hold a whole sitting — a 25-minute Pomodoro is thirty-odd items
     * and about ten signals each — and the PROBE still publishes only the tail of it, because
     * `__vs.report()` serializes every probe and `tools/review.mjs verify` calls it. The full trace
     * is reachable through `teachwiring.trace()`, which only `review/measure/P34.mjs` asks for.
     */
    const TRACE_CAP = 4000;
    const trace = [];
    let traced = 0;
    const counts = Object.fromEntries(TRACE_NAMES.map((n) => [n, 0]));
    const offs = TRACE_NAMES.map((name) =>
      signals.on(name, (e) => {
        traced += 1;
        counts[name] += 1;
        trace.push({
          seq: traced,
          t: Math.round((kernel.simTime ?? 0) * 100) / 100,
          name,
          kpId: e?.kpId ?? null,
          itemId: e?.itemId ?? e?.id ?? null,
          detail:
            name === "learn:respond"
              ? { correct: e?.correct === true, scored: e?.scored === true, credited: e?.credited === true, family: e?.family ?? null, latencyMs: e?.latencyMs ?? null, hinted: e?.hinted === true }
              : name === "learn:mastery"
                ? { p: e?.p ?? null, delta: e?.delta ?? null, status: e?.status ?? null }
                : name === "learn:teach"
                  ? { phase: e?.phase ?? null }
                  : name === "learn:session"
                    ? { phase: e?.phase ?? null }
                    : null,
        });
        if (trace.length > TRACE_CAP) trace.shift();
      })
    );

    publish("teaching", () => teaching.probe());
    publish("teachtrace", () => ({
      names: TRACE_NAMES,
      total: traced,
      counts: { ...counts },
      entries: trace.slice(-300),
    }));

    kernel.mount("teachwiring", {
      /**
       * THERE IS NO `expected()` HERE ANY MORE, AND THAT IS THE POINT.
       *
       * Round 2 published the open item's accepted spelling on this object so a measurement run
       * could answer correctly. Both drivers used it, and a run that reads the answer key measures
       * the harness: it proves the engine can mark a response, and it proves nothing at all about
       * whether a human being could have produced one from what is on the screen. The hook is gone,
       * so the only route to a correct answer is the same one a player has — read the rows standing
       * in the world. `review/measure/P34.mjs` now derives every response from
       * `probe("mathtex").panels` and nothing else.
       */
      /** REVIEW HARNESS ONLY — the whole trace, not the tail the probe publishes. */
      trace: () => ({ names: TRACE_NAMES, total: traced, counts: { ...counts }, entries: trace.slice(), cap: TRACE_CAP }),
      /** REVIEW HARNESS ONLY — the trace, cleared, so one run can measure one stretch of play. */
      resetTrace: () => {
        trace.length = 0;
        traced = 0;
        for (const n of TRACE_NAMES) counts[n] = 0;
      },
      sockets: TEACH.sockets,
      dispose() {
        removeEventListener("keydown", onKey);
        offAction?.();
        for (const off of offs) off?.();
      },
    });
  },
};
