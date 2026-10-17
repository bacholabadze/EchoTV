import * as THREE from 'three';
import {GLTFLoader} from '../../lab/vendor/GLTFLoader.js';
import {lightEditorialRoom} from '../materials.js?v=6';
import {MockAdapter,captionAt} from '../core.js?v=2';
import {makeEditorialCharacter} from '../editorial-characters.js?v=6';
import {novaFrame} from './actor.js';
import {createRoom,applyPerformance} from '../room.js?v=4';
const $=s=>document.querySelector(s),canvas=$('#scene'),stage=$('#stage');
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
const audio=new Audio();audio.preload='auto';
let adapter,renderer,scene,camera,actor,frameId=0,last=0,elapsed=0,ready=false,cueIndex=0,failed=false,pmrem,environment,observer;
function text(id,value){if($(id).textContent!==value)$(id).textContent=value;}
function format(t){return '00:'+String(Math.floor(Math.min(t,59))).padStart(2,'0');}
function caption(){if(!adapter)return;text('#caption',captionAt(adapter.turn,audio.currentTime));const t=adapter.state==='ended'?adapter.duration:adapter.time;text('#time',format(t)+' / '+format(adapter.duration));$('#progress').style.width=Math.min(100,t/adapter.duration*100)+'%';}
function ui(){if(!adapter)return;last=0;const state=adapter.state;$('#play').disabled=!ready||state==='loading';$('#replay').disabled=!ready;text('#play',state==='playing'?'Pause':state==='loading'?'Loading':state==='ended'?'Play again':state==='paused'?'Resume':'Play 15 seconds');if(state!=='error')text('#message',state==='playing'?'Recorded speech · real-time character':state==='paused'?'Paused':state==='ended'?'Study complete. Replay or compare with Studio V2.':'A scripted visual study. Audio starts when you press Play.');caption();requestFrame();}
function fallback(message){failed=true;$('#loading').hidden=true;$('#fallback').hidden=false;$('#fallback p').textContent=message;canvas.hidden=true;cancelAnimationFrame(frameId);frameId=0;}

