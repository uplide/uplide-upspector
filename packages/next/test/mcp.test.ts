import { UPSPECTOR_PAYLOAD_VERSION, type UpspectorEntry } from "@uplide/upspector";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAgentBuffer,
  createEventsHandler,
  createMcpHandler,
  getAgentBuffer,
} from "../src/mcp.js";

function entry(id: string, overrides: Partial<UpspectorEntry> = {}): UpspectorEntry {
  return {
    id,
    source: "csr",
    method: "GET",
    url: "https://api.example.test/products",
    statusCode: 200,
    capturedAt: "2026-11-03T00:00:00.000Z",
    payload: {
      version: UPSPECTOR_PAYLOAD_VERSION,
      requestId: id,
      startedAt: "2026-11-03T00:00:00.000Z",
      durationMs: 12,
      request: {
        method: "GET",
        url: "/products",
        controller: "ProductsController",
        handler: "list",
      },
      timers: [],
      database: {
        count: 11,
        totalMs: 4,
        truncated: false,
        duplicates: [{ sql: "SELECT * FROM tag WHERE id = $1", count: 10 }],
        queries: [
          {
            index: 0,
            kind: "query",
            sql: "SELECT * FROM product",
            startMs: 0,
            durationMs: 250,
            inTransaction: false,
          },
        ],
      },
      http: { count: 0, totalMs: 0, truncated: false, calls: [] },
      cache: { count: 0, totalMs: 0, truncated: false, operations: [] },
      logs: { count: 0, truncated: false, entries: [] },
      memory: { rssBytes: 1, heapUsedBytes: 1, heapUsedDeltaBytes: 0 },
    },
    exchange: {
      requestHeaders: {},
      query: {},
      requestBody: null,
      responseHeaders: {},
      responseBody: null,
    },
    ...overrides,
  };
}

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const events = createEventsHandler();
const mcp = createMcpHandler();

async function rpc(method: string, params: Record<string, unknown> = {}) {
  const response = await mcp.POST(
    post("/api/upspector/mcp", { jsonrpc: "2.0", id: 1, method, params }),
  );
  return (await response.json()) as {
    result?: any;
    error?: { code: number; message: string };
  };
}

async function callTool(name: string, args: Record<string, unknown> = {}) {
  const { result } = await rpc("tools/call", { name, arguments: args });
  return {
    isError: result.isError === true,
    value: JSON.parse(result.content[0].text),
  };
}

function forward(tabId: string, items: unknown[]) {
  return events.POST(
    post("/api/upspector/events", { tabId, items }, { origin: "http://localhost:3000" }),
  );
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  clearAgentBuffer();
});
afterEach(() => vi.unstubAllEnvs());

describe("createEventsHandler", () => {
  it("buffers forwarded entries once per tab, tagged with their page", async () => {
    const page = "http://localhost:3000/products";
    const response = await forward("tab-1", [
      { pageUrl: page, entry: entry("a") },
      { pageUrl: page, entry: entry("a") },
      { pageUrl: page, entry: { not: "an entry" } },
    ]);

    expect(response.status).toBe(204);
    expect(getAgentBuffer().entries).toHaveLength(1);
    expect(getAgentBuffer().entries[0]).toMatchObject({
      tabId: "tab-1",
      pageUrl: page,
      seq: 1,
    });
  });

  it("refuses another site's page", async () => {
    const response = await events.POST(
      post(
        "/api/upspector/events",
        { tabId: "t", items: [] },
        { origin: "https://evil.example" },
      ),
    );

    expect(response.status).toBe(403);
  });

  it("answers 404 outside development", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = await forward("t", []);

    expect(response.status).toBe(404);
  });
});

describe("createMcpHandler", () => {
  it("negotiates the protocol version and advertises tools", async () => {
    const init = await rpc("initialize", { protocolVersion: "2025-06-18" });
    expect(init.result.protocolVersion).toBe("2025-06-18");
    expect(init.result.capabilities).toEqual({ tools: {} });

    const fallback = await rpc("initialize", { protocolVersion: "1999-01-01" });
    expect(fallback.result.protocolVersion).toBe("2025-11-25");

    const { result } = await rpc("tools/list");
    expect(result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "list_requests",
      "get_request",
      "find_issues",
      "get_render_passes",
      "clear",
    ]);
  });

  it("acknowledges notifications without a body", async () => {
    const response = await mcp.POST(
      post("/api/upspector/mcp", {
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    );

    expect(response.status).toBe(202);
  });

  it("refuses a non-loopback host", async () => {
    const response = await mcp.POST(
      post("/api/upspector/mcp", { jsonrpc: "2.0", id: 1, method: "ping" }, {
        host: "attacker.example",
      }),
    );

    expect(response.status).toBe(403);
  });

  it("lists, filters and fetches requests by cursor", async () => {
    await forward("tab-1", [
      { pageUrl: "http://localhost:3000/", entry: entry("a") },
    ]);
    const first = await callTool("list_requests");
    expect(first.value.requests).toEqual([
      expect.objectContaining({
        id: "a",
        queries: 11,
        duplicateQueries: 1,
        handler: "ProductsController.list",
      }),
    ]);

    await forward("tab-1", [
      { pageUrl: "http://localhost:3000/products", entry: entry("b") },
    ]);
    const next = await callTool("list_requests", { sinceSeq: first.value.cursor });
    expect(next.value.requests.map((r: { id: string }) => r.id)).toEqual(["b"]);

    const byPage = await callTool("list_requests", { pageUrl: "/products" });
    expect(byPage.value.requests.map((r: { id: string }) => r.id)).toEqual(["b"]);

    const full = await callTool("get_request", { id: "b" });
    expect(full.value.entry.payload.database.count).toBe(11);

    const missing = await callTool("get_request", { id: "nope" });
    expect(missing.isError).toBe(true);
  });

  it("reports duplicate, slow and failed work", async () => {
    await forward("tab-1", [
      {
        pageUrl: "http://localhost:3000/",
        entry: entry("a", { statusCode: 500 }),
      },
    ]);

    const { value } = await callTool("find_issues");
    expect(value.issues.map((issue: { kind: string }) => issue.kind)).toEqual([
      "http-error",
      "duplicate-query",
      "slow-query",
    ]);
  });

  it("clears the buffer but keeps the cursor moving", async () => {
    await forward("tab-1", [
      { pageUrl: "http://localhost:3000/", entry: entry("a") },
    ]);

    const before = getAgentBuffer().seq;
    const { value } = await callTool("clear");
    expect(value.cursor).toBe(before);
    expect(before).toBeGreaterThan(0);
    expect((await callTool("list_requests")).value.requests).toEqual([]);
  });

  it("rejects unknown methods and tools", async () => {
    expect((await rpc("resources/list")).error?.code).toBe(-32601);
    expect((await rpc("tools/call", { name: "nope" })).error?.code).toBe(-32602);
  });
});
