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

  function parseEpoch(raw) {
    var n = Date.parse(String(raw || '').trim());
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function isUpdateLikeRow(x) {
    if (!x) return false;
    var type = String(x.ctaType || '').trim().toLowerCase();
    var role = String(x.role || '').trim().toLowerCase();
    var status = String(x.status || '').trim().toLowerCase();
    return type === 'update' || role === 'update' || status === 'updated';
  }

  /**
   * Sort key for banner / home / feeds.
   * Non-update rows: {@code createdAt} first (first publish) so later edits do not jump above newer campaigns;
   * falls back to {@code updatedAt} if created is missing.
   * Update-like rows: editorial {@code updateDate} when before save time (backdated story), else save time.
   */
  function hfaFeedRecencyEpoch(item) {
    if (!item || typeof item !== 'object') return 0;
    var save = parseEpoch(item.updatedAt) || parseEpoch(item.createdAt);
    if (isUpdateLikeRow(item)) {
      var ud = String(item.updateDate || '').trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(ud)) {
        var story = Date.parse(ud.slice(0, 10) + 'T12:00:00');
        if (Number.isFinite(story) && story > 0 && save > 0 && story < save) {
          return story;
        }
      }
      return save || parseEpoch(item.updateDate);
    }
    return parseEpoch(item.createdAt) || parseEpoch(item.updatedAt);
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
  global.hfaFeedRecencyEpoch = hfaFeedRecencyEpoch;
})(typeof window !== 'undefined' ? window : globalThis);
