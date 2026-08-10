import{G as le,c as A,e as he,w as q,d as R,V as v,f as V,B as ue,a as ce,S as de,g as fe,D as me,M as ge,s as N,p as ae,A as W,h as F,C as pe,i as j,j as ve,R as ye,b as xe}from"./index-Bu0U1eDj.js";const w=[{el:0,hex:"#F7A75C"},{el:6,hex:"#EDA05E"},{el:10.5,hex:"#BC9968"},{el:15,hex:"#929576"},{el:20,hex:"#6D8E81"},{el:27,hex:"#558789"},{el:90,hex:"#4A848B"}],H="#FFD6A0",De=42,C={top:"#FFD891",body:"#FFCA84",under:"#DFAE74",sunward:"#FFF6E0"},h={hex:"#FFE8A0",coreHex:"#FFFDF2",elevationDeg:8,azimuthDeg:118,discRadiusDeg:1.15,glowTightDeg:3.2,glowWideDeg:17},x={mean:1,swing:.1,periods:[41,67,113,269,617],phases:[0,1.31,2.62,4.11,5.5]},u={azCells:656,elCell:.0096,low:{deckH:1700,yBias:.085,ringR:8,hScale:.13,aniso:1,azDrift:.0031,camParallax:.0016,cover:.578,core:.622,elLow:.075,elHigh:.78,evo:.026},high:{deckH:4200,yBias:.15,ringR:6.5,hScale:.085,aniso:2.2,azDrift:-.0052,camParallax:6e-4,cover:.628,core:.668,elLow:.17,elHigh:.96,evo:.016}},g={azimuthDeg:302,driftDegPerSec:.12,elevationDeg:4.6,halfAzDeg:5.2,halfElDeg:2.4,hex:"#241D2A",edgeHex:"#2FE3D6"},K={potato:{lowOct:2,highOct:0,deck2:0,rim:0,errata:0},low:{lowOct:3,highOct:2,deck2:1,rim:0,errata:1},medium:{lowOct:3,highOct:2,deck2:1,rim:1,errata:1},high:{lowOct:4,highOct:3,deck2:1,rim:1,errata:1},ultra:{lowOct:5,highOct:3,deck2:1,rim:1,errata:1}};function L(a){const e=parseInt(a.replace("#",""),16),t=i=>{const s=i/255;return s<=.04045?s/12.92:Math.pow((s+.055)/1.055,2.4)};return[t(e>>16&255),t(e>>8&255),t(e&255)]}const we=[[.59719,.35458,.04823],[.076,.90834,.01566],[.0284,.13383,.83777]],be=[[1.60475,-.53108,-.07367],[-.10208,1.10813,-.00605],[-.00327,-.07276,1.07602]];function Y(a,e){return[a[0][0]*e[0]+a[0][1]*e[1]+a[0][2]*e[2],a[1][0]*e[0]+a[1][1]*e[1]+a[1][2]*e[2],a[2][0]*e[0]+a[2][1]*e[1]+a[2][2]*e[2]]}function Se(a,e=1){let t=a.map(i=>i*(e/.6));return t=Y(we,t),t=t.map(i=>{const s=i*(i+.0245786)-90537e-9,o=i*(.983729*i+.432951)+.238081;return s/o}),t=Y(be,t),t.map(i=>Math.min(1,Math.max(0,i)))}function ie(a,e=1,t=W){if(t!==W)return{rgb:a.slice(),residual:0,iterations:0};const i=a.slice();let s=1,o=0;for(;o<96;o++){const r=Se(i,e);if(s=Math.max(...r.map((l,n)=>Math.abs(l-a[n]))),s<1e-5)break;for(let l=0;l<3;l++){const n=(a[l]+1e-5)/(r[l]+1e-5);i[l]=Math.max(0,i[l]*Math.pow(n,.75))}}return{rgb:i,residual:s,iterations:o}}function ke(a){let e=0;for(let t=0;t<x.periods.length;t++)e+=Math.sin(2*Math.PI*a/x.periods[t]+x.phases[t]);return x.mean+x.swing*(e/x.periods.length)}function Ce(){let a=0;for(const e of x.periods)a+=2*Math.PI/e;return x.swing/x.periods.length*a}function ze(a=h.elevationDeg,e=h.azimuthDeg){const t=a*Math.PI/180,i=e*Math.PI/180;return new v(Math.cos(t)*Math.sin(i),Math.sin(t),Math.cos(t)*Math.cos(i))}const Ae=`
float vsHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.20219, 0.16843, 0.27547));
  q += dot(q, q.yzx + 47.109);
  return fract((q.x + q.y) * (q.z + q.x));
}

float vsNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = vsHash(i);
  float b = vsHash(i + vec2(1.0, 0.0));
  float c = vsHash(i + vec2(0.0, 1.0));
  float d = vsHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Rotate-and-scale between octaves so the field has no axis-aligned grain of its own — the only
// axis alignment in the finished cloud must come from the block grid.
const mat2 VS_OCT = mat2(1.6598, 0.9834, -0.9834, 1.6598);

// 3-D value noise. The cloud decks need it because a cylinder is the only cheap addressing scheme
// that is seamless in azimuth AND lets cloud width and cloud height be two different numbers.
float vsHash3(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}

float vsNoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = p - i;
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n000 = vsHash3(i);
  float n100 = vsHash3(i + vec3(1.0, 0.0, 0.0));
  float n010 = vsHash3(i + vec3(0.0, 1.0, 0.0));
  float n110 = vsHash3(i + vec3(1.0, 1.0, 0.0));
  float n001 = vsHash3(i + vec3(0.0, 0.0, 1.0));
  float n101 = vsHash3(i + vec3(1.0, 0.0, 1.0));
  float n011 = vsHash3(i + vec3(0.0, 1.0, 1.0));
  float n111 = vsHash3(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
    mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
    u.z
  );
}

// Rotate xy and scale z between octaves. Rotating (cos az, sin az) is still (cos, sin) of a
// shifted angle, so every octave stays exactly periodic in azimuth — no seam, at any frequency.
vec3 vsOct3(vec3 p) {
  return vec3(
    p.x * 1.6598 + p.y * 0.9834,
    -p.x * 0.9834 + p.y * 1.6598,
    p.z * 1.9273 + 31.7
  );
}
`,_e=`
float vsBayer8(vec2 fc) {
  vec2 p = floor(mod(fc, 8.0));
  float x0 = mod(p.x, 2.0), x1 = mod(floor(p.x * 0.5), 2.0), x2 = mod(floor(p.x * 0.25), 2.0);
  float y0 = mod(p.y, 2.0), y1 = mod(floor(p.y * 0.5), 2.0), y2 = mod(floor(p.y * 0.25), 2.0);
  float v = abs(x2 - y2) + y2 * 2.0
          + abs(x1 - y1) * 4.0 + y1 * 8.0
          + abs(x0 - y0) * 16.0 + y0 * 32.0;
  return v * (1.0 / 64.0);
}
`,Me=w.length,X=a=>new R(a.deckH,a.ringR,a.hScale,a.cover),J=a=>new R(a.core,a.elLow,a.elHigh,a.evo),Q=a=>new R(a.yBias,a.aniso,a.azDrift,a.camParallax),Ee=`
#define VS_NBANDS ${Me}
uniform vec3  uBandCol[VS_NBANDS];
uniform float uBandEl[VS_NBANDS];
uniform float uBandSharp;
uniform vec3  uUnder;
uniform float uUnderSpan;

vec3 vsSkyGradient(float el) {
  if (el <= uBandEl[0]) {
    // No ground under this world: below the skyline the sky keeps going and gets brighter.
    float d = clamp((uBandEl[0] - el) / uUnderSpan, 0.0, 1.0);
    return mix(uBandCol[0], uUnder, d * d * (3.0 - 2.0 * d));
  }
  vec3 c = uBandCol[0];
  for (int i = 0; i < VS_NBANDS - 1; i++) {
    float a = uBandEl[i];
    float b = uBandEl[i + 1];
    float mid = 0.5 * (a + b);
    float half_ = max(1e-6, 0.5 * (b - a) * uBandSharp);
    // Plateau, knee, plateau. uBandSharp = 1 degenerates to a plain smoothstep chain.
    c = mix(c, uBandCol[i + 1], smoothstep(mid - half_, mid + half_, el));
  }
  return c;
}
`,Fe=`
uniform mat4 uCamWorld;
uniform mat4 uProjInv;
varying vec3 vRay;

void main() {
  // A full-screen triangle whose vertices are already in NDC. z = 1 is the far plane; depthTest
  // is off so nothing about the depth buffer matters and nothing is ever culled.
  vec4 clip = vec4(position.xy, 1.0, 1.0);
  vec4 eye = uProjInv * clip;
  vRay = (uCamWorld * vec4(eye.xyz / eye.w, 0.0)).xyz;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;function Be(a){return`
