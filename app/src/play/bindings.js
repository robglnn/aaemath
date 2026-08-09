/**
 * bindings.js — the input vocabulary of Variable Star, as data.
 *
 * Nothing in the game ever asks "is KeyW down". It asks "is `moveForward` held", and this file
 * is the only place that knows KeyW exists. That indirection is what makes three things possible
 * at once: a full rebinding UI, a pad that plays the entire game with no keyboard, and prompt
 * glyphs that swap between Xbox and PlayStation naming without a single `if` in gameplay code.
 *
 * ## Chords
 *
 * A binding is a *chord string* — one token, comparable, serializable, printable:
 *
 *   "KeyW" "Space" "ShiftLeft"      KeyboardEvent.code, verbatim
 *   "Mouse0" "Mouse1" "Mouse2"      MouseEvent.button (0 left, 1 middle, 2 right)
 *   "Wheel+" "Wheel-"               wheel down / wheel up, delivered as an instant press+release
 *   "Pad:A" "Pad:RT" "Pad:DUp"      Standard Gamepad buttons, by *semantic* name
 *   "Pad:LSUp" "Pad:RSLeft"         stick deflection treated as a button (menu navigation)
 *
 * Pad chords are stored by semantic name rather than button index so that the PlayStation glyph
 * table is a pure presentation swap: the chord is still "Pad:A", it just prints as ✕.
 *
 * ## Contexts
 *
 * Every action declares the contexts it is alive in — `play`, `build`, `menu`. This is not
 * bureaucracy; it is what lets one physical button mean the obvious thing in each mode without a
 * genuine conflict. RT fires your primary in play and places a structure in build. A on the pad
 * jumps in play and confirms in a menu. The conflict detector therefore only flags two actions
 * sharing a chord when their context sets actually *overlap* — and with the defaults below it
 * finds nothing.
 *
 * ## Localization
 *
 * Labels come back as `{ text, i18n }`. `text` is a locale-neutral fallback and `i18n` is the key
 * P20 should localize. Symbols (✕ ◯ ▢ △ ↑ ↓ ← → [ ] W 1) carry `i18n: null` because they read the
 * same in EN, ES and PL; only word-shaped names ("Space", "Options", "Left Shift") carry a key.
 * A prompt that renders `text` when `i18n` is null is not an English fallback leak.
 */

export const KBM = "kbm";
export const PAD = "pad";

export const CONTEXTS = ["play", "build", "menu"];

/** W3C Standard Gamepad button order, named the way a player thinks about them. */
export const PAD_BUTTONS = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  View: 8,
  Menu: 9,
  L3: 10,
  R3: 11,
  DUp: 12,
  DDown: 13,
  DLeft: 14,
  DRight: 15,
  Guide: 16,
};

export const PAD_BUTTON_NAMES = Object.keys(PAD_BUTTONS);

/** Triggers are continuous; they need a threshold with hysteresis, not a boolean. */
export const PAD_ANALOG_BUTTONS = new Set(["LT", "RT"]);

export const PAD_AXES = { LX: 0, LY: 1, RX: 2, RY: 3 };

/**
 * Stick deflection promoted to a button. Menus must be drivable with the left stick — a player
 * who never touches the d-pad still has to be able to reach every setting.
 */
export const PAD_STICK_DIRS = {
  LSUp: { axis: 1, sign: -1 },
  LSDown: { axis: 1, sign: 1 },
  LSLeft: { axis: 0, sign: -1 },
  LSRight: { axis: 0, sign: 1 },
  RSUp: { axis: 3, sign: -1 },
  RSDown: { axis: 3, sign: 1 },
  RSLeft: { axis: 2, sign: -1 },
  RSRight: { axis: 2, sign: 1 },
};

export const PAD_STICK_NAMES = Object.keys(PAD_STICK_DIRS);

