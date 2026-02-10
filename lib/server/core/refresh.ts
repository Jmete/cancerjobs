import {
  applyWikidataEnrichment,
  getRefreshCursor,
  listBannedOfficeKeys,
  listCompaniesForMatching,
  listStaleWikidataEntityIds,
  listCentersAfterCursor,
  pruneCenterLinksNotSeenSince,
  purgeAllOfficePoints,
  pruneStaleCenterLinks,
  setRefreshCursor,
  upsertOfficesAndLinks,
} from "./db";
import {
  buildCompanyMatchIndex,
  filterOfficesWithKnownCompanies,
} from "./company-match";
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
  officesMatchedCompanies: number;
  officesFilteredOutNoCompanyMatch: number;
  linksUpserted: number;
  prunedLinks: number;
  wikidataEntitiesFetched: number;
  wikidataOfficesUpdated: number;
}

export interface RefreshSearchOptions {
  radiusM?: number;
  maxOffices?: number | null;
  companyMatchIndex?: CompanyMatchIndex;
  bannedOfficeKeys?: BannedOfficeKeySet;
}

export interface RefreshAllResult {
  fullClean: boolean;
  cleanedLinksDeleted: number;
  cleanedOfficesDeleted: number;
  centersAttempted: number;
  centersSucceeded: number;
  centersFailed: number;
  officesFetched: number;
  officesMatchedCompanies: number;
  officesFilteredOutNoCompanyMatch: number;
  wikidataEntitiesFetched: number;
  wikidataOfficesUpdated: number;
  throttleMs: number;
  batchSize: number;
  radiusM: number;
  maxOffices: number | null;
  centerRetryCount: number;
  retryDelayMs: number;
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

type CompanyMatchIndex = ReturnType<typeof buildCompanyMatchIndex>;
type BannedOfficeKeySet = Set<string>;

function toNonNegativeInt(value: unknown, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
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

async function loadCompanyMatchIndex(env: Env): Promise<CompanyMatchIndex> {
  const companies = await listCompaniesForMatching(env.DB);
  return buildCompanyMatchIndex(companies);
}

function officeKey(osmType: CenterOffice["osmType"], osmId: number): string {
  return `${osmType}:${osmId}`;
}

async function loadBannedOfficeKeys(env: Env): Promise<BannedOfficeKeySet> {
  const bannedOffices = await listBannedOfficeKeys(env.DB);
  return new Set(
    bannedOffices.map((office) => officeKey(office.osmType, office.osmId))
  );
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
      : toPositiveInt(env.DEFAULT_RADIUS_M, 100000);
  const maxOffices =
    typeof options?.maxOffices === "number" &&
    Number.isFinite(options.maxOffices) &&
    options.maxOffices > 0
      ? Math.trunc(options.maxOffices)
      : null;
  const staleDays = toPositiveInt(env.STALE_LINK_DAYS, 30);
  const companyMatchIndex =
    options?.companyMatchIndex ?? (await loadCompanyMatchIndex(env));
  const bannedOfficeKeys = options?.bannedOfficeKeys ?? (await loadBannedOfficeKeys(env));
  const query = buildOfficesQuery(center.lat, center.lon, radiusM);
  const elements = await fetchOverpassElements(env, query);
  const normalizedOffices = normalizeOverpassElements(elements);
  const cappedOffices = capOfficesByLimit(center, normalizedOffices, maxOffices);
  const { matchedOffices, matchedCount, filteredOutCount } =
    filterOfficesWithKnownCompanies(cappedOffices, companyMatchIndex);
  const offices = matchedOffices.filter(
    (office) => !bannedOfficeKeys.has(officeKey(office.osmType, office.osmId))
  );

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

  const prunedUnmatchedLinks = await pruneCenterLinksNotSeenSince(
    env.DB,
    center.id,
    seenAt
  );
  const prunedStaleLinks = await pruneStaleCenterLinks(env.DB, center.id, staleDays);
  const prunedLinks = prunedUnmatchedLinks + prunedStaleLinks;

  return {
    centerId: center.id,
    centerName: center.name,
    officesFetched: cappedOffices.length,
    officesMatchedCompanies: matchedCount,
    officesFilteredOutNoCompanyMatch: filteredOutCount,
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
  let totalMatchedCompanies = 0;
  let totalFilteredOutNoCompanyMatch = 0;
  let totalWikidataEntitiesFetched = 0;
  let totalWikidataOfficesUpdated = 0;
  const companyMatchIndex = await loadCompanyMatchIndex(env);
  const bannedOfficeKeys = await loadBannedOfficeKeys(env);

  for (const center of centers) {
    try {
      const result = await refreshCenterOffices(env, center, {
        companyMatchIndex,
        bannedOfficeKeys,
      });
      processed += 1;
      totalFetched += result.officesFetched;
      totalMatchedCompanies += result.officesMatchedCompanies;
      totalFilteredOutNoCompanyMatch += result.officesFilteredOutNoCompanyMatch;
      totalWikidataEntitiesFetched += result.wikidataEntitiesFetched;
      totalWikidataOfficesUpdated += result.wikidataOfficesUpdated;

      console.log(
        JSON.stringify({
          event: "refresh_center_success",
          centerId: result.centerId,
          centerName: result.centerName,
          officesFetched: result.officesFetched,
          officesMatchedCompanies: result.officesMatchedCompanies,
          officesFilteredOutNoCompanyMatch:
            result.officesFilteredOutNoCompanyMatch,
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
      officesMatchedCompanies: totalMatchedCompanies,
      officesFilteredOutNoCompanyMatch: totalFilteredOutNoCompanyMatch,
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
    fullClean?: boolean;
    centerRetryCount?: number;
    retryDelayMs?: number;
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
    toNonNegativeInt(options?.throttleMs ?? env.OVERPASS_THROTTLE_MS, 1200)
  );
  const centerRetryCount = Math.min(
    5,
    Math.max(
      0,
      toNonNegativeInt(
        options?.centerRetryCount ?? env.REFRESH_CENTER_RETRY_COUNT,
        3
      )
    )
  );
  const retryDelayMs = Math.min(
    60000,
    Math.max(
      0,
      toNonNegativeInt(
        options?.retryDelayMs ?? env.REFRESH_CENTER_RETRY_DELAY_MS,
        2000
      )
    )
  );
  const radiusM =
    typeof options?.radiusM === "number" &&
    Number.isFinite(options.radiusM) &&
    options.radiusM > 0
      ? Math.trunc(options.radiusM)
      : toPositiveInt(env.DEFAULT_RADIUS_M, 100000);
  const maxOffices =
    typeof options?.maxOffices === "number" &&
    Number.isFinite(options.maxOffices) &&
    options.maxOffices > 0
      ? Math.trunc(options.maxOffices)
      : null;
  const fullClean = options?.fullClean === true;

  let cursor = 0;
  let cleanedLinksDeleted = 0;
  let cleanedOfficesDeleted = 0;
  let centersAttempted = 0;
  let centersSucceeded = 0;
  let centersFailed = 0;
  let officesFetched = 0;
  let officesMatchedCompanies = 0;
  let officesFilteredOutNoCompanyMatch = 0;
  let wikidataEntitiesFetched = 0;
  let wikidataOfficesUpdated = 0;

  if (fullClean) {
    const cleanupResult = await purgeAllOfficePoints(env.DB);
    cleanedLinksDeleted = cleanupResult.linksDeleted;
    cleanedOfficesDeleted = cleanupResult.officesDeleted;
  }

  const companyMatchIndex = await loadCompanyMatchIndex(env);
  const bannedOfficeKeys = await loadBannedOfficeKeys(env);

  while (true) {
    const centers = await listCentersAfterCursor(env.DB, cursor, batchSize);
    if (centers.length === 0) {
      break;
    }

    for (const center of centers) {
      centersAttempted += 1;

      const attemptsAllowed = centerRetryCount + 1;
      let result: RefreshCenterResult | null = null;
      let lastError: unknown = null;

      for (let attempt = 1; attempt <= attemptsAllowed; attempt += 1) {
        try {
          result = await refreshCenterOffices(env, center, {
            radiusM,
            maxOffices,
            companyMatchIndex,
            bannedOfficeKeys,
          });
          break;
        } catch (error) {
          lastError = error;

          if (attempt < attemptsAllowed) {
            const nextAttempt = attempt + 1;
            console.warn(
              JSON.stringify({
                event: "refresh_all_center_retry",
                centerId: center.id,
                centerName: center.name,
                attempt,
                nextAttempt,
                maxAttempts: attemptsAllowed,
                retryDelayMs,
                message: error instanceof Error ? error.message : "unknown error",
              })
            );

            if (retryDelayMs > 0) {
              await sleep(retryDelayMs);
            }
          }
        }
      }

      if (result) {
        centersSucceeded += 1;
        officesFetched += result.officesFetched;
        officesMatchedCompanies += result.officesMatchedCompanies;
        officesFilteredOutNoCompanyMatch +=
          result.officesFilteredOutNoCompanyMatch;
        wikidataEntitiesFetched += result.wikidataEntitiesFetched;
        wikidataOfficesUpdated += result.wikidataOfficesUpdated;

        console.log(
          JSON.stringify({
            event: "refresh_all_center_success",
            centerId: result.centerId,
            centerName: result.centerName,
            officesFetched: result.officesFetched,
            officesMatchedCompanies: result.officesMatchedCompanies,
            officesFilteredOutNoCompanyMatch:
              result.officesFilteredOutNoCompanyMatch,
            linksUpserted: result.linksUpserted,
            prunedLinks: result.prunedLinks,
            wikidataEntitiesFetched: result.wikidataEntitiesFetched,
            wikidataOfficesUpdated: result.wikidataOfficesUpdated,
          })
        );
      } else {
        centersFailed += 1;
        console.error(
          JSON.stringify({
            event: "refresh_all_center_error",
            centerId: center.id,
            centerName: center.name,
            attempts: attemptsAllowed,
            message:
              lastError instanceof Error ? lastError.message : "unknown error",
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
      fullClean,
      cleanedLinksDeleted,
      cleanedOfficesDeleted,
      centersAttempted,
      centersSucceeded,
      centersFailed,
      officesFetched,
      officesMatchedCompanies,
      officesFilteredOutNoCompanyMatch,
      wikidataEntitiesFetched,
      wikidataOfficesUpdated,
      throttleMs,
      batchSize,
      radiusM,
      maxOffices,
      centerRetryCount,
      retryDelayMs,
      cursorEnd: cursor,
    })
  );

  return {
    fullClean,
    cleanedLinksDeleted,
    cleanedOfficesDeleted,
    centersAttempted,
    centersSucceeded,
    centersFailed,
    officesFetched,
    officesMatchedCompanies,
    officesFilteredOutNoCompanyMatch,
    wikidataEntitiesFetched,
    wikidataOfficesUpdated,
    throttleMs,
    batchSize,
    radiusM,
    maxOffices,
    centerRetryCount,
    retryDelayMs,
    cursorEnd: cursor,
  };
}
