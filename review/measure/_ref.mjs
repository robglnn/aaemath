import { readPNG, px, hsv, lum, hex } from "../p02-png.mjs";
const img = readPNG("reference/target-lowpoly.png");
console.log("size", img.width, img.height);
const boxMed = (x0,y0,x1,y1) => {
  const rs=[],gs=[],bs=[];
  for (let y = Math.round(y0*img.height); y < Math.round(y1*img.height); y++)
    for (let x = Math.round(x0*img.width); x < Math.round(x1*img.width); x++){
      const p = px(img,x,y); rs.push(p[0]);gs.push(p[1]);bs.push(p[2]);
    }
  const m=a=>a.sort((u,v)=>u-v)[a.length>>1];
  const r=m(rs),g=m(gs),b=m(bs);
  const [h,s,v]=hsv(r,g,b);
  return `${hex(r,g,b)} hue ${h.toFixed(1)} S ${s.toFixed(3)} V ${v.toFixed(3)} Y ${lum(r,g,b).toFixed(4)}`;
};
const spots = {
  "ground right of feet (§3.2 lit box)": [0.545,0.760,0.575,0.790],
  "ground in cast shadow (§3.4 box)":    [0.530,0.920,0.570,0.950],
  "ground far right of courier":          [0.62,0.74,0.66,0.77],
  "ground foreground centre":             [0.44,0.86,0.50,0.90],
  "ground mid-left of courier":           [0.36,0.80,0.42,0.84],
  "spire lit plane":                      [0.100,0.235,0.140,0.250],
  "spire turned plane":                   [0.055,0.30,0.075,0.36],
  "plain beyond the river":               [0.60,0.55,0.68,0.58],
  "river cyan":                           [0.60,0.60,0.63,0.615],
  "crystal cluster":                      [0.39,0.37,0.42,0.40],
  "armour shadow":                        [0.475,0.44,0.495,0.48],
  "sky mid":                              [0.30,0.10,0.40,0.13],
};
for (const [k,b] of Object.entries(spots)) console.log(k.padEnd(36), boxMed(...b));

// whole-frame warm-lit share
let warm=0,cool=0,tot=0;
for (let y=0;y<img.height;y+=2) for (let x=0;x<img.width;x+=2){
  const p=px(img,x,y); const [h,s,v]=hsv(p[0],p[1],p[2]); const Y=lum(p[0],p[1],p[2]); tot++;
  if (h>=20&&h<=50&&s>=0.40&&Y>=0.08) warm++;
  if (h>=150&&h<=200&&v>=0.80&&s>=0.25) cool++;
}
console.log("warm-lit share", (warm/tot*100).toFixed(2)+"%", " cyan accent share", (cool/tot*100).toFixed(2)+"%");
