import {
  DEFAULT_RESPONSE_KEY,
  type UpspectorOptions,
  type ResolvedUpspectorOptions,
} from './types';

/**
 * DI token for the resolved options. Deliberately a string and not a Symbol:
 * consumers read it back with `app.get(UPSPECTOR_OPTIONS)` in `main.ts` to build
 * the middleware from the exact same option object the module was configured
 * with, and a string token survives multiple module copies on disk.
 */
export const UPSPECTOR_OPTIONS = 'UPSPECTOR_OPTIONS';

export const DEFAULT_UPSPECTOR_OPTIONS = {
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

export function resolveUpspectorOptions(
  options: UpspectorOptions,
): ResolvedUpspectorOptions {
  return {
    enabled: options.enabled,
    responseKey: options.responseKey ?? DEFAULT_UPSPECTOR_OPTIONS.responseKey,
    maxSpans: options.maxSpans ?? DEFAULT_UPSPECTOR_OPTIONS.maxSpans,
    maxQueries: options.maxQueries ?? DEFAULT_UPSPECTOR_OPTIONS.maxQueries,
    maxHttpCalls: options.maxHttpCalls ?? DEFAULT_UPSPECTOR_OPTIONS.maxHttpCalls,
    maxCacheOps: options.maxCacheOps ?? DEFAULT_UPSPECTOR_OPTIONS.maxCacheOps,
    maxLogs: options.maxLogs ?? DEFAULT_UPSPECTOR_OPTIONS.maxLogs,
    maxSqlLength: options.maxSqlLength ?? DEFAULT_UPSPECTOR_OPTIONS.maxSqlLength,
    includeQueryParams:
      options.includeQueryParams ?? DEFAULT_UPSPECTOR_OPTIONS.includeQueryParams,
    paramMaxLength:
      options.paramMaxLength ?? DEFAULT_UPSPECTOR_OPTIONS.paramMaxLength,
    sanitizeParams: options.sanitizeParams,
    captureCallSite:
      options.captureCallSite ?? DEFAULT_UPSPECTOR_OPTIONS.captureCallSite,
    callSiteRoot: options.callSiteRoot ?? process.cwd(),
    skip: options.skip ?? neverSkip,
  };
}
