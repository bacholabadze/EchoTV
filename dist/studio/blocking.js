// Edition 05: inward seating and stable conversation eyelines.
export const conversationSeats=[
 {id:'echo',variant:4,x:0,z:-.42,yaw:0},
 {id:'nova',variant:0,x:-1.21,z:.04,yaw:1.12},
 {id:'atlas',variant:1,x:1.21,z:.04,yaw:-1.12}
];
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
export function attentionTarget(id,state){
 if(state.speaker!==id)return state.speaker;
 let target=id==='echo'?'audience':'echo';
 for(const cue of state.attention||[])if(state.audioTime>=cue.at)target=cue.target;
 return target;
}
export function conversationGaze(actor,state){
 const target=attentionTarget(actor.id,state);
 const seat=conversationSeats.find(s=>s.id===target);
 const point=seat?{x:seat.x+Math.sin(seat.yaw)*.13,z:seat.z+Math.cos(seat.yaw)*.13}:{x:0,z:3.2};
 const origin={x:actor.seat.x+Math.sin(actor.seat.yaw)*.13,z:actor.seat.z+Math.cos(actor.seat.yaw)*.13};
 const angle=wrap(Math.atan2(point.x-origin.x,point.z-origin.z)-actor.seat.yaw);
 const head=clamp(angle*.73,-.80,.80),eyes=clamp(angle-head,-.32,.32);
 return {head,eyes,target,angle};
}
export function conversationFrame(shot,aspect){
 const portrait=aspect<1.15;
 const frames={
 wide:portrait?[0,1.65,Math.max(4.8,5.6*.82/aspect),0,1.22,-.20,36]:[.16,1.58,4.65,0,1.28,-.22,35],
 echo:[.12,1.30,.64,-.02,1.20,-.30,30],
 nova:[-.28,1.31,.78,-1.11,1.20,.09,30],
 atlas:[.28,1.31,.78,1.11,1.20,.09,30],
 two:portrait?[-.35,1.48,Math.max(3.8,4.4*.82/aspect),-.35,1.32,-.10,34]:[-.61,1.30,2.4,-.61,.88,-.10,33],
 'two-atlas':portrait?[.35,1.48,Math.max(3.8,4.4*.82/aspect),.35,1.32,-.10,34]:[.61,1.30,2.4,.61,.88,-.10,33]
 };
 return frames[shot]||frames.wide;
}

export const conversationPracticals=[[-2,-1.4],[2,-1.4]];
