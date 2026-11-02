import {
  DEBUGBAR_HEADER,
  DEBUGBAR_PAYLOAD_VERSION,
  setCaptureTracker,
} from "@uplide/debugbar";
import { wrapFetch } from "@uplide/debugbar/fetch";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Outside a real RSC request React's `cache()` never memoizes. A single shared
// store per test stands in for "one render pass".
let renderPass: Record<string, unknown> | undefined;
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  cache: (fn: () => unknown) => () => {
    renderPass ??= { value: fn() };
    return renderPass.value;
  },
}));

const { registerDebugbar, openDebugbarScope, waitForDebugbarSsrEntries } =
  await import("../src/server.js");
const { isSsrCaptureActive, pushSsrEntry } = await import("../src/ssr-store.js");
const { withDebugbar } = await import("../src/with-debugbar.js");
const { defineNextDebugbarConfig } = await import("../src/index.js");
const { createInspectHandler } = await import("../src/inspect.js");

const API = "https://api.example.test";

const payload = {
  version: DEBUGBAR_PAYLOAD_VERSION,
  requestId: "req-1",
  startedAt: "2026-11-02T00:00:00.000Z",
  durationMs: 1,
  request: { method: "GET", url: "/probe" },
  timers: [],
  database: { count: 0, totalMs: 0, truncated: false, duplicates: [], queries: [] },
  http: { count: 0, totalMs: 0, truncated: false, calls: [] },
  cache: { count: 0, totalMs: 0, truncated: false, operations: [] },
  logs: { count: 0, truncated: false, entries: [] },
  memory: { rssBytes: 1, heapUsedBytes: 1, heapUsedDeltaBytes: 0 },
};

function flagged(): Response {
  return new Response(JSON.stringify({ data: 1, debugbar: payload }), {
    headers: {
      "content-type": "application/json",
      [DEBUGBAR_HEADER]: String(DEBUGBAR_PAYLOAD_VERSION),
    },
  });
}

const config = defineNextDebugbarConfig({
  enabled: true,
  backend: { origins: [API] },
});

beforeEach(() => {
  renderPass = undefined;
  registerDebugbar(config);
});

afterEach(() => setCaptureTracker(null));

describe("SSR scope", () => {
  it("is inactive until the root layout opens it", () => {
    expect(isSsrCaptureActive()).toBe(false);

    openDebugbarScope();

    expect(isSsrCaptureActive()).toBe(true);
  });

  it("collects fetch captures and waits for the ones in flight", async () => {
    openDebugbarScope();
    let release: (response: Response) => void = () => {};
    const inner = () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      });
    const fetched = wrapFetch(inner, {
      source: "ssr",
      inScope: isSsrCaptureActive,
      onEntry: pushSsrEntry,
    });

    const request = fetched(`${API}/items`);
    const waiting = waitForDebugbarSsrEntries();
    let done = false;
    void waiting.then(() => {
      done = true;
    });

    await Promise.resolve();
    expect(done).toBe(false);

    release(flagged());
    expect(await (await request).json()).toEqual({ data: 1 });

    const entries = await waiting;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.source).toBe("ssr");
  });

  it("leaves requests outside an opened scope untouched", async () => {
    const original = flagged();
    const fetched = wrapFetch(async () => original, {
      source: "ssr",
      inScope: isSsrCaptureActive,
      onEntry: pushSsrEntry,
    });

    expect(await fetched(`${API}/items`)).toBe(original);
  });
});

describe("defineNextDebugbarConfig", () => {
  it("matches backend origins only", () => {
    expect(config.match(`${API}/v1/items?x=1`)).toBe(true);
    expect(config.match("https://cdn.example.test/a.png")).toBe(false);
  });
});

