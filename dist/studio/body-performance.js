// Authored-event layers over the existing seated rig. Radians, not guessed IK targets.
// Joint axes were measured on cast-clean-v6: negative forearm X and mirrored Z lift the palms.
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
const smooth=x=>{x=clamp(x,0,1);return x*x*(3-2*x);};
export function gestureEnvelope(age,duration=1.6){
 if(!Number.isFinite(age)||!Number.isFinite(duration)||duration<=0||age<0||age>=duration)return 0;
 const u=age/duration;
 // Deliberate lift, small hold, slower placement; no repeating sine-wave arm motion.
 return smooth(u/.26)*(1-smooth((u-.48)/.52));
}
export function bodyPerformance(id,time,state,reduced=false){
 const phase={echo:.3,nova:2.1,atlas:4.4}[id]??0;
 const zero={spine:[0,0,0],chest:[0,0,0],head:[0,0,0],left:0,right:0,open:0,settle:0};
 if(reduced)return zero;
 const active=state.speaking&&state.speaker===id;
 let left=0,right=0,open=0,listen=0,nod=0;
 if(active)for(const [i,cue] of (state.gestures||[]).entries()){
  if(cue.actor&&cue.actor!==id)continue;
  const strength=Number.isFinite(cue.strength)?clamp(cue.strength,0,1):.65;
  const e=gestureEnvelope(state.audioTime-cue.at,cue.duration)*strength;
  // Existing events need no migration. Explicit hand/kind can be authored by a future adapter.
  const hand=cue.hand||((id==='nova'||i%2)?'left':'right');
  if(hand==='left'||hand==='both')left=Math.max(left,e);
  if(hand==='right'||hand==='both')right=Math.max(right,e*(hand==='both'?.65:1));
  if(cue.kind==='open'||id==='nova')open=Math.max(open,e);
 }
 if(!active)for(const cue of state.performance||[]){
  if(cue.actor!==id)continue;
  const e=gestureEnvelope(state.audioTime-cue.at,cue.duration)*(Number.isFinite(cue.strength)?clamp(cue.strength,0,1):1);
  if(['consider','acknowledge','doubt','warmth','question'].includes(cue.intent))listen=Math.max(listen,e);
 }
 // A single acknowledgment follows an explicit turn-end, never an invented emotional beat.
 if(!active&&state.handoff?.target===id){const age=state.handoff.age;if(age>=.08&&age<.85)nod=.042*gestureEnvelope(age-.08,.77);}
 const emphasis=Math.max(left,right);
 const breath=(Math.sin(time*.93+phase)+.28*Math.sin(time*.41+phase))*.002;
 return {spine:[0,(left-right)*.008,0],chest:[breath-.005*emphasis-.004*listen,0,(right-left)*.004],head:[-.018*emphasis+nod,0,(id==='atlas'?-1:1)*.014*listen],left,right,open,settle:listen};
}
