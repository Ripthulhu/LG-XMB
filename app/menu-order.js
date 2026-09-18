/* SPDX-License-Identifier: GPL-3.0-or-later */
(function (root) {
  'use strict';
  var DELETED = 'lg-xmb-deleted-apps-v1', KEY = 'lg-xmb-menu-order-v1', MODES = ['default', 'az', 'za'];
  function MenuOrder(categories, storage) {
    this.categories = categories; this.storage = storage;
    this.modes = Object.create(null); this.order = Object.create(null); this.removed = new Set();
    var saved, deleted;
    try { deleted = JSON.parse(storage.getItem(DELETED) || '[]'); } catch (ignore) {}
    if (Array.isArray(deleted)) deleted.slice(0, 1000).forEach(function (id) {
      if (typeof id === 'string' && /^[a-zA-Z0-9]+(?:[._-][a-zA-Z0-9]+)*$/.test(id) && id.length <= 128 &&
          !/^(com\.webos\.|com\.palm\.|com\.lge\.|org\.local\.openxmb\.|org\.webosbrew\.hbchannel)/.test(id)) this.removed.add(id);
    }, this);
    try { saved = JSON.parse(storage.getItem(KEY) || '{}'); } catch (ignore) {}
    for (var i = 0; i < categories.length; i++) {
      var c = categories[i]; this.order[c.id] = c.items.slice();
      this.modes[c.id] = saved && MODES.indexOf(saved[c.id]) >= 0 ? saved[c.id] : 'default';
    }
  }
  MenuOrder.prototype.apply = function (category, selected) {
    var order = this.order[category.id], mode = this.modes[category.id];
    category.items.forEach(function (item) { if (order.indexOf(item) < 0) order.push(item); });
    category.items.sort(function (a, b) {
      var n = mode === 'default' ? 0 : a.title.localeCompare(b.title, undefined, {numeric: true, sensitivity: 'base'});
      return (mode === 'za' ? -n : n) || order.indexOf(a) - order.indexOf(b);
    });
    var at = category.items.findIndex(function (i) { return i.id === selected; });
    return at < 0 ? 0 : at;
  };
  MenuOrder.prototype.set = function (category, mode, selected) {
    if (MODES.indexOf(mode) < 0) throw new Error('Invalid menu sort');
    // Save before mutating either preference or order, so storage refusal is clear.
    var next = Object.assign(Object.create(null), this.modes); next[category.id] = mode;
    this.storage.setItem(KEY, JSON.stringify(next)); this.modes = next;
    return this.apply(category, selected);
  };
  MenuOrder.prototype.remove = function (id, selections) {
    this.removed.add(id);
    try { this.storage.setItem(DELETED, JSON.stringify(Array.from(this.removed))); } catch (ignore) {}
    this.categories.forEach(function (c, ci) {
      var oldIndex = selections[ci], old = c.items[oldIndex], selected = old && old.id;
      c.items = c.items.filter(function (i) { return i.id !== id; });
      if (!c.items.length) c.items.push({id: 'lg-xmb:empty:' + c.id, title: 'No apps', icon: c.icon,
        type: c.title.toUpperCase(), description: 'Install an app from Network to get started.', action: 'empty'});
      var at = c.items.findIndex(function (i) { return i.id === selected; });
      selections[ci] = at >= 0 ? at : Math.max(0, Math.min(oldIndex, c.items.length - 1));
    });
  };
  MenuOrder.prototype.reconcile = function (apps) {
    var self = this, changed = false;
    apps.forEach(function (app) {
      if (!self.removed.has(app.id)) return;
      self.removed.delete(app.id); changed = true;
      self.categories.forEach(function (cat) {
        var original = self.order[cat.id].find(function (item) { return item.id === app.id; });
        if (original && !cat.items.some(function (i) { return i.id === app.id; })) {
          cat.items = cat.items.filter(function (i) { return i.action !== 'empty'; }); cat.items.push(original);
        }
      });
    });
    if (changed) try { this.storage.setItem(DELETED, JSON.stringify(Array.from(this.removed))); } catch (ignore) {}
  };
  root.LGXMBMenuOrder = MenuOrder;
  if (typeof module === 'object' && module.exports) module.exports = MenuOrder;
})(typeof window !== 'undefined' ? window : globalThis);