/**
 * A stick direction is a *promotion* of an analog axis to a button, and the two must never be
 * added together. `Pad:LSUp` exists so menus are drivable from the stick and so a pad prompt for
 * "Move" can print `L ↑`; the actual walking speed comes from the analog axis map. Anything that
 * sums digital move keys has to skip these, or a stick at 0.6 would read as a full digital press
 * and the analog curve would be thrown away.
 */
export function isStickChord(chord) {
  return isPadChord(chord) && padPart(chord) in PAD_STICK_DIRS;
}

const ARROW = { DUp: "↑", DDown: "↓", DLeft: "←", DRight: "→" };

function padWords(style, over) {
  const base = {
    LB: { text: "LB", i18n: null },
    RB: { text: "RB", i18n: null },
    LT: { text: "LT", i18n: null },
    RT: { text: "RT", i18n: null },
    L3: { text: "L3", i18n: null },
    R3: { text: "R3", i18n: null },
    View: { text: "View", i18n: `input.pad.${style}.view` },
    Menu: { text: "Menu", i18n: `input.pad.${style}.menu` },
    Guide: { text: "Guide", i18n: `input.pad.${style}.guide` },
    DUp: { text: `D ${ARROW.DUp}`, i18n: null },
    DDown: { text: `D ${ARROW.DDown}`, i18n: null },
    DLeft: { text: `D ${ARROW.DLeft}`, i18n: null },
    DRight: { text: `D ${ARROW.DRight}`, i18n: null },
    LSUp: { text: `L ${ARROW.DUp}`, i18n: null },
    LSDown: { text: `L ${ARROW.DDown}`, i18n: null },
    LSLeft: { text: `L ${ARROW.DLeft}`, i18n: null },
    LSRight: { text: `L ${ARROW.DRight}`, i18n: null },
    RSUp: { text: `R ${ARROW.DUp}`, i18n: null },
    RSDown: { text: `R ${ARROW.DDown}`, i18n: null },
    RSLeft: { text: `R ${ARROW.DLeft}`, i18n: null },
    RSRight: { text: `R ${ARROW.DRight}`, i18n: null },
  };
  return { ...base, ...over };
}

/** Glyph tables. Face buttons are the only thing that really differs between families. */
export const PAD_GLYPHS = {
  xbox: padWords("xbox", {
    A: { text: "A", i18n: null },
    B: { text: "B", i18n: null },
    X: { text: "X", i18n: null },
    Y: { text: "Y", i18n: null },
  }),
  playstation: padWords("playstation", {
    A: { text: "✕", i18n: null },
    B: { text: "◯", i18n: null },
    X: { text: "▢", i18n: null },
    Y: { text: "△", i18n: null },
    LB: { text: "L1", i18n: null },
    RB: { text: "R1", i18n: null },
    LT: { text: "L2", i18n: null },
    RT: { text: "R2", i18n: null },
    View: { text: "Create", i18n: "input.pad.playstation.view" },
    Menu: { text: "Options", i18n: "input.pad.playstation.menu" },
    Guide: { text: "PS", i18n: null },
  }),
};
PAD_GLYPHS.generic = PAD_GLYPHS.xbox;

/**
 * Pad family from the raw HID id string. Unknown pads report as Xbox because the W3C Standard
 * Gamepad mapping *is* the Xbox layout — guessing PlayStation for an unknown pad would put the
 * wrong symbol on the wrong physical button, which is worse than a neutral letter.
 */
export function detectPadStyle(id = "") {
  const s = String(id).toLowerCase();
  // Order matters. Chrome reports a DualShock 4 as the maddeningly generic
  // "Wireless Controller (STANDARD GAMEPAD Vendor: 054c ...)", so that phrase has to be the
  // *last* resort — an Xbox pad also calls itself a wireless controller and must not end up
  // printing ✕ on the button stamped A.
  if (/dualsense|dualshock|playstation|\b054c\b/.test(s)) return "playstation";
  if (/xbox|xinput|x-box|\b045e\b/.test(s)) return "xbox";
  if (/^wireless controller/.test(s)) return "playstation";
  return "xbox";
}

// ------------------------------------------------------------------ keyboard label table

