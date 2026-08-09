/**
 * Signals — the only channel subsystems use to talk to each other.
 *
 * Hard rule for this codebase: a module may import the kernel and pure helpers, but it
 * must never import a sibling feature module. Everything crossing a feature boundary
 * goes through a named signal. That keeps every feature independently buildable,
 * replaceable and reviewable without touching its neighbours.
 */
export class Signals {
  #handlers = new Map();
  #log = [];
  #logging = false;

  on(name, fn) {
    let set = this.#handlers.get(name);
    if (!set) this.#handlers.set(name, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }

  once(name, fn) {
    const off = this.on(name, (v) => {
      off();
      fn(v);
    });
    return off;
  }

  emit(name, value) {
    if (this.#logging) {
      this.#log.push({ name, value, t: performance.now() });
      if (this.#log.length > 500) this.#log.shift();
    }
    const set = this.#handlers.get(name);
    if (!set) return;
    // Snapshot: handlers routinely unsubscribe themselves mid-dispatch.
    for (const fn of [...set]) {
      try {
        fn(value);
      } catch (err) {
        console.error(`signal "${name}" handler failed`, err);
      }
    }
  }

  /** Turn on a rolling buffer of recent signals — used by the review harness. */
  record(on = true) {
    this.#logging = on;
    if (!on) this.#log.length = 0;
  }

  history() {
    return [...this.#log];
  }

  names() {
    return [...this.#handlers.keys()].sort();
  }
}

export const signals = new Signals();
