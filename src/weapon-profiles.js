import * as THREE from 'three';

// Each animation has its own stationary grip transform relative to a common
// weapon/socket bone. The exported clips receive independent GLTF channels;
// a single shared node transform is not enough for Idle/Run/Attack.
export function captureWeaponLocal(weapon){
 if(!weapon?.isObject3D)return null;
 return {
  position:weapon.position.toArray(),
  quaternion:weapon.quaternion.toArray(),
  scale:weapon.scale.toArray(),
  parentBone:weapon.parent?.isBone?weapon.parent.name:null
 };
}
export function applyWeaponLocal(weapon,pose){
 if(!weapon?.isObject3D||!pose)return false;
 if(pose.parentBone!==(weapon.parent?.isBone?weapon.parent.name:null))return false;
 for(const key of ['position','quaternion','scale']){
  const a=pose[key],len=key==='quaternion'?4:3;
  if(!Array.isArray(a)||a.length!==len||!a.every(Number.isFinite))return false;
 }
 weapon.position.fromArray(pose.position);
 weapon.quaternion.fromArray(pose.quaternion).normalize();
 weapon.scale.fromArray(pose.scale);
 weapon.updateMatrixWorld(true);
 return true;
}
const clonePose=p=>p?{
 position:[...p.position],quaternion:[...p.quaternion],scale:[...p.scale],
 parentBone:p.parentBone
}:null;
export class WeaponAnimationProfiles {
 constructor(){this.base=null;this.slots=new Map();}
 clear(){this.base=null;this.slots.clear();}
 attach(weapon){this.base=captureWeaponLocal(weapon);this.slots.clear();}
 load(weapon,metadata){
  this.clear();
  if(metadata?.schema==='rig-weapon-studio/weapon-profiles-v1'&&Array.isArray(metadata.slots)){
   this.base=clonePose(metadata.base)||captureWeaponLocal(weapon);
   for(const [i,p] of metadata.slots){
    if(Number.isInteger(i)&&i>=0&&i<10000&&p?.parentBone===this.base?.parentBone)
     this.slots.set(i,clonePose(p));
   }
  }else this.base=captureWeaponLocal(weapon);
 }
 save(index,weapon){
  if(!Number.isInteger(index)||index<0||!weapon?.parent?.isBone)return false;
  const p=captureWeaponLocal(weapon);
  if(!this.base||p.parentBone!==this.base.parentBone)return false;
  this.slots.set(index,p);
  return true;
 }
 has(index){return this.slots.has(index);}
 get(index){return clonePose(this.slots.get(index)||this.base);}
 apply(index,weapon){return applyWeaponLocal(weapon,this.get(index));}
 reset(index,weapon){
  this.slots.delete(index);
  return this.apply(index,weapon);
 }
 toJSON(){return {
  schema:'rig-weapon-studio/weapon-profiles-v1',
  base:clonePose(this.base),
  slots:[...this.slots].map(([i,p])=>[i,clonePose(p)])
 };}
 get size(){return this.slots.size;}
}

// Convert local weapon placements into actual per-animation GLB tracks.
// Skipped if weapon has no bone parent (world placement is not portable).
export function bakeWeaponAnimationClips(clips,weapon,profiles){
 if(!weapon?.parent?.isBone||!profiles?.base)return {clips,modified:0};
 let count=0;
 const boundId=weapon.uuid;
 const boundName=weapon.name;
 const output=clips.map((clip,index)=>{
  const p=profiles.get(index);
  if(!p||p.parentBone!==weapon.parent.name)return clip;
  // All clips need explicit tracks: otherwise the prior clip's weapon
  // offsets can bleed into the next one in Godot / GLTF playback.
  const old=clip.tracks.filter(t=>{
   let parsed;
   try{parsed=THREE.PropertyBinding.parseTrackName(t.name);}catch{return true;}
   const hit=parsed.nodeName===boundId||parsed.nodeName===boundName;
   return !(hit&&['position','quaternion','scale'].includes(parsed.propertyName));
  }).map(t=>t.clone());
  const duration=Math.max(.001,clip.duration||0.001);
  const times=[0,duration];
  const append=(values)=>[...values,...values];
  const tracks=[
   new THREE.VectorKeyframeTrack(boundId+'.position',times,append(p.position)),
   new THREE.QuaternionKeyframeTrack(boundId+'.quaternion',times,append(p.quaternion)),
   new THREE.VectorKeyframeTrack(boundId+'.scale',times,append(p.scale))
  ];
  count++;
  const saved=clip.clone();
  saved.tracks=[...old,...tracks];
  return saved;
 });
 return {clips:output,modified:count};
}