const KEY_WORDS = {
  Space: { text: "Space", i18n: "input.key.space" },
  Escape: { text: "Esc", i18n: "input.key.escape" },
  Enter: { text: "Enter", i18n: "input.key.enter" },
  NumpadEnter: { text: "Enter", i18n: "input.key.enter" },
  Tab: { text: "Tab", i18n: "input.key.tab" },
  Backspace: { text: "Backspace", i18n: "input.key.backspace" },
  ShiftLeft: { text: "L Shift", i18n: "input.key.shiftLeft" },
  ShiftRight: { text: "R Shift", i18n: "input.key.shiftRight" },
  ControlLeft: { text: "L Ctrl", i18n: "input.key.controlLeft" },
  ControlRight: { text: "R Ctrl", i18n: "input.key.controlRight" },
  AltLeft: { text: "L Alt", i18n: "input.key.altLeft" },
  AltRight: { text: "R Alt", i18n: "input.key.altRight" },
  CapsLock: { text: "Caps", i18n: "input.key.capsLock" },
  ArrowUp: { text: "↑", i18n: null },
  ArrowDown: { text: "↓", i18n: null },
  ArrowLeft: { text: "←", i18n: null },
  ArrowRight: { text: "→", i18n: null },
  BracketLeft: { text: "[", i18n: null },
  BracketRight: { text: "]", i18n: null },
  Semicolon: { text: ";", i18n: null },
  Quote: { text: "'", i18n: null },
  Comma: { text: ",", i18n: null },
  Period: { text: ".", i18n: null },
  Slash: { text: "/", i18n: null },
  Backslash: { text: "\\", i18n: null },
  Minus: { text: "-", i18n: null },
  Equal: { text: "=", i18n: null },
  Backquote: { text: "`", i18n: null },
};

const MOUSE_WORDS = {
  Mouse0: { text: "LMB", i18n: "input.mouse.left" },
  Mouse1: { text: "MMB", i18n: "input.mouse.middle" },
  Mouse2: { text: "RMB", i18n: "input.mouse.right" },
  Mouse3: { text: "M4", i18n: null },
  Mouse4: { text: "M5", i18n: null },
  "Wheel+": { text: "Wheel ↓", i18n: "input.mouse.wheelDown" },
  "Wheel-": { text: "Wheel ↑", i18n: "input.mouse.wheelUp" },
};

export function isPadChord(chord) {
  return typeof chord === "string" && chord.startsWith("Pad:");
}

export function chordDevice(chord) {
  return isPadChord(chord) ? PAD : KBM;
}

export function padPart(chord) {
  return isPadChord(chord) ? chord.slice(4) : null;
}

/** Printable name for a chord. Returns `{ text, i18n }` — see the localization note above. */
export function chordLabel(chord, style = "xbox") {
  if (!chord) return { text: "—", i18n: null };
  if (isPadChord(chord)) {
    const table = PAD_GLYPHS[style] ?? PAD_GLYPHS.xbox;
    return table[padPart(chord)] ?? { text: padPart(chord), i18n: null };
  }
  if (MOUSE_WORDS[chord]) return MOUSE_WORDS[chord];
  if (KEY_WORDS[chord]) return KEY_WORDS[chord];
  if (/^Key[A-Z]$/.test(chord)) return { text: chord.slice(3), i18n: null };
  if (/^Digit[0-9]$/.test(chord)) return { text: chord.slice(5), i18n: null };
  if (/^Numpad[0-9]$/.test(chord)) return { text: `Num ${chord.slice(6)}`, i18n: null };
  if (/^F[0-9]{1,2}$/.test(chord)) return { text: chord, i18n: null };
  return { text: chord, i18n: null };
}

// ------------------------------------------------------------------ the action vocabulary

const PLAY = ["play", "build"];

