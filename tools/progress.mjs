#!/usr/bin/env node
// Regenerates the live progress page from the piece manifest plus one status file per piece.
//
// Status is split per piece on purpose: many agents write concurrently, and a single shared
// status document would be corrupted the moment two of them saved at once.
//
//   progress/status/<PIECE_ID>.json   { state, round, gap, note, evidence[], updated }
//   progress/log.jsonl                append-only event feed (one JSON object per line)
//
// Usage: node tools/progress.mjs

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "design/pieces.json"), "utf8"));
const statusDir = path.join(ROOT, "progress/status");
fs.mkdirSync(statusDir, { recursive: true });

const STATE = {
  todo: { label: "queued", tone: "idle" },
  building: { label: "building", tone: "work" },
  critique: { label: "in critique", tone: "judge" },
  revising: { label: "revising", tone: "work" },
  passed: { label: "passed", tone: "good" },
  blocked: { label: "blocked", tone: "bad" },
};

function statusFor(id) {
  const f = path.join(statusDir, `${id}.json`);
  if (!fs.existsSync(f)) return { state: "todo", round: 0 };
  try {
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {
    return { state: "todo", round: 0, note: "status file unreadable" };
  }
}

function readLog(limit = 60) {
  const f = path.join(ROOT, "progress/log.jsonl");
  if (!fs.existsSync(f)) return [];
  return fs
    .readFileSync(f, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .slice(-limit)
    .reverse();
}

function latestShots(limit = 8) {
  const dir = path.join(ROOT, "review/shots");
  if (!fs.existsSync(dir)) return [];
  const walk = (d) =>
    fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) return walk(p);
      return e.name.endsWith(".png") ? [p] : [];
    });
  return walk(dir)
    .map((p) => ({ p, m: fs.statSync(p).mtimeMs }))
    .sort((a, b) => b.m - a.m)
    .slice(0, limit)
    .map((x) => ({
      rel: path.relative(ROOT, x.p).replace(/\\/g, "/"),
      when: new Date(x.m).toISOString().slice(11, 19),
    }));
}

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const pieces = manifest.pieces.map((p) => ({ ...p, status: statusFor(p.id) }));
const passed = pieces.filter((p) => p.status.state === "passed").length;
const active = pieces.filter((p) => ["building", "critique", "revising"].includes(p.status.state));
const rounds = pieces.reduce((a, p) => a + (p.status.round || 0), 0);
const pct = Math.round((passed / pieces.length) * 100);

const waveRows = manifest.waves
  .map((w) => {
    const items = pieces.filter((p) => p.wave === w.id);
    const done = items.filter((p) => p.status.state === "passed").length;
    const cards = items
      .map((p) => {
        const st = STATE[p.status.state] ?? STATE.todo;
        return `<article class="card ${st.tone}">
        <header><span class="pid">${esc(p.id)}</span><span class="pill ${st.tone}">${esc(st.label)}${
          p.status.round ? ` · r${p.status.round}` : ""
        }</span></header>
        <h4>${esc(p.title)}</h4>
        ${p.status.gap ? `<p class="gap"><b>biggest gap</b> ${esc(p.status.gap)}</p>` : ""}
        ${p.status.note ? `<p class="note">${esc(p.status.note)}</p>` : ""}
        <p class="judge">${esc(p.judge)}</p>
      </article>`;
      })
      .join("");
    return `<section class="wave">
      <h3><span>${esc(w.id)} · ${esc(w.name)}</span><em>${done}/${items.length}</em></h3>
      <p class="wnote">${esc(w.note)}</p>
      <div class="grid">${cards}</div>
    </section>`;
  })
  .join("");

const shots = latestShots();
const shotHtml = shots.length
  ? `<div class="shots">${shots
      .map(
        (s) =>
          `<figure><img src="${esc(s.rel)}" loading="lazy" alt=""><figcaption>${esc(
            s.rel.replace("review/shots/", "")
          )} · ${esc(s.when)}</figcaption></figure>`
      )
      .join("")}</div>`
  : `<p class="empty">No captures yet.</p>`;

const logHtml = readLog()
  .map(
    (e) =>
      `<li><time>${esc((e.t || "").slice(11, 19))}</time><span class="lid">${esc(
        e.piece || "—"
      )}</span><span class="lmsg">${esc(e.msg)}</span></li>`
  )
  .join("");

