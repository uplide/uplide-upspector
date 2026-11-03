import {
  type DebugbarEntry,
  type DebugbarRenderPass,
  isRecord,
} from "@uplide/debugbar";
import {
  clearAgentBuffer,
  type DebugbarBufferedEntry,
  getAgentBuffer,
  pushAgentEntry,
  pushAgentRenderPass,
} from "./agent-buffer.js";
import { json, refuseRequest } from "./guard.js";

export {
  clearAgentBuffer,
  getAgentBuffer,
  pushAgentEntry,
  pushAgentRenderPass,
} from "./agent-buffer.js";
export type {
  DebugbarAgentBuffer,
  DebugbarBufferedEntry,
  DebugbarBufferedRenderPass,
  DebugbarPageContext,
} from "./agent-buffer.js";

export interface DebugbarAgentHandlerOptions {
  /**
   * Hostnames besides loopback the dev server may be reached by. Each one
   * widens who can read captured SQL and bodies, so keep it empty unless
   * needed.
   */
  allowedHosts?: readonly string[];
}

/** One tab can only have produced so much between two flushes. */
const MAX_BATCH_ITEMS = 200;

function isEntry(value: unknown): value is DebugbarEntry {
  return isRecord(value) && typeof value.id === "string";
}

function isRenderPass(value: unknown): value is DebugbarRenderPass {
  return isRecord(value) && typeof value.id === "string";
}

/**
 * Route handler the browser forwards its captured entries to (see
 * `eventsEndpoint`), so the MCP route can hand them to an agent. Development
 * only, like the inspector: the entries carry SQL and bound parameters.
 */
export function createEventsHandler({
  allowedHosts = [],
}: DebugbarAgentHandlerOptions = {}) {
  async function POST(request: Request): Promise<Response> {
    if (process.env.NODE_ENV !== "development") {
      return new Response(null, { status: 404 });
    }

    const refused = refuseRequest(request, allowedHosts);
    if (refused) return refused;

    const body: unknown = await request.json().catch(() => null);
    if (!isRecord(body) || typeof body.tabId !== "string") {
      return json({ error: "expected { tabId, items }" }, 400);
    }

    const items = Array.isArray(body.items)
      ? body.items.slice(0, MAX_BATCH_ITEMS)
      : [];

    for (const item of items) {
      if (!isRecord(item) || typeof item.pageUrl !== "string") continue;

      const context = { tabId: body.tabId, pageUrl: item.pageUrl };
      if (isEntry(item.entry)) pushAgentEntry(context, item.entry);
      if (isRenderPass(item.renderPass)) {
        pushAgentRenderPass(context, item.renderPass);
      }
    }

    return new Response(null, { status: 204 });
  }

  return { POST };
}

// ---------------------------------------------------------------------------
// Tools

type ToolArgs = Record<string, unknown>;

interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: ToolArgs) => unknown;
}

function stringArg(args: ToolArgs, name: string): string | undefined {
  const value = args[name];
  return typeof value === "string" && value !== "" ? value : undefined;
}

