// Native replies are simulated; no TV, shell, media or network access.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../app/tv-bridge.js'), 'utf8');

function setup(tv = true) {
  const calls = [], timers = new Map();
  let nextTimer = 0;
  const context = {
    location: {protocol: tv ? 'file:' : 'http:', search: ''},
    navigator: {userAgent: 'Linux SmartTV webOS'},
    PalmSystem: {identifier: 'com.webos.app.home'},
    setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, {fn, delay}); return id; },
    clearTimeout(id) { timers.delete(id); },
    PalmServiceBridge: function () {
      this.call = (uri, payload) => calls.push({uri, payload: JSON.parse(payload),
        reply: this.onservicecallback, bridge: this});
      this.cancel = () => { this.cancelled = true; };
    }
  };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app/input-discovery.js'), 'utf8'), context);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app/tv-discovery.js'), 'utf8'), context);
  vm.runInNewContext(source, context);
  return {tv: context.C5TV, calls, timers, context};
}
const device = (port, label, extra = {}) => ({id: `HDMI_${port}`, port,
  appId: `com.webos.app.hdmi${port}`, label, ...extra});
const plain = value => JSON.parse(JSON.stringify(value));
async function inputs(devices) {
  const h = setup(), read = h.tv.listInputs();
  h.calls[0].reply(JSON.stringify({returnValue: true, devices}));
  return plain((await read).inputs);
}

test('desktop labels remain preview-only without constructing a native bridge', async () => {
  const h = setup(false);
  assert.deepEqual(plain(await h.tv.listInputs()), {ok: true, preview: true, inputs: []});
  assert.equal(h.calls.length, 0);
  assert.equal(h.timers.size, 0);
});

test('reads only EIM once and exports labels with stable HDMI identities', async () => {
  const h = setup(), read = h.tv.listInputs();
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0].payload, {});
  assert.equal(h.calls[0].uri, 'luna://com.webos.service.eim/getAllInputStatus');
  assert.equal([...h.timers.values()][0].delay, 5000);
  h.calls[0].reply(JSON.stringify({returnValue: true, devices: [device(2, 'PS3 Konsola do gier', {
    connected: true, iconPrefix: '/usr/palm/plugins/inputapps/assets/small/',
    icon: 'gameconsole.png', subList: [{labelName: 'PS3', serviceType: 'game'}]
  })]}));
  assert.deepEqual(plain(await read), {ok: true, preview: false,
    inputs: [{id: 'com.webos.app.hdmi2', port: 2, kind: 'hdmi', label: 'PS3 Konsola do gier'}]});
  assert.equal(h.calls.length, 1);
  assert.equal(h.timers.size, 0);
  assert.equal(h.calls[0].bridge.cancelled, true);
});

test('retains disconnected inputs and does not require optional id/port fields', async () => {
  assert.deepEqual(await inputs([device(1, 'PC', {connected: false}),
    {appId: 'com.webos.app.hdmi3', label: 'Console'}]), [
    {id: 'com.webos.app.hdmi1', port: 1, kind: 'hdmi', label: 'PC'},
    {id: 'com.webos.app.hdmi3', port: 3, kind: 'hdmi', label: 'Console'}]);
});

test('missing, null, blank and control-only labels fall back to the physical port', async () => {
  const rows = await inputs([device(1, undefined), device(2, null), device(3, '   '), device(4, '\u0000\u202e')]);
  assert.deepEqual(rows.map(row => row.label), ['HDMI 1', 'HDMI 2', 'HDMI 3', 'HDMI 4']);
});

test('preserves Unicode and literal markup while bounding and cleaning labels', async () => {
  const rows = await inputs([device(1, '  Télé  電視 🎮  '), device(2, '<img src=x onerror=alert(1)>'),
    device(3, '\u0000PC\u007f\u0085\u202e  Game\u2069'), device(4, '🎮'.repeat(130))]);
  assert.equal(rows[0].label, 'Télé 電視 🎮');
  assert.equal(rows[1].label, '<img src=x onerror=alert(1)>');
  assert.equal(rows[2].label, 'PC Game');
  assert.equal(rows[3].label, '🎮'.repeat(120));
});

