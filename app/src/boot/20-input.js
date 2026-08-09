import { Input } from "../play/Input.js";

/**
 * P07 — input. Mounted early (order 20) so every system that reads intent in the same fixed step
 * sees state that was refreshed at the top of that step rather than one frame stale.
 *
 * Consumers do not import this module. They either listen to the signals — `input:move`,
 * `input:look`, `input:action`, `input:device` — or read the mounted system by name:
 *
 *   const input = kernel.get("input");
 *   if (input.consume("jump")) launch();          // honours a press buffered during recovery
 *   const { x, y } = input.moveVector();          // +x right, +y forward, magnitude <= 1
 *
 * `kernel.get(name)` is a runtime lookup, not a sibling import, so the no-cross-imports rule in
 * design/architecture.md still holds.
 *
 * The system uses three kernel hooks: `fixed` (drain the event queue, update every action, move
 * and look), `frame` (one extra gamepad sweep per rendered frame) and `dispose`. The gamepad is
 * additionally sampled on its own 250 Hz timer inside the module, because a pad read only on the
 * render loop loses inputs on any machine that ever drops a frame.
 *
 * Reviewers drive a synthetic pad through `window.__vsInput` — see the `_installTestHook` block
 * in play/Input.js for the full method list. `__vsInput.probe()` and `__vs.probe("input")` return
 * the same JSON-safe snapshot.
 */
export default {
  id: "input",
  order: 20,
  async setup(kernel) {
    kernel.mount("input", new Input(kernel));
  },
};
