import * as path from 'node:path';

/** Longest value depth walked by `sanitizeParamValue` before collapsing. */
const MAX_PARAM_DEPTH = 3;

/**
 * Cut `value` to `max` characters, appending the real length so a reader can
 * tell a truncated blob from a short one.
 */
export function truncateText(value: string, max: number): string {
  if (max <= 0 || value.length <= max) {
    return value;
  }

  return `${value.slice(0, max)}…(${value.length})`;
}

/**
 * Make a bound query parameter JSON-safe.
 *
 * Load-bearing, not cosmetic: the payload is attached *after* the app's own
 * serializer interceptors have already walked the envelope, and Express
 * `res.json` uses `JSON.stringify`, which throws `TypeError` on BigInt. Every
 * non-JSON primitive Prisma can bind (bigint, Date, Buffer) is mapped here.
 */
export function sanitizeParamValue(
  value: unknown,
  maxLength: number,
  depth = 0,
): unknown {
  if (value === undefined) {
    return null;
  }
  if (value === null) {
    return null;
  }

  switch (typeof value) {
    case 'bigint':
      return String(value);
    case 'string':
      return truncateText(value, maxLength);
    case 'number':
    case 'boolean':
      return value;
    case 'function':
      return '[Function]';
    case 'symbol':
      return String(value);
    default:
      break;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
  }
  if (value instanceof Uint8Array) {
    return `<Bytes ${value.byteLength}>`;
  }
  if (value instanceof Error) {
    return truncateText(`${value.name}: ${value.message}`, maxLength);
  }

  if (depth >= MAX_PARAM_DEPTH) {
    return Array.isArray(value) ? '[Array]' : '[Object]';
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeParamValue(item, maxLength, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    result[key] = sanitizeParamValue(item, maxLength, depth + 1);
  }

  return result;
}

export function sanitizeParams(
  params: unknown[],
  maxLength: number,
): unknown[] {
  return params.map((param) => sanitizeParamValue(param, maxLength));
}

/** `at fn (/abs/file.ts:12:34)` and bare `at /abs/file.ts:12:34`. */
const STACK_FRAME = /\(?([^()\s]+):(\d+):(\d+)\)?$/;

/** Frames inside the debugbar package itself, resolved once at load time. */
const PACKAGE_ROOT = path.dirname(__dirname);

/**
 * First stack frame that belongs to application code — i.e. not this package,
 * not a dependency, not Node internals — reported relative to `root`
 * (e.g. `src/modules/v1/foo/foo.service.ts:214`).
 */
export function resolveCallSite(
  root: string,
  stack: string | undefined,
): string | undefined {
  if (!stack) {
    return undefined;
  }

  for (const rawLine of stack.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('at ')) {
      continue;
    }

    const match = STACK_FRAME.exec(line);
    if (!match) {
      continue;
    }

    const file = match[1].replace(/^file:\/\//, '');
    if (
      file.startsWith('node:') ||
      file.includes('node_modules') ||
      file.includes('internal/') ||
      file.startsWith(PACKAGE_ROOT)
    ) {
      continue;
    }

    const relative = path.relative(root, file);
    const label = relative.startsWith('..') ? file : relative;

    return `${label}:${match[2]}`;
  }

  return undefined;
}
