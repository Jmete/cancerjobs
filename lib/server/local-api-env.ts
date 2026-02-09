import "server-only";

import type { Env } from "@/lib/server/core/types";

import { getLocalDatabase } from "./sqlite-db";

function envValue(name: string): string | undefined {
  const value = process.env[name];
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function createLocalApiEnv(): Env {
  return {
    DB: getLocalDatabase(),
    OVERPASS_URL: envValue("OVERPASS_URL"),
    DEFAULT_RADIUS_M: envValue("DEFAULT_RADIUS_M"),
    BATCH_CENTERS_PER_RUN: envValue("BATCH_CENTERS_PER_RUN"),
    OVERPASS_THROTTLE_MS: envValue("OVERPASS_THROTTLE_MS"),
    STALE_LINK_DAYS: envValue("STALE_LINK_DAYS"),
    REFRESH_HEALTH_MAX_AGE_MINUTES: envValue("REFRESH_HEALTH_MAX_AGE_MINUTES"),
    CORS_ORIGIN: envValue("CORS_ORIGIN"),
    ADMIN_TOKEN: envValue("ADMIN_API_TOKEN"),
    WIKIDATA_API_URL: envValue("WIKIDATA_API_URL"),
    WIKIDATA_ENRICH_ENABLED: envValue("WIKIDATA_ENRICH_ENABLED"),
    WIKIDATA_ENRICH_MAX_IDS_PER_CENTER: envValue(
      "WIKIDATA_ENRICH_MAX_IDS_PER_CENTER"
    ),
    WIKIDATA_ENRICH_STALE_DAYS: envValue("WIKIDATA_ENRICH_STALE_DAYS"),
    WIKIDATA_ENRICH_THROTTLE_MS: envValue("WIKIDATA_ENRICH_THROTTLE_MS"),
  };
}