precision highp float;

#define LOW_OCT ${a.lowOct}
#define HIGH_OCT ${a.highOct}
#define DECK2 ${a.deck2}
#define RIM ${a.rim}
#define ERRATA ${a.errata}

uniform vec3  uCamPos;
uniform vec3  uSunDir;
uniform vec3  uSunGlow;
uniform vec3  uSunCore;
uniform float uGlowTight;   // radians
uniform float uGlowWide;    // radians
uniform float uGlowTightAmp;
uniform float uGlowWideAmp;
uniform float uDiscRadius;  // radians
uniform float uDiscGain;

uniform float uLethis;
uniform float uTime;
uniform float uMotion;

uniform float uCellAz;      // radians per azimuth cell
uniform float uCellEl;      // dir.y per elevation cell

uniform vec4  uDeckLowA;    // deckH, ringR, hScale, cover
uniform vec4  uDeckLowB;    // core, elLow, elHigh, evo
uniform vec4  uDeckLowC;    // yBias, aniso, azDrift, camParallax
uniform vec4  uDeckHighA;
uniform vec4  uDeckHighB;
uniform vec4  uDeckHighC;

uniform vec3  uCloudTop;
uniform vec3  uCloudBody;
uniform vec3  uCloudUnder;
uniform vec3  uCloudSunward;
uniform float uCloudGain;

