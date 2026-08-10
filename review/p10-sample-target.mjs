// P10 scratch: sample the binding target's sky so the gradient stops are measured, not guessed.
import { readPNG, px, hex, hsv } from "./p02-png.mjs";

const img = readPNG("reference/target-lowpoly.png");
console.log(`target ${img.width}x${img.height}`);

// Horizon: find the row where the far-right open sky stops being sky. Scan a column in the
// clear right-of-centre gap (x ~ 0.56W) which in the target is open sky down to the far ridge.
const cols = [0.06, 0.30, 0.42, 0.56, 0.72, 0.90];

function colReport(fx, label) {
  const x = Math.round(fx * img.width);
  const rows = [];
  for (let fy = 0; fy <= 0.40; fy += 0.0125) {
    const y = Math.min(img.height - 1, Math.round(fy * img.height));
    const [r, g, b] = px(img, x, y);
    const [h, s, v] = hsv(r, g, b);
    rows.push(
      `  y=${fy.toFixed(3)} (${y})  ${hex(r, g, b)}  H${h.toFixed(0).padStart(3)} S${s.toFixed(3)} V${v.toFixed(3)}`
    );
  }
  console.log(`\n--- column x=${(fx * 100).toFixed(0)}% ${label}`);
  console.log(rows.join("\n"));
}

for (const c of cols) colReport(c, "");

// Cloud sample: pick the bright cloud slab pixels near y=0.10, x=0.28
console.log("\n--- cloud slab probes");
for (const [fx, fy, name] of [
  [0.28, 0.098, "left cloud bright"],
  [0.29, 0.115, "left cloud lower"],
  [0.36, 0.132, "mid cloud"],
  [0.66, 0.075, "right upper cloud"],
  [0.62, 0.100, "right cloud 2"],
  [0.80, 0.150, "right dark streak"],
  [0.55, 0.06, "clear sky between"],
  [0.50, 0.255, "sun glow core"],
  [0.52, 0.30, "sun core low"],
  [0.16, 0.25, "left sky mid"],
]) {
  const x = Math.round(fx * img.width);
  const y = Math.round(fy * img.height);
  const [r, g, b] = px(img, x, y);
  const [h, s, v] = hsv(r, g, b);
  console.log(
    `  ${name.padEnd(20)} (${x},${y}) ${hex(r, g, b)} H${h.toFixed(0)} S${s.toFixed(3)} V${v.toFixed(3)}`
  );
}
