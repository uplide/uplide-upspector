import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAgentBuffer, getAgentBuffer } from "../src/mcp.js";
import { createUpspectorHandler } from "../src/route.js";

const handler = createUpspectorHandler();

function context(endpoint: string) {
  return { params: Promise.resolve({ endpoint }) };
}

function post(endpoint: string, body: unknown) {
  return handler.POST(
    new Request(`http://localhost:3000/api/upspector/${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    context(endpoint),
  );
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  clearAgentBuffer();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createUpspectorHandler", () => {
  it("routes mcp to the MCP server", async () => {
    const response = await post("mcp", { jsonrpc: "2.0", id: 1, method: "ping" });

    expect(await response.json()).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
  });

  it("routes events to the agent buffer", async () => {
    const response = await post("events", {
      tabId: "tab-1",
      items: [{ pageUrl: "http://localhost:3000/", entry: { id: "a", url: "/x" } }],
    });

    expect(response.status).toBe(204);
    expect(getAgentBuffer().entries.map((held) => held.entry.id)).toEqual(["a"]);
  });

  it("routes inspect to the inspector", async () => {
    const response = await post("inspect", { paths: [] });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "no paths given" });
  });

  it("answers 404 for an unknown endpoint, including inherited names", async () => {
    for (const endpoint of ["nope", "constructor", "__proto__"]) {
      expect((await post(endpoint, {})).status).toBe(404);
    }
  });

  it("answers 405 with the allowed methods for a method the endpoint lacks", async () => {
    const response = await handler.GET(
      new Request("http://localhost:3000/api/upspector/inspect"),
      context("inspect"),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

  it("answers 404 outside development", async () => {
    vi.stubEnv("NODE_ENV", "production");

    expect((await post("mcp", { jsonrpc: "2.0", id: 1, method: "ping" })).status).toBe(404);
  });
});
