/* Fixed background-control commands through the existing Homebrew service.
 * SPDX-License-Identifier: GPL-3.0-or-later
 * This bridge creates no network listener and exposes no generic exec function.
 */
(function (root) {
  'use strict';
  var URI = 'luna://org.webosbrew.hbchannel.service/exec';
  var COMMAND = '/usr/bin/python3 /var/lib/openxmb-c5/process-control.py ';
  var KEYS = ['home', 'browser', 'search', 'hdmi1', 'hdmi2', 'hdmi3', 'hdmi4', 'livetv', 'usage', 'ads', 'voice'];
  var APPS = ['com.webos.app.home', 'com.webos.app.browser', 'com.webos.app.voice',
    'com.webos.app.hdmi1', 'com.webos.app.hdmi2', 'com.webos.app.hdmi3', 'com.webos.app.hdmi4', 'com.webos.app.livetv'];
  var retained = Object.create(null), nextId = 0;

  function isTV() {
    try { return !!(root.C5TV && root.C5TV.isTV()); } catch (ignored) { return false; }
  }
  // Preview clients keep their own local example state and never construct this bridge.
  if (!isTV()) return;

  function problem(code) {
    var messages = {
      INVALID_CHOICE: 'This background setting is unavailable.',
      INVALID_REVISION: 'Settings changed. Please refresh and try again.',
      CONFLICT: 'Settings changed. Please refresh and try again.',
      TIMEOUT: 'The TV did not confirm the change. Refresh these settings before trying again.',
      CANCELLED: 'The background settings request was cancelled.',
      INVALID_REPLY: 'The TV returned an unreadable background settings response.',
      UNAVAILABLE: 'Background controls are unavailable. Please try again.',
      HOME_MAPPING_REQUIRES_CUSTOM: 'Choose this menu for the Home button before keeping LG Home closed.',
      OTHER_HOME_MAPPING: 'Another app is assigned to the Home button. Restore its mapping before changing this setting.',
      SERVICE_ERROR: 'The TV could not complete this background settings request.'
    };
    var error = new Error(messages[code] || messages.SERVICE_ERROR);
    error.name = 'C5ProcessError';
    error.code = code;
    return error;
  }

  function object(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
  function nonzeroCode(value) { return value !== undefined && value !== 0 && value !== '0'; }

  function parseReply(raw) {
    if (typeof raw !== 'string' || raw.length > 65536) throw problem('INVALID_REPLY');
    var outer;
    try { outer = JSON.parse(raw); } catch (ignored) { throw problem('INVALID_REPLY'); }
    if (!object(outer)) throw problem('INVALID_REPLY');
    // Homebrew exec does not normally return an exit code. Its returnValue is false
    // whenever child_process.exec reports a nonzero exit or another execution error.
    if (outer.returnValue !== true || nonzeroCode(outer.errorCode) ||
        nonzeroCode(outer.returnCode) || nonzeroCode(outer.exitCode) ||
        (outer.error !== undefined && outer.error !== null && outer.error !== '')) {
      throw problem('SERVICE_ERROR');
    }
    if (typeof outer.stdoutString !== 'string' || outer.stdoutString.length > 32768 ||
        (outer.stderrString !== undefined &&
          (typeof outer.stderrString !== 'string' || outer.stderrString.length > 4096))) {
      throw problem('INVALID_REPLY');
    }
    if (outer.stderrString) throw problem('SERVICE_ERROR');
    var value;
    try { value = JSON.parse(outer.stdoutString); } catch (ignored) { throw problem('INVALID_REPLY'); }
    if (!object(value)) throw problem('INVALID_REPLY');
    if (value.returnValue !== true || nonzeroCode(value.errorCode) || nonzeroCode(value.returnCode) || nonzeroCode(value.exitCode)) {
      var code = value.code || value.errorCode;
      throw problem(code === 'revision_conflict' ? 'CONFLICT' : code === 'home_mapping_requires_custom' ? 'HOME_MAPPING_REQUIRES_CUSTOM' : code === 'other_home_mapping' ? 'OTHER_HOME_MAPPING' : 'SERVICE_ERROR');
    }
    return value;
  }

  function request(command, timeout) {
    var cancel = function () {};
    var operation = new Promise(function (resolve, reject) {
      if (!isTV() || typeof root.PalmServiceBridge !== 'function') {
        reject(problem('UNAVAILABLE'));
        return;
      }
      var bridge, timer, done = false, id = ++nextId;
      function finish(error, value) {
        if (done) return;
        done = true;
        root.clearTimeout(timer);
        if (bridge) {
          bridge.onservicecallback = function () {};
          try { bridge.cancel(); } catch (ignored) {}
        }
        delete retained[id];
        if (error) reject(error); else resolve(value);
      }
      // Cancellation releases the callback. It cannot undo a command already sent.
      // A timed-out write is never automatically retried; refresh authoritative state.
      cancel = function () { finish(problem('CANCELLED')); };
      try {
        bridge = new root.PalmServiceBridge();
        retained[id] = bridge;
        bridge.onservicecallback = function (raw) {
          if (done) return;
          try { finish(null, parseReply(raw)); } catch (error) { finish(error); }
        };
        timer = root.setTimeout(function () { finish(problem('TIMEOUT')); }, timeout);
        bridge.call(URI, JSON.stringify({ command: command }));
      } catch (ignored) { finish(problem('UNAVAILABLE')); }
    });
    operation.cancel = function () { cancel(); };
    return operation;
  }

  function mapped(operation, success, failure) {
    var result = operation.then(success, failure);
    result.cancel = function () { operation.cancel(); };
    return result;
  }

  function state(value) {
    if (value.available !== true || !Number.isSafeInteger(value.revision) || value.revision < 0 ||
        !Array.isArray(value.items) || value.items.length > KEYS.length) throw problem('INVALID_REPLY');
    var seen = Object.create(null);
    value.items.forEach(function (item) {
      if (!object(item) || KEYS.indexOf(item.id) === -1 || seen[item.id] ||
          typeof item.enabled !== 'boolean' || typeof item.supported !== 'boolean' ||
          ['apps', 'privacy'].indexOf(item.group) === -1 ||
          typeof item.title !== 'string' || !item.title || item.title.length > 100 ||
          (item.description !== undefined && (typeof item.description !== 'string' || item.description.length > 1000)) ||
          (item.status !== undefined && (typeof item.status !== 'string' || item.status.length > 160))) {
        throw problem('INVALID_REPLY');
      }
      seen[item.id] = true;
    });
    return value;
  }

  function getState() { return mapped(request(COMMAND + 'get', 8000), state); }
  function setEnabled(key, enabled, revision) {
    if (KEYS.indexOf(key) === -1 || typeof enabled !== 'boolean') return Promise.reject(problem('INVALID_CHOICE'));
    if (!Number.isSafeInteger(revision) || revision < 0) return Promise.reject(problem('INVALID_REVISION'));
    // Every variable is allowlisted or a literal boolean/safe integer; shell input
    // never comes from labels, app metadata, JSON, paths or arbitrary caller strings.
    return mapped(request(COMMAND + 'set ' + key + ' ' + (enabled ? '1' : '0') + ' ' + revision, 8000), state);
  }
  function prepareLaunch(appId) {
    if (APPS.indexOf(appId) === -1) return Promise.resolve({ prepared: false, reason: 'not_managed' });
    return mapped(request(COMMAND + 'prepare ' + appId, 1000), function (value) {
      return { prepared: value.prepared === true };
    }, function () { return { prepared: false, reason: 'unavailable' }; });
  }

  function remoteState(value) {
    if (value.available !== true || !Number.isSafeInteger(value.revision) || value.revision < 0 ||
        ['custom','stock','other'].indexOf(value.home) === -1 || typeof value.homeKeepClosed !== 'boolean') throw problem('INVALID_REPLY');
    return {available:true,revision:value.revision,home:value.home,homeKeepClosed:value.homeKeepClosed};
  }
  function getRemoteState() { return mapped(request(COMMAND + 'remote-get', 8000), remoteState); }
  function setRemoteHome(home, revision) {
    if (['custom','stock'].indexOf(home) === -1) return Promise.reject(problem('INVALID_CHOICE'));
    if (!Number.isSafeInteger(revision) || revision < 0) return Promise.reject(problem('INVALID_REVISION'));
    return mapped(request(COMMAND + 'remote-set ' + home + ' ' + revision, 40000), remoteState);
  }

  root.C5ProcessAdapter = Object.freeze({ getState: getState, setEnabled: setEnabled, prepareLaunch: prepareLaunch });
  root.C5RemoteAdapter = Object.freeze({getState:getRemoteState,setHome:setRemoteHome});
}(typeof window !== 'undefined' ? window : globalThis));
