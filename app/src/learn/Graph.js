/**
 * Graph — the runtime view of `content/knowledge-graph.json`.
 *
 * P03 owns the content; this file owns the *questions the engine asks of it* at runtime:
 * what are this node's prerequisites, what is its whole ancestor closure, which nodes may a
 * learner in this state legally be offered, and in what order does the graph have to be walked.
 *
 * Two rules shape everything here.
 *
 *  1. **Nothing is duplicated.** Every number the learner model uses lives in the JSON under
 *     `model`. This class exposes it; it never restates it. If a constant appears both here and
 *     in the content file, the content file is the one that is right and this file is a bug.
 *
 *  2. **A broken graph fails loudly, at load, in one place.** A cycle in the prerequisite
 *     relation does not produce a subtly wrong frontier six sessions into a session — it
 *     produces an infinite regress the learner experiences as a game that will not give them
 *     anything to do. `validate()` runs on construction by default and throws `GraphError`
 *     with the actual cycle written out.
 *
 * The class takes the parsed JSON as an argument rather than importing it, because the same
 * code has to run in two places with two different module systems: inside Vite (where the boot
 * module imports the JSON) and inside plain Node (where `review/measure/P16.mjs` reads it off
 * disk). A constructor argument is the only thing both agree on.
 */

/** Thrown when the content file cannot support a runtime. Carries every issue, not just the first. */
export class GraphError extends Error {
  constructor(message, issues = []) {
    super(issues.length ? `${message}\n  - ${issues.join("\n  - ")}` : message);
    this.name = "GraphError";
    this.issues = issues;
  }
}

export class Graph {
  /**
   * @param {object} source parsed `content/knowledge-graph.json`
   * @param {{validate?: boolean}} [opts]
   */
  constructor(source, opts = {}) {
    const { validate = true } = opts;
    if (!source || typeof source !== "object") throw new GraphError("knowledge graph source is not an object");
    if (!Array.isArray(source.nodes) || source.nodes.length === 0)
      throw new GraphError("knowledge graph has no nodes");
    if (!source.model || !Array.isArray(source.model.bands))
      throw new GraphError("knowledge graph has no model.bands block");

    this.raw = source;
    this.model = source.model;
    this.level = source.level ?? null;
    this.nodes = source.nodes;
    this.ids = this.nodes.map((n) => n.id);

    this.byId = new Map(this.nodes.map((n) => [n.id, n]));
    this.bandByDifficulty = new Map(this.model.bands.map((b) => [b.difficulty, b]));

    // Declaration order is the tie-break everywhere in this file. It is the only ordering the
    // content file actually fixes, and a reviewer re-running a script has to get the same answer.
    this.indexOf = new Map(this.ids.map((id, i) => [id, i]));

    this._successors = new Map(this.ids.map((id) => [id, []]));
    for (const n of this.nodes) {
      for (const p of n.prerequisites ?? []) {
        if (this._successors.has(p)) this._successors.get(p).push(n.id);
      }
    }

    this._ancestors = new Map();
    this._descendants = new Map();
    this._topo = null;

    if (validate) this.validate();

    // Memoise the two closures once the graph is known to be acyclic — before that, the
    // recursion below is exactly the infinite regress `validate()` exists to catch.
    for (const id of this.ids) this.descendants(id);
    for (const id of this.ids) this.ancestors(id);
    this.maxDescendants = Math.max(1, ...this.ids.map((id) => this.descendants(id).size));
  }

  // ------------------------------------------------------------------ lookup

  has(id) {
    return this.byId.has(id);
  }

  /** @returns {object} the node record. Throws rather than returning undefined: a typo'd kpId is a bug. */
  node(id) {
    const n = this.byId.get(id);
    if (!n) throw new GraphError(`unknown knowledge point "${id}"`);
    return n;
  }

  /** Difficulty band (1..5) of a node. */
  difficulty(id) {
    return this.node(id).difficulty;
  }

  /** The `model.bands` row for a node — prior, learn, slip, guess, logit centre. */
  band(id) {
    const d = this.difficulty(id);
    const b = this.bandByDifficulty.get(d);
    if (!b) throw new GraphError(`node "${id}" has difficulty ${d} with no matching model.bands row`);
    return b;
  }

