/* Read-only app and input inventory. Standalone uses Homebrew root access;
 * a Home replacement reads native services under the Home identity.
 * SPDX-License-Identifier: GPL-3.0-or-later */
(function (root) {
  'use strict';

  var APP_ID = 'org.local.openxmb.c5';
  var URI = 'luna://org.webosbrew.hbchannel.service/exec';
  var LIMIT = 2 * 1024 * 1024;
  var READS = {
    apps: {
      uri: 'luna://com.webos.applicationManager/listApps',
      field: 'apps',
      limit: 1000
    },
    inputs: {
      uri: 'luna://com.webos.service.eim/getAllInputStatus',
      field: 'devices',
      limit: 128
    }
  };
  function command(read) {
    return (
      'if [ "$(id -u)" = "0" ]; then exec /usr/bin/luna-send -n 1 -w 4000 ' +
      read.uri +
      ' \'{}\'; else printf \'%s\\n\' \'{"returnValue":false,"errorCode":"root_required"}\'; fi'
    );
  }
  var active = Object.create(null);
  var nextRequest = 0;

  function problem(code, message) {
    var error = new Error(message);
    error.name = 'C5TVError';
    error.code = code;
    return error;
  }

  function transport() {
    var system = root.PalmSystem || root.webOSSystem;
    if (!root.C5TV || !root.C5TV.isTV()) return null;
    var id = system.identifier.split(/\s+/)[0];
    if (id === APP_ID) return 'root';
    if (id === 'com.webos.app.home') return 'native';
    return null;
  }

  function object(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function failedCode(code) {
    return code !== undefined && code !== 0 && code !== '0';
  }

  function parse(raw, read, route) {
    var envelope, response;
    try {
      if (typeof raw !== 'string' || raw.length > LIMIT) throw new Error();
      envelope = JSON.parse(raw);
      if (!object(envelope)) throw new Error();
    } catch (ignore) {
      throw problem('INVALID_RESPONSE', 'The TV returned an unreadable discovery response.');
    }
    if (route === 'native') response = envelope;
    else {
      if (
        envelope.returnValue !== true ||
        failedCode(envelope.errorCode) ||
        failedCode(envelope.returnCode) ||
        failedCode(envelope.exitCode) ||
        (envelope.error !== undefined && envelope.error !== null && envelope.error !== '') ||
        (envelope.stderrString !== undefined && envelope.stderrString !== '')
      ) {
        throw problem(
          'EXEC_UNAVAILABLE',
          'App and input discovery need Homebrew Channel running with root access.'
        );
      }
      try {
        if (typeof envelope.stdoutString !== 'string' || envelope.stdoutString.length > LIMIT)
          throw new Error();
        response = JSON.parse(envelope.stdoutString);
        if (!object(response)) throw new Error();
      } catch (ignore) {
        throw problem('INVALID_RESPONSE', 'The TV returned an unreadable discovery response.');
      }
    }
    if (response.returnValue === false) {
      if (response.errorCode === 'root_required')
        throw problem(
          'ROOT_REQUIRED',
          'App and input discovery need Homebrew Channel running with root access.'
        );
      var failure = problem('SERVICE_ERROR', 'The TV did not allow this inventory read.');
      failure.serviceCode = response.errorCode;
      throw failure;
    }
    if (
      response.returnValue !== true ||
      failedCode(response.errorCode) ||
      !Array.isArray(response[read.field]) ||
      response[read.field].length > read.limit
    )
      throw problem('INVALID_RESPONSE', 'The TV did not return the requested list.');
    return response;
  }

  function request(read) {
    var cancel = function () {};
    var operation = new Promise(function (resolve, reject) {
      var route = transport();
      if (!route) {
        reject(problem('EXEC_UNAVAILABLE', 'App and input discovery require the packaged TV app.'));
        return;
      }
      var bridge,
        timer,
        done = false;
      var key = ++nextRequest;
      function finish(error, response) {
        if (done) return;
        done = true;
        root.clearTimeout(timer);
        if (bridge) {
          bridge.onservicecallback = function () {};
          try {
            if (typeof bridge.cancel === 'function') bridge.cancel();
          } catch (ignore) {}
        }
        delete active[key];
        if (error) reject(error);
        else resolve(response);
      }
      cancel = function () {
        finish(problem('CANCELLED', 'The discovery request was cancelled.'));
      };
      try {
        bridge = new root.PalmServiceBridge();
        active[key] = bridge;
        bridge.onservicecallback = function (raw) {
          if (done) return;
          try {
            finish(null, parse(raw, read, route));
          } catch (error) {
            finish(error);
          }
        };
        timer = root.setTimeout(
          function () {
            finish(problem('TIMEOUT', 'The TV did not return the requested list.'));
          },
          route === 'root' ? 6500 : 5000
        );
        bridge.call(
          route === 'root' ? URI : read.uri,
          JSON.stringify(route === 'root' ? { command: command(read) } : {})
        );
      } catch (ignore) {
        finish(
          problem(
            route === 'root' ? 'EXEC_UNAVAILABLE' : 'BRIDGE_ERROR',
            route === 'root'
              ? 'App and input discovery need Homebrew Channel running with root access.'
              : 'The TV connection could not complete this inventory read.'
          )
        );
      }
    });
    operation.cancel = function () {
      cancel();
    };
    return operation;
  }

  root.LGXMBDiscovery = Object.freeze({
    listApps: function () {
      return request(READS.apps);
    },
    listInputs: function () {
      return request(READS.inputs);
    }
  });
})(window);
