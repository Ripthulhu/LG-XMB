/* SPDX-License-Identifier: GPL-3.0-or-later */
// Clock presentation only. The launcher owns its timer; TV time has a separate editor.
(function (root) {
  'use strict';
  function text(element, value) {
    if (element.textContent !== value) element.textContent = value;
  }
  function attribute(element, name, value) {
    if (element.getAttribute(name) !== value) element.setAttribute(name, value);
  }
  function ClockView(element) {
    this.element = element;
    this.time = element.querySelector('#time');
    this.date = element.querySelector('#date');
    this.hour = element.querySelector('.clock-hour');
    this.minute = element.querySelector('.clock-minute');
  }
  ClockView.prototype.update = function (now, style, timeFormat, dateFormat) {
    if (!Number.isFinite(now.getTime())) return;
    var ps3 = style === 'ps3',
      hour = now.getHours(),
      hour12 = timeFormat === '12h',
      time =
        (hour12 ? hour % 12 || 12 : ps3 ? hour : String(hour).padStart(2, '0')) +
        ':' +
        String(now.getMinutes()).padStart(2, '0') +
        (hour12 ? (hour < 12 ? ' AM' : ' PM') : ''),
      date;
    if (dateFormat === 'dmy' || dateFormat === 'mdy' || dateFormat === 'ymd') {
      var day = String(now.getDate()).padStart(2, '0'),
        month = String(now.getMonth() + 1).padStart(2, '0'),
        year = now.getFullYear();
      date =
        dateFormat === 'ymd'
          ? year + '-' + month + '-' + day
          : (dateFormat === 'mdy' ? month + '/' + day : day + '/' + month) + '/' + year;
    } else {
      date = ps3
        ? now.getDate() + '/' + (now.getMonth() + 1)
        : now.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
    }
    attribute(this.element, 'data-style', ps3 ? 'ps3' : 'current');
    if (this.time.textContent !== time) {
      text(this.time, time);
      this.time.dateTime = now.toISOString();
    }
    text(this.date, date);
    if (ps3) {
      // Minute-resolution hands need no animation loop or extra timer.
      attribute(
        this.hour,
        'transform',
        'rotate(' + ((now.getHours() % 12) * 30 + now.getMinutes() / 2) + ' 16 16)'
      );
      attribute(this.minute, 'transform', 'rotate(' + now.getMinutes() * 6 + ' 16 16)');
    }
  };
  root.LGXMBClockView = ClockView;
})(window);
