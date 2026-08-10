import { publish } from "../core/Introspect.js";
import { signals as globalSignals } from "../core/Signals.js";
import { config as globalConfig } from "../core/Config.js";
import {
  ACTIONS,
  ACTION_LIST,
  MOVE_AXIS_ACTIONS,
  DEFAULT_BINDINGS,
  DEFAULT_AXES,
  TUNING,
  KBM,
  PAD,
  PAD_AXES,
  PAD_BUTTONS,
  PAD_BUTTON_NAMES,
  PAD_ANALOG_BUTTONS,
  PAD_STICK_DIRS,
  PAD_STICK_NAMES,
  axisLabel,
  chordDevice,
  chordLabel,
  cloneAxes,
  cloneBindings,
  contextsOverlap,
  detectPadStyle,
  isKnownChord,
  isPadChord,
  isStickChord,
  padPart,
  swappedAxes,
} from "./bindings.js";

const BIND_STORE = "variable-star/bindings/1";
/**
 * Chords one action may hold on one device. A fourth is *refused* rather than silently truncated —
 * see `bind()` — because a settings screen that is told a write succeeded will repaint itself
 * around a binding that does not exist. Surfaced to that screen as `tuning.maxSlots` in the probe.
 */
const MAX_SLOTS = 3;
/**
 * Pending transitions held for one action. One is applied per fixed step, so this is the depth of
 * the "press and release faster than the simulation can look" guarantee: four full press+release
 * pairs may arrive inside a single 16.7 ms step and every one of them still gets its own step of
 * `held`. A fifth pair in the same step is dropped from the tail — reachable only from a script
 * firing synthetic edges inside one JS task, since the hardware path samples at 250 Hz and a human
 * tap is ~60 ms. Chord membership is tracked separately from this queue, so an overflow costs a
 * *duplicate* transition and never leaves the action stuck down. Stated plainly here because no
 * test may claim "no input is ever lost" without it.
 */
const MAX_QUEUE = 8;
const PAD_SLOTS = 17; // W3C Standard Gamepad button count

function nowMs() {
  return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
}

/**
 * Radial deadzone with an inner and an outer band, plus a response curve.
 *
 * The whole point is the last two lines: both components are scaled by the *same* factor, so the
 * direction of the stick survives untouched. Per-axis deadzoning — the common shortcut — kills
 * the smaller component of a shallow diagonal and is exactly why so many browser games snap to
 * the eight compass points. Here a stick at 22.5° comes out at 22.5°, always.
 */
function radial(x, y, band) {
  const r = Math.hypot(x, y);
  if (!(r > band.inner)) return { x: 0, y: 0, mag: 0, raw: r };
  const span = Math.max(1e-6, band.outer - band.inner);
  const t = Math.min(1, (r - band.inner) / span);
  const mag = Math.pow(t, band.exp);
  const s = mag / r;
  return { x: x * s, y: y * s, mag, raw: r };
}

function smoothstep(t) {
  const k = Math.min(1, Math.max(0, t));
  return k * k * (3 - 2 * k);
}

function isEditable(target) {
  if (!target || typeof target !== "object") return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable === true;
}

function freshState() {
  return {
    active: false, // effective held state (this is what gameplay reads)
    rawDown: false, // physical state before hold/toggle interpretation
    value: 0, // 0..1; analog for triggers
    chords: new Set(), // physical chords currently holding this action
    queue: [], // pending transitions, at most one applied per fixed step
    downStep: -1,
    upStep: -1,
    downAt: -1,
    upAt: -1,
    hold: 0,
    bufferAt: -1,
    bufferUsed: true,
    repeats: 0,
    lastRepeat: -1,
  };
}

/**
 * Input — one unified action state for keyboard, mouse and gamepad.
 *
 * Four things make this console-grade rather than merely functional:
 *
 * 1. **Actions, never keys.** Gameplay asks `input.held("sprint")`. `bindings.js` is the only
 *    file that knows a keyboard exists, which is what makes rebinding and pad glyph swapping
 *    possible without touching a line of gameplay code.
 *
 * 2. **One transition per simulation step, plus a press buffer.** A press and release that both
 *    land inside a single rendered frame are spread across two fixed steps, so no consumer can
 *    ever miss the press; and every press stamps a buffer that a system can `consume()` up to
 *    ~0.2 s later. That is the mechanism behind "input during a recovery animation is honoured,
 *    not swallowed" — Locomotion calls `consume("jump")` the instant it becomes able to jump and
 *    the press the player made mid-landing still fires.
 *
 * 3. **The pad is an event stream, not a polled level.** This is the difference between a browser
 *    game and a console game, and it is worth stating plainly because the browser gives you no
 *    help with it: `navigator.getGamepads()` hands back a *level*, so a naive implementation is
 *    only as reliable as the render rate and as honest as the pad's resting voltage. Here:
 *
 *      · the pad is sampled on its own **250 Hz timer**, and that timer alone is what buys the
 *        sub-frame resolution. `fixed` and `frame` call the same sweep, but for real hardware it
 *        is wall-clock gated at 4 ms, so eight simulation steps inside one JS task produce *one*
 *        sample, not eight — `navigator.getGamepads()` does not update mid-task, so there is
 *        nothing there to see. Those two extra call sites exist to cover a timer that a throttled
 *        or starved tab has stopped delivering, not to multiply the sample rate;
 *      · **no pad edge is born while the game does not have focus.** `_focused` gates the sweep,
 *        so alt-tabbing with a thumb on the stick cannot have the still-held button re-observed
 *        as a fresh press on the next step — and `releaseAll` zeroes the analog vectors too,
 *        because move and look read the axes directly and would otherwise never see the release;
 *      · every observed edge is **latched** — the comparison is against the last phase this
 *        module actually emitted, never against the last raw poll — so a button that goes down
 *        and back up before the simulation catches up still delivers a `down` and *then* an `up`,
 *        which the one-transition-per-step rule spreads over two steps. An unconsumed press can
 *        never be cancelled by a later poll;
 *      · the resting position is **measured**, not assumed (see `_updateRest`), and subtracted
 *        before the deadzone, so a worn stick sitting at 0.30 moves the avatar exactly nowhere;
 *      · the prompt device is arbitrated on **changes with a dwell**, never on levels, so a pad
 *        lying on the desk cannot strobe the glyphs while the player types — and the dwell only
 *        ever *delays* a switch, because a device that asks 250 times a second and a device that
 *        asks once per keystroke cannot be allowed to compete on how often they ask (`_wake`).
 *
 * 4. **Sticks handled properly.** Radial inner/outer deadzone, tunable response exponent, and
 *    no axial snapping whatsoever (see `radial`). Look on a pad is a *rate* with an acceleration
 *    ramp; look on a mouse is *displacement*. Conflating those two is why pad look usually feels
 *    either sluggish or uncontrollable. Both the chord table and the analog axis map are
 *    rebindable and persisted, which is what makes southpaw and per-stick invert possible.
 *
 * 5. **Contexts.** One physical button legitimately means different things in play, build and
 *    menu, and the conflict detector knows the difference.
 *
 * Everything crossing a feature boundary leaves through `core/Signals.js`:
 *   `input:move {x, y}` · `input:look {dx, dy}` · `input:action {action, phase, value}` ·
 *   `input:device {kind, style, id}` · `input:rebind {...}` · `input:capture {...}`
 *
 * `input:look` is in **radians**, deliberately device-independent: dx is intended yaw (+ right),
 * dy is intended pitch (+ down, i.e. screen space) after inversion preferences are applied.
 * `input:move` is a unit-clamped vector in player space: +x right, +y forward.
 */
export class Input {
  constructor(kernel) {
    this.kernel = kernel ?? null;
    this.signals = kernel?.signals ?? globalSignals;
    this.config = kernel?.config ?? globalConfig;
    this.canvas = kernel?.canvas ?? document.getElementById("stage") ?? document.body;

    this.stepIndex = 0;
    this.simTime = 0;
    this.context = "play";
    this._menuDepth = 0;

    /**
     * Does this window still have the player's hands? The keyboard answers this for free — a
     * blurred window simply stops receiving `keydown` — but the pad does not: `getGamepads()`
     * keeps reporting the physically-held button of a player who is now typing in Discord. So the
     * focus state is tracked explicitly and gates the whole pad sweep (`_samplePad`).
     *
     * Two independent facts, because they can disagree: a window can be blurred while its tab is
     * still visible (click the URL bar), and a tab can be hidden while its window still holds
     * focus (switch tabs). Either one means "not playing". Both start true rather than being read
     * from `document.hasFocus()`, which reports false in some headless review runs and would
     * silently disable the pad in exactly the harness that has to prove it works.
     */
    this._windowFocused = true;
    this._pageVisible = typeof document === "undefined" || document.visibilityState !== "hidden";
    this._focused = true;

    this.device = KBM;
    this.padStyle = "xbox";
    this.padId = null;
    this.padIndex = -1;
    this.padConnected = false;
    this.everPad = false;
    /** Sim time of the last prompt-device switch; the dwell is measured from here. */
    this._deviceAt = -1e9;
    /** A claim the dwell refused. Held, not dropped — see `_wake` and `_settleDevice`. */
    this._pendingDevice = null;
    /** Sim time each device was last physically *used*, whether or not it owned the prompts. */
    this._activityAt = { [KBM]: -1e9, [PAD]: -1e9 };
    this.deviceSwitches = 0;

    const store = this._readStore();
    this.bindings = this._loadBindings(store);
    this.axes = this._loadAxes(store);
    this._index = new Map();
    this._rebuildIndex();

    this.actions = new Map(ACTION_LIST.map((a) => [a, freshState()]));

    this._events = [];
    this._mouse = { dx: 0, dy: 0 };
    this._mouseTravel = 0;
    this._lastClient = null;
    this._everLocked = false;
    this._simulatedLock = false;
    /** "auto" drives look from an unlocked pointer until a real lock has happened once. */
    this.lookMode = "auto";
    /** Auto pointer-lock is skipped under WebDriver so review captures keep a deterministic path. */
    this.wantPointerLock = !navigator.webdriver;

    // ---- pad edge stream -------------------------------------------------
    /** Last phase *emitted* per button. The latch: a poll never compares against a raw level. */
    this._padLatch = Object.create(null);
    this._padStick = Object.create(null);
    this._padVal = Object.create(null);
    /** Untouched hardware axes, and the same axes after the measured rest offset is removed. */
    this._padAxesRaw = [0, 0, 0, 0];
    this._padAxes = [0, 0, 0, 0];
    this._padZero = null;
    this._padZeroAt = -1;
    this._padZeroCount = 0;
    this._padRestRef = [0, 0, 0, 0];
    this._padStill = 0;
    this._padWakeRef = [0, 0, 0, 0];
    /** Latch for "the sticks are currently displaced from where the pad last held the prompts". */
    this._padAxisWoke = false;
    this._padRefInit = false;
    this._padSeen = false;
    this._padPollAt = -1e9;
    this._padSamples = 0;
    this._padEdges = 0;
    this._virtual = null;
    // Scratch, reused every sample: at 250 Hz a fresh snapshot object per poll is real garbage.
    this._sAxes = [0, 0, 0, 0];
    this._sVals = new Float64Array(PAD_SLOTS);
    this._sPress = new Uint8Array(PAD_SLOTS);

    this.move = { x: 0, y: 0 };
    this.moveMag = 0;
    this.moveSource = "none";
    this.look = { dx: 0, dy: 0 };
    this.lookSource = "none";
    this.lookBoost = 1;
    /** Cumulative look intent since boot. A per-step delta is invisible to anyone probing after
     *  the fact; a running total is a number a reviewer can actually check against a gesture. */
    this.lookTotal = { yaw: 0, pitch: 0 };
    this._rampT = 0;
    // `hw` is the untouched gamepad axis, `mapped` is after the axis binding's inversion,
    // `out` is after the radial deadzone and response curve. A reviewer can check every stage.
    this.sticks = { left: zeroStickView(), right: zeroStickView() };

    this._capture = null;
    this._lastEmittedMove = { x: 0, y: 0 };

    this._bindListeners();
    this._watchMenus();
    this._startPolling();
    this._installTestHook();
    this._publishProbe();
  }

