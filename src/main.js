
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
import './style.css';

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
transform.addEventListener('objectChange', () => { refreshFields(); refreshExport(); });
const state = { character: null, weapon: null, bones: [], selectedBone: null, skeletonHelper: null,
  mixer: null, clips: [], action: null, clip: null, playing: false, time: 0,
  characterName: null, weaponName: null, modelUrls: [], toastTimer: null,
  gizmoVisible: true, exporting: false };

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
  if (state.character) { scene.remove(state.character); disposeObject(state.character); }
  Object.assign(state, {character:null,bones:[],selectedBone:null,skeletonHelper:null,mixer:null,clips:[],action:null,clip:null,playing:false,time:0,characterName:null});
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
  state.weaponName = null;
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
  $('start-screen').classList.add('closed');
  $('empty-state').classList.add('hidden');
  setTimeout(() => { $('start-screen')?.remove(); resize(); }, 380);
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
      renderBones();
      if (state.bones.length) {
        const likely = state.bones.find(b => /right(hand|wrist)|hand[_ .-]?r|r[_ .-]?hand|mixamorig.*righthand/i.test(b.name));
        if (likely) state.selectedBone = likely;
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
      toast('Персонаж загружен: '+loaded.name);
    } else {
      resetWeapon();
      state.weapon = loaded.root;
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
    refreshFields(); refreshExport();
    showEditor();
    refreshModelActions();
  } catch (error) {
    console.error('Model loading failed',error);
    toast('Ошибка загрузки: '+(error?.message || 'неизвестный формат'));
    setStatus('ОШИБКА');
  } finally { finishLoading(); }
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
  state.mixer.stopAllAction();
  state.clip = state.clips[index];
  state.action = state.mixer.clipAction(state.clip);
  state.action.reset().play();
  state.action.paused = true;
  state.action.timeScale = Number($('animation-speed').value);
  state.playing = false;
  state.time = 0;
  state.mixer.update(0);
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
  state.mixer.update(0);
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
  transform.attach(state.weapon);
  setGizmoVisible(false);
  refreshFields(); refreshExport();
  toast('Оружие привязано к '+state.selectedBone.name+'. Оси скрыты для просмотра; нажми «Показать стрелки» для настройки.');
}
function detachWeapon() {
  if (!state.weapon) return toast('Сначала загрузи оружие');
  scene.attach(state.weapon); // world position remains fixed at current pose
  transform.attach(state.weapon);
  refreshFields(); refreshExport();
  toast('Оружие отвязано, мировое положение сохранено');
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
  o.updateMatrixWorld(true);
  refreshExport();
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
button('reset-weapon',()=> {
  if(!state.weapon)return toast('Сначала загрузи оружие');
  state.weapon.position.set(0,0,0);state.weapon.rotation.set(0,0,0);state.weapon.scale.set(1,1,1);
  refreshFields();refreshExport();
});
$('bone-search').addEventListener('input',renderBones);
$('animation-select').addEventListener('change',event=>selectClip(Number(event.target.value)));
button('animation-play',playPause);
button('animation-stop',stopAnimation);
button('animation-start',()=> {stopAnimation();});
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
function downloadBlob(content,filename,type) {
  const blob = content instanceof Blob ? content : new Blob([content],{type});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),15000);
}

async function exportSceneGLB() {
  if (state.exporting) return;
  if (!state.character && !state.weapon) return toast('Сначала загрузи персонажа или оружие');
  state.exporting = true;
  const btn = $('export-glb');
  const before = btn.textContent;
  btn.disabled = true; btn.textContent = '⏳ Подготавливаем GLB…';
  setStatus('ЭКСПОРТ');
  const exportScene = new THREE.Scene();
  // Put real objects into the export scene temporarily to preserve the original skinning.
  // Do not clone SkinnedMesh with regular clone(); its skeleton references may break.
  const exportCharacter = state.character;
  const exportWeapon = state.weapon;
  const detachedWeapon = exportWeapon && (!exportCharacter || !exportCharacter.getObjectById(exportWeapon.id));
  try {
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    if(exportCharacter) exportScene.add(exportCharacter);
    if(detachedWeapon) exportScene.add(exportWeapon);
    exportScene.updateMatrixWorld(true);
    const exporter = new GLTFExporter();
    const result = await exporter.parseAsync(exportScene,{
      binary: true,
      trs: true,
      onlyVisible: true,
      animations: exportCharacter ? state.clips : []
    });
    const baseName = (state.characterName || state.weaponName || 'rig-weapon').replace(/\.[^.]+$/,'').replace(/[^a-zA-Z0-9_-]+/g,'_').slice(0,70);
    downloadBlob(result,baseName+'_weapon.glb','model/gltf-binary');
    toast('GLB подготовлен: персонаж, оружие и совместимые анимации.');
  } catch(error) {
    console.error('GLB export failed', error);
    toast('Не удалось экспортировать GLB: '+(error?.message||'ошибка конвертации'));
  } finally {
    if(exportCharacter) scene.add(exportCharacter);
    if(detachedWeapon) scene.add(exportWeapon);
    scene.updateMatrixWorld(true);
    state.exporting = false;
    btn.disabled = !state.character && !state.weapon;
    btn.textContent = before;
    setStatus('ГОТОВ');
  }
}
button('export-glb',exportSceneGLB);

button('download-transform',()=>{
  const info=transformInfo();if(!info)return toast('Сначала загрузи оружие');
  const blob=new Blob([JSON.stringify(info,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download='weapon-transform.json';document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
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
    state.mixer.update(delta);
    state.time=state.action.time;
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
