/**
 * P33 — Save.
 *
 * What a browser game loses when it loses a save is not "progress". It is the *shape* of the
 * learner's week: which claims were open, how fast they were working, whether the last sitting
 * ended or merely stopped. `learn/Mastery.js` already persists the learner MODEL — every
 * posterior, every counter, the open certification event — under its own key, and this file does
 * not duplicate one byte of that. This file persists the two things the model has no opinion
 * about:
 *
 *   1. **the learner's own pace** — the calibration `Session.js` budgets a Pomodoro arc with, so
 *      the second sitting does not have to re-learn how fast this person works from scratch;
 *   2. **session history** — what happened in each of the last {@link HISTORY_CAP} sittings, so
 *      the re-entry line can say what was going on and so a break genuinely ENDS a session.
 *
 * ---------------------------------------------------------------------------------------------
 * THE `live` BLOCK, WHICH IS THE WHOLE REASON A BREAK IS NOT A LOSS
 *
 * A session that has begun writes a `live` record and updates it at every beat boundary. A
 * session that closes moves that record into `sessions` and clears `live`. So on load there are
 * exactly two possibilities and they are distinguishable:
 *
 *   - `live === null` — the last sitting ended. Start a fresh arc.
 *   - `live !== null` — the last sitting was interrupted: a closed tab, a dead battery, a bell.
 *     It is folded into history as `interrupted`, counted, and reported. It is **not** resumed as
 *     though no time had passed, because a Pomodoro arc that resumes six hours later at minute 14
 *     is not a Pomodoro arc. The learner MODEL is untouched by any of this — Mastery persisted
 *     that separately, and a half-answered retention check resumes exactly as P16 designed it to.
 *
 * That asymmetry is the point. **The work survives; the sitting does not.**
 *
 * ---------------------------------------------------------------------------------------------
 * HONESTY ABOUT A BAD SAVE
 *
 * Three failures are told apart rather than collapsed into "no save":
 *
 *   - `absent` — nothing stored. Normal on a first run, and it is not a fault.
 *   - `corrupt-json` / `not-an-object` / `wrong-version:N` — something is there and it cannot be
 *     read. The raw text is QUARANTINED under `<key>.corrupt` before anything overwrites it, the
 *     fault is `warn()`ed and published on the probe, and a fresh save is started. Silently
 *     resetting to defaults is how a support conversation becomes unanswerable.
 *   - `repaired` — the blob parsed and the right version, but a field had the wrong type. The
 *     field is replaced with its default and **named** in `repaired[]`. Partial damage does not
 *     cost the learner the rest of the file.
 *
 * `storage-unavailable` / `storage-denied` are their own answer: private browsing and locked-down
 * school Chromebooks both do this, and neither is a gameplay failure. Everything still runs; it
 * just runs without memory, and says so.
 */

export const SAVE_KEY = "vs.flow.save.v1";
export const SAVE_VERSION = 1;

/** How many closed sittings are kept. Enough to draw a week; small enough to stay a few kB. */
export const HISTORY_CAP = 40;

/** Cap on the quarantined blob, so a corrupt megabyte cannot wedge the next write on quota. */
const QUARANTINE_CHARS = 20000;

/**
 * `localStorage` if it is genuinely usable, else null. Reading the global is not enough: Safari's
 * private mode hands back an object whose `setItem` throws, and a school-managed profile can deny
 * it outright.
 */
