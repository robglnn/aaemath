import { I18n, LOCALES, REFERENCE_LOCALE } from "./I18n.js";

/**
 * The one live I18n instance, plus the free functions every other piece should import.
 *
 * Feature modules import `t`, `n`, `tex` from here and nothing else. Locale switching at
 * runtime replaces the instance and re-emits `ui:locale`, so a HUD that re-reads its strings on
 * that signal follows a language change without knowing anything about how loading works.
 */

/** @type {I18n|null} */
let active = null;

export async function setLocale(locale) {
  active = await I18n.load(locale);
  active.selfTest();
  return active;
}

export function i18n() {
  if (!active) throw new Error("i18n used before boot/05-i18n.js ran — check the boot order table");
  return active;
}

/** True once a bundle is loaded. Lets a system degrade instead of throwing if it boots early. */
export function ready() {
  return active !== null;
}

/** A localized string. `params` values that are numbers are formatted in the locale's convention. */
export const t = (key, params) => i18n().t(key, params);

/** A locale-formatted number for plain text (HUD, prompt, bark). */
export const n = (value, opts) => i18n().n(value, opts);

/** A locale-formatted number as a KaTeX-safe token. Never put `n()` output into TeX. */
export const tex = (value, opts) => i18n().tex(value, opts);

export const percent = (value, opts) => i18n().percent(value, opts);
export const list = (items) => i18n().list(items);
export const plural = (count) => i18n().plural(count);
export const locale = () => i18n().locale;

export { I18n, LOCALES, REFERENCE_LOCALE };
