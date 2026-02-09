-- 1) Remove nameless offices and their links.
DELETE FROM center_office
WHERE EXISTS (
  SELECT 1
  FROM offices o
  WHERE o.osm_type = center_office.osm_type
    AND o.osm_id = center_office.osm_id
    AND (o.name IS NULL OR TRIM(o.name) = '')
);

DELETE FROM offices
WHERE name IS NULL OR TRIM(name) = '';

-- 2) Repoint links from duplicate offices to keeper office (if missing).
WITH ranked AS (
  SELECT
    osm_type,
    osm_id,
    LOWER(TRIM(name)) AS normalized_name,
    ROUND(lat, 6) AS rounded_lat,
    ROUND(lon, 6) AS rounded_lon,
    ROW_NUMBER() OVER (
      PARTITION BY LOWER(TRIM(name)), ROUND(lat, 6), ROUND(lon, 6)
      ORDER BY
        CASE WHEN website IS NOT NULL AND TRIM(website) <> '' THEN 1 ELSE 0 END DESC,
        CASE WHEN wikidata IS NOT NULL AND TRIM(wikidata) <> '' THEN 1 ELSE 0 END DESC,
        CASE WHEN brand IS NOT NULL AND TRIM(brand) <> '' THEN 1 ELSE 0 END DESC,
        CASE WHEN operator IS NOT NULL AND TRIM(operator) <> '' THEN 1 ELSE 0 END DESC,
        osm_type ASC,
        osm_id ASC
    ) AS rank_order
  FROM offices
  WHERE name IS NOT NULL AND TRIM(name) <> ''
),
keepers AS (
  SELECT normalized_name, rounded_lat, rounded_lon, osm_type, osm_id
  FROM ranked
  WHERE rank_order = 1
),
duplicates AS (
  SELECT normalized_name, rounded_lat, rounded_lon, osm_type, osm_id
  FROM ranked
  WHERE rank_order > 1
),
duplicate_map AS (
  SELECT
    d.osm_type AS duplicate_osm_type,
    d.osm_id AS duplicate_osm_id,
    k.osm_type AS keeper_osm_type,
    k.osm_id AS keeper_osm_id
  FROM duplicates d
  JOIN keepers k
    ON d.normalized_name = k.normalized_name
   AND d.rounded_lat = k.rounded_lat
   AND d.rounded_lon = k.rounded_lon
)
INSERT INTO center_office (center_id, osm_type, osm_id, distance_m, last_seen)
SELECT
  co.center_id,
  dm.keeper_osm_type,
  dm.keeper_osm_id,
  co.distance_m,
  co.last_seen
FROM center_office co
JOIN duplicate_map dm
  ON co.osm_type = dm.duplicate_osm_type
 AND co.osm_id = dm.duplicate_osm_id
LEFT JOIN center_office existing
  ON existing.center_id = co.center_id
 AND existing.osm_type = dm.keeper_osm_type
 AND existing.osm_id = dm.keeper_osm_id
WHERE existing.center_id IS NULL;

-- 3) Delete duplicate links and duplicate office rows.
WITH ranked AS (
  SELECT
    osm_type,
    osm_id,
    LOWER(TRIM(name)) AS normalized_name,
    ROUND(lat, 6) AS rounded_lat,
    ROUND(lon, 6) AS rounded_lon,
    ROW_NUMBER() OVER (
      PARTITION BY LOWER(TRIM(name)), ROUND(lat, 6), ROUND(lon, 6)
      ORDER BY
        CASE WHEN website IS NOT NULL AND TRIM(website) <> '' THEN 1 ELSE 0 END DESC,
        CASE WHEN wikidata IS NOT NULL AND TRIM(wikidata) <> '' THEN 1 ELSE 0 END DESC,
        CASE WHEN brand IS NOT NULL AND TRIM(brand) <> '' THEN 1 ELSE 0 END DESC,
        CASE WHEN operator IS NOT NULL AND TRIM(operator) <> '' THEN 1 ELSE 0 END DESC,
        osm_type ASC,
        osm_id ASC
    ) AS rank_order
  FROM offices
  WHERE name IS NOT NULL AND TRIM(name) <> ''
),
duplicates AS (
  SELECT osm_type, osm_id
  FROM ranked
  WHERE rank_order > 1
)
DELETE FROM center_office
WHERE EXISTS (
  SELECT 1
  FROM duplicates d
  WHERE d.osm_type = center_office.osm_type
    AND d.osm_id = center_office.osm_id
);

WITH ranked AS (
  SELECT
    osm_type,
    osm_id,
    LOWER(TRIM(name)) AS normalized_name,
    ROUND(lat, 6) AS rounded_lat,
    ROUND(lon, 6) AS rounded_lon,
    ROW_NUMBER() OVER (
      PARTITION BY LOWER(TRIM(name)), ROUND(lat, 6), ROUND(lon, 6)
      ORDER BY
        CASE WHEN website IS NOT NULL AND TRIM(website) <> '' THEN 1 ELSE 0 END DESC,
        CASE WHEN wikidata IS NOT NULL AND TRIM(wikidata) <> '' THEN 1 ELSE 0 END DESC,
        CASE WHEN brand IS NOT NULL AND TRIM(brand) <> '' THEN 1 ELSE 0 END DESC,
        CASE WHEN operator IS NOT NULL AND TRIM(operator) <> '' THEN 1 ELSE 0 END DESC,
        osm_type ASC,
        osm_id ASC
    ) AS rank_order
  FROM offices
  WHERE name IS NOT NULL AND TRIM(name) <> ''
),
duplicates AS (
  SELECT osm_type, osm_id
  FROM ranked
  WHERE rank_order > 1
)
DELETE FROM offices
WHERE EXISTS (
  SELECT 1
  FROM duplicates d
  WHERE d.osm_type = offices.osm_type
    AND d.osm_id = offices.osm_id
);

-- 4) Remove orphan office rows with no links.
DELETE FROM offices
WHERE NOT EXISTS (
  SELECT 1
  FROM center_office co
  WHERE co.osm_type = offices.osm_type
    AND co.osm_id = offices.osm_id
);
