/**
 * Number, quantity and list conventions per locale — the half of localization that is not words.
 *
 * Two output channels, deliberately separate:
 *
 *   `formatNumber()`  plain text for HUD, prompts and barks.
 *   `texNumber()`     a KaTeX-safe token for the math renderer (P15) to drop into a claim.
 *
 * They cannot be the same function, and the reason is a real TeX behaviour rather than taste:
 * in math mode a bare `,` is punctuation and gets a trailing space, so `1,5` typesets as
 * "1, 5" and `16,004` as "16, 004". The idiomatic fix is to brace the comma — `1{,}5` — and to
 * set a thousands gap with a thin space `\,` instead of a character. So a Spanish or Polish
 * decimal comma reaching KaTeX unbraced is not a cosmetic issue: it is a wrong number on screen
 * in two of the three shipped locales, and it is invisible to a spell-check of the locale file.
 *
 * `Intl.NumberFormat` is not used here for the same reason `plurals.js` avoids `Intl.PluralRules`:
 * its output is ICU-version dependent (Spanish grouping in particular has changed separator
 * between ICU releases), and this project fails a piece whose numbers cannot be reproduced.
 */

/**
 * @typedef {object} Convention
 * @property {string} decimal          decimal separator in plain text
 * @property {string} group            thousands separator in plain text
 * @property {number} groupFrom        group only when the integer part has at least this many digits
 * @property {string} texDecimal       decimal separator as TeX
 * @property {string} texGroup         thousands separator as TeX
 * @property {string} minus            display minus sign
 * @property {string} percentGap       what sits between the number and the % sign
 * @property {string} listSep          separator between list items
 * @property {string} listLast         conjunction before the final item
 */

/** @type {Record<string, Convention>} */
export const CONVENTIONS = {
  en: {
    decimal: ".",
    group: ",",
    // English groups from four digits: 1,000.
    groupFrom: 4,
    texDecimal: ".",
    texGroup: "{,}",
    minus: "−",
    percentGap: "",
    listSep: ", ",
    listLast: " and ",
  },
  es: {
    decimal: ",",
    // RAE prescribes a fixed space for groups of three and explicitly rejects the comma; the
    // full stop is the old convention and is no longer recommended. A no-break space is used so
    // a number can never wrap across a group boundary.
    group: " ",
    // …and RAE writes four-digit numbers with no separator at all: 4111, not 4 111. That rule is
    // load-bearing in this product because `sign.kindness.02` paints a revision number on a board.
    groupFrom: 5,
    texDecimal: "{,}",
    texGroup: "\\,",
    minus: "−",
    percentGap: " ",
    listSep: ", ",
    listLast: " y ",
  },
  pl: {
    decimal: ",",
    // Polish typographic practice matches: space-grouped, four digits unbroken.
    group: " ",
    groupFrom: 5,
    texDecimal: "{,}",
    texGroup: "\\,",
    minus: "−",
    percentGap: " ",
    listSep: ", ",
    listLast: " i ",
  },
};

export const REFERENCE_LOCALE = "en";

function conv(locale) {
  return CONVENTIONS[locale] ?? CONVENTIONS[REFERENCE_LOCALE];
}

function groupDigits(intDigits, c) {
  if (intDigits.length < c.groupFrom) return intDigits;
  let out = "";
  for (let i = 0; i < intDigits.length; i++) {
    if (i > 0 && (intDigits.length - i) % 3 === 0) out += c.group;
    out += intDigits[i];
  }
  return out;
}

/**
 * Plain-text number in the locale's convention.
 *
 * @param {number} value
 * @param {string} locale
 * @param {{decimals?: number, group?: boolean}} [opts]
 *        `decimals` fixes the fraction length; omit it to print the value's own shortest form.
 */
export function formatNumber(value, locale, opts = {}) {
  const c = conv(locale);
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);

  const negative = num < 0 || Object.is(num, -0);
  const abs = Math.abs(num);
  const text = opts.decimals === undefined ? String(abs) : abs.toFixed(opts.decimals);

  // Exponential shorthand would leak an "e" into a HUD; expand it before splitting.
  const plain = text.includes("e") ? abs.toFixed(Math.max(0, opts.decimals ?? 6)) : text;
  const [intPart, fracPart = ""] = plain.split(".");

  const grouped = opts.group === false ? intPart : groupDigits(intPart, c);
  const body = fracPart ? grouped + c.decimal + fracPart : grouped;
  return negative ? c.minus + body : body;
}

/**
 * The same number as a KaTeX-safe token. Never interpolate a `formatNumber()` result into TeX.
 *
 * @param {number} value
 * @param {string} locale
 * @param {{decimals?: number, group?: boolean}} [opts]
 */
export function texNumber(value, locale, opts = {}) {
  const c = conv(locale);
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);

  const negative = num < 0 || Object.is(num, -0);
  const abs = Math.abs(num);
  const text = opts.decimals === undefined ? String(abs) : abs.toFixed(opts.decimals);
  const plain = text.includes("e") ? abs.toFixed(Math.max(0, opts.decimals ?? 6)) : text;
  const [intPart, fracPart = ""] = plain.split(".");

  const grouped =
    opts.group === false
      ? intPart
      : intPart.length < c.groupFrom
        ? intPart
        : (() => {
            let out = "";
            for (let i = 0; i < intPart.length; i++) {
              if (i > 0 && (intPart.length - i) % 3 === 0) out += c.texGroup;
              out += intPart[i];
            }
            return out;
          })();

  const body = fracPart ? grouped + c.texDecimal + fracPart : grouped;
  // In math mode `-` is already the minus glyph; U+2212 would be an unnecessary unicode token.
  return negative ? "-" + body : body;
}

/** A percentage, with the gap the locale wants before the sign (ES and PL want one; EN does not). */
export function formatPercent(value, locale, opts = {}) {
  return formatNumber(value, locale, opts) + conv(locale).percentGap + "%";
}

/**
 * A human list. Spanish is the one that needs a rule rather than a constant: `y` becomes `e`
 * before a word that *sounds* like it starts with "i", which is a spelling rule about the next
 * word and not about the list — "certezas e hilos", never "certezas y hilos".
 */
export function formatList(items, locale) {
  const c = conv(locale);
  const list = items.map((s) => String(s)).filter(Boolean);
  if (list.length === 0) return "";
  if (list.length === 1) return list[0];
  const head = list.slice(0, -1);
  const tail = list[list.length - 1];
  let last = c.listLast;
  if (locale === "es" && /^(i(?!e)|hi(?!e))/i.test(tail)) last = " e ";
  return head.join(c.listSep) + last + tail;
}

/** The convention table, for the probe and for the math renderer to read. */
export function conventions(locale) {
  return { ...conv(locale) };
}
