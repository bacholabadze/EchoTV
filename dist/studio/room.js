import {conversationGaze} from './blocking.js?v=5';
import {bodyPerformance} from './body-performance.js';
import {facePerformance} from './performance.js?v=4';
import * as THREE from 'three';
import {makeCharacter} from './characters.js?v=2';
export const seats=[{id:'echo',variant:4,x:0,z:-.42,yaw:0},{id:'nova',variant:0,x:-.91,z:.12,yaw:.36},{id:'atlas',variant:1,x:.91,z:.12,yaw:-.36}];
const poseEuler=new THREE.Euler(),poseQuaternion=new THREE.Quaternion();
// Small deterministic material maps; no external textures or image downloads.
function surfaceTexture(kind){
  if(typeof document==='undefined')return null;
  const canvas=document.createElement('canvas');canvas.width=canvas.height=256;const c=canvas.getContext('2d');
  c.fillStyle=kind==='wood'?'#a29887':'#bcbcaf';c.fillRect(0,0,256,256);
  let seed=17;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<3500;i++){const alpha=random()*.09;c.fillStyle=`rgba(35,38,29,${alpha})`;const x=random()*256,y=random()*256;c.fillRect(x,y,kind==='wood'?1:random()*2,kind==='wood'?12+random()*70:random()*2);}
  const texture=new THREE.CanvasTexture(canvas);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(kind==='wood'?3:4,4);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}
