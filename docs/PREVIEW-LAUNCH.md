# Soft launch: coming soon + team preview login

## Enable preview mode (without committing the passphrase)

1. **Committed file** `assets/js/hfa-preview-settings.js` stays as `window.HFA_PREVIEW_PASSPHRASE = '';` — safe for Git.
2. Copy the example file:
   ```text
   assets/js/hfa-preview-settings.local.js.example
   → assets/js/hfa-preview-settings.local.js
   ```
3. Edit **`hfa-preview-settings.local.js`** and set your real passphrase. That filename is in **`.gitignore`**, so Git will not add it unless you force it.
4. **Deploy** must include `hfa-preview-settings.local.js` on the server (upload with the rest of `assets/js/`, or generate it in CI — see below). If the file is missing, the browser gets a 404 for that script; the site stays **public** (no gate).

HTML loads scripts in order: defaults → **local override** → gate.

## GitHub Actions / CI (optional)

In a deploy workflow, write the file from a repository secret so nothing sensitive is in the repo:

```yaml
- run: |
    echo "window.HFA_PREVIEW_PASSPHRASE = '${{ secrets.HFA_PREVIEW_PASSPHRASE }}';" > assets/js/hfa-preview-settings.local.js
```

(Adjust quoting/escaping if the passphrase contains `'` or `\`.)

## What visitors see

- Anyone who opens a normal page (`index.html`, `about.html`, etc.) without a prior login is sent to **`coming-soon.html`**, with a `return=` query so they land back on the page they wanted after signing in.
- On **`coming-soon.html`**, the **Team preview** box accepts the passphrase. A correct entry sets `sessionStorage` for that browser tab/session and sends them to the return URL (usually home).
- **`404.html`** is not gated so broken links still show your 404 page.

## Hosting notes

- You do **not** have to make `coming-soon.html` the server’s default document. If the host serves `index.html` at `/`, the gate script on `index.html` redirects unauthenticated users to `coming-soon.html` automatically.
- Optional: set the default document to `coming-soon.html` if you want the URL bar to show the root without hitting `index.html` first.

## Security expectations

This is **obfuscation**, not access control. The passphrase still reaches the browser for anyone who loads `hfa-preview-settings.local.js`.

**For a real “only certain people on the live site” setup**, use **Cloudflare Access** at the edge instead — see **[CLOUDFLARE-ACCESS.md](./CLOUDFLARE-ACCESS.md)**. When Access is on, keep `HFA_PREVIEW_PASSPHRASE` empty so you don’t get two logins.

Other options: HTTP basic auth at the host, or a Worker in front of the site.
