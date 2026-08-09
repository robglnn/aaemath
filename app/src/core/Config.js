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
  autoTier: true,
  locale: "en",

  // Camera & control feel
  lookSensitivity: 1,
  invertY: false,
  aimAssist: true,
  fovBase: 62,

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
    if (this.values[key] === value) return;
    this.values[key] = value;
    write(this.values);
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
