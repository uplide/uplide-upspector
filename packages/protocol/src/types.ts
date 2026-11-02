/**
 * Wire format for the `debugbar` response key. Other projects consume these
 * literals, so treat every field name here as a public contract: additive
 * changes only, and bump `DEBUGBAR_PAYLOAD_VERSION` when the shape changes.
 */
export const DEBUGBAR_PAYLOAD_VERSION = 1;

/** Top-level response key the payload rides under unless a host renames it. */
export const DEFAULT_RESPONSE_KEY = 'debugbar';

/**
 * Response header set on every response that carries a payload; its value is
 * the payload version. Lets a `fetch` client decide from headers alone whether
 * a body is worth buffering, so every other response keeps streaming.
 */
export const DEBUGBAR_HEADER = 'x-debugbar';

export type DebugbarLogLevel =
  | 'log'
  | 'error'
  | 'warn'
  | 'debug'
  | 'verbose'
  | 'fatal';

export type DebugbarQueryKind = 'query' | 'execute' | 'begin' | 'script';

export interface DebugbarSpan {
  name: string;
  startMs: number;
  durationMs: number;
}

export interface DebugbarQueryEntry {
  index: number;
  kind: DebugbarQueryKind;
  sql: string;
  params?: unknown[];
  startMs: number;
  durationMs: number;
  inTransaction: boolean;
  callSite?: string;
  error?: string;
}

export interface DebugbarHttpEntry {
  method: string;
  url: string;
  statusCode?: number;
  startMs: number;
  durationMs: number;
  error?: string;
}

export interface DebugbarCacheEntry {
  command: string;
  key?: string;
  argCount: number;
  startMs: number;
  durationMs: number;
  error?: string;
}

export interface DebugbarLogEntry {
  level: DebugbarLogLevel;
  message: string;
  context?: string;
  atMs: number;
}

export interface DebugbarPayload {
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
  timers: DebugbarSpan[];
  database: {
    count: number;
    totalMs: number;
    truncated: boolean;
    duplicates: Array<{ sql: string; count: number }>;
    queries: DebugbarQueryEntry[];
  };
  http: {
    count: number;
    totalMs: number;
    truncated: boolean;
    calls: DebugbarHttpEntry[];
  };
  cache: {
    count: number;
    totalMs: number;
    truncated: boolean;
    operations: DebugbarCacheEntry[];
  };
  logs: {
    count: number;
    truncated: boolean;
    entries: DebugbarLogEntry[];
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
export interface DebugbarErrorPayload {
  version: number;
  error: string;
}
