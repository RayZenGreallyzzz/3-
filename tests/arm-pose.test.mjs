import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ArmPoseController, identifyArmBone, resolveArmBones, bakePoseClips, deltaQuaternion } from '../src/arm-pose.js';

const nearQuat = (a,b,eps=0.0001) => Math.abs(a.dot(b)) > 1-eps;

test('mixamo bones are recognized and fingers or legs excluded', () => {
  const names = ['mixamorigRightArm','mixamorigRightForeArm','mixamorigRightHand',
    'mixamorigLeftShoulder','mixamorigLeftHand','mixamorigRightHandIndex1','mixamorigRightLeg'];
  const bones = names.map(n => { const b=new THREE.Bone(); b.name=n; return b; });
  const rig = resolveArmBones(bones);
  assert.equal(rig.right.upper,bones[0]);
  assert.equal(rig.right.forearm,bones[1]);
  assert.equal(rig.right.hand,bones[2]);
  assert.equal(rig.left.clavicle,bones[3]);
  assert.equal(rig.left.hand,bones[4]);
  assert.equal(identifyArmBone(bones[5]),null);
  assert.equal(identifyArmBone(bones[6]),null);
});

test('overlay applies without accumulating and reset restores baseline', () => {
  const bone = new THREE.Bone(); bone.name='mixamorigRightArm';
  const pose = new ArmPoseController();
  const baseline = bone.quaternion.clone();
  pose.set(bone,{x:30,y:0,z:0});
  const once = bone.quaternion.clone();
  pose.apply();
  assert.ok(nearQuat(bone.quaternion,once));
  pose.restore();
  assert.ok(nearQuat(bone.quaternion,baseline));
  const animated = new THREE.Quaternion().setFromEuler(new THREE.Euler(0,.4,0));
  bone.quaternion.copy(animated);
  pose.apply();
  assert.ok(nearQuat(bone.quaternion,animated.clone().multiply(deltaQuaternion({x:30,y:0,z:0}))));
  pose.clearAll();
  assert.ok(nearQuat(bone.quaternion,animated));
});

test('export bakes quaternion motion without changing original tracks', () => {
  const bone=new THREE.Bone();bone.name='mixamorigRightForeArm';
  const original = new THREE.QuaternionKeyframeTrack(bone.name+'.quaternion',[0,1],[0,0,0,1,0,0,0,1]);
  const clip = new THREE.AnimationClip('Attack',1,[original]);
  const offsets=new Map([[bone,{x:0,y:25,z:0}]]);
  const baked=bakePoseClips([clip],offsets);
  assert.equal(baked.modified,1);
  assert.equal(baked.skipped,0);
  assert.equal(original.values[1],0);
  const expected=deltaQuaternion({x:0,y:25,z:0});
  assert.ok(nearQuat(new THREE.Quaternion().fromArray(baked.clips[0].tracks[0].values,0),expected));
  assert.ok(nearQuat(new THREE.Quaternion().fromArray(baked.clips[0].tracks[0].values,4),expected));
});

test('no modifications when arms are unedited', () => {
  const clip=new THREE.AnimationClip('Idle',1,[]);
  const result=bakePoseClips([clip],new Map());
  assert.strictEqual(result.clips[0],clip);
  assert.equal(result.modified,0);
});
