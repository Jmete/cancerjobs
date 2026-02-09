import type { Env } from "./types";

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let result = 0;
  for (let index = 0; index < a.length; index += 1) {
    result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }

  return result === 0;
}

export function isAdminAuthorized(request: Request, env: Env): boolean {
  const configuredToken = env.ADMIN_TOKEN;
  if (!configuredToken) return false;

  const headerValue = request.headers.get("authorization");
  if (!headerValue || !headerValue.startsWith("Bearer ")) {
    return false;
  }

  const providedToken = headerValue.slice("Bearer ".length).trim();
  if (!providedToken) return false;

  return constantTimeEqual(providedToken, configuredToken);
}