  // ================================================================= read API

  /**
   * Is the action physically held right now?
   *
   * Deliberately *raw*. This layer reports what the player's hands did; it does not reinterpret
   * it. Preferences that change what a press means over time — hold-to-sprint versus
   * toggle-to-sprint, hold-to-crouch, hold-to-aim — belong to the system that owns the verb,
   * because only that system knows when the latch should be broken (landing, stagger, a menu).
   * Locomotion owns the sprint latch off `config.holdToSprint`; if two layers both applied it,
   * the second press would cancel the first and sprint would stick on forever.
   */
  held(action) {
    return this.actions.get(action)?.active === true;
  }

  /** True only during the simulation step in which the press landed. */
  pressed(action) {
    return this.actions.get(action)?.downStep === this.stepIndex;
  }

  released(action) {
    return this.actions.get(action)?.upStep === this.stepIndex;
  }

  /** 0..1. Analog for triggers, 0/1 for everything else. */
  value(action) {
    const st = this.actions.get(action);
    return st ? st.value : 0;
  }

  /** Seconds the action has been held, for charge-style verbs. */
  holdTime(action) {
    const st = this.actions.get(action);
    return st && st.active ? Math.max(0, this.simTime - st.downAt) : 0;
  }

  /**
   * Is there an unconsumed press within the buffer window? A system in the recovery phase of an
   * animation polls this to decide what it will do the moment it is free again.
   */
  buffered(action, window = null) {
    const st = this.actions.get(action);
    if (!st || st.bufferUsed || st.bufferAt < 0) return false;
    const w = window ?? ACTIONS[action]?.buffer ?? TUNING.bufferDefault;
    return w > 0 && this.simTime - st.bufferAt <= w;
  }

  /** Take the buffered press. Returns true exactly once per press. */
  consume(action, window = null) {
    if (!this.buffered(action, window)) return false;
    this.actions.get(action).bufferUsed = true;
    return true;
  }

  /** `pressed || buffered`, consumed atomically — the call most gameplay code actually wants. */
  consumePress(action, window = null) {
    return this.consume(action, window);
  }

  clearBuffer(action) {
    const st = this.actions.get(action);
    if (st) st.bufferUsed = true;
  }

  clearAllBuffers() {
    for (const st of this.actions.values()) st.bufferUsed = true;
  }

  /** Unit-clamped move intent: +x right, +y forward. */
  moveVector() {
    return { x: this.move.x, y: this.move.y };
  }

  /** Look intent for the step just simulated, in radians. */
  lookDelta() {
    return { dx: this.look.dx, dy: this.look.dy };
  }

  // ================================================================= context

  /**
   * Switch the live action set. Anything held that the new context does not own is force-released
   * first, so opening a menu mid-sprint can never leave a key stuck down behind it.
   */
  setContext(ctx) {
    if (ctx === this.context) return this.context;
    this.context = ctx;
    for (const name of ACTION_LIST) {
      if (ACTIONS[name].ctx.includes(ctx)) continue;
      const st = this.actions.get(name);
      if (st.active || st.rawDown || st.queue.length) this._forceRelease(name, st);
    }
    this._rearmSticks(ctx);
    this.signals.emit("input:context", { context: ctx });
    return this.context;
  }

  /**
   * A pad chord only exists as an edge, and the new context never saw the edge that is still
   * physically true. Open a menu while the stick is already pushed forward and menu navigation
   * would be stone dead until the player centred the stick and pushed it again — which nobody
   * does, because on every console they have ever used the list just starts scrolling.
   *
   * So stick directions are re-armed on a context switch. Buttons deliberately are **not**: a
   * thumb still resting on A after it opened the pause menu must not immediately confirm the
   * highlighted item. The stick is the navigation device; the buttons are the commitments.
   */
  _rearmSticks(ctx) {
    if (this._capture) return;
    for (const name of PAD_STICK_NAMES) {
      if (this._padStick[name] !== true) continue;
      const chord = `Pad:${name}`;
      if (!this._boundIn(chord, ctx)) continue;
      this._pushChord(chord, "down", 1);
    }
  }

  /**
   * A menu opening anywhere in the game takes the input context with it, and closing gives back
   * whatever context was in force before — so leaving the pause screen mid-build returns you to
   * build mode, not to play mode with a structure ghost stuck on screen.
   */
  _watchMenus() {
    this._offMenu = this.signals.on("ui:menu", (e) => {
      if (!e || typeof e.open !== "boolean") return;
      const before = this._menuDepth;
      this._menuDepth = Math.max(0, before + (e.open ? 1 : -1));
      if (before === 0 && this._menuDepth > 0) this._priorContext = this.context;
      this.setContext(this._menuDepth > 0 ? "menu" : this._priorContext ?? "play");
    });
  }

  // ================================================================= simulation

  fixed(step, simTime) {
    this.stepIndex++;
    this.simTime = simTime;
    this._samplePad();
    this._updateRest(step);
    this._drain();
    this._updateActions(step, simTime);
    // Before move/look emit, so every signal produced by this step names the device that is
    // actually driving it.
    this._settleDevice();
    this._updateMove();
    this._updateLook(step);
  }

  /**
   * A third call site for the sweep, and worth being precise about what it does and does not buy.
   *
   * It does **not** multiply the sample rate. `_samplePad` is wall-clock gated at 4 ms for real
   * hardware, so this call and the eight `fixed` calls inside one slow frame collapse to at most
   * one actual read of `navigator.getGamepads()` — which is correct, because the browser does not
   * refresh the gamepad snapshot in the middle of a JS task anyway.
   *
   * What it buys is coverage when the 250 Hz timer is not running: a background or throttled tab
   * clamps `setInterval`, and some browsers coalesce timers hard under load. Two independent
   * paths into the same rate-gated sweep means the pad keeps being read whenever *anything* in
   * the app is still ticking.
   */
  frame() {
    this._samplePad();
  }

  _drain() {
    if (!this._events.length) return;
    const events = this._events;
    this._events = [];
    for (const ev of events) {
      const acts = this._index.get(ev.chord);
      if (!acts) continue;
      for (const name of acts) {
        const st = this.actions.get(name);
        if (!st) continue;
        if (ev.phase === "down") {
          // Down is context-gated; up never is, or a context switch would strand a held key.
          if (!ACTIONS[name].ctx.includes(this.context)) continue;
          const wasHeld = st.chords.size > 0;
          st.chords.add(ev.chord);
          if (wasHeld) continue;
        } else {
          if (!st.chords.delete(ev.chord)) continue;
          if (st.chords.size > 0) continue; // a second bound chord still holds it
        }
        if (st.queue.length < MAX_QUEUE) st.queue.push({ phase: ev.phase, value: ev.value });
      }
    }
  }

  _updateActions(step, simTime) {
    // A *held* key is live keyboard use, not just the instant it went down. The pad re-asserts
    // itself from every sample, so without the mirror image of that the player who was already
    // holding W when the pad last spoke could never take the prompts back — they only ever get
    // one chance, at the keydown edge, and if that lands inside the dwell it is gone.
    let kbmHeld = false;

    for (const name of ACTION_LIST) {
      const st = this.actions.get(name);
      const def = ACTIONS[name];

      if (!kbmHeld && st.chords.size) {
        for (const chord of st.chords) {
          if (isPadChord(chord)) continue;
          kbmHeld = true;
          break;
        }
      }

      // At most one transition per step. A press+release inside one rendered frame therefore
      // still produces a full step of "held", which is what makes taps impossible to miss.
      const tr = st.queue.length ? st.queue.shift() : null;
      if (tr) {
        const raw = tr.phase === "down";
        if (raw !== st.rawDown) {
          st.rawDown = raw;
          this._setActive(name, st, raw, simTime);
        }
      }

      if (st.active) {
        st.hold = Math.max(0, simTime - st.downAt);
        st.value = this._analogValue(name, st);
        if (def.repeat) {
          const due = st.repeats === 0 ? TUNING.navRepeat.delay : TUNING.navRepeat.rate;
          if (simTime - st.lastRepeat >= due) {
            st.lastRepeat = simTime;
            st.repeats++;
            st.downStep = this.stepIndex;
            if (def.buffer > 0) {
              st.bufferAt = simTime;
              st.bufferUsed = false;
            }
            this.signals.emit("input:action", {
              action: name,
              phase: "down",
              value: st.value,
              repeat: true,
              device: this.device,
            });
          }
        }
      } else {
        st.hold = 0;
        st.value = 0;
      }
    }

    // A sustained claim: weaker than a fresh edge (see `_wake`), but it repeats every step, so
    // the keyboard can never be shut out by having asked at the wrong moment.
    if (kbmHeld) this._wake(KBM, { edge: false });
  }

  _analogValue(name, st) {
    if (!ACTIONS[name].analog) return 1;
    let best = 0;
    for (const chord of st.chords) {
      if (isPadChord(chord)) {
        const part = padPart(chord);
        best = Math.max(best, this._padVal[part] ?? 1);
      } else best = Math.max(best, 1);
    }
    return best > 0 ? best : 1;
  }

  _setActive(name, st, next, simTime) {
    st.active = next;
    if (next) {
      st.downStep = this.stepIndex;
      st.downAt = simTime;
      st.hold = 0;
      st.repeats = 0;
      st.lastRepeat = simTime;
      st.value = this._analogValue(name, st);
      if (ACTIONS[name].buffer > 0) {
        st.bufferAt = simTime;
        st.bufferUsed = false;
      }
    } else {
      st.upStep = this.stepIndex;
      st.upAt = simTime;
      st.hold = 0;
      st.value = 0;
    }
    this.signals.emit("input:action", {
      action: name,
      phase: next ? "down" : "up",
      value: st.value,
      device: this.device,
    });
  }

