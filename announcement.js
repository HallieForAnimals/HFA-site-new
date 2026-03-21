/**
 * Announcement bar: shows the most recent CTA from data/links.json.
 */
(function() {
  var root = document.getElementById('announcement-root');
  if (!root) return;

  function esc(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function getPageForStatus(status) {
    if (status === 'ongoing') return 'ongoing.html';
    if (status === 'recent') return 'recent.html';
    if (status === 'updated') return 'updated.html';
    return 'cta.html';
  }

  // Resolve data/links.json from the current page so it works from any path (e.g. /HFA-site-new/recent.html).
  function getLinksJsonUrl() {
    var p = window.location.pathname || '/';
    var base = p.slice(0, p.lastIndexOf('/') + 1);
    return base + 'data/links.json';
  }

  // Keep in sync with hallie-app-new CTA builder.
  var TRACKER_BASE = 'https://go.hallieforanimals.org/t';
  function trackedUrlFromSlug(slug) {
    if (!slug) return '';
    return TRACKER_BASE + '/' + encodeURIComponent(String(slug).trim());
  }

  fetch(getLinksJsonUrl(), { cache: 'no-store' })
    .then(function(r) { return r.ok ? r.json() : Promise.reject(); })
    .then(function(json) {
      var links = [];
      // Support both:
      // 1) New format: { links: [...] } with status/role fields
      // 2) Old format: { sections: [{ name, links: [...] }, ...] } (Recent/Ongoing inferred from section name)
      if (Array.isArray(json.links)) {
        links = json.links;
      } else if (Array.isArray(json.sections)) {
        json.sections.forEach(function(s) {
          if (s && Array.isArray(s.links)) links = links.concat(s.links);
        });
      }
      if (!links.length) return;

      function isHiddenCta(item) {
        return !!(item && (item.hidden === true || item.archived === true));
      }

      var sorted = links.slice().sort(function(a, b) {
        var aAt = a.updatedAt || a.createdAt || '';
        var bAt = b.updatedAt || b.createdAt || '';
        return bAt.localeCompare(aAt);
      });
      var latest = sorted.filter(function(x) { return !isHiddenCta(x); })[0];
      var title = (latest.title || latest.slug || 'Latest CTA').trim();
      if (!title) return;

      var slug = (latest.slug || '').trim();
      var url = (latest.shortlinkUrl || '').trim();
      // If old data has a non-tracker "shortlinkUrl", normalize it.
      if (!url || (slug && url.indexOf(TRACKER_BASE + '/') !== 0)) {
        url = trackedUrlFromSlug(slug);
      }
      if (!url) url = getPageForStatus(latest.status || '');

      var text = 'Latest: ' + title + ' — Take action';
      var inner = '<a href="' + esc(url) + '" style="color:inherit; text-decoration:none;">' + esc(text) + '</a>';
      root.innerHTML = '<div class="announcement-bar">' + inner + '</div>';
    })
    .catch(function() {});
})();
