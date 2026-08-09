import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
const b64 = readFileSync('reference/brief-hero.png').toString('base64');
const browser = await chromium.launch(); const page = await browser.newPage();
await page.setContent('<canvas id=c></canvas>');
const r = await page.evaluate(async ({b64})=>{
  const img=new Image();img.src='data:image/png;base64,'+b64;await img.decode();
  const W=img.naturalWidth,H=img.naturalHeight,c=document.getElementById('c');
  c.width=W;c.height=H;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0);
  const D=ctx.getImageData(0,0,W,H).data;
  const L=new Float32Array(256);for(let i=0;i<256;i++){const v=i/255;L[i]=v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4);}
  const lum=(r,g,b)=>0.2126*L[r]+0.7152*L[g]+0.0722*L[b];
  const at=(x,y)=>{const i=((y|0)*W+(x|0))*4;return[D[i],D[i+1],D[i+2]];};
  // The hero is bounded by a near-black ink contour. For each row inside his band,
  // find the leftmost and rightmost ink pixel (Y<0.02) between x 0.27 and 0.44.
  const rows=[];
  for(let yn=0.27;yn<=0.96;yn+=0.005){
    const y=Math.floor(yn*H); let lo=null,hi=null;
    for(let x=Math.floor(0.27*W);x<Math.floor(0.45*W);x++){
      if(lum(...at(x,y))<0.020){ if(lo===null)lo=x; hi=x; }
    }
    if(lo===null)continue;
    rows.push({y:+yn.toFixed(3),x0:+(lo/W).toFixed(4),x1:+(hi/W).toFixed(4),w:+((hi-lo)/W).toFixed(4)});
  }
  return {rows, W, H};
},{b64});
await browser.close();
const rows=r.rows;
const at=(y)=>rows.reduce((b,o)=>Math.abs(o.y-y)<Math.abs(b.y-y)?o:b,rows[0]);
console.log('rows sampled', rows.length);
for(const y of [0.28,0.30,0.32,0.34,0.36,0.38,0.40,0.42,0.44,0.46,0.48,0.50,0.52,0.55,0.58,0.60,0.62,0.65,0.68,0.70,0.75,0.80,0.85,0.90,0.94]){
  const o=at(y); console.log('  y='+y.toFixed(2),'x',o.x0,'..',o.x1,'width',o.w);
}
const widest=rows.reduce((b,o)=>o.w>b.w?o:b);
console.log('\nwidest row', JSON.stringify(widest));
console.log('extent x', Math.min(...rows.map(o=>o.x0)).toFixed(4), '..', Math.max(...rows.map(o=>o.x1)).toFixed(4));
console.log('extent y', rows[0].y, '..', rows[rows.length-1].y);
