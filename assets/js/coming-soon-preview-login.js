/**
 * Login form on coming-soon.html — uses HFA_PREVIEW_PASSPHRASE from hfa-preview-settings.js
 */
(function () {
  'use strict';

  function safeReturn(raw) {
    if (!raw || typeof raw !== 'string') return 'index.html';
    var s = raw.trim();
    if (s.length > 240 || s.indexOf('//') !== -1 || s.indexOf(':') !== -1) return 'index.html';
    if (!/^[\w./?&=%\-+#]+$/i.test(s)) return 'index.html';
    return s;
  }

  document.addEventListener('DOMContentLoaded', function () {
    var pass = window.HFA_PREVIEW_PASSPHRASE;
    var form = document.getElementById('preview-login-form');
    var err = document.getElementById('preview-login-error');
    var hint = document.getElementById('preview-login-disabled-hint');
    if (!form) return;

    if (!pass || typeof pass !== 'string' || !pass.trim()) {
      if (hint) hint.hidden = false;
      form.querySelectorAll('input, button').forEach(function (el) {
        el.disabled = true;
      });
      return;
    }
    if (hint) hint.hidden = true;

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (err) {
        err.textContent = '';
        err.hidden = true;
      }
      var input = document.getElementById('preview-login-pass');
      var v = input && input.value ? String(input.value).trim() : '';
      if (v === pass) {
        try {
          sessionStorage.setItem('hfa_preview_ok', '1');
        } catch (e) {
          if (err) {
            err.textContent = 'Could not save session (browser blocked storage). Try another browser or turn off private mode.';
            err.hidden = false;
          }
          return;
        }
        var params = new URLSearchParams(location.search);
        var ret = safeReturn(params.get('return') || 'index.html');
        location.href = ret;
        return;
      }
      if (err) {
        err.textContent = 'That passphrase is not correct.';
        err.hidden = false;
      }
      if (input) input.value = '';
    });
  });
})();
