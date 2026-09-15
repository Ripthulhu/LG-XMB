/* lg-xmb web application, 2026. SPDX-License-Identifier: GPL-3.0-or-later */
(function (root) {
  'use strict';
  var DURATION = 180, DISTANCE = 10.6, EASING = 'cubic-bezier(.22,.8,.2,1)';

  // Only the list is copied: never native video, audio, preview images or handlers.
  // The real listbox keeps its identity/focus and changes selection synchronously.
  function snapshot(list) {
    var copy = list.cloneNode(false);
    copy.className = 'items-outgoing';
    Array.prototype.forEach.call(list.children, function (row) {
      var style = root.getComputedStyle(row);
      if (style.visibility === 'hidden' || Number(style.opacity) === 0) return;
      var clone = row.cloneNode(true);
      clone.style.transform = style.transform;
      clone.style.opacity = style.opacity;
      copy.appendChild(clone);
    });
    var nodes = [copy].concat(Array.prototype.slice.call(copy.querySelectorAll('*')));
    nodes.forEach(function (node) {
      ['id', 'role', 'aria-label', 'aria-activedescendant', 'aria-selected', 'aria-current'].forEach(function (name) {
        node.removeAttribute(name);
      });
      if (node.tagName === 'BUTTON') node.disabled = true;
      if (node.hasAttribute('tabindex') || node.tagName === 'BUTTON') node.tabIndex = -1;
    });
    copy.removeAttribute('tabindex');
    copy.setAttribute('aria-hidden', 'true');
    copy.setAttribute('inert', ''); // Supplementary; disabled controls work on older engines too.
    return copy;
  }

  function CategoryTransition(list, bar) {
    this.list = list;
    this.bar = bar || null;
    this.ghost = null;
    this.animations = [];
    this.timer = null;
    this.generation = 0;
    this.destroyed = false;
  }

  CategoryTransition.prototype.cancel = function () {
    this.generation++;
    if (this.timer !== null) root.clearTimeout(this.timer);
    this.timer = null;
    this.animations.forEach(function (animation) {
      // Do not use finished promises: cancelling them would reject with AbortError.
      animation.onfinish = null;
      animation.oncancel = null;
      try { animation.cancel(); } catch (ignore) {}
    });
    this.animations = [];
    if (this.ghost && this.ghost.parentNode) this.ghost.parentNode.removeChild(this.ghost);
    this.ghost = null;
    this.list.classList.remove('items-arriving');
  };

  // Read values, not the live CSSStyleDeclaration, before changing selection.
  function appearance(node) {
    var style = root.getComputedStyle(node);
    return {transform:style.transform, opacity:style.opacity, color:style.color};
  }

  function barSnapshot(bar) {
    if (!bar) return [];
    return Array.prototype.map.call(bar.children, function (node) {
      var icon = node.querySelector('.category-icon');
      return {node:node, left:node.getBoundingClientRect().left,
        active:node.getAttribute('aria-current') === 'true',
        opacity:root.getComputedStyle(node).opacity,
        icon:icon, iconStyle:icon && appearance(icon)};
    });
  }

  CategoryTransition.prototype.change = function (steps, update, enabled) {
    if (typeof update !== 'function') throw new TypeError('A synchronous list update is required');
    var reduced = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var timeline = root.document.timeline;
    var allowed = !this.destroyed && enabled && !reduced && !root.document.hidden &&
      Number.isInteger(steps) && steps !== 0 && Math.abs(steps) <= 64 &&
      typeof this.list.animate === 'function' && (!this.bar || typeof this.bar.animate === 'function') &&
      timeline && typeof timeline.currentTime === 'number';
    var ghost = null, from = null, before = [];
    if (allowed) {
      try {
        // Capture the current rendered positions, including a half-finished reversal.
        from = appearance(this.list);
        before = barSnapshot(this.bar);
        ghost = snapshot(this.list);
      } catch (ignore) { allowed = false; }
    }
    this.cancel();
    if (allowed) this.list.classList.add('items-arriving');
    try { update(); } catch (error) { this.cancel(); throw error; }
    if (!allowed) return;
    var self = this, generation = this.generation;
    function finish() { if (self.generation === generation) self.cancel(); }
    try {
      var arrival = (steps * DISTANCE) + 'vw', departure = (-steps * DISTANCE) + 'vw';
      if (this.bar) {
        var active = before.find(function (entry) { return entry.node.getAttribute('aria-current') === 'true'; });
        var old = before.find(function (entry) { return entry.active; });
        if (!active || !old) throw new Error('Missing category anchor');
        var anchor = active.node.getBoundingClientRect().left;
        // Both columns stay horizontally attached to their own category icons.
        // Measured offsets also handle a pointer jump over multiple categories.
        arrival = (active.left - anchor) + 'px';
        departure = (old.node.getBoundingClientRect().left - anchor) + 'px';
      }
      this.ghost = ghost;
      this.list.parentNode.insertBefore(ghost, this.list);
      function animate(node, frames) {
        var animation = node.animate(frames, {duration:DURATION, easing:EASING, fill:'both'});
        self.animations.push(animation);
        return animation;
      }
      animate(ghost, [from, {transform:'translateX(' + departure + ')', opacity:0}]);
      var incoming = animate(this.list, [
        {transform:'translateX(' + arrival + ')', opacity:0},
        {transform:'translateX(0)', opacity:1}
      ]);
      if (this.bar) {
        animate(this.bar, [{transform:'translateX(' + arrival + ')'}, {transform:'translateX(0)'}]);
        before.forEach(function (entry) {
          var opacity = root.getComputedStyle(entry.node).opacity;
          if (entry.opacity !== opacity) animate(entry.node, [{opacity:entry.opacity}, {opacity:opacity}]);
          if (entry.icon) {
            var target = appearance(entry.icon);
            if (entry.iconStyle.transform !== target.transform || entry.iconStyle.color !== target.color) {
              animate(entry.icon, [entry.iconStyle, target]);
            }
          }
        });
      }
      // One timeline, start, duration and easing for bar, columns and selection.
      // Do not mix CSS transitions with WAAPI: reversals shorten CSS transitions.
      var start = timeline.currentTime;
      this.animations.forEach(function (animation) { animation.startTime = start; });
      incoming.onfinish = finish;
      incoming.oncancel = finish;
      this.timer = root.setTimeout(finish, DURATION + 100);
    } catch (ignore) {
      // Animation support is optional. Selection and focus are already current.
      this.cancel();
    }
  };

  CategoryTransition.prototype.destroy = function () {
    this.destroyed = true;
    this.cancel();
  };
  CategoryTransition.DURATION = DURATION;
  CategoryTransition.DISTANCE = DISTANCE;
  CategoryTransition.EASING = EASING;
  root.LGXMBCategoryTransition = CategoryTransition;
  if (typeof module === 'object' && module.exports) module.exports = CategoryTransition;
})(typeof window !== 'undefined' ? window : globalThis);
