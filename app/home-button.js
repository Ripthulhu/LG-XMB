/* Optional Home button mapping through the verified app-owned helper.
 * SPDX-License-Identifier: GPL-3.0-or-later */
(function (root) {
  'use strict';
  var URI = 'luna://org.webosbrew.hbchannel.service/exec';
  var ENTRY = '/media/developer/apps/usr/palm/applications/org.local.openxmb.c5/helper-startup.py';
  var pending = null;
  var revision = null;
  var messages = {
    root_required: 'Home button setup needs root access in Homebrew Channel.',
    python_missing: 'Home button setup needs Python 3 on the TV.',
    python_too_old: 'Home button setup needs Python 3.7 or newer.',
    helper_permissions_required: 'The installed helper needs repair. Reinstall LG-XMB.',
    home_overlay_active: 'LG-XMB replaces LG Home. Restore LG Home to change this button.',
    home_mapping_changed: 'The Home button setting changed. Check it again.',
    home_mapping_not_confirmed: 'The change was not confirmed. Check the Home button setting.',
    home_button_busy: 'Home button setup is busy. Check it again shortly.',
    cancelled: 'Home button check cancelled.',
    timeout: 'The Home button setting was not confirmed. Check it again.',
    unavailable: 'Home button setup is unavailable. Check Homebrew Channel and root access.'
  };
  function problem(code) {
    var error = new Error(messages[code] || messages.unavailable);
    error.code = code;
    return error;
  }
  function object(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
  }
  function replacesHome() {
    var system = root.PalmSystem || root.webOSSystem;
    return (
      !!system &&
      typeof system.identifier === 'string' &&
      system.identifier.trim().split(/\s+/)[0] === 'com.webos.app.home'
    );
  }
  function replacementState() {
    return {
      mode: 'xmb',
      available: false,
      reason: 'home_overlay_active',
      canRetry: false,
      message: messages.home_overlay_active
    };
  }
  function parse(raw) {
    var outer, value;
    try {
      if (typeof raw !== 'string' || raw.length > 32768) throw new Error();
      outer = JSON.parse(raw);
      if (
        !object(outer) ||
        typeof outer.stdoutString !== 'string' ||
        outer.stdoutString.length > 8192
      )
        throw new Error();
      value = JSON.parse(outer.stdoutString);
      if (!object(value)) throw new Error();
    } catch (ignore) {
      throw problem('unavailable');
    }
    if (value.returnValue === false) throw problem(value.errorCode);
    if (
      outer.returnValue !== true ||
      outer.stderrString ||
      [outer.errorCode, outer.returnCode, outer.exitCode].some(function (code) {
        return code !== undefined && code !== 0 && code !== '0';
      }) ||
      (outer.error !== undefined && outer.error !== null && outer.error !== '') ||
      value.returnValue !== true ||
      value.available !== true ||
      ['stock', 'xmb', 'other'].indexOf(value.mode) < 0 ||
      typeof value.revision !== 'string' ||
      !/^[0-9a-f]{64}$/.test(value.revision)
    )
      throw problem('unavailable');
    return value;
  }
  function request(action, mode) {
    if (pending) return Promise.reject(problem('home_button_busy'));
    if (!root.C5TV || !root.C5TV.isTV() || typeof root.PalmServiceBridge !== 'function')
      return Promise.reject(problem('unavailable'));
    // A copied Home replacement already owns this button. Its identity is
    // enough to explain the limitation without calling a privileged service.
    if (replacesHome()) {
      revision = null;
      return action === 'get'
        ? Promise.resolve(replacementState())
        : Promise.reject(problem('home_overlay_active'));
    }
    var args = 'get';
    if (action === 'set') {
      if (['stock', 'xmb'].indexOf(mode) < 0 || !revision)
        return Promise.reject(problem('home_mapping_changed'));
      // Every argument is from a fixed allowlist or a validated digest, never a
      // native app name, user text, path or arbitrary command from the page.
      args = 'set ' + mode + ' ' + revision;
    }
    revision = null;
    var cancel;
    var operation = new Promise(function (resolve, reject) {
      var bridge,
        timer,
        done = false;
      function finish(error, value) {
        if (done) return;
        done = true;
        root.clearTimeout(timer);
        pending = null;
        if (bridge) {
          bridge.onservicecallback = function () {};
          try {
            bridge.cancel();
          } catch (ignore) {}
        }
        if (error) {
          if (action === 'get' && error.code === 'home_overlay_active') {
            resolve(replacementState());
          } else reject(error);
          return;
        }
        revision = value.revision;
        resolve({ mode: value.mode, available: true });
      }
      cancel = function () {
        finish(problem('cancelled'));
      };
      try {
        bridge = new root.PalmServiceBridge();
        bridge.onservicecallback = function (raw) {
          try {
            var value = parse(raw);
            if (action === 'set' && value.mode !== mode)
              throw problem('home_mapping_not_confirmed');
            finish(null, value);
          } catch (error) {
            finish(error);
          }
        };
        timer = root.setTimeout(function () {
          finish(problem('timeout'));
        }, 18000);
        bridge.call(
          URI,
          JSON.stringify({
            command:
              'if [ -x /usr/bin/python3 ]; then /usr/bin/python3 -I -B ' +
              ENTRY +
              ' home-button ' +
              args +
              '; else printf \'%s\\n\' \'{"returnValue":false,"errorCode":"python_missing"}\'; fi'
          })
        );
      } catch (ignore) {
        finish(problem('unavailable'));
      }
    });
    // A cancelled write can still finish on the TV. Its snapshot stays invalid
    // until an explicit get confirms the current assignment.
    operation.cancel = function () {
      cancel();
    };
    pending = operation;
    operation.then(
      function () {
        if (pending === operation) pending = null;
      },
      function () {
        if (pending === operation) pending = null;
      }
    );
    return operation;
  }
  root.LGXMBHomeButton = {
    get: function () {
      return request('get');
    },
    set: function (mode) {
      return request('set', mode);
    }
  };
})(window);
