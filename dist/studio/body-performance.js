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
const seeds={echo:7,nova:23,atlas:41};
function hash(n){const x=Math.sin(n*127.1+311.7)*43758.5453;return x-Math.floor(x);}
export function bodyPerformance(id,time,state,reduced=false){
 const phase={echo:.3,nova:2.1,atlas:4.4}[id]??0,cinematic=!!state.cinematic;
 const zero={spine:[0,0,0],chest:[0,0,0],head:[0,0,0],left:0,right:0,open:0,settle:0,pull:0};
 if(reduced)return zero;
 const active=state.speaking&&state.speaker===id;
 let left=0,right=0,open=0,listen=0,nod=0,pull=0,beat=0;
 if(active)for(const [i,cue] of (state.gestures||[]).entries()){
  if(cue.actor&&cue.actor!==id)continue;
  const strength=Number.isFinite(cue.strength)?clamp(cue.strength,0,1):.65;
  // Wave 3: each authored gesture gets a deterministic shape of its own (never above the Wave 2 envelope).
  const v=cinematic?hash(cue.at*37+seeds[id]):.5,shape=cinematic?.82+.18*v:1,lag=cinematic?.10+.08*v:0;
  const e=gestureEnvelope(state.audioTime-cue.at,cue.duration)*strength*shape;
  // Existing events need no migration. Explicit hand/kind can be authored by a future adapter.
  const hand=cue.hand||((id==='nova'||i%2)?'left':'right');
  if(hand==='left'||hand==='both')left=Math.max(left,e);
  if(hand==='right'||hand==='both')right=Math.max(right,(cinematic&&hand==='both'?gestureEnvelope(state.audioTime-cue.at-lag,cue.duration)*strength*shape:e)*(hand==='both'?.65:1));
  if(cue.kind==='open'||id==='nova'||(cinematic&&v>.55))open=Math.max(open,e*(cinematic?.6+.4*v:1));
 }
 if(!active&&cinematic)for(const cue of state.gestures||[]){
  // Listeners are drawn toward the speaker's emphasis: head only, never the supported torso or hands.
  if(cue.actor&&cue.actor!==state.speaker)continue;
  pull=Math.max(pull,gestureEnvelope(state.audioTime-cue.at,cue.duration)*(Number.isFinite(cue.strength)?clamp(cue.strength,0,1):.65));
 }
 if(active&&cinematic&&Number.isFinite(state.sentenceAt)){const age=state.audioTime-state.sentenceAt;if(age>=0&&age<.55)beat=gestureEnvelope(age,.55);}
 if(!active)for(const cue of state.performance||[]){
  if(cue.actor!==id)continue;
  const e=gestureEnvelope(state.audioTime-cue.at,cue.duration)*(Number.isFinite(cue.strength)?clamp(cue.strength,0,1):1);
  if(['consider','acknowledge','doubt','warmth','question'].includes(cue.intent))listen=Math.max(listen,e);
 }
 // A single acknowledgment follows an explicit turn-end, never an invented emotional beat.
 if(!active&&state.handoff?.target===id){const age=state.handoff.age;if(age>=.08&&age<.85)nod=.042*gestureEnvelope(age-.08,.77);}
 const emphasis=Math.max(left,right);
 const breath=(Math.sin(time*.93+phase)+.28*Math.sin(time*.41+phase))*.002;
 // Wave 3 idle: very slow seated weight shift with incommensurate periods, so no visible loop.
 const shift=cinematic?.006*Math.sin(time*2*Math.PI/23.7+phase)+.003*Math.sin(time*2*Math.PI/41.3+phase*1.7):0;
 return {spine:[0,(left-right)*.008+shift,0],chest:[breath-.005*emphasis-.004*listen,0,(right-left)*.004],head:[-.018*emphasis+nod-.012*beat,0,(id==='atlas'?-1:1)*(.014*listen+.010*pull)],left,right,open,settle:listen,pull};
}