uniform vec3  uErrataCol;
uniform vec3  uErrataEdge;
uniform vec4  uErrata;      // azimuth0, driftRadPerSec, elevation, halfAz
uniform float uErrataHalfEl;

uniform float uDither;

varying vec3 vRay;

${Ae}
${Ee}
${_e}

float vsFbm(vec2 p, int octaves) {
  float a = 0.5;
  float s = 0.0;
  float n = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    s += a * vsNoise(p);
    n += a;
    p = VS_OCT * p;
    a *= 0.53;
  }
  return s / max(n, 1e-4);
}

// ------------------------------------------------------------------ cloud decks
//
// idx is the INTEGER block address: azimuth cell (already in the deck's drifting frame) and
// elevation cell. The density is sampled ONCE per block, at the block's centre, so the value is
// constant across the whole block and every boundary in the finished frame is a hard rectangular
// step — which is the entire point.
//
// The sample lives on a polar plane around the viewer whose radius is the horizon-limited deck
// distance, compressed by a power. See the CLOUDS comment for why all three of those words are
// load-bearing.

// Gain 0.44, not the usual 0.5. A cloud in the target is a big confident shape with a clean
// staircase edge; at gain 0.5 the fourth octave carries 13% of the field and the silhouette grows
// single-cell nubs and pinholes all over it, which reads as lace rather than as a slab.
float vsFbm3(vec3 p, int octaves) {
  float a = 0.5;
  float s = 0.0;
  float n = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    s += a * vsNoise3(p);
    n += a;
    p = vsOct3(p);
    a *= 0.44;
  }
  return s / max(n, 1e-4);
}

float vsDeckDensity(vec2 idx, vec4 a, vec4 b, vec4 c, int oct) {
  float az = (idx.x + 0.5) * uCellAz;              // in the deck's own frame: drift is not added,
  float y  = max((idx.y + 0.5) * uCellEl, 0.0);    // so the pattern is rigid and the GRID moves.
  // Horizon-limited, square-rooted deck distance: the third axis of the cylinder.
  float h = sqrt(a.x / (y + c.x)) * a.z * c.y;
  vec3 p = vec3(vec2(cos(az), sin(az)) * a.y + uCamPos.xz * c.w, h);
  // Shapes are BORN AND DIE: a slow field displaces the domain, so no rigid shift of an earlier
  // frame can reproduce a later one. review/measure/P10.mjs measures exactly that. The amplitude
  // is deliberately well under one feature — a large warp does not evolve a cloud, it smears it.
  float e = b.w * uTime;
  vec2 disp = vec2(vsNoise(p.xz * 0.31 + vec2(e, 3.7)), vsNoise(p.xz * 0.27 + vec2(-e * 0.8, 9.1)));
  p.xz += (disp - 0.5) * 1.1;
  return vsFbm3(p, oct);
}

// One deck, returned as (coverage, shadeSelect) where shadeSelect is 0 under-step, 1 body,
// 2 core, 3 lit top step.
vec2 vsDeckShade(vec2 idx, vec4 a, vec4 b, vec4 c, int oct) {
  float dens = vsDeckDensity(idx, a, b, c, oct);
  float body = step(a.w, dens);
  if (body < 0.5) return vec2(0.0, 1.0);
  float sel = 1.0 + step(b.x, dens);               // body -> core
  #if RIM
    // Two cells down and two cells up. A block with nothing beyond it toward the horizon is on
    // the slab's underside; a block with nothing above it is the slab's lit top. Per-face flat
    // shading on a 2-D field — two cells deep, because a one-cell rim at 0.55° is a hairline and
    // the target's slabs carry a shadow band you can actually read.
    float below = vsDeckDensity(idx + vec2(0.0, -3.0), a, b, c, oct);
    float above = vsDeckDensity(idx + vec2(0.0,  2.0), a, b, c, oct);
    if (below < a.w) sel = 0.0;
    else if (above < a.w) sel = 3.0;
  #endif
  return vec2(1.0, sel);
}

vec3 vsCloudColour(float sel, float sunFacing) {
  vec3 c = uCloudBody;
  if (sel < 0.5) c = uCloudUnder;
  else if (sel > 2.5) c = uCloudTop;
  else if (sel > 1.5) c = mix(uCloudBody, uCloudTop, 0.45);
  // Near the sun the slabs wash out toward white, exactly as they do in the target.
  return mix(c, uCloudSunward, pow(max(sunFacing, 0.0), 5.0) * 0.85) * uLethis;
}

