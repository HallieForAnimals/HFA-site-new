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
    selfHostedBeacon: true,

    /**
     * Optional JSON URL for ad audience targeting: must return { country_code or countryCode, region, city }.
     * When empty, the site uses ctaTrackerOrigin + /api/visitor-geo (Cloudflare edge country), then falls back to ipapi.co.
     */
    adAudienceGeoUrl: '',

    /**
     * When no geo URL resolves to a country, allow ipapi.co as fallback (after /api/visitor-geo when using defaults).
     * Set false to disable third-party ipapi (only custom adAudienceGeoUrl or CF geo will work).
     */
    adAudienceIpLookup: true
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
    var trackerOrigin = trimSlash(s.ctaTrackerOrigin) || 'https://go.hallieforanimals.org';
    function getSessionId() {
      try {
        var k = 'hfa_session_id';
        var v = localStorage.getItem(k);
        if (v) return v;
        v = 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
        localStorage.setItem(k, v);
        return v;
      } catch (_) {
        return 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
      }
    }
    var sessionId = getSessionId();
    function emit(path, payload) {
      try {
        var data = JSON.stringify(payload || {});
        if (navigator.sendBeacon) {
          navigator.sendBeacon(trackerOrigin + path, data);
        } else {
          fetch(trackerOrigin + path, { method: 'POST', body: data, keepalive: true }).catch(function () {});
        }
      } catch (_) {}
    }
    function emitAdEvent(eventType, adMeta, extra) {
      var meta = adMeta || {};
      emit('/api/ad-event', Object.assign({
        eventType: eventType,
        sessionId: sessionId,
        pagePath: location.pathname,
        adSlot: meta.slot || '',
        adId: meta.id || '',
        campaignId: meta.campaignId || '',
        url: meta.url || ''
      }, extra || {}));
    }
    function emitEngagement(eventType, valueNum) {
      emit('/api/engagement', {
        eventType: eventType,
        sessionId: sessionId,
        pagePath: location.pathname,
        valueNum: valueNum
      });
    }

    emitEngagement('session_start', 1);

    var el = document.getElementById('email-counter-number');
    if (el) {
      fetch(trackerOrigin + '/api/email-sends-total')
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

        /**
         * ISO 3166-1 alpha-2 sets for ad macro regions. Keys must match Hallie Command Center (audienceMacroRegions).
         * Regions overlap by design (e.g. France is in EU and western_europe); visitor needs one selected bucket only.
         */
        /** Valid macro keys (must match Hallie `HFA_AD_MACRO_REGIONS` / ads editor). */
        var HFA_AD_MACRO_KEYS = {
          uk: true,
          eu: true,
          usa_canada: true,
          central_america: true,
          caribbean: true,
          south_america: true,
          western_europe: true,
          eastern_europe: true,
          mena: true,
          sub_saharan_africa: true,
          asia: true,
          oceania: true
        };

        var HFA_MACRO_REGION_COUNTRIES = {
          uk: ['GB'],
          eu: ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'],
          usa_canada: ['US', 'CA'],
          central_america: ['MX', 'GT', 'HN', 'SV', 'NI', 'CR', 'PA', 'BZ'],
          caribbean: ['AG', 'AI', 'AW', 'BB', 'BM', 'BQ', 'BS', 'CU', 'CW', 'DM', 'DO', 'GD', 'GP', 'HT', 'JM', 'KN', 'KY', 'LC', 'MF', 'MQ', 'MS', 'PR', 'SX', 'TC', 'TT', 'VC', 'VG', 'VI'],
          south_america: ['AR', 'BO', 'BR', 'CL', 'CO', 'EC', 'FK', 'GF', 'GY', 'PE', 'PY', 'SR', 'UY', 'VE'],
          western_europe: ['AT', 'BE', 'CH', 'LI', 'DE', 'FR', 'NL', 'LU', 'MC', 'ES', 'PT', 'IT', 'IE', 'IS', 'NO', 'SE', 'DK', 'FI', 'SM', 'VA', 'AD', 'CY', 'MT', 'GR'],
          eastern_europe: ['PL', 'CZ', 'SK', 'HU', 'RO', 'BG', 'HR', 'SI', 'EE', 'LV', 'LT', 'UA', 'BY', 'MD', 'RS', 'BA', 'ME', 'MK', 'AL', 'RU', 'XK', 'GE'],
          mena: ['DZ', 'BH', 'EG', 'IR', 'IQ', 'IL', 'JO', 'KW', 'LB', 'LY', 'MA', 'OM', 'PS', 'QA', 'SA', 'SY', 'TN', 'AE', 'YE', 'TR', 'SD', 'SS', 'EH'],
          sub_saharan_africa: ['AO', 'BJ', 'BW', 'BF', 'BI', 'CV', 'CM', 'CF', 'TD', 'KM', 'CG', 'CD', 'CI', 'DJ', 'GQ', 'ER', 'SZ', 'ET', 'GA', 'GM', 'GH', 'GN', 'GW', 'KE', 'LS', 'LR', 'MG', 'MW', 'ML', 'MR', 'MU', 'MZ', 'NA', 'NE', 'NG', 'RW', 'ST', 'SN', 'SC', 'SL', 'SO', 'ZA', 'TZ', 'TG', 'UG', 'ZM', 'ZW'],
          asia: ['AF', 'AM', 'AZ', 'BD', 'BT', 'BN', 'KH', 'CN', 'HK', 'IN', 'ID', 'JP', 'KZ', 'KP', 'KR', 'KG', 'LA', 'MO', 'MY', 'MV', 'MN', 'MM', 'NP', 'PK', 'PH', 'SG', 'LK', 'TW', 'TJ', 'TH', 'TL', 'TM', 'UZ', 'VN'],
          oceania: ['AU', 'NZ', 'FJ', 'PG', 'SB', 'VU', 'NC', 'PF', 'WS', 'TO', 'KI', 'FM', 'MH', 'PW', 'NR', 'TV', 'GU', 'MP', 'AS', 'CK', 'NU', 'TK', 'WF', 'PN']
        };

        function normLoc(x) {
          return String(x || '').trim().toLowerCase();
        }

        function normalizePlacementSlotKey(k) {
          return String(k || '')
            .trim()
            .toLowerCase()
            .replace(/-/g, '_')
            .replace(/\s+/g, '_');
        }

        /** Merge camelCase + snake_case arrays so an empty `placementSlots: []` does not hide `placement_slots`. */
        function mergeAdsJsonStringArrays(a, b) {
          var out = [];
          var seen = {};
          function add(arr) {
            if (!Array.isArray(arr)) return;
            for (var i = 0; i < arr.length; i++) {
              var s = String(arr[i] || '').trim();
              if (!s || seen[s]) continue;
              seen[s] = true;
              out.push(arr[i]);
            }
          }
          add(a);
          add(b);
          return out;
        }

        function normalizeVisitorCountryCode(c) {
          var x = String(c || '').trim().toUpperCase();
          if (x === 'UK') return 'GB';
          if (x.length === 2) return x;
          return '';
        }

        /**
         * Align runtime parsing with Hallie `normalizeSiteDataAds`: fixes hand-edited JSON,
         * hyphenated slot keys, and ensures macro keys are valid (so EU targeting actually runs).
         */
        function normalizeAdsPlacements(data) {
          if (!data || !Array.isArray(data.placements)) return;
          data.placements.forEach(function (p) {
            if (p.active === undefined) p.active = true;

            var mergedSlots = mergeAdsJsonStringArrays(
              Array.isArray(p.placementSlots) ? p.placementSlots : [],
              Array.isArray(p.placement_slots) ? p.placement_slots : []
            );
            var rawSlots = mergedSlots.length ? mergedSlots : null;
            if (!rawSlots || !rawSlots.length) {
              if (String(p.position || '').toLowerCase() === 'sidebar') {
                rawSlots = ['sidebar_left', 'sidebar_right'];
              } else {
                rawSlots = ['banner_above_footer'];
              }
            }
            var VALID_SLOT = {
              banner_below_header: true,
              banner_above_footer: true,
              banner_below_footer: true,
              sidebar_left: true,
              sidebar_right: true
            };
            p.placementSlots = rawSlots
              .map(normalizePlacementSlotKey)
              .filter(function (k) {
                return VALID_SLOT[k];
              });
            if (!p.placementSlots.length) p.placementSlots = ['banner_above_footer'];

            var rawMacro = mergeAdsJsonStringArrays(
              Array.isArray(p.audienceMacroRegions) ? p.audienceMacroRegions : [],
              Array.isArray(p.audience_macro_regions) ? p.audience_macro_regions : []
            );
            p.audienceMacroRegions = rawMacro
              .map(function (x) {
                return String(x || '')
                  .trim()
                  .toLowerCase()
                  .replace(/-/g, '_')
                  .replace(/\s+/g, '_');
              })
              .filter(function (k) {
                return HFA_AD_MACRO_KEYS[k];
              });

            if (!Array.isArray(p.audienceCountries) && Array.isArray(p.audience_countries)) {
              p.audienceCountries = p.audience_countries;
            }
            if (!Array.isArray(p.audienceRegions) && Array.isArray(p.audience_regions)) {
              p.audienceRegions = p.audience_regions;
            }
            if (!Array.isArray(p.audienceCities) && Array.isArray(p.audience_cities)) {
              p.audienceCities = p.audience_cities;
            }
          });
        }

        function audienceNeedsGeo(ad) {
          var macros = ad.audienceMacroRegions || ad.audience_macro_regions;
          var c = ad.audienceCountries || ad.audience_countries;
          var r = ad.audienceRegions || ad.audience_regions;
          var ci = ad.audienceCities || ad.audience_cities;
          return (Array.isArray(macros) && macros.length > 0) ||
            (Array.isArray(c) && c.length > 0) ||
            (Array.isArray(r) && r.length > 0) ||
            (Array.isArray(ci) && ci.length > 0);
        }

        function audienceMatches(ad, geo) {
          var macros = ad.audienceMacroRegions || ad.audience_macro_regions || [];
          var countries = ad.audienceCountries || ad.audience_countries || [];
          var regions = ad.audienceRegions || ad.audience_regions || [];
          var cities = ad.audienceCities || ad.audience_cities || [];
          if (!macros.length && !countries.length && !regions.length && !cities.length) return true;
          if (!geo) return false;
          var cc = normalizeVisitorCountryCode(geo.country);
          if (macros.length) {
            if (!cc) return false;
            var macroOk = macros.some(function (key) {
              var k = String(key || '').trim().toLowerCase().replace(/\s+/g, '_');
              var set = HFA_MACRO_REGION_COUNTRIES[k];
              return set && set.indexOf(cc) >= 0;
            });
            if (!macroOk) return false;
          }
          if (countries.length) {
            if (!cc) return false;
            if (!countries.some(function (x) {
              return normalizeVisitorCountryCode(String(x || '').trim()) === cc;
            })) return false;
          }
          if (regions.length) {
            var gr = normLoc(geo.region);
            if (!gr) return false;
            if (!regions.some(function (r) {
              var nr = normLoc(r);
              if (!nr) return false;
              return gr === nr || gr.indexOf(nr) >= 0 || nr.indexOf(gr) >= 0;
            })) return false;
          }
          if (cities.length) {
            var gc = normLoc(geo.city);
            if (!gc) return false;
            if (!cities.some(function (c) {
              var nc = normLoc(c);
              if (!nc) return false;
              return gc === nc || gc.indexOf(nc) >= 0 || nc.indexOf(gc) >= 0;
            })) return false;
          }
          return true;
        }

        function resolveVisitorGeo(cb) {
          var done = false;
          var timeoutId;
          function finish(g) {
            if (done) return;
            done = true;
            if (timeoutId) clearTimeout(timeoutId);
            cb(g || null);
          }
          timeoutId = setTimeout(function () { finish(null); }, 5000);

          function geoFromJson(j) {
            if (!j || j.error) return null;
            var raw = j.country_code != null ? j.country_code : (j.countryCode != null ? j.countryCode : j.country);
            var cc = normalizeVisitorCountryCode(raw);
            return {
              country: cc,
              region: String(j.region || j.regionName || ''),
              city: String(j.city || '')
            };
          }

          var explicit = trimSlash(s.adAudienceGeoUrl || '');
          var trackerOrigin = trimSlash(s.ctaTrackerOrigin || '');

          function tryIpapi() {
            if (s.adAudienceIpLookup === false) return finish(null);
            fetch('https://ipapi.co/json/', { credentials: 'omit', cache: 'no-store' })
              .then(function (r) { return r.ok ? r.json() : null; })
              .then(function (j) {
                var g = geoFromJson(j);
                if (!g || !g.country) return finish(null);
                finish(g);
              })
              .catch(function () { finish(null); });
          }

          if (explicit) {
            fetch(explicit, { credentials: 'omit', cache: 'no-store' })
              .then(function (r) { return r.ok ? r.json() : null; })
              .then(function (j) {
                var g = geoFromJson(j);
                if (!g) return finish(null);
                finish(g);
              })
              .catch(function () { finish(null); });
            return;
          }

          if (trackerOrigin) {
            fetch(trackerOrigin + '/api/visitor-geo', { credentials: 'omit', cache: 'no-store' })
              .then(function (r) { return r.ok ? r.json() : null; })
              .then(function (j) {
                var g = geoFromJson(j);
                if (g && g.country) return finish(g);
                tryIpapi();
              })
              .catch(function () { tryIpapi(); });
            return;
          }

          tryIpapi();
        }

        /** BEM modifier must match selectors in style.css (.hfa-ad-slot--below-header, etc.). */
        function hfaAdSlotCssModifier(slotKey) {
          if (slotKey === 'banner_below_header') return 'below-header';
          if (slotKey === 'banner_above_footer') return 'above-footer';
          if (slotKey === 'banner_below_footer') return 'below-footer';
          return String(slotKey || '').replace(/_/g, '-');
        }

        var needGeo = false;
        fetch(window.hfaDataJsonUrl('data/ads.json'))
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (data) {
            if (!data || !data.enabled || !Array.isArray(data.placements)) return null;
            normalizeAdsPlacements(data);
            needGeo = data.placements.some(function (ad) {
              return ad.active !== false && audienceNeedsGeo(ad);
            });
            return data;
          })
          .then(function (data) {
            if (!data) return;
            function runWithGeo(geo) {
              var eligible = data.placements.filter(function (ad) {
                if (ad.active === false) return false;
                if (!audienceMatches(ad, geo)) return false;
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

              var VALID_PLACEMENT_SLOTS = {
                banner_below_header: true,
                banner_above_footer: true,
                banner_below_footer: true,
                sidebar_left: true,
                sidebar_right: true
              };

              function adEffectivePlacementSlots(ad) {
                var slots = ad.placementSlots || ad.placement_slots;
                if (Array.isArray(slots) && slots.length) {
                  return slots
                    .map(function (k) {
                      return normalizePlacementSlotKey(k);
                    })
                    .filter(function (k) {
                      return VALID_PLACEMENT_SLOTS[k];
                    });
                }
                if (String(ad.position).toLowerCase() === 'sidebar') return ['sidebar_left', 'sidebar_right'];
                return ['banner_above_footer'];
              }

              function poolForSlot(slotKey) {
                return eligible.filter(function (a) {
                  return adEffectivePlacementSlots(a).indexOf(slotKey) >= 0;
                });
              }

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
              function buildAdHtml(ad, slotKey) {
                var slot = slotKey || 'banner_above_footer';
                var lbl = esc(ad.label || data.label || 'Sponsored');
                var img = resolveImg(ad.image);
                var adId = String(ad.id || ad.sponsor || ad.image || Math.random().toString(36).slice(2, 8)).replace(/\s+/g, '-').toLowerCase();
                var h = '<p class="hfa-ad-label">' + lbl + '</p>';
                h += '<a href="' + safeUrl(ad.url) + '" target="_blank" rel="sponsored noopener" class="hfa-ad-link" data-ad-id="' + esc(adId) + '" data-ad-slot="' + esc(slot) + '" data-ad-url="' + esc(safeUrl(ad.url)) + '">';
                if (img) h += '<img src="' + esc(img) + '" alt="' + esc(ad.alt || ad.sponsor || '') + '" class="hfa-ad-img">';
                if (ad.sponsor) h += '<span class="hfa-ad-sponsor">' + esc(ad.sponsor) + '</span>';
                h += '</a>';
                return h;
              }
              function wireAdEvents(container, slotName) {
                if (!container) return;
                var link = container.querySelector('.hfa-ad-link');
                if (!link) return;
                var adMeta = {
                  slot: slotName || link.getAttribute('data-ad-slot') || 'banner_above_footer',
                  id: link.getAttribute('data-ad-id') || '',
                  campaignId: '',
                  url: link.getAttribute('data-ad-url') || ''
                };
                emitAdEvent('impression', adMeta);
                var observer;
                try {
                  observer = new IntersectionObserver(function (entries) {
                    entries.forEach(function (entry) {
                      if (entry && entry.isIntersecting && entry.intersectionRatio >= 0.5) {
                        emitAdEvent('viewable', adMeta);
                        if (observer) observer.disconnect();
                      }
                    });
                  }, { threshold: [0.5] });
                  observer.observe(container);
                } catch (_) {}
                link.addEventListener('click', function () {
                  emitAdEvent('click', adMeta);
                });
              }

              ['banner_below_header', 'banner_above_footer', 'banner_below_footer'].forEach(function (sk) {
                var pool = poolForSlot(sk);
                if (!pool.length) return;
                var chosen = pool[Math.floor(Math.random() * pool.length)];
                var container = document.createElement('aside');
                container.className = 'hfa-ad-slot hfa-ad-slot--' + hfaAdSlotCssModifier(sk);
                container.setAttribute('aria-label', (chosen.label || data.label || 'Sponsored'));
                container.innerHTML = buildAdHtml(chosen, sk);
                var hdr = document.querySelector('body > header') || document.querySelector('header');
                var footer = document.querySelector('body > footer') || document.querySelector('footer');
                if (sk === 'banner_below_header') {
                  if (hdr && hdr.parentNode) hdr.parentNode.insertBefore(container, hdr.nextSibling);
                  else document.body.insertBefore(container, document.body.firstChild);
                } else if (sk === 'banner_above_footer') {
                  if (footer && footer.parentNode) footer.parentNode.insertBefore(container, footer);
                  else document.body.appendChild(container);
                } else if (sk === 'banner_below_footer') {
                  if (footer && footer.parentNode) {
                    if (footer.nextSibling) footer.parentNode.insertBefore(container, footer.nextSibling);
                    else footer.parentNode.appendChild(container);
                  } else document.body.appendChild(container);
                }
                wireAdEvents(container, sk);
              });

              ['sidebar_left', 'sidebar_right'].forEach(function (sk) {
                var pool = poolForSlot(sk);
                if (!pool.length) return;
                var chosen = pool[Math.floor(Math.random() * pool.length)];
                var rail = document.createElement('aside');
                rail.className = 'hfa-ad-rail hfa-ad-rail--' + (sk === 'sidebar_left' ? 'left' : 'right');
                rail.setAttribute('aria-label', (chosen.label || data.label || 'Sponsored'));
                rail.innerHTML = buildAdHtml(chosen, sk);
                document.body.appendChild(rail);
                wireAdEvents(rail, sk);
              });
            }
            if (needGeo) resolveVisitorGeo(runWithGeo);
            else runWithGeo(null);
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

    (function trackEngagement() {
      var sentDepth = {};
      function markDepth(depth) {
        if (sentDepth[depth]) return;
        sentDepth[depth] = true;
        emitEngagement('scroll_depth', depth);
      }
      function onScroll() {
        var doc = document.documentElement;
        var top = (window.pageYOffset || doc.scrollTop || 0);
        var h = Math.max(1, (doc.scrollHeight || 1) - (window.innerHeight || 0));
        var pct = Math.round((top / h) * 100);
        if (pct >= 25) markDepth(25);
        if (pct >= 50) markDepth(50);
        if (pct >= 75) markDepth(75);
        if (pct >= 100) markDepth(100);
      }
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
      setInterval(function () {
        if (document.visibilityState !== 'visible') return;
        emitEngagement('engaged_time', 15);
      }, 15000);
    })();
  });
})();
