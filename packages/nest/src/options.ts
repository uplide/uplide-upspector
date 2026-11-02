import {
  DEFAULT_RESPONSE_KEY,
  type DebugbarOptions,
  type ResolvedDebugbarOptions,
} from './types';

/**
 * DI token for the resolved options. Deliberately a string and not a Symbol:
 * consumers read it back with `app.get(DEBUGBAR_OPTIONS)` in `main.ts` to build
 * the middleware from the exact same option object the module was configured
 * with, and a string token survives multiple module copies on disk.
 */
export const DEBUGBAR_OPTIONS = 'DEBUGBAR_OPTIONS';

export const DEFAULT_DEBUGBAR_OPTIONS = {
  responseKey: DEFAULT_RESPONSE_KEY,
  maxSpans: 100,
  maxQueries: 200,
  maxHttpCalls: 100,
  maxCacheOps: 200,
  maxLogs: 200,
  maxSqlLength: 2000,
  includeQueryParams: true,
  paramMaxLength: 256,
  captureCallSite: true,
} as const;

const neverSkip = (): boolean => false;

export function resolveDebugbarOptions(
  options: DebugbarOptions,
): ResolvedDebugbarOptions {
  return {
    enabled: options.enabled,
    responseKey: options.responseKey ?? DEFAULT_DEBUGBAR_OPTIONS.responseKey,
    maxSpans: options.maxSpans ?? DEFAULT_DEBUGBAR_OPTIONS.maxSpans,
    maxQueries: options.maxQueries ?? DEFAULT_DEBUGBAR_OPTIONS.maxQueries,
    maxHttpCalls: options.maxHttpCalls ?? DEFAULT_DEBUGBAR_OPTIONS.maxHttpCalls,
    maxCacheOps: options.maxCacheOps ?? DEFAULT_DEBUGBAR_OPTIONS.maxCacheOps,
    maxLogs: options.maxLogs ?? DEFAULT_DEBUGBAR_OPTIONS.maxLogs,
    maxSqlLength: options.maxSqlLength ?? DEFAULT_DEBUGBAR_OPTIONS.maxSqlLength,
    includeQueryParams:
      options.includeQueryParams ?? DEFAULT_DEBUGBAR_OPTIONS.includeQueryParams,
    paramMaxLength:
      options.paramMaxLength ?? DEFAULT_DEBUGBAR_OPTIONS.paramMaxLength,
    sanitizeParams: options.sanitizeParams,
    captureCallSite:
      options.captureCallSite ?? DEFAULT_DEBUGBAR_OPTIONS.captureCallSite,
    callSiteRoot: options.callSiteRoot ?? process.cwd(),
    skip: options.skip ?? neverSkip,
  };
}
