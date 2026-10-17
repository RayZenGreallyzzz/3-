import * as THREE from 'three';

// One GLB node always has exactly one parent. Switching between character
// hand, spine and hips must therefore be *baked* into that node's local TRS
// tracks. These keys store transforms in the chosen SOURCE bone's local space.
const SCHEMA='rig-weapon-studio/weapon-motion-v1';
const finite=a=>Array.isArray(a)&&a.every(Number.isFinite);
const copy=k=>({time:k.time,bone:k.bone,position:[...k.position],
 quaternion:[...k.quaternion],scale:[...k.scale]});
const isKey=k=>Boolean(k&&Number.isFinite(k.time)&&k.time>=0&&typeof k.bone==='string'&&k.bone.length&&
 finite(k.position)&&k.position.length===3&&finite(k.quaternion)&&k.quaternion.length===4&&
 finite(k.scale)&&k.scale.length===3&&k.scale.every(v=>v>0));
const nameMatch=(bone,term)=>bone.name.toLowerCase().replace(/[^a-z0-9]/g,'').includes(term);
export function findWeaponAnchor(bones,kind,selected){
 const all=(bones||[]).filter(b=>b?.isBone);
 if(kind==='selected')return selected?.isBone?selected:null;
 const candidates=kind==='hand'
   ? ['righthand','rightwrist','lefthand','leftwrist','hand','wrist']
   :kind==='back'
     ? ['spine2','spine1','chest','upperchest','spine']
     :kind==='waist'
       ? ['hips','pelvis','root']
       :[];
 for(const part of candidates){const found=all.find(b=>nameMatch(b,part));if(found)return found;}
 return null;
}
export function captureMotionKey(weapon,bone,time){
 if(!weapon?.isObject3D||!bone?.isBone||!Number.isFinite(time)||time<0)return null;
 weapon.updateWorldMatrix(true,false);bone.updateWorldMatrix(true,false);
 const local=new THREE.Matrix4().copy(bone.matrixWorld).invert().multiply(weapon.matrixWorld);
 const position=new THREE.Vector3(),q=new THREE.Quaternion(),scale=new THREE.Vector3();
 local.decompose(position,q,scale);
 const key={time,bone:bone.name,position:position.toArray(),
  quaternion:q.normalize().toArray(),scale:scale.toArray()};
 return isKey(key)?key:null;
}
export class WeaponMotionLibrary{
 constructor(){this.byClip=new Map();}
 clear(){this.byClip.clear();}
 keys(index){return (this.byClip.get(index)||[]).map(copy);}
 has(index){return (this.byClip.get(index)?.length||0)>0;}
 put(index,key){
  if(!Number.isInteger(index)||index<0||!isKey(key))return false;
  const list=this.keys(index).filter(k=>Math.abs(k.time-key.time)>1e-4);
  list.push(copy(key));list.sort((a,b)=>a.time-b.time);
  if(list.length>160)throw Error('Максимум 160 ключей крепления на анимацию');
  this.byClip.set(index,list);return true;
 }
 delete(index,time){
  const list=this.keys(index),left=list.filter(k=>Math.abs(k.time-time)>1e-4);
  if(left.length===list.length)return false;
  if(left.length)this.byClip.set(index,left);else this.byClip.delete(index);
  return true;
 }
 load(data,bones){
  this.clear();
  if(data?.schema!==SCHEMA||!Array.isArray(data.clips))return;
  const available=new Set((bones||[]).filter(b=>b.isBone).map(b=>b.name));
  for(const [i,list] of data.clips){
   if(!Number.isInteger(i)||i<0||i>9999||!Array.isArray(list))continue;
   for(const k of list.slice(0,160))
    if(isKey(k)&&available.has(k.bone))this.put(i,k);
  }
 }
 toJSON(){return {schema:SCHEMA,
  clips:[...this.byClip].map(([i,keys])=>[i,keys.map(copy)])};}
}
function worldAtKey(key,resolveBone){
 const bone=resolveBone(key.bone);if(!bone?.isBone)return null;
 bone.updateWorldMatrix(true,false);
 const local=new THREE.Matrix4().compose(
  new THREE.Vector3(...key.position),new THREE.Quaternion(...key.quaternion),
  new THREE.Vector3(...key.scale));
 const world=new THREE.Matrix4().multiplyMatrices(bone.matrixWorld,local);
 const position=new THREE.Vector3(),quaternion=new THREE.Quaternion(),scale=new THREE.Vector3();
 world.decompose(position,quaternion,scale);
 return {position,quaternion,scale};
}
export function sampleWeaponMotion(keys,time,resolveBone){
 if(!keys?.length)return null;
 const t=Math.max(0,time||0);
 let left=keys[0],right=keys[keys.length-1];
 if(t<=keys[0].time){left=right=keys[0];}
 else if(t>=right.time){left=right;}
 else for(let i=0;i<keys.length-1;i++){
  if(keys[i].time<=t&&t<=keys[i+1].time){left=keys[i];right=keys[i+1];break;}
 }
 const a=worldAtKey(left,resolveBone);if(!a)return null;
 if(left===right)return a;
 const b=worldAtKey(right,resolveBone);if(!b)return null;
 const alpha=THREE.MathUtils.clamp((t-left.time)/(right.time-left.time),0,1);
 return {
  position:a.position.lerp(b.position,alpha),
  quaternion:a.quaternion.slerp(b.quaternion,alpha),
  scale:a.scale.lerp(b.scale,alpha)
 };
}
export function applyMotionToWeapon(weapon,worldPose){
 if(!weapon?.isObject3D||!worldPose)return false;
 const parent=weapon.parent;
 if(!parent)return false;
 parent.updateWorldMatrix(true,false);
 const mat=new THREE.Matrix4().compose(worldPose.position,worldPose.quaternion,worldPose.scale);
 const local=new THREE.Matrix4().copy(parent.matrixWorld).invert().multiply(mat);
 local.decompose(weapon.position,weapon.quaternion,weapon.scale);
 weapon.quaternion.normalize();weapon.updateMatrixWorld(true);
 return true;
}
function isWeaponTrack(track,weapon){
 try{
  const binding=THREE.PropertyBinding.parseTrackName(track.name);
  return (binding.nodeName===weapon.uuid||binding.nodeName===weapon.name)&&
   ['position','quaternion','scale'].includes(binding.propertyName);
 }catch{return false;}
}
// Bake dynamic attachment as regular GLB TRS samples in one fixed parent.
// Only clips with motion keys need per-frame sampling and mixer work.
export function bakeWeaponMotionClips(clips,weapon,character,motion,{fps=30,maxSamples=600}={}){
 if(!weapon?.parent?.isBone||!character||!motion?.byClip?.size)
  return {clips,modified:0,missing:[]};
 const bones=[];
 character.traverse(o=>{if(o.isBone)bones.push(o);});
 const lookup=new Map(bones.map(b=>[b.name,b]));
 const saved=character.children.length?new Map():new Map();
 character.traverse(o=>{if(o.isObject3D)saved.set(o,{position:o.position.clone(),quaternion:o.quaternion.clone(),scale:o.scale.clone()});});
 const out=[],missing=[];let modified=0;
 const restore=()=>{
  for(const [o,p] of saved){o.position.copy(p.position);o.quaternion.copy(p.quaternion);o.scale.copy(p.scale);}
  character.updateMatrixWorld(true);
 };
 try{
  for(let index=0;index<clips.length;index++){
   const clip=clips[index],keys=motion.keys(index);
   if(!keys.length){out.push(clip);continue;}
   if(keys.some(k=>!lookup.has(k.bone))){
    missing.push(clip.name);out.push(clip);continue;
   }
   restore();
   const mixer=new THREE.AnimationMixer(character);
   const action=mixer.clipAction(clip);action.reset().play();
   action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;
   const duration=Math.max(.001,clip.duration||.001);
   const n=Math.min(maxSamples,Math.max(2,Math.ceil(duration*fps)+1));
   const ts=[],p=[],q=[],s=[];
   for(let k=0;k<n;k++){
    const t=duration*k/(n-1);
    mixer.setTime(t);character.updateMatrixWorld(true);
    const world=sampleWeaponMotion(keys,t,name=>lookup.get(name));
    if(!world)throw Error('Не удалось вычислить точку крепления в '+clip.name);
    const parent=weapon.parent;
    parent.updateWorldMatrix(true,false);
    const wm=new THREE.Matrix4().compose(world.position,world.quaternion,world.scale);
    const lm=new THREE.Matrix4().copy(parent.matrixWorld).invert().multiply(wm);
    const lp=new THREE.Vector3(),lq=new THREE.Quaternion(),ls=new THREE.Vector3();
    lm.decompose(lp,lq,ls);
    ts.push(t);lp.toArray(p,p.length);lq.normalize().toArray(q,q.length);ls.toArray(s,s.length);
   }
   const replacement=clip.clone();
   replacement.tracks=[
    ...clip.tracks.filter(track=>!isWeaponTrack(track,weapon)).map(t=>t.clone()),
    new THREE.VectorKeyframeTrack(weapon.uuid+'.position',ts,p),
    new THREE.QuaternionKeyframeTrack(weapon.uuid+'.quaternion',ts,q),
    new THREE.VectorKeyframeTrack(weapon.uuid+'.scale',ts,s)
   ];
   out.push(replacement);modified++;
   action.stop();mixer.uncacheRoot(character);
  }
 }finally{restore();}
 return {clips:out,modified,missing};
}
