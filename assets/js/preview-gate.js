/**
 * Redirects to coming-soon.html when preview mode is on and user has not logged in.
 * Depends on hfa-preview-settings.js (load before this file).
 */
(function () {
  'use strict';
  var pass = typeof window !== 'undefined' && window.HFA_PREVIEW_PASSPHRASE;
  if (!pass || typeof pass !== 'string' || !pass.trim()) return;

  var pathname = location.pathname || '';
  var low = pathname.toLowerCase();
  if (low.indexOf('coming-soon') !== -1) return;
  if (low.indexOf('404.html') !== -1) return;

  var ok = false;
  try {
    ok = sessionStorage.getItem('hfa_preview_ok') === '1';
  } catch (e) {
    ok = false;
  }
  if (ok) return;

  function currentTarget() {
    var path = pathname.replace(/\/+$/, '');
    var seg = path.split('/').pop() || '';
    if (!seg || seg.indexOf('.') === -1) seg = 'index.html';
    return seg + (location.search || '');
  }

  location.replace('coming-soon.html?return=' + encodeURIComponent(currentTarget()));
})();
