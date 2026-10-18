// Small authored expressions, not emotion recognition. Pure clock-driven sampling:
// pause and replay cannot accumulate timers or produce different performances.
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const smooth=x=>{x=clamp(x,0,1);return x*x*(3-2*x);};
const seed={echo:7,nova:23,atlas:41};
function random(n){const x=Math.sin(n*127.1+311.7)*43758.5453;return x-Math.floor(x);}
export const intents={
 question:{browInnerUp:.24,browOuterUpLeft:.17,browOuterUpRight:.10,eyeWideLeft:.075,eyeWideRight:.06},
 consider:{browInnerUp:.10,browDownRight:.09,eyeSquintLeft:.06,eyeSquintRight:.045},
 surprise:{browInnerUp:.27,browOuterUpLeft:.19,browOuterUpRight:.19,eyeWideLeft:.15,eyeWideRight:.15},
 doubt:{browOuterUpLeft:.26,browDownRight:.14,mouthPressLeft:.10,mouthPressRight:.05},
 warmth:{mouthSmileLeft:.28,mouthSmileRight:.23,cheekSquintLeft:.15,cheekSquintRight:.12},
 resolve:{browDownLeft:.11,browDownRight:.085,mouthPressLeft:.09,mouthPressRight:.09},
 acknowledge:{browInnerUp:.09,mouthSmileLeft:.10,mouthSmileRight:.08,cheekSquintLeft:.05,cheekSquintRight:.05}
};
export function envelope(age,duration){if(age<0||age>=duration)return 0;return smooth(age/(duration*.22))*(1-smooth((age-duration*.44)/(duration*.56)));}
const blinkSchedules={};
for(const id of Object.keys(seed)){let at=1.1+random(seed[id]) * 2.4;blinkSchedules[id]=[];for(let i=0;i<100;i++){blinkSchedules[id].push(at);at+=2.5+random(seed[id]+i+1)*4.5;}}
export function facePerformance(id,time,state,reduced=false){
 const weights={},active=state.speaking&&state.speaker===id;
 // Lower eyelid attention stays very small; expression events carry the emphasis.
 weights.eyeSquintLeft=weights.eyeSquintRight=active?.018:.028;
 for(const cue of state.performance||[]){
  if(cue.actor!==id||!intents[cue.intent])continue;
  const e=envelope(state.audioTime-cue.at,cue.duration)*(cue.strength??1);
  for(const [key,value]of Object.entries(intents[cue.intent])){
   // Speech owns the lower face. Listener smiles/presses never fight visemes.
   const lower=key.startsWith('mouth');weights[key]=(weights[key]||0)+value*e*(active&&lower?.18:1);
  }
 }
 let blink=0;
 for(const at of blinkSchedules[id]||[]){const age=time-at;if(age<0)break;if(age>.25)continue;blink=age<.065?smooth(age/.065):age<.11?1:1-smooth((age-.11)/.14);}
 // A tiny eyelid offset avoids perfectly mechanical bilateral closure.
 weights.eyeBlinkLeft=blink;weights.eyeBlinkRight=blink>.95?blink:blink*.97;
 for(const key of ['eyeSquintLeft','eyeSquintRight','eyeWideLeft','eyeWideRight'])weights[key]=(weights[key]||0)*(1-blink);
 for(const key of Object.keys(weights))weights[key]=clamp(weights[key],0,key.startsWith('eyeBlink')?1:.32);
 // Occasional tiny eye refixations. A stable target between movements, no sine wobble.
 const cycle=Math.floor((time+seed[id]*.13)/3.1),u=((time+seed[id]*.13)/3.1)%1;
 const move=smooth(u/.075),old=(random(seed[id]+cycle-1)-.5)*.022,next=(random(seed[id]+cycle)-.5)*.022;
 const gaze=reduced?0:old+(next-old)*move;
 let nod=0;
 if(!reduced)for(const cue of state.performance||[]){if(cue.actor===id&&cue.nod){const age=state.audioTime-cue.at;if(age>=0&&age<.9)nod+=Math.sin(age/.9*Math.PI)**2*.052;}}
 return {weights,gaze,nod};
}
