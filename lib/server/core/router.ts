import { isAdminAuthorized } from "./auth";
import {
  disableCentersMissingFromSync,
  getOperationalStatus,
  getCenterById,
  listCenters,
  listOfficesForCenter,
  upsertCenterFromCsv,
} from "./db";
import { parseCentersCsv } from "./csv";
import {
  refreshCenterOffices,
  runRefreshAllCenters,
  runScheduledRefresh,
} from "./refresh";
import type { Env } from "./types";
import { clamp, toBoolean, toPositiveInt } from "./utils";

const ALLOWED_REFRESH_RADIUS_KM = new Set([10, 25, 50, 100]);

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

    return jsonResponse(env, {
      center: {
        id: center.id,
        centerCode: center.centerCode,
        name: center.name,
        lat: center.lat,
        lon: center.lon,
      },
      radiusKm,
      offices: offices.map((office) => ({
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
      })),
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
    const { rows, issues } = parseCentersCsv(csvText);

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
    } = {};
    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      try {
        payload = (await request.json()) as {
          delayMs?: number | string;
          batchSize?: number | string;
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

    const delayMs = clamp(
      toPositiveInt(payload.delayMs, toPositiveInt(env.OVERPASS_THROTTLE_MS, 1200)),
      0,
      15000
    );
    const batchSize = clamp(
      toPositiveInt(payload.batchSize, toPositiveInt(env.BATCH_CENTERS_PER_RUN, 10)),
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

    const result = await runRefreshAllCenters(env, {
      throttleMs: delayMs,
      batchSize,
      radiusM,
      maxOffices,
    });

    return jsonResponse(env, {
      ok: result.centersFailed === 0,
      generatedAt: new Date().toISOString(),
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
