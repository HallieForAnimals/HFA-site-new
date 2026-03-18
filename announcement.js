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

  fetch('data/links.json', { cache: 'no-store' })
    .then(function(r) { return r.ok ? r.json() : Promise.reject(); })
    .then(function(json) {
      var links = Array.isArray(json.links) ? json.links : [];
      if (!links.length) return;

      var sorted = links.slice().sort(function(a, b) {
        var aAt = a.updatedAt || a.createdAt || '';
        var bAt = b.updatedAt || b.createdAt || '';
        return bAt.localeCompare(aAt);
      });
      var latest = sorted[0];
      var title = (latest.title || latest.slug || 'Latest CTA').trim();
      if (!title) return;

      var url = (latest.shortlinkUrl || '').trim();
      if (!url) url = getPageForStatus(latest.status || '');

      var text = 'Latest: ' + title + ' — Take action';
      var inner = '<a href="' + esc(url) + '" style="color:inherit; text-decoration:none;">' + esc(text) + '</a>';
      root.innerHTML = '<div class="announcement-bar">' + inner + '</div>';
    })
    .catch(function() {});
})();
