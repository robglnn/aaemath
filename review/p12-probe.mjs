// Scratch: does the SCENE render differently into a render target than it does to the canvas?
// Reads the same pixels out of both, converts the linear target values through the CPU mirror of
// the shipped display transform, and prints them side by side.
import { openGame, arg } from "../tools/lib/session.mjs";

const width = Number(arg("width", "960"));
const height = Number(arg("height", "540"));

await openGame({ width, height, built: true }, async (d) => {
  await d.play(1.0);
  await d.look(200, -60);
  await d.play(0.25);
  const out = await d.run(() => {
    const k = window.__vs.kernel;
    const gl = k.renderer.getContext();
    const stack = k.get("post");
    k.halt();

    const W = stack.size.x;
    const H = stack.size.y;
    const pts = [
      [880, 420],
      [900, 300],
      [700, 250],
      [480, 120],
      [300, 200],
    ].map(([x, y]) => [Math.min(W - 1, x), Math.min(H - 1, y)]);

    // 1. scene into the composer's half-float target, read back linear
    k.renderer.setRenderTarget(stack.sceneTarget);
    k.renderer.render(k.scene, k.camera);
    const h2f = (h) => {
      const s = (h & 0x8000) >> 15;
      const e = (h & 0x7c00) >> 10;
      const f = h & 0x3ff;
      if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
      if (e === 0x1f) return NaN;
      return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
    };
    const buf = new Uint16Array(4);
    const rt = pts.map(([x, y]) => {
      k.renderer.readRenderTargetPixels(stack.sceneTarget, x, H - 1 - y, 1, 1, buf);
      return [h2f(buf[0]), h2f(buf[1]), h2f(buf[2])];
    });

    // 2. scene straight to the canvas, read back the 8-bit codes before the frame is composited
    k.renderer.setRenderTarget(null);
    k.renderer.render(k.scene, k.camera);
    const px = new Uint8Array(4);
    const canvas = pts.map(([x, y]) => {
      gl.readPixels(x, H - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return [px[0], px[1], px[2]];
    });

    const enc = (v) => {
      const x = Math.min(1, Math.max(0, v));
      return Math.round(255 * (x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055));
    };
    return {
      toneMapping: k.renderer.toneMapping,
      outputColorSpace: k.renderer.outputColorSpace,
      samples: stack.sceneTarget.samples,
      rows: pts.map((p, i) => ({
        px: p,
        rtLinear: rt[i].map((v) => Number(v.toFixed(5))),
        rtEncoded: rt[i].map(enc),
        canvasCodes: canvas[i],
      })),
    };
  });
  console.log(JSON.stringify(out, null, 1));
});
