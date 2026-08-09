/**
 * Introspect — the contract between the running game and any automated reviewer.
 *
 * A reviewer is never allowed to trust a builder's description of the game, so it needs to
 * read the truth out of the live page: exact game time, real draw counts, the actual locale
 * in force, the actual KaTeX nodes on screen. Everything a reviewer may need is published
 * here under `window.__vs`, and nothing in the gameplay code is allowed to depend on it.
 */
const probes = new Map();

export const introspect = {
  build: "0.0.1",
  ready: false,
  fatal: null,
  errors: [],
  warnings: [],
  kernel: null,
};

export function attach(kernel) {
  introspect.kernel = kernel;

  addEventListener("error", (e) => {
    introspect.errors.push(String(e.error?.stack || e.message || e));
  });
  addEventListener("unhandledrejection", (e) => {
    introspect.errors.push(`unhandled rejection: ${String(e.reason?.stack || e.reason)}`);
  });

  Object.assign(introspect, {
    /** Advance exact game time. The reviewer's only legitimate way to move time forward. */
    advance: (seconds, opts) => kernel.advance(Number(seconds) || 0, opts),
    pause: (v = true) => (kernel.paused = v),
    stats: () => kernel.stats(),
    probe: (name) => probes.get(name)?.(),
    probeNames: () => [...probes.keys()].sort(),

    /**
     * Full-page report. Deliberately includes the checks that a screenshot cannot make:
     * whether any TeX failed to typeset, whether raw source leaked into visible text,
     * and whether any localized string is missing.
     */
    report() {
      const katexNodes = [...document.querySelectorAll(".katex")];
      const errorNodes = [...document.querySelectorAll(".katex-error")];
      const overlay = document.getElementById("overlay");
      const visibleText = overlay ? overlay.innerText : "";

      return {
        build: introspect.build,
        ready: introspect.ready,
        fatal: introspect.fatal,
        errors: introspect.errors.slice(0, 25),
        warnings: introspect.warnings.slice(0, 25),
        stats: kernel.stats(),
        katex: {
          rendered: katexNodes.length,
          failed: errorNodes.length,
          failedSamples: errorNodes.slice(0, 5).map((n) => n.textContent),
          // Untypeset TeX reaching the player is a hard failure, not a cosmetic one.
          rawSourceLeak: /(\\frac|\\sqrt|\\cdot|\\times|\\left|\\right|\\begin\{|\$\$)/.test(
            visibleText
          ),
          leakSample: (visibleText.match(/.{0,40}\\[a-zA-Z]+.{0,40}/) || [])[0] || null,
        },
        probes: Object.fromEntries(
          [...probes.entries()].map(([k, fn]) => {
            try {
              return [k, fn()];
            } catch (err) {
              return [k, { error: String(err) }];
            }
          })
        ),
      };
    },
  });

  window.__vs = introspect;
  return introspect;
}

/** Systems publish a read-only view of themselves for reviewers and tests. */
export function publish(name, fn) {
  probes.set(name, fn);
}

export function warn(message) {
  introspect.warnings.push(String(message));
  console.warn(message);
}
