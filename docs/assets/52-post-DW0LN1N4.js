import{a0 as q,a1 as _,a2 as N,a3 as A,a4 as H,M as Y,B as X,a5 as Q,a6 as J,b as $,S as Z,V as v,h as S,d as g,a7 as ee,c as M,w as te,s as se,p as ie,a8 as ae,a9 as oe,aa as G,ab as re,ac as ne}from"./index-CvP8__zr.js";const F=`
float vsLum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`,x={none:0,linear:1,aces:2};function P(a){return a===4?x.aces:a===1?x.linear:x.none}const le=`
uniform float uShoulder;   // S — value where compression begins. Shipped 1.0 = no compression.
uniform float uWhite;      // W — the asymptote. Shipped 1.0.

float vsFilmicCh(float x) {
  x = max(x, 0.0);
  if (x <= uShoulder) return x;
  float span = max(uWhite - uShoulder, 1e-4);
  return uWhite - span * exp(-(x - uShoulder) / span);
}
vec3 vsFilmic(vec3 c) {
  return vec3(vsFilmicCh(c.r), vsFilmicCh(c.g), vsFilmicCh(c.b));
}
`,ue=`
vec3 vsRRTAndODTFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 vsACES(vec3 color, float exposure) {
  const mat3 IN = mat3(
    vec3(0.59719, 0.07600, 0.02840),
    vec3(0.35458, 0.90834, 0.13383),
    vec3(0.04823, 0.01566, 0.83777));
  const mat3 OUT = mat3(
    vec3( 1.60475, -0.10208, -0.00327),
    vec3(-0.53108,  1.10813, -0.07276),
    vec3(-0.07367, -0.00605,  1.07602));
  color *= exposure / 0.6;
  color = IN * color;
  color = vsRRTAndODTFit(color);
  color = OUT * color;
  return clamp(color, 0.0, 1.0);
}
`,he=`
uniform float uDisplayExposure;

vec3 vsDisplay(vec3 c) {
  #if VS_DISPLAY == 1
    return clamp(c * uDisplayExposure, 0.0, 1.0);
  #elif VS_DISPLAY == 2
    return vsACES(c, uDisplayExposure);
  #elif VS_DISPLAY == 3
    return vsFilmic(c * uDisplayExposure);
  #else
    return c;
  #endif
}
`,ce=`
vec3 vsEncodeSRGB(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(0.41666667)) - 0.055, step(vec3(0.0031308), c));
}
`,fe=`
// The 2x2 seed [[0,2],[3,1]]/4, written without bitwise operators because ShaderMaterial compiles
// as GLSL ES 1.00 and integer bit ops do not exist there.
float vsBayer2(vec2 p) {
  p = floor(p);
  return fract(p.x * 0.5 + p.y * p.y * 0.75);
}
// Two recursions of M(2n) = M(n)/4 + M(2), which yields 16 then 64 distinct levels, each occurring
// exactly once per tile. Verified as a strict permutation by review/measure/P12.mjs claim B3.
float vsBayer4(vec2 p) { return vsBayer2(p * 0.5) * 0.25 + vsBayer2(p); }
float vsBayer8(vec2 p) { return vsBayer4(p * 0.5) * 0.25 + vsBayer2(p); }
`,me=`
float vsHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
`,de=`
vec3 vsSoftKnee(vec3 c, float threshold, float knee) {
  float br = max(c.r, max(c.g, c.b));
  float soft = clamp(br - threshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-5);
  float weight = max(soft, br - threshold) / max(br, 1e-5);
  return c * weight;
}
`,pe=`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`,D=new X;D.setAttribute("position",new $(new Float32Array([-1,-1,0,3,-1,0,-1,3,0]),3));D.setAttribute("uv",new $(new Float32Array([0,0,2,0,0,2]),2));D.boundingSphere=new Z(new v,4);const ve=new J(-1,1,1,-1,0,1);class y{constructor(e){this.material=e,this.mesh=new Y(D,e),this.mesh.frustumCulled=!1,this.scene=new Q,this.scene.add(this.mesh)}get uniforms(){return this.material.uniforms}render(e,t,{clear:s=!0}={}){const i=e.autoClear;e.autoClear=!1,e.setRenderTarget(t??null),s&&e.clear(!0,!1,!1),e.render(this.scene,ve),e.autoClear=i}dispose(){this.material.dispose()}}const T=pe;function B(a,e,{depth:t=!1,samples:s=0,name:i=""}={}){const l=new q(Math.max(1,a),Math.max(1,e),{type:H,format:A,minFilter:N,magFilter:N,wrapS:_,wrapT:_,depthBuffer:t,stencilBuffer:!1,generateMipmaps:!1,samples:s});return l.texture.name=i,l}function C(a){if(!a)return 0;const e=a.width*a.height*8,t=(a.samples||0)>0?e*a.samples:0,s=a.depthBuffer?a.width*a.height*4*Math.max(1,a.samples||1):0;return e+t+s}class ge{constructor({threshold:e,knee:t,clamp:s}){this.material=new S({name:"vs.post.bright",uniforms:{tScene:{value:null},uTexel:{value:new g},uThreshold:{value:e},uKnee:{value:t},uClamp:{value:s}},vertexShader:T,fragmentShader:`
        uniform sampler2D tScene;
        uniform vec2 uTexel;      // one source texel, in UV
        uniform float uThreshold;
        uniform float uKnee;
        uniform float uClamp;
        varying vec2 vUv;
        ${F}
        ${de}

        vec4 tap(vec2 uv) {
          vec3 c = max(texture2D(tScene, uv).rgb, 0.0);
          c = vsSoftKnee(c, uThreshold, uKnee);
          // Karis: weight by inverse luminance so one hot texel cannot dominate the average.
          float w = 1.0 / (1.0 + vsLum(c));
          return vec4(c * w, w);
        }

        void main() {
          vec2 o = uTexel * 0.5;
          vec4 s = tap(vUv + vec2(-o.x, -o.y))
                 + tap(vUv + vec2( o.x, -o.y))
                 + tap(vUv + vec2(-o.x,  o.y))
                 + tap(vUv + vec2( o.x,  o.y));
          vec3 c = s.rgb / max(s.a, 1e-5);
          float br = max(c.r, max(c.g, c.b));
          if (br > uClamp) c *= uClamp / br;   // clamp preserves hue; a per-channel min does not
          gl_FragColor = vec4(c, 1.0);
        }
      `,depthTest:!1,depthWrite:!1,toneMapped:!1}),this.blit=new y(this.material)}render(e,t,s,i,l){this.material.uniforms.tScene.value=t,this.material.uniforms.uTexel.value.set(1/s,1/i),this.blit.render(e,l)}set(e,t,s){this.material.uniforms.uThreshold.value=e,this.material.uniforms.uKnee.value=t,this.material.uniforms.uClamp.value=s}dispose(){this.blit.dispose()}}const we=.004,U=3,k=8,be=[.55,.7,.85,.95,1,1,1,1];function j(a){const e=Math.log2(we*Math.max(8,a))-1,t=Math.max(0,Math.min(k-U,Math.round(e))),s=Math.min(k,t+U);return{base:t,top:s,radius:Math.pow(2,e-t)}}function xe(a){const{top:e,radius:t}=j(a);return Math.pow(2,e+1)*t/Math.max(8,a)}class Se{constructor(){this.mips=[],this.base=0,this.top=0,this.radius=1,this.downMaterial=new S({name:"vs.post.bloom.down",uniforms:{tSrc:{value:null},uTexel:{value:new g}},vertexShader:T,fragmentShader:`
        uniform sampler2D tSrc;
        uniform vec2 uTexel;
        varying vec2 vUv;
        ${F}
        vec3 T(vec2 o) { return texture2D(tSrc, vUv + o * uTexel).rgb; }
        void main() {
          // 13 taps: a 3x3 grid at +-2 texels plus a 2x2 at +-1. The inner quad carries half the
          // weight, which is what stops the chain from aliasing a bright single texel into a
          // flickering blob two levels down — §11.4's 3%-per-step emitter budget, upstream.
          vec3 a = T(vec2(-2.0, -2.0)), b = T(vec2(0.0, -2.0)), c = T(vec2(2.0, -2.0));
          vec3 d = T(vec2(-2.0,  0.0)), e = T(vec2(0.0,  0.0)), f = T(vec2(2.0,  0.0));
          vec3 g = T(vec2(-2.0,  2.0)), h = T(vec2(0.0,  2.0)), i = T(vec2(2.0,  2.0));
          vec3 j = T(vec2(-1.0, -1.0)), k = T(vec2(1.0, -1.0));
          vec3 l = T(vec2(-1.0,  1.0)), m = T(vec2(1.0,  1.0));
          vec3 o = e * 0.125;
          o += (a + c + g + i) * 0.03125;
          o += (b + d + f + h) * 0.0625;
          o += (j + k + l + m) * 0.125;
          gl_FragColor = vec4(o, 1.0);
        }
      `,depthTest:!1,depthWrite:!1,toneMapped:!1}),this.upMaterial=new S({name:"vs.post.bloom.up",uniforms:{tSrc:{value:null},uTexel:{value:new g},uRadius:{value:1},uWeight:{value:1}},vertexShader:T,fragmentShader:`
        uniform sampler2D tSrc;
        uniform vec2 uTexel;
        uniform float uRadius;
        uniform float uWeight;
        varying vec2 vUv;
        vec3 T(vec2 o) { return texture2D(tSrc, vUv + o * uTexel * uRadius).rgb; }
        void main() {
          // 9-tap tent — 1 2 1 / 2 4 2 / 1 2 1, normalised.
          vec3 o = T(vec2(-1.0, -1.0)) + T(vec2(0.0, -1.0)) * 2.0 + T(vec2(1.0, -1.0));
          o += T(vec2(-1.0, 0.0)) * 2.0 + T(vec2(0.0, 0.0)) * 4.0 + T(vec2(1.0, 0.0)) * 2.0;
          o += T(vec2(-1.0, 1.0)) + T(vec2(0.0, 1.0)) * 2.0 + T(vec2(1.0, 1.0));
          gl_FragColor = vec4(o * (0.0625 * uWeight), 1.0);
        }
      `,depthTest:!1,depthWrite:!1,toneMapped:!1,blending:ee}),this.down=new y(this.downMaterial),this.up=new y(this.upMaterial)}get texture(){return this.mips[this.base]?.texture??null}get brightTarget(){return this.mips[0]??null}get drawCalls(){return this.top+(this.top-this.base)}setSize(e,t){const{base:s,top:i,radius:l}=j(t);if(this.radius=l,this.base=s,this.top!==i){for(const o of this.mips)o.dispose();this.mips=[],this.top=i;for(let o=0;o<=i;o++)this.mips.push(B(1,1,{name:`vs.bloom.${o}`}))}for(let o=0;o<=i;o++){const u=Math.max(1,Math.floor(e/Math.pow(2,o+1))),n=Math.max(1,Math.floor(t/Math.pow(2,o+1)));this.mips[o].setSize(u,n)}}render(e){for(let t=1;t<=this.top;t++){const s=this.mips[t-1];this.downMaterial.uniforms.tSrc.value=s.texture,this.downMaterial.uniforms.uTexel.value.set(1/s.width,1/s.height),this.down.render(e,this.mips[t])}for(let t=this.top;t>this.base;t--){const s=this.mips[t];this.upMaterial.uniforms.tSrc.value=s.texture,this.upMaterial.uniforms.uTexel.value.set(1/s.width,1/s.height),this.upMaterial.uniforms.uRadius.value=this.radius,this.upMaterial.uniforms.uWeight.value=be[this.top-t]??1,this.up.render(e,this.mips[t-1],{clear:!1})}}stats(){return{base:this.base,top:this.top,lobes:this.top-this.base,tentRadius:Number(this.radius.toFixed(3)),compositeSize:this.mips[this.base]?[this.mips[this.base].width,this.mips[this.base].height]:null,mipSizes:this.mips.map(e=>[e.width,e.height]),drawCalls:this.drawCalls}}dispose(){for(const e of this.mips)e.dispose();this.mips=[],this.down.dispose(),this.up.dispose()}}class V{constructor({samples:e=16}={}){this.samples=e,this.material=new S({name:"vs.post.sunglow",defines:{SAMPLES:e},uniforms:{tBright:{value:null},uSun:{value:new g(.5,.5)},uReach:{value:.26},uDecay:{value:.9},uWeight:{value:0}},vertexShader:T,fragmentShader:`
        uniform sampler2D tBright;
        uniform vec2 uSun;
        uniform float uReach;
        uniform float uDecay;
        uniform float uWeight;
        varying vec2 vUv;

        void main() {
          if (uWeight <= 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
          vec2 delta = (vUv - uSun) * (uReach / float(SAMPLES));
          vec2 p = vUv;
          float w = 1.0;
          float norm = 0.0;
          vec3 acc = vec3(0.0);
          for (int i = 0; i < SAMPLES; i++) {
            p -= delta;
            acc += texture2D(tBright, p).rgb * w;
            norm += w;
            w *= uDecay;
          }
          // Normalised by the weight sum, not by the tap count: the pass redistributes the bright
          // buffer's energy along a short radius, it does not manufacture any.
          gl_FragColor = vec4(acc * (uWeight / max(norm, 1e-4)), 1.0);
        }
      `,depthTest:!1,depthWrite:!1,toneMapped:!1}),this.blit=new y(this.material)}render(e,t,s,i,l){const o=this.material.uniforms;o.tBright.value=t,o.uSun.value.copy(s),o.uWeight.value=i,this.blit.render(e,l)}dispose(){this.blit.dispose()}}const w=new v,W=new v;function ye(a,e,t){W.set(0,0,-1).applyQuaternion(a.quaternion);const s=W.dot(e);w.copy(a.position).addScaledVector(e,1e4).project(a),t.set(w.x*.5+.5,w.y*.5+.5);const i=Math.max(Math.abs(w.x),Math.abs(w.y)),l=O(.05,.35,s),o=1-O(1,1.9,i);return{uv:t,weight:s>0?l*o:0,onScreen:s>0&&Math.abs(w.x)<=1&&Math.abs(w.y)<=1}}function O(a,e,t){const s=Math.min(1,Math.max(0,(t-a)/(e-a)));return s*s*(3-2*s)}const r={exposure:1,contrast:1,pivot:.18,lift:[0,0,0],gain:[1,1,1],gamma:[1,1,1],saturation:1,shoulder:1,white:1,bloomThreshold:1.25,bloomKnee:.35,bloomClamp:8,bloomStrength:.055,sunGlowStrength:.42,vignetteAmount:.08,vignetteStart:.72,grainAmount:.0018,ditherAmount:.5};class Te{constructor(e,t=x.none){this.enabled={bloom:!1,sunGlow:!1,grain:!1,vignette:!1,...e},this.displayMode=t,this.material=new S({name:"vs.post.grade",defines:this._defines(),uniforms:{tScene:{value:null},tBloom:{value:null},tSunGlow:{value:null},uAspect:{value:16/9},uResolution:{value:new g(1920,1080)},uGrainCell:{value:1},uDisplayExposure:{value:1},uExposure:{value:r.exposure},uContrast:{value:r.contrast},uPivot:{value:r.pivot},uShoulder:{value:r.shoulder},uWhite:{value:r.white},uLift:{value:new v(...r.lift)},uGain:{value:new v(...r.gain)},uGamma:{value:new v(...r.gamma)},uSaturation:{value:r.saturation},uBloom:{value:r.bloomStrength},uSunGlow:{value:0},uVignette:{value:r.vignetteAmount},uVignetteStart:{value:r.vignetteStart},uGrain:{value:r.grainAmount},uDither:{value:r.ditherAmount}},vertexShader:T,fragmentShader:`
        uniform sampler2D tScene;
        uniform sampler2D tBloom;
        uniform sampler2D tSunGlow;
        uniform float uAspect;
        uniform vec2 uResolution;
        uniform float uGrainCell;
        uniform float uExposure;
        uniform float uContrast;
        uniform float uPivot;
        uniform vec3 uLift;
        uniform vec3 uGain;
        uniform vec3 uGamma;
        uniform float uSaturation;
        uniform float uBloom;
        uniform float uSunGlow;
        uniform float uVignette;
        uniform float uVignetteStart;
        uniform float uGrain;
        uniform float uDither;
        varying vec2 vUv;

        ${F}
        ${le}
        ${ue}
        ${he}
        ${ce}
        ${fe}
        ${me}

        // Radius normalised so 0 is the frame centre and 1.0 is a corner, measured in frame
        // HEIGHTS so a 21:9 window and a 4:3 window get the same falloff along the short axis.
        float cornerRadius(vec2 uv) {
          vec2 d = (uv - 0.5) * vec2(uAspect, 1.0);
          float corner = length(vec2(uAspect, 1.0) * 0.5);
          return length(d) / corner;
        }

        void main() {
          vec2 uv = vUv;
          vec3 c = max(texture2D(tScene, uv).rgb, 0.0);

          #ifdef VS_BLOOM
            c += texture2D(tBloom, uv).rgb * uBloom;
          #endif
          #ifdef VS_SUNGLOW
            c += texture2D(tSunGlow, uv).rgb * uSunGlow;
          #endif

          #ifdef VS_VIGNETTE
            float v = 1.0 - uVignette * smoothstep(uVignetteStart, 1.0, cornerRadius(uv));
            c *= v;
          #endif

          c *= uExposure;

          // Contrast about a log pivot at mid-grey. In linear this is a power law that leaves 0 at
          // 0 and uPivot at uPivot, so it adds mid-tone separation without moving the black point
          // or the exposure. Ships at 1.0, which is an exact wire.
          if (uContrast != 1.0) {
            c = uPivot * exp2(log2(max(c, 1e-5) / uPivot) * uContrast);
          }

          c = vsDisplay(c);                       // -> display-linear. A mirror, not a look.

          // Lift / gamma / gain, the classic three-way, on bounded values. All identity as shipped.
          c = clamp(c, 0.0, 1.0);
          c = uLift + c * (uGain - uLift);
          c = pow(max(c, 0.0), 1.0 / uGamma);

          if (uSaturation != 1.0) {
            c = mix(vec3(vsLum(c)), c, uSaturation);
          }
          c = clamp(c, 0.0, 1.0);

          #ifdef VS_GRAIN
            // Static tile in DEVICE pixels, with a cell size that grows with resolution so the
            // grain is the same apparent size at 720p and at 4K. Windowed by luminance: none in
            // the blacks, where §7.4 budgets only 0.44% of frame below Y 0.004 and noise would
            // read as a broken shadow, and none in the highlights, where §5.4 needs the accent
            // clean.
            float y = vsLum(c);
            float g = vsHash(floor(gl_FragCoord.xy / uGrainCell)) - 0.5;
            float gw = smoothstep(0.02, 0.14, y) * (1.0 - smoothstep(0.55, 0.95, y));
            c = clamp(c + g * uGrain * gw, 0.0, 1.0);
          #endif

          vec3 s = vsEncodeSRGB(c);

          // The last operation in the frame, at 8-bit quantisation, from a fixed tile indexed in
          // device pixels. No time term: see BAYER in glsl.js.
          s += (vsBayer8(gl_FragCoord.xy) - 0.5) * (uDither * 2.0 / 255.0);

          gl_FragColor = vec4(clamp(s, 0.0, 1.0), 1.0);
        }
      `,depthTest:!1,depthWrite:!1,toneMapped:!1}),this.blit=new y(this.material)}_defines(){const e={VS_DISPLAY:String(this.displayMode)};return this.enabled.bloom&&(e.VS_BLOOM=""),this.enabled.sunGlow&&(e.VS_SUNGLOW=""),this.enabled.grain&&(e.VS_GRAIN=""),this.enabled.vignette&&(e.VS_VIGNETTE=""),e}configure({enabled:e,displayMode:t}={}){e&&(this.enabled={...this.enabled,...e}),t!==void 0&&(this.displayMode=t),this.material.defines=this._defines(),this.material.needsUpdate=!0}setLook(e){const t=this.material.uniforms,s={exposure:"uExposure",contrast:"uContrast",pivot:"uPivot",shoulder:"uShoulder",white:"uWhite",saturation:"uSaturation",bloomStrength:"uBloom",vignetteAmount:"uVignette",vignetteStart:"uVignetteStart",grainAmount:"uGrain",ditherAmount:"uDither"};for(const[i,l]of Object.entries(s))e[i]!==void 0&&(t[l].value=e[i]);for(const i of["lift","gain","gamma"])e[i]&&t[`u${i[0].toUpperCase()}${i.slice(1)}`].value.set(...e[i])}setSize(e,t,s){const i=this.material.uniforms;i.uResolution.value.set(e,t),i.uAspect.value=s,i.uGrainCell.value=Math.max(1,Math.round(t/1080))}render(e,t,s,i,l,o,u){const n=this.material.uniforms;n.tScene.value=t,n.tBloom.value=s,n.tSunGlow.value=i,n.uSunGlow.value=l,n.uDisplayExposure.value=o,this.blit.render(e,u)}dispose(){this.blit.dispose()}}const I=new Set(["tonemap","bloom","godrays","grain","vignette","ca"]),K={ca:"chromatic aberration lays a coloured multi-pixel ramp across every silhouette; art-direction §4 requires a 1.4 px antialiased geometric edge and §6.1 bans lens artefacts"};function Me(a,e,t){return t!==null?t:!e.capabilities.isWebGL2||Ge(e)||a>9e6?0:a>25e5?2:4}function Ge(a){try{const e=a.getContext(),t=e.getExtension("WEBGL_debug_renderer_info"),s=String(t?e.getParameter(t.UNMASKED_RENDERER_WEBGL):e.getParameter(e.RENDERER));return/swiftshader|llvmpipe|software|basic render/i.test(s)}catch{return!1}}class _e{constructor(e){this.kernel=e,this.renderer=e.renderer,this.scene=e.scene,this.camera=e.camera;const t=Array.isArray(M.tier.postStack)?[...M.tier.postStack]:[];this.requested=t,this.declined=[],this.unknown=t.filter(n=>!I.has(n));for(const n of this.unknown)te(`PostStack: unknown pass "${n}" in tier ${M.tier.id}`);const s=new Set(t.filter(n=>I.has(n)));for(const n of Object.keys(K))s.delete(n)&&this.declined.push({id:n,why:K[n]});const i=new URLSearchParams(location.search),l=i.get("post");this.mode=l==="off"||l==="bare"||l==="on"?l:"tier";const o=i.get("postMsaa");if(this.msaaOverride=o===null?null:Math.max(0,Math.min(8,Number(o)|0)),this.effects={bloom:s.has("bloom"),sunGlow:s.has("godrays"),grain:s.has("grain"),vignette:s.has("vignette")},this.mode==="bare")for(const n of Object.keys(this.effects))this.effects[n]=!1;const u=Object.values(this.effects).some(Boolean);this.installed=this.mode==="off"?!1:this.mode!=="tier"||u,this.size=new g(1,1),this.sceneTarget=null,this.sunGlowTarget=null,this.bright=null,this.bloom=null,this.sunGlow=null,this.grade=null,this.displayMode=x.none,this._sunUv=new g(.5,.5),this._sun={uv:this._sunUv,weight:0,onScreen:!1},this.sunDir=new v(.35,.16,-.92).normalize(),this.sunSource="default",this._offSun=se.on("world:sun",n=>this._adoptSun(n)),this._frames=0,this._glowDrawn=null,this._lastDraws=0,this.installed&&this._build(),ie("post",()=>this.report())}_build(){const e=this._drawingBuffer();this.bright=new ge({threshold:r.bloomThreshold,knee:r.bloomKnee,clamp:r.bloomClamp}),this.bloom=new Se,this.effects.sunGlow&&(this.sunGlow=new V),this.displayMode=P(this.renderer.toneMapping),this.grade=new Te(this.effects,this.displayMode),this.setSize(e.x,e.y),this.kernel.composer=this}_drawingBuffer(){return this.renderer.getDrawingBufferSize(new g)}_adoptSun(e){const t=e?.direction;if(!t||typeof t.x!="number")return;const s=new v(t.x,t.y,t.z);s.lengthSq()<1e-8||(this.sunDir.copy(s).normalize(),this.sunSource=e.source??"signal")}_seedSunFromScene(){const e=this.scene.userData?.sunDirection;if(e&&typeof e.x=="number"){this.sunDir.set(e.x,e.y,e.z).normalize(),this.sunSource="scene.userData";return}let t=null;if(this.scene.traverse(s=>{s.isDirectionalLight&&s.intensity>0&&(!t||s.intensity>t.intensity)&&(t=s)}),t){const s=new v().subVectors(t.position,t.target.position);s.lengthSq()>1e-8&&(this.sunDir.copy(s).normalize(),this.sunSource=`light:${t.name||"directional"}`)}}resize(){if(!this.installed)return;const e=this._drawingBuffer();this.setSize(e.x,e.y)}setSize(e,t){const s=Math.max(1,Math.floor(e)),i=Math.max(1,Math.floor(t));if(this.size.x===s&&this.size.y===i&&this.sceneTarget)return;this.size.set(s,i);const l=Me(s*i,this.renderer,this.msaaOverride);if(!this.sceneTarget||this.sceneTarget.samples!==l?(this.sceneTarget?.dispose(),this.sceneTarget=B(s,i,{depth:!0,samples:l,name:"vs.post.scene"})):this.sceneTarget.setSize(s,i),this.bloom.setSize(s,i),this.sunGlow){const o=Math.max(1,Math.floor(s/4)),u=Math.max(1,Math.floor(i/4));this.sunGlowTarget?this.sunGlowTarget.setSize(o,u):this.sunGlowTarget=B(o,u,{name:"vs.post.sunglow"})}this.grade.setSize(s,i,s/i)}render(){const e=this.renderer,t=this._drawingBuffer();(t.x!==this.size.x||t.y!==this.size.y)&&this.setSize(t.x,t.y),this._frames===0&&this.sunSource==="default"&&this._seedSunFromScene(),this._frames++;const s=P(e.toneMapping);s!==this.displayMode&&(this.displayMode=s,this.grade.configure({displayMode:s})),e.setRenderTarget(this.sceneTarget),e.render(this.scene,this.camera);let i=null,l=null,o=0;(this.effects.bloom||this.effects.sunGlow)&&this.bright.render(e,this.sceneTarget.texture,this.size.x,this.size.y,this.bloom.brightTarget),this.effects.sunGlow&&(this._sun=ye(this.camera,this.sunDir,this._sunUv),o=this._sun.weight*r.sunGlowStrength,this._sun.weight>0?(this.sunGlow.render(e,this.bloom.brightTarget.texture,this._sun.uv,1,this.sunGlowTarget),this._glowDrawn=!0):this._glowDrawn!==!1&&(e.setRenderTarget(this.sunGlowTarget),e.clear(!0,!1,!1),this._glowDrawn=!1),l=this.sunGlowTarget.texture),this.effects.bloom&&(this.bloom.render(e),i=this.bloom.texture),this.grade.render(e,this.sceneTarget.texture,i,l,o,e.toneMappingExposure,null),this._lastDraws=this.drawCallCount()}drawCallCount(){if(!this.installed)return 0;let e=1;return(this.effects.bloom||this.effects.sunGlow)&&(e+=1),this.effects.sunGlow&&(e+=1),this.effects.bloom&&(e+=this.bloom.drawCalls),e}setEnabled(e){return e&&!this.installed?(this.installed=!0,this.grade?this.kernel.composer=this:this._build()):!e&&this.installed&&(this.installed=!1,this.kernel.composer=null),this.installed}setEffect(e,t){return!(e in this.effects)||(this.effects[e]=!!t,!this.grade)?!1:(e==="sunGlow"&&t&&!this.sunGlow&&(this.sunGlow=new V,this.size.set(0,0),this.resize()),this.grade.configure({enabled:this.effects}),!0)}setLook(e){this.grade?.setLook(e),(e.bloomThreshold!==void 0||e.bloomKnee!==void 0||e.bloomClamp!==void 0)&&this.bright?.set(e.bloomThreshold??r.bloomThreshold,e.bloomKnee??r.bloomKnee,e.bloomClamp??r.bloomClamp)}sampleScene(e=256){if(!this.installed||!this.sceneTarget)return null;const t=this.size.x,s=this.size.y,i=Math.max(1,Math.ceil(Math.max(t,s)/e)),l=Math.floor(t/i),o=Math.floor(s/i),u=new Uint16Array(t*4),n=[],h=[];for(let d=0;d<o;d++){const m=Math.min(s-1,d*i);this.renderer.readRenderTargetPixels(this.sceneTarget,0,m,t,1,u);for(let c=0;c<l;c++){const b=Math.min(t-1,c*i)*4,z=E(u[b]),R=E(u[b+1]),L=E(u[b+2]);n.push(.2126*z+.7152*R+.0722*L),h.push(Math.max(z,R,L))}}const f=(d,m)=>{const c=Float64Array.from(d).sort();return c.length?c[Math.min(c.length-1,Math.floor(m*(c.length-1)))]:0},p=(d,m)=>d.reduce((c,b)=>c+(b>m?1:0),0)/Math.max(1,d.length);return{samples:n.length,grid:[l,o],luminance:{p50:f(n,.5),p95:f(n,.95),p99:f(n,.99),p999:f(n,.999),max:Math.max(...n)},maxChannel:{p50:f(h,.5),p95:f(h,.95),p99:f(h,.99),p999:f(h,.999),max:Math.max(...h)},shareAbove:{"0.8":p(h,.8),"1.0":p(h,1),"1.25":p(h,1.25),"1.5":p(h,1.5),"2.0":p(h,2),"4.0":p(h,4)},threshold:r.bloomThreshold}}processLinearRGB(e,{bloom:t=!0}={}){if(!this.installed)return null;const{width:s,height:i}=e,l=e.data.length/(s*i),o=new Float32Array(s*i*4);for(let m=0,c=0;m<s*i;m++,c+=l)o[m*4]=e.data[c],o[m*4+1]=e.data[c+1],o[m*4+2]=e.data[c+2],o[m*4+3]=1;const u=new ae(o,s,i,A,oe);u.minFilter=G,u.magFilter=G,u.wrapS=_,u.wrapT=_,u.generateMipmaps=!1,u.needsUpdate=!0;const n=new q(s,i,{type:re,format:A,minFilter:G,magFilter:G,depthBuffer:!1,stencilBuffer:!1,generateMipmaps:!1});n.texture.colorSpace=ne;const h={x:this.size.x,y:this.size.y},f=this.effects.bloom;this.size.set(0,0),this.bloom.setSize(s,i),this.grade.setSize(s,i,s/i),f!==t&&(this.effects.bloom=t,this.grade.configure({enabled:this.effects})),t&&(this.bright.render(this.renderer,u,s,i,this.bloom.brightTarget),this.bloom.render(this.renderer)),this.grade.render(this.renderer,u,t?this.bloom.texture:null,null,0,this.renderer.toneMappingExposure,n);const p=new Uint8Array(s*i*4);this.renderer.readRenderTargetPixels(n,0,0,s,i,p),this.renderer.setRenderTarget(null);const d={base:this.bloom.base,top:this.bloom.top,radius:this.bloom.radius};return f!==t&&(this.effects.bloom=f,this.grade.configure({enabled:this.effects})),n.dispose(),u.dispose(),this.size.set(0,0),this.setSize(h.x,h.y),{width:s,height:i,data:p,bloomLevels:d}}report(){const e=C(this.sceneTarget)+C(this.sunGlowTarget)+(this.bloom?.mips??[]).reduce((t,s)=>t+C(s),0);return{installed:this.installed,mode:this.mode,tier:M.tier.id,requested:this.requested,declined:this.declined,unknown:this.unknown,effects:{...this.effects},display:{mode:this.displayMode,name:["none","linear","aces","vs"][this.displayMode]??"?",mirrors:this.renderer.toneMapping,exposure:Number((this.renderer.toneMappingExposure??1).toFixed(4))},size:this.installed?[this.size.x,this.size.y]:null,samples:this.sceneTarget?.samples??0,targets:this.installed?(this.sceneTarget?1:0)+(this.bloom?.mips.length??0)+(this.sunGlowTarget?1:0):0,targetBytes:e,megabytes:Number((e/1048576).toFixed(2)),postDrawCalls:this.drawCallCount(),bloom:this.bloom?{...this.bloom.stats(),radiusFractionOfHeight:Number(xe(this.size.y).toFixed(4))}:null,sun:{source:this.sunSource,direction:[Number(this.sunDir.x.toFixed(4)),Number(this.sunDir.y.toFixed(4)),Number(this.sunDir.z.toFixed(4))],uv:[Number(this._sun.uv.x.toFixed(4)),Number(this._sun.uv.y.toFixed(4))],weight:Number(this._sun.weight.toFixed(4)),onScreen:this._sun.onScreen},look:{bloomThreshold:r.bloomThreshold,bloomKnee:r.bloomKnee,bloomStrength:r.bloomStrength,sunGlowStrength:r.sunGlowStrength,vignetteAmount:r.vignetteAmount,vignetteStart:r.vignetteStart,grainAmount:r.grainAmount,ditherAmount:r.ditherAmount,shoulder:r.shoulder,white:r.white,gradeIsIdentity:r.lift.every(t=>t===0)&&r.gain.every(t=>t===1)&&r.gamma.every(t=>t===1)},frames:this._frames}}dispose(){this._offSun?.(),this.kernel.composer===this&&(this.kernel.composer=null),this.sceneTarget?.dispose(),this.sunGlowTarget?.dispose(),this.bright?.dispose(),this.bloom?.dispose(),this.sunGlow?.dispose(),this.grade?.dispose()}}function E(a){const e=(a&32768)>>15,t=(a&31744)>>10,s=a&1023;return t===0?(e?-1:1)*Math.pow(2,-14)*(s/1024):t===31?s?NaN:(e?-1:1)*(1/0):(e?-1:1)*Math.pow(2,t-15)*(1+s/1024)}const Ce={id:"post",order:52,async setup(a){a.mount("post",new _e(a))}};export{Ce as default};
