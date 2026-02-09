PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS cancer_centers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  center_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  tier TEXT,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  country TEXT,
  region TEXT,
  source_url TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  last_csv_sync_token TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS offices (
  osm_type TEXT NOT NULL,
  osm_id INTEGER NOT NULL,
  name TEXT,
  brand TEXT,
  operator TEXT,
  website TEXT,
  wikidata TEXT,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  low_confidence INTEGER NOT NULL DEFAULT 0 CHECK (low_confidence IN (0, 1)),
  tags_json TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (osm_type, osm_id)
);

CREATE TABLE IF NOT EXISTS center_office (
  center_id INTEGER NOT NULL,
  osm_type TEXT NOT NULL,
  osm_id INTEGER NOT NULL,
  distance_m REAL NOT NULL,
  last_seen TEXT NOT NULL,
  PRIMARY KEY (center_id, osm_type, osm_id),
  FOREIGN KEY (center_id) REFERENCES cancer_centers(id) ON DELETE CASCADE,
  FOREIGN KEY (osm_type, osm_id) REFERENCES offices(osm_type, osm_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS refresh_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_centers_active_id ON cancer_centers(is_active, id);
CREATE INDEX IF NOT EXISTS idx_centers_tier ON cancer_centers(tier);
CREATE INDEX IF NOT EXISTS idx_centers_country ON cancer_centers(country);
CREATE INDEX IF NOT EXISTS idx_offices_low_confidence ON offices(low_confidence);
CREATE INDEX IF NOT EXISTS idx_offices_lat_lon ON offices(lat, lon);
CREATE INDEX IF NOT EXISTS idx_center_office_center_id ON center_office(center_id);
CREATE INDEX IF NOT EXISTS idx_center_office_last_seen ON center_office(last_seen);