void main() {
  vec3 dir = normalize(vRay);
  float el = asin(clamp(dir.y, -1.0, 1.0));
  float az = atan(dir.x, dir.z);

  vec3 col = vsSkyGradient(el) * uLethis;

  float sunFacing = dot(dir, uSunDir);
  float ang = acos(clamp(sunFacing, -1.0, 1.0));

  // ---- clouds --------------------------------------------------------------------------------
  // The block GRID drifts with each deck's wind and the pattern inside it is rigid, so slabs
  // translate smoothly across the screen instead of popping one cell at a time. Everything that
  // is not translation — birth, death, the second deck's opposite bearing — is in the density.
  float elIdx = floor(dir.y / uCellEl);

  if (dir.y > uDeckLowB.y - 0.03) {
    float drift = uDeckLowC.z * uTime;
    vec2 idx = vec2(floor((az - drift) / uCellAz), elIdx);
    vec2 sh = vsDeckShade(idx, uDeckLowA, uDeckLowB, uDeckLowC, LOW_OCT);
    float cover = sh.x
      * smoothstep(uDeckLowB.y, uDeckLowB.y + 0.075, dir.y)
      * (1.0 - smoothstep(uDeckLowB.z, uDeckLowB.z + 0.22, dir.y));
    col = mix(col, vsCloudColour(sh.y, sunFacing), clamp(cover * uCloudGain, 0.0, 1.0));
  }

  #if DECK2
  if (dir.y > uDeckHighB.y - 0.03) {
    float drift = uDeckHighC.z * uTime;
    vec2 idx = vec2(floor((az - drift) / uCellAz), elIdx);
    vec2 sh = vsDeckShade(idx, uDeckHighA, uDeckHighB, uDeckHighC, HIGH_OCT);
    float cover = sh.x
      * smoothstep(uDeckHighB.y, uDeckHighB.y + 0.09, dir.y)
      * (1.0 - smoothstep(uDeckHighB.z, uDeckHighB.z + 0.20, dir.y));
    col = mix(col, vsCloudColour(sh.y, sunFacing) * 1.02, clamp(cover * uCloudGain * 0.9, 0.0, 1.0));
  }
  #endif

  // ---- Lethis --------------------------------------------------------------------------------
  // A low sun: a tight white core, a warm wide wash. The target's entire horizontal variation is
  // this term — the base gradient is azimuth-independent (see the header, §4).
  {
    float tight = exp(-ang / uGlowTight);
    float wide  = exp(-ang / uGlowWide);
    col += uSunGlow * (uGlowTightAmp * tight + uGlowWideAmp * wide) * uLethis;
    float disc = 1.0 - smoothstep(uDiscRadius * 0.82, uDiscRadius, ang);
    col = mix(col, uSunCore * uDiscGain * uLethis, disc);
  }

  // ---- the Errata ----------------------------------------------------------------------------
  // world.md §3: "a hole in the sky on the far horizon, moving." A HOLE, so it erases whatever it
  // crosses; and it is quantised on the same block grid, so it belongs to the same language.
  #if ERRATA
  {
    float eAz = uErrata.x + uErrata.y * uTime * uMotion;
    float qAz = (floor(az / uCellAz) + 0.5) * uCellAz;
    float qEl = (floor(dir.y / uCellEl) + 0.5) * uCellEl;
    float dAz = atan(sin(qAz - eAz), cos(qAz - eAz));
    // Ragged, but ragged in whole blocks.
    float ragged = 0.30 * (vsNoise(vec2(qAz * 34.0 + uTime * 0.05 * uMotion, qEl * 60.0)) - 0.5);
    float r = length(vec2(dAz / uErrata.w, (qEl - uErrata.z) / uErrataHalfEl)) + ragged;
    float hole = step(r, 1.0);
    float rim  = step(r, 1.22) - hole;
    col = mix(col, uErrataCol, hole);
    col = mix(col, uErrataEdge * 0.55 + col * 0.45, rim * 0.8);
  }
  #endif

  gl_FragColor = vec4(max(col, 0.0), 1.0);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>

  // LAST. After the curve, after the colour-space transform, immediately before the framebuffer
  // quantises to 8 bits. Fixed pattern from gl_FragCoord alone, so it is deterministic and it
  // does not crawl. See the header, §2.
  gl_FragColor.rgb += (vsBayer8(gl_FragCoord.xy) - 0.5) * uDither;
}
`}class Re{constructor(e){this.kernel=e,this.root=new le,this.root.name="sky";const t=new URLSearchParams(location.search),i=A.tier.id;this.knobs=K[i]??K.high,this.sunDir=ze(),this.sunAdopted=null,this.sunElevationDeg=h.elevationDeg,this.sunAzimuthDeg=h.azimuthDeg,this.lethis=1,this.simTime=0,this.motion=A.get("reduceMotion")?.4:1,this.bandSharp=Number(t.get("skyBandSharp")??.45),this.ditherLsb=Number(t.get("skyDither")??1.25),this.exposure=e.renderer.toneMappingExposure,this.toneMapping=e.renderer.toneMapping,he.enabled!==!0&&q("Sky: THREE.ColorManagement is disabled — measured sky colours will not land.");const s=Math.PI/180,o=()=>new v;this.uniforms={uCamWorld:{value:new V},uProjInv:{value:new V},uCamPos:{value:new v},uBandCol:{value:w.map(()=>new v)},uBandEl:{value:w.map(l=>l.el*s)},uBandSharp:{value:this.bandSharp},uUnder:{value:o()},uUnderSpan:{value:De*s},uSunDir:{value:this.sunDir.clone()},uSunGlow:{value:o()},uSunCore:{value:o()},uGlowTight:{value:h.glowTightDeg*s},uGlowWide:{value:h.glowWideDeg*s},uGlowTightAmp:{value:1.35},uGlowWideAmp:{value:.42},uDiscRadius:{value:h.discRadiusDeg*s},uDiscGain:{value:7.5},uLethis:{value:1},uTime:{value:0},uMotion:{value:this.motion},uCellAz:{value:2*Math.PI/u.azCells},uCellEl:{value:u.elCell},uDeckLowA:{value:X(u.low)},uDeckLowB:{value:J(u.low)},uDeckLowC:{value:Q(u.low)},uDeckHighA:{value:X(u.high)},uDeckHighB:{value:J(u.high)},uDeckHighC:{value:Q(u.high)},uCloudTop:{value:o()},uCloudBody:{value:o()},uCloudUnder:{value:o()},uCloudSunward:{value:o()},uCloudGain:{value:Number(t.get("skyClouds")??1)},uErrataCol:{value:o()},uErrataEdge:{value:o()},uErrata:{value:new R(g.azimuthDeg*s,g.driftDegPerSec*s,Math.sin(g.elevationDeg*s),g.halfAzDeg*s)},uErrataHalfEl:{value:Math.sin(g.halfElDeg*s)},uDither:{value:this.ditherLsb/255}},this._solveTone();const r=new ue;r.setAttribute("position",new ce(new Float32Array([-1,-1,0,3,-1,0,-1,3,0]),3)),r.boundingSphere=new de(new v,1e9),this.material=new fe({uniforms:this.uniforms,vertexShader:Fe,fragmentShader:Be(this.knobs),depthTest:!1,depthWrite:!1,side:me,fog:!1,toneMapped:!0}),this.mesh=new ge(r,this.material),this.mesh.name="sky-plate",this.mesh.frustumCulled=!1,this.mesh.renderOrder=-1e4,this.mesh.onBeforeRender=(l,n,d)=>{this.uniforms.uCamWorld.value.copy(d.matrixWorld),this.uniforms.uProjInv.value.copy(d.projectionMatrixInverse),d.getWorldPosition(this.uniforms.uCamPos.value)},this.root.add(this.mesh),e.scene.background=null,this._offSun=N.on("world:sun",l=>this._adoptSun(l)),ae("sky",()=>this.report()),N.emit("world:sun",this._sunPayload())}_adoptSun(e){if(!e||e.source==="sky")return;const t=e.toLight;if(!t)return;const i=Array.isArray(t)?new v(t[0],t[1],t[2]):new v(t.x,t.y,t.z);i.lengthSq()<1e-6||(i.normalize(),this.sunAdopted=i,this.uniforms.uSunDir.value.copy(i),this.sunElevationDeg=Number.isFinite(e.elevationDeg)?e.elevationDeg:Math.asin(i.y)*180/Math.PI,this.sunAzimuthDeg=Number.isFinite(e.azimuthDeg)?e.azimuthDeg:Math.atan2(i.x,i.z)*180/Math.PI)}_sunPayload(){const e=this.uniforms.uSunDir.value;return{source:"sky",toLight:[c(e.x),c(e.y),c(e.z)],direction:[c(-e.x),c(-e.y),c(-e.z)],hex:h.hex,elevationDeg:m(this.sunElevationDeg),azimuthDeg:m(this.sunAzimuthDeg),relativeIntensity:c(this.lethis)}}_solveTone(){const e=this.exposure,t=this.toneMapping;this.residuals={},this.maxResidual=0;const i=(s,o,r,l)=>{const n=ie(L(r),e,t);this.residuals[o]=Number(n.residual.toFixed(4)),l&&(this.maxResidual=Math.max(this.maxResidual,n.residual)),s.set(n.rgb[0],n.rgb[1],n.rgb[2])};w.forEach((s,o)=>i(this.uniforms.uBandCol.value[o],`band${s.el}`,s.hex,!0)),i(this.uniforms.uUnder.value,"under",H,!0),i(this.uniforms.uCloudTop.value,"cloudTop",C.top,!0),i(this.uniforms.uCloudBody.value,"cloudBody",C.body,!0),i(this.uniforms.uCloudUnder.value,"cloudUnder",C.under,!0),i(this.uniforms.uCloudSunward.value,"cloudSunward",C.sunward,!1),i(this.uniforms.uSunGlow.value,"sunGlow",h.hex,!0),i(this.uniforms.uSunCore.value,"sunCore",h.coreHex,!1),i(this.uniforms.uErrataCol.value,"errata",g.hex,!0),i(this.uniforms.uErrataEdge.value,"errataEdge",g.edgeHex,!1),this.maxResidual>.004&&q(`Sky: tonemap inversion residual ${this.maxResidual.toFixed(4)} — sky is off-palette`)}setDither(e){this.ditherLsb=Math.max(0,Number(e)||0),this.uniforms.uDither.value=this.ditherLsb/255}setBandSharpness(e){this.bandSharp=Math.min(1,Math.max(.05,Number(e)||.45)),this.uniforms.uBandSharp.value=this.bandSharp}setClouds(e){this.uniforms.uCloudGain.value=Math.min(1,Math.max(0,Number(e)||0))}fixed(e,t){this.simTime=t,this.lethis=ke(t),this.uniforms.uLethis.value=this.lethis,this.uniforms.uTime.value=t*this.motion}frame(){const e=this.kernel.renderer;(e.toneMappingExposure!==this.exposure||e.toneMapping!==this.toneMapping)&&(this.exposure=e.toneMappingExposure,this.toneMapping=e.toneMapping,this._solveTone())}report(){const e=this.uniforms.uSunDir.value;return{tier:A.tier.id,knobs:this.knobs,drawCalls:1,triangles:1,simTime:c(this.simTime),motionScale:this.motion,lethis:c(this.lethis),lethisMaxRatePerStep:Number((Ce()/60).toFixed(7)),lethisRateBudgetPerStep:.0015,sun:{toLight:[c(e.x),c(e.y),c(e.z)],elevationDeg:m(this.sunElevationDeg),azimuthDeg:m(this.sunAzimuthDeg),adopted:this.sunAdopted!==null,discRadiusDeg:h.discRadiusDeg},bands:w.map(t=>({elevationDeg:t.el,hex:t.hex})),bandSharp:m(this.bandSharp),underHex:H,cloud:{...C,azCells:u.azCells,cellAzDeg:c(360/u.azCells*1),cellElDirY:u.elCell,cellElDegNearHorizon:c(Math.asin(u.elCell)*180/Math.PI),gain:m(this.uniforms.uCloudGain.value),decks:this.knobs.deck2?2:1,lowElevationBandDeg:[m(Math.asin(u.low.elLow)*180/Math.PI),m(Math.asin(u.low.elHigh)*180/Math.PI)],rimShading:!!this.knobs.rim},errata:{enabled:!!this.knobs.errata,azimuthDeg:m(g.azimuthDeg+g.driftDegPerSec*this.simTime*this.motion),driftDegPerSec:g.driftDegPerSec},dither:{lsb:m(this.ditherLsb),pattern:"bayer8x8",source:"gl_FragCoord",appliedAfter:"tonemapping+colorspace"},toneMapping:this.toneMapping,exposure:m(this.exposure),toneSolveResidual:Number(this.maxResidual.toFixed(6)),toneSolveResiduals:this.residuals}}dispose(){this._offSun?.(),this.material.dispose(),this.mesh.geometry.dispose()}}const m=a=>Number((Number(a)||0).toFixed(3)),c=a=>Number((Number(a)||0).toFixed(4)),D=Math.PI/180,Z={potato:{flat:1,near:30,far:220,density:3.2,max:.9,desat:.55},low:{flat:1,near:34,far:300,density:3.2,max:.92,desat:.6},medium:{flat:0,near:38,far:360,density:3,max:.93,desat:.65},high:{flat:0,near:42,far:440,density:3,max:.94,desat:.68},ultra:{flat:0,near:46,far:540,density:3,max:.94,desat:.68}},B={clear:{rangeScale:1.25,densityScale:.85,warmth:0,lift:0},thick:{rangeScale:.68,densityScale:1.35,warmth:.35,lift:.06}},k={base:-40,scale:420},b=a=>a.map(e=>e.toFixed(5)).join(", ");function Te(a,e,t,i){if(e==="scene")return ie(L(a),t,i).rgb;if(e==="linear")return L(a);const s=parseInt(a.replace("#",""),16);return[(s>>16&255)/255,(s>>8&255)/255,(s&255)/255]}function ee(a,e,t){return a.map((i,s)=>i+(e[s]-i)*t)}function Ne(a){const{space:e,exposure:t,toneMapping:i,sunDir:s,warmth:o,lift:r,density:l,max:n,desat:d,flat:S,heightBase:_,heightScale:se,glowWideDeg:oe}=a,M=f=>Te(f,e,t,i),O=e==="scene"?24:1,P=M(w[0].hex),y=w.map(f=>({el:f.el*D,c:ee(M(f.hex),P,o).map(E=>Math.min(O,E*(1+r)))})),ne=ee(M(H),P,o),re=M(h.hex).map(f=>Math.min(O,f*1.05));let G=`  vec3 c = vec3(${b(y[0].c)});
`;for(let f=0;f<y.length-1;f++){const E=y[f].el,I=y[f+1].el,$=.5*(E+I),U=Math.max(1e-6,.5*(I-E)*a.bandSharp);G+=`  c = mix(c, vec3(${b(y[f+1].c)}), smoothstep(${($-U).toFixed(6)}, ${($+U).toFixed(6)}, el));
`}return{fog_pars_vertex:`
#ifdef USE_FOG
	varying vec3 vVsFogView;