  /** The item-difficulty centre of a node on the logit scale. */
  centre(id) {
    return this.band(id).logit;
  }

  /** Direct prerequisites, in declaration order. */
  prerequisites(id) {
    return this.node(id).prerequisites ?? [];
  }

  /** Direct dependents, in declaration order. */
  successors(id) {
    return this._successors.get(id) ?? [];
  }

  // ----------------------------------------------------------------- closure

  /**
   * Transitive prerequisite closure of one node — everything that must be true before this node
   * is honest to serve. Cached; the returned Set is shared, so callers must not mutate it.
   */
  ancestors(id) {
    const hit = this._ancestors.get(id);
    if (hit) return hit;
    const out = new Set();
    this._ancestors.set(id, out); // placed before recursion so a cycle cannot spin forever
    for (const p of this.prerequisites(id)) {
      out.add(p);
      for (const a of this.ancestors(p)) out.add(a);
    }
    return out;
  }

  /** Transitive dependents — what this node opens up. The `Reach` term of §4 is normalised on its size. */
  descendants(id) {
    const hit = this._descendants.get(id);
    if (hit) return hit;
    const out = new Set();
    this._descendants.set(id, out);
    for (const c of this.successors(id)) {
      out.add(c);
      for (const d of this.descendants(c)) out.add(d);
    }
    return out;
  }

  /**
   * Prerequisite closure of a *set* of nodes: everything a learner needs before any of `ids`
   * is reachable. `includeSelf` folds the seeds back in, which is what a "what does this level
   * actually contain" query wants.
   */
  closure(ids, { includeSelf = false } = {}) {
    const out = new Set();
    for (const id of ids) {
      if (includeSelf) out.add(id);
      for (const a of this.ancestors(id)) out.add(a);
    }
    return out;
  }

  roots() {
    return this.ids.filter((id) => this.prerequisites(id).length === 0);
  }

  leaves() {
    return this.ids.filter((id) => this.successors(id).length === 0);
  }

  // -------------------------------------------------------------------- order

  /**
   * Topological order — Kahn's algorithm, with declaration order as a deterministic tie-break so
   * two runs of the same review script produce the same list. Also the cycle detector: if fewer
   * than `nodes.length` ids come out, the leftovers are exactly the nodes trapped in a cycle.
   */
  topoOrder() {
    if (this._topo) return this._topo.slice();
    const indegree = new Map(this.ids.map((id) => [id, this.prerequisites(id).length]));
    const ready = this.ids.filter((id) => indegree.get(id) === 0).sort((a, b) => this.indexOf.get(a) - this.indexOf.get(b));
    const out = [];
    while (ready.length) {
      const id = ready.shift();
      out.push(id);
      for (const s of this.successors(id)) {
        const left = indegree.get(s) - 1;
        indegree.set(s, left);
        if (left === 0) {
          // Insert in declaration order rather than push-then-sort: same result, and it keeps the
          // ordering property obvious to the next reader.
          const at = ready.findIndex((x) => this.indexOf.get(x) > this.indexOf.get(s));
          if (at === -1) ready.push(s);
          else ready.splice(at, 0, s);
        }
      }
    }
    if (out.length !== this.ids.length) return out; // caller (validate) reports the cycle
    this._topo = out;
    return out.slice();
  }

  /** Longest chain of prerequisites ending at `id`, counted in nodes. */
  depth(id) {
    const memo = new Map();
    const walk = (n) => {
      if (memo.has(n)) return memo.get(n);
      memo.set(n, 1);
      let best = 1;
      for (const p of this.prerequisites(n)) best = Math.max(best, 1 + walk(p));
      memo.set(n, best);
      return best;
    };
    return walk(id);
  }

  // ----------------------------------------------------------------- frontier

