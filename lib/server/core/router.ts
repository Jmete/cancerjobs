import { isAdminAuthorized } from "./auth";
import {
  approveOfficeDeletionFlag,
  disableCentersMissingFromSync,
  getOperationalStatus,
  getCenterById,
  insertCompanyFromCsv,
  listCompaniesForMatching,
  listOfficeDeletionFlags,
  listCenters,
  listOfficesForCenter,
  officeExistsForCenter,
  rejectOfficeDeletionFlag,
  submitOfficeDeletionFlag,
  upsertCenterFromCsv,
} from "./db";
import { parseCentersCsv, parseCompaniesCsv } from "./csv";
import { buildCompanyMatchIndex, matchOfficeToCompany } from "./company-match";
import {
  refreshCenterOffices,
  runRefreshAllCenters,
  runScheduledRefresh,
} from "./refresh";
import type { Env, OfficeDeletionFlagStatus, Office } from "./types";
import { clamp, sanitizeText, toBoolean, toPositiveInt } from "./utils";

const ALLOWED_REFRESH_RADIUS_KM = new Set([10, 25, 50, 100]);
const ALLOWED_OSM_TYPES = new Set(["node", "way", "relation"]);
const ALLOWED_DELETION_FLAG_STATUS = new Set([
  "pending",
  "approved",
  "rejected",
  "all",
]);

function toNonNegativeInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function corsHeaders(env: Env): HeadersInit {
  return {
    "access-control-allow-origin": env.CORS_ORIGIN ?? "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
  };
}

function jsonResponse(env: Env, payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders(env),
    },
  });
}

function emptyResponse(env: Env, status = 204): Response {
  return new Response(null, {
    status,
    headers: corsHeaders(env),
  });
}

function unauthorized(env: Env): Response {
  return jsonResponse(
    env,
    {
      error: "Unauthorized",
      message: "Provide a valid Bearer token in the Authorization header.",
    },
    401
  );
}

