/**
 * HallieForAnimals — unified contact & submissions form (Turnstile + submissions Worker).
 * Page: contact.html (#hfa-unified-form). Deep links: contact.html?kind=cta|support|memoriam|scam|contact
 */
(function () {
  'use strict';

  function cfg() {
    return window.HFA_SITE || {};
  }

  function endpoint() {
    var u = (cfg().submissionsEndpoint || '').trim();
    return u || 'https://hfa-submissions-proxy.hallieforanimals.workers.dev/';
  }

  function siteKey() {
    return (cfg().turnstileSiteKey || '').trim();
  }

  function validateConsents(panel, names) {
    var ok = true;
    names.forEach(function (name) {
      var cb = panel.querySelector('input[name="' + name + '"]');
      var label = cb && cb.closest('label');
      if (!cb || !cb.checked) {
        if (label) label.classList.add('is-error');
        ok = false;
      }
    });
    return ok;
  }

  function whenTurnstileReady(cb) {
    if (window.turnstile && typeof window.turnstile.render === 'function') return cb();
    var t = setInterval(function () {
      if (window.turnstile && typeof window.turnstile.render === 'function') {
        clearInterval(t);
        cb();
      }
    }, 25);
  }

  function createWidget(holderSelector) {
    var widgetId = null;
    var key = siteKey();

    function render() {
      var holder = document.querySelector(holderSelector);
      if (!holder || !key) return;
      holder.style.display = 'block';
      if (widgetId != null) return;
      widgetId = window.turnstile.render(holderSelector, {
        sitekey: key,
        theme: 'light',
        'expired-callback': function () {
          try {
            window.turnstile.reset(widgetId);
          } catch (e) {}
        },
        'error-callback': function () {}
      });
    }

    function ensureToken(form) {
      var hidden = form && form.querySelector('input[name="cf-turnstile-response"]');
      if (hidden && hidden.value) return Promise.resolve(hidden.value);
      return new Promise(function (resolve, reject) {
        whenTurnstileReady(function () {
          render();
          var tries = 0;
          function tick() {
            try {
              var t = window.turnstile.getResponse(widgetId);
              if (t) return resolve(t);
            } catch (e) {}
            tries++;
            if (tries >= 20) return reject(new Error('Captcha not ready'));
            setTimeout(tick, 100);
          }
          tick();
        });
      });
    }

    function reset() {
      try {
        if (window.turnstile && widgetId != null) window.turnstile.reset(widgetId);
      } catch (e) {}
    }

    return { render: render, ensureToken: ensureToken, reset: reset };
  }

  function setOK(elOk, elBad, msg, hide) {
    if (elBad) elBad.hidden = true;
    if (!elOk) return;
    if (hide || msg === '') {
      elOk.hidden = true;
      return;
    }
    elOk.textContent = msg || 'Thanks — your message was sent.';
    elOk.hidden = false;
  }

  function setBad(elOk, elBad, msg, hide) {
    if (elOk) elOk.hidden = true;
    if (!elBad) return;
    if (hide || msg === '') {
      elBad.hidden = true;
      return;
    }
    elBad.textContent =
      msg || "Something's missing or invalid. Please check the highlighted fields.";
    elBad.hidden = false;
  }

  function emailOk(s) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
  }

  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  function parseErrHint(out) {
    if (!out || typeof out !== 'object') return '';
    var codes =
      (out.detail && (out.detail['error-codes'] || out.detail.error_codes)) || out.errors || [];
    var mc = out.mc_status ? ' [MC ' + out.mc_status + ']' : '';
    var h = Array.isArray(codes) && codes.length ? ' (' + codes.join(', ') + ')' : '';
    return h + mc;
  }

  /** Map Worker JSON (400/500) to a single user-visible string. */
  function formatSubmissionFailure(res, out) {
    var code = res && res.status;
    if (!out || typeof out !== 'object') {
      return 'Send failed' + (code ? ' (HTTP ' + code + ')' : '') + '. Please try again.';
    }
    var err = out.error ? String(out.error) : 'request_failed';
    var parts = ['Send failed: ' + err];
    if (out.hint) parts.push(String(out.hint));
    parts.push(parseErrHint(out).trim());
    if (err === 'Captcha verification failed' || err === 'Captcha missing') {
      parts.push(
        'Confirm Turnstile loads, wait for the checkmark, and try again. If you use a preview/staging URL, add that hostname to the Turnstile widget in Cloudflare (Domains).'
      );
    }
    if (err === 'Bad request body') {
      parts.push('Try again or use another browser; if it persists, the upload may be too large or corrupted.');
    }
    if (err === 'photo_required') {
      parts.push('In memoriam needs exactly one image (JPEG, PNG, HEIC, etc.).');
    }
    return parts.filter(Boolean).join(' ');
  }

  function populateYearSelects(form) {
    var fromSel = form.querySelector('#mem-year-from');
    var toSel = form.querySelector('#mem-year-to');
    if (!fromSel || !toSel) return;
    function fill(sel) {
      sel.innerHTML = '';
      var ph = document.createElement('option');
      ph.value = '';
      ph.textContent = '—';
      sel.appendChild(ph);
      var y = new Date().getFullYear();
      for (var yr = y; yr >= 1950; yr--) {
        var o = document.createElement('option');
        o.value = String(yr);
        o.textContent = String(yr);
        sel.appendChild(o);
      }
    }
    fill(fromSel);
    fill(toSel);
  }

  function val(panel, name) {
    var el = panel.querySelector('[name="' + name + '"]');
    return el ? String(el.value || '').trim() : '';
  }

  function wireUnifiedForm() {
    var form = document.getElementById('hfa-unified-form');
    if (!form) return;

    var kindSelect = document.getElementById('hfa-form-kind');
    var introEl = document.getElementById('hfa-form-intro');
    var statusOK = document.getElementById('submit-ok');
    var statusBad = document.getElementById('submit-bad');
    var submitBtn = document.getElementById('hfa-unified-submit');
    var ts = createWidget('#captcha-wrap');

    var intros = {
      contact: 'General questions, media, or anything else.',
      support: 'Broken links, errors, or problems using this site.',
      cta: 'Suggest a campaign, case, or action you think we should highlight.',
      memoriam: 'Share a photo and short tribute for our In Memoriam page (we curate submissions).',
      scam: 'Report scams, impersonation, or fraud related to animal welfare or our cause.'
    };

    var successMsg = {
      contact: 'Thanks — your message was sent.',
      support: 'Thanks — we received your report.',
      cta: 'Thanks — your submission was received.',
      memoriam: 'Thanks — your submission was received.',
      scam: 'Thanks — your report was received.'
    };

    function panelFor(kind) {
      return form.querySelector('.hfa-form-panel[data-hfa-kind="' + kind + '"]');
    }

    function setKind(k) {
      var allowed = ['contact', 'support', 'cta', 'memoriam', 'scam'];
      if (allowed.indexOf(k) < 0) k = 'contact';
      kindSelect.value = k;
      form.querySelectorAll('.hfa-form-panel').forEach(function (p) {
        var on = p.getAttribute('data-hfa-kind') === k;
        p.classList.toggle('is-active', on);
        p.setAttribute('aria-hidden', on ? 'false' : 'true');
      });
      if (introEl) introEl.textContent = intros[k] || '';
      if (submitBtn) {
        submitBtn.textContent =
          k === 'contact'
            ? 'Send message'
            : k === 'support'
              ? 'Send report'
              : k === 'scam'
                ? 'Submit report'
                : 'Submit';
      }
    }

    function initCtaIncidentDatePicker() {
      var el = document.getElementById('cta-date');
      var clearBtn = document.getElementById('cta-date-clear');
      if (clearBtn && !clearBtn.dataset.hfaBound) {
        clearBtn.dataset.hfaBound = '1';
        clearBtn.addEventListener('click', function () {
          if (el && el._flatpickr) {
            el._flatpickr.clear();
          } else if (el) {
            el.value = '';
          }
        });
      }
      if (!el) return;
      if (typeof window.flatpickr !== 'function') {
        el.readOnly = false;
        el.placeholder = 'YYYY-MM-DD (optional)';
        el.setAttribute('inputmode', 'numeric');
        return;
      }
      if (el._flatpickr) return;
      el.readOnly = true;
      window.flatpickr(el, {
        dateFormat: 'Y-m-d',
        allowInput: false,
        disableMobile: true,
        monthSelectorType: 'static',
        nextArrow:
          '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z"/></svg>',
        prevArrow:
          '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6z"/></svg>'
      });
    }

    onReady(function () {
      var params = new URLSearchParams(location.search);
      var hash = (location.hash || '').replace(/^#/, '');
      var k = params.get('kind') || hash || 'contact';
      setKind(k);
      populateYearSelects(form);
      initCtaIncidentDatePicker();
      if (!siteKey()) {
        console.warn('[HFA] Set HFA_SITE.turnstileSiteKey in hfa-site-config.js');
      }
      whenTurnstileReady(function () {
        ts.render();
      });
    });

    kindSelect.addEventListener('change', function () {
      setKind(kindSelect.value);
      try {
        history.replaceState(null, '', 'contact.html?kind=' + encodeURIComponent(kindSelect.value));
      } catch (e) {}
    });

    form.addEventListener('input', function (ev) {
      var t = ev.target;
      if (!t || typeof t.matches !== 'function') return;
      if (t.matches('.hfa-form-panel[data-hfa-kind="cta"] textarea[name="description"]')) {
        var dc = document.getElementById('desc-count');
        if (dc) dc.textContent = String(t.value.length);
      }
      if (t.matches('.hfa-form-panel[data-hfa-kind="memoriam"] textarea[name="description"]')) {
        var mc = document.getElementById('mem-desc-count');
        if (mc) mc.textContent = String(t.value.length);
      }
    });

    function chk(panel, n) {
      var el = panel.querySelector('[name="' + n + '"]');
      return !!(el && el.checked);
    }

    function clearErrors() {
      form.querySelectorAll('.is-error').forEach(function (el) {
        el.classList.remove('is-error');
      });
      var ee = document.getElementById('evidence-errors');
      if (ee) ee.textContent = '';
      var pe = document.getElementById('mem-photo-errors');
      if (pe) pe.textContent = '';
      var sfe = document.getElementById('support-file-errors');
      if (sfe) sfe.textContent = '';
    }

    function extFromName(n) {
      var m = String(n || '')
        .toLowerCase()
        .match(/\.([a-z0-9]+)$/);
      return m ? m[1] : '';
    }

    function memoriamImageExtOk(ext) {
      var o = {
        jpg: 1,
        jpeg: 1,
        jfif: 1,
        pjpeg: 1,
        png: 1,
        gif: 1,
        webp: 1,
        bmp: 1,
        heic: 1,
        heif: 1,
        avif: 1,
        tiff: 1,
        tif: 1
      };
      return !!o[String(ext || '').toLowerCase()];
    }

    /** Matches Worker rules: any raster image; octet-stream + known ext (common on iOS). */
    function memoriamImageFileOk(f) {
      var t = (f.type || '').trim().toLowerCase();
      if (t.indexOf('image/') === 0) {
        if (t === 'image/svg+xml') return false;
        return true;
      }
      if (t === 'application/octet-stream') {
        return memoriamImageExtOk(extFromName(f.name));
      }
      if (!t) {
        return memoriamImageExtOk(extFromName(f.name));
      }
      return false;
    }

    function ctaFileOk(f) {
      var t = (f.type || '').toLowerCase();
      if (t.indexOf('image/') === 0 || t.indexOf('video/') === 0 || t === 'application/pdf') {
        return true;
      }
      var ext = extFromName(f.name);
      var vid = { mp4: 1, webm: 1, mov: 1, mkv: 1, avi: 1, m4v: 1 };
      if (t === 'application/octet-stream' || !t) {
        return !!(memoriamImageExtOk(ext) || vid[ext] || ext === 'pdf');
      }
      return !!(memoriamImageExtOk(ext) || vid[ext] || ext === 'pdf');
    }

    function supportFileOk(f) {
      var t = (f.type || '').toLowerCase();
      if (t.indexOf('image/') === 0 || t === 'application/pdf') {
        return true;
      }
      var ext = extFromName(f.name);
      if (t === 'application/octet-stream' || !t) {
        return memoriamImageExtOk(ext) || ext === 'pdf';
      }
      return memoriamImageExtOk(ext) || ext === 'pdf';
    }

    function validateSupportFiles(panel) {
      var errEl = document.getElementById('support-file-errors');
      if (errEl) errEl.textContent = '';
      var inp = panel.querySelector('input[name="files"]');
      if (!inp || !inp.files || !inp.files.length) {
        return true;
      }
      var maxFiles = 6;
      var maxPer = 35 * 1024 * 1024;
      var maxTotal = 98 * 1024 * 1024;
      var files = Array.prototype.slice.call(inp.files);
      var wrap = inp.closest('label');
      if (files.length > maxFiles) {
        if (errEl) errEl.textContent = 'Please attach no more than 6 files.';
        wrap && wrap.classList.add('is-error');
        return false;
      }
      var total = 0;
      for (var i = 0; i < files.length; i++) {
        var sf = files[i];
        if (!supportFileOk(sf)) {
          if (errEl) errEl.textContent = 'Use images or PDF only for screenshots.';
          wrap && wrap.classList.add('is-error');
          return false;
        }
        if (sf.size > maxPer) {
          if (errEl) errEl.textContent = 'Each file must be 35 MB or smaller.';
          wrap && wrap.classList.add('is-error');
          return false;
        }
        total += sf.size;
        if (total > maxTotal) {
          if (errEl) errEl.textContent = 'Combined files are too large (max ~98 MB total).';
          wrap && wrap.classList.add('is-error');
          return false;
        }
      }
      return true;
    }

    function validateCta(panel) {
      var evidence = panel.querySelector('textarea[name="evidence"]');
      var evidenceErr = document.getElementById('evidence-errors');
      var filesInput = panel.querySelector('input[name="files"]');
      var ok = true;
      ['country', 'description'].forEach(function (name) {
        var input = panel.querySelector('[name="' + name + '"]');
        var wrap = input && input.closest('label');
        if (!input || !String(input.value || '').trim()) {
          wrap && wrap.classList.add('is-error');
          ok = false;
        }
      });
      var rem = panel.querySelector('[name="reporterEmail"]');
      if (rem && rem.value.trim() && !emailOk(rem.value)) {
        rem.closest('label') && rem.closest('label').classList.add('is-error');
        ok = false;
      }
      if (evidenceErr) evidenceErr.textContent = '';
      var urls = (evidence && evidence.value ? evidence.value : '')
        .split(/\r?\n/)
        .map(function (s) {
          return s.trim();
        })
        .filter(Boolean);
      var hasFiles = !!(filesInput && filesInput.files && filesInput.files.length);
      if (!urls.length && !hasFiles) {
        if (evidenceErr) evidenceErr.textContent = 'Add at least one evidence URL or attach file(s).';
        evidence && evidence.closest('label') && evidence.closest('label').classList.add('is-error');
        ok = false;
      }
      if (urls.length) {
        var urlish =
          /^(?:(?:https?:\/\/)?(?:www\.)?|www\.)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9-]+)+(?:[\/?#][^\s]*)?$/i;
        if (urls.some(function (l) { return !urlish.test(l); })) {
          if (evidenceErr) evidenceErr.textContent = 'Invalid URL(s) in list.';
          evidence && evidence.closest('label') && evidence.closest('label').classList.add('is-error');
          ok = false;
        }
      }
      if (filesInput && filesInput.files && filesInput.files.length) {
        var maxFiles = 8;
        var maxPer = 98 * 1024 * 1024;
        var maxTotal = 98 * 1024 * 1024;
        var files = Array.prototype.slice.call(filesInput.files);
        var total = 0;
        if (files.length > maxFiles) ok = false;
        for (var fi = 0; fi < files.length; fi++) {
          var cf = files[fi];
          if (!ctaFileOk(cf) || cf.size > maxPer) ok = false;
          total += cf.size;
        }
        if (total > maxTotal) ok = false;
        if (!ok) filesInput.closest('label') && filesInput.closest('label').classList.add('is-error');
      }
      if (!validateConsents(panel, ['consentTruth', 'consentShare', 'consentPrivacy'])) ok = false;
      return ok;
    }

    function validateMemoriam(panel) {
      var photoErr = document.getElementById('mem-photo-errors');
      if (photoErr) photoErr.textContent = '';
      var ok = true;
      var yearMsg = null;
      var hints = [];
      ['petName', 'description'].forEach(function (name) {
        var input = panel.querySelector('[name="' + name + '"]');
        var wrap = input && input.closest('label');
        if (!input || !String(input.value || '').trim()) {
          wrap && wrap.classList.add('is-error');
          ok = false;
          hints.push(
            name === 'petName'
              ? "your companion's name (under About your companion)"
              : 'short tribute (the required text box above Photo)'
          );
        }
      });
      var em = panel.querySelector('[name="reporterEmail"]');
      if (em && em.value.trim() && !emailOk(em.value)) {
        em.closest('label') && em.closest('label').classList.add('is-error');
        ok = false;
        hints.push('a valid email, or leave Your email blank');
      }
      var inp = panel.querySelector('input[name="photos"]');
      if (!inp || !inp.files || inp.files.length !== 1) {
        if (photoErr) {
          photoErr.textContent = !inp || !inp.files || !inp.files.length
            ? 'Please attach one image (photos & screenshots, including iPhone HEIC).'
            : 'Please attach only one image.';
        }
        inp && inp.closest('label') && inp.closest('label').classList.add('is-error');
        ok = false;
        hints.push(!inp || !inp.files || !inp.files.length ? 'one photo upload' : 'only one photo');
      } else {
        var f0 = inp.files[0];
        if (f0.size > 35 * 1024 * 1024 || !memoriamImageFileOk(f0)) {
          if (photoErr) {
            photoErr.textContent =
              'Use a common image file (JPEG, PNG, HEIC, WebP, etc.), max 35 MB.';
          }
          ok = false;
          hints.push('a supported image under 35 MB (not SVG)');
        }
        if (!ok) inp.closest('label') && inp.closest('label').classList.add('is-error');
      }
      if (!validateConsents(panel, ['consentRights', 'consentPrivacy'])) {
        ok = false;
        hints.push('both consent checkboxes');
      }

      var yFrom = (panel.querySelector('[name="yearFrom"]') || {}).value || '';
      var yTo = (panel.querySelector('[name="yearTo"]') || {}).value || '';
      if (yFrom && yTo && Number(yFrom) > Number(yTo)) {
        panel.querySelector('#mem-year-from') &&
          panel.querySelector('#mem-year-from').closest('label') &&
          panel.querySelector('#mem-year-from').closest('label').classList.add('is-error');
        panel.querySelector('#mem-year-to') &&
          panel.querySelector('#mem-year-to').closest('label') &&
          panel.querySelector('#mem-year-to').closest('label').classList.add('is-error');
        yearMsg = '“From” year cannot be after “To” year.';
        ok = false;
      }
      var clientHint =
        !ok && hints.length
          ? 'Please fix: ' + hints.join('; ') + '.'
          : !ok
            ? "Something's missing or invalid. Please check the highlighted fields."
            : '';
      return { ok: ok, yearMsg: yearMsg, clientHint: clientHint };
    }

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      clearErrors();
      setOK(statusOK, statusBad, '', true);
      setBad(statusOK, statusBad, '', true);

      var kind = kindSelect.value;
      var panel = panelFor(kind);
      if (!panel) {
        setBad(statusOK, statusBad, 'Invalid form type.');
        return;
      }

      var hp = form.querySelector('[name="website"]');
      if (hp && hp.value.trim()) return;

      var ok = true;

      if (kind === 'contact') {
        ['topic', 'name', 'email', 'message'].forEach(function (name) {
          var el = panel.querySelector('[name="' + name + '"]');
          if (!el || !String(el.value || '').trim()) {
            el && el.closest('label') && el.closest('label').classList.add('is-error');
            ok = false;
          }
        });
        var em = panel.querySelector('[name="email"]');
        if (em && em.value.trim() && !emailOk(em.value)) {
          em.closest('label') && em.closest('label').classList.add('is-error');
          ok = false;
        }
        if (!validateConsents(panel, ['consentPrivacy', 'consentReply'])) ok = false;
      } else if (kind === 'support') {
        ['topic', 'email', 'message'].forEach(function (name) {
          var el = panel.querySelector('[name="' + name + '"]');
          if (!el || !String(el.value || '').trim()) {
            el && el.closest('label') && el.closest('label').classList.add('is-error');
            ok = false;
          }
        });
        var em2 = panel.querySelector('[name="email"]');
        if (em2 && em2.value.trim() && !emailOk(em2.value)) {
          em2.closest('label') && em2.closest('label').classList.add('is-error');
          ok = false;
        }
        if (!validateSupportFiles(panel)) ok = false;
        if (!validateConsents(panel, ['consentPrivacy', 'consentReply'])) ok = false;
      } else if (kind === 'cta') {
        ok = validateCta(panel);
      } else if (kind === 'memoriam') {
        var memV = validateMemoriam(panel);
        ok = memV.ok;
        if (memV.yearMsg) {
          setBad(statusOK, statusBad, memV.yearMsg);
          return;
        }
        if (!ok) {
          setBad(statusOK, statusBad, memV.clientHint);
          return;
        }
      } else if (kind === 'scam') {
        var platSel = panel.querySelector('[name="platform"]');
        if (!platSel || !String(platSel.value || '').trim()) {
          platSel && platSel.closest('label') && platSel.closest('label').classList.add('is-error');
          ok = false;
        }
        var rem = panel.querySelector('[name="reporterEmail"]');
        if (rem && rem.value.trim() && !emailOk(rem.value)) {
          rem.closest('label') && rem.closest('label').classList.add('is-error');
          ok = false;
        }
        if (!validateConsents(panel, ['consentTruth', 'consentShare', 'consentPrivacy'])) ok = false;
      }

      if (!ok) {
        setBad(statusOK, statusBad);
        return;
      }

      if (!siteKey()) {
        setBad(statusOK, statusBad, 'Form configuration error (missing Turnstile key).');
        return;
      }

      var token;
      try {
        token = await ts.ensureToken(form);
      } catch (err) {
        setBad(statusOK, statusBad, 'Captcha failed. Please try again.');
        return;
      }

      try {
        var res;
        if (kind === 'contact') {
          var fdC = new FormData();
          fdC.set('formType', 'contact');
          fdC.set('subjectRaw', 'HFA General contact');
          fdC.set('topic', val(panel, 'topic'));
          fdC.set('name', val(panel, 'name'));
          fdC.set('email', val(panel, 'email'));
          fdC.set('message', val(panel, 'message'));
          fdC.set('consentPrivacy', chk(panel, 'consentPrivacy') ? '1' : '');
          fdC.set('consentReply', chk(panel, 'consentReply') ? '1' : '');
          fdC.set('website', '');
          fdC.set('cf-turnstile-response', token);
          fdC.set('turnstileToken', token);
          fdC.set('token', token);
          fdC.set('response', token);
          res = await fetch(endpoint(), { method: 'POST', body: fdC });
        } else if (kind === 'support') {
          var fdS = new FormData();
          fdS.set('formType', 'support');
          fdS.set('route', 'support');
          fdS.set('subjectRaw', 'HFA Support request');
          fdS.set('topic', val(panel, 'topic'));
          fdS.set('name', val(panel, 'name'));
          fdS.set('email', val(panel, 'email'));
          fdS.set('message', val(panel, 'message'));
          fdS.set('consentPrivacy', chk(panel, 'consentPrivacy') ? '1' : '');
          fdS.set('consentReply', chk(panel, 'consentReply') ? '1' : '');
          fdS.set('website', '');
          fdS.set('cf-turnstile-response', token);
          fdS.set('turnstileToken', token);
          fdS.set('token', token);
          fdS.set('response', token);
          var supFilesIn = panel.querySelector('input[name="files"]');
          if (supFilesIn && supFilesIn.files && supFilesIn.files.length) {
            for (var sx = 0; sx < supFilesIn.files.length; sx++) {
              fdS.append('files', supFilesIn.files[sx], supFilesIn.files[sx].name);
            }
          }
          res = await fetch(endpoint(), { method: 'POST', body: fdS });
        } else if (kind === 'scam') {
          var payloadScam = {
            formType: 'scam',
            subjectRaw: 'HFA Submission Scam',
            description: '',
            reporterName: val(panel, 'reporterName'),
            reporterEmail: val(panel, 'reporterEmail'),
            platform: val(panel, 'platform'),
            scamHandle: val(panel, 'scamHandle'),
            other: val(panel, 'other'),
            consentTruth: chk(panel, 'consentTruth'),
            consentShare: chk(panel, 'consentShare'),
            consentPrivacy: chk(panel, 'consentPrivacy'),
            website: '',
            'cf-turnstile-response': token,
            turnstileToken: token,
            token: token,
            response: token
          };
          res = await fetch(endpoint(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(payloadScam)
          });
        } else if (kind === 'cta') {
          var evidenceLines = val(panel, 'evidence')
            .split(/\r?\n/)
            .map(function (s) { return s.trim(); })
            .filter(Boolean);
          var evidenceStr = evidenceLines.join('\n');
          var filesInput = panel.querySelector('input[name="files"]');
          var hasFiles = !!(filesInput && filesInput.files && filesInput.files.length);
          if (hasFiles) {
            var fd = new FormData();
            fd.set('formType', 'cta');
            fd.set('route', 'cta');
            fd.set('subjectRaw', 'HFA Submission CTA');
            fd.set('country', val(panel, 'country'));
            fd.set('city', val(panel, 'city'));
            fd.set('date', val(panel, 'date'));
            fd.set('description', val(panel, 'description'));
            fd.set('evidence', evidenceStr);
            fd.set('reporterName', val(panel, 'reporterName'));
            fd.set('reporterEmail', val(panel, 'reporterEmail'));
            fd.set('handle', val(panel, 'handle'));
            fd.set('consentTruth', String(chk(panel, 'consentTruth')));
            fd.set('consentShare', String(chk(panel, 'consentShare')));
            fd.set('consentPrivacy', String(chk(panel, 'consentPrivacy')));
            fd.set('website', '');
            fd.set('cf-turnstile-response', token);
            for (var i = 0; i < filesInput.files.length; i++) {
              fd.append('files', filesInput.files[i], filesInput.files[i].name);
            }
            res = await fetch(endpoint(), { method: 'POST', body: fd });
          } else {
            var payloadCta = {
              formType: 'cta',
              route: 'cta',
              subjectRaw: 'HFA Submission CTA',
              country: val(panel, 'country'),
              city: val(panel, 'city'),
              date: val(panel, 'date'),
              description: val(panel, 'description'),
              evidence: evidenceStr,
              reporterName: val(panel, 'reporterName'),
              reporterEmail: val(panel, 'reporterEmail'),
              handle: val(panel, 'handle'),
              consentTruth: chk(panel, 'consentTruth'),
              consentShare: chk(panel, 'consentShare'),
              consentPrivacy: chk(panel, 'consentPrivacy'),
              website: '',
              'cf-turnstile-response': token,
              turnstileToken: token,
              token: token,
              response: token
            };
            res = await fetch(endpoint(), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
              body: JSON.stringify(payloadCta)
            });
          }
        } else if (kind === 'memoriam') {
          var yFrom = val(panel, 'yearFrom');
          var yTo = val(panel, 'yearTo');
          var yearsCombined = yFrom && yTo ? yFrom + '–' + yTo : yFrom || yTo || '';
          var fdM = new FormData();
          fdM.set('formType', 'memoriam');
          fdM.set('route', 'memoriam');
          fdM.set('subjectRaw', 'HFA Submission In Memoriam');
          fdM.set('petName', val(panel, 'petName'));
          fdM.set('species', val(panel, 'species'));
          fdM.set('yearFrom', yFrom);
          fdM.set('yearTo', yTo);
          fdM.set('years', yearsCombined);
          fdM.set('description', val(panel, 'description'));
          fdM.set('reporterName', val(panel, 'reporterName'));
          fdM.set('reporterEmail', val(panel, 'reporterEmail'));
          fdM.set('handle', val(panel, 'handle'));
          fdM.set('consentRights', String(chk(panel, 'consentRights')));
          fdM.set('consentPrivacy', String(chk(panel, 'consentPrivacy')));
          fdM.set('website', '');
          fdM.set('cf-turnstile-response', token);
          fdM.set('turnstileToken', token);
          fdM.set('token', token);
          fdM.set('response', token);
          var photosIn = panel.querySelector('input[name="photos"]');
          if (photosIn && photosIn.files) {
            for (var j = 0; j < photosIn.files.length; j++) {
              fdM.append('photos', photosIn.files[j], photosIn.files[j].name);
            }
          }
          res = await fetch(endpoint(), { method: 'POST', body: fdM });
        }

        var out;
        try {
          out = await res.json();
        } catch (e2) {
          out = await res.text();
        }
        if (res.ok && out && out.ok) {
          var keepKind = kindSelect.value;
          form.reset();
          var ctaDateEl = document.getElementById('cta-date');
          if (ctaDateEl && ctaDateEl._flatpickr) {
            ctaDateEl._flatpickr.clear();
          }
          populateYearSelects(form);
          setKind(keepKind);
          ts.reset();
          setOK(statusOK, statusBad, successMsg[kind] || 'Thanks — received.', false);
        } else {
          if (typeof console !== 'undefined' && console.warn) {
            console.warn('[hfa-submissions]', res.status, out);
          }
          setBad(statusOK, statusBad, formatSubmissionFailure(res, out));
        }
      } catch (err) {
        console.error(err);
        setBad(statusOK, statusBad, 'Network error. Please try again.');
      }
    });
  }

  wireUnifiedForm();
})();
