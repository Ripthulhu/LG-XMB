/* SPDX-License-Identifier: GPL-3.0-or-later */
(function (root) {
  'use strict';
  var FIELDS = [['day', 'Day'], ['month', 'Month'], ['year', 'Year'], ['hour', 'Hour'], ['minute', 'Minute'], ['second', 'Second']];
  function DateTimeSettings(options) {
    this.options = options; this.api = options.api || root.LGXMBSystemTime;
    this.generation = 0; this.read = null; this.opened = false; this.pending = false; this.buttons = [];
    this.number = ''; this.numberAt = 0; this.numberField = '';
  }
  DateTimeSettings.prototype.open = function (parent) {
    this.close(); this.opened = true; this.parent = parent; this.loaded = false; this.pending = false;
    parent.innerHTML = '<p class="date-time-zone"></p><div class="date-time-fields" role="group" aria-label="Date and time"></div>' +
      '<p class="date-time-help">Left/Right selects a field. Up/Down changes it. Number keys also work. OK moves to Apply.</p>' +
      '<button type="button" class="option date-time-occurrence" hidden></button>' +
      '<button type="button" class="option" id="applyDateTime" aria-disabled="true">Apply date &amp; time</button>' +
      '<button type="button" class="option" id="readDateTime">Read current TV time</button>' +
      '<p class="date-time-help">Uses the TV’s current time zone. Automatic time settings are not changed and may override a manual value.</p>' +
      '<p class="date-time-status" role="status" aria-live="polite"></p>';
    this.zone = parent.querySelector('.date-time-zone'); this.status = parent.querySelector('.date-time-status');
    this.applyButton = parent.querySelector('#applyDateTime'); this.readButton = parent.querySelector('#readDateTime');
    this.occurrence = parent.querySelector('.date-time-occurrence');
    var self = this, container = parent.querySelector('.date-time-fields'); this.buttons = [];
    FIELDS.forEach(function (f) {
      var field = root.document.createElement('div'); field.className = 'date-time-field';
      var label = root.document.createElement('span'); label.textContent = f[1]; field.appendChild(label);
      var up = root.document.createElement('button'); up.type = 'button'; up.className = 'date-time-step'; up.textContent = '+'; up.tabIndex = -1; up.setAttribute('aria-label', 'Increase ' + f[1].toLowerCase());
      var b = root.document.createElement('button'); b.type = 'button'; b.className = 'date-time-value'; b.dataset.field = f[0]; b.setAttribute('role', 'spinbutton'); b.setAttribute('aria-label', f[1]); b.setAttribute('aria-valuetext', 'Loading'); b.textContent = '—';
      var down = root.document.createElement('button'); down.type = 'button'; down.className = 'date-time-step'; down.textContent = '−'; down.tabIndex = -1; down.setAttribute('aria-label', 'Decrease ' + f[1].toLowerCase());
      up.onclick = function () { self.change(f[0], 1); b.focus({preventScroll: true}); };
      down.onclick = function () { self.change(f[0], -1); b.focus({preventScroll: true}); };
      b.onclick = function () { b.focus({preventScroll: true}); };
      field.appendChild(up); field.appendChild(b); field.appendChild(down); container.appendChild(field); self.buttons.push(b);
    });
    this.applyButton.onclick = function () { self.apply(); };
    this.readButton.onclick = function () { if (!self.pending) self.load(); };
    this.occurrence.onclick = function () { self.choice = self.choice ? 0 : 1; self.update(); };
    this.load();
  };
  DateTimeSettings.prototype.load = function () {
    if (!this.opened || this.pending) return;
    if (this.read && this.read.cancel) this.read.cancel();
    var self = this, generation = ++this.generation;
    this.loaded = false; this.status.textContent = ''; this.zone.textContent = 'Time zone · Reading…'; this.applyButton.setAttribute('aria-disabled', 'true');
    var op = this.read = this.api.get();
    op.then(function (r) {
      if (!self.opened || generation !== self.generation || self.read !== op) return;
      self.read = null; self.loaded = true; self.value = Object.assign({}, r.local); self.timezone = r.timezone; self.choice = 0;
      self.number = ''; self.zone.textContent = (r.preview ? 'Desktop preview · ' : 'Time zone · ') + r.timezone;
      self.status.textContent = ''; self.update();
    }, function (e) { if (self.opened && generation === self.generation) { self.read = null; self.status.textContent = e.message; } });
  };
  DateTimeSettings.prototype.range = function (name) {
    return name === 'year' ? [2000, 2099] : name === 'month' ? [1, 12] : name === 'day' ? [1, this.api.days(this.value.year, this.value.month)] : [0, name === 'hour' ? 23 : 59];
  };
  DateTimeSettings.prototype.update = function () {
    if (!this.loaded) return;
    var self = this;
    this.buttons.forEach(function (b) {
      var n = b.dataset.field, v = self.value[n], range = self.range(n);
      var text = String(v).padStart(n === 'year' ? 4 : 2, '0');
      if (b.textContent !== text) b.textContent = text;
      b.setAttribute('aria-valuenow', v); b.setAttribute('aria-valuetext', v); b.setAttribute('aria-valuemin', range[0]); b.setAttribute('aria-valuemax', range[1]);
    });
    this.times = [];
    try { this.times = this.api.candidates(this.value, this.timezone); }
    catch (e) { this.status.textContent = e.message; }
    this.occurrence.hidden = this.times.length !== 2;
    this.occurrence.textContent = 'Repeated clock hour: ' + (this.choice ? 'second occurrence' : 'first occurrence') + ' (select to change)';
    this.applyButton.setAttribute('aria-disabled', String(this.pending || !this.times.length));
    this.readButton.setAttribute('aria-disabled', String(this.pending));
  };
  DateTimeSettings.prototype.change = function (name, delta, direct) {
    if (!this.loaded || this.pending || root.document.hidden) return;
    var range = this.range(name), value = direct === undefined ? this.value[name] + delta : direct;
    if (direct === undefined) value = value > range[1] ? range[0] : value < range[0] ? range[1] : value;
    if (!Number.isInteger(value) || value < range[0] || value > range[1]) return;
    this.value[name] = value; this.value.day = Math.min(this.value.day, this.api.days(this.value.year, this.value.month));
    this.choice = 0; this.status.textContent = ''; this.update(); this.options.sound('cursor');
  };
  DateTimeSettings.prototype.apply = function () {
    if (!this.opened || !this.loaded || this.pending || root.document.hidden || !this.times.length) return;
    var self = this, generation = this.generation, utc = this.times[this.choice] || this.times[0];
    this.pending = true; this.parent.setAttribute('aria-busy', 'true'); this.update(); this.status.textContent = 'Setting TV time…';
    this.options.sound('decide');
    this.api.set(utc).then(function (result) {
      if (!self.opened || generation !== self.generation) return;
      if (result.preview) { self.finish('Preview only — no TV clock was changed.'); return; }
      // Refresh the on-screen clock without resetting renderer quality or animation.
      self.options.onApplied();
      self.status.textContent = 'Checking the TV clock…';
      var op = self.read = self.api.get();
      op.then(function (r) {
        if (!self.opened || generation !== self.generation || self.read !== op) return;
        self.read = null;
        self.finish(Math.abs(r.utc - utc) <= 10 ? 'TV date and time updated.' : 'The service accepted the change, but the TV reports a different time. Check automatic time in TV Settings.');
      }, function () { if (self.opened && generation === self.generation) { self.read = null; self.finish('The service accepted the change; reading it back failed.'); } });
    }, function (e) { if (self.opened && generation === self.generation) { self.finish(e.message); self.options.sound('error'); } });
  };
  DateTimeSettings.prototype.finish = function (message) { this.pending = false; this.parent.removeAttribute('aria-busy'); this.update(); this.status.textContent = message; };
  DateTimeSettings.prototype.key = function (e) {
    var active = root.document.activeElement, index = this.buttons.indexOf(active), isEnter = e.key === 'Enter' || e.keyCode === 13;
    var controls = this.buttons.concat(this.occurrence.hidden ? [] : [this.occurrence]).concat([this.applyButton, this.readButton, this.options.closeButton]);
    if (e.key === 'Tab' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault(); this.number = ''; var d = e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey) ? -1 : 1;
      controls[(Math.max(0, controls.indexOf(active)) + d + controls.length) % controls.length].focus(); return;
    }
    if (index >= 0) {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); this.number = ''; this.change(active.dataset.field, e.key === 'ArrowUp' ? 1 : -1); }
      else if (isEnter) { e.preventDefault(); if (!e.repeat) this.applyButton.focus(); }
      else if (/^[0-9]$/.test(e.key) && !e.repeat) {
        e.preventDefault(); var name = active.dataset.field, now = root.performance.now(), max = name === 'year' ? 4 : 2;
        if (this.numberField !== name || now - this.numberAt > 1500 || this.number.length >= max) this.number = '';
        this.number += e.key; this.numberAt = now; this.numberField = name;
        this.change(name, 0, Number(this.number));
      }
      return;
    }
    if (isEnter) { e.preventDefault(); if (!e.repeat && controls.indexOf(active) >= 0) active.click(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); var delta = e.key === 'ArrowDown' ? 1 : -1; controls[(Math.max(0, controls.indexOf(active)) + delta + controls.length) % controls.length].focus(); }
  };
  DateTimeSettings.prototype.close = function () {
    this.opened = false; this.generation++;
    if (this.read && this.read.cancel) this.read.cancel(); this.read = null;
    if (this.parent) this.parent.removeAttribute('aria-busy');
    // Already-dispatched writes finish independently; no undo or late dialog update.
  };
  root.LGXMBDateTimeSettings = DateTimeSettings;
})(typeof window !== 'undefined' ? window : globalThis);
