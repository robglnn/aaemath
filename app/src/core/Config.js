/**
 * Config — persisted player preferences plus the quality ladder every visual system
 * reads from. One place to turn the whole renderer up or down.
 */
const STORE_KEY = "variable-star/config/1";

export const TIERS = {
  potato: {
    id: "potato",
    maxPixelRatio: 1,
    shadows: false,
    shadowResolution: 1024,
    shadowCascades: 1,
    postStack: ["tonemap"],
    bloom: false,
    volumetrics: false,
    reflections: false,
    grassDensity: 0,
    particleBudget: 200,
    drawDistance: 380,
  },
  low: {
    id: "low",
    maxPixelRatio: 1,
    shadows: true,
    shadowResolution: 1024,
    shadowCascades: 1,
    postStack: ["tonemap"],
    bloom: false,
    volumetrics: false,
    reflections: false,
    grassDensity: 0.25,
    particleBudget: 600,
    drawDistance: 550,
  },
  medium: {
    id: "medium",
    maxPixelRatio: 1.25,
    shadows: true,
    shadowResolution: 2048,
    shadowCascades: 2,
    postStack: ["bloom", "tonemap", "vignette"],
    bloom: true,
    volumetrics: false,
    reflections: false,
    grassDensity: 0.6,
    particleBudget: 1400,
    drawDistance: 800,
  },
  high: {
    id: "high",
    maxPixelRatio: 1.5,
    shadows: true,
    shadowResolution: 3072,
    shadowCascades: 3,
    postStack: ["bloom", "godrays", "tonemap", "grain", "vignette"],
    bloom: true,
    volumetrics: true,
    reflections: true,
    grassDensity: 1,
    particleBudget: 3000,
    drawDistance: 1400,
  },
  ultra: {
    id: "ultra",
    maxPixelRatio: 2,
    shadows: true,
    shadowResolution: 4096,
    shadowCascades: 4,
    postStack: ["bloom", "godrays", "tonemap", "grain", "vignette", "ca"],
    bloom: true,
    volumetrics: true,
    reflections: true,
    grassDensity: 1.35,
    particleBudget: 6000,
    drawDistance: 2000,
  },
};

export const TIER_ORDER = ["potato", "low", "medium", "high", "ultra"];

const DEFAULTS = {
  tier: "high",
  // The switch `core/AutoTier.js` reads, on **every frame** — not once at boot. True: the tier
  // above is a *ceiling*, not a starting point. A first-frame hardware heuristic starts at `medium`
  // unless the renderer string names a discrete GPU, and sustained frame-cost measurement corrects
  // it from there. False: the player has chosen, and nothing may move the picture under them.
  // `set("tier", …)` and `?tier=` both flip it to false; `applyTier()` deliberately does not.
  autoTier: true,
  locale: "en",

  // Camera & control feel
  lookSensitivity: 1,
  lookSensitivityMouse: 1,
  lookSensitivityPad: 1,
  invertX: false,
  invertY: false,
  aimAssist: true,
  fovBase: 62,

  // Controller. Declared here rather than left to a fallback inside the input module so a
  // settings screen has a discoverable contract to build sliders against and `reset()` restores
  // them. Stick bands are radial inner/outer with a response exponent; 0.24 matches the XInput
  // standard (0.2395 left / 0.2650 right) and is what a worn pad needs.
  //
  // These six are *mirrors*. The source of truth for the feel is `play/bindings.js TUNING.move`
  // and `TUNING.look`, which carry the reasoning; the values here are the factory position of the
  // sliders and must be kept equal to it, because `Input._band()` treats a Config value as the
  // player's setting and it therefore wins over the module constant.
  rumble: true,
  swapSticks: false,
  stickMoveInner: 0.24,
  stickMoveOuter: 0.94,
  stickMoveExp: 1.25,
  stickLookInner: 0.24,
  stickLookOuter: 0.92,
  stickLookExp: 1.6,

  // Audio
  volumeMaster: 0.85,
  volumeMusic: 0.55,
  volumeSfx: 0.9,
  volumeVoice: 1,

  // Comfort / accessibility
  reduceMotion: false,
  cameraShake: 1,
  motionBlur: true,
  screenFlash: true,
  uiScale: 1,
  highContrast: false,
  readableFont: false,
  captions: true,
  colorFilter: "none",
  holdToSprint: true,
  extraTime: false,
};

export class Config {
  constructor() {
    this.values = { ...DEFAULTS, ...read() };
    // ?lang=es and ?tier=low are honoured so the review harness can pin a state.
    const q = new URLSearchParams(location.search);
    if (q.has("lang")) this.values.locale = q.get("lang");
    if (q.has("tier") && TIERS[q.get("tier")]) {
      this.values.tier = q.get("tier");
      this.values.autoTier = false;
    }
    if (q.has("reduceMotion")) this.values.reduceMotion = q.get("reduceMotion") !== "0";
  }

  get(key) {
    return this.values[key];
  }

  set(key, value) {
    /**
     * A tier arriving through the public setter is a *player* choice — a settings screen, the
     * console, a debug key. Auto-tiering stands down for good the moment one exists, and it is
     * recorded in storage so it survives the next boot. `AutoTier` never lands here: its own
     * choices go through `applyTier()` below.
     *
     * The second clause of the guard is not decoration. `applyTier()` moves `values.tier` without
     * touching `autoTier`, so by the time a player opens the settings screen the runtime tier is
     * routinely *already* the one they are about to pick. With a bare equality guard that choice
     * early-returns, `autoTier` stays true, and auto-tiering keeps moving the picture under a
     * player who just told it to stop — the setting silently does nothing precisely when the
     * player agrees with the measurement. Found by `review/measure/P35.mjs` B6.
     */
    const tierChoice = key === "tier" && !!TIERS[value];
    if (this.values[key] === value && !(tierChoice && this.values.autoTier !== false)) return;
    this.values[key] = value;
    if (tierChoice) this.values.autoTier = false;
    write(this.values);
  }

  /**
   * Apply a tier chosen by measurement rather than by the player.
   *
   * Two properties this must have, both of which `set()` would get wrong:
   *
   *  * **It does not disable auto-tiering.** Otherwise the first automatic step would be the last.
   *  * **It is not persisted.** A tier measured on one bad afternoon — a machine with a browser
   *    update downloading behind the game — must not become a permanent setting the student has no
   *    idea how to undo. Every session re-measures from the player's own stored preference.
   *
   * @returns {boolean} true when the tier actually moved
   */
  applyTier(id) {
    if (!TIERS[id] || this.values.tier === id) return false;
    this.values.tier = id;
    return true;
  }

  get tier() {
    return TIERS[this.values.tier] ?? TIERS.high;
  }

  pixelRatio() {
    return Math.min(globalThis.devicePixelRatio || 1, this.tier.maxPixelRatio);
  }

  reset() {
    this.values = { ...DEFAULTS };
    write(this.values);
  }
}

function read() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
  } catch {
    return {};
  }
}

function write(values) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(values));
  } catch {
    /* storage unavailable — preferences stay session-only */
  }
}

export const config = new Config();
