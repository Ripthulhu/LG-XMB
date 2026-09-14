/* In-app setup for the bundled helper. SPDX-License-Identifier: GPL-3.0-or-later */
(function () {
  'use strict';
  var opened = false, generation = 0, pending = null, state = null, message = '';
  function content() { return document.getElementById('modalContent'); }
  function active(token) { return opened && generation === token && !document.hidden; }
  function paragraph(text, error) {
    var node = document.createElement('p');
    node.className = error ? 'background-error' : 'remote-note';
    node.textContent = text;
    if (error) node.setAttribute('role', 'alert');
    content().appendChild(node);
  }
  function button(text, action) {
    var node = document.createElement('button');
    node.className = 'option'; node.type = 'button'; node.textContent = text;
    node.setAttribute('aria-disabled', String(!!pending));
    node.addEventListener('click', function () { if (!pending) run(action); });
    content().appendChild(node);
  }
  function render(focus) {
    var root = content(); root.textContent = '';
    root.setAttribute('aria-busy', String(!!pending));
    paragraph('Cached HDMI pictures and Home-button settings need Homebrew Channel with root access and Python 3.7 or newer. The bundled helper currently targets the LG C5 on webOS 25.');
    if (message) paragraph(message, true);
    if (pending) paragraph('Checking or setting up TV features…');
    else if (state === 'running') paragraph('TV helper is running. Cached pictures appear after an eligible HDMI input has been viewed.');
    else if (state === 'starting') paragraph('TV helper started. Use Check status to confirm it is still running.');
    else if (state) {
      paragraph('Setup installs the bundled helper and starts it at boot. It does not assign the Home button. New installs leave all background controls on Allow; existing choices are kept.');
      button(state === 'missing' ? 'Enable TV features' : 'Repair TV features', 'install');
    }
    if (!pending && (state === 'running' || state === 'starting')) button('Stop helper for update', 'stop');
    if (!pending) button('Check status', 'status');
    paragraph('Before uninstalling Home, restore LG Home and set background controls to Allow. Removing the app prevents future boot starts but does not undo TV settings.');
    if (focus) { var first = root.querySelector('button'); if (first) first.focus(); }
  }
  function run(action) {
    if (pending || !opened || document.hidden) return;
    var token = generation;
    message = '';
    var adapter = window.C5HelperAdapter;
    // There is deliberately no desktop installer simulation or shell fallback.
    pending = Promise.resolve().then(function () {
      if (!adapter) throw new Error('TV setup is available only in the installed app, with Homebrew Channel root access.');
      return action === 'install' ? adapter.install() : action === 'stop' ? adapter.stop() : adapter.getState();
    }).then(function (value) {
      state = value.state;
    }).catch(function (error) {
      state = null;
      message = error.message || 'TV setup failed. Check Homebrew Channel root access and try Check status.';
    }).then(function () {
      pending = null;
      if (active(token)) render(true);
      // Reopening a panel waits for an already submitted setup, never retries it.
      else if (opened && !document.hidden) run('status');
    });
    render(false);
  }
  window.C5HelperSettings = {
    open: function () { generation++; opened = true; state = null; message = ''; render(false); run('status'); },
    close: function () { generation++; opened = false; content().removeAttribute('aria-busy'); }
  };
  document.addEventListener('visibilitychange', function () {
    if (opened && !document.hidden) run('status');
  });
}());
