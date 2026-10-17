import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {readFileSync} from 'node:fs';
import {WeaponAnimationProfiles,captureWeaponLocal,applyWeaponLocal,bakeWeaponAnimationClips} from '../src/weapon-profiles.js';
import {bakePoseClipsByIndex,cloneArmOffsets,deltaQuaternion} from '../src/arm-pose.js';
const qnear=(a,b)=>Math.abs(a.dot(b))>1-1e-7;
function character(){
 const root=new THREE.Group(),hand=new THREE.Bone();
 hand.name='mixamorigRightHand';root.add(hand);
 const weapon=new THREE.Group();weapon.name='Sword';hand.add(weapon);
 return {root,hand,weapon};
}
const pose=(w,p,r)=>{w.position.set(...p);w.quaternion.setFromEuler(new THREE.Euler(...r));};
const find=(clip,suffix)=>clip.tracks.find(t=>t.name.endsWith(suffix));
const values=track=>Array.from(track.values.slice(0,track.getValueSize()));
test('Idle, Run, Attack keep THREE independent stored weapon placements',()=>{
 const {weapon}=character(),p=new WeaponAnimationProfiles();p.attach(weapon);
 pose(weapon,[.10,.20,.30],[0,0,0]);assert.equal(p.save(0,weapon),true);
 pose(weapon,[.5,.6,.7],[0,.2,.3]);assert.equal(p.save(1,weapon),true);
 pose(weapon,[-.35,.2,.1],[.4,0,.1]);assert.equal(p.save(2,weapon),true);
 p.apply(0,weapon);assert.deepEqual(weapon.position.toArray(),[.1,.2,.3]);
 p.apply(2,weapon);assert.deepEqual(weapon.position.toArray(),[-.35,.2,.1]);
 p.apply(1,weapon);assert.deepEqual(weapon.position.toArray(),[.5,.6,.7]);
 assert.equal(p.size,3);
});
test('per-animation weapon transforms are encoded as separate GLB animation tracks',()=>{
 const {weapon}=character(),p=new WeaponAnimationProfiles();p.attach(weapon);
 pose(weapon,[.1,.2,.3],[.2,0,0]);p.save(0,weapon);
 pose(weapon,[-.9,.7,.4],[0,.5,0]);p.save(1,weapon);
 const clips=['Idle','Attack'].map(n=>new THREE.AnimationClip(n,1,[]));
 const result=bakeWeaponAnimationClips(clips,weapon,p);
 assert.equal(result.modified,2);
 assert.equal(result.clips.length,2);
 assert.deepEqual(values(find(result.clips[0],'.position')),[.1,.2,.3].map(Math.fround));
 assert.deepEqual(values(find(result.clips[1],'.position')),[-.9,.7,.4].map(Math.fround));
 assert.equal(find(result.clips[0],'.quaternion').times.length,2);
 assert.equal(find(result.clips[1],'.scale').values.length,6);
 assert.ok(clips.every(x=>x.tracks.length===0),'original source clips are untouched');
});
test('missing grip preset uses base position rather than previous animation',()=>{
 const {weapon}=character(),p=new WeaponAnimationProfiles();p.attach(weapon);
 pose(weapon,[1,2,3],[0,0,0]);p.save(0,weapon);
 pose(weapon,[2,3,4],[0,0,0]);p.apply(1,weapon);
 assert.deepEqual(weapon.position.toArray(),[0,0,0]);
 const clips=['Attack','Idle'].map(n=>new THREE.AnimationClip(n,1,[]));
 const baked=bakeWeaponAnimationClips(clips,weapon,p).clips;
 assert.deepEqual(values(find(baked[1],'.position')),[0,0,0]);
});
test('reloading composed GLB metadata restores separate weapon placements',()=>{
 const {weapon}=character(),p=new WeaponAnimationProfiles();p.attach(weapon);
 pose(weapon,[.21,.43,-.25],[.32,.12,0]);p.save(0,weapon);
 pose(weapon,[-.35,-.1,.8],[0,.9,0]);p.save(1,weapon);
 const metadata=p.toJSON();
 const next=new WeaponAnimationProfiles();next.load(weapon,metadata);
 next.apply(0,weapon);assert.deepEqual(weapon.position.toArray(),[.21,.43,-.25]);
 next.apply(1,weapon);assert.deepEqual(weapon.position.toArray(),[-.35,-.1,.8]);
 assert.equal(next.size,2);
});
test('a new parent attachment invalidates all old per-bone placements',()=>{
 const {root,hand,weapon}=character(),p=new WeaponAnimationProfiles();p.attach(weapon);
 pose(weapon,[.1,.2,.3],[0,0,0]);p.save(0,weapon);
 const other=new THREE.Bone();other.name='mixamorigLeftHand';root.add(other);
 other.attach(weapon);
 p.attach(weapon);
 assert.equal(p.size,0);
 assert.equal(p.get(1).parentBone,'mixamorigLeftHand');
});
test('arm fixes apply only to selected clip, not globally to all clips',()=>{
 const arm=new THREE.Bone();arm.name='mixamorigRightArm';
 const track=new THREE.QuaternionKeyframeTrack(arm.name+'.quaternion',[0,1],[0,0,0,1,0,0,0,1]);
 const clips=['Idle','Attack'].map(n=>new THREE.AnimationClip(n,1,[track.clone()]));
 const correction=new Map([[1,new Map([[arm,{x:0,y:30,z:0}]])]]);
 const baked=bakePoseClipsByIndex(clips,correction).clips;
 assert.strictEqual(baked[0],clips[0]);
 assert.ok(qnear(new THREE.Quaternion().fromArray(baked[0].tracks[0].values),new THREE.Quaternion()));
 assert.ok(qnear(new THREE.Quaternion().fromArray(baked[1].tracks[0].values),deltaQuaternion({x:0,y:30,z:0})));
 const snapshot=cloneArmOffsets(correction.get(1));
 snapshot.get(arm).y=5;
 assert.equal(correction.get(1).get(arm).y,30);
});
test('the app saves weapon before clip switch, playback and export; explicit button exists',()=>{
 const main=readFileSync('src/main.js','utf8');
 const html=readFileSync('index.html','utf8');
 assert.ok(html.includes('id="save-weapon-clip"'));
 assert.ok(html.includes('id="reset-weapon-clip"'));
 assert.ok(main.includes('if(weaponDirty)commitWeapon();rememberArms();'));
 assert.ok(main.includes('weaponProfiles.apply(index,state.weapon)'));
 assert.ok(main.includes('bakeWeaponAnimationClips(processed.clips,exportWeapon,weaponProfiles)'));
 assert.ok(main.includes('rigWeaponStudioWeaponProfiles=weaponProfiles.toJSON()'));
});
