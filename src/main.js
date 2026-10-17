
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { ArmPoseController, POSE_LIMITS, POSE_LABELS, resolveArmBones, identifyArmBone, bakePoseClipsByIndex, cloneArmOffsets } from './arm-pose.js';
import {WeaponAnimationProfiles,bakeWeaponAnimationClips} from './weapon-profiles.js';
import {bakeWeaponMotionClips} from './weapon-motion.js';
import {WeaponMotionEditor} from './weapon-motion-editor.js';
import './style.css';

const NativeFileSaver = registerPlugin('NativeFileSaver');
const $ = (id) => document.getElementById(id);
const viewport = $('viewport');
const scene = new THREE.Scene();
scene.background = new THREE.Color('#0c1523');
scene.fog = new THREE.Fog('#0c1523', 16, 65);
const camera = new THREE.PerspectiveCamera(42, 1, 0.005, 1200);
camera.position.set(2.8, 2.1, 4.1);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.4;
renderer.domElement.setAttribute('aria-label', '3D сцена: вращай, приближай и перемещай оружие');
viewport.prepend(renderer.domElement);
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.dampingFactor = .08;
orbit.minDistance = .01;
orbit.maxDistance = 400;
orbit.target.set(0, 1, 0);
orbit.update();

scene.add(new THREE.HemisphereLight(0xc2d9ff, 0x1b2236, 2.0));
const keyLight = new THREE.DirectionalLight(0xffe8cc, 3.1);
keyLight.position.set(3, 7, 5);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0x8499ff, 2.6);
rimLight.position.set(-3, 3, -4);
scene.add(rimLight);
const grid = new THREE.GridHelper(24, 24, 0x4b5a80, 0x28354b);
grid.material.opacity = .35;
grid.material.transparent = true;
scene.add(grid);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200,200), new THREE.ShadowMaterial({opacity:0}));
ground.rotation.x = -Math.PI / 2;
ground.visible = false;
scene.add(ground);

const transform = new TransformControls(camera, renderer.domElement);
scene.add(transform.getHelper());
transform.setSize(.85);
transform.setMode('translate');
transform.setSpace('local');
transform.addEventListener('dragging-changed', e => { orbit.enabled = !e.value; });
transform.addEventListener('objectChange', () => {markWeaponDirty();refreshFields();refreshExport();});
const state = { character: null, weapon: null, bones: [], selectedBone: null, skeletonHelper: null,
  mixer: null, clips: [], action: null, clip: null, playing: false, time: 0,
  characterName: null, weaponName: null, modelUrls: [], toastTimer: null,
  gizmoVisible: true, exporting: false, poseSide: 'right', poseJoint: 'upper',
  poseArmBones: {left:{},right:{}}, poseManualBone: null };
const armPose = new ArmPoseController();
const weaponProfiles=new WeaponAnimationProfiles();
const armCorrections=new Map();
let weaponDirty=false;
const currentClipIndex=()=>state.clip?state.clips.indexOf(state.clip):-1;
function refreshWeaponPresetUI(){
 const i=currentClipIndex(),ready=Boolean(state.weapon?.parent?.isBone&&i>=0);
 $('save-weapon-clip').disabled=!ready||state.exporting;
 $('reset-weapon-clip').disabled=!ready||state.exporting;
 weaponMotionEditor.render();
 $('weapon-preset-status').textContent=!ready
  ?'Привяжи оружие к кости и выбери анимацию'
  :weaponDirty?'● Изменено — запомнится при переключении / экспорте'
  :weaponProfiles.has(i)?'✓ Для этой анимации есть сохранённая позиция'
  :'Используется исходная позиция. Настрой оружие и нажми «Запомнить».';
}
function markWeaponDirty(){
 if(!state.weapon?.parent?.isBone)return;
 weaponDirty=true;refreshWeaponPresetUI();
}
function commitWeapon(){
 const i=currentClipIndex();
 if(i<0||!state.weapon?.parent?.isBone)return false;
 const ok=weaponProfiles.save(i,state.weapon);
 if(ok){weaponDirty=false;refreshWeaponPresetUI();}
 return ok;
}
function rememberArms(){
 const i=currentClipIndex();if(i<0)return;
 if(armPose.offsets.size)armCorrections.set(i,cloneArmOffsets(armPose.offsets));
 else armCorrections.delete(i);
}
function loadArms(i){
 armPose.clearAll();
 const saved=armCorrections.get(i);
 if(saved?.size){armPose.offsets=cloneArmOffsets(saved);armPose.apply();}
}

const weaponMotionEditor=new WeaponMotionEditor({
 getWeapon:()=>state.weapon,getBones:()=>state.bones,
 getSelectedBone:()=>state.selectedBone,getClipIndex:currentClipIndex,
 getTime:()=>state.time,setTime:t=>setTime(t),
 isExporting:()=>state.exporting,isDirty:()=>weaponDirty,
 markDirty:()=>markWeaponDirty(),
 clearDirty:()=>{weaponDirty=false;refreshWeaponPresetUI();},
 refresh:()=>{refreshFields();refreshExport();},
 notify:message=>toast(message)
});
function applyCurrentWeapon(){
 if(weaponDirty)return;
 if(!weaponMotionEditor.preview())weaponProfiles.apply(currentClipIndex(),state.weapon);
}
function toast(message) {
  const t = $('toast');
  t.textContent = message;
  t.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}
