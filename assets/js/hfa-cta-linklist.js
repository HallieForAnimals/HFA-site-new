/**
 * Single source for which CTAs appear on Recent / Ongoing / home list.
 * Hallie saves flat <code>links[]</code>; legacy data may also use <code>sections[]</code>.
 * We merge both (flat list wins on slug collision) so nothing in <code>links</code> is dropped.
 */
(function (global) {
  'use strict';

  function isHiddenCta(item) {
    return !!(item && (item.hidden === true || item.archived === true));
  }

  function isRecentOriginalCta(x) {
    if (!x) return false;
    if (String(x.ctaType || '').toLowerCase() === 'update') return false;
    if (String(x.role || '').toLowerCase() === 'update') return false;
    if (String(x.status || '').toLowerCase() === 'updated') return false;
    var stRaw = x.status;
    var st = String(stRaw == null || String(stRaw).trim() === '' ? 'recent' : stRaw).toLowerCase();
    if (st !== 'recent') return false;
    var role = x.role;
    if (role == null || role === '' || String(role).trim() === '') return true;
    return String(role).toLowerCase() === 'original';
  }

  function normalizedListStatus(x) {
    if (!x || x.status == null) return '';
    return String(x.status).trim().toLowerCase();
  }

  function isOngoingCta(x) {
    if (!x) return false;
    if (String(x.ctaType || '').toLowerCase() === 'update') return false;
    if (String(x.role || '').toLowerCase() === 'update') return false;
    return normalizedListStatus(x) === 'ongoing';
  }

  function sectionLinksNamed(json, needle) {
    var sec = json && json.sections;
    if (!Array.isArray(sec) || !sec.length) return [];
    var out = [];
    var n = String(needle || '').toLowerCase();
    sec.forEach(function (s) {
      var name = String(s && s.name ? s.name : '').toLowerCase();
      if (name.indexOf(n) !== -1 && Array.isArray(s.links)) out = out.concat(s.links);
    });
    return out;
  }

  /**
   * @param {object} json parsed links.json
   * @param {function} predicate row filter
   * @param {string} sectionNeedle e.g. "recent"
   */
  function collectMerged(json, predicate, sectionNeedle) {
    var seen = Object.create(null);
    var out = [];
    function push(list) {
      if (!Array.isArray(list)) return;
      list.forEach(function (item) {
        if (!item || !predicate(item)) return;
        var sl = String(item.slug || '').trim().toLowerCase();
        if (sl) {
          if (seen[sl]) return;
          seen[sl] = true;
        }
        out.push(item);
      });
    }
    if (Array.isArray(json.links)) push(json.links);
    push(sectionLinksNamed(json, sectionNeedle));
    return out.filter(function (x) { return !isHiddenCta(x); });
  }

  function hfaCollectRecentCtas(json) {
    return collectMerged(json || {}, isRecentOriginalCta, 'recent');
  }

  function hfaCollectOngoingCtas(json) {
    return collectMerged(json || {}, isOngoingCta, 'ongoing');
  }

  global.hfaCollectRecentCtas = hfaCollectRecentCtas;
  global.hfaCollectOngoingCtas = hfaCollectOngoingCtas;
})(typeof window !== 'undefined' ? window : globalThis);
