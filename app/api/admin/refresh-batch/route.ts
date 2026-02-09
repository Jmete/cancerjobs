import { handleLocalApiRequest } from "@/lib/server/local-api-handler";

export async function POST(request: Request): Promise<Response> {
  return handleLocalApiRequest(request, "/api/admin/refresh-batch");
}

export async function OPTIONS(request: Request): Promise<Response> {
  return handleLocalApiRequest(request, "/api/admin/refresh-batch");
}
