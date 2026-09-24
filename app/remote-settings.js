/* Home and Back button settings. SPDX-License-Identifier: GPL-3.0-or-later */
(function () {
  'use strict';
  var options = null,
    generation = 0,
    pendingRead = null,
    home = null,
    busy = false,
    homeSection,
    homeStatus,
    retry,
    error;
  function content() {
    return document.getElementById('modalContent');
  }
  function element(tag, cls, text) {
    var node = document.createElement(tag);
    node.className = cls;
    if (text) node.textContent = text;
    return node;
  }
  function group(label, choices, value, handler) {
    var section = element('section', 'choice-group');
    section.setAttribute('role', 'group');
    section.setAttribute('aria-label', label);
    section.appendChild(element('h3', '', label));
    var buttons = element('div', 'choice-options');
    section.appendChild(buttons);
    choices.forEach(function (choice) {
      var button = element('button', 'option');
      button.type = 'button';
      button.setAttribute('data-remote-choice', label + ':' + choice[0]);
      button.setAttribute('aria-pressed', String(value === choice[0]));
      var check = element('span', 'option-check', value === choice[0] ? '✓' : '');
      check.setAttribute('aria-hidden', 'true');
      button.appendChild(element('span', '', choice[1]));
      button.appendChild(check);
      button.addEventListener('click', function () {
        handler(choice[0]);
      });
      buttons.appendChild(button);
    });
    content().appendChild(section);
    return section;
  }
  function selection(section, label, value) {
    [].forEach.call(section.querySelectorAll('[data-remote-choice]'), function (button) {
      var selected = button.getAttribute('data-remote-choice') === label + ':' + value;
      button.setAttribute('aria-pressed', String(selected));
      button.querySelector('.option-check').textContent = selected ? '✓' : '';
    });
  }
  function showError(message) {
    error.textContent = message || '';
    error.hidden = !message;
  }
  function showHome(message, canRetry) {
    selection(homeSection, 'Home button', home && home.mode);
    [].forEach.call(homeSection.querySelectorAll('button'), function (button) {
      button.disabled = !home || !home.available;
      // Keep focus on the chosen button while its write is being checked.
      button.setAttribute('aria-disabled', String(button.disabled || busy));
    });
    homeStatus.textContent = message || '';
    homeStatus.hidden = !message;
    if (!canRetry && document.activeElement === retry) {
      var target = content().querySelector('button:not(:disabled)[aria-pressed="true"]');
      if (target) target.focus({ preventScroll: true });
    }
    retry.hidden = !canRetry;
    retry.disabled = busy;
  }
  function readHome() {
    if (busy) return;
    var current = generation;
    busy = true;
    showHome('Checking Home button…', false);
    Promise.resolve()
      .then(function () {
        if (current !== generation) return;
        pendingRead = options.getHome();
        return pendingRead;
      })
      .then(function (result) {
        if (current !== generation) return;
        pendingRead = null;
        busy = false;
        home = result;
        showHome(
          result.message || (result.mode === 'other' ? 'Another app is assigned to Home.' : ''),
          !result.available && result.canRetry !== false
        );
      })
      .catch(function (failure) {
        if (current !== generation) return;
        pendingRead = null;
        busy = false;
        home = null;
        showHome(failure.message || 'Could not read the Home button setting.', true);
      });
  }
  function setHome(value) {
    if (busy || !home || !home.available || home.mode === value) return;
    var current = generation;
    busy = true;
    showError('');
    showHome('Saving Home button…', false);
    Promise.resolve()
      .then(function () {
        if (current !== generation) return;
        return options.setHome(value);
      })
      .then(function (result) {
        if (current !== generation) return;
        busy = false;
        home = result;
        showHome(result.message || '', !result.available && result.canRetry !== false);
      })
      .catch(function (failure) {
        if (current !== generation) return;
        busy = false;
        // A failed reply can follow a successful write. Read again before another change.
        home = null;
        showHome(failure.message || 'Could not confirm the Home button setting.', true);
      });
  }
  function render() {
    var root = content();
    root.textContent = '';
    error = element('p', 'background-error');
    error.setAttribute('role', 'alert');
    error.hidden = true;
    root.appendChild(error);
    homeSection = group(
      'Home button',
      [
        ['stock', 'LG Home'],
        ['xmb', 'LG-XMB']
      ],
      null,
      setHome
    );
    homeStatus = element('p', 'modal-intro');
    homeStatus.setAttribute('role', 'status');
    homeSection.appendChild(homeStatus);
    retry = element('button', 'option', 'Retry');
    retry.type = 'button';
    retry.setAttribute('data-remote-retry', '');
    retry.addEventListener('click', readHome);
    root.appendChild(retry);
    var back = group(
      'Back button',
      [
        ['previous', 'Return to last app or input'],
        ['stay', 'Stay in Home'],
        ['lg', 'Show exit prompt']
      ],
      options.getBack(),
      function (value) {
        if (options.getBack() === value) return;
        showError('');
        try {
          options.setBack(value);
        } catch (failure) {
          showError(failure.message || 'Could not save the Back button setting.');
        }
        selection(back, 'Back button', options.getBack());
      }
    );
    showHome('Checking Home button…', false);
    var target = back.querySelector('[aria-pressed="true"]') || back.querySelector('button');
    if (target) target.focus({ preventScroll: true });
    root.scrollTop = 0;
  }
  function close() {
    generation++;
    if (pendingRead && typeof pendingRead.cancel === 'function') pendingRead.cancel();
    pendingRead = null;
    options = null;
    busy = false;
    home = null;
  }
  window.C5RemoteSettings = {
    open: function (callbacks) {
      close();
      options = callbacks;
      render();
      readHome();
    },
    close: close,
    getState: function () {
      return {
        back: options ? options.getBack() : null,
        home: home && home.mode,
        homeAvailable: !!(home && home.available),
        homeBusy: busy
      };
    }
  };
})();
