import { json } from "./guard.js";
import {
  createInspectHandler,
  type UpspectorInspectHandlerOptions,
} from "./inspect.js";
import { createEventsHandler, createMcpHandler } from "./mcp.js";

export type UpspectorHandlerOptions = UpspectorInspectHandlerOptions;

export interface UpspectorRouteContext {
  params: Promise<{ endpoint: string }>;
}

type Method = "GET" | "POST" | "DELETE";
type Handler = (request: Request) => Promise<Response> | Response;

/**
 * One route handler for every upspector endpoint, mounted as
 * `app/api/upspector/[endpoint]/route.ts`:
 * - `inspect` — the element picker (`createInspectHandler`);
 * - `events` — entries the browser forwards (`createEventsHandler`);
 * - `mcp` — the MCP server over those entries (`createMcpHandler`).
 *
 * `allowedHosts` applies to all three; the remaining options go to the
 * inspector. Development only, like each handler on its own.
 */
export function createUpspectorHandler(options: UpspectorHandlerOptions = {}) {
  const { allowedHosts } = options;
  const endpoints: Record<string, Partial<Record<Method, Handler>>> = {
    inspect: createInspectHandler(options),
    events: createEventsHandler({ allowedHosts }),
    mcp: createMcpHandler({ allowedHosts }),
  };

  function route(method: Method) {
    return async (
      request: Request,
      { params }: UpspectorRouteContext,
    ): Promise<Response> => {
      if (process.env.NODE_ENV !== "development") {
        return new Response(null, { status: 404 });
      }

      const { endpoint } = await params;
      const handlers = Object.hasOwn(endpoints, endpoint)
        ? endpoints[endpoint]
        : undefined;
      if (!handlers) return json({ error: `unknown endpoint: ${endpoint}` }, 404);

      const handler = handlers[method];
      if (!handler) {
        return new Response(null, {
          status: 405,
          headers: { allow: Object.keys(handlers).join(", ") },
        });
      }

      return handler(request);
    };
  }

  return { GET: route("GET"), POST: route("POST"), DELETE: route("DELETE") };
}
