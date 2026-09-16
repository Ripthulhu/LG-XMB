/* lg-xmb web application, 2026. SPDX-License-Identifier: GPL-3.0-or-later */
(function(){'use strict';
var categories=window.C5Catalog, selectedCategory=1, selections=categories.map(function(){return 0;}), busy=false, modalOpen=false, lastDirection=0, toastTimer, announceTimer;
var preferences={theme:'midnight',motion:'full',sound:false,previewMode:'cached',waveSpeed:'normal',waveBrightness:'normal',backBehavior:'stay',waveMSAA:0,waveSampling:1.5,waveDetail:'high',waveSoftness:0.75,wavePostprocess:'fxaa',waveSmoothing:'normal',musicEnabled:false,musicVolume:0.25,waveParticles:true,waveParticleCount:2000};
var themes={midnight:{name:'Midnight',background:'#050911',wave:'#738acf',accent:'#a7baf3'},ocean:{name:'Ocean',background:'#030e13',wave:'#4da6ab',accent:'#98dfdf'},ember:{name:'Ember',background:'#130906',wave:'#ac6c45',accent:'#eebd96'},forest:{name:'Forest',background:'#040f0b',wave:'#579b7a',accent:'#b0d6bb'},amber:{name:'Amber',background:'#130f05',wave:'#c49a4a',accent:'#e0c998'},rose:{name:'Rose',background:'#13080d',wave:'#b86e8c',accent:'#e6b2c7'},violet:{name:'Violet',background:'#0d0816',wave:'#9678ca',accent:'#c8b5ec'},graphite:{name:'Graphite',background:'#090b0d',wave:'#83939d',accent:'#ccd4d9'},seasonal:{name:'Seasonal',background:'#080813',wave:'#2e2e73',accent:'#b3b3ea'}};
// Monthly colours are adapted from OpenXMB config.json, shell.theme-month-colours.
var monthColours=['#f2e6a6','#9e4540','#4da640','#f299cc','#99cc59','#b399e6','#80d9f2','#3373f2','#2e2e73','#994db3','#cc8040','#e64040'];
var $=function(id){return document.getElementById(id);};
try{var saved=JSON.parse(localStorage.getItem('lg-xmb-preferences-v1')||localStorage.getItem('openxmb-c5-preferences-v1')||'{}');if(Object.prototype.hasOwnProperty.call(themes,saved.theme))preferences.theme=saved.theme;if(saved.motion==='reduced'||saved.motion==='full')preferences.motion=saved.motion;else if(matchMedia('(prefers-reduced-motion: reduce)').matches)preferences.motion='reduced';preferences.sound=saved.sound===true;preferences.previewMode=saved.previewMode==='live'?'live':'cached';if(['slow','normal','fast'].indexOf(saved.waveSpeed)!==-1)preferences.waveSpeed=saved.waveSpeed;if(['low','normal','high'].indexOf(saved.waveBrightness)!==-1)preferences.waveBrightness=saved.waveBrightness;if(saved.backBehavior==='lg')preferences.backBehavior='lg';}catch(ignore){}
// New quality preferences are independent of existing appearance and TV settings.
if(saved && typeof saved === 'object') {
  if([0,2,4].indexOf(saved.waveMSAA)!==-1)preferences.waveMSAA=saved.waveMSAA;
  if(typeof saved.waveParticles==='boolean')preferences.waveParticles=saved.waveParticles;
  if([500,2000,4000].indexOf(saved.waveParticleCount)!==-1)preferences.waveParticleCount=saved.waveParticleCount;
  preferences.musicEnabled=saved.musicEnabled===true;
  if([0.1,0.25,0.5,0.75,1].indexOf(saved.musicVolume)!==-1)preferences.musicVolume=saved.musicVolume;
  if([1,1.25,1.5,2].indexOf(saved.waveSampling)!==-1)preferences.waveSampling=saved.waveSampling;
  if(['standard','high','fine'].indexOf(saved.waveDetail)!==-1)preferences.waveDetail=saved.waveDetail;
  if([0,0.75,1.5].indexOf(saved.waveSoftness)!==-1)preferences.waveSoftness=saved.waveSoftness;
  if(['off','fxaa','wave'].indexOf(saved.wavePostprocess)!==-1)preferences.wavePostprocess=saved.wavePostprocess;
  if(['gentle','normal','strong'].indexOf(saved.waveSmoothing)!==-1)preferences.waveSmoothing=saved.waveSmoothing;
}
// Keep the canvas and spline surface at full HD; do not downscale on timing gaps.
preferences.waveColors=LGXMBWaveColors.normalize(saved && saved.waveColors);
var wave=new C5Wave($('wave'),{quality:'1080p',adaptive:false,onRenderStatus:updateWaveStatus});
var inputPreview=new C5InputPreview($('inputPreview'),{isTV:function(){return C5TV.isTV();}});
var thumbnail=new C5Thumbnail($('inputThumbnail'),$('thumbnailFallback'),{isTV:function(){return C5TV.isTV();}});
var categoryTransition=new LGXMBCategoryTransition($('categories'));
var music=new LGXMBBackgroundMusic({enabled:preferences.musicEnabled,volume:preferences.musicVolume,onChange:updateMusicStatus});
var detailItemId=null,detailIcon=null,renderedCategory=-1,launchGeneration=0,pageActive=!document.hidden,musicAway=false,lastReturnAt=-Infinity;
document.querySelector('.input-preview-symbol').innerHTML=C5Icon('hdmi');
document.querySelector('.thumbnail-symbol').innerHTML=C5Icon('hdmi');
var audioContext, inputLabelRead=null;
function tick(){if(!preferences.sound||document.hidden)return;try{if(!audioContext)audioContext=new(window.AudioContext||window.webkitAudioContext)();if(audioContext.state==='suspended')audioContext.resume();var oscillator=audioContext.createOscillator(),gain=audioContext.createGain(),now=audioContext.currentTime;oscillator.type='sine';oscillator.frequency.setValueAtTime(660,now);oscillator.frequency.exponentialRampToValueAtTime(440,now+.065);gain.gain.setValueAtTime(.018,now);gain.gain.exponentialRampToValueAtTime(.0001,now+.065);oscillator.connect(gain);gain.connect(audioContext.destination);oscillator.start(now);oscillator.stop(now+.07);}catch(ignore){}}
function save(){try{localStorage.setItem('lg-xmb-preferences-v1',JSON.stringify(preferences));}catch(ignore){toast('This device could not save your preference.');}}
function seasonal(){var colour=monthColours[new Date().getMonth()],rgb=colour.match(/[a-f0-9]{2}/gi).map(function(x){return parseInt(x,16);});themes.seasonal.wave=colour;themes.seasonal.background='#'+rgb.map(function(v){return Math.max(3,Math.round(v*.07)).toString(16).padStart(2,'0');}).join('');themes.seasonal.accent='#'+rgb.map(function(v){return Math.round(v*.45+255*.55).toString(16).padStart(2,'0');}).join('');}
function applyPreferences(){if(preferences.motion==='reduced')categoryTransition.cancel();seasonal();var theme=themes[preferences.theme];document.documentElement.style.setProperty('--accent','#ffffff');document.documentElement.style.setProperty('--accent-rgb','255,255,255');document.documentElement.style.setProperty('--background',theme.background);document.documentElement.style.setProperty('--background-rgb',theme.background.match(/[a-f0-9]{2}/gi).map(function(x){return parseInt(x,16);}).join(','));document.body.classList.toggle('reduced-motion',preferences.motion==='reduced');wave.setTheme(Object.assign({},theme,{colors:preferences.waveColors}));wave.setStyle({speed:{slow:0.5,normal:1.5,fast:2.25}[preferences.waveSpeed],brightness:{low:0.6,normal:1,high:1.5}[preferences.waveBrightness]});wave.setQuality({msaa:preferences.waveMSAA,sampling:preferences.waveSampling,detail:preferences.waveDetail,softness:preferences.waveSoftness,postprocess:preferences.wavePostprocess,strength:preferences.waveSmoothing,particles:preferences.waveParticles,particleCount:preferences.waveParticleCount});wave.setReducedMotion(preferences.motion==='reduced');}
function toast(message){$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(function(){$('toast').classList.remove('show');},4200);}
function clearToast(){clearTimeout(toastTimer);$('toast').classList.remove('show');if($('toast').textContent)$('toast').textContent='';}
function invalidateLaunch(){launchGeneration++;busy=false;$('items').removeAttribute('aria-busy');}
function currentItem(){return categories[selectedCategory].items[selections[selectedCategory]];}
function currentPort(){var item=currentItem(),match=categories[selectedCategory].id==='inputs'&&item.action==='input'&&/^com\.webos\.app\.hdmi([1-4])$/.exec(item.id);return match?Number(match[1]):null;}
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
function renderDetail(){renderDetailText();syncInputPreview();}
function buildCategories(){var nav=$('categories');categories.forEach(function(cat,index){var b=document.createElement('button');b.className='category';b.style.transform='translateX(calc(-50% + '+(index*LGXMBCategoryTransition.DISTANCE)+'vw))';b.setAttribute('aria-label',cat.title);b.innerHTML='<span class="category-icon">'+C5Icon(cat.icon)+'</span><span class="category-label"></span>';b.querySelector('.category-label').textContent=cat.title;b.addEventListener('click',function(){if(!busy)selectCategory(index);});nav.appendChild(b);});}
// Detached category rows are reused, not cloned or kept as hidden live layers.
var itemButtons = new WeakMap(), itemOffsets = new WeakMap();
function buildItems(){
  var list=$('items'),cat=categories[selectedCategory];
  list.textContent='';list.setAttribute('aria-label',cat.title);
  var fragment=document.createDocumentFragment();
  cat.items.forEach(function(item,index){
    var b=itemButtons.get(item);
    if(!b){
      b=document.createElement('button');b.className='item';b.setAttribute('role','option');b.tabIndex=-1;
      b.innerHTML='<span class="item-icon">'+C5Icon(item.icon)+'</span><span class="item-text"></span>';
      b.addEventListener('click',function(){
        if(busy)return;
        var current=categories[selectedCategory].items.indexOf(item);if(current<0)return;
        selections[selectedCategory]=current;render();tick();activate();
      });
      itemButtons.set(item,b);
    }
    b.id='item-'+index;
    // Input labels may have refreshed while this category was detached.
    if(b.getAttribute('aria-label')!==item.title){
      b.setAttribute('aria-label',item.title);b.querySelector('.item-text').textContent=item.title;
    }
    fragment.appendChild(b);
  });
  list.appendChild(fragment);
}
function render(){
  var index=selections[selectedCategory];
  // Up/down does not change the horizontal bar. Leave its styles, accessibility
  // attributes and any in-flight CSS transition alone.
  if(renderedCategory!==selectedCategory){
    $('categories').style.transform='translateX('+(-selectedCategory*LGXMBCategoryTransition.DISTANCE)+'vw)';
    [].forEach.call($('categories').children,function(button,i){
      var offset=i-selectedCategory;
      button.classList.toggle('active',offset===0);
      button.style.opacity=offset===0?'1':Math.abs(offset)>2?'.36':'.5';
      button.setAttribute('aria-current',offset===0?'true':'false');
      button.tabIndex=offset===0?0:-1;
    });
    renderedCategory=selectedCategory;
  }
  [].forEach.call($('items').children,function(button,i){
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
    button.style.opacity=!visible?'0':offset===0?'1':offset<0?String(.48+offset*.10):String(.64-offset*.09);
    itemOffsets.set(button,offset);
  });
  var active='item-'+index;
  if($('items').getAttribute('aria-activedescendant')!==active)$('items').setAttribute('aria-activedescendant',active);
  renderDetail();announceSelection();
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
  if(index===selectedCategory){renderDetail();return;}
  var direction=index-selectedCategory;
  categoryTransition.change(direction,function(){
    selectedCategory=index;buildItems();render();
  },preferences.motion==='full');
  tick();
}
function navigate(direction){
  if(busy||!pageActive||document.hidden)return;
  var next;
  if(direction==='left'||direction==='right'){
    next=Math.max(0,Math.min(categories.length-1,selectedCategory+(direction==='right'?1:-1)));
    selectCategory(next);return;
  }
  next=Math.max(0,Math.min(categories[selectedCategory].items.length-1,selections[selectedCategory]+(direction==='down'?1:-1)));
  if(next===selections[selectedCategory]){renderDetail();return;}
  selections[selectedCategory]=next;render();tick();
}
function row(label,colour,isSelected,handler,parent){var button=document.createElement('button');button.className='option';button.setAttribute('aria-pressed',String(isSelected));var labelSpan=document.createElement('span');if(colour){var swatch=document.createElement('i');swatch.className='swatch';swatch.style.background=colour;labelSpan.appendChild(swatch);}labelSpan.appendChild(document.createTextNode(label));button.appendChild(labelSpan);var mark=document.createElement('span');mark.className='option-check';mark.setAttribute('aria-hidden','true');mark.textContent=isSelected?'✓':'';button.appendChild(mark);button.addEventListener('click',handler);(parent||$('modalContent')).appendChild(button);return button;}
function selectChoice(parent,value){[].forEach.call(parent.querySelectorAll('[data-choice]'),function(button){var chosen=button.getAttribute('data-choice')===String(value);button.setAttribute('aria-pressed',String(chosen));button.querySelector('.option-check').textContent=chosen?'✓':'';});}
function choiceGroup(label,choices,value,handler){var group=document.createElement('section');group.className='choice-group';group.setAttribute('role','group');group.setAttribute('aria-label',label);var title=document.createElement('h3');title.textContent=label;group.appendChild(title);var options=document.createElement('div');options.className='choice-options';group.appendChild(options);choices.forEach(function(choice){var button=row(choice[1],null,value===choice[0],function(){handler(choice[0]);selectChoice(options,choice[0]);},options);button.setAttribute('data-choice',choice[0]);});$('modalContent').appendChild(group);return group;}
var modalType='';
function openModal(type){categoryTransition.cancel();if(!modalOpen||modalType!==type)clearToast();if(modalType==='background')C5BackgroundSettings.close();if(modalType==='remote')C5RemoteSettings.close();stopInputPreview();modalType=type;$('modal').classList.toggle('background-settings',type==='background');$('modal').classList.toggle('waves-settings',type==='motion'||type==='music'||type==='wave-colors');$('modal').classList.toggle('appearance-settings',type==='appearance');modalOpen=true;syncInputPreview();document.querySelector('.screen').setAttribute('aria-hidden','true');$('modalBackdrop').hidden=false;$('modalContent').textContent='';$('modalContent').classList.remove('theme-options');$('modalTitle').textContent={appearance:'Appearance',motion:'Waves','wave-colors':'Wave colours',sound:'Navigation sound',music:'Background music',previews:'Input previews',background:'Background activity',remote:'Back button',about:'About this menu'}[type];$('modalIntro').textContent={appearance:'',motion:'','wave-colors':'Monthly gradients and manual RGB controls.',sound:'',music:'Loop your own MP3 while Home is open. Music pauses during live HDMI previews and when you leave Home.',previews:'Live previews can change HDR mode.',background:'Choose what Home keeps closed. Apps can still be opened and close again when you return.',remote:'Applies in this menu only.',about:'Version 0.1.30'}[type];
if(type==='appearance'){$('modalContent').classList.add('theme-options');Object.keys(themes).forEach(function(key){var button=row(themes[key].name,key==='seasonal'?monthColours[new Date().getMonth()]:themes[key].wave,preferences.theme===key,function(){preferences.theme=key;applyPreferences();save();selectChoice($('modalContent'),key);});button.setAttribute('data-choice',key);});}
else if(type==='motion'){openWaveSettings();}
else if(type==='wave-colors'){LGXMBWaveColorSettings.open($('modalContent'),preferences.waveColors,function(value){preferences.waveColors=value;wave.setTheme(Object.assign({},themes[preferences.theme],{colors:value}));save();});}
else if(type==='music'){openMusicSettings();}
else if(type==='sound'){row('Off',null,!preferences.sound,function(){preferences.sound=false;save();openModal(type);});row('On',null,preferences.sound,function(){preferences.sound=true;save();tick();openModal(type);});}
else if(type==='previews'){row('Cached',null,preferences.previewMode==='cached',function(){preferences.previewMode='cached';save();openModal(type);});row('Live',null,preferences.previewMode==='live',function(){preferences.previewMode='live';save();openModal(type);});helperStatusPanel();}
else if(type==='background'){C5BackgroundSettings.open();}
else if(type==='remote'){C5RemoteSettings.open({getBack:function(){return preferences.backBehavior;},setBack:function(value){if(['stay','lg'].indexOf(value)===-1)throw new Error('Choose a valid Back button setting.');var next=Object.assign({},preferences,{backBehavior:value});try{localStorage.setItem('lg-xmb-preferences-v1',JSON.stringify(next));}catch(ignore){throw new Error('This device could not save the Back button setting.');}preferences.backBehavior=value;}});}
else{$('modalContent').innerHTML='<div class="about-copy"><p>A webOS adaptation of phenom64/OpenXMB. Original waves and seasonal colours come from Syndromatic and contributors. The PS3-style spline surface adapts linkev/PlayStation-3-XMB by Mart.</p><p>This launcher adds no advertising or usage logging. Your TV and the apps you open retain their own privacy settings.</p><p>GPL version 3. Full source and licence notices accompany this app.</p></div>';}
var chosen=$('modalContent').querySelector('[aria-pressed="true"]')||$('modalContent').querySelector('button')||$('closeModal');chosen.focus();}
function openWaveSettings(){
  var colorButton=row('Wave colours',null,false,function(){openModal('wave-colors');});colorButton.id='openWaveColors';
  choiceGroup('Animation',[['full','On'],['reduced','Off']],preferences.motion,function(value){preferences.motion=value;applyPreferences();save();});
  choiceGroup('Speed',[['slow','Slow'],['normal','Normal'],['fast','Fast']],preferences.waveSpeed,function(value){preferences.waveSpeed=value;applyPreferences();save();});
  choiceGroup('Brightness',[['low','Low'],['normal','Normal'],['high','High']],preferences.waveBrightness,function(value){preferences.waveBrightness=value;applyPreferences();save();});
  function qualityChoice(label,choices,key){
    choiceGroup(label,choices,preferences[key],function(value){
      preferences[key]=value;
      wave.setQuality({msaa:preferences.waveMSAA,sampling:preferences.waveSampling,detail:preferences.waveDetail,softness:preferences.waveSoftness,postprocess:preferences.wavePostprocess,strength:preferences.waveSmoothing,particles:preferences.waveParticles,particleCount:preferences.waveParticleCount});
      save();updateWaveStatus();
    });
  }
  qualityChoice('MSAA',[[0,'Off'],[2,'2×'],[4,'4×']],'waveMSAA');
  qualityChoice('Supersampling',[[1,'Off'],[1.25,'1.25×'],[1.5,'1.5×'],[2,'2×']],'waveSampling');
  qualityChoice('Mesh detail',[['standard','Standard'],['high','High'],['fine','Fine']],'waveDetail');
  qualityChoice('Edge softness',[[0,'Sharp'],[0.75,'Subtle'],[1.5,'Soft']],'waveSoftness');
  qualityChoice('Particles',[[true,'On'],[false,'Off']],'waveParticles');
  qualityChoice('Particle density',[[500,'Low'],[2000,'Normal'],[4000,'High']],'waveParticleCount');
  qualityChoice('Post-process antialiasing',[['off','Off'],['fxaa','FXAA'],['wave','Wave FXAA']],'wavePostprocess');
  qualityChoice('Smoothing strength',[['gentle','Gentle'],['normal','Normal'],['strong','Strong']],'waveSmoothing');
  var note=document.createElement('p');note.className='wave-quality-note';
  note.textContent='MSAA smooths geometric edges when WebGL 2 supports it. Try 4× MSAA with supersampling Off first; enabling both adds cost. Higher supersampling and mesh detail use more graphics resources. FXAA smooths edges at the output resolution, without filtering text. Wave FXAA uses wave opacity to find edges; it is experimental. Smoothing strength applies when either filter is enabled.';
  $('modalContent').appendChild(note);
  var status=document.createElement('p');status.id='waveRenderStatus';status.className='wave-quality-note';status.setAttribute('role','status');
  $('modalContent').appendChild(status);updateWaveStatus();
}
function updateMusicStatus(){
  var status=$('musicStatus'),retry=$('retryMusic');if(!status||!music)return;
  var state=music.getState();
  status.textContent={off:'Music is off.',loading:'Loading background music…',playing:'Playing on repeat.',
    suspended:'Paused while Home is away.',preview:'Paused for the live HDMI preview.',
    blocked:'Press OK on Retry playback to start the music.',
    unavailable:'Music file is missing, unreadable or unsupported. Copy your MP3 to the displayed path, then choose Retry playback.'}[state.phase]||'';
  if(retry){
    var hide=state.phase!=='blocked'&&state.phase!=='unavailable';
    if(hide&&document.activeElement===retry){var choice=$('modalContent').querySelector('[aria-pressed="true"]');if(choice)choice.focus();}
    retry.hidden=hide;
  }
}
function openMusicSettings(){
  var help=document.createElement('p');help.className='wave-quality-note';
  help.textContent='No music is included. Copy an MP3 to this path on the TV. It stays there across app updates.';
  $('modalContent').appendChild(help);
  var path=document.createElement('p');path.id='musicFilePath';path.className='wave-quality-note music-file-path';
  path.textContent='/media/internal/lg-xmb/background.mp3';$('modalContent').appendChild(path);
  choiceGroup('Background music',[[true,'On'],[false,'Off']],preferences.musicEnabled,function(value){
    preferences.musicEnabled=value;music.setEnabled(value);save();updateMusicStatus();
  });
  choiceGroup('Music volume',[[0.1,'10%'],[0.25,'25%'],[0.5,'50%'],[0.75,'75%'],[1,'100%']],preferences.musicVolume,function(value){
    preferences.musicVolume=value;music.setVolume(value);save();
  });
  var status=document.createElement('p');status.id='musicStatus';status.className='wave-quality-note';status.setAttribute('role','status');
  $('modalContent').appendChild(status);
  var retry=row('Retry playback',null,false,function(){music.retry();updateMusicStatus();});retry.id='retryMusic';
  updateMusicStatus();
}
// Bubble after navigation/launch handlers, so a gesture that leaves Home cannot
// revive an autoplay-blocked track on the way out.
function musicGesture(event){
  // This dialog has an explicit retry. Arrow navigation must not hide the
  // focused retry button by starting a new autoplay attempt on every key.
  if(!modalOpen||modalType!=='music')music.gesture(event);
}
window.addEventListener('keydown',musicGesture);
window.addEventListener('click',musicGesture);
function updateWaveStatus(){
  var status=$('waveRenderStatus');if(!status||!wave)return;
  var diag=wave.getDiagnostics(),surface=diag.surface;
  if(diag.mode!=='webgl'||diag.pattern!=='ps3'||!surface||!surface.surfaceWidth){
    status.textContent=diag.mode==='pending'||diag.mode==='compiling'?'Preparing waves…':'Compatibility renderer active. Extra quality controls apply to PS3 waves only.';return;
  }
  status.textContent='Output '+diag.backingWidth+' × '+diag.backingHeight+' · Wave surface '+surface.surfaceWidth+' × '+surface.surfaceHeight+(surface.cropped&&surface.bandHeight?' (cropped to '+surface.bandWidth+' × '+surface.bandHeight+' output band)':'')+
    (surface.samplingFallback?' · '+surface.effectiveScale+'× applied ('+surface.samplingFallback.toLowerCase()+').':'')+
    ' · MSAA '+(surface.msaaSamples ? surface.msaaSamples+'×' : 'Off')+
    (surface.msaaFallback?' ('+surface.msaaFallback.toLowerCase()+')':'')+
    ' · Filter '+({off:'Off',fxaa:'FXAA',wave:'Wave FXAA'}[surface.postprocess]||'Off')+
    (surface.postWidth?' at '+surface.postWidth+' × '+surface.postHeight:'')+
    (surface.postprocessFallback?' ('+surface.postprocessFallback.toLowerCase()+')':'');
  if(preferences.waveParticles){status.textContent+=surface.particlesFallback?' · Particles unavailable':' · '+surface.particleCount+' particles';}
}
function updateHelperStatus(){
  var status=$('helperStatus'),retry=$('retryHelper');
  if(!status||!window.LGXMBHelper)return;
  var state=LGXMBHelper.getState();
  status.textContent=state.message;
  if(retry)retry.hidden=state.phase!=='failed' && !(state.ready&&!state.captureRunning);
}
function helperStatusPanel(){
  if(!C5TV.isTV()||!window.LGXMBHelper)return;
  var status=document.createElement('p');status.id='helperStatus';status.className='modal-intro';status.setAttribute('role','status');$('modalContent').appendChild(status);
  var retry=row('Retry helper setup',null,false,function(){LGXMBHelper.retry().then(updateHelperStatus,updateHelperStatus);});retry.id='retryHelper';updateHelperStatus();
}
function startHelper(){
  if(!C5TV.isTV()||!window.LGXMBHelper)return;
  var generation=launchGeneration;
  LGXMBHelper.ensure().then(function(){
    if(pageActive&&!document.hidden&&!busy&&generation===launchGeneration&&currentPort()&&preferences.previewMode==='cached')thumbnail.refresh();
  },function(){/* Settings show the specific setup error; navigation stays usable. */});
}
document.addEventListener('lg-xmb-helper-status',updateHelperStatus);
function closeModal(){if(modalType==='wave-colors'){openModal('motion');$('openWaveColors').focus();return;}if(modalType==='background')C5BackgroundSettings.close();if(modalType==='remote')C5RemoteSettings.close();modalOpen=false;$('modalBackdrop').hidden=true;document.querySelector('.screen').removeAttribute('aria-hidden');$('items').focus();renderDetail();}
function modalKey(event){if(event.key==='Escape'||event.key==='Backspace'||event.keyCode===461){event.preventDefault();closeModal();return;}if(modalType==='wave-colors'){LGXMBWaveColorSettings.key(event,$('modal'));return;}var group=document.activeElement.closest&&document.activeElement.closest('.choice-group');if(group&&/^Arrow/.test(event.key)){event.preventDefault();var horizontal=event.key==='ArrowLeft'||event.key==='ArrowRight',choices=Array.from(group.querySelectorAll('button')),groups=Array.from($('modalContent').querySelectorAll('.choice-group'));if(horizontal){var offset=event.key==='ArrowRight'?1:-1;choices[(choices.indexOf(document.activeElement)+offset+choices.length)%choices.length].focus();}else{var target=groups[groups.indexOf(group)+(event.key==='ArrowDown'?1:-1)];if(target)(target.querySelector('[aria-pressed="true"]')||target.querySelector('button')).focus();else{var retry=modalType==='music'&&$('retryMusic');(retry&&!retry.hidden&&event.key==='ArrowDown'?retry:modalType==='motion'&&event.key==='ArrowUp'?$('openWaveColors'):$('closeModal')).focus();}}tick();return;}var controls=Array.from($('modal').querySelectorAll('button')).filter(function(button){return !button.hidden;}),index=controls.indexOf(document.activeElement),delta=event.key==='ArrowDown'||event.key==='ArrowRight'?1:event.key==='ArrowUp'||event.key==='ArrowLeft'?-1:0;if(event.key==='Tab')delta=event.shiftKey?-1:1;if(delta){event.preventDefault();controls[(Math.max(index,0)+delta+controls.length)%controls.length].focus();tick();}}
async function activate(){if(busy||!pageActive||document.hidden)return;categoryTransition.cancel();var item=currentItem();if(['appearance','motion','sound','music','previews','background','remote','about'].indexOf(item.action)!==-1){openModal(item.action);return;}var generation=++launchGeneration;clearToast();busy=true;musicAway=true;syncInputPreview();var launched=false;$('items').setAttribute('aria-busy','true');try{if(window.C5ProcessControl){try{await C5ProcessControl.prepareLaunch(item.id);}catch(ignore){}if(generation!==launchGeneration||!pageActive||document.hidden)return;}var result=item.action==='stock'?await C5TV.exitToStockHome():item.action==='input'?await C5TV.openInput(item.id):await C5TV.launch(item.id);if(generation!==launchGeneration||!pageActive||document.hidden)return;launched=!result.preview;if(result.preview)toast('Preview · '+item.title+' opens on your TV.');}catch(error){if(generation===launchGeneration&&pageActive&&!document.hidden)toast('Could not open '+item.title+'. '+(error.message||'Please try LG Home.'));}finally{if(generation===launchGeneration){busy=false;$('items').removeAttribute('aria-busy');if(!launched&&pageActive&&!document.hidden){musicAway=false;renderDetail();$('items').focus();}}}}
function back(){if(modalOpen){closeModal();return;}if(preferences.backBehavior!=='lg'||busy||!pageActive||document.hidden)return;var generation=++launchGeneration;C5TV.platformBack().catch(function(error){if(generation===launchGeneration&&pageActive&&!document.hidden)toast(error.message||'Could not open the TV exit prompt.');});}
document.addEventListener('keydown',function(event){var isActivate=event.key==='Enter'||event.keyCode===13,isBack=event.key==='Escape'||event.key==='Backspace'||event.keyCode===461;if(event.repeat&&(isActivate||isBack)){event.preventDefault();return;}if(modalOpen){modalKey(event);return;}var direction={ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down'}[event.key];if(direction){event.preventDefault();var now=performance.now();if(event.repeat&&now-lastDirection<100)return;lastDirection=now;navigate(direction);if(document.activeElement!==$('items'))$('items').focus();}else if(isActivate){event.preventDefault();activate();}else if(isBack){event.preventDefault();back();}});
document.addEventListener('wheel',function(event){if(modalOpen){if($('modal').contains(event.target))return;event.preventDefault();return;}event.preventDefault();if(busy||Math.abs(event.deltaY)<2)return;var now=performance.now();if(now-lastDirection<130)return;lastDirection=now;navigate(event.deltaY>0?'down':'up');},{passive:false});
$('closeModal').addEventListener('click',closeModal);$('modalBackdrop').addEventListener('click',function(event){if(event.target===$('modalBackdrop'))closeModal();});
$('previewButton').addEventListener('click',function(){if(busy||modalOpen)return;activate();});
function updateClock(){var now=new Date(),time=now.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:false}),date=now.toLocaleDateString('en-GB',{weekday:'short',day:'2-digit',month:'short'});if($('time').textContent!==time){$('time').textContent=time;$('time').dateTime=now.toISOString();}if($('date').textContent!==date)$('date').textContent=date;}
function restoreFocus(){if(modalOpen){if(!$('modal').contains(document.activeElement)){var control=$('modalContent').querySelector('[aria-pressed="true"]')||$('modalContent').querySelector('button')||$('closeModal');control.focus();}}else if(document.activeElement!==$('items'))$('items').focus();}
async function refreshInputLabels(){
  if(!pageActive||document.hidden||inputLabelRead)return;
  var read;
  try{
    read=C5TV.listInputLabels();
    inputLabelRead=read;
    var result=await read;
    if(inputLabelRead!==read||!pageActive||document.hidden||result.preview)return;
    var inputCategory=categories.find(function(category){return category.id==='inputs';});
    var visible=categories[selectedCategory]===inputCategory, changed=false;
    inputCategory.items.forEach(function(item,index){
      var input=result.inputs.find(function(entry){return entry.id===item.id;});
      if(!input)return;
      var type=input.label==='HDMI '+input.port?'INPUT':'HDMI '+input.port;
      if(item.title===input.label&&item.type===type)return;
      item.title=input.label;
      item.type=type;
      changed=true;
      // Update text in place: keep row nodes, selection, focus and port bindings.
      if(visible){var button=$('items').children[index];button.querySelector('.item-text').textContent=item.title;button.setAttribute('aria-label',item.title);}
    });
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
function restorePage(refreshStill){if(document.hidden)return;var now=performance.now(),wasActive=pageActive,before=thumbnail.getState();pageActive=true;musicAway=false;wave.setPaused(false);renderDetail();if(refreshStill&&wasActive&&now-lastReturnAt>=250&&preferences.previewMode==='cached'&&before.port===currentPort()&&before.port!==null&&before.status!=='loading')thumbnail.refresh();lastReturnAt=now;updateClock();restoreFocus();if(!wasActive||refreshStill)refreshInputLabels();}
function suspendPage(){categoryTransition.cancel();var wasActive=pageActive;pageActive=false;music.setContext(false,false);cancelInputLabels();invalidateLaunch();clearToast();clearTimeout(announceTimer);if(wasActive){stopInputPreview();thumbnail.setPaused(true);wave.setPaused(true);}}
function handleRelaunch(){categoryTransition.cancel();invalidateLaunch();clearToast();if(modalOpen)closeModal();restorePage(true);}
// handlesRelaunch stays false: webOS brings the app forward automatically.
// A Home press while already visible still needs to leave any open dialog.
document.addEventListener('webOSRelaunch',handleRelaunch,true);
async function discoverApps(){try{var result=await C5TV.listApps();if(result.preview)return;var appCategory=categories.find(function(c){return c.id==='apps';}),known=new Set(categories.reduce(function(all,c){return all.concat(c.items.map(function(i){return i.id;}));},[]));result.apps.forEach(function(app){if(known.has(app.id)||app.id==='org.local.openxmb.c5')return;appCategory.items.push({id:app.id,title:app.title,icon:'apps',type:'ON YOUR TV',description:'Open '+app.title+'.',note:'Your app, with its existing settings.'});known.add(app.id);});if(categories[selectedCategory].id==='apps'){categoryTransition.cancel();buildItems();render();}}catch(error){/* Curated, verified shortcuts remain usable if enumeration is not permitted. */}}
buildCategories();buildItems();applyPreferences();render();updateClock();var clockTimer=setInterval(updateClock,10000);$('items').focus();discoverApps();refreshInputLabels();startHelper();
document.addEventListener('visibilitychange',function(){if(document.hidden){suspendPage();if(audioContext&&audioContext.state==='running')audioContext.suspend();}else restorePage(false);});
window.addEventListener('resize',function(){categoryTransition.cancel();});
window.addEventListener('pagehide',suspendPage);window.addEventListener('pageshow',function(){restorePage(false);});window.addEventListener('beforeunload',function(){clearInterval(clockTimer);suspendPage();categoryTransition.destroy();music.destroy();thumbnail.destroy();inputPreview.destroy();wave.destroy();});
window.C5App={getState:function(){return{category:categories[selectedCategory].id,item:currentItem().id,modal:modalOpen?modalType:null,remote:modalOpen&&modalType==='remote'?C5RemoteSettings.getState():null,preferences:Object.assign({},preferences),busy:busy,detailPending:false,detailItem:detailItemId,music:music.getState(),thumbnail:thumbnail.getState(),inputPreview:inputPreview.getState(),waveMode:wave.mode,waveError:wave.error||null,waveDiagnostics:wave.getDiagnostics()};}};
})();
