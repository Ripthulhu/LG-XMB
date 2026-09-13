// Synthetic settings and lifecycle checks; no TV operations.
const assert = require('node:assert/strict');
const path = require('node:path');
module.exports = async function checkBackgroundSettings(browser, checks, errors) {
  async function openSettings(page) {
    await page.getByRole('button', {name: 'Settings', exact: true}).click();
    for (let i = 0; i < 12 && await page.evaluate(() => C5App.getState().item !== 'background'); i++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => C5App.getState().modal === 'background');
  }
  async function createPage(inject) {
    const page = await browser.newPage({viewport: {width: 1920, height: 1080}});
    page.on('pageerror', error => errors.push(error.message));
    if (inject) await page.addInitScript(inject);
    await page.goto('http://127.0.0.1:8765');
    await page.waitForFunction(() => window.C5App && !['pending','compiling'].includes(C5App.getState().waveMode));
    return page;
  }
  const desktop = await createPage();
  try {
    await openSettings(desktop);
    await desktop.waitForSelector('[data-process-id="browser"]');
    assert.equal(await desktop.locator('#modalTitle').innerText(), 'Background activity');
    assert.equal(await desktop.getByRole('heading', {name: 'Privacy', exact: true}).count(), 1);
    assert.equal(await desktop.locator('[role="switch"][aria-checked="true"]').count(), 1);
    assert.equal(await desktop.locator('[data-process-id="home"]').getAttribute('aria-checked'), 'true');
    const browserRow = desktop.locator('[data-process-id="browser"]');
    await browserRow.click();
    await desktop.waitForFunction(() => document.querySelector('[data-process-id="browser"]').getAttribute('aria-checked') === 'true');
    assert.equal(await desktop.evaluate(() => document.activeElement.getAttribute('data-process-id')), 'browser');
    await desktop.keyboard.press('ArrowDown');
    assert.equal(await desktop.evaluate(() => document.activeElement.getAttribute('data-process-id')), 'search');
    for (let i = 0; i < 12 && await desktop.evaluate(() => document.activeElement.getAttribute('data-process-id') !== 'usage'); i++) await desktop.keyboard.press('ArrowDown');
    assert.equal(await desktop.evaluate(() => document.activeElement.getAttribute('data-process-id')), 'usage');
    const bounds = await desktop.locator('[data-process-id="usage"]').boundingBox();
    assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 1080, 'Remote focus scrolls the final privacy row into view');
    await desktop.screenshot({path: path.join(__dirname, '../qa/background-settings-1080.png')});
    await desktop.keyboard.press('Escape');
    assert.equal(await desktop.evaluate(() => document.activeElement.id), 'items');
    await desktop.reload(); await desktop.waitForFunction(() => window.C5App);
    await openSettings(desktop); await desktop.waitForSelector('[data-process-id="browser"]');
    assert.equal(await desktop.locator('[data-process-id="browser"]').getAttribute('aria-checked'), 'true');
    await desktop.setViewportSize({width: 1280, height: 720});
    await desktop.locator('[data-process-id="usage"]').focus();
    assert.equal(await desktop.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    checks.push('Background activity has Apps and Privacy switches, only LG Home defaults on, remote scrolling/focus works and desktop choices persist');
  } finally { await desktop.close(); }

  const pendingPage = await createPage(() => {
    window.backgroundTest = {calls: [], gets: 0, state: {available: true, revision: 7, items: [
      {id:'home',title:'LG Home',group:'apps',description:'Closes after returning Home.',enabled:true,supported:true,status:''},
      {id:'browser',title:'Web Browser',group:'apps',description:'May take longer to open.',enabled:false,supported:true,status:''},
      {id:'search',title:'Search',group:'apps',description:'Check search and accessibility.',enabled:false,supported:true,status:''},
      {id:'usage',title:'Usage context and suggestions',group:'privacy',description:'May affect reminders.',enabled:false,supported:true,status:''},
      {id:'ads',title:'Advertising service',group:'privacy',description:'Other apps retain their advertising settings.',enabled:false,supported:false,status:'Unavailable on this TV.'}
    ]}};
    window.C5ProcessAdapter = {
      getState: () => { backgroundTest.gets++; return Promise.resolve(JSON.parse(JSON.stringify(backgroundTest.state))); },
      setEnabled: (id, enabled, revision) => new Promise((resolve, reject) => backgroundTest.calls.push({id, enabled, revision, resolve, reject})),
      prepareLaunch: () => Promise.resolve({prepared: true})
    };
  });
  try {
    await openSettings(pendingPage); await pendingPage.waitForSelector('[data-process-id="browser"]');
    await pendingPage.locator('[data-process-id="browser"]').click();
    await pendingPage.keyboard.press('Enter');
    assert.equal(await pendingPage.evaluate(() => backgroundTest.calls.length), 1);
    assert.equal(await pendingPage.locator('[data-process-id="browser"]').getAttribute('aria-checked'), 'false', 'No optimistic saved state');
    assert.equal(await pendingPage.locator('[data-process-id="browser"]').getAttribute('aria-disabled'), 'true');
    await pendingPage.keyboard.press('ArrowDown');
    await pendingPage.evaluate(() => {
      backgroundTest.state.revision++;
      backgroundTest.state.items.find(item => item.id === 'browser').enabled = true;
      backgroundTest.calls[0].resolve(JSON.parse(JSON.stringify(backgroundTest.state)));
    });
    await pendingPage.waitForFunction(() => document.getElementById('modalContent').getAttribute('aria-busy') === 'false');
    assert.equal(await pendingPage.evaluate(() => document.activeElement.getAttribute('data-process-id')), 'search');
    assert.equal(await pendingPage.locator('[data-process-id="browser"]').getAttribute('aria-checked'), 'true');
    await pendingPage.keyboard.press('Enter');
    await pendingPage.evaluate(() => backgroundTest.calls[1].reject(new Error('Setting could not be saved.')));
    await pendingPage.waitForFunction(() => document.getElementById('modalContent').getAttribute('aria-busy') === 'false');
    assert.equal(await pendingPage.locator('[data-process-id="search"]').getAttribute('aria-checked'), 'false');
    assert.match(await pendingPage.locator('.background-error').innerText(), /could not be saved/);
    assert.equal(await pendingPage.evaluate(() => document.activeElement.getAttribute('data-process-id')), 'search');
    assert.equal(await pendingPage.evaluate(() => backgroundTest.gets), 2);
    await pendingPage.locator('[data-process-id="ads"]').click({force: true});
    assert.equal(await pendingPage.evaluate(() => backgroundTest.calls.length), 2, 'Unsupported privacy row cannot change settings');
    checks.push('Background saves reject duplicate activation, retain current focus, show inline errors with re-read actual values, and prevent unsupported changes');

    await pendingPage.locator('[data-process-id="usage"]').click();
    await pendingPage.keyboard.press('Escape');
    await pendingPage.keyboard.press('Enter');
    await pendingPage.evaluate(() => {
      backgroundTest.state.revision++;
      backgroundTest.state.items.find(item => item.id === 'usage').enabled = true;
      backgroundTest.calls[2].resolve(JSON.parse(JSON.stringify(backgroundTest.state)));
    });
    await pendingPage.waitForFunction(() => document.querySelector('[data-process-id="usage"]')?.getAttribute('aria-checked') === 'true');
    assert.equal(await pendingPage.locator('#modalContent').getAttribute('aria-busy'), 'false');
    assert.equal(await pendingPage.evaluate(() => document.activeElement.getAttribute('data-process-id')), 'home');
    checks.push('Closing and reopening during a save waits for the pending change and reads confirmed state without stale focus updates');
  } finally { await pendingPage.close(); }

  const refreshPage = await createPage(() => {
    const set = window.setTimeout.bind(window), clear = window.clearTimeout.bind(window);
    window.refreshTest = {timers: new Map(), timerId: 90000, gets: 0, sets: [], reads: [], holdRead: false, mutations: 0,
      state: {available:true,revision:0,items:['home','browser','search','hdmi3','hdmi4','livetv','usage','ads'].map((id,i) => ({
        id,title:id,group:i<6?'apps':'privacy',description:'A setting description with its affected features. A setting description with its affected features.',
        enabled:id==='home',supported:true,status:'Ready'
      }))}};
    window.setTimeout = (fn, delay, ...args) => {
      if (delay !== 5000) return set(fn,delay,...args);
      const id = ++refreshTest.timerId; refreshTest.timers.set(id, () => fn(...args)); return id;
    };
    window.clearTimeout = id => { if (!refreshTest.timers.delete(id)) clear(id); };
    refreshTest.fire = () => {
      const first = refreshTest.timers.entries().next().value;
      if (!first) throw new Error('No refresh scheduled');
      refreshTest.timers.delete(first[0]); first[1]();
    };
    window.C5ProcessAdapter = {
      getState: () => {refreshTest.gets++;return refreshTest.holdRead ? new Promise(resolve => refreshTest.reads.push(resolve)) : Promise.resolve(JSON.parse(JSON.stringify(refreshTest.state)));},
      setEnabled: (id,enabled,revision) => new Promise(resolve => refreshTest.sets.push({id,enabled,revision,resolve})),
      prepareLaunch: () => Promise.resolve({prepared:true})
    };
  });
  try {
    await openSettings(refreshPage); await refreshPage.waitForSelector('[data-process-id="ads"]');
    await refreshPage.waitForFunction(() => refreshTest.timers.size === 1);
    await refreshPage.locator('[data-process-id="ads"]').focus();
    await refreshPage.evaluate(() => {
      refreshTest.row = document.querySelector('[data-process-id="ads"]');
      refreshTest.scrollTop = document.getElementById('modalContent').scrollTop;
      new MutationObserver(records => refreshTest.mutations += records.length).observe(document.getElementById('modalContent'), {subtree:true,childList:true,attributes:true,characterData:true});
      refreshTest.state.revision++;
      refreshTest.fire();
    });
    await refreshPage.waitForFunction(() => refreshTest.timers.size === 1);
    assert.equal(await refreshPage.evaluate(() => refreshTest.gets), 2);
    assert.equal(await refreshPage.evaluate(() => refreshTest.mutations), 0, 'Unchanged snapshots do not mutate the DOM');
    assert.equal(await refreshPage.evaluate(() => document.activeElement === refreshTest.row), true);
    await refreshPage.evaluate(() => {refreshTest.state.items[7].status='Stopped';refreshTest.fire();});
    await refreshPage.waitForFunction(() => document.querySelector('[data-process-id="ads"] .background-option-status').textContent === 'Stopped');
    assert.equal(await refreshPage.evaluate(() => document.activeElement.getAttribute('data-process-id')), 'ads');
    assert.equal(await refreshPage.evaluate(() => document.getElementById('modalContent').scrollTop), await refreshPage.evaluate(() => refreshTest.scrollTop));
    await refreshPage.evaluate(() => {refreshTest.holdRead=true;refreshTest.fire();});
    await refreshPage.keyboard.press('Enter');
    assert.equal(await refreshPage.evaluate(() => refreshTest.sets.length), 0, 'Save waits for an existing status read');
    assert.equal(await refreshPage.evaluate(() => refreshTest.timers.size), 0);
    await refreshPage.evaluate(() => {refreshTest.holdRead=false;refreshTest.reads[0](JSON.parse(JSON.stringify(refreshTest.state)));});
    await refreshPage.waitForFunction(() => refreshTest.sets.length === 1);
    assert.equal(await refreshPage.evaluate(() => refreshTest.sets[0].revision), 1, 'A revision-only refresh updates save concurrency without rebuilding the UI');
    const duringSave = await refreshPage.evaluate(() => refreshTest.gets);
    await refreshPage.evaluate(() => {
      Object.defineProperty(document,'hidden',{configurable:true,value:true});
      document.dispatchEvent(new Event('visibilitychange'));
      refreshTest.state.items[7].enabled=true;refreshTest.state.revision++;
      refreshTest.sets[0].resolve(JSON.parse(JSON.stringify(refreshTest.state)));
    });
    await refreshPage.waitForTimeout(20);
    assert.equal(await refreshPage.evaluate(() => refreshTest.timers.size), 0);
    assert.equal(await refreshPage.evaluate(() => refreshTest.gets), duringSave, 'No refresh is sent during a save or while hidden');
    await refreshPage.evaluate(() => {
      Object.defineProperty(document,'hidden',{configurable:true,value:false});
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await refreshPage.waitForFunction(() => refreshTest.gets > 4 && refreshTest.timers.size === 1);
    assert.equal(await refreshPage.locator('#modalContent').getAttribute('aria-busy'), 'false');
    assert.equal(await refreshPage.locator('[data-process-id="ads"]').getAttribute('aria-checked'), 'true');
    await refreshPage.evaluate(() => {refreshTest.holdRead=true;refreshTest.fire();});
    await refreshPage.keyboard.press('Escape');
    const closedCalls = await refreshPage.evaluate(() => refreshTest.gets);
    await refreshPage.evaluate(() => {
      refreshTest.state.items[7].status='Stale result after close';
      refreshTest.reads[1](JSON.parse(JSON.stringify(refreshTest.state)));
    });
    await refreshPage.waitForTimeout(20);
    assert.equal(await refreshPage.evaluate(() => refreshTest.timers.size), 0);
    assert.equal(await refreshPage.evaluate(() => refreshTest.gets), closedCalls);
    assert.equal(await refreshPage.locator('#modalContent').innerText().then(text => text.includes('Stale result after close')), false);
    checks.push('Background status refresh is bounded and serialized, skips unchanged DOM, preserves focus/scroll, pauses during saves and hiding, and ignores closed-dialog responses');
  } finally { await refreshPage.close(); }

  const launchPage = await createPage();
  try {
    await launchPage.evaluate(() => {
      window.launchControlTest = {prepares: [], launches: []};
      C5ProcessControl.useAdapter({prepareLaunch: id => new Promise((resolve, reject) => launchControlTest.prepares.push({id, resolve, reject}))});
      window.C5TV = Object.assign({}, C5TV, {isTV: () => true, launch: id => { launchControlTest.launches.push(id); return Promise.resolve({ok:true,preview:false}); }});
    });
    await launchPage.keyboard.press('Enter');
    assert.equal(await launchPage.evaluate(() => launchControlTest.launches.length), 0);
    await launchPage.evaluate(() => document.dispatchEvent(new Event('webOSRelaunch')));
    await launchPage.evaluate(() => launchControlTest.prepares[0].resolve({prepared:true}));
    assert.equal(await launchPage.evaluate(() => launchControlTest.launches.length), 0, 'Home invalidates an awaiting prepare request');
    await launchPage.keyboard.press('Enter');
    await launchPage.evaluate(() => launchControlTest.prepares[1].resolve({prepared:true}));
    await launchPage.waitForFunction(() => !C5App.getState().busy);
    assert.equal(await launchPage.evaluate(() => launchControlTest.launches.length), 1);
    await launchPage.keyboard.press('Enter');
    await launchPage.evaluate(() => launchControlTest.prepares[2].reject(new Error('Unavailable')));
    await launchPage.waitForFunction(() => !C5App.getState().busy);
    assert.equal(await launchPage.evaluate(() => launchControlTest.launches.length), 2, 'Unavailable process control does not prevent a normal launch');
    assert.equal(await launchPage.locator('#toast').innerText(), '');
    checks.push('App launch waits for background preparation, respects stale lifecycle cancellation and still works if background control is unavailable');
  } finally { await launchPage.close(); }
};
