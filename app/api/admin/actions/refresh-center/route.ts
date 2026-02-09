import { NextResponse } from "next/server";

import {
  isAdminRequestAuthenticated,
  isSameOriginRequest,
  unauthorizedResponse,
} from "@/lib/admin-auth";
import { forwardToLocalAdminApi } from "@/lib/server/admin-api-forward";

export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  }

  const authenticated = await isAdminRequestAuthenticated(request);
  if (!authenticated) {
    return unauthorizedResponse();
  }

  let centerId = Number.NaN;
  let radiusKm: number | string | undefined;
  let maxOffices: number | string | null | undefined;

  try {
    const payload = (await request.json()) as {
      centerId?: number | string;
      radiusKm?: number | string;
      maxOffices?: number | string | null;
    };
    centerId = Number(payload.centerId);
    radiusKm = payload.radiusKm;
    maxOffices = payload.maxOffices;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!Number.isFinite(centerId) || centerId <= 0) {
    return NextResponse.json({ error: "centerId must be a positive number." }, { status: 400 });
  }

  try {
    const refreshPayload: {
      radiusKm?: number | string;
      maxOffices?: number | string | null;
    } = {};

    if (radiusKm !== undefined) {
      refreshPayload.radiusKm = radiusKm;
    }
    if (maxOffices !== undefined) {
      refreshPayload.maxOffices = maxOffices;
    }

    const upstreamResponse = await forwardToLocalAdminApi(
      `/api/admin/refresh-center/${Math.trunc(centerId)}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(refreshPayload),
      }
    );

    const upstreamPayload = await upstreamResponse.text();

    return new Response(upstreamPayload, {
      status: upstreamResponse.status,
      headers: {
        "content-type":
          upstreamResponse.headers.get("content-type") ??
          "application/json; charset=utf-8",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Refresh request failed unexpectedly.",
      },
      { status: 500 }
    );
  }
}