function setStatus(message) { $('state-indicator').textContent = '● ' + message; }
function button(id, handler) { $(id).addEventListener('click', handler); }
function disposeObject(root) {
  if (!root) return;
  root.traverse(child => {
    if (child.geometry) child.geometry.dispose();
    if (!child.material) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
      material.dispose();
    }
  });
}
function refreshModelActions() {
  $('reset-character').disabled = !state.character;
  $('clear-weapon').disabled = !state.weapon;
  $('export-glb').disabled = !state.character && !state.weapon;
  syncGizmoVisibility();
  $('model-badge').textContent = state.characterName || state.weaponName || 'Сцена пуста';
  $('empty-state').classList.toggle('hidden', !!(state.character || state.weapon));
  refreshPoseUI();
  refreshWeaponPresetUI();
  weaponMotionEditor.render();
}
function syncGizmoVisibility() {
  const enabled = !!state.weapon && state.gizmoVisible;
  transform.getHelper().visible = enabled;
  transform.enabled = enabled;
  $('gizmo-toggle').disabled = !state.weapon;
  $('gizmo-toggle').textContent = enabled ? '◉ Скрыть стрелки' : '◎ Показать стрелки';
  $('gizmo-toggle').setAttribute('aria-pressed', String(enabled));
  $('gizmo-hint').textContent = enabled ? 'Оси оружия видны' : 'Чистый просмотр';
}
function setGizmoVisible(value) {
  state.gizmoVisible = Boolean(value);
  syncGizmoVisibility();
}
function resetCharacter() {
  // Preserve weapon world position before removing the animated skeleton.
  if (state.weapon?.parent && state.weapon.parent !== scene) scene.attach(state.weapon);
  if (state.mixer) { state.mixer.stopAllAction(); state.mixer.uncacheRoot(state.character); }
  if (state.skeletonHelper) { scene.remove(state.skeletonHelper); state.skeletonHelper.geometry.dispose(); state.skeletonHelper.material.dispose(); }
  armPose.clearAll();armCorrections.clear();weaponProfiles.clear();weaponMotionEditor.reset();weaponDirty=false;
  if (state.character) { scene.remove(state.character); disposeObject(state.character); }
  Object.assign(state, {character:null,bones:[],selectedBone:null,skeletonHelper:null,mixer:null,clips:[],action:null,clip:null,playing:false,time:0,characterName:null,
    poseArmBones:{left:{},right:{}},poseManualBone:null});
  $('character-file').textContent = 'Загрузить';
  $('bone-search').value = '';
  renderBones();
  updateAnimationList();
  refreshModelActions();
  refreshFields(); refreshExport();
}
function resetWeapon() {
  transform.detach();
  if (state.weapon) { state.weapon.removeFromParent(); disposeObject(state.weapon); }
  state.weapon = null;
  state.weaponName = null;weaponProfiles.clear();weaponMotionEditor.reset();weaponDirty=false;
  $('weapon-file').textContent = 'Загрузить';
  refreshFields(); refreshExport();
  refreshModelActions();
}

