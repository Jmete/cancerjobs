import {
  applyWikidataEnrichment,
  getRefreshCursor,
  listStaleWikidataEntityIds,
  listCentersAfterCursor,
  pruneStaleCenterLinks,
  setRefreshCursor,
  upsertOfficesAndLinks,
} from "./db";
import { buildOfficesQuery, fetchOverpassElements, normalizeOverpassElements } from "./overpass";
import type { CancerCenter, CenterOffice, Env } from "./types";
import { fetchWikidataEnrichment } from "./wikidata";
import {
  haversineMeters,
  normalizeWikidataEntityId,
  sleep,
  toBoolean,
  toPositiveInt,
} from "./utils";

export interface RefreshCenterResult {
  centerId: number;
  centerName: string;
  officesFetched: number;
  linksUpserted: number;
  prunedLinks: number;
  wikidataEntitiesFetched: number;
  wikidataOfficesUpdated: number;
}

export interface RefreshSearchOptions {
  radiusM?: number;
  maxOffices?: number | null;
}

export interface RefreshAllResult {
  centersAttempted: number;
  centersSucceeded: number;
  centersFailed: number;
  officesFetched: number;
  wikidataEntitiesFetched: number;
  wikidataOfficesUpdated: number;
  throttleMs: number;
  batchSize: number;
  radiusM: number;
  maxOffices: number | null;
  cursorEnd: number;
}

function createLinks(
  center: CancerCenter,
  offices: ReturnType<typeof normalizeOverpassElements>,
  seenAt: string
): CenterOffice[] {
  return offices.map((office) => ({
    centerId: center.id,
    osmType: office.osmType,
    osmId: office.osmId,
    distanceM: haversineMeters(center.lat, center.lon, office.lat, office.lon),
    lastSeen: seenAt,
  }));
}

interface WikidataEnrichmentStats {
  entitiesFetched: number;
  officesUpdated: number;
}

function capOfficesByLimit(
  center: CancerCenter,
  offices: ReturnType<typeof normalizeOverpassElements>,
  maxOffices: number | null
): ReturnType<typeof normalizeOverpassElements> {
  if (maxOffices === null) return offices;
  if (offices.length <= maxOffices) return offices;

  return [...offices]
    .sort((left, right) => {
      const leftDistance = haversineMeters(
        center.lat,
        center.lon,
        left.lat,
        left.lon
      );
      const rightDistance = haversineMeters(
        center.lat,
        center.lon,
        right.lat,
        right.lon
      );
      return leftDistance - rightDistance;
    })
    .slice(0, maxOffices);
}

async function enrichOfficesWithWikidata(
  env: Env,
  offices: ReturnType<typeof normalizeOverpassElements>
): Promise<WikidataEnrichmentStats> {
  const enrichmentEnabled = toBoolean(env.WIKIDATA_ENRICH_ENABLED ?? null, true);
  if (!enrichmentEnabled || offices.length === 0) {
    return {
      entitiesFetched: 0,
      officesUpdated: 0,
    };
  }

  const uniqueWikidataEntityIds = Array.from(
    new Set(
      offices
        .map((office) => normalizeWikidataEntityId(office.wikidata))
        .filter((value): value is string => Boolean(value))
    )
  );

  if (uniqueWikidataEntityIds.length === 0) {
    return {
      entitiesFetched: 0,
      officesUpdated: 0,
    };
  }

  const maxIdsPerCenter = toPositiveInt(env.WIKIDATA_ENRICH_MAX_IDS_PER_CENTER, 30);
  const staleDays = toPositiveInt(env.WIKIDATA_ENRICH_STALE_DAYS, 14);
  const throttleMs = toPositiveInt(env.WIKIDATA_ENRICH_THROTTLE_MS, 250);

  const staleEntityIds = await listStaleWikidataEntityIds(
    env.DB,
    uniqueWikidataEntityIds,
    staleDays,
    maxIdsPerCenter
  );

  if (staleEntityIds.length === 0) {
    return {
      entitiesFetched: 0,
      officesUpdated: 0,
    };
  }

  const enrichment = await fetchWikidataEnrichment(env, staleEntityIds, {
    throttleMs,
  });
  if (enrichment.length === 0) {
    return {
      entitiesFetched: 0,
      officesUpdated: 0,
    };
  }

  const wikidataEnrichedAt = new Date().toISOString();
  const updates = enrichment.map((item) => ({
    wikidataEntityId: item.wikidataEntityId,
    employeeCount: item.employeeCount,
    employeeCountAsOf: item.employeeCountAsOf,
    marketCap: item.marketCap,
    marketCapCurrencyQid: item.marketCapCurrencyQid,
    marketCapAsOf: item.marketCapAsOf,
    wikidataEnrichedAt,
  }));

  const officesUpdated = await applyWikidataEnrichment(env.DB, updates);
  return {
    entitiesFetched: enrichment.length,
    officesUpdated,
  };
}

