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

  let file: File | null = null;

  try {
    const formData = await request.formData();
    const formFile = formData.get("file");
    if (formFile instanceof File) {
      file = formFile;
    }
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  if (!file) {
    return NextResponse.json(
      { error: "Attach a CSV file in `file`." },
      { status: 400 }
    );
  }

  const maxCsvBytes = 5 * 1024 * 1024;
  if (file.size > maxCsvBytes) {
    return NextResponse.json(
      { error: "CSV file is too large. Maximum size is 5MB." },
      { status: 413 }
    );
  }

  try {
    const upstreamFormData = new FormData();
    upstreamFormData.append("file", file, file.name);

    const upstreamResponse = await forwardToLocalAdminApi(
      "/api/admin/centers/upload-csv",
      {
        method: "POST",
        body: upstreamFormData,
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
            : "Upload request failed unexpectedly.",
      },
      { status: 500 }
    );
  }
}
