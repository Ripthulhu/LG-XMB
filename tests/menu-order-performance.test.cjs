// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const MenuOrder = require('../app/menu-order.js');
const source = fs.readFileSync(path.join(__dirname, '../app/menu-order.js'), 'utf8');
const modes = ['default', 'az', 'za', 'recent'];

function storage(mode = 'default', recent = []) {
  return {
    getItem(key) {
      if (key === 'lg-xmb-menu-order-v1') return JSON.stringify({ apps: mode });
      if (key === 'lg-xmb-recent-items-v1') return JSON.stringify(recent);
      return null;
    },
    setItem() {}
  };
}

// Previous comparator, retained as an independent behavior/performance reference.
function previousApply(category, selected) {
  const order = this.order[category.id], mode = this.modes[category.id], recent = this.recent;
  category.items.forEach(item => { if (order.indexOf(item) < 0) order.push(item); });
  category.items.sort((a, b) => {
    const aRecent = recent.indexOf(a.id), bRecent = recent.indexOf(b.id);
    const n = mode === 'recent'
      ? (aRecent < 0 ? recent.length : aRecent) - (bRecent < 0 ? recent.length : bRecent)
      : mode === 'default' ? 0
        : a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });
    return (mode === 'za' ? -n : n) || order.indexOf(a) - order.indexOf(b);
  });
  const at = category.items.findIndex(item => item.id === selected);
  return at < 0 ? 0 : at;
}

function random(seed) {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function shuffle(items, rand) {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const at = Math.floor(rand() * (i + 1));
    [result[i], result[at]] = [result[at], result[i]];
  }
  return result;
}

function sameObjects(actual, expected) {
  assert.equal(actual.length, expected.length);
  actual.forEach((item, at) => assert.equal(item, expected[at], 'item identity at index ' + at));
}

test('all modes match previous ordering for duplicates, ties, saved modes and new objects', () => {
  const titles = ['App 2', 'App 10', 'APP 2', 'Ápp 2', 'Video', 'video', 'Éclair', 'Eclair', '日本語', ''];
  for (let seed = 1; seed <= 32; seed++) {
    const rand = random(seed);
    const pool = Array.from({ length: 80 }, (_, at) => ({
      id: 'app.' + (at % 43),
      title: titles[Math.floor(rand() * titles.length)]
    }));
    // Include the same reference twice and distinct objects sharing an ID/title.
    const initial = shuffle(pool.slice(0, 60).concat(pool[3], pool[5]), rand);
    const incoming = shuffle(pool.slice(10).concat(pool[12], pool[12]), rand);
    const recent = shuffle(pool.slice(0, 40).map(item => item.id), rand);
    const selected = seed % 3 === 0 ? 'missing.app' : incoming[seed].id;
    for (const mode of modes) {
      const category = { id: 'apps', items: initial.slice() };
      const model = new MenuOrder([category], storage(mode, recent));
      const old = {
        order: { apps: model.order.apps.slice() },
        modes: { apps: mode },
        recent: model.recent.slice()
      };
      category.items = incoming.slice();
      const previous = { id: 'apps', items: incoming.slice() };
      assert.equal(model.apply(category, selected), previousApply.call(old, previous, selected));
      sameObjects(category.items, previous.items);
      sameObjects(model.order.apps, old.order.apps);

      // Fresh per-apply ranks must follow recent updates, mode changes and additions.
      model.recent = old.recent = [pool[20].id, pool[20].id, pool[30].id];
      model.modes.apps = old.modes.apps = 'recent';
      const added = { id: 'new.app', title: 'App 2' };
      category.items.push(added);
      previous.items.push(added);
      assert.equal(model.apply(category, added.id), previousApply.call(old, previous, added.id));
      sameObjects(category.items, previous.items);
      sameObjects(model.order.apps, old.order.apps);
    }
  }
});

