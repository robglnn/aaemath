import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const b64 = readFileSync('reference/brief-hero.png').toString('base64');
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<canvas id=c></canvas>');
const r = await page.evaluate(async ({ b64 }) => {
  const img = new Image(); img.src='data:image/png;base64,'+b64; await img.decode();
  const W=img.naturalWidth,H=img.naturalHeight,c=document.getElementById('c');
  c.width=W;c.height=H;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0);
  const D=ctx.getImageData(0,0,W,H).data;
  const L=new Float32Array(256);for(let i=0;i<256;i++){const v=i/255;L[i]=v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4);}
  const lum=(r,g,b)=>0.2126*L[r]+0.7152*L[g]+0.0722*L[b];
  const hsv=(r,g,b)=>{const mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn;if(!d)return[0,0];let h;if(mx===r)h=60*(((g-b)/d)%6);else if(mx===g)h=60*((b-r)/d+2);else h=60*((r-g)/d+4);return[h<0?h+360:h,d/mx];};
  let n=0,cool=0,warm=0,other=0; const bins=new Array(36).fill(0);
  // also: same census restricted to the FOREGROUND band only (y>0.62), which is where
  // a shader author actually controls the shadow tint
  let nf=0,coolf=0;
  for(let y=0;y<H;y+=2)for(let x=0;x<W;x+=2){
    const i=(y*W+x)*4,r0=D[i],g0=D[i+1],b0=D[i+2];
    const Y=lum(r0,g0,b0);const[h,s]=hsv(r0,g0,b0);
    if(Y<0.02||Y>0.12||s<0.10)continue;
    n++;bins[Math.floor(h/10)%36]++;
    const isCool=(h>=185&&h<=320);
    if(isCool)cool++;else if(h<60||h>=320)warm++;else other++;
    if(y/H>0.62){nf++;if(isCool)coolf++;}
  }
  return {n,coolShare:+(cool/n).toFixed(4),warmShare:+(warm/n).toFixed(4),otherShare:+(other/n).toFixed(4),
    fgN:nf,fgCoolShare:+(coolf/Math.max(1,nf)).toFixed(4),
    bins:bins.map((v,i)=>({h:i*10,pct:+(100*v/n).toFixed(2)})).filter(o=>o.pct>0.3)};
},{b64});
await browser.close();
console.log(JSON.stringify(r,null,1));