  _forceRelease(name, st) {
    st.chords.clear();
    st.queue.length = 0;
    st.rawDown = false;
    st.bufferUsed = true;
    if (st.active) this._setActive(name, st, false, this.simTime);
  }

  /**
   * Alt-tab, focus loss or a context change must never leave the avatar sprinting into a wall.
   *
   * The action state machine is only half of that, and on a pad it is the *smaller* half. Move and
   * look do not go through `held()` at all — `_updateMove` and `_updateLook` call `_readStick`,
   * which reads `_padAxes` straight out of the last sample — so clearing every action latch still
   * leaves a player who tabbed away mid-stride walking at `mag = 1` and yawing at full stick rate,
   * for as long as they are gone. Both halves have to be zeroed, and `_focused` has to stop the
   * next sweep from putting the axes straight back (see `_samplePad`).
   *
   * The zero move is *emitted*, not just stored. A listener that latched on `input:move` and has
   * been told nothing since is a listener that is still moving; suppressing the one signal that
   * says "stop" because the value happens to be zero is exactly the wrong economy.
   */
  releaseAll() {
    for (const [name, st] of this.actions) this._forceRelease(name, st);
    this._events.length = 0;
    this._mouse.dx = 0;
    this._mouse.dy = 0;
    this._mouseTravel = 0;
    this._lastClient = null;

    // The latches go too: whatever is still physically held will be re-observed — and therefore
    // re-emitted as exactly one fresh edge — by the first sample after focus returns.
    this._padLatch = Object.create(null);
    this._padStick = Object.create(null);
    this._padVal = Object.create(null);
    // The analog picture. `_padAxes` is what `_readStick` reads, `_padAxesRaw` is what the next
    // `_applyZero` would rebuild it from, so both have to go or the vector comes back.
    for (let i = 0; i < 4; i++) {
      this._padAxesRaw[i] = 0;
      this._padAxes[i] = 0;
    }
    this._padAxisWoke = false;

    // The derived vectors, so a probe taken on the very step of the blur is already honest rather
    // than honest one step later.
    const wasMoving = this._lastEmittedMove.x !== 0 || this._lastEmittedMove.y !== 0;
    this.move.x = 0;
    this.move.y = 0;
    this.moveMag = 0;
    this.moveSource = "none";
    this.look.dx = 0;
    this.look.dy = 0;
    this.lookSource = "none";
    this._lastEmittedMove.x = 0;
    this._lastEmittedMove.y = 0;
    this._rampT = 0;
    this.lookBoost = 1;
    this.sticks.left = zeroStickView();
    this.sticks.right = zeroStickView();
    if (wasMoving) this.signals.emit("input:move", { x: 0, y: 0, mag: 0, device: "none" });

    // Nothing is held any more, so a claim parked behind the dwell describes a hand that is no
    // longer on the hardware. Whatever the player picks up next will ask again.
    this._pendingDevice = null;
  }

  /**
   * Focus lost — a real `blur`, or a tab that went to the background. Everything stops, and
   * `_focused` keeps it stopped: without that gate the very next `_samplePad` (which `fixed` calls
   * at the top of every step) re-observes the still-held button against a cleared latch, calls it
   * a fresh `down`, and hands back every action the release just took away.
   */
  _loseFocus(reason) {
    const was = this._focused;
    this._focused = this._windowFocused && this._pageVisible;
    if (this._focused || !was) return;
    this.releaseAll();
    this.signals.emit("input:focus", { focused: false, reason });
  }

  /**
   * A real user gesture arrived, so the document has focus whatever the event stream claimed.
   * Belt and braces for browsers that skip the `focus` event on a restore; a no-op in the normal
   * case, which is why it is safe to call from a hot path.
   */
  _proveFocus(reason) {
    if (this._focused) return;
    this._windowFocused = true;
    this._pageVisible = typeof document === "undefined" || document.visibilityState !== "hidden";
    this._gainFocus(reason);
  }

  /**
   * Focus regained. The pad is re-baselined rather than resumed.
   *
   * `_padRefInit = false` makes the first sample after the return re-freeze `_padWakeRef` and
   * `_padRestRef` at wherever the sticks actually are, so a stick that is merely *drifting* — a
   * worn pad on the desk at 0.30, above both `padWakeAxisDelta` and the calibration rail — is not
   * read as a fresh "the pad woke up" claim and does not take the prompt glyphs off the keyboard
   * the player just alt-tabbed with. The latches are already clear from `releaseAll`, so a button
   * or a stick somebody is genuinely still holding produces exactly one `down` edge, which is
   * right: it *is* down, and the game has to know.
   */
  _gainFocus(reason) {
    const was = this._focused;
    this._focused = this._windowFocused && this._pageVisible;
    if (!this._focused || was) return;
    this._padLatch = Object.create(null);
    this._padStick = Object.create(null);
    this._padRefInit = false;
    this._padAxisWoke = false;
    this._padStill = 0;
    this._padPollAt = -1e9; // the first sweep after the return should not wait out the rate gate
    this.signals.emit("input:focus", { focused: true, reason });
  }

  // ----------------------------------------------------------------- move

  /**
   * The stick after calibration and the axis binding, ready for `radial`. `hw` is what the
   * hardware said, `zero` is the measured rest offset that was removed, `mapped` is what the
   * deadzone actually sees — every stage is kept so a reviewer can check the arithmetic.
   */
  _readStick(vec) {
    const mapX = this.axes[vec].x;
    const mapY = this.axes[vec].y;
    const hwX = this._padAxesRaw[mapX.axis] ?? 0;
    const hwY = this._padAxesRaw[mapY.axis] ?? 0;
    const zX = this._padZero ? this._padZero[mapX.axis] : 0;
    const zY = this._padZero ? this._padZero[mapY.axis] : 0;
    const x = (this._padAxes[mapX.axis] ?? 0) * (mapX.invert ? -1 : 1);
    const y = (this._padAxes[mapY.axis] ?? 0) * (mapY.invert ? -1 : 1);
    const out = radial(x, y, this._band(vec));
    return {
      out,
      view: {
        hw: { x: round4(hwX), y: round4(hwY) },
        zero: { x: round4(zX), y: round4(zY) },
        mapped: { x: round4(x), y: round4(y) },
        out: { x: round4(out.x), y: round4(out.y) },
        mag: round4(out.mag),
      },
    };
  }

  _updateMove() {
    // Digital source: normalized so a diagonal is a true diagonal, not 1.41× the speed.
    // Stick-direction chords are excluded — they exist for prompts and menu navigation, and
    // summing them here would throw away the analog curve the moment the stick passed 0.55.
    let kx = 0;
    let ky = 0;
    for (const name of MOVE_AXIS_ACTIONS) {
      const st = this.actions.get(name);
      if (!st.active) continue;
      let digital = false;
      for (const chord of st.chords) {
        if (!isStickChord(chord)) {
          digital = true;
          break;
        }
      }
      if (!digital) continue;
      const ax = ACTIONS[name].axis;
      if (ax.k === "x") kx += ax.s;
      else ky += ax.s;
    }
    const kMag = Math.hypot(kx, ky);
    if (kMag > 1) {
      kx /= kMag;
      ky /= kMag;
    }

    // Analog source: radial deadzone, direction untouched.
    const read = this._readStick("move");
    const stick = read.out;
    this.sticks.left = read.view;

    // Digital movement is already context-gated by the action state machine, but the stick reads
    // the hardware directly — so it needs the same gate, or a menu would still be steering the
    // avatar behind itself.
    const moveLive = ACTIONS.moveForward.ctx.includes(this.context);
    const digital = moveLive ? Math.min(1, kMag) : 0;
    if (!moveLive) stick.mag = 0;

    let x = 0;
    let y = 0;
    let source = "none";
    if (stick.mag > digital) {
      x = stick.x;
      y = stick.y;
      source = PAD;
    } else if (digital > 0) {
      x = kx;
      y = ky;
      source = KBM;
    }

    this.move.x = x;
    this.move.y = y;
    this.moveMag = Math.hypot(x, y);
    this.moveSource = source;

    const prev = this._lastEmittedMove;
    if (Math.abs(prev.x - x) > 1e-3 || Math.abs(prev.y - y) > 1e-3) {
      prev.x = x;
      prev.y = y;
      this.signals.emit("input:move", {
        x: round4(x),
        y: round4(y),
        mag: round4(this.moveMag),
        device: source,
      });
    }
  }

  // ----------------------------------------------------------------- look

  _updateLook(step) {
    const menu = this.context === "menu";
    const sens = Math.max(0.05, Number(this._cfg("lookSensitivity", 1)) || 1);
    const invY = this._cfg("invertY", false) ? -1 : 1;
    const invX = this._cfg("invertX", false) ? -1 : 1;

    // Mouse: displacement. Never scaled by dt — a mouse already moved a real distance.
    const mScale =
      TUNING.mouse.radiansPerPixel * sens * Math.max(0.05, Number(this._cfg("lookSensitivityMouse", 1)) || 1);
    let dx = menu ? 0 : this._mouse.dx * mScale * invX;
    let dy = menu ? 0 : this._mouse.dy * mScale * invY;
    const mouseMoved = this._mouse.dx !== 0 || this._mouse.dy !== 0;
    this._mouse.dx = 0;
    this._mouse.dy = 0;

    // Pad: a rate, with an acceleration ramp so precision and a fast spin can coexist.
    const read = this._readStick("look");
    const stick = read.out;
    this.sticks.right = read.view;

    const ramp = TUNING.lookRamp;
    if (!menu && stick.mag >= ramp.threshold) this._rampT = Math.min(ramp.seconds, this._rampT + step);
    else this._rampT = Math.max(0, this._rampT - step * ramp.decay);
    const boost = 1 + (ramp.boost - 1) * smoothstep(this._rampT / ramp.seconds);
    this.lookBoost = boost;

    if (!menu && stick.mag > 0) {
      const padSens = sens * Math.max(0.05, Number(this._cfg("lookSensitivityPad", 1)) || 1);
      const rate = TUNING.lookRate * padSens * boost * step;
      dx += stick.x * rate * invX;
      dy += stick.y * rate * TUNING.lookPitchScale * invY;
    }

    this.look.dx = dx;
    this.look.dy = dy;
    this.lookTotal.yaw += dx;
    this.lookTotal.pitch += dy;
    this.lookSource = stick.mag > 0 ? PAD : mouseMoved ? KBM : "none";

    if (dx !== 0 || dy !== 0) {
      this.signals.emit("input:look", {
        dx,
        dy,
        device: this.lookSource === "none" ? this.device : this.lookSource,
        boost: round4(boost),
      });
    }
  }

  /**
   * The live band. `TUNING` carries the reasoning and the fallback; `core/Config.js` carries the
   * player's setting and therefore wins — which means the two must agree at the factory position
   * or the module constant is dead code. Both are clamped here, so a corrupt preference file
   * cannot produce a deadzone that swallows the whole stick.
   */
  _band(which) {
    const base = TUNING[which];
    const p = which === "move" ? "stickMove" : "stickLook";
    return {
      inner: clamp(Number(this._cfg(`${p}Inner`, base.inner)), 0, 0.6),
      outer: clamp(Number(this._cfg(`${p}Outer`, base.outer)), 0.4, 1),
      exp: clamp(Number(this._cfg(`${p}Exp`, base.exp)), 0.5, 4),
    };
  }