function numberArg(args: ToolArgs, name: string): number | undefined {
  const value = args[name];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** The filters every listing tool shares, applied in one place. */
function selectEntries(args: ToolArgs): DebugbarBufferedEntry[] {
  const pageUrl = stringArg(args, "pageUrl");
  const url = stringArg(args, "url");
  const tabId = stringArg(args, "tabId");
  const sinceSeq = numberArg(args, "sinceSeq") ?? 0;

  return getAgentBuffer().entries.filter(
    (held) =>
      held.seq > sinceSeq &&
      (!tabId || held.tabId === tabId) &&
      (!pageUrl || held.pageUrl.includes(pageUrl)) &&
      (!url || held.entry.url.includes(url)),
  );
}

const FILTER_PROPERTIES = {
  sinceSeq: {
    type: "number",
    description:
      "Only records after this cursor. Pass the `cursor` of a previous call (or of `clear`) to see what the next navigation produced.",
  },
  pageUrl: {
    type: "string",
    description: "Substring of the browser page URL the request was made on.",
  },
  url: {
    type: "string",
    description: "Substring of the backend request URL.",
  },
  tabId: { type: "string", description: "Only this browser tab." },
} as const;

function summarize(held: DebugbarBufferedEntry) {
  const { entry } = held;
  const payload = entry.payload;

  return {
    seq: held.seq,
    id: entry.id,
    source: entry.source,
    method: entry.method,
    url: entry.url,
    statusCode: entry.statusCode,
    route: payload?.request.route,
    handler:
      payload?.request.controller && payload.request.handler
        ? `${payload.request.controller}.${payload.request.handler}`
        : undefined,
    durationMs: payload?.durationMs,
    queries: payload?.database.count,
    queryMs: payload?.database.totalMs,
    duplicateQueries: payload?.database.duplicates.length,
    httpCalls: payload?.http.count,
    payloadError: entry.payloadError,
    pageUrl: held.pageUrl,
    tabId: held.tabId,
    capturedAt: entry.capturedAt,
  };
}

const DEFAULT_SLOW_QUERY_MS = 100;
const DEFAULT_SLOW_REQUEST_MS = 1000;

interface Issue {
  kind: string;
  requestId: string;
  method: string;
  url: string;
  pageUrl: string;
  detail: Record<string, unknown>;
}

function findIssues(
  held: DebugbarBufferedEntry,
  slowQueryMs: number,
  slowRequestMs: number,
): Issue[] {
  const { entry } = held;
  const issues: Issue[] = [];
  const add = (kind: string, detail: Record<string, unknown>) =>
    issues.push({
      kind,
      requestId: entry.id,
      method: entry.method,
      url: entry.url,
      pageUrl: held.pageUrl,
      detail,
    });

  if (entry.statusCode !== undefined && entry.statusCode >= 400) {
    add("http-error", { statusCode: entry.statusCode });
  }
  if (entry.payloadError) add("payload-error", { error: entry.payloadError });

  const payload = entry.payload;
  if (!payload) return issues;

  if (payload.durationMs >= slowRequestMs) {
    add("slow-request", { durationMs: payload.durationMs });
  }
  for (const duplicate of payload.database.duplicates) {
    add("duplicate-query", {
      sql: duplicate.sql,
      count: duplicate.count,
      hint: "the same statement ran repeatedly in one request; likely N+1",
    });
  }
  for (const query of payload.database.queries) {
    if (query.error) {
      add("query-error", { sql: query.sql, error: query.error });
    } else if (query.durationMs >= slowQueryMs) {
      add("slow-query", {
        sql: query.sql,
        durationMs: query.durationMs,
        callSite: query.callSite,
      });
    }
  }
  for (const call of payload.http.calls) {
    if (call.error || (call.statusCode !== undefined && call.statusCode >= 500)) {
      add("upstream-error", {
        method: call.method,
        url: call.url,
        statusCode: call.statusCode,
        error: call.error,
      });
    }
  }
  for (const log of payload.logs.entries) {
    if (log.level === "error" || log.level === "fatal") {
      add("error-log", { message: log.message, context: log.context });
    }
  }

  return issues;
}

const TOOLS: Tool[] = [
  {
    name: "list_requests",
    description:
      "Backend requests the app's pages made (server and browser side), newest last, each with its query count, duration and status. Use `get_request` for the full SQL, logs and bodies of one.",
    inputSchema: {
      type: "object",
      properties: {
        ...FILTER_PROPERTIES,
        limit: { type: "number", description: "Newest N. Default 30." },
      },
    },
    run: (args) => {
      const limit = numberArg(args, "limit") ?? 30;

      return {
        cursor: getAgentBuffer().seq,
        requests: selectEntries(args).slice(-limit).map(summarize),
      };
    },
  },
  {
    name: "get_request",
    description:
      "Everything captured for one request: SQL with bound parameters, outbound HTTP, cache, logs, timers, and the request/response exchange.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The `id` from `list_requests`." },
      },
      required: ["id"],
    },
    run: (args) => {
      const id = stringArg(args, "id");
      const held = getAgentBuffer().entries.find(
        (candidate) => candidate.entry.id === id,
      );
      if (!held) throw new Error(`no request with id ${id ?? "(none)"}`);

      return held;
    },
  },
  {
    name: "find_issues",
    description:
      "Problems in the captured requests: duplicate (N+1) and slow queries, query and upstream errors, error logs, 4xx/5xx responses and slow requests.",
    inputSchema: {
      type: "object",
      properties: {
        ...FILTER_PROPERTIES,
        slowQueryMs: {
          type: "number",
          description: `Default ${DEFAULT_SLOW_QUERY_MS}.`,
        },
        slowRequestMs: {
          type: "number",
          description: `Default ${DEFAULT_SLOW_REQUEST_MS}.`,
        },
      },
    },
    run: (args) => {
      const slowQueryMs = numberArg(args, "slowQueryMs") ?? DEFAULT_SLOW_QUERY_MS;
      const slowRequestMs =
        numberArg(args, "slowRequestMs") ?? DEFAULT_SLOW_REQUEST_MS;

      return {
        cursor: getAgentBuffer().seq,
        issues: selectEntries(args).flatMap((held) =>
          findIssues(held, slowQueryMs, slowRequestMs),
        ),
      };
    },
  },
  {
    name: "get_render_passes",
    description:
      "Server render measurements of the pages the browser loaded: duration, memory, per-component timings and, when profiling is on, GC and allocation sites.",
    inputSchema: {
      type: "object",
      properties: {
        sinceSeq: FILTER_PROPERTIES.sinceSeq,
        pageUrl: FILTER_PROPERTIES.pageUrl,
        limit: { type: "number", description: "Newest N. Default 5." },
      },
    },
    run: (args) => {
      const pageUrl = stringArg(args, "pageUrl");
      const sinceSeq = numberArg(args, "sinceSeq") ?? 0;
      const limit = numberArg(args, "limit") ?? 5;

      return {
        cursor: getAgentBuffer().seq,
        renderPasses: getAgentBuffer()
          .renderPasses.filter(
            (held) =>
              held.seq > sinceSeq &&
              (!pageUrl || held.pageUrl.includes(pageUrl)),
          )
          .slice(-limit),
      };
    },
  },
  {
    name: "clear",
    description:
      "Forgets every captured record. Call it before reproducing a scenario so the next listing holds only that scenario.",
    inputSchema: { type: "object", properties: {} },
    run: () => ({ cursor: clearAgentBuffer() }),
  },
];

