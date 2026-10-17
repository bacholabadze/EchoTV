import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {room,THREE} from './rig.mjs';
import {applyPerformance} from '../../dist/studio/room.js';
import {bodyPerformance,gestureEnvelope} from '../../dist/studio/body-performance.js';
import {PerformanceDirector,crossedPerformance,handoffTarget} from '../../dist/studio/performance-direction.js';
import {captionAt} from '../../dist/studio/core.js';
const base='9ca8eceb28ba32c6f10207c469f62757d78d0f4b';
const uri=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const read=p=>execFileSync('git',['show',`${base}:${p}`],{encoding:'utf8'});
const face=uri(read('dist/studio/performance.js'));
const priorSource=read('dist/studio/room.js').replace(/from '([^']+)'/g,(whole,p)=>p.startsWith('.')?`from '${p.startsWith('./performance.js')?face:new URL('../../dist/studio/'+p,import.meta.url).href}'`:whole);
const before=await import(uri(priorSource));
const old=await room(before.createRoom),now=await room();
const turns=JSON.parse(fs.readFileSync(new URL('../../dist/studio/dialogue.json',import.meta.url)));
const vec=new THREE.Vector3(),world=name=>a=>a.bones[name].bone.getWorldPosition(new THREE.Vector3());
const feet=now.actors.map(a=>['LeftFoot','RightFoot','LeftToeBase','RightToeBase'].map(n=>world(n)(a)));
const samples=now.actors.map(a=>{const mesh=a.model.getObjectByName('Human'),weights=mesh.geometry.attributes.skinWeight,indices=mesh.geometry.attributes.skinIndex;return Array.from({length:indices.count},(_,i)=>i).filter(i=>i%3===0&&[0,1,2,3].some(k=>weights.getComponent(i,k)>.3&&/Hand|ForeArm|Arm$/.test(mesh.skeleton.bones[indices.getComponent(i,k)].name)));});
const hitBones={};
let frames=0,vertices=0,maxLift=0,maxWristStep=0,minHandY=Infinity,penetrations=0,baselinePenetrations=0,clock=0,lastPositions=new Map();
const director=new PerformanceDirector(),cuts=[];let lastShot='wide';
const cut=(event,time)=>{const previous=director.shot;director.event(event,time);if(previous!==director.shot){cuts.push({time,shot:director.shot,event:event.type});lastShot=director.shot;}};
for(const turn of turns){
 cut({type:'turn-start',speaker:turn.speaker,utterance:turn},clock);let prev=-1,caption=-1;
 for(let t=0;t<turn.duration;t+=1/30){
  const index=turn.captions.findIndex(c=>t>=c.start&&t<c.end);if(index!==caption&&index>=0){caption=index;cut({type:'sentence',speaker:turn.speaker,reaction:Math.abs(turn.captions[index].start-turn.reactionAt)<.1?turn.reaction:null},clock+t);}
  for(const cue of crossedPerformance(turn,prev,t))cut({type:'performance',speaker:turn.speaker,cue,audioTime:t,remaining:turn.duration-t},clock+t);prev=t;
  const cue=turn.cues.find(c=>t>=c.start&&t<c.end),state={speaker:turn.speaker,speaking:true,expressive:true,directed:true,audioTime:t,performance:turn.performance,gestures:turn.gestures,attention:turn.attention,cue,mouthStrength:.56};
  const snapshot=JSON.stringify(state);
  for(let i=0;i<3;i++){
   const a=now.actors[i],b=old.actors[i];applyPerformance(a,clock+t,1/30,state,false);before.applyPerformance(b,clock+t,1/30,state,false);
   assert.equal(JSON.stringify(state),snapshot,'Renderer must not mutate audio/caption/event state');
   a.model.updateMatrixWorld(true);b.model.updateMatrixWorld(true);
   for(const side of ['Left','Right']){
    const p=world(side+'Hand')(a),q=world(side+'Hand')(b);maxLift=Math.max(maxLift,p.y-q.y);assert(p.y>.83&&p.y<.915,'Wrist stays in supported gesture volume');
    const key=a.id+side,last=lastPositions.get(key);if(last)maxWristStep=Math.max(maxWristStep,p.distanceTo(last));lastPositions.set(key,p);
   }
   for(const [j,n]of ['LeftFoot','RightFoot','LeftToeBase','RightToeBase'].entries())assert(world(n)(a).distanceTo(feet[i][j])<1e-9,'No leg/foot drift');
   if(frames%3===0){
    for(const actor of [a,b])actor.model.getObjectByName('Human').skeleton.update();
    for(const ix of samples[i]){
     for(const [actor,isOld]of [[a,false],[b,true]]){
      const mesh=actor.model.getObjectByName('Human');mesh.getVertexPosition(ix,vec);mesh.localToWorld(vec);assert(vec.toArray().every(Number.isFinite));
      const inside=(vec.x/1.68)**2+((vec.z-.68)/.76)**2<.96;
      if(inside&&vec.y>.72&&vec.y<.825){if(isOld)baselinePenetrations++;else {penetrations++;const skin=mesh.geometry.attributes.skinIndex;const name=mesh.skeleton.bones[skin.getX(ix)].name;hitBones[name]=(hitBones[name]||0)+1;}}
      if(!isOld&&inside)minHandY=Math.min(minHandY,vec.y);
      vertices++;
     }
    }
   }
  }
  assert.equal(captionAt(turn,t),beforeCaption(turn,t));frames++;
 }
 const target=handoffTarget(turn);cut({type:'turn-end',speaker:turn.speaker,target},clock+turn.duration);
 for(let t=0;t<turn.pause;t+=1/30)for(const a of now.actors)applyPerformance(a,clock+turn.duration+t,1/30,{speaker:turn.speaker,speaking:false,directed:true,expressive:true,audioTime:turn.duration,handoff:{target,age:t},attention:turn.attention},false);
 clock+=turn.duration+turn.pause;
}
function beforeCaption(turn,t){let text=turn.captions[0].text;for(const c of turn.captions){if(c.start>t)break;text=c.text;}return text;}
assert(maxLift>.015,'Gesture must visibly lift beyond the old motion');assert(maxWristStep<.012,'No wrist pops between frames');
if(penetrations)console.error({hitBones,minHandY});
assert.equal(penetrations,0,'Sampled hands and arms stay above the tabletop');
for(const a of now.actors){const beforePose=Object.values(a.bones).map(b=>b.bone.quaternion.toArray());applyPerformance(a,99,.03,{paused:true},false);assert.deepEqual(Object.values(a.bones).map(b=>b.bone.quaternion.toArray()),beforePose,'Pause freezes the pose');}
const s={speaker:'nova',speaking:true,audioTime:.9,gestures:[{at:0,duration:2,strength:1}],performance:[]};
assert.deepEqual(bodyPerformance('nova',4,s),bodyPerformance('nova',4,s));assert.equal(bodyPerformance('nova',4,s,true).left,0);assert.equal(bodyPerformance('nova',4,s,true).chest[0],0);
assert.equal(gestureEnvelope(NaN,2),0);assert.equal(gestureEnvelope(1,0),0);assert.equal(gestureEnvelope(-1,2),0);
assert.deepEqual(crossedPerformance(turns[0],3,1),[]);assert.deepEqual(crossedPerformance(turns[0],1,1),[]);
assert(cuts.some(c=>c.event==='performance'),'Authored listener event causes a real camera cut');assert(cuts.some(c=>c.shot==='two'));
for(let i=1;i<cuts.length;i++)assert(cuts[i].time-cuts[i-1].time>=2.2-.04,'Camera hold floor');
director.mode='fixed';director.select('wide',0);director.event({type:'turn-start',speaker:'nova'},500);assert.equal(director.shot,'wide');
console.log(JSON.stringify({result:'PASS',frames,vertices,maxLiftMeters:maxLift,maxWristStepMeters:maxWristStep,minSampledHandY:minHandY,tableIntersections:{before:baselinePenetrations,after:penetrations},cuts,checks:['planted legs and feet','finite animated geometry','bounded wrists','no new sampled table intersections','paused pose','reduced motion','deterministic sampling','semantic camera holds','caption contract unchanged']},null,2));
