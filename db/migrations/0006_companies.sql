CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_name TEXT NOT NULL,
  company_name_normalized TEXT NOT NULL UNIQUE,
  known_aliases TEXT,
  hq_country TEXT,
  description TEXT,
  type TEXT,
  geography TEXT,
  industry TEXT,
  suitability_tier TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_companies_suitability_tier
  ON companies(suitability_tier);
CREATE INDEX IF NOT EXISTS idx_companies_industry
  ON companies(industry);
