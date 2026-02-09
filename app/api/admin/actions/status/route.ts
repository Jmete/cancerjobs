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
    const includeCounts = requestUrl.searchParams.get("includeCounts");
    const upstreamPath =
      includeCounts === "1" || includeCounts === "true"
        ? "/api/admin/status?includeCounts=true"
        : "/api/admin/status";

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
            : "Status request failed unexpectedly.",
      },
      { status: 500 }
    );
  }
}
