import { openGame } from "../../tools/lib/session.mjs";
import { installToolkit } from "./p11-toolkit.mjs";
await openGame({ width: 1280, height: 720, tier: "medium" }, async (d) => {
  await d.page.route("**/@vite/client*", (r) => r.fulfill({ status:200, contentType:"text/javascript", body:"export const createHotContext = () => ({on(){},send(){},accept(){},dispose(){},prune(){},invalidate(){},decline(){}}); export const injectQuery=(u)=>u; export const removeStyle=()=>{}; export const updateStyle=()=>{};" }));
  await d.page.reload({ waitUntil: "load" });
  await d.page.waitForFunction(() => window.__vs && (window.__vs.ready || window.__vs.fatal));
  await d.run(() => { window.__vs.kernel.composer = null; });
  await d.play(0.5);
  await d.run(() => window.__vs.kernel.byName.get("lighting").materialBoard({ view: "wide" }));
  await d.page.evaluate(installToolkit);
  await d.play(0.3);
  await d.run(() => window.__p11.grab());
  const out = await d.run(() => {
    const T = window.__p11;
    const L = T.lighting;
    const mat = T.meshByName("vs.board.shelf").material;
    const faces = T.faces("vs.board.shelf");
    const rows = faces.slice(0, 200).filter(f=>f.area>2).sort((a,b)=>b.ndl-a.ndl).slice(0,8).map(f => {
      const p = T.box(f.x, f.y, 2);
      const [h,s,v] = T.hsv(...p);
      return { ndl: +f.ndl.toFixed(3), ny: +f.ny.toFixed(3), px: p, hue: +h.toFixed(1), S: +s.toFixed(3), Y: +T.lum(...p).toFixed(4) };
    });
    return {
      groundAlbedoLinear: [mat.color.r, mat.color.g, mat.color.b].map(v=>+v.toFixed(4)),
      groundAlbedoHex: "#" + mat.color.getHexString("srgb").toUpperCase(),
      fill: { c: [L.fill.color.r, L.fill.color.g, L.fill.color.b].map(v=>+v.toFixed(4)), i: +L.fill.intensity.toFixed(4), g: [L.fill.groundColor.r,L.fill.groundColor.g,L.fill.groundColor.b].map(v=>+v.toFixed(4)) },
      key: { c: [L.key.color.r, L.key.color.g, L.key.color.b].map(v=>+v.toFixed(4)), i: +L.key.intensity.toFixed(4) },
      nFaces: faces.length,
      top: rows,
      albedos: window.__vs.probe("lighting").materials.albedos,
    };
  });
  console.log(JSON.stringify(out, null, 1));
});