/**
 * Every named action in the game.
 *
 *   ctx     contexts the action is live in
 *   group   coarse category, for a settings screen that wants sections
 *   buffer  press-buffer window in seconds; 0 means "do not buffer this"
 *   axis    contribution to a virtual analog vector when driven from digital keys
 *   repeat  auto-repeat while held (menu navigation only)
 *   latch   documentation only: a Config key that some *consumer* may use to turn this hold into
 *           a toggle. The input layer never applies it — see `Input.held()` for why.
 *
 * Buffer windows are the numbers that decide whether the game feels forgiving or deaf. A press
 * that lands during the recovery frames of another move must still be honoured, so anything with
 * a commitment phase in front of it gets a window: jump 0.20 s (12 frames), dash 0.16 s,
 * interact 0.26 s because reaching an object is a slow approach, primary 0.12 s because a fire
 * button that remembers too long feels like lag.
 */
export const ACTIONS = {
  // --- locomotion ---------------------------------------------------------
  moveForward: { en: "Move forward", ctx: PLAY, group: "move", buffer: 0, axis: { vec: "move", k: "y", s: 1 } },
  moveBack: { en: "Move back", ctx: PLAY, group: "move", buffer: 0, axis: { vec: "move", k: "y", s: -1 } },
  moveLeft: { en: "Move left", ctx: PLAY, group: "move", buffer: 0, axis: { vec: "move", k: "x", s: -1 } },
  moveRight: { en: "Move right", ctx: PLAY, group: "move", buffer: 0, axis: { vec: "move", k: "x", s: 1 } },

  jump: { en: "Jump", ctx: PLAY, group: "move", buffer: 0.2 },
  sprint: { en: "Sprint", ctx: PLAY, group: "move", buffer: 0, latch: "holdToSprint" },
  crouch: { en: "Crouch", ctx: PLAY, group: "move", buffer: 0.12 },
  dash: { en: "Dash", ctx: PLAY, group: "move", buffer: 0.16 },

  // --- world --------------------------------------------------------------
  interact: { en: "Interact", ctx: ["play"], group: "world", buffer: 0.26 },
  primary: { en: "Primary", ctx: ["play"], group: "world", buffer: 0.12, analog: true },
  secondary: { en: "Secondary", ctx: ["play"], group: "world", buffer: 0.12, analog: true },
  cyclePrev: { en: "Cycle previous", ctx: ["play"], group: "world", buffer: 0.1 },
  cycleNext: { en: "Cycle next", ctx: ["play"], group: "world", buffer: 0.1 },
  map: { en: "Star chart", ctx: PLAY, group: "world", buffer: 0 },
  menu: { en: "Menu", ctx: PLAY, group: "world", buffer: 0 },

  // --- construction -------------------------------------------------------
  buildToggle: { en: "Build mode", ctx: PLAY, group: "build", buffer: 0.14 },
  buildSlot1: { en: "Build slot 1", ctx: PLAY, group: "build", buffer: 0.1 },
  buildSlot2: { en: "Build slot 2", ctx: PLAY, group: "build", buffer: 0.1 },
  buildSlot3: { en: "Build slot 3", ctx: PLAY, group: "build", buffer: 0.1 },
  buildSlot4: { en: "Build slot 4", ctx: PLAY, group: "build", buffer: 0.1 },
  buildRotate: { en: "Rotate piece", ctx: ["build"], group: "build", buffer: 0.1 },
  buildPlace: { en: "Place piece", ctx: ["build"], group: "build", buffer: 0.12, analog: true },
  buildRemove: { en: "Remove piece", ctx: ["build"], group: "build", buffer: 0.12, analog: true },

  // --- interface ----------------------------------------------------------
  confirm: { en: "Confirm", ctx: ["menu"], group: "ui", buffer: 0.1 },
  cancel: { en: "Back", ctx: ["menu"], group: "ui", buffer: 0.1 },
  navUp: { en: "Navigate up", ctx: ["menu"], group: "ui", buffer: 0, repeat: true },
  navDown: { en: "Navigate down", ctx: ["menu"], group: "ui", buffer: 0, repeat: true },
  navLeft: { en: "Navigate left", ctx: ["menu"], group: "ui", buffer: 0, repeat: true },
  navRight: { en: "Navigate right", ctx: ["menu"], group: "ui", buffer: 0, repeat: true },
  tabPrev: { en: "Previous tab", ctx: ["menu"], group: "ui", buffer: 0 },
  tabNext: { en: "Next tab", ctx: ["menu"], group: "ui", buffer: 0 },
};

