import {Director} from './core.js';
const actors=new Set(['echo','nova','atlas']);
// Visual direction only. Every cut comes from a semantic event on the audio clock.
export class PerformanceDirector extends Director {
 constructor(){super({minHold:4.2});this.reactionHold=2.2;}
 reset(){super.reset();this.reacted=false;}
 event(event,time){
  if(event.type==='turn-start'){
   const turn=event.utterance||{};this.pending=event.shot||turn.shot||event.speaker;this.reacted=false;
  }
  if(this.mode!=='auto'||time-this.lastCut<(this.reacting?this.reactionHold:event.type==='turn-start'?2.8:this.minHold))return this.shot;
  const cue=event.cue;
  const explicitReaction=event.type==='sentence'?event.reaction:event.type==='turn-end'?event.target:null;
  const performanceReaction=event.type==='performance'&&cue?.actor!==event.speaker&&
   ['acknowledge','consider','doubt','warmth','surprise'].includes(cue?.intent)&&
   event.audioTime>=1.2&&event.remaining>=1.2?cue.actor:null;
  const listener=explicitReaction||performanceReaction;
  if(!this.reacted&&actors.has(listener)&&listener!==event.speaker){
   this.reacting=true;this.reacted=true;return this.select(listener,time);
  }
  if(['turn-start','sentence'].includes(event.type)&&this.pending){
   this.reacting=false;return this.select(this.pending,time);
  }
  return this.shot;
 }
}
// Crossing detector: seek/replay are explicit resets; no wall-clock timers or synthetic approvals.
export function crossedPerformance(turn,previous,current){
 if(!Number.isFinite(current)||current<previous)return [];
 return (turn.performance||[]).filter(cue=>cue.at>previous&&cue.at<=current);
}
export function handoffTarget(turn={}){
 const target=turn.attention?.at(-1)?.target;
 return actors.has(target)&&target!==turn.speaker?target:null;
}
