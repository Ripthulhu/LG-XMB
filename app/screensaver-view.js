/* SPDX-License-Identifier: GPL-3.0-or-later */
// DOM fades and wake gestures. The idle deadline lives in screensaver.js.
(function (root) {
  'use strict';
  function ScreensaverView(screensaver, options) {
    options = options || {};
    var doc = root.document,
      body = doc.body,
      dim = doc.getElementById('screensaverDim'),
      active = false,
      transitionTimer = null,
      generation = 0,
      listeners = [],
      blockedKeys = Object.create(null),
      blockedPointer = null,
      blockClickUntil = 0,
      blockWheelUntil = 0,
      keyPointerPairUntil = 0,
      pointer = null,
      sleepFocus = null,
      destroyed = false;
    function now() {
      return root.performance.now();
    }
    function stop(event) {
      if (event.cancelable) event.preventDefault();
      event.stopImmediatePropagation();
    }
    function listen(type, handler) {
      root.addEventListener(type, handler, { capture: true, passive: false });
      listeners.push([type, handler]);
    }
    function activity() {
      return screensaver.activity();
    }
    function keyId(event) {
      // Magic Remote releases can omit code or report it as Unidentified.
      return String(event.keyCode || event.which || event.code || event.key);
    }
    // A lost release must not disable clicks until Home is relaunched. Repeats
    // extend this guard; a fresh press starts a new gesture immediately.
    var heldInputTimeout = 2000;
    function clearHeldInput() {
      blockedKeys = Object.create(null);
      blockedPointer = null;
      keyPointerPairUntil = 0;
    }
    function expireHeldInput(stamp) {
      Object.keys(blockedKeys).forEach(function (id) {
        if (blockedKeys[id] <= stamp) delete blockedKeys[id];
      });
      if (blockedPointer && blockedPointer.until <= stamp) blockedPointer = null;
    }
    listen('keydown', function (event) {
      var id = keyId(event),
        stamp = now();
      if (!event.repeat) clearHeldInput();
      if (blockedKeys[id]) {
        blockedKeys[id] = stamp + heldInputTimeout;
        activity();
        stop(event);
        return;
      }
      blockClickUntil = 0;
      if (activity()) {
        blockedKeys[id] = stamp + heldInputTimeout;
        keyPointerPairUntil = stamp + 100;
        stop(event);
      }
    });
    listen('keyup', function (event) {
      var id = keyId(event);
      if (!blockedKeys[id]) return;
      activity();
      delete blockedKeys[id];
      blockClickUntil = now() + 350;
      stop(event);
    });
    function pointerDown(event) {
      var stamp = now(),
        pairedKey = stamp < keyPointerPairUntil && Object.keys(blockedKeys).length > 0;
      // A remote OK may emit both a key and a pointer press for the same wake.
      // Later presses must recover even if the earlier release never arrived.
      if (!pairedKey) clearHeldInput();
      blockClickUntil = 0;
      var woke = activity();
      if (woke || pairedKey) {
        blockedPointer = {
          id: event.pointerId === undefined ? 'mouse' : event.pointerId,
          until: stamp + heldInputTimeout
        };
        stop(event);
      }
    }
    function pointerUp(event) {
      var id = event.pointerId === undefined ? 'mouse' : event.pointerId;
      if (!blockedPointer || blockedPointer.id !== id) return;
      activity();
      clearHeldInput();
      blockClickUntil = now() + 350;
      stop(event);
    }
    listen(root.PointerEvent ? 'pointerdown' : 'mousedown', pointerDown);
    listen(root.PointerEvent ? 'pointerup' : 'mouseup', pointerUp);
    listen('pointercancel', function () {
      if (!blockedPointer) return;
      clearHeldInput();
      blockClickUntil = now() + 350;
    });
    function move(event) {
      var id = event.pointerId === undefined ? 'mouse' : event.pointerId;
      if (blockedPointer && blockedPointer.id === id && event.buttons & 1)
        blockedPointer.until = now() + heldInputTimeout;
      if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
      var changed = pointer
        ? event.clientX !== pointer.x || event.clientY !== pointer.y
        : !!(event.movementX || event.movementY);
      if (!pointer || changed) pointer = { x: event.clientX, y: event.clientY };
      // Ignore duplicate pointer/mouse events and stationary cursor notifications.
      if (changed) activity();
    }
    listen('pointermove', move);
    listen('mousemove', move);
    function click(event) {
      expireHeldInput(now());
      var holdingWake = blockedPointer !== null || Object.keys(blockedKeys).length > 0,
        blocked = holdingWake || now() < blockClickUntil;
      if (!holdingWake) blockClickUntil = 0;
      if (activity() || blocked) stop(event);
    }
    listen('click', click);
    listen('contextmenu', click);
    listen('wheel', function (event) {
      if (!event.deltaX && !event.deltaY) return;
      var stamp = now(),
        blocked = stamp < blockWheelUntil;
      if (activity() || blocked) {
        // One wake spin should not also scroll the hidden menu.
        blockWheelUntil = stamp + 200;
        stop(event);
      }
    });
    function resetInput() {
      clearHeldInput();
      blockClickUntil = blockWheelUntil = 0;
      pointer = null;
    }
    listen('blur', function (event) {
      if (event.target === root) resetInput();
    });
    function render(state) {
      if (destroyed) return;
      dim.style.setProperty('--screensaver-shade', String(1 - state.brightness));
      if (active === state.active) return;
      active = state.active;
      var current = ++generation;
      if (transitionTimer !== null) root.clearTimeout(transitionTimer);
      if (active) {
        clearHeldInput();
        blockClickUntil = blockWheelUntil = 0;
        sleepFocus = doc.activeElement;
      }
      if (active && options.beforeSleep) options.beforeSleep();
      body.classList.remove('screensaver-asleep');
      body.classList.add('screensaver-transition');
      body.classList.toggle('screensaver-active', active);
      if (!active) {
        if (state.available && !doc.hidden) {
          if (sleepFocus && sleepFocus.isConnected && sleepFocus !== body) {
            sleepFocus.focus({ preventScroll: true });
          }
          if (options.restoreFocus) options.restoreFocus();
        }
        sleepFocus = null;
      }
      transitionTimer = root.setTimeout(
        function () {
          if (destroyed || current !== generation) return;
          transitionTimer = null;
          body.classList.toggle('screensaver-asleep', active);
          body.classList.remove('screensaver-transition');
        },
        active ? 1250 : 200
      );
    }
    function destroy() {
      if (destroyed) return;
      destroyed = true;
      sleepFocus = null;
      generation++;
      if (transitionTimer !== null) root.clearTimeout(transitionTimer);
      listeners.forEach(function (entry) {
        root.removeEventListener(entry[0], entry[1], true);
      });
      body.classList.remove('screensaver-active', 'screensaver-asleep', 'screensaver-transition');
      resetInput();
    }
    return { render: render, resetInput: resetInput, destroy: destroy };
  }
  root.LGXMBScreensaverView = ScreensaverView;
})(window);
