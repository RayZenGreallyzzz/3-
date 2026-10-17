import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {readFileSync} from 'node:fs';
import {WeaponMotionLibrary,findWeaponAnchor,captureMotionKey,
 sampleWeaponMotion,applyMotionToWeapon,bakeWeaponMotionClips} from '../src/weapon-motion.js';
function rig(){
 const character=new THREE.Group();
 const hips=new THREE.Bone();hips.name='mixamorigHips';hips.position.set(0,1,0);character.add(hips);
 const spine=new THREE.Bone();spine.name='mixamorigSpine2';spine.position.y=.6;hips.add(spine);
 const hand=new THREE.Bone();hand.name='mixamorigRightHand';hand.position.set(.5,0,.2);spine.add(hand);
 const sword=new THREE.Group();sword.name='Sword';hand.add(sword);
 character.updateMatrixWorld(true);
 return {character,hips,spine,hand,sword,bones:[hips,spine,hand]};
}
const close=(a,b,eps=1e-5)=>assert.ok(Math.abs(a-b)<eps,`${a} != ${b}`);
test('existing rig bones provide hand, back, belt points without adding fake sockets',()=>{
 const {bones,hand,spine,hips}=rig();
 assert.strictEqual(findWeaponAnchor(bones,'hand'),hand);
 assert.strictEqual(findWeaponAnchor(bones,'back'),spine);
 assert.strictEqual(findWeaponAnchor(bones,'waist'),hips);
 assert.strictEqual(findWeaponAnchor(bones,'selected',spine),spine);
 assert.strictEqual(findWeaponAnchor(bones,'tail'),null);
});
test('one clip stores spine at start and hand at end; preview follows moving body bones',()=>{
 const {character,spine,hand,sword,bones}=rig();
 const keys=new WeaponMotionLibrary();
 // The sword hovers at the spine in idle/start frame.
 const backPos=spine.getWorldPosition(new THREE.Vector3());
 sword.position.copy(hand.worldToLocal(backPos.clone()));
 character.updateMatrixWorld(true);
 assert.equal(keys.put(0,captureMotionKey(sword,spine,0)),true);
 // At the last frame, sword should be held at hand origin.
 sword.position.set(0,0,0);character.updateMatrixWorld(true);
 assert.equal(keys.put(0,captureMotionKey(sword,hand,1)),true);
 assert.deepEqual(keys.keys(0).map(k=>k.bone),['mixamorigSpine2','mixamorigRightHand']);
 const bodyName=new Map(bones.map(b=>[b.name,b]));
 const pose0=sampleWeaponMotion(keys.keys(0),0,name=>bodyName.get(name));
 close(pose0.position.distanceTo(backPos),0);
 hand.position.x=.9;character.updateMatrixWorld(true);
 const pose1=sampleWeaponMotion(keys.keys(0),1,name=>bodyName.get(name));
 close(pose1.position.distanceTo(hand.getWorldPosition(new THREE.Vector3())),0);
 assert.equal(applyMotionToWeapon(sword,pose1),true);
 close(sword.getWorldPosition(new THREE.Vector3()).distanceTo(hand.getWorldPosition(new THREE.Vector3())),0);
});
test('export bakes world-space back-to-hand into weapon-local tracks with animated hand',()=>{
 const {character,spine,hand,sword}=rig();
 const library=new WeaponMotionLibrary();
 const backPos=spine.getWorldPosition(new THREE.Vector3());
 sword.position.copy(hand.worldToLocal(backPos));character.updateWorldMatrix(true,true);
 library.put(0,captureMotionKey(sword,spine,0));
 sword.position.set(0,0,0);character.updateWorldMatrix(true,true);
 library.put(0,captureMotionKey(sword,hand,1));
 // Moving wrist means back keys must cancel hand motion in local TRS,
 // while hand keys should stay at origin.
 const anim=new THREE.AnimationClip('DrawWeapon',1,[
  new THREE.VectorKeyframeTrack(hand.uuid+'.position',[0,1],[.5,0,.2,1,0,.2])
 ]);
 const original=sword.position.clone();
 const baked=bakeWeaponMotionClips([anim],sword,character,library,{fps:20});
 assert.equal(baked.modified,1);
 assert.deepEqual(baked.missing,[]);
 assert.equal(baked.clips[0].tracks.length,4);
 const weaponPos=baked.clips[0].tracks.find(t=>t.name===sword.uuid+'.position');
 assert.equal(weaponPos.times.length,21);
 close(weaponPos.values[20*3+0],0);close(weaponPos.values[20*3+1],0);close(weaponPos.values[20*3+2],0);
 assert.ok(Number.isFinite(weaponPos.values[9]));
 close(sword.position.distanceTo(original),0);
 assert.equal(anim.tracks.length,1,'original clip must not be mutated');
});
test('other clips remain unchanged when the action has no keyed weapon movement',()=>{
 const {character,spine,hand,sword}=rig();
 const library=new WeaponMotionLibrary();
 library.put(1,captureMotionKey(sword,hand,0));
 const idle=new THREE.AnimationClip('Idle',1,[]);
 const draw=new THREE.AnimationClip('Draw',1,[]);
 const baked=bakeWeaponMotionClips([idle,draw],sword,character,library);
 assert.strictEqual(baked.clips[0],idle);
 assert.equal(baked.modified,1);
});
test('metadata reimport restores separate timed bone keys per action',()=>{
 const {bones,spine,hand,sword}=rig();
 const lib=new WeaponMotionLibrary();
 lib.put(2,captureMotionKey(sword,spine,.1));
 lib.put(2,captureMotionKey(sword,hand,.9));
 const recovered=new WeaponMotionLibrary();recovered.load(JSON.parse(JSON.stringify(lib.toJSON())),bones);
 assert.equal(recovered.keys(2).length,2);
 assert.equal(recovered.has(0),false);
 assert.equal(recovered.keys(2)[1].bone,hand.name);
 recovered.delete(2,.1);
 assert.equal(recovered.keys(2).length,1);
});
test('Android app has real clip-aware capture, preview and GLB bake UI',()=>{
 const html=readFileSync('index.html','utf8');
 const source=readFileSync('src/main.js','utf8');
 assert.ok(html.includes('id="weapon-motion-record"'));
 assert.ok(html.includes('id="weapon-motion-place"'));
 assert.ok(html.includes('id="weapon-motion-keys"'));
 assert.ok(source.includes('weaponMotionEditor.preview()'));
 assert.ok(source.includes('bakeWeaponMotionClips('));
 assert.ok(source.includes('rigWeaponStudioMotionKeys=weaponMotionEditor.toJSON()'));
});
