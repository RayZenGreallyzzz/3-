import * as THREE from 'three';
import {WeaponMotionLibrary,findWeaponAnchor,captureMotionKey,
 sampleWeaponMotion,applyMotionToWeapon} from './weapon-motion.js';

// UI for existing rig bones; no fabricated sockets or bone reparenting.
// Accept functions so this editor does not depend on the application's state.
export class WeaponMotionEditor{
 constructor({getWeapon,getBones,getSelectedBone,getClipIndex,getTime,setTime,
  getClipName,isExporting,isDirty,markDirty,clearDirty,refresh,notify}){
  Object.assign(this,{getWeapon,getBones,getSelectedBone,getClipIndex,getTime,setTime,
    getClipName,isExporting,isDirty,markDirty,clearDirty,refresh,notify});
  this.library=new WeaponMotionLibrary();
  this.anchorSelect=document.getElementById('weapon-motion-anchor');
  this.list=document.getElementById('weapon-motion-keys');
  this.hint=document.getElementById('weapon-motion-anchor-name');
  this.place=document.getElementById('weapon-motion-place');
  this.recordButton=document.getElementById('weapon-motion-record');
  this.anchorSelect.addEventListener('change',()=>this.render());
  this.place.addEventListener('click',()=>this.align());
  this.recordButton.addEventListener('click',()=>this.record());
  this.render();
 }
 reset(){this.library.clear();this.render();}
 load(data){this.library.load(data,this.getBones());this.render();}
 toJSON(){return this.library.toJSON();}
 anchor(){return findWeaponAnchor(this.getBones(),this.anchorSelect.value,this.getSelectedBone());}
 ready(){return Boolean(this.getWeapon()?.parent?.isBone && this.getClipIndex()>=0);}
 render(){
  const index=this.getClipIndex(),anchor=this.anchor(),ready=this.ready();
  this.place.disabled=!ready||!anchor||this.isExporting();
  this.recordButton.disabled=!ready||!anchor||this.isExporting();
  this.hint.textContent=anchor?'Используется кость: '+anchor.name:
    'Нет такой кости: выбери другую точку или кость из списка.';
  this.list.replaceChildren();
  const keys=this.library.keys(index);
  if(!keys.length){
   this.list.textContent='Ключей нет. Для неподвижного хвата используй «Запомнить положение».';
   return;
  }
  for(const key of keys){
   const row=document.createElement('div');row.className='weapon-motion-key-row';
   const jump=document.createElement('button');jump.type='button';
   jump.className='btn subtle';jump.textContent=key.time.toFixed(2)+'с · '+key.bone;
   jump.addEventListener('click',()=>this.setTime(key.time));
   const remove=document.createElement('button');remove.type='button';
   remove.className='btn subtle';remove.textContent='×';remove.title='Удалить этот ключ';
   remove.addEventListener('click',()=>{
    this.library.delete(index,key.time);
    this.clearDirty();this.preview();this.render();
    this.notify('Ключ удалён');
   });
   row.append(jump,remove);this.list.append(row);
  }
 }
 preview(){
  const weapon=this.getWeapon(),index=this.getClipIndex();
  if(!this.ready()||!this.library.has(index)||this.isDirty())return false;
  const bones=this.getBones();
  const world=sampleWeaponMotion(this.library.keys(index),this.getTime(),
    name=>bones.find(b=>b.name===name));
  return Boolean(world&&applyMotionToWeapon(weapon,world));
 }
 align(){
  const bone=this.anchor(),weapon=this.getWeapon();
  if(!bone||!this.ready())return;
  bone.updateWorldMatrix(true,false);
  const position=new THREE.Vector3(),quaternion=new THREE.Quaternion(),scale=new THREE.Vector3();
  bone.matrixWorld.decompose(position,quaternion,scale);
  scale.copy(weapon.getWorldScale(new THREE.Vector3()));
  if(applyMotionToWeapon(weapon,{position,quaternion,scale})){
   this.markDirty();this.refresh();
   this.notify('Оружие возле '+bone.name+'. Поправь положение и запиши ключ.');
  }
 }
 record(){
  const weapon=this.getWeapon(),bone=this.anchor(),index=this.getClipIndex();
  if(!this.ready()||!bone)return this.notify('Сначала выбери анимацию и кость крепления.');
  const time=Math.max(0,this.getTime());
  const key=captureMotionKey(weapon,bone,time);
  if(!key)return this.notify('Ошибка записи положения относительно кости');
  this.library.put(index,key);
  this.clearDirty();this.render();this.refresh();
  this.notify('✓ Записан ключ на '+time.toFixed(2)+'с относительно '+bone.name);
 }
}