  /**
   * The unlocked frontier, §4 step 3: every node whose **direct** prerequisites are all unlocked
   * and which is not yet `mastered`.
   *
   * "Direct" is load-bearing and it is only safe because the content file is transitively
   * reduced — `review/p03/kg-validate.mjs` asserts that on every run. A redundant edge would make
   * this rule quietly stricter than it reads.
   *
   * Unlocking is monotone (§2): the predicate should answer for `everUnlocked`, not for the
   * current status, so the world never re-locks behind a learner who lapsed.
   *
   * @param {(id:string)=>boolean} isUnlocked  has this node ever reached `provisional`?
   * @param {(id:string)=>boolean} [isMastered]
   * @returns {string[]} ids, in declaration order
   */
  frontier(isUnlocked, isMastered = () => false) {
    return this.ids.filter((id) => {
      if (isMastered(id)) return false;
      return this.prerequisites(id).every((p) => isUnlocked(p));
    });
  }

  // --------------------------------------------------------------- validation

  /**
   * Structural conformance of the content file to what the runtime assumes. Throws `GraphError`
   * listing every issue found, not just the first — an author fixing content wants the whole list.
   *
   * Hard failures (they make the runtime impossible, not merely wrong):
   *   - a prerequisite that names a node that does not exist
   *   - a cycle in the prerequisite relation
   *   - a difficulty with no `model.bands` row
   *   - a duplicate node id
   *   - a node with no standards mapping (quality gate L3: every knowledge point maps to a standard)
   *
   * Band monotonicity (§0: no node easier than its prerequisite) is reported as an issue too,
   * because a node sitting behind a harder parent is pitched at the wrong band centre and carries
   * a prior fitted for a population that has not met the parent.
   */
  validate() {
    const issues = [];

    const seen = new Set();
    for (const n of this.nodes) {
      if (!n.id) issues.push(`a node has no id`);
      else if (seen.has(n.id)) issues.push(`duplicate node id "${n.id}"`);
      seen.add(n.id);
      if (!this.bandByDifficulty.has(n.difficulty))
        issues.push(`node "${n.id}" has difficulty ${n.difficulty} with no model.bands row`);
      if (!Array.isArray(n.standards) || n.standards.length === 0)
        issues.push(`node "${n.id}" maps to no standard (quality gate L3)`);
      for (const p of n.prerequisites ?? []) {
        if (!this.byId.has(p)) issues.push(`node "${n.id}" requires unknown prerequisite "${p}"`);
      }
    }

    if (!issues.some((i) => i.includes("unknown prerequisite"))) {
      const order = this.topoOrder();
      if (order.length !== this.ids.length) {
        const stuck = new Set(this.ids.filter((id) => !order.includes(id)));
        issues.push(`prerequisite relation is CYCLIC: ${this._describeCycle(stuck)}`);
      } else {
        for (const n of this.nodes) {
          for (const p of n.prerequisites ?? []) {
            const pd = this.byId.get(p)?.difficulty;
            if (pd != null && pd > n.difficulty)
              issues.push(`band inversion: "${n.id}" (band ${n.difficulty}) sits behind harder "${p}" (band ${pd})`);
          }
        }
      }
    }

    if (issues.length) throw new GraphError("knowledge graph is not usable as a runtime", issues);
    return true;
  }

  /** Walk the nodes a topological sort could not place and print one concrete cycle. */
  _describeCycle(stuck) {
    const start = [...stuck].sort((a, b) => this.indexOf.get(a) - this.indexOf.get(b))[0];
    const path = [];
    const onPath = new Set();
    const walk = (id) => {
      if (onPath.has(id)) {
        path.push(id);
        return true;
      }
      if (!stuck.has(id)) return false;
      onPath.add(id);
      path.push(id);
      for (const p of this.prerequisites(id)) if (walk(p)) return true;
      path.pop();
      onPath.delete(id);
      return false;
    };
    walk(start);
    const at = path.indexOf(path[path.length - 1]);
    return path.slice(at).join(" <- ");
  }

  // -------------------------------------------------------------------- stats

  /** A small JSON-safe summary, for probes and for the measurement script's header. */
  stats() {
    const bands = {};
    for (const n of this.nodes) bands[n.difficulty] = (bands[n.difficulty] ?? 0) + 1;
    return {
      nodes: this.nodes.length,
      edges: this.nodes.reduce((a, n) => a + (n.prerequisites?.length ?? 0), 0),
      roots: this.roots().length,
      leaves: this.leaves().length,
      longestChain: Math.max(...this.ids.map((id) => this.depth(id))),
      bands,
      maxDescendants: this.maxDescendants,
    };
  }
}
