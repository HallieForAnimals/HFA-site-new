# Cloudflare Access — lock the whole live site to testers

This guide protects **`https://your-domain.org`** (and optionally `www`) **before** any HTML loads. No passphrase in Git; rules live in Cloudflare.

You configure this in the **Cloudflare dashboard** (we can’t do it from this repo).

---

## Before you start

1. **Access only runs on names that are “Proxied” (orange cloud)**  
   Cloudflare applies Access **per DNS name**. If a record is **DNS only** (grey cloud), traffic never hits Cloudflare’s edge → **Access cannot run** for that hostname.

2. **`go` → `hallieforanimals.workers.dev` is not the same as the main website**  
   A proxied **CNAME** like `go` → `*.workers.dev` only puts **that subdomain** (e.g. `go.hallieforanimals.org`) through Cloudflare to your Worker. It does **not** protect **`hallieforanimals.org`** or **`www.…`** unless those records are **also** proxied.

   To lock the **whole public site** (homepage + pages): in **DNS**, turn **Proxied** **on** for whatever records visitors use for the site, usually:
   - **`@`** (apex) and/or  
   - **`www`**  
   …the ones that today point at **GitHub Pages**, **Cloudflare Pages**, or your host — **not** only `go`.

   After you orange-cloud them, SSL mode is usually **Full** (or **Full (strict)**) so the connection from Cloudflare to GitHub/Pages still works. If something breaks, check [SSL/TLS](https://dash.cloudflare.com/) and your host’s HTTPS requirements.

3. **Know your live hostnames**  
   e.g. `hallieforanimals.org` **and** `www.hallieforanimals.org` if you use both. You’ll add each hostname (or use your dashboard’s subdomain/wildcard options if available on your plan).

4. **Turn off the JS “preview gate”** (recommended)  
   If you use Cloudflare Access, set **`HFA_PREVIEW_PASSPHRASE`** to empty everywhere (no `hfa-preview-settings.local.js` override, or remove deploy of that file).  
   Otherwise testers may hit **Access login** and then the **coming-soon passphrase** — confusing double wall.

---

## Step 1 — Open Zero Trust

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com).
2. Open **Zero Trust** (sometimes labeled **Cloudflare One**).  
   Direct link pattern: `https://one.dash.cloudflare.com/` (you may be redirected from the main dashboard).
3. First visit: complete **Zero Trust setup** (choose a **team name** — this becomes something like `yourteam.cloudflareaccess.com` for the login page). Free tier is enough for small teams.

---

## Step 2 — Add an Access application (whole site)

**Use “Self-hosted,” not the Tunnel / private-app wizard.** If Cloudflare shows a flow titled **“Private web application”** with steps like **Assign a Tunnel** and fields for an **internal hostname or IP** (`10.x.x.x`, `*.local`), that is for apps reached via **Cloudflare Tunnel**. Your GitHub Pages site is already on the public internet with **proxied DNS** — you only need a **self-hosted** Access app on your **real domain** (no tunnel).

1. In Zero Trust: **Access** → **Applications**.
2. **Add an application** → **Self-hosted** (not private/Tunnel-only onboarding).
3. Configure:
   - **Application name:** e.g. `HFA website (private beta)`.
   - **Session duration:** e.g. 24 hours (how often testers re-authenticate).
   - **Application domain(s):** add the hostname(s) visitors use:
     - `hallieforanimals.org`
     - `www.hallieforanimals.org`  
     (Use your real domains; add both if both resolve to the site.)
   - **Path:** `*` or leave default so **the entire site** is protected (all paths).

4. Save. You’ll attach **policies** next.

---

## Step 3 — Who is allowed? (Access policies)

Still on the application → **Add a policy** (or edit the default).

**Example A — Specific email addresses**

- **Policy name:** `Allow testers`
- **Action:** **Allow**
- **Include** → **Emails** → list addresses (e.g. `you@…`, `teammate@…`).

**Example B — Everyone at your org domain**

- **Include** → **Emails ending in** → `@yourcompany.com`

**Example C — One-time code (no Google/Microsoft)**

- Under **Settings** → **Authentication**, ensure **One-time PIN** (email) is enabled for your Access login experience, or add **Google** / **GitHub** as an identity provider if you want “Sign in with Google.”

**Order:** Put **Allow** policies **above** any **Deny** / catch-all. If nothing matches, Access **denies** by default (good).

---

## Step 4 — Identity providers (first-time setup)

In Zero Trust: **Settings** → **Authentication**.

- **One-time PIN** sends a code to the visitor’s email (simple for a few people).
- For **Google / GitHub / Microsoft**, add the provider and complete OAuth setup so testers can choose that login.

Testers only need **one** working method you enabled.

---

## Step 5 — Test

1. Open a **private/incognito** window.
2. Visit `https://your-domain.org`.
3. You should see the **Cloudflare Access** login, not your normal homepage.
4. After login, the full site should load.

If you still see the site **without** login:

- Confirm DNS for that hostname is **proxied** (orange cloud).
- Confirm the **Application domain** in Access **exactly** matches what you typed in the browser (including `www` vs apex).

---

## GitHub Pages vs Cloudflare Pages (quick notes)

| Hosting | Access works when… |
|--------|---------------------|
| **GitHub Pages** + custom domain on **Cloudflare DNS** with **proxy on** | Yes — Cloudflare sits in front of GitHub. |
| **Cloudflare Pages** + custom domain on same account | Yes — add the **Pages hostname** as the Access application domain. |

If the site is only on `*.github.io` **without** a custom domain on Cloudflare, you **cannot** put Access on that `github.io` hostname (GitHub’s domain). Use your **custom domain** through Cloudflare instead.

---

## Optional: separate public vs private later

When you launch publicly:

1. **Delete** the Access application (or set a policy **Allow** → **Everyone** — not recommended; better to remove the app), **or**
2. Move the beta to a subdomain (e.g. `beta.hallieforanimals.org`) with Access, and leave apex public.

---

## Official references

- [Cloudflare Access documentation](https://developers.cloudflare.com/cloudflare-one/policies/access/)
- [Add a self-hosted application](https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/self-hosted-apps/) (wording may match your dashboard version)

Pricing and free-tier limits: see Cloudflare’s current **Zero Trust / Access** product page.

---

## Checklist

- [ ] **`@` / `www` (or your real web hostnames)** are **proxied** — not only `go` or Workers  
- [ ] Zero Trust application covers **all paths** on that hostname (and `www` if used)  
- [ ] **Allow** policy lists the right people (emails / domain / IdP)  
- [ ] Test in incognito  
- [ ] **Disabled** JS preview passphrase / local override so there’s only one login  
