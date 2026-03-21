/**
 * Public site + Turnstile site key (safe to expose in HTML).
 * Override before loading hfa-submissions.js if needed.
 */
(function () {
  window.HFA_SITE = window.HFA_SITE || {
    submissionsEndpoint: 'https://hfa-submissions-proxy.hallieforanimals.workers.dev/',
    /** Cloudflare Turnstile widget key (must pair with TURNSTILE_SECRET on the Worker). */
    turnstileSiteKey: '0x4AAAAAAB-QUsgpCF_PFhLt'
  };
})();
