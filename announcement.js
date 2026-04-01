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
    return 'recent.html';
  }

  // Resolve data/links.json: optional HFA_SITE.githubRawDataBase (see hfa-site-config.js), else same-dir as page.
  function getLinksJsonUrl() {
    if (typeof window.hfaDataJsonUrl === 'function') return window.hfaDataJsonUrl('data/links.json');
    var p = window.location.pathname || '/';
    var base = p.slice(0, p.lastIndexOf('/') + 1) + 'data/links.json';
    var sep = base.indexOf('?') === -1 ? '?' : '&';
    return base + sep + 'cb=' + Date.now();
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
      var raw = [];
      if (Array.isArray(json.links)) raw = raw.concat(json.links);
      if (Array.isArray(json.sections)) {
        json.sections.forEach(function(s) {
          if (s && Array.isArray(s.links)) raw = raw.concat(s.links);
        });
      }
      if (!raw.length) return;

      function isArchivedCta(item) {
        return !!(item && item.archived === true);
      }
      function parseEpoch(r) {
        var n = Date.parse(String(r || '').trim());
        return Number.isFinite(n) && n > 0 ? n : 0;
      }
      function slugTailYmdEpoch(slug) {
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
      function isUpdateLikeRow(x) {
        if (!x) return false;
        var type = String(x.ctaType || '').trim().toLowerCase();
        var role = String(x.role || '').trim().toLowerCase();
        var status = String(x.status || '').trim().toLowerCase();
        return type === 'update' || role === 'update' || status === 'updated';
      }
      /** Updates: backdated story date vs save. Originals: max({@code createdAt}, slug {@code -YYYYMMDD} tail). */
      function feedRecencyEpoch(item) {
        if (!item) return 0;
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
        var base = parseEpoch(item.createdAt) || parseEpoch(item.updatedAt);
        var slugE = slugTailYmdEpoch(item.slug);
        return slugE > base ? slugE : base;
      }
      var bySlug = Object.create(null);
      var noSlug = [];
      raw.forEach(function(item) {
        if (!item) return;
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
        var fi = feedRecencyEpoch(item);
        var fc = feedRecencyEpoch(cur);
        if (fi > fc) {
          bySlug[sl] = item;
        } else if (fi === fc && cur.hidden === true && item.hidden !== true) {
          bySlug[sl] = item;
        }
      });
      var links = Object.keys(bySlug).map(function(k) { return bySlug[k]; }).concat(noSlug);

      // Banner = highest feed recency (archived excluded). Use true latest row for ordering; if it is
      // hidden, still show it but without a link (see inner below). Skipping hidden rows here surfaced
      // the next visible CTA — often a backdated update — while a newer row was hidden.
      var pool = links.filter(function(x) { return !isArchivedCta(x); });
      var sorted = pool.slice().sort(function(a, b) { return feedRecencyEpoch(b) - feedRecencyEpoch(a); });
      var latest = sorted[0];
      if (!latest) return;
      var title = (latest.title || latest.slug || 'Latest CTA').trim();
      if (!title) return;

      var slug = (latest.slug || '').trim();
      var url = (latest.shortlinkUrl || '').trim();
      // If old data has a non-tracker "shortlinkUrl", normalize it.
      if (!url || (slug && url.indexOf(TRACKER_BASE + '/') !== 0)) {
        url = trackedUrlFromSlug(slug);
      }
      if (!url) url = getPageForStatus(latest.status || '');

      var tag = (latest.tag || '').toString().toLowerCase();
      var isEmail = latest.ctaType === 'email' || (String(latest.ctaType || '') === 'update' && latest.updateIncludeEmail) || tag.indexOf('email') !== -1;
      var annAttrs = isEmail ? '' : ' target="_blank" rel="noopener noreferrer"';

      var nonEmailLabel = String(latest.nonEmailActionText || latest.actionText || '').trim();
      if (!nonEmailLabel) nonEmailLabel = 'Take action';
      var actionText = isEmail ? 'Send the one-click email' : nonEmailLabel;
      var text = latest.hidden === true
        ? ('Latest: ' + title)
        : ('Latest: ' + title + ' — ' + actionText);
      var inner = latest.hidden === true
        ? '<span style="color:inherit;">' + esc(text) + '</span>'
        : '<a href="' + esc(url) + '" style="color:inherit; text-decoration:none;"' + annAttrs + '>' + esc(text) + '</a>';
      root.innerHTML = '<div class="announcement-bar">' + inner + '</div>';
    })
    .catch(function() {});
})();