#endif
`,fog_vertex:`
#ifdef USE_FOG
	vVsFogView = mvPosition.xyz;
#endif
`,fog_pars_fragment:`
#ifdef USE_FOG

	uniform vec3 fogColor;
	varying vec3 vVsFogView;

	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif

${S?`vec3 vsAtmoSky(vec3 dir) { return vec3(${b(y[0].c)}); }`:`
vec3 vsAtmoSky(vec3 dir) {
  float el = asin(clamp(dir.y, -1.0, 1.0));
  if (el <= ${y[0].el.toFixed(6)}) {
    float d = clamp((${y[0].el.toFixed(6)} - el) / ${(50*D).toFixed(6)}, 0.0, 1.0);
    return mix(vec3(${b(y[0].c)}), vec3(${b(ne)}), d * d * (3.0 - 2.0 * d));
  }
${G}  // The sun wash, in the same shape Sky.js gives it, so the haze near the sun goes pale
  // instead of going orange — which is what the target does and what a rule that only knew
  // about elevation could never produce.
  float ang = acos(clamp(dot(dir, vec3(${b(s)})), -1.0, 1.0));
  c = mix(c, vec3(${b(re)}), exp(-ang / ${(oe*D).toFixed(6)}) * 0.62);
  return c;
}`}

	// P10's depth law. Runs in the renderer's OUTPUT space (three includes this chunk after the
	// tonemap and the colour-space transform), which is why every constant above is a measured
	// display value rather than a scene-referred one.
	vec3 vsAerial(vec3 col, vec3 vpos, float near_, float far_) {
		float dist = length(vpos);
		vec3 w = vpos * mat3(viewMatrix);            // orthonormal rotation: right-multiply = inverse
		float wy = cameraPosition.y + w.y;
		vec3 dir = normalize(w + vec3(0.0, 1e-6, 0.0));

		float hk = exp(-max(wy - (${_.toFixed(2)}), 0.0) / ${se.toFixed(2)});
		float t = max(dist - near_, 0.0) / max(far_ - near_, 1.0);
		float f = 1.0 - exp(-t * t * ${l.toFixed(4)} * hk);
		f = clamp(f, 0.0, 1.0) * ${n.toFixed(4)};

		// Chroma dies first, then value lifts into the sky. That order is what keeps a far
		// silhouette a silhouette instead of a coloured smear.
		float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
		col = mix(col, vec3(l), ${d.toFixed(4)} * f);
		return mix(col, vsAtmoSky(dir), f);
	}

