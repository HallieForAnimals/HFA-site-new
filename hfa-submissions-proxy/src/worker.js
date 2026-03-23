export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let path = url.pathname;
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
    if (path === "") path = "/";

    // ----- Hallie Command Center: inbox list + file download (Bearer / X-HFA-Inbox-Token) -----
    // Keep all /api/inbox* OPTIONS here so preflight never falls through to form CORS (Content-Type only).
    if (path.startsWith("/api/inbox")) {
      const inboxHdrs = inboxCorsHeaders(request);
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: inboxHdrs });
      }
      if (path === "/api/inbox/file") {
        if (request.method === "GET") {
          return handleInboxFileGet(request, env, inboxHdrs);
        }
        return jsonInbox({ error: "method_not_allowed" }, 405, inboxHdrs);
      }
      if (path === "/api/inbox/item") {
        if (request.method === "DELETE") {
          return handleInboxItemDelete(request, env, inboxHdrs);
        }
        return jsonInbox({ error: "method_not_allowed" }, 405, inboxHdrs);
      }
      if (path === "/api/inbox/bulk-delete") {
        if (request.method === "POST") {
          return handleInboxBulkDelete(request, env, inboxHdrs);
        }
        return jsonInbox({ error: "method_not_allowed" }, 405, inboxHdrs);
      }
      if (path === "/api/inbox") {
        if (request.method === "GET") {
          return handleInboxGet(request, env, inboxHdrs);
        }
        return jsonInbox({ error: "method_not_allowed" }, 405, inboxHdrs);
      }
      return jsonInbox({ error: "not_found", hint: "unknown inbox path" }, 404, inboxHdrs);
    }

    // ----- Hallie auth: user login + management (D1-backed, private) -----
    if (path.startsWith("/api/auth")) {
      const authHdrs = inboxCorsHeaders(request);
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: authHdrs });
      }
      if (path === "/api/auth/login" && request.method === "POST") {
        return handleAuthLogin(request, env, authHdrs);
      }
      if (path === "/api/auth/users" && request.method === "GET") {
        return handleAuthUsersGet(request, env, authHdrs);
      }
      if (path === "/api/auth/users" && request.method === "POST") {
        return handleAuthUsersSave(request, env, authHdrs);
      }
      return jsonInbox({ error: "not_found" }, 404, authHdrs);
    }

    // ----- CORS for browser form POSTs -----
    const origin = request.headers.get("Origin") || "";
    const cors = {
      "Access-Control-Allow-Origin": pickCorsOrigin(origin, env.ALLOWED_ORIGINS),
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400"
    };

    if (request.method === "GET") {
      if (url.pathname === "/turnstile-test") {
        const SECRET = (env.TURNSTILE_SECRET || "").trim();
        const token = url.searchParams.get("t") || "";
        if (!SECRET) {
          return new Response(JSON.stringify({ ok: false, error: "missing-secret-binding" }), {
            status: 500,
            headers: { "content-type": "application/json", ...cors }
          });
        }
        if (!token) {
          return new Response(JSON.stringify({ ok: false, error: "missing-token" }), {
            status: 400,
            headers: { "content-type": "application/json", ...cors }
          });
        }
        const body = new URLSearchParams({ secret: SECRET, response: token });
        const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body
        });
        const j = await r.json();
        return new Response(JSON.stringify(j), {
          headers: { "content-type": "application/json", ...cors }
        });
      }
      return new Response("OK", { status: 200, headers: cors });
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405, headers: cors });
    }

    return handleFormPost(request, env, cors);
  }
};

/**
 * Echo Origin if listed in ALLOWED_ORIGINS, or if it's local dev (any port on localhost / 127.0.0.1).
 * Avoids CORS failures when preview servers pick random ports (e.g. npx serve, VS Code Live Preview).
 */
function pickCorsOrigin(originHeader, envAllowedOriginsCsv) {
  const o = (originHeader || "").trim();
  const allowed = (envAllowedOriginsCsv || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowed.includes(o)) return o;
  try {
    const u = new URL(o);
    if (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) {
      return o;
    }
  } catch (_) {
    /* ignore */
  }
  return "https://hallieforanimals.org";
}

