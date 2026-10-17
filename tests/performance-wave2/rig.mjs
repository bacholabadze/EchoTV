import fs from 'node:fs';
import * as THREE from '../../dist/lab/vendor/three.module.js';
import {GLTFLoader} from '../../dist/lab/vendor/GLTFLoader.js';
import {createRoom} from '../../dist/studio/room.js';
import {makeEditorialCharacter} from '../../dist/studio/editorial-characters.js';
import {conversationSeats,conversationPracticals} from '../../dist/studio/blocking.js';
globalThis.self=globalThis;
export async function room(factory=createRoom){
 const loader=new GLTFLoader();
 const load=async p=>{const b=fs.readFileSync(new URL('../../'+p,import.meta.url));return loader.parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');};
 const [base,hair]=await Promise.all([load('dist/studio/lookdev/assets/cast-clean-v6.glb'),load('dist/studio/lookdev/assets/hair-clean-v6.glb')]);
 const result=factory(base.scene,{cast:conversationSeats,practicalPositions:conversationPracticals,actorFactory:(base,index)=>makeEditorialCharacter(base,index,{hairLibrary:hair.scene})});result.scene.updateMatrixWorld(true);return result;
}
export {THREE};
