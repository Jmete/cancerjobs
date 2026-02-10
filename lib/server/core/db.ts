import type {
  CancerCenter,
  CenterOffice,
  CsvCenterRow,
  CsvCompanyRow,
  OfficeDeletionFlagStatus,
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

interface CompanyRecord {
  id: number;
  company_name: string;
  company_name_normalized: string;
  known_aliases: string | null;
}

interface OfficeDeletionFlagIdRecord {
  id: number;
}

interface OfficeDeletionFlagReviewRecord {
  id: number;
  centerId: number | null;
  centerName: string | null;
  osmType: Office["osmType"];
  osmId: number;
  reason: string | null;
  status: OfficeDeletionFlagStatus;
  submittedAt: string;
  reviewedAt: string | null;
  officeName: string | null;
  officeWebsite: string | null;
  officeLat: number | null;
  officeLon: number | null;
}

interface OfficeDeletionFlagStatusRecord {
  status: OfficeDeletionFlagStatus;
  osmType: Office["osmType"];
  osmId: number;
}

interface BannedOfficeRecord {
  osmType: Office["osmType"];
  osmId: number;
}

function normalizeOfficeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeCompanyName(name: string): string {
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
    "  AND NOT EXISTS (",
    "    SELECT 1",
    "    FROM banned_offices bo",
    "    WHERE bo.osm_type = co.osm_type",
    "      AND bo.osm_id = co.osm_id",
    "  )",
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

export interface SubmitOfficeDeletionFlagInput {
  centerId: number | null;
  osmType: Office["osmType"];
  osmId: number;
  reason: string | null;
}

export interface SubmitOfficeDeletionFlagResult {
  outcome: "created" | "already_pending" | "already_banned";
  flagId: number | null;
}

export interface OfficeDeletionFlagForReview {
  id: number;
  centerId: number | null;
  centerName: string | null;
  osmType: Office["osmType"];
  osmId: number;
  reason: string | null;
  status: OfficeDeletionFlagStatus;
  submittedAt: string;
  reviewedAt: string | null;
  officeName: string | null;
  officeWebsite: string | null;
  officeLat: number | null;
  officeLon: number | null;
}

export interface ReviewOfficeDeletionFlagResult {
  outcome: "approved" | "rejected" | "already_approved" | "already_rejected" | "not_found";
  flagId: number;
  osmType: Office["osmType"] | null;
  osmId: number | null;
  deletedLinks: number;
  deletedOffices: number;
}

export async function officeExistsForCenter(
  db: SqlDatabase,
  centerId: number,
  osmType: Office["osmType"],
  osmId: number
): Promise<boolean> {
  const row = await db
    .prepare(
      [
        "SELECT 1 AS found",
        "FROM center_office",
        "WHERE center_id = ?",
        "  AND osm_type = ?",
        "  AND osm_id = ?",
        "LIMIT 1",
      ].join("\n")
    )
    .bind(centerId, osmType, osmId)
    .first<{ found: number }>();

  return Boolean(row?.found);
}

export async function submitOfficeDeletionFlag(
  db: SqlDatabase,
  input: SubmitOfficeDeletionFlagInput
): Promise<SubmitOfficeDeletionFlagResult> {
  const banned = await db
    .prepare(
      [
        "SELECT 1 AS found",
        "FROM banned_offices",
        "WHERE osm_type = ?",
        "  AND osm_id = ?",
        "LIMIT 1",
      ].join("\n")
    )
    .bind(input.osmType, input.osmId)
    .first<{ found: number }>();

  if (banned?.found) {
    return {
      outcome: "already_banned",
      flagId: null,
    };
  }

  const pending = await db
    .prepare(
      [
        "SELECT id",
        "FROM office_deletion_flags",
        "WHERE osm_type = ?",
        "  AND osm_id = ?",
        "  AND status = 'pending'",
        "ORDER BY id DESC",
        "LIMIT 1",
      ].join("\n")
    )
    .bind(input.osmType, input.osmId)
    .first<OfficeDeletionFlagIdRecord>();

  if (pending?.id) {
    return {
      outcome: "already_pending",
      flagId: pending.id,
    };
  }

  const inserted = await db
    .prepare(
      [
        "INSERT INTO office_deletion_flags (",
        "  center_id, osm_type, osm_id, reason, status, submitted_at",
        ") VALUES (?, ?, ?, ?, 'pending', datetime('now'))",
      ].join("\n")
    )
    .bind(input.centerId, input.osmType, input.osmId, input.reason)
    .run();

  const insertedId = Number(inserted.meta?.last_row_id ?? 0);
  if (insertedId > 0) {
    return {
      outcome: "created",
      flagId: insertedId,
    };
  }

  const fallback = await db
    .prepare(
      [
        "SELECT id",
        "FROM office_deletion_flags",
        "WHERE osm_type = ?",
        "  AND osm_id = ?",
        "  AND status = 'pending'",
        "ORDER BY id DESC",
        "LIMIT 1",
      ].join("\n")
    )
    .bind(input.osmType, input.osmId)
    .first<OfficeDeletionFlagIdRecord>();

  return {
    outcome: "already_pending",
    flagId: fallback?.id ?? null,
  };
}

export async function listOfficeDeletionFlags(
  db: SqlDatabase,
  options?: {
    status?: OfficeDeletionFlagStatus;
    limit?: number;
  }
): Promise<OfficeDeletionFlagForReview[]> {
  const sql = [
    "SELECT",
    "  f.id AS id,",
    "  f.center_id AS centerId,",
    "  cc.name AS centerName,",
    "  f.osm_type AS osmType,",
    "  f.osm_id AS osmId,",
    "  f.reason AS reason,",
    "  f.status AS status,",
    "  f.submitted_at AS submittedAt,",
    "  f.reviewed_at AS reviewedAt,",
    "  o.name AS officeName,",
    "  o.website AS officeWebsite,",
    "  o.lat AS officeLat,",
    "  o.lon AS officeLon",
    "FROM office_deletion_flags f",
    "LEFT JOIN cancer_centers cc ON cc.id = f.center_id",
    "LEFT JOIN offices o",
    "  ON o.osm_type = f.osm_type AND o.osm_id = f.osm_id",
    "WHERE 1 = 1",
    options?.status ? "  AND f.status = ?" : "",
    "ORDER BY f.submitted_at DESC, f.id DESC",
    "LIMIT ?",
  ]
    .filter(Boolean)
    .join("\n");

  const bindings: unknown[] = [];
  if (options?.status) {
    bindings.push(options.status);
  }
  bindings.push(Math.max(1, Math.min(500, options?.limit ?? 100)));

  const result = await db
    .prepare(sql)
    .bind(...bindings)
    .all<OfficeDeletionFlagReviewRecord>();

  return (result.results ?? []).map((item) => ({
    id: item.id,
    centerId: item.centerId,
    centerName: item.centerName,
    osmType: item.osmType,
    osmId: item.osmId,
    reason: item.reason,
    status: item.status,
    submittedAt: item.submittedAt,
    reviewedAt: item.reviewedAt,
    officeName: item.officeName,
    officeWebsite: item.officeWebsite,
    officeLat: item.officeLat,
    officeLon: item.officeLon,
  }));
}

async function getOfficeDeletionFlagStatus(
  db: SqlDatabase,
  flagId: number
): Promise<OfficeDeletionFlagStatusRecord | null> {
  return db
    .prepare(
      [
        "SELECT status, osm_type AS osmType, osm_id AS osmId",
        "FROM office_deletion_flags",
        "WHERE id = ?",
      ].join("\n")
    )
    .bind(flagId)
    .first<OfficeDeletionFlagStatusRecord>();
}

export async function approveOfficeDeletionFlag(
  db: SqlDatabase,
  flagId: number
): Promise<ReviewOfficeDeletionFlagResult> {
  const existing = await getOfficeDeletionFlagStatus(db, flagId);
  if (!existing) {
    return {
      outcome: "not_found",
      flagId,
      osmType: null,
      osmId: null,
      deletedLinks: 0,
      deletedOffices: 0,
    };
  }

  if (existing.status === "approved") {
    return {
      outcome: "already_approved",
      flagId,
      osmType: existing.osmType,
      osmId: existing.osmId,
      deletedLinks: 0,
      deletedOffices: 0,
    };
  }

  await db
    .prepare(
      [
        "UPDATE office_deletion_flags",
        "SET status = 'approved',",
        "    reviewed_at = datetime('now')",
        "WHERE id = ?",
      ].join("\n")
    )
    .bind(flagId)
    .run();

  await db
    .prepare(
      [
        "INSERT INTO banned_offices (osm_type, osm_id, approved_flag_id, approved_at)",
        "VALUES (?, ?, ?, datetime('now'))",
        "ON CONFLICT(osm_type, osm_id) DO UPDATE SET",
        "  approved_flag_id = excluded.approved_flag_id,",
        "  approved_at = excluded.approved_at",
      ].join("\n")
    )
    .bind(existing.osmType, existing.osmId, flagId)
    .run();

  const deletedLinks = await db
    .prepare(
      [
        "DELETE FROM center_office",
        "WHERE osm_type = ?",
        "  AND osm_id = ?",
      ].join("\n")
    )
    .bind(existing.osmType, existing.osmId)
    .run();

  const deletedOffices = await db
    .prepare(
      [
        "DELETE FROM offices",
        "WHERE osm_type = ?",
        "  AND osm_id = ?",
      ].join("\n")
    )
    .bind(existing.osmType, existing.osmId)
    .run();

  return {
    outcome: "approved",
    flagId,
    osmType: existing.osmType,
    osmId: existing.osmId,
    deletedLinks: Number(deletedLinks.meta?.changes ?? 0),
    deletedOffices: Number(deletedOffices.meta?.changes ?? 0),
  };
}

export async function rejectOfficeDeletionFlag(
  db: SqlDatabase,
  flagId: number
): Promise<ReviewOfficeDeletionFlagResult> {
  const existing = await getOfficeDeletionFlagStatus(db, flagId);
  if (!existing) {
    return {
      outcome: "not_found",
      flagId,
      osmType: null,
      osmId: null,
      deletedLinks: 0,
      deletedOffices: 0,
    };
  }

  if (existing.status === "approved") {
    return {
      outcome: "already_approved",
      flagId,
      osmType: existing.osmType,
      osmId: existing.osmId,
      deletedLinks: 0,
      deletedOffices: 0,
    };
  }

  if (existing.status === "rejected") {
    return {
      outcome: "already_rejected",
      flagId,
      osmType: existing.osmType,
      osmId: existing.osmId,
      deletedLinks: 0,
      deletedOffices: 0,
    };
  }

  await db
    .prepare(
      [
        "UPDATE office_deletion_flags",
        "SET status = 'rejected',",
        "    reviewed_at = datetime('now')",
        "WHERE id = ?",
      ].join("\n")
    )
    .bind(flagId)
    .run();

  return {
    outcome: "rejected",
    flagId,
    osmType: existing.osmType,
    osmId: existing.osmId,
    deletedLinks: 0,
    deletedOffices: 0,
  };
}

export async function listBannedOfficeKeys(
  db: SqlDatabase
): Promise<Array<{ osmType: Office["osmType"]; osmId: number }>> {
  const result = await db
    .prepare(
      [
        "SELECT osm_type AS osmType, osm_id AS osmId",
        "FROM banned_offices",
      ].join("\n")
    )
    .all<BannedOfficeRecord>();

  return (result.results ?? []).map((row) => ({
    osmType: row.osmType,
    osmId: row.osmId,
  }));
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

export async function pruneCenterLinksNotSeenSince(
  db: SqlDatabase,
  centerId: number,
  seenAt: string
): Promise<number> {
  const result = await db
    .prepare(
      [
        "DELETE FROM center_office",
        "WHERE center_id = ?",
        "  AND last_seen < ?",
      ].join("\n")
    )
    .bind(centerId, seenAt)
    .run();

  return Number(result.meta?.changes ?? 0);
}

export interface PurgeOfficePointsResult {
  linksDeleted: number;
  officesDeleted: number;
}

export async function purgeAllOfficePoints(
  db: SqlDatabase
): Promise<PurgeOfficePointsResult> {
  const deletedLinks = await db.prepare("DELETE FROM center_office").run();
  const deletedOffices = await db.prepare("DELETE FROM offices").run();
  await setRefreshCursor(db, 0);

  return {
    linksDeleted: Number(deletedLinks.meta?.changes ?? 0),
    officesDeleted: Number(deletedOffices.meta?.changes ?? 0),
  };
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

export async function insertCompanyFromCsv(
  db: SqlDatabase,
  row: CsvCompanyRow
): Promise<"inserted" | "skipped"> {
  const normalizedName =
    row.companyNameNormalized || normalizeCompanyName(row.companyName);
  if (!normalizedName) {
    return "skipped";
  }

  const result = await db
    .prepare(
      [
        "INSERT INTO companies (",
        "  company_name, company_name_normalized, known_aliases, hq_country, description, type, geography, industry, suitability_tier, updated_at",
        ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
        "ON CONFLICT(company_name_normalized) DO NOTHING",
      ].join("\n")
    )
    .bind(
      row.companyName,
      normalizedName,
      row.knownAliases,
      row.hqCountry,
      row.description,
      row.companyType,
      row.geography,
      row.industry,
      row.suitabilityTier
    )
    .run();

  return Number(result.meta?.changes ?? 0) > 0 ? "inserted" : "skipped";
}

export interface CompanyRecordForMatching {
  id: number;
  companyName: string;
  companyNameNormalized: string;
  knownAliases: string | null;
}

export async function listCompaniesForMatching(
  db: SqlDatabase
): Promise<CompanyRecordForMatching[]> {
  const result = await db
    .prepare(
      [
        "SELECT id, company_name, company_name_normalized, known_aliases",
        "FROM companies",
        "ORDER BY id ASC",
      ].join("\n")
    )
    .all<CompanyRecord>();

  return (result.results ?? []).map((record) => ({
    id: record.id,
    companyName: record.company_name,
    companyNameNormalized: record.company_name_normalized,
    knownAliases: record.known_aliases,
  }));
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
