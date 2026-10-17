import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {STUDIO_HELP_TABS,setupStudioHelp} from '../src/studio-help.js';
const html=readFileSync('index.html','utf8');
const main=readFileSync('src/main.js','utf8');
const css=readFileSync('src/style.css','utf8');
test('Russian studio help is reachable from toolbar, splash and keyframe panel',()=>{
 for(const id of ['open-studio-help','start-help','studio-help-modal',
  'close-studio-help','studio-help-prev','studio-help-next','studio-help-page',
  'studio-help-body','studio-help-status']){
  assert.ok(id==='start-help'?main.includes('id="'+id+'"'):html.includes('id="'+id+'"'),id);
 }
 assert.ok(main.includes('setupStudioHelp('));
 assert.ok(html.includes('data-open-studio-help="motion"'));
});
test('each help tab has a real topic and describes practical workflow',()=>{
 assert.deepEqual(STUDIO_HELP_TABS,['basics','clips','motion','issues']);
 for(const key of STUDIO_HELP_TABS){
  assert.ok(html.includes('data-help-tab="'+key+'"'),key+' tab');
  assert.ok(html.includes('data-help-section="'+key+'"'),key+' content');
 }
 for(const term of ['Запомнить положение','Ключ на этом кадре','Спина','Пояс',
  '0.70','экспорт','Нужна','две','Рука']){
  assert.ok(html.toLowerCase().includes(term.toLowerCase()),term);
 }
});
test('guide jump buttons only reference actual existing app controls',()=>{
 const targets=[...html.matchAll(/data-help-target="([^"]+)"/g)].map(m=>m[1]);
 assert.ok(targets.length>=10);
 for(const id of targets)assert.ok(html.includes('id="'+id+'"'),id);
});
test('help modal is closed by default, keyboard accessible and styled for Android',()=>{
 assert.ok(html.includes('id="studio-help-modal" class="studio-help-overlay" hidden role="dialog"'));
 assert.ok(css.includes('#studio-help-modal[hidden]'));
 assert.ok(css.includes('max-height:calc(100dvh - 22px)'));
 assert.ok(css.includes('safe-area-inset-bottom'));
 assert.ok(main.includes('getStatus:()=>['));
 assert.equal(typeof setupStudioHelp,'function');
});
test('help is interactive and does not start export or generate animation keys',()=>{
 const source=readFileSync('src/studio-help.js','utf8');
 assert.ok(source.includes("event.key==='Escape'"));
 assert.ok(source.includes('scrollIntoView('));
 assert.ok(source.includes("event.target===modal"));
 assert.ok(source.includes('onNavigate()'));
 assert.ok(!source.includes('exportSceneGLB('));
 assert.ok(!source.includes('recordWeaponMotionKey('));
 assert.ok(!source.includes('recordWeaponMotionKey()'));
});