/** CORS for browser fetches from Hallie (localhost / GitHub Pages) with auth headers on GET. */
function inboxCorsHeaders(request) {
  const permitted = new Set(["authorization", "content-type", "x-hfa-inbox-token"]);
  let allowHeaders = "Authorization, Content-Type, X-HFA-Inbox-Token";
  const raw = request && request.headers.get("Access-Control-Request-Headers");
  if (raw) {
    const parts = raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (parts.length && parts.every((h) => permitted.has(h))) {
      allowHeaders = raw.trim();
    }
  }
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": allowHeaders,
    "Access-Control-Max-Age": "86400"
  };
}

function jsonInbox(obj, status, inboxHdrs) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...inboxHdrs }
  });
}

/** Strip invisible chars / line endings that break copy-paste from password managers & editors. */
function normalizeInboxCredential(s) {
  return String(s || "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

/** Bearer token, or same value in X-HFA-Inbox-Token (some clients mangle Authorization on GET). */
function getInboxCredential(request) {
  const auth = (request.headers.get("Authorization") || "").trim();
  const m = /^Bearer\s+([\s\S]+)$/i.exec(auth);
  if (m) return normalizeInboxCredential(m[1]);
  const alt = request.headers.get("X-HFA-Inbox-Token");
  if (alt != null && String(alt).trim() !== "") return normalizeInboxCredential(alt);
  return "";
}

async function handleInboxGet(request, env, inboxHdrs) {
  const db = env.SUBMISSIONS_DB;
  const secret = normalizeInboxCredential(env.INBOX_SECRET || "");
  if (!db) {
    return jsonInbox({ error: "inbox_storage_not_configured", hint: "Add D1 binding SUBMISSIONS_DB" }, 503, inboxHdrs);
  }
  if (!secret) {
    return jsonInbox({ error: "inbox_auth_not_configured", hint: "Set secret INBOX_SECRET on the Worker" }, 503, inboxHdrs);
  }

  const token = getInboxCredential(request);
  if (token !== secret) {
    return jsonInbox(
      {
        error: "unauthorized",
        hint:
          token.length === 0
            ? "No token — use Authorization: Bearer SECRET or header X-HFA-Inbox-Token: SECRET"
            : "Worker INBOX_SECRET does not match — re-run wrangler secret put INBOX_SECRET, paste once, no extra spaces/lines; or try X-HFA-Inbox-Token header in curl.",
        bearer_len: token.length,
        secret_len: secret.length
      },
      401,
      inboxHdrs
    );
  }

  try {
    await ensureSubmissionsSchema(db);
  } catch (e) {
    return jsonInbox({ error: "schema_error", detail: String(e) }, 500, inboxHdrs);
  }

  const url = new URL(request.url);
  let limit = parseInt(url.searchParams.get("limit") || "50", 10);
  if (Number.isNaN(limit) || limit < 1) limit = 50;
  limit = Math.min(200, limit);
  let offset = parseInt(url.searchParams.get("offset") || "0", 10);
  if (Number.isNaN(offset) || offset < 0) offset = 0;

  const totalRow = await db.prepare(`SELECT COUNT(*) AS c FROM submissions`).first();
  const total = totalRow?.c ?? 0;

  const rows = await db
    .prepare(
      `SELECT id, created_at, form_type, route_key, reporter_email, reporter_name, country, city, date_field,
              description, evidence_json, attachment_meta_json, extra_json, mail_sent, mail_detail
         FROM submissions ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .bind(limit, offset)
    .all();

  const origin = new URL(request.url).origin;
  const items = (rows?.results || []).map((r) => enrichInboxItem(rowToApi(r), origin));

  return jsonInbox({ ok: true, items, limit, offset, total }, 200, inboxHdrs);
}

/** Public attachment list: no raw R2 keys; add authenticated download hrefs. */
function enrichInboxItem(item, origin) {
  const atts = Array.isArray(item.attachments) ? item.attachments : [];
  const sid = encodeURIComponent(item.id || "");
  item.attachments = atts.map((a, idx) => ({
    name: a.name,
    type: a.type || "",
    size: a.size || 0,
    stored: !!a.key,
    href: a.key ? `${origin}/api/inbox/file?submissionId=${sid}&idx=${idx}` : null
  }));
  return item;
}

async function handleInboxFileGet(request, env, inboxHdrs) {
  const db = env.SUBMISSIONS_DB;
  const bucket = env.INBOX_UPLOADS;
  const secret = normalizeInboxCredential(env.INBOX_SECRET || "");
  if (!db) {
    return jsonInbox({ error: "inbox_storage_not_configured" }, 503, inboxHdrs);
  }
  if (!secret) {
    return jsonInbox({ error: "inbox_auth_not_configured" }, 503, inboxHdrs);
  }
  if (!bucket) {
    return jsonInbox({ error: "uploads_not_configured", hint: "Bind R2 bucket INBOX_UPLOADS" }, 503, inboxHdrs);
  }

  const token = getInboxCredential(request);
  if (token !== secret) {
    return jsonInbox({ error: "unauthorized" }, 401, inboxHdrs);
  }

  const url = new URL(request.url);
  const submissionId = (url.searchParams.get("submissionId") || "").trim();
  let idx = parseInt(url.searchParams.get("idx") || "", 10);
  if (!submissionId || Number.isNaN(idx) || idx < 0) {
    return jsonInbox({ error: "bad_request", hint: "submissionId and idx (0-based) required" }, 400, inboxHdrs);
  }

  try {
    await ensureSubmissionsSchema(db);
  } catch (e) {
    return jsonInbox({ error: "schema_error", detail: String(e) }, 500, inboxHdrs);
  }

  const row = await db.prepare(`SELECT attachment_meta_json FROM submissions WHERE id = ?`).bind(submissionId).first();
  if (!row) {
    return jsonInbox({ error: "not_found" }, 404, inboxHdrs);
  }

  let meta = [];
  try {
    meta = row.attachment_meta_json ? JSON.parse(row.attachment_meta_json) : [];
  } catch (_) {
    meta = [];
  }
  if (!Array.isArray(meta) || idx >= meta.length) {
    return jsonInbox({ error: "not_found", hint: "attachment index out of range" }, 404, inboxHdrs);
  }

  const entry = meta[idx];
  const key = entry && entry.key;
  if (!key || typeof key !== "string" || !key.startsWith(`inbox/${submissionId}/`)) {
    return jsonInbox({ error: "not_found", hint: "no file stored for this attachment" }, 404, inboxHdrs);
  }

  const obj = await bucket.get(key);
  if (!obj) {
    return jsonInbox({ error: "not_found", hint: "object missing in R2" }, 404, inboxHdrs);
  }

  const ct = obj.httpMetadata?.contentType || entry.type || "application/octet-stream";
  const filename = (entry.name || "download").replace(/[^\w.\- ]+/g, "_").slice(0, 180) || "download";

  const headers = new Headers(inboxHdrs);
  headers.set("content-type", ct);
  headers.set("content-disposition", `inline; filename="${filename}"`);
  headers.set("cache-control", "private, max-age=3600");

  return new Response(obj.body, { status: 200, headers });
}

/** Authenticated DELETE: remove D1 row and any R2 objects under inbox/{submissionId}/. */
async function handleInboxItemDelete(request, env, inboxHdrs) {
  const db = env.SUBMISSIONS_DB;
  const bucket = env.INBOX_UPLOADS;
  const secret = normalizeInboxCredential(env.INBOX_SECRET || "");
  if (!db) {
    return jsonInbox({ error: "inbox_storage_not_configured" }, 503, inboxHdrs);
  }
  if (!secret) {
    return jsonInbox({ error: "inbox_auth_not_configured" }, 503, inboxHdrs);
  }

  const token = getInboxCredential(request);
  if (token !== secret) {
    return jsonInbox({ error: "unauthorized" }, 401, inboxHdrs);
  }

  const url = new URL(request.url);
  const submissionId = (url.searchParams.get("submissionId") || url.searchParams.get("id") || "").trim();
  if (!submissionId) {
    return jsonInbox({ error: "bad_request", hint: "submissionId query parameter required" }, 400, inboxHdrs);
  }

  try {
    await ensureSubmissionsSchema(db);
  } catch (e) {
    return jsonInbox({ error: "schema_error", detail: String(e) }, 500, inboxHdrs);
  }

  const row = await db.prepare(`SELECT attachment_meta_json FROM submissions WHERE id = ?`).bind(submissionId).first();
  if (!row) {
    return jsonInbox({ error: "not_found" }, 404, inboxHdrs);
  }

  let meta = [];
  try {
    meta = row.attachment_meta_json ? JSON.parse(row.attachment_meta_json) : [];
  } catch (_) {
    meta = [];
  }
  if (bucket && Array.isArray(meta)) {
    for (const entry of meta) {
      const key = entry && entry.key;
      if (key && typeof key === "string" && key.startsWith(`inbox/${submissionId}/`)) {
        try {
          await bucket.delete(key);
        } catch (e) {
          console.error("[submissions] R2 delete failed", key, e);
        }
      }
    }
  }

  await db.prepare(`DELETE FROM submissions WHERE id = ?`).bind(submissionId).run();
  return jsonInbox({ ok: true, deleted: submissionId }, 200, inboxHdrs);
}

/** Authenticated POST: delete multiple inbox items at once. Body: { ids: ["id1","id2",...] } */
async function handleInboxBulkDelete(request, env, inboxHdrs) {
  const db = env.SUBMISSIONS_DB;
  const bucket = env.INBOX_UPLOADS;
  const secret = normalizeInboxCredential(env.INBOX_SECRET || "");
  if (!db) return jsonInbox({ error: "inbox_storage_not_configured" }, 503, inboxHdrs);
  if (!secret) return jsonInbox({ error: "inbox_auth_not_configured" }, 503, inboxHdrs);

  const token = getInboxCredential(request);
  if (token !== secret) return jsonInbox({ error: "unauthorized" }, 401, inboxHdrs);

  let body;
  try { body = await request.json(); } catch { return jsonInbox({ error: "bad_json" }, 400, inboxHdrs); }
  const ids = Array.isArray(body && body.ids) ? body.ids.filter(id => typeof id === "string" && id.trim()) : [];
  if (!ids.length) return jsonInbox({ error: "bad_request", hint: "ids array required" }, 400, inboxHdrs);

  try { await ensureSubmissionsSchema(db); } catch (e) {
    return jsonInbox({ error: "schema_error", detail: String(e) }, 500, inboxHdrs);
  }

  const deleted = [];
  for (const submissionId of ids) {
    const row = await db.prepare(`SELECT attachment_meta_json FROM submissions WHERE id = ?`).bind(submissionId).first();
    if (!row) continue;
    let meta = [];
    try { meta = row.attachment_meta_json ? JSON.parse(row.attachment_meta_json) : []; } catch { meta = []; }
    if (bucket && Array.isArray(meta)) {
      for (const entry of meta) {
        const key = entry && entry.key;
        if (key && typeof key === "string" && key.startsWith(`inbox/${submissionId}/`)) {
          try { await bucket.delete(key); } catch { /* best effort */ }
        }
      }
    }
    await db.prepare(`DELETE FROM submissions WHERE id = ?`).bind(submissionId).run();
    deleted.push(submissionId);
  }
  return jsonInbox({ ok: true, deleted, count: deleted.length }, 200, inboxHdrs);
}

/** Stay under Cloudflare ~100 MB Worker request body limit (multipart + fields). */
const MAX_REQUEST_UPLOAD_BYTES = 98 * 1024 * 1024;

function uploadPolicy(routeKey) {
  const k = (routeKey || "").toLowerCase();
  if (k === "memoriam") {
    return { maxFiles: 1, maxPerFile: 35 * 1024 * 1024, maxTotal: 35 * 1024 * 1024 };
  }
  if (k === "cta") {
    return {
      maxFiles: 8,
      maxPerFile: MAX_REQUEST_UPLOAD_BYTES,
      maxTotal: MAX_REQUEST_UPLOAD_BYTES
    };
  }
  if (k === "support") {
    return {
      maxFiles: 6,
      maxPerFile: 35 * 1024 * 1024,
      maxTotal: MAX_REQUEST_UPLOAD_BYTES
    };
  }
  return { maxFiles: 0, maxPerFile: 0, maxTotal: 0 };
}

function extOf(fileName) {
  const fn = String(fileName || "").toLowerCase();
  const m = fn.match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

/** Memoriam: common photo formats (incl. iPhone HEIC/HEIF); exclude SVG uploads for safety. */
const MEMORIAM_IMAGE_EXT = new Set([
  "jpg",
  "jpeg",
  "jfif",
  "pjpeg",
  "png",
  "gif",
  "webp",
  "bmp",
  "heic",
  "heif",
  "avif",
  "tiff",
  "tif"
]);

function memoriamImageMimeOk(mime, fileName) {
  const m = (mime || "").trim().toLowerCase();
  const ext = extOf(fileName);
  if (m.startsWith("image/")) {
    if (m === "image/svg+xml") return false;
    return true;
  }
  if (m === "application/octet-stream" && MEMORIAM_IMAGE_EXT.has(ext)) return true;
  return false;
}

/** When the browser sends an empty type, infer from filename (common on some mobile uploads). */
function uploadMimeOk(routeKey, mime, fileName) {
  const m = (mime || "").trim().toLowerCase();
  const ext = extOf(fileName);
  const k = (routeKey || "").toLowerCase();

  if (m) {
    if (k === "memoriam") {
      return memoriamImageMimeOk(m, fileName);
    }
    if (k === "support") {
      if (m.startsWith("image/")) return true;
      if (m === "application/pdf") return true;
      if (m === "application/octet-stream") {
        return MEMORIAM_IMAGE_EXT.has(ext) || ext === "pdf";
      }
      return false;
    }
    if (k === "cta") {
      if (m.startsWith("image/") || m.startsWith("video/")) return true;
      if (m === "application/pdf") return true;
      if (m === "application/octet-stream") {
        const vid = new Set(["mp4", "webm", "mov", "mkv", "avi", "m4v"]);
        return MEMORIAM_IMAGE_EXT.has(ext) || vid.has(ext) || ext === "pdf";
      }
      return false;
    }
    return false;
  }

  if (k === "memoriam") {
    return MEMORIAM_IMAGE_EXT.has(ext);
  }
  if (k === "support") {
    return MEMORIAM_IMAGE_EXT.has(ext) || ext === "pdf";
  }
  if (k === "cta") {
    const vid = new Set(["mp4", "webm", "mov", "mkv", "avi", "m4v"]);
    return MEMORIAM_IMAGE_EXT.has(ext) || vid.has(ext) || ext === "pdf";
  }
  return false;
}

function guessContentTypeFromName(fileName) {
  const ext = extOf(fileName);
  const map = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    jfif: "image/jpeg",
    pjpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
    heic: "image/heic",
    heif: "image/heif",
    avif: "image/avif",
    tif: "image/tiff",
    tiff: "image/tiff",
    pdf: "application/pdf",
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    mkv: "video/x-matroska",
    avi: "video/x-msvideo",
    m4v: "video/x-m4v"
  };
  return map[ext] || "";
}

function safeFilePart(name) {
  const n = String(name || "file")
    .replace(/[/\\]/g, "_")
    .replace(/[^a-zA-Z0-9._\- ]/g, "_")
    .trim()
    .slice(0, 120);
  return n || "file";
}

function rowToApi(r) {
  let evidence = [];
  let attachmentMeta = [];
  let extra = {};
  try {
    evidence = r.evidence_json ? JSON.parse(r.evidence_json) : [];
  } catch (_) {}
  try {
    attachmentMeta = r.attachment_meta_json ? JSON.parse(r.attachment_meta_json) : [];
  } catch (_) {}
  try {
    extra = r.extra_json ? JSON.parse(r.extra_json) : {};
  } catch (_) {}
  return {
    id: r.id,
    createdAt: r.created_at,
    formType: r.form_type,
    routeKey: r.route_key,
    reporterEmail: r.reporter_email,
    reporterName: r.reporter_name,
    country: r.country,
    city: r.city,
    date: r.date_field,
    description: r.description,
    evidence,
    attachments: attachmentMeta,
    extra,
    mailSent: !!r.mail_sent,
    mailDetail: r.mail_detail || null
  };
}

let __schemaReady;

async function ensureSubmissionsSchema(db) {
  if (__schemaReady) return;
  const statements = [
    `CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      form_type TEXT,
      route_key TEXT,
      reporter_email TEXT,
      reporter_name TEXT,
      country TEXT,
      city TEXT,
      date_field TEXT,
      description TEXT,
      evidence_json TEXT,
      attachment_meta_json TEXT,
      extra_json TEXT,
      mail_sent INTEGER NOT NULL DEFAULT 0,
      mail_detail TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_submissions_created ON submissions (created_at DESC)`
  ];
  for (const sql of statements) {
    await db.prepare(sql).run();
  }
  __schemaReady = true;
}

let __usersSchemaReady = false;
async function ensureUsersSchema(db) {
  if (__usersSchemaReady) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY COLLATE NOCASE,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    first_name TEXT DEFAULT '',
    last_name TEXT DEFAULT '',
    preferred_name TEXT DEFAULT ''
  )`).run();
  __usersSchemaReady = true;
}

async function handleAuthLogin(request, env, hdrs) {
  const db = env.SUBMISSIONS_DB;
  if (!db) return jsonInbox({ error: "db_not_configured" }, 503, hdrs);
  let body;
  try { body = await request.json(); } catch { return jsonInbox({ error: "bad_json" }, 400, hdrs); }
  const username = String(body?.username || "").trim();
  const password = String(body?.password || "");
  if (!username || !password) return jsonInbox({ error: "missing_credentials" }, 400, hdrs);
  try { await ensureUsersSchema(db); } catch (e) {
    return jsonInbox({ error: "schema_error", detail: String(e) }, 500, hdrs);
  }
  const row = await db.prepare(`SELECT * FROM users WHERE username = ?`).bind(username).first();
  if (!row || row.password !== password) {
    return jsonInbox({ error: "invalid_credentials" }, 401, hdrs);
  }
  return jsonInbox({
    ok: true,
    user: {
      username: row.username,
      role: row.role || "user",
      firstName: row.first_name || "",
      lastName: row.last_name || "",
      preferredName: row.preferred_name || ""
    }
  }, 200, hdrs);
}

async function handleAuthUsersGet(request, env, hdrs) {
  const db = env.SUBMISSIONS_DB;
  const secret = normalizeInboxCredential(env.INBOX_SECRET || "");
  if (!db) return jsonInbox({ error: "db_not_configured" }, 503, hdrs);
  if (!secret) return jsonInbox({ error: "auth_not_configured" }, 503, hdrs);
  const token = getInboxCredential(request);
  if (token !== secret) return jsonInbox({ error: "unauthorized" }, 401, hdrs);
  try { await ensureUsersSchema(db); } catch (e) {
    return jsonInbox({ error: "schema_error", detail: String(e) }, 500, hdrs);
  }
  const { results } = await db.prepare(`SELECT username, password, role, first_name, last_name, preferred_name FROM users ORDER BY username`).all();
  const users = (results || []).map(r => ({
    username: r.username,
    password: r.password,
    role: r.role || "user",
    firstName: r.first_name || "",
    lastName: r.last_name || "",
    preferredName: r.preferred_name || ""
  }));
  return jsonInbox({ ok: true, users }, 200, hdrs);
}

async function handleAuthUsersSave(request, env, hdrs) {
  const db = env.SUBMISSIONS_DB;
  const secret = normalizeInboxCredential(env.INBOX_SECRET || "");
  if (!db) return jsonInbox({ error: "db_not_configured" }, 503, hdrs);
  if (!secret) return jsonInbox({ error: "auth_not_configured" }, 503, hdrs);
  const token = getInboxCredential(request);
  if (token !== secret) return jsonInbox({ error: "unauthorized" }, 401, hdrs);
  let body;
  try { body = await request.json(); } catch { return jsonInbox({ error: "bad_json" }, 400, hdrs); }
  const users = Array.isArray(body?.users) ? body.users : [];
  if (!users.length) return jsonInbox({ error: "empty_users_list" }, 400, hdrs);
  if (!users.some(u => u.role === "admin" || u.role === "developer")) {
    return jsonInbox({ error: "must_have_admin", hint: "At least one admin or developer required" }, 400, hdrs);
  }
  try { await ensureUsersSchema(db); } catch (e) {
    return jsonInbox({ error: "schema_error", detail: String(e) }, 500, hdrs);
  }
  const stmts = [db.prepare(`DELETE FROM users`)];
  for (const u of users) {
    const un = String(u.username || "").trim();
    if (!un) continue;
    stmts.push(
      db.prepare(
        `INSERT INTO users (username, password, role, first_name, last_name, preferred_name) VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(
        un, String(u.password ?? ""), String(u.role || "user"),
        String(u.firstName ?? ""), String(u.lastName ?? ""), String(u.preferredName ?? "")
      )
    );
  }
  await db.batch(stmts);
  return jsonInbox({ ok: true, count: users.length }, 200, hdrs);
}

async function handleFormPost(request, env, cors) {
  let data = {};
  let files = [];
  const ct = request.headers.get("Content-Type") || "";

  try {
    if (ct.includes("multipart/form-data")) {
      const fd = await request.formData();
      data = {};
      for (const [key, value] of fd.entries()) {
        if (typeof value === "string") {
          data[key] = value;
        } else if (value && typeof value === "object" && typeof value.arrayBuffer === "function") {
          const k = key.toLowerCase();
          if (k === "files" || k === "photos") {
            files.push(value);
          }
        }
      }
    } else if (ct.includes("application/json")) {
      data = await request.json();
    } else {
      data = await request.json();
    }
  } catch (err) {
    return json({ error: "Bad request body" }, 400, cors);
  }

  const reporterEmail = (str(data.reporterEmail) || str(data.email)).trim();
  const reporterName = (str(data.reporterName) || str(data.name) || str(data.petName)).trim();
  const country = (str(data.country) || str(data.countryName)).trim();
  const city = (str(data.city) || str(data.location) || str(data.cityTown)).trim();
  const dateField = (str(data.date) || str(data.dateOfIncident) || str(data.dateOfLoss)).trim();
  const description = (
    str(data.description) ||
    str(data.message) ||
    str(data.story)
  )
    .trim()
    .slice(0, 8000);

  let evidence = [];
  if (Array.isArray(data.evidence)) {
    evidence = data.evidence.slice(0, 25);
  } else if (typeof data.evidence === "string" && data.evidence.trim()) {
    evidence = data.evidence.split(/\r?\n/).slice(0, 25);
  } else if (typeof data.evidenceUrls === "string" && data.evidenceUrls.trim()) {
    evidence = data.evidenceUrls.split(/\r?\n/).slice(0, 25);
  }

  if (str(data.website)) {
    return json({ ok: true }, 200, cors);
  }

  const token =
    str(data["cf-turnstile-response"]) ||
    str(data.turnstileToken) ||
    str(data.token) ||
    str(data.response);

  if (!token) {
    return json({ error: "Captcha missing" }, 400, cors);
  }

  const SECRET = (env.TURNSTILE_SECRET || "").trim();
  if (!SECRET) {
    return json({ error: "missing-secret-binding" }, 500, cors);
  }

  const verifyRes = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      secret: SECRET,
      response: token,
      remoteip: request.headers.get("CF-Connecting-IP") || ""
    })
  });

  const verify = await verifyRes.json().catch(() => ({}));
  if (!verify.success) {
    return json({ error: "Captcha verification failed", detail: verify }, 400, cors);
  }

  const routeKey = (str(data.route) || str(data.formType) || "general").toLowerCase();
  const formType = str(data.formType).trim().toLowerCase();

  const extraJson = JSON.stringify({
    topic: str(data.topic),
    petName: str(data.petName),
    species: str(data.species),
    yearFrom: str(data.yearFrom),
    yearTo: str(data.yearTo),
    years: str(data.years),
    handle: str(data.handle),
    subjectRaw: str(data.subjectRaw),
    platform: str(data.platform),
    scamHandle: str(data.scamHandle),
    other: str(data.other),
    consentTruth: data.consentTruth,
    consentShare: data.consentShare,
    consentPrivacy: data.consentPrivacy,
    consentReply: data.consentReply,
    consentRights: data.consentRights
  });

  const rk = routeKey;
  const db = env.SUBMISSIONS_DB;
  const bucket = env.INBOX_UPLOADS;
  if (!db) {
    return json(
      {
        error: "storage_not_configured",
        hint: "Bind D1 database SUBMISSIONS_DB on this Worker."
      },
      500,
      cors
    );
  }

  const policy = uploadPolicy(rk);
  if (files.length > policy.maxFiles) {
    return json({ error: "too_many_files", max: policy.maxFiles, route: rk }, 400, cors);
  }
  if (files.length > 0 && policy.maxFiles === 0) {
    return json({ error: "attachments_not_allowed", route: rk }, 400, cors);
  }
  if (rk === "memoriam" && files.length < 1) {
    return json({ error: "photo_required", hint: "In memoriam requires one image upload." }, 400, cors);
  }

  const filesSlice = files.slice(0, policy.maxFiles);
  if (filesSlice.length > 0 && !bucket) {
    return json(
      {
        error: "uploads_not_configured",
        hint: "Create an R2 bucket and add [[r2_buckets]] binding INBOX_UPLOADS in wrangler.toml. See FORMS-WIRING.md."
      },
      503,
      cors
    );
  }

  const id = crypto.randomUUID();
  const createdAt = Math.floor(Date.now() / 1000);
  const mailDetail = "inbox_only";

  let totalBytes = 0;
  const attachmentMeta = [];
  for (let i = 0; i < filesSlice.length; i++) {
    const f = filesSlice[i];
    const mt = (f.type || "").trim().toLowerCase();
    if (!uploadMimeOk(rk, mt, f.name)) {
      return json(
        {
          error: "unsupported_file_type",
          name: f.name || "",
          mime: mt || "(empty)",
          route: rk
        },
        400,
        cors
      );
    }
    const sz = f.size || 0;
    if (sz > policy.maxPerFile) {
      return json(
        {
          error: "file_too_large",
          maxMb: Math.ceil(policy.maxPerFile / (1024 * 1024)),
          name: f.name || ""
        },
        400,
        cors
      );
    }
    totalBytes += sz;
    if (totalBytes > policy.maxTotal) {
      return json(
        {
          error: "upload_total_too_large",
          maxTotalMb: Math.floor(policy.maxTotal / (1024 * 1024))
        },
        400,
        cors
      );
    }
    const key = `inbox/${id}/${i}-${safeFilePart(f.name)}`;
    const storedType =
      (f.type && f.type.trim()) || guessContentTypeFromName(f.name) || "application/octet-stream";
    try {
      const buf = await f.arrayBuffer();
      await bucket.put(key, buf, {
        httpMetadata: { contentType: storedType }
      });
    } catch (e) {
      console.error("[submissions] R2 put failed", e);
      return json({ error: "upload_failed", detail: String(e) }, 500, cors);
    }
    attachmentMeta.push({
      name: f.name || "file",
      type: storedType === "application/octet-stream" ? "" : storedType,
      size: f.size || 0,
      key
    });
  }

  const attachmentMetaJson = JSON.stringify(attachmentMeta);

  try {
    await ensureSubmissionsSchema(db);
    await db
      .prepare(
        `INSERT INTO submissions (
            id, created_at, form_type, route_key, reporter_email, reporter_name, country, city, date_field,
            description, evidence_json, attachment_meta_json, extra_json, mail_sent, mail_detail
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        createdAt,
        formType || null,
        rk,
        reporterEmail || null,
        reporterName || null,
        country || null,
        city || null,
        dateField || null,
        description || null,
        JSON.stringify(evidence),
        attachmentMetaJson,
        extraJson,
        0,
        mailDetail
      )
      .run();
  } catch (e) {
    console.error("[submissions] D1 insert failed", e);
    return json({ error: "storage_failed", detail: String(e) }, 500, cors);
  }

  return json({ ok: true, id, stored: true, mailSent: false }, 200, cors);
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers }
  });
}
const str = (v) => (v == null ? "" : String(v));