for (const [name, def] of Object.entries(ACTIONS)) {
  def.name = name;
  def.i18n = `input.action.${name}`;
}

export const ACTION_LIST = Object.keys(ACTIONS);

/** Actions that feed the virtual `move` vector when a keyboard is driving. */
export const MOVE_AXIS_ACTIONS = ACTION_LIST.filter((a) => ACTIONS[a].axis);

// ------------------------------------------------------------------ default tables

/**
 * Keyboard + mouse. Two slots per action wherever a second is genuinely useful — arrows shadow
 * WASD so a left-handed or one-handed player is never stranded, and both shifts sprint.
 */
export const DEFAULT_BINDINGS = {
  [KBM]: {
    moveForward: ["KeyW", "ArrowUp"],
    moveBack: ["KeyS", "ArrowDown"],
    moveLeft: ["KeyA", "ArrowLeft"],
    moveRight: ["KeyD", "ArrowRight"],
    jump: ["Space"],
    sprint: ["ShiftLeft", "ShiftRight"],
    crouch: ["ControlLeft", "KeyC"],
    dash: ["KeyF"],

    interact: ["KeyE"],
    primary: ["Mouse0"],
    secondary: ["Mouse2"],
    cyclePrev: ["Wheel-", "BracketLeft"],
    cycleNext: ["Wheel+", "BracketRight"],
    map: ["Tab"],
    menu: ["Escape"],

    buildToggle: ["KeyB"],
    buildSlot1: ["Digit1"],
    buildSlot2: ["Digit2"],
    buildSlot3: ["Digit3"],
    buildSlot4: ["Digit4"],
    buildRotate: ["KeyR"],
    buildPlace: ["Mouse0"],
    buildRemove: ["Mouse2", "KeyX"],

    confirm: ["Enter", "Space"],
    cancel: ["Escape", "Backspace"],
    navUp: ["ArrowUp", "KeyW"],
    navDown: ["ArrowDown", "KeyS"],
    navLeft: ["ArrowLeft", "KeyA"],
    navRight: ["ArrowRight", "KeyD"],
    tabPrev: ["KeyQ", "Wheel-"],
    tabNext: ["KeyE", "Wheel+"],
  },

  /**
   * Gamepad. The whole game is reachable here — movement and look on the sticks, every verb on a
   * button, menus on the d-pad *and* the left stick. Face buttons follow the console convention a
   * player already has in their thumbs: bottom face jumps and confirms, right face crouches and
   * backs out. Triggers carry the two contextual verbs, so the same finger places a wall in build
   * mode that fires in play mode.
   */
  [PAD]: {
    // The left stick, promoted to four directions. These are what a pad prompt for "Move" prints
    // and what lets a player rebind movement onto the d-pad; the *speed* still comes from the
    // analog axis map below, and `isStickChord` keeps the two from being summed.
    moveForward: ["Pad:LSUp"],
    moveBack: ["Pad:LSDown"],
    moveLeft: ["Pad:LSLeft"],
    moveRight: ["Pad:LSRight"],
    jump: ["Pad:A"],
    sprint: ["Pad:L3"],
    crouch: ["Pad:B"],
    dash: ["Pad:R3"],

    interact: ["Pad:X"],
    primary: ["Pad:RT"],
    secondary: ["Pad:LT"],
    cyclePrev: ["Pad:LB"],
    cycleNext: ["Pad:RB"],
    map: ["Pad:View"],
    menu: ["Pad:Menu"],

    buildToggle: ["Pad:Y"],
    buildSlot1: ["Pad:DUp"],
    buildSlot2: ["Pad:DRight"],
    buildSlot3: ["Pad:DDown"],
    buildSlot4: ["Pad:DLeft"],
    buildRotate: ["Pad:RB"],
    buildPlace: ["Pad:RT"],
    buildRemove: ["Pad:LT"],

    confirm: ["Pad:A"],
    cancel: ["Pad:B", "Pad:Menu"],
    navUp: ["Pad:DUp", "Pad:LSUp"],
    navDown: ["Pad:DDown", "Pad:LSDown"],
    navLeft: ["Pad:DLeft", "Pad:LSLeft"],
    navRight: ["Pad:DRight", "Pad:LSRight"],
    tabPrev: ["Pad:LB"],
    tabNext: ["Pad:RB"],
  },
};

