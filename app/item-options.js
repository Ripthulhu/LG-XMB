/* SPDX-License-Identifier: GPL-3.0-or-later */
(function (root) {
  'use strict';
  function ItemOptions(options) {
    this.options = options; this.manager = options.manager;
    this.opened = false; this.generation = 0; this.request = null;
    this.removal = null; this.item = null; this.view = 'main'; this.closeTimer = null;
    this.frame = 0; this.openTimer = null; this.opening = false; this.mainButtons = null; this.prepared = false;
    var self = this, doc = root.document;
    this.element = doc.createElement('div'); this.element.className = 'item-options';
    this.element.innerHTML = '<div class="item-options-shade"></div><section class="item-options-panel" role="dialog" aria-modal="true" aria-labelledby="itemOptionsTitle" tabindex="-1">' +
      '<button type="button" class="item-options-close" aria-label="Close item options">Back</button>' +
      '<h2 class="item-options-heading" id="itemOptionsTitle"></h2><p class="item-options-caption"></p>' +
      '<div class="item-options-actions"></div><div class="item-options-content"></div>' +
      '<p class="item-options-status" role="status" aria-live="polite"></p></section>';
    this.element.setAttribute('aria-hidden', 'true'); doc.body.appendChild(this.element);
    this.panel = this.element.querySelector('section'); this.title = this.element.querySelector('h2');
    this.caption = this.element.querySelector('.item-options-caption');
    this.actions = this.element.querySelector('.item-options-actions');
    this.content = this.element.querySelector('.item-options-content');
    this.status = this.element.querySelector('.item-options-status');
    this.backButton = this.element.querySelector('.item-options-close');
    this.backButton.tabIndex = -1;
    this.panel.addEventListener('transitionend', function (e) {
      if (e.target === self.panel && e.propertyName === 'transform') self.finishOpening();
    });
    this.backButton.addEventListener('click', function () { self.back(); });
    this.element.querySelector('.item-options-shade').addEventListener('click', function () { self.close('back'); });
  }
  ItemOptions.prototype.sound = function (name) { this.options.sound(name); };
  ItemOptions.prototype.button = function (label, action, handler, disabled) {
    var b = root.document.createElement('button'); b.type = 'button';
    b.className = 'item-options-button'; b.textContent = label; b.dataset.action = action;
    // aria-disabled keeps the explanation reachable using the remote.
    if (disabled) b.setAttribute('aria-disabled', 'true');
    var self = this;
    b.addEventListener('click', function () {
      if (!self.opened || self.removal || self.opening) return;
      if (b.getAttribute('aria-disabled') === 'true') { self.status.textContent = action === 'sort' ? 'This category has only one item.' : action === 'start' ? 'There is no app to open.' : self.reason || 'Not available for this item.'; return; }
      handler();
    });
    this.actions.appendChild(b); return b;
  };
  ItemOptions.prototype.focus = function () {
    (this.actions.querySelector('[data-action=start]') || this.actions.querySelector('button') || this.backButton).focus({preventScroll: true});
  };
  ItemOptions.prototype.cancelOpening = function () {
    if (this.frame) root.cancelAnimationFrame(this.frame);
    root.clearTimeout(this.openTimer); this.frame = 0; this.openTimer = null; this.opening = false;
  };
  ItemOptions.prototype.prepare = function (item, category) {
    // Populate while the OK hold is still in progress. No native calls, focus,
    // sound or modal state changes until the gesture actually becomes a hold.
    if (this.opened || this.removal) return;
    this.item = {id: item.id, title: item.title, description: item.description, type: item.type, action: item.action};
    this.category = category; this.info = null; this.error = ''; this.view = 'main'; this.prepared = true;
    this.render();
    this.panel.querySelectorAll('button').forEach(function (b) { b.tabIndex = -1; });
  };
  ItemOptions.prototype.finishOpening = function () {
    if (!this.opened || !this.opening) return;
    this.cancelOpening();
    if (!this.item.action) this.loadInfo();
  };
  ItemOptions.prototype.open = function (item, category) {
    if (this.removal || this.opened) return false;
    this.cancelOpening(); root.clearTimeout(this.closeTimer); this.element.classList.remove('closing', 'instant');
    if (!this.prepared || !this.item || this.item.id !== item.id || this.item.title !== item.title || this.category !== category || this.view !== 'main') this.prepare(item, category);
    this.prepared = false; this.generation++; this.opened = true; this.opening = true;
    this.panel.querySelectorAll('button').forEach(function (b) { b.tabIndex = 0; });
    this.options.onOpen(); this.element.classList.add('open'); this.element.setAttribute('aria-hidden', 'false');
    this.focus(); this.sound('option');
    var self = this, generation = this.generation;
    var reduced = root.document.body.classList.contains('reduced-motion') || (root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (reduced) { this.element.classList.add('shown'); this.finishOpening(); return true; }
    // Leave one presented frame for layout, focus paint and native media unload
    // before moving the already-layered panel. No per-frame JS animation.
    this.frame = root.requestAnimationFrame(function () {
      self.frame = root.requestAnimationFrame(function () {
        self.frame = 0;
        if (!self.opened || generation !== self.generation) return;
        self.element.classList.add('shown');
        // Metadata can change text/geometry: do not ask for it during the slide.
        // transitionend is primary; a bounded fallback covers absent transitions.
        self.openTimer = root.setTimeout(function () {
          if (generation === self.generation) self.finishOpening();
        }, 280);
      });
    });
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
    else if (this.view === 'main') this.status.textContent = this.info && this.info.removable ? 'Hold OK on an item for options. Back closes this panel.' : this.reason;
  };
  ItemOptions.prototype.render = function () {
    var self = this, item = this.item;
    if (this.view !== 'main' || !this.mainButtons || this.mainButtons[0].parentNode !== this.actions) this.actions.textContent = '';
    this.content.textContent = ''; this.status.textContent = '';
    this.title.textContent = item.title; this.caption.textContent = this.category.title;
    this.backButton.textContent = 'Back';
    if (this.view === 'main') {
      this.reason = item.action ? 'Inputs and launcher settings cannot be uninstalled.' :
        this.info ? this.info.removalReason : this.error || 'Checking whether this app can be deleted…';
      if (!this.mainButtons) {
        this.button('Sort By', 'sort', function () { self.view = 'sort'; self.render(); self.focus(); self.sound('option'); });
        this.button('Start', 'start', function () { var target = self.item; self.close('start'); self.options.onStart(target); });
        this.button('Delete', 'delete', function () { self.view = 'confirm'; self.render(); self.focus(); self.sound('option'); });
        this.button('Information', 'info', function () { self.view = 'info'; self.render(); self.focus(); self.sound('option'); });
        this.mainButtons = Array.from(this.actions.children);
      } else if (this.mainButtons[0].parentNode !== this.actions) {
        this.mainButtons.forEach(function (b) { self.actions.appendChild(b); });
      }
      this.mainButtons[0].setAttribute('aria-disabled', String(this.category.items.length < 2));
      this.mainButtons[1].textContent = item.action && item.action !== 'input' ? 'Open' : 'Start';
      this.mainButtons[1].setAttribute('aria-disabled', String(item.action === 'empty'));
      this.mainButtons[2].setAttribute('aria-disabled', String(!this.info || !this.info.removable));
      this.mainButtons.forEach(function (b) { b.tabIndex = self.opened ? 0 : -1; });
      this.status.textContent = this.info && this.info.removable ? 'Hold OK on an item for options. Back closes this panel.' : this.reason;
    } else if (this.view === 'sort') {
      this.caption.textContent = 'Sort this category';
      [['default', 'Default order'], ['az', 'Name: A–Z'], ['za', 'Name: Z–A']].forEach(function (choice) {
        var b = self.button(choice[1], 'sort-' + choice[0], function () {
          try { self.options.onSort(self.category, choice[0], item.id); self.sound('decide'); self.view = 'main'; self.render(); self.focus(); }
          catch (error) { self.status.textContent = 'Could not save the sort order. ' + error.message; self.sound('error'); }
        });
        b.setAttribute('aria-pressed', self.options.getSort(self.category.id) === choice[0] ? 'true' : 'false');
      });
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
  ItemOptions.prototype.renderInfo = function () {
    this.content.textContent = '';
    var i = this.info || {}, item = this.item, dl = root.document.createElement('dl'); dl.className = 'item-options-info';
    [['Name', i.title || item.title], ['App ID', item.action && item.action !== 'input' ? 'Launcher setting' : item.id],
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
    if (this.view !== 'main' && !this.removal) { this.view = 'main'; this.render(); this.focus(); this.sound('cancel'); }
    else this.close('back');
  };
  ItemOptions.prototype.close = function (reason) {
    if (!this.opened) return;
    var wasOpening = this.opening; this.cancelOpening();
    this.opened = false; this.generation++;
    if (this.request && this.request.cancel) this.request.cancel(); this.request = null;
    if (this.removal && this.removal.cancelBeforeDispatch) this.removal.cancelBeforeDispatch();
    this.element.classList.toggle('instant', reason === 'lifecycle' || reason === 'start');
    this.element.classList.remove('open', 'shown'); this.element.setAttribute('aria-hidden', 'true');
    this.panel.querySelectorAll('button').forEach(function (b) { b.tabIndex = -1; });
    var self = this;
    if (reason !== 'lifecycle' && reason !== 'start' && !wasOpening) { this.element.classList.add('closing'); this.closeTimer = root.setTimeout(function () { self.element.classList.remove('closing'); }, 230); }
    else this.element.classList.remove('closing');
    this.options.onClose(reason);
    if (reason === 'back') this.sound('cancel');
  };
  ItemOptions.prototype.key = function (e) {
    var enter = e.key === 'Enter' || e.keyCode === 13;
    if (e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 461 || e.key === 'ArrowLeft') {
      e.preventDefault(); if (!e.repeat) this.back(); return;
    }
    if (this.opening) { e.preventDefault(); return; }
    if (enter) { e.preventDefault(); if (!e.repeat && this.panel.contains(root.document.activeElement)) root.document.activeElement.click(); return; }
    if (e.key === 'ArrowRight') {
      e.preventDefault(); var a = root.document.activeElement;
      if (!e.repeat && a && a.dataset.action === 'sort') a.click(); return;
    }
    var d = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : e.key === 'Tab' ? (e.shiftKey ? -1 : 1) : 0;
    if (d) {
      e.preventDefault(); var buttons = Array.from(this.actions.querySelectorAll('button')).concat([this.backButton]);
      var at = buttons.indexOf(root.document.activeElement); buttons[(Math.max(0, at) + d + buttons.length) % buttons.length].focus(); this.sound('cursor');
    }
  };
  ItemOptions.prototype.getState = function () { return {open: this.opened, opening: this.opening, view: this.view, item: this.item && this.item.id, deleting: !!this.removal, removable: !!(this.info && this.info.removable)}; };
  ItemOptions.prototype.destroy = function () { this.close('lifecycle'); this.cancelOpening(); root.clearTimeout(this.closeTimer); this.element.remove(); };
  root.LGXMBItemOptions = ItemOptions;
})(typeof window !== 'undefined' ? window : globalThis);
