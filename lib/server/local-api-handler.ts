import "server-only";

import { handleRequest } from "@/lib/server/core/router";

import { createLocalApiEnv } from "./local-api-env";

const LOCAL_ORIGIN = "http://localhost";

function withPath(request: Request, path: string): Request {
  const url = new URL(request.url || LOCAL_ORIGIN, LOCAL_ORIGIN);
  const override = new URL(path, LOCAL_ORIGIN);
  url.pathname = override.pathname;
  // Keep original query params unless the override path explicitly provides its own.
  if (override.search) {
    url.search = override.search;
  }
  return new Request(url.toString(), request);
}

export function handleLocalApiRequest(
  request: Request,
  pathOverride?: string
): Promise<Response> {
  const routedRequest = pathOverride ? withPath(request, pathOverride) : request;
  return handleRequest(routedRequest, createLocalApiEnv());
}
