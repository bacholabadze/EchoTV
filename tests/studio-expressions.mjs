import assert from 'node:assert/strict';
import fs from 'node:fs';
import {facePerformance,intents,envelope} from '../dist/studio/performance.js';
const turns=JSON.parse(fs.readFileSync(new URL('../dist/studio/dialogue.json',import.meta.url)));
let expressionSamples=0,blinks={echo:[],nova:[],atlas:[]};
for(const turn of turns){
 for(const cue of turn.performance){assert(intents[cue.intent]);assert(cue.at<turn.duration);assert(cue.duration>0);}
 for(let time=0;time<turn.duration;time+=.05){
  for(const id of ['echo','nova','atlas']){
   const state={speaker:turn.speaker,speaking:true,audioTime:time,performance:turn.performance};const sample=facePerformance(id,time,state);
   for(const [key,v]of Object.entries(sample.weights)){assert(Number.isFinite(v)&&v>=0&&v<=1);if(key.startsWith('mouth')&&id===turn.speaker)assert(v<.06,'Speech must dominate lower face');}
   assert.deepEqual(sample,facePerformance(id,time,state),'Clock sampling is deterministic and pause-safe');
   const reduced=facePerformance(id,time,state,true);assert.equal(reduced.gaze,0);assert.equal(reduced.nod,0);
   if(sample.weights.browInnerUp>.08||sample.weights.browOuterUpLeft>.1)expressionSamples++;
  }
 }
}
assert(expressionSamples>200,'Authored facial beats must be measurable');
for(const id of Object.keys(blinks)){let was=false;for(let t=0;t<70;t+=.02){const p=facePerformance(id,t,{speaker:'echo',speaking:false,audioTime:0});if(p.weights.eyeBlinkLeft>.8&&!was)blinks[id].push(t);was=p.weights.eyeBlinkLeft>.8;}}
assert(blinks.echo.length>6&&blinks.nova.length>6);assert.notDeepEqual(blinks.echo,blinks.nova);assert.notDeepEqual(blinks.echo,blinks.atlas);
assert.equal(envelope(-1,2),0);assert.equal(envelope(3,2),0);
assert.deepEqual(facePerformance('nova',4,{audioTime:1}),facePerformance('nova',4,{audioTime:1}));
console.log(`PASS: ${expressionSamples} expressive samples; bounded speech-safe morphs; distinct blink schedules; reduced motion; deterministic pause/replay sampling.`);
