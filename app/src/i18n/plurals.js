/**
 * Plural rules — CLDR, hand-written, three languages.
 *
 * Written out rather than delegated to `Intl.PluralRules` on purpose. This project's whole
 * review contract is that a claim about the game is reproducible: `Intl` output is supplied by
 * whatever ICU the host browser happens to carry, so a rule that passes on the reviewer's
 * Chromium can quietly differ on a player's. These functions are pure, deterministic and
 * measurable offline by `review/measure/P20.mjs`, which is what makes the Polish claim below
 * an assertion instead of a hope.
 *
 * The categories are CLDR's, and the interesting one is Polish, which genuinely has four:
 *
 *   one   1                                     1 liść
 *   few   2–4, 22–24, 32–34 …                   2 liście
 *   many  0, 5–21, 25–31 …                      5 liści
 *   other any value with a visible fraction     1,5 liścia
 *
 * `many` is not "a lot" — it is the genitive-plural slot, and it swallows 0, every teen, and
 * every number ending in 1 that is not 1 itself (21 liści, never *21 liść). `other` is the
 * fraction slot and is the one implementations skip; skipping it means `1,5 liścia` comes out
 * as `1,5 liść`, which is the tell that a Polish localization was done with an English plural
 * function and an if-statement.
 */

/** Every category name CLDR can emit. Used to tell a plural bundle from a branch of the tree. */
export const PLURAL_KEYS = ["zero", "one", "two", "few", "many", "other"];

/**
 * The categories a bundle in this language MUST supply. A locale file missing one of these for
 * a plural string is a missing key, reported by the probe and failed by `review.mjs verify`.
 */
export const REQUIRED_CATEGORIES = {
  en: ["one", "other"],
  es: ["one", "other"],
  pl: ["one", "few", "many", "other"],
};

/** Split a number the way CLDR does: integer part, count of visible decimals, fraction digits. */
function operands(value) {
  const n = Math.abs(Number(value));
  if (!Number.isFinite(n)) return { n: 0, i: 0, v: 0, f: 0 };
  // `v` is the number of *visible* fraction digits. We take it from the shortest round-trip
  // decimal form, which is what a formatter would actually print.
  const text = String(n);
  const dot = text.indexOf(".");
  const v = dot === -1 ? 0 : text.length - dot - 1;
  const f = dot === -1 ? 0 : Number(text.slice(dot + 1));
  return { n, i: Math.floor(n), v, f };
}

const RULES = {
  // CLDR en: one -> i = 1 and v = 0.
  en(value) {
    const { i, v } = operands(value);
    return i === 1 && v === 0 ? "one" : "other";
  },

  // CLDR es: one -> n = 1. (`many` exists only for compact millions and never for the integer
  // counts this product displays, so `one`/`other` is the complete set here — see
  // REQUIRED_CATEGORIES, which is what the audit enforces.)
  es(value) {
    const { n } = operands(value);
    return n === 1 ? "one" : "other";
  },

  // CLDR pl, in full.
  pl(value) {
    const { i, v } = operands(value);
    if (v !== 0) return "other"; // 1,5 liścia — the slot everybody forgets
    if (i === 1) return "one";
    const i10 = i % 10;
    const i100 = i % 100;
    if (i10 >= 2 && i10 <= 4 && !(i100 >= 12 && i100 <= 14)) return "few";
    return "many"; // 0, 5–9, every teen, and every other …1 (11, 21, 101)
  },
};

/** Which plural form a language wants for this count. Unknown languages behave like English. */
export function pluralCategory(locale, value) {
  return (RULES[locale] ?? RULES.en)(value);
}

/**
 * True when this object is a plural bundle rather than a branch of the key tree.
 *
 * All three conditions are load-bearing, and the third was found by the build gate rather than
 * reasoned out: `amb.stray.other.01` nests an `other` under `amb.stray`, so "every key is a
 * plural category" alone reads a perfectly ordinary branch as a plural bundle and then reports
 * the language's other categories as missing. A plural bundle's forms are always strings.
 */
export function isPluralBundle(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.length === 0 || !keys.includes("other")) return false;
  return keys.every((k) => PLURAL_KEYS.includes(k) && typeof value[k] === "string");
}