test('sorting uses rank lookups instead of repeated saved-order or recent array searches', () => {
  for (const mode of modes) {
    const category = { id: 'apps', items: [
      { id: 'app.z', title: 'Z' }, { id: 'app.a', title: 'A' }, { id: 'app.b', title: 'A' }
    ] };
    const model = new MenuOrder([category], storage(mode, ['app.b']));
    const forbidden = () => assert.fail('sort must not repeatedly scan rank arrays');
    model.order.apps.indexOf = forbidden;
    model.recent.indexOf = forbidden;
    model.apply(category, 'app.z');
    sameObjects(category.items, mode === 'default' ? model.order.apps
      : mode === 'za' ? [model.order.apps[0], model.order.apps[1], model.order.apps[2]]
        : mode === 'recent' ? [model.order.apps[2], model.order.apps[0], model.order.apps[1]]
          : [model.order.apps[1], model.order.apps[2], model.order.apps[0]]);
  }
});

function isolated(intl) {
  const window = { Intl: intl };
  vm.runInNewContext(source, { window });
  return window.LGXMBMenuOrder;
}

test('one lazy collator serves repeated alphabetical sorts and default/recent sorts need none', () => {
  let constructions = 0, comparisons = 0;
  const Order = isolated({ Collator: function (locale, options) {
    constructions++;
    const collator = new Intl.Collator(locale, options);
    this.compare = (a, b) => { comparisons++; return collator.compare(a, b); };
  } });
  for (let instance = 0; instance < 2; instance++) {
    const category = { id: 'apps', items: [{ id: 'ten', title: 'App 10' }, { id: 'two', title: 'App 2' }] };
    const model = new Order([category], storage());
    model.apply(category, 'two');
    model.modes.apps = 'recent';
    model.apply(category, 'two');
    assert.equal(constructions, instance ? 1 : 0);
    for (const mode of ['az', 'za', 'az']) {
      model.modes.apps = mode;
      model.apply(category, 'two');
      assert.equal(category.items[0].id, mode === 'za' ? 'ten' : 'two');
    }
  }
  assert.equal(constructions, 1);
  assert.ok(comparisons > 0);
});

test('absent or unusable Intl.Collator retains the previous localeCompare fallback', () => {
  let failures = 0;
  for (const intl of [undefined, {}, { Collator: function () { failures++; throw Error('Unavailable'); } }]) {
    const Order = isolated(intl);
    const items = [
      { id: 'ten', title: 'App 10' }, { id: 'accent', title: 'Ápp 2' }, { id: 'two', title: 'app 2' }
    ];
    const category = { id: 'apps', items: items.slice() };
    const model = new Order([category], storage('az'));
    for (const mode of ['az', 'za', 'az']) {
      const previous = { id: 'apps', items: items.slice() };
      model.modes.apps = mode;
      previousApply.call(model, previous, 'two');
      model.apply(category, 'two');
      sameObjects(category.items, previous.items);
    }
  }
  assert.equal(failures, 1, 'an unavailable constructor is checked only once');
});

// Opt-in local CPU benchmark: no timing thresholds in the regression suite.
if (process.env.LGXMB_MENU_BENCHMARK === '1') {
  test('local sorting timings for 100, 500 and 1000 apps', t => {
    for (const size of [100, 500, 1000]) {
      const rand = random(4234);
      const items = Array.from({ length: size }, (_, at) => ({
        id: 'app.' + at,
        title: ['Player', 'Video', 'Game', 'Music', 'Photo'][at % 5] + ' ' + (at % 113)
      }));
      const incoming = shuffle(items, rand);
      const recent = shuffle(items, rand).slice(0, Math.floor(size * 0.6)).map(item => item.id);
      for (const mode of modes) {
        const category = { id: 'apps', items: items.slice() };
        const model = new MenuOrder([category], storage(mode, recent));
        const results = {};
        for (const [label, apply] of [['previous', previousApply], ['current', model.apply]]) {
          const timings = [];
          for (let run = 0; run < 8; run++) {
            category.items = incoming.slice();
            const start = performance.now();
            apply.call(model, category, items[42].id);
            const elapsed = performance.now() - start;
            if (run) timings.push(elapsed);
          }
          results[label] = Number(timings.sort((a, b) => a - b)[3].toFixed(3));
        }
        t.diagnostic(JSON.stringify({ apps: size, mode, medianMs: results }));
      }
    }
  });
}