test('ignores virtual, unsupported and malformed records rather than inventing targets', async () => {
  const rows = [null, false, [], 'HDMI_1', {}, device(0, 'zero'), device(100, 'invalid port'),
    device(1, 'wrong id', {id: 'HDMI_2'}), device(2, 'wrong port', {port: 3}),
    device(3, 'invalid port', {port: '03'}), device(4, 42),
    device(1, 'other app', {appId: 'com.example.app'}),
    {id: 'HDMI_2', port: 2, label: 'no app ID'}, {appId: '__proto__', label: 'unsafe'}];
  assert.deepEqual(await inputs(rows), []);
});

test('duplicate HDMI identities are discarded, regardless of order or connection', async () => {
  const rows = [device(1, 'PC'), device(2, 'A'), device(2, 'B', {connected: false}), device(3, 'Console')];
  assert.deepEqual((await inputs(rows)).map(row => row.port), [1, 3]);
  assert.deepEqual((await inputs(rows.reverse())).map(row => row.port), [3, 1]);
});

test('a conflicting duplicate cannot override a valid record', async () => {
  assert.deepEqual(await inputs([device(2, 'valid'), device(2, 'contradiction', {port: 1})]), []);
});

test('empty and partial lists are allowed without synthesizing missing ports', async () => {
  assert.deepEqual(await inputs([]), []);
  assert.deepEqual(await inputs([device(4, 'Last')]), [{id: 'com.webos.app.hdmi4', port: 4, kind: 'hdmi', label: 'Last'}]);
});

test('rejects missing, wrongly typed and oversized device lists', async () => {
  for (const devices of [undefined, null, {}, 'list', Array(129).fill({})]) {
    const h = setup(), read = h.tv.listInputs();
    const rejected = assert.rejects(read, {code: 'INVALID_RESPONSE'});
    h.calls[0].reply(JSON.stringify({returnValue: true, devices}));
    await rejected;
    assert.equal(h.calls.length, 1);
  }
});

test('service denial and invalid native replies stay failures with no fallback execution', async () => {
  for (const reply of ['not json', JSON.stringify({returnValue: false, errorCode: -1}),
    JSON.stringify({returnValue: true, errorCode: 3, devices: []}), 'x'.repeat(2 * 1024 * 1024 + 1)]) {
    const h = setup(), read = h.tv.listInputs();
    const rejected = assert.rejects(read);
    h.calls[0].reply(reply);
    await rejected;
    assert.equal(h.calls.length, 1);
    assert.equal(h.timers.size, 0);
  }
});

test('timeout cancels the bridge and ignores late success without retrying', async () => {
  const h = setup(), read = h.tv.listInputs();
  const rejected = assert.rejects(read, {code: 'TIMEOUT'});
  [...h.timers.values()][0].fn();
  await rejected;
  h.calls[0].reply(JSON.stringify({returnValue: true, devices: [device(2, 'Too late')]}));
  assert.equal(h.calls[0].bridge.cancelled, true);
  assert.equal(h.calls.length, 1);
  assert.equal(h.timers.size, 0);
});

test('cancellation cannot complete a newer read with an obsolete label', async () => {
  const h = setup(), old = h.tv.listInputs();
  const rejected = assert.rejects(old, {code: 'CANCELLED'});
  old.cancel();
  await rejected;
  const current = h.tv.listInputs();
  h.calls[0].reply(JSON.stringify({returnValue: true, devices: [device(2, 'Old')]}));
  h.calls[1].reply(JSON.stringify({returnValue: true, devices: [device(2, 'New')]}));
  assert.equal((await current).inputs[0].label, 'New');
  assert.equal(h.calls.length, 2);
});


test('launching a reported analog input uses its native target; absent ports stay unavailable', async () => {
  const h = setup(), read = h.tv.listInputs();
  h.calls[0].reply(JSON.stringify({returnValue:true,devices:[
    device(2,'Console'), {id:'AV_1',port:1,appId:'com.webos.app.externalinput.av1',label:'Composite'}
  ]}));
  assert.deepEqual(plain((await read).inputs.map(x=>x.kind)), ['hdmi','av']);
  const launch=h.tv.openInput('AV_1');
  assert.deepEqual(h.calls[1].payload,{appId:'com.webos.app.externalinput.av1'});
  h.calls[1].reply(JSON.stringify({returnValue:true,exist:true}));
  await Promise.resolve();
  assert.deepEqual(h.calls[2].payload,{id:'com.webos.app.externalinput.av1'});
  h.calls[2].reply(JSON.stringify({returnValue:true}));
  assert.equal((await launch).id,'com.webos.app.externalinput.av1');
  await assert.rejects(h.tv.openInput('HDMI_4'),{code:'INVALID_INPUT'});
});
