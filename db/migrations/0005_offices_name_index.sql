CREATE INDEX IF NOT EXISTS idx_offices_name_nocase
  ON offices(name COLLATE NOCASE);
