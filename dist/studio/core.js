// Provider-neutral event contract. Audio owns time; the renderer only consumes state.
export class Director {
  constructor({minHold=5.5}={}) { this.minHold=minHold; this.reset(); }
  reset(){this.shot='wide';this.lastCut=0;this.mode='auto';this.pending=null;this.reacting=false;}
  select(shot,time){if(shot!==this.shot){this.shot=shot;this.lastCut=time;}return shot;}
  event(event,time){
    if(event.type==='turn-start')this.pending=event.shot||event.utterance?.shot||event.speaker;
    if(this.mode!=='auto'||time-this.lastCut<this.minHold)return this.shot;
    if(event.type==='sentence'&&event.reaction){this.reacting=true;return this.select(event.reaction,time);}
    // Defer an early turn cut to its next sentence boundary, never to a blind timer.
    if((event.type==='turn-start'||event.type==='sentence')&&this.pending){this.reacting=false;return this.select(this.pending,time);}
    return this.shot;
  }
}
export function captionAt(turn,time){
  const captions=turn.captions;
  if(!captions?.length)return turn.text;
  // Keep the last complete caption through encoded padding and inter-turn pauses.
  let text=captions[0].text;
  for(const c of captions){if(c.start>time)break;text=c.text;}
  return text;
}
export class MockAdapter extends EventTarget {
  constructor(turns,audio){super();this.turns=turns;this.audio=audio;this.index=0;this.state='ready';this.generation=0;this.elapsedBefore=0;this.gap=0;this.gapTimer=0;this.muted=false;
    audio.onended=()=>this.endTurn();audio.onerror=()=>this.fail('Audio could not load. Retry this turn or use the transcript.');
    audio.ontimeupdate=()=>this.emit('timing');
  }
  emit(type,extra={}){this.dispatchEvent(new CustomEvent(type,{detail:{type,speaker:this.turn?.speaker,text:this.turn?.text||'',time:this.audio.currentTime,utterance:this.turn,...extra}}));}
  get turn(){return this.turns[this.index];}
  get time(){return this.elapsedBefore+(this.gap?this.turn.duration:this.audio.currentTime||0);}
  get duration(){return this.turns.reduce((s,t)=>s+t.duration+(t.pause??.55),0);}
  async play(){
    if(this.state==='ended')return this.replay();
    if(this.gap){this.state='playing';this.emit('state');this.scheduleGap();return;}
    if(!this.audio.getAttribute('src')){this.audio.src=this.turn.audio;this.emit('turn-start');}
    const generation=++this.generation;this.state='loading';this.emit('state');
    try {await this.audio.play();if(generation!==this.generation)return;this.state='playing';this.emit('state');}
    catch {if(generation===this.generation)this.fail('Playback is blocked. Tap Play to try again.');}
  }
  pause(){this.generation++;this.audio.pause();if(this.gapTimer){clearTimeout(this.gapTimer);this.gapTimer=0;this.gap=Math.max(1,this.gap-(performance.now()-this.gapAt));}this.state='paused';this.emit('state');}
  endTurn(){if(this.state!=='playing')return;this.emit('turn-end');this.gap=(this.turn.pause??.55)*1000;this.scheduleGap();}
  scheduleGap(){clearTimeout(this.gapTimer);this.gapAt=performance.now();this.gapTimer=setTimeout(()=>{this.gapTimer=0;this.gap=0;this.elapsedBefore+=this.turn.duration+(this.turn.pause??.55);this.index++;if(this.index>=this.turns.length){this.index=this.turns.length-1;this.state='ended';this.emit('state');return;}this.audio.removeAttribute('src');this.audio.currentTime=0;this.play();},this.gap);}
  cancel(){this.pause();this.emit('cancel');}
  interrupt(){this.pause();this.gap=0;this.audio.currentTime=0;this.audio.removeAttribute('src');this.emit('interruption');}
  replay(){this.pause();this.index=0;this.elapsedBefore=0;this.gap=0;this.audio.removeAttribute('src');this.audio.currentTime=0;this.state='ready';this.emit('reset');return this.play();}
  fail(message){this.pause();this.state='error';this.emit('failure',{message});this.emit('state');}
  mute(value){this.muted=value;this.audio.muted=value;this.emit('mute');}
  dispose(){this.cancel();this.audio.onended=this.audio.onerror=this.audio.ontimeupdate=null;this.audio.removeAttribute('src');this.audio.load();}
}
