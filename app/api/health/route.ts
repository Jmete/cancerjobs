import { handleLocalApiRequest } from "@/lib/server/local-api-handler";

export async function GET(request: Request): Promise<Response> {
  return handleLocalApiRequest(request, "/api/health");
}

export async function OPTIONS(request: Request): Promise<Response> {
  return handleLocalApiRequest(request, "/api/health");
}
