#!/usr/bin/env node
// P02 round-2 inspection crops. node review/p02-crop2.mjs
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
const ROOT = process.cwd();
const b64 = readFileSync(path.join(ROOT,'reference','brief-hero.png')).toString('base64');
mkdirSync(path.join(ROOT,'review','p02-crops'),{recursive:true});
const CROPS = [
  ['hero-torso',0.276,0.270,0.430,0.700,4],['hero-upper',0.276,0.270,0.430,0.520,6],['legs',        0.270,0.680,0.440,0.975, 3],
  ['band-left',   0.010,0.820,0.360,0.985, 3],
  ['band-full',   0.000,0.825,1.000,0.990, 1],
  ['holo-leftedge',0.455,0.250,0.560,0.500, 4],
  ['holo-rightedge',0.720,0.230,0.800,0.560, 4],
  ['holo-topedge',0.520,0.215,0.760,0.300, 3],
  ['terrace-right',0.840,0.440,0.960,0.650, 4],
  ['socket',      0.540,0.620,0.760,0.820, 3],
  ['ruins-left',  0.090,0.140,0.290,0.300, 3],
  ['foliage',     0.060,0.400,0.560,0.680, 2]
];
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<canvas id=c></canvas>');
const outs = await page.evaluate(async ({b64,CROPS}) => {
  const img=new Image(); img.src='data:image/png;base64,'+b64; await img.decode();
  const W=img.naturalWidth,H=img.naturalHeight;
  const res={};
  for (const [name,u0,v0,u1,v1,z] of CROPS){
    const sx=Math.round(u0*W),sy=Math.round(v0*H),sw=Math.round((u1-u0)*W),sh=Math.round((v1-v0)*H);
    const c=document.createElement('canvas'); c.width=Math.round(sw*z); c.height=Math.round(sh*z);
    const x=c.getContext('2d'); x.imageSmoothingEnabled=false;
    x.drawImage(img,sx,sy,sw,sh,0,0,c.width,c.height);
    res[name]=c.toDataURL('image/png').split(',')[1];
  }
  // thumbnails at 64 and 128 tall, upscaled 6x nearest for viewing
  for (const th of [64,128]){
    const tw=Math.round(W*th/H);
    const t=document.createElement('canvas'); t.width=tw;t.height=th;
    t.getContext('2d').drawImage(img,0,0,tw,th);
    const up=document.createElement('canvas'); up.width=tw*6;up.height=th*6;
    const ux=up.getContext('2d'); ux.imageSmoothingEnabled=false; ux.drawImage(t,0,0,up.width,up.height);
    res['thumb'+th]=up.toDataURL('image/png').split(',')[1];
    // desaturated hero-only crop at true thumb scale, upscaled 10x
    const hc=document.createElement('canvas'); hc.width=Math.round(0.16*tw); hc.height=Math.round(0.70*th);
    hc.getContext('2d').drawImage(t,Math.round(0.268*tw),Math.round(0.268*th),hc.width,hc.height,0,0,hc.width,hc.height);
    const hd=hc.getContext('2d').getImageData(0,0,hc.width,hc.height);
    for(let i=0;i<hd.data.length;i+=4){const g=0.2126*hd.data[i]+0.7152*hd.data[i+1]+0.0722*hd.data[i+2];hd.data[i]=hd.data[i+1]=hd.data[i+2]=g;}
    hc.getContext('2d').putImageData(hd,0,0);
    const hu=document.createElement('canvas'); hu.width=hc.width*12;hu.height=hc.height*12;
    const hx=hu.getContext('2d'); hx.imageSmoothingEnabled=false; hx.drawImage(hc,0,0,hu.width,hu.height);
    res['hero'+th]=hu.toDataURL('image/png').split(',')[1];
  }
  return res;
},{b64,CROPS});
await browser.close();
const { writeFileSync } = await import('node:fs');
for (const [k,v] of Object.entries(outs)) writeFileSync(path.join(ROOT,'review','p02-crops',k+'.png'),Buffer.from(v,'base64'));
console.log('wrote '+Object.keys(outs).length+' crops to review/p02-crops/');
