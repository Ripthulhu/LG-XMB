// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../app/category-transition.js'), 'utf8');
function fixture() {
  const animations = [], timers = new Map(); let nextTimer = 1;
  class Element {
    constructor(tag = 'DIV') {
      this.tagName = tag; this.attrs = {}; this.children = []; this.style = {}; this.className = '';
      this.classList = {add: c => { this.className += ' ' + c; }, remove: c => { this.className = this.className.split(' ').filter(n => n !== c).join(' '); }};
    }
    setAttribute(n, v) { this.attrs[n] = String(v); }
    getAttribute(n) { return this.attrs[n] ?? null; }
    hasAttribute(n) { return n in this.attrs; }
    removeAttribute(n) { delete this.attrs[n]; }
    appendChild(e) { this.children.push(e); e.parentNode = this; return e; }
    insertBefore(e, before) { this.children.splice(this.children.indexOf(before), 0, e); e.parentNode = this; }
    removeChild(e) { this.children.splice(this.children.indexOf(e), 1); e.parentNode = null; }
    querySelectorAll() { return this.children.flatMap(e => [e, ...e.querySelectorAll()]); }
    cloneNode(deep) {
      const e = new Element(this.tagName); Object.assign(e.attrs, this.attrs); Object.assign(e.style, this.style); e.className = this.className;
      if (deep) this.children.forEach(c => e.appendChild(c.cloneNode(true))); return e;
    }
    animate(frames, options) {
      if (this.failAnimation) throw Error('Animation refused');
      const a = {target: this, frames, options, cancelled: false, cancel() { this.cancelled = true; if (this.oncancel) this.oncancel(); }};
      animations.push(a); return a;
    }
  }
  const root = {document: {hidden: false}, reduced: false, matchMedia() { return {matches:this.reduced}; },
    getComputedStyle(e) { return {transform: e.style.transform || 'none', opacity: e.style.opacity || '1', visibility: e.style.visibility || 'visible'}; },
    setTimeout(fn, delay) { const id = nextTimer++; timers.set(id, {fn, delay}); return id; }, clearTimeout(id) { timers.delete(id); }};
  vm.runInNewContext(source, {window:root});
  const parent = new Element(), list = parent.appendChild(new Element());
  list.setAttribute('id', 'items'); list.setAttribute('role', 'listbox'); list.setAttribute('tabindex', '0');
  list.setAttribute('aria-activedescendant', 'item-0');
  const row = list.appendChild(new Element('BUTTON')); row.setAttribute('id', 'item-0'); row.setAttribute('role', 'option'); row.setAttribute('aria-label', 'Old');
  row.setAttribute('aria-selected', 'true'); row.setAttribute('tabindex', '-1'); row.style.transform = 'matrix(1,0,0,1,0,-240)';
  row.appendChild(new Element('SPAN'));
  const hidden = list.appendChild(new Element('BUTTON')); hidden.style.visibility = 'hidden';
  const preview = parent.appendChild(new Element('VIDEO'));
  const transition = new root.LGXMBCategoryTransition(list);
  let updates = 0; const update = () => { updates++; list.children.length = 0; list.appendChild(new Element('BUTTON')); };
  return {root, list, parent, row, preview, transition, animations, timers, update, updates: () => updates};
}
test('category switch commits synchronously and animates mirrored slide/fade keyframes', () => {
  for (const direction of [-1, 1]) {
    const f = fixture(); f.transition.change(direction, f.update, true);
    assert.equal(f.updates(), 1); assert.equal(f.animations.length, 2); assert.equal(f.parent.children[1], f.list);
    assert.equal(f.animations[0].frames[1].transform, `translateX(${-direction * 10.6}vw)`);
    assert.equal(f.animations[1].frames[0].transform, `translateX(${direction * 10.6}vw)`);
    assert.equal(f.animations[1].frames[0].opacity, 0); assert.equal(f.animations[1].frames[1].opacity, 1);
    assert.equal(f.animations[1].options.duration, 260); assert.equal(f.animations[0].options.duration, 180);
  }
});
test('outgoing snapshot has no duplicate IDs, accessible options, focus targets or native media', () => {
  const f = fixture(); f.transition.change(1, f.update, true); const g = f.transition.ghost;
  assert.equal(g.children.length, 1); assert.equal(g.getAttribute('aria-hidden'), 'true'); assert.ok(g.hasAttribute('inert'));
  assert.equal(g.getAttribute('tabindex'), null); assert.equal(g.children[0].disabled, true); assert.equal(g.children[0].tabIndex, -1);
  assert.equal(g.children[0].style.transform, 'matrix(1,0,0,1,0,-240)');
  for (const e of [g, ...g.querySelectorAll('*')]) { assert.equal(e.getAttribute('id'), null); assert.equal(e.getAttribute('role'), null); assert.notEqual(e.tagName, 'VIDEO'); }
  assert.ok(f.parent.children.includes(f.preview));
});
test('rapid reversals cancel old effects and stale completion cannot delete the new transition', () => {
  const f = fixture(); f.transition.change(1, f.update, true); const old = f.animations[1].onfinish;
  f.list.style.transform = 'matrix(1,0,0,1,76,0)'; f.list.style.opacity = '0.6';
  f.transition.change(-1, f.update, true); const ghost = f.transition.ghost;
  assert.equal(f.updates(), 2); assert.equal(f.timers.size, 1); assert.equal(f.parent.children.length, 3);
  assert.ok(f.animations.slice(0, 2).every(a => a.cancelled)); assert.equal(f.animations[2].frames[0].opacity, '0.6');
  old(); assert.equal(f.transition.ghost, ghost); assert.equal(f.timers.size, 1);
});
test('completion and watchdog each remove the visual layer and release animation resources', () => {
  for (const watchdog of [false, true]) {
    const f = fixture(); f.transition.change(1, f.update, true);
    if (watchdog) [...f.timers.values()][0].fn(); else f.animations[1].onfinish();
    assert.equal(f.transition.ghost, null); assert.equal(f.timers.size, 0); assert.equal(f.parent.children.length, 2);
    assert.ok(f.animations.every(a => a.cancelled)); assert.equal(f.list.className.includes('items-arriving'), false);
  }
});
test('hidden, reduced-motion, disabled, missing API and invalid direction use the immediate update', () => {
  for (const mode of ['hidden', 'system-reduced', 'disabled', 'no-api', 'invalid']) {
    const f = fixture(); if (mode === 'hidden') f.root.document.hidden = true; if (mode === 'system-reduced') f.root.reduced = true;
    if (mode === 'no-api') f.list.animate = undefined;
    f.transition.change(mode === 'invalid' ? 0 : 1, f.update, mode !== 'disabled');
    assert.equal(f.updates(), 1); assert.equal(f.animations.length, 0); assert.equal(f.transition.ghost, null);
  }
});
test('animation refusal and rendering exceptions do not leave a blank or duplicated column', () => {
  const f = fixture(); f.list.failAnimation = true; f.transition.change(1, f.update, true);
  assert.equal(f.updates(), 1); assert.equal(f.transition.ghost, null); assert.equal(f.parent.children.length, 2);
  assert.ok(f.animations.every(a => a.cancelled));
  assert.throws(() => f.transition.change(1, () => { throw Error('render'); }, true), /render/);
  assert.equal(f.transition.ghost, null); assert.equal(f.list.className.includes('items-arriving'), false);
});
test('cancel and destroy are idempotent and destroy permanently disables effects', () => {
  const f = fixture(); f.transition.change(1, f.update, true); f.transition.cancel(); f.transition.cancel();
  f.transition.destroy(); f.transition.destroy(); f.transition.change(1, f.update, true);
  assert.equal(f.updates(), 2); assert.equal(f.animations.length, 2); assert.equal(f.timers.size, 0);
  assert.throws(() => f.transition.change(1, null, true), /synchronous/);
});