function getMainFile(files) {
  const supported = ['glb','gltf','fbx','obj','dae','stl','ply'];
  return files.find(f => supported.includes((f.name.split('.').pop() || '').toLowerCase()));
}
function makeManager(files) {
  const manager = new THREE.LoadingManager();
  const mapping = new Map();
  const urls = [];
  files.forEach(file => {
    const url = URL.createObjectURL(file);
    urls.push(url);
    mapping.set(file.name.toLowerCase(),url);
    mapping.set(file.name.split('/').pop().toLowerCase(),url);
  });
  manager.setURLModifier(original => {
    const clean = decodeURIComponent(original.split('?')[0].split('#')[0]).replace(/\\/g,'/');
    const base = clean.slice(clean.lastIndexOf('/') + 1).toLowerCase();
    return mapping.get(clean.toLowerCase()) || mapping.get(base) || original;
  });
  return {manager, mapping, urls};
}
async function decodeModel(files) {
  const main = getMainFile(files);
  if (!main) throw new Error('Выбери GLB, GLTF, FBX, OBJ, DAE, STL или PLY');
  const ext = main.name.split('.').pop().toLowerCase();
  const bundle = makeManager(files);
  let model = null;
  let clips = [];
  try {
    const url = bundle.mapping.get(main.name.toLowerCase());
    if (ext === 'glb' || ext === 'gltf') {
      const gltf = await new GLTFLoader(bundle.manager).loadAsync(url);
      model = gltf.scene;
      clips = gltf.animations || [];
    } else if (ext === 'fbx') {
      model = await new FBXLoader(bundle.manager).loadAsync(url);
      clips = model.animations || [];
    } else if (ext === 'obj') {
      model = await new OBJLoader(bundle.manager).loadAsync(url);
    } else if (ext === 'dae') {
      const result = await new ColladaLoader(bundle.manager).loadAsync(url);
      model = result.scene; clips = result.animations || [];
    } else if (ext === 'stl' || ext === 'ply') {
      const geometry = await (ext === 'stl' ? new STLLoader(bundle.manager) : new PLYLoader(bundle.manager)).loadAsync(url);
      if (!geometry.attributes.normal) geometry.computeVertexNormals();
      model = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({color:0xadbde1,roughness:.58,metalness:.15,side:THREE.DoubleSide}));
    }
    if (!model) throw new Error('Не удалось прочитать сцену из файла');
    const container = new THREE.Group();
    container.name = main.name;
    container.add(model);
    container.traverse(obj => {
      if (!obj.isMesh) return;
      obj.frustumCulled = false; // animated / imported bounds may be stale
    });
    return {root:container, clips, name:main.name};
  } finally {
    // Some loaders schedule texture loads asynchronously, so keep URLs alive a little longer.
    setTimeout(() => bundle.urls.forEach(url => URL.revokeObjectURL(url)), 45000);
  }
}
function frameObject(object) {
  if (!object) { camera.position.set(2.8,2.1,4.1); orbit.target.set(0,1,0); orbit.update(); return; }
  object.updateWorldMatrix(true,true);
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(size.length() * .5, .1);
  const cameraDist = (radius / Math.sin(THREE.MathUtils.degToRad(camera.fov * .5))) * 1.30;
  camera.position.copy(center).add(new THREE.Vector3(cameraDist*.65,cameraDist*.36,cameraDist*.86));
  camera.near = Math.max(.001, cameraDist / 300);
  camera.far = Math.max(1000, cameraDist * 100);
  camera.updateProjectionMatrix();
  orbit.target.copy(center);
  orbit.minDistance = Math.max(.001, cameraDist / 100);
  orbit.maxDistance = Math.max(25, cameraDist * 80);
  orbit.update();
}
function findBones(root) {
  const found = [];
  root.traverse(node => {if(node.isBone) found.push(node);});
  return found;
}
function hasRenderableMesh(root) {
  let hasMesh = false;
  root.traverse(node => { if (node.isMesh) hasMesh = true; });
  return hasMesh;
}
function findEmbeddedWeapon(root, originalFileName) {
  // Our newer GLBs identify the weapon explicitly via glTF node extras.
  let tagged = null;
  root.traverse(node => {
    if (!tagged && node !== root && node.userData?.rigWeaponStudioRole === 'weapon'
        && hasRenderableMesh(node)) tagged = node;
  });
  if (tagged) return tagged;

  // Compatibility with v0.2/v0.3 GLBs already saved on the tablet:
  // those files were named *_weapon.glb, but lacked identification metadata.
  // Only search for a mesh under a bone for such files; otherwise character
  // attachments, hats, etc. must never be silently reclassified as weapons.
  if (!/_weapon\.(glb|gltf)$/i.test(originalFileName || '')) return null;
  const bones = findBones(root);
  const preferred = bones.filter(bone => /hand|wrist|weapon|grip/i.test(bone.name));
  for (const bone of [...preferred, ...bones.filter(b => !preferred.includes(b))]) {
    const candidate = bone.children.find(child =>
      !child.isBone && hasRenderableMesh(child));
    if (candidate) return candidate;
  }
  return null;
}
function renderBones() {
  const filter = $('bone-search').value.trim().toLowerCase();
  $('bone-count').textContent = state.bones.length + ' костей';
  const list = $('bone-list');
  list.replaceChildren();
  const bones = state.bones.filter(b => b.name.toLowerCase().includes(filter));
  if (!bones.length) {
    const el = document.createElement('div'); el.className = 'placeholder';
    el.textContent = state.bones.length ? 'Нет совпадений' : 'Загрузи персонажа со скелетом';
    list.append(el); return;
  }
  bones.forEach((bone,i) => {
    const row = document.createElement('button'); row.className = 'bone-row'+ (state.selectedBone === bone?' selected':'');
    const name = document.createElement('span'); name.textContent = bone.name || '(без имени)';
    const index = document.createElement('small'); index.textContent = '#'+(state.bones.indexOf(bone)+1);
    row.append(name,index);
    row.addEventListener('click', () => { state.selectedBone = bone; renderBones(); toast('Кость выбрана: '+bone.name); });
    list.append(row);
  });
}
function showEditor() {
  // Opening a second character/weapon must work after the original splash
  // element has already been removed during the first import.
  const splashScreen = $('start-screen');
  if (splashScreen) {
    splashScreen.classList.add('closed');
    setTimeout(() => { splashScreen.remove(); resize(); }, 380);
  } else {
    resize();
  }
  $('empty-state')?.classList.toggle('hidden', !!(state.character || state.weapon));
}
function startLoading(filename) {
  $('loading-file').textContent = filename;
  $('loading-layer').classList.remove('hidden');
  setStatus('ЗАГРУЗКА');
}
function finishLoading() { $('loading-layer').classList.add('hidden'); setStatus('ГОТОВ'); }
async function importModel(kind, files) {
  if (!files.length) return;
  const main = getMainFile(files);
  if (!main) { toast('Нужен файл модели GLB / GLTF / FBX / OBJ / DAE / STL / PLY'); return; }
  startLoading(main.name);
  // Let overlay paint before costly model parsing.
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  try {
    const loaded = await decodeModel(files);
    if (kind === 'character') {
      resetCharacter();
      state.character = loaded.root;
      state.characterName = loaded.name;
      scene.add(state.character);
      state.character.updateWorldMatrix(true,true);
      state.bones = findBones(state.character);
      state.poseArmBones = resolveArmBones(state.bones);
      state.poseManualBone = null;
      // A previously exported GLB includes the weapon as a child of the
      // character hierarchy; expose that child to the weapon editor again.
      const embeddedWeapon = findEmbeddedWeapon(state.character, loaded.name);
      if (embeddedWeapon) {
        if (state.weapon) resetWeapon();
        state.weapon = embeddedWeapon;
        weaponProfiles.load(embeddedWeapon,embeddedWeapon.userData?.rigWeaponStudioWeaponProfiles);
        weaponMotionEditor.load(embeddedWeapon.userData?.rigWeaponStudioMotionKeys);
        weaponDirty=false;
        state.weaponName = embeddedWeapon.name || 'Оружие из GLB';
        $('weapon-file').textContent = state.weaponName;
        transform.attach(state.weapon);
        setGizmoVisible(false);
      }
      renderBones();
      if (state.bones.length) {
        const likely = state.bones.find(b => /right(hand|wrist)|hand[_ .-]?r|r[_ .-]?hand|mixamorig.*righthand/i.test(b.name));
        if (state.weapon?.parent?.isBone) state.selectedBone = state.weapon.parent;
        else if (likely) state.selectedBone = likely;
        renderBones();
        state.skeletonHelper = new THREE.SkeletonHelper(state.character);
        state.skeletonHelper.visible = $('bone-toggle').classList.contains('active');
        scene.add(state.skeletonHelper);
      }
      if (loaded.clips.length) {
        state.clips = loaded.clips;
        state.mixer = new THREE.AnimationMixer(state.character);
      }
      updateAnimationList();
      frameObject(state.character);
      $('character-file').textContent = loaded.name;
      $('model-badge').textContent = loaded.name;
      toast(embeddedWeapon
        ? 'Персонаж, анимации и редактируемое оружие загружены из GLB'
        : 'Персонаж загружен: '+loaded.name);
    } else {
      resetWeapon();
      state.weapon = loaded.root;
      weaponProfiles.clear();weaponMotionEditor.reset();weaponDirty=false;
      state.weaponName = loaded.name;
      scene.add(state.weapon);
      // Put a new weapon near the origin; never silently change its scale.
      state.weapon.position.set(0,0,0);
      transform.attach(state.weapon);
      setGizmoVisible(true);
      if (!state.character) frameObject(state.weapon);
      $('weapon-file').textContent = loaded.name;
      toast('Оружие загружено. Выбери кость и нажми «Привязать».');
    }
    refreshFields(); refreshExport(); refreshPoseUI();
    showEditor();
    refreshModelActions();
  } catch (error) {
    console.error('Model loading failed',error);
    toast('Ошибка загрузки: '+(error?.message || 'неизвестный формат'));
    setStatus('ОШИБКА');
  } finally {
    finishLoading();
    // Keep the buttons and empty-scene overlay synchronized even if an
    // imported file triggers an error after its scene objects were loaded.
    refreshModelActions();
  }
}
function updateAnimationList() {
  const select = $('animation-select');
  select.replaceChildren();
  if (!state.clips.length) {
    select.add(new Option('Нет анимаций',''));
    $('animation-time').textContent = '0.000 / 0.000 c';
  } else {
    state.clips.forEach((clip,i) => select.add(new Option((clip.name || 'Анимация '+(i+1)) + ' · '+clip.duration.toFixed(2)+'c',String(i))));
    select.value = '0';
    selectClip(0);
  }
}
function selectClip(index) {
  if (!state.mixer || !state.clips[index]) return;
  if(weaponDirty)commitWeapon();rememberArms();armPose.restore();
  state.mixer.stopAllAction();
  state.clip = state.clips[index];
  state.action = state.mixer.clipAction(state.clip);
  state.action.reset().play();
  state.action.paused = true;
  state.action.timeScale = Number($('animation-speed').value);
  state.playing = false;
  state.time = 0;
  loadArms(index);armPose.restore();state.mixer.update(0);armPose.apply();
  weaponDirty=false;applyCurrentWeapon();weaponMotionEditor.render();
  refreshWeaponPresetUI();refreshPoseUI();refreshFields();
  $('animation-play').textContent = '▶';
  $('animation-seek').value = '0';
  refreshAnimationTime();
}
function refreshAnimationTime() {
  const duration = state.clip?.duration || 0;
  $('animation-time').textContent = state.time.toFixed(3) + ' / ' + duration.toFixed(3) + ' c';
  if (duration > 0 && document.activeElement !== $('animation-seek')) $('animation-seek').value = String(Math.round((state.time / duration) * 1000));
}
function setTime(t) {
  if (!state.action) return;
  state.time = THREE.MathUtils.clamp(t,0,state.clip.duration);
  state.action.time = state.time;
  armPose.restore();
  state.mixer.update(0);armPose.apply();
  applyCurrentWeapon();
  refreshAnimationTime();
  refreshExport();
}
function playPause() {
  if (!state.action) { toast('В модели нет анимаций'); return; }
  if (state.playing) {
    state.playing = false; state.action.paused = true;
  } else {
    if (state.time >= state.clip.duration) setTime(0);
    state.playing = true; state.action.paused = false;
  }
  $('animation-play').textContent = state.playing ? 'Ⅱ' : '▶';
}
function stopAnimation() {if (!state.action) return;state.playing=false;state.action.paused=true;setTime(0);$('animation-play').textContent='▶';}
function attachWeapon() {
  if (!state.weapon) return toast('Сначала загрузи оружие');
  if (!state.selectedBone) return toast('Выбери кость руки в списке');
  state.selectedBone.updateWorldMatrix(true,true);
  state.selectedBone.attach(state.weapon); // preserve world transform at current pose
  weaponProfiles.attach(state.weapon);weaponMotionEditor.reset();weaponDirty=false;refreshWeaponPresetUI();
  transform.attach(state.weapon);
  setGizmoVisible(false);
  refreshFields(); refreshExport();
  toast('Оружие привязано к '+state.selectedBone.name+'. Оси скрыты для просмотра; нажми «Показать стрелки» для настройки.');
}
function detachWeapon() {
  if (!state.weapon) return toast('Сначала загрузи оружие');
  scene.attach(state.weapon); // world position remains fixed at current pose
  weaponProfiles.clear();weaponMotionEditor.reset();weaponDirty=false;refreshWeaponPresetUI();
  transform.attach(state.weapon);
  refreshFields(); refreshExport();
  toast('Оружие отвязано, мировое положение сохранено');
}
function currentPoseBone() {
  return state.poseManualBone || state.poseArmBones[state.poseSide]?.[state.poseJoint] || null;
}
function refreshPoseUI() {
  const bone = currentPoseBone();
  const name = $('pose-bone-label');
  if (!name) return;
  for (const button of document.querySelectorAll('[data-pose-side]'))
    button.classList.toggle('selected', button.dataset.poseSide === state.poseSide);
  for (const button of document.querySelectorAll('[data-pose-joint]'))
    button.classList.toggle('selected', button.dataset.poseJoint === state.poseJoint && !state.poseManualBone);
  name.textContent = bone?.name || (state.character
    ? 'Кость не найдена — выбери нужную в списке выше'
    : 'Сначала загрузи персонажа со скелетом');
  const limit = POSE_LIMITS[state.poseJoint];
  const angles = bone ? armPose.get(bone) : {x:0, y:0, z:0};
  for (const axis of ['x','y','z']) {
    const slider = $('pose-'+axis);
    const field = $('pose-'+axis+'-number');
    slider.min = String(-limit);
    slider.max = String(limit);
    field.min = String(-limit);
    field.max = String(limit);
    slider.disabled = !bone;
    field.disabled = !bone;
    slider.value = String(angles[axis]);
    if (document.activeElement !== field) field.value = String(angles[axis]);
  }
  $('pose-choose-bone').disabled = !state.selectedBone;
  $('pose-reset-joint').disabled = !bone || !armPose.offsets.has(bone);
  $('pose-reset-arm').disabled = !state.character || ![...armPose.offsets.keys()].some(bone => {
    const classification = identifyArmBone(bone);
    return classification?.side === state.poseSide;
  });
  $('pose-bone-help').textContent = bone
    ? 'Локальные повороты ±'+limit+'°. Ноги и таз не меняются.'
    : 'Используй ручной выбор кости для нестандартного скелета.';
}
function setPoseRotation(axis, rawValue) {
  const bone = currentPoseBone();
  if (!bone || state.exporting) return;
  const limit = POSE_LIMITS[state.poseJoint];
  const value = Number(rawValue);
  if (!Number.isFinite(value)) return;
  const angles = armPose.get(bone);
  angles[axis] = THREE.MathUtils.clamp(value, -limit, limit);
  armPose.set(bone, angles);
  refreshPoseUI();
  refreshExport();
}
function selectPoseSide(side) {
  state.poseSide = side;
  state.poseManualBone = null;
  refreshPoseUI();
}
function selectPoseJoint(joint) {
  state.poseJoint = joint;
  state.poseManualBone = null;
  refreshPoseUI();
}
function nearestBoneName(node) {
  if (!node?.isBone) return null;
  return node.name || '(unnamed bone)';
}
function roundForDisplay(x) { return Number(x).toFixed(5).replace(/0+$/,'').replace(/\.$/,''); }
function refreshFields() {
  const o = state.weapon;
  for (const axis of ['x','y','z']) {
    if (document.activeElement !== $('p'+axis)) $('p'+axis).value = roundForDisplay(o?.position[axis] ?? 0);
    if (document.activeElement !== $('r'+axis)) $('r'+axis).value = roundForDisplay(o ? THREE.MathUtils.radToDeg(o.rotation[axis]) : 0);
    if (document.activeElement !== $('s'+axis)) $('s'+axis).value = roundForDisplay(o?.scale[axis] ?? 1);
  }
  $('attached-label').textContent = o?.parent?.isBone ? 'Привязано: '+o.parent.name : 'Оружие не привязано';
  $('space-caption').textContent = o?.parent?.isBone ? 'Координаты относительно кости' : 'Координаты относительно сцены';
}
function readFields() {
  if (!state.weapon) return;
  const get = (id, fallback) => {const n = Number($(id).value);return Number.isFinite(n)?n:fallback;};
  const o=state.weapon;
  o.position.set(get('px',o.position.x),get('py',o.position.y),get('pz',o.position.z));
  o.rotation.set(THREE.MathUtils.degToRad(get('rx',0)),THREE.MathUtils.degToRad(get('ry',0)),THREE.MathUtils.degToRad(get('rz',0)));
  o.scale.set(get('sx',1),get('sy',1),get('sz',1));
  o.updateMatrixWorld(true);markWeaponDirty();refreshExport();
}
function transformInfo() {
  if (!state.weapon) return null;
  const obj=state.weapon;
  obj.updateWorldMatrix(true,false);
  const worldPosition = new THREE.Vector3(), worldQuaternion = new THREE.Quaternion(), worldScale = new THREE.Vector3();
  obj.matrixWorld.decompose(worldPosition, worldQuaternion, worldScale);
  const vector = v => ({x:v.x,y:v.y,z:v.z});
  const quaternion = q => ({x:q.x,y:q.y,z:q.z,w:q.w});
  const localRadians = vector(obj.rotation);
  const localDegrees = vector(new THREE.Vector3().set(THREE.MathUtils.radToDeg(obj.rotation.x),THREE.MathUtils.radToDeg(obj.rotation.y),THREE.MathUtils.radToDeg(obj.rotation.z)));
  return {
    schema: 'rig-weapon-studio/transform-v1',
    model: {character:state.characterName,weapon:state.weaponName},
    coordinateSystem: 'Three.js: Y up, right handed, units from source model',
    parent: {type:obj.parent?.isBone?'bone':'scene',name:nearestBoneName(obj.parent),boneIndex:obj.parent?.isBone?state.bones.indexOf(obj.parent):null},
    animation: {clip:state.clip?.name??null,timeSeconds:state.time},
    local: {position:vector(obj.position),rotationEulerRadians:localRadians,rotationEulerDegrees:localDegrees,rotationOrder:obj.rotation.order,quaternion:quaternion(obj.quaternion),scale:vector(obj.scale),matrixColumnMajor:obj.matrix.toArray()},
    world: {position:vector(worldPosition),quaternion:quaternion(worldQuaternion),scale:vector(worldScale),matrixColumnMajor:obj.matrixWorld.toArray()},
    note: 'For attachment presets prefer local; world depends on the selected animation frame. Import into Godot with explicit axis and coordinate conversion.'
  };
}
function refreshExport() {
  const info=transformInfo();
  $('export-parent').textContent=info?.parent.name || 'Сцена (world)';
  const fmt=(p)=>p ? [p.x,p.y,p.z].map(n=>Number(n).toFixed(4)).join(', ') : '0, 0, 0';
  $('export-local').textContent=fmt(info?.local.position);
  $('export-world').textContent=fmt(info?.world.position);
}
async function copyText(value) {
  try { await navigator.clipboard.writeText(value); return true; }
  catch {
    const field=document.createElement('textarea');field.value=value;document.body.append(field);field.select();
    const ok=document.execCommand('copy');field.remove();return ok;
  }
}

