import assert from 'node:assert/strict';
import {novaFrame} from '../dist/studio/lookdev/actor.js';
import fs from 'node:fs';
import {makeEditorialCharacter} from '../dist/studio/editorial-characters.js';
import * as THREE from '../dist/lab/vendor/three.module.js';
import {GLTFLoader} from '../dist/lab/vendor/GLTFLoader.js';
import {createRoom,applyPerformance} from '../dist/studio/room.js';
const buffer=fs.readFileSync(new URL('../dist/studio/lookdev/assets/cast-clean-v6.glb',import.meta.url));
const n=buffer.readUInt32LE(12),g=JSON.parse(buffer.subarray(20,20+n));
const hasBakedAO=g.materials.some(m=>m.name==='Nova / warm porcelain skin'&&m.occlusionTexture);
for(const m of g.materials){delete m.normalTexture;delete m.occlusionTexture;delete m.emissiveTexture;if(m.pbrMetallicRoughness){delete m.pbrMetallicRoughness.baseColorTexture;delete m.pbrMetallicRoughness.metallicRoughnessTexture;}}delete g.images;delete g.textures;delete g.samplers;
const json=Buffer.from(JSON.stringify(g)),pad=Buffer.alloc((4-json.length%4)%4,32),bin=buffer.subarray(20+n),header=Buffer.alloc(20);header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2,4);header.writeUInt32LE(20+json.length+pad.length+bin.length,8);header.writeUInt32LE(json.length+pad.length,12);header.writeUInt32LE(0x4e4f534a,16);
const b=Buffer.concat([header,json,pad,bin]);globalThis.self=globalThis;
const gltf=await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');

const hb=fs.readFileSync(new URL('../dist/studio/lookdev/assets/hair-clean-v6.glb',import.meta.url));
const hair=await new GLTFLoader().parseAsync(hb.buffer.slice(hb.byteOffset,hb.byteOffset+hb.byteLength),'');
const actorFactory=(base,index)=>makeEditorialCharacter(base,index,{hairLibrary:hair.scene});
const {scene,actors}=createRoom(gltf.scene,{actorFactory,cast:[{id:'nova',variant:0,x:0,z:-.20,yaw:.12}]});
scene.updateMatrixWorld(true);const actor=actors[0];assert.equal(actors.length,1);
assert.equal(actor.morphs.find(m=>m.morphTargetDictionary.viseme_aa!==undefined).morphTargetInfluences.length,66);
for(const side of ['Left','Right']){const wrist=actor.bones[side+'Hand'].bone.getWorldPosition(new THREE.Vector3());assert(wrist.y>.845&&wrist.y<.89);assert((wrist.x/1.68)**2+((wrist.z-.68)/.76)**2<1);}
let samples=0;
for(const cue of [null,{key:'aa'},{key:'PP'},{key:'O'}]){
 for(let i=0;i<20;i++)applyPerformance(actor,i/30,1/30,{speaker:'nova',speaking:!!cue,mouthStrength:.56,audioTime:1,cue,reaction:null,reactionAge:0},false);
 scene.updateMatrixWorld(true);
 actor.model.traverse(m=>{if(m.isSkinnedMesh){m.skeleton.update();for(let i=0;i<m.geometry.attributes.position.count;i+=50){const v=new THREE.Vector3();m.getVertexPosition(i,v);assert(v.toArray().every(Number.isFinite));samples++;}}});
}
for(const aspect of [320/480,360/440,390/500,680/560]){const p=novaFrame(aspect),camera=new THREE.PerspectiveCamera(p[6],aspect,.05,25);camera.position.set(...p.slice(0,3));camera.lookAt(...p.slice(3,6));camera.updateMatrixWorld(true);for(const x of [-.12,.12])for(const y of [1.13,1.38]){const v=new THREE.Vector3(x,y,.13).applyMatrix4(actor.pivot.matrixWorld).project(camera);assert(Math.abs(v.x)<.94&&Math.abs(v.y)<.94,'Head must fit the study frame');}}
const turns=JSON.parse(fs.readFileSync(new URL('../dist/studio/lookdev/dialogue.json',import.meta.url)));const duration=turns.reduce((sum,t)=>sum+t.duration+t.pause,0);assert(Math.abs(duration-15)<.02);assert(turns.every(t=>t.speaker==='nova'));for(const t of turns){assert(fs.existsSync(new URL('../dist'+t.audio,import.meta.url)));assert.equal(t.captions.map(c=>c.text).join(' '),t.text);}
assert(!hasBakedAO);
assert(buffer.length<12000000,'Audition asset size budget');
console.log(`PASS: one actor; 66 base facial shapes; ${samples} finite posed/morphed vertex samples; seated wrist contacts; four portrait/desktop frames; ${duration.toFixed(3)}s recording; no baked AO; ${(buffer.length/1e6).toFixed(2)}MB GLB.`);
