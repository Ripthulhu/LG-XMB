'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../app/tv-bridge.js'), 'utf8');

function setup(overrides = {}) {
  const calls = [], bridges = [], timers = new Map();
  let timerId = 0;
  class PalmServiceBridge {
    constructor() { this.cancelled = false; bridges.push(this); }
    call(uri, body) { calls.push({ uri, payload: JSON.parse(body), bridge: this }); }
    cancel() { this.cancelled = true; }
  }
  const window = {
    location: { protocol: 'file:', search: '' },
    navigator: { userAgent: 'Mozilla/5.0 (Web0S; Linux/SmartTV) Chrome/120' },
    PalmSystem: { identifier: 'com.webos.app.home 1234' },
    PalmServiceBridge,
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    ...overrides
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app/input-discovery.js'), 'utf8'), { window });
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app/tv-discovery.js'), 'utf8'), { window, Promise });
  vm.runInNewContext(source, { window, Promise });
  function respond(index, value) { calls[index].bridge.onservicecallback(typeof value === 'string' ? value : JSON.stringify(value)); }
  return { tv: window.C5TV, calls, bridges, timers, window, respond };
}

test('desktop and hosted previews never construct a native bridge', async () => {
  for (const overrides of [
    { PalmSystem: undefined }, { PalmServiceBridge: undefined },
    { location: { protocol: 'http:', search: '' } },
    { location: { protocol: 'file:', search: '?preview=1' } },
    { navigator: { userAgent: 'Desktop Chrome' } }
  ]) {
    const h = setup(overrides);
    assert.equal(h.tv.isTV(), false);
    assert.equal((await h.tv.listApps()).apps.length, 0);
    assert.equal((await h.tv.launch('youtube.leanback.v4')).preview, true);
    assert.equal((await h.tv.openInput('HDMI_2')).id, 'com.webos.app.hdmi2');
    assert.equal(h.bridges.length, 0);
  }
});

test('PalmSystem plus LinuxSmartTV is recognized without webOSTV.js', () => {
  assert.equal(setup({ navigator: { userAgent: 'LinuxSmartTV' } }).tv.isTV(), true);
});

test('app enumeration is a single read, strips unsafe metadata and does not persist it', async () => {
  const h = setup();
  const result = h.tv.listApps();
  assert.equal(h.calls[0].uri, 'luna://com.webos.applicationManager/listApps');
  assert.deepEqual(h.calls[0].payload, {});
  h.respond(0, { returnValue: true, apps: [
    { id: 'youtube.leanback.v4', title: 'You\u0000Tube', icon: '/media/apps/youtube/icon.png', type: 'web', visible: true },
    { id: 'netflix', title: 'Netflix', icon: 'https://tracking.example/icon', visible: true },
    { id: 'netflix', title: 'Duplicate', visible: true }, { id: 'bad/id', title: 'Bad', visible: true },
    { id: 'hidden.app', visible: false }, { id: 'factory.app' }, { id: 'stringvisible.app', visible: 'true' }
  ] });
  const got = await result;
  assert.equal(got.preview, false);
  assert.equal(got.apps.length, 2);
  assert.equal(got.apps[0].title, 'YouTube');
  assert.equal(got.apps[1].icon, '');
  assert.equal(h.bridges[0].cancelled, true);
  assert.equal(h.timers.size, 0);
});

test('launch checks installation first and sends only the selected ID', async () => {
  const h = setup();
  const result = h.tv.launch('youtube.leanback.v4');
  assert.match(h.calls[0].uri, /getAppLoadStatus$/);
  assert.deepEqual(h.calls[0].payload, { appId: 'youtube.leanback.v4' });
  h.respond(0, { returnValue: true, exist: true });
  await Promise.resolve();
  assert.equal(h.calls.length, 2);
  assert.match(h.calls[1].uri, /\/launch$/);
  assert.deepEqual(h.calls[1].payload, { id: 'youtube.leanback.v4' });
  h.respond(1, { returnValue: true });
  assert.equal((await result).id, 'youtube.leanback.v4');
  assert.equal(h.timers.size, 0);
});

test('denied enumeration reports failure without a guessed catalog', async () => {
  const h = setup();
  const result = h.tv.listApps();
  h.respond(0, { returnValue: false, errorCode: -1, errorText: 'Denied method call' });
  await assert.rejects(result, e => e.code === 'SERVICE_ERROR' && e.serviceCode === -1);
  assert.equal(h.calls.length, 1);
});

test('denied or missing installation never falls through to a launch', async () => {
  for (const response of [
    { returnValue: false, errorCode: -1, errorText: 'Denied' },
    { returnValue: true, exist: false }, { returnValue: true }
  ]) {
    const h = setup();
    const result = h.tv.launch('netflix');
    h.respond(0, response);
    await assert.rejects(result);
    assert.equal(h.calls.length, 1);
  }
});

test('malformed and contradictory service responses reject cleanly', async () => {
  for (const response of ['not-json', 'null', '[]', '{}', '{"returnValue":true,"errorCode":-3}']) {
    const h = setup();
    const result = h.tv.listApps();
    h.respond(0, response);
    await assert.rejects(result);
    assert.equal(h.timers.size, 0);
  }
});

test('timeout cancels, ignores a late callback and never retries', async () => {
  const h = setup();
  const result = h.tv.listApps();
  const callback = h.bridges[0].onservicecallback;
  const timeout = [...h.timers.values()][0];
  assert.equal(timeout.delay, 5000);
  timeout.fn();
  await assert.rejects(result, e => e.code === 'TIMEOUT');
  callback('{"returnValue":true,"apps":[]}');
  assert.equal(h.bridges[0].cancelled, true);
  assert.equal(h.calls.length, 1);
  assert.equal(h.timers.size, 0);
});

test('native transport exceptions become a bounded bridge failure', async () => {
  const h = setup({ PalmServiceBridge: class { call() { throw new Error('native failed'); } cancel() {} } });
  await assert.rejects(h.tv.listApps(), e => e.code === 'BRIDGE_ERROR');
  assert.equal(h.timers.size, 0);
});

test('invalid IDs and inputs cause no native requests', async () => {
  const h = setup();
  for (const id of ['', 'luna://com.webos.service/exec', '../app', 'app;reboot', 'app id', null, {}, 'a'.repeat(129)]) {
    await assert.rejects(h.tv.launch(id), e => e.code === 'INVALID_APP_ID');
  }
  for (const id of ['HDMI_5', 'com.webos.app.home', 'com.webos.app.hdmi1/launch', '__proto__']) {
    await assert.rejects(h.tv.openInput(id), e => e.code === 'INVALID_INPUT');
  }
  assert.equal(h.calls.length, 0);
});

test('A discovered input uses ordinary app launch with no settings', async () => {
  const h = setup();
  const inventory = h.tv.listInputs();
  h.respond(0, {returnValue:true,devices:[{appId:'com.webos.app.hdmi4',id:'HDMI_4',port:4}]});
  await inventory;
  for (const [operation, expected] of [
    [() => h.tv.openInput('HDMI_4'), 'com.webos.app.hdmi4']
  ]) {
    const start = h.calls.length;
    const result = operation();
    h.respond(start, { returnValue: true, exist: true });
    await Promise.resolve();
    h.respond(start + 1, { returnValue: true });
    assert.equal((await result).id, expected);
  }
  assert.ok(h.calls.slice(1).every(call => /\/(getAppLoadStatus|launch)$/.test(call.uri)));
  assert.equal(Object.keys(h.tv).sort().join(','), 'connectMusicAudio,getInputPreviewStatus,isTV,launch,listApps,listInputs,openInput,platformBack,returnToPrevious');
});

test('Back uses native recent order, skips Home and checks the last app or input before launching', async () => {
  for (const id of ['com.webos.app.hdmi2', 'netflix']) {
    const h = setup();
    const result = h.tv.returnToPrevious();
    assert.equal(h.calls[0].uri, 'luna://com.webos.surfacemanager/getRecentsAppList');
    assert.deepEqual(h.calls[0].payload, {});
    h.respond(0, {returnValue: true, ready: true, recentsAppList: ['com.webos.app.home', 'org.local.openxmb.c5', id, 'com.webos.app.hdmi1']});
    await Promise.resolve();
    assert.deepEqual(h.calls[1].payload, {appId: id});
    h.respond(1, {returnValue: true, exist: true});
    await Promise.resolve();
    assert.deepEqual(h.calls[2].payload, {id});
    h.respond(2, {returnValue: true});
    assert.deepEqual(JSON.parse(JSON.stringify(await result)), {ok: true, preview: false, id, returned: true});
    assert.equal(h.timers.size, 0);
  }
});

test('Back stays in Home when there is no previous app and never sends TV calls from a preview', async () => {
  const desktop = setup({location: {protocol: 'http:', search: ''}});
  assert.equal((await desktop.tv.returnToPrevious()).preview, true);
  assert.equal(desktop.calls.length, 0);
  for (const list of [[], ['com.webos.app.home', 'org.local.openxmb.c5']]) {
    const h = setup(), result = h.tv.returnToPrevious();
    h.respond(0, {returnValue: true, ready: true, recentsAppList: list});
    assert.equal((await result).returned, false);
    assert.equal(h.calls.length, 1);
  }
});

test('Back never launches after Home invalidates either pending read', async () => {
  for (const stage of ['before', 'recents', 'installed']) {
    let current = stage !== 'before';
    const h = setup(), result = h.tv.returnToPrevious(() => current);
    if (stage !== 'before') {
      if (stage === 'recents') current = false;
      h.respond(0, {returnValue: true, ready: true, recentsAppList: ['netflix']});
      await Promise.resolve();
      if (stage === 'installed') {
        current = false;
        h.respond(1, {returnValue: true, exist: true});
      }
    }
    assert.equal((await result).cancelled, true);
    assert.ok(h.calls.every(call => !call.uri.endsWith('/launch')));
    assert.equal(h.timers.size, 0);
  }
});

test('unavailable, malformed or denied recents never guess a different return target', async () => {
  for (const response of [
    {returnValue: false, errorText: 'Denied'},
    {returnValue: true, ready: false, recentsAppList: ['netflix']},
    {returnValue: true, ready: true, recentsAppList: ['bad/id', 'netflix']},
    {returnValue: true, ready: true, recentsAppList: [{id: 'netflix'}]},
    {returnValue: true, ready: true, recentsAppList: 'netflix'}
  ]) {
    const h = setup(), result = h.tv.returnToPrevious();
    h.respond(0, response);
    await assert.rejects(result);
    assert.equal(h.calls.length, 1);
  }
  const h = setup(), result = h.tv.returnToPrevious();
  h.respond(0, {returnValue: true, ready: true, recentsAppList: ['uninstalled.app', 'netflix']});
  await Promise.resolve();
  h.respond(1, {returnValue: true, exist: false});
  await assert.rejects(result, error => error.code === 'APP_NOT_INSTALLED');
  assert.equal(h.calls.length, 2);
});

function previewEntry(overrides = {}) {
  return {appId: 'org.local.openxmb.c5', contentType: 'hdmi2', connected: true,
    connectedSource: 'HDMI', connectedSourcePort: 2, width: 0, height: 0, frameRate: 0, videoInfo: null, ...overrides};
}

test('preview status reads only the fixed endpoint and filters to our selected HDMI', async () => {
  const h = setup();
  const result = h.tv.getInputPreviewStatus(2);
  assert.deepEqual(h.calls.map(call => [call.uri, call.payload]), [['luna://com.webos.service.videooutput/getStatus', {}]]);
  h.respond(0, {returnValue: true, video: [
    previewEntry({appId: 'another.app', width: 3840, height: 2160}),
    previewEntry({contentType: 'hdmi1', connectedSourcePort: 1, width: 3840, height: 2160}),
    previewEntry()
  ], clients: [{appId: 'unrelated.app'}]});
  assert.deepEqual(JSON.parse(JSON.stringify(await result)), {port: 2, signal: false});
  assert.equal(h.bridges[0].cancelled, true);
  assert.equal(h.timers.size, 0);
});

test('preview status recognizes positive video dimensions without exporting unrelated metadata', async () => {
  const h = setup();
  const result = h.tv.getInputPreviewStatus(2);
  h.respond(0, {returnValue: true, video: [previewEntry({connectedSourcePort: 3, width: 3840, height: 2160, frameRate: 144, videoInfo: {hdr: true}})]});
  assert.deepEqual(JSON.parse(JSON.stringify(await result)), {port: 2, signal: true});
});

test('missing, ambiguous or mismatched preview status remains unknown', async () => {
  for (const video of [
    undefined, {}, [], [null], [previewEntry({appId: 'another.app'})],
    [previewEntry({contentType: 'hdmi3'})],
    [previewEntry({connected: false})], [previewEntry({connectedSource: 'VDEC'})],
    [previewEntry({width: '0'})], [previewEntry({height: null})],
    [previewEntry({width: 1280})], [previewEntry({width: -1})],
    [previewEntry(), previewEntry({width: 1920, height: 1080})]
  ]) {
    const h = setup();
    const result = h.tv.getInputPreviewStatus(2);
    h.respond(0, {returnValue: true, video});
    assert.equal((await result).signal, null);
    assert.equal(h.calls.length, 1);
  }
});

test('preview cancellation releases its native bridge and ignores late responses', async () => {
  const h = setup();
  const result = h.tv.getInputPreviewStatus(2);
  const late = h.bridges[0].onservicecallback;
  result.cancel();
  result.cancel();
  await assert.rejects(result, problem => problem.code === 'CANCELLED');
  late(JSON.stringify({returnValue: true, video: [previewEntry()]}));
  assert.equal(h.bridges[0].cancelled, true);
  assert.equal(h.timers.size, 0);
  assert.equal(h.calls.length, 1);
});

test('preview status uses the existing bounded timeout and never retries denied calls', async () => {
  const h = setup();
  const result = h.tv.getInputPreviewStatus(2);
  const timer = [...h.timers.values()][0];
  assert.equal(timer.delay, 5000);
  timer.fn();
  await assert.rejects(result, problem => problem.code === 'TIMEOUT');
  assert.equal(h.calls.length, 1);
  assert.equal(h.bridges[0].cancelled, true);
  const denied = h.tv.getInputPreviewStatus(2);
  h.respond(1, {returnValue: false, errorCode: -1, errorText: 'Denied'});
  await assert.rejects(denied, problem => problem.code === 'SERVICE_ERROR');
  assert.equal(h.calls.length, 2);
  assert.equal(h.timers.size, 0);
});

test('desktop and invalid preview requests never create native calls', async () => {
  const desktop = setup({location: {protocol: 'http:', search: ''}});
  assert.deepEqual(JSON.parse(JSON.stringify(await desktop.tv.getInputPreviewStatus(2))), {port: 2, signal: null, preview: true});
  assert.equal(desktop.bridges.length, 0);
  const h = setup();
  for (const port of [0, 5, 1.5, '2', null, {}, 'luna://arbitrary/service']) {
    await assert.rejects(h.tv.getInputPreviewStatus(port), problem => problem.code === 'INVALID_INPUT');
  }
  assert.equal(h.bridges.length, 0);
});

test('LG Back uses only the platform exit API on TV, remains preview-only on desktop and reports missing support', async () => {
  let backs=0;
  const h=setup({PalmSystem:{identifier:'org.local.openxmb.c5 1234',platformBack(){backs++;}}});
  assert.equal((await h.tv.platformBack()).preview,false);assert.equal(backs,1);assert.equal(h.calls.length,0);
  const desktop=setup({location:{protocol:'http:',search:''},PalmSystem:{identifier:'org.local.openxmb.c5 1234',platformBack(){backs++;}}});
  assert.equal((await desktop.tv.platformBack()).preview,true);assert.equal(backs,1);
  await assert.rejects(setup().tv.platformBack(),problem=>problem.code==='BACK_UNAVAILABLE');
  // webOS 6 renamed PalmSystem to webOSSystem and isTV already accepts either.
  const renamed=setup({PalmSystem:undefined,webOSSystem:{identifier:'org.local.openxmb.c5 1234',platformBack(){backs++;}}});
  assert.equal((await renamed.tv.platformBack()).preview,false);assert.equal(backs,2);
});

test('music audio is connected to the main sink only under the Home identity', async () => {
  const dev = setup({PalmSystem:{identifier:'org.local.openxmb.c5 1234'}});
  assert.equal((await dev.tv.connectMusicAudio()).reason, 'not-needed');
  assert.equal(dev.calls.length, 0);

  const pipelines = [
    { type: 'avconnector', id: '_av' },
    { type: 'media', id: '_other', appId: 'youtube.leanback.v4', uri: 'file:///x/user-music.mp3', resource: [{ index: 0, resource: 'ADEC' }] },
    { type: 'media', id: '_music1', appId: 'com.webos.app.home', uri: 'file:///usr/palm/applications/com.webos.app.home/user-music.mp3',
      resource: [{ index: 1, resource: 'ADEC' }, { index: 5, resource: 'ADEC_BANDWIDTH' }] }
  ];
  const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
  const home = setup({ PalmSystem: { identifier: 'com.webos.app.home 77' } });
  let result = home.tv.connectMusicAudio();
  home.respond(0, pipelines); await settle();
  home.respond(1, { returnValue: true, audio: [{ streamType: 'umimedia', pipelineInfo: [{ pipelineId: '_music1', sourceSinkInfo: [] }] }] }); await settle();
  assert.equal(home.calls[2].uri, 'luna://com.webos.service.audio/UMI/connect');
  assert.deepEqual(home.calls[2].payload, { streamType: 'umimedia', source: 'ADEC', sourcePort: 1, sink: 'MAIN', pipelineId: '_music1', activate: true });
  home.respond(2, { returnValue: true });
  assert.equal((await result).reason, 'connected');

  const wired = setup({ PalmSystem: { identifier: 'com.webos.app.home 77' } });
  result = wired.tv.connectMusicAudio();
  wired.respond(0, pipelines); await settle();
  wired.respond(1, { returnValue: true, audio: [{ streamType: 'umimedia', pipelineInfo: [{ pipelineId: '_music1', sourceSinkInfo: [{ sink: 'MAIN' }] }] }] });
  assert.equal((await result).reason, 'already');
  assert.equal(wired.calls.length, 2);

  const none = setup({ PalmSystem: { identifier: 'com.webos.app.home 77' } });
  result = none.tv.connectMusicAudio();
  none.respond(0, [pipelines[0], pipelines[1]]);
  assert.equal((await result).reason, 'no-pipeline');
  assert.equal(none.calls.length, 1);
});

test('music routing cannot connect after the owning playback session ends', async () => {
  for (const endAt of ['before', 'pipelines', 'status']) {
    const h=setup({PalmSystem:{identifier:'com.webos.app.home 77'}});
    let current=endAt!=='before';
    const operation=h.tv.connectMusicAudio(()=>current);
    if(endAt!=='before'){
      if(endAt==='pipelines')current=false;
      h.respond(0,[{type:'media',id:'music',appId:'com.webos.app.home',uri:'file:///home/user-music.mp3',resource:[{resource:'ADEC',index:1}]}]);
      for(let i=0;i<6;i++)await Promise.resolve();
      if(endAt==='status'){current=false;h.respond(1,{returnValue:true,audio:[]});}
    }
    assert.equal((await operation).reason,'cancelled');
    assert.equal(h.calls.some(c=>c.uri.endsWith('/UMI/connect')),false);
  }
});