function resize(){if(!renderer||failed)return;const aspect=stage.clientWidth/stage.clientHeight;renderer.setSize(stage.clientWidth,stage.clientHeight,false);camera.aspect=aspect;const frame=novaFrame(aspect);camera.position.set(...frame.slice(0,3));camera.fov=frame[6];camera.lookAt(...frame.slice(3,6));camera.updateProjectionMatrix();requestFrame();}
function requestFrame(){if(!frameId&&renderer&&scene&&!document.hidden&&!failed)frameId=requestAnimationFrame(render);}
// Authored low-amplitude performance beats, timed to the existing recording.
// [seconds, headPitch, headYaw, forearmTwist]; no motion capture or live emotion inference.
const beats=[[0,0,.06,0],[.35,-.012,.04,0],[1.4,0,.02,0],[3.0,.012,-.04,0],[5.2,0,-.02,0],[6.0,0,.03,0],[8.2,-.009,.05,.025],[10.5,0,0,.04],[12.8,.013,-.02,.01],[14.7,0,.035,0],[15.1,0,0,0]];
const euler=new THREE.Euler(),quaternion=new THREE.Quaternion();
function performanceBeat(time,dt){if(reduce)return;let i=0;while(i<beats.length-2&&beats[i+1][0]<time)i++;const a=beats[i],b=beats[i+1];let u=THREE.MathUtils.clamp((time-a[0])/(b[0]-a[0]),0,1);u=u*u*(3-2*u);const p=a.slice(1).map((v,j)=>THREE.MathUtils.lerp(v,b[j+1],u));for(const [name,x,y]of [['Head',p[0],p[1]],['RightForeArm',0,p[2]]]){const bone=actor.bones[name];euler.set(x,y,0);quaternion.setFromEuler(euler).premultiply(bone.rest);bone.bone.quaternion.slerp(quaternion,1-Math.exp(-10*dt));}}
function render(ms){frameId=0;if(document.hidden||failed)return;const playing=adapter?.state==='playing';if(playing&&last&&ms-last<32){requestFrame();return;}const dt=Math.min(last?(ms-last)/1000:1/30,.07);last=ms;if(playing)elapsed+=dt;const cues=adapter?.turn?.cues||[];if(cueIndex>=cues.length||audio.currentTime<(cues[cueIndex]?.start||0))cueIndex=0;while(cueIndex<cues.length&&audio.currentTime>=cues[cueIndex].end)cueIndex++;const cue=cues[cueIndex];applyPerformance(actor,elapsed,dt,{speaker:'nova',mouthStrength:.56,expressive:true,performance:adapter?.turn?.performance||[],speaking:playing&&!adapter.gap,audioTime:audio.currentTime,cue:cue&&audio.currentTime>=cue.start?cue:null,reaction:null,reactionAge:0},reduce);if(playing)performanceBeat(adapter.time,dt);renderer.render(scene,camera);if(playing){caption();requestFrame();}}
async function init(){
 try{const response=await fetch('dialogue.json');if(!response.ok)throw Error('The recorded study could not load. Please reload.');adapter=new MockAdapter(await response.json(),audio);adapter.addEventListener('state',ui);adapter.addEventListener('timing',caption);adapter.addEventListener('turn-start',()=>{cueIndex=0;caption();});adapter.addEventListener('reset',()=>{elapsed=0;cueIndex=0;});adapter.addEventListener('failure',e=>text('#message',e.detail.message));}catch(error){fallback(error.message);text('#play','Unavailable');return;}
 try{
  renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'low-power'});renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.88;
  camera=new THREE.PerspectiveCamera(32,1,.05,25);
  const [gltf,hair]=await Promise.all([new GLTFLoader().loadAsync('assets/cast-clean-v6.glb',e=>{if(e.total)text('#load-detail','Character · '+Math.round(e.loaded/e.total*100)+'%');}),new GLTFLoader().loadAsync('assets/hair-clean-v6.glb')]);
  const room=createRoom(gltf.scene,{actorFactory:(base,index)=>makeEditorialCharacter(base,index,{hairLibrary:hair.scene}),cast:[{id:'nova',variant:0,x:0,z:-.20,yaw:.12}]});scene=room.scene;actor=room.actors[0];
  {scene.addEventListener('visualchange',requestFrame);lightEditorialRoom(scene);}
  $('#loading').hidden=true;resize();observer=new ResizeObserver(resize);observer.observe(stage);
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();adapter.pause();fallback('3D was interrupted. The recorded clip is still available; reload to restore the scene.');});
 }catch(error){console.warn('Nova study:',error.message);fallback('3D is unavailable. You can still play the recorded clip and read the captions.');}
 ready=true;ui();
}
$('#play').onclick=()=>adapter?.state==='playing'?adapter.pause():adapter?.play();$('#replay').onclick=()=>adapter?.replay();$('#mute').onclick=()=>{adapter?.mute(!audio.muted);text('#mute',audio.muted?'Unmute':'Mute');$('#mute').setAttribute('aria-pressed',String(audio.muted));};$('#reload').onclick=()=>location.reload();
document.addEventListener('visibilitychange',()=>{if(document.hidden){if(['playing','loading'].includes(adapter?.state))adapter.pause();cancelAnimationFrame(frameId);frameId=0;}else requestFrame();});
window.addEventListener('pagehide',event=>{if(event.persisted)adapter?.pause();else{adapter?.dispose();observer?.disconnect();renderer?.dispose();environment?.dispose();}cancelAnimationFrame(frameId);frameId=0;});window.addEventListener('pageshow',requestFrame);
window.EchoNovaStudy={getState:()=>({ready,rendererAvailable:!!scene&&!failed,playback:adapter?.state,time:adapter?.time,drawCalls:renderer?.info.render.calls,triangles:renderer?.info.render.triangles}),interrupt:()=>adapter?.interrupt()};
init();
