import {PerformanceDirector} from './performance-direction.js';
import {conversationFrame} from './blocking.js?v=5';
// Wave 3: cinematic direction on top of the Wave 2 semantic director. Still no wall-clock timers:
// every decision comes from a turn, sentence, performance or handoff event on the audio clock.
const actors=new Set(['echo','nova','atlas']);
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const smooth=x=>{x=clamp(x,0,1);return x*x*(3-2*x);};
// Which two-person composition contains both the speaker and the person they address.
export const twoShots={echo:{nova:'two',atlas:'two-atlas'},nova:{echo:'two'},atlas:{echo:'two-atlas'}};
export function currentAttention(turn={},audioTime=0){
 let target=turn.speaker==='echo'?'audience':'echo';
 for(const cue of turn.attention||[])if(audioTime>=cue.at)target=cue.target;
 return target;
}
export class CinematicDirector extends PerformanceDirector{
 constructor(){super();this.endGuard=1.5;this.midTurnAt=2.4;this.twoHold=2.2;this.devHold=2.4;}
 reset(){super.reset();this.midCut=false;this.turn=null;this.turnStart=0;}
 event(event,time){
  if(event.type==='turn-start'){this.turn=event.utterance||{};this.turnStart=time;this.midCut=false;}
  // Never land a cut in the last moments of a turn: the turn boundary will cut anyway.
  if(this.mode==='auto'&&event.type==='sentence'&&Number.isFinite(event.remaining)&&event.remaining<this.endGuard)return this.shot;
  const before=this.shot,picked=super.event(event,time);
  if(this.mode!=='auto'||picked!==before||event.type!=='sentence'||this.midCut||this.reacting||!this.turn)return picked;
  // Mid-turn development: after a held close-up, open to the two-person frame that holds the speaker and the person addressed.
  const t=event.audioTime??0,remaining=event.remaining??Infinity;
  // A development cut may follow the turn-start close-up after devHold (3 s), shorter than the general minHold.
  if(t<this.midTurnAt||remaining<this.twoHold||time-this.lastCut<this.devHold)return picked;
  const two=twoShots[event.speaker]?.[currentAttention(this.turn,t)];
  if(!two||two===this.shot)return picked;
  this.midCut=true;return this.select(two,time);
 }
}
// Deterministic camera life. `age` is the time since the cut; motion is bounded so the rig test's
// face margins hold at the extremes (see tests/visual-wave3/direction.mjs).
export const motionLimits={push:.04,drift:.016,rise:.02};
export function cameraMotion(shot,age,reduced=false){
 if(reduced||!Number.isFinite(age)||age<0)return {push:0,drift:0,rise:0};
 const isWide=shot==='wide',isTwo=shot==='two'||shot==='two-atlas';
 // Slow push-in toward the look-at point; wide shots drift sideways instead of pushing.
 // Close-ups rise a little as they push, so headroom grows rather than shrinks.
 const push=(isWide?.018:isTwo?.03:motionLimits.push)*smooth(age/(isWide?14:9));
 const drift=(isWide?motionLimits.drift:.006)*Math.sin(age*(isWide?.21:.33));
 const rise=(isWide?0:isTwo?.008:motionLimits.rise)*smooth(age/9);
 return {push,drift,rise};
}
// Desktop stages are wider than 16:9 (the studio stage is about 2.2:1 at 1320 px). The Wave 2 frames were tuned at
// 16:9, which crops hair tops in close-ups on wide stages. Give back headroom on wide aspects; untouched at <= 1.9.
export function cinematicFrame(shot,aspect,frame){
 const base=frame||conversationFrame(shot,aspect);if(!(aspect>1.9)||shot==='wide')return base;
 const k=Math.min(aspect-1.9,.6),isTwo=shot==='two'||shot==='two-atlas';
 const [x,y,z,tx,ty,tz,fov]=base,dx=x-tx,dy=y-ty,dz=z-tz,back=1+(isTwo?.08:.14)*k;
 return [tx+dx*back,y+(isTwo?.02:.05)*k,tz+dz*back,tx,ty+(isTwo?.03:.06)*k,tz,fov];
}
// Apply motion to a frame [x,y,z,tx,ty,tz,fov]: position eases toward the target, slides along the camera's right axis.
export function framedPosition(frame,motion){
 const [x,y,z,tx,ty,tz]=frame;
 const dx=x-tx,dy=y-ty,dz=z-tz;
 const px=tx+dx*(1-motion.push),py=ty+dy*(1-motion.push)+motion.rise,pz=tz+dz*(1-motion.push);
 // Right axis of a camera looking along (-dx,-dy,-dz) with world up.
 const len=Math.hypot(dx,dz)||1,rx=dz/len,rz=-dx/len;
 return [px+rx*motion.drift,py,pz+rz*motion.drift];
}
export const cinematicShotNames={'two-atlas':'Two-person'};
