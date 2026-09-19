/* lg-xmb web application, 2026. SPDX-License-Identifier: GPL-3.0-or-later */
(function(){'use strict';
var categories=window.C5Catalog, selectedCategory=Math.max(0,categories.findIndex(function(category){return category.id==='tv';})), selections=categories.map(function(){return 0;}), busy=false, modalOpen=false, lastDirection=0, toastTimer, announceTimer;
var preferences={theme:'midnight',motion:'full',sound:false,previewMode:'cached',waveSpeed:'normal',waveBrightness:'normal',backBehavior:'stay',waveMSAA:0,waveSampling:1.5,waveDetail:'high',waveSoftness:0.75,wavePostprocess:'wave',waveSmoothing:'strong',musicEnabled:false,musicVolume:0.25,waveParticles:true,waveParticleCount:2000,waveFrameRate:60};
var themes={midnight:{name:'Midnight',background:'#050911',wave:'#738acf',accent:'#a7baf3'},ocean:{name:'Ocean',background:'#030e13',wave:'#4da6ab',accent:'#98dfdf'},ember:{name:'Ember',background:'#130906',wave:'#ac6c45',accent:'#eebd96'},forest:{name:'Forest',background:'#040f0b',wave:'#579b7a',accent:'#b0d6bb'},amber:{name:'Amber',background:'#130f05',wave:'#c49a4a',accent:'#e0c998'},rose:{name:'Rose',background:'#13080d',wave:'#b86e8c',accent:'#e6b2c7'},violet:{name:'Violet',background:'#0d0816',wave:'#9678ca',accent:'#c8b5ec'},graphite:{name:'Graphite',background:'#090b0d',wave:'#83939d',accent:'#ccd4d9'},seasonal:{name:'Seasonal',background:'#080813',wave:'#2e2e73',accent:'#b3b3ea'}};
// Monthly colours are adapted from OpenXMB config.json, shell.theme-month-colours.
var monthColours=['#f2e6a6','#9e4540','#4da640','#f299cc','#99cc59','#b399e6','#80d9f2','#3373f2','#2e2e73','#994db3','#cc8040','#e64040'];
var $=function(id){return document.getElementById(id);};
// Preserve stored brightness keys; the old high gain is capped at normal.
try{var saved=JSON.parse(localStorage.getItem('lg-xmb-preferences-v1')||localStorage.getItem('openxmb-c5-preferences-v1')||'{}');if(Object.prototype.hasOwnProperty.call(themes,saved.theme))preferences.theme=saved.theme;if(saved.motion==='reduced'||saved.motion==='full')preferences.motion=saved.motion;else if(matchMedia('(prefers-reduced-motion: reduce)').matches)preferences.motion='reduced';preferences.sound=saved.sound===true;preferences.previewMode=saved.previewMode==='live'?'live':'cached';if(['slow','normal','fast'].indexOf(saved.waveSpeed)!==-1)preferences.waveSpeed=saved.waveSpeed;if(['dim','low','normal'].indexOf(saved.waveBrightness)!==-1)preferences.waveBrightness=saved.waveBrightness;else if(saved.waveBrightness==='high')preferences.waveBrightness='normal';if(saved.backBehavior==='lg')preferences.backBehavior='lg';}catch(ignore){}
// Load quality settings separately from appearance and TV preferences.
if(saved && typeof saved === 'object') {
  if([0,2,4].indexOf(saved.waveMSAA)!==-1)preferences.waveMSAA=saved.waveMSAA;
  if([30,60].indexOf(saved.waveFrameRate)!==-1)preferences.waveFrameRate=saved.waveFrameRate;
  if(typeof saved.waveParticles==='boolean')preferences.waveParticles=saved.waveParticles;
  // 500 was Low until the densities became 1,000 / 2,000 / 4,000.
  if(saved.waveParticleCount===500)preferences.waveParticleCount=1000;
  else if([1000,2000,4000].indexOf(saved.waveParticleCount)!==-1)preferences.waveParticleCount=saved.waveParticleCount;
  preferences.musicEnabled=saved.musicEnabled===true;
  if([0.1,0.25,0.5,0.75,1].indexOf(saved.musicVolume)!==-1)preferences.musicVolume=saved.musicVolume;
  if([1,1.25,1.5,2].indexOf(saved.waveSampling)!==-1)preferences.waveSampling=saved.waveSampling;
  if(['standard','high','fine'].indexOf(saved.waveDetail)!==-1)preferences.waveDetail=saved.waveDetail;
  if([0,0.75,1.5].indexOf(saved.waveSoftness)!==-1)preferences.waveSoftness=saved.waveSoftness;
  if(['off','fxaa','wave'].indexOf(saved.wavePostprocess)!==-1)preferences.wavePostprocess=saved.wavePostprocess;
  if(['gentle','normal','strong'].indexOf(saved.waveSmoothing)!==-1)preferences.waveSmoothing=saved.waveSmoothing;
}
// Keep the requested output at full HD; allocation limits are handled by the renderer.
preferences.waveColors=LGXMBWaveColors.normalize(saved && saved.waveColors);
var wave=new C5Wave($('wave'),{quality:'1080p',adaptive:false});
var inputPreview=new C5InputPreview($('inputPreview'),{isTV:function(){return C5TV.isTV();}});
var thumbnail=new C5Thumbnail($('inputThumbnail'),$('thumbnailFallback'),{isTV:function(){return C5TV.isTV();}});
var categoryTransition=new LGXMBCategoryTransition($('categories'));
var music=new LGXMBBackgroundMusic({enabled:preferences.musicEnabled,volume:preferences.musicVolume,onChange:updateMusicStatus});
var detailItemId=null,detailIcon=null,renderedCategory=-1,launchGeneration=0,pageActive=!document.hidden,musicAway=false,lastReturnAt=-Infinity;
document.querySelector('.input-preview-symbol').innerHTML=C5Icon('hdmi');
document.querySelector('.thumbnail-symbol').innerHTML=C5Icon('hdmi');
var inputLabelRead=null;
var menuOrder=new LGXMBMenuOrder(categories,{getItem:function(k){return localStorage.getItem(k);},setItem:function(k,v){localStorage.setItem(k,v);}}), hold=new LGXMBHoldGesture(), pointerHold=null, suppressHoldClick=false;
var appCategories=new LGXMBAppCategories(categories,menuOrder,{getItem:function(k){return localStorage.getItem(k);},setItem:function(k,v){localStorage.setItem(k,v);}});
var appRefresh=new LGXMBAppRefresh({read:function(){return C5TV.listApps();},
  canApply:function(){return pageActive&&!document.hidden&&!busy&&!musicAway&&!modalOpen&&!hold.state&&!waveOnly&&!itemOptions.removal&&(lastDirection===0||performance.now()-lastDirection>=500);},
  apply:function(apps){var changed=appCategories.reconcile(apps,selections);if(changed){categoryTransition.cancel();buildItems();render();}return changed;}
});
var itemOptions=new LGXMBItemOptions({manager:LGXMBAppManager,sound:tick,
  canHide:function(item){return appCategories.canHide(item);},
  getHidden:function(){return appCategories.hiddenApps();},
  onHide:function(item){appCategories.hide(item,selections);categoryTransition.cancel();},
  onRestore:function(id){appCategories.restore(id,selections);categoryTransition.cancel();},
  canAssign:function(item){return appCategories.canAssign(item);},
  getCategories:function(){return appCategories.choices();},
  getCategory:function(id){return appCategories.get(id);},
  getCategoryLocations:function(id){return appCategories.locations(id);},
  getDefaultCategories:function(id){return appCategories.defaultLocations(id);},
  onCategory:function(item,id){var ci=appCategories.assign(item,id,selections,categories[selectedCategory].id);categoryTransition.cancel();if(ci>=0)selectedCategory=ci;},
  onRefresh:function(){appRefresh.refresh();},
  getSort:function(id){return menuOrder.modes[id];},
  onOpen:function(){document.body.classList.add('item-options-visible');categoryTransition.cancel();clearToast();clearTimeout(detailTimer);detailTimer=0;modalOpen=true;modalType='item-options';document.querySelector('.screen').setAttribute('aria-hidden','true');syncInputPreview();},
  onClose:function(reason){if(directionRepeat)directionRepeat.cancel();document.body.classList.remove('item-options-visible');modalOpen=false;modalType='';document.querySelector('.screen').classList.remove('modal-dimmed');document.querySelector('.screen').removeAttribute('aria-hidden');if(reason!=='lifecycle'&&pageActive&&!document.hidden){$('items').focus();if(reason!=='start'){buildItems();render();}}},
  onStart:function(item){if(currentItem().id===item.id)activate();},
  onSort:function(cat,mode,id){var ci=categories.indexOf(cat);selections[ci]=menuOrder.set(cat,mode,id);buildItems();render();},
  onDeleted:function(id,title){appRefresh.invalidate();appCategories.deleted(id,selections);buildItems();if(pageActive&&!document.hidden){render();toast(title+' was deleted.');}}
});
var dateTimeSettings=new LGXMBDateTimeSettings({api:LGXMBSystemTime,sound:tick,onApplied:function(){updateClock();seasonal();wave.setTheme(Object.assign({},themes[preferences.theme],{colors:preferences.waveColors}));}});
function openItemOptions(){if(busy||modalOpen||waveOnly||!pageActive||document.hidden)return;if(itemOptions.removal){toast('App deletion is still in progress.');return;}itemOptions.open(currentItem(),categories[selectedCategory]);}
function cancelHold(){hold.cancel();pointerHold=null;}
var sounds=new LGXMBMenuSounds({enabled:preferences.sound,onChange:updateSoundStatus});
function tick(kind){sounds.play(kind||'cursor');}
function save(){try{localStorage.setItem('lg-xmb-preferences-v1',JSON.stringify(preferences));}catch(ignore){toast('This device could not save your preference.');}}
function seasonal(){var colour=monthColours[new Date().getMonth()],rgb=colour.match(/[a-f0-9]{2}/gi).map(function(x){return parseInt(x,16);});themes.seasonal.wave=colour;themes.seasonal.background='#'+rgb.map(function(v){return Math.max(3,Math.round(v*.07)).toString(16).padStart(2,'0');}).join('');themes.seasonal.accent='#'+rgb.map(function(v){return Math.round(v*.45+255*.55).toString(16).padStart(2,'0');}).join('');}
function applyPreferences(){sounds.setEnabled(preferences.sound);if(preferences.motion==='reduced')categoryTransition.cancel();seasonal();var theme=themes[preferences.theme];document.documentElement.style.setProperty('--accent','#ffffff');document.documentElement.style.setProperty('--accent-rgb','255,255,255');document.documentElement.style.setProperty('--background',theme.background);document.documentElement.style.setProperty('--background-rgb',theme.background.match(/[a-f0-9]{2}/gi).map(function(x){return parseInt(x,16);}).join(','));document.body.classList.toggle('reduced-motion',preferences.motion==='reduced');wave.setTheme(Object.assign({},theme,{colors:preferences.waveColors}));wave.setStyle({speed:{slow:0.5,normal:1.5,fast:2.25}[preferences.waveSpeed],brightness:{dim:0.3,low:0.6,normal:1}[preferences.waveBrightness]});wave.setQuality({frameRate:preferences.waveFrameRate,msaa:preferences.waveMSAA,sampling:preferences.waveSampling,detail:preferences.waveDetail,softness:preferences.waveSoftness,postprocess:preferences.wavePostprocess,strength:preferences.waveSmoothing,particles:preferences.waveParticles,particleCount:preferences.waveParticleCount});wave.setReducedMotion(preferences.motion==='reduced');}
function toast(message){$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(function(){$('toast').classList.remove('show');},4200);}
function clearToast(){clearTimeout(toastTimer);$('toast').classList.remove('show');if($('toast').textContent)$('toast').textContent='';}
var recentOrderDirty=false;
function recordRecent(item){menuOrder.record(item.id);recentOrderDirty=true;}
function refreshRecent(){
  if(!recentOrderDirty)return;recentOrderDirty=false;var changed=false;
  categories.forEach(function(cat,ci){if(menuOrder.modes[cat.id]==='recent'){var before=cat.items.map(function(i){return i.id;}).join('|');selections[ci]=menuOrder.apply(cat,cat.items[selections[ci]]&&cat.items[selections[ci]].id);if(before!==cat.items.map(function(i){return i.id;}).join('|'))changed=true;}});
  if(changed){buildItems();renderRows(selectedCategory);$('items').setAttribute('aria-activedescendant','item-'+selections[selectedCategory]);}
}
function invalidateLaunch(){launchGeneration++;busy=false;$('items').removeAttribute('aria-busy');}
function currentItem(){return categories[selectedCategory].items[selections[selectedCategory]];}
function currentPort(){var item=currentItem(),match=item.action==='input'&&/^com\.webos\.app\.hdmi([1-4])$/.exec(item.id);return match?Number(match[1]):null;}
function stopInputPreview(){inputPreview.stop();$('previewPanel').classList.remove('live-preview');}
function syncInputPreview(){var port=currentPort(),shown=!!port&&!modalOpen,active=shown&&pageActive&&!document.hidden&&!busy,live=active&&preferences.previewMode==='live';document.querySelector('.detail').classList.toggle('has-input-preview',shown);$('previewPanel').hidden=!shown;$('previewPanel').classList.toggle('live-preview',live);$('previewButton').setAttribute('aria-label','Open '+currentItem().title+' full-screen');if(!active||live){thumbnail.setPaused(true);thumbnail.select(shown?port:null);}else{thumbnail.select(port);thumbnail.setPaused(false);}if(live){music.setContext(pageActive&&!busy&&!musicAway,C5TV.isTV());inputPreview.select(port);}else{inputPreview.stop();music.setContext(pageActive&&!busy&&!musicAway,false);}}
function renderDetailText(){
  var item=currentItem();
  // Labels can change while the selected physical input stays the same.
  if($('detailType').textContent!==item.type)$('detailType').textContent=item.type;
  if($('detailTitle').textContent!==item.title)$('detailTitle').textContent=item.title;
  if($('detailDescription').textContent!==item.description)$('detailDescription').textContent=item.description;
  if(detailIcon!==item.icon){$('detailEmblem').innerHTML=C5Icon(item.icon);detailIcon=item.icon;}
  detailItemId=item.id;
  $('previewButton').setAttribute('aria-label','Open '+item.title+' full-screen');
}
// Delay detail text by 140 ms so rapid navigation repaints it once,
// separately from the moving rows.
var detailTimer=0;
function renderDetail(){clearTimeout(detailTimer);detailTimer=0;renderDetailText();syncInputPreview();}
// Only the text waits. The preview has to hear about the new row at once, cause
// leaving an HDMI row must stop a live preview immediately.
function scheduleDetail(){clearTimeout(detailTimer);detailTimer=setTimeout(function(){detailTimer=0;renderDetailText();},140);syncInputPreview();}
function buildCategories(){var nav=$('categories');categories.forEach(function(cat,index){var b=document.createElement('button');b.className='category';b.style.transform='translateX(calc(-50% + '+(index*LGXMBCategoryTransition.DISTANCE)+'vw))';b.setAttribute('aria-label',cat.title);b.setAttribute('data-category',cat.id);var face='<span class="category-icon">'+C5Icon(cat.icon)+'</span><span class="category-label"></span>';b.innerHTML='<span class="face dim">'+face+'</span><span class="face lit" aria-hidden="true">'+face+'<i class="category-dot"></i></span>';[].forEach.call(b.querySelectorAll('.category-label'),function(label){label.textContent=cat.title;});b.addEventListener('click',function(){if(!busy)selectCategory(index);});nav.appendChild(b);});}
// Retain painted category rows off-screen so switching categories can move
// existing layers instead of rebuilding and rasterising their text.
var itemButtons = new WeakMap(), itemOffsets = new WeakMap(), itemLists = [], itemListKeys = [];
function buildItems(){
  var list=$('items');list.setAttribute('aria-label',categories[selectedCategory].title);
  categories.forEach(function(cat,ci){
    var wrap=itemLists[ci],key=cat.items.map(function(item){return item.id;}).join('|');
    if(!wrap){wrap=document.createElement('div');wrap.className='rows';wrap.setAttribute('role','none');wrap.setAttribute('data-category',cat.id);list.appendChild(wrap);itemLists[ci]=wrap;}
    if(itemListKeys[ci]!==key){
      wrap.textContent='';
      cat.items.forEach(function(item){
        var b=itemButtons.get(item);
        if(!b){
          b=document.createElement('button');b.className='item';b.setAttribute('role','option');b.setAttribute('data-item',item.id);b.tabIndex=-1;
          b.innerHTML='<span class="item-icon">'+C5Icon(item.icon)+'</span><span class="item-text"></span>';
          b.addEventListener('click',function(){
            if(busy||modalOpen||!pageActive||document.hidden)return;
            cancelHold();
            var current=categories[selectedCategory].items.indexOf(item);if(current<0)return;
            selections[selectedCategory]=current;render();activate();
          });
          itemButtons.set(item,b);
        }
        itemOffsets.delete(b);wrap.appendChild(b);
      });
      itemListKeys[ci]=key;
    }
    var active=ci===selectedCategory;
    if(wrap.classList.contains('parked')===active){
      wrap.classList.toggle('parked',!active);wrap.setAttribute('aria-hidden',active?'false':'true');
    }
    [].forEach.call(wrap.children,function(b,index){
      var item=cat.items[index],id=active?'item-'+index:'';
      // Only the active list owns the item-N ids the listbox points at.
      if(b.id!==id){if(id)b.id=id;else b.removeAttribute('id');}
      // Input labels may have refreshed since this row was last built.
      if(b.getAttribute('aria-label')!==item.title){b.setAttribute('aria-label',item.title);b.querySelector('.item-text').textContent=item.title;}
    });
    // A parked list is kept in its remembered state, so showing it changes nothing.
    if(!active)renderRows(ci);
  });
}
function render(deferDetail){
  var index=selections[selectedCategory];
  // Up/down does not change the horizontal bar. Leave its styles, accessibility
  // attributes and any in-flight CSS transition alone.
  if(renderedCategory!==selectedCategory){
    $('categories').style.transform='translate3d('+(-selectedCategory*LGXMBCategoryTransition.DISTANCE)+'vw,0,0)';
    [].forEach.call($('categories').children,function(button,i){
      var offset=i-selectedCategory;
      button.classList.toggle('active',offset===0);
      // Dim through colour alpha, not element opacity: on the C5 a change to
      // a text element's opacity cost a dropped frame per key press, colour
      // is a plain repaint. Never transition it, that repaints every frame.
      button.setAttribute('aria-current',offset===0?'true':'false');
      button.tabIndex=offset===0?0:-1;
    });
    renderedCategory=selectedCategory;
  }
  renderRows(selectedCategory);
  var active='item-'+index;
  if($('items').getAttribute('aria-activedescendant')!==active)$('items').setAttribute('aria-activedescendant',active);
  if(deferDetail===true)scheduleDetail();else renderDetail();
  announceSelection();
  wave.setMenuObjects(menuObjects());
}
// Where the moving menu objects are headed, in Y-up NDC, for the particles'
// icon wind. These are layout constants, not measurements: reading the page's
// geometry every frame is exactly the work the C5 can't spare. The renderer
// animates towards them with the console's own position curve.
function menuObjects(){
  var out=[],index=selections[selectedCategory],rows=categories[selectedCategory].items.length;
  categories.forEach(function(cat,i){out.push({id:'c'+i,x:(31+(i-selectedCategory)*LGXMBCategoryTransition.DISTANCE)/50-1,y:1-32.6/50});});
  for(var i=Math.max(0,index-3);i<=Math.min(rows-1,index+3);i++){
    var offset=i-index;
    out.push({id:'r'+selectedCategory+':'+i,x:31/50-1,y:1-(52+offset*8.4-(offset<0?25:0)+3.25)/50});
  }
  return out;
}
function renderRows(ci){
  var index=selections[ci];
  [].forEach.call(itemLists[ci]?itemLists[ci].children:[],function(button,i){
    var offset=i-index,previous=itemOffsets.get(button);
    if(previous===offset)return;
    var first=previous===undefined,visible=offset>=-3&&offset<=3;
    button.style.setProperty('--item-y',(offset*8.4-(offset<0?25:0))+'vh');
    if(first||(previous<0)!==(offset<0))button.classList.toggle('above-bar',offset<0);
    if(first||(previous===0)!==(offset===0)){
      button.classList.toggle('selected',offset===0);
      button.setAttribute('aria-selected',offset===0?'true':'false');
    }
    if(first||visible!==(previous>=-3&&previous<=3)){
      button.style.visibility=visible?'visible':'hidden';
      button.setAttribute('aria-hidden',visible?'false':'true');
    }
    var itemAlpha=!visible?'0':offset===0?'1':'.5';
    if(button.style.getPropertyValue('--item-alpha')!==itemAlpha)button.style.setProperty('--item-alpha',itemAlpha);
    itemOffsets.set(button,offset);
  });
}
function announceSelection(){
  var cat=categories[selectedCategory],index=selections[selectedCategory],item=cat.items[index];
  clearTimeout(announceTimer);
  announceTimer=setTimeout(function(){
    $('selectionLive').textContent=cat.title+', '+item.title+', '+(index+1)+' of '+cat.items.length;
  },180);
}
function selectCategory(index){
  if(busy||modalOpen||!pageActive||document.hidden)return;
  if(index===selectedCategory)return;
  cancelHold();
  var direction=index-selectedCategory;
  categoryTransition.change(direction,function(){
    selectedCategory=index;buildItems();render(true);
  },preferences.motion==='full');
  wave.navigated(direction>0?'right':'left');
  tick('category');
}
function navigate(direction){
  if(busy||!pageActive||document.hidden)return;
  cancelHold();
  var next;
  if(direction==='left'||direction==='right'){
    next=Math.max(0,Math.min(categories.length-1,selectedCategory+(direction==='right'?1:-1)));
    selectCategory(next);return;
  }
  next=Math.max(0,Math.min(categories[selectedCategory].items.length-1,selections[selectedCategory]+(direction==='down'?1:-1)));
  if(next===selections[selectedCategory])return;
  selections[selectedCategory]=next;render(true);wave.navigated(direction);tick();
}
function row(label,colour,isSelected,handler,parent){var button=document.createElement('button');button.className='option';button.setAttribute('aria-pressed',String(isSelected));var labelSpan=document.createElement('span');if(colour){var swatch=document.createElement('i');swatch.className='swatch';swatch.style.background=colour;labelSpan.appendChild(swatch);}labelSpan.appendChild(document.createTextNode(label));button.appendChild(labelSpan);var mark=document.createElement('span');mark.className='option-check';mark.setAttribute('aria-hidden','true');mark.textContent=isSelected?'✓':'';button.appendChild(mark);button.addEventListener('click',function(){var previousModal=modalType;handler();tick(previousModal!==modalType?'option':'decide');});(parent||$('modalContent')).appendChild(button);return button;}
function selectChoice(parent,value){[].forEach.call(parent.querySelectorAll('[data-choice]'),function(button){var chosen=button.getAttribute('data-choice')===String(value);if(button.getAttribute('aria-pressed')!==String(chosen)){button.setAttribute('aria-pressed',String(chosen));button.querySelector('.option-check').textContent=chosen?'✓':'';}});}
function choiceGroup(label,choices,value,handler){var group=document.createElement('section');group.className='choice-group';group.setAttribute('role','group');group.setAttribute('aria-label',label);var title=document.createElement('h3');title.textContent=label;group.appendChild(title);var options=document.createElement('div');options.className='choice-options';group.appendChild(options);choices.forEach(function(choice){var button=row(choice[1],null,value===choice[0],function(){handler(choice[0]);selectChoice(options,choice[0]);},options);button.setAttribute('data-choice',choice[0]);});$('modalContent').appendChild(group);return group;}
var modalType='';
function openModal(type){if(directionRepeat)directionRepeat.cancel();cancelHold();categoryTransition.cancel();if(!modalOpen||modalType!==type)clearToast();if(modalType==='remote')C5RemoteSettings.close();if(modalType==='datetime')dateTimeSettings.close();stopInputPreview();modalType=type;$('modal').classList.toggle('waves-settings',type==='appearance'||type==='sound'||type==='wave-colors');$('modal').classList.toggle('appearance-settings',type==='appearance');modalOpen=true;syncInputPreview();document.querySelector('.screen').setAttribute('aria-hidden','true');$('modalBackdrop').hidden=false;$('modalContent').textContent='';$('modalContent').classList.remove('theme-options');$('modalTitle').textContent={datetime:'Date & time',appearance:'Appearance',theme:'Theme','wave-colors':'Wave colours',sound:'Sound',previews:'Input previews',remote:'Back button'}[type];$('modalIntro').textContent={datetime:'',appearance:'',theme:'','wave-colors':'',sound:'',previews:'',remote:''}[type];
if(type==='theme'){$('modalContent').classList.add('theme-options');Object.keys(themes).forEach(function(key){var button=row(themes[key].name,key==='seasonal'?monthColours[new Date().getMonth()]:themes[key].wave,preferences.theme===key,function(){preferences.theme=key;applyPreferences();save();selectChoice($('modalContent'),key);});button.setAttribute('data-choice',key);});}
else if(type==='appearance'){row('Theme',null,false,function(){openModal('theme');}).id='openTheme';openWaveSettings();}
else if(type==='datetime'){dateTimeSettings.open($('modalContent'));}
else if(type==='wave-colors'){LGXMBWaveColorSettings.open($('modalContent'),preferences.waveColors,function(value){preferences.waveColors=value;wave.setTheme(Object.assign({},themes[preferences.theme],{colors:value}));save();});}
else if(type==='sound'){openSoundSettings();}
else if(type==='previews'){[['cached','Cached'],['live','Live']].forEach(function(choice){var button=row(choice[1],null,preferences.previewMode===choice[0],function(){if(preferences.previewMode===choice[0])return;preferences.previewMode=choice[0];save();selectChoice($('modalContent'),choice[0]);updateHelperStatus();});button.setAttribute('data-choice',choice[0]);});helperStatusPanel();}
else if(type==='remote'){C5RemoteSettings.open({getBack:function(){return preferences.backBehavior;},setBack:function(value){if(['stay','lg'].indexOf(value)===-1)throw new Error('Choose a valid Back button setting.');var next=Object.assign({},preferences,{backBehavior:value});try{localStorage.setItem('lg-xmb-preferences-v1',JSON.stringify(next));}catch(ignore){throw new Error('This device could not save the Back button setting.');}preferences.backBehavior=value;}});}
var chosen=(type==='appearance'&&$('openTheme'))||(type==='datetime'&&$('modalContent').querySelector('.date-time-value'))||$('modalContent').querySelector('[aria-pressed="true"]')||$('modalContent').querySelector('button')||$('modal');LGXMBMenuFocus(chosen);}
// Hide with visibility to avoid text-opacity compositing on the C5.
// Ignore navigation while hidden so the menu retains its selection.
var waveOnly=false;
function setWaveOnly(on){
  on=on===true;if(waveOnly===on)return;
  if(on&&modalOpen)closeModal(true);
  waveOnly=on;document.body.classList.toggle('wave-only',on);
  if(on)toast('Press Back to return.');else{clearToast();$('items').focus();}
}
// Avoid replacing identical text nodes on repeated service/status callbacks.
function statusText(node,text){if(node.textContent!==text)node.textContent=text;}
function reserveAction(button){var slot=document.createElement('div');slot.className='menu-action-slot';button.parentNode.insertBefore(slot,button);slot.appendChild(button);}
function updateSoundStatus(){
  var status=$('soundStatus');if(!status||!sounds)return;
  var state=sounds.getState();
  var message=state.enabled&&state.phase==='unsupported'?'Navigation sound unavailable.':'';
  statusText(status,message);
}
function openSoundSettings(){
  choiceGroup('Navigation sound',[[false,'Off'],[true,'On']],preferences.sound,function(value){
    preferences.sound=value;sounds.setEnabled(value);save();updateSoundStatus();
  });
  openMusicSettings();
  var status=document.createElement('p');status.id='soundStatus';status.className='wave-quality-note';status.setAttribute('role','status');$('modalContent').appendChild(status);
  var reload=row('Reload sounds',null,false,function(){sounds.retry();updateSoundStatus();});reload.id='reloadSounds';
  $('modalContent').insertBefore(reload,$('musicStatus'));
  $('modalContent').appendChild(status);
  updateSoundStatus();
}
function openWaveSettings(){
  var colorButton=row('Wave colours',null,false,function(){openModal('wave-colors');});colorButton.id='openWaveColors';
  row('Show waves full screen',null,false,function(){setWaveOnly(true);}).id='showWavesOnly';
  choiceGroup('Animation',[['full','On'],['reduced','Off']],preferences.motion,function(value){preferences.motion=value;applyPreferences();save();});
  choiceGroup('Speed',[['slow','Slow'],['normal','Normal'],['fast','Fast']],preferences.waveSpeed,function(value){preferences.waveSpeed=value;applyPreferences();save();});
  choiceGroup('Brightness',[['dim','Low'],['low','Medium'],['normal','High']],preferences.waveBrightness,function(value){preferences.waveBrightness=value;applyPreferences();save();});
  function qualityChoice(label,choices,key){
    choiceGroup(label,choices,preferences[key],function(value){
      preferences[key]=value;
      wave.setQuality({frameRate:preferences.waveFrameRate,msaa:preferences.waveMSAA,sampling:preferences.waveSampling,detail:preferences.waveDetail,softness:preferences.waveSoftness,postprocess:preferences.wavePostprocess,strength:preferences.waveSmoothing,particles:preferences.waveParticles,particleCount:preferences.waveParticleCount});
      save();
    });
  }
  // An unsupported level is never rounded up, so offering one the driver cannot
  // allocate renders with no MSAA at all and reads as a broken setting. The C5
  // reports 4x only, so 2x is withheld there instead of silently doing nothing.
  function msaaChoices(){
    var surface=wave.getDiagnostics().surface,supported=surface?surface.msaaSupported:null;
    var choices=[[0,'Off']];
    [2,4].forEach(function(n){if(!supported||supported.indexOf(n)!==-1)choices.push([n,n+'×']);});
    if(preferences.waveMSAA&&!choices.some(function(choice){return choice[0]===preferences.waveMSAA;})){
      // Match what the renderer was already doing with an unsupported request.
      preferences.waveMSAA=0;save();
    }
    return choices;
  }
  qualityChoice('Frame rate',[[60,'60 fps'],[30,'30 fps']],'waveFrameRate');
  qualityChoice('MSAA',msaaChoices(),'waveMSAA');
  qualityChoice('Supersampling',[[1,'Off'],[1.25,'1.25×'],[1.5,'1.5×'],[2,'2×']],'waveSampling');
  qualityChoice('Mesh detail',[['standard','Reduced'],['high','Original'],['fine','Original (legacy)']],'waveDetail');
  qualityChoice('Edge softness',[[0,'Sharp'],[0.75,'Subtle'],[1.5,'Soft']],'waveSoftness');
  qualityChoice('Particles',[[true,'On'],[false,'Off']],'waveParticles');
  // The emitter has a 4,096-slot pool; density limits the live population.
  qualityChoice('Particle density',[[1000,'Low'],[2000,'Medium'],[4000,'High']],'waveParticleCount');
  qualityChoice('Post-process antialiasing',[['off','Off'],['fxaa','FXAA'],['wave','Wave FXAA']],'wavePostprocess');
  qualityChoice('Smoothing strength',[['gentle','Gentle'],['normal','Normal'],['strong','Strong']],'waveSmoothing');

}
// The Home identity's audio is never connected by the TV, see connectMusicAudio.
// The pipeline can show up a moment after the element says it's playing, so
// one miss gets one more try.
var musicConnectTimer=0,musicPhase='',musicRouteEpoch=0,musicRouteError='';
function connectMusic(again){
  clearTimeout(musicConnectTimer);
  var epoch=musicRouteEpoch,generation=music.getState().generation;
  function current(){return epoch===musicRouteEpoch&&music.allowed()&&music.getState().generation===generation&&music.getState().phase==='playing';}
  C5TV.connectMusicAudio(current).then(function(result){
    if(!current())return;
    if(result&&result.reason==='no-pipeline'){
      if(again)musicConnectTimer=setTimeout(function(){if(current())connectMusic(false);},2000);
      else{musicRouteError='Audio unavailable. Retry playback.';updateMusicStatus();}
    }
  }).catch(function(){if(current()){musicRouteError='Audio unavailable. Retry playback.';updateMusicStatus();}});
}
function updateMusicStatus(){
  if(music){var phase=music.getState().phase;if(phase!==musicPhase){musicRouteEpoch++;clearTimeout(musicConnectTimer);musicRouteError='';if(phase==='playing')connectMusic(true);}musicPhase=phase;}
  var status=$('musicStatus'),retry=$('retryMusic');if(!status||!music)return;
  var state=music.getState();
  var message=musicRouteError||{blocked:'Choose Retry playback.',
    unavailable:state.failure&&state.failure.kind==='media'&&(state.failure.code===3||state.failure.code===4)?
      'Check the MP3 at /media/internal/lg-xmb/background.mp3.':'Music unavailable. Retry playback.'}[state.phase]||'';
  statusText(status,message);
  if(retry){
    var hide=state.phase!=='blocked'&&state.phase!=='unavailable'&&!musicRouteError;
    if(hide&&document.activeElement===retry){var choice=$('modalContent').querySelector('[aria-pressed="true"]');if(choice)LGXMBMenuFocus(choice);}
    retry.hidden=hide;
  }
}
function openMusicSettings(){
  choiceGroup('Background music',[[true,'On'],[false,'Off']],preferences.musicEnabled,function(value){
    preferences.musicEnabled=value;music.setEnabled(value);save();updateMusicStatus();
  });
  choiceGroup('Music volume',[[0.1,'10%'],[0.25,'25%'],[0.5,'50%'],[0.75,'75%'],[1,'100%']],preferences.musicVolume,function(value){
    preferences.musicVolume=value;music.setVolume(value);save();
  });
  var status=document.createElement('p');status.id='musicStatus';status.className='wave-quality-note';status.setAttribute('role','status');
  $('modalContent').appendChild(status);
  var retry=row('Retry playback',null,false,function(){music.retry();updateMusicStatus();});retry.id='retryMusic';reserveAction(retry);
  updateMusicStatus();
}
// Bubble after navigation/launch handlers, so a gesture that leaves Home cannot
// revive an autoplay-blocked track on the way out.
function musicGesture(event){
  // This dialog has an explicit retry. Arrow navigation must not hide the
  // focused retry button by starting a new autoplay attempt on every key.
  if(!modalOpen||modalType!=='sound')music.gesture(event);
}
window.addEventListener('keydown',musicGesture);
window.addEventListener('click',musicGesture);
function updateHelperStatus(){
  var status=$('helperStatus'),retry=$('retryHelper');
  if(!status||!window.LGXMBHelper)return;
  var state=LGXMBHelper.getState();
  var health=state.captureHealth, cached=preferences.previewMode==='cached';
  var message=cached?{stale:'Cached preview helper is not responding.',stopped:'Cached preview helper stopped.',skipped:'Cached preview could not be updated.',unknown:state.phase==='failed'?'Helper setup could not be confirmed.':''}[health]||'':'';
  statusText(status,message);
  if(retry)retry.hidden=!message;

}
function helperStatusPanel(){
  if(!C5TV.isTV()||!window.LGXMBHelper)return;
  var status=document.createElement('p');status.id='helperStatus';status.className='modal-intro';status.setAttribute('role','status');$('modalContent').appendChild(status);
  var retry=row('Retry helper setup',null,false,function(){LGXMBHelper.retry().then(function(){return LGXMBHelper.checkCapture();},function(){return LGXMBHelper.checkCapture();}).then(updateHelperStatus);});retry.id='retryHelper';reserveAction(retry);LGXMBHelper.checkCapture().then(updateHelperStatus);updateHelperStatus();
}
function startHelper(){
  if(!C5TV.isTV()||!window.LGXMBHelper)return;
  var generation=launchGeneration;
  LGXMBHelper.ensure().then(function(){
    // The aliases may have appeared after the first attempted preload.
    if(preferences.sound)sounds.retry();
    if(pageActive&&!document.hidden&&!busy&&generation===launchGeneration&&currentPort()&&preferences.previewMode==='cached')thumbnail.refresh();
  },function(){/* Settings show the specific setup error; navigation stays usable. */});
}
document.addEventListener('lg-xmb-helper-status',updateHelperStatus);
function closeModal(quiet){if(directionRepeat)directionRepeat.cancel();if(itemOptions.opened){itemOptions.close(quiet===true?'lifecycle':'back');return;}if(quiet!==true)tick('cancel');if(modalType==='wave-colors'||modalType==='theme'){var returnId=modalType==='theme'?'openTheme':'openWaveColors';openModal('appearance');LGXMBMenuFocus($(returnId));return;}if(modalType==='remote')C5RemoteSettings.close();if(modalType==='datetime')dateTimeSettings.close();modalOpen=false;$('modalBackdrop').hidden=true;document.querySelector('.screen').classList.remove('modal-dimmed');document.querySelector('.screen').removeAttribute('aria-hidden');$('items').focus();refreshRecent();renderDetail();}
function modalKey(event){
  if(event.key==='Escape'||event.key==='Backspace'||event.keyCode===461){event.preventDefault();closeModal();return;}
  if(modalType==='datetime'){dateTimeSettings.key(event);return;}
  if(modalType==='wave-colors'){LGXMBWaveColorSettings.key(event,$('modal'));return;}
  var current=document.activeElement,controls=Array.from($('modal').querySelectorAll('button')).filter(function(b){return !b.closest('[hidden]');});
  var group=current.closest&&current.closest('.choice-group'),target;
  if(event.key==='Tab'){
    target=controls[(Math.max(controls.indexOf(current),0)+(event.shiftKey?-1:1)+controls.length)%controls.length];
  }else if(/^Arrow/.test(event.key)){
    var horizontal=event.key==='ArrowLeft'||event.key==='ArrowRight',delta=event.key==='ArrowDown'||event.key==='ArrowRight'?1:-1;
    if(horizontal&&group){
      var choices=Array.from(group.querySelectorAll('button'));
      target=choices[(choices.indexOf(current)+delta+choices.length)%choices.length];
    }else{
      // Each horizontal choice group is one row; standalone actions retain
      // their DOM order, including actions before and after those groups.
      var rows=[];
      controls.forEach(function(b){var row=b.closest('.choice-group')||b;if(rows.indexOf(row)<0)rows.push(row);});
      var at=rows.indexOf(group||current),next=Math.max(0,Math.min(rows.length-1,at+delta));
      if(next===at){event.preventDefault();return;}
      var row=rows[next];
      target=row&&(row.matches('button')?row:row.querySelector('[aria-pressed="true"]')||row.querySelector('button'));
    }
  }else return;
  event.preventDefault();if(target&&target!==current){LGXMBMenuFocus(target);tick();}
}
async function activate(){if(busy||!pageActive||document.hidden||itemOptions.opened)return;if(itemOptions.removal){toast('App deletion is still in progress.');return;}cancelHold();if(currentItem().action==='empty')return;categoryTransition.cancel();var item=currentItem();if(['appearance','sound','previews','remote','datetime'].indexOf(item.action)!==-1){tick('option');openModal(item.action);recordRecent(item);return;}tick('decide');var generation=++launchGeneration;clearToast();busy=true;musicAway=true;syncInputPreview();var launched=false;$('items').setAttribute('aria-busy','true');try{var result=item.action==='input'?await C5TV.openInput(item.id):await C5TV.launch(item.id);if(!result.preview){recordRecent(item);if(generation!==launchGeneration&&pageActive&&!document.hidden&&!busy&&!modalOpen)refreshRecent();}if(generation!==launchGeneration||!pageActive||document.hidden)return;launched=!result.preview;if(result.preview)toast('Preview · '+item.title+' opens on your TV.');}catch(error){if(generation===launchGeneration&&pageActive&&!document.hidden){tick('error');toast('Could not open '+item.title+'. '+(error.message||'Please try again.'));}}finally{if(generation===launchGeneration){busy=false;$('items').removeAttribute('aria-busy');if(!launched&&pageActive&&!document.hidden){musicAway=false;renderDetail();$('items').focus();}}}}
function back(){if(modalOpen){closeModal();return;}if(preferences.backBehavior!=='lg'||busy||!pageActive||document.hidden)return;tick('cancel');var generation=++launchGeneration;C5TV.platformBack().catch(function(error){if(generation===launchGeneration&&pageActive&&!document.hidden)toast(error.message||'Could not open the TV exit prompt.');});}
// Main-menu activation happens on release; otherwise a long OK would launch
// the app before the options timer had a chance to fire.
var directionRepeat=new LGXMBDirectionalRepeat({onDirection:handleKey});
function handleKey(event){
  if(!pageActive||document.hidden){directionRepeat.cancel();return;}
  var isActivate=event.key==='Enter'||event.keyCode===13,isBack=event.key==='Escape'||event.key==='Backspace'||event.keyCode===461;
  if(!pointerHold)suppressHoldClick=false;
  if(waveOnly){event.preventDefault();if(isBack&&!event.repeat)setWaveOnly(false);return;}
  if(isActivate&&hold.state){event.preventDefault();return;}
  if(itemOptions.opened){itemOptions.key(event);return;}
  if(event.repeat&&(isActivate||isBack)){event.preventDefault();return;}
  if(modalOpen){modalKey(event);return;}
  if(event.key==='ContextMenu'||event.key==='F2'){event.preventDefault();cancelHold();if(!event.repeat)openItemOptions();return;}
  var direction={ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down'}[event.key];
  if(direction){event.preventDefault();cancelHold();lastDirection=performance.now();navigate(direction);if(document.activeElement!==$('items'))$('items').focus();}
  else if(isActivate){
    event.preventDefault();if(busy||!pageActive||document.hidden)return;if(itemOptions.removal){toast('App deletion is still in progress.');return;}
    var identity=categories[selectedCategory].id+':'+currentItem().id;
    function stillSelected(){return identity===categories[selectedCategory].id+':'+currentItem().id;}
    itemOptions.prepare(currentItem(),categories[selectedCategory]);
    hold.down('key',function(){if(stillSelected())activate();},function(){if(stillSelected())openItemOptions();});
  }else if(isBack){event.preventDefault();cancelHold();back();}
}
document.addEventListener('keydown',function(event){
  if(!pageActive||document.hidden){directionRepeat.cancel();return;}
  directionRepeat.interval=!modalOpen&&/^Arrow(Up|Down)$/.test(event.key)?60:100;
  if(directionRepeat.handle(event))return;
  // An action changes the target of navigation; never deliver an old arrow afterward.
  directionRepeat.cancel();handleKey(event);
});

document.addEventListener('keyup',function(event){directionRepeat.keyup(event);if(event.key==='Enter'||event.keyCode===13){event.preventDefault();hold.up('key');}});
window.addEventListener('blur',function(){directionRepeat.cancel();});
// Holding an item with the Magic Remote, mouse or touch uses the same timer.
function pointerItem(target){return target.closest&&target.closest('#items>.rows:not(.parked)>.item');}
document.addEventListener('pointerdown',function(e){
  directionRepeat.cancel();
  suppressHoldClick=false;
  if(e.button!==0||e.isPrimary===false||busy||modalOpen||waveOnly||!pageActive||document.hidden)return;
  var b=pointerItem(e.target);if(!b)return;
  var index=categories[selectedCategory].items.findIndex(function(i){return i.id===b.dataset.item;});if(index<0)return;
  cancelHold();selections[selectedCategory]=index;render();
  pointerHold={id:e.pointerId,x:e.clientX,y:e.clientY};
  itemOptions.prepare(currentItem(),categories[selectedCategory]);
  hold.down('pointer',function(){},function(){suppressHoldClick=true;openItemOptions();});
},true);
document.addEventListener('pointermove',function(e){if(pointerHold&&e.pointerId===pointerHold.id&&Math.hypot(e.clientX-pointerHold.x,e.clientY-pointerHold.y)>12){suppressHoldClick=true;cancelHold();}},true);
document.addEventListener('pointerup',function(e){if(pointerHold&&e.pointerId===pointerHold.id){hold.up('pointer');pointerHold=null;}},true);
document.addEventListener('pointercancel',function(){suppressHoldClick=true;cancelHold();},true);
document.addEventListener('click',function(e){if(suppressHoldClick){suppressHoldClick=false;e.preventDefault();e.stopImmediatePropagation();}},true);
document.addEventListener('contextmenu',function(e){
  if(itemOptions.opened){e.preventDefault();return;}
  if(modalOpen||waveOnly||busy||!pageActive||document.hidden)return;
  var b=pointerItem(e.target);if(!b&&!$('items').contains(e.target))return;
  e.preventDefault();cancelHold();
  if(b){var at=categories[selectedCategory].items.findIndex(function(i){return i.id===b.dataset.item;});if(at>=0){selections[selectedCategory]=at;render();}}
  suppressHoldClick=true;openItemOptions();
});
window.addEventListener('blur',cancelHold);
document.addEventListener('click',function(event){if(waveOnly){event.preventDefault();event.stopPropagation();setWaveOnly(false);}},true);
document.addEventListener('wheel',function(event){if(waveOnly){event.preventDefault();return;}if(modalOpen){if(itemOptions.opened&&itemOptions.panel.contains(event.target))return;if($('modal').contains(event.target))return;event.preventDefault();return;}event.preventDefault();if(busy||Math.abs(event.deltaY)<2)return;var now=performance.now();if(now-lastDirection<130)return;lastDirection=now;navigate(event.deltaY>0?'down':'up');},{passive:false});
$('modalBackdrop').addEventListener('click',function(event){if(event.target===$('modalBackdrop'))closeModal();});
$('previewButton').addEventListener('click',function(){if(busy||modalOpen)return;activate();});
var themeMonth=new Date().getMonth();
function updateClock(){var now=new Date();if(themeMonth!==now.getMonth()){themeMonth=now.getMonth();if(preferences.theme==='seasonal'){seasonal();wave.setTheme(Object.assign({},themes.seasonal,{colors:preferences.waveColors}));}}var time=now.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:false}),date=now.toLocaleDateString('en-GB',{weekday:'short',day:'2-digit',month:'short'});if($('time').textContent!==time){$('time').textContent=time;$('time').dateTime=now.toISOString();}if($('date').textContent!==date)$('date').textContent=date;}
function restoreFocus(){if(itemOptions.opened){if(!itemOptions.panel.contains(document.activeElement))itemOptions.focus();return;}if(modalOpen){if(!$('modal').contains(document.activeElement)){var control=$('modalContent').querySelector('[aria-pressed="true"]')||$('modalContent').querySelector('button')||$('modal');LGXMBMenuFocus(control);}}else if(document.activeElement!==$('items'))$('items').focus();}
async function refreshInputLabels(){
  if(!pageActive||document.hidden||inputLabelRead)return;
  var read;
  try{
    read=C5TV.listInputLabels();
    inputLabelRead=read;
    var result=await read;
    if(inputLabelRead!==read||!pageActive||document.hidden||result.preview)return;
    var inputCategory=categories.find(function(category){return category.id==='tv';});
    if(!inputCategory)return;
    var visible=categories[selectedCategory]===inputCategory, changed=false;
    inputCategory.items.forEach(function(item,index){
      if(item.action!=='input')return;
      var input=result.inputs.find(function(entry){return entry.id===item.id;});
      if(!input)return;
      var type=input.label==='HDMI '+input.port?'INPUT':'HDMI '+input.port;
      if(item.title===input.label&&item.type===type)return;
      item.title=input.label;
      item.type=type;
      changed=true;
      // Update text in place: keep row nodes, selection, focus and port bindings.
      if(visible){var button=itemLists[selectedCategory].children[index];button.querySelector('.item-text').textContent=item.title;button.setAttribute('aria-label',item.title);}
    });
    if(changed&&menuOrder.modes[inputCategory.id]!=='default'){
      var ci=categories.indexOf(inputCategory),id=inputCategory.items[selections[ci]]&&inputCategory.items[selections[ci]].id;
      selections[ci]=menuOrder.apply(inputCategory,id);buildItems();renderRows(selectedCategory);
      $('items').setAttribute('aria-activedescendant','item-'+selections[selectedCategory]);
    }
    if(visible&&changed){
      // Metadata must not restart media after a successful launch but before hide.
      renderDetailText();
      if(!modalOpen)announceSelection();
    }
  }catch(error){
    // Optional firmware API: keep defaults or the last successful names.
  }finally{
    if(inputLabelRead===read)inputLabelRead=null;
  }
}
function cancelInputLabels(){
  var read=inputLabelRead;
  inputLabelRead=null;
  if(read&&typeof read.cancel==='function'){
    try{read.cancel();}catch(ignore){}
  }
}
function restorePage(refreshStill){if(document.hidden)return;var now=performance.now(),wasActive=pageActive,before=thumbnail.getState();pageActive=true;refreshRecent();sounds.setActive(true);musicAway=false;wave.setPaused(false);renderDetail();if(refreshStill&&wasActive&&now-lastReturnAt>=250&&preferences.previewMode==='cached'&&before.port===currentPort()&&before.port!==null&&before.status!=='loading')thumbnail.refresh();lastReturnAt=now;updateClock();restoreFocus();if(!wasActive||refreshStill)refreshInputLabels();if(C5TV.isTV())appRefresh.resume();}
function suspendPage(){directionRepeat.cancel();appRefresh.pause();if(modalType==='datetime'){dateTimeSettings.close();modalOpen=false;modalType='';$('modalBackdrop').hidden=true;document.querySelector('.screen').classList.remove('modal-dimmed');document.querySelector('.screen').removeAttribute('aria-hidden');}cancelHold();itemOptions.close('lifecycle');categoryTransition.cancel();var wasActive=pageActive;pageActive=false;sounds.setActive(false);music.setContext(false,false);cancelInputLabels();invalidateLaunch();clearToast();clearTimeout(announceTimer);if(wasActive){stopInputPreview();thumbnail.setPaused(true);wave.setPaused(true);}}
function handleRelaunch(){directionRepeat.cancel();cancelHold();if(itemOptions.opened)itemOptions.close('lifecycle');setWaveOnly(false);categoryTransition.cancel();invalidateLaunch();clearToast();if(modalOpen)closeModal(true);restorePage(true);}
// handlesRelaunch stays false: webOS brings the app forward automatically.
// A Home press while already visible still needs to leave any open dialog.
document.addEventListener('webOSRelaunch',handleRelaunch,true);
appCategories.rebuild(selections);
categories.forEach(function(c,ci){selections[ci]=menuOrder.apply(c,c.items[selections[ci]]&&c.items[selections[ci]].id);});
buildCategories();buildItems();applyPreferences();render();sounds.prepare();updateClock();var clockTimer=setInterval(updateClock,10000);$('items').focus();if(C5TV.isTV())appRefresh.resume();refreshInputLabels();startHelper();
document.addEventListener('visibilitychange',function(){if(document.hidden){suspendPage();}else restorePage(false);});
window.addEventListener('resize',function(){cancelHold();categoryTransition.cancel();});
window.addEventListener('pagehide',suspendPage);window.addEventListener('pageshow',function(){restorePage(false);});window.addEventListener('beforeunload',function(){clearInterval(clockTimer);suspendPage();appRefresh.destroy();categoryTransition.destroy();itemOptions.destroy();sounds.destroy();music.destroy();thumbnail.destroy();inputPreview.destroy();wave.destroy();});
window.C5App={getState:function(){return{category:categories[selectedCategory].id,item:currentItem().id,modal:modalOpen?modalType:null,remote:modalOpen&&modalType==='remote'?C5RemoteSettings.getState():null,preferences:Object.assign({},preferences),busy:busy,appRefresh:appRefresh.getState(),appCategories:appCategories.snapshot(),itemOptions:itemOptions.getState(),detailPending:detailTimer!==0,detailItem:detailItemId,music:music.getState(),sounds:sounds.getState(),thumbnail:thumbnail.getState(),inputPreview:inputPreview.getState(),waveOnly:waveOnly,waveMode:wave.mode,waveError:wave.error||null,waveDiagnostics:wave.getDiagnostics()};}};
})();
