// Wave 3 checks: director rhythm, framing safety at camera-motion extremes, and the cinematic body layer
// against the same tabletop/wrist envelope the Wave 2 sequence test enforces. Pure sampling, no browser.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {room,THREE} from '../performance-wave2/rig.mjs';
import {applyPerformance} from '../../dist/studio/room.js';
import {conversationFrame} from '../../dist/studio/blocking.js';
import {CinematicDirector,cameraMotion,framedPosition,motionLimits,currentAttention,twoShots,cinematicFrame} from '../../dist/studio/direction-wave3.js';
import {crossedPerformance,handoffTarget} from '../../dist/studio/performance-direction.js';
import {openingCamera,openingLight,openingTitle,OPENING_DURATION} from '../../dist/studio/opening.js';
const turns=JSON.parse(fs.readFileSync(new URL('../../dist/studio/dialogue.json',import.meta.url)));
// 1. Director: run the whole dialogue, collect cuts, assert rhythm rules.
const director=new CinematicDirector(),cuts=[];let clock=0;
const fire=(e,t)=>{const before=director.shot;director.event(e,t);if(director.shot!==before)cuts.push({t,shot:director.shot,event:e.type,turn:e.utterance?.id||e.turnId});};
let twoCuts=0,twoAtlas=0;
for(const turn of turns){
 fire({type:'turn-start',speaker:turn.speaker,utterance:turn},clock);let prev=-1,caption=-1;
 for(let t=0;t<turn.duration;t+=1/30){
  const index=turn.captions.findIndex(c=>t>=c.start&&t<c.end);
  if(index!==caption&&index>=0){caption=index;fire({type:'sentence',speaker:turn.speaker,audioTime:t,remaining:turn.duration-t,turnId:turn.id,reaction:Math.abs(turn.captions[index].start-turn.reactionAt)<.1?turn.reaction:null},clock+t);}
  for(const cue of crossedPerformance(turn,prev,t))fire({type:'performance',speaker:turn.speaker,cue,audioTime:t,remaining:turn.duration-t,turnId:turn.id},clock+t);prev=t;
 }
 const target=handoffTarget(turn);fire({type:'turn-end',speaker:turn.speaker,utterance:turn,target},clock+turn.duration);
 clock+=turn.duration+(turn.pause??.55);
}
for(let i=1;i<cuts.length;i++){const gap=cuts[i].t-cuts[i-1].t;assert(gap>=2.2-1e-6,`cut spacing ${gap.toFixed(2)} s below the reaction hold`);}
for(const c of cuts){if(c.shot==='two')twoCuts++;if(c.shot==='two-atlas')twoAtlas++;}
assert(twoAtlas>0,'the new ECHO/Atlas two-shot must be used at least once in the dialogue: '+JSON.stringify(cuts));
assert(cuts.length<=turns.length*3,'no more than three cuts per turn on average');
// End guard: a sentence event inside the last 1.5 s never cuts.
const guard=new CinematicDirector();guard.event({type:'turn-start',speaker:'nova',utterance:turns[1]},0);guard.lastCut=-10;const held=guard.shot;
guard.event({type:'sentence',speaker:'nova',audioTime:turns[1].duration-.9,remaining:.9},turns[1].duration-.9);assert.equal(guard.shot,held,'no cut inside the end guard');
// Fixed camera mode never changes the shot.
const fixed=new CinematicDirector();fixed.mode='fixed';fixed.select('atlas',0);for(const turn of turns)fixed.event({type:'turn-start',speaker:turn.speaker,utterance:turn},100);assert.equal(fixed.shot,'atlas');
assert.equal(currentAttention(turns[0],5),'atlas');assert.equal(twoShots.atlas.echo,'two-atlas');
// 2. Framing safety: every shot, both aspects, at motion extremes, faces stay inside the frame with margin.
const {actors}=await room();
const extremes=[{push:0,drift:0,rise:0},{push:motionLimits.push,drift:motionLimits.drift,rise:motionLimits.rise},{push:motionLimits.push,drift:-motionLimits.drift,rise:motionLimits.rise},cameraMotion('wide',60),cameraMotion('echo',60),cameraMotion('two-atlas',60)];
let combos=0;
for(const shot of ['wide','echo','nova','atlas','two','two-atlas'])for(const aspect of [2.24,2.15,16/9,1.6,.82])for(const m of extremes){
 const p=cinematicFrame(shot,aspect),cam=new THREE.PerspectiveCamera(p[6],aspect,.05,30);cam.position.set(...framedPosition(p,m));cam.lookAt(...p.slice(3,6));cam.updateMatrixWorld(true);
 const visible=shot==='wide'?actors:shot==='two'?actors.filter(a=>a.id!=='atlas'):shot==='two-atlas'?actors.filter(a=>a.id!=='nova'):actors.filter(a=>a.id===shot);
 for(const a of visible){for(const [x,y] of [[-.1,1.1],[.1,1.1],[0,1.4],[-.11,1.3],[.11,1.3]]){const pt=new THREE.Vector3(x,y,.13).applyMatrix4(a.pivot.matrixWorld).project(cam);assert(Math.abs(pt.x)<.95&&Math.abs(pt.y)<.9&&pt.z<1,`face point outside ${shot} ${aspect.toFixed(2)} ${a.id} ${JSON.stringify(m)}`);}
  // Hair top (model y ≈ 1.70 after seating offset) must not be cropped in single and two-person shots.
  if(shot!=='wide'){const top=new THREE.Vector3(0,1.30,.05).applyMatrix4(a.pivot.matrixWorld).project(cam);assert(top.y<.985,`hair top cropped ${shot} ${aspect.toFixed(2)} ${a.id} y=${top.y.toFixed(3)} ${JSON.stringify(m)}`);}}
 combos++;
}
for(const m of [cameraMotion('echo',0),cameraMotion('wide',1e9),cameraMotion('two',30,true)]){assert(Math.abs(m.push)<=motionLimits.push+1e-9&&Math.abs(m.drift)<=motionLimits.drift+1e-9&&Math.abs(m.rise)<=motionLimits.rise+1e-9);}
assert.deepEqual(cameraMotion('echo',30,true),{push:0,drift:0,rise:0},'reduced motion disables camera motion');
// 3. Opening: camera lands exactly on the wide frame, lights restore to 1.0, title fades in and out.
const wide=conversationFrame('wide',16/9),end=openingCamera(wide,1);
assert(end.position.every((v,i)=>Math.abs(v-wide[i])<1e-9)&&end.target.every((v,i)=>Math.abs(v-wide[3+i])<1e-9)&&Math.abs(end.fov-wide[6])<1e-9,'opening ends on the wide frame');
assert(openingLight(0)<.2&&Math.abs(openingLight(OPENING_DURATION)-1)<1e-9&&openingTitle(0)===0&&openingTitle(3)===1&&openingTitle(OPENING_DURATION)===0);
// 4. Cinematic body layer: same envelope as Wave 2 (wrists in the supported volume, feet fixed, no table dips beyond Wave 2's floor).
const feet=actors.map(a=>['LeftFoot','RightFoot','LeftToeBase','RightToeBase'].map(n=>a.bones[n].bone.getWorldPosition(new THREE.Vector3())));
let minWrist=Infinity,maxWrist=-Infinity,frames=0;clock=0;
for(const turn of turns){let caption=-1,sentenceAt=NaN;
 for(let t=0;t<turn.duration;t+=1/15){
  const index=turn.captions.findIndex(c=>t>=c.start&&t<c.end);if(index!==caption&&index>=0){caption=index;sentenceAt=turn.captions[index].start;}
  const cue=turn.cues.find(c=>t>=c.start&&t<c.end),state={speaker:turn.speaker,speaking:true,expressive:true,directed:true,cinematic:true,sentenceAt,audioTime:t,performance:turn.performance,gestures:turn.gestures,attention:turn.attention,cue,mouthStrength:.56};
  const snapshot=JSON.stringify(state);
  for(const [i,a] of actors.entries()){applyPerformance(a,clock+t,1/15,state,false);assert.equal(JSON.stringify(state),snapshot);a.model.updateMatrixWorld(true);
   for(const side of ['Left','Right']){const y=a.bones[side+'Hand'].bone.getWorldPosition(new THREE.Vector3()).y;minWrist=Math.min(minWrist,y);maxWrist=Math.max(maxWrist,y);assert(y>.83&&y<.915,`wrist ${y.toFixed(3)} outside supported volume (${a.id} ${side}, turn ${turn.id} t=${t.toFixed(2)})`);}
   for(const [j,n] of ['LeftFoot','RightFoot','LeftToeBase','RightToeBase'].entries())assert(a.bones[n].bone.getWorldPosition(new THREE.Vector3()).distanceTo(feet[i][j])<1e-9,'feet fixed');
  }
  frames++;
 }
 clock+=turn.duration+(turn.pause??.55);
}
console.log(`PASS wave3: ${cuts.length} cuts over ${turns.length} turns (two-shots ${twoCuts} ECHO/Nova, ${twoAtlas} ECHO/Atlas), min spacing ok, end guard, fixed mode; ${combos} shot/aspect/motion framing combos; opening lands on wide frame; cinematic body ${frames} frames, wrist y ${minWrist.toFixed(3)}–${maxWrist.toFixed(3)} m, feet fixed.`);
