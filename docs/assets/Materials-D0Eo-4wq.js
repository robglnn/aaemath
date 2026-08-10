import{b as le,V as I,C as R,d as re,D as de,j as _,L as he,F as J,e as ue,w as se,G as P,U as Q,M as H,W as y,J as U,z as me,X as z,Y as ee,q as fe}from"./index-2rgWg1WU.js";import{p as K}from"./palette-wYCl9Rsm.js";const ge=K.roles??{},we=K.constructedRoles??{},ve=new Set(Object.keys(K.removedRoles??{})),be=16711935,X=new Set;function pe(t){const e=ge[t]??we[t];if(!e){if(!X.has(t)){X.add(t);const a=ve.has(t)?` — that role was REMOVED on purpose (${K.removedRoles[t]?.why??"banned by the target"})`:"";se(`Materials: palette role "${t}" does not exist${a} — rendering debug magenta`)}return be}return parseInt(e.hex.slice(1),16)}function b(t){return new R().setHex(pe(t),_)}const ye=16769976,Se=2760470,We=9067326,C=new R().setHex(ye,_),Y=.342,te=new R().setHex(Se,_),Z={};function x(t,{ndl:e=1,hemi:a=.5,label:s=t}={}){const c=b(t),r=ne(),n=["r","g","b"].map(f=>(te[f]+(r.color[f]-te[f])*a)*r.intensity/Math.PI),o=new R(c.r/(C.r*e+n[0]),c.g/(C.g*e+n[1]),c.b/(C.b*e+n[2])),l=Math.max(o.r,o.g,o.b);return l>1&&(se(`Materials: albedo "${s}" from ${t} at N·L ${e} exceeds 1 (${l.toFixed(3)}) — clamped`),o.multiplyScalar(1/l)),Z[s]={from:t,sampled:`#${c.getHexString(_).toUpperCase()}`,ndl:e,hemi:a,albedo:`#${o.clone().getHexString(_).toUpperCase()}`,linear:[k(o.r),k(o.g),k(o.b)],clamped:l>1?k(l):void 0},o}let xe=null;function ne(){return xe??=Ve()}function Ve(){const t=b("ground.lit"),e=b("ground.shadow"),a=n=>[t[n],e[n],C[n]],s=["r","g","b"].map(n=>{const[o,l,f]=a(n),w=Math.min(.985,l/Math.max(o,1e-6));return w/(1-w)*f*Math.PI*Y}),c=Math.max(...s),r=new R(s[0]/c,s[1]/c,s[2]/c);return{color:r,intensity:c,hex:`#${r.clone().getHexString(_).toUpperCase()}`,linear:s.map(k),method:"shadow/lit on (ground.lit, ground.shadow), solved for fill/(key+fill) — art-direction §3.1",printedInDoc:"#66B3FF"}}function ae(t,e,a){const s=b(t),c=b(e),r=new R(Math.max(0,c.r-s.r)/C.r,Math.max(0,c.g-s.g)/C.g,Math.max(0,c.b-s.b)/C.b);return Z[a]={from:`${e} - ${t}`,sampled:`#${c.getHexString(_).toUpperCase()}`,ladderStep:1,albedo:`#${r.clone().getHexString(_).toUpperCase()}`,linear:[k(r.r),k(r.g),k(r.b)]},r}function De(t,e,a){return t.clone().lerp(a,e)}const Me={uVsKeyDir:{value:new I(0,1,0)},uVsKeyRadiance:{value:new R(0,0,0)},uVsRim:{value:new re(0,1,0,0)},uVsShadowTint:{value:new R(0,0,0)},uVsCascade:{value:new le(14,60)},uVsTime:{value:0}},Te=`
varying vec3 vVsWorld;

uniform vec3  uVsKeyDir;
uniform vec3  uVsKeyRadiance;
uniform vec4  uVsRim;
uniform vec3  uVsShadowTint;
uniform vec2  uVsCascade;
uniform float uVsTime;

uniform vec4  uVsTune;      // x tint weight, y rim weight, z turned-face knee, w spare
uniform vec4  uVsWater;     // x ramp A freq, y ramp B freq, z scroll m/s, w band A threshold
uniform vec3  uVsWaterBody;
uniform vec3  uVsWaterMid;
uniform vec3  uVsWaterHot;
`,Re=`
float vsKeyShadow( float viewDist ) {
	float s = 1.0;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
		DirectionalLightShadow vsS0 = directionalLightShadows[ 0 ];
		s = getShadow( directionalShadowMap[ 0 ], vsS0.shadowMapSize, vsS0.shadowIntensity, vsS0.shadowBias, vsS0.shadowRadius, vDirectionalShadowCoord[ 0 ] );
		#if NUM_DIR_LIGHT_SHADOWS > 1
			DirectionalLightShadow vsS1 = directionalLightShadows[ 1 ];
			float far = getShadow( directionalShadowMap[ 1 ], vsS1.shadowMapSize, vsS1.shadowIntensity, vsS1.shadowBias, vsS1.shadowRadius, vDirectionalShadowCoord[ 1 ] );
			// Blend across the split rather than switching: §11.3 forbids a hard family change.
			s = mix( s, far, smoothstep( uVsCascade.x * 0.78, uVsCascade.x, viewDist ) );
		#endif
	#endif
	return s;
}
`,_e=`
	vVsWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
`,ke=`
#ifdef VS_WATER
	{
		vec2 p = vVsWorld.xz;
		float a = fract( dot( p, vec2( 0.9239, 0.3827 ) ) * uVsWater.x - uVsTime * uVsWater.z );
		float b = fract( dot( p, vec2( -0.3827, 0.9239 ) ) * uVsWater.y + uVsTime * uVsWater.z * 0.62 );
		float band = step( uVsWater.w, a ) + step( 0.93, b );
		totalEmissiveRadiance = band > 1.5 ? uVsWaterHot : ( band > 0.5 ? uVsWaterMid : uVsWaterBody );
	}
#endif
`,Ee=`
	{
		// View -> world for a direction: the view matrix's rotation is orthonormal, so its transpose
		// is its inverse. Doing it this way (rather than a world-normal varying) is what makes the
		// grade correct for BOTH routes in §2.1 — baked per-face normals and FLAT_SHADED skinned
		// meshes, whose normal only exists as a screen-space derivative.
		vec3 vsN = normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
		float vsDist = distance( cameraPosition, vVsWorld );
		float vsNdL = dot( vsN, uVsKeyDir );

		#ifdef VS_KEYSHADOW
			float vsShadow = receiveShadow ? vsKeyShadow( vsDist ) : 1.0;
			outgoingLight -= diffuseColor.rgb * uVsKeyRadiance * max( vsNdL, 0.0 ) * ( 1.0 - vsShadow );
		#endif

		#ifdef VS_TINT
			// §3.4, the single most important paragraph in the art bible. A face TURNED FROM THE KEY
			// converges on one chromatic blue whatever its albedo — rock, a shelf underside and the
			// character's armour all measure hue 195–201 on the target. This is purely geometric:
			// a cast shadow does not enter it, which is what keeps ground in a cast shadow at its own
			// albedo under the blue fill, i.e. green, i.e. the other half of the bimodal dark end.
			float vsTurned = 1.0 - smoothstep( -uVsTune.z, uVsTune.z * 4.0, vsNdL );
			vec3 vsShade = uVsShadowTint;

			#ifdef VS_RIM
				// The separator that keeps a faceted silhouette off the sky.
				//
				// It lives INSIDE the shadow family and scales the tint itself, so it can move value
				// and can never move hue or saturation: a rimmed shadow face is the same colour as an
				// unrimmed one, up to 1.30x brighter. That is not a fifth shadow value — it is the
				// spread the target itself carries across its three shadow witnesses (Y 0.0227 rock,
				// 0.0245 shelf underside, 0.0290 armour = 1.28x), which is why they are not identical.
				//
				// It is N.L on a world-fixed direction, so it is geometry catching the anti-sun sky.
				// No view vector appears anywhere in it: it cannot draw a Fresnel outline round a
				// shape (anti-pattern 3) and it cannot follow the camera (§10.4).
				vsShade *= 1.0 + uVsRim.w * uVsTune.y * max( dot( vsN, uVsRim.xyz ), 0.0 );
			#endif

			outgoingLight = mix( outgoingLight, vsShade, vsTurned * uVsTune.x );
		#endif
	}
`,j=(t,e,a,s)=>new re(t,e,a,s),T={lit:1,e:.27},v={full:.94,hero:.9,foliage:.86,none:0},He=.035,oe={rock:{albedo:()=>x("rock.lit.a",{ndl:T.lit,hemi:.5,label:"rock"}),tint:v.full,rim:1},ground:{albedo:()=>x("ground.lit",{ndl:Y,hemi:1,label:"ground"}),tint:v.full,rim:.85},stone:{albedo:()=>x("stone.bone",{ndl:T.lit,hemi:.5,label:"stone"}),tint:v.full,rim:1},metal:{albedo:()=>De(x("stone.bone",{ndl:T.lit,hemi:.5,label:"metal"}),.3,ne().color),tint:v.full,rim:1,record:"metal"},grey:{albedo:()=>x("world.grey",{ndl:Y,hemi:1,label:"grey"}),tint:v.none,rim:0},greyDeep:{albedo:()=>x("world.grey.deep",{ndl:T.e,hemi:.5,label:"greyDeep"}),tint:v.none,rim:0},foliage:{albedo:()=>x("world.foliage.lit",{ndl:T.lit,hemi:.6,label:"foliage"}),tint:v.foliage,rim:.4,side:de,alphaTest:.5},crystal:{albedo:()=>ae("crystal.face","crystal.hot","crystal"),emissive:()=>b("crystal.face"),tint:v.none,rim:0,accent:!0},crystalCore:{albedo:()=>ae("crystal.face","crystal.hot","crystalCore"),emissive:()=>b("crystal.hot").multiplyScalar(.86),tint:v.none,rim:0,accent:!0},water:{albedo:()=>b("water.body").multiplyScalar(.3),emissive:()=>b("water.body"),tint:v.none,rim:0,accent:!0,water:j(1/9,1/6.5,.03,.8)},vein:{basic:!0,albedo:()=>b("water.core"),accent:!0},heroPlate:{albedo:()=>x("hero.rim",{ndl:T.lit,hemi:.5,label:"heroPlate"}),tint:v.hero,rim:1,flatShading:!0},heroSkin:{albedo:()=>x("hero.skin",{ndl:T.e,hemi:.5,label:"heroSkin"}),tint:v.hero,rim:.55,flatShading:!0},heroHair:{albedo:()=>x("hero.hair",{ndl:T.e,hemi:.5,label:"heroHair"}),tint:v.hero,rim:.55,flatShading:!0},heroDark:{albedo:()=>x("hero.dark",{ndl:T.e,hemi:.5,label:"heroDark"}),tint:v.hero,rim:.3,flatShading:!0},cloudSlab:{basic:!0,albedo:()=>b("cloud.slab"),alphaTest:.5},glyph:{basic:!0,albedo:()=>b("math.glyph")}};class Le{constructor(){this.cache=new Map,this.built=0,this.hits=0}get(e,a=null){const s=oe[e];if(!s)throw new Error(`Materials: unknown archetype "${e}"`);const c=a?`${e}|${Ie(a)}`:e,r=this.cache.get(c);if(r)return this.hits++,r;const n=this._build(e,s,a||{});return n.userData.vsKey=c,this.cache.set(c,n),this.built++,n}_build(e,a,s){const c=s.color!==void 0?new R().setHex(s.color,_):a.albedo();if(a.basic){const u=new he({color:c,side:s.side??a.side??J,transparent:!1,alphaTest:s.alphaTest??a.alphaTest??0,fog:s.fog??!0,toneMapped:!0,dithering:!0});return u.name=`vs.${e}`,u.userData.vsArchetype=e,u.userData.vsAccent=!!a.accent,u.customProgramCacheKey=()=>`vs:basic:${u.alphaTest>0?"a":"-"}`,u}const r=new ue({color:c,side:s.side??a.side??J,flatShading:s.flatShading??a.flatShading??!1,alphaTest:s.alphaTest??a.alphaTest??0,transparent:!1,fog:s.fog??!0,dithering:!0});r.name=`vs.${e}`,a.emissive&&(r.emissive=a.emissive(),r.emissiveIntensity=s.emissiveIntensity??1);const n={VS_KEYSHADOW:""},o=s.tint??a.tint??0,l=s.rim??a.rim??0;o>0&&(n.VS_TINT=""),l>0&&o>0&&(n.VS_RIM=""),a.water&&(n.VS_WATER=""),r.defines=n;const f=b("water.body"),w=b("water.core"),h={uVsTune:{value:j(o,l,He,0)},uVsWater:{value:(a.water??j(0,0,0,0)).clone()},uVsWaterBody:{value:f.clone().multiplyScalar(.86)},uVsWaterMid:{value:f.clone().lerp(w,.3).multiplyScalar(.9)},uVsWaterHot:{value:w.clone().multiplyScalar(.95)}};r.userData.vsUniforms=h,r.userData.vsArchetype=e,r.userData.vsAccent=!!a.accent,r.onBeforeCompile=u=>{Object.assign(u.uniforms,Me,h),u.vertexShader=u.vertexShader.replace("#include <common>",`#include <common>
varying vec3 vVsWorld;`).replace("#include <project_vertex>",`#include <project_vertex>
`+_e),u.fragmentShader=u.fragmentShader.replace("#include <common>",`#include <common>
`+Te).replace("void main() {",Re+`
void main() {`).replace("#include <emissivemap_fragment>",`#include <emissivemap_fragment>
`+ke).replace("#include <opaque_fragment>",Ee+`
#include <opaque_fragment>`)};const p=`vs:lambert:${Object.keys(n).sort().join(",")}:${r.flatShading?"f":"-"}:${r.alphaTest>0?"a":"-"}`;return r.customProgramCacheKey=()=>p,r}rock(e){return this.get("rock",e)}ground(e){return this.get("ground",e)}stone(e){return this.get("stone",e)}metal(e){return this.get("metal",e)}grey(e){return this.get("grey",e)}greyDeep(e){return this.get("greyDeep",e)}foliage(e){return this.get("foliage",e)}crystal(e){return this.get("crystal",e)}crystalCore(e){return this.get("crystalCore",e)}water(e){return this.get("water",e)}vein(e){return this.get("vein",e)}heroPlate(e){return this.get("heroPlate",e)}heroSkin(e){return this.get("heroSkin",e)}heroHair(e){return this.get("heroHair",e)}heroDark(e){return this.get("heroDark",e)}cloudSlab(e){return this.get("cloudSlab",e)}glyph(e){return this.get("glyph",e)}stats(){const e=new Set;for(const a of this.cache.values())e.add(a.customProgramCacheKey());return{instances:this.cache.size,built:this.built,cacheHits:this.hits,programVariants:e.size,archetypes:Object.keys(oe).length,textures:0,standardMaterials:0,envMaps:0,missingRoles:[...X],keyHex:"#FFE3B8",albedos:Z,keys:[...this.cache.keys()].sort()}}dispose(){for(const e of this.cache.values())e.dispose();this.cache.clear()}}function L(t){const e=t.index?t.toNonIndexed():t;return e.deleteAttribute("normal"),e.computeVertexNormals(),e.userData.vsFlat=!0,e}function Ae(t){let e=0,a=0,s=0,c=[];return t.traverse(r=>{if(!r.isMesh||!r.geometry?.attributes?.position)return;const n=r.geometry,o=n.attributes.normal;if(s++,!o)return;if(r.material?.flatShading){const h=(n.index?n.index.count:o.count)/3;e+=h,a+=h;return}const l=n.index,f=(l?l.count:o.count)/3;let w=0;for(let h=0;h<f;h++){const p=l?l.getX(h*3):h*3,u=l?l.getX(h*3+1):h*3+1,V=l?l.getX(h*3+2):h*3+2;N(o.getX(p),o.getX(u))&&N(o.getY(p),o.getY(u))&&N(o.getZ(p),o.getZ(u))&&N(o.getX(p),o.getX(V))&&N(o.getY(p),o.getY(V))&&N(o.getZ(p),o.getZ(V))&&w++}e+=f,a+=w,w<f&&c.push(r.name||r.type)}),{meshes:s,triangles:e,flatTriangles:a,flatFraction:e?Number((a/e).toFixed(4)):1,smoothMeshes:c.slice(0,12)}}const N=(t,e)=>Math.abs(t-e)<1e-4;function Oe(t){const e=new P;e.name="vs.materialBoard";const a={},s=fe.degToRad(118),c=Math.sin(s),r=Math.cos(s),n=(i,d)=>{const g=i*c+d*r,D=i*r-d*c;return Math.sin(g*.62)*.42+Math.sin(D*.31+1.1)*.3+Math.sin(g*.19-.4)*.5-Math.abs(d)*.015},o=(i,d,g,D,M,A)=>{const m=new H(L(i),d);return m.position.set(g,n(g,M)+D,M),m.castShadow=!0,m.receiveShadow=!0,m.name=A,e.add(m),m},l=new Q(34,22,11,7),f=l.attributes.position;for(let i=0;i<f.count;i++)f.setZ(i,n(f.getX(i),-f.getY(i)));const w=new H(L(l),t.ground());w.rotation.x=-Math.PI/2,w.position.set(0,0,0),w.receiveShadow=!0,w.name="vs.board.shelf",e.add(w);const h=new H(L(new y(34.4,2.4,22.4)),t.ground());h.position.set(0,-1.2,0),h.receiveShadow=!0,h.name="vs.board.shelfBody",e.add(h);const p=new H(L(new U(15,9,7,1)),t.rock());p.position.set(0,-6.9,0),p.rotation.x=Math.PI,p.name="vs.board.underside",e.add(p);const u=o(new me(3.4,0),t.rock(),-9,4.4,3,"vs.board.spire");u.rotation.set(.18,.42,.1),u.scale.set(1,1.85,.82),o(new z(1.9,0),t.rock(),-7,.9,6.4,"vs.board.boulderA"),o(new z(1.15,0),t.stone(),-5.4,.6,4.4,"vs.board.boulderB"),o(new z(1.35,0),t.rock(),2.4,.8,4.2,"vs.board.boulderC");const V=new P;V.name="vs.board.crystal",V.position.set(5,n(5,2.6)-.05,2.6),[[0,0,0,.9,0],[.7,0,.35,.6,.5],[-.6,0,.5,.48,-.7],[.2,0,-.7,.7,.25]].forEach(([i,,d,g,D],M)=>{const A=L(new U(.3*g,2.2*g,5,1)),m=new H(A,M===0?t.crystalCore():t.crystal());m.position.set(i,1.1*g,d),m.rotation.z=D*.22,m.castShadow=!0,m.name=`vs.board.crystal.${M}`,V.add(m)}),e.add(V),a.crystal=V.position.clone().setY(V.position.y+1.1);const O=7.6,q=new Q(26,1.3,18,2),$=q.attributes.position;for(let i=0;i<$.count;i++){const d=$.getX(i),g=$.getY(i);$.setZ(i,n(d,O-g)+.3+Math.sin(d*.9+g*2.1)*.05+Math.sin(d*2.3)*.028)}const W=new H(L(q),t.water());W.rotation.x=-Math.PI/2,W.position.set(0,0,O),W.receiveShadow=!1,W.name="vs.board.carry",e.add(W),a.water=new I(3,n(3,O)+.3,O);const ce=o(new y(6.2,.34,1.5),t.grey(),-14.2,1.7,-6,"vs.board.grey");ce.rotation.z=-.03,o(new y(.34,1.7,.34),t.stone(),-12,.85,-6,"vs.board.prop");for(let i=0;i<9;i++){const d=i/9*Math.PI*2,g=.6+Math.cos(d)*2.4,D=5.2+Math.sin(d)*1.1,M=o(new U(.26,.85+i%3*.2,3,1),t.foliage(),g,.42,D,`vs.board.blade.${i}`);M.rotation.y=d}o(new ee(.55,.55,1.5,6,1),t.metal(),8.6,.75,-1.6,"vs.board.metal");const E=new P;E.name="vs.board.hero";const F=-3.5,G=2,B=n(F,G);E.position.set(F,B,G),E.rotation.y=-.5;const S=(i,d,g,D,M,A)=>{const m=new H(L(i),d);return m.position.set(g,D,M),m.castShadow=!0,m.receiveShadow=!0,m.name=A,E.add(m),m};return S(new y(.62,.72,.38),t.heroPlate(),0,1.28,0,"hero.torso"),S(new y(.52,.26,.34),t.heroDark(),0,.88,0,"hero.belt"),S(new y(.2,.24,.22),t.heroSkin(),0,1.79,0,"hero.head"),S(new y(.24,.14,.26),t.heroHair(),0,1.9,-.02,"hero.hair"),S(new y(.16,.62,.18),t.heroPlate(),-.39,1.28,0,"hero.armL"),S(new y(.16,.62,.18),t.heroPlate(),.39,1.28,0,"hero.armR"),S(new y(.22,.8,.22),t.heroDark(),-.16,.46,0,"hero.legL"),S(new y(.22,.8,.22),t.heroDark(),.16,.46,0,"hero.legR"),S(new y(.26,.1,.34),t.heroDark(),-.16,.05,.03,"hero.footL"),S(new y(.26,.1,.34),t.heroDark(),.16,.05,.03,"hero.footR"),S(new ee(.15,.15,.36,6,1),t.metal(),.36,.92,-.16,"hero.can"),e.add(E),a.hero=new I(F,B,G),E.updateMatrixWorld(!0),a.sole=E.getObjectByName("hero.footR").getWorldPosition(new I),a.sole.y=B+.004,a.heroHead=new I(F,B+1.85,G),a.rock=new I(-9,n(-9,3)+4.4,3),a.ground=new I(.5,n(.5,-1),-1),e.userData.marks=Object.fromEntries(Object.entries(a).map(([i,d])=>[i,[d.x,d.y,d.z]])),e.userData.heightFn=n,e.userData.sunBearingDeg=118,e}function Ie(t){return Object.keys(t).sort().map(e=>`${e}=${typeof t[e]=="number"?t[e].toFixed(4):String(t[e])}`).join(",")}const k=t=>Number(t.toFixed(4)),$e=new Le;export{We as B,Se as F,Y as G,ye as K,pe as a,Oe as b,L as c,Ve as d,Ae as f,$e as m,b as r,Me as s};
