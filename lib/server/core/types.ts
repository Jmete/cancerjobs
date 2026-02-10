export interface SqlResultMeta {
  changes?: number;
  duration?: number;
  last_row_id?: number;
  rows_read?: number;
  rows_written?: number;
  [key: string]: unknown;
}

export interface SqlResult<T = Record<string, unknown>> {
  success: boolean;
  results?: T[];
  meta?: SqlResultMeta;
  error?: string;
}

export interface SqlPreparedStatement {
  bind(...values: unknown[]): SqlPreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<SqlResult<T>>;
  run<T = Record<string, unknown>>(): Promise<SqlResult<T>>;
}

export interface SqlDatabase {
  prepare(query: string): SqlPreparedStatement;
  batch<T = Record<string, unknown>>(
    statements: SqlPreparedStatement[]
  ): Promise<Array<SqlResult<T>>>;
}

export interface Env {
  DB: SqlDatabase;
  OVERPASS_URL?: string;
  DEFAULT_RADIUS_M?: string;
  BATCH_CENTERS_PER_RUN?: string;
  OVERPASS_THROTTLE_MS?: string;
  REFRESH_CENTER_RETRY_COUNT?: string;
  REFRESH_CENTER_RETRY_DELAY_MS?: string;
  STALE_LINK_DAYS?: string;
  REFRESH_HEALTH_MAX_AGE_MINUTES?: string;
  CORS_ORIGIN?: string;
  ADMIN_TOKEN?: string;
  WIKIDATA_API_URL?: string;
  WIKIDATA_ENRICH_ENABLED?: string;
  WIKIDATA_ENRICH_MAX_IDS_PER_CENTER?: string;
  WIKIDATA_ENRICH_STALE_DAYS?: string;
  WIKIDATA_ENRICH_THROTTLE_MS?: string;
}

export interface CancerCenter {
  id: number;
  centerCode: string;
  name: string;
  tier: string | null;
  lat: number;
  lon: number;
  country: string | null;
  region: string | null;
  sourceUrl: string | null;
  isActive: boolean;
}

export interface Office {
  osmType: "node" | "way" | "relation";
  osmId: number;
  name: string | null;
  brand: string | null;
  operator: string | null;
  website: string | null;
  wikidata: string | null;
  lat: number;
  lon: number;
  lowConfidence: boolean;
  tagsJson: string | null;
}

export type OfficeDeletionFlagStatus = "pending" | "approved" | "rejected";

export interface CenterOffice {
  centerId: number;
  osmType: Office["osmType"];
  osmId: number;
  distanceM: number;
  lastSeen: string;
}

export interface CsvCenterRow {
  centerCode: string;
  name: string;
  tier: string | null;
  lat: number;
  lon: number;
  country: string | null;
  region: string | null;
  sourceUrl: string | null;
}

export interface CsvCompanyRow {
  companyName: string;
  companyNameNormalized: string;
  knownAliases: string | null;
  hqCountry: string | null;
  description: string | null;
  companyType: string | null;
  geography: string | null;
  industry: string | null;
  suitabilityTier: string | null;
}

export interface CsvValidationIssue {
  row: number;
  reason: string;
}

export interface ScheduledEvent {
  cron: string;
  scheduledTime: number;
  type: "scheduled";
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}
