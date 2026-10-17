import * as THREE from 'three';
// Edition 06: authored colors are absolute sRGB colors, not multipliers over an atlas.
export const materialPalettes={
  0:{skin:0xd1a283,shirt:0xd4d0ba,hair:0x50382c,iris:0x687558},
  4:{skin:0xb98e72,shirt:0x7c8b78,hair:0x62635e,iris:0x647776},
  1:{skin:0x91684e,shirt:0x334e46,hair:0x302a26,iris:0x685440}
};
export function characterMaterial(source,index){
 const p=materialPalettes[index];let color,roughness=.8,metalness=0,surface;
 const name=source.name;
 if(name.includes('porcelain skin')){color=p.skin;surface='skin';}
 else if(name.includes('ivory knit')){color=p.shirt;roughness=.95;surface='cloth';}
 else if(name.includes('brows')||name.startsWith('Hair / ')){color=p.hair;roughness=.86;surface=name.startsWith('Hair / ')?'hair':'brows';}
 else if(name.includes('teeth_base')){color=0xd9d2ba;roughness=.6;surface='teeth';}
 else if(name.includes('tongue01')){color=0x7d413c;surface='tongue';}
 else if(name.includes('sclera')){color=0xd2cec0;roughness=.44;surface='sclera';}
 else if(name.includes('hazel iris')){color=p.iris;roughness=.7;surface='iris';}
 else if(name.includes('pupil')){color=0x151c18;roughness=.45;surface='pupil';}
 else if(name.includes('brushed brass')){color=0x9e8757;roughness=.5;metalness=.55;surface='metal';}
 else throw Error('Unclassified character material: '+name);
 const material=new THREE.MeshStandardMaterial({name:'ECHO / '+surface,color,roughness,metalness,envMapIntensity:surface==='metal'?.35:.18,side:THREE.FrontSide,transparent:false,depthWrite:true});
 material.userData.surface=surface;
 return material;
}
// Stable lighting without image-based exposure shifts or baked skin shadows.
export function lightEditorialRoom(scene){
 scene.environment=null;
 for(const o of scene.children){
  if(o.isHemisphereLight){o.color.set(0xf3eee3);o.groundColor.set(0x788476);o.intensity=1.2;}
  if(o.isDirectionalLight){
   const rear=o.position.z<0;
   o.color.set(rear?0xe5ebdf:0xfff4e5);
   o.intensity=rear?.55:o.position.x<0?2.0:.95;
  }
 }
}
