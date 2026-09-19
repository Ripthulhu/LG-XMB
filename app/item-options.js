/* SPDX-License-Identifier: GPL-3.0-or-later */
(function (root) {
  'use strict';
  function ItemOptions(options) {
    this.options = options; this.manager = options.manager;
    this.opening = false; this.opened = false; this.generation = 0; this.request = null;
    this.removal = null; this.item = null; this.view = 'main'; this.infoTimer = null;
    this.mainButtons = null; this.prepared = false; this.categoryDraft = null; this.categoryDefault = false;
    var self = this, doc = root.document;
    this.element = doc.createElement('div'); this.element.className = 'item-options';
    this.element.innerHTML = '<div class="modal-backdrop item-options-shade"></div><section class="modal item-options-panel" role="dialog" aria-modal="true" aria-labelledby="itemOptionsTitle" tabindex="-1">' +
      '<div class="modal-top"><button type="button" class="item-options-close" aria-label="Close item options">×</button></div>' +
      '<h2 class="item-options-heading" id="itemOptionsTitle"></h2><p class="modal-intro item-options-caption" id="itemOptionsCaption"></p>' +
      '<div class="item-options-scroll"><div class="item-options-actions"></div><div class="item-options-content"></div>' +
      '<p class="modal-intro item-options-status" role="status" aria-live="polite"></p></div></section>';
    this.element.hidden = true; this.element.setAttribute('aria-hidden', 'true'); doc.body.appendChild(this.element);
    this.panel = this.element.querySelector('section'); this.title = this.element.querySelector('h2');
    this.caption = this.element.querySelector('.item-options-caption');
    this.actions = this.element.querySelector('.item-options-actions');
    this.content = this.element.querySelector('.item-options-content');
    this.status = this.element.querySelector('.item-options-status');
    this.backButton = this.element.querySelector('.item-options-close');
    this.backButton.tabIndex = -1;
    this.backButton.addEventListener('click', function () { self.back(); });
    this.element.querySelector('.item-options-shade').addEventListener('click', function () { self.close('back'); });
  }
  ItemOptions.prototype.sound = function (name) { this.options.sound(name); };
  ItemOptions.prototype.button = function (label, action, handler, disabled) {
    var b = root.document.createElement('button'); b.type = 'button';
    b.className = 'option item-options-button'; b.textContent = label; b.dataset.action = action;
    // aria-disabled keeps the explanation reachable using the remote.
    if (disabled) b.setAttribute('aria-disabled', 'true');
    var self = this;
    b.addEventListener('click', function () {
      if (!self.opened || self.removal) return;
      if (b.getAttribute('aria-disabled') === 'true') { self.explainRemoval = action === 'delete'; self.status.textContent = action === 'category-apply' ? 'Choose at least one category, or restore the default locations.' : action === 'category' ? 'Inputs and launcher settings keep their categories.' : action === 'sort' ? 'This category has only one item.' : action === 'start' ? 'There is no app to open.' : self.reason || 'Not available for this item.'; return; }
      handler();
    });
    this.actions.appendChild(b); return b;
  };
  ItemOptions.prototype.focus = function () {
    (this.view === 'category' && this.actions.querySelector('[aria-checked=true]') || this.view === 'sort' && this.actions.querySelector('[aria-pressed=true]') || this.actions.querySelector('[data-action=start]') || this.actions.querySelector('button') || this.backButton).focus({preventScroll: true});
  };
  ItemOptions.prototype.prepare = function (item, category) {
    // Populate while the OK hold is still in progress. No native calls, focus,
    // sound or modal state changes until the gesture actually becomes a hold.
    if (this.opened || this.removal) return;
    this.item = {id: item.id, title: item.title, description: item.description, type: item.type, action: item.action};
    this.category = category; this.info = null; this.error = ''; this.view = 'main'; this.prepared = true; this.categoryDraft = null;
    this.render();
    this.panel.querySelectorAll('button').forEach(function (b) { b.tabIndex = -1; });
    // Lay out during the hold without painting or accepting focus/input. The
    // visibility change at open can reuse these dimensions and text positions.
    this.element.classList.add('prepared'); this.element.hidden = false;
  };
  ItemOptions.prototype.open = function (item, category) {
    if (this.removal || this.opened) return false;
    if (!this.prepared || !this.item || this.item.id !== item.id || this.item.title !== item.title || this.category !== category || this.view !== 'main') this.prepare(item, category);
    this.prepared = false; this.generation++; this.opened = true;
    this.panel.querySelectorAll('button').forEach(function (b) { b.tabIndex = 0; });
    this.options.onOpen(); this.element.hidden = false; this.element.classList.add('open'); this.element.classList.remove('prepared'); this.element.setAttribute('aria-hidden', 'false');
    this.focus(); this.sound('option');
    // The menu is usable immediately. Defer the optional metadata request out
    // of this input task, not behind an animation or a sequence of frame hooks.
    var self = this, generation = this.generation;
    this.infoTimer = root.setTimeout(function () {
      self.infoTimer = null;
      if (self.opened && generation === self.generation && !self.item.action) self.loadInfo();
    }, 0);
    return true;
  };
  ItemOptions.prototype.loadInfo = function () {
    var self = this, generation = this.generation, request = this.manager.getAppInfo(this.item.id);
    this.request = request;
    request.then(function (r) {
      if (!self.opened || generation !== self.generation || self.request !== request) return;
      self.request = null; self.info = r.info; self.refreshInfo();
    }, function (e) {
      if (!self.opened || generation !== self.generation || self.request !== request) return;
      self.request = null; self.error = e.message || 'App information is unavailable.'; self.refreshInfo();
    });
  };
  ItemOptions.prototype.refreshInfo = function () {
    // Do not rebuild the action list under a key or pointer while metadata loads.
    this.reason = this.info ? this.info.removalReason : this.error || 'Checking whether this app can be deleted…';
    var b = this.actions.querySelector('[data-action=delete]');
    if (b) { b.setAttribute('aria-disabled', this.info && this.info.removable ? 'false' : 'true'); }
    if (this.view === 'info') this.renderInfo();
    else if (this.view === 'main' && this.explainRemoval) this.status.textContent = this.info && this.info.removable ? '' : this.reason;
  };
  ItemOptions.prototype.render = function () {
    var self = this, item = this.item;
    if (this.view !== 'main' || !this.mainButtons || this.mainButtons[0].parentNode !== this.actions) this.actions.textContent = '';
    this.content.textContent = ''; this.status.textContent = '';
    this.actions.removeAttribute('role'); this.actions.removeAttribute('aria-labelledby');
    this.title.textContent = item.title; this.caption.textContent = this.category.title;
    this.backButton.textContent = '×';
    if (this.view === 'main') {
      this.reason = item.action ? 'Inputs and launcher settings cannot be uninstalled.' :
        this.info ? this.info.removalReason : this.error || 'Checking whether this app can be deleted…';
      if (!this.mainButtons) {
        this.button('Sort By', 'sort', function () { self.view = 'sort'; self.render(); self.focus(); self.sound('option'); });
        this.button('Categories', 'category', function () { self.beginCategories(); self.sound('option'); });
        this.button('Start', 'start', function () { var target = self.item; self.close('start'); self.options.onStart(target); });
        this.button('Delete', 'delete', function () { self.view = 'confirm'; self.render(); self.focus(); self.sound('option'); });
        this.button('Information', 'info', function () { self.view = 'info'; self.render(); self.focus(); self.sound('option'); });
        this.button('Refresh apps', 'refresh', function () { self.close('refresh'); self.options.onRefresh(); });
        this.mainButtons = Array.from(this.actions.children);
      } else if (this.mainButtons[0].parentNode !== this.actions) {
        this.mainButtons.forEach(function (b) { self.actions.appendChild(b); });
      }
      this.actions.querySelector('[data-action=sort]').setAttribute('aria-disabled', String(this.category.items.length < 2));
      this.actions.querySelector('[data-action=category]').setAttribute('aria-disabled', String(!this.options.canAssign || !this.options.canAssign(item)));
      var start = this.actions.querySelector('[data-action=start]');
      start.textContent = item.action && item.action !== 'input' ? 'Open' : 'Start';
      start.setAttribute('aria-disabled', String(item.action === 'empty'));
      this.actions.querySelector('[data-action=delete]').setAttribute('aria-disabled', String(!this.info || !this.info.removable));
      this.actions.querySelector('[data-action=refresh]').setAttribute('aria-disabled', String(!this.options.onRefresh));
      this.mainButtons.forEach(function (b) { b.tabIndex = self.opened ? 0 : -1; });
      // Metadata may enable Delete, but never replace the footer on arrival.
      // Explain an unavailable action only when the user chooses it.
      this.explainRemoval = false;
    } else if (this.view === 'sort') {
      this.caption.textContent = 'Sort this category';
      [['default', 'Default order'], ['az', 'Name: A–Z'], ['za', 'Name: Z–A']].forEach(function (choice) {
        var b = self.button(choice[1], 'sort-' + choice[0], function () {
          try { self.options.onSort(self.category, choice[0], item.id); self.sound('decide'); self.view = 'main'; self.render(); self.focus(); }
          catch (error) { self.status.textContent = 'Could not save the sort order. ' + error.message; self.sound('error'); }
        });
        b.setAttribute('aria-pressed', self.options.getSort(self.category.id) === choice[0] ? 'true' : 'false');
      });
    } else if (this.view === 'category') {
      this.caption.textContent = 'Choose one or more categories';
      this.actions.setAttribute('role', 'group'); this.actions.setAttribute('aria-labelledby', 'itemOptionsCaption');
      this.options.getCategories().forEach(function (choice) {
        var b = self.button(choice.title, 'category-' + choice.id, function () {
          // A native default may be outside the assignable destinations (TV
          // Settings). Drop that implicit location when making an explicit choice.
          if (self.categoryDefault) self.categoryDraft = self.categoryDraft.filter(function (id) {
            return self.options.getCategories().some(function (c) { return c.id === id; });
          });
          var index = self.categoryDraft.indexOf(choice.id);
          if (index < 0) self.categoryDraft.push(choice.id); else self.categoryDraft.splice(index, 1);
          self.categoryDefault = false; self.updateCategoryChecks(); self.sound('cursor');
        });
        b.setAttribute('role', 'checkbox'); b.setAttribute('aria-label', choice.title);
        b.dataset.categoryId = choice.id;
      });
      this.button('Apply categories', 'category-apply', function () {
        try {
          self.options.onCategory(item, self.categoryDefault ? 'default' : self.categoryDraft.slice());
          self.sound('decide'); self.close('category');
        } catch (error) { self.status.textContent = error.message || 'Could not save the categories.'; self.sound('error'); }
      });
      this.button('Default locations', 'category-default', function () {
        self.categoryDraft = self.options.getDefaultCategories(item.id).slice(); self.categoryDefault = true;
        self.updateCategoryChecks(); self.sound('cursor');
      });
      this.button('Cancel', 'category-cancel', function () { self.back(); });
      this.updateCategoryChecks();
    } else if (this.view === 'confirm') {
      this.caption.textContent = 'Delete this app from the TV?';
      var p = root.document.createElement('p'); p.className = 'item-options-warning';
      p.textContent = 'This uninstalls “' + item.title + '”, not just its shortcut. Local app data may also be removed.'; this.content.appendChild(p);
      this.button('Cancel', 'cancel-delete', function () { self.back(); });
      this.button('Delete app', 'confirm-delete', function () { self.deleteConfirmed(); });
      this.status.textContent = 'You can reinstall it later from its store.';
    } else if (this.view === 'info') {
      this.caption.textContent = 'Application information'; this.renderInfo();
      this.button('Back', 'back', function () { self.back(); });
    }
  };
  ItemOptions.prototype.beginCategories = function () {
    this.categoryDefault = this.options.getCategory(this.item.id) === 'default';
    this.categoryDraft = this.options.getCategoryLocations(this.item.id).slice();
    this.view = 'category'; this.render(); this.focus();
  };
  ItemOptions.prototype.updateCategoryChecks = function () {
    var selected = this.categoryDraft;
    this.actions.querySelectorAll('[data-category-id]').forEach(function (b) {
      b.setAttribute('aria-checked', String(selected.indexOf(b.dataset.categoryId) >= 0));
    });
    this.actions.querySelector('[data-action=category-apply]').setAttribute('aria-disabled', String(!selected.length));
    this.actions.querySelector('[data-action=category-default]').setAttribute('aria-pressed', String(this.categoryDefault));
    this.status.textContent = !selected.length ? 'Choose at least one category, or restore the default locations.' :
      this.categoryDefault ? 'Default locations selected. Choose Apply categories to restore them.' :
      'OK toggles a category. Apply saves all choices; Back discards them.';
  };
  ItemOptions.prototype.renderInfo = function () {
    this.content.textContent = '';
    var i = this.info || {}, item = this.item, dl = root.document.createElement('dl'); dl.className = 'item-options-info';
    var locations = this.options.getCategoryLocations && this.options.canAssign && this.options.canAssign(item) ? this.options.getCategoryLocations(item.id) : [this.category.id];
    var choices = this.options.getCategories ? this.options.getCategories() : [this.category];
    var names = choices.filter(function (c) { return locations.indexOf(c.id) >= 0; }).map(function (c) { return c.title; });
    [['Name', i.title || item.title], ['Categories', names.join(', ') || this.category.title], ['App ID', item.action && item.action !== 'input' ? 'Launcher setting' : item.id],
      ['Version', i.version || 'Not reported'], ['Developer', i.vendor || 'Not reported'],
      ['Type', i.type || item.type], ['Installation', i.installation || (item.action ? 'Built-in shortcut' : 'Not reported')],
      ['Description', i.description || item.description || 'Not reported']].forEach(function (pair) {
      var dt = root.document.createElement('dt'), dd = root.document.createElement('dd'); dt.textContent = pair[0]; dd.textContent = pair[1]; dl.appendChild(dt); dl.appendChild(dd);
    }); this.content.appendChild(dl); this.status.textContent = this.error;
  };
  ItemOptions.prototype.deleteConfirmed = function () {
    if (this.removal || !this.info || !this.info.removable) return;
    var self = this, id = this.item.id, title = this.item.title, generation = this.generation;
    this.sound('decide'); this.status.textContent = 'Deleting ' + title + '…';
    this.actions.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-disabled', 'true'); });
    var op = this.removal = this.manager.removeApp(id, true); this.panel.setAttribute('aria-busy', 'true');
    op.then(function (result) {
      self.removal = null; self.panel.removeAttribute('aria-busy');
      if (result.preview) return;
      // Reconcile even if Home went into the background after dispatch.
      self.options.onDeleted(id, title);
      if (self.opened && generation === self.generation) self.close('deleted');
    }, function (e) {
      self.removal = null; self.panel.removeAttribute('aria-busy');
      if (!self.opened || generation !== self.generation) return;
      self.view = 'main'; self.render(); self.focus(); self.status.textContent = e.message || 'Deletion failed.'; self.sound('error');
    });
  };
  ItemOptions.prototype.back = function () {
    if (!this.opened) return;
    if (this.view !== 'main' && !this.removal) { this.categoryDraft = null; this.view = 'main'; this.render(); this.focus(); this.sound('cancel'); }
    else this.close('back');
  };
  ItemOptions.prototype.close = function (reason) {
    if (!this.opened) return;
    root.clearTimeout(this.infoTimer); this.infoTimer = null;
    this.opened = false; this.generation++; this.categoryDraft = null;
    if (this.request && this.request.cancel) this.request.cancel(); this.request = null;
    if (this.removal && this.removal.cancelBeforeDispatch) this.removal.cancelBeforeDispatch();
    this.element.hidden = true; this.element.classList.remove('open'); this.element.setAttribute('aria-hidden', 'true');
    this.panel.querySelectorAll('button').forEach(function (b) { b.tabIndex = -1; });
    this.options.onClose(reason);
    if (reason === 'back') this.sound('cancel');
  };
  ItemOptions.prototype.key = function (e) {
    var enter = e.key === 'Enter' || e.keyCode === 13;
    if (e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 461 || e.key === 'ArrowLeft') {
      e.preventDefault(); if (!e.repeat) this.back(); return;
    }
    if (enter) { e.preventDefault(); if (!e.repeat && this.panel.contains(root.document.activeElement)) root.document.activeElement.click(); return; }
    if (e.key === ' ' && this.view === 'category' && root.document.activeElement && root.document.activeElement.getAttribute('role') === 'checkbox') {
      e.preventDefault(); if (!e.repeat) root.document.activeElement.click(); return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault(); var a = root.document.activeElement;
      if (!e.repeat && a && (a.dataset.action === 'sort' || a.dataset.action === 'category')) a.click(); return;
    }
    var d = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : e.key === 'Tab' ? (e.shiftKey ? -1 : 1) : 0;
    if (d) {
      e.preventDefault(); var buttons = Array.from(this.actions.querySelectorAll('button')).concat([this.backButton]);
      var at = buttons.indexOf(root.document.activeElement); buttons[(Math.max(0, at) + d + buttons.length) % buttons.length].focus(); this.sound('cursor');
    }
  };
  ItemOptions.prototype.getState = function () { return {open: this.opened, opening: false, view: this.view, item: this.item && this.item.id, deleting: !!this.removal, removable: !!(this.info && this.info.removable)}; };
  ItemOptions.prototype.destroy = function () { this.close('lifecycle'); root.clearTimeout(this.infoTimer); this.element.remove(); };
  root.LGXMBItemOptions = ItemOptions;
})(typeof window !== 'undefined' ? window : globalThis);
