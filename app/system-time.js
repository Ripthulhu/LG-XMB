/* SPDX-License-Identifier: GPL-3.0-or-later */
(function (root) {
  'use strict';
  var SERVICE = 'luna://com.webos.service.systemservice/time/';
  var MIN = 946684800, MAX = 4102444799; // Supported editor range: 2000..2099 UTC.
  var pendingWrite = null;
  function problem(code, message) { var e = new Error(message); e.code = code; return e; }
  function validUTC(utc) { return Number.isSafeInteger(utc) && utc >= MIN && utc <= MAX; }
  function clean(value) { return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').slice(0, 200) : ''; }
  function isTV() { return !!(root.C5TV && root.C5TV.isTV()); }
  function request(method, payload) {
    var cancel = function () {};
    var op = new Promise(function (resolve, reject) {
      var bridge, timer, done = false;
      function finish(error, result) {
        if (done) return;
        done = true; root.clearTimeout(timer);
        if (bridge) { bridge.onservicecallback = function () {}; try { bridge.cancel(); } catch (ignore) {} }
        if (error) reject(error); else resolve(result);
      }
      cancel = function () { finish(problem('CANCELLED', 'Time read cancelled.')); };
      try {
        bridge = new root.PalmServiceBridge();
        bridge.onservicecallback = function (raw) {
          if (done) return;
          var r;
          try { if (typeof raw === 'string' && raw.length > 16384) throw Error(); r = typeof raw === 'string' ? JSON.parse(raw) : raw; }
          catch (ignore) { finish(problem('INVALID_RESPONSE', 'The TV returned an unreadable time response.')); return; }
          if (!r || typeof r !== 'object' || Array.isArray(r)) { finish(problem('INVALID_RESPONSE', 'Invalid time response.')); return; }
          if (r.returnValue !== true || (r.errorCode !== undefined && r.errorCode !== 0 && r.errorCode !== '0')) {
            finish(problem('SERVICE_ERROR', clean(r.errorText) || 'The TV refused this time operation.')); return;
          }
          finish(null, r);
        };
        // Relative timeout, never Date.now(): this request can change the clock.
        timer = root.setTimeout(function () { finish(problem('TIMEOUT', method === 'setSystemTime' ?
          'The TV did not confirm the change. It may have applied; read the clock before retrying.' : 'The TV did not return its time.')); }, 5000);
        bridge.call(SERVICE + method, JSON.stringify(payload));
      } catch (ignore) { finish(problem('BRIDGE_ERROR', 'The TV time service is unavailable.')); }
    });
    op.cancel = cancel; return op;
  }
  var formatZone, cachedFormat;
  function formatter(zone) {
    if (cachedFormat && formatZone === zone) return cachedFormat;
    var result = new Intl.DateTimeFormat('en-GB-u-nu-latn', {timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'});
    formatZone = zone; cachedFormat = result; return result;
  }
  function parts(utc, zone) {
    var out = {};
    formatter(zone).formatToParts(new Date(utc * 1000)).forEach(function (p) {
      if (['year', 'month', 'day', 'hour', 'minute', 'second'].indexOf(p.type) >= 0) out[p.type] = Number(p.value);
    });
    return out;
  }
  function days(year, month) { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }
  function localEpoch(p) {
    if (!p || !['year', 'month', 'day', 'hour', 'minute', 'second'].every(function (k) { return Number.isInteger(p[k]); }) ||
      p.year < 2000 || p.year > 2099 || p.month < 1 || p.month > 12 || p.day < 1 || p.day > days(p.year, p.month) ||
      p.hour < 0 || p.hour > 23 || p.minute < 0 || p.minute > 59 || p.second < 0 || p.second > 59)
      throw problem('INVALID_DATE', 'Enter a valid date and time between 2000 and 2099.');
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) / 1000;
  }
  function epoch(p) { return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) / 1000; }
  function candidates(p, zone) {
    var wall = localEpoch(p), offsets = [], result = [];
    // Probe both sides of a DST transition, then round-trip each candidate.
    // A fixed current UTC offset would be wrong when editing another season.
    for (var h = -48; h <= 48; h += 12) {
      var probe = wall + h * 3600, offset = epoch(parts(probe, zone)) - probe;
      if (offsets.indexOf(offset) < 0) offsets.push(offset);
    }
    offsets.forEach(function (offset) {
      var utc = wall - offset;
      if (validUTC(utc) && epoch(parts(utc, zone)) === wall && result.indexOf(utc) < 0) result.push(utc);
    });
    result.sort(function (a, b) { return a - b; });
    if (!result.length) throw problem('NONEXISTENT_TIME', 'This local time does not exist in the TV time zone, or is outside the supported range.');
    return result;
  }
  function normalize(r) {
    if (!Number.isSafeInteger(r.utc) || r.utc < 0 || r.utc > MAX) throw problem('INVALID_RESPONSE', 'The TV returned an invalid UTC time.');
    var zone = clean(r.timezone) || Intl.DateTimeFormat().resolvedOptions().timeZone;
    try { formatter(zone); } catch (ignore) { throw problem('TIMEZONE_UNAVAILABLE', 'The TV time zone is not supported by this browser. Use TV Settings to adjust it.'); }
    var local = parts(r.utc, zone);
    // With no named zone, do not assume the browser and native service agree.
    if (!r.timezone && Number.isFinite(r.offset) && epoch(local) - r.utc !== r.offset * 60)
      throw problem('TIMEZONE_MISMATCH', 'The TV and browser time zones disagree. Use TV Settings to adjust the time zone.');
    return {utc: r.utc, timezone: zone, local: local, preview: r.preview === true};
  }
  function get() {
    if (!isTV()) { var now = Math.floor(Date.now() / 1000); return Promise.resolve(normalize({utc: now, preview: true})); }
    var read = request('getSystemTime', {}), op = read.then(normalize); op.cancel = function () { read.cancel(); }; return op;
  }
  function set(utc) {
    if (!validUTC(utc)) return Promise.reject(problem('INVALID_TIME', 'Time must be whole Unix seconds, not milliseconds, between 2000 and 2099.'));
    if (!isTV()) return Promise.resolve({preview: true, utc: utc});
    if (pendingWrite) return Promise.reject(problem('TIME_PENDING', 'A time change is already pending.'));
    // Only explicit Apply reaches this call. Never retry a write automatically.
    var op = request('setSystemTime', {utc: utc});
    pendingWrite = op;
    var result = op.then(function () { return {preview: false, utc: utc}; });
    result.then(function () { if (pendingWrite === op) pendingWrite = null; }, function () { if (pendingWrite === op) pendingWrite = null; });
    // Closing a panel cannot undo a write that already reached the service.
    return result;
  }
  var api = {get: get, set: set, parts: parts, candidates: candidates, days: days, validUTC: validUTC};
  root.LGXMBSystemTime = Object.freeze(api);
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
