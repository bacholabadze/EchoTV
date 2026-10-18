// Visual scenery only. The original room remains visible until a valid replacement is ready.
import {GLTFLoader} from '../../lab/vendor/GLTFLoader.js';
export const FESTIVAL_SET_URL = '/studio/visual-upgrade/festival-set.glb';
export function attachFestivalSet(scene, group) {
  if(scene.userData.festivalSet === 'ready')return;
  const boxName='ECHO original backdrop';
  group.name='ECHO Hacktoberfest scenery';
  group.traverse(o=>{if(o.isMesh){o.castShadow=false;o.receiveShadow=false;}});
  scene.add(group);
  for(const name of [boxName,'ECHO original slats']){const original=scene.getObjectByName(name);if(original)original.visible=false;}
  scene.userData.festivalSet='ready';
  scene.dispatchEvent({type:'visualchange'});
}
export function loadFestivalSet(scene, loader = new GLTFLoader()) {
  if(scene.userData.festivalSet)return;
  scene.userData.festivalSet='loading';
  loader.load(FESTIVAL_SET_URL,gltf=>attachFestivalSet(scene,gltf.scene),undefined,()=>{
    scene.userData.festivalSet='unavailable'; // No playout side effects; original scenery stays intact.
    console.warn('ECHO event scenery unavailable; original studio retained.');
  });
}
