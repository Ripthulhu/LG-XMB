// SPDX-License-Identifier: GPL-3.0-or-later
// Actual XHR + Web Audio decoding under the product CSP, generated test PCM only.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const root=path.resolve(__dirname,'..'),out=path.join(root,'artifacts/menu-sounds');
const offline=process.env.OFFLINE_SOUND_TRANSPORT==='1';
const FILES=require('../app/menu-sounds.js').FILES,checks=[],errors=[],requests=[];let missing=new Set();
function wav(index){
  const samples=480+index*48,b=Buffer.alloc(44+samples*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);
  b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(24000,24);b.writeUInt32LE(48000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(samples*2,40);
  for(let i=0;i<samples;i++)b.writeInt16LE(Math.round(Math.sin(i*.15)*1000),44+i*2);return b;
}
const probe=`window.soundProbe={played:[],stopped:0};
const realStart=AudioBufferSourceNode.prototype.start,realStop=AudioBufferSourceNode.prototype.stop;
AudioBufferSourceNode.prototype.start=function(...args){soundProbe.played.push(this.buffer.duration);return realStart.apply(this,args);};
AudioBufferSourceNode.prototype.stop=function(...args){soundProbe.stopped++;return realStop.apply(this,args);};`;
const scripts=['icons.js','catalog.js','category-transition.js','fixture.js','probe.js','menu-sounds.js','app-manager.js','hold-gesture.js','menu-order.js','app-categories.js','app-refresh.js','item-options.js','system-time.js','date-time-settings.js','app.js'];
const html=fs.readFileSync(path.join(root,'app/index.html'),'utf8').replace(/  <script src="[^"]+"><\/script>\n/g,'').replace('</body>',scripts.map(s=>'<script src="'+s+'"></script>').join('\n')+'\n</body>');
const server=http.createServer((req,res)=>{
 const name=decodeURIComponent(req.url.split('?')[0]).slice(1);
 if(name.startsWith('user-sounds/')){
  const file=name.slice(12),index=Object.values(FILES).indexOf(file);requests.push(file);
  if(index<0||missing.has(file)){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':'audio/wav','Cache-Control':'no-store'});res.end(wav(index));return;
 }
 let data,type='text/javascript';
 if(!name){data=html;type='text/html';}
 else if(name==='fixture.js')data=fs.readFileSync(path.join(__dirname,'fixtures/catalog-platform.js'));
 else if(name==='probe.js')data=probe;
 else if(scripts.includes(name)||name==='style.css'||name==='item-options.css'||name==='date-time-settings.css'){data=fs.readFileSync(path.join(root,'app',name));if(name.endsWith('.css'))type='text/css';}
 else {res.writeHead(404);res.end();return;}
 res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(data);
});
function check(name,fn){fn();checks.push(name);}
const order=['settings','photo','music','video','tv','apps','browser','network'];
async function select(page,id){const c=await page.evaluate(()=>C5App.getState().category),d=order.indexOf(id)-order.indexOf(c);for(let i=0;i<Math.abs(d);i++)await page.keyboard.press(d>0?'ArrowRight':'ArrowLeft');}
async function clear(page){await page.waitForTimeout(30);await page.evaluate(()=>{soundProbe.played=[];});}
async function played(page){return page.evaluate(()=>soundProbe.played.map(d=>480+48*Math.round((d*24000-480)/48)));}
const samples=k=>480+Object.keys(FILES).indexOf(k)*48;
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{}),args:['--no-sandbox']});
 try{
  const context=await browser.newContext({viewport:{width:1280,height:720},bypassCSP:offline}),page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  if(offline){
    await page.exposeFunction('fixtureWav',async file=>{
      requests.push(file);return {status:missing.has(file)?404:200,data:[...wav(Object.values(FILES).indexOf(file))]};
    });
    await page.setContent(html.replace(/<script[\s\S]*?<\/script>/g,'').replace(/<link[^>]+>/g,''));
    await page.addStyleTag({content:fs.readFileSync(path.join(root,'app/style.css'),'utf8')});
    await page.addStyleTag({content:fs.readFileSync(path.join(root,'app/item-options.css'),'utf8')});
    await page.addStyleTag({content:fs.readFileSync(path.join(root,'app/date-time-settings.css'),'utf8')});
    await page.evaluate(()=>{
      const storage=new Map();Object.defineProperty(window,'localStorage',{value:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),clear:()=>storage.clear()}});
      window.XMLHttpRequest=class{
      open(method,url){this.url=url;}abort(){this.cancelled=true;}
      async send(){const response=await fixtureWav(this.url.split('/').pop().split('?')[0]);
        if(this.cancelled)return;this.status=response.status;this.response=new Uint8Array(response.data).buffer;if(this.onload)this.onload();}
    };});
    for(const name of scripts){const content=name==='probe.js'?probe:fs.readFileSync(name==='fixture.js'?path.join(__dirname,'fixtures/catalog-platform.js'):path.join(root,'app',name),'utf8');await page.addScriptTag({content});}
  }else await page.goto('http://127.0.0.1:'+server.address().port);
  await page.waitForFunction(()=>window.C5App);check('Off does not load any clips',()=>assert.equal(requests.length,0));
  await select(page,'settings');await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(()=>C5App.getState().modal),'sound');
  await page.getByRole('button',{name:'On',exact:true}).click();await page.waitForFunction(()=>C5App.getState().sounds.phase==='ready');
  check('six generated PCM WAVs loaded and decoded',()=>assert.equal(requests.length,6));
  check('only whitelisted app-relative assets requested',()=>assert.deepEqual([...requests].sort(),Object.values(FILES).sort()));
  check('CSP source only permits same-origin connections',()=>assert.match(html,/connect-src 'self';/));
  await page.keyboard.press('ArrowDown');assert.equal(await page.locator(':focus').getAttribute('id'),'reloadSounds');checks.push('Reload is reachable with remote navigation');
  await page.keyboard.press('ArrowUp');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('lg-xmb-preferences-v1')).sound),true);checks.push('sound toggle persists using the existing preference');
  await clear(page);await page.keyboard.press('ArrowLeft');await page.waitForTimeout(30);
  assert.deepEqual(await played(page),[samples('cursor')]);checks.push('dialog navigation uses cursor');
  await clear(page);await page.keyboard.press('Escape');await page.waitForTimeout(30);assert.deepEqual(await played(page),[samples('cancel')]);checks.push('Back uses cancel');
  await clear(page);await page.keyboard.press('ArrowRight');await page.waitForTimeout(30);assert.deepEqual(await played(page),[samples('category')]);checks.push('category movement uses category_decide');
  await clear(page);await page.keyboard.press('ArrowDown');await page.waitForTimeout(30);assert.deepEqual(await played(page),[samples('cursor')]);checks.push('row movement uses cursor');
  await clear(page);await page.keyboard.press('Enter');await page.waitForTimeout(30);assert.deepEqual(await played(page),[samples('decide')]);checks.push('launch uses decide exactly once');
  await select(page,'settings');await clear(page);await page.keyboard.press('Enter');await page.waitForTimeout(30);assert.deepEqual(await played(page),[samples('option')]);checks.push('opening settings uses option');
  await page.keyboard.press('Escape');await select(page,'network');await page.evaluate(()=>catalogHarness.failLaunch=true);await clear(page);await page.keyboard.press('Enter');await page.waitForTimeout(30);
  assert.deepEqual(await played(page),[samples('decide'),samples('error')]);checks.push('failed launch uses error');await page.evaluate(()=>catalogHarness.failLaunch=false);
  await clear(page);await page.keyboard.press('ArrowRight');await page.waitForTimeout(30);assert.deepEqual(await played(page),[]);checks.push('navigation at the end does not play');
  check('playback reuses decoded clips without further reads',()=>assert.equal(requests.length,6));
  await clear(page);await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));await page.keyboard.press('ArrowLeft');await page.waitForTimeout(30);
  assert.deepEqual(await played(page),[]);checks.push('hidden page does not play');
  await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')));await page.waitForTimeout(30);assert.deepEqual(await played(page),[]);checks.push('foreground does not replay stale sounds');
  await select(page,'settings');await page.keyboard.press('Enter');await page.getByRole('button',{name:'Off',exact:true}).click();await clear(page);await page.keyboard.press('Escape');await page.keyboard.press('ArrowRight');await page.waitForTimeout(30);
  assert.deepEqual(await played(page),[]);checks.push('toggle Off silences navigation immediately');
  await select(page,'settings');await page.keyboard.press('Enter');missing=new Set(['snd_cancel.wav']);await page.getByRole('button',{name:'On',exact:true}).click();
  await page.getByRole('button',{name:'Reload sounds',exact:true}).click();await page.waitForFunction(()=>C5App.getState().sounds.phase==='partial');
  assert.deepEqual(await page.evaluate(()=>C5App.getState().sounds.missing),['snd_cancel.wav']);checks.push('one missing file does not disable others');
  missing.clear();await page.getByRole('button',{name:'Reload sounds',exact:true}).click();await page.waitForFunction(()=>C5App.getState().sounds.phase==='ready');checks.push('Reload picks up newly supplied files');
  await page.screenshot({path:path.join(out,'sound-settings.png')});await page.keyboard.press('Escape');await select(page,'network');await page.waitForTimeout(450);await page.screenshot({path:path.join(out,'network.png')});
  check('no uncaught browser errors',()=>assert.deepEqual(errors,[]));
  const report={browser:browser.version(),realXHR:!offline,realWebAudio:true,productCSP:!offline,offlineTransport:offline,assets:'Generated PCM only, not user PS3 WAVs',nativeTV:'Not tested; TV/media/wave APIs are doubles',passed:checks.length,checks};
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));await context.close();
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
