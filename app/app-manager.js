/* SPDX-License-Identifier: GPL-3.0-or-later */
(function (root) {
  'use strict';
  // Firmware APIs, not a public third-party TV contract. Denials stay denials:
  // no shell, force flag, role changes or root fallback.
  var INFO = 'luna://com.webos.applicationManager/getAppInfo';
  var REMOVE = 'luna://com.webos.appInstallService/';
  var pending = Object.create(null);
  function problem(code, message) {
    var e = new Error(message);
    e.code = code;
    return e;
  }
  function validId(id) {
    return (
      typeof id === 'string' && id.length <= 128 && /^[a-zA-Z0-9]+(?:[._-][a-zA-Z0-9]+)*$/.test(id)
    );
  }
  function clean(s, limit) {
    return typeof s === 'string'
      ? s.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').slice(0, limit)
      : '';
  }
  function protectedId(id) {
    var system = root.PalmSystem || root.webOSSystem;
    var self = system && String(system.identifier || '').split(' ')[0];
    return (
      !validId(id) ||
      id === self ||
      id === 'org.local.openxmb.c5' ||
      id === 'org.webosbrew.hbchannel' ||
      id.indexOf('org.webosbrew.hbchannel.') === 0 ||
      id === 'com.palmdts.devmode' ||
      /^(com\.webos\.|com\.palm\.|com\.lge\.)/.test(id)
    );
  }
  function installKind(raw) {
    // A manifest boolean alone is not enough to classify a native/system app.
    var p = raw.folderPath;
    if (typeof p !== 'string' || p.indexOf('..') !== -1 || /[\\\u0000-\u001f]/.test(p)) return null;
    if (p === '/media/developer/apps/usr/palm/applications/' + raw.id) return 'developer';
    if (p === '/media/cryptofs/apps/usr/palm/applications/' + raw.id) return 'store';
    return null;
  }
  function normalize(raw, id) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.id !== id)
      throw problem('INVALID_RESPONSE', 'The TV returned information for a different application.');
    var kind = installKind(raw),
      protectedApp = protectedId(id) || (raw.systemApp !== undefined && raw.systemApp !== false);
    var removable = !protectedApp && raw.removable === true && kind !== null;
    return {
      id: id,
      title: clean(raw.title, 120) || id,
      version: clean(raw.version, 64),
      vendor: clean(raw.vendor, 120),
      type: clean(raw.type, 40),
      description: clean(raw.appDescription, 1000),
      installation: kind || 'system or unknown',
      removable: removable,
      removalReason: protectedApp
        ? 'System, launcher and recovery apps cannot be deleted here.'
        : raw.removable !== true
          ? 'The TV has not marked this app as removable.'
          : !kind
            ? 'The installation location could not be verified.'
            : ''
    };
  }
  function tv() {
    return !!(root.C5TV && root.C5TV.isTV());
  }
  function request(uri, payload, removal) {
    var cancel = function () {};
    var task = new Promise(function (resolve, reject) {
      var bridge,
        timer,
        done = false;
      function finish(error, value) {
        if (done) return;
        done = true;
        root.clearTimeout(timer);
        if (bridge) {
          bridge.onservicecallback = function () {};
          try {
            bridge.cancel();
          } catch (ignore) {}
        }
        if (error) reject(error);
        else resolve(value);
      }
      cancel = function () {
        finish(problem('CANCELLED', 'Operation cancelled before completion.'));
      };
      try {
        bridge = new root.PalmServiceBridge();
        bridge.onservicecallback = function (raw) {
          if (done) return;
          var r;
          try {
            if (typeof raw === 'string' && raw.length > 1024 * 1024) throw Error('size');
            r = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (!r || typeof r !== 'object' || Array.isArray(r)) throw Error('shape');
          } catch (ignore) {
            finish(problem('INVALID_RESPONSE', 'The TV returned an unreadable response.'));
            return;
          }
          if (
            r.returnValue === false ||
            (r.errorCode !== undefined && r.errorCode !== 0 && r.errorCode !== '0')
          ) {
            finish(
              problem('SERVICE_ERROR', clean(r.errorText, 240) || 'The TV refused this operation.')
            );
            return;
          }
          if (!removal) {
            if (r.returnValue !== true)
              finish(
                problem('INVALID_RESPONSE', 'The TV did not confirm the information request.')
              );
            else finish(null, r);
            return;
          }
          // Initial returnValue/subscribed acknowledges the subscription only.
          // 21 is also intermediate. 31 is the install service's terminal success.
          if (r.id !== undefined && r.id !== payload.id) {
            finish(problem('INVALID_RESPONSE', 'Uninstall status belongs to another application.'));
            return;
          }
          var detail = r.details && typeof r.details === 'object' ? r.details : {};
          if (
            r.statusValue === 25 ||
            (detail.errorCode !== undefined && detail.errorCode !== 0 && detail.errorCode !== '0')
          ) {
            finish(
              problem(
                'REMOVE_FAILED',
                clean(detail.reason, 240) || 'The TV could not delete this app.'
              )
            );
            return;
          }
          if (r.statusValue === 31) finish(null, { ok: true, preview: false, id: payload.id });
        };
        timer = root.setTimeout(
          function () {
            finish(
              problem(
                'TIMEOUT',
                removal
                  ? 'Deletion was not confirmed. It may still finish; check the app list before trying again.'
                  : 'App information timed out.'
              )
            );
          },
          removal ? 45000 : 5000
        );
        bridge.call(uri, JSON.stringify(payload));
      } catch (error) {
        finish(problem('BRIDGE_ERROR', 'The TV connection could not complete this operation.'));
      }
    });
    task.cancel = function () {
      cancel();
    };
    return task;
  }
  function getAppInfo(id) {
    if (!validId(id))
      return Promise.reject(problem('INVALID_APP_ID', 'Choose a valid installed application.'));
    if (!tv())
      return Promise.resolve({
        preview: true,
        info: { id: id, removable: false, removalReason: 'Deletion is only available on the TV.' }
      });
    var read = request(INFO, { id: id }, false);
    var result = read.then(function (r) {
      return { preview: false, info: normalize(r.appInfo, id) };
    });
    result.cancel = function () {
      read.cancel();
    };
    return result;
  }
  function removeApp(id, confirmation) {
    if (confirmation !== true || protectedId(id))
      return Promise.reject(problem('PROTECTED_APP', 'Deletion is not allowed for this item.'));
    if (!tv()) return Promise.reject(problem('PREVIEW_ONLY', 'Preview only; no app was deleted.'));
    if (pending[id])
      return Promise.reject(
        problem('REMOVE_PENDING', 'This app already has a deletion in progress.')
      );
    var cancelled = false,
      dispatched = false,
      read = getAppInfo(id);
    // Fresh metadata after confirmation, not the earlier display snapshot.
    var task = read.then(function (result) {
      if (cancelled) throw problem('CANCELLED', 'Deletion cancelled before it was sent.');
      if (!result.info.removable) throw problem('PROTECTED_APP', result.info.removalReason);
      dispatched = true;
      return request(
        REMOVE + (result.info.installation === 'developer' ? 'dev/remove' : 'remove'),
        { id: id, subscribe: true },
        true
      );
    });
    var result = task.then(
      function (value) {
        delete pending[id];
        return value;
      },
      function (error) {
        delete pending[id];
        throw error;
      }
    );
    // A dispatched uninstall cannot be undone by closing the panel. Keep observing
    // it so a late success can still reconcile the menu, including while hidden.
    result.cancelBeforeDispatch = function () {
      if (!dispatched) {
        cancelled = true;
        if (read.cancel) read.cancel();
      }
    };
    result.wasDispatched = function () {
      return dispatched;
    };
    pending[id] = result;
    return result;
  }
  var api = Object.freeze({
    getAppInfo: getAppInfo,
    removeApp: removeApp,
    protectedId: protectedId,
    normalize: normalize
  });
  root.LGXMBAppManager = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
