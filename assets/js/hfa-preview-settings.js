/**
 * Soft launch — “coming soon” team preview (defaults only — safe to commit)
 * -------------------------------------------------------------------------
 * Keep this file as '' in Git. Put your real passphrase in
 * hfa-preview-settings.local.js (see .example file next to it). That local file
 * is listed in .gitignore so it is never committed.
 *
 * Load order in HTML: this file, then .local.js (optional), then preview-gate.js.
 *
 * Not strong security: the passphrase still ships to the browser for anyone who
 * gets the local file on the server. For real access control use Cloudflare Access.
 */
window.HFA_PREVIEW_PASSPHRASE = '';