function officePointKey(osmType: Office["osmType"], osmId: number): string {
  return `${osmType}:${osmId}`;
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  if (request.method === "OPTIONS") {
    return emptyResponse(env);
  }

  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === "GET" && path === "/api/centers") {
    const tier = url.searchParams.get("tier") ?? undefined;
    const activeOnly = toBoolean(url.searchParams.get("activeOnly"), true);
    const centers = await listCenters(env.DB, { tier, activeOnly });

    return jsonResponse(
      env,
      centers.map((center) => ({
        id: center.id,
        centerCode: center.centerCode,
        name: center.name,
        tier: center.tier,
        lat: center.lat,
        lon: center.lon,
        country: center.country,
        region: center.region,
      }))
    );
  }

  const officesMatch = path.match(/^\/api\/centers\/(\d+)\/offices$/);
  if (request.method === "GET" && officesMatch) {
    const centerId = Number.parseInt(officesMatch[1], 10);
    const center = await getCenterById(env.DB, centerId);
    if (!center) {
      return jsonResponse(
        env,
        { error: "Not found", message: `Center ${centerId} was not found.` },
        404
      );
    }

    const maxRadiusKm = Math.max(
      1,
      toPositiveInt(env.DEFAULT_RADIUS_M, 50000) / 1000
    );
    const requestedRadiusKm = Number.parseFloat(url.searchParams.get("radiusKm") ?? "25");
    const radiusKm = Number.isFinite(requestedRadiusKm)
      ? clamp(requestedRadiusKm, 1, maxRadiusKm)
      : Math.min(25, maxRadiusKm);

    const limitRaw = url.searchParams.get("limit");
    let limit: number | null = null;
    if (limitRaw !== null && limitRaw.trim() !== "") {
      const requestedLimit = Number.parseInt(limitRaw, 10);
      if (!Number.isFinite(requestedLimit)) {
        return jsonResponse(
          env,
          { error: "Bad request", message: "limit must be a positive integer." },
          400
        );
      }

      limit = clamp(requestedLimit, 1, 5000);
    }

    const highConfidenceOnly = toBoolean(
      url.searchParams.get("highConfidenceOnly"),
      false
    );
    const search = url.searchParams.get("search")?.trim() ?? "";

    const offices = await listOfficesForCenter(
      env.DB,
      centerId,
      radiusKm * 1000,
      limit,
      highConfidenceOnly,
      search
    );
    const linkedCompanyByOfficeKey = new Map<
      string,
      { companyId: number; companyName: string }
    >();

    if (offices.length > 0) {
      try {
        const companies = await listCompaniesForMatching(env.DB);
        if (companies.length > 0) {
          const companyIndex = buildCompanyMatchIndex(companies);

          for (const office of offices) {
            const match = matchOfficeToCompany(
              {
                osmType: office.osmType,
                osmId: office.osmId,
                name: office.name,
                brand: office.brand,
                operator: office.operator,
                website: office.website,
                wikidata: office.wikidata,
                lat: office.lat,
                lon: office.lon,
                lowConfidence: office.lowConfidence === 1,
                tagsJson: office.tagsJson,
              },
              companyIndex
            );

            if (match) {
              linkedCompanyByOfficeKey.set(
                officePointKey(office.osmType, office.osmId),
                {
                  companyId: match.companyId,
                  companyName: match.companyName,
                }
              );
            }
          }
        }
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "office_company_link_enrichment_error",
            centerId: center.id,
            message: error instanceof Error ? error.message : "unknown error",
          })
        );
      }
    }

    return jsonResponse(env, {
      center: {
        id: center.id,
        centerCode: center.centerCode,
        name: center.name,
        lat: center.lat,
        lon: center.lon,
      },
      radiusKm,
      offices: offices.map((office) => {
        const linkedCompany = linkedCompanyByOfficeKey.get(
          officePointKey(office.osmType, office.osmId)
        );

        return {
          osmType: office.osmType,
          osmId: office.osmId,
          name: office.name,
          brand: office.brand,
          operator: office.operator,
          website: office.website,
          wikidata: office.wikidata,
          wikidataEntityId: office.wikidataEntityId,
          employeeCount: office.employeeCount,
          employeeCountAsOf: office.employeeCountAsOf,
          marketCap: office.marketCap,
          marketCapCurrencyQid: office.marketCapCurrencyQid,
          marketCapAsOf: office.marketCapAsOf,
          wikidataEnrichedAt: office.wikidataEnrichedAt,
          lat: office.lat,
          lon: office.lon,
          lowConfidence: office.lowConfidence === 1,
          distanceM: office.distanceM,
          linkedCompanyId: linkedCompany?.companyId ?? null,
          linkedCompanyName: linkedCompany?.companyName ?? null,
        };
      }),
    });
  }

  if (request.method === "POST" && path === "/api/offices/flag-deletion") {
    let payload: {
      centerId?: number | string;
      osmType?: string;
      osmId?: number | string;
      reason?: string | null;
    } = {};
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return jsonResponse(
        env,
        { error: "Bad request", message: "Request must be JSON." },
        400
      );
    }

    try {
      payload = (await request.json()) as {
        centerId?: number | string;
        osmType?: string;
        osmId?: number | string;
        reason?: string | null;
      };
    } catch {
      return jsonResponse(
        env,
        { error: "Bad request", message: "Invalid JSON request body." },
        400
      );
    }

    const centerId = Number.parseInt(String(payload.centerId ?? ""), 10);
    if (!Number.isFinite(centerId) || centerId <= 0) {
      return jsonResponse(
        env,
        { error: "Bad request", message: "centerId must be a positive integer." },
        400
      );
    }

    const center = await getCenterById(env.DB, centerId);
    if (!center || !center.isActive) {
      return jsonResponse(
        env,
        { error: "Not found", message: `Center ${centerId} was not found.` },
        404
      );
    }

    const osmTypeRaw = String(payload.osmType ?? "").trim().toLowerCase();
    if (!ALLOWED_OSM_TYPES.has(osmTypeRaw)) {
      return jsonResponse(
        env,
        { error: "Bad request", message: "osmType must be one of: node, way, relation." },
        400
      );
    }
    const osmType = osmTypeRaw as Office["osmType"];

    const osmId = Number.parseInt(String(payload.osmId ?? ""), 10);
    if (!Number.isFinite(osmId) || osmId <= 0) {
      return jsonResponse(
        env,
        { error: "Bad request", message: "osmId must be a positive integer." },
        400
      );
    }

    const officeExists = await officeExistsForCenter(
      env.DB,
      centerId,
      osmType,
      osmId
    );
    if (!officeExists) {
      return jsonResponse(
        env,
        {
          error: "Not found",
          message:
            "Office was not found for the selected center and current saved points.",
        },
        404
      );
    }

    const result = await submitOfficeDeletionFlag(env.DB, {
      centerId,
      osmType,
      osmId,
      reason: sanitizeText(payload.reason ?? null, 500),
    });

    const message =
      result.outcome === "created"
        ? "Office flagged for admin review."
        : result.outcome === "already_pending"
          ? "This office already has a pending deletion flag."
          : "This office is already banned from refresh results.";

    return jsonResponse(env, {
      ok: true,
      outcome: result.outcome,
      flagId: result.flagId,
      message,
    });
  }

  if (request.method === "POST" && path === "/api/admin/centers/upload-csv") {
    if (!isAdminAuthorized(request, env)) {
      return unauthorized(env);
    }

    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.includes("multipart/form-data")) {
      return jsonResponse(
        env,
        {
          error: "Bad request",
          message: "Use multipart/form-data with a file field named `file`.",
        },
        400
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return jsonResponse(
        env,
        {
          error: "Bad request",
          message: "Missing CSV file. Attach it using form field `file`.",
        },
        400
      );
    }

    const csvText = await file.text();
    let parsedCentersCsv: ReturnType<typeof parseCentersCsv>;
    try {
      parsedCentersCsv = parseCentersCsv(csvText);
    } catch (error) {
      return jsonResponse(
        env,
        {
          error: "Bad request",
          message:
            error instanceof Error ? error.message : "Failed to parse centers CSV.",
        },
        400
      );
    }
    const { rows, issues } = parsedCentersCsv;

    if (rows.length === 0) {
      return jsonResponse(
        env,
        {
          error: "Bad request",
          message: "No valid center rows found in CSV.",
          issues,
        },
        400
      );
    }

    const syncToken = crypto.randomUUID();
    let inserted = 0;
    let updated = 0;

    for (const row of rows) {
      const operation = await upsertCenterFromCsv(env.DB, row, syncToken);
      if (operation === "inserted") {
        inserted += 1;
      } else {
        updated += 1;
      }
    }

    const disabled = await disableCentersMissingFromSync(env.DB, syncToken);

    return jsonResponse(env, {
      inserted,
      updated,
      disabled,
      acceptedRows: rows.length,
      rejectedRows: issues.length,
      issues: issues.slice(0, 100),
    });
  }

  if (request.method === "POST" && path === "/api/admin/companies/upload-csv") {
    if (!isAdminAuthorized(request, env)) {
      return unauthorized(env);
    }

    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.includes("multipart/form-data")) {
      return jsonResponse(
        env,
        {
          error: "Bad request",
          message: "Use multipart/form-data with a file field named `file`.",
        },
        400
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return jsonResponse(
        env,
        {
          error: "Bad request",
          message: "Missing CSV file. Attach it using form field `file`.",
        },
        400
      );
    }

    const csvText = await file.text();
    let parsedCompaniesCsv: ReturnType<typeof parseCompaniesCsv>;
    try {
      parsedCompaniesCsv = parseCompaniesCsv(csvText);
    } catch (error) {
      return jsonResponse(
        env,
        {
          error: "Bad request",
          message:
            error instanceof Error ? error.message : "Failed to parse companies CSV.",
        },
        400
      );
    }
    const { rows, issues } = parsedCompaniesCsv;

    if (rows.length === 0) {
      return jsonResponse(
        env,
        {
          error: "Bad request",
          message: "No valid company rows found in CSV.",
          issues,
        },
        400
      );
    }

    let inserted = 0;
    let skipped = 0;

    for (const row of rows) {
      const operation = await insertCompanyFromCsv(env.DB, row);
      if (operation === "inserted") {
        inserted += 1;
      } else {
        skipped += 1;
      }
    }

    return jsonResponse(env, {
      inserted,
      skipped,
      acceptedRows: rows.length,
      rejectedRows: issues.length,
      issues: issues.slice(0, 100),
    });
  }

  const manualRefreshMatch = path.match(/^\/api\/admin\/refresh-center\/(\d+)$/);
  if (request.method === "POST" && manualRefreshMatch) {
    if (!isAdminAuthorized(request, env)) {
      return unauthorized(env);
    }

    const centerId = Number.parseInt(manualRefreshMatch[1], 10);
    const center = await getCenterById(env.DB, centerId);

    if (!center || !center.isActive) {
      return jsonResponse(
        env,
        { error: "Not found", message: `Center ${centerId} is missing or inactive.` },
        404
      );
    }

    let payload: { radiusKm?: number | string; maxOffices?: number | string | null } = {};
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      try {
        payload = (await request.json()) as {
          radiusKm?: number | string;
          maxOffices?: number | string | null;
        };
      } catch {
        return jsonResponse(
          env,
          { error: "Bad request", message: "Invalid JSON request body." },
          400
        );
      }
    }

    const radiusSource = payload.radiusKm ?? url.searchParams.get("radiusKm");
    let radiusM: number | undefined;
    if (radiusSource !== undefined && radiusSource !== null) {
      const radiusRaw = String(radiusSource).trim();
      if (radiusRaw) {
        const radiusKm = Number.parseInt(radiusRaw, 10);
        if (!Number.isFinite(radiusKm) || !ALLOWED_REFRESH_RADIUS_KM.has(radiusKm)) {
          return jsonResponse(
            env,
            {
              error: "Bad request",
              message: "radiusKm must be one of: 10, 25, 50, 100.",
            },
            400
          );
        }
        radiusM = radiusKm * 1000;
      }
    }

    const maxOfficesSource =
      payload.maxOffices ?? url.searchParams.get("maxOffices");
    let maxOffices: number | null | undefined;
    if (maxOfficesSource !== undefined && maxOfficesSource !== null) {
      const maxOfficesRaw = String(maxOfficesSource).trim();
      if (!maxOfficesRaw) {
        maxOffices = null;
      } else {
        const parsedMaxOffices = Number.parseInt(maxOfficesRaw, 10);
        if (!Number.isFinite(parsedMaxOffices) || parsedMaxOffices <= 0) {
          return jsonResponse(
            env,
            {
              error: "Bad request",
              message: "maxOffices must be blank or a positive integer.",
            },
            400
          );
        }
        maxOffices = clamp(parsedMaxOffices, 1, 10000);
      }
    }

    const result = await refreshCenterOffices(env, center, {
      radiusM,
      maxOffices,
    });
    return jsonResponse(env, {
      ok: true,
      result,
    });
  }

  if (request.method === "POST" && path === "/api/admin/refresh-batch") {
    if (!isAdminAuthorized(request, env)) {
      return unauthorized(env);
    }

    await runScheduledRefresh(env);
    return jsonResponse(env, {
      ok: true,
      message: "Refresh batch completed.",
      generatedAt: new Date().toISOString(),
    });
  }

  if (request.method === "POST" && path === "/api/admin/refresh-all") {
    if (!isAdminAuthorized(request, env)) {
      return unauthorized(env);
    }

    let payload: {
      delayMs?: number | string;
      batchSize?: number | string;
      radiusKm?: number | string;
      maxOffices?: number | string | null;
      fullClean?: boolean | string;
      centerRetryCount?: number | string;
      retryDelayMs?: number | string;
    } = {};
    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      try {
        payload = (await request.json()) as {
          delayMs?: number | string;
          batchSize?: number | string;
          radiusKm?: number | string;
          maxOffices?: number | string | null;
          fullClean?: boolean | string;
          centerRetryCount?: number | string;
          retryDelayMs?: number | string;
        };
      } catch {
        return jsonResponse(
          env,
          { error: "Bad request", message: "Invalid JSON request body." },
          400
        );
      }
    }

    const delaySource =
      payload.delayMs === undefined ? env.OVERPASS_THROTTLE_MS : String(payload.delayMs);
    const delayMs = clamp(
      toNonNegativeInt(delaySource, toPositiveInt(env.OVERPASS_THROTTLE_MS, 1200)),
      0,
      15000
    );
    const centerRetryCountSource =
      payload.centerRetryCount === undefined
        ? env.REFRESH_CENTER_RETRY_COUNT
        : String(payload.centerRetryCount);
    const centerRetryCount = clamp(
      toNonNegativeInt(centerRetryCountSource, toPositiveInt(env.REFRESH_CENTER_RETRY_COUNT, 3)),
      0,
      5
    );
    const retryDelaySource =
      payload.retryDelayMs === undefined
        ? env.REFRESH_CENTER_RETRY_DELAY_MS
        : String(payload.retryDelayMs);
    const retryDelayMs = clamp(
      toNonNegativeInt(
        retryDelaySource,
        toNonNegativeInt(env.REFRESH_CENTER_RETRY_DELAY_MS, 2000)
      ),
      0,
      60000
    );
    const batchSizeSource =
      payload.batchSize === undefined
        ? env.BATCH_CENTERS_PER_RUN
        : String(payload.batchSize);
    const batchSize = clamp(
      toPositiveInt(batchSizeSource, toPositiveInt(env.BATCH_CENTERS_PER_RUN, 10)),
      1,
      200
    );

    const radiusSource = payload.radiusKm;
    let radiusM: number | undefined;
    if (radiusSource !== undefined && radiusSource !== null) {
      const radiusRaw = String(radiusSource).trim();
      if (radiusRaw) {
        const radiusKm = Number.parseInt(radiusRaw, 10);
        if (!Number.isFinite(radiusKm) || !ALLOWED_REFRESH_RADIUS_KM.has(radiusKm)) {
          return jsonResponse(
            env,
            {
              error: "Bad request",
              message: "radiusKm must be one of: 10, 25, 50, 100.",
            },
            400
          );
        }
        radiusM = radiusKm * 1000;
      }
    }

    let maxOffices: number | null | undefined;
    if (payload.maxOffices !== undefined && payload.maxOffices !== null) {
      const maxOfficesRaw = String(payload.maxOffices).trim();
      if (!maxOfficesRaw) {
        maxOffices = null;
      } else {
        const parsedMaxOffices = Number.parseInt(maxOfficesRaw, 10);
        if (!Number.isFinite(parsedMaxOffices) || parsedMaxOffices <= 0) {
          return jsonResponse(
            env,
            {
              error: "Bad request",
              message: "maxOffices must be blank or a positive integer.",
            },
            400
          );
        }
        maxOffices = clamp(parsedMaxOffices, 1, 10000);
      }
    }

    const fullClean =
      typeof payload.fullClean === "boolean"
        ? payload.fullClean
        : toBoolean(
            payload.fullClean === undefined || payload.fullClean === null
              ? null
              : String(payload.fullClean),
            false
          );

    const result = await runRefreshAllCenters(env, {
      throttleMs: delayMs,
      batchSize,
      radiusM,
      maxOffices,
      fullClean,
      centerRetryCount,
      retryDelayMs,
    });

    return jsonResponse(env, {
      ok: result.centersFailed === 0,
      generatedAt: new Date().toISOString(),
      result,
    });
  }

  if (request.method === "GET" && path === "/api/admin/offices/deletion-flags") {
    if (!isAdminAuthorized(request, env)) {
      return unauthorized(env);
    }

    const requestedStatus = (
      url.searchParams.get("status") ?? "pending"
    ).trim().toLowerCase();
    if (!ALLOWED_DELETION_FLAG_STATUS.has(requestedStatus)) {
      return jsonResponse(
        env,
        {
          error: "Bad request",
          message: "status must be one of: pending, approved, rejected, all.",
        },
        400
      );
    }

    const requestedLimit = toPositiveInt(url.searchParams.get("limit") ?? undefined, 100);
    const limit = clamp(requestedLimit, 1, 500);
    const status =
      requestedStatus === "all"
        ? undefined
        : (requestedStatus as OfficeDeletionFlagStatus);

    const items = await listOfficeDeletionFlags(env.DB, { status, limit });

    return jsonResponse(env, {
      ok: true,
      count: items.length,
      items,
    });
  }

  const flagDecisionMatch = path.match(
    /^\/api\/admin\/offices\/deletion-flags\/(\d+)\/decision$/
  );
  if (request.method === "POST" && flagDecisionMatch) {
    if (!isAdminAuthorized(request, env)) {
      return unauthorized(env);
    }

    const flagId = Number.parseInt(flagDecisionMatch[1], 10);
    if (!Number.isFinite(flagId) || flagId <= 0) {
      return jsonResponse(
        env,
        { error: "Bad request", message: "flagId must be a positive integer." },
        400
      );
    }

    let payload: { decision?: string } = {};
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return jsonResponse(
        env,
        { error: "Bad request", message: "Request must be JSON." },
        400
      );
    }

    try {
      payload = (await request.json()) as { decision?: string };
    } catch {
      return jsonResponse(
        env,
        { error: "Bad request", message: "Invalid JSON request body." },
        400
      );
    }

    const decision = String(payload.decision ?? "").trim().toLowerCase();
    if (decision !== "approve" && decision !== "reject") {
      return jsonResponse(
        env,
        { error: "Bad request", message: "decision must be either approve or reject." },
        400
      );
    }

    const result =
      decision === "approve"
        ? await approveOfficeDeletionFlag(env.DB, flagId)
        : await rejectOfficeDeletionFlag(env.DB, flagId);

    if (result.outcome === "not_found") {
      return jsonResponse(
        env,
        { error: "Not found", message: `Flag ${flagId} was not found.` },
        404
      );
    }

    if (decision === "reject" && result.outcome === "already_approved") {
      return jsonResponse(
        env,
        {
          error: "Conflict",
          message: `Flag ${flagId} is already approved and cannot be rejected.`,
        },
        409
      );
    }

    return jsonResponse(env, {
      ok: result.outcome === "approved" || result.outcome === "rejected",
      result,
    });
  }

  if (request.method === "GET" && path === "/api/admin/status") {
    if (!isAdminAuthorized(request, env)) {
      return unauthorized(env);
    }

    const includeCounts = toBoolean(url.searchParams.get("includeCounts"), false);
    const status = await getOperationalStatus(env.DB, {
      includeHeavyCounts: includeCounts,
    });
    const maxRefreshAgeMinutes = toPositiveInt(
      env.REFRESH_HEALTH_MAX_AGE_MINUTES,
      130
    );

    const refreshUpdatedAtMs = status.refreshUpdatedAt
      ? Date.parse(status.refreshUpdatedAt)
      : Number.NaN;
    const refreshAgeMinutes = Number.isFinite(refreshUpdatedAtMs)
      ? (Date.now() - refreshUpdatedAtMs) / (1000 * 60)
      : null;

    const refreshHealthy =
      refreshAgeMinutes !== null && refreshAgeMinutes <= maxRefreshAgeMinutes;
    const centersHealthy = status.activeCenters > 0;
    const healthy = centersHealthy && refreshHealthy;

    const checks = {
      activeCentersAtLeastOne: centersHealthy,
      refreshStatePresent: status.refreshUpdatedAt !== null,
      refreshRecentEnough: refreshHealthy,
    };

    return jsonResponse(env, {
      ok: healthy,
      generatedAt: new Date().toISOString(),
      checks,
      thresholds: {
        maxRefreshAgeMinutes,
      },
      metrics: {
        exactCounts: status.exactCounts,
        centersTotal: status.centersTotal,
        activeCenters: status.activeCenters,
        officesTotal: status.officesTotal,
        centerOfficeLinksTotal: status.centerOfficeLinksTotal,
      },
      refresh: {
        cursor: status.refreshCursor,
        updatedAt: status.refreshUpdatedAt,
        ageMinutes: refreshAgeMinutes,
      },
    });
  }

  if (request.method === "GET" && path === "/api/health") {
    return jsonResponse(env, {
      ok: true,
      timestamp: new Date().toISOString(),
    });
  }

  return jsonResponse(
    env,
    {
      error: "Not found",
      message: `No route matches ${request.method} ${path}`,
    },
    404
  );
}