describe("withDebugbar", () => {
  const base = { reactStrictMode: true, experimental: { ppr: true } };

  function projectWith(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), "debugbar-next-"));
    for (const [name, source] of Object.entries(files)) {
      writeFileSync(join(root, name), source);
    }
    vi.spyOn(process, "cwd").mockReturnValue(root);
    return root;
  }

  afterEach(() => vi.restoreAllMocks());

  it("turns the HMR fetch cache off only when the config enables it", async () => {
    projectWith({
      "debugbar.config.ts": "export default { enabled: true as boolean };",
    });
    expect(await withDebugbar(base)()).toEqual({
      reactStrictMode: true,
      experimental: { ppr: true, serverComponentsHmrCache: false },
    });

    projectWith({ "debugbar.config.ts": "export default { enabled: false };" });
    expect(await withDebugbar(base)()).toBe(base);
  });

  it("reads a custom config path", async () => {
    projectWith({ "debug.mjs": "export default { enabled: true };" });

    const config = await withDebugbar(base, { configFile: "debug.mjs" })();
    expect(config.experimental).toHaveProperty("serverComponentsHmrCache", false);
  });

  it("fails clearly when no config file exists", async () => {
    projectWith({});

    await expect(withDebugbar(base)()).rejects.toThrow(/No config file found/);
  });
});

describe("createInspectHandler", () => {
  it("answers 404 outside development", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { POST } = createInspectHandler();

    const response = await POST(
      new Request("http://localhost/api/debugbar/inspect", {
        method: "POST",
        body: JSON.stringify({ paths: ["app/page.tsx:1:1:div"] }),
      }),
    );

    expect(response.status).toBe(404);
    vi.unstubAllEnvs();
  });

  describe("in development", () => {
    beforeEach(() => vi.stubEnv("NODE_ENV", "development"));
    afterEach(() => vi.unstubAllEnvs());

    function inspect(
      paths: string[],
      headers: Record<string, string> = {},
      options: Parameters<typeof createInspectHandler>[0] = {},
    ) {
      return createInspectHandler(options).POST(
        new Request("http://localhost:4200/api/debugbar/inspect", {
          method: "POST",
          headers: {
            host: "localhost:4200",
            origin: "http://localhost:4200",
            "sec-fetch-site": "same-origin",
            "content-type": "application/json",
            ...headers,
          },
          body: JSON.stringify({ paths }),
        }),
      );
    }

    it("refuses a page from another origin", async () => {
      const foreignOrigin = await inspect(["a.ts:1:1:div"], {
        origin: "https://evil.example",
      });
      const crossSite = await inspect(["a.ts:1:1:div"], {
        "sec-fetch-site": "cross-site",
      });

      expect(foreignOrigin.status).toBe(403);
      expect(crossSite.status).toBe(403);
    });

    it("refuses a cross-site simple request (text/plain)", async () => {
      const response = await inspect(["a.ts:1:1:div"], {
        "content-type": "text/plain",
      });

      expect(response.status).toBe(415);
    });

    it("refuses a non-loopback Host unless allowed (LAN, DNS rebinding)", async () => {
      const rebound = await inspect(["a.ts:1:1:div"], {
        host: "evil.example:4200",
        origin: "http://evil.example:4200",
      });
      const allowed = await inspect(
        ["a.ts:1:1:div"],
        { host: "192.168.1.20:4200", origin: "http://192.168.1.20:4200" },
        { allowedHosts: ["192.168.1.20"] },
      );

      expect(rebound.status).toBe(403);
      expect(allowed.status).toBe(200);
    });

    it("serves repository source but not ignored files or dependencies", async () => {
      const response = await inspect([
        "packages/next/src/inspect.ts:1:1:div",
        "packages/next/dist/inspect.js:1:1:div",
        "node_modules/react/index.js:1:1:div",
      ]);
      const { frames } = (await response.json()) as {
        frames: { snippet: string[]; error?: string }[];
      };

      expect(response.status).toBe(200);
      expect(frames[0]?.error).toBeUndefined();
      expect(frames[0]?.snippet.length).toBeGreaterThan(0);
      expect(frames[1]?.error).toMatch(/^path refused/);
      expect(frames[2]?.error).toMatch(/^path refused/);
    });
  });
});