const splash=document.createElement('div'); splash.id='start-screen';
splash.innerHTML=`
  <div class="start-orb orb-a"></div><div class="start-orb orb-b"></div>
  <div class="start-content">
    <div class="start-overline">3D CHARACTER WORKSHOP</div>
    <h1>RIG <span>& WEAPON</span><br/>STUDIO</h1>
    <p class="start-description">Твоя 3D-мастерская. Загружай персонажей, просматривай анимации и настраивай оружие до идеального положения.</p>
    <div class="start-art-wrap"><img class="start-art" src="/panda-menu.webp" alt="Неоновый талисман приложения — сердитый зверёк в кепке"/></div>
    <div class="start-buttons"><button class="btn primary" id="start-character"><span class="btn-ico">◈</span> Загрузить персонажа <span>→</span></button>
    <button class="btn subtle" id="start-weapon"><span class="btn-ico">⚔</span> Загрузить оружие <span>→</span></button>
    <button class="btn subtle" id="start-demo"><span class="btn-ico">◉</span> Открыть пустую сцену <span>→</span></button></div>
    <div class="start-divider">РЕДАКТОР ПОДДЕРЖИВАЕТ</div>
    <div class="start-features"><span>GLB · GLTF · FBX</span><span>OBJ · DAE · STL · PLY</span><span>Скелет и анимации</span></div>
    <div class="start-bottom">PERSONAL 3D EDITOR · ANDROID & DESKTOP</div>
  </div>`;
