# Forms & Workers wiring (HFA-site-new)

Public forms post to **`hfa-submissions-proxy`** (Cloudflare Worker). Shortlinks / KV / analytics use **`hfa-cta-tracker`** (`go.hallieforanimals.org`).

## 1. Submissions Worker

From `hfa-submissions-proxy/`:

### 1a. D1 inbox (Hallie Command Center)

Each valid form submission is stored in **D1** so the Hallie app can list them via **`GET /api/inbox`** (Bearer token).

1. Create the database (once):

   ```bash
   cd hfa-submissions-proxy
   npx wrangler d1 create hfa_submissions_inbox
   ```

2. Copy the printed **`database_id`** into `wrangler.toml` → `[[d1_databases]]` → `database_id` (replace the placeholder).

3. **R2 bucket for uploads** (memoriam photos, etc.):

   ```bash
   npx wrangler r2 bucket create hfa-submissions-uploads
   ```

   `wrangler.toml` should include `[[r2_buckets]]` with `binding = "INBOX_UPLOADS"` and the same `bucket_name` (already in the repo template). Redeploy after the bucket exists.

4. Apply the schema:

   ```bash
   npx wrangler d1 migrations apply hfa_submissions_inbox --remote
   ```

5. Set the inbox API secret (pick a long random ASCII string; use the **same** value in Hallie `config.json` → `formInbox.secret`):

   ```bash
   npx wrangler secret put INBOX_SECRET
   ```

   **If Hallie/curl always get `401` but you’re sure the string matches:** set the secret again from the **Cloudflare dashboard** (Workers → `hfa-submissions-proxy` → **Settings** → **Variables** → **Add** → type **Secret** → name `INBOX_SECRET`) and paste the value once. On some Windows setups, `wrangler secret put` can store a subtly different string than what you typed (encoding). Confirm the name is exactly `INBOX_SECRET` (case-sensitive).

6. Deploy:

   ```bash
   npx wrangler deploy
   ```

**API**

- `GET /api/inbox?limit=50&offset=0` — list rows; each attachment may include **`href`** to open the file (same auth as below).  
- `GET /api/inbox/file?submissionId=<uuid>&idx=<0-based>` — stream file bytes from R2 (auth required). Hallie uses this with `Authorization` + `X-HFA-Inbox-Token`.  
- Auth (either works): `Authorization: Bearer <INBOX_SECRET>` **or** header `X-HFA-Inbox-Token: <INBOX_SECRET>`.  
- CORS: `Access-Control-Allow-Origin: *` (safe because auth is required).

**Upload limits (enforced in the Worker + front-end):**

| Route | Files | Per-file | Total upload |
|--------|--------|----------|----------------|
| **In memoriam** | **1** image (JPEG, PNG, HEIC/HEIF, WebP, GIF, AVIF, TIFF, etc.; not SVG) | 35 MB | 35 MB |
| **CTA** | Up to **8** (images, PDF, video) | 98 MB each | **~98 MB** combined (stay under Cloudflare’s ~100 MB request body limit) |
| **Tech / support** | Up to **6** (images, PDF) | 35 MB each | **~98 MB** combined |
| Other (contact, scam, …) | No attachments | — | — |

**R2** is required when visitors attach files; **text-only** submissions work with D1 alone (R2 binding can still be absent until you need uploads).

**Debug (401):** Try `curl.exe` with the alternate header:

`curl.exe -s -H "X-HFA-Inbox-Token: YOUR_SECRET" "https://YOUR-WORKER.workers.dev/api/inbox?limit=5"`

If that works but `Authorization: Bearer …` does not, the problem is how the header is sent, not Cloudflare.

### 1b. Secrets

```bash
npx wrangler secret put TURNSTILE_SECRET
npx wrangler secret put INBOX_SECRET   # required for GET /api/inbox
```

Submissions are stored in **D1** (metadata) + **R2** (file bytes). **Outbound email is not used.**

The **Turnstile site key** in `assets/js/hfa-site-config.js` must pair with `TURNSTILE_SECRET`.

### CORS (browser forms)

`wrangler.toml` → `ALLOWED_ORIGINS` must list every **Origin** visitors use for **production** (apex, `www`, GitHub Pages). Redeploy after edits.

**Local dev:** The Worker also allows **`http://localhost:<any port>`** and **`http://127.0.0.1:<any port>`** so preview servers that pick random ports (e.g. `npx serve`, VS Code Live Preview) work without editing `ALLOWED_ORIGINS` each time.

### Front-end config

| File | Purpose |
|------|---------|
| `assets/js/hfa-site-config.js` | `submissionsEndpoint`, `turnstileSiteKey` |
| `assets/js/hfa-submissions.js` | Shared submit logic |

**Wired page:** **`contact.html`** — one unified form with a dropdown (general contact, tech issue, CTA suggestion, In Memoriam, scam report). Deep links: `contact.html?kind=contact|support|cta|memoriam|scam`. Older URLs (`cta-submit.html`, `tech-submit.html`, `in-memoriam-submit.html`) redirect to the matching `?kind=`.

**CTA “Date of incident”:** Uses **Flatpickr** (CSS + JS from jsDelivr) so the calendar popup can match site branding; native `<input type="date">` popups cannot be styled in Chrome/Edge. Submitted value is still `YYYY-MM-DD`. If Flatpickr fails to load, the field allows typing a date manually (`YYYY-MM-DD`).

## 2. Hallie app (`hallie-app-new`)

In **`config.json`** add:

```json
"formInbox": {
  "url": "https://YOUR-SUBMISSIONS-WORKER.workers.dev/api/inbox",
  "secret": "YOUR_INBOX_SECRET"
}
```

Then in the Command Center sidebar: **Submissions → Form inbox (live)**.

See also `hallie-app-new/config.example.json`.

## 3. CTA tracker Worker

From `hfa-cta-tracker/`:

```bash
npx wrangler deploy
```

Update `ALLOWED_ORIGINS` for sites that call the tracker API from the browser.

## 4. Smoke tests

1. **D1** — submit any wired form; then `GET /api/inbox` with Bearer token → new row.
2. **Hallie** — open **Form inbox (live)** and refresh.
3. Shortlink: `https://go.hallieforanimals.org/t/<slug>` → redirect.

## 5. GitHub Pages

If the site uses a **project** path, the browser **Origin** is still `https://hallieforanimals.github.io` (no path in CORS).
