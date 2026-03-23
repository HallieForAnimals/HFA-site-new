// HFA CTA Tracker – with multi-origin CORS already wired

/** GitHub Pages project path from SITE_BASE, e.g. …github.io/site/ → "/site". Empty for apex custom domains. */
function githubProjectPathFromSiteBase(siteBaseStr) {
  try {
    const u = new URL(siteBaseStr);
    if (!u.hostname.endsWith('.github.io')) return '';
    return (u.pathname || '/').replace(/\/+$/, '');
  } catch {
    return '';
  }
}

/** /email/… lives at site root on custom domains; on *.github.io project pages it is under the project path. */
function resolveEmailPublicPath(pathname, siteBaseStr) {
  if (!pathname.startsWith('/email/')) return pathname;
  const withSlash = pathname.endsWith('/') ? pathname : pathname + '/';
  const proj = githubProjectPathFromSiteBase(siteBaseStr);
  if (!proj) return withSlash;
  return proj + withSlash;
}

/** Older KV stored /site/email/… for all hosts; strip /site when SITE_BASE is not a GH project page. */
function stripObsoleteSiteEmailPrefix(pathname, siteBaseStr) {
  if (!pathname.startsWith('/site/email/')) return pathname;
  if (githubProjectPathFromSiteBase(siteBaseStr)) return pathname;
  return pathname.slice('/site'.length);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "");
    const method = request.method;
    const SITE_BASE = (env.SITE_BASE || 'https://hallieforanimals.org/').replace(/\/?$/,'/');
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

    // ---- Public total: tracked mailto clicks via /t/:slug + baseline (historical sends)
    if (method === "GET" && path === "/api/email-sends-total") {
      const baseline = Math.max(
        0,
        parseInt(String(env.EMAIL_SENDS_BASELINE ?? "251050").replace(/,/g, ""), 10) || 251050
      );
      let tracked = 0;
      try {
        const row = await db
          .prepare(
            `SELECT COUNT(*) AS c FROM clicks WHERE lower(COALESCE(url,'')) LIKE 'mailto:%'`
          )
          .first();
        tracked = Math.max(0, Number(row?.c || 0));
      } catch {
        tracked = 0;
      }
      const total = baseline + tracked;
      return json(
        { ok: true, baseline, tracked, total },
        200,
        env,
        request
      );
    }

    // ---- Site visitor beacon: POST /api/beacon  (lightweight page view ping)
    if (method === "POST" && path === "/api/beacon") {
      let b;
      try { b = await request.json(); } catch { return json({ ok: false }, 400, env, request); }
      if (!b || typeof b !== 'object') return json({ ok: false }, 400, env, request);
      const ua = request.headers.get("user-agent") || "";
      const cc = request.cf?.country || "";
      const city = request.cf?.city || "";
      const dev = deviceFromUA(ua);
      try {
        await db.prepare(
          `INSERT INTO events (ts, type, channel, slug, path, ref, ua, ip_hash, cc, city, dev)
           VALUES (?, 'view', 'site', '', ?, ?, ?, '', ?, ?, ?)`
        ).bind(
          Math.floor((b.t || Date.now()) / 1000),
          String(b.p || '/'),
          String(b.r || '').slice(0, 512),
          ua.slice(0, 512),
          cc, city, dev
        ).run();
      } catch { /* best effort */ }
      return json({ ok: true }, 200, env, request);
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

  if (p.startsWith('/email/')) {
    p = resolveEmailPublicPath(p, SITE_BASE);
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
    p = resolveEmailPublicPath(p, SITE_BASE);
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
  let p = stripObsoleteSiteEmailPrefix(dest, SITE_BASE);
  if (p.startsWith('/email/')) p = resolveEmailPublicPath(p, SITE_BASE);
  dest = new URL(p, SITE_BASE).href;
} else if (isHttp) {
  const u = new URL(dest);
  // Legacy: full URL on github.io → same path on SITE_BASE (custom domain)
  if (u.hostname === 'hallieforanimals.github.io' && u.pathname.startsWith('/site/email/')) {
    try {
      const b = new URL(SITE_BASE);
      if (!b.hostname.endsWith('.github.io')) {
        dest = new URL(u.pathname.replace(/^\/site(?=\/email\/)/, ''), SITE_BASE).href;
      } else {
        dest = u.href;
      }
    } catch {
      dest = u.href;
    }
  } else if (u.hostname === 'hallieforanimals.github.io' && !u.pathname.startsWith('/site/')) {
    dest = new URL(u.pathname, SITE_BASE).href;
  }
  // otherwise leave absolute http(s) alone
}
 else if (hasScheme) {
  // mailto:, tel:, sms:, etc. → leave as-is
} else {
  let p = '/' + dest.replace(/^\/+/, '');
  p = stripObsoleteSiteEmailPrefix(p, SITE_BASE);
  if (p.startsWith('/email/')) p = resolveEmailPublicPath(p, SITE_BASE);
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

      const isMailto = /^mailto:/i.test(dest);

      // Light bot skip (still redirect, just don't log)
      if (isLikelyBot(ua)) return isMailto ? mailtoInterstitial(dest, slug, SITE_BASE) : redirect(dest);

      const lat  = parseFloat(cf.latitude) || null;
      const lon  = parseFloat(cf.longitude) || null;
      const dev  = deviceFromUA(ua);

      // Log row
      const ts = Math.floor(Date.now()/1000);
try {
  await db.prepare(
    `INSERT INTO clicks (ts, slug, url, ref, ua, ip_hash, country, region, city, asn, colo, lat, lon, dev)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    ts, slug, String(dest), ref || '', ua, ip_hash,
    country || '', region || '', city || '', asn, colo || '',
    lat, lon, dev
  ).run();
} catch (e) {
  // logging must never block the user
}
return isMailto ? mailtoInterstitial(dest, slug, SITE_BASE) : redirect(dest);

    }

    // ---- Analytics dashboard: GET /api/analytics/dashboard?slug=&range=30d
    //   slug can be comma-separated for multi-slug (caseId) queries
    if (method === "GET" && path === "/api/analytics/dashboard") {
      const slugRaw = (url.searchParams.get("slug") || "").trim();
      const slugList = slugRaw ? slugRaw.split(",").map(s => s.trim()).filter(Boolean) : [];
      const { sinceTs, label } = parseRange(url.searchParams.get("range"));
      let slugWhere = "";
      let slugBinds = [];
      if (slugList.length === 1) {
        slugWhere = " AND slug=?";
        slugBinds = [slugList[0]];
      } else if (slugList.length > 1) {
        slugWhere = ` AND slug IN (${slugList.map(() => "?").join(",")})`;
        slugBinds = slugList;
      }

      const totalRow = await db.prepare(
        `SELECT COUNT(*) AS c FROM clicks WHERE ts>=?${slugWhere}`
      ).bind(sinceTs, ...slugBinds).first();

      const countriesRow = await db.prepare(
        `SELECT COUNT(DISTINCT country) AS c FROM clicks WHERE ts>=? AND country != ''${slugWhere}`
      ).bind(sinceTs, ...slugBinds).first();

      const citiesRow = await db.prepare(
        `SELECT COUNT(DISTINCT city || '|' || country) AS c FROM clicks WHERE ts>=? AND city != ''${slugWhere}`
      ).bind(sinceTs, ...slugBinds).first();

      const devRows = await db.prepare(
        `SELECT COALESCE(dev,'desktop') AS dev, COUNT(*) AS c FROM clicks WHERE ts>=?${slugWhere} GROUP BY dev ORDER BY c DESC`
      ).bind(sinceTs, ...slugBinds).all();
      const devices = {};
      for (const r of (devRows?.results || [])) devices[r.dev || 'desktop'] = r.c;

      const geo = await db.prepare(
        `SELECT ROUND(lat,1) AS lat, ROUND(lon,1) AS lon, city, country, COUNT(*) AS c
         FROM clicks WHERE ts>=? AND lat IS NOT NULL AND lon IS NOT NULL${slugWhere}
         GROUP BY ROUND(lat,1), ROUND(lon,1), city, country ORDER BY c DESC LIMIT 500`
      ).bind(sinceTs, ...slugBinds).all();

      const byCountry = await db.prepare(
        `SELECT country, COUNT(*) AS c FROM clicks WHERE ts>=?${slugWhere} GROUP BY country ORDER BY c DESC LIMIT 100`
      ).bind(sinceTs, ...slugBinds).all();

      const byCity = await db.prepare(
        `SELECT country, city, COUNT(*) AS c FROM clicks WHERE ts>=?${slugWhere} GROUP BY country, city ORDER BY c DESC LIMIT 200`
      ).bind(sinceTs, ...slugBinds).all();

      const daily = await db.prepare(
        `SELECT strftime('%Y-%m-%d', ts, 'unixepoch') AS day, COUNT(*) AS c
         FROM clicks WHERE ts>=?${slugWhere} GROUP BY day ORDER BY day ASC`
      ).bind(sinceTs, ...slugBinds).all();

      const referrers = await db.prepare(
        `SELECT ref, COUNT(*) AS c FROM clicks WHERE ts>=? AND ref != ''${slugWhere} GROUP BY ref ORDER BY c DESC LIMIT 20`
      ).bind(sinceTs, ...slugBinds).all();

      const slugs = await db.prepare(
        `SELECT slug, COUNT(*) AS c FROM clicks WHERE ts>=? GROUP BY slug ORDER BY c DESC`
      ).bind(sinceTs).all();

      // Merge KV-registered slugs so every published CTA appears in the filter
      const clickSlugMap = {};
      for (const r of (slugs?.results || [])) clickSlugMap[r.slug] = r.c;

      if (env.CTA_MAP) {
        try {
          let cursor;
          do {
            const page = await env.CTA_MAP.list({ prefix: "slug:", cursor });
            cursor = page.cursor;
            for (const { name } of page.keys) {
              const s = name.replace(/^slug:/, "");
              if (!(s in clickSlugMap)) clickSlugMap[s] = 0;
            }
          } while (cursor);
        } catch { /* KV read failure shouldn't block the response */ }
      }

      const mergedSlugs = Object.entries(clickSlugMap)
        .map(([slug, count]) => ({ slug, count }))
        .sort((a, b) => b.count - a.count || a.slug.localeCompare(b.slug));

      return json({
        range: label,
        slug: slugRaw || null,
        summary: {
          totalClicks: totalRow?.c || 0,
          uniqueCountries: countriesRow?.c || 0,
          uniqueCities: citiesRow?.c || 0,
          devices
        },
        geo: (geo?.results || []).map(r => ({ lat: r.lat, lon: r.lon, city: r.city, country: r.country, count: r.c })),
        byCountry: (byCountry?.results || []).map(r => ({ country: r.country, count: r.c })),
        byCity: (byCity?.results || []).map(r => ({ country: r.country, city: r.city, count: r.c })),
        dailySeries: (daily?.results || []).map(r => ({ day: r.day, count: r.c })),
        topReferrers: (referrers?.results || []).map(r => ({ ref: r.ref, count: r.c })),
        allSlugs: mergedSlugs
      }, 200, env, request);
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

  // Create tables first
  for (const sql of statements) {
    const trimmed = sql.trim();
    if (!trimmed) continue;
    await db.prepare(trimmed).run();
  }

  // Best-effort patch for existing DBs created before these columns; ignore if already present
  const __addCols = [
    "ALTER TABLE clicks ADD COLUMN url TEXT DEFAULT ''",
    "ALTER TABLE clicks ADD COLUMN ref TEXT DEFAULT ''",
    "ALTER TABLE clicks ADD COLUMN country TEXT DEFAULT ''",
    "ALTER TABLE clicks ADD COLUMN region TEXT DEFAULT ''",
    "ALTER TABLE clicks ADD COLUMN asn INTEGER",
    "ALTER TABLE clicks ADD COLUMN colo TEXT DEFAULT ''",
    "ALTER TABLE clicks ADD COLUMN lat REAL",
    "ALTER TABLE clicks ADD COLUMN lon REAL",
    "ALTER TABLE clicks ADD COLUMN dev TEXT DEFAULT ''"
  ];
  for (const sql of __addCols) {
    try { await db.prepare(sql).run(); } catch {}
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

function mailtoInterstitial(dest, slug, siteBase) {
  const home = String(siteBase || "https://hallieforanimals.org").replace(/\/+$/, "");
  const b64 = btoa(unescape(encodeURIComponent(dest)));
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>HallieForAnimals &ndash; Take action</title>
<link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Baloo 2',system-ui,sans-serif;background:#0b0b17;color:#E5E6EA;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2rem}
.brand{display:flex;align-items:center;gap:0.6rem;margin-bottom:2rem;text-decoration:none;color:#E5E6EA}
.brand img{height:2.5rem}
.brand span{font-size:1.4rem;font-weight:700;letter-spacing:0.02em}
.card{background:#201f3a;border:1px solid #3c3960;border-radius:16px;padding:2rem 2.5rem;max-width:480px;width:100%;text-align:center}
h1{font-size:1.4rem;font-weight:800;margin-bottom:0.75rem}
.lede{color:#B6B8C8;font-size:0.95rem;line-height:1.5;margin-bottom:1.5rem}
.lede strong{color:#E5E6EA}
.actions{display:flex;gap:0.75rem;justify-content:center;flex-wrap:wrap}
.btn-primary{background:#0071D1;color:#fff;font-family:inherit;font-size:0.95rem;font-weight:700;padding:0.65rem 1.6rem;border:none;border-radius:8px;cursor:pointer;text-decoration:none;transition:opacity 0.2s;text-transform:uppercase;letter-spacing:0.04em}
.btn-primary:hover{opacity:0.85}
.btn-outline{background:transparent;color:#0071D1;font-family:inherit;font-size:0.95rem;font-weight:700;padding:0.65rem 1.6rem;border:2px solid #0071D1;border-radius:8px;cursor:pointer;text-decoration:none;transition:opacity 0.2s}
.btn-outline:hover{opacity:0.85}
.footer{margin-top:2rem;font-size:0.75rem;color:#B6B8C8}
.footer a{color:#0071D1;text-decoration:none}
.footer a:hover{text-decoration:underline}
</style>
</head>
<body>
<a href="${home}" class="brand">
  <img src="${home}/assets/img/logo.png" alt="">
  <span>HallieForAnimals</span>
</a>
<div class="card">
  <h1>Opening your email app&hellip;</h1>
  <p class="lede">We&rsquo;ll try to open your mail app with the message ready. If nothing happens, tap <strong>Open email</strong>. When you&rsquo;re done, use <strong>Continue to site</strong> (or we&rsquo;ll send you back after you return to this tab).</p>
  <div class="actions">
    <a id="go" class="btn-primary" href="#">Open email</a>
    <a class="btn-outline" href="${home}">Continue to site</a>
  </div>
</div>
<p class="footer">Powered by <a href="${home}">HallieForAnimals</a></p>
<script>
(function(){
var d=atob("${b64}");
var a=document.getElementById("go");
a.href=d;
setTimeout(function(){window.location.href=d},600);
var h=document.visibilityState;
document.addEventListener("visibilitychange",function(){
  if(document.visibilityState==="visible"&&h==="hidden"){window.location.href="${home}";}
  h=document.visibilityState;
});
})();
</script>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
  });
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

