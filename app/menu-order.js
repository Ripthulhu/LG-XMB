/* SPDX-License-Identifier: GPL-3.0-or-later */
(function (root) {
  'use strict';
  var DELETED = 'lg-xmb-deleted-apps-v1',
    KEY = 'lg-xmb-menu-order-v1',
    RECENT = 'lg-xmb-recent-items-v1',
    MODES = ['default', 'az', 'za', 'recent'];
  var titleCollator;
  function compareTitles(a, b) {
    if (titleCollator === undefined) {
      titleCollator = null;
      try {
        if (root.Intl && typeof root.Intl.Collator === 'function')
          titleCollator = new root.Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
      } catch (ignore) {}
    }
    return titleCollator
      ? titleCollator.compare(a, b)
      : a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  }
  function MenuOrder(categories, storage) {
    this.categories = categories;
    this.storage = storage;
    this.modes = Object.create(null);
    this.order = Object.create(null);
    this.removed = new Set();
    this.recent = [];
    try {
      var recent = JSON.parse(storage.getItem(RECENT) || '[]');
      if (Array.isArray(recent))
        this.recent = recent
          .filter(function (id, at) {
            return (
              typeof id === 'string' &&
              id.length <= 128 &&
              /^[a-zA-Z0-9]+(?:[._-][a-zA-Z0-9]+)*$/.test(id) &&
              recent.indexOf(id) === at
            );
          })
          .slice(0, 1000);
    } catch (ignore) {}
    var saved, deleted;
    try {
      deleted = JSON.parse(storage.getItem(DELETED) || '[]');
    } catch (ignore) {}
    if (Array.isArray(deleted))
      deleted.slice(0, 1000).forEach(function (id) {
        if (
          typeof id === 'string' &&
          /^[a-zA-Z0-9]+(?:[._-][a-zA-Z0-9]+)*$/.test(id) &&
          id.length <= 128 &&
          !/^(com\.webos\.|com\.palm\.|com\.lge\.|org\.local\.openxmb\.|org\.webosbrew\.hbchannel)/.test(
            id
          )
        )
          this.removed.add(id);
      }, this);
    try {
      saved = JSON.parse(storage.getItem(KEY) || '{}');
    } catch (ignore) {}
    for (var i = 0; i < categories.length; i++) {
      var c = categories[i];
      this.order[c.id] = c.items.slice();
      this.modes[c.id] = saved && MODES.indexOf(saved[c.id]) >= 0 ? saved[c.id] : 'default';
    }
  }
  MenuOrder.prototype.apply = function (category, selected) {
    var order = this.order[category.id],
      mode = this.modes[category.id],
      recent = this.recent,
      ranks = new Map(),
      recentRanks = mode === 'recent' ? new Map() : null;
    // Rank by object identity, retaining the first occurrence just like indexOf.
    // Build once per apply: inventories and recent opens can change between reads.
    order.forEach(function (item, at) {
      if (!ranks.has(item)) ranks.set(item, at);
    });
    category.items.forEach(function (item) {
      if (!ranks.has(item)) {
        ranks.set(item, order.length);
        order.push(item);
      }
    });
    if (recentRanks)
      recent.forEach(function (id, at) {
        if (!recentRanks.has(id)) recentRanks.set(id, at);
      });
    category.items.sort(function (a, b) {
      var n = 0;
      if (recentRanks) {
        var aRecent = recentRanks.get(a.id),
          bRecent = recentRanks.get(b.id);
        n =
          (aRecent === undefined ? recent.length : aRecent) -
          (bRecent === undefined ? recent.length : bRecent);
      } else if (mode !== 'default') n = compareTitles(a.title, b.title);
      return (mode === 'za' ? -n : n) || ranks.get(a) - ranks.get(b);
    });
    var at = category.items.findIndex(function (i) {
      return i.id === selected;
    });
    return at < 0 ? 0 : at;
  };
  // Record successful opens only. A denied storage write must not block launch.
  MenuOrder.prototype.record = function (id) {
    if (
      typeof id !== 'string' ||
      id.length > 128 ||
      !/^[a-zA-Z0-9]+(?:[._-][a-zA-Z0-9]+)*$/.test(id) ||
      this.recent[0] === id
    )
      return;
    this.recent = [id]
      .concat(
        this.recent.filter(function (entry) {
          return entry !== id;
        })
      )
      .slice(0, 1000);
    try {
      this.storage.setItem(RECENT, JSON.stringify(this.recent));
    } catch (ignore) {}
  };
  MenuOrder.prototype.set = function (category, mode, selected) {
    if (MODES.indexOf(mode) < 0) throw new Error('Invalid menu sort');
    // Save before mutating either preference or order, so storage refusal is clear.
    var next = Object.assign(Object.create(null), this.modes);
    next[category.id] = mode;
    this.storage.setItem(KEY, JSON.stringify(next));
    this.modes = next;
    return this.apply(category, selected);
  };
  MenuOrder.prototype.remove = function (id, selections) {
    this.removed.add(id);
    try {
      this.storage.setItem(DELETED, JSON.stringify(Array.from(this.removed)));
    } catch (ignore) {}
    this.categories.forEach(function (c, ci) {
      var oldIndex = selections[ci],
        old = c.items[oldIndex],
        selected = old && old.id;
      c.items = c.items.filter(function (i) {
        return i.id !== id;
      });
      if (!c.items.length)
        c.items.push({
          id: 'lg-xmb:empty:' + c.id,
          title: 'No apps',
          icon: c.icon,
          type: c.title.toUpperCase(),
          description: 'Install an app from Network to get started.',
          action: 'empty'
        });
      var at = c.items.findIndex(function (i) {
        return i.id === selected;
      });
      selections[ci] = at >= 0 ? at : Math.max(0, Math.min(oldIndex, c.items.length - 1));
    });
  };
  MenuOrder.prototype.reconcile = function (apps) {
    var self = this,
      changed = false;
    apps.forEach(function (app) {
      if (!self.removed.has(app.id)) return;
      self.removed.delete(app.id);
      changed = true;
      self.categories.forEach(function (cat) {
        var original = self.order[cat.id].find(function (item) {
          return item.id === app.id;
        });
        if (
          original &&
          !cat.items.some(function (i) {
            return i.id === app.id;
          })
        ) {
          cat.items = cat.items.filter(function (i) {
            return i.action !== 'empty';
          });
          cat.items.push(original);
        }
      });
    });
    if (changed)
      try {
        this.storage.setItem(DELETED, JSON.stringify(Array.from(this.removed)));
      } catch (ignore) {}
  };
  root.LGXMBMenuOrder = MenuOrder;
  if (typeof module === 'object' && module.exports) module.exports = MenuOrder;
})(typeof window !== 'undefined' ? window : globalThis);
