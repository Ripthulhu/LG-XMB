/* SPDX-License-Identifier: GPL-3.0-or-later */
(function (root) {
  'use strict';
  var CATEGORY_STORAGE_KEY = 'lg-xmb-app-categories-v1',
    HIDDEN_STORAGE_KEY = 'lg-xmb-hidden-apps-v1';
  var inputs =
    root.LGXMBInputs ||
    (typeof module === 'object' && module.exports ? require('./input-discovery.js') : null);
  // Settings and input actions stay fixed; only app shortcuts are assignable.
  var DESTINATIONS = ['photo', 'music', 'video', 'tv', 'apps', 'browser', 'network'];
  function isValidAppId(id) {
    return (
      typeof id === 'string' && id.length <= 128 && /^[a-zA-Z0-9]+(?:[._-][a-zA-Z0-9]+)*$/.test(id)
    );
  }
  function isLauncher(id) {
    return id === 'org.local.openxmb.c5' || id === 'com.webos.app.home';
  }
  function sanitizeTitle(value, fallback) {
    return typeof value === 'string' && value.trim()
      ? value
          .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '')
          .slice(0, 120) || fallback
      : fallback;
  }
  // The catalog owns app artwork; this model only places and retains rows.
  // An explicit resolver also lets tests and alternate catalogs stay independent.
  function AppCategories(categories, order, storage, iconForApp) {
    this.categories = categories;
    this.order = order;
    this.storage = storage;
    this.iconForApp =
      iconForApp ||
      (root.LGXMBCatalog && root.LGXMBCatalog.iconForApp) ||
      function () {
        return 'application';
      };
    this.base = categories.map(function (c) {
      return c.items
        .filter(function (i) {
          return i.action !== 'empty';
        })
        .slice();
    });
    this.inventory = new Map();
    this.assignments = Object.create(null);
    this.waitForAbsence = new Set();
    this.empties = Object.create(null);
    this.hidden = Object.create(null);
    try {
      var hiddenRaw = storage.getItem(HIDDEN_STORAGE_KEY),
        hidden = hiddenRaw && hiddenRaw.length <= 262144 ? JSON.parse(hiddenRaw) : null;
      if (hidden && typeof hidden === 'object' && !Array.isArray(hidden))
        Object.keys(hidden)
          .slice(0, 1000)
          .forEach(function (id) {
            if (isValidAppId(id) && !isLauncher(id))
              this.hidden[id] = sanitizeTitle(hidden[id], id);
          }, this);
    } catch (ignore) {}
    var saved;
    try {
      var raw = storage.getItem(CATEGORY_STORAGE_KEY);
      if (raw && raw.length <= 262144) saved = JSON.parse(raw);
    } catch (ignore) {}
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      Object.keys(saved)
        .slice(0, 1000)
        .forEach(function (id) {
          var destinations = this.normalize(saved[id]);
          if (isValidAppId(id) && !isLauncher(id) && destinations)
            this.assignments[id] = destinations;
        }, this);
    }
  }
  AppCategories.prototype.destination = function (id) {
    return (
      DESTINATIONS.indexOf(id) >= 0 &&
      this.categories.some(function (c) {
        return c.id === id;
      })
    );
  };
  AppCategories.prototype.canAssign = function (item) {
    return !!item && !item.action && isValidAppId(item.id) && !isLauncher(item.id);
  };
  AppCategories.prototype.canHide = function (item) {
    return this.canAssign(item);
  };
  AppCategories.prototype.hiddenApps = function () {
    return Object.keys(this.hidden)
      .map(function (id) {
        var item = this.inventory.get(id);
        return { id: id, title: item ? item.title : this.hidden[id] };
      }, this)
      .sort(function (a, b) {
        return (
          a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }) ||
          a.id.localeCompare(b.id)
        );
      });
  };
  AppCategories.prototype.hide = function (item, selections) {
    if (!this.canHide(item)) throw new Error('Only apps can be hidden.');
    if (
      !this.categories.some(function (c) {
        return c.items.some(function (row) {
          return row.id === item.id && !row.action;
        });
      })
    )
      throw new Error('This app is no longer in the menu.');
    var next = Object.assign(Object.create(null), this.hidden);
    next[item.id] = sanitizeTitle(item.title, item.id);
    if (Object.keys(next).length > 1000) throw new Error('Too many hidden apps.');
    this.storage.setItem(HIDDEN_STORAGE_KEY, JSON.stringify(next));
    this.hidden = next;
    return this.rebuild(selections);
  };
  AppCategories.prototype.restore = function (id, selections) {
    if (!Object.prototype.hasOwnProperty.call(this.hidden, id)) return false;
    var next = Object.assign(Object.create(null), this.hidden);
    delete next[id];
    this.storage.setItem(HIDDEN_STORAGE_KEY, JSON.stringify(next));
    this.hidden = next;
    return this.rebuild(selections);
  };
  AppCategories.prototype.choices = function () {
    return this.categories
      .filter(function (c) {
        return this.destination(c.id);
      }, this)
      .map(function (c) {
        return { id: c.id, title: c.title };
      });
  };
  // Accept old scalar assignments without writing storage during startup.
  AppCategories.prototype.normalize = function (value) {
    var ids = typeof value === 'string' ? [value] : value;
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > DESTINATIONS.length ||
      !ids.every(function (id) {
        return this.destination(id);
      }, this)
    )
      return null;
    return this.choices()
      .map(function (c) {
        return c.id;
      })
      .filter(function (id) {
        return ids.indexOf(id) >= 0;
      });
  };
  AppCategories.prototype.get = function (id) {
    return this.assignments[id] ? this.assignments[id].slice() : 'default';
  };
  AppCategories.prototype.defaultLocations = function (id) {
    var locations = this.categories
      .filter(function (c, ci) {
        return this.base[ci].some(function (item) {
          return item.id === id && !item.action;
        });
      }, this)
      .map(function (c) {
        return c.id;
      });
    return locations.length ? locations : this.destination('apps') ? ['apps'] : [];
  };
  AppCategories.prototype.locations = function (id) {
    return this.assignments[id] ? this.assignments[id].slice() : this.defaultLocations(id);
  };
  AppCategories.prototype.snapshot = function () {
    var result = Object.create(null);
    Object.keys(this.assignments).forEach(function (id) {
      result[id] = this.assignments[id].slice();
    }, this);
    return result;
  };
  AppCategories.prototype.persistRemoved = function () {
    try {
      this.storage.setItem(
        'lg-xmb-deleted-apps-v1',
        JSON.stringify(Array.from(this.order.removed))
      );
    } catch (ignore) {}
  };
  // Synchronize a complete native app inventory while preserving row objects.
  AppCategories.prototype.reconcile = function (apps, selections) {
    // This method accepts a COMPLETE, successful visible-app snapshot, never
    // a native delta/acknowledgement or a failed enumeration interpreted as [].
    if (!Array.isArray(apps) || apps.length > 1000) throw new Error('Invalid application list');
    var next = new Map(),
      metadata = false,
      removedChanged = false;
    apps.forEach(function (app) {
      if (
        !app ||
        !isValidAppId(app.id) ||
        isLauncher(app.id) ||
        next.has(app.id) ||
        (inputs && inputs.identity(app.id))
      )
        return;
      var item = this.inventory.get(app.id),
        name = sanitizeTitle(app.title, app.id);
      if (!item)
        item = {
          id: app.id,
          title: name,
          icon: this.iconForApp(app.id),
          type: 'ON YOUR TV',
          description: 'Open ' + name + '.',
          discovered: true
        };
      else if (item.title !== name) {
        item.title = name;
        item.description = 'Open ' + name + '.';
        metadata = true;
      }
      next.set(app.id, item);
    }, this);
    // A successful uninstall may precede the platform's list update. Do not
    // resurrect it from that stale snapshot. Once absent, a later presence is
    // a reinstall and its user's category is still available.
    this.waitForAbsence.forEach(function (id) {
      if (!next.has(id)) this.waitForAbsence.delete(id);
    }, this);
    next.forEach(function (_, id) {
      if (this.order.removed.has(id) && !this.waitForAbsence.has(id)) {
        this.order.removed.delete(id);
        removedChanged = true;
      }
    }, this);
    if (removedChanged) this.persistRemoved();
    this.inventory = next;
    return this.rebuild(selections) || metadata;
  };
  // Replace physical inputs from a complete EIM snapshot, retaining row objects
  // and selection. Keeping this in the model prevents app refreshes from
  // resurrecting sockets that do not exist on this TV.
  AppCategories.prototype.reconcileInputs = function (snapshot, selections) {
    if (!inputs || !Array.isArray(snapshot) || snapshot.length > 128)
      throw new Error('Invalid input list.');
    var ci = this.categories.findIndex(function (category) {
      return category.id === 'tv';
    });
    if (ci < 0) return false;
    var before = this.base[ci],
      byId = new Map(),
      seen = new Set(),
      metadata = false;
    before.forEach(function (item) {
      if (item.action === 'input') byId.set(item.id, item);
    });
    var rows = snapshot
      .map(function (input) {
        var next = inputs.item(input);
        if (!next || seen.has(next.id)) return null;
        seen.add(next.id);
        var row = byId.get(next.id);
        if (!row) return next;
        Object.keys(next).forEach(function (key) {
          if (row[key] !== next[key]) {
            row[key] = next[key];
            metadata = true;
          }
        });
        return row;
      })
      .filter(Boolean);
    this.base[ci] = before
      .filter(function (item) {
        return item.action !== 'input';
      })
      .concat(rows);
    return this.rebuild(selections) || metadata;
  };
  // Rebuild category membership from curated rows, installed apps and user
  // overrides. Keep row identity and the selected app wherever possible.
  AppCategories.prototype.rebuild = function (selections) {
    var before = this.categories.map(function (c, ci) {
      return {
        items: c.items,
        index: selections[ci],
        id: c.items[selections[ci]] && c.items[selections[ci]].id
      };
    });
    var lists = this.categories.map(function () {
        return [];
      }),
      byId = new Map(),
      seen = new Set(),
      changed = false;
    // The DOM caches buttons by item object. Each category needs its own row,
    // or appending a shared button to Video steals it from Music. Reuse rows
    // within their category so unchanged inventory reads do not repaint them.
    var rows = before.map(function (c) {
      return new Map(
        c.items.map(function (item) {
          return [item.id, item];
        })
      );
    });
    this.categories.forEach(function (c, ci) {
      this.order.order[c.id].forEach(function (item) {
        if (!rows[ci].has(item.id)) rows[ci].set(item.id, item);
      });
    }, this);
    var defaults = this.base.map(function (items) {
      return new Map(
        items.map(function (item) {
          return [item.id, item];
        })
      );
    });
    var added = lists.map(function () {
      return new Set();
    });
    function appendRow(ci, source) {
      if (added[ci].has(source.id)) return;
      added[ci].add(source.id);
      if (source.action) {
        lists[ci].push(source);
        return;
      }
      var template = defaults[ci].get(source.id) || source,
        item = rows[ci].get(source.id);
      if (!item || item.action) item = defaults[ci].get(source.id) || Object.assign({}, template);
      else
        Object.keys(template).forEach(function (key) {
          if (item[key] !== template[key]) {
            item[key] = template[key];
            changed = true;
          }
        });
      lists[ci].push(item);
    }
    // Catalog entries provide placement and artwork, never proof an app exists.
    // Native inventory must confirm each shortcut before it is shown.
    this.base.forEach(function (items, ci) {
      items.forEach(function (item) {
        if (item.action) {
          appendRow(ci, item);
          return;
        }
        if (!this.inventory.has(item.id)) return;
        if (!byId.has(item.id)) byId.set(item.id, item);
        seen.add(item.id);
        if (this.hidden[item.id] || this.order.removed.has(item.id) || this.assignments[item.id])
          return;
        appendRow(ci, item);
      }, this);
    }, this);
    // Unassigned installed apps appear under Apps.
    this.inventory.forEach(function (item, id) {
      if (!byId.has(id)) byId.set(id, item);
      if (this.hidden[id] || seen.has(id) || this.order.removed.has(id) || this.assignments[id])
        return;
      var ci = this.categories.findIndex(function (c) {
        return c.id === 'apps';
      });
      if (ci >= 0) appendRow(ci, item);
    }, this);
    Object.keys(this.assignments).forEach(function (id) {
      var item = byId.get(id);
      if (!item || !this.canAssign(item) || this.hidden[id] || this.order.removed.has(id)) return;
      this.assignments[id].forEach(function (destination) {
        var ci = this.categories.findIndex(function (c) {
          return c.id === destination;
        });
        if (ci >= 0) appendRow(ci, item);
      }, this);
    }, this);
    this.categories.forEach(function (c, ci) {
      if (!lists[ci].length) {
        if (!this.empties[c.id])
          this.empties[c.id] = {
            id: 'lg-xmb:empty:' + c.id,
            title: 'No apps',
            icon: c.icon,
            type: c.title.toUpperCase(),
            description: 'Assign an app here using its options menu, or install one from Network.',
            action: 'empty'
          };
        lists[ci].push(this.empties[c.id]);
      }
      c.items = lists[ci];
      // Only keep real live/default rows in the sorting history. The DOM uses
      // object identity, so surviving rows can be moved without recreation.
      var retained = new Set(this.base[ci].concat(c.items));
      this.order.order[c.id].forEach(function (item) {
        if (this.hidden[item.id]) retained.add(item);
      }, this);
      this.order.order[c.id] = this.order.order[c.id].filter(function (item) {
        return item.action !== 'empty' && retained.has(item);
      });
      this.order.apply(c, before[ci].id);
      var at = c.items.findIndex(function (i) {
        return i.id === before[ci].id;
      });
      selections[ci] =
        at >= 0 ? at : Math.max(0, Math.min(before[ci].index || 0, c.items.length - 1));
      if (
        c.items.length !== before[ci].items.length ||
        c.items.some(function (item, i) {
          return item !== before[ci].items[i];
        })
      )
        changed = true;
      else c.items = before[ci].items;
    }, this);
    return changed;
  };
  AppCategories.prototype.assign = function (item, value, selections, preferredCategory) {
    var destinations = value === 'default' ? null : this.normalize(value);
    if (!this.canAssign(item) || (value !== 'default' && !destinations))
      throw new Error('Choose at least one available category.');
    var found = this.categories.some(function (c) {
      return c.items.some(function (i) {
        return i.id === item.id && !i.action;
      });
    });
    if (!found) throw new Error('This app is no longer in the menu.');
    var next = Object.assign(Object.create(null), this.assignments);
    if (value === 'default') delete next[item.id];
    else next[item.id] = destinations;
    if (Object.keys(next).length > 1000) throw new Error('Too many saved app categories.');
    // Persist the complete choice before moving any shortcuts. A refused save
    // leaves the menu, selection and the previous assignment unchanged.
    this.storage.setItem(CATEGORY_STORAGE_KEY, JSON.stringify(next));
    this.assignments = next;
    this.rebuild(selections);
    var matches = this.categories
      .map(function (c, ci) {
        return c.items.some(function (i) {
          return i.id === item.id;
        })
          ? ci
          : -1;
      })
      .filter(function (ci) {
        return ci >= 0;
      });
    var destination = matches.find(function (ci) {
      return this.categories[ci].id === preferredCategory;
    }, this);
    if (destination === undefined) destination = matches.length ? matches[0] : -1;
    if (destination >= 0)
      selections[destination] = this.categories[destination].items.findIndex(function (i) {
        return i.id === item.id;
      });
    return destination;
  };
  AppCategories.prototype.deleted = function (id, selections) {
    this.waitForAbsence.add(id);
    this.order.removed.add(id);
    this.persistRemoved();
    this.inventory.delete(id);
    return this.rebuild(selections);
  };
  root.LGXMBAppCategories = AppCategories;
  if (typeof module === 'object' && module.exports) module.exports = AppCategories;
})(typeof window !== 'undefined' ? window : globalThis);