export function safeStorage() {
  try {
    if (typeof localStorage === "undefined") return null;
    const probe = "vs.flow.probe";
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

/** The pace calibration a first-run learner starts from: the design's own per-item seconds. */
export function freshPace() {
  return {
    /** Observed seconds per item ÷ `phases.secondsPerItemByPhase` for that item. 1.0 = on design. */
    ratio: 1,
    /** EWMA standard deviation of that ratio. Feeds the ceiling estimate, never the plan. */
    spread: 0,
    /**
     * An OBSERVED upper quantile (p95) of that ratio, tracked online by `Session._calibrateTail`.
     * A variance cannot see a heavy tail — a rare four-minute stare barely moves an EWMA — and the
     * reservation that decides whether a four-item retention check fits inside twenty-five minutes
     * is exactly a question about the tail. 2 is the first-run default: a learner nobody has
     * measured yet is assumed capable of taking twice the design's seconds on one item, which is
     * an honest thing to assume and a cheap one to be wrong about.
     */
    slowRatio: 2,
    /** Seconds between one item being answered and the next being served: travel, feedback, world. */
    gapSeconds: 4,
    /** How many items the numbers above are made of. 0 means "these are the design's, not yours". */
    samples: 0,
  };
}

export function freshSave() {
  return {
    version: SAVE_VERSION,
    createdAt: null,
    updatedAt: null,
    pace: freshPace(),
    /** Closed sittings, oldest first, capped at {@link HISTORY_CAP}. */
    sessions: [],
    /** The sitting currently under way, or null. See the header. */
    live: null,
    counters: { opened: 0, closed: 0, interrupted: 0 },
  };
}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const num = (v, fallback) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

export class Save {
  /**
   * @param {object} [opts]
   * @param {Storage|null} [opts.storage] injectable; defaults to `localStorage` when usable.
   * @param {string} [opts.key]
   * @param {() => number} [opts.now] wall clock in **milliseconds**.
   * @param {(msg: string) => void} [opts.onWarn] where a fault is announced. Defaults to silence
   *        so a Node simulation does not spray the console; boot passes `Introspect.warn`.
   */
  constructor(opts = {}) {
    this.key = opts.key ?? SAVE_KEY;
    this.storage = opts.storage === undefined ? safeStorage() : opts.storage;
    this.now = opts.now ?? (() => Date.now());
    this.onWarn = opts.onWarn ?? (() => {});

    this.state = freshSave();
    /** null when the file was read cleanly. See the header for the vocabulary. */
    this.fault = null;
    /** Field names that were the wrong type and were replaced with their default. */
    this.repaired = [];
    /** Set when a corrupt blob was moved aside rather than overwritten. */
    this.quarantined = null;
    /** The interrupted sitting found on load, if any — what the re-entry line has to work with. */
    this.interrupted = null;
    this.loaded = false;
    this.writes = 0;
    this.writeFailures = 0;
  }

  // ------------------------------------------------------------------------ read

  /**
   * Read the file. Always leaves `this.state` usable — the question a caller asks afterwards is
   * `this.fault`, not whether it worked.
   */
  load() {
    this.repaired = [];
    this.quarantined = null;
    this.interrupted = null;
    this.loaded = true;

    if (!this.storage) {
      this.fault = "storage-unavailable";
      this.state = freshSave();
      this.onWarn("flow/save: no usable storage — this sitting will not be remembered");
      return this.result();
    }

    let raw = null;
    try {
      raw = this.storage.getItem(this.key);
    } catch {
      this.fault = "storage-denied";
      this.state = freshSave();
      this.onWarn("flow/save: storage refused a read — this sitting will not be remembered");
      return this.result();
    }

    if (raw == null) {
      this.fault = "absent";
      this.state = freshSave();
      return this.result();
    }

    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return this._reject(raw, "corrupt-json");
    }
    if (!isObject(parsed)) return this._reject(raw, "not-an-object");
    if (parsed.version !== SAVE_VERSION) return this._reject(raw, `wrong-version:${JSON.stringify(parsed.version)}`);

    this.state = this._repair(parsed);
    this.fault = this.repaired.length ? "repaired" : null;
    if (this.repaired.length)
      this.onWarn(`flow/save: ${this.repaired.length} field(s) were the wrong type and were reset: ${this.repaired.join(", ")}`);

    // A sitting that was never closed. Fold it into history as what it was, and count it.
    if (this.state.live) {
      const rec = { ...this.state.live, closeReason: "interrupted", closedAt: this.state.live.closedAt ?? this.state.updatedAt };
      this.interrupted = rec;
      this.state.sessions.push(rec);
      while (this.state.sessions.length > HISTORY_CAP) this.state.sessions.shift();
      this.state.live = null;
      this.state.counters.interrupted += 1;
      this.write();
    }

    return this.result();
  }

  _reject(raw, fault) {
    this.fault = fault;
    this._quarantine(raw, fault);
    this.state = freshSave();
    this.onWarn(
      `flow/save: the stored save could not be read (${fault}). The original is kept at "${this.key}.corrupt"; ` +
        `a fresh one has been started. The learner model is stored separately and is untouched.`
    );
    return this.result();
  }

  _quarantine(raw, reason) {
    if (!this.storage) return;
    try {
      this.storage.setItem(
        `${this.key}.corrupt`,
        JSON.stringify({ at: this.now(), reason, raw: String(raw).slice(0, QUARANTINE_CHARS) })
      );
      this.quarantined = reason;
    } catch {
      // Quota or a denied write. The fault is still reported; we simply could not keep the body.
      this.quarantined = null;
    }
  }

  /**
   * Copy field by field with a type check. Anything **present and wrong** is named in `repaired[]`
   * and replaced with its default; anything **absent** is simply defaulted and is not damage. That
   * distinction is not pedantry — a save written by an older build legitimately has fewer fields,
   * and reporting those as corruption would train whoever reads the probe to ignore it.
   */
  _repair(raw) {
    const out = freshSave();
    const bad = (field) => this.repaired.push(field);
    /** present-and-wrong -> named and defaulted; absent -> defaulted quietly. */
    const field = (name, value, ok, dflt) => {
      if (value === undefined) return dflt;
      if (ok(value)) return value;
      bad(name);
      return dflt;
    };

    out.createdAt = num(raw.createdAt, null);
    out.updatedAt = num(raw.updatedAt, null);

    if (isObject(raw.pace)) {
      const p = raw.pace;
      const d = freshPace();
      const finite = (v) => typeof v === "number" && Number.isFinite(v);
      // A ratio outside this range is not a fast learner, it is a corrupted number. The range is
      // deliberately generous: 0.1 is four seconds on a 46-second item and 6 is four and a half
      // minutes, and a human being can honestly be at either end.
      out.pace.ratio = field("pace.ratio", p.ratio, (v) => finite(v) && v >= 0.1 && v <= 6, d.ratio);
      out.pace.spread = field("pace.spread", p.spread, (v) => finite(v) && v >= 0 && v <= 6, d.spread);
      // Absent is an older build and is defaulted quietly; present-and-wrong is damage and is named.
      out.pace.slowRatio = field("pace.slowRatio", p.slowRatio, (v) => finite(v) && v >= 0.1 && v <= 12, d.slowRatio);
      out.pace.gapSeconds = field("pace.gapSeconds", p.gapSeconds, (v) => finite(v) && v >= 0 && v <= 120, d.gapSeconds);
      out.pace.samples = Math.floor(field("pace.samples", p.samples, (v) => finite(v) && v >= 0, d.samples));
    } else if (raw.pace !== undefined) bad("pace");

    if (Array.isArray(raw.sessions)) {
      out.sessions = raw.sessions.filter(isObject).slice(-HISTORY_CAP);
      if (out.sessions.length !== Math.min(raw.sessions.length, HISTORY_CAP)) bad("sessions[]");
    } else if (raw.sessions !== undefined) bad("sessions");

    if (isObject(raw.live)) out.live = raw.live;
    else if (raw.live !== undefined && raw.live !== null) bad("live");

    if (isObject(raw.counters)) {
      for (const k of ["opened", "closed", "interrupted"]) {
        out.counters[k] = Math.floor(
          field(`counters.${k}`, raw.counters[k], (v) => typeof v === "number" && Number.isFinite(v) && v >= 0, 0)
        );
      }
    } else if (raw.counters !== undefined) bad("counters");

    return out;
  }

  // ----------------------------------------------------------------------- write

  write() {
    if (!this.storage) return false;
    this.state.updatedAt = this.now();
    if (this.state.createdAt == null) this.state.createdAt = this.state.updatedAt;
    try {
      this.storage.setItem(this.key, JSON.stringify(this.state));
      this.writes += 1;
      return true;
    } catch {
      // Quota, or a profile that denied us between load and now. Report it once per run rather
      // than every beat: a wall of identical warnings buries the one that matters.
      this.writeFailures += 1;
      if (this.writeFailures === 1) {
        this.fault = this.fault ?? "write-failed";
        this.onWarn("flow/save: storage refused a write — this sitting will not be remembered");
      }
      return false;
    }
  }

  // -------------------------------------------------------------------- sessions

  /** Begin a sitting. The record is live from here until `closeSession` moves it into history. */
  openSession(record) {
    this.state.live = { ...record, openedAt: record.openedAt ?? this.now() };
    this.state.counters.opened += 1;
    this.write();
    return this.state.live;
  }

  /** Update the live record. Called at every beat boundary, so a crash loses at most one beat. */
  checkpoint(patch) {
    if (!this.state.live) return null;
    this.state.live = { ...this.state.live, ...patch };
    this.write();
    return this.state.live;
  }

  closeSession(record) {
    const closed = { ...(this.state.live ?? {}), ...record, closedAt: record.closedAt ?? this.now() };
    this.state.live = null;
    this.state.sessions.push(closed);
    while (this.state.sessions.length > HISTORY_CAP) this.state.sessions.shift();
    this.state.counters.closed += 1;
    this.write();
    return closed;
  }

  /** The pace calibration the next sitting starts from. */
  savePace(pace) {
    this.state.pace = { ...freshPace(), ...pace };
    this.write();
    return this.state.pace;
  }

  get pace() {
    return this.state.pace;
  }

  /** The most recent CLOSED sitting — what the re-entry line describes. */
  lastSession() {
    return this.state.sessions.length ? this.state.sessions[this.state.sessions.length - 1] : null;
  }

  clear() {
    this.state = freshSave();
    try {
      this.storage?.removeItem(this.key);
    } catch {
      /* denied storage is not a gameplay failure */
    }
    return true;
  }

  // -------------------------------------------------------------------- reporting

  result() {
    return {
      fault: this.fault,
      repaired: [...this.repaired],
      quarantined: this.quarantined,
      interrupted: this.interrupted,
      sessions: this.state.sessions.length,
      pace: { ...this.state.pace },
    };
  }

  probe() {
    return {
      key: this.key,
      storage: this.storage ? "available" : "unavailable",
      loaded: this.loaded,
      fault: this.fault,
      repaired: [...this.repaired],
      quarantined: this.quarantined,
      sessions: this.state.sessions.length,
      counters: { ...this.state.counters },
      writes: this.writes,
      writeFailures: this.writeFailures,
      pace: { ...this.state.pace },
      lastCloseReason: this.lastSession()?.closeReason ?? null,
    };
  }
}
