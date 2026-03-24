/**
 * Single source for which CTAs appear on Recent / Ongoing / home list.
 * Hallie saves flat <code>links[]</code>; legacy data may also use <code>sections[]</code>.
 * We merge both (flat list wins on slug collision) so nothing in <code>links</code> is dropped.
 */
(function (global) {
  'use strict';

  function parseEpoch(raw) {
    var n = Date.parse(String(raw || '').trim());
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function ctaCreatedEpoch(x) {
    if (!x || typeof x !== 'object') return 0;
    return parseEpoch(x.createdAt) || parseEpoch(x.updatedAt);
  }

  function isHiddenCta(item) {
    return !!(item && (item.hidden === true || item.archived === true));
  }

  function isRecentOriginalCta(x) {
    if (!x) return false;
    var ctaType = String(x.ctaType || '').trim().toLowerCase();
    var roleNorm = String(x.role || '').trim().toLowerCase();
    var statusNorm = String(x.status || '').trim().toLowerCase();
    if (ctaType === 'update') return false;
    if (roleNorm === 'update') return false;
    if (statusNorm === 'updated') return false;
    var stRaw = x.status;
    var st = String(stRaw == null || String(stRaw).trim() === '' ? 'recent' : stRaw).toLowerCase();
    if (st !== 'recent') return false;
    var role = x.role;
    if (role == null || role === '' || String(role).trim() === '') return true;
    return String(role).trim().toLowerCase() === 'original';
  }

  function normalizedListStatus(x) {
    if (!x || x.status == null) return '';
    return String(x.status).trim().toLowerCase();
  }

  function isOngoingCta(x) {
    if (!x) return false;
    if (String(x.ctaType || '').trim().toLowerCase() === 'update') return false;
    if (String(x.role || '').trim().toLowerCase() === 'update') return false;
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
        // Important: skip hidden/archived rows before slug de-dupe.
        // Otherwise a hidden duplicate can claim the slug and hide the visible CTA.
        if (isHiddenCta(item)) return;
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
    return out
      .sort(function (a, b) {
        // "recent"/"ongoing" lists are by most recently made CTA.
        return ctaCreatedEpoch(b) - ctaCreatedEpoch(a);
      });
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
