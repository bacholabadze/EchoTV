const config=__CONFIG__;
const THREE=await import(config.three),{GLTFLoader}=await import(config.loader),{attachFestivalSet}=await import(config.festival);
const {PerformanceDirector,crossedPerformance,handoffTarget}=await import(config.direction);
const $=s=>document.querySelector(s),rooms={},mods={},snapshots=[];
const evidence={baseline:config.BASE,sourceSha256:config.sourceSha256,userAgent:navigator.userAgent,createdAt:new Date().toISOString(),captures:[],benchmarks:[],cuts:[],timing:[],audioEvents:[],failures:[]};
const bytes=b64=>Uint8Array.from(atob(b64),c=>c.charCodeAt(0)).buffer;
const loader=new GLTFLoader(),base=await loader.parseAsync(bytes(config.assets['cast-clean-v6']),''),hair=await loader.parseAsync(bytes(config.assets['hair-clean-v6']),'');
for(const v of ['before','after']){
 mods[v]=Object.fromEntries(await Promise.all(Object.entries(config.entries[v]).map(async([k,url])=>[k,await import(url)])));
 const m=mods[v];rooms[v]=m.room.createRoom(base.scene,{cast:m.blocking.conversationSeats,practicalPositions:m.blocking.conversationPracticals,actorFactory:(b,i)=>m['editorial-characters'].makeEditorialCharacter(b,i,{hairLibrary:hair.scene})});
 m.materials.lightEditorialRoom(rooms[v].scene,{festival:false});attachFestivalSet(rooms[v].scene,(await loader.parseAsync(bytes(config.assets.festival),'')).scene);
}
const renderer=new THREE.WebGLRenderer({canvas:$('#render'),antialias:true,powerPreference:'low-power',preserveDrawingBuffer:true});renderer.setSize(1920,540,false);renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.88;
const camera=new THREE.PerspectiveCamera(35,16/9,.05,30),output=$('#output'),ctx=output.getContext('2d');
const audio=new Audio();audio.muted=true;audio.preload='auto';
const turns=[0,1,2,6].map(i=>({...config.turns[i],audio:URL.createObjectURL(new Blob([bytes(config.audioAssets[config.turns[i].audio])],{type:'audio/mpeg'}))}));
const {MockAdapter,captionAt,Director}=mods.after.core,adapter=new MockAdapter(turns,audio),directors={before:new Director(),after:new PerformanceDirector()};
let clock=0,last=0,raf=0,sentence=-1,previous=-1,handoff=null,recorder,recordingStart=0,recording=false,finished=false,lastTiming=-1;
function event(e){for(const [version,d] of Object.entries(directors)){const old=d.shot;d.event(e,adapter.time);if(old!==d.shot)evidence.cuts.push({version,at:adapter.time,shot:d.shot,event:e.type});}}
function state(turn,t,playing=true){return {speaker:turn.speaker,speaking:playing,mouthStrength:.56,expressive:true,directed:true,attention:turn.attention||[],gestures:turn.gestures||[],performance:turn.performance||[],audioTime:t,cue:turn.cues.find(c=>t>=c.start&&t<c.end),handoff:handoff?{target:handoff.target,age:clock-handoff.at}:null};}
function apply(version,s,t,dt){for(const actor of rooms[version].actors)mods[version].room.applyPerformance(actor,t,dt,s,false);}
function view(shot){const p=shot==='hands'?[.75,1.18,1.05,0,.89,.11,39]:mods.after.blocking.conversationFrame(shot,16/9);camera.aspect=16/9;camera.position.set(...p.slice(0,3));camera.fov=p[6];camera.lookAt(...p.slice(3,6));camera.updateProjectionMatrix();}
function render(shot,caption=''){
 view(shot);renderer.setScissorTest(true);
 for(const [i,v]of ['before','after'].entries()){renderer.setViewport(i*960,0,960,540);renderer.setScissor(i*960,0,960,540);renderer.render(rooms[v].scene,camera);}
 renderer.setScissorTest(false);ctx.fillStyle='#10251e';ctx.fillRect(0,0,1920,620);ctx.drawImage(renderer.domElement,0,40);ctx.fillStyle='#eceddc';ctx.font='22px system-ui';ctx.fillText('BEFORE · Wave 1',24,28);ctx.fillText('AFTER · Wave 2',984,28);ctx.font='18px system-ui';ctx.fillText(caption.slice(0,180),24,606);ctx.fillText(shot,1800,28);
}
const capturePlan=[['speaker-gesture','01',1.15,'wide'],['hand-clearance','01',1.2,'hands'],['listener-acknowledgment','01',2.60,'nova'],['seated-posture','02',1.15,'wide'],['listener-considers','03',6.45,'nova'],['two-person-conversation','07',4.05,'two'],['three-character-wide','07',4.10,'wide']];
function sampleCaptures(){for(const [label,id,at,shot]of capturePlan){if(adapter.turn.id!==id||audio.currentTime<at||snapshots.includes(label))continue;render(shot,captionAt(adapter.turn,audio.currentTime));evidence.captures.push({label,shot,turn:id,audioTime:audio.currentTime,png:output.toDataURL('image/png')});snapshots.push(label);}}
function frame(ms){raf=requestAnimationFrame(frame);if(last&&ms-last<32)return;const dt=Math.min(last?(ms-last)/1000:1/30,.08);last=ms;
 const playing=adapter.state==='playing';if(playing)clock+=dt;
 if(playing&&!adapter.gap){
  const turn=adapter.turn,t=audio.currentTime,index=turn.captions.findIndex(c=>t>=c.start&&t<c.end);
  if(index>=0&&index!==sentence){sentence=index;event({type:'sentence',speaker:turn.speaker,reaction:Math.abs(turn.captions[index].start-turn.reactionAt)<.1?turn.reaction:null});}
  for(const cue of crossedPerformance(turn,previous,t))event({type:'performance',speaker:turn.speaker,cue,audioTime:t,remaining:turn.duration-t});previous=t;
  if(Math.floor(t*5)!==lastTiming){lastTiming=Math.floor(t*5);const cue=turn.cues.find(c=>t>=c.start&&t<c.end);evidence.timing.push({turn:turn.id,audioTime:t,caption:captionAt(turn,t),cue:cue?.key||null,wallTime:ms});}
 }
 const s=state(adapter.turn,audio.currentTime,playing&&!adapter.gap);for(const v of ['before','after'])apply(v,s,clock,dt);
 if(recording)sampleCaptures();render(directors.after.shot,captionAt(adapter.turn,audio.currentTime));
}
audio.addEventListener('playing',()=>evidence.audioEvents.push({turn:adapter.turn.id,wallOffsetMs:performance.now()-recordingStart,mediaTime:audio.currentTime}));
adapter.addEventListener('turn-start',e=>{sentence=-1;previous=-1;lastTiming=-1;event(e.detail);});
adapter.addEventListener('turn-end',e=>{const target=handoffTarget(e.detail.utterance);handoff=target?{target,at:clock}:null;event({...e.detail,target});});
adapter.addEventListener('failure',e=>{evidence.failures.push(e.detail.message);$('#status').textContent=e.detail.message;recorder?.stop();});
adapter.addEventListener('state',()=>{if(adapter.state==='ended'&&!finished){finished=true;recording=false;cancelAnimationFrame(raf);recorder.stop();}});
const next=()=>new Promise(requestAnimationFrame),pct=(values,q)=>[...values].sort((a,b)=>a-b)[Math.floor((values.length-1)*q)];
async function benchmark(){
 const gl=renderer.getContext(),extension=gl.getExtension('EXT_disjoint_timer_query_webgl2');
 for(let trial=0;trial<2;trial++)for(const version of (trial?['after','before']:['before','after'])){
  renderer.setViewport(0,0,960,540);renderer.setScissor(0,0,960,540);renderer.setScissorTest(true);view('wide');
  const turn=config.turns[0],scene=rooms[version].scene;renderer.compile(scene,camera);
  for(let i=0;i<30;i++){apply(version,state(turn,i/30),i/30,1/30);renderer.render(scene,camera);await next();}
  const animation=[],submit=[],frames=[],gpu=[],pending=[];let stamp=performance.now();
  for(let i=0;i<180;i++){
   await next();const start=performance.now();frames.push(start-stamp);stamp=start;apply(version,state(turn,i/30),i/30,1/30);animation.push(performance.now()-start);
   const q=extension?gl.createQuery():null;if(q)gl.beginQuery(extension.TIME_ELAPSED_EXT,q);
   const draw=performance.now();renderer.render(scene,camera);submit.push(performance.now()-draw);if(q){gl.endQuery(extension.TIME_ELAPSED_EXT);pending.push(q);}
   while(pending.length&&gl.getQueryParameter(pending[0],gl.QUERY_RESULT_AVAILABLE)){const query=pending.shift();if(!gl.getParameter(extension.GPU_DISJOINT_EXT))gpu.push(gl.getQueryParameter(query,gl.QUERY_RESULT)/1e6);gl.deleteQuery(query);}
  }
  for(let tries=0;pending.length&&tries<12;tries++){await next();while(pending.length&&gl.getQueryParameter(pending[0],gl.QUERY_RESULT_AVAILABLE)){const q=pending.shift();if(!gl.getParameter(extension.GPU_DISJOINT_EXT))gpu.push(gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6);gl.deleteQuery(q);}}
  for(const q of pending)gl.deleteQuery(q);
  evidence.benchmarks.push({version,trial,samples:180,width:960,height:540,pixelRatio:1,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,animationMedianMs:pct(animation,.5),animationP95Ms:pct(animation,.95),submitMedianMs:pct(submit,.5),submitP95Ms:pct(submit,.95),frameP95Ms:pct(frames,.95),gpuSamples:gpu.length,gpuMedianMs:gpu.length?pct(gpu,.5):null,gpuP95Ms:gpu.length?pct(gpu,.95):null});
 }
 renderer.setScissorTest(false);render('wide','Recorded dialogue complete · visual-only benchmark complete.');$('#metrics').textContent=JSON.stringify(evidence.benchmarks,null,2);$('#status').textContent=`Complete: ${evidence.captures.length} matched motion frames, audio-clock trace, 4 animated benchmarks. Download the video and evidence.`;$('#save').disabled=false;
}
$('#start').onclick=async()=>{
 $('#start').disabled=true;
 try{
  const stream=output.captureStream(30);
  const mime=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus'].find(v=>MediaRecorder.isTypeSupported(v));
  const chunks=[];recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:6000000});
  recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
  recorder.onstop=async()=>{const blob=new Blob(chunks,{type:recorder.mimeType});$('#video').href=URL.createObjectURL(blob);$('#video').download='echo-performance-wave2.webm';$('#video').hidden=false;evidence.recording={mime:recorder.mimeType,bytes:blob.size,turns:turns.map(t=>t.id),expectedDuration:turns.reduce((s,t)=>s+t.duration+t.pause,0),width:1920,height:620,fpsTarget:30,audio:'video-only capture; original dialogue is muxed at measured media-element playing offsets',comparison:'matched Wave 2 camera on both versions'};$('#status').textContent='Recording ready. Measuring animated renderer…';await benchmark();};
  recording=true;recordingStart=performance.now();recorder.start(1000);raf=requestAnimationFrame(frame);await adapter.play();$('#status').textContent='Recording actual animated playback on the muted media clock…';
 }catch(e){evidence.failures.push(e.message);$('#status').textContent=e.stack;$('#start').disabled=false;}
};
$('#save').onclick=()=>{const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([JSON.stringify(evidence)],{type:'application/json'}));link.download='echo-performance-wave2-evidence.json';link.click();$('#status').textContent='Evidence download requested.';};
window.addEventListener('error',e=>{evidence.failures.push(e.message);$('#status').textContent=e.message;});
for(const v of ['before','after'])apply(v,state(turns[0],0,false),0,1/30);render('wide','Ready · play the recorded comparison.');$('#start').disabled=false;$('#status').textContent='Ready. No provider calls or production connection.';
