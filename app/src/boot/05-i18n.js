import { publish, warn } from "../core/Introspect.js";
import { config } from "../core/Config.js";
import { signals } from "../core/Signals.js";
import { setLocale, i18n } from "../i18n/index.js";
import { mountLocaleProof } from "../i18n/LocaleProof.js";

/**
 * P20 — strings. Order 05, ahead of everything, because every other boot module is allowed to
 * assume `t()` works by the time it runs.
 *
 * Loading is awaited here rather than kicked off and hoped for: a system that mounts at order 20
 * and reads a string must not race a fetch. Three locales at a few tens of kilobytes each is a
 * cost worth paying once at boot to make `t()` synchronous everywhere else.
 */
export default {
  id: "i18n",
  order: 5,
  async setup(kernel) {
    const requested = config.get("locale") ?? "en";
    const strings = await setLocale(requested);

    // Rendering every string once at boot is what turns "no missing keys" from a claim about a
    // screen somebody opened into a claim about the whole bundle.
    const rendered = strings.selfTest();

    document.documentElement.lang = strings.locale;
    signals.emit("ui:locale", { locale: strings.locale });

    const faults = strings.missing();
    if (faults.length) {
      // A warning, not an error: `verify` fails on the probe, and a console error here would
      // make every other piece's capture unreviewable for a fault that is ours.
      warn(`i18n: ${faults.length} missing string(s) in "${strings.locale}": ${faults.slice(0, 8).join(", ")}`);
    }

    // Off unless asked for. `review/measure/P20.mjs` asks; nothing a player runs does.
    const proof = new URLSearchParams(location.search).get("i18nproof") === "1"
      ? mountLocaleProof(strings)
      : null;

    kernel.mount("i18n", {
      dispose() {
        proof?.root.remove();
      },
    });

    publish("i18n", () => {
      const live = i18n();
      return {
        ...live.report(),
        rendered,
        // The proof surface's pixel measurements, when it is mounted.
        layout: proof ? proof.measure() : null,
      };
    });
  },
};
