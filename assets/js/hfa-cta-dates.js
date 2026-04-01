/**
 * Display dates for CTAs: US-style (en-US) in America/Los_Angeles.
 * Manual {@code updateDate} (YYYY-MM-DD) is shown as-entered for update rows; ISO times use Pacific.
 */
(function (global) {
  'use strict';

  var TZ = 'America/Los_Angeles';
  var US_OPTS = { timeZone: TZ, year: 'numeric', month: 'short', day: 'numeric' };

  var MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function hfaFormatYmdCalendarUs(ymd) {
    var m = String(ymd || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return '';
    var y = parseInt(m[1], 10);
    var mo = parseInt(m[2], 10);
    var d = parseInt(m[3], 10);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
    return MONTHS_SHORT[mo - 1] + ' ' + d + ', ' + y;
  }

  function hfaFormatIsoInPacific(raw) {
    var s = String(raw || '').trim();
    if (!s) return '';
    var dt = new Date(s);
    if (isNaN(dt.getTime())) return s;
    return dt.toLocaleDateString('en-US', US_OPTS);
  }

  /**
   * Prefer editorial {@code updateDate} when set (YYYY-MM-DD); otherwise timestamps in Pacific.
   */
  function hfaUpdateDisplayDate(item) {
    if (!item || typeof item !== 'object') return '';
    var ud = String(item.updateDate || '').trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(ud)) {
      return hfaFormatYmdCalendarUs(ud.slice(0, 10));
    }
    return hfaFormatIsoInPacific(item.updatedAt || item.createdAt || item.updateDate);
  }

  global.hfaFormatYmdCalendarUs = hfaFormatYmdCalendarUs;
  global.hfaFormatIsoInPacific = hfaFormatIsoInPacific;
  global.hfaUpdateDisplayDate = hfaUpdateDisplayDate;
})(typeof window !== 'undefined' ? window : globalThis);
