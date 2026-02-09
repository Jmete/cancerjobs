import { handleLocalApiRequest } from "@/lib/server/local-api-handler";

export async function GET(request: Request): Promise<Response> {
  return handleLocalApiRequest(request, "/api/admin/status");
}

export async function OPTIONS(request: Request): Promise<Response> {
  return handleLocalApiRequest(request, "/api/admin/status");
}
