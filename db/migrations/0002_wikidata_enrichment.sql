ALTER TABLE offices ADD COLUMN wikidata_entity_id TEXT;
ALTER TABLE offices ADD COLUMN employee_count INTEGER;
ALTER TABLE offices ADD COLUMN employee_count_as_of TEXT;
ALTER TABLE offices ADD COLUMN market_cap REAL;
ALTER TABLE offices ADD COLUMN market_cap_currency_qid TEXT;
ALTER TABLE offices ADD COLUMN market_cap_as_of TEXT;
ALTER TABLE offices ADD COLUMN wikidata_enriched_at TEXT;

CREATE INDEX IF NOT EXISTS idx_offices_wikidata_entity_id
  ON offices(wikidata_entity_id);
CREATE INDEX IF NOT EXISTS idx_offices_wikidata_enriched_at
  ON offices(wikidata_enriched_at);

UPDATE offices
SET wikidata_entity_id = UPPER(TRIM(wikidata))
WHERE wikidata_entity_id IS NULL
  AND wikidata IS NOT NULL
  AND TRIM(wikidata) GLOB 'Q[0-9]*';
