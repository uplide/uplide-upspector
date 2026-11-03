/**
 * Wire format for the `upspector` response key. Other projects consume these
 * literals, so treat every field name here as a public contract: additive
 * changes only, and bump `UPSPECTOR_PAYLOAD_VERSION` when the shape changes.
 */
export const UPSPECTOR_PAYLOAD_VERSION = 1;

/** Top-level response key the payload rides under unless a host renames it. */
export const DEFAULT_RESPONSE_KEY = 'upspector';

/**
 * Response header set on every response that carries a payload; its value is
 * the payload version. Lets a `fetch` client decide from headers alone whether
 * a body is worth buffering, so every other response keeps streaming.
 */
export const UPSPECTOR_HEADER = 'x-upspector';

export type UpspectorLogLevel =
  | 'log'
  | 'error'
  | 'warn'
  | 'debug'
  | 'verbose'
  | 'fatal';

export type UpspectorQueryKind = 'query' | 'execute' | 'begin' | 'script';

export interface UpspectorSpan {
  name: string;
  startMs: number;
  durationMs: number;
}

export interface UpspectorQueryEntry {
  index: number;
  kind: UpspectorQueryKind;
  sql: string;
  params?: unknown[];
  startMs: number;
  durationMs: number;
  inTransaction: boolean;
  callSite?: string;
  error?: string;
}

export interface UpspectorHttpEntry {
  method: string;
  url: string;
  statusCode?: number;
  startMs: number;
  durationMs: number;
  error?: string;
}

export interface UpspectorCacheEntry {
  command: string;
  key?: string;
  argCount: number;
  startMs: number;
  durationMs: number;
  error?: string;
}

export interface UpspectorLogEntry {
  level: UpspectorLogLevel;
  message: string;
  context?: string;
  atMs: number;
}

export interface UpspectorPayload {
  version: number;
  requestId: string;
  /** ISO timestamp of the moment the collector was created. */
  startedAt: string;
  durationMs: number;
  request: {
    method: string;
    url: string;
    route?: string;
    controller?: string;
    handler?: string;
    statusCode?: number;
  };
  timers: UpspectorSpan[];
  database: {
    count: number;
    totalMs: number;
    truncated: boolean;
    duplicates: Array<{ sql: string; count: number }>;
    queries: UpspectorQueryEntry[];
  };
  http: {
    count: number;
    totalMs: number;
    truncated: boolean;
    calls: UpspectorHttpEntry[];
  };
  cache: {
    count: number;
    totalMs: number;
    truncated: boolean;
    operations: UpspectorCacheEntry[];
  };
  logs: {
    count: number;
    truncated: boolean;
    entries: UpspectorLogEntry[];
  };
  memory: {
    rssBytes: number;
    heapUsedBytes: number;
    heapUsedDeltaBytes: number;
  };
}

/**
 * Written in place of a payload when the backend's snapshot itself failed, so
 * the client can show why instead of silently showing nothing.
 */
export interface UpspectorErrorPayload {
  version: number;
  error: string;
}