#endif
`,fog_fragment:`
#ifdef USE_FOG
	#ifdef FOG_EXP2
		gl_FragColor.rgb = vsAerial(gl_FragColor.rgb, vVsFogView, 1.0 / max(fogDensity, 1e-5), 2.0 / max(fogDensity, 1e-5));
	#else
		gl_FragColor.rgb = vsAerial(gl_FragColor.rgb, vVsFogView, fogNear, fogFar);
	#endif
#endif
`}}const T=["fog_pars_vertex","fog_vertex","fog_pars_fragment","fog_fragment"];class He{constructor(e){this.kernel=e,this.scene=e.scene;const t=new URLSearchParams(location.search);this.tier=Z[A.tier.id]??Z.high,this.timeOfDay=te(Number(t.get("tod")??.18)),this.densityScale=Number(t.get("haze")??1),this.rangeScale=Number(t.get("hazeRange")??1),this.enabled=t.get("haze")!=="0",this.sunDir=new v(Math.cos(h.elevationDeg*D)*Math.sin(h.azimuthDeg*D),Math.sin(h.elevationDeg*D),Math.cos(h.elevationDeg*D)*Math.cos(h.azimuthDeg*D)),this.sunElevationDeg=h.elevationDeg,this.sunAzimuthDeg=h.azimuthDeg,this._bakedSunAzimuth=this.sunAzimuthDeg,this._original={};for(const s of T)this._original[s]=F[s];const i=new pe().setStyle(w[0].hex,j);this.fog=new ve(i,this.tier.near,this.tier.far),this.scene.fog=this.fog,this._bake(),this._applyRange(),this._offSun=N.on("world:sun",s=>this._adoptSun(s)),ae("atmosphere",()=>this.report())}_pathSignature(){const e=this.kernel.renderer;return[this.kernel.composer?"hdr":"canvas",e.toneMapping,(e.toneMappingExposure??1).toFixed(4),e.outputColorSpace,this.timeOfDay.toFixed(4),Math.round(this.sunAzimuthDeg/4)].join("|")}_space(){const e=this.kernel.renderer;return this.kernel.composer?"scene":e.outputColorSpace===j?"srgb":"linear"}_bake(){const e=B.clear,t=B.thick,i=this.timeOfDay,s=e.warmth+(t.warmth-e.warmth)*i,o=e.lift+(t.lift-e.lift)*i,r=this.kernel.renderer;this.space=this._space();const l=Ne({space:this.space,exposure:r.toneMappingExposure??1,toneMapping:r.toneMapping,sunDir:[this.sunDir.x,this.sunDir.y,this.sunDir.z],bandSharp:.45,warmth:s,lift:o,density:this.tier.density,max:this.tier.max,desat:this.tier.desat,flat:this.tier.flat,heightBase:k.base,heightScale:k.scale,glowWideDeg:h.glowWideDeg});for(const d of T)F[d]=l[d];this._bakedSunAzimuth=this.sunAzimuthDeg,this._bakeCount=(this._bakeCount??0)+1,this._bakedSignature=this._pathSignature();let n=0;this.scene.traverse(d=>{const S=d.material;if(S)for(const _ of Array.isArray(S)?S:[S])_.fog!==!1&&(_.needsUpdate=!0,n++)}),this._touchedOnBake=n}_applyRange(){const e=B.clear,t=B.thick,i=this.timeOfDay,s=(e.rangeScale+(t.rangeScale-e.rangeScale)*i)*this.rangeScale,o=e.densityScale+(t.densityScale-e.densityScale)*i,r=(this.tier.far-this.tier.near)*s/Math.max(.05,o*this.densityScale);this.fog.near=this.enabled?this.tier.near*s:1e7,this.fog.far=this.enabled?this.fog.near+Math.max(20,r):10000001}_adoptSun(e){if(!e)return;const t=e.toLight;if(!t)return;const i=Array.isArray(t)?new v(t[0],t[1],t[2]):new v(t.x,t.y,t.z);i.lengthSq()<1e-6||(this.sunDir.copy(i.normalize()),this.sunElevationDeg=Number.isFinite(e.elevationDeg)?e.elevationDeg:Math.asin(this.sunDir.y)*180/Math.PI,this.sunAzimuthDeg=Number.isFinite(e.azimuthDeg)?e.azimuthDeg:Math.atan2(this.sunDir.x,this.sunDir.z)*180/Math.PI)}frame(){this._pathSignature()!==this._bakedSignature&&(this._bake(),this._applyRange())}setTimeOfDay(e){this.timeOfDay=te(e),this._bake(),this._applyRange()}setDensity(e){this.densityScale=Math.max(0,Number(e)||0),this._applyRange()}setRange(e){this.rangeScale=Math.max(.05,Number(e)||1),this._applyRange()}setEnabled(e){this.enabled=!!e,this._applyRange()}sampleDistances(e){const t=this.kernel.camera,i=new ye;i.far=1e6;const s=this.scene.children.filter(r=>r.name!=="sky"),o=[];for(const r of(e||[]).slice(0,48)){i.setFromCamera(new xe(r.nx,r.ny),t);const n=i.intersectObjects(s,!0).find(d=>d.object?.name!=="sky-plate"&&d.object?.visible!==!1);o.push({nx:r.nx,ny:r.ny,hit:!!n,distance:n?p(n.distance):null,worldY:n?p(n.point.y):null,f:n?z(this.hazeFactor(n.distance,n.point.y)):null})}return o}hazeFactor(e,t){const i=Math.exp(-Math.max(t-k.base,0)/k.scale),s=Math.max(e-this.fog.near,0)/Math.max(this.fog.far-this.fog.near,1),o=1-Math.exp(-s*s*this.tier.density*i);return Math.min(1,Math.max(0,o))*this.tier.max}report(){return{installed:F.fog_fragment.includes("vsAerial"),tier:A.tier.id,enabled:this.enabled,flatFallback:!!this.tier.flat,space:this.space,composer:!!this.kernel.composer,timeOfDay:p(this.timeOfDay),near:p(this.fog.near),far:p(this.fog.far),densityScale:p(this.densityScale),rangeScale:p(this.rangeScale),law:{density:this.tier.density,max:this.tier.max,desaturation:this.tier.desat,heightBase:k.base,heightScale:k.scale,shape:"f = 1 - exp(-t^2 * density * exp(-(y-h0)/hscale)), t = (d-near)/(far-near)",appliedIn:"renderer output space, after tonemap + colorspace"},sun:{toLight:[z(this.sunDir.x),z(this.sunDir.y),z(this.sunDir.z)],elevationDeg:p(this.sunElevationDeg),azimuthDeg:p(this.sunAzimuthDeg),bakedAzimuthDeg:p(this._bakedSunAzimuth)},sample:[40,120,260,500,900,1600].map(e=>({distance:e,f:z(this.hazeFactor(e,0))})),bakes:this._bakeCount??0,materialsTouchedOnBake:this._touchedOnBake??0}}dispose(){this._offSun?.();for(const e of T)F[e]=this._original[e];this.scene.fog===this.fog&&(this.scene.fog=null),this.scene.traverse(e=>{const t=e.material;if(t)for(const i of Array.isArray(t)?t:[t])i.needsUpdate=!0})}}const te=a=>Number.isFinite(a)?Math.min(1,Math.max(0,a)):0,p=a=>Number((Number(a)||0).toFixed(3)),z=a=>Number((Number(a)||0).toFixed(4)),Ge={id:"sky",order:12,async setup(a){a.mount("sky",new Re(a)),a.mount("atmosphere",new He(a))}};export{Ge as default};
