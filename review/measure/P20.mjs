#!/usr/bin/env node
/**
 * P20 — the re-runnable proof.
 *
 *   node review/measure/P20.mjs              everything, including the browser
 *   node review/measure/P20.mjs --offline    file and runtime checks only, no Chromium
 *   node review/measure/P20.mjs --shots      also write review/shots/p20/*.png
 *
 * Every claim P20's handoff makes is a row below, with a stated threshold, measured here.
 * Prints a JSON table and PASS/FAIL per claim; exits non-zero if any claim fails.
 *
 * This script is written to demolish the piece, not to flatter it. In particular it does not
 * trust the locale files to be a faithful copy of `design/voice.md` — it re-extracts the canon
 * from the bible and compares byte for byte (C1), which is the check that would catch a builder
 * "improving" a canonical line while translating it.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const OFFLINE = process.argv.includes("--offline");
const SHOTS = process.argv.includes("--shots") || !OFFLINE;

const { pluralCategory, REQUIRED_CATEGORIES, isPluralBundle, PLURAL_KEYS } = await import(
  pathToFileURL(path.join(ROOT, "app/src/i18n/plurals.js")).href
);
const { formatNumber, texNumber, formatPercent, formatList } = await import(
  pathToFileURL(path.join(ROOT, "app/src/i18n/numbers.js")).href
);

const LOCALES = ["en", "es", "pl"];
const bundles = Object.fromEntries(
  LOCALES.map((l) => [l, JSON.parse(fs.readFileSync(path.join(ROOT, "content/locales", `${l}.json`), "utf8"))])
);

// ---------------------------------------------------------------- helpers

function flatten(node, prefix = "", out = []) {
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("$")) continue;
    const p = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string" || isPluralBundle(value)) out.push([p, value]);
    else if (value && typeof value === "object") flatten(value, p, out);
  }
  return out;
}

const flat = Object.fromEntries(LOCALES.map((l) => [l, flatten(bundles[l])]));
const map = Object.fromEntries(LOCALES.map((l) => [l, new Map(flat[l])]));
const forms = (leaf) => (typeof leaf === "string" ? [leaf] : Object.values(leaf));
const params = (leaf) => new Set(forms(leaf).flatMap((s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1])));

/** The canon, re-derived from the bible rather than taken on trust. */
function canonFromVoice() {
  const src = fs.readFileSync(path.join(ROOT, "design/voice.md"), "utf8");
  const out = new Map();
  let fenced = false;
  for (const line of src.split(/\r?\n/)) {
    if (/^```/.test(line)) { fenced = !fenced; continue; }
    if (!fenced) continue;
    const m = /^([a-z][a-z0-9]*(?:\.[a-z0-9]+)+)\s+(.+?)\s*$/.exec(line);
    if (m) out.set(m[1], m[2]);
  }
  for (const m of src.matchAll(/^\| .+? \| `(fail\.[a-z.]+)` — (.+?) \|$/gm)) out.set(m[1], m[2]);
  return out;
}

const claims = [];
function claim(id, statement, threshold, ok, detail) {
  claims.push({ id, statement, threshold, pass: !!ok, ...detail });
}

// ---------------------------------------------------------------- C1 canon fidelity

{
  const canon = canonFromVoice();
  const bad = [];
  for (const [key, text] of canon) {
    const mine = map.en.get(key);
    if (typeof mine !== "string") bad.push(`${key}: absent`);
    else if (mine !== text) bad.push(`${key}: "${mine}" != "${text}"`);
  }
  claim(
    "C1 CANON-EXACT",
    "every shippable string in design/voice.md is in en.json, byte-identical",
    "0 mismatches, 254 keys",
    bad.length === 0 && canon.size === 254,
    { canonKeys: canon.size, mismatches: bad.length, sample: bad.slice(0, 5) }
  );
}

// ---------------------------------------------------------------- C2 key parity and order

{
  const ref = flat.en.map(([k]) => k);
  const rows = {};
  let bad = 0;
  for (const l of LOCALES) {
    const keys = flat[l].map(([k]) => k);
    const missing = ref.filter((k) => !map[l].has(k));
    const extra = keys.filter((k) => !map.en.has(k));
    const orderMatches = JSON.stringify(keys) === JSON.stringify(ref);
    rows[l] = { keys: keys.length, missing: missing.length, extra: extra.length, sameOrder: orderMatches,
      sampleMissing: missing.slice(0, 5), sampleExtra: extra.slice(0, 5) };
    if (missing.length || extra.length || !orderMatches) bad++;
  }
  claim(
    "C2 KEY-PARITY",
    "es and pl carry exactly en's key paths, in exactly en's order",
    "0 missing, 0 extra, identical order in all 3",
    bad === 0,
    { locales: rows }
  );
}

// ---------------------------------------------------------------- C3 plural coverage

{
  const rows = {};
  let bad = 0;
  for (const l of LOCALES) {
    const need = REQUIRED_CATEGORIES[l];
    const gaps = [];
    let bundlesSeen = 0;
    for (const [key, leaf] of flat[l]) {
      if (typeof leaf === "string") continue;
      bundlesSeen++;
      for (const cat of need) if (typeof leaf[cat] !== "string") gaps.push(`${key}:${cat}`);
      for (const cat of Object.keys(leaf)) if (!PLURAL_KEYS.includes(cat)) gaps.push(`${key}:${cat}?`);
    }
    // Every plural key in en must be plural everywhere.
    for (const [key, leaf] of flat.en) {
      if (typeof leaf === "string") continue;
      if (typeof map[l].get(key) === "string") gaps.push(`${key}:not-a-plural`);
    }
    rows[l] = { required: need, pluralBundles: bundlesSeen, gaps: gaps.length, sample: gaps.slice(0, 5) };
    if (gaps.length) bad++;
  }
  claim(
    "C3 PLURAL-COVERAGE",
    "every plural bundle supplies every CLDR category its language requires (pl needs 4)",
    "0 gaps in all 3",
    bad === 0,
    { locales: rows }
  );
}

// ---------------------------------------------------------------- C4 placeholder parity

{
  const bad = [];
  for (const [key, leaf] of flat.en) {
    const want = params(leaf);
    for (const l of LOCALES.slice(1)) {
      const got = params(map[l].get(key));
      for (const p of want) if (!got.has(p)) bad.push(`${l} ${key} lost {${p}}`);
      for (const p of got) if (!want.has(p)) bad.push(`${l} ${key} invented {${p}}`);
    }
  }
  const withParams = flat.en.filter(([, leaf]) => params(leaf).size > 0).length;
  claim(
    "C4 PLACEHOLDER-PARITY",
    "no locale drops or invents a {placeholder}",
    "0 mismatches",
    bad.length === 0,
    { keysCarryingParams: withParams, mismatches: bad.length, sample: bad.slice(0, 5) }
  );
}

// ---------------------------------------------------------------- C5 plural rule correctness

{
  // Ground truth written out by hand from CLDR, not read back from the implementation.
  const cases = [
    ["pl", 0, "many"], ["pl", 1, "one"], ["pl", 2, "few"], ["pl", 3, "few"], ["pl", 4, "few"],
    ["pl", 5, "many"], ["pl", 9, "many"], ["pl", 11, "many"], ["pl", 12, "many"], ["pl", 13, "many"],
    ["pl", 14, "many"], ["pl", 15, "many"], ["pl", 21, "many"], ["pl", 22, "few"], ["pl", 24, "few"],
    ["pl", 25, "many"], ["pl", 101, "many"], ["pl", 102, "few"], ["pl", 112, "many"], ["pl", 114, "many"],
    ["pl", 122, "few"], ["pl", 1.5, "other"], ["pl", 0.5, "other"], ["pl", 2.5, "other"],
    ["en", 0, "other"], ["en", 1, "one"], ["en", 2, "other"], ["en", 1.5, "other"], ["en", 21, "other"],
    ["es", 0, "other"], ["es", 1, "one"], ["es", 2, "other"], ["es", 1.5, "other"], ["es", 21, "other"],
  ];
  const wrong = cases.filter(([l, n, want]) => pluralCategory(l, n) !== want)
    .map(([l, n, want]) => `${l}/${n}: got ${pluralCategory(l, n)}, want ${want}`);
  claim(
    "C5 PLURAL-RULE",
    "plurals.js reproduces CLDR for 34 hand-written cases, including pl's teens, …1s and fractions",
    "34/34 correct",
    wrong.length === 0,
    { cases: cases.length, wrong: wrong.length, sample: wrong.slice(0, 5) }
  );
}

// ---------------------------------------------------------------- C6 number conventions

{
  const NBSP = " ";
  const expect = [
    ["en", "n", 16004, "16,004"], ["es", "n", 16004, `16${NBSP}004`], ["pl", "n", 16004, `16${NBSP}004`],
    ["en", "n", 4111, "4,111"], ["es", "n", 4111, "4111"], ["pl", "n", 4111, "4111"],
    ["en", "n", 1.5, "1.5"], ["es", "n", 1.5, "1,5"], ["pl", "n", 1.5, "1,5"],
    ["en", "n", -2.25, "−2.25"], ["es", "n", -2.25, "−2,25"], ["pl", "n", -2.25, "−2,25"],
    ["en", "pct", 80, "80%"], ["es", "pct", 80, `80${NBSP}%`], ["pl", "pct", 80, `80${NBSP}%`],
    ["en", "tex", 16004.5, "16{,}004.5"], ["es", "tex", 16004.5, "16\\,004{,}5"], ["pl", "tex", 16004.5, "16\\,004{,}5"],
    ["en", "tex", 1.5, "1.5"], ["es", "tex", 1.5, "1{,}5"], ["pl", "tex", 1.5, "1{,}5"],
    ["en", "tex", -3, "-3"], ["pl", "tex", -3, "-3"],
    ["en", "list", ["a", "b", "c"], "a, b and c"],
    ["es", "list", ["a", "b", "c"], "a, b y c"],
    ["es", "list", ["certezas", "hilos"], "certezas e hilos"],
    ["pl", "list", ["a", "b", "c"], "a, b i c"],
  ];
  const run = (l, kind, v) =>
    kind === "n" ? formatNumber(v, l)
    : kind === "tex" ? texNumber(v, l)
    : kind === "pct" ? formatPercent(v, l)
    : formatList(v, l);
  const wrong = expect
    .map(([l, kind, v, want]) => ({ l, kind, v, want, got: run(l, kind, v) }))
    .filter((r) => r.got !== r.want)
    .map((r) => `${r.l}/${r.kind}(${JSON.stringify(r.v)}): got ${JSON.stringify(r.got)}, want ${JSON.stringify(r.want)}`);
  claim(
    "C6 NUMBER-CONVENTION",
    "decimal mark, group separator, group threshold, minus, percent gap, TeX form and list conjunction per locale",
    `${expect.length}/${expect.length} exact`,
    wrong.length === 0,
    { cases: expect.length, wrong: wrong.length, sample: wrong.slice(0, 6) }
  );
}

// ---------------------------------------------------------------- C7 untranslated strings

{
  // Strings that are legitimately identical across locales, with the reason.
  const ALLOW = new Set([
    "ui.lang.en", "ui.lang.es", "ui.lang.pl",      // endonyms, identical in every bundle by design
    "ui.setting.control",                           // "Control" is the Spanish word too
    "ui.hud.provisional", "walk.solv.01",           // ES "Provisional" is the same word
    "sennar.refuse.help.01",                        // Sennar's whole line is "No." — so is Spanish's
  ]);
  const rows = {};
  let bad = 0;
  for (const l of LOCALES.slice(1)) {
    const same = [];
    for (const [key, leaf] of flat.en) {
      if (ALLOW.has(key)) continue;
      const mine = map[l].get(key);
      if (JSON.stringify(mine) === JSON.stringify(leaf)) same.push(key);
    }
    rows[l] = { identicalToEnglish: same.length, keys: same };
    if (same.length) bad++;
  }
  claim(
    "C7 NO-UNTRANSLATED",
    "no es/pl string is byte-identical to its English source outside a declared allowlist",
    "0 outside the allowlist",
    bad === 0,
    { allowlist: [...ALLOW], locales: rows }
  );
}

// ---------------------------------------------------------------- C8 banned vocabulary

{
  // voice.md §1 is a rule about meaning, so each locale gets its own list of the same offences.
  const BANNED = {
    en: /\b(problems?|questions?|exercises?|answers?|solutions?|correct|incorrect|wrong|homework|drills?|tutorials?|lessons?|practice|study|learn|learning|teach|teaching|master|mastered|skills?|scores?|points|xp|streak|combo|hints?|student|users?|maths?|mathematics|equations?|algebra|inequalit(y|ies)|expressions?|variables?|substitute|distribute|simplify|just)\b/i,
    es: /\b(ejercicios?|respuestas?|problemas?|correcto|incorrecto|deberes|tareas?|alumnos?|estudiantes?|lecci[óo]n|lecciones|matem[áa]ticas?|ecuaci[óo]n(es)?|[áa]lgebra|desigualdad(es)?|variables?|sustituir|simplificar|puntuaci[óo]n|puntos)\b/i,
    pl: /\b(zadani[ae]|odpowiedzi?|odpowiedź|poprawnie|błędnie|brawo|ocen[ay]|ucze[ńn]|uczniowie|lekcj[ae]|matematyk[ai]|r[óo]wnani[ae]|algebra|nier[óo]wno[śs][ćc]|zmienn[aey]|podstawi[ćc]|upro[śs]ci[ćc]|punkty)\b/i,
  };
  // world.md §1 fixes the product's title, and the title is a name rather than in-world speech.
  const EXEMPT = new Set(["ui.title"]);
  const rows = {};
  let bad = 0;
  for (const l of LOCALES) {
    const hits = [];
    for (const [key, leaf] of flat[l]) {
      if (EXEMPT.has(key)) continue;
      for (const text of forms(leaf)) {
        const m = BANNED[l].exec(String(text));
        if (m) hits.push(`${key}: "${m[0]}"`);
      }
    }
    rows[l] = { hits: hits.length, sample: hits.slice(0, 6) };
    if (hits.length) bad++;
  }
  claim(
    "C8 BANNED-VOCAB",
    "voice.md §1's ban holds in all three locales, by meaning not spelling",
    "0 hits (ui.title exempt: world.md §1 fixes the product name)",
    bad === 0,
    { exempt: [...EXEMPT], locales: rows }
  );
}

// ---------------------------------------------------------------- C9 exclamation budget

{
  const WANT = ["ix.first.solve.01", "ix.bark.walker.01", "ix.mastery.digit.01"].sort();
  const rows = {};
  let bad = 0;
  for (const l of LOCALES) {
    // Counted on the closing "!" only: Spanish opens with "¡", and counting both marks would
    // read correct Spanish punctuation as double the budget.
    const keys = flat[l].filter(([, leaf]) => forms(leaf).some((t) => String(t).includes("!"))).map(([k]) => k).sort();
    const total = flat[l].reduce((sum, [, leaf]) => sum + forms(leaf).reduce((s, t) => s + (String(t).match(/!/g) ?? []).length, 0), 0);
    rows[l] = { marks: total, keys };
    if (total !== 3 || JSON.stringify(keys) !== JSON.stringify(WANT)) bad++;
  }
  claim(
    "C9 EXCLAMATION-BUDGET",
    "exactly three exclamation marks in Level 1, all Ix's, the same three keys in every locale",
    "3 marks, keys == voice.md §2",
    bad === 0,
    { expected: WANT, locales: rows }
  );
}

// ---------------------------------------------------------------- C10 length reserve

{
  // voice.md §7: caps are measured on EN; PL reserves +30%, ES +20%.
  const CAPS = [
    { name: "bark", test: (k) => /\.bark\./.test(k), en: 56 },
    { name: "system", test: (k) => k.startsWith("sys.") || k.startsWith("mastery."), en: 44 },
    { name: "ambient", test: (k) => k.startsWith("amb."), en: 48 },
  ];
  const RESERVE = { en: 1.0, es: 1.2, pl: 1.3 };
  const rows = {};
  let bad = 0;
  for (const l of LOCALES) {
    const over = [];
    let worst = 0;
    for (const [key, leaf] of flat[l]) {
      const cap = CAPS.find((c) => c.test(key));
      if (!cap) continue;
      const limit = Math.round(cap.en * RESERVE[l]);
      for (const text of forms(leaf)) {
        const len = String(text).length;
        worst = Math.max(worst, len / limit);
        if (len > limit) over.push(`${key}: ${len} > ${limit} (${cap.name})`);
      }
    }
    rows[l] = { over: over.length, worstRatio: Number(worst.toFixed(3)), sample: over.slice(0, 5) };
    if (over.length) bad++;
  }
  claim(
    "C10 LENGTH-RESERVE",
    "every capped register fits its locale reserve (EN cap, ES ×1.2, PL ×1.3) from voice.md §7",
    "0 over cap in all 3",
    bad === 0,
    { locales: rows }
  );
}

// ---------------------------------------------------------------- C11 register rules that survive translation

{
  const problems = [];
  for (const l of LOCALES) {
    // The Verse: em dashes at both ends, never punctuated into sentences.
    for (const [key, leaf] of flat[l]) {
      if (!key.startsWith("walk.verse.")) continue;
      const t = String(leaf);
      if (!t.startsWith("—") || !t.endsWith("—")) problems.push(`${l} ${key}: not dash-bounded`);
    }
    // The cutters: never the first-person pronoun, in any locale.
    const PRONOUN = { en: /\bI\b/, es: /\byo\b/i, pl: /\bja\b/i };
    for (const [key, leaf] of flat[l]) {
      if (!key.startsWith("walk.cut.")) continue;
      if (PRONOUN[l].test(String(leaf))) problems.push(`${l} ${key}: first-person pronoun`);
    }
    // The rating: a located part of a body, never a flat "we".
    const PART = { en: /\bof us\b/, es: /\bde nosotros\b/, pl: /\bz nas\b/ };
    for (const [key, leaf] of flat[l]) {
      if (!key.startsWith("walk.rate.")) continue;
      if (!PART[l].test(String(leaf))) problems.push(`${l} ${key}: flattened to a plain plural`);
    }
    // sys.* is third person: never addresses the player.
    const YOU = { en: /\b(you|your|yours)\b/i, es: /\b(t[úu]|tuyo|usted|su vano)\b/i, pl: /\b(ty|tw[óo]j|twoje|twoja|ciebie)\b/i };
    for (const [key, leaf] of flat[l]) {
      if (!key.startsWith("sys.")) continue;
      if (YOU[l].test(String(leaf))) problems.push(`${l} ${key}: sys.* addresses the player`);
    }
  }
  claim(
    "C11 REGISTER-SURVIVES",
    "Verse dash-bounded, cutters never say I, walk.rate names a body part, sys.* never says you — in every locale",
    "0 violations across 3 locales",
    problems.length === 0,
    { violations: problems.length, sample: problems.slice(0, 6) }
  );
}

// ---------------------------------------------------------------- C12 runtime renders everything

{
  const { I18n } = await import(pathToFileURL(path.join(ROOT, "app/src/i18n/I18n.js")).href).catch(() => ({}));
  // I18n.js loads JSON through the bundler, so drive the pieces we can reach from node instead:
  // render every leaf with the plural sweep the runtime uses and assert nothing is left unfilled.
  const counts = [0, 1, 2, 5, 11, 21, 1.5];
  const rows = {};
  let bad = 0;
  for (const l of LOCALES) {
    const broken = [];
    let rendered = 0;
    for (const [key, leaf] of flat[l]) {
      const names = params(leaf);
      const isPlural = typeof leaf !== "string";
      for (const count of isPlural ? counts : [1]) {
        const cat = isPlural ? pluralCategory(l, count) : null;
        let text = isPlural ? leaf[cat] : leaf;
        if (text === undefined) { broken.push(`${key}: no ${cat}`); continue; }
        for (const n of names) text = String(text).replaceAll(`{${n}}`, n === "n" || n === "count" ? formatNumber(count, l) : "…");
        rendered++;
        if (/\{\w+\}/.test(text)) broken.push(`${key}: unfilled placeholder`);
      }
    }
    rows[l] = { rendered, broken: broken.length, sample: broken.slice(0, 5) };
    if (broken.length) bad++;
  }
  claim(
    "C12 RENDERS-CLEAN",
    "every string renders for every count the language can produce, with no placeholder left standing",
    "0 broken renders in all 3",
    bad === 0 && typeof I18n === "function",
    { runtimeLoadable: typeof I18n === "function", locales: rows }
  );
}

// ---------------------------------------------------------------- live browser

const live = { ran: false };
if (!OFFLINE) {
  const { openGame, ROOT: SROOT } = await import(pathToFileURL(path.join(ROOT, "tools/lib/session.mjs")).href);
  live.ran = true;
  const probes = {};
  const layouts = {};
  const foreignErrors = {};
  const shots = [];
  const SIZES = [
    { w: 1600, h: 900 },
    { w: 1280, h: 720 },
  ];

  // Other pieces are being written while this runs, and a Vite HMR reload mid-session destroys
  // the page's execution context. That is churn, not a finding, so a session gets three tries
  // before it is allowed to fail the measurement.
  const attempt = async (fn) => {
    let last;
    for (let i = 0; i < 3; i++) {
      try {
        return await fn();
      } catch (err) {
        last = err;
      }
    }
    throw last;
  };

  for (const lang of LOCALES) {
    for (const size of SIZES) {
      await attempt(() => openGame(
        { lang, width: size.w, height: size.h, query: { i18nproof: "1" } },
        async (d) => {
          // Advancing time runs every other piece's hooks, and a sibling mid-rewrite can throw
          // inside `after()`. Boot has already completed by the time openGame returns, so a
          // failed advance costs this measurement nothing — and swallowing it here is what keeps
          // a P20 number from depending on P13's current save state. Foreign errors are still
          // collected and printed below, never attributed.
          try {
            await d.play(1.0);
          } catch {
            /* a sibling's hook threw; recorded via report().errors */
          }
          // The proof surface must actually be on the page before anything is measured or
          // captured. Without this the retry above can hand back a session that reloaded under
          // it, and the evidence is a black frame that looks like a render bug.
          const mounted = await d.run(() => !!document.querySelector(".vs-i18nproof"));
          if (!mounted) throw new Error(`${lang}@${size.w}: proof surface not mounted`);
          const p = await d.probe("i18n");
          if (size.w === 1600) probes[lang] = p;
          layouts[`${lang}@${size.w}x${size.h}`] = p?.layout ?? null;
          // Foreign boot failures are recorded, never attributed to P20.
          const rep = await d.report().catch(() => ({ errors: ["report() unavailable"] }));
          foreignErrors[`${lang}@${size.w}`] = (rep.errors ?? []).map((e) => e.split("\n")[0]);
          if (SHOTS && size.w === 1600) {
            const file = `review/shots/p20/${lang}-1600x900.png`;
            // Pause the fixed-step clock first. Headless software GL is slow enough that a live
            // 3D scene can starve the compositor and time the capture out; the layout numbers
            // above are already taken, and a paused frame is the same frame.
            await d.run(() => {
              window.__vs?.pause?.(true);
              // The proof surface is opaque and covers the viewport, so the canvas contributes
              // no pixels to this capture — hiding it only stops software GL competing with the
              // compositor, which is what times the screenshot out on a loaded machine.
              const c = document.getElementById("stage");
              if (c) c.style.visibility = "hidden";
            });
            try {
              await d.page.screenshot({ path: path.join(SROOT, file), timeout: 120000 });
              shots.push(path.join(SROOT, file));
            } catch (err) {
              shots.push(`${file} — CAPTURE FAILED: ${String(err).split("\n")[0]}`);
            }
            await d.run(() => {
              window.__vs?.pause?.(false);
              const c = document.getElementById("stage");
              if (c) c.style.visibility = "";
            });
          }
          const sentinel = await d.run(() => (document.getElementById("overlay")?.innerText ?? "").includes("‹"));
          if (sentinel) throw new Error(`${lang}: a ‹key› sentinel is on screen`);
        }
      ));
    }
  }

  // C13 — the probe verify reads
  {
    const rows = {};
    let bad = 0;
    for (const l of LOCALES) {
      const p = probes[l];
      const ok = p && p.locale === l && Array.isArray(p.missing) && p.missing.length === 0 && p.keys === flat.en.length;
      rows[l] = p ? { locale: p.locale, keys: p.keys, missing: p.missing.length, rendered: p.rendered, sample: p.sample } : null;
      if (!ok) bad++;
    }
    claim(
      "C13 PROBE-CLEAN",
      "the live i18n probe reports the requested locale and zero missing strings",
      `locale matches and missing.length == 0, keys == ${flat.en.length}`,
      bad === 0,
      { locales: rows }
    );
  }

  // C14 — layout, in real laid-out pixels
  {
    const rows = {};
    let bad = 0;
    let worst = { px: 0, where: null };
    for (const [id, boxes] of Object.entries(layouts)) {
      if (!boxes) { rows[id] = "no proof surface"; bad++; continue; }
      const over = boxes.filter((b) => b.overflowX > 0 || b.overflowY > 0 || b.offViewport > 0);
      for (const b of boxes) {
        const px = Math.max(b.overflowX, b.overflowY, b.offViewport);
        if (px > worst.px) worst = { px, where: `${id} ${b.id} (${b.key})` };
      }
      rows[id] = { boxes: boxes.length, overflowing: over.length,
        sample: over.slice(0, 4).map((b) => `${b.id}/${b.key}: +${b.overflowX}px`) };
      if (over.length) bad++;
    }
    claim(
      "C14 NO-LAYOUT-BREAK",
      "the longest string of every register fits its box at 1600×900 and 1280×720, in all three locales",
      "0 px of overflow anywhere",
      bad === 0,
      { worstOverflowPx: worst.px, worstAt: worst.where, cells: rows }
    );
  }

  // C15 — the proof surface is off by default (G8)
  {
    let visible = null;
    await openGame({ lang: "pl", width: 1280, height: 720 }, async (d) => {
      await d.play(0.6);
      visible = await d.run(() => !!document.querySelector(".vs-i18nproof"));
    });
    claim(
      "C15 PROOF-OFF-BY-DEFAULT",
      "the measurement overlay never appears without ?i18nproof=1 (G8: no debug labels in a player frame)",
      "absent from the DOM",
      visible === false,
      { presentWithoutFlag: visible }
    );
  }

  live.foreignErrors = foreignErrors;
  live.shots = shots;
}

// ---------------------------------------------------------------- report

const failed = claims.filter((c) => !c.pass);
console.log(JSON.stringify({ piece: "P20", offline: OFFLINE, claims, live }, null, 2));
console.log("\n" + "-".repeat(78));
for (const c of claims) {
  console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.id.padEnd(24)} ${c.threshold}`);
}
console.log("-".repeat(78));
console.log(`${claims.length - failed.length}/${claims.length} claims pass`);
if (live.ran) {
  const foreign = new Set(Object.values(live.foreignErrors ?? {}).flat());
  if (foreign.size) {
    console.log(`\nNOTE — ${foreign.size} boot error(s) from modules P20 does not own (reported, not attributed):`);
    for (const e of foreign) console.log("  · " + e);
  }
}
if (failed.length) process.exit(1);