document.body.append(splash);
const loader=document.createElement('div'); loader.id='loading-layer'; loader.className='loading-layer hidden';
loader.innerHTML=`<div class="loading-card"><img src="/panda-icon.png" alt="Иконка приложения" /><h2>Загружаем 3D-модель</h2><p id="loading-file">Подготовка сцены</p><div class="loading-track"><div class="loading-bar"></div></div></div>`;
document.body.append(loader);

button('start-character',()=> $('file-character').click());
button('start-weapon',()=> $('file-weapon').click());
button('start-demo',()=> { showEditor(); $('empty-state').classList.remove('hidden'); });
for (const [id,kind] of [['file-character','character'],['file-weapon','weapon']]) {
  $(id).addEventListener('change', e => {const files=Array.from(e.target.files||[]); e.target.value=''; importModel(kind,files);});
}
button('empty-load',()=> $('file-character').click());
button('character-load',()=> $('file-character').click());
button('weapon-load',()=> $('file-weapon').click());
button('reset-character',()=>{
  if(!state.character) return;
  resetCharacter();
  frameObject(state.weapon);
  toast('Персонаж и его анимации удалены. Оружие сохранено.');
});
button('clear-weapon',()=>{
  if(!state.weapon) return;
  resetWeapon();
  frameObject(state.character);
  toast('Оружие удалено. Персонаж сохранён.');
});
button('gizmo-toggle',()=>setGizmoVisible(!state.gizmoVisible));
button('wide-toggle',()=>{
  const open=$('app').classList.toggle('viewer-wide');
  $('wide-toggle').classList.toggle('active',open);
  $('wide-toggle').setAttribute('title',open?'Показать редактор':'Развернуть 3D-сцену');
  $('wide-toggle').setAttribute('aria-label',open?'Показать редактор':'Развернуть 3D-сцену');
  $('wide-toggle').textContent = open ? '↙' : '⛶';
  requestAnimationFrame(resize);
});
button('attach-weapon',attachWeapon);
button('detach-weapon',detachWeapon);
for (const btn of document.querySelectorAll('[data-pose-side]'))
  btn.addEventListener('click', () => selectPoseSide(btn.dataset.poseSide));
