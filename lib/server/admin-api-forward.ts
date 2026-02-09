import "server-only";

import { handleLocalApiRequest } from "./local-api-handler";

function getAdminApiToken(): string {
  const token = process.env.ADMIN_API_TOKEN;
  if (!token) {
    throw new Error("Missing ADMIN_API_TOKEN.");
  }

  return token.trim();
}

export async function forwardToLocalAdminApi(
  path: string,
  init: RequestInit
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${getAdminApiToken()}`);

  const request = new Request(`http://localhost${path}`, {
    method: init.method,
    headers,
    body: init.body,
  });

  return handleLocalApiRequest(request, path);
}
