/**
 * Single source for which CTAs appear on Recent / Ongoing / home list.
 * `archived` excludes a row entirely; `hidden` keeps the card but callers omit the primary CTA button.
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

  /** Fully excluded from site lists (not shown as a card). */
  function isArchivedCta(item) {
    return !!(item && item.archived === true);
  }

  /** "Hide on site" in Hallie: card stays visible; primary CTA button is omitted. */
  function hidePrimaryCtaButton(item) {
    return !!(item && item.hidden === true);
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

  function isUpdateCta(x) {
    if (!x) return false;
    var ctaType = String(x.ctaType || '').trim().toLowerCase();
    var roleNorm = String(x.role || '').trim().toLowerCase();
    var statusNorm = String(x.status || '').trim().toLowerCase();
    return ctaType === 'update' || roleNorm === 'update' || statusNorm === 'updated';
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
    var candidates = [];
    function consider(list) {
      if (!Array.isArray(list)) return;
      list.forEach(function (item) {
        if (!item || !predicate(item) || isArchivedCta(item)) return;
        candidates.push(item);
      });
    }
    if (Array.isArray(json.links)) consider(json.links);
    consider(sectionLinksNamed(json, sectionNeedle));
    var bySlug = Object.create(null);
    var noSlug = [];
    candidates.forEach(function (item) {
      var sl = String(item.slug || '').trim().toLowerCase();
      if (!sl) {
        noSlug.push(item);
        return;
      }
      var cur = bySlug[sl];
      if (!cur) {
        bySlug[sl] = item;
        return;
      }
      if (cur.hidden === true && item.hidden !== true) {
        bySlug[sl] = item;
      }
    });
    var out = Object.keys(bySlug)
      .map(function (k) {
        return bySlug[k];
      })
      .concat(noSlug);
    return out.sort(function (a, b) {
      return ctaCreatedEpoch(b) - ctaCreatedEpoch(a);
    });
  }

  function hfaCollectRecentCtas(json) {
    return collectMerged(json || {}, isRecentOriginalCta, 'recent');
  }

  function hfaCollectOngoingCtas(json) {
    return collectMerged(json || {}, isOngoingCta, 'ongoing');
  }

  function hfaCollectUpdateCtas(json) {
    var list = Array.isArray(json && json.links) ? json.links : [];
    var candidates = [];
    list.forEach(function (item) {
      if (!item || !isUpdateCta(item) || isArchivedCta(item)) return;
      candidates.push(item);
    });
    var bySlug = Object.create(null);
    candidates.forEach(function (item) {
      var sl = String(item.slug || '').trim().toLowerCase();
      if (!sl) return;
      var cur = bySlug[sl];
      if (!cur) {
        bySlug[sl] = item;
        return;
      }
      if (cur.hidden === true && item.hidden !== true) {
        bySlug[sl] = item;
      }
    });
    var out = Object.keys(bySlug).map(function (k) {
      return bySlug[k];
    });
    function updateRowEpoch(x) {
      var ud = String(x && x.updateDate || '').trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(ud)) {
        var t = Date.parse(ud.slice(0, 10) + 'T12:00:00');
        if (Number.isFinite(t) && t > 0) return t;
      }
      return parseEpoch(x.updatedAt) || parseEpoch(x.createdAt) || parseEpoch(x.updateDate);
    }
    return out.sort(function (a, b) {
      return updateRowEpoch(b) - updateRowEpoch(a);
    });
  }

  global.hfaCollectRecentCtas = hfaCollectRecentCtas;
  global.hfaCollectOngoingCtas = hfaCollectOngoingCtas;
  global.hfaCollectUpdateCtas = hfaCollectUpdateCtas;
  global.hfaIsUpdateCta = isUpdateCta;
  global.hfaHidePrimaryCtaButton = hidePrimaryCtaButton;
  global.hfaIsArchivedCta = isArchivedCta;
})(typeof window !== 'undefined' ? window : globalThis);
