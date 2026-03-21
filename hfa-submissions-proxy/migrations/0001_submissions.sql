-- Form submissions stored for Hallie Command Center (GET /api/inbox)
CREATE TABLE IF NOT EXISTS submissions (
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
);

CREATE INDEX IF NOT EXISTS idx_submissions_created ON submissions (created_at DESC);
