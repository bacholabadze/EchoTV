// Wave 3 optional cinematic opening. Visual pre-roll only: it runs before the adapter starts the
// dialogue clock, so no caption, cue or turn timing moves. Lights are scaled and restored, never replaced.
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v)),smooth=x=>{x=clamp(x,0,1);return x*x*(3-2*x);};
export const OPENING_DURATION=6.5;
export function openingCamera(frame,u){
 const start=[frame[0]+1.15,frame[1]+1.0,frame[2]+2.7],look0=[frame[3]+.25,frame[4]+.30,frame[5]];
 const m=smooth(u);
 return {position:[0,1,2].map(i=>start[i]+(frame[i]-start[i])*m),target:[0,1,2].map(i=>look0[i]+(frame[3+i]-look0[i])*m),fov:(frame[6]-4)+4*m};
}
export function openingLight(age,reduced=false){return reduced?1:.12+.88*smooth(age/3.6);}
export function openingTitle(age){return age<1.2?0:age<2.2?smooth((age-1.2)/1):age<5.2?1:1-smooth((age-5.2)/1);}
export function createOpening({scene,camera,frame,stage,reduced=false}){
 const lights=[];scene.traverse(o=>{if(o.isLight)lights.push({light:o,intensity:o.intensity});});
 const title=typeof document!=='undefined'?document.createElement('div'):null;
 if(title){title.className='opening-title';title.setAttribute('aria-hidden','true');const mark=document.createElement('span');mark.className='opening-mark';mark.textContent='ECHO';const sub=document.createElement('span');sub.className='opening-sub';sub.textContent='THE TABLE · ROOM FOR DOUBT';title.append(mark,sub);title.style.opacity='0';stage?.append(title);}
 let age=0,done=false;
 function restore(){for(const {light,intensity} of lights)light.intensity=intensity;title?.remove();}
 function update(dt){
  if(done)return true;
  age+=Math.min(dt,.08);
  const scale=openingLight(age,reduced);for(const {light,intensity} of lights)light.intensity=intensity*scale;
  const c=openingCamera(frame,reduced?1:age/OPENING_DURATION);
  camera.position.set(...c.position);camera.fov=c.fov;camera.lookAt(...c.target);camera.updateProjectionMatrix();
  if(title)title.style.opacity=openingTitle(age).toFixed(3);
  if(age>=OPENING_DURATION){done=true;restore();}
  return done;
 }
 return {update,cancel(){if(!done){done=true;restore();}},get done(){return done;},get age(){return age;}};
}