  // ================================================================= gamepad
  //
  // Everything below exists to turn a *level* into an *event stream*. The Gamepad API gives no
  // button events at all: you get a snapshot of what is true right now, and if you look at it
  // once per rendered frame you will miss inputs on any machine that ever drops a frame, which
  // is every machine. Three mechanisms together close that:
  //
  //   _startPolling  a 250 Hz timer that runs independently of the render loop
  //   _samplePad     the sweep, rate-gated, also called from `fixed` and `frame`
  //   _ingest        threshold + latch: the only place a pad edge is ever born
  //
  // Edges land in the same `_events` queue the keyboard uses, so from `_drain` onward a pad
  // press and a key press are literally the same code path with the same guarantees.

  /** Sample on a real timer, not on the render loop — the whole point of the exercise. */
  _startPolling() {
    if (typeof setInterval !== "function") return;
    this._pollTimer = setInterval(() => {
      try {
        this._samplePad();
      } catch {
        /* a pad that throws mid-sweep must never take the game's loop with it */
      }
    }, Math.max(1, Math.round(TUNING.padPollMs)));
  }

  _readPad() {
    if (this._virtual) return this._virtual;
    if (typeof navigator === "undefined" || !navigator.getGamepads) return null;
    let list;
    try {
      list = navigator.getGamepads();
    } catch {
      return null;
    }
    let first = null;
    for (const g of list || []) {
      if (!g || g.connected === false) continue;
      this._padSeen = true;
      if (g.index === this.padIndex) return g;
      if (!first) first = g;
    }
    return first;
  }

  /**
   * One sweep. Cheap enough to call from three places: `navigator.getGamepads()` allocates a
   * fresh array, so hardware sweeps are gated to `padPollMs` (4 ms) once a pad exists and to
   * `padIdlePollMs` (200 ms) before one ever has — the keyboard-only majority pays nothing.
   */
  _samplePad(force = false) {
    // Before the rate gate, before `force`, before anything. This is the line that makes
    // `releaseAll` actually hold on a pad: `fixed` calls this at the top of every step, and a
    // single unguarded sweep would re-observe the still-held button against the cleared latch and
    // re-latch every action the blur just released. `force` deliberately does not override it —
    // an explicit poll from the test hook while the window is blurred must see the same silence a
    // player does, or the guarantee is only true when nobody is looking.
    if (!this._focused) return;

    if (!this._virtual) {
      const now = nowMs();
      const gate = this._padSeen ? TUNING.padPollMs : TUNING.padIdlePollMs;
      if (!force && now - this._padPollAt < gate) return;
      this._padPollAt = now;
    }

    const pad = this._readPad();
    const wasConnected = this.padConnected;
    this.padConnected = !!pad;
    if (!pad) {
      if (wasConnected) this._padGone();
      return;
    }

    if (typeof pad.index === "number") this.padIndex = pad.index;
    if (pad.id !== this.padId) {
      this.padId = pad.id ?? null;
      this.padStyle = detectPadStyle(this.padId ?? "");
      // A different pad has a different rest position and a different neutral reference.
      this._padZero = null;
      this._padStill = 0;
      this._padRefInit = false;
      if (this.device === PAD) this._emitDevice();
    }

    // Sub-poll samples first. A synthetic pad journals every state it passed through, which is
    // what makes a scripted `press("A"); release("A")` exactly as reliable as a scripted
    // keydown/keyup pair — the same guarantee, tested through the same `_ingest`.
    const journal = pad.__samples;
    if (journal && journal.length) {
      const pending = journal.splice(0, journal.length);
      for (const s of pending) this._ingest(s.axes, s.vals, s.press);
    }

    const axes = pad.axes || [];
    for (let i = 0; i < 4; i++) this._sAxes[i] = Number(axes[i]) || 0;
    const buttons = pad.buttons || [];
    for (let i = 0; i < PAD_SLOTS; i++) {
      const b = buttons[i];
      const v = typeof b === "number" ? b : Number(b?.value) || 0;
      this._sVals[i] = v;
      this._sPress[i] = (b && typeof b === "object" ? b.pressed === true : v >= 0.5) ? 1 : 0;
    }
    this._ingest(this._sAxes, this._sVals, this._sPress);
    this._padSamples++;
  }

  /**
   * Threshold one sample into edges.
   *
   * The load-bearing line is `const prev = this._padLatch[name] === true` — the comparison is
   * against the last phase this module **emitted**, not against the last raw poll. That is the
   * latch. If a button goes down and comes back up faster than the simulation can look, the
   * down is emitted by whichever sample saw it, the latch says "as far as the game knows this is
   * down", and the very next sample therefore emits the matching up. The pair sits in the event
   * queue and `_updateActions` applies one transition per fixed step, so the press is guaranteed
   * a full step of `held` and a full buffer stamp. No later poll can quietly erase it.
   */
  _ingest(axes, vals, press) {
    if (!this._padRefInit) {
      for (let i = 0; i < 4; i++) {
        this._padWakeRef[i] = axes[i] || 0;
        this._padRestRef[i] = axes[i] || 0;
      }
      this._padAxisWoke = false;
      this._padRefInit = true;
    }

    let wakeMoved = 0;
    let restMoved = 0;
    for (let i = 0; i < 4; i++) {
      const raw = axes[i] || 0;
      const d = Math.abs(raw - this._padWakeRef[i]);
      if (d > wakeMoved) wakeMoved = d;
      const r = Math.abs(raw - this._padRestRef[i]);
      if (r > restMoved) restMoved = r;
      this._padAxesRaw[i] = raw;
      this._padAxes[i] = this._applyZero(raw, i);
    }

    let edge = false;
    let edgeDown = false;
    for (const name of PAD_BUTTON_NAMES) {
      const idx = PAD_BUTTONS[name];
      const v = vals[idx] || 0;
      this._padVal[name] = v;
      const prev = this._padLatch[name] === true;
      // Triggers are continuous, so they need hysteresis or a resting finger chatters.
      const down = PAD_ANALOG_BUTTONS.has(name)
        ? prev
          ? v > TUNING.trigger.release
          : v >= TUNING.trigger.press
        : press[idx] === 1 || press[idx] === true || v >= 0.5;
      if (down !== prev) {
        this._padLatch[name] = down;
        this._pushChord(`Pad:${name}`, down ? "down" : "up", v);
        this._padEdges++;
        edge = true;
        if (down) edgeDown = true;
      }
    }

    // Stick-as-button uses the *calibrated* axes, so drift can never half-open a menu row.
    for (const name of PAD_STICK_NAMES) {
      const dir = PAD_STICK_DIRS[name];
      const r = (this._padAxes[dir.axis] || 0) * dir.sign;
      const prev = this._padStick[name] === true;
      const down = prev ? r > TUNING.stickButton.release : r >= TUNING.stickButton.press;
      if (down !== prev) {
        this._padStick[name] = down;
        this._pushChord(`Pad:${name}`, down ? "down" : "up", Math.max(0, r));
        this._padEdges++;
        edge = true;
        if (down) edgeDown = true;
      }
    }

    // Anything that moved restarts the stillness window the rest capture is waiting on.
    if (edge || restMoved > TUNING.padRest.epsilon) {
      for (let i = 0; i < 4; i++) this._padRestRef[i] = axes[i] || 0;
      this._padStill = 0;
    }

    // Is somebody's hands on this pad *right now*? Not the same question as "should the pad take
    // the prompts": a player steering with the stick and nothing else produces no edges for
    // seconds at a time, and if that counted as an idle pad a stray mouse nudge would flip the
    // glyphs mid-turn. Buttons held and sticks off centre both count, measured on the calibrated
    // axes so a worn stick that has been zeroed reads as the untouched pad it is.
    let engaged = edge;
    if (!engaged) {
      for (const name of PAD_BUTTON_NAMES) {
        if (this._padLatch[name] === true) {
          engaged = true;
          break;
        }
      }
    }
    if (!engaged) {
      for (let i = 0; i < 4; i++) {
        if (Math.abs(this._padAxes[i]) > TUNING.padWakeAxisDelta) {
          engaged = true;
          break;
        }
      }
    }
    if (engaged) this._activityAt[PAD] = this.simTime;

    // Device arbitration on *change*, never on level. `_padWakeRef` is frozen at the moment the
    // pad last lost the prompts, so a stick resting at 0.30 stays 0.00 away from its own
    // reference for as long as nobody touches it, however long the player types.
    //
    // The stick claim is an edge exactly once — the sample on which the deflection crosses the
    // threshold — and a sustain from then on, which is the pad's mirror of keydown versus
    // key-held. Before that distinction existed this line fired at 250 Hz and the pad simply
    // out-asked every other device.
    const axisWake = wakeMoved > TUNING.padWakeAxisDelta;
    const axisEdge = axisWake && !this._padAxisWoke;
    this._padAxisWoke = axisWake;
    if (edgeDown) this._wake(PAD);
    else if (axisWake) this._wake(PAD, { edge: axisEdge });
    if (this.device === PAD) for (let i = 0; i < 4; i++) this._padWakeRef[i] = axes[i] || 0;
  }

  /**
   * Remove the measured rest offset and give back the travel it cost.
   *
   * Subtracting alone is not enough. A stick whose centre reads −0.30 still hits −1 and +1 at its
   * mechanical stops, so after subtraction one direction only reaches 0.70 and the player has
   * quietly lost 30% of their top speed in that direction — which on a worn pad is worse than the
   * drift was. Each side of centre is therefore rescaled by the travel actually available to it:
   * raw = zero maps to 0, raw = ±1 maps to ±1, and the curve stays continuous and monotonic
   * through the middle. On an uncalibrated or perfectly centred pad this is the identity, which is
   * why the direction-preservation of `radial` is untouched in the common case.
   */
  _applyZero(raw, i) {
    const z = this._padZero ? this._padZero[i] : 0;
    if (!z) return clamp(raw, -1, 1);
    const v = raw - z;
    return clamp(v >= 0 ? v / Math.max(0.05, 1 - z) : v / Math.max(0.05, 1 + z), -1, 1);
  }

