// HFA CTA Tracker – with multi-origin CORS already wired

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "");
    const method = request.method;
    const SITE_BASE = (env.SITE_BASE || 'https://hallieforanimals.github.io/site/').replace(/\/?$/,'/');
    const db = env.hfa_cta_tracker;


    // CORS preflight
    if (method === "OPTIONS") return corsPreflight(env, request);

    // Ensure events table exists, but never block redirects if D1 is down
try {
  await ensureSchema(db);
} catch (e) {
  // swallow – we still want redirects to work
}


    // ---- Analytics API: GET /api/events?from=YYYY-MM-DD&to=YYYY-MM-DD
    if (method === "GET" && path === "/api/events") {
      const from = url.searchParams.get("from");
      const to   = url.searchParams.get("to");
      if (!from || !to) return json([], 200, env, request);
      const { start, end } = dayToUnixRange(from, to);

      // 1) events table (views, pings, email opens, site clicks)
      const ev = await db.prepare(
        `SELECT ts, type, channel, slug, path, ref, cc, city, dev, sid, pid, active_ms, el
           FROM events WHERE ts BETWEEN ? AND ?`
      ).bind(start, end).all();

      const eventsRows = ev?.results || [];

      // 2) clicks table → map to unified event format (type='click', channel='shortlink')
      const clicks = await db.prepare(
        `SELECT ts, slug, ref, ua, country AS cc, city
           FROM clicks WHERE ts BETWEEN ? AND ?`
      ).bind(start, end).all();

      const clickRows = (clicks?.results || []).map(r => ({
        ts: r.ts,
        type: "click",
        channel: "shortlink",
        slug: r.slug || "",
        path: `/s/${r.slug || ""}`,
        ref: r.ref || "",
        cc: r.cc || "",
        city: r.city || "",
        dev: deviceFromUA(r.ua || ""),
        sid: "",
        pid: "",
        active_ms: 0,
        el: ""
      }));

      // Combine & return
      const out = eventsRows.concat(clickRows);
      return json(out, 200, env, request);
    }

    // ---- Page beacon: POST /t  (JSON body)
    if (method === "POST" && path === "/t") {
      let e;
      try { e = await request.json(); } catch { return json({ ok:false, error:"bad-json" }, 400, env, request); }
      const ts   = Number(e.ts) || Math.floor(Date.now()/1000);
      const ua   = request.headers.get("user-agent") || "";
      const ref  = e.ref || request.headers.get("referer") || "";
      const cc   = request.cf?.country || "";
      const city = request.cf?.city || "";
      const dev  = e.dev || deviceFromUA(ua);

      await db.prepare(
        `INSERT INTO events (ts, type, channel, slug, path, ref, cc, city, dev, sid, pid, active_ms, el)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        ts,
        String(e.type || "view"),
        String(e.channel || "site"),
        String(e.slug || ""),
        String(e.path || ""),
        String(ref || ""),
        String(cc || ""),
        String(city || ""),
        String(dev || ""),
        String(e.sid || ""),
        String(e.pid || ""),
        Number(e.active_ms || 0),
        String(e.el || "")
      ).run();

      return json({ ok:true }, 200, env, request);
    }

    // ---- Email pixel: GET /t.gif?t=open&c=email&s=<slug>&p=<path>
    if (method === "GET" && path === "/t.gif") {
      const ts   = Math.floor(Date.now()/1000);
      const t    = url.searchParams.get("t") || "open";
      const ch   = url.searchParams.get("c") || "email";
      const slug = url.searchParams.get("s") || "";
      const pth  = url.searchParams.get("p") || "/email";
      const ua   = request.headers.get("user-agent") || "";
      const ref  = request.headers.get("referer") || "";
      const cc   = request.cf?.country || "";
      const city = request.cf?.city || "";
      const dev  = deviceFromUA(ua);

      await db.prepare(
        `INSERT INTO events (ts, type, channel, slug, path, ref, cc, city, dev)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(ts, t, ch, slug, pth, ref, cc, city, dev).run();

      // 1x1 transparent GIF
      const gif = Uint8Array.from([71,73,70,56,57,97,1,0,1,0,128,0,0,0,0,0,0,0,0,33,249,4,1,0,0,1,0,44,0,0,0,0,1,0,1,0,0,2,2,68,1,0,59]);
      return new Response(gif, {
        headers: {
          "Content-Type": "image/gif",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": pickCorsOrigin(env, request),
          "Vary": "origin"
        }
      });
    }


     // ---- KV proxy: /api/kv/slug/:slug  (PUT to write, GET to read)
if (path.startsWith("/api/kv/slug/")) {
  const slug = decodeURIComponent(path.slice("/api/kv/slug/".length)).trim();
  if (!slug) return json({ error: "Missing slug" }, 400, env, request);

  if (method === "PUT") {
    let body; try { body = await request.json(); } catch {}
    const target = body?.url?.toString?.().trim();
    if (!target) return json({ error: "Missing url" }, 400, env, request);

// Accept full URLs or bare paths; store path-only for our own hosts
let incoming = (body?.url || '').trim();
let toStore = incoming;

// If it's a non-http(s) scheme (mailto:, tel:, sms:, etc.), just store as-is.
if (/^[a-zA-Z][a-zA-Z0-9+.\-]*:/.test(incoming) && !/^https?:/i.test(incoming)) {
  await env.CTA_MAP.put(`slug:${slug}`, incoming);
  return json({ ok:true, slug, stored: incoming }, 200, env, request);
}

try {
  const u = new URL(incoming, SITE_BASE); // tolerate bare path
const own = new Set(['hallieforanimals.org','hallieforanimals.github.io']);
if (own.has(u.hostname)) {
  // keep path AS-IS (do NOT force a trailing slash for .html routes)
  let p = u.pathname;

  // normalize GH Pages email pages to /site prefix; keep trailing slash for /email/… pages only
  if (p.startsWith('/email/')) {
    p = '/site' + (p.endsWith('/') ? p : (p + '/'));
  }

  // 👇 PRESERVE the fragment
  const h = u.hash || '';  // e.g. "#my-slug"
  toStore = p + h;         // store path + hash
}

} catch {
  if (!incoming.startsWith('/')) return json({ ok:false, error:'bad url' }, 400, env, request);

  // Split path + hash manually to preserve it
  const hashIdx = incoming.indexOf('#');
  const rawPath = hashIdx >= 0 ? incoming.slice(0, hashIdx) : incoming;
  const rawHash = hashIdx >= 0 ? incoming.slice(hashIdx)    : '';

  let p = rawPath; // do NOT force a trailing slash for .html routes
  if (p.startsWith('/email/')) {
    p = '/site' + (p.endsWith('/') ? p : (p + '/'));  // only /email/... keeps trailing slash
  }

  toStore = p + rawHash;  // path + hash
}


    await env.CTA_MAP.put(`slug:${slug}`, toStore);
    return json({ ok:true, slug, stored: toStore }, 200, env, request);
  }

  if (method === "GET") {
    const value = await env.CTA_MAP.get(`slug:${slug}`);
    return json({ ok: true, slug, url: value || null }, 200, env, request);
  }

    if (method === "DELETE") {
    await env.CTA_MAP.delete(`slug:${slug}`);
    return json({ ok: true, slug }, 200, env, request);
  }


  return json({ error: "Method not allowed" }, 405, env, request);
}


    // ---- KV list/search: GET /api/kv/list?q=<prefix>&with=dest
if (path === "/api/kv/list" && method === "GET") {
  const q = url.searchParams.get("q") || "";       // prefix filter
  const withDest = url.searchParams.get("with") === "dest";

  const items = [];
  let cursor;
  do {
    const page = await env.CTA_MAP.list({ prefix: q ? `slug:${q}` : "slug:", cursor });
    cursor = page.cursor;
    for (const { name } of page.keys) {
      const slug = name.replace(/^slug:/, "");
      if (withDest) {
        const dest = await env.CTA_MAP.get(name);
        items.push({ slug, destination: dest || null });
      } else {
        items.push({ slug });
      }
    }
  } while (cursor);

  return json({ ok: true, items }, 200, env, request);
}



    // ---- Track & redirect: GET /t/:slug[?to=https://...]
    if (method === "GET" && path.startsWith("/t/")) {
      const slug = decodeURIComponent(path.split("/").pop() || "").trim();
      if (!slug) return json({ error: "Missing slug" }, 400, env, request);

      // Destination: ?to=… > KV > hard default to GH Pages shortlink page
let dest = url.searchParams.get("to");
if (!dest && env.CTA_MAP) dest = await env.CTA_MAP.get(`slug:${slug}`);
// hard fallback: always send to GH Pages shortlink page
if (!dest) dest = new URL(`email/${slug}/`, SITE_BASE).href;


      // Build absolute URL from stored path using SITE_BASE
// after: let dest = <from ?to or KV>
// --- Normalize destination without breaking mailto:/tel:/etc.
const isHttp = /^https?:\/\//i.test(dest);
const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.\-]*:/.test(dest);

if (dest.startsWith('/')) {
  // path → make absolute against SITE_BASE
  let p = dest;
  // ensure GH Pages '/site' prefix for email shortlink pages
  if (p.startsWith('/email/')) p = '/site' + p;
  dest = new URL(p, SITE_BASE).href;
} else if (isHttp) {
  // absolute http(s): if it's a github.io host without /site, re-host on SITE_BASE
  const u = new URL(dest);
  if (u.hostname === 'hallieforanimals.github.io' && !u.pathname.startsWith('/site/')) {
    dest = new URL(u.pathname, SITE_BASE).href;
  }
  // otherwise leave absolute http(s) alone
}
 else if (hasScheme) {
  // mailto:, tel:, sms:, etc. → leave as-is
} else {
  // bare pathish string → treat as site-relative
  let p = ('/' + dest.replace(/^\/+/, ''));
  if (p.startsWith('/email/')) p = '/site' + p;
  dest = new URL(p, SITE_BASE).href;
}

      // Geo/meta
      const cf = request.cf || {};
      const country = cf.country || null;
      const region  = cf.region  || null;
      const city    = cf.city    || null;
      const asn     = Number(cf.asn) || null;
      const colo    = cf.colo    || null;

      const ua  = request.headers.get("user-agent") || "";
      const ref = request.headers.get("referer") || null;

      // Privacy-friendly IP hash (per-day salt)
      const ip      = request.headers.get("cf-connecting-ip") || "";
      const day     = new Date().toISOString().slice(0,10);
      const ip_hash = await sha256(`${ip}|${day}|${slug}`);

      // Light bot skip (still redirect, just don't log)
      if (isLikelyBot(ua)) return redirect(dest);

      // Log row
      const ts = Math.floor(Date.now()/1000);
try {
  await db.prepare(
    `INSERT INTO clicks (ts, slug, url, ref, ua, ip_hash, country, region, city, asn, colo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    ts, slug, String(dest), ref || '', ua, ip_hash,
    country || '', region || '', city || '', asn, colo || ''
  ).run();
} catch (e) {
  // logging must never block the user
}
return redirect(dest);

    }

    // ---- Per-CTA stats: GET /stats/:slug?range=30d
    if (method === "GET" && path.startsWith("/stats/")) {
      const slug = decodeURIComponent(path.split("/").pop() || "").trim();
      if (!slug) return json({ error: "Missing slug" }, 400, env, request);
      const { sinceTs, label } = parseRange(url.searchParams.get("range"));

      const total = await db.prepare(
        `SELECT COUNT(*) AS c FROM clicks WHERE slug=? AND ts>=?`
      ).bind(slug, sinceTs).first();

      const byCountry = await db.prepare(
        `SELECT country, COUNT(*) AS c FROM clicks
         WHERE slug=? AND ts>=? GROUP BY country ORDER BY c DESC LIMIT 100`
      ).bind(slug, sinceTs).all();

      const byCity = await db.prepare(
        `SELECT country, city, COUNT(*) AS c FROM clicks
         WHERE slug=? AND ts>=? GROUP BY country, city ORDER BY c DESC LIMIT 200`
      ).bind(slug, sinceTs).all();

      const referrers = await db.prepare(
        `SELECT ref, COUNT(*) AS c FROM clicks
         WHERE slug=? AND ts>=? GROUP BY ref ORDER BY c DESC LIMIT 20`
      ).bind(slug, sinceTs).all();

      return json({
        slug, range: label,
        total: total?.c || 0,
        byCountry: byCountry?.results || [],
        byCity: byCity?.results || [],
        topReferrers: referrers?.results || []
      }, 200, env, request);
    }

    // ---- All slugs totals: GET /stats-all?range=30d
    if (method === "GET" && path === "/stats-all") {
      const { sinceTs, label } = parseRange(url.searchParams.get("range"));
      const rows = await db.prepare(
        `SELECT slug, COUNT(*) AS c FROM clicks
         WHERE ts>=? GROUP BY slug ORDER BY c DESC`
      ).bind(sinceTs).all();
      return json({ range: label, slugs: rows?.results || [] }, 200, env, request);
    }

    // ---- Daily series: GET /stats-daily/:slug?days=30
    if (method === "GET" && path.startsWith("/stats-daily/")) {
      const slug = decodeURIComponent(path.split("/").pop() || "").trim();
      const days = clampInt(url.searchParams.get("days"), 1, 365, 30);
      const sinceTs = Math.floor(Date.now()/1000) - days*86400;
      const series = await db.prepare(
        `SELECT strftime('%Y-%m-%d', ts, 'unixepoch') AS day, COUNT(*) AS c
         FROM clicks WHERE slug=? AND ts>=? GROUP BY day ORDER BY day ASC`
      ).bind(slug, sinceTs).all();
      return json({ slug, days, series: series?.results || [] }, 200, env, request);
    }

    return json({ ok: true, message: "HFA CTA tracker online" }, 200, env, request);
  }
};

/* ========= HFA Analytics additions ========= */

let __schemaReady; // per-isolate memoization

async function ensureSchema(db) {
  if (__schemaReady) return; // avoid re-running in warm isolates

  // Each statement must be standalone AND non-empty
  const statements = [
    `CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      type TEXT NOT NULL,           -- view | click | ping | open
      channel TEXT NOT NULL,        -- site | email
      slug TEXT DEFAULT '',
      path TEXT DEFAULT '',
      ref TEXT DEFAULT '',
      ua TEXT DEFAULT '',
      ip_hash TEXT DEFAULT '',
      cc TEXT DEFAULT '',
      city TEXT DEFAULT '',
      dev TEXT DEFAULT '',
      sid TEXT DEFAULT '',
      pid TEXT DEFAULT '',
      active_ms INTEGER DEFAULT 0,
      el TEXT DEFAULT ''
    )`,

    `CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts)`,
    `CREATE INDEX IF NOT EXISTS idx_events_type ON events(type)`,
    `CREATE INDEX IF NOT EXISTS idx_events_slug ON events(slug)`,

    `CREATE TABLE IF NOT EXISTS clicks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  slug TEXT NOT NULL,
  url TEXT NOT NULL,
  ref TEXT DEFAULT '',
  ua TEXT DEFAULT '',
  ip_hash TEXT DEFAULT '',
  country TEXT DEFAULT '',
  region TEXT DEFAULT '',
  city TEXT DEFAULT '',
  asn INTEGER,
  colo TEXT DEFAULT ''
)`,


    `CREATE INDEX IF NOT EXISTS idx_clicks_ts ON clicks(ts)`,
    `CREATE INDEX IF NOT EXISTS idx_clicks_slug ON clicks(slug)`
  ];

  // Best-effort patch for existing DBs; ignore if columns already exist
const __addCols = [
  "ALTER TABLE clicks ADD COLUMN ref TEXT DEFAULT ''",
  "ALTER TABLE clicks ADD COLUMN country TEXT DEFAULT ''",
  "ALTER TABLE clicks ADD COLUMN region TEXT DEFAULT ''",
  "ALTER TABLE clicks ADD COLUMN asn INTEGER",
  "ALTER TABLE clicks ADD COLUMN colo TEXT DEFAULT ''"
];
for (const sql of __addCols) {
  try { await db.prepare(sql).run(); } catch {}
}


  // Run sequentially; don't use db.batch and don't pass multi-statement strings
  for (const sql of statements) {
    const trimmed = sql.trim();
    if (!trimmed) continue;
    await db.prepare(trimmed).run();
  }

  __schemaReady = true;
}


function deviceFromUA(ua=""){
  const u = ua.toLowerCase();
  if (u.includes("bot") || u.includes("spider") || u.includes("crawl")) return "bot";
  if (u.includes("mobile")) return "mobile";
  if (u.includes("tablet") || u.includes("ipad")) return "tablet";
  return "desktop";
}

function dayToUnixRange(fromISO, toISO){
  const start = Math.floor(new Date(fromISO + "T00:00:00Z").getTime()/1000);
  const end   = Math.floor(new Date(toISO   + "T23:59:59Z").getTime()/1000);
  return { start, end };
}
/* ======== end analytics additions ======== */


/* ---------------- helpers (already integrated) ---------------- */

function clampInt(v, min, max, dflt){ v = parseInt(v||dflt,10); return Math.min(max, Math.max(min, isNaN(v)?dflt:v)); }

function parseRange(r) {
  const now = Math.floor(Date.now()/1000);
  const m = /^\s*(\d+)\s*d\s*$/i.exec(r||"");
  const days = m ? parseInt(m[1],10) : 30;
  return { sinceTs: now - days*86400, label: `${days}d` };
}

function redirect(url) {
  return new Response(null, { status: 302, headers: { Location: url } });
}

// somewhere near top-level helpers
function pickCorsOrigin(env, request) {
  const origin = request.headers.get("Origin");
  let allowed = [];
  try { allowed = JSON.parse(env.ALLOWED_ORIGINS || "[]"); } catch {}
  if (origin && allowed.includes(origin)) return origin;
  // desktop app / file:// / curl → no Origin header; allow wildcard
  return "*";
}


function corsPreflight(env, request) {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": pickCorsOrigin(env, request),
      "Access-Control-Allow-Methods": "GET, PUT, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, authorization",
      "Access-Control-Max-Age": "86400",
      "Vary": "origin"
    }
  });
}

function json(data, status = 200, env, request) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": pickCorsOrigin(env, request),
      "Access-Control-Allow-Headers": "content-type, authorization",
      "Vary": "origin"
    }
  });
}


function isLikelyBot(ua) {
  const n = ["bot","crawler","spider","slurp","headless","phantom","preview"];
  const l = ua.toLowerCase();
  return n.some(x => l.includes(x));
}

async function sha256(str){
  const bytes = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,"0")).join("");
}

