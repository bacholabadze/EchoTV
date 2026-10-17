import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../dist/lab/vendor/three.module.js';
import {GLTFLoader} from '../dist/lab/vendor/GLTFLoader.js';
import {makeEditorialCharacter} from '../dist/studio/editorial-characters.js';
import {materialPalettes} from '../dist/studio/materials.js';
globalThis.self=globalThis;
async function clean(name){
 const b=fs.readFileSync(new URL('../dist/studio/lookdev/assets/'+name,import.meta.url));
 const g=JSON.parse(b.subarray(20,20+b.readUInt32LE(12)));
 assert(!g.images?.length&&!g.textures?.length,'No embedded texture layers');
 for(const m of g.materials){assert(!m.occlusionTexture&&!m.normalTexture&&!m.pbrMetallicRoughness?.baseColorTexture);}
 for(const m of g.meshes)for(const p of m.primitives)assert(!p.attributes.COLOR_0,'No vertex tint layer');
 assert(!g.nodes.some(n=>/sculpted.?bob/i.test(n.name||'')),'Obsolete hair physically removed');
 return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');
}
const base=await clean('cast-clean-v6.glb'),hair=await clean('hair-clean-v6.glb');
assert.equal(hair.scene.children.length,3);
for(const index of [0,4,1]){
 const a=makeEditorialCharacter(base.scene,index,{hairLibrary:hair.scene});let skin=0,hairs=0;
 a.model.traverse(o=>{
  if(!o.isMesh)return;
  for(const m of Array.isArray(o.material)?o.material:[o.material]){
   assert(!m.map&&!m.aoMap&&!m.normalMap&&!m.vertexColors);
   assert.equal(m.side,THREE.FrontSide);assert(!m.transparent&&m.depthWrite);
   if(m.userData.surface==='skin'){skin++;assert.equal(m.color.getHex(),materialPalettes[index].skin);}
   if(m.userData.surface==='hair'){hairs++;assert.equal(m.color.getHex(),materialPalettes[index].hair);}
  }
 });
 assert.equal(skin,1);assert.equal(hairs,1);
}
const nova=hair.scene.getObjectByName('HairNova'),p=nova.geometry.attributes.position;
let back=Infinity;for(let i=0;i<p.count;i++)back=Math.min(back,p.getZ(i));
assert(back>-.12,'Rear bun absent; cap stays close to skull');
console.log('PASS: raw GLBs have no image/occlusion/normal/vertex-color layers; one skin and one fitted hair per actor; absolute palette colors; opaque front faces; old bob and rear bun absent.');
