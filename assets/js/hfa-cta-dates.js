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
   * Hallie slugs often end with {@code -YYYYMMDD} or {@code -YYYY-MM-DD} (batch / launch date).
   * That date can track “which ask is newer” better than {@code createdAt} when a row was re-saved
   * after a status/type change (Hallie resets {@code createdAt} in that case).
   */
  function hfaSlugTailYmdEpoch(slug) {
    var s = String(slug || '').trim();
    if (!s) return 0;
    var mIso = s.match(/-(20\d{2}-\d{2}-\d{2})$/);
    if (mIso) {
      var t0 = Date.parse(mIso[1] + 'T12:00:00');
      if (Number.isFinite(t0) && t0 > 0) return t0;
    }
    var m = s.match(/-(20\d{2})(\d{2})(\d{2})$/);
    if (!m) return 0;
    var mo = parseInt(m[2], 10);
    var d = parseInt(m[3], 10);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return 0;
    var t = Date.parse(m[1] + '-' + m[2] + '-' + m[3] + 'T12:00:00');
    return Number.isFinite(t) && t > 0 ? t : 0;
  }

  /**
   * Sort key for banner / home / feeds.
   * Non-update rows: max of {@code createdAt} (else {@code updatedAt}) and slug tail date when present.
   * Update-like rows: last save time only ({@code updatedAt} / {@code createdAt}). Editorial {@code updateDate}
   * is for display ({@code hfaUpdateDisplayDate}), not feed order — otherwise a “story” date sorts the
   * update below the case’s original even when the update was published later.
   */
  function hfaFeedRecencyEpoch(item) {
    if (!item || typeof item !== 'object') return 0;
    var save = parseEpoch(item.updatedAt) || parseEpoch(item.createdAt);
    if (isUpdateLikeRow(item)) {
      return save || parseEpoch(item.updateDate);
    }
    var base = parseEpoch(item.createdAt) || parseEpoch(item.updatedAt);
    var slugE = hfaSlugTailYmdEpoch(item.slug);
    return slugE > base ? slugE : base;
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
  global.hfaSlugTailYmdEpoch = hfaSlugTailYmdEpoch;
})(typeof window !== 'undefined' ? window : globalThis);
