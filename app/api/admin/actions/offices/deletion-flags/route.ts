import { NextResponse } from "next/server";

import {
  isAdminRequestAuthenticated,
  isSameOriginRequest,
  unauthorizedResponse,
} from "@/lib/admin-auth";
import { forwardToLocalAdminApi } from "@/lib/server/admin-api-forward";

export async function GET(request: Request): Promise<Response> {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  }

  const authenticated = await isAdminRequestAuthenticated(request);
  if (!authenticated) {
    return unauthorizedResponse();
  }

  try {
    const requestUrl = new URL(request.url);
    const upstreamParams = new URLSearchParams();
    const status = requestUrl.searchParams.get("status");
    const limit = requestUrl.searchParams.get("limit");

    if (status) {
      upstreamParams.set("status", status);
    }
    if (limit) {
      upstreamParams.set("limit", limit);
    }

    const upstreamPath = upstreamParams.toString()
      ? `/api/admin/offices/deletion-flags?${upstreamParams.toString()}`
      : "/api/admin/offices/deletion-flags";

    const upstreamResponse = await forwardToLocalAdminApi(upstreamPath, {
      method: "GET",
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
            : "Office deletion flags request failed unexpectedly.",
      },
      { status: 500 }
    );
  }
}
