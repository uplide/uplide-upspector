/**
 * The wire format lives in `@uplide/upspector-protocol` so the backend and the
 * clients that read it compile against one definition.
 */
export * from '@uplide/upspector-protocol';

/**
 * Minimal structural view of an Express-family request. Declared locally so
 * the package never depends on `@types/express`; `express.Request` and
 * `http.IncomingMessage` are both assignable to it.
 */
export interface UpspectorRequestLike {
  method?: string;
  url?: string;
  originalUrl?: string;
  headers?: Record<string, string | string[] | undefined>;
}

/**
 * Minimal structural view of an Express-family response. `json` is the single
 * injection point for the payload (both the success envelope and the error
 * envelope funnel through it); `setHeader` flags the response for clients.
 */
export interface UpspectorResponseLike {
  statusCode?: number;
  json(body: unknown): unknown;
  setHeader(name: string, value: string): unknown;
}

export interface UpspectorOptions {
  /** Master switch. When false every integration is an identity/no-op. */
  enabled: boolean;
  /** Top-level response key. Default `'upspector'`. */
  responseKey?: string;
  /** Default 100. */
  maxSpans?: number;
  /** Default 200. */
  maxQueries?: number;
  /** Default 100. */
  maxHttpCalls?: number;
  /** Default 200. */
  maxCacheOps?: number;
  /** Default 200. */
  maxLogs?: number;
  /** Default 2000. */
  maxSqlLength?: number;
  /** Default true. */
  includeQueryParams?: boolean;
  /** Default 256. */
  paramMaxLength?: number;
  /** Overrides the built-in sanitizer. Must never throw. */
  sanitizeParams?: (sql: string, params: unknown[]) => unknown[];
  /** Default true. Resolves the first application stack frame per query. */
  captureCallSite?: boolean;
  /** Default `process.cwd()`. Call sites are reported relative to it. */
  callSiteRoot?: string;
  /** Return true to leave a request completely uninstrumented. */
  skip?: (req: UpspectorRequestLike) => boolean;
}

export type ResolvedUpspectorOptions = Required<
  Omit<UpspectorOptions, 'sanitizeParams'>
> &
  Pick<UpspectorOptions, 'sanitizeParams'>;
