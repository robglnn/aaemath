// Throwaway diagnostic: which stage of a 15-deep nested fraction takes the renderer down?
// Each stage is its own page.evaluate, so the last line printed names the survivor.
// Run: node review/measure/_p15sweep.mjs
import { openGame } from "../../tools/lib/session.mjs";

const frac = (n) => "\\frac{1}{".repeat(n) + "2" + "}".repeat(n);
const DEPTH = Number(process.argv[2] || 15);

await openGame({ width: 1200, height: 700, lang: "en", tier: "low" }, async (d) => {
  await d.play(0.5);
  const tex = frac(DEPTH);
  console.log(`depth=${DEPTH} chars=${tex.length}`);

  const a = await d.run(async ([t, url]) => {
    const T = await import(url);
    const t0 = performance.now();
    const rec = T.render(t, { locale: "en", displayMode: true });
    window.__probeHtml = rec.html;
    return { stage: "katex", ok: rec.ok, htmlLen: rec.html.length, ms: Number((performance.now() - t0).toFixed(1)) };
  }, [tex, "/src/math/Tex.js"]);
  console.log(JSON.stringify(a));

  const b = await d.run(() => {
    const div = document.createElement("div");
    div.innerHTML = window.__probeHtml;
    window.__probeDiv = div;
    return { stage: "parse-html-detached", nodes: div.querySelectorAll("*").length };
  });
  console.log(JSON.stringify(b));

  const c = await d.run(() => {
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:-32768px;top:0;white-space:nowrap;font-size:48px;line-height:1.2;";
    host.appendChild(window.__probeDiv);
    document.body.appendChild(host);
    window.__probeHost = host;
    return { stage: "attached-no-layout-read" };
  });
  console.log(JSON.stringify(c));

  const e = await d.run(() => {
    const r = window.__probeHost.getBoundingClientRect();
    return { stage: "layout", w: Math.round(r.width), h: Math.round(r.height) };
  });
  console.log(JSON.stringify(e));

  const f = await d.run(() => {
    let n = 0;
    const walk = (el) => {
      getComputedStyle(el);
      el.getBoundingClientRect();
      n++;
      for (const k of el.children) walk(k);
    };
    walk(window.__probeHost);
    return { stage: "computed-style-walk", visited: n };
  });
  console.log(JSON.stringify(f));
});
