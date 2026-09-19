/* Recovered PS3 3.01 background calendar/clock arithmetic; plain JS, no framework.
 * These defaults come from a menu constructor, not every effective XMB context.
 * Graphics data and code-derived research in this pack are not relicensed assets.
 */
(function (root) {
  'use strict';
  const F = Math.fround;
  const days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const defaults = Object.freeze({
    nightBlend: 1,
    nightBrightness: 0.5,
    dawnBegin: 4,
    dawnEnd: 6,
    duskBegin: 18,
    duskEnd: 20,
    daySpread: 0
  });

  // Active background object in the supplied RPCS3 capture at 0x20401954.
  // Transition bounds are stored as fractions of a day.
  const retained = Object.freeze({
    nightBlend: 0.4999470114707947,
    nightBrightness: 0.4860590100288391,
    dawnBegin: 0,
    dawnEnd: 0.21525458991527557 * 24,
    duskBegin: 0.7707499861717224 * 24,
    duskEnd: 0.8471333384513855 * 24,
    daySpread: 2.68038010597229
  });
  function coordinates(date, automaticDate, month, period) {
    const live = fromLocalDate(date);
    return {
      month: automaticDate ? live.month : month - 1,
      day: period === 'auto' ? live.day : period === 'night' ? 0 : 0.5
    };
  }
  function calendar(month, day, hour, minute = 0, second = 0) {
    const fields = [month, day, hour, minute, second];
    if (
      !fields.every(Number.isInteger) ||
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > (month === 2 ? 29 : days[month - 1]) ||
      hour < 0 ||
      hour > 23 ||
      minute < 0 ||
      minute > 59 ||
      second < 0 ||
      second > 59
    ) {
      throw new RangeError('Invalid background calendar fields');
    }
    const d = month === 2 && day === 29 ? 27 : day - 1;
    return {
      day: F(F(hour * 3600 + minute * 60 + second) / 86400),
      month: F(F(month - 1) + F(F(d) / days[month - 1]))
    };
  }
  function fromLocalDate(date) {
    if (!(date instanceof Date) || !Number.isFinite(date.getTime()))
      throw new TypeError('Invalid date');
    return calendar(
      date.getMonth() + 1,
      date.getDate(),
      date.getHours(),
      date.getMinutes(),
      date.getSeconds()
    );
  }
  function smooth(a, b, t) {
    const x = F(Math.max(0, Math.min(1, F(F(t - a) / F(b - a)))));
    return F(F(x * x) * F(3 - 2 * x));
  }
  function uniforms(coordinates, settings, alpha = 1) {
    const s = Object.assign({}, defaults, settings);
    if (
      !coordinates ||
      !Number.isFinite(coordinates.day) ||
      !Number.isFinite(coordinates.month) ||
      !Number.isFinite(alpha) ||
      !Object.values(s).every(Number.isFinite) ||
      s.dawnBegin >= s.dawnEnd ||
      s.duskBegin >= s.duskEnd
    ) {
      throw new RangeError('Invalid background coordinates or transition settings');
    }
    const t = F(Math.max(0, Math.min(1, coordinates.day))),
      m = F(Math.max(0, Math.min(12, coordinates.month)));
    const i = Math.trunc(m),
      a = i % 12,
      b = (a + 1) % 12,
      t2 = F(t * t),
      t3 = F(t2 * t),
      spread = F(s.daySpread);
    const h1 = F(F(-2 * t3) + F(3 * t2)),
      h2 = F(F(t3 - F(2 * t2)) + t),
      h3 = F(t3 - t2);
    const q = F(F(h1 + F(h2 * spread)) + F(h3 * spread));
    let nt = F(t - 0.5);
    if (nt < 0) nt = F(nt + 1);
    const rise = smooth(F(s.dawnBegin / 24), F(s.dawnEnd / 24), t);
    const fall = F(1 - smooth(F(s.duskBegin / 24), F(s.duskEnd / 24), t));
    return {
      layers: [a, b, 12 + a, 12 + b],
      values: {
        _DayTime: F(q * 2400),
        _NightTime: F(nt * 2400),
        _MonthTime: F(F(m - i) * 30),
        _NightDayBlend: F(1 + F(F(rise * fall) - 1) * F(s.nightBlend)),
        _NightBrightness: F(s.nightBrightness),
        _Alpha: F(alpha)
      }
    };
  }
  function nextMonthWeight(phase, y) {
    const a =
      (F(0.04444444179534912) * (phase - 15) * (phase - 15) + F(0.1)) * (y + 1 - F(0.1) * phase);
    return 0.5 - 0.5 * Math.tanh(Math.max(-10, Math.min(10, a)));
  }
  const api = Object.freeze({
    defaults,
    retained,
    calendar,
    fromLocalDate,
    coordinates,
    uniforms,
    nextMonthWeight
  });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LGXMBPS3BackgroundClock = api;
})(typeof window === 'object' ? window : globalThis);
