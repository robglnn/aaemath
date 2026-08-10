import { publish } from "../core/Introspect.js";
import { signals } from "../core/Signals.js";
import { itemBank } from "../learn/ItemBank.js";

/**
 * P17 — item bank.
 *
 * Order 62 is the learning slot in boot/README.md. The bank is a service, not a system: it owns
 * no frame, draws nothing and mounts no hook. It exists at boot so that (a) a reviewer can read
 * `probe --name=itembank` out of the running game rather than out of a builder's summary, and
 * (b) the mastery engine finds it already loaded and locale-correct on its first draw.
 *
 * It listens to `ui:locale` only. That is an existing signal in design/architecture.md and it is
 * the one fact about the world the bank needs: which of the three locales the item text should
 * come back in.
 */
export default {
  id: "itembank",
  order: 62,
  async setup(kernel) {
    const initial = document.documentElement.lang || "en";
    itemBank.setLocale(initial);

    signals.on("ui:locale", (payload) => {
      if (payload?.locale) itemBank.setLocale(payload.locale);
    });

    publish("itembank", () => itemBank.probe());

    kernel.mount("itembank", {
      dispose() {
        /* no listeners on the kernel; the signal handler dies with the page */
      },
    });
  },
};
