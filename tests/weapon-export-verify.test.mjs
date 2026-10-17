import test from 'node:test';
import assert from 'node:assert/strict';
import {assertSavedWeaponMotion} from '../src/weapon-export-verify.js';
const sample=()=>{
 const nodes=[{name:'Hero'},{name:'Sword',extras:{rigWeaponStudioRole:'weapon'}}];
 const animation=()=>({channels:[
  {target:{node:1,path:'translation'}},
  {target:{node:1,path:'rotation'}},
  {target:{node:1,path:'scale'}},
  {target:{node:0,path:'rotation'}}
 ]});
 return {asset:{version:'2.0'},nodes,animations:[animation(),animation()]};
};
test('validate every action exported with 3 independent sword tracks',()=>{
 const result=assertSavedWeaponMotion(sample(),2,{weaponExpected:true});
 assert.deepEqual(result,{clips:2,weaponChannels:6});
});
test('missing sword rotation or location in any action aborts save',()=>{
 const gltf=sample();gltf.animations[1].channels.splice(1,1);
 assert.throws(()=>assertSavedWeaponMotion(gltf,2,{weaponExpected:true}),/Не записано положение оружия/);
});
test('silently dropping an animation is not accepted',()=>{
 const gltf=sample();gltf.animations.pop();
 assert.throws(()=>assertSavedWeaponMotion(gltf,2,{weaponExpected:true}),/вместо 2/);
});
test('missing attached weapon node aborts save',()=>{
 const gltf=sample();delete gltf.nodes[1].extras;
 assert.throws(()=>assertSavedWeaponMotion(gltf,2,{weaponExpected:true}),/пропала метка/);
});
test('character without weapon can still save its usual animations',()=>{
 const gltf=sample();delete gltf.nodes[1].extras;
 assert.equal(assertSavedWeaponMotion(gltf,2).clips,2);
});
