/* Bundled helper setup through the TV's existing Homebrew service.
 * SPDX-License-Identifier: GPL-3.0-or-later */
(function (root) {
  'use strict';
  var URI = 'luna://org.webosbrew.hbchannel.service/exec';
  var COMMAND =
    'if [ -x /usr/bin/python3 ]; then /usr/bin/python3 -I -B ' +
    '/media/developer/apps/usr/palm/applications/org.local.openxmb.c5/helper-startup.py ensure; ' +
    'else printf \'%s\\n\' \'{"returnValue":false,"errorCode":"python_missing"}\'; fi';
  var pending = null,
    confirmed = null,
    failure = null,
    phase = 'idle';
  var messages = {
    EXEC_UNAVAILABLE:
      'Homebrew helper execution is unavailable. Check Homebrew Channel, then retry setup.',
    ROOT_REQUIRED:
      'Homebrew ran the helper without root privileges. Check its root status, then retry setup.',
    PYTHON_MISSING: 'The TV has no usable Python 3 interpreter for the helper.',
    PYTHON_TOO_OLD: 'The helper needs Python 3.7 or newer on the TV.',
    BUNDLE_INCOMPLETE: 'The installed helper is incomplete. Reinstall the lg-xmb IPK.',
    BUNDLE_MISMATCH: 'The installed app and helper do not match. Reinstall the lg-xmb IPK.',
    HELPER_PERMISSIONS:
      'The installed helper directory is writable by other users. Install a corrected lg-xmb IPK.',
    HELPER_OWNER:
      'The installed helper directory is not owned by root. Its ownership was not changed.',
    CONFIG_CONFLICT:
      'Old and new helper settings differ. Both were preserved; resolve the migration before continuing.',
    BUSY: 'Helper setup is busy. Wait for it to finish before retrying.',
    SETUP_PENDING:
      'Another lg-xmb setup is still finishing. Open this menu again to check its progress.',
    WORKER_BUSY:
      'The worker lock is held without a verified reusable helper. No additional worker was started.',
    TIMEOUT: 'Helper setup was not confirmed. It may still be running; no retry was sent.',
    SETUP_FAILED:
      'Helper setup failed. Check the startup log and installed helper files before retrying.'
  };
  function problem(code) {
    var e = new Error(messages[code] || messages.SETUP_FAILED);
    e.code = code;
    return e;
  }
  function object(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }
  function emit(type) {
    if (root.document && typeof root.Event === 'function')
      root.document.dispatchEvent(new root.Event(type || 'lg-xmb-helper-status'));
  }
  function parse(raw) {
    var outer, value;
    try {
      if (typeof raw !== 'string' || raw.length > 65536) throw new Error();
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
      throw problem('EXEC_UNAVAILABLE');
    }
    if (value.returnValue === false) {
      var codes = {
        python_missing: 'PYTHON_MISSING',
        python_too_old: 'PYTHON_TOO_OLD',
        bundle_incomplete: 'BUNDLE_INCOMPLETE',
        invalid_helper_bundle: 'BUNDLE_MISMATCH',
        helper_bundle_mismatch: 'BUNDLE_MISMATCH',
        untrusted_app_manifest: 'BUNDLE_MISMATCH',
        helper_directory_writable: 'HELPER_PERMISSIONS',
        helper_owner_mismatch: 'HELPER_OWNER',
        legacy_config_conflict: 'CONFIG_CONFLICT',
        helper_busy: 'BUSY',
        setup_in_progress: 'SETUP_PENDING',
        bundle_lock_busy: 'SETUP_PENDING',
        worker_lock_busy: 'WORKER_BUSY'
      };
      if (
        value.errorCode === 'root_required' &&
        Number.isInteger(value.effectiveUid) &&
        value.effectiveUid > 0
      )
        throw problem('ROOT_REQUIRED');
      var error = problem(codes[value.errorCode] || 'SETUP_FAILED');
      if (value.logWritten === true) error.message += ' Log: /var/lib/webosbrew/lg-xmb-startup.log';
      throw error;
    }
    if (
      outer.returnValue !== true ||
      [outer.errorCode, outer.returnCode, outer.exitCode].some(function (code) {
        return code !== undefined && code !== 0 && code !== '0';
      }) ||
      (outer.error !== undefined && outer.error !== null && outer.error !== '') ||
      outer.stderrString ||
      value.returnValue !== true ||
      value.ready !== true ||
      typeof value.captureRunning !== 'boolean'
    )
      throw problem('EXEC_UNAVAILABLE');
    return { ready: true, captureRunning: value.captureRunning };
  }
  function ensure() {
    if (destroyed) return Promise.reject(problem('EXEC_UNAVAILABLE'));
    if (confirmed) return Promise.resolve(confirmed);
    if (pending) return pending;
    // A bounded lock wait can expire before another setup finishes. This is
    // not a sticky session failure; the next caller may recheck. Other errors,
    // including an uncertain RPC timeout, still require an explicit retry.
    if (failure && failure.code !== 'SETUP_PENDING') return Promise.reject(failure);
    if (!root.C5TV || !root.C5TV.isTV() || typeof root.PalmServiceBridge !== 'function')
      return Promise.reject(problem('EXEC_UNAVAILABLE'));
    failure = null;
    phase = 'starting';
    emit();
    // Keep the bridge alive until this fixed setup command replies.
    var operation = new Promise(function (resolve, reject) {
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
      try {
        bridge = new root.PalmServiceBridge();
        bridge.onservicecallback = function (raw) {
          try {
            finish(null, parse(raw));
          } catch (error) {
            finish(error);
          }
        };
        timer = root.setTimeout(function () {
          finish(problem('TIMEOUT'));
        }, 45000);
        bridge.call(URI, JSON.stringify({ command: COMMAND }));
      } catch (ignore) {
        finish(problem('EXEC_UNAVAILABLE'));
      }
    });
    pending = operation.then(
      function (value) {
        confirmed = value;
        phase = 'ready';
        pending = null;
        emit();
        return value;
      },
      function (error) {
        failure = error;
        phase = error.code === 'SETUP_PENDING' ? 'waiting' : 'failed';
        pending = null;
        emit();
        throw error;
      }
    );
    return pending;
  }
  // Setup readiness and capture health are separate. A verified setup can outlive
  // its worker, and a working capture can outlive an unconfirmed setup reply.
  var captureHealth = 'unknown',
    captureCheck = null,
    captureRead = null,
    active = false,
    watching = false,
    destroyed = false,
    lifecycle = 0,
    watchTimer = null,
    resumeTimer = null;
  var HEALTH_INTERVAL = 5000,
    RESUME_GRACE = 10000;

  function captureState(value) {
    if (
      !object(value) ||
      value.version !== 1 ||
      !Number.isFinite(value.updatedAt) ||
      typeof value.state !== 'string'
    )
      return 'unknown';
    var age = Date.now() / 1000 - value.updatedAt;
    if (age < -5 || age > 30) return 'stale';
    if (
      ['idle', 'settling', 'waiting', 'captured', 'discarded_source_changed'].indexOf(
        value.state
      ) >= 0
    )
      return 'running';
    if (['stopped', 'app_absent', 'app_rejected', 'app_unavailable'].indexOf(value.state) >= 0)
      return 'stopped';
    if (value.state === 'waiting_for_app') return 'waiting';
    if (value.state === 'skipped') return 'skipped';
    return 'unknown';
  }

  function checkCapture() {
    if (destroyed) return Promise.resolve('unknown');
    if (captureCheck) return captureCheck;
    var read = { cancelled: false, cancel: null };
    captureRead = read;
    captureCheck = new Promise(function (resolve) {
      var xhr,
        done = false;
      function finish(value) {
        if (done) return;
        done = true;
        if (!read.cancelled) {
          captureHealth = value;
        }
        resolve(value);
      }
      read.cancel = function () {
        read.cancelled = true;
        finish('unknown');
        if (xhr) {
          xhr.onload = xhr.onerror = xhr.ontimeout = xhr.onabort = null;
          try {
            xhr.abort();
          } catch (ignore) {}
        }
      };
      try {
        xhr = new root.XMLHttpRequest();
        xhr.open('GET', 'thumbnails/status.json?t=' + Date.now(), true);
        xhr.timeout = 3000;
        xhr.onload = function () {
          try {
            if (xhr.status === 404) {
              finish('missing');
              return;
            }
            if ((xhr.status !== 0 && xhr.status !== 200) || xhr.responseText.length > 16384)
              throw Error();
            finish(captureState(JSON.parse(xhr.responseText)));
          } catch (ignore) {
            finish('unknown');
          }
        };
        xhr.onerror =
          xhr.ontimeout =
          xhr.onabort =
            function () {
              finish('unknown');
            };
        xhr.send();
      } catch (ignore) {
        finish('unknown');
      }
    }).then(function (value) {
      if (captureRead === read) {
        captureRead = null;
        captureCheck = null;
        if (!read.cancelled) emit();
      }
      return value;
    });
    return captureCheck;
  }

  function cancelCaptureRead() {
    var read = captureRead;
    captureRead = null;
    captureCheck = null;
    if (read && read.cancel) read.cancel();
  }

  function clearHealthTimers() {
    if (watchTimer !== null) root.clearTimeout(watchTimer);
    if (resumeTimer !== null) root.clearTimeout(resumeTimer);
    watchTimer = resumeTimer = null;
  }

  function pollCapture() {
    var generation = lifecycle;
    return checkCapture().then(function (health) {
      if (active && watching && generation === lifecycle && watchTimer === null) {
        watchTimer = root.setTimeout(function () {
          watchTimer = null;
          pollCapture();
        }, HEALTH_INTERVAL);
      }
      return health;
    });
  }

  function watchCapture(value) {
    watching = !!value;
    if (watchTimer !== null) root.clearTimeout(watchTimer);
    watchTimer = null;
    if (active && watching) pollCapture();
  }

  function retry() {
    if (pending) return pending;
    // A manual retry also supersedes any delayed resume recovery.
    if (resumeTimer !== null) root.clearTimeout(resumeTimer);
    resumeTimer = null;
    // Do not reuse a heartbeat read begun before the new setup attempt.
    cancelCaptureRead();
    failure = null;
    confirmed = null;
    var generation = lifecycle,
      operation = ensure();
    operation.then(
      function () {
        if (active && generation === lifecycle) emit('lg-xmb-helper-recovered');
      },
      function () {}
    );
    return operation;
  }

  function resume() {
    if (active || destroyed || (root.document && root.document.hidden)) return;
    active = true;
    var generation = ++lifecycle,
      hadWorker = !!(confirmed && confirmed.captureRunning);
    pollCapture();
    if (!hadWorker) return;
    // A suspended worker needs time to publish a fresh heartbeat. Recheck once
    // after that grace; never loop retries or retry an uncertain setup RPC.
    resumeTimer = root.setTimeout(function () {
      resumeTimer = null;
      if (!active || generation !== lifecycle) return;
      checkCapture().then(function (health) {
        if (
          !active ||
          generation !== lifecycle ||
          !confirmed ||
          failure ||
          pending ||
          ['stale', 'stopped', 'missing'].indexOf(health) < 0
        )
          return;
        retry().then(
          function () {
            if (active && generation === lifecycle) pollCapture();
          },
          function () {
            // The failure stays sticky until the user chooses Retry setup.
          }
        );
      });
    }, RESUME_GRACE);
  }

  function suspend() {
    active = false;
    lifecycle++;
    clearHealthTimers();
    cancelCaptureRead();
  }

  function status() {
    return {
      captureHealth: captureHealth,
      captureChecking: !!captureRead,
      captureRecovering: resumeTimer !== null,
      phase: phase,
      ready: !!confirmed,
      captureRunning: !!(confirmed && confirmed.captureRunning),
      code: failure ? failure.code : null,
      message: failure
        ? failure.message
        : phase === 'starting'
          ? 'Preparing TV helper…'
          : confirmed
            ? confirmed.captureRunning
              ? 'TV helper ready. Cached pictures appear after an input is viewed.'
              : 'Helper setup finished, but HDMI capture did not start.'
            : 'TV helper has not started.'
    };
  }
  root.LGXMBHelper = Object.freeze({
    ensure: ensure,
    checkCapture: checkCapture,
    isReady: function () {
      return !!confirmed;
    },
    getState: status,
    retry: retry,
    resume: resume,
    suspend: suspend,
    watchCapture: watchCapture,
    destroy: function () {
      destroyed = true;
      watching = false;
      suspend();
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