/**
 * Analog sources — rebindable, exactly like the chord table.
 *
 * `move.y` inverts because the Standard Gamepad reports stick-up as −1 while the game's move
 * vector is +forward; `look.y` does not, because +y is screen-down for both. Every entry is a
 * `{ axis, invert }` pair the player can change: southpaw (swap the two sticks), a per-stick
 * vertical invert, or a pad whose manufacturer wired the right stick to axes 3/4.
 */
export const DEFAULT_AXES = {
  move: { x: { axis: PAD_AXES.LX, invert: false }, y: { axis: PAD_AXES.LY, invert: true } },
  look: { x: { axis: PAD_AXES.RX, invert: false }, y: { axis: PAD_AXES.RY, invert: false } },
};

export const AXIS_VECTORS = ["move", "look"];
export const AXIS_COMPONENTS = ["x", "y"];

const AXIS_WORDS = [
  { text: "L X", i18n: "input.axis.lx" },
  { text: "L Y", i18n: "input.axis.ly" },
  { text: "R X", i18n: "input.axis.rx" },
  { text: "R Y", i18n: "input.axis.ry" },
];

/** Printable name for a hardware axis index, for a rebinding screen. */
export function axisLabel(index) {
  return AXIS_WORDS[index] ?? { text: `Axis ${index}`, i18n: null };
}

/** Sanitizing deep copy. Anything unrecognised falls back to the factory value. */
export function cloneAxes(src = DEFAULT_AXES) {
  const out = {};
  for (const vec of AXIS_VECTORS) {
    out[vec] = {};
    for (const comp of AXIS_COMPONENTS) {
      const fallback = DEFAULT_AXES[vec][comp];
      const m = src?.[vec]?.[comp];
      const axis = Math.trunc(Number(m?.axis));
      out[vec][comp] = {
        axis: Number.isFinite(axis) && axis >= 0 && axis <= 3 ? axis : fallback.axis,
        invert: m ? !!m.invert : fallback.invert,
      };
    }
  }
  return out;
}

/** Southpaw preset: the two sticks trade jobs, inversions stay attached to their vector. */
export function swappedAxes(src = DEFAULT_AXES) {
  const out = cloneAxes(src);
  const swap = [2, 3, 0, 1];
  for (const vec of AXIS_VECTORS) {
    for (const comp of AXIS_COMPONENTS) out[vec][comp].axis = swap[out[vec][comp].axis];
  }
  return out;
}

/**
 * Feel constants.
 *
 * Deadzones are *radial with an inner and an outer band* — never per-axis. A per-axis deadzone is
 * the reason so many browser games snap to the cardinal directions: it zeroes the smaller
 * component of a shallow diagonal and the character walks due north when you asked for
 * north-north-east. Here the raw magnitude is rescaled and the direction is passed through
 * untouched, so a stick at 22.5° produces a move vector at 22.5°.
 *
 *   inner  slop the stick returns to; below this the output is exactly zero
 *   outer  deflection that counts as full; above this the output saturates at 1, so a worn
 *          stick that only reaches 0.94 can still sprint
 *   exp    response curve. Movement stays close to linear (1.25) because walking speed should be
 *          directly negotiable. Look is 1.6 — still curved, so the bottom of the stick is fine
 *          aim, but not so steep that the middle of the stick is dead.
 *
 * The look exponent is a measured number, not a taste. At 2.0 the curve read 5.1°/s at a third of
 * the stick and 27°/s at half, against a 409°/s ceiling: fine aim and a fast turn behaved like two
 * different devices with nothing usable in between, and the whole middle of the stick — where a
 * player actually tracks a moving thing — was unreachable. At 1.6 the same points are 10.1°/s and
 * 40.0°/s, and 99.6°/s at 0.7. See `lookRamp.boost` for the other half of the change.
 *
 * The inner numbers are 0.24, not the 0.12 that looks more responsive on a brand-new pad. XInput
 * ships 0.2395 on the left stick and 0.2650 on the right for a reason: a controller with a year of
 * wear rests at 0.15–0.30 off centre, and every value below the inner band is *free* travel a
 * player never notices losing. Paired with the rest capture below (which subtracts the measured
 * resting offset before the deadzone is even applied), 0.24 is generous rather than deaf.
 */
