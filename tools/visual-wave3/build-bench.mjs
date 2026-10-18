// Self-contained renderer benchmark: Wave 2 modules read from git (e3529e7) vs the working tree, same GLBs,
// same camera, same dialogue state; measures animation CPU, render submission CPU, GPU timer queries,
// draw calls and triangles. No backend, no network, no production state.
import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';
const BASE='e3529e7f0348fb6332d5b1ea3117d7825afbc6f9';const imports={},seen=new Set();
function moduleFor(file,version){file=file.split('?')[0];if(file.includes('/vendor/'))version='shared';const id=`echo-${version}:${file}`;if(seen.has(id))return id;seen.add(id);
 let text=version==='before'?execFileSync('git',['show',`${BASE}:${file}`],{encoding:'utf8',maxBuffer:8e6}):fs.readFileSync(file,'utf8');
 text=text.replace(/(from\s*|import\s*)['"]([^'"]+)['"]/g,(all,lead,spec)=>{const resolved=spec==='three'?'dist/lab/vendor/three.module.js':spec.startsWith('.')?path.posix.normalize(path.posix.join(path.posix.dirname(file),spec)):spec.startsWith('/')?'dist'+spec:null;return resolved?`${lead}'${moduleFor(resolved,version)}'`:all;});
 imports[id]='data:text/javascript;base64,'+Buffer.from(text).toString('base64');return id;}