// Aim in world space, retaining the rig's existing twist. No Mixamo axis assumptions.
export function aimBone(model,bone,child,target){
  model.updateMatrixWorld(true);
  const origin=bone.getWorldPosition(new THREE.Vector3());
  const from=child.getWorldPosition(new THREE.Vector3()).sub(origin).normalize();
  const to=model.localToWorld(target.clone()).sub(origin).normalize();
  const q=new THREE.Quaternion().setFromUnitVectors(from,to).multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
  bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q));
  model.updateMatrixWorld(true);
}
export function seatActor(actor){
  const {model,bones}=actor;const b=name=>bones[name].bone;
  // Foot contacts, bent knees, and forearms supported by the table; targets in model space.
  for(const [side,sign] of [['Left',1],['Right',-1]]){
    aimBone(model,b(side+'UpLeg'),b(side+'Leg'),new THREE.Vector3(sign*.105,.95,.44));
    aimBone(model,b(side+'Leg'),b(side+'Foot'),new THREE.Vector3(sign*.105,.51,.45));
    aimBone(model,b(side+'Foot'),b(side+'ToeBase'),new THREE.Vector3(sign*.105,.46,.60));
    aimBone(model,b(side+'Arm'),b(side+'ForeArm'),new THREE.Vector3(sign*.24,1.29,.244));
    aimBone(model,b(side+'ForeArm'),b(side+'Hand'),new THREE.Vector3(sign*.20,1.285,.49));
    // Flatten palms toward the tabletop by aligning a finger base along the forearm.
    const finger=bones[side+'HandMiddle1']?.bone;
    if(finger){
      aimBone(model,b(side+'Hand'),finger,new THREE.Vector3(sign*.17,1.285,.60));
      // Measured palm pronation: align all four finger rows above the tabletop, not just the middle finger.
      b(side+'Hand').rotateY(sign*.95);
      // Unopposed thumb rests beside the fingers instead of dropping through the table.
      bones[side+'HandThumb1']?.bone.rotateZ(sign*.58);
      b(side+'Arm').rotateZ(sign*.018); // Millimetres of clearance for the forearm's skin envelope.
    }
  }
  for(const entry of Object.values(bones))entry.rest.copy(entry.bone.quaternion);
  model.position.y=-.43;
}
export function createRoom(base,{actorFactory=makeCharacter,cast=seats,practicalPositions=[[-2.35,-.9],[2.35,-.9]]}={}){
  const scene=new THREE.Scene();scene.background=new THREE.Color('#10271f');scene.fog=new THREE.Fog('#10271f',8,18);
  const grain=surfaceTexture('wood'),weave=surfaceTexture('fabric');
  const mats={forest:new THREE.MeshStandardMaterial({color:0x294536,roughness:.96,map:weave}),dark:new THREE.MeshStandardMaterial({color:0x111c17,roughness:.7}),ivory:new THREE.MeshStandardMaterial({color:0xe3dac0,roughness:.72}),sage:new THREE.MeshStandardMaterial({color:0x5d7259,roughness:1,map:weave}),brass:new THREE.MeshStandardMaterial({color:0x9e8d59,metalness:.55,roughness:.45}),wood:new THREE.MeshStandardMaterial({color:0x84715a,roughness:.76,map:grain})};
  function mesh(geo,mat,x,y,z,parent=scene){const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);parent.add(m);return m;}
  function box(w,h,d,mat,x,y,z,parent){return mesh(new THREE.BoxGeometry(w,h,d),mat,x,y,z,parent);}
  function cyl(r,h,mat,x,y,z,parent){return mesh(new THREE.CylinderGeometry(r,r,h,r<.08?16:48),mat,x,y,z,parent);}
  function rounded(w,h,d,r,mat,x,y,z,parent){
    const s=new THREE.Shape(),l=-w/2,b=-h/2;
    s.moveTo(l+r,b);s.lineTo(l+w-r,b);s.quadraticCurveTo(l+w,b,l+w,b+r);s.lineTo(l+w,b+h-r);s.quadraticCurveTo(l+w,b+h,l+w-r,b+h);s.lineTo(l+r,b+h);s.quadraticCurveTo(l,b+h,l,b+h-r);s.lineTo(l,b+r);s.quadraticCurveTo(l,b,l+r,b);
    const geo=new THREE.ExtrudeGeometry(s,{depth:d,bevelEnabled:true,bevelSize:.008,bevelThickness:.008,bevelSegments:2,steps:1,curveSegments:6});geo.translate(0,0,-d/2);return mesh(geo,mat,x,y,z,parent);
  }
  // Soft authored grounding, without shadow-map passes or screen-space effects.
  const contactMaterial=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{opacity:{value:.26}},vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:'varying vec2 vUv;uniform float opacity;void main(){float d=length((vUv-.5)*2.0);gl_FragColor=vec4(.035,.052,.035,(1.0-smoothstep(.08,1.0,d))*opacity);}'});
  function contact(x,y,z,w,d){const m=mesh(new THREE.PlaneGeometry(w,d),contactMaterial,x,y,z);m.rotation.x=-Math.PI/2;return m;}
  box(14,.1,12,mats.forest,0,-.065,0);
  const backdrop=new THREE.Group();backdrop.name='ECHO original backdrop';scene.add(backdrop);
  box(12,5,.15,mats.forest,0,2.1,-2.1,backdrop);
  const slats=new THREE.InstancedMesh(new THREE.BoxGeometry(.038,3.6,.055),mats.wood,49),transform=new THREE.Matrix4();
  for(let i=0;i<49;i++){transform.makeTranslation((i-24)*.15,1.75,-2);slats.setMatrixAt(i,transform);}slats.name='ECHO original slats';scene.add(slats);
  // Deep architectural arch replaces the flat panel and luminous ring.
  const arch=new THREE.Shape();arch.moveTo(-1.48,.1);arch.lineTo(-1.48,1.7);arch.absarc(0,1.7,1.48,Math.PI,0,true);arch.lineTo(1.48,.1);arch.closePath();
  mesh(new THREE.ExtrudeGeometry(arch,{depth:.14,bevelEnabled:true,bevelSize:.035,bevelThickness:.025,bevelSegments:3,steps:1,curveSegments:32}),mats.forest,0,0,-1.94,backdrop);
  for(const x of [-1.62,1.62]){box(.012,2.7,.025,mats.brass,x,1.35,-1.86,backdrop);box(.05,2.7,.06,mats.dark,x+.035,1.35,-1.92,backdrop);}
  const canvas=typeof document!=='undefined'?document.createElement('canvas'):null;
  if(canvas){canvas.width=1024;canvas.height=256;const c=canvas.getContext('2d');c.clearRect(0,0,1024,256);c.fillStyle='#d3dbc5';c.font='500 120px Arial';c.textAlign='center';c.fillText('E C H O',512,145);c.font='22px Arial';c.fillText('T H E   T A B L E',512,205);const tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;mesh(new THREE.PlaneGeometry(1.6,.4),new THREE.MeshBasicMaterial({map:tex,transparent:true,depthWrite:false}),0,1.78,-1.77,backdrop);}
  const rug=cyl(2.35,.012,mats.sage,0,.001,.3);rug.scale.z=.68;
  const rugBorder=cyl(2.39,.006,mats.dark,0,-.002,.3);rugBorder.scale.z=.68;
  contact(0,.012,.57,3.6,2.2);
  const profile=[[0,-.045],[.96,-.045],[.99,-.026],[1,0],[.995,.022],[.98,.04],[.96,.045],[0,.045]].map(p=>new THREE.Vector2(...p));
  const tabletop=mesh(new THREE.LatheGeometry(profile,96),mats.ivory,0,.78,.68);tabletop.scale.set(1.68,1,.76);
  const rim=cyl(1,.025,mats.brass,0,.726,.68);rim.scale.set(1.65,1,.73);
  const pedestal=cyl(.37,.69,mats.wood,0,.35,.68);pedestal.scale.z=.75;
  const actors=[];
  for(const seat of cast){
    const a=actorFactory(base,seat.variant);seatActor(a);a.id=seat.id;a.seat=seat;a.pivot=new THREE.Group();a.pivot.position.set(seat.x,0,seat.z);a.pivot.rotation.y=seat.yaw;a.pivot.add(a.model);scene.add(a.pivot);actors.push(a);
    const chair=new THREE.Group();chair.position.copy(a.pivot.position);chair.rotation.y=seat.yaw;scene.add(chair);
    const cushion=rounded(.53,.51,.10,.10,mats.sage,0,.48,-.04,chair);cushion.rotation.x=-Math.PI/2;
    const back=rounded(.54,.58,.09,.13,mats.sage,0,.77,-.25,chair);back.rotation.x=-.07;
    contact(seat.x,.015,seat.z,.85,.85);
    for(const x of [-.21,.21])for(const z of [-.20,.16])box(.026,.44,.026,mats.brass,x,.23,z,chair);
    for(const x of [-.28,.28]){box(.035,.025,.42,mats.wood,x,.72,-.04,chair);box(.025,.22,.025,mats.brass,x,.60,.12,chair);}
    // Microphone lives beside the hands, below the face line.
    const mic=new THREE.Group();mic.position.set(seat.x*.84,0,seat.z+.52);scene.add(mic);
    cyl(.07,.017,mats.dark,0,.837,0,mic);cyl(.008,.15,mats.brass,0,.91,0,mic);const capsule=mesh(new THREE.CapsuleGeometry(.023,.085,4,10),mats.dark,0,1.01,0,mic);capsule.rotation.x=-.42;
    const cup=cyl(.043,.08,mats.forest,seat.x*.77+.19,.865,seat.z+.65);cyl(.036,.002,mats.dark,cup.position.x,.906,cup.position.z);
    cyl(.065,.006,mats.wood,cup.position.x,.829,cup.position.z);contact(cup.position.x,.827,cup.position.z,.17,.17);
  }
  const notebook=rounded(.20,.27,.012,.009,mats.forest,-.41,.839,.76);notebook.rotation.x=-Math.PI/2;notebook.rotation.z=-.16;
  const pen=cyl(.004,.17,mats.brass,-.26,.836,.77);pen.rotation.x=Math.PI/2;pen.rotation.z=.15;
  // Two architectural practicals anchor the room's depth.
  for(const [x,z] of practicalPositions){cyl(.025,1.6,mats.brass,x,.8,z);const shade=mesh(new THREE.CylinderGeometry(.20,.28,.38,32,1,true),new THREE.MeshStandardMaterial({color:0xe9d6ab,side:THREE.DoubleSide,emissive:0xd5b776,emissiveIntensity:.22}),x,1.65,z);cyl(.22,.025,mats.dark,x,.015,z);}
  scene.add(new THREE.HemisphereLight(0xe8ebd6,0x273327,1.15));
  for(const [color,power,pos]of [[0xffe3bd,3.1,[-2.5,3,2.4]],[0xc8ddca,.75,[2,1.8,2]],[0xdce8bb,2.8,[1,2.8,-1.3]]]){const light=new THREE.DirectionalLight(color,power);light.position.set(...pos);scene.add(light);}
  return {scene,actors};
}
export function cameraFrame(shot,aspect){
  const mobile=aspect<1.15;
  const positions={
    wide:mobile?[.12,1.64,Math.max(3.9,4.4*.82/aspect),0,1.04,.05,36]:[.25,1.52,3.55,0,1.04,.02,38],
    echo:[.18,1.29,.84,-.02,1.16,-.35,32],
    nova:[-.40,1.29,1.19,-.88,1.17,.17,34],
    atlas:[.42,1.28,1.17,.88,1.17,.17,34],
    two:mobile?[-.5,1.35,Math.max(2.55,2.75*.82/aspect),-.46,1.16,-.10,34]:[-.60,1.32,Math.max(1.63,1.63*2.1/aspect),-.47,1.16,-.10,31]
  };
  return positions[shot]||positions.wide;
}