export async function refreshCenterOffices(
  env: Env,
  center: CancerCenter,
  options?: RefreshSearchOptions
): Promise<RefreshCenterResult> {
  const radiusM =
    typeof options?.radiusM === "number" &&
    Number.isFinite(options.radiusM) &&
    options.radiusM > 0
      ? Math.trunc(options.radiusM)
      : toPositiveInt(env.DEFAULT_RADIUS_M, 50000);
  const maxOffices =
    typeof options?.maxOffices === "number" &&
    Number.isFinite(options.maxOffices) &&
    options.maxOffices > 0
      ? Math.trunc(options.maxOffices)
      : null;
  const staleDays = toPositiveInt(env.STALE_LINK_DAYS, 30);
  const query = buildOfficesQuery(center.lat, center.lon, radiusM);
  const elements = await fetchOverpassElements(env, query);
  const normalizedOffices = normalizeOverpassElements(elements);
  const offices = capOfficesByLimit(center, normalizedOffices, maxOffices);

  const seenAt = new Date().toISOString();
  const links = createLinks(center, offices, seenAt);
  let wikidataEntitiesFetched = 0;
  let wikidataOfficesUpdated = 0;

  if (offices.length > 0) {
    await upsertOfficesAndLinks(env.DB, offices, links);

    try {
      const enrichment = await enrichOfficesWithWikidata(env, offices);
      wikidataEntitiesFetched = enrichment.entitiesFetched;
      wikidataOfficesUpdated = enrichment.officesUpdated;
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "wikidata_enrichment_error",
          centerId: center.id,
          centerName: center.name,
          message: error instanceof Error ? error.message : "unknown error",
        })
      );
    }
  }

  const prunedLinks = await pruneStaleCenterLinks(env.DB, center.id, staleDays);

  return {
    centerId: center.id,
    centerName: center.name,
    officesFetched: offices.length,
    linksUpserted: links.length,
    prunedLinks,
    wikidataEntitiesFetched,
    wikidataOfficesUpdated,
  };
}

export async function runScheduledRefresh(env: Env): Promise<void> {
  const batchSize = toPositiveInt(env.BATCH_CENTERS_PER_RUN, 10);
  const throttleMs = toPositiveInt(env.OVERPASS_THROTTLE_MS, 1200);
  const cursor = await getRefreshCursor(env.DB);

  const centers = await listCentersAfterCursor(env.DB, cursor, batchSize);
  if (centers.length === 0) {
    await setRefreshCursor(env.DB, 0);
    console.log(
      JSON.stringify({
        event: "refresh_cycle_reset",
        previousCursor: cursor,
      })
    );
    return;
  }

  let processed = 0;
  let totalFetched = 0;
  let totalWikidataEntitiesFetched = 0;
  let totalWikidataOfficesUpdated = 0;

  for (const center of centers) {
    try {
      const result = await refreshCenterOffices(env, center);
      processed += 1;
      totalFetched += result.officesFetched;
      totalWikidataEntitiesFetched += result.wikidataEntitiesFetched;
      totalWikidataOfficesUpdated += result.wikidataOfficesUpdated;

      console.log(
        JSON.stringify({
          event: "refresh_center_success",
          centerId: result.centerId,
          centerName: result.centerName,
          officesFetched: result.officesFetched,
          linksUpserted: result.linksUpserted,
          prunedLinks: result.prunedLinks,
          wikidataEntitiesFetched: result.wikidataEntitiesFetched,
          wikidataOfficesUpdated: result.wikidataOfficesUpdated,
        })
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "refresh_center_error",
          centerId: center.id,
          centerName: center.name,
          message: error instanceof Error ? error.message : "unknown error",
        })
      );
    }

    if (throttleMs > 0) {
      await sleep(throttleMs);
    }
  }

  const lastCenter = centers[centers.length - 1];
  await setRefreshCursor(env.DB, lastCenter.id);

  console.log(
    JSON.stringify({
      event: "refresh_batch_complete",
      cursorStart: cursor,
      cursorEnd: lastCenter.id,
      centersProcessed: processed,
      officesFetched: totalFetched,
      wikidataEntitiesFetched: totalWikidataEntitiesFetched,
      wikidataOfficesUpdated: totalWikidataOfficesUpdated,
    })
  );
}

