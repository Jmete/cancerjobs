import { handleLocalApiRequest } from "@/lib/server/local-api-handler";

export async function POST(request: Request): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  const match = pathname.match(/^\/api\/admin\/refresh-center\/(\d+)$/);
  const centerId = match?.[1];

  if (!centerId) {
    return new Response(
      JSON.stringify({
        error: "Bad request",
        message: "centerId must be a positive integer.",
      }),
      {
        status: 400,
        headers: { "content-type": "application/json; charset=utf-8" },
      }
    );
  }

  return handleLocalApiRequest(request, `/api/admin/refresh-center/${centerId}`);
}

export async function OPTIONS(request: Request): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  const match = pathname.match(/^\/api\/admin\/refresh-center\/(\d+)$/);
  const centerId = match?.[1] ?? "0";
  return handleLocalApiRequest(request, `/api/admin/refresh-center/${centerId}`);
}