/**
 * Footer social: href="instagram.com/..." resolves on the live site as /instagram.com/... on your domain.
 * Fix same-origin mistake and missing-scheme URLs on .footer-social-a only.
 */
(function() {
  var tld = '(?:com|org|net|io|co|edu|gov|uk|me|tv|fm|app|dev|ai|gg|be|us|ca)';
  var pathLooksLikeExternal = new RegExp(
    '^\\/([a-z0-9][a-z0-9-]*(?:\\.[a-z0-9-]+)*\\.' + tld + ')(?:\\/.*)?$',
    'i'
  );

  function fixFooterSocialAnchors() {
    document.querySelectorAll('a.footer-social-a[href]').forEach(function(a) {
      var raw = (a.getAttribute('href') || '').trim();
      if (!raw) return;
      try {
        var abs = new URL(raw, window.location.href);
        if (abs.origin === window.location.origin) {
          var m = abs.pathname.match(pathLooksLikeExternal);
          if (m) {
            a.setAttribute('href', 'https://' + abs.pathname.replace(/^\//, ''));
            return;
          }
        }
      } catch (e) { /* ignore */ }
      if (!/^(https?:|\/\/|mailto:|tel:|#)/i.test(raw)) {
        a.setAttribute('href', 'https://' + raw.replace(/^\/+/, ''));
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fixFooterSocialAnchors);
  } else {
    fixFooterSocialAnchors();
  }
})();

/**
 * Live footer stats: elements with data-live-stat="email_sends" get total from CTA tracker
 * (baseline + mailto redirects logged on go.hallieforanimals.org/t/...).
 */
(function() {
  function fmt(n) {
    try {
      return Number(n).toLocaleString('en-US');
    } catch (e) {
      return String(n);
    }
  }
  var els = document.querySelectorAll('[data-live-stat="email_sends"]');
  if (!els.length) return;
  var site = window.HFA_SITE || {};
  var base = (site.ctaTrackerOrigin || 'https://go.hallieforanimals.org').replace(/\/+$/, '');
  var url = base + '/api/email-sends-total';
  fetch(url, { cache: 'no-store', credentials: 'omit', mode: 'cors' })
    .then(function(r) { return r.ok ? r.json() : Promise.reject(new Error(String(r.status))); })
    .then(function(j) {
      if (!j || typeof j.total !== 'number') return;
      var t = fmt(j.total);
      els.forEach(function(el) { el.textContent = t; });
    })
    .catch(function() {});
})();

/**
 * Back-to-top control + WhatsApp channel join popup.
 * Replaces the old newsletter modal. Uses the same dismiss/snooze localStorage pattern.
 */
(function () {
  var STORAGE_DISMISS_UNTIL = 'hfa_wa_dismiss_until';
  var STORAGE_JOINED = 'hfa_wa_joined';

  function prefersReducedMotion() {
    try {
      return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) {
      return false;
    }
  }

  function shouldOffer() {
    try {
      if (localStorage.getItem(STORAGE_JOINED) === '1') return false;
      var until = localStorage.getItem(STORAGE_DISMISS_UNTIL);
      if (until && Date.now() < parseInt(until, 10)) return false;
    } catch (e) { /* private mode */ }
    return true;
  }

  function snoozeForDays(days) {
    try {
      localStorage.setItem(STORAGE_DISMISS_UNTIL, String(Date.now() + days * 86400000));
    } catch (e) { /* ignore */ }
  }

  function markJoined() {
    try {
      localStorage.setItem(STORAGE_JOINED, '1');
    } catch (e) { /* ignore */ }
  }

  var WA_ICON_SVG =
    '<svg viewBox="0 0 32 32" width="28" height="28" fill="currentColor" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M19.07 17.18c-.15-.08-.86-.42-1-.47-.14-.05-.23-.08-.33.08-.1.15-.38.47-.47.57-.09.1-.17.11-.32.03-.15-.08-.64-.23-1.22-.75-.45-.4-.75-.9-.83-1.05-.09-.15-.01-.23.07-.31.07-.07.17-.2.26-.3.09-.1.1-.18.15-.28.05-.1.02-.2-.01-.27-.03-.07-.32-.8-.43-1.1-.11-.29-.22-.25-.32-.25h-.27c-.09 0-.24.03-.37.18-.13.15-.5.48-.5 1.17 0 .7.51 1.37.58 1.47.07.1.99 1.51 2.4 2.12.34.14.6.22.81.29.34.11.65.1.9.06.28-.04.86-.35.99-.69.13-.34.13-.63.09-.69-.04-.07-.14-.11-.29-.19z"/>' +
      '<path d="M16 3c-7.18 0-13 5.82-13 13 0 2.29.6 4.52 1.74 6.48L3 28l5.69-1.67A12.92 12.92 0 0 0 16 29c7.18 0 13-5.82 13-13S23.18 3 16 3zm0 24.08c-2.07 0-4.1-.56-5.86-1.63l-.42-.25-3.1.91.93-3.02-.27-.44A10.98 10.98 0 0 1 5.05 16C5.05 9.97 9.97 5.05 16 5.05S26.95 9.97 26.95 16 22.03 27.08 16 27.08z"/>' +
      '<path d="M20.45 18.62c-.25-.13-1.47-.72-1.7-.81-.23-.09-.4-.13-.57.13-.17.26-.67.82-.82.99-.15.17-.3.2-.55.07-.26-.13-1.11-.41-2.11-1.27-.78-.68-1.3-1.52-1.44-1.78-.14-.26-.02-.4.1-.52.11-.11.25-.3.38-.45.13-.15.17-.25.25-.4.08-.15.04-.29-.02-.41-.06-.12-.55-1.33-.75-1.82-.2-.49-.4-.42-.55-.42h-.47c-.15 0-.39.06-.6.29-.2.24-.79.77-.79 1.88s.81 2.18.92 2.33c.11.15 1.52 2.32 3.69 3.2.52.21.93.34 1.25.44.52.16 1 .14 1.38.09.38-.06 1.23-.5 1.41-.98.18-.48.18-.9.13-.99-.05-.1-.2-.16-.45-.29z"/>' +
    '</svg>';

  function run() {
    if (!document.body) return;

    /* —— Back to top —— */
    var topBtn = document.createElement('button');
    topBtn.type = 'button';
    topBtn.className = 'hfa-back-to-top';
    topBtn.setAttribute('aria-label', 'Back to top');
    topBtn.innerHTML = '<span class="hfa-back-to-top-icon" aria-hidden="true">↑</span><span class="hfa-back-to-top-text">Top</span>';
    topBtn.hidden = true;
    document.body.appendChild(topBtn);

    function syncBackToTop() {
      var y = window.scrollY || document.documentElement.scrollTop || 0;
      var show = y > 360;
      topBtn.hidden = !show;
      topBtn.setAttribute('aria-hidden', show ? 'false' : 'true');
    }

    var scrollTicking = false;
    window.addEventListener(
      'scroll',
      function () {
        if (!scrollTicking) {
          scrollTicking = true;
          requestAnimationFrame(function () {
            syncBackToTop();
            scrollTicking = false;
          });
        }
      },
      { passive: true }
    );
    syncBackToTop();

    topBtn.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      topBtn.blur();
    });

    /* —— WhatsApp channel join popup —— */
    var waUrl = window.HFA_SITE && window.HFA_SITE.whatsappChannelUrl
      ? String(window.HFA_SITE.whatsappChannelUrl).trim() : '';
    if (!waUrl || !shouldOffer()) return;

    var overlay = document.createElement('div');
    overlay.className = 'hfa-newsletter-overlay';
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');

    var modal = document.createElement('div');
    modal.className = 'hfa-newsletter-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'hfa-wa-popup-title');
    modal.hidden = true;

    modal.innerHTML =
      '<button type="button" class="hfa-newsletter-x" aria-label="Close">&times;</button>' +
      '<div class="hfa-wa-popup-icon" aria-hidden="true">' + WA_ICON_SVG + '</div>' +
      '<h2 id="hfa-wa-popup-title" class="hfa-newsletter-title">Join our WhatsApp</h2>' +
      '<p class="hfa-newsletter-lede">Get campaign updates and calls to action delivered straight to your phone.</p>' +
      '<a class="btn hfa-wa-popup-join" href="' + waUrl.replace(/"/g, '&quot;') + '" target="_blank" rel="noopener noreferrer">Join the channel</a>' +
      '<p class="hfa-newsletter-later"><button type="button" class="hfa-newsletter-text-btn">Maybe later</button></p>';

    document.body.appendChild(overlay);
    document.body.appendChild(modal);

    var joinBtn = modal.querySelector('.hfa-wa-popup-join');
    var btnX = modal.querySelector('.hfa-newsletter-x');
    var btnLater = modal.querySelector('.hfa-newsletter-text-btn');
    var lastFocus = null;
    var offered = false;

    function trapTab(e) {
      if (e.key !== 'Tab') return;
      var nodes = modal.querySelectorAll('button:not([disabled]), [href]');
      var list = Array.prototype.slice.call(nodes).filter(function (n) {
        return n.offsetParent !== null;
      });
      if (!list.length) return;
      var first = list[0];
      var last = list[list.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }

    function openModal() {
      if (offered) return;
      offered = true;
      lastFocus = document.activeElement;
      overlay.hidden = false;
      modal.hidden = false;
      overlay.setAttribute('aria-hidden', 'false');
      document.body.classList.add('hfa-newsletter-open');
      window.setTimeout(function () {
        if (joinBtn) joinBtn.focus();
      }, 50);
      modal.addEventListener('keydown', onModalKeydown);
    }

    function onModalKeydown(e) {
      if (e.key === 'Escape') { e.preventDefault(); closeModal(3); return; }
      trapTab(e);
    }

    function closeModal(snoozeDays) {
      modal.removeEventListener('keydown', onModalKeydown);
      overlay.hidden = true;
      modal.hidden = true;
      overlay.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('hfa-newsletter-open');
      if (typeof snoozeDays === 'number') snoozeForDays(snoozeDays);
      if (lastFocus && typeof lastFocus.focus === 'function') {
        try { lastFocus.focus(); } catch (e2) { /* ignore */ }
      }
    }

    function scheduleOffer() {
      var done = false;
      function fire() {
        if (done) return;
        done = true;
        openModal();
      }
      window.setTimeout(fire, 14000);
      window.addEventListener(
        'scroll',
        function onScroll() {
          var doc = document.documentElement;
          var max = (doc.scrollHeight || 0) - (doc.clientHeight || 0);
          if (max <= 0) return;
          if ((window.scrollY || 0) / max >= 0.28) {
            window.removeEventListener('scroll', onScroll);
            fire();
          }
        },
        { passive: true }
      );
    }

    scheduleOffer();

    overlay.addEventListener('click', function () { closeModal(3); });
    btnX.addEventListener('click', function () { closeModal(3); });
    btnLater.addEventListener('click', function () { snoozeForDays(14); closeModal(); });

    joinBtn.addEventListener('click', function () {
      markJoined();
      closeModal();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();

/**
 * Share helpers + page-level share button.
 * CTA share buttons (rendered from JSON) call window.hfaShareUrl().
 */
(function () {
  function showToast(message) {
    var existing = document.querySelector('.hfa-share-toast');
    if (existing) existing.remove();
    var toast = document.createElement('div');
    toast.className = 'hfa-share-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    window.setTimeout(function () {
      try { toast.remove(); } catch (e) { /* ignore */ }
    }, 2200);
  }

  function shareUrl(url, title, text) {
    var u = String(url || window.location.href || '').trim();
    var t = String(title || document.title || 'HallieForAnimals').trim();
    var x = String(text || 'Take action for animals.').trim();

    if (!u) return;

    if (navigator && typeof navigator.share === 'function') {
      try {
        navigator.share({ title: t, text: x, url: u }).catch(function () { /* user cancelled */ });
        return;
      } catch (e) { /* fall back */ }
    }

    if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(u).then(function () {
        showToast('Link copied.');
      }).catch(function () {
        showToast('Share URL ready. Copy it from the address bar.');
        window.prompt('Copy this link:', u);
      });
      return;
    }

    window.prompt('Copy this link:', u);
  }

  window.hfaShareUrl = shareUrl;

  function injectPageShareButton() {
    if (document.getElementById('hfa-page-share-btn')) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'hfa-page-share-btn';
    btn.className = 'hfa-page-share-btn';
    btn.setAttribute('aria-label', 'Share this page');
    btn.innerHTML =
      '<img class="hfa-page-share-icon-img" src="assets/img/hfa-share-icon.png" alt="" aria-hidden="true" />' +
      '<span>Share</span>';
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var clean = window.location.href ? String(window.location.href).split('#')[0] : '';
      shareUrl(clean, document.title, 'Take action for animals.');
    });
    document.body.appendChild(btn);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectPageShareButton);
  } else {
    injectPageShareButton();
  }
})();

/**
 * WhatsApp join button (optional).
 * Configure `whatsappChannelUrl` in `assets/js/hfa-site-config.js`.
 */
(function () {
  function inject() {
    var url = window.HFA_SITE && window.HFA_SITE.whatsappChannelUrl ? String(window.HFA_SITE.whatsappChannelUrl).trim() : '';
    if (!url) return;
    if (document.getElementById('hfa-whatsapp-join-btn')) return;

    var label = window.HFA_SITE && window.HFA_SITE.whatsappChannelLabel
      ? String(window.HFA_SITE.whatsappChannelLabel).trim()
      : 'Join the HallieForAnimals WhatsApp';

    var btn = document.createElement('a');
    btn.id = 'hfa-whatsapp-join-btn';
    btn.href = url;
    btn.target = '_blank';
    btn.rel = 'noopener noreferrer';
    btn.className = 'hfa-whatsapp-join-btn';
    btn.innerHTML =
      '<span class="hfa-whatsapp-join-icon" aria-hidden="true">' +
        '<svg viewBox="0 0 32 32" width="22" height="22" fill="currentColor" xmlns="http://www.w3.org/2000/svg">' +
          '<path d="M19.07 17.18c-.15-.08-.86-.42-1-.47-.14-.05-.23-.08-.33.08-.1.15-.38.47-.47.57-.09.1-.17.11-.32.03-.15-.08-.64-.23-1.22-.75-.45-.4-.75-.9-.83-1.05-.09-.15-.01-.23.07-.31.07-.07.17-.2.26-.3.09-.1.1-.18.15-.28.05-.1.02-.2-.01-.27-.03-.07-.32-.8-.43-1.1-.11-.29-.22-.25-.32-.25h-.27c-.09 0-.24.03-.37.18-.13.15-.5.48-.5 1.17 0 .7.51 1.37.58 1.47.07.1.99 1.51 2.4 2.12.34.14.6.22.81.29.34.11.65.1.9.06.28-.04.86-.35.99-.69.13-.34.13-.63.09-.69-.04-.07-.14-.11-.29-.19z"/>' +
          '<path d="M16 3c-7.18 0-13 5.82-13 13 0 2.29.6 4.52 1.74 6.48L3 28l5.69-1.67A12.92 12.92 0 0 0 16 29c7.18 0 13-5.82 13-13S23.18 3 16 3zm0 24.08c-2.07 0-4.1-.56-5.86-1.63l-.42-.25-3.1.91.93-3.02-.27-.44A10.98 10.98 0 0 1 5.05 16C5.05 9.97 9.97 5.05 16 5.05S26.95 9.97 26.95 16 22.03 27.08 16 27.08z"/>' +
          '<path d="M20.45 18.62c-.25-.13-1.47-.72-1.7-.81-.23-.09-.4-.13-.57.13-.17.26-.67.82-.82.99-.15.17-.3.2-.55.07-.26-.13-1.11-.41-2.11-1.27-.78-.68-1.3-1.52-1.44-1.78-.14-.26-.02-.4.1-.52.11-.11.25-.3.38-.45.13-.15.17-.25.25-.4.08-.15.04-.29-.02-.41-.06-.12-.55-1.33-.75-1.82-.2-.49-.4-.42-.55-.42h-.47c-.15 0-.39.06-.6.29-.2.24-.79.77-.79 1.88s.81 2.18.92 2.33c.11.15 1.52 2.32 3.69 3.2.52.21.93.34 1.25.44.52.16 1 .14 1.38.09.38-.06 1.23-.5 1.41-.98.18-.48.18-.9.13-.99-.05-.1-.2-.16-.45-.29z"/>' +
        '</svg>' +
      '</span>' +
      '<span>' + label + '</span>';
    btn.addEventListener('click', function () {
      try { localStorage.setItem('hfa_wa_joined', '1'); } catch (e) { /* ignore */ }
    });
    document.body.appendChild(btn);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
