import { runScheduledRefresh } from "./refresh";
import { handleRequest } from "./router";
import type { Env, ExecutionContext, ScheduledEvent } from "./types";

const workerHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "fetch_error",
          message: error instanceof Error ? error.message : "unknown error",
        })
      );

      return new Response(
        JSON.stringify({
          error: "Internal server error",
        }),
        {
          status: 500,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "access-control-allow-origin": env.CORS_ORIGIN ?? "*",
            "access-control-allow-methods": "GET,POST,OPTIONS",
            "access-control-allow-headers": "content-type,authorization",
          },
        }
      );
    }
  },

  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    ctx.waitUntil(runScheduledRefresh(env));
  },
};

export default workerHandler;
