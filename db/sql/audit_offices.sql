SELECT 'offices_total' AS metric, COUNT(*) AS value
FROM offices;

SELECT 'nameless_offices' AS metric, COUNT(*) AS value
FROM offices
WHERE name IS NULL OR TRIM(name) = '';

SELECT 'duplicate_offices_by_name_coords' AS metric,
       COALESCE(SUM(group_size - 1), 0) AS value
FROM (
  SELECT COUNT(*) AS group_size
  FROM offices
  WHERE name IS NOT NULL AND TRIM(name) <> ''
  GROUP BY LOWER(TRIM(name)), ROUND(lat, 6), ROUND(lon, 6)
  HAVING COUNT(*) > 1
);

SELECT 'center_office_links_total' AS metric, COUNT(*) AS value
FROM center_office;

SELECT 'orphan_offices_without_links' AS metric, COUNT(*) AS value
FROM offices o
WHERE NOT EXISTS (
  SELECT 1
  FROM center_office co
  WHERE co.osm_type = o.osm_type
    AND co.osm_id = o.osm_id
);