for (const btn of document.querySelectorAll('[data-pose-joint]'))
  btn.addEventListener('click', () => selectPoseJoint(btn.dataset.poseJoint));
button('pose-choose-bone', () => {
  if (!state.selectedBone?.isBone) return toast('Выбери кость из списка выше');
  state.poseManualBone = state.selectedBone;
  const matched = identifyArmBone(state.selectedBone);
  if (matched) { state.poseSide = matched.side; state.poseJoint = matched.joint; }
  refreshPoseUI();
  toast('Настраиваем кость: ' + state.selectedBone.name);
});
for (const axis of ['x','y','z']) {
  $('pose-'+axis).addEventListener('input', event => setPoseRotation(axis, event.target.value));
  $('pose-'+axis+'-number').addEventListener('change', event => setPoseRotation(axis, event.target.value));
}
button('pose-reset-joint', () => {
  const bone = currentPoseBone();
  if (!bone) return;
  armPose.clearBones([bone]);
  refreshPoseUI();
  toast('Поворот сустава сброшен');
});
button('pose-reset-arm', () => {
  const affected = [...armPose.offsets.keys()].filter(bone => identifyArmBone(bone)?.side === state.poseSide);
  armPose.clearBones(affected);
  refreshPoseUI();
  toast('Поправки ' + (state.poseSide === 'right' ? 'правой' : 'левой') + ' руки сброшены');
});
button('reset-weapon',()=> {
  if(!state.weapon)return toast('Сначала загрузи оружие');
  state.weapon.position.set(0,0,0);state.weapon.rotation.set(0,0,0);state.weapon.scale.set(1,1,1);
    markWeaponDirty();refreshFields();refreshExport();
});
$('bone-search').addEventListener('input',renderBones);
$('animation-select').addEventListener('change',event=>selectClip(Number(event.target.value)));
button('animation-play',playPause);
button('animation-stop',stopAnimation);
button('animation-start',()=> {stopAnimation();});
button('save-weapon-clip',()=>{
 if(!commitWeapon())return toast('Сначала привяжи оружие к кости и выбери анимацию.');
 toast('✓ Положение оружия сохранено для «'+state.clip.name+'»');
});
button('reset-weapon-clip',()=>{
 const i=currentClipIndex();if(i<0||!state.weapon?.parent?.isBone)return;
 weaponProfiles.reset(i,state.weapon);weaponDirty=false;
 refreshFields();refreshExport();refreshWeaponPresetUI();
 toast('Исходная позиция восстановлена только для этого действия');
});
$('animation-speed').addEventListener('change',()=> {if(state.action)state.action.timeScale=Number($('animation-speed').value);});
$('animation-seek').addEventListener('input',event=> {if (state.clip)setTime(state.clip.duration*(Number(event.target.value)/1000));});
for (const modeButton of document.querySelectorAll('[data-mode]')) {
  modeButton.addEventListener('click',() => {
    document.querySelectorAll('[data-mode]').forEach(btn=>btn.classList.remove('selected'));
    modeButton.classList.add('selected');
    transform.setMode(modeButton.dataset.mode);
    // Choosing an editing mode returns to manipulation after clean preview.
    setGizmoVisible(true);
  });
}
$('gizmo-space').addEventListener('change',e=>transform.setSpace(e.target.value));
$('snap-toggle').addEventListener('change',e=>{
  transform.setTranslationSnap(e.target.checked?.05:null);
  transform.setRotationSnap(e.target.checked?Math.PI/12:null);
  transform.setScaleSnap(e.target.checked?.05:null);
});
for(const id of ['px','py','pz','rx','ry','rz','sx','sy','sz']) $(id).addEventListener('change',()=> {readFields();refreshFields();});
button('grid-toggle',()=> {grid.visible=!grid.visible; $('grid-toggle').classList.toggle('active',grid.visible);});
button('bone-toggle',()=> {
  const enabled=$('bone-toggle').classList.toggle('active');
  if(state.skeletonHelper)state.skeletonHelper.visible=enabled;
});
button('frame-camera',()=>frameObject(state.character || state.weapon));
button('reset-camera',()=>frameObject(state.character || state.weapon));
button('copy-transform',async()=>{
  const info=transformInfo();if(!info)return toast('Сначала загрузи оружие');
  const copied=await copyText(JSON.stringify(info,null,2));
  toast(copied?'Точные координаты скопированы':'Не удалось скопировать — сохрани JSON в файл');
});