  /**
   * Rest capture, on the simulation clock so it is deterministic and reviewable.
   *
   * A pad that has held every axis inside ±0.02 with no button edge for 1.5 s is a pad nobody is
   * touching, and where its sticks happen to sit electrically *is* zero for that controller. The
   * `maxOffset` rail means a genuinely deflected stick is never mistaken for rest.
   */
  _updateRest(step) {
    // A blurred window is not measuring anything: the axes it would calibrate against are the
    // zeroes `releaseAll` wrote, not the pad.
    if (!this._focused) return;
    if (!this.padConnected || !this._padRefInit) {
      this._padStill = 0;
      return;
    }
    this._padStill += step;
    const need = this._padZero ? TUNING.padRest.settleSeconds : TUNING.padRest.firstSeconds;
    if (this._padStill < need) return;
    this._padStill = 0;

    const ref = this._padRestRef;
    for (let i = 0; i < 4; i++) {
      if (Math.abs(ref[i]) > TUNING.padRest.maxOffset) return; // held, not resting
    }
    let changed = !this._padZero;
    if (!changed) {
      for (let i = 0; i < 4; i++) {
        if (Math.abs(this._padZero[i] - ref[i]) > 1e-4) changed = true;
      }
    }
    if (!changed) return;

    this._padZero = [ref[0], ref[1], ref[2], ref[3]];
    this._padZeroAt = this.simTime;
    this._padZeroCount++;
    for (let i = 0; i < 4; i++) this._padAxes[i] = this._applyZero(this._padAxesRaw[i], i);
    this.signals.emit("input:calibrate", { zero: [...this._padZero], padId: this.padId });
  }

  /** Forget the captured rest position — for a settings screen, or a pad handed to someone else. */
  recalibrate() {
    this._padZero = null;
    this._padStill = 0;
    for (let i = 0; i < 4; i++) {
      this._padRestRef[i] = this._padAxesRaw[i];
      this._padAxes[i] = this._padAxesRaw[i];
    }
    return true;
  }

  _padGone() {
    for (const name of PAD_BUTTON_NAMES) {
      if (this._padLatch[name] === true) {
        this._padLatch[name] = false;
        this._pushChord(`Pad:${name}`, "up", 0);
      }
    }
    for (const name of PAD_STICK_NAMES) {
      if (this._padStick[name] === true) {
        this._padStick[name] = false;
        this._pushChord(`Pad:${name}`, "up", 0);
      }
    }
    for (let i = 0; i < 4; i++) {
      this._padAxesRaw[i] = 0;
      this._padAxes[i] = 0;
    }
    this._padZero = null;
    this._padStill = 0;
    this._padRefInit = false;
    this._padAxisWoke = false;
    // A pad that is gone is not a pad anybody is using; leaving its activity stamp fresh would
    // block the keyboard's sustained claims for a dwell after the cable was pulled.
    this._activityAt[PAD] = -1e9;
    if (this._pendingDevice === PAD) this._pendingDevice = null;
  }

  // ================================================================= raw plumbing

  _pushChord(chord, phase, value = 1) {
    if (this._capture && phase === "down") {
      this._resolveCapture(chord);
      return true;
    }
    // A paused simulation still receives DOM events; drop the oldest rather than grow forever.
    if (this._events.length >= 256) this._events.shift();
    this._events.push({ chord, phase, value });
    return this._isBound(chord);
  }

  _isBound(chord) {
    return this._boundIn(chord, this.context);
  }

  _boundIn(chord, ctx) {
    const acts = this._index.get(chord);
    if (!acts) return false;
    for (const a of acts) if (ACTIONS[a].ctx.includes(ctx)) return true;
    return false;
  }

  /**
   * Claim the prompt glyphs for a device.
   *
   * Three rules, and the second and third exist because the first one alone is a trap.
   *
   * 1. **A dwell between switches.** Both devices are usually alive at once — a pad on the desk, a
   *    keyboard under the hands — and every switch repaints every prompt in the game. A minimum of
   *    `deviceDwell` seconds between switches means the worst case is a prompt that is 0.35 s late
   *    instead of prompts that strobe.
   *
   * 2. **A refused claim is remembered, never dropped.** This is the rule that was missing, and it
   *    made the arbitration one-directional: the pad re-asks from every sample at 250 Hz and so
   *    retries its way past any dwell, while the keyboard asks exactly once per keydown. A single
   *    keystroke landing inside the dwell was therefore lost *permanently*, and a player who put
   *    the pad down and grabbed the keyboard ran across the island with ✕ on every prompt. Now the
   *    claim is parked in `_pendingDevice` and `_settleDevice` applies it the moment the dwell is
   *    over, so there is no losing side: whoever asked last gets the prompts, at most 0.35 s late.
   *
   * 3. **An edge outranks a sustain.** A fresh press (keydown, mouse button, wheel, pad button, a
   *    stick leaving centre) is a deliberate statement of intent and takes the prompts from
   *    anything. A *sustained* input — a key still held, a stick still pushed — repeats every step
   *    and may only take the prompts from an incumbent that has gone quiet for the dwell. Without
   *    that asymmetry, a player holding W while the stick is also deflected would watch the glyphs
   *    trade hands every 0.35 s forever, which is a worse bug than the one being fixed.
   *
   * `_activityAt` is stamped by *every* call, accepted or not, so "the incumbent has gone quiet"
   * is a real measurement of the hardware rather than a proxy for who happens to own the prompts.
   */
  _wake(kind, { edge = true } = {}) {
    if (kind === PAD) this.everPad = true;
    this._activityAt[kind] = this.simTime;
    if (kind === this.device) {
      if (this._pendingDevice === kind) this._pendingDevice = null;
      return;
    }
    if (!edge && this.simTime - this._activityAt[this.device] < TUNING.deviceDwell) return;
    if (this.simTime - this._deviceAt < TUNING.deviceDwell) {
      this._pendingDevice = kind;
      return;
    }
    this._pendingDevice = null;
    this._deviceAt = this.simTime;
    this.device = kind;
    this.deviceSwitches++;
    this._emitDevice();
  }

  /**
   * Hand the prompts to whoever the dwell turned away, as soon as the dwell allows it. Runs once
   * per fixed step so the timing is on the simulation clock and a reviewer can reproduce it.
   *
   * A parked claim is up to a dwell old, and a lot can happen in 0.35 s — so it is honoured only
   * if its owner is still the device that spoke most recently. Otherwise one stray keystroke while
   * a player is steering with the stick would take the prompts a third of a second later, when the
   * hands that made the claim have already gone back to the pad.
   */
  _settleDevice() {
    const kind = this._pendingDevice;
    if (!kind) return;
    if (kind === this.device) {
      this._pendingDevice = null;
      return;
    }
    if (this.simTime - this._deviceAt < TUNING.deviceDwell) return;
    this._pendingDevice = null;
    if (this._activityAt[kind] < this._activityAt[this.device]) return;
    this._wake(kind);
  }

  _emitDevice() {
    this.signals.emit("input:device", {
      kind: this.device,
      style: this.device === PAD ? this.padStyle : KBM,
      id: this.device === PAD ? this.padId : null,
    });
  }

  _bindListeners() {
    const on = (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts);
      this._listeners.push([target, type, fn, opts]);
    };
    this._listeners = [];

    on(
      window,
      "keydown",
      (e) => {
        if (isEditable(e.target)) return;
        if (e.repeat) return;
        // A key event is proof of focus. Some window managers restore a tab without ever firing
        // `focus`, and without this the pad would stay gated for the rest of the session while the
        // keyboard carried on working — a bug that only a pad player would ever hit.
        this._proveFocus("keydown");
        this._wake(KBM);
        if (this._pushChord(e.code, "down", 1)) e.preventDefault();
      },
      { passive: false }
    );

    on(window, "keyup", (e) => {
      this._pushChord(e.code, "up", 0);
    });

    on(
      window,
      "mousedown",
      (e) => {
        if (isEditable(e.target)) return;
        this._proveFocus("mousedown");
        this._wake(KBM);
        if (this._pushChord(`Mouse${e.button}`, "down", 1)) e.preventDefault();
        // Only a click on the world itself grabs the pointer. The overlay is pointer-transparent
        // except for `.hit` controls, so a click that reaches a real element is UI and must keep
        // its cursor.
        const onWorld = e.target === this.canvas || e.target === document.body || e.target === document.documentElement;
        if (e.button === 0 && onWorld) this._maybeLock();
      },
      { passive: false }
    );

    on(window, "mouseup", (e) => {
      this._pushChord(`Mouse${e.button}`, "up", 0);
    });

    on(window, "mousemove", (e) => this._onMouseMove(e), { passive: true });

    on(
      window,
      "wheel",
      (e) => {
        if (isEditable(e.target)) return;
        if (!e.deltaY) return;
        this._wake(KBM);
        const chord = e.deltaY > 0 ? "Wheel+" : "Wheel-";
        // A wheel notch has no duration: emit both edges and let the one-transition-per-step
        // rule spread them over two steps so nothing can swallow the tick.
        const bound = this._isBound(chord);
        this._pushChord(chord, "down", 1);
        this._pushChord(chord, "up", 0);
        if (bound) e.preventDefault();
      },
      { passive: false }
    );

    // Right-drag is aim, not a browser menu — except inside a menu or a text field, where the
    // platform behaviour is the accessible one.
    on(window, "contextmenu", (e) => {
      if (this.context === "menu" || isEditable(e.target)) return;
      e.preventDefault();
    });
    // Focus is tracked as two independent facts and collapsed to one gate, because the browser
    // can give you either one without the other: clicking the URL bar blurs the window while the
    // tab stays visible, and switching tabs hides the page while the window keeps focus. Either
    // one means the player's hands are somewhere else.
    on(window, "blur", () => {
      this._windowFocused = false;
      this._loseFocus("blur");
    });
    on(window, "focus", () => {
      this._windowFocused = true;
      this._gainFocus("focus");
    });
    on(document, "visibilitychange", () => {
      this._pageVisible = document.visibilityState === "visible";
      if (this._pageVisible) this._gainFocus("visible");
      else this._loseFocus("hidden");
    });
    on(document, "pointerlockchange", () => {
      if (document.pointerLockElement) this._everLocked = true;
      else this._lastClient = null;
    });
    // Swallowed on purpose: a refused lock is a browser policy, not a game fault, and an
    // unhandled error here would poison every automated review capture.
    on(document, "pointerlockerror", (e) => e.preventDefault?.());

