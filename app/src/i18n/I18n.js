import { PLURAL_KEYS, REQUIRED_CATEGORIES, isPluralBundle, pluralCategory } from "./plurals.js";
import { CONVENTIONS, conventions, formatList, formatNumber, formatPercent, texNumber } from "./numbers.js";

/**
 * I18n — the string runtime.
 *
 * Three things it does that a `t(key)` lookup does not:
 *
 * 1. **It never falls back to English.** G3 says no English fallback may be visible in ES or PL,
 *    and the usual "fall back to the reference locale" design is precisely the mechanism that
 *    puts English on a Polish player's screen and then hides the fact from every automated
 *    check. A key this locale does not have renders as `‹key›` — loud on screen, recorded in
 *    the probe, and fatal to `review.mjs verify`. A sentinel can therefore never ship, because
 *    the build gate that would have to pass is the one it breaks.
 *
 * 2. **It audits the whole bundle at load, not one key at a time.** A missing-key tracker that
 *    only records keys somebody happened to ask for reports zero on a screen nobody opened.
 *    So the reference bundle is always loaded alongside the active one and the two are compared
 *    key by key: shape, plural categories, and interpolation placeholders. That is what makes
 *    the probe's `missing: []` mean something before the HUD exists.
 *
 * 3. **It formats numbers on the way through.** A number handed to `t()` as a parameter is
 *    rendered in the locale's convention, so `fail.tilt.near` with `{n: 1.5}` reads
 *    "cięższa o 1,5" in Polish without any caller knowing that Polish uses a decimal comma.
 *
 * Missing-key report format, one string per fault:
 *
 *   `some.key`               absent from this locale
 *   `some.key!shape`         string here, plural bundle there (or vice versa)
 *   `some.key!plural:few`    plural bundle missing a category this language requires
 *   `some.key!param:n`       placeholder set differs from the reference string
 *   `some.key!extra`         present in this locale and absent from the reference
 *   `some.key!render`        rendered to a sentinel or left a `{placeholder}` unfilled
 */

export const REFERENCE_LOCALE = "en";
export const LOCALES = ["en", "es", "pl"];

const LOADERS = {
  en: () => import("../../../content/locales/en.json"),
  es: () => import("../../../content/locales/es.json"),
  pl: () => import("../../../content/locales/pl.json"),
};

const PLACEHOLDER = /\{(\w+)\}/g;

/** Walk a nested bundle into `dotted.path -> leaf`, where a leaf is a string or a plural bundle. */
function flatten(node, prefix = "", out = new Map()) {
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("$")) continue; // $meta and friends are not strings
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string" || isPluralBundle(value)) out.set(path, value);
    else if (value && typeof value === "object") flatten(value, path, out);
    else out.set(path, String(value));
  }
  return out;
}

/** Every `{placeholder}` a leaf uses, across all its plural forms. */
function placeholdersOf(leaf) {
  const forms = typeof leaf === "string" ? [leaf] : Object.values(leaf);
  const set = new Set();
  for (const form of forms) for (const m of String(form).matchAll(PLACEHOLDER)) set.add(m[1]);
  return set;
}

export class I18n {
  /** @param {{locale: string, strings: Map<string, any>, reference: Map<string, any>, meta: object}} init */
  constructor({ locale, strings, reference, meta }) {
    this.locale = locale;
    this.meta = meta ?? {};
    this.conventions = conventions(locale);
    this.pluralCategories = REQUIRED_CATEGORIES[locale] ?? REQUIRED_CATEGORIES[REFERENCE_LOCALE];

    this._strings = strings;
    this._reference = reference;
    this._missing = new Set();
    this._audited = false;
  }

  /**
   * Load a locale. The reference bundle comes too, always — it is the yardstick the audit
   * measures against, and it is a few tens of kilobytes of JSON.
   */
  static async load(requested) {
    const locale = LOCALES.includes(requested) ? requested : REFERENCE_LOCALE;
    const refMod = await LOADERS[REFERENCE_LOCALE]();
    const refRaw = refMod.default ?? refMod;
    const mod = locale === REFERENCE_LOCALE ? refMod : await LOADERS[locale]();
    const raw = mod.default ?? mod;

    const i18n = new I18n({
      locale,
      strings: flatten(raw),
      reference: flatten(refRaw),
      meta: raw.$meta ?? {},
    });
    i18n.requested = requested;
    i18n.audit();
    return i18n;
  }

  // ---------------------------------------------------------------- lookup

  has(key) {
    return this._strings.has(key);
  }

  /** Every `[key, leaf]` in the active bundle. Used by the audit surfaces, never by gameplay. */
  entries() {
    return [...this._strings.entries()];
  }

  /** The longest rendered string under a key prefix — i.e. the worst case for a layout. */
  longest(prefix) {
    let best = null;
    for (const [key, leaf] of this._strings) {
      if (!key.startsWith(prefix)) continue;
      const text = typeof leaf === "string" ? leaf : (leaf.many ?? leaf.other);
      const rendered = String(text).replace(PLACEHOLDER, "8");
      if (!best || rendered.length > best.text.length) best = { key, text: rendered };
    }
    return best;
  }

