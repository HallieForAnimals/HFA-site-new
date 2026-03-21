-- One row per click
CREATE TABLE IF NOT EXISTS clicks (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        INTEGER NOT NULL,          -- unix seconds
  slug      TEXT NOT NULL,
  country   TEXT,
  region    TEXT,
  city      TEXT,
  asn       INTEGER,
  colo      TEXT,
  ref       TEXT,
  ua        TEXT,
  ip_hash   TEXT                       -- per-day salted hash (privacy)
);

CREATE INDEX IF NOT EXISTS idx_clicks_slug_ts ON clicks (slug, ts);
CREATE INDEX IF NOT EXISTS idx_clicks_country ON clicks (country);
CREATE INDEX IF NOT EXISTS idx_clicks_city ON clicks (city);