    on(window, "gamepadconnected", (e) => {
      this._padSeen = true;
      this.padIndex = e.gamepad?.index ?? this.padIndex;
      this.padId = e.gamepad?.id ?? this.padId;
      this.padStyle = detectPadStyle(this.padId ?? "");
      // A fresh pad brings its own rest position and its own neutral reference with it.
      this._padRefInit = false;
      this._padZero = null;
      this._padStill = 0;
      this.signals.emit("input:device", { kind: this.device, style: this.padStyle, id: this.padId, connected: true });
    });
    on(window, "gamepaddisconnected", () => {
      this.padIndex = -1;
      this.padConnected = false;
      // Drop back to the cheap sweep; a second pad still attached is re-found within a fifth of
      // a second, and the disconnect itself is turned into real `up` edges by `_padGone`.
      this._padSeen = false;
      this._padGone();
    });
  }

  _onMouseMove(e) {
    // The mouse's version of the pad gate. A blurred window still receives `mousemove` whenever
    // the pointer crosses it — click the URL bar, sweep the cursor back over the game, and an
    // ungated handler would turn the camera for a player who is typing somewhere else.
    if (!this._focused) return;
    const locked = this._isLocked();
    let dx = 0;
    let dy = 0;
    if (locked) {
      dx = e.movementX || 0;
      dy = e.movementY || 0;
    } else if (this._lastClient) {
      dx = e.clientX - this._lastClient.x;
      dy = e.clientY - this._lastClient.y;
      this._lastClient.x = e.clientX;
      this._lastClient.y = e.clientY;
    } else {
      this._lastClient = { x: e.clientX, y: e.clientY };
      return;
    }
    if (!dx && !dy) return;

    // Mouse travel is a *sustain*, not an edge. A mouse gets nudged — by a sleeve, by the desk
    // moving — and 8 px of that must not take the prompts off a pad the player is actively
    // steering with. Keep moving it for a dwell while the pad is quiet and it wins, which is the
    // gesture a player who has genuinely switched hands actually makes.
    this._mouseTravel += Math.abs(dx) + Math.abs(dy);
    if (this._mouseTravel >= TUNING.mouse.deviceSwitchPixels) {
      this._mouseTravel = 0;
      this._wake(KBM, { edge: false });
    }
    if (!this._lookAllowed(locked)) return;
    this._mouse.dx += dx;
    this._mouse.dy += dy;
  }

  _isLocked() {
    return this._simulatedLock || (typeof document !== "undefined" && document.pointerLockElement != null);
  }

  /**
   * Mouse look without a pointer lock is a development and review affordance, not a shipping
   * behaviour: it is allowed only until the pointer has genuinely been locked once. After a real
   * player has clicked in and pressed Escape, the cursor is theirs again and the camera holds
   * still.
   */
  _lookAllowed(locked) {
    if (this.context === "menu") return false;
    if (locked) return true;
    if (this.lookMode === "always") return true;
    if (this.lookMode === "locked") return false;
    return !this._everLocked;
  }

  /** Request pointer lock. Safe to call from any gesture; every failure path is swallowed. */
  requestPointerLock() {
    const el = this.canvas;
    if (!el?.requestPointerLock || this._isLocked()) return false;
    try {
      const p = el.requestPointerLock({ unadjustedMovement: true });
      if (p && typeof p.catch === "function") {
        p.catch(() => {
          try {
            el.requestPointerLock();
          } catch {
            /* browser said no; unlocked look keeps the game playable */
          }
        });
      }
    } catch {
      try {
        el.requestPointerLock();
      } catch {
        return false;
      }
    }
    return true;
  }

  _maybeLock() {
    if (!this.wantPointerLock) return;
    if (this.context === "menu") return;
    this.requestPointerLock();
  }

  // ================================================================= rebinding

  _rebuildIndex() {
    this._index = new Map();
    for (const device of [KBM, PAD]) {
      const table = this.bindings[device] ?? {};
      for (const action of ACTION_LIST) {
        for (const chord of table[action] ?? []) {
          let list = this._index.get(chord);
          if (!list) this._index.set(chord, (list = []));
          if (!list.includes(action)) list.push(action);
        }
      }
    }
  }

  listBindings() {
    return cloneBindings(this.bindings);
  }

  chordsFor(action, device = this.device) {
    return [...(this.bindings[device]?.[action] ?? [])];
  }

  actionsForChord(chord) {
    return [...(this._index.get(chord) ?? [])];
  }

  /**
   * Which existing actions would this chord collide with? Only actions that are alive at the
   * same time count: RT is `primary` in play and `buildPlace` in build, and that is by design.
   */
  conflictsFor(action, chord) {
    const device = chordDevice(chord);
    const table = this.bindings[device] ?? {};
    const out = [];
    for (const other of ACTION_LIST) {
      if (other === action) continue;
      if (!(table[other] ?? []).includes(chord)) continue;
      if (contextsOverlap(action, other)) out.push(other);
    }
    return out;
  }

  /** Every real collision in the current table. The defaults must report an empty array. */
  allConflicts() {
    const out = [];
    for (const device of [KBM, PAD]) {
      const seen = new Map();
      for (const action of ACTION_LIST) {
        for (const chord of this.bindings[device]?.[action] ?? []) {
          const prior = seen.get(chord) ?? [];
          for (const other of prior) {
            if (contextsOverlap(action, other)) out.push({ device, chord, actions: [other, action] });
          }
          prior.push(action);
          seen.set(chord, prior);
        }
      }
    }
    return out;
  }

  /**
   * Every action that has no chord at all on a device — the opposite failure to a conflict, and
   * the one the rebinding layer used to be blind to. `bind("dash","Space",{force:true})` strips
   * Space from `jump`, and if Space was jump's only chord the player now owns a jump they cannot
   * perform: `allConflicts()` is empty, the table is internally consistent, and the prompt renders
   * "—". A settings screen has to be able to see that, so it is reported here and in the probe.
   *
   * Returned per device rather than per action, because an action bound on the pad and stranded on
   * the keyboard is a real and different problem from one stranded on both — which is what
   * `both` tells you without a second call.
   */
  unboundActions(device = null) {
    const devices = device ? [device] : [KBM, PAD];
    const empty = (d, a) => (this.bindings[d]?.[a] ?? []).length === 0;
    const out = [];
    for (const d of devices) {
      for (const action of ACTION_LIST) {
        if (!empty(d, action)) continue;
        out.push({
          device: d,
          action,
          ctx: [...ACTIONS[action].ctx],
          both: empty(KBM, action) && empty(PAD, action),
        });
      }
    }
    return out;
  }

  /**
   * Bind a chord to an action.
   *
   * Returns `{ ok, reason, conflicts, chords }`, and every refusal leaves the table byte-identical
   * — including the capacity refusal, which is why the slot check runs *before* the conflicting
   * chords are stripped off their old owners. There are exactly three ways to be told no:
   *
   *   `unknown-action` / `unknown-chord`  the argument is not part of the vocabulary
   *   `conflict`                          another live action already owns this chord; pass
   *                                       `{force:true}` to take it, and the loser is reported
   *                                       back in `replaced` (and in `stranded` if that was its
   *                                       last chord on the device)
   *   `slots-full`                        the action already holds `MAX_SLOTS` chords. Previously
   *                                       this path pushed the chord, truncated the list back to
   *                                       three, threw the new chord away and still answered
   *                                       `ok:true` — a lie a settings screen would repaint
   *                                       itself around. Pass `{slot:n}` to replace a specific
   *                                       one, or `{evict:true}` to drop the oldest.
   */
  bind(action, chord, { slot = null, force = false, evict = false, save = true } = {}) {
    if (!ACTIONS[action]) return { ok: false, reason: "unknown-action", conflicts: [] };
    if (!isKnownChord(chord)) return { ok: false, reason: "unknown-chord", conflicts: [] };
    const device = chordDevice(chord);
    const conflicts = this.conflictsFor(action, chord);
    if (conflicts.length && !force) return { ok: false, reason: "conflict", conflicts };

    const list = this.bindings[device][action] ?? (this.bindings[device][action] = []);
    const existing = list.indexOf(chord);
    const wantSlot = Number.isInteger(slot) && slot >= 0 ? slot : null;
    // A slot index inside the list replaces and cannot grow it. Anything else appends — and an
    // append into a full list is the case that has to be refused, because it is the only one that
    // would need a truncation to stay legal.
    if ((wantSlot === null || wantSlot >= list.length) && existing < 0 && list.length >= MAX_SLOTS) {
      if (!evict) {
        return { ok: false, reason: "slots-full", conflicts, chords: [...list], slots: MAX_SLOTS };
      }
      list.shift(); // explicit, requested eviction of the oldest chord
    }

    for (const other of conflicts) {
      this.bindings[device][other] = (this.bindings[device][other] ?? []).filter((c) => c !== chord);
    }
    if (existing >= 0) list.splice(existing, 1);
    const at = wantSlot !== null && wantSlot < list.length ? wantSlot : null;
    if (at === null) list.push(chord);
    else list[at] = chord;

    this._rebuildIndex();
    if (save) this.saveBindings();
    // Which of the actions this bind took a chord from is now unreachable on this device? The
    // caller asked for one change and may have caused two; it should not have to diff the table
    // to find out.
    const stranded = conflicts.filter((other) => (this.bindings[device][other] ?? []).length === 0);
    this.signals.emit("input:rebind", { action, device, chord, slot: at, replaced: conflicts, stranded });
    return { ok: true, conflicts, stranded, chords: [...list] };
  }

  unbind(action, chord, { save = true } = {}) {
    const device = chordDevice(chord);
    const list = this.bindings[device]?.[action];
    if (!list) return false;
    const i = list.indexOf(chord);
    if (i < 0) return false;
    list.splice(i, 1);
    this._rebuildIndex();
    if (save) this.saveBindings();
    this.signals.emit("input:rebind", { action, device, chord: null, removed: chord });
    return true;
  }

  resetBindings(action = null, { save = true } = {}) {
    if (action) {
      for (const device of [KBM, PAD]) {
        this.bindings[device][action] = [...(DEFAULT_BINDINGS[device][action] ?? [])];
      }
    } else {
      this.bindings = cloneBindings(DEFAULT_BINDINGS);
      this.axes = cloneAxes(DEFAULT_AXES);
    }
    this._rebuildIndex();
    if (save) this.saveBindings();
    this.signals.emit("input:rebind", { action, reset: true });
    return this.listBindings();
  }

  // ---------------------------------------------------------------- analog axes
  //
  // The sticks are rebindable too. Without this there is no southpaw, no stick swap and no
  // per-stick invert, and a settings screen has nothing to build a control against — the axis
  // map would be a module-level constant that only a code change could reach.

  listAxes() {
    return cloneAxes(this.axes);
  }

  axisFor(vec, comp) {
    const m = this.axes?.[vec]?.[comp];
    return m ? { ...m, label: axisLabel(m.axis) } : null;
  }

  /**
   * Point one component of one vector at a hardware axis, and/or flip it.
   *   input.setAxis("look", "y", { invert: true })     // per-stick vertical invert
   *   input.setAxis("move", "x", { axis: 2 })          // move X on the right stick
   */
  setAxis(vec, comp, { axis = null, invert = null, save = true } = {}) {
    const m = this.axes?.[vec]?.[comp];
    if (!m) return { ok: false, reason: "unknown-vector" };
    if (axis !== null && axis !== undefined) {
      const i = Math.trunc(Number(axis));
      if (!Number.isFinite(i) || i < 0 || i > 3) return { ok: false, reason: "unknown-axis" };
      m.axis = i;
    }
    if (invert !== null && invert !== undefined) m.invert = !!invert;
    if (save) this.saveBindings();
    this.signals.emit("input:rebind", { axes: true, vec, comp, axis: m.axis, invert: m.invert });
    return { ok: true, vec, comp, map: { ...m } };
  }

  /**
   * Southpaw. `swapSticks()` toggles, `swapSticks(true|false)` sets.
   *
   * It operates on the **live** axis map, never on the factory table. Rebuilding from
   * `DEFAULT_AXES` looks equivalent and is not: it silently discards every other axis preference
   * the player has set, so turning southpaw on threw away an inverted look-Y and turning it off
   * again did not bring it back. The swap is an involution — the permutation [2,3,0,1] applied
   * twice is the identity — so one expression covers both directions, and because `cloneAxes`
   * keeps `invert` attached to its vector, the inversions ride across the change untouched.
   *
   * Returns the state `sticksSwapped()` actually reports afterwards, so the probe and the return
   * value can never disagree.
   */
  swapSticks(on = null) {
    const was = this.sticksSwapped();
    const want = on === null || on === undefined ? !was : !!on;
    if (want !== was) this.axes = swappedAxes(this.axes);
    const now = this.sticksSwapped();
    this.config?.set?.("swapSticks", now);
    this.saveBindings();
    this.signals.emit("input:rebind", { axes: true, swapSticks: now });
    return now;
  }

  /** True only for a full southpaw layout; a one-axis custom remap is not "swapped sticks". */
  sticksSwapped() {
    return this.axes.move.x.axis === PAD_AXES.RX && this.axes.move.y.axis === PAD_AXES.RY;
  }

  resetAxes({ save = true } = {}) {
    this.axes = cloneAxes(DEFAULT_AXES);
    if (save) this.saveBindings();
    this.signals.emit("input:rebind", { axes: true, reset: true });
    return this.listAxes();
  }

  /** Listen-for-a-key mode. The next press binds; Escape cancels. */
  startCapture(action, { slot = null, device = null } = {}) {
    if (!ACTIONS[action]) return false;
    this._capture = { action, slot, device };
    this.signals.emit("input:capture", { action, phase: "start" });
    return true;
  }

  cancelCapture() {
    if (!this._capture) return false;
    const { action } = this._capture;
    this._capture = null;
    this.signals.emit("input:capture", { action, phase: "cancel" });
    return true;
  }

  _resolveCapture(chord) {
    const cap = this._capture;
    if (chord === "Escape") {
      this._capture = null;
      this.signals.emit("input:capture", { action: cap.action, phase: "cancel" });
      return;
    }
    if (cap.device && chordDevice(chord) !== cap.device) return;
    this._capture = null;
    const result = this.bind(cap.action, chord, { slot: cap.slot, force: true });
    this.signals.emit("input:capture", { action: cap.action, phase: "done", chord, result });
  }

  /** `?bindings=default` gives a review capture a factory controller no matter what is saved. */
  _readStore() {
    try {
      if (new URLSearchParams(location.search).get("bindings") === "default") return null;
    } catch {
      /* no location in this environment */
    }
    try {
      const raw = JSON.parse(localStorage.getItem(BIND_STORE) || "null");
      return raw && raw.v === 1 ? raw : null;
    } catch {
      return null; // a corrupt or unavailable store simply means factory bindings
    }
  }

  _loadBindings(store = this._readStore()) {
    const table = cloneBindings(DEFAULT_BINDINGS);
    if (!store) return table;
    for (const device of [KBM, PAD]) {
      for (const [action, chords] of Object.entries(store[device] ?? {})) {
        if (!ACTIONS[action] || !Array.isArray(chords)) continue;
        table[device][action] = chords
          .filter((c) => isKnownChord(c) && chordDevice(c) === device)
          .slice(0, MAX_SLOTS);
      }
    }
    return table;
  }

  /** Axes live in the same record as the chords — one save, one reset, one migration story. */
  _loadAxes(store = this._readStore()) {
    if (store?.axes) return cloneAxes(store.axes);
    return this._cfg("swapSticks", false) === true ? swappedAxes(DEFAULT_AXES) : cloneAxes(DEFAULT_AXES);
  }

  saveBindings() {
    try {
      localStorage.setItem(
        BIND_STORE,
        JSON.stringify({ v: 1, ...cloneBindings(this.bindings), axes: cloneAxes(this.axes) })
      );
      return true;
    } catch {
      return false;
    }
  }

  // ================================================================= presentation

  /** Printable prompt for an action on the active device: `{ text, i18n, chord }`. */
  glyph(action, device = this.device) {
    const chord = this.chordsFor(action, device)[0] ?? null;
    const label = chordLabel(chord, device === PAD ? this.padStyle : KBM);
    return { ...label, chord };
  }

  glyphs(device = this.device) {
    return Object.fromEntries(ACTION_LIST.map((a) => [a, this.glyph(a, device).text]));
  }

  /**
   * Pad haptics. Kept here rather than in an effects system because the pad is an input device
   * and only this module knows which one is live. Silently does nothing on a keyboard, on a pad
   * without actuators, or when the player has asked for reduced motion — so callers never need
   * to check first.
   *
   *   kernel.get("input").rumble({ strong: 0.6, weak: 0.2, ms: 180 })
   */
  rumble({ strong = 0.5, weak = 0.25, ms = 150, delay = 0 } = {}) {
    if (this.device !== PAD) return false;
    if (this._cfg("rumble", true) === false || this._cfg("reduceMotion", false) === true) return false;
    const pad = this._readPad();
    const actuator = pad?.vibrationActuator;
    if (!actuator?.playEffect) return false;
    try {
      const p = actuator.playEffect("dual-rumble", {
        startDelay: Math.max(0, delay),
        duration: clamp(ms, 0, 1500),
        weakMagnitude: clamp(weak, 0, 1),
        strongMagnitude: clamp(strong, 0, 1),
      });
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch {
      return false;
    }
    return true;
  }

  // ================================================================= probe

  probeState() {
    const actions = {};
    const held = [];
    for (const name of ACTION_LIST) {
      const st = this.actions.get(name);
      const isHeld = st.active;
      const pressed = st.downStep === this.stepIndex;
      const released = st.upStep === this.stepIndex;
      const buffered = this.buffered(name);
      if (isHeld) held.push(name);
      if (!isHeld && !pressed && !released && !buffered) continue;
      actions[name] = {
        held: isHeld,
        pressed,
        released,
        buffered,
        value: round4(st.value),
        hold: round4(st.hold),
        chords: [...st.chords],
      };
    }
    return {
      device: {
        active: this.device,
        style: this.device === PAD ? this.padStyle : KBM,
        padId: this.padId,
        padConnected: this.padConnected,
        padVirtual: !!this._virtual,
        everPad: this.everPad,
        switches: this.deviceSwitches,
        switchedAt: round4(this._deviceAt < -1e8 ? -1 : this._deviceAt),
        dwell: TUNING.deviceDwell,
        // The arbitration, made inspectable. `pending` is a claim the dwell has parked and will
        // apply; `usedAt` is when each device was last physically touched, whichever owned the
        // prompts. Between them a reviewer can tell a late switch from a lost one.
        pending: this._pendingDevice,
        usedAt: {
          [KBM]: round4(this._activityAt[KBM] < -1e8 ? -1 : this._activityAt[KBM]),
          [PAD]: round4(this._activityAt[PAD] < -1e8 ? -1 : this._activityAt[PAD]),
        },
      },
      pad: {
        connected: this.padConnected,
        samples: this._padSamples,
        edges: this._padEdges,
        axesRaw: this._padAxesRaw.map(round4),
        axesCal: this._padAxes.map(round4),
        zero: this._padZero ? this._padZero.map(round4) : null,
        zeroAt: round4(this._padZeroAt),
        zeroCount: this._padZeroCount,
        still: round4(this._padStill),
        latched: PAD_BUTTON_NAMES.filter((n) => this._padLatch[n] === true),
        sticksDown: PAD_STICK_NAMES.filter((n) => this._padStick[n] === true),
        pending: this._events.length,
      },
      context: this.context,
      // Focus is a *gameplay* state on a pad, not housekeeping: while `focused` is false the pad
      // sweep does not run at all, so a reviewer reading a silent probe can tell "nothing is
      // happening because the window is blurred" apart from "nothing is happening because input
      // is broken".
      focus: { focused: this._focused, window: this._windowFocused, page: this._pageVisible },
      step: this.stepIndex,
      move: { x: round4(this.move.x), y: round4(this.move.y), mag: round4(this.moveMag), source: this.moveSource },
      look: {
        dx: round6(this.look.dx),
        dy: round6(this.look.dy),
        yawTotal: round6(this.lookTotal.yaw),
        pitchTotal: round6(this.lookTotal.pitch),
        boost: round4(this.lookBoost),
        source: this.lookSource,
        pointerLock: this._isLocked(),
        lookMode: this.lookMode,
      },
      // A snapshot, never the live object. Two probes taken a step apart have to be comparable —
      // handing out `this.sticks` meant a capture taken at full deflection read as centred the
      // moment the stick was released, and no reviewer could ever catch it.
      sticks: { left: copyStick(this.sticks.left), right: copyStick(this.sticks.right) },
      held,
      actions,
      conflicts: this.allConflicts(),
      // The other half of "is this control scheme playable": a chord two actions share, and an
      // action no chord reaches. Both have to be visible to a rebinding screen.
      unbound: this.unboundActions(),
      bindings: this.listBindings(),
      axes: this.listAxes(),
      sticksSwapped: this.sticksSwapped(),
      glyphs: this.glyphs(),
      tuning: {
        moveBand: this._band("move"),
        lookBand: this._band("look"),
        lookRate: TUNING.lookRate,
        lookRamp: TUNING.lookRamp,
        mouseRadiansPerPixel: TUNING.mouse.radiansPerPixel,
        bufferDefault: TUNING.bufferDefault,
        deviceDwell: TUNING.deviceDwell,
        padWakeAxisDelta: TUNING.padWakeAxisDelta,
        padRest: { ...TUNING.padRest },
        padPollHz: TUNING.padPollHz,
        trigger: { ...TUNING.trigger },
        stickButton: { ...TUNING.stickButton },
        // How many chords one action may hold on one device. A settings screen needs this to know
        // when to offer "replace which one?" instead of an add button that will be refused.
        maxSlots: MAX_SLOTS,
        sensitivity: {
          look: this._cfg("lookSensitivity", 1),
          mouse: this._cfg("lookSensitivityMouse", 1),
          pad: this._cfg("lookSensitivityPad", 1),
          invertX: !!this._cfg("invertX", false),
          invertY: !!this._cfg("invertY", false),
          holdToSprint: this._cfg("holdToSprint", true) !== false,
          swapSticks: !!this._cfg("swapSticks", false),
          rumble: this._cfg("rumble", true) !== false,
        },
      },
      actionCount: ACTION_LIST.length,
    };
  }

  _publishProbe() {
    publish("input", () => this.probeState());
  }

  // ================================================================= test hook

  /**
   * `window.__vsInput` — the review harness cannot press a physical gamepad, so it drives a
   * synthetic one. The virtual pad takes priority over `navigator.getGamepads()` while it exists
   * and is shaped exactly like a Standard Gamepad, so the code path under test is the real one:
   * the same `_samplePad`/`_ingest` that reads hardware reads this.
   *
   * **The journal.** Every mutation appends the resulting state to `pad.__samples`, and
   * `_samplePad` drains that queue before it looks at the live snapshot. This is not a special
   * case bolted on for testing — it is the synthetic equivalent of the 250 Hz timer. A real pad
   * gets its sub-frame resolution from being sampled every 4 ms; a scripted pad gets it from
   * journalling the states it passed through, because a script's `press` and `release` can happen
   * inside a single JS task where no timer can possibly fire. Both feed the same `_ingest`, so
   * `press("A"); release("A")` between two `__vs.advance()` calls produces a real down edge and a
   * real up edge, exactly like a scripted keydown/keyup pair — which is what makes it a fair test
   * of the buffering, the latch and the one-transition-per-step rule rather than a test of the
   * harness's timing.
   *
   * Every method returns state, so a whole scenario fits in a single semicolon-free expression —
   * which is what `review.mjs`'s `eval:` verb requires.
   *
   *   __vsInput.set({ axes: { lx: 0.62, ly: -0.62 }, buttons: { RT: 0.8 } })
   *   __vsInput.press("A")          __vsInput.release("A")   __vsInput.tap("A")
   *   __vsInput.stick("left", x, y) __vsInput.stick("right", x, y)
   *   __vsInput.connect({ style: "playstation" })   __vsInput.disconnect()
   *   __vsInput.poll()              // force one sweep now, outside the rate gate
   *   __vsInput.zero()              // the captured rest offsets, or null
   *   __vsInput.recalibrate()       // forget them
   *   __vsInput.setAxis("look","y",{invert:true})   __vsInput.swapSticks(true)
   *   __vsInput.pointerLock(true)   // exercise the locked mouse-look branch
   *   __vsInput.lookMode("always")  __vsInput.context("menu")   __vsInput.probe()
   *   __vsInput.blur()  __vsInput.focus()  __vsInput.hidden(true|false)
   *                                 // alt-tab, both routes, through the real DOM events
   *   __vsInput.unbound()           // actions with no chord on a device
   *   __vsInput.conflicts()         // chords two live actions share
   */
  _installTestHook() {
    const self = this;
    const AXIS_ALIAS = { lx: 0, ly: 1, rx: 2, ry: 3, 0: 0, 1: 1, 2: 2, 3: 3 };

    const blank = (id) => ({
      id,
      index: 0,
      connected: true,
      mapping: "standard",
      timestamp: 0,
      axes: [0, 0, 0, 0],
      buttons: PAD_BUTTON_NAMES.map(() => ({ pressed: false, touched: false, value: 0 })),
      __samples: [],
      __virtual: true,
    });

    /** Append the state the pad is in *now*, so no transition can pass unobserved. */
    const record = (pad) => {
      if (!pad) return;
      if (!Array.isArray(pad.__samples)) pad.__samples = [];
      if (pad.__samples.length >= 256) pad.__samples.shift();
      pad.__samples.push({
        axes: [pad.axes[0] ?? 0, pad.axes[1] ?? 0, pad.axes[2] ?? 0, pad.axes[3] ?? 0],
        vals: Array.from({ length: PAD_SLOTS }, (_, i) => Number(pad.buttons?.[i]?.value) || 0),
        press: Array.from({ length: PAD_SLOTS }, (_, i) => pad.buttons?.[i]?.pressed === true),
      });
    };

    const ensure = (id) => {
      if (!self._virtual) self._virtual = blank(id ?? "Variable Star Virtual Pad (STANDARD GAMEPAD)");
      return self._virtual;
    };

    const hook = {
      connect(opts = {}) {
        const pad = ensure(opts.id);
        if (opts.style === "playstation") pad.id = opts.id ?? "DualSense Wireless Controller (STANDARD GAMEPAD)";
        else if (opts.style === "xbox") pad.id = opts.id ?? "Xbox Wireless Controller (STANDARD GAMEPAD)";
        else if (opts.id) pad.id = opts.id;
        self.padId = null; // force a style re-detect on the next sweep
        self._padRefInit = false;
        record(pad);
        return hook.snapshot();
      },
      disconnect() {
        self._virtual = null;
        self._samplePad(true); // turn the disconnect into real `up` edges immediately
        return hook.snapshot();
      },
      set(state = {}) {
        const pad = ensure(state.id);
        if (state.id) pad.id = state.id;
        if (state.axes) {
          for (const [k, v] of Object.entries(state.axes)) {
            const i = AXIS_ALIAS[String(k).toLowerCase()];
            if (i !== undefined) pad.axes[i] = clamp(Number(v) || 0, -1, 1);
          }
        }
        if (Array.isArray(state.buttons)) {
          for (const name of state.buttons) hook._button(pad, name, 1);
        } else if (state.buttons) {
          for (const [name, v] of Object.entries(state.buttons)) hook._button(pad, name, v);
        }
        pad.timestamp = performance.now();
        record(pad);
        return hook.snapshot();
      },
      _button(pad, name, v) {
        const i = PAD_BUTTONS[name];
        if (i === undefined) return;
        const value = clamp(Number(v) || 0, 0, 1);
        pad.buttons[i] = { pressed: value >= 0.5, touched: value > 0, value };
      },
      press(name, value = 1) {
        return hook.set({ buttons: { [name]: value } });
      },
      release(name) {
        return hook.set({ buttons: { [name]: 0 } });
      },
      /** A press and a release with nothing in between — the input a polled level loses. */
      tap(name, value = 1) {
        hook.set({ buttons: { [name]: value } });
        return hook.set({ buttons: { [name]: 0 } });
      },
      axis(name, v) {
        return hook.set({ axes: { [name]: v } });
      },
      stick(which, x, y) {
        return which === "right" ? hook.set({ axes: { rx: x, ry: y } }) : hook.set({ axes: { lx: x, ly: y } });
      },
      /** Inject a full Gamepad-shaped object, for testing an exotic pad snapshot verbatim. */
      raw(gamepadLike) {
        self._virtual = gamepadLike ? { ...blank("raw"), ...gamepadLike, __virtual: true } : null;
        if (self._virtual && !Array.isArray(self._virtual.__samples)) self._virtual.__samples = [];
        record(self._virtual);
        return hook.snapshot();
      },
      clear() {
        if (!self._virtual) return hook.snapshot();
        const id = self._virtual.id;
        self._virtual = blank(id);
        record(self._virtual);
        return hook.snapshot();
      },
      /** Force one sweep now, ignoring the rate gate. */
      poll() {
        self._samplePad(true);
        return { samples: self._padSamples, edges: self._padEdges, pending: self._events.length };
      },
      zero() {
        return self._padZero ? [...self._padZero] : null;
      },
      recalibrate() {
        return self.recalibrate();
      },
      rest() {
        return { still: self._padStill, ref: [...self._padRestRef], zero: hook.zero() };
      },
      setAxis(vec, comp, opts) {
        return self.setAxis(vec, comp, opts);
      },
      swapSticks(on) {
        return self.swapSticks(on);
      },
      axes() {
        return self.listAxes();
      },
      pointerLock(on = true) {
        self._simulatedLock = !!on;
        if (on) self._everLocked = true;
        return self._isLocked();
      },
      lookMode(mode) {
        if (mode) self.lookMode = mode;
        return self.lookMode;
      },
      context(ctx) {
        if (ctx) self.setContext(ctx);
        return self.context;
      },
      /** Dispatch a synthetic mouse move; under a simulated lock this feeds the movementX branch. */
      mouse(dx, dy) {
        const e = new MouseEvent("mousemove", {
          clientX: (self._lastClient?.x ?? 0) + dx,
          clientY: (self._lastClient?.y ?? 0) + dy,
          movementX: dx,
          movementY: dy,
          bubbles: true,
        });
        window.dispatchEvent(e);
        return { dx: self._mouse.dx, dy: self._mouse.dy };
      },
      device() {
        return self.device;
      },
      /**
       * Alt-tab, simulated. These dispatch the **genuine** DOM events rather than poking the flag,
       * so what is under test is the real listener chain: `blur` → `_loseFocus` → `releaseAll` →
       * `_samplePad` gated. `focus()` is the return trip. `hidden(true|false)` does the same for
       * the tab-switch path, which reaches the same place by a different route.
       */
      blur() {
        window.dispatchEvent(new Event("blur"));
        return { focused: self._focused, held: self.probeState().held };
      },
      focus() {
        window.dispatchEvent(new Event("focus"));
        return { focused: self._focused, held: self.probeState().held };
      },
      hidden(on = true) {
        // Override the getter and fire the real event, so the module's own listener does the
        // reading. Poking `_pageVisible` would test the hook rather than the handler.
        try {
          Object.defineProperty(document, "visibilityState", {
            configurable: true,
            get: () => (on ? "hidden" : "visible"),
          });
        } catch {
          /* a browser that refuses the override still gets the event below */
        }
        document.dispatchEvent(new Event("visibilitychange"));
        return { focused: self._focused, held: self.probeState().held };
      },
      unbound() {
        return self.unboundActions();
      },
      conflicts() {
        return self.allConflicts();
      },
      bind(action, chord, opts) {
        return self.bind(action, chord, opts);
      },
      reset(action) {
        return self.resetBindings(action);
      },
      snapshot() {
        const pad = self._virtual;
        return pad
          ? {
              id: pad.id,
              axes: [...pad.axes],
              buttons: Object.fromEntries(
                PAD_BUTTON_NAMES.map((n) => [n, pad.buttons[PAD_BUTTONS[n]]?.value ?? 0]).filter((e) => e[1] > 0)
              ),
            }
          : null;
      },
      probe() {
        return self.probeState();
      },
    };

    this._hook = hook;
    if (typeof window !== "undefined") window.__vsInput = hook;
  }

  // ================================================================= lifecycle

  _cfg(key, fallback) {
    const v = this.config?.get?.(key);
    return v === undefined || v === null ? fallback : v;
  }

  dispose() {
    for (const [target, type, fn, opts] of this._listeners ?? []) target.removeEventListener(type, fn, opts);
    this._listeners = [];
    if (this._pollTimer) clearInterval(this._pollTimer);
    this._pollTimer = null;
    this._offMenu?.();
    if (typeof window !== "undefined" && window.__vsInput === this._hook) delete window.__vsInput;
  }
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function round4(v) {
  return Math.round(v * 1e4) / 1e4;
}

function round6(v) {
  return Math.round(v * 1e6) / 1e6;
}

/** A centred stick, in the same four-stage shape `_readStick` reports. */
function zeroStickView() {
  return {
    hw: { x: 0, y: 0 },
    zero: { x: 0, y: 0 },
    mapped: { x: 0, y: 0 },
    out: { x: 0, y: 0 },
    mag: 0,
  };
}

/** Probes must be JSON-safe and honest, which means a value, not a window onto live state. */
function copyStick(s) {
  return {
    hw: { x: s.hw.x, y: s.hw.y },
    zero: { x: s.zero.x, y: s.zero.y },
    mapped: { x: s.mapped.x, y: s.mapped.y },
    out: { x: s.out.x, y: s.out.y },
    mag: s.mag,
  };
}
