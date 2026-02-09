import type {
  CancerCenter,
  CenterOffice,
  CsvCenterRow,
  SqlDatabase,
  SqlPreparedStatement,
  Office,
} from "./types";
import { chunk } from "./utils";

const REFRESH_CURSOR_KEY = "center_cursor";

interface CenterRecord {
  id: number;
  center_code: string;
  name: string;
  tier: string | null;
  lat: number;
  lon: number;
  country: string | null;
  region: string | null;
  source_url: string | null;
  is_active: number;
}

interface OfficeRecord {
  osmType: Office["osmType"];
  osmId: number;
  name: string | null;
  brand: string | null;
  operator: string | null;
  website: string | null;
  wikidata: string | null;
  wikidataEntityId: string | null;
  employeeCount: number | null;
  employeeCountAsOf: string | null;
  marketCap: number | null;
  marketCapCurrencyQid: string | null;
  marketCapAsOf: string | null;
  wikidataEnrichedAt: string | null;
  lat: number;
  lon: number;
  lowConfidence: number;
  tagsJson: string | null;
  distanceM: number;
}

interface CountRecord {
  count: number | string;
}

function normalizeOfficeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function toLikePrefix(value: string): string {
  return `${value.replace(/[\\%_]/g, "\\$&")}%`;
}

function officeCoordinatesKey(lat: number, lon: number): string {
  return `${lat.toFixed(6)}|${lon.toFixed(6)}`;
}

