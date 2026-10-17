const config=__CONFIG__;
const THREE=await import(config.three),{GLTFLoader}=await import(config.loader),{attachFestivalSet}=await import(config.festival);
const $=s=>document.querySelector(s), scenes={},modules={},records={baseline:config.BASE,sourceSha256:config.sourceSha256,userAgent:navigator.userAgent,createdAt:new Date().toISOString(),captures:[],benchmarks:[]};
const bytes=b64=>Uint8Array.from(atob(b64),c=>c.charCodeAt(0)).buffer;
const gltf=new GLTFLoader(),base=await gltf.parseAsync(bytes(config.assets['cast-clean-v6']),''),hair=await gltf.parseAsync(bytes(config.assets['hair-clean-v6']),'');
for(const version of ['before','after']){
 const mods=Object.fromEntries(await Promise.all(Object.entries(config.entries[version]).map(async([k,v])=>[k,await import(v)])));modules[version]=mods;
 const room=mods.room.createRoom(base.scene,{cast:mods.blocking.conversationSeats,practicalPositions:mods.blocking.conversationPracticals,actorFactory:(b,i)=>mods['editorial-characters'].makeEditorialCharacter(b,i,{hairLibrary:hair.scene})});
 mods.materials.lightEditorialRoom(room.scene,{festival:false});
 if(version==='after')attachFestivalSet(room.scene,(await gltf.parseAsync(bytes(config.assets.festival),'')).scene);
 const state={speaker:'echo',speaking:false,directed:true,expressive:true,audioTime:1,attention:[{at:0,target:'audience'}],gestures:[],performance:[],cue:null,reaction:null,reactionAge:0};
 for(let i=0;i<60;i++)for(const actor of room.actors)mods.room.applyPerformance(actor,2,1/30,state,true);
 scenes[version]=room.scene;
}
const renderer=new THREE.WebGLRenderer({canvas:$('#canvas'),antialias:true,powerPreference:'low-power',preserveDrawingBuffer:true});renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.88;renderer.setPixelRatio(1);
const camera=new THREE.PerspectiveCamera(35,16/9,.05,30);let version='before',shot='wide',portrait=false;
function render(){
 const w=portrait?390:1280,h=portrait?844:720;renderer.setSize(w,h,false);camera.aspect=w/h;
 const p=modules[version].blocking.conversationFrame(shot,w/h);camera.position.set(...p.slice(0,3));camera.fov=p[6];camera.lookAt(...p.slice(3,6));camera.updateProjectionMatrix();
 renderer.render(scenes[version],camera);$('#metrics').textContent=JSON.stringify({version,shot,viewport:[w,h],drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles},null,2);
}
$('#version').onchange=e=>{version=e.target.value;render();};$('#shot').onchange=e=>{shot=e.target.value;render();};
$('#portrait').onclick=()=>{portrait=!portrait;$('#stage').classList.toggle('portrait',portrait);render();};
const next=()=>new Promise(requestAnimationFrame);
$('#suite').onclick=async()=>{
 for(const el of document.querySelectorAll('button,select'))el.disabled=true;
 records.captures=[];records.benchmarks=[];
 try{
 for(portrait of [false,true])for(version of ['before','after']){
  $('#stage').classList.toggle('portrait',portrait);$('#version').value=version;
  for(shot of ['wide','echo','nova','atlas','two']){
   $('#shot').value=shot;render();await next();render();
   records.captures.push({version,shot,portrait,width:renderer.domElement.width,height:renderer.domElement.height,png:renderer.domElement.toDataURL('image/png'),drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles});
  }
  shot='wide';render();renderer.compile(scenes[version],camera);
  for(let i=0;i<30;i++){await next();renderer.render(scenes[version],camera);}
  const submit=[],frame=[];let last=performance.now();
  for(let i=0;i<180;i++){await next();const t=performance.now();frame.push(t-last);last=t;renderer.render(scenes[version],camera);submit.push(performance.now()-t);}
  const percentile=(a,q)=>[...a].sort((a,b)=>a-b)[Math.floor((a.length-1)*q)];
  records.benchmarks.push({version,portrait,samples:180,width:renderer.domElement.width,height:renderer.domElement.height,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,submitMedianMs:percentile(submit,.5),submitP95Ms:percentile(submit,.95),frameMedianMs:percentile(frame,.5),frameP95Ms:percentile(frame,.95),note:'Warm, stationary visual scene; preserveDrawingBuffer=true, pixelRatio=1. No inference about broadcast/audio performance.'});
  $('#status').textContent=`Measured ${version} ${portrait?'portrait':'landscape'}`;
 }
 $('#metrics').textContent=JSON.stringify(records.benchmarks,null,2);$('#status').textContent='20 WebGL captures + four benchmark samples ready. Save evidence JSON.';
 }catch(e){$('#status').textContent=e.stack;}
 for(const el of document.querySelectorAll('button,select'))el.disabled=false;
};
$('#save').onclick=async()=>{
 try{
 const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([JSON.stringify(records)],{type:'application/json'}));link.download='echo-visual-evidence.json';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),60000);$('#status').textContent='Evidence JSON download requested.';
 }catch(e){$('#status').textContent='Save: '+e.message;}
};
window.addEventListener('error',e=>{$('#status').textContent=e.message;});
render();$('#status').textContent='Ready · embedded real studio assets. Choose a shot, compare, then capture.';
if(location.hash.includes('after')){version='after';$('#version').value=version;render();}
if(location.hash.includes('capture')){await $('#suite').onclick();$('#save').focus();}
