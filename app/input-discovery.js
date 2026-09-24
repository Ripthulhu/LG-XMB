/* Physical inputs reported by the TV. SPDX-License-Identifier: GPL-3.0-or-later */
(function (root) {
  'use strict';

  // App IDs identify the input family; names and connection state never do.
  // Keep disconnected sockets, but exclude wireless/virtual EIM sources.
  // LG's stock appLaunch.js/checkSTBAppRunning maps HDMI_n, AV_n, COMP_1
  // and SCART to these app IDs. An installed stub alone is not a socket.
  function identity(id) {
    if (typeof id !== 'string') return null;
    var match = /^com\.webos\.app\.hdmi([1-9][0-9]?)$/.exec(id);
    if (match) return { kind: 'hdmi', port: Number(match[1]), prefix: 'HDMI' };
    match = /^com\.webos\.app\.externalinput\.(av|component|scart)([1-9][0-9]?)?$/.exec(id);
    if (!match) return null;
    var names = { av: 'AV', component: 'COMP', scart: 'SCART' };
    return { kind: match[1], port: Number(match[2] || 1), prefix: names[match[1]] };
  }

  function sourceIds(input) {
    var ids = [input.prefix + '_' + input.port];
    // LG's stock key router uses SCART without a numeric suffix.
    if (input.kind === 'scart' && input.port === 1) ids.push('SCART');
    return ids;
  }

  function cleanLabel(value) {
    return Array.from(
      (value || '')
        .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
    )
      .slice(0, 120)
      .join('');
  }

  function defaultLabel(input) {
    var names = { hdmi: 'HDMI', av: 'AV', component: 'Component', scart: 'SCART' };
    return names[input.kind] + (input.kind === 'hdmi' || input.port > 1 ? ' ' + input.port : '');
  }

  function normalize(devices) {
    if (!Array.isArray(devices) || devices.length > 128) throw new Error('Invalid input list.');
    var seen = Object.create(null),
      duplicates = Object.create(null),
      inputs = [];
    devices.forEach(function (device) {
      if (!device || typeof device !== 'object' || Array.isArray(device)) return;
      var source = identity(device.appId);
      if (!source) return;
      if (seen[device.appId]) duplicates[device.appId] = true;
      seen[device.appId] = true;
      // Some firmware omits id/port. Never accept contradictory identifiers.
      if (
        (device.id !== undefined && sourceIds(source).indexOf(device.id) < 0) ||
        (device.port !== undefined &&
          device.port !== source.port &&
          device.port !== String(source.port)) ||
        (device.label != null && typeof device.label !== 'string')
      )
        return;
      inputs.push({
        id: device.appId,
        port: source.port,
        kind: source.kind,
        label: cleanLabel(device.label) || defaultLabel(source)
      });
    });
    return inputs.filter(function (input) {
      return !duplicates[input.id];
    });
  }

  function item(input) {
    var source = input && identity(input.id);
    if (
      !source ||
      input.port !== source.port ||
      (input.kind !== undefined && input.kind !== source.kind) ||
      typeof input.label !== 'string'
    )
      return null;
    var name = defaultLabel(source),
      label = cleanLabel(input.label) || name;
    return {
      id: input.id,
      title: label,
      icon: source.kind === 'hdmi' ? 'hdmi' : 'live',
      type: label === name ? 'INPUT' : name,
      description: 'Switch to ' + name + '.',
      action: 'input'
    };
  }

  var api = { identity: identity, sourceIds: sourceIds, normalize: normalize, item: item };
  root.LGXMBInputs = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
