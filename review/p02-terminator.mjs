import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const b64 = readFileSync('reference/brief-hero.png').toString('base64');
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<canvas id=c></canvas>');
const r = await page.evaluate(async ({ b64 }) => {
  const img=new Image();img.src='data:image/png;base64,'+b64;await img.decode();
  const W=img.naturalWidth,H=img.naturalHeight,c=document.getElementById('c');
  c.width=W;c.height=H;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0);
  const D=ctx.getImageData(0,0,W,H).data;
  const L=new Float32Array(256);for(let i=0;i<256;i++){const v=i/255;L[i]=v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4);}
  const lum=(r,g,b)=>0.2126*L[r]+0.7152*L[g]+0.0722*L[b];
  const hsv=(r,g,b)=>{const mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn;if(!d)return[0,0,mx/255];let h;if(mx===r)h=60*(((g-b)/d)%6);else if(mx===g)h=60*((b-r)/d+2);else h=60*((r-g)/d+4);return[h<0?h+360:h,d/mx,mx/255];};
  const at=(x,y)=>{const i=((y|0)*W+(x|0))*4;return[D[i],D[i+1],D[i+2]];};
  const hex=p=>'#'+p.map(z=>z.toString(16).padStart(2,'0')).join('');
  const cut=(name,x0,x1,yn,step)=>{const out=[];const y=Math.floor(yn*H);
    for(let xn=x0;xn<=x1;xn+=step){const p=at(Math.floor(xn*W),y);const[h,s,v]=hsv(...p);
      out.push({x:+xn.toFixed(4),hex:hex(p),h:Math.round(h),s:+s.toFixed(2),Y:+lum(...p).toFixed(4)});}
    return{name,samples:out};};
  return [
    cut('plinth terminator (lit top -> cast shadow)',0.560,0.640,0.760,0.0035),
    cut('plinth right edge (shadow -> hot lit rim)',0.680,0.730,0.735,0.0025),
    cut('terrace right (lit -> shadow face)',0.860,0.900,0.560,0.0025)
  ];
},{b64});
await browser.close();
for(const c of r){console.log('\n== '+c.name);for(const s of c.samples)console.log('  ',s.x,s.hex,'hue',String(s.h).padStart(3),'S',s.s,'Y',s.Y);}