// ---------------------------------------------------------------------------
// MCP over Streamable HTTP, stateless and JSON-only: every POST is answered
// with one JSON body and the server never opens an SSE stream, which the
// transport allows. That keeps it a plain route handler with no session.

/** Newest first; a client asking for one of these gets it back. */
const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const SERVER_INFO = { name: "uplide-debugbar", version: "0.1.0" };

const INSTRUCTIONS =
  "Reads what the app's backend did while a browser used the app: every API request the pages made, with its SQL, outbound HTTP, logs and timings. Typical loop: `clear`, drive the browser through a scenario, then `find_issues` or `list_requests` and drill into one with `get_request`.";

type JsonRpcId = string | number;

class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

function textResult(value: unknown, isError = false) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

function dispatch(method: string, params: Record<string, unknown>): unknown {
  switch (method) {
    case "initialize": {
      const requested = params.protocolVersion;

      return {
        protocolVersion:
          typeof requested === "string" && PROTOCOL_VERSIONS.includes(requested)
            ? requested
            : PROTOCOL_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      };
    }
    case "ping":
      return {};
    case "tools/list":
      return {
        tools: TOOLS.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        })),
      };
    case "tools/call": {
      const tool = TOOLS.find((candidate) => candidate.name === params.name);
      if (!tool) throw new RpcError(-32602, `unknown tool: ${String(params.name)}`);

      try {
        return textResult(
          tool.run(isRecord(params.arguments) ? params.arguments : {}),
        );
      } catch (error) {
        // A tool failure is the agent's to read and recover from, not a
        // protocol error.
        return textResult(
          { error: error instanceof Error ? error.message : String(error) },
          true,
        );
      }
    }
    default:
      throw new RpcError(-32601, `method not found: ${method}`);
  }
}

function rpcError(id: JsonRpcId | null, code: number, message: string) {
  return json({ jsonrpc: "2.0", id, error: { code, message } });
}

/**
 * MCP endpoint over the captured entries. Register it with an agent as an HTTP
 * server, e.g. `claude mcp add --transport http debugbar
 * http://localhost:3000/api/debugbar/mcp`. Development only.
 */
export function createMcpHandler({
  allowedHosts = [],
}: DebugbarAgentHandlerOptions = {}) {
  async function POST(request: Request): Promise<Response> {
    if (process.env.NODE_ENV !== "development") {
      return new Response(null, { status: 404 });
    }

    const refused = refuseRequest(request, allowedHosts);
    if (refused) return refused;

    const message: unknown = await request.json().catch(() => undefined);
    if (!isRecord(message) || message.jsonrpc !== "2.0") {
      return rpcError(null, -32600, "expected a single JSON-RPC 2.0 message");
    }

    // Notifications and the client's responses need no answer.
    if (typeof message.method !== "string" || message.id === undefined) {
      return new Response(null, { status: 202 });
    }

    const id = message.id as JsonRpcId;

    try {
      const result = dispatch(
        message.method,
        isRecord(message.params) ? message.params : {},
      );

      return json({ jsonrpc: "2.0", id, result });
    } catch (error) {
      return error instanceof RpcError
        ? rpcError(id, error.code, error.message)
        : rpcError(id, -32603, String(error));
    }
  }

  /** No server-initiated stream: the transport's answer for that is 405. */
  function GET(): Response {
    return new Response(null, { status: 405, headers: { allow: "POST" } });
  }

  return { POST, GET, DELETE: GET };
}