export const TUNING = {
  move: { inner: 0.24, outer: 0.94, exp: 1.25 },
  look: { inner: 0.24, outer: 0.92, exp: 1.6 },

  /** Trigger press/release thresholds. The gap is hysteresis — without it a resting finger chatters. */
  trigger: { press: 0.35, release: 0.28 },
  /** Stick-as-button thresholds for menu navigation. */
  stickButton: { press: 0.55, release: 0.4 },

  /** Radians per second of yaw at full stick deflection, sensitivity 1. 3.25 rad/s ≈ 186°/s. */
  lookRate: 3.25,
  /** Pitch is deliberately slower than yaw; a 1:1 pitch feels twitchy on a pad. */
  lookPitchScale: 0.78,
  /**
   * Turn acceleration. Hold the stick past `threshold` and the rate ramps to `boost`× over
   * `seconds`, then falls away four times faster when you ease off. This is the difference
   * between a pad that can spin to face a threat and a pad that feels like it is in treacle,
   * and the ramp is what keeps small corrections precise despite the high top speed.
   *
   * `boost` is 1.7, not the 2.2 it started at. 2.2 put the ceiling at 409°/s — faster than BotW
   * (~180°/s) and than Fortnite's default, on a game that is mostly exploration. 1.7 gives
   * 186°/s standing and 317°/s once the ramp is in, which is a 180° spin in about 0.57 s: still a
   * genuine snap-round, with a top-to-bottom dynamic range of 31× instead of 82×.
   *
   * `threshold` is read against the *post-curve* magnitude, so with `look.exp` at 1.6 the ramp
   * arms at a physical deflection of 0.877 — you have to mean it.
   */
  lookRamp: { threshold: 0.9, seconds: 0.45, boost: 1.7, decay: 4 },

  /** Mouse look is displacement, never rate: radians per pixel of raw movement at sensitivity 1. */
  mouse: { radiansPerPixel: 0.0022, deviceSwitchPixels: 8 },

  /** Default press-buffer window when an action does not name its own. */
  bufferDefault: 0.18,
  /** Menu auto-repeat: a beat before it starts, then ~9 steps a second. */
  navRepeat: { delay: 0.42, rate: 0.11 },

  /**
   * Rest capture. A pad that has been *perfectly* still — every axis inside ±`epsilon` and no
   * button edge — for `settleSeconds` has its axis values recorded as the new electrical zero and
   * subtracted from every later reading. `maxOffset` is the safety rail: an offset larger than
   * this is a stick somebody is holding, not a stick at rest, and is never captured.
   *
   * `epsilon = 0.02` is the discriminator that makes this safe. A resting stick is dead still to
   * three decimal places; a thumb deliberately holding a gentle 0.3 push wanders by an order of
   * magnitude more than that over a second and a half, so the window never completes and the push
   * is never mistaken for zero.
   *
   * `maxOffset = 0.18` sits deliberately *below* the 0.24 inner band. That is the invariant worth
   * stating: a captured zero can only ever swallow a deflection the deadzone was going to swallow
   * anyway, so no push the player can feel in the avatar can be re-defined as centre. At the old
   * 0.35 a dead-still 0.32 hold — a deliberate slow walk, held by a steady thumb — had its output
   * silently zeroed after about two seconds and the walk died under the thumb. The rail exists to
   * catch a stick somebody is holding; it has to be tighter than the smallest hold that does
   * anything.
   *
   * The cost, stated plainly: drift *above* 0.18 is no longer captured automatically. Between 0.18
   * and 0.24 that is free — the inner band already eats it — so the real exposure is a stick
   * resting past 0.24, which is worse than the 0.2395/0.2650 XInput assumes and is a controller
   * with a fault rather than a controller with wear. That case is served by the explicit
   * `Input.recalibrate()` (a settings-screen button, and `__vsInput.recalibrate()` for review),
   * because silently redefining a third of a stick's travel on a guess is the more expensive
   * mistake: it is invisible, it survives into the next session, and it can only be undone by the
   * same button.
   *
   * The *first* capture for a pad uses the shorter `firstSeconds`, because until it happens the
   * drift is live and the avatar is creeping. A pad discovered at rest is zeroed a third of a
   * second in (≈0.09 m of creep instead of ≈0.39 m); every capture after that takes the full
   * 1.5 s, which is the window that has to be conservative because the player is now playing.
   */
  padRest: { settleSeconds: 1.5, firstSeconds: 0.35, maxOffset: 0.18, epsilon: 0.02 },

  /**
   * Which device the prompt glyphs show. Level tests are wrong here: a pad lying on the desk with
   * a worn stick sits at 0.30 forever, and a level test would flip the glyphs on every poll while
   * the player types. The pad may only claim the prompts on a genuine *change* — a button edge, or
   * an axis that moved more than `padWakeAxisDelta` from where it was when the pad last had them —
   * and no device may take them back inside `deviceDwell` seconds of the last switch.
   *
   * `deviceDwell` is a *delay*, never a veto: a claim the dwell turns away is parked and applied
   * the instant the dwell expires (`Input._settleDevice`). That distinction is the whole ball
   * game. Dropping refused claims made the arbitration one-directional, because the two devices
   * do not ask at the same rate — the pad re-asks 250 times a second and the keyboard asks once
   * per keystroke — so the pad won every contested moment and the glyphs stuck on a controller
   * the player had already put down.
   */
  deviceDwell: 0.35,
  padWakeAxisDelta: 0.12,

  /**
   * The pad is sampled on its own timer, not on the render frame. `navigator.getGamepads()` is a
   * level, so the only defence against a tap that begins and ends between two samples is to sample
   * far faster than a human can tap: 250 Hz bounds the blind window to 4 ms against a ~60 ms tap.
   * Until a pad has ever been seen the sweep drops to `padIdlePollMs` so the keyboard-only
   * majority pays nothing.
   */
  padPollHz: 250,
  padIdlePollMs: 200,
};

TUNING.padPollMs = 1000 / TUNING.padPollHz;

// ------------------------------------------------------------------ helpers

export function cloneBindings(src = DEFAULT_BINDINGS) {
  return {
    [KBM]: Object.fromEntries(ACTION_LIST.map((a) => [a, [...(src[KBM]?.[a] ?? [])]])),
    [PAD]: Object.fromEntries(ACTION_LIST.map((a) => [a, [...(src[PAD]?.[a] ?? [])]])),
  };
}

/** Two actions only truly collide when they are alive at the same time. */
export function contextsOverlap(a, b) {
  const ca = ACTIONS[a]?.ctx ?? [];
  const cb = ACTIONS[b]?.ctx ?? [];
  return ca.some((c) => cb.includes(c));
}

/** Reject a chord we could never receive, so a corrupt save can't poison the table. */
export function isKnownChord(chord) {
  if (typeof chord !== "string" || !chord) return false;
  if (isPadChord(chord)) {
    const part = padPart(chord);
    return part in PAD_BUTTONS || part in PAD_STICK_DIRS;
  }
  if (chord in MOUSE_WORDS) return true;
  return /^[A-Za-z][A-Za-z0-9]*$/.test(chord);
}