export function resetPerformance(actor){
  for(const entry of Object.values(actor.bones))entry.bone.quaternion.copy(entry.rest);
  for(const {mesh,index}of actor.morphBindings)mesh.morphTargetInfluences[index]=0;
  actor.performanceSampled=false;
}
export function applyPerformance(actor,t,dt,state,reduced){
  if(state.paused&&actor.performanceSampled)return;
  actor.performanceSampled=true;
  const i=seats.findIndex(s=>s.id===actor.id),active=state.speaker===actor.id&&state.speaking;
  const facial=state.expressive?facePerformance(actor.id,t,state,reduced):null;
  const values=facial?{...facial.weights}:{};const phase=(t+i*.91)%(3.7+i*.67);if(!facial)values.eyeBlinkLeft=values.eyeBlinkRight=phase<.14?Math.sin(phase/.14*Math.PI):0;
  if(active){const cue=state.cue;if(cue?.key)values['viseme_'+cue.key]=state.mouthStrength??.78;if(!facial)values.browInnerUp=.10;}
  else if(!facial){values.mouthSmileLeft=.035;values.mouthSmileRight=.035;}
  // Wave 3: brows, cheeks and smiles ease at 11/s so expressions arrive and leave instead of snapping; speech shapes keep 24/s.
  const expressionRate=state.cinematic?11:24;
  for(const {mesh,name,index}of actor.morphBindings)mesh.morphTargetInfluences[index]=facial&&name.startsWith('eyeBlink')?(values[name]||0):!active&&name.startsWith('viseme_')?0:THREE.MathUtils.damp(mesh.morphTargetInfluences[index],values[name]||0,name.startsWith('viseme_')||name.startsWith('eye')?24:expressionRate,dt);
  const speaker=seats.find(s=>s.id===state.speaker);
  const directed=state.directed?conversationGaze(actor,state):null;
  const gaze=speaker&&!active?THREE.MathUtils.clamp(Math.atan2(speaker.x-actor.seat.x,1.7)-actor.seat.yaw,-.43,.43):active?(actor.id==='nova'?.15:actor.id==='atlas'?-.15:0):0;
  function pose(name,x,y,z,speed=7){const b=actor.bones[name];if(!b)return;poseEuler.set(x,y,z);poseQuaternion.setFromEuler(poseEuler).premultiply(b.rest);b.bone.quaternion.slerp(poseQuaternion,1-Math.exp(-speed*dt));}
  const nod=!reduced&&state.reaction===actor.id?Math.sin(Math.min(state.reactionAge,1.1)/1.1*Math.PI*2)*.035:0;
  const body=state.directed?bodyPerformance(actor.id,t,state,reduced):null;
  if(directed)pose('Neck',0,directed.head*.12,0);
  pose('Head',nod+(facial?.nod||0)+(body?.head[0]||0),directed?directed.head*.88:gaze*.78,body?.head[2]||0);
  pose('LeftEye',0,(directed?directed.eyes:gaze*.16)+(facial?.gaze||0),0,18);pose('RightEye',0,(directed?directed.eyes:gaze*.16)+(facial?.gaze||0),0,18);
  if(body){
    // Wave 3: the torso settles slower than the arms, so speaking turns into listening instead of stopping.
    const torso=state.cinematic?4.2:7;
    pose('Spine1',...body.spine,torso);pose('Spine2',...body.chest,torso);
    for(const [side,sign,amount] of [['Left',1,body.left],['Right',-1,body.right]]){
      // Keep the other palm supported. Maximum gesture is ~4 cm above its seated contact.
      pose(side+'Shoulder',0,sign*amount*.006,0,state.cinematic?5:7);
      pose(side+'Arm',0,0,sign*amount*.015);
      pose(side+'ForeArm',-amount*.065,sign*amount*body.open*.035,sign*amount*.07);
      pose(side+'Hand',0,sign*amount*.045,sign*amount*.035);
    }
  }else{
    pose('Spine2',reduced?0:Math.sin(t*1.15+i*2)*.0035,0,0);
    const gesture=active&&!reduced&&state.audioTime>2&&state.audioTime<3.1?Math.sin((state.audioTime-2)/1.1*Math.PI)*.025:0;
    pose('RightArm',0,gesture,gesture*.3);
  }
}
