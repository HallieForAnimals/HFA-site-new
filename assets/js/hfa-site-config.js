/**
 * Public site + Turnstile site key (safe to expose in HTML).
 * Override before loading hfa-submissions.js if needed.
 */
(function () {
  function trimSlash(s) {
    return String(s || '').trim().replace(/\/+$/, '');
  }

  var defaults = {
    /**
     * Raw GitHub base for `/data/*.json` (and `hfaDataJsonUrl`). Empty = same folder as the HTML page (production).
     * Default on localhost / 127.0.0.1 / file open: main branch on GitHub so a local mirror tracks the repo.
     * Override with '' on localhost if you want only local files.
     */
    githubRawDataBase: (function () {
      try {
        var h = window.location.hostname;
        if (h === 'localhost' || h === '127.0.0.1' || h === '') {
          return 'https://raw.githubusercontent.com/HallieForAnimals/HFA-site-new/main';
        }
      } catch (e) { /* ignore */ }
      return '';
    })(),

    submissionsEndpoint: 'https://hfa-submissions-proxy.hallieforanimals.workers.dev/',
    /** Cloudflare Turnstile widget key (must pair with TURNSTILE_SECRET on the Worker). */
    turnstileSiteKey: '0x4AAAAAAB-QUsgpCF_PFhLt',
    /** CTA shortlink worker (live footer stat: GET /api/email-sends-total). No trailing slash. */
    ctaTrackerOrigin: 'https://go.hallieforanimals.org',

    /** Optional WhatsApp channel invite URL for the “Join WhatsApp” button. */
    whatsappChannelUrl: 'https://whatsapp.com/channel/0029Vb6qgaCJ93wbiTUoxf1O',
    whatsappChannelLabel: 'Join the HallieForAnimals WhatsApp',

    /**
     * Stripe donation checkout (public URL only).
     * Create a Payment Link in Stripe Dashboard (Products → Payment links), or a similar donate URL.
     * Safe to ship in this file. Never put secret keys (sk_live_…), webhook secrets, or restricted keys here.
     */
    stripeDonationUrl: 'https://donate.stripe.com/4gM6oJbcgcE54XK2ie7bW00',

    /**
     * Optional: Stripe Pricing Table (monthly tiers on one widget). Dashboard → Product catalog → Pricing tables.
     * publishable-key = pk_live_… or pk_test_… only (safe in this file). Never sk_… here.
     */
    stripePricingTableId: 'prctbl_1TDa2xQuuTvgE9aYwzNfiFqG',
    stripePublishableKey: 'pk_live_51T6LtvQuuTvgE9aYsnKjfgq2PMLaqFcfyNiiPpAvDE4Bp1gsD8TJjWi1RLGVEVvaa24ALn8YXbEsK3pjgX4lLYjL0034OJDmwC',

    /**
     * Google Analytics 4 Measurement ID (e.g. "G-XXXXXXXXXX").
     * Set to '' or omit to disable. Get yours from:
     * https://analytics.google.com → Admin → Data Streams → Web → Measurement ID
     */
    ga4MeasurementId: '',

    /**
     * Self-hosted beacon: POST page-view data to the CTA tracker worker.
     * Set to true to send lightweight pings (page, referrer, viewport, timestamp)
     * to /api/beacon on ctaTrackerOrigin. No cookies, no external scripts.
     */
    selfHostedBeacon: true
  };
  var s = (window.HFA_SITE = window.HFA_SITE || {});
  Object.keys(defaults).forEach(function (k) {
    if (s[k] === undefined) s[k] = defaults[k];
  });

  /** Resolve `data/links.json` etc.: remote base if set, else same-directory-relative to the page. */
  window.hfaDataJsonUrl = function (relPath) {
    relPath = String(relPath || '').replace(/^\/+/, '');
    var raw = trimSlash(window.HFA_SITE && window.HFA_SITE.githubRawDataBase);
    if (raw) return raw + '/' + relPath + '?ts=' + Date.now();
    var p = window.location.pathname || '/';
    var base = p.slice(0, p.lastIndexOf('/') + 1) + relPath;
    // Same-origin still needs a cache-buster: some CDNs edge-cache JSON despite fetch(..., { cache: 'no-store' }).
    var sep = base.indexOf('?') === -1 ? '?' : '&';
    return base + sep + 'cb=' + Date.now();
  };

  /** Base for JSON + repo-relative image paths on In Memoriam / Rescues (fallback = public main branch). */
  window.hfaGithubRawBase = function () {
    var c = trimSlash(window.HFA_SITE && window.HFA_SITE.githubRawDataBase);
    if (c) return c;
    return 'https://raw.githubusercontent.com/HallieForAnimals/HFA-site-new/main';
  };
  document.addEventListener('DOMContentLoaded', function () {
    var el = document.getElementById('email-counter-number');
    if (el) {
      var origin = trimSlash(s.ctaTrackerOrigin) || 'https://go.hallieforanimals.org';
      fetch(origin + '/api/email-sends-total')
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (d && d.total != null) el.textContent = Number(d.total).toLocaleString();
        })
        .catch(function () {});
    }

    var ga4 = s.ga4MeasurementId;
    if (ga4 && typeof ga4 === 'string' && ga4.trim()) {
      var gScript = document.createElement('script');
      gScript.async = true;
      gScript.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(ga4.trim());
      document.head.appendChild(gScript);
      window.dataLayer = window.dataLayer || [];
      function gtag() { window.dataLayer.push(arguments); }
      gtag('js', new Date());
      gtag('config', ga4.trim(), { send_page_view: true });
    }

    (function loadAds() {
      try {
        var rawPage = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
        var page = rawPage || 'index.html';
        var pageBase = page.replace(/\.html$/i, '');
        fetch(window.hfaDataJsonUrl('data/ads.json'))
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (data) {
            if (!data || !data.enabled || !Array.isArray(data.placements)) return;
            var eligible = data.placements.filter(function (ad) {
              if (!ad.active) return false;
              function pageMatch(entry) {
                var e = entry.toLowerCase().replace(/\.html$/i, '');
                return e === pageBase || entry.toLowerCase() === page;
              }
              if (ad.excludePages && ad.excludePages.length) {
                if (ad.excludePages.some(pageMatch)) return false;
              }
              if (ad.pages && ad.pages.length) {
                return ad.pages.some(pageMatch);
              }
              return true;
            });
            if (!eligible.length) return;
            var rawBase = (window.hfaGithubRawBase ? window.hfaGithubRawBase() : '');
            function resolveImg(src) {
              if (!src) return '';
              if (/^https?:\/\//i.test(src)) return src;
              return (rawBase ? rawBase + '/' : '') + src.replace(/^\/+/, '');
            }
            function esc(s) {
              var d = document.createElement('div');
              d.textContent = String(s || '');
              return d.innerHTML;
            }
            function safeUrl(u) {
              u = String(u || '').trim();
              if (/^https?:\/\//i.test(u)) return u;
              return '#';
            }
            function buildAdHtml(ad) {
              var lbl = esc(ad.label || data.label || 'Sponsored');
              var img = resolveImg(ad.image);
              var h = '<p class="hfa-ad-label">' + lbl + '</p>';
              h += '<a href="' + safeUrl(ad.url) + '" target="_blank" rel="sponsored noopener" class="hfa-ad-link">';
              if (img) h += '<img src="' + esc(img) + '" alt="' + esc(ad.alt || ad.sponsor || '') + '" class="hfa-ad-img">';
              if (ad.sponsor) h += '<span class="hfa-ad-sponsor">' + esc(ad.sponsor) + '</span>';
              h += '</a>';
              return h;
            }

            var sidebars = eligible.filter(function (a) { return a.position === 'sidebar'; });
            var banners  = eligible.filter(function (a) { return a.position !== 'sidebar'; });

            if (sidebars.length) {
              var leftAd  = sidebars[Math.floor(Math.random() * sidebars.length)];
              var rightAd = sidebars.length > 1
                ? sidebars.filter(function (a) { return a !== leftAd; })[Math.floor(Math.random() * (sidebars.length - 1))]
                : leftAd;
              var left = document.createElement('aside');
              left.className = 'hfa-ad-rail hfa-ad-rail--left';
              left.setAttribute('aria-label', (leftAd.label || data.label || 'Sponsored'));
              left.innerHTML = buildAdHtml(leftAd);
              document.body.appendChild(left);
              var right = document.createElement('aside');
              right.className = 'hfa-ad-rail hfa-ad-rail--right';
              right.setAttribute('aria-label', (rightAd.label || data.label || 'Sponsored'));
              right.innerHTML = buildAdHtml(rightAd);
              document.body.appendChild(right);
            }

            if (banners.length) {
              var chosen = banners[Math.floor(Math.random() * banners.length)];
              var container = document.createElement('aside');
              container.className = 'hfa-ad-slot';
              container.setAttribute('aria-label', (chosen.label || data.label || 'Sponsored'));
              container.innerHTML = buildAdHtml(chosen);
              var footer = document.querySelector('footer');
              if (footer && footer.parentNode) {
                footer.parentNode.insertBefore(container, footer);
              } else {
                document.body.appendChild(container);
              }
            }
          })
          .catch(function () {});
      } catch (e) { /* ignore */ }
    })();

    if (s.selfHostedBeacon) {
      try {
        var bOrigin = trimSlash(s.ctaTrackerOrigin) || 'https://go.hallieforanimals.org';
        var payload = JSON.stringify({
          p: location.pathname,
          r: document.referrer || '',
          w: window.innerWidth,
          h: window.innerHeight,
          l: navigator.language || '',
          t: Date.now()
        });
        if (navigator.sendBeacon) {
          navigator.sendBeacon(bOrigin + '/api/beacon', payload);
        } else {
          fetch(bOrigin + '/api/beacon', { method: 'POST', body: payload, keepalive: true }).catch(function () {});
        }
      } catch (e) { /* ignore */ }
    }
  });
})();