function downloadBlob(content, filename, type) {
  const blob = content instanceof Blob ? content : new Blob([content], {type});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// Android WebView does not reliably honor <a download> for in-memory blobs.
// Use the native Android Storage Access Framework (ACTION_CREATE_DOCUMENT):
// it lets the user pick a folder, create a folder if supported, and name the file.
async function saveFile(content, filename, mimeType, onProgress = () => {}) {
  const data = content instanceof ArrayBuffer ? new Uint8Array(content)
    : content instanceof Uint8Array ? content
    : new TextEncoder().encode(String(content));
  if (Capacitor.getPlatform() === 'android' && Capacitor.isNativePlatform()) {
    await NativeFileSaver.beginFile({ filename, mimeType });
    try {
      const chunkSize = 96 * 1024;
      for (let offset = 0; offset < data.byteLength; offset += chunkSize) {
        const chunk = data.subarray(offset, Math.min(offset + chunkSize, data.byteLength));
        let binary = '';
        for (let i = 0; i < chunk.length; i += 1) binary += String.fromCharCode(chunk[i]);
        await NativeFileSaver.appendChunk({ data: btoa(binary) });
        if (offset % (chunkSize * 8) === 0) {
          onProgress(Math.min(100, Math.round((offset + chunk.length) * 100 / data.byteLength)));
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
      onProgress(100);
      const response = await NativeFileSaver.finishFile();
      return { saved: Boolean(response.saved), cancelled: Boolean(response.cancelled) };
    } catch (error) {
      try { await NativeFileSaver.cancelFile(); } catch (_) {}
      throw error;
    }
  }
  // Desktop browser: showSaveFilePicker if available and permitted by browser.
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: mimeType === 'application/json' ? 'JSON' : '3D GLB', accept: { [mimeType]: [filename.endsWith('.json') ? '.json' : '.glb'] } }]
      });
      const writable = await handle.createWritable();
      try { await writable.write(data); await writable.close(); }
      catch (error) { await writable.abort().catch(() => {}); throw error; }
      return { saved: true, cancelled: false };
    } catch (error) {
      if (error?.name === 'AbortError') return { saved: false, cancelled: true };
      if (error?.name !== 'SecurityError' && error?.name !== 'NotAllowedError') throw error;
    }
  }
  // Non-native fallback: browser-managed download (may not offer a folder picker).
  downloadBlob(data, filename, mimeType);
  return { saved: false, cancelled: false, browserDownload: true };
}

function verifyGlbBuffer(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 28)
    throw new Error('Экспортёр вернул пустой или повреждённый GLB');
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== buffer.byteLength)
    throw new Error('Неверный заголовок GLB');
  if (view.getUint32(16, true) !== 0x4e4f534a)
    throw new Error('В GLB отсутствует JSON-описание');
  const jsonSize = view.getUint32(12, true);
  if (!jsonSize || 20 + jsonSize > buffer.byteLength) throw new Error('Повреждённый JSON-блок GLB');
  const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonSize)));
  if (!gltf.asset || !gltf.scenes?.length || !gltf.nodes?.length)
    throw new Error('Экспортированный GLB не содержит модели');
  return gltf;
}

function showExportStatus(message) {
  $('export-status').textContent = message;
}

