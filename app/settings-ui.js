/* SPDX-License-Identifier: GPL-3.0-or-later */
// Shared controls and directional focus for the standard settings panels.
(function (root) {
  'use strict';
  function SettingsUI(content, options) {
    function row(label, colour, isSelected, handler, parent) {
      var button = document.createElement('button');
      button.className = 'option';
      button.setAttribute('aria-pressed', String(isSelected));
      var labelSpan = document.createElement('span');
      if (colour) {
        var swatch = document.createElement('i');
        swatch.className = 'swatch';
        swatch.style.background = colour;
        labelSpan.appendChild(swatch);
      }
      labelSpan.appendChild(document.createTextNode(label));
      button.appendChild(labelSpan);
      var mark = document.createElement('span');
      mark.className = 'option-check';
      mark.setAttribute('aria-hidden', 'true');
      mark.textContent = isSelected ? '✓' : '';
      button.appendChild(mark);
      button.addEventListener('click', function () {
        var previousModal = options.getPanel();
        handler();
        options.sound(previousModal !== options.getPanel() ? 'option' : 'decide');
      });
      (parent || content).appendChild(button);
      return button;
    }
    function selectChoice(parent, value) {
      [].forEach.call(parent.querySelectorAll('[data-choice]'), function (button) {
        var chosen = button.getAttribute('data-choice') === String(value);
        if (button.getAttribute('aria-pressed') !== String(chosen)) {
          button.setAttribute('aria-pressed', String(chosen));
          button.querySelector('.option-check').textContent = chosen ? '✓' : '';
        }
      });
    }
    function choiceGroup(label, choices, value, handler) {
      var group = document.createElement('section');
      group.className = 'choice-group';
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', label);
      var title = document.createElement('h3');
      title.textContent = label;
      group.appendChild(title);
      var options = document.createElement('div');
      options.className = 'choice-options';
      group.appendChild(options);
      choices.forEach(function (choice) {
        var button = row(
          choice[1],
          null,
          value === choice[0],
          function () {
            handler(choice[0]);
            selectChoice(options, choice[0]);
          },
          options
        );
        button.setAttribute('data-choice', choice[0]);
      });
      content.appendChild(group);
      return group;
    }
    function statusText(node, text) {
      if (node.textContent !== text) node.textContent = text;
    }
    function reserveAction(button) {
      var slot = document.createElement('div');
      slot.className = 'menu-action-slot';
      button.parentNode.insertBefore(slot, button);
      slot.appendChild(button);
    }
    function key(event, panel) {
      if (event.key !== 'Tab' && !/^Arrow/.test(event.key)) return;
      var current = document.activeElement,
        group = current.closest && current.closest('.choice-group'),
        horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight',
        controls,
        target;
      // Left/Right stays within its choice row; only row changes and Tab need
      // the full panel, including any actions that just became visible.
      if (!horizontal || !group)
        controls = Array.from(panel.querySelectorAll('button')).filter(function (b) {
          return !b.disabled && !b.closest('[hidden]');
        });
      if (event.key === 'Tab') {
        target =
          controls[
            (Math.max(controls.indexOf(current), 0) + (event.shiftKey ? -1 : 1) + controls.length) %
              controls.length
          ];
      } else {
        var delta = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1;
        if (horizontal && group) {
          var choices = Array.from(group.querySelectorAll('button')).filter(function (b) {
            return !b.disabled && !b.closest('[hidden]');
          });
          target = choices[(choices.indexOf(current) + delta + choices.length) % choices.length];
        } else {
          // Each horizontal choice group is one row; standalone actions retain
          // their DOM order, including actions before and after those groups.
          var rows = [],
            rowStarts = [],
            previousRow;
          controls.forEach(function (b, index) {
            var row = b.closest('.choice-group') || b;
            // A group's buttons are consecutive in DOM order. Retain their
            // positions in this same eligibility scan for target selection.
            if (row !== previousRow) {
              rows.push(row);
              rowStarts.push(index);
              previousRow = row;
            }
          });
          var at = rows.indexOf(group || current),
            next = Math.max(0, Math.min(rows.length - 1, at + delta));
          if (next === at) {
            event.preventDefault();
            return;
          }
          var first = rowStarts[next],
            end = next + 1 < rowStarts.length ? rowStarts[next + 1] : controls.length;
          target = controls[first];
          for (var i = first; i < end; i++) {
            if (controls[i].getAttribute('aria-pressed') === 'true') {
              target = controls[i];
              break;
            }
          }
        }
      }
      event.preventDefault();
      if (target && target !== current) {
        options.focus(target);
        options.sound();
      }
    }
    return {
      row: row,
      choiceGroup: choiceGroup,
      selectChoice: selectChoice,
      key: key,
      statusText: statusText,
      reserveAction: reserveAction
    };
  }
  root.LGXMBSettingsUI = SettingsUI;
})(window);