export async function runRefreshAllCenters(
  env: Env,
  options?: {
    throttleMs?: number;
    batchSize?: number;
    radiusM?: number;
    maxOffices?: number | null;
  }
): Promise<RefreshAllResult> {
  const batchSize = Math.max(
    1,
    toPositiveInt(
      String(options?.batchSize ?? env.BATCH_CENTERS_PER_RUN ?? "10"),
      10
    )
  );
  const throttleMs = Math.max(
    0,
    toPositiveInt(
      String(options?.throttleMs ?? env.OVERPASS_THROTTLE_MS ?? "1200"),
      1200
    )
  );
  const radiusM =
    typeof options?.radiusM === "number" &&
    Number.isFinite(options.radiusM) &&
    options.radiusM > 0
      ? Math.trunc(options.radiusM)
      : toPositiveInt(env.DEFAULT_RADIUS_M, 50000);
  const maxOffices =
    typeof options?.maxOffices === "number" &&
    Number.isFinite(options.maxOffices) &&
    options.maxOffices > 0
      ? Math.trunc(options.maxOffices)
      : null;

  let cursor = 0;
  let centersAttempted = 0;
  let centersSucceeded = 0;
  let centersFailed = 0;
  let officesFetched = 0;
  let wikidataEntitiesFetched = 0;
  let wikidataOfficesUpdated = 0;

  while (true) {
    const centers = await listCentersAfterCursor(env.DB, cursor, batchSize);
    if (centers.length === 0) {
      break;
    }

    for (const center of centers) {
      centersAttempted += 1;

      try {
        const result = await refreshCenterOffices(env, center, {
          radiusM,
          maxOffices,
        });
        centersSucceeded += 1;
        officesFetched += result.officesFetched;
        wikidataEntitiesFetched += result.wikidataEntitiesFetched;
        wikidataOfficesUpdated += result.wikidataOfficesUpdated;

        console.log(
          JSON.stringify({
            event: "refresh_all_center_success",
            centerId: result.centerId,
            centerName: result.centerName,
            officesFetched: result.officesFetched,
            linksUpserted: result.linksUpserted,
            prunedLinks: result.prunedLinks,
            wikidataEntitiesFetched: result.wikidataEntitiesFetched,
            wikidataOfficesUpdated: result.wikidataOfficesUpdated,
          })
        );
      } catch (error) {
        centersFailed += 1;
        console.error(
          JSON.stringify({
            event: "refresh_all_center_error",
            centerId: center.id,
            centerName: center.name,
            message: error instanceof Error ? error.message : "unknown error",
          })
        );
      }

      if (throttleMs > 0) {
        await sleep(throttleMs);
      }
    }

    cursor = centers[centers.length - 1]?.id ?? cursor;
    await setRefreshCursor(env.DB, cursor);
  }

  console.log(
    JSON.stringify({
      event: "refresh_all_complete",
      centersAttempted,
      centersSucceeded,
      centersFailed,
      officesFetched,
      wikidataEntitiesFetched,
      wikidataOfficesUpdated,
      throttleMs,
      batchSize,
      radiusM,
      maxOffices,
      cursorEnd: cursor,
    })
  );

  return {
    centersAttempted,
    centersSucceeded,
    centersFailed,
    officesFetched,
    wikidataEntitiesFetched,
    wikidataOfficesUpdated,
    throttleMs,
    batchSize,
    radiusM,
    maxOffices,
    cursorEnd: cursor,
  };
}
