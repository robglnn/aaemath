import { openGame } from "../tools/lib/session.mjs";
await openGame({ width: 640, height: 360 }, async (d) => {
  await d.page.waitForFunction(() => window.__vs && (window.__vs.ready || window.__vs.fatal), { timeout: 90000 });
  await d.play(1.0);
  const out = await d.run(() => {
    const K = window.__vs.kernel;
    const t = K.get("terrain");
    const lv = K.get("level01");
    const W = (aX, aZ) => [aZ, -aX];
    const rows = [];
    // carry.low centreline samples
    for (const [aX, aZ] of [[-232,-78],[-150,-66],[-64,-50],[24,-34],[104,-18]]) {
      const [x, z] = W(aX, aZ);
      rows.push({ carry:'low', aX, ground: Number((t.groundAt(x,z)??NaN).toFixed(2)), base: Number((12 - Math.tan(7*Math.PI/180)*aX).toFixed(2)) });
    }
    for (const [aX, aZ] of [[104,114],[-30,78],[-92,56]]) {
      const [x, z] = W(aX, aZ);
      rows.push({ carry:'middle', aX, ground: Number((t.groundAt(x,z)??NaN).toFixed(2)), base: Number((12 - Math.tan(7*Math.PI/180)*aX).toFixed(2)) });
    }
    const cm = lv.carryMesh;
    const p = cm.geometry.getAttribute('position');
    let ymin=1e9,ymax=-1e9; const bb=cm.geometry.boundingBox;
    for(let i=0;i<p.count;i++){const y=p.getY(i); if(y<ymin)ymin=y; if(y>ymax)ymax=y;}
    // how many ribbon vertices are BELOW the terrain at their own xz?
    let buried=0, tested=0;
    for(let i=0;i<p.count;i+=3){
      const x=p.getX(i), y=p.getY(i), z=p.getZ(i);
      const g=t.groundAt(x,z); if(!Number.isFinite(g)) continue; tested++;
      if(y < g) buried++;
    }
    return { rows, carry:{tris:p.count/3, ymin:Number(ymin.toFixed(1)), ymax:Number(ymax.toFixed(1)), buried, tested,
      bbox:[bb.min.toArray().map(v=>Math.round(v)), bb.max.toArray().map(v=>Math.round(v))], visible: cm.visible, matName: cm.material.name}};
  });
  console.log(JSON.stringify(out, null, 1));
});
