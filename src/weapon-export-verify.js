// Validate a glTF JSON snapshot after export: reporting "saved" when all
// weapon animation tracks were dropped is worse than an explicit error.
export function assertSavedWeaponMotion(gltf,expectedClips,{weaponExpected=false}={}){
 if(!gltf||typeof gltf!=='object')throw Error('Некорректный экспорт GLB');
 if(!expectedClips)return {clips:0,weaponChannels:0};
 const animations=gltf.animations||[];
 if(animations.length!==expectedClips)
  throw Error('Экспорт сохранил '+animations.length+' анимаций вместо '+expectedClips);
 if(!weaponExpected)return {clips:animations.length,weaponChannels:0};
 const nodes=gltf.nodes||[];
 const weaponIndex=nodes.findIndex(n=>n.extras?.rigWeaponStudioRole==='weapon');
 if(weaponIndex<0)throw Error('У экспортированного оружия пропала метка узла');
 let weaponChannels=0;
 animations.forEach((anim,index)=>{
  const targets=new Set((anim.channels||[])
   .filter(c=>c.target?.node===weaponIndex).map(c=>c.target.path));
  if(!targets.has('translation')||!targets.has('rotation')||!targets.has('scale'))
   throw Error('Не записано положение оружия в клипе №'+(index+1));
  weaponChannels+=3;
 });
 return {clips:animations.length,weaponChannels};
}
