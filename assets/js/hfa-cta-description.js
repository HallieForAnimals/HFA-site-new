/**
 * Site CTA cards: caption field often bundles prefix + Call block + hashtags with free text.
 * Targets / location / phones are shown in their own sections from captionBuilder — strip the
 * redundant lines from the Description block only.
 */
(function (global) {
  'use strict';

  function isHashtagOnlyLine(t) {
    var s = (t || '').trim();
    if (!s) return false;
    return /^(?:#[A-Za-z0-9_]+\s*)+$/i.test(s);
  }

  function isGeneratedPrefixLine(t) {
    var s = (t || '').trim();
    if (!s) return false;
    if (/PLEASE\s+SEND\s+THE\s+ONE-CLICK\s+EMAIL/i.test(s)) return true;
    if (/^ANIMAL\s+ABUSER\s+ALERT/i.test(s)) return true;
    if (/^SCAM\s+ALERT/i.test(s)) return true;
    if (/^BE\s+ON\s+THE\s+LOOKOUT/i.test(s)) return true;
    if (/^PUBLIC\s+SERVICE\s+ANNOUNCEMENT/i.test(s)) return true;
    if (/^APPEAL\s+FOR\s+INFORMATION/i.test(s)) return true;
    if (/^UPDATE/i.test(s) && /❗/.test(s)) return true;
    return false;
  }

  function isLikelyCallDetailLine(s) {
    var t = (s || '').trim();
    if (!t) return false;
    if (/^[^:]+:\s*\+?[\d\s\-–—.()]{6,}/.test(t)) return true;
    if (/^\+?[\d\s\-–—.()]{8,}$/.test(t)) return true;
    return /ext\.?\s*\d/i.test(t);
  }

  function hfaStripCaptionMetaFromDescription(raw) {
    if (raw == null || String(raw) === '') return '';
    var lines = String(raw).split(/\r?\n/);
    var res = [];
    var i = 0;
    while (i < lines.length) {
      var line = lines[i];
      var t = line.trim();

      if (!t) {
        res.push('');
        i++;
        continue;
      }

      if (isGeneratedPrefixLine(t)) {
        i++;
        continue;
      }

      if (/^Call:\s*$/i.test(t)) {
        i++;
        while (i < lines.length && lines[i].trim() && isLikelyCallDetailLine(lines[i])) i++;
        continue;
      }

      if (/^Call:\s*.+/i.test(t)) {
        var afterCall = t.replace(/^Call:\s*/i, '').trim();
        if (isLikelyCallDetailLine(afterCall)) {
          i++;
          continue;
        }
      }

      if (isHashtagOnlyLine(t)) {
        i++;
        continue;
      }

      res.push(line);
      i++;
    }

    return res.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  global.hfaStripCaptionMetaFromDescription = hfaStripCaptionMetaFromDescription;
})(typeof window !== 'undefined' ? window : globalThis);
