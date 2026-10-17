// Offline geometry review only; does not render WebGL or start a browser.
import fs from 'node:fs';
import * as THREE from '../dist/lab/vendor/three.module.js';
import {GLTFLoader} from '../dist/lab/vendor/GLTFLoader.js';
import {createRoom,applyPerformance} from '../dist/studio/room.js';
import {makeEditorialCharacter} from '../dist/studio/editorial-characters.js';
import {conversationSeats,conversationFrame,conversationPracticals} from '../dist/studio/blocking.js';
const output='/tmp/echo-scene-review';fs.mkdirSync(output,{recursive:true});const materialMaps={};
async function load(path,prefix){
 const buffer=fs.readFileSync(path),n=buffer.readUInt32LE(12),g=JSON.parse(buffer.subarray(20,20+n)),binary=buffer.subarray(28+n);
 for(let i=0;i<(g.images||[]).length;i++){const im=g.images[i],v=g.bufferViews[im.bufferView];fs.writeFileSync(`${output}/${prefix}-${i}.png`,binary.subarray(v.byteOffset||0,(v.byteOffset||0)+v.byteLength));}
 for(const m of g.materials){const t=m.pbrMetallicRoughness?.baseColorTexture;if(t)materialMaps[m.name]=`${output}/${prefix}-${g.textures[t.index].source}.png`;delete m.normalTexture;delete m.occlusionTexture;delete m.emissiveTexture;if(m.pbrMetallicRoughness){delete m.pbrMetallicRoughness.baseColorTexture;delete m.pbrMetallicRoughness.metallicRoughnessTexture;}}
 delete g.images;delete g.textures;delete g.samplers;
 const json=Buffer.from(JSON.stringify(g)),pad=Buffer.alloc((4-json.length%4)%4,32),bin=buffer.subarray(20+n),header=Buffer.alloc(20);header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2,4);header.writeUInt32LE(20+json.length+pad.length+bin.length,8);header.writeUInt32LE(json.length+pad.length,12);header.writeUInt32LE(0x4e4f534a,16);
 const b=Buffer.concat([header,json,pad,bin]);globalThis.self=globalThis;return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');
}
const base=await load('dist/studio/lookdev/assets/cast-clean-v6.glb','body'),hair=await load('dist/studio/lookdev/assets/hair-clean-v6.glb','hair');
const room=createRoom(base.scene,{cast:conversationSeats,practicalPositions:conversationPracticals,actorFactory:(base,index)=>makeEditorialCharacter(base,index,{hairLibrary:hair.scene})});
const shots=['wide','echo','nova','atlas','two'];
for(const shot of shots){
 const speaker=['wide','two'].includes(shot)?'echo':shot;
 const state={speaker,speaking:true,directed:true,expressive:true,audioTime:1,attention:[{at:0,target:speaker==='echo'?'audience':'echo'}],gestures:[],performance:[],cue:null,reaction:null,reactionAge:0};
 for(const a of room.actors)for(let i=0;i<60;i++)applyPerformance(a,2,1/30,state,false);
 room.scene.updateMatrixWorld(true);const meshes=[];
 room.scene.traverse(o=>{
  if(!o.isMesh||o.isInstancedMesh||!o.visible||o.material.isShaderMaterial)return;
  let p=o.parent;while(p){if(!p.visible)return;p=p.parent;}
  o.skeleton?.update();const g=o.geometry,points=[],v=new THREE.Vector3();
  for(let i=0;i<g.attributes.position.count;i++){o.getVertexPosition(i,v);v.applyMatrix4(o.matrixWorld);points.push(v.toArray());}
  const idx=g.index?Array.from(g.index.array):Array.from({length:points.length},(_,i)=>i);const m=Array.isArray(o.material)?o.material[0]:o.material;
  meshes.push({name:o.name,points,indices:idx,uv:g.attributes.uv?Array.from(g.attributes.uv.array):null,color:m.color?.toArray()||[.08,.1,.08],roughness:m.roughness??.8,metalness:m.metalness??0,map:materialMaps[m.name]||null});
 });
 fs.writeFileSync(`${output}/${shot}.json`,JSON.stringify({shot,meshes,camera:conversationFrame(shot,shot==='wide'?1.45:.82),aspect:shot==='wide'?1.45:.82}));
}
console.log('Exported five posed scene geometry snapshots to '+output);
