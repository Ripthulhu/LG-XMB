/* lg-xmb web application, 2026. SPDX-License-Identifier: GPL-3.0-or-later */
(function (root) {
  'use strict';
  var DURATION = 260, EXIT_DURATION = 180, DISTANCE = 10.6;

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

  function CategoryTransition(list) {
    this.list = list;
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

  CategoryTransition.prototype.change = function (direction, update, enabled) {
    if (typeof update !== 'function') throw new TypeError('A synchronous list update is required');
    var reduced = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var allowed = !this.destroyed && enabled && !reduced && !root.document.hidden &&
      (direction === -1 || direction === 1) && typeof this.list.animate === 'function';
    var ghost = null, from = null;
    if (allowed) {
      try {
        // Read the in-flight position before cancelling a previous swipe.
        var style = root.getComputedStyle(this.list);
        from = {transform:style.transform, opacity:style.opacity};
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
      this.ghost = ghost;
      this.list.parentNode.insertBefore(ghost, this.list);
      var outgoing = ghost.animate([
        from,
        {transform:'translateX(' + (-direction * DISTANCE) + 'vw)', opacity:0}
      ], {duration:EXIT_DURATION, easing:'cubic-bezier(.22,.8,.2,1)', fill:'both'});
      this.animations.push(outgoing);
      var incoming = this.list.animate([
        {transform:'translateX(' + (direction * DISTANCE) + 'vw)', opacity:0},
        {transform:'translateX(0)', opacity:1}
      ], {duration:DURATION, easing:'cubic-bezier(.22,.8,.2,1)', fill:'both'});
      this.animations.push(incoming);
      incoming.onfinish = finish;
      incoming.oncancel = finish;
      // A missing finish notification must not leave stale layers in the DOM.
      this.timer = root.setTimeout(finish, DURATION + 100);
    } catch (ignore) {
      // Animation support is optional. The new category is already usable.
      this.cancel();
    }
  };

  CategoryTransition.prototype.destroy = function () {
    this.destroyed = true;
    this.cancel();
  };
  CategoryTransition.DURATION = DURATION;
  CategoryTransition.DISTANCE = DISTANCE;
  root.LGXMBCategoryTransition = CategoryTransition;
  if (typeof module === 'object' && module.exports) module.exports = CategoryTransition;
})(typeof window !== 'undefined' ? window : globalThis);
