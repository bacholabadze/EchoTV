import fs from 'node:fs';
import * as THREE from '../dist/lab/vendor/three.module.js';
import {GLTFLoader} from '../dist/lab/vendor/GLTFLoader.js';
import {createRoom,cameraFrame,applyPerformance} from '../dist/studio/room.js';
import {intents} from '../dist/studio/performance.js';
import {makeEditorialCharacter} from '../dist/studio/editorial-characters.js';
import {conversationSeats,conversationFrame,conversationGaze,conversationPracticals} from '../dist/studio/blocking.js';
const directed=process.argv.includes('--directed');
const editorial=directed||process.argv.includes('--editorial');
async function loadModel(path){
const buffer=fs.readFileSync(new URL(path,import.meta.url));
const n=buffer.readUInt32LE(12),g=JSON.parse(buffer.subarray(20,20+n));
for(const m of g.materials){delete m.normalTexture;delete m.occlusionTexture;delete m.emissiveTexture;if(m.pbrMetallicRoughness){delete m.pbrMetallicRoughness.baseColorTexture;delete m.pbrMetallicRoughness.metallicRoughnessTexture;}}delete g.images;delete g.textures;delete g.samplers;
const json=Buffer.from(JSON.stringify(g)),pad=Buffer.alloc((4-json.length%4)%4,32),bin=buffer.subarray(20+n),header=Buffer.alloc(20);header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2,4);header.writeUInt32LE(20+json.length+pad.length+bin.length,8);header.writeUInt32LE(json.length+pad.length,12);header.writeUInt32LE(0x4e4f534a,16);
const b=Buffer.concat([header,json,pad,bin]);globalThis.self=globalThis;
return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');
}
const gltf=await loadModel(editorial?'../dist/studio/lookdev/assets/cast-clean-v6.glb':'../dist/lab/assets/nova.glb');
const hair=editorial?await loadModel('../dist/studio/lookdev/assets/hair-clean-v6.glb'):null;
if(hair)hair.scene.traverse(m=>{if(!m.isMesh)return;const p=m.geometry.attributes.position,n=m.geometry.attributes.normal;let alignment=0;for(let i=0;i<p.count;i++)alignment+=p.getX(i)*n.getX(i)+(p.getY(i)-1.685)*n.getY(i)+(p.getZ(i)-.012)*n.getZ(i);if(alignment/p.count<.04)throw Error('Hair normals must face outward');});
const {scene,actors}=createRoom(gltf.scene,editorial?{cast:directed?conversationSeats:undefined,practicalPositions:directed?conversationPracticals:undefined,actorFactory:(base,index)=>makeEditorialCharacter(base,index,{hairLibrary:hair.scene})}:{});scene.updateMatrixWorld(true);

const assert=(condition,message)=>{if(!condition)throw Error(message);};
let sampled=0;
for(const a of actors){
 for(const side of ['Left','Right']){
  const wrist=a.bones[side+'Hand'].bone.getWorldPosition(new THREE.Vector3());
  assert(wrist.y>.845&&wrist.y<.89,'Wrist/table height '+a.id);
  assert((wrist.x/1.68)**2+((wrist.z-.68)/.76)**2<1,'Wrist outside table '+a.id);
  const foot=a.bones[side+'ToeBase'].bone.getWorldPosition(new THREE.Vector3());
  assert(foot.y>0&&foot.y<.08,'Foot contact '+a.id);
 }
 for(const m of a.morphs){m.skeleton?.update();if(m.isSkinnedMesh)for(let i=0;i<m.geometry.attributes.position.count;i+=50){const p=new THREE.Vector3().fromBufferAttribute(m.geometry.attributes.position,i);m.applyBoneTransform(i,p);assert(p.toArray().every(Number.isFinite),'Invalid skinned vertex');sampled++;}}
}
const faceSizes=[];
for(const aspect of [320/480,360/440,390/440,768/570,1240/570])for(const shot of ['wide','echo','nova','atlas','two']){
 const p=(directed?conversationFrame:cameraFrame)(shot,aspect),camera=new THREE.PerspectiveCamera(p[6],aspect,.05,30);camera.position.set(...p.slice(0,3));camera.lookAt(...p.slice(3,6));camera.updateMatrixWorld(true);
 if(['echo','nova','atlas'].includes(shot)){const actor=actors.find(a=>a.id===shot);const lower=new THREE.Vector3(0,1.13,.13).applyMatrix4(actor.pivot.matrixWorld).project(camera),upper=new THREE.Vector3(0,1.34,.13).applyMatrix4(actor.pivot.matrixWorld).project(camera);const size=(upper.y-lower.y)/2;assert(size>.26,'Face must occupy at least 26% of frame height');faceSizes.push(size);}
 const relevant=shot==='wide'?actors:shot==='two'?actors.filter(a=>a.id!=='atlas'):actors.filter(a=>a.id===shot);
 for(const actor of relevant){
   const point=new THREE.Vector3(0,1.23,.145).applyMatrix4(actor.pivot.matrixWorld),direction=point.clone().sub(camera.position),distance=direction.length();
   const ray=new THREE.Raycaster(camera.position,direction.normalize(),.05,distance-.08);
   const furniture=scene.children.filter(o=>!actors.some(a=>a.pivot===o));
   assert(ray.intersectObjects(furniture,true).length===0,'Furniture obscures face center '+shot+' '+actor.id);
 }

 for(const a of relevant)for(const x of [-.11,.11])for(const y of [1.13,1.34]){
   const point=new THREE.Vector3(x,y,.13).applyMatrix4(a.pivot.matrixWorld).project(camera);
   assert(Math.abs(point.x)<.94&&Math.abs(point.y)<.88&&point.z<1,'Face outside camera '+shot+' '+aspect+' '+a.id);
 }
}
assert(actors[0].bones.Head.bone!==actors[1].bones.Head.bone,'Skeletons must be independent');
assert(scene.children.some(o=>o.isInstancedMesh&&o.count===49),'Wall slats must be batched');
for(const actor of actors){for(let n=0;n<12;n++)applyPerformance(actor,n/30,1/30,{speaker:actor.id,speaking:true,audioTime:2.5,cue:{key:'aa'},reaction:null,reactionAge:0},false);assert(actor.morphBindings.some(b=>b.name==='viseme_aa'&&b.mesh.morphTargetInfluences[b.index]>.5),'Speaking mouth cue');applyPerformance(actor,1,1/30,{speaker:actor.id,speaking:false,audioTime:0,reaction:null,reactionAge:0},false);assert(actor.morphBindings.filter(b=>b.name.startsWith('viseme_')).every(b=>b.mesh.morphTargetInfluences[b.index]===0),'Paused mouth must be closed');}
console.log('Measured geometric face-height range: '+Math.round(Math.min(...faceSizes)*100)+'–'+Math.round(Math.max(...faceSizes)*100)+'% of frame.');
console.log('PASS: independent skeletons, '+sampled+' skinned vertex samples, wrist and toe contacts, face projection in 25 shot/aspect combinations. Not a visual collision check.');

