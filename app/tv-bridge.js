/* OpenXMB C5: limited local webOS application/media-status bridge. No network or root helpers.
 * Native transport verified against LG webOSTV.js 1.2.13 (PalmServiceBridge).
 * https://webostv.developer.lge.com/develop/references/application-manager
 * listApps and inputStatus are firmware APIs, not guaranteed third-party APIs.
 */
(function (root) {
  'use strict';

  var SERVICE = 'luna://com.webos.applicationManager/';
  var TIMEOUT_MS = 5000;
  var METHODS = Object.freeze({
    listApps: SERVICE + 'listApps', getAppLoadStatus: SERVICE + 'getAppLoadStatus',
    launch: SERVICE + 'launch', previewStatus: 'luna://com.webos.service.videooutput/getStatus',
    inputStatus: 'luna://com.webos.service.eim/getAllInputStatus',
    mediaPipelines: 'luna://com.webos.media/getActivePipelines',
    audioStatus: 'luna://com.webos.service.audio/UMI/getStatus',
    audioConnect: 'luna://com.webos.service.audio/UMI/connect'
  });
  var INPUTS = Object.freeze({
    HDMI_1: 'com.webos.app.hdmi1', HDMI_2: 'com.webos.app.hdmi2',
    HDMI_3: 'com.webos.app.hdmi3', HDMI_4: 'com.webos.app.hdmi4'
  });
  var active = Object.create(null);
  var nextRequest = 0;

  function error(code, message, serviceCode) {
    var result = new Error(message);
    result.name = 'C5TVError';
    result.code = code;
    if (typeof serviceCode === 'number' || typeof serviceCode === 'string') {
      result.serviceCode = serviceCode;
    }
    return result;
  }

  function text(value, max) {
    return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max) : '';
  }

  function validId(id) {
    return typeof id === 'string' && id.length <= 128 &&
      /^[a-zA-Z0-9]+(?:[._-][a-zA-Z0-9]+)*$/.test(id);
  }

  function isTV() {
    var location = root.location || {};
    var system = root.PalmSystem || root.webOSSystem;
    return location.protocol === 'file:' &&
      !/(?:^|[?&])preview=(?:1|true)(?:&|$)/i.test(location.search || '') &&
      !!system && typeof system.identifier === 'string' && system.identifier.length > 0 &&
      typeof root.PalmServiceBridge === 'function' &&
      /SmartTV|Large Screen|Web0S|webOS/i.test((root.navigator || {}).userAgent || '');
  }

  function previewResult(action, id) {
    var result = { ok: true, preview: true, message: 'Preview only — no TV action was sent.', action: action };
    if (id) result.id = id;
    return result;
  }

  function request(method, payload) {
    var cancel = function () {};
    var operation = new Promise(function (resolve, reject) {
      if (!Object.prototype.hasOwnProperty.call(METHODS, method)) {
        reject(error('UNSUPPORTED_METHOD', 'This TV operation is unavailable.'));
        return;
      }
      if (!isTV()) {
        reject(error('PREVIEW_ONLY', 'A packaged webOS TV app is required for this operation.'));
        return;
      }
      var bridge;
      var timer;
      var done = false;
      var key = ++nextRequest;
      function finish(problem, result) {
        if (done) return;
        done = true;
        root.clearTimeout(timer);
        if (bridge) {
          bridge.onservicecallback = function () {};
          try { if (typeof bridge.cancel === 'function') bridge.cancel(); } catch (ignored) {}
        }
        delete active[key];
        if (problem) reject(problem);
        else resolve(result);
      }
      cancel = function () { finish(error('CANCELLED', 'The TV status request was cancelled.')); };
      try {
        bridge = new root.PalmServiceBridge();
        active[key] = bridge; // Retain native objects until callback or timeout, as LG recommends.
        bridge.onservicecallback = function (raw) {
          if (done) return;
          var response;
          try {
            if (typeof raw === 'string' && raw.length > 2 * 1024 * 1024) throw new Error('size');
            response = typeof raw === 'string' ? JSON.parse(raw) : raw;
            // The media server answers this one with a bare array.
            if (method === 'mediaPipelines' && Array.isArray(response)) response = { returnValue: true, pipelines: response };
            if (!response || typeof response !== 'object' || Array.isArray(response)) throw new Error('shape');
          } catch (ignored) {
            finish(error('INVALID_RESPONSE', 'The TV returned an unreadable response.'));
            return;
          }
          if (response.returnValue !== true || (response.errorCode !== undefined &&
              response.errorCode !== 0 && response.errorCode !== '0')) {
            finish(error('SERVICE_ERROR', text(response.errorText, 240) || 'The TV did not allow this operation.', response.errorCode));
            return;
          }
          finish(null, response);
        };
        timer = root.setTimeout(function () {
          finish(error('TIMEOUT', method === 'launch' ?
            'The TV did not confirm the launch. It may still have opened; no retry was sent.' :
            'The TV did not respond. No retry was sent.'));
        }, TIMEOUT_MS);
        // Each method is one-shot. No subscriptions, retries, settings writes or shell execution.
        bridge.call(METHODS[method], JSON.stringify(payload));
      } catch (cause) {
        finish(error('BRIDGE_ERROR', 'The TV connection could not complete this operation.'));
      }
    });
    operation.cancel = function () { cancel(); };
    return operation;
  }

  function getInputPreviewStatus(port) {
    if (!Number.isInteger(port) || port < 1 || port > 4) {
      return Promise.reject(error('INVALID_INPUT', 'Choose HDMI 1, 2, 3 or 4.'));
    }
    if (!isTV()) return Promise.resolve({ port: port, signal: null, preview: true });
    // Read only: correlate the one selected input, discard all other app/video data.
    var read = request('previewStatus', {});
    var result = read.then(function (response) {
      var matches = Array.isArray(response.video) ? response.video.filter(function (entry) {
        return entry && entry.appId === 'org.local.openxmb.c5' && entry.contentType === 'hdmi' + port;
      }) : [];
      var signal = null;
      if (matches.length === 1) {
        var entry = matches[0];
        if (entry.connected === true && entry.connectedSource === 'HDMI' &&
            Number.isFinite(entry.width) && Number.isFinite(entry.height)) {
          if (entry.width === 0 && entry.height === 0) signal = false;
          else if (entry.width > 0 && entry.height > 0) signal = true;
        }
      }
      return { port: port, signal: signal };
    });
    result.cancel = function () { read.cancel(); };
    return result;
  }

  function localIcon(value) {
    // Do not introduce online tracking requests through icons returned by another app.
    if (typeof value !== 'string' || value.length > 1024 || /[\u0000-\u001f\\]/.test(value)) return '';
    return /^\/(?!\/)/.test(value) || /^file:\/\/\//.test(value) ? value : '';
  }

  function listApps() {
    if (!isTV()) {
      var result = previewResult('listApps');
      result.apps = [];
      return Promise.resolve(result);
    }
    var read = request('listApps', {});
    var result = read.then(function (response) {
      if (!Array.isArray(response.apps) || response.apps.length > 1000) throw error('INVALID_RESPONSE', 'The TV did not return an application list.');
      var seen = Object.create(null);
      var apps = [];
      response.apps.forEach(function (app) {
        if (!app || !validId(app.id) || seen[app.id] || app.visible !== true) return;
        seen[app.id] = true;
        apps.push({ id: app.id, title: text(app.title, 120) || app.id,
          icon: localIcon(app.icon), type: text(app.type, 30) });
      });
      return { ok: true, preview: false, apps: apps };
    });
    result.cancel = function () { read.cancel(); };
    return result;
  }

  function listInputLabels() {
    if (!isTV()) return Promise.resolve({ ok: true, preview: true, inputs: [] });
    var read = request('inputStatus', {});
    var result = read.then(function (response) {
      if (!Array.isArray(response.devices) || response.devices.length > 128) {
        throw error('INVALID_RESPONSE', 'The TV did not return a valid input list.');
      }
      var seen = Object.create(null), duplicates = Object.create(null), inputs = [];
      response.devices.forEach(function (device) {
        if (!device || typeof device !== 'object' || Array.isArray(device)) return;
        var match = typeof device.appId === 'string' && /^com\.webos\.app\.hdmi([1-4])$/.exec(device.appId);
        if (!match) return;
        // EIM also exposes virtual sources. Never use a label to choose a target,
        // or pick the first of multiple records claiming the same HDMI app.
        if (seen[device.appId]) { duplicates[device.appId] = true; return; }
        seen[device.appId] = true;
        var port = Number(match[1]);
        if ((device.id !== undefined && device.id !== 'HDMI_' + port) ||
            (device.port !== undefined && device.port !== port) ||
            (device.label != null && typeof device.label !== 'string')) return;
        var label = (device.label || '').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '')
          .replace(/\s+/g, ' ').trim();
        label = Array.from(label).slice(0, 120).join('');
        // A disconnected port is still usable. Names, not connection state or
        // subList metadata, are all this read exports. No native icon paths.
        inputs.push({ id: device.appId, port: port, label: label || 'HDMI ' + port });
      });
      return { ok: true, preview: false, inputs: inputs.filter(function (input) {
        return !duplicates[input.id];
      }) };
    });
    result.cancel = function () { read.cancel(); };
    return result;
  }

  function launch(id) {
    if (!validId(id)) return Promise.reject(error('INVALID_APP_ID', 'Choose a valid installed TV application.'));
    if (!isTV()) return Promise.resolve(previewResult('launch', id));
    // Failure or denial of the installation check must not trigger an unchecked launch.
    return request('getAppLoadStatus', { appId: id }).then(function (response) {
      if (response.exist !== true) {
        throw error(response.exist === false ? 'APP_NOT_INSTALLED' : 'INVALID_RESPONSE',
          response.exist === false ? 'This application is not installed on the TV.' :
            'The TV could not confirm that this application is installed.');
      }
      return request('launch', { id: id });
    }).then(function () {
      return { ok: true, preview: false, id: id };
    });
  }

  function openInput(id) {
    var target = typeof id === 'string' && Object.prototype.hasOwnProperty.call(INPUTS, id) ? INPUTS[id] : id;
    if (typeof target !== 'string' || !/^com\.webos\.app\.hdmi[1-4]$/.test(target)) {
      return Promise.reject(error('INVALID_INPUT', 'Choose HDMI 1, 2, 3 or 4.'));
    }
    return launch(target);
  }

  // Under the Home takeover the app runs as com.webos.app.home. The TV's media
  // pipeline registers that identity's audio with the audio service and then
  // never connects it, cause LG's own Home isn't meant to own the speakers. The
  // track decodes, the player says it's playing, and nothing comes out. So the
  // app connects its own stream to the main sink. Any other identity is wired
  // up by the TV already and is left alone.
  function connectMusicAudio(isCurrent) {
    isCurrent = typeof isCurrent === 'function' ? isCurrent : function () { return true; };
    function cancelled() { return {ok: true, connected: false, reason: 'cancelled'}; }
    if (!isCurrent()) return Promise.resolve(cancelled());
    if (!isTV()) return Promise.resolve(previewResult('connectMusicAudio'));
    var system = root.PalmSystem || root.webOSSystem;
    var appId = String(system.identifier).split(' ')[0];
    if (appId !== 'com.webos.app.home') return Promise.resolve({ ok: true, preview: false, connected: false, reason: 'not-needed' });
    return request('mediaPipelines', {}).then(function (response) {
      if (!isCurrent()) return cancelled();
      var found = null;
      (response.pipelines || []).forEach(function (entry) {
        if (!entry || entry.type !== 'media' || entry.appId !== appId) return;
        if (typeof entry.uri !== 'string' || !/\/user-music\.mp3$/.test(entry.uri)) return;
        if (typeof entry.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(entry.id)) return;
        (Array.isArray(entry.resource) ? entry.resource : []).forEach(function (item) {
          if (item && item.resource === 'ADEC' && Number.isInteger(item.index) && item.index >= 0 && item.index <= 7)
            found = { id: entry.id, port: item.index };
        });
      });
      if (!found) return { ok: true, preview: false, connected: false, reason: 'no-pipeline' };
      return request('audioStatus', {}).then(function (status) {
        if (!isCurrent()) return cancelled();
        var wired = (Array.isArray(status.audio) ? status.audio : []).some(function (stream) {
          return (Array.isArray(stream.pipelineInfo) ? stream.pipelineInfo : []).some(function (info) {
            return info.pipelineId === found.id && Array.isArray(info.sourceSinkInfo) && info.sourceSinkInfo.length > 0;
          });
        });
        if (wired) return { ok: true, preview: false, connected: true, reason: 'already' };
        return request('audioConnect', { streamType: 'umimedia', source: 'ADEC', sourcePort: found.port,
          sink: 'MAIN', pipelineId: found.id, activate: true }).then(function () {
          return { ok: true, preview: false, connected: true, reason: 'connected' };
        });
      });
    });
  }

  function platformBack() {
    if (!isTV()) return Promise.resolve(previewResult('platformBack'));
    // LG webOSTV.js 1.2.13 forwards platformBack directly to this platform API.
    // On webOS 6+, the TV owns the exit prompt; panels are handled in app.js first.
    // webOS 6 renamed PalmSystem to webOSSystem. isTV accepts either, so this
    // has to as well, or Back just rejects on a build that only has the new one.
    var system = root.PalmSystem || root.webOSSystem;
    if (!system || typeof system.platformBack !== 'function') {
      return Promise.reject(error('BACK_UNAVAILABLE', 'The TV exit prompt is unavailable.'));
    }
    try { system.platformBack(); return Promise.resolve({ok:true,preview:false}); }
    catch (ignored) { return Promise.reject(error('BACK_UNAVAILABLE', 'The TV could not open its exit prompt.')); }
  }

  root.C5TV = Object.freeze({
    isTV: isTV,
    listApps: listApps,
    listInputLabels: listInputLabels,
    launch: launch,
    openInput: openInput,
    getInputPreviewStatus: getInputPreviewStatus,
    platformBack: platformBack,
    connectMusicAudio: connectMusicAudio
  });
}(typeof window !== 'undefined' ? window : globalThis));