async function exportSceneGLB() {
  if (state.exporting) return;
  if (!state.character && !state.weapon) return toast('Сначала загрузи персонажа или оружие');
  if(weaponDirty)commitWeapon();rememberArms();
  state.exporting = true;
  const btn = $('export-glb');
  btn.disabled = true;
  btn.textContent = '⏳ Подготавливаем GLB…';
  showExportStatus('Подготовка модели для сохранения…');
  setStatus('ЭКСПОРТ');
  const exportScene = new THREE.Scene();
  // Preserve skinned meshes and bones by moving the original scene root
  // temporarily, NOT by cloning Skeleton / SkinnedMesh objects.
  const exportCharacter = state.character;
  const exportWeapon = state.weapon;
  // glTF extras survive reload. They identify the weapon separately from
  // the character so it can be edited again in another Rig & Weapon session.
  if (exportWeapon){exportWeapon.userData.rigWeaponStudioRole = 'weapon';exportWeapon.userData.rigWeaponStudioWeaponProfiles=weaponProfiles.toJSON();exportWeapon.userData.rigWeaponStudioMotionKeys=weaponMotionEditor.toJSON();}
  const detachedWeapon = exportWeapon && (!exportCharacter || !exportCharacter.getObjectById(exportWeapon.id));
  const playingBeforeSave = state.playing;
  if (state.action) state.action.paused = true;
  state.playing = false;
  let objectsInExportScene = false;
  const restoreExportScene = () => {
    if (!objectsInExportScene) return;
    if (exportCharacter) scene.add(exportCharacter);
    if (detachedWeapon) scene.add(exportWeapon);
    scene.updateMatrixWorld(true);
    objectsInExportScene = false;
  };
  try {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (exportCharacter) exportScene.add(exportCharacter);
    if (detachedWeapon) exportScene.add(exportWeapon);
    objectsInExportScene = true;
    exportScene.updateMatrixWorld(true);
    const exporter = new GLTFExporter();
    const processed=bakePoseClipsByIndex(state.clips,armCorrections);
    const weaponClips=bakeWeaponAnimationClips(processed.clips,exportWeapon,weaponProfiles);
    const motionBake=bakeWeaponMotionClips(weaponClips.clips,exportWeapon,exportCharacter,weaponMotionEditor.library);
    if(motionBake.missing.length)throw Error('Не найдены кости для анимаций: '+motionBake.missing.join(', '));
    const animationsForExport=exportCharacter?motionBake.clips:[];
    let result;
    let missingAnimations = false;
    try {
      result = await exporter.parseAsync(exportScene, {
        binary: true, trs: true, onlyVisible: true,
        animations: animationsForExport
      });
    } catch (animationError) {
      // Some FBX animation tracks cannot be represented by glTF.
      // Still allow export of the character with its attached weapon,
      // but warn clearly that its animations were not included.
      if (!state.clips.length) throw animationError;
      console.warn('Animation export failed, retry without clips:', animationError);
      result = await new GLTFExporter().parseAsync(exportScene, {
        binary: true, trs: true, onlyVisible: true, animations: []
      });
      missingAnimations = true;
    }
    restoreExportScene();
    const gltf = verifyGlbBuffer(result);
    const nodes = gltf.nodes || [];
    if (exportCharacter && !nodes.some(n => n.name === exportCharacter.name))
      console.warn('Character root group not named in export; model nodes:', nodes.length);
    if (exportWeapon && !nodes.some(n => n.name === exportWeapon.name))
      throw new Error('В экспортируемом GLB потеряно оружие');
    const baseName = (state.characterName || state.weaponName || 'rig-weapon')
      .replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 70);
    const filename = (baseName || 'character') + '_weapon.glb';
    const mbs = (result.byteLength / 1048576).toFixed(1);
    const poseWarning = processed.skipped ? ' Некоторые нестандартные треки позы не удалось преобразовать.' : '';
    showExportStatus('GLB готов (' + mbs + ' МБ). Выбери папку и имя файла в окне Android.' + poseWarning);
    btn.textContent = '⏳ Передача файла…';
    const outcome = await saveFile(result, filename, 'model/gltf-binary', p => {
      btn.textContent = p < 100 ? '⏳ Подготовка сохранения ' + p + '%' : '📁 Выбери папку…';
    });
    if (outcome.saved) {
      const notice = missingAnimations
        ? 'GLB сохранён, но анимации не удалось включить. Модель и оружие сохранены.'
        : 'GLB сохранён. Проверь модель, привязку оружия и анимации при повторной загрузке.';
      showExportStatus(notice);
      toast(notice);
    } else if (outcome.cancelled) {
      showExportStatus('Сохранение отменено. Модель осталась в редакторе.');
      toast('Сохранение отменено');
    } else {
      showExportStatus('Файл передан браузеру. Проверь папку загрузок.');
      toast('Открыта загрузка файла: ' + filename);
    }
  } catch (error) {
    console.error('GLB export/save failed:', error);
    const details = error?.message || String(error);
    showExportStatus('Ошибка экспорта/сохранения: ' + details);
    toast('Ошибка: ' + details);
    setStatus('ОШИБКА');
  } finally {
    restoreExportScene();
    if (playingBeforeSave && state.action) {
      state.playing = true;
      state.action.paused = false;
    }
    state.exporting = false;
    btn.disabled = !state.character && !state.weapon;
    btn.textContent = '📁 Сохранить GLB…';
    if ($('state-indicator').textContent === '● ЭКСПОРТ') setStatus('ГОТОВ');
  }
}
button('export-glb', exportSceneGLB);

button('download-transform', async () => {
  const info = transformInfo();
  if (!info) return toast('Сначала загрузи оружие');
  try {
    const result = await saveFile(JSON.stringify(info, null, 2), 'weapon-transform.json', 'application/json');
    toast(result.saved ? 'Координаты JSON сохранены' : result.cancelled ? 'Сохранение отменено' : 'JSON передан браузеру');
  } catch (error) {
    toast('Не удалось сохранить JSON: ' + (error?.message || 'неизвестная ошибка'));
  }
});

function setupDrop(element){
  element.addEventListener('dragover',e=>{e.preventDefault();e.dataTransfer.dropEffect='copy';});
  element.addEventListener('drop',e=>{
    e.preventDefault();const files=Array.from(e.dataTransfer.files||[]);
    if(files.length)importModel(state.character?'weapon':'character',files);
  });
}
setupDrop(viewport);
setupDrop(splash);

function resize(){
  const width=viewport.clientWidth,height=viewport.clientHeight;
  if(width < 2 || height < 2)return;
  camera.aspect=width/height;camera.updateProjectionMatrix();renderer.setSize(width,height,false);
}
new ResizeObserver(resize).observe(viewport);
window.addEventListener('resize',resize);
resize();
const clock=new THREE.Clock();
let displayAcc=0;
function animate(){
  requestAnimationFrame(animate);
  const delta=Math.min(clock.getDelta(),.1);
  if(state.playing && state.mixer && state.action){
    armPose.restore();
    state.mixer.update(delta);
    armPose.apply();
    state.time=state.action.time;
    applyCurrentWeapon();
    displayAcc += delta;
    if(displayAcc>=.06) {refreshAnimationTime();refreshExport();displayAcc=0;}
  } else if(state.weapon?.parent?.isBone) {
    displayAcc+=delta;if(displayAcc>=.1){refreshExport();displayAcc=0;}
  }
  orbit.update();
  renderer.render(scene,camera);
}
animate();
refreshFields();refreshExport();
refreshModelActions();
refreshPoseUI();
