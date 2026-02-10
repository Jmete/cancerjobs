CREATE TABLE IF NOT EXISTS office_deletion_flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  center_id INTEGER,
  osm_type TEXT NOT NULL,
  osm_id INTEGER NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT,
  FOREIGN KEY (center_id) REFERENCES cancer_centers(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS banned_offices (
  osm_type TEXT NOT NULL,
  osm_id INTEGER NOT NULL,
  approved_flag_id INTEGER,
  approved_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (osm_type, osm_id),
  FOREIGN KEY (approved_flag_id) REFERENCES office_deletion_flags(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_office_deletion_flags_status_submitted
  ON office_deletion_flags(status, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_office_deletion_flags_center
  ON office_deletion_flags(center_id, submitted_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_office_deletion_flags_pending_unique
  ON office_deletion_flags(osm_type, osm_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_banned_offices_approved_at
  ON banned_offices(approved_at DESC);