  /**
   * A localized string.
   *
   * @param {string} key    dotted path, e.g. `fail.tilt.near`
   * @param {object} [params] values for `{placeholders}`; numbers are locale-formatted
   */
  t(key, params) {
    const leaf = this._strings.get(key);
    if (leaf === undefined) {
      this._missing.add(key);
      return `‹${key}›`;
    }

    let text = leaf;
    if (typeof leaf !== "string") {
      const count = params?.n ?? params?.count ?? 0;
      const category = pluralCategory(this.locale, count);
      text = leaf[category] ?? leaf.other;
      if (text === undefined) {
        this._missing.add(`${key}!plural:${category}`);
        return `‹${key}›`;
      }
    }

    if (!params) return text;
    return String(text).replace(PLACEHOLDER, (whole, name) => {
      if (!(name in params)) return whole;
      const value = params[name];
      return typeof value === "number" ? this.n(value) : String(value);
    });
  }

  // ------------------------------------------------------------ formatting

  /** Locale-formatted number for plain text. */
  n(value, opts) {
    return formatNumber(value, this.locale, opts);
  }

  /** Locale-formatted number as a KaTeX-safe token — this is what the math renderer consumes. */
  tex(value, opts) {
    return texNumber(value, this.locale, opts);
  }

  percent(value, opts) {
    return formatPercent(value, this.locale, opts);
  }

  list(items) {
    return formatList(items, this.locale);
  }

  plural(count) {
    return pluralCategory(this.locale, count);
  }

  // ---------------------------------------------------------------- audit

  /**
   * Compare the whole active bundle against the reference. Runs once at load; everything it
   * finds is in the probe before a single frame is drawn.
   */
  audit() {
    if (this._audited) return this;
    this._audited = true;
    const required = this.pluralCategories;

    for (const [key, ref] of this._reference) {
      const mine = this._strings.get(key);
      if (mine === undefined) {
        this._missing.add(key);
        continue;
      }
      const refIsPlural = typeof ref !== "string";
      const mineIsPlural = typeof mine !== "string";
      if (refIsPlural !== mineIsPlural) {
        this._missing.add(`${key}!shape`);
        continue;
      }
      if (mineIsPlural) {
        for (const category of required) {
          if (typeof mine[category] !== "string") this._missing.add(`${key}!plural:${category}`);
        }
        for (const category of Object.keys(mine)) {
          if (!PLURAL_KEYS.includes(category)) this._missing.add(`${key}!plural:${category}`);
        }
      }
      // Placeholder parity. A translator dropping `{n}` produces a sentence that reads fine and
      // has lost the number in it — the exact class of bug a screenshot cannot catch.
      const refParams = placeholdersOf(ref);
      const myParams = placeholdersOf(mine);
      for (const name of refParams) if (!myParams.has(name)) this._missing.add(`${key}!param:${name}`);
      for (const name of myParams) if (!refParams.has(name)) this._missing.add(`${key}!param:${name}`);
    }

    for (const key of this._strings.keys()) {
      if (!this._reference.has(key)) this._missing.add(`${key}!extra`);
    }

    return this;
  }

  /**
   * Render every string in the bundle. Proves the runtime can actually produce each one — that
   * every plural category a Polish count can land on exists, and that no `{placeholder}` is left
   * standing after interpolation. Cheap enough (a few hundred templates) to run at boot.
   */
  selfTest() {
    // 0 / 1 / 2 / 5 / 11 / 21 covers Polish one, few and many including the teens and the
    // twenty-ones; 1.5 is the fraction slot that only `other` can serve.
    const counts = [0, 1, 2, 5, 11, 21, 1.5];
    let rendered = 0;
    for (const [key, leaf] of this._strings) {
      const names = placeholdersOf(leaf);
      const isPlural = typeof leaf !== "string";
      const probes = isPlural ? counts : [1];
      for (const count of probes) {
        const params = {};
        for (const name of names) params[name] = name === "n" || name === "count" ? count : "…";
        if (isPlural && !names.has("n") && !names.has("count")) params.n = count;
        const out = this.t(key, params);
        rendered++;
        // Deliberately a fresh, non-global test: a `g` regex carries `lastIndex` between calls
        // and would skip every other string in the sweep.
        if (out.startsWith("‹") || /\{\w+\}/.test(out)) this._missing.add(`${key}!render`);
      }
    }
    return rendered;
  }

  /** Sorted, de-duplicated fault list. Empty is the only passing value. */
  missing() {
    return [...this._missing].sort();
  }

  /** Everything a reviewer needs, JSON-safe and cheap. */
  report() {
    return {
      locale: this.locale,
      requested: this.requested ?? this.locale,
      reference: REFERENCE_LOCALE,
      keys: this._strings.size,
      referenceKeys: this._reference.size,
      missing: this.missing(),
      pluralCategories: this.pluralCategories,
      conventions: this.conventions,
      // Worked samples, so a critic can see the conventions rather than read about them.
      sample: {
        number: this.n(16004),
        decimal: this.n(1.5),
        negative: this.n(-2.25),
        percent: this.percent(80),
        tex: this.tex(16004.5),
        plural: {
          1: this.t("ui.count.leaves", { n: 1 }),
          2: this.t("ui.count.leaves", { n: 2 }),
          5: this.t("ui.count.leaves", { n: 5 }),
          22: this.t("ui.count.leaves", { n: 22 }),
          "1.5": this.t("ui.count.leaves", { n: 1.5 }),
        },
      },
    };
  }
}

export { CONVENTIONS, PLURAL_KEYS, REQUIRED_CATEGORIES, pluralCategory, isPluralBundle };