const entries={};for(const v of ['before','after'])entries[v]=Object.fromEntries(['room','materials','blocking','editorial-characters'].map(n=>[n,moduleFor(`dist/studio/${n}.js`,v)]));
entries.after.direction=moduleFor('dist/studio/direction-wave3.js','after');
const three=moduleFor('dist/lab/vendor/three.module.js','shared'),loader=moduleFor('dist/lab/vendor/GLTFLoader.js','shared'),festival=moduleFor('dist/studio/visual-upgrade/festival-set.js','after');
const assets=Object.fromEntries(['cast-clean-v6','hair-clean-v6'].map(n=>[n,fs.readFileSync(`dist/studio/lookdev/assets/${n}.glb`).toString('base64')]));assets.festival=fs.readFileSync('dist/studio/visual-upgrade/festival-set.glb').toString('base64');
const turns=JSON.parse(fs.readFileSync('dist/studio/dialogue.json'));
const script=`
const config=__CONFIG__;const THREE=await import(config.three),{GLTFLoader}=await import(config.loader),{attachFestivalSet}=await import(config.festival);
const bytes=b64=>Uint8Array.from(atob(b64),c=>c.charCodeAt(0)).buffer,loader=new GLTFLoader();
const base=await loader.parseAsync(bytes(config.assets['cast-clean-v6']),''),hair=await loader.parseAsync(bytes(config.assets['hair-clean-v6']),'');
const mods={},rooms={};
for(const v of ['before','after']){mods[v]=Object.fromEntries(await Promise.all(Object.entries(config.entries[v]).map(async([k,u])=>[k,await import(u)])));const m=mods[v];
 rooms[v]=m.room.createRoom(base.scene,{cast:m.blocking.conversationSeats,practicalPositions:m.blocking.conversationPracticals,actorFactory:(b,i)=>m['editorial-characters'].makeEditorialCharacter(b,i,{hairLibrary:hair.scene})});
 m.materials.lightEditorialRoom(rooms[v].scene,{festival:false});attachFestivalSet(rooms[v].scene,(await loader.parseAsync(bytes(config.assets.festival),'')).scene);}
const canvas=document.querySelector('canvas'),renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'low-power'});renderer.setSize(1320,600,false);renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.88;
const camera=new THREE.PerspectiveCamera(35,2.2,.05,30);const gl=renderer.getContext(),ext=gl.getExtension('EXT_disjoint_timer_query_webgl2');
const next=()=>new Promise(requestAnimationFrame),pct=(a,q)=>[...a].sort((x,y)=>x-y)[Math.floor((a.length-1)*q)];
const turn=config.turns[0];
function state(t,cinematic){return {speaker:turn.speaker,speaking:true,mouthStrength:.56,expressive:true,directed:true,cinematic,sentenceAt:0,attention:turn.attention||[],gestures:turn.gestures||[],performance:turn.performance||[],audioTime:t,cue:turn.cues.find(c=>t>=c.start&&t<c.end),handoff:null};}
function view(v,shot,age){const m=mods[v];let p=m.blocking.conversationFrame(shot,2.2);if(v==='after'){p=m.direction.cinematicFrame(shot,2.2);const mo=m.direction.cameraMotion(shot,age);camera.position.set(...m.direction.framedPosition(p,mo));}else camera.position.set(...p.slice(0,3));camera.fov=p[6];camera.lookAt(...p.slice(3,6));camera.updateProjectionMatrix();}
const out=[];
for(let trial=0;trial<2;trial++)for(const v of (trial?['after','before']:['before','after']))for(const shot of ['wide','echo']){
 const scene=rooms[v].scene,cinematic=v==='after';renderer.compile(scene,camera);
 for(let i=0;i<30;i++){view(v,shot,i/30);for(const a of rooms[v].actors)mods[v].room.applyPerformance(a,i/30,1/30,state(i/30,cinematic),false);renderer.render(scene,camera);await next();}
 const anim=[],submit=[],gpu=[],pending=[];
 for(let i=0;i<180;i++){await next();const t=i/30;const s=performance.now();view(v,shot,t);for(const a of rooms[v].actors)mods[v].room.applyPerformance(a,t,1/30,state(t,cinematic),false);anim.push(performance.now()-s);
  const q=ext?gl.createQuery():null;if(q)gl.beginQuery(ext.TIME_ELAPSED_EXT,q);const d=performance.now();renderer.render(scene,camera);submit.push(performance.now()-d);if(q){gl.endQuery(ext.TIME_ELAPSED_EXT);pending.push(q);}
  while(pending.length&&gl.getQueryParameter(pending[0],gl.QUERY_RESULT_AVAILABLE)){const qq=pending.shift();if(!gl.getParameter(ext.GPU_DISJOINT_EXT))gpu.push(gl.getQueryParameter(qq,gl.QUERY_RESULT)/1e6);gl.deleteQuery(qq);}}
 for(let k=0;pending.length&&k<12;k++){await next();while(pending.length&&gl.getQueryParameter(pending[0],gl.QUERY_RESULT_AVAILABLE)){const qq=pending.shift();if(!gl.getParameter(ext.GPU_DISJOINT_EXT))gpu.push(gl.getQueryParameter(qq,gl.QUERY_RESULT)/1e6);gl.deleteQuery(qq);}}
 out.push({version:v,trial,shot,samples:180,size:'1320x600',drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,animationMedianMs:pct(anim,.5),animationP95Ms:pct(anim,.95),submitMedianMs:pct(submit,.5),submitP95Ms:pct(submit,.95),gpuSamples:gpu.length,gpuMedianMs:gpu.length?pct(gpu,.5):null,gpuP95Ms:gpu.length?pct(gpu,.95):null});
}
window.__benchDone(JSON.stringify({baseline:config.BASE,userAgent:navigator.userAgent,gpu:(()=>{const d=gl.getExtension('WEBGL_debug_renderer_info');return d?gl.getParameter(d.UNMASKED_RENDERER_WEBGL):null;})(),timerQuery:!!ext,results:out}));`;
const html=`<!doctype html><meta charset="utf-8"><title>ECHO wave 3 bench</title><body style="margin:0;background:#0d201a"><canvas width="1320" height="600"></canvas><script type="importmap">${JSON.stringify({imports})}</script><script type="module">${script.replace('__CONFIG__',JSON.stringify({BASE,entries,three,loader,festival,assets,turns}))}</script>`;
fs.mkdirSync('data/visual-wave3',{recursive:true});fs.writeFileSync('data/visual-wave3/bench.html',html);console.log('bench page',html.length,'bytes');
