import {characterMaterial} from './materials.js?v=6';
import * as THREE from 'three';
import {clone} from '../lab/vendor/SkeletonUtils.js';
// Independent skeletons and materials; no photographic atlas or inherited tint.
export const editorialLooks={
  0:{name:'Nova',jaw:0,nose:0},
  4:{name:'ECHO',jaw:-.055,nose:0},
  1:{name:'Atlas',jaw:.13,nose:.002}
};
function reshape(mesh,fn){
  mesh.geometry=mesh.geometry.clone();const geometry=mesh.geometry,position=geometry.attributes.position;
  const original=position.array.slice();
  for(let i=0;i<position.count;i++)position.setXYZ(i,...fn(original[i*3],original[i*3+1],original[i*3+2]));
  for(const attribute of geometry.morphAttributes.position||[]){for(let i=0;i<attribute.count;i++){
    const x=original[i*3],y=original[i*3+1],z=original[i*3+2];
    const p=fn(attribute.getX(i)+(geometry.morphTargetsRelative?x:0),attribute.getY(i)+(geometry.morphTargetsRelative?y:0),attribute.getZ(i)+(geometry.morphTargetsRelative?z:0));
    attribute.setXYZ(i,p[0]-(geometry.morphTargetsRelative?position.getX(i):0),p[1]-(geometry.morphTargetsRelative?position.getY(i):0),p[2]-(geometry.morphTargetsRelative?position.getZ(i):0));
  }}
  geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
}
export function makeEditorialCharacter(base,index,{hairLibrary}={}){
  const look=editorialLooks[index];if(!look)throw Error('Unknown editorial cast member');
  if(!hairLibrary)throw Error('Clean hair library is required');
  const model=clone(base),bones={},morphs=[];
  model.traverse(o=>{
    if(o.isBone)bones[o.name]={bone:o,rest:o.quaternion.clone()};
    if(!o.isMesh)return;
    const meshName=o.name.replace(/[^a-z0-9]/gi,'');
    o.frustumCulled=false;if(o.morphTargetDictionary)morphs.push(o);
    if(meshName==='Humanfemalecasualsuit01'){
      // Small cloth clearance prevents skin piercing the collar in close shots.
      o.geometry=o.geometry.clone();const p=o.geometry.attributes.position,n=o.geometry.attributes.normal;
      for(let i=0;i<p.count;i++){const clearance=p.getY(i)>1.39?.004:.0015;p.setXYZ(i,p.getX(i)+n.getX(i)*clearance,p.getY(i)+n.getY(i)*clearance,p.getZ(i)+n.getZ(i)*clearance);}
      o.geometry.computeVertexNormals();o.geometry.computeBoundingSphere();
    }

    if(index!==0&&meshName.startsWith('Novaearring'))o.visible=false;
    if(meshName==='Human'){
      // Cull skin fully covered by the shoes rather than allowing toe/sole intersections.
      o.geometry=o.geometry.clone();const p=o.geometry.attributes.position,ix=o.geometry.index,kept=[];
      for(let i=0;i<ix.count;i+=3){const a=ix.getX(i),b=ix.getX(i+1),c=ix.getX(i+2);if(p.getY(a)<.075&&p.getY(b)<.075&&p.getY(c)<.075)continue;kept.push(a,b,c);}
      o.geometry.setIndex(kept);
    }

    if(index!==0&&o.name==='Human')reshape(o,(x,y,z)=>{
      const front=THREE.MathUtils.clamp((z-.01)/.08,0,1);
      const jaw=Math.exp(-(((y-1.57)/.035)**2))*front;
      const nose=Math.exp(-((x/.021)**2)-((y-1.625)/.024)**2)*front;
      return [x*(1+look.jaw*jaw),y,z+look.nose*nose];
    });
    const materials=(Array.isArray(o.material)?o.material:[o.material]).map(source=>characterMaterial(source,index));o.material=Array.isArray(o.material)?materials:materials[0];
  });
  // Low-profile shoes cover the base model's bare feet in establishing shots.
  const shoeMaterial=new THREE.MeshStandardMaterial({color:index===0?0x564735:0x26332e,roughness:.82});
  const soleMaterial=new THREE.MeshStandardMaterial({color:0x1c2520,roughness:.96});
  for(const [side,sign]of [['Left',1],['Right',-1]]){
    const shoe=new THREE.Group();shoe.name='Shoe'+side;
    const geo=new THREE.SphereGeometry(1,24,16),p=geo.attributes.position;
    for(let i=0;i<p.count;i++){const z=p.getZ(i);p.setXYZ(i,p.getX(i)*(.052+.007*Math.max(0,z)),Math.max(.003,.047+p.getY(i)*.055),.081+z*.143);}
    geo.computeVertexNormals();const upper=new THREE.Mesh(geo,shoeMaterial);upper.position.x=sign*.198;shoe.add(upper);
    const sole=new THREE.Mesh(new THREE.SphereGeometry(1,24,10),soleMaterial);sole.scale.set(.059,.008,.145);sole.position.set(sign*.198,.005,.081);shoe.add(sole);
    model.add(shoe);model.updateMatrixWorld(true);bones[side+'Foot'].bone.attach(shoe);
  }
  if(hairLibrary){
    const name={0:'HairNova',4:'HairEcho',1:'HairAtlas'}[index];
    const source=hairLibrary.getObjectByName(name);if(!source)throw Error('Missing fitted hair: '+name);
    const hair=source.clone();hair.material=characterMaterial(source.material,index);hair.name=name;model.add(hair);model.updateMatrixWorld(true);bones.Head.bone.attach(hair);
  }
  if(index===1){
    // Thin open frames, placed outside the eyelids; attached in model coordinates.
    const glasses=new THREE.Group(),metal=new THREE.MeshStandardMaterial({color:0xa99977,roughness:.42,metalness:.65,envMapIntensity:.65});
    for(const x of [-.033,.033]){const rim=new THREE.Mesh(new THREE.TorusGeometry(.023,.0013,6,32),metal);rim.scale.y=.8;rim.position.x=x;glasses.add(rim);}
    const bridge=new THREE.Mesh(new THREE.CylinderGeometry(.0012,.0012,.020,6),metal);bridge.rotation.z=Math.PI/2;glasses.add(bridge);
    for(const sign of [-1,1]){const arm=new THREE.Mesh(new THREE.CylinderGeometry(.0012,.0012,.09,6),metal);arm.rotation.x=Math.PI/2;arm.position.set(sign*.056,0,-.045);glasses.add(arm);}
    glasses.position.set(0,1.653,.157);model.add(glasses);model.updateMatrixWorld(true);bones.Head.bone.attach(glasses);
  }
  return {model,bones,morphs,index,morphBindings:morphs.flatMap(mesh=>Object.entries(mesh.morphTargetDictionary).map(([name,index])=>({mesh,name,index})))};
}
