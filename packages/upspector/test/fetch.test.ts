import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setCaptureTracker } from "../src/capture.js";
import { setUpspectorConfig } from "../src/config.js";
import { installFetchCapture, wrapFetch } from "../src/fetch.js";
import type { UpspectorEntry } from "../src/types.js";
import { jsonResponse, payload } from "./fixtures.js";

const API = "https://api.example.test";

let entries: UpspectorEntry[];
const onEntry = (entry: UpspectorEntry) => entries.push(entry);

beforeEach(() => {
  entries = [];
  setUpspectorConfig({
    enabled: true,
    match: (url) => url.startsWith(API),
  });
  // Every test reuses the fixture's request id; forget the ones already seen.
  delete (globalThis as Record<symbol, unknown>)[
    Symbol.for("@uplide/upspector/seen-request-ids")
  ];
});

afterEach(() => setCaptureTracker(null));

describe("wrapFetch", () => {
  it("returns an unflagged response as the same object, stream unread", async () => {
    const original = jsonResponse({ data: 1, upspector: payload }, { flagged: false });
    const fetched = wrapFetch(async () => original, { onEntry });

    const response = await fetched(`${API}/items`);

    expect(response).toBe(original);
    expect(response.bodyUsed).toBe(false);
    expect(entries).toHaveLength(0);
  });

  it("captures a flagged JSON response and strips the key", async () => {
    const original = jsonResponse({ data: 1, upspector: payload }, { status: 201 });
    const fetched = wrapFetch(async () => original, { onEntry });

    const response = await fetched(`${API}/items?page=2`, {
      method: "POST",
      headers: { authorization: "Bearer secret", "x-trace": "t" },
      body: JSON.stringify({ name: "x" }),
    });

    expect(await response.json()).toEqual({ data: 1 });
    expect(response.status).toBe(201);
    expect(response.headers.get("content-type")).toBe("application/json");
    // Consumed: a wrapper further out passes the response through unread.
    expect(response.headers.has("x-upspector")).toBe(false);

    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry?.method).toBe("POST");
    expect(entry?.statusCode).toBe(201);
    expect(entry?.payload?.requestId).toBe("req-1");
    expect(entry?.exchange.query).toEqual({ page: "2" });
    expect(entry?.exchange.requestHeaders.authorization).toBe("«redacted»");
    expect(entry?.exchange.requestHeaders["x-trace"]).toBe("t");
    expect(entry?.exchange.responseBody?.text).toBe('{"data":1}');
  });

  it("keeps a snapshot-failure payload as an error entry", async () => {
    const fetched = wrapFetch(
      async () => jsonResponse({ data: 1, upspector: { version: 1, error: "boom" } }),
      { onEntry },
    );

    const response = await fetched(`${API}/items`);

    expect(await response.json()).toEqual({ data: 1 });
    expect(entries[0]?.payload).toBeNull();
    expect(entries[0]?.payloadError).toBe("boom");
  });

  it("passes through out-of-scope, unmatched and opted-out requests", async () => {
    const original = jsonResponse({ upspector: payload });
    const inner = vi.fn(async () => original);

    const outOfScope = wrapFetch(inner, { onEntry, inScope: () => false });
    expect(await outOfScope(`${API}/a`)).toBe(original);

    const fetched = wrapFetch(inner, { onEntry });
    expect(await fetched("https://cdn.example.test/logo.png")).toBe(original);
    expect(await fetched(`${API}/a`, { upspector: false })).toBe(original);

    expect(entries).toHaveLength(0);
    expect(inner).toHaveBeenCalledTimes(3);
  });

  it("does nothing when the config is disabled", async () => {
    setUpspectorConfig({ enabled: false, match: () => true });
    const original = jsonResponse({ upspector: payload });

    const response = await wrapFetch(async () => original, { onEntry })(`${API}/a`);

    expect(response).toBe(original);
    expect(entries).toHaveLength(0);
  });

  it("ends the capture even when the request fails", async () => {
    const begin = vi.fn();
    const end = vi.fn();
    setCaptureTracker(() => {
      begin();
      return end;
    });

    const fetched = wrapFetch(
      async () => {
        throw new TypeError("network down");
      },
      { onEntry },
    );

    await expect(fetched(`${API}/a`)).rejects.toThrow("network down");
    expect(begin).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);
  });

  it("passes the caller's init through unchanged", async () => {
    const inner = vi.fn(async () => jsonResponse({ data: 1 }, { flagged: false }));
    const init = { method: "GET", cache: "no-store" as const };

    await wrapFetch(inner, { onEntry })(`${API}/a`, init);

    expect(inner).toHaveBeenCalledWith(`${API}/a`, init);
  });
});

describe("installFetchCapture", () => {
  it("wraps once and restores the previous fetch", async () => {
    const original = vi.fn(async () => jsonResponse({ upspector: payload }));
    const target = { fetch: original as unknown as typeof fetch };

    const uninstall = installFetchCapture({ onEntry }, target);
    const wrapped = target.fetch;
    installFetchCapture({ onEntry }, target);

    expect(target.fetch).toBe(wrapped);
    await target.fetch(`${API}/a`);
    expect(entries).toHaveLength(1);

    uninstall();
    expect(target.fetch).toBe(original);
  });

  it("wraps again after the host swapped fetch out, without double capture", async () => {
    const original = vi.fn(async () => jsonResponse({ upspector: payload }));
    const target = { fetch: original as unknown as typeof fetch };

    installFetchCapture({ onEntry }, target);
    // A host patch on top (Next's own), then our re-wrap outside of it.
    const inner = target.fetch;
    target.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
      inner(input, init)) as typeof fetch;
    installFetchCapture({ onEntry }, target);

    const response = await target.fetch(`${API}/a`);

    expect(await response.json()).toEqual({});
    expect(entries).toHaveLength(1);
  });
});

describe("replays", () => {
  it("captures a request id once; a cached replay is stripped but not logged", async () => {
    const fetched = wrapFetch(async () => jsonResponse({ data: 1, upspector: payload }), {
      onEntry,
    });

    await fetched(`${API}/a`);
    const replay = await fetched(`${API}/a`);

    expect(await replay.json()).toEqual({ data: 1 });
    expect(entries).toHaveLength(1);
  });
});