if(editorial){
 const body=a=>a.model.getObjectByName('Human');
 assert(body(actors[0]).geometry!==body(actors[1]).geometry,'Edited face geometries must be isolated');
 assert(body(actors[0]).material!==body(actors[1]).material,'Material isolation');
 const before=actors[1].bones.Head.bone.quaternion.clone();actors[0].bones.Head.bone.rotation.y+=.2;
 assert(actors[1].bones.Head.bone.quaternion.equals(before),'Pose must not leak between actors');
 for(const a of actors){assert(body(a).morphTargetInfluences.length===66,'66 facial targets');for(const preset of Object.values(intents))for(const key of Object.keys(preset))assert(key in body(a).morphTargetDictionary,'Expression shape exists: '+key);
  for(let i=0;i<12;i++)applyPerformance(a,3,1/30,{speaker:a.id,speaking:true,expressive:true,audioTime:.6,performance:[{actor:a.id,intent:'question',at:0,duration:2}],cue:{key:'aa'},reaction:null,reactionAge:0},false);assert(body(a).morphTargetInfluences[body(a).morphTargetDictionary.browInnerUp]>.15,'Authored brow event reaches the rendered morph');
  for(const cue of ['aa','PP','O']){for(let i=0;i<12;i++)applyPerformance(a,i/30,1/30,{speaker:a.id,speaking:true,mouthStrength:.56,audioTime:1,cue:{key:cue},reaction:null,reactionAge:0},false);
   scene.updateMatrixWorld(true);for(const m of a.morphs){if(!m.isSkinnedMesh)continue;m.skeleton.update();for(let i=0;i<m.geometry.attributes.position.count;i+=100){const v=new THREE.Vector3();m.getVertexPosition(i,v);assert(v.toArray().every(Number.isFinite),'Deformed facial vertices must remain finite');}}
  }
 }
 for(const actor of actors){let oldHair;actor.model.traverse(o=>{if(o.name.replace(/[^a-z0-9]/gi,'')==='Novasculptedbob')oldHair=o;});assert(!oldHair,'Old bob must be absent');const name={echo:'HairEcho',nova:'HairNova',atlas:'HairAtlas'}[actor.id];const fitted=actor.model.getObjectByName(name);assert(fitted&&fitted.parent===actor.bones.Head.bone,'Fitted hair must follow head bone');const box=new THREE.Box3().setFromObject(fitted);assert(box.max.y<1.42&&box.min.y>1.12,'Hair remains around seated skull');}

 console.log('PASS: editorial faces/materials/poses isolated; all three retain 66 facial targets and finite speech deformation.');
}

if(directed){
 const turns=JSON.parse(fs.readFileSync(new URL('../dist/studio/dialogue.json',import.meta.url)));
 for(const turn of turns)for(const at of [0,1,3,5]){
  for(const a of actors)for(let i=0;i<30;i++)applyPerformance(a,at+i/30,1/30,{speaker:turn.speaker,speaking:true,directed:true,expressive:true,audioTime:at,attention:turn.attention,gestures:turn.gestures,performance:turn.performance,cue:{key:'aa'},reaction:null,reactionAge:0},false);
  scene.updateMatrixWorld(true);
  for(const a of actors){const gaze=conversationGaze(a,{speaker:turn.speaker,audioTime:at,attention:turn.attention});assert(gaze.target!==a.id,'Actors do not look at themselves');assert(Math.abs(gaze.head)<=.8&&Math.abs(gaze.eyes)<=.32,'Gaze limits');
   for(const side of ['Left','Right']){const w=a.bones[side+'Hand'].bone.getWorldPosition(new THREE.Vector3());assert(w.y>.83&&w.y<.91,'Gesture wrist remains at table height');}
  }
 }
 console.log('PASS: directed attention and restrained gesture contacts over all dialogue turns.');
}