const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="25">
<title>${esc(manifest.project)} — build progress</title>
<style>
:root{--bg:#070d13;--panel:#0d1720;--line:#1d2b38;--ink:#e6f4f8;--dim:#8ba3b0;
--good:#6ee7a8;--work:#79dfff;--judge:#ffc46b;--bad:#ff8095;--idle:#4a5f6d;--accent:#79f0e4}
*{box-sizing:border-box}
body{margin:0;background:radial-gradient(1200px 700px at 70% -10%,#12283a 0%,var(--bg) 60%);
color:var(--ink);font:15px/1.5 "Inter","Segoe UI",system-ui,sans-serif;padding:28px clamp(16px,4vw,56px) 80px}
h1{font-size:clamp(24px,3vw,36px);margin:0;letter-spacing:.01em}
h1 small{display:block;font-size:14px;color:var(--dim);font-weight:400;margin-top:6px}
.top{display:flex;flex-wrap:wrap;gap:24px;align-items:flex-end;justify-content:space-between;
border-bottom:1px solid var(--line);padding-bottom:20px;margin-bottom:24px}
.stats{display:flex;gap:28px;flex-wrap:wrap}
.stat b{display:block;font-size:26px;color:var(--accent);font-variant-numeric:tabular-nums}
.stat span{font-size:12px;color:var(--dim);text-transform:uppercase;letter-spacing:.12em}
.bar{height:8px;border-radius:6px;background:#152230;overflow:hidden;margin-top:16px}
.bar i{display:block;height:100%;background:linear-gradient(90deg,var(--accent),#9d8dff);width:${pct}%}
.wave{margin:34px 0}
.wave h3{display:flex;justify-content:space-between;align-items:baseline;font-size:16px;
letter-spacing:.14em;text-transform:uppercase;color:var(--dim);margin:0 0 2px}
.wave h3 em{font-style:normal;color:var(--accent);font-variant-numeric:tabular-nums}
.wnote{margin:0 0 14px;color:#66808e;font-size:13px}
.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(285px,1fr))}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:13px 15px;
border-left-width:3px}
.card.good{border-left-color:var(--good)}.card.work{border-left-color:var(--work)}
.card.judge{border-left-color:var(--judge)}.card.bad{border-left-color:var(--bad)}
.card.idle{border-left-color:var(--idle);opacity:.72}
.card header{display:flex;justify-content:space-between;align-items:center;gap:8px}
.pid{font:600 11px var(--mono,ui-monospace,monospace);color:var(--dim);letter-spacing:.1em}
.pill{font-size:10.5px;text-transform:uppercase;letter-spacing:.1em;padding:3px 8px;border-radius:99px;
background:#16242f;color:var(--dim)}
.pill.good{color:var(--good)}.pill.work{color:var(--work)}.pill.judge{color:var(--judge)}.pill.bad{color:var(--bad)}
.card h4{margin:8px 0 6px;font-size:15px;line-height:1.3}
.judge{margin:8px 0 0;font-size:12px;color:#5f7a88}
.gap{margin:6px 0;font-size:12.5px;color:#ffd0a8}
.note{margin:6px 0;font-size:12.5px;color:#a9c3cf}
.shots{display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(320px,1fr))}
.shots img{width:100%;border-radius:10px;border:1px solid var(--line);display:block;background:#000}
.shots figcaption{font-size:11px;color:var(--dim);margin-top:5px;font-family:ui-monospace,monospace}
.feed{list-style:none;padding:0;margin:0;max-height:340px;overflow:auto;
border:1px solid var(--line);border-radius:12px;background:var(--panel)}
.feed li{display:grid;grid-template-columns:64px 56px 1fr;gap:10px;padding:7px 14px;
border-bottom:1px solid #131f2a;font-size:12.5px}
.feed time{color:#5c7482;font-family:ui-monospace,monospace}
.lid{color:var(--accent);font-family:ui-monospace,monospace}
.lmsg{color:#b9ced8}
h2{font-size:13px;letter-spacing:.16em;text-transform:uppercase;color:var(--dim);
margin:38px 0 12px;border-top:1px solid var(--line);padding-top:22px}
.empty{color:var(--dim);font-size:13px}
</style></head><body>
<div class="top">
  <h1>${esc(manifest.project)}<small>${esc(manifest.tagline)}</small></h1>
  <div class="stats">
    <div class="stat"><b>${passed}/${pieces.length}</b><span>pieces passed</span></div>
    <div class="stat"><b>${active.length}</b><span>in flight</span></div>
    <div class="stat"><b>${rounds}</b><span>critic rounds</span></div>
    <div class="stat"><b>${new Date().toISOString().slice(11, 16)}Z</b><span>updated</span></div>
  </div>
</div>
<div class="bar"><i></i></div>
${waveRows}
<h2>Latest real captures</h2>
${shotHtml}
<h2>Activity</h2>
<ul class="feed">${logHtml || "<li><time>—</time><span class='lid'>—</span><span class='lmsg'>nothing logged yet</span></li>"}</ul>
</body></html>`;

fs.writeFileSync(path.join(ROOT, "progress.html"), html);
console.log(`progress.html — ${passed}/${pieces.length} passed, ${active.length} active, ${rounds} rounds`);
