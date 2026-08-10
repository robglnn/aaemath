#!/usr/bin/env node
/**
 * CRITIC's own probe for P31 — drive a real session inside the REAL BUILT GAME and watch which
 * group chunks the browser actually fetches. This is the test round 2 failed: not "does the
 * loader work in Node", but "does the shipped page pull per-lesson catalogue while a session runs".
 *
 *   node review/measure/_critic-P31-session.mjs [--break=<kpId>] [--items=N]
 *
 * `--break` deletes that knowledge point's chunk from dist BEFORE the preview server starts, so
 * the dynamic import gets a real 404 from a real server — not the ItemBank's own `__faultGroup`
 * test hook, which is the builder's backdoor and proves nothing about transport.
 */
import fs from "node:fs";
import path from "node:path";
import { openGame, ROOT } from "../../tools/lib/session.mjs";

const arg = (n, d) => {
  const h = process.argv.find((a) => a.startsWith(`--${n}=`));
  return h ? h.split("=")[1] : d;
};
const BREAK = arg("break", null);
const ITEMS = Number(arg("items", 120));

const KP_IDS = JSON.parse(fs.readFileSync(path.join(ROOT, "content/knowledge-graph.json"), "utf8")).nodes.map(
  (n) => n.id
);
const ASSETS = path.join(ROOT, "dist/assets");
const files = fs.readdirSync(ASSETS);
const bankChunk = files.find((f) => /^ItemBank-.*\.js$/.test(f));
const isGroupChunk = (name) => KP_IDS.some((id) => name === `${id}.js` || name.startsWith(`${id}-`));

let broken = null;
if (BREAK) {
  const hit = files.find((f) => f === `${BREAK}.js` || f.startsWith(`${BREAK}-`));
  if (!hit) throw new Error(`no built chunk for ${BREAK}`);
  broken = path.join(ASSETS, hit);
  fs.renameSync(broken, `${broken}.HIDDEN`);
  console.error(`hid ${hit} — the server will 404 it`);
}

const base = (u) => String(u).split("/").pop().split("?")[0];

try {
  const out = await openGame({ built: true, width: 960, height: 540 }, async (d) => {
    const report = await d.report();
    const atReady = (await d.run(() => performance.getEntriesByType("resource").map((e) => e.name))).map(base);

    // A real learner does not reach the first item in the same millisecond as `ready`. Await the
    // boot module's own warm (and two idle turns for its prefetch) before the session opens, which
    // is the most generous reading of the shipped behaviour.
    let warm = null;
    if (process.env.VS_WARM === "1") {
      warm = await d.run(async () => {
        const sys = window.__vs?.kernel?.get?.("itembank");
        const w = sys?.warmed ? await sys.warmed() : { error: "no warmed()" };
        await new Promise((res) => {
          const turn = (fn) =>
            typeof requestIdleCallback === "function" ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 30);
          turn(() => turn(() => setTimeout(res, 150)));
        });
        return w;
      });
    }

    const session = await d.run(
      async ([chunk, n]) => {
        const mod = await import(`./assets/${chunk}`);
        // Rollup mangles the export names of a shared chunk, so find them by shape.
        const vals = Object.values(mod);
        const bank = vals.find((v) => v && typeof v.select === "function" && typeof v.residency === "function");
        const chan = vals.find((v) => v && typeof v === "object" && "onIssue" in v);
        if (!bank) return { fatal: `no itemBank singleton among exports ${Object.keys(mod).join(",")}` };
        const learning = window.__vs.kernel.get("learning");
        const issues = [];
        if (chan) {
          const prev = chan.onIssue;
          chan.onIssue = (i) => {
            issues.push({ kind: i.kind, kpId: i.kpId ?? null, error: String(i.error ?? "") });
            prev?.(i);
          };
        }
        const served = [];
        let blanks = 0;
        let steps = 0;
        const t0 = performance.now();
        for (; served.length < n; ) {
          steps += 1;
          if (steps > n * 6) break;
          const req = learning.next();
          if (!req) break;
          const sel = bank.select({
            kpId: req.kpId,
            form: req.form,
            difficulty: req.difficulty,
            misconception: req.misconception ?? req.targetMisconception ?? null,
            exclude: req.avoidItemIds,
          });
          if (!sel || !sel.item) {
            blanks += 1;
            learning.submit(req, { correct: false, latencyMs: 20000, itemId: `blank#${steps}` });
            continue;
          }
          const right = (steps % 4) !== 0;
          const answer = bank.accepts(sel.item)[0];
          const verdict = bank.check(sel.item, right ? answer : `${answer}zz`);
          const presented = bank.present ? bank.present(sel.item) : null;
          served.push({
            kpId: req.kpId,
            id: sel.item.id,
            source: sel.source,
            relaxation: sel.relaxation,
            correct: verdict.correct,
            tex: presented?.tex ?? presented?.prompt ?? null,
          });
          learning.submit(req, {
            correct: verdict.correct,
            latencyMs: 20000,
            itemId: sel.item.id,
            misconception: verdict.misconception,
          });
          await new Promise((r) => setTimeout(r, 0));
        }
        return {
          ms: Math.round(performance.now() - t0),
          steps,
          blanks,
          served,
          issues,
          residency: bank.residency(),
          probe: bank.probe(),
        };
      },
      [bankChunk, ITEMS]
    );

    const after = (await d.run(() => performance.getEntriesByType("resource").map((e) => e.name))).map(base);
    const post = await d.report();
    return {
      ready: report.ready,
      warm,
      errors: post.errors ?? [],
      warnings: (post.warnings ?? []).filter((w) => /itembank|bank|group/i.test(w)),
      failedRequests: d.failedRequests,
      groupChunksAtReady: atReady.filter(isGroupChunk),
      groupChunksAfterSession: [...new Set(after.filter(isGroupChunk))],
      session,
    };
  });

  const s = out.session;
  const kps = [...new Set(s.served.map((x) => x.kpId))];
  const bySource = {};
  for (const x of s.served) bySource[`${x.source}/${x.relaxation}`] = (bySource[`${x.source}/${x.relaxation}`] ?? 0) + 1;
  console.log(
    JSON.stringify(
      {
        broken: BREAK,
        ready: out.ready,
        warm: out.warm,
        errors: out.errors,
        bankWarnings: out.warnings,
        failedRequests: out.failedRequests,
        groupChunksAtReady: out.groupChunksAtReady,
        groupChunksAfterSession: out.groupChunksAfterSession.sort(),
        itemsServed: s.served.length,
        steps: s.steps,
        blanks: s.blanks,
        ms: s.ms,
        kpsTouched: kps,
        bySource,
        residentGroups: s.residency.resident,
        failedGroups: Object.keys(s.residency.failed ?? {}),
        degraded: s.probe.degraded,
        issues: s.issues,
        onBrokenKp: BREAK
          ? s.served.filter((x) => x.kpId === BREAK).map((x) => ({ id: x.id, source: x.source, relaxation: x.relaxation, hasTex: !!x.tex }))
          : null,
        firstFive: s.served.slice(0, 5),
      },
      null,
      1
    )
  );
} finally {
  if (broken) fs.renameSync(`${broken}.HIDDEN`, broken);
}
