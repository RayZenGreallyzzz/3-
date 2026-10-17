// Interactive, offline-first Russian guide for the Android Rig & Weapon editor.
// Navigates to controls without invoking destructive operations, uploading
// files, changing animation keys, or saving over an existing project.
export const STUDIO_HELP_TABS=Object.freeze(['basics','clips','motion','issues']);
export function setupStudioHelp({getStatus=()=>'',onNavigate=()=>{}}={}){
 const $=id=>document.getElementById(id);
 const modal=$('studio-help-modal'),body=$('studio-help-body');
 if(!modal||!body)throw Error('Не найдена встроенная инструкция студии');
 const tabs=[...modal.querySelectorAll('[data-help-tab]')];
 const sections=[...modal.querySelectorAll('[data-help-section]')];
 let index=0,returnFocus=null;
 const setTab=(topic)=>{
  const chosen=STUDIO_HELP_TABS.indexOf(topic);
  index=chosen<0?0:chosen;
  tabs.forEach(tab=>{
   const active=tab.dataset.helpTab===STUDIO_HELP_TABS[index];
   tab.classList.toggle('selected',active);
   tab.setAttribute('aria-selected',String(active));
  });
  sections.forEach(section=>{
   section.hidden=section.dataset.helpSection!==STUDIO_HELP_TABS[index];
  });
  $('studio-help-page').textContent=(index+1)+' / '+STUDIO_HELP_TABS.length;
  $('studio-help-prev').disabled=index===0;
  $('studio-help-next').textContent=index===STUDIO_HELP_TABS.length-1?'Готово ✓':'Далее →';
  body.scrollTop=0;
  $('studio-help-status').textContent=String(getStatus());
 };
 const open=(topic='basics')=>{
  if(!modal.hidden){setTab(topic);return;}
  returnFocus=document.activeElement;
  modal.hidden=false;
  document.body.classList.add('studio-help-visible');
  setTab(topic);
  $('close-studio-help').focus();
 };
 const close=()=>{
  if(modal.hidden)return;
  modal.hidden=true;
  document.body.classList.remove('studio-help-visible');
  if(returnFocus?.isConnected&&typeof returnFocus.focus==='function')returnFocus.focus();
 };
 $('open-studio-help').addEventListener('click',()=>open('basics'));
 const start=$('start-help');
 if(start)start.addEventListener('click',()=>open('basics'));
 document.querySelectorAll('[data-open-studio-help]').forEach(button=>{
  button.addEventListener('click',()=>open(button.dataset.openStudioHelp||'basics'));
 });
 $('close-studio-help').addEventListener('click',close);
 modal.addEventListener('click',event=>{if(event.target===modal)close();});
 tabs.forEach(tab=>tab.addEventListener('click',()=>setTab(tab.dataset.helpTab)));
 $('studio-help-prev').addEventListener('click',()=>setTab(STUDIO_HELP_TABS[Math.max(0,index-1)]));
 $('studio-help-next').addEventListener('click',()=>{
  if(index===STUDIO_HELP_TABS.length-1)close();
  else setTab(STUDIO_HELP_TABS[index+1]);
 });
 modal.querySelectorAll('[data-help-target]').forEach(button=>{
  button.addEventListener('click',()=>{
   const id=button.dataset.helpTarget;
   const target=$(id);
   if(!target)return;
   close();
   onNavigate();
   // Scroll after the splash/editor transition has begun.
   requestAnimationFrame(()=>{
    target.scrollIntoView({behavior:'smooth',block:'center',inline:'nearest'});
    const region=target.closest('.panel,.transport,.weapon-clip-preset')||target;
    region.classList.add('studio-help-target-flash');
    setTimeout(()=>region.classList.remove('studio-help-target-flash'),1600);
    if(!target.disabled&&typeof target.focus==='function')target.focus({preventScroll:true});
   });
  });
 });
 document.addEventListener('keydown',event=>{
  if(modal.hidden)return;
  if(event.key==='Escape'){event.preventDefault();close();}
  if(event.key==='Tab'){
   // Keep keyboard focus inside the dialog while the guide is visible.
   const focusable=[...modal.querySelectorAll('button:not([disabled]):not([hidden]),[tabindex="0"]')]
    .filter(node=>node.offsetParent!==null);
   if(!focusable.length)return;
   const first=focusable[0],last=focusable[focusable.length-1];
   if(event.shiftKey&&document.activeElement===first){
    event.preventDefault();last.focus();
   }else if(!event.shiftKey&&document.activeElement===last){
    event.preventDefault();first.focus();
   }
  }
 });
 return {open,close,setTab};
}
