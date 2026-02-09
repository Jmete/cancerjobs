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

  let payload: {
    delayMs?: number | string;
    batchSize?: number | string;
    radiusKm?: number | string;
    maxOffices?: number | string | null;
  } = {};

  try {
    payload = (await request.json()) as {
      delayMs?: number | string;
      batchSize?: number | string;
      radiusKm?: number | string;
      maxOffices?: number | string | null;
    };
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  try {
    const upstreamResponse = await forwardToLocalAdminApi("/api/admin/refresh-all", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

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
            : "Refresh-all request failed unexpectedly.",
      },
      { status: 500 }
    );
  }
}
