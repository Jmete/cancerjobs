import { handleLocalApiRequest } from "@/lib/server/local-api-handler";

export async function POST(request: Request): Promise<Response> {
  return handleLocalApiRequest(request, "/api/admin/centers/upload-csv");
}

export async function OPTIONS(request: Request): Promise<Response> {
  return handleLocalApiRequest(request, "/api/admin/centers/upload-csv");
}