function toCount(value: number | string | undefined): number {
  const parsed =
    typeof value === "number" ? value : Number.parseInt(String(value ?? 0), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

function toCenter(record: CenterRecord): CancerCenter {
  return {
    id: record.id,
    centerCode: record.center_code,
    name: record.name,
    tier: record.tier,
    lat: record.lat,
    lon: record.lon,
    country: record.country,
    region: record.region,
    sourceUrl: record.source_url,
    isActive: record.is_active === 1,
  };
}

export async function listCenters(
  db: SqlDatabase,
  options: { tier?: string; activeOnly?: boolean }
): Promise<CancerCenter[]> {
  const activeOnly = options.activeOnly ?? true;
  const statements: string[] = [
    "SELECT id, center_code, name, tier, lat, lon, country, region, source_url, is_active",
    "FROM cancer_centers",
    "WHERE 1 = 1",
  ];
  const bindings: unknown[] = [];

  if (activeOnly) {
    statements.push("AND is_active = 1");
  }

  if (options.tier) {
    statements.push("AND tier = ?");
    bindings.push(options.tier);
  }

  statements.push("ORDER BY name ASC");

  const result = await db
    .prepare(statements.join("\n"))
    .bind(...bindings)
    .all<CenterRecord>();

  return (result.results ?? []).map(toCenter);
}

export async function getCenterById(
  db: SqlDatabase,
  centerId: number
): Promise<CancerCenter | null> {
  const row = await db
    .prepare(
      [
        "SELECT id, center_code, name, tier, lat, lon, country, region, source_url, is_active",
        "FROM cancer_centers",
        "WHERE id = ?",
      ].join("\n")
    )
    .bind(centerId)
    .first<CenterRecord>();

  if (!row) return null;
  return toCenter(row);
}

export async function listOfficesForCenter(
  db: SqlDatabase,
  centerId: number,
  radiusM: number,
  limit: number | null,
  highConfidenceOnly: boolean,
  searchQuery?: string
): Promise<OfficeRecord[]> {
  const normalizedSearch = searchQuery?.trim() ?? "";

  const sql = [
    "SELECT",
    "  o.osm_type AS osmType,",
    "  o.osm_id AS osmId,",
    "  o.name,",
    "  o.brand,",
    "  o.operator,",
    "  o.website,",
    "  o.wikidata,",
    "  o.wikidata_entity_id AS wikidataEntityId,",
    "  o.employee_count AS employeeCount,",
    "  o.employee_count_as_of AS employeeCountAsOf,",
    "  o.market_cap AS marketCap,",
    "  o.market_cap_currency_qid AS marketCapCurrencyQid,",
    "  o.market_cap_as_of AS marketCapAsOf,",
    "  o.wikidata_enriched_at AS wikidataEnrichedAt,",
    "  o.lat,",
    "  o.lon,",
    "  o.low_confidence AS lowConfidence,",
    "  o.tags_json AS tagsJson,",
    "  co.distance_m AS distanceM",
    "FROM center_office co",
    "JOIN offices o",
    "  ON o.osm_type = co.osm_type AND o.osm_id = co.osm_id",
    "WHERE co.center_id = ?",
    "  AND co.distance_m <= ?",
    "  AND o.name IS NOT NULL",
    "  AND TRIM(o.name) <> ''",
    highConfidenceOnly ? "  AND o.low_confidence = 0" : "",
    normalizedSearch
      ? "  AND o.name COLLATE NOCASE LIKE ? ESCAPE '\\'"
      : "",
    "ORDER BY co.distance_m ASC",
    limit !== null ? "LIMIT ?" : "",
  ]
    .filter(Boolean)
    .join("\n");

  const bindings: unknown[] = [centerId, radiusM];
  if (normalizedSearch) {
    bindings.push(toLikePrefix(normalizedSearch.slice(0, 120)));
  }
  if (limit !== null) {
    bindings.push(limit);
  }

  const result = await db.prepare(sql).bind(...bindings).all<OfficeRecord>();

  const rows = result.results ?? [];
  const deduped = new Map<string, OfficeRecord>();

  for (const row of rows) {
    if (!row.name) continue;

    const key = `${normalizeOfficeName(row.name)}|${officeCoordinatesKey(
      row.lat,
      row.lon
    )}`;

    if (!deduped.has(key)) {
      deduped.set(key, row);
    }
  }

  return Array.from(deduped.values());
}

export async function getRefreshCursor(db: SqlDatabase): Promise<number> {
  const row = await db
    .prepare("SELECT value FROM refresh_state WHERE key = ?")
    .bind(REFRESH_CURSOR_KEY)
    .first<{ value: string }>();

  const parsed = Number.parseInt(row?.value ?? "0", 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return parsed;
}

export async function setRefreshCursor(
  db: SqlDatabase,
  cursor: number
): Promise<void> {
  await db
    .prepare(
      [
        "INSERT INTO refresh_state (key, value, updated_at)",
        "VALUES (?, ?, datetime('now'))",
        "ON CONFLICT(key) DO UPDATE SET",
        "  value = excluded.value,",
        "  updated_at = excluded.updated_at",
      ].join("\n")
    )
    .bind(REFRESH_CURSOR_KEY, String(cursor))
    .run();
}

export async function listCentersAfterCursor(
  db: SqlDatabase,
  cursor: number,
  limit: number
): Promise<CancerCenter[]> {
  const result = await db
    .prepare(
      [
        "SELECT id, center_code, name, tier, lat, lon, country, region, source_url, is_active",
        "FROM cancer_centers",
        "WHERE is_active = 1 AND id > ?",
        "ORDER BY id ASC",
        "LIMIT ?",
      ].join("\n")
    )
    .bind(cursor, limit)
    .all<CenterRecord>();

  return (result.results ?? []).map(toCenter);
}

function officeUpsertStatement(
  db: SqlDatabase,
  office: Office
): SqlPreparedStatement {
  return db
    .prepare(
      [
        "INSERT INTO offices (",
        "  osm_type, osm_id, name, brand, operator, website, wikidata, wikidata_entity_id, lat, lon, low_confidence, tags_json, updated_at",
        ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
        "ON CONFLICT(osm_type, osm_id) DO UPDATE SET",
        "  name = excluded.name,",
        "  brand = excluded.brand,",
        "  operator = excluded.operator,",
        "  website = excluded.website,",
        "  wikidata = excluded.wikidata,",
        "  wikidata_entity_id = excluded.wikidata_entity_id,",
        "  lat = excluded.lat,",
        "  lon = excluded.lon,",
        "  low_confidence = excluded.low_confidence,",
        "  tags_json = excluded.tags_json,",
        "  updated_at = excluded.updated_at",
      ].join("\n")
    )
    .bind(
      office.osmType,
      office.osmId,
      office.name,
      office.brand,
      office.operator,
      office.website,
      office.wikidata,
      office.wikidata,
      office.lat,
      office.lon,
      office.lowConfidence ? 1 : 0,
      office.tagsJson
    );
}

function centerOfficeUpsertStatement(
  db: SqlDatabase,
  link: CenterOffice
): SqlPreparedStatement {
  return db
    .prepare(
      [
        "INSERT INTO center_office (center_id, osm_type, osm_id, distance_m, last_seen)",
        "VALUES (?, ?, ?, ?, ?)",
        "ON CONFLICT(center_id, osm_type, osm_id) DO UPDATE SET",
        "  distance_m = excluded.distance_m,",
        "  last_seen = excluded.last_seen",
      ].join("\n")
    )
    .bind(
      link.centerId,
      link.osmType,
      link.osmId,
      link.distanceM,
      link.lastSeen
    );
}

export async function upsertOfficesAndLinks(
  db: SqlDatabase,
  offices: Office[],
  links: CenterOffice[]
): Promise<void> {
  const statements: SqlPreparedStatement[] = [];

  for (const office of offices) {
    statements.push(officeUpsertStatement(db, office));
  }

  for (const link of links) {
    statements.push(centerOfficeUpsertStatement(db, link));
  }

  for (const chunkedStatements of chunk(statements, 80)) {
    await db.batch(chunkedStatements);
  }
}

interface WikidataEntityIdRecord {
  wikidataEntityId: string;
}

export interface WikidataEnrichmentUpdate {
  wikidataEntityId: string;
  employeeCount: number | null;
  employeeCountAsOf: string | null;
  marketCap: number | null;
  marketCapCurrencyQid: string | null;
  marketCapAsOf: string | null;
  wikidataEnrichedAt: string;
}

export async function listStaleWikidataEntityIds(
  db: SqlDatabase,
  wikidataEntityIds: string[],
  staleDays: number,
  limit: number
): Promise<string[]> {
  if (wikidataEntityIds.length === 0 || limit <= 0) {
    return [];
  }

  const placeholders = wikidataEntityIds.map(() => "?").join(", ");
  const result = await db
    .prepare(
      [
        "SELECT DISTINCT wikidata_entity_id AS wikidataEntityId",
        "FROM offices",
        `WHERE wikidata_entity_id IN (${placeholders})`,
        "  AND (",
        "    wikidata_enriched_at IS NULL",
        "    OR wikidata_enriched_at < datetime('now', ?)",
        "  )",
        "ORDER BY wikidata_entity_id ASC",
        "LIMIT ?",
      ].join("\n")
    )
    .bind(...wikidataEntityIds, `-${staleDays} days`, limit)
    .all<WikidataEntityIdRecord>();

  return (result.results ?? [])
    .map((row) => row.wikidataEntityId)
    .filter((value): value is string => Boolean(value));
}

export async function applyWikidataEnrichment(
  db: SqlDatabase,
  updates: WikidataEnrichmentUpdate[]
): Promise<number> {
  if (updates.length === 0) return 0;

  const statements = updates.map((update) =>
    db
      .prepare(
        [
          "UPDATE offices",
          "SET employee_count = ?,",
          "    employee_count_as_of = ?,",
          "    market_cap = ?,",
          "    market_cap_currency_qid = ?,",
          "    market_cap_as_of = ?,",
          "    wikidata_enriched_at = ?,",
          "    updated_at = datetime('now')",
          "WHERE wikidata_entity_id = ?",
        ].join("\n")
      )
      .bind(
        update.employeeCount,
        update.employeeCountAsOf,
        update.marketCap,
        update.marketCapCurrencyQid,
        update.marketCapAsOf,
        update.wikidataEnrichedAt,
        update.wikidataEntityId
      )
  );

  let updatedRows = 0;
  for (const chunkedStatements of chunk(statements, 80)) {
    const batchResult = await db.batch(chunkedStatements);
    for (const result of batchResult) {
      updatedRows += Number(result.meta?.changes ?? 0);
    }
  }

  return updatedRows;
}

export async function pruneStaleCenterLinks(
  db: SqlDatabase,
  centerId: number,
  staleDays: number
): Promise<number> {
  const result = await db
    .prepare(
      [
        "DELETE FROM center_office",
        "WHERE center_id = ?",
        "  AND last_seen < datetime('now', ?)",
      ].join("\n")
    )
    .bind(centerId, `-${staleDays} days`)
    .run();

  return Number(result.meta?.changes ?? 0);
}

export async function upsertCenterFromCsv(
  db: SqlDatabase,
  row: CsvCenterRow,
  syncToken: string
): Promise<"inserted" | "updated"> {
  const existing = await db
    .prepare("SELECT id FROM cancer_centers WHERE center_code = ?")
    .bind(row.centerCode)
    .first<{ id: number }>();

  await db
    .prepare(
      [
        "INSERT INTO cancer_centers (",
        "  center_code, name, tier, lat, lon, country, region, source_url, is_active, last_csv_sync_token, updated_at",
        ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, datetime('now'))",
        "ON CONFLICT(center_code) DO UPDATE SET",
        "  name = excluded.name,",
        "  tier = excluded.tier,",
        "  lat = excluded.lat,",
        "  lon = excluded.lon,",
        "  country = excluded.country,",
        "  region = excluded.region,",
        "  source_url = excluded.source_url,",
        "  is_active = 1,",
        "  last_csv_sync_token = excluded.last_csv_sync_token,",
        "  updated_at = excluded.updated_at",
      ].join("\n")
    )
    .bind(
      row.centerCode,
      row.name,
      row.tier,
      row.lat,
      row.lon,
      row.country,
      row.region,
      row.sourceUrl,
      syncToken
    )
    .run();

  return existing ? "updated" : "inserted";
}

export async function disableCentersMissingFromSync(
  db: SqlDatabase,
  syncToken: string
): Promise<number> {
  const result = await db
    .prepare(
      [
        "UPDATE cancer_centers",
        "SET is_active = 0, updated_at = datetime('now')",
        "WHERE is_active = 1",
        "  AND COALESCE(last_csv_sync_token, '') <> ?",
      ].join("\n")
    )
    .bind(syncToken)
    .run();

  return Number(result.meta?.changes ?? 0);
}

export interface OperationalStatus {
  centersTotal: number;
  activeCenters: number;
  officesTotal: number | null;
  centerOfficeLinksTotal: number | null;
  refreshCursor: number;
  refreshUpdatedAt: string | null;
  exactCounts: boolean;
}

export async function getOperationalStatus(
  db: SqlDatabase,
  options?: { includeHeavyCounts?: boolean }
): Promise<OperationalStatus> {
  const includeHeavyCounts = options?.includeHeavyCounts ?? false;
  const [totalCentersRow, activeCentersRow, refreshStateRow] = await Promise.all([
    db
      .prepare("SELECT COUNT(*) AS count FROM cancer_centers")
      .first<CountRecord>(),
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM cancer_centers WHERE is_active = 1"
      )
      .first<CountRecord>(),
    db
      .prepare("SELECT value, updated_at FROM refresh_state WHERE key = ?")
      .bind(REFRESH_CURSOR_KEY)
      .first<{ value: string; updated_at: string | null }>(),
  ]);

  let officesTotal: number | null = null;
  let centerOfficeLinksTotal: number | null = null;

  if (includeHeavyCounts) {
    const [totalOfficesRow, totalLinksRow] = await Promise.all([
      db.prepare("SELECT COUNT(*) AS count FROM offices").first<CountRecord>(),
      db
        .prepare("SELECT COUNT(*) AS count FROM center_office")
        .first<CountRecord>(),
    ]);

    officesTotal = toCount(totalOfficesRow?.count);
    centerOfficeLinksTotal = toCount(totalLinksRow?.count);
  }

  return {
    centersTotal: toCount(totalCentersRow?.count),
    activeCenters: toCount(activeCentersRow?.count),
    officesTotal,
    centerOfficeLinksTotal,
    refreshCursor: toCount(refreshStateRow?.value),
    refreshUpdatedAt: refreshStateRow?.updated_at ?? null,
    exactCounts: includeHeavyCounts,
  };
}
