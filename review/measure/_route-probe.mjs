// Scratch: project a candidate carry route through the measured arrival camera.
// Uses the level's own design formulas (baseY + the pads that matter on the route) as an
// approximation of terrain.groundAt; the real number comes from review/measure/P09.mjs.
const TILT = Math.tan((7 * Math.PI) / 180);
const baseY = (aX) => 12 - TILT * aX;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smoothstep = (a, b, t) => { const x = clamp((t - a) / (b - a || 1e-6), 0, 1); return x * x * (3 - 2 * x); };
const lerp = (a, b, t) => a + (b - a) * t;
const pad = (aX, aZ, x0, x1, z0, z1, f) =>
  smoothstep(x0 - f, x0 + f, aX) * (1 - smoothstep(x1 - f, x1 + f, aX)) *
  smoothstep(z0 - f, z0 + f, aZ) * (1 - smoothstep(z1 - f, z1 + f, aZ));

function ground(aX, aZ) {
  let h = baseY(aX);
  const bowl = pad(aX, aZ, -336, -264, -140, 165, 24);
  h = lerp(h, 30, bowl * 0.95);
  const brow = pad(aX, aZ, -260, -206, -170, 180, 20);
  h += brow * 20;
  const crest = pad(aX, aZ, -300, -110, -172, -34, 30);
  h += crest * 22; // ridged() averages ~0.27 -> ~10+12
  const shelf = pad(aX, aZ, -132, -48, -110, -20, 15);
  h = lerp(h, baseY(-90) + 2.0, shelf);
  const wob2 = Math.sin(aZ * 0.021) * 14 + Math.sin(aZ * 0.052 + 1.3) * 6;
  const scarp = (x0, x1, x2, x3, rise, w) => rise * smoothstep(x0, x1, aX + w) * (1 - smoothstep(x2, x3, aX + w));
  h += scarp(-136, -112, -74, -40, 11, wob2);
  h += scarp(120, 140, 150, 168, 8, wob2 * 0.6);
  const knuckle = pad(aX, aZ, 26, 106, -96, -8, 22);
  h += knuckle * 29;
  const terrace = pad(aX, aZ, -30, 78, -40, 104, 24);
  h = lerp(h, baseY(24) - 1.2, terrace * 0.85);
  const shoulder = pad(aX, aZ, -150, 30, 126, 214, 30);
  h += shoulder * 17;
  return h;
}

const CAM = { x: 11.15, y: 60.61, z: 219.25, fovY: 62, W: 1600, H: 900 };
const pxPerRad = CAM.H / (2 * Math.tan((CAM.fovY * Math.PI) / 360));
const pxPerRadX = pxPerRad; // same focal length in both axes
const horizonRow = 367.3;

const W = (aX, aZ) => [aZ, -aX];

const route = JSON.parse(process.argv[2]);
const width = Number(process.argv[3] ?? 44);
const widthAt = (t) => width * (0.48 + 0.70 * Math.sin(Math.PI * Math.pow(t, 0.9)));
const brim = Number(process.argv[4] ?? 2.6);

let total = 0;
for (let i = 1; i < route.length; i++) total += Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]);

console.log("len(m)", total.toFixed(0), " width base", width);
console.log(
  ["i", "aX", "aZ", "dist", "offAxis°", "row", "col", "depr°", "phi°", "w(m)", "vpx"].map((s) => s.padStart(8)).join("")
);
let acc = 0;
for (let i = 0; i < route.length; i++) {
  const [aX, aZ] = route[i];
  if (i > 0) acc += Math.hypot(aX - route[i - 1][0], aZ - route[i - 1][1]);
  const t = acc / total;
  const [wx, wz] = W(aX, aZ);
  const gy = ground(aX, aZ) + brim;
  const dx = wx - CAM.x, dy = gy - CAM.y, dz = wz - CAM.z;
  const flat = Math.hypot(dx, dz);
  const dist = Math.hypot(flat, dy);
  const offAxis = (Math.atan2(dx, -dz) * 180) / Math.PI;
  const depr = (Math.atan2(-dy, flat) * 180) / Math.PI;
  const row = horizonRow + Math.tan(Math.atan2(-dy, flat)) * pxPerRad;
  const col = CAM.W / 2 + Math.tan(Math.atan2(dx, -dz)) * pxPerRadX;
  // segment tangent in plan (world)
  const j = i === route.length - 1 ? i - 1 : i;
  const seg = [W(route[j + 1][0], route[j + 1][1])[0] - W(route[j][0], route[j][1])[0],
               W(route[j + 1][0], route[j + 1][1])[1] - W(route[j][0], route[j][1])[1]];
  const sl = Math.hypot(seg[0], seg[1]) || 1;
  const viewDir = [dx / flat, dz / flat];
  const cosPhi = Math.abs((seg[0] / sl) * viewDir[0] + (seg[1] / sl) * viewDir[1]);
  const phi = (Math.acos(clamp(cosPhi, -1, 1)) * 180) / Math.PI;
  const w = widthAt(t);
  const vpx = (w * Math.sin((phi * Math.PI) / 180) * Math.sin(Math.abs((depr * Math.PI) / 180)) / dist) * pxPerRad;
  console.log(
    [i, aX, aZ, dist.toFixed(0), offAxis.toFixed(1), row.toFixed(0), col.toFixed(0), depr.toFixed(1), phi.toFixed(0), w.toFixed(1), vpx.toFixed(0)]
      .map((s) => String(s).padStart(8)).join("")
  );
}
