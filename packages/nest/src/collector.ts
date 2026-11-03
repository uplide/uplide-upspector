import { sanitizeParams, truncateText } from './sanitize';
import type {
  UpspectorCacheEntry,
  UpspectorHttpEntry,
  UpspectorLogEntry,
  UpspectorLogLevel,
  UpspectorPayload,
  UpspectorQueryEntry,
  UpspectorQueryKind,
  UpspectorSpan,
  ResolvedUpspectorOptions,
} from './types';
import { UPSPECTOR_PAYLOAD_VERSION } from './types';

/** Milliseconds, rounded to 0.01 — sub-10µs noise is not information. */
function ms(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface UpspectorCollectorInit {
  requestId: string;
  method: string;
  url: string;
  startedAtEpochMs: number;
  startHr: number;
}

/**
 * Per-request accumulator. Plain class on purpose: no DI, no decorators, so
 * integrations (Prisma adapter, ioredis, axios, logger) can reach it through
 * AsyncLocalStorage without importing Nest.
 *
 * Every bucket is bounded: past its limit an entry still counts towards
 * `count`/`totalMs` but is not retained, and the bucket's `truncated` flag
 * flips. Payload size is therefore independent of request shape.
 */
export class UpspectorCollector {
  readonly requestId: string;
  readonly startHr: number;

  /** Set by `UpspectorInterceptor` so the `serialize` span can start there. */
  handlerEndHr?: number;

  private readonly method: string;
  private readonly url: string;
  private readonly startedAt: string;
  private readonly heapUsedAtStart: number;

  private readonly spans: UpspectorSpan[] = [];

  private readonly queries: UpspectorQueryEntry[] = [];
  private queryCount = 0;
  private queryTotalMs = 0;
  private queriesTruncated = false;

  private readonly httpCalls: UpspectorHttpEntry[] = [];
  private httpCount = 0;
  private httpTotalMs = 0;
  private httpTruncated = false;

  private readonly cacheOps: UpspectorCacheEntry[] = [];
  private cacheCount = 0;
  private cacheTotalMs = 0;
  private cacheTruncated = false;

  private readonly logs: UpspectorLogEntry[] = [];
  private logCount = 0;
  private logsTruncated = false;

  private route?: string;
  private controller?: string;
  private handler?: string;
  private statusCode?: number;

  constructor(
    private readonly options: ResolvedUpspectorOptions,
    init: UpspectorCollectorInit,
  ) {
    this.requestId = init.requestId;
    this.startHr = init.startHr;
    this.method = init.method;
    this.url = init.url;
    this.startedAt = new Date(init.startedAtEpochMs).toISOString();
    this.heapUsedAtStart = process.memoryUsage().heapUsed;
  }

  /** Milliseconds since the request started. */
  nowMs(): number {
    return ms(performance.now() - this.startHr);
  }

  /**
   * Opens a named span; the returned function closes it. Exposed for opt-in
   * instrumentation of work the built-in integrations do not see (queue
   * producers, background fan-out inside a request).
   */
  startSpan(name: string): () => void {
    const startHr = performance.now();
    let closed = false;

    return () => {
      if (closed) {
        return;
      }
      closed = true;
      this.addSpan(name, startHr);
    };
  }

  addSpan(name: string, startHr: number, endHr?: number): void {
    if (this.spans.length >= this.options.maxSpans) {
      return;
    }

    const end = endHr ?? performance.now();
    this.spans.push({
      name,
      startMs: ms(startHr - this.startHr),
      durationMs: ms(end - startHr),
    });
  }

  recordQuery(entry: {
    kind: UpspectorQueryKind;
    sql: string;
    params?: unknown[];
    startHr: number;
    durationMs: number;
    inTransaction: boolean;
    callSite?: string;
    error?: string;
  }): void {
    const index = this.queryCount;
    this.queryCount += 1;
    this.queryTotalMs = ms(this.queryTotalMs + entry.durationMs);

    if (this.queries.length >= this.options.maxQueries) {
      this.queriesTruncated = true;
      return;
    }

    const stored: UpspectorQueryEntry = {
      index,
      kind: entry.kind,
      sql: truncateText(entry.sql, this.options.maxSqlLength),
      startMs: ms(entry.startHr - this.startHr),
      durationMs: ms(entry.durationMs),
      inTransaction: entry.inTransaction,
    };

    if (this.options.includeQueryParams && entry.params) {
      stored.params = this.options.sanitizeParams
        ? this.options.sanitizeParams(entry.sql, entry.params)
        : sanitizeParams(entry.params, this.options.paramMaxLength);
    }
    if (entry.callSite) {
      stored.callSite = entry.callSite;
    }
    if (entry.error) {
      stored.error = truncateText(entry.error, this.options.paramMaxLength);
    }

    this.queries.push(stored);
  }

  recordHttp(entry: {
    method: string;
    url: string;
    statusCode?: number;
    startHr: number;
    durationMs: number;
    error?: string;
  }): void {
    this.httpCount += 1;
    this.httpTotalMs = ms(this.httpTotalMs + entry.durationMs);

    if (this.httpCalls.length >= this.options.maxHttpCalls) {
      this.httpTruncated = true;
      return;
    }

    const stored: UpspectorHttpEntry = {
      method: entry.method,
      url: truncateText(entry.url, this.options.maxSqlLength),
      startMs: ms(entry.startHr - this.startHr),
      durationMs: ms(entry.durationMs),
    };

    if (entry.statusCode !== undefined) {
      stored.statusCode = entry.statusCode;
    }
    if (entry.error) {
      stored.error = truncateText(entry.error, this.options.paramMaxLength);
    }

    this.httpCalls.push(stored);
  }

  recordCache(entry: {
    command: string;
    key?: string;
    argCount: number;
    startHr: number;
    durationMs: number;
    error?: string;
  }): void {
    this.cacheCount += 1;
    this.cacheTotalMs = ms(this.cacheTotalMs + entry.durationMs);

    if (this.cacheOps.length >= this.options.maxCacheOps) {
      this.cacheTruncated = true;
      return;
    }

    const stored: UpspectorCacheEntry = {
      command: entry.command,
      argCount: entry.argCount,
      startMs: ms(entry.startHr - this.startHr),
      durationMs: ms(entry.durationMs),
    };

    if (entry.key !== undefined) {
      stored.key = truncateText(entry.key, this.options.paramMaxLength);
    }
    if (entry.error) {
      stored.error = truncateText(entry.error, this.options.paramMaxLength);
    }

    this.cacheOps.push(stored);
  }

  recordLog(entry: {
    level: UpspectorLogLevel;
    message: string;
    context?: string;
  }): void {
    this.logCount += 1;

    if (this.logs.length >= this.options.maxLogs) {
      this.logsTruncated = true;
      return;
    }

    const stored: UpspectorLogEntry = {
      level: entry.level,
      message: truncateText(entry.message, this.options.maxSqlLength),
      atMs: this.nowMs(),
    };

    if (entry.context) {
      stored.context = entry.context;
    }

    this.logs.push(stored);
  }

  setRoute(info: {
    controller?: string;
    handler?: string;
    route?: string;
  }): void {
    if (info.controller) {
      this.controller = info.controller;
    }
    if (info.handler) {
      this.handler = info.handler;
    }
    if (info.route) {
      this.route = info.route;
    }
  }

  setStatusCode(statusCode: number): void {
    this.statusCode = statusCode;
  }

  /**
   * Build the wire payload. Pure and repeatable: nothing here mutates the
   * buckets, so a second call cannot double-count.
   */
  snapshot(): UpspectorPayload {
    const memory = process.memoryUsage();

    return {
      version: UPSPECTOR_PAYLOAD_VERSION,
      requestId: this.requestId,
      startedAt: this.startedAt,
      durationMs: this.nowMs(),
      request: {
        method: this.method,
        url: this.url,
        ...(this.route ? { route: this.route } : {}),
        ...(this.controller ? { controller: this.controller } : {}),
        ...(this.handler ? { handler: this.handler } : {}),
        ...(this.statusCode !== undefined
          ? { statusCode: this.statusCode }
          : {}),
      },
      timers: this.spans.slice(),
      database: {
        count: this.queryCount,
        totalMs: this.queryTotalMs,
        truncated: this.queriesTruncated,
        duplicates: this.collectDuplicates(),
        queries: this.queries.slice(),
      },
      http: {
        count: this.httpCount,
        totalMs: this.httpTotalMs,
        truncated: this.httpTruncated,
        calls: this.httpCalls.slice(),
      },
      cache: {
        count: this.cacheCount,
        totalMs: this.cacheTotalMs,
        truncated: this.cacheTruncated,
        operations: this.cacheOps.slice(),
      },
      logs: {
        count: this.logCount,
        truncated: this.logsTruncated,
        entries: this.logs.slice(),
      },
      memory: {
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        heapUsedDeltaBytes: memory.heapUsed - this.heapUsedAtStart,
      },
    };
  }

  /** N+1 detector: retained queries whose SQL text repeats, worst first. */
  private collectDuplicates(): Array<{ sql: string; count: number }> {
    const counts = new Map<string, number>();
    for (const query of this.queries) {
      counts.set(query.sql, (counts.get(query.sql) ?? 0) + 1);
    }

    const duplicates: Array<{ sql: string; count: number }> = [];
    for (const [sql, count] of counts) {
      if (count > 1) {
        duplicates.push({ sql, count });
      }
    }

    return duplicates.sort((a, b) => b.count - a.count).slice(0, 10);
  }
}
