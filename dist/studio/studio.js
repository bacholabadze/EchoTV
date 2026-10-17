import {conversationSeats,conversationFrame,conversationPracticals} from './blocking.js?v=5';
import * as THREE from 'three';
import {GLTFLoader} from '../lab/vendor/GLTFLoader.js';
import {lightEditorialRoom} from './materials.js?v=6';
import {makeEditorialCharacter} from './editorial-characters.js?v=6';
import {Director,MockAdapter,captionAt} from './core.js?v=2';
import {createRoom,cameraFrame,applyPerformance} from './room.js?v=5';
const $=s=>document.querySelector(s),stage=$('#stage'),canvas=$('#scene');
const legacy=new URLSearchParams(location.search).get('edition')==='2';
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
const names={echo:'ECHO',nova:'Nova',atlas:'Atlas'};
const shotNames={wide:'Establishing',echo:'Moderator',nova:'Nova',atlas:'Atlas',two:'Two-person',};
const director=new Director();
let renderer,scene,camera,actors=[],adapter,raf=0,last=0,visualTime=0,ready=false,sentence=-1,reaction=null,reactionAt=0,frameSamples=[],quality=1,frames=0,cueCursor=0,renderedShot=null,environment=null,resizeObserver=null;
const audio=new Audio();audio.preload='auto';
function fallback(message){$('#loading').hidden=true;$('#fallback').hidden=false;$('#fallback-text').textContent=message;canvas.hidden=true;renderer?.setAnimationLoop(null);cancelAnimationFrame(raf);raf=0;}
function report(message){$('#error').textContent=message;$('#error').hidden=false;}
function setText(selector,text){const element=$(selector);if(element.textContent!==text)element.textContent=text;}
function updateLabels(){
  const who=adapter?.turn?.speaker||'echo',shot=director.shot;
  setText('#caption-speaker',`${names[who]} / ${who==='echo'?'MODERATOR':'GUEST'}`);
  setText('#speaker-name',shot==='wide'?'ECHO · Nova · Atlas':shot==='two'?'ECHO / Nova':names[shot]);
  setText('#speaker-role',shot==='wide'?'AT THE TABLE':shot==='two'?'IN CONVERSATION':shot!==who?'LISTENING':shot==='echo'?'MODERATOR':'GUEST');
}
function selectShot(shot){
  director.shot=shot;renderedShot=shot;stage.dataset.shot=shot;setText('#shot',shotNames[shot]||'Listening reaction');updateLabels();
  if(camera){const p=(legacy?cameraFrame:conversationFrame)(shot,stage.clientWidth/stage.clientHeight);camera.position.set(...p.slice(0,3));camera.fov=p[6];camera.lookAt(...p.slice(3,6));camera.updateProjectionMatrix();}requestFrame();
}
function resize(){if(!renderer)return;const w=stage.clientWidth,h=stage.clientHeight;renderer.setPixelRatio(Math.min(devicePixelRatio||1,quality));renderer.setSize(w,h,false);camera.aspect=w/h;selectShot(director.shot);}
function requestFrame(){if(!raf&&!document.hidden&&renderer&&canvas.hidden===false)raf=requestAnimationFrame(frame);}
function frame(ms){raf=0;if(document.hidden||!renderer||canvas.hidden)return;
  const playing=adapter?.state==='playing';
  if(playing&&last&&ms-last<32){requestFrame();return;}
  const delta=last?(ms-last)/1000:1/30;last=ms;const dt=Math.min(delta,.08);
  if(playing)visualTime+=dt;
  if(playing&&!adapter.gap){
    const turn=adapter.turn,segments=turn.captions||[];const index=segments.findIndex(c=>audio.currentTime>=c.start&&audio.currentTime<c.end);
    if(index!==-1&&index!==sentence){sentence=index;const event={type:'sentence',speaker:turn.speaker,reaction:turn.reaction&&Math.abs(segments[index].start-(turn.reactionAt??-1))<.1?turn.reaction:null};
      if(event.reaction){reaction=event.reaction;reactionAt=visualTime;}const next=director.event(event,adapter.time);if(next!==renderedShot)selectShot(next);}
    updateCaption();
  }
  const cues=adapter?.turn?.cues||[];
  if(cueCursor>=cues.length||audio.currentTime<(cues[cueCursor]?.start||0))cueCursor=0;
  while(cueCursor<cues.length&&audio.currentTime>=cues[cueCursor].end)cueCursor++;
  const cue=cues[cueCursor],performanceState={speaker:adapter?.turn?.speaker,speaking:playing&&!adapter.gap,mouthStrength:legacy?.78:.56,expressive:!legacy,directed:!legacy,attention:adapter?.turn?.attention||[],gestures:adapter?.turn?.gestures||[],performance:adapter?.turn?.performance||[],audioTime:audio.currentTime,cue:cue&&audio.currentTime>=cue.start?cue:null,reaction,reactionAge:visualTime-reactionAt};
  for(const actor of actors)applyPerformance(actor,visualTime,dt,performanceState,reduced);
  renderer.render(scene,camera);frames++;
  if(playing){frameSamples.push(delta);if(frameSamples.length===90){const avg=frameSamples.reduce((a,b)=>a+b,0)/90;if(avg>.05&&quality>1){quality=1;resize();}frameSamples=[];}requestFrame();}
}
function format(t){return `${String(Math.floor(t/60)).padStart(2,'0')}:${String(Math.floor(t%60)).padStart(2,'0')}`;}
function updateCaption(){if(!adapter)return;const turn=adapter.turn;if(adapter.state==='ended'){$('#caption').textContent='The best answer can survive another question.';$('#progress-fill').style.width='100%';$('#timer').textContent=`${format(adapter.duration)} / ${format(adapter.duration)}`;return;}
  setText('#caption',captionAt(turn,audio.currentTime));
  setText('#timer',`${format(Math.min(adapter.time,adapter.duration))} / ${format(adapter.duration)}`);
  const percentage=Math.min(100,adapter.time/adapter.duration*100).toFixed(1);if($('#progress-fill').dataset.progress!==percentage){$('#progress-fill').style.width=percentage+'%';$('#progress-fill').dataset.progress=percentage;}

}
function ui(){if(!adapter)return;const state=adapter.state;$('#play').disabled=!ready||state==='loading';$('#replay').disabled=!ready;$('#interrupt').disabled=!ready||!['playing','paused'].includes(state);$('#play').textContent=state==='playing'?'Pause':state==='loading'?'Loading':state==='ended'?'Play again':state==='paused'?'Resume':'Play episode';$('#status').textContent=({ready:'Ready',playing:'Recorded demo',paused:'Paused',ended:'Episode complete',error:'Playback unavailable',loading:'Loading audio'})[state];updateCaption();requestFrame();}
function enrichCaptions(turn){
  if(turn.captions?.length)return turn;
  // Audio-aligned sentence ranges supplied by the adapter are preferred; proportional fallback is explicitly approximate.
  const chunks=turn.text.match(/[^.!?]+[.!?]+|[^.!?]+$/g)||[turn.text];let at=0;return {...turn,captions:chunks.map(text=>{const start=at;at+=turn.duration*text.length/turn.text.length;return {start,end:at,text:text.trim()};})};
}
async function init(){
  try{const response=await fetch('dialogue.json?v=5');if(!response.ok)throw Error('Dialogue could not load. Reload the studio to retry.');const turns=(await response.json()).map(enrichCaptions);adapter=new MockAdapter(turns,audio);
    for(const turn of turns){const p=document.createElement('p'),b=document.createElement('b');b.textContent=names[turn.speaker];p.append(b,document.createTextNode(turn.text));$('#transcript').append(p);}
    adapter.addEventListener('turn-start',event=>{sentence=-1;cueCursor=0;reaction=null;$('#error').hidden=true;selectShot(director.event(event.detail,adapter.time));updateCaption();});
    adapter.addEventListener('state',()=>{last=0;frameSamples=[];ui();});adapter.addEventListener('timing',updateCaption);adapter.addEventListener('failure',e=>report(e.detail.message));adapter.addEventListener('interruption',()=>{report('Turn interrupted. Press Resume to restart this turn.');requestFrame();});
    adapter.addEventListener('reset',()=>{cueCursor=0;visualTime=0;const mode=director.mode;director.reset();director.mode=mode;selectShot(mode==='auto'?'wide':$('#camera').value);});
    $('#timer').textContent=`00:00 / ${format(adapter.duration)}`;
  }catch(error){fallback(error.message);report(error.message);$('#play').textContent='Unavailable';return;}
  try{
    renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'low-power',alpha:false});renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=legacy?.94:.88;quality=innerWidth<650?1.25:1.5;
    camera=new THREE.PerspectiveCamera(37,1,.05,30);
    const [gltf,hair]=await Promise.all([
      new GLTFLoader().loadAsync(legacy?'/lab/assets/nova.glb':'lookdev/assets/cast-clean-v6.glb',event=>{if(event.total)$('#loading small').textContent=`Shared character model · ${Math.round(event.loaded/event.total*100)}%`;}),
      legacy?Promise.resolve(null):new GLTFLoader().loadAsync('lookdev/assets/hair-clean-v6.glb')
    ]);
    const room=createRoom(gltf.scene,legacy?{}:{cast:conversationSeats,practicalPositions:conversationPracticals,actorFactory:(base,index)=>makeEditorialCharacter(base,index,{hairLibrary:hair.scene})});scene=room.scene;actors=room.actors;
    if(!legacy){scene.addEventListener('visualchange',requestFrame);lightEditorialRoom(scene);}
    $('#loading').hidden=true;resize();resizeObserver=new ResizeObserver(resize);resizeObserver.observe(stage);
    canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();adapter.pause();fallback('The 3D connection was lost. Audio and transcript remain available. Reload to restore the room.');});
  }catch(error){fallback('The 3D room could not load. You can still play the recorded conversation and read its transcript.');console.warn('Studio renderer unavailable:',error.message);}
  ready=true;ui();
}
$('#play').onclick=()=>{if(adapter?.state==='playing')adapter.pause();else adapter?.play();};
$('#replay').onclick=()=>adapter?.replay();$('#interrupt').onclick=()=>adapter?.interrupt();$('#retry').onclick=()=>location.reload();
$('#mute').onclick=()=>{const value=!audio.muted;if(adapter)adapter.mute(value);else audio.muted=value;$('#mute').textContent=value?'Unmute':'Mute';$('#mute').setAttribute('aria-pressed',String(value));};
$('#director').onchange=()=>{director.mode=$('#director').value;$('#camera').hidden=director.mode==='auto';if(director.mode==='fixed'){director.select($('#camera').value,adapter?.time||0);selectShot($('#camera').value);}else{director.pending=adapter?.turn?.shot||adapter?.turn?.speaker;director.lastCut=adapter?.time||0;}};
$('#camera').onchange=()=>{director.select($('#camera').value,adapter?.time||0);selectShot($('#camera').value);};
document.addEventListener('visibilitychange',()=>{if(document.hidden){if(adapter?.state==='playing'||adapter?.state==='loading')adapter.pause();cancelAnimationFrame(raf);raf=0;}else{last=0;requestFrame();}});
window.addEventListener('pagehide',event=>{cancelAnimationFrame(raf);raf=0;if(event.persisted){adapter?.pause();}else{adapter?.dispose();resizeObserver?.disconnect();environment?.dispose();renderer?.dispose();}});
window.addEventListener('pageshow',()=>{last=0;requestFrame();});
// A live provider can replace MockAdapter while retaining these semantic events and timing fields.
window.EchoStudio={interrupt:()=>adapter?.interrupt(),cancel:()=>adapter?.cancel(),getState:()=>({edition:legacy?2:6,state:adapter?.state,turn:adapter?.index,shot:director.shot,mode:director.mode,rendererAvailable:!!scene,renderedFrames:frames,drawCalls:renderer?.info.render.calls,triangles:renderer?.info.render.triangles,pixelRatio:renderer?.getPixelRatio()})};
if(legacy){$('.eyebrow').textContent='THE TABLE / STUDIO EDITION 02';$('.edition-link').textContent='Open updated Studio ↗';$('.edition-link').href='/studio/';}
init();
