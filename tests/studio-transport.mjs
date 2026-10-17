import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Director,MockAdapter,captionAt} from '../dist/studio/core.js';
const realTimeout=globalThis.setTimeout,realClear=globalThis.clearTimeout;let nextTimer=0;const timers=new Map();globalThis.setTimeout=(fn)=>{timers.set(++nextTimer,fn);return nextTimer;};globalThis.clearTimeout=id=>timers.delete(id);
class Audio {constructor(){this.src='';this.currentTime=0;this.muted=false;this.running=false;this.starts=0;}getAttribute(){return this.src;}removeAttribute(){this.src='';}async play(){this.running=true;this.starts++;}pause(){this.running=false;}load(){}}
const turns=JSON.parse(fs.readFileSync(new URL('../dist/studio/dialogue.json',import.meta.url)));
const audio=new Audio(),adapter=new MockAdapter(turns,audio);let starts=0;adapter.addEventListener('turn-start',()=>starts++);
await adapter.play();assert.equal(adapter.state,'playing');assert.equal(starts,1);audio.currentTime=2;adapter.pause();assert.equal(audio.running,false);assert.equal(audio.currentTime,2);await adapter.play();assert.equal(starts,1);assert.equal(audio.currentTime,2);
adapter.mute(true);assert.equal(audio.muted,true);adapter.interrupt();assert.equal(audio.currentTime,0);assert.equal(adapter.state,'paused');await adapter.play();assert.equal(starts,2);
audio.onended();assert.equal(timers.size,1);adapter.pause();assert.equal(timers.size,0);await adapter.play();assert.equal(timers.size,1);const fn=[...timers.values()][0];timers.clear();fn();await Promise.resolve();assert.equal(adapter.index,1);assert.equal(starts,3);
await adapter.replay();assert.equal(adapter.index,0);assert.equal(adapter.elapsedBefore,0);assert.equal(timers.size,0);assert.equal(starts,4);
adapter.fail('missing');assert.equal(adapter.state,'error');assert.equal(audio.running,false);await adapter.play();assert.equal(adapter.state,'playing');adapter.cancel();assert.equal(audio.running,false);
// A real script rehearsal: all cuts come from turn/caption events, including the authored reaction.
const director=new Director();let time=0;const cuts=[];
for(const turn of turns){
 const before=director.shot;director.event({type:'turn-start',speaker:turn.speaker,utterance:turn},time);if(before!==director.shot)cuts.push([time,director.shot]);
 for(const caption of turn.captions){
  const reaction=turn.reaction&&Math.abs(caption.start-turn.reactionAt)<.1?turn.reaction:null;
  const before=director.shot;director.event({type:'sentence',speaker:turn.speaker,reaction},time+caption.start);if(before!==director.shot)cuts.push([time+caption.start,director.shot]);
 }
 time+=turn.duration+turn.pause;
}
assert(cuts.some(c=>c[1]==='two'));assert(cuts.some(c=>Math.abs(c[0]-(turns.slice(0,6).reduce((s,t)=>s+t.duration+t.pause,0)+turns[6].reactionAt))<.01));for(let i=1;i<cuts.length;i++)assert(cuts[i][0]-cuts[i-1][0]>=5.5);
assert(cuts.some(c=>c[1]==='echo'&&c[0]>52&&c[0]<56),'Moderator must regain frame at a sentence boundary after reaction');
for(const t of turns){assert.equal(captionAt(t,t.duration+.5),t.captions.at(-1).text,'Hold last caption through gap');assert.equal(captionAt(t,0),t.captions[0].text);}
director.mode='fixed';director.select('wide',0);director.event({type:'turn-start',speaker:'nova'},100);assert.equal(director.shot,'wide');
for(const t of turns){assert(fs.existsSync(new URL('../dist/studio/'+t.audio,import.meta.url)));assert.equal(t.captions.map(c=>c.text).join(' '),t.text);assert(t.cues.every(c=>c.end>=c.start&&c.end<=t.duration+.001));}
assert(time>=60&&time<=90);adapter.dispose();assert.equal(timers.size,0);globalThis.setTimeout=realTimeout;globalThis.clearTimeout=realClear;
console.log('PASS: audio pause/resume/replay/interruption/mute/failure/cancel; no duplicate gap timers; fixed mode; script duration '+time.toFixed(2)+'s; cuts',cuts.map(c=>[+c[0].toFixed(2),c[1]]));
