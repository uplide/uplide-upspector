import {
  DEBUGBAR_HEADER,
  DEBUGBAR_PAYLOAD_VERSION,
  type DebugbarPayload,
} from "@uplide/debugbar-protocol";

export const payload: DebugbarPayload = {
  version: DEBUGBAR_PAYLOAD_VERSION,
  requestId: "req-1",
  startedAt: "2026-11-02T00:00:00.000Z",
  durationMs: 12,
  request: { method: "GET", url: "/probe" },
  timers: [],
  database: { count: 2, totalMs: 1, truncated: false, duplicates: [], queries: [] },
  http: { count: 0, totalMs: 0, truncated: false, calls: [] },
  cache: { count: 0, totalMs: 0, truncated: false, operations: [] },
  logs: { count: 0, truncated: false, entries: [] },
  memory: { rssBytes: 1, heapUsedBytes: 1, heapUsedDeltaBytes: 0 },
};

export function jsonResponse(
  body: unknown,
  { flagged = true, status = 200 }: { flagged?: boolean; status?: number } = {},
): Response {
  const headers = new Headers({ "content-type": "application/json" });
  if (flagged) headers.set(DEBUGBAR_HEADER, String(DEBUGBAR_PAYLOAD_VERSION));

  return new Response(JSON.stringify(body), { status, headers });
}
