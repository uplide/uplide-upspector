import {
  DEFAULT_RESPONSE_KEY,
  type UpspectorErrorPayload,
  type UpspectorPayload,
} from './types.js';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Structural check of the fields a client reads. Deliberately shallow: the
 * payload comes from the host's own backend, so this only has to catch a
 * version skew or a truncated body, not hostile input.
 */
export function isUpspectorPayload(value: unknown): value is UpspectorPayload {
  if (!isRecord(value)) return false;
  if (typeof value.version !== 'number') return false;
  if (typeof value.requestId !== 'string') return false;
  if (typeof value.durationMs !== 'number') return false;
  if (!Array.isArray(value.timers)) return false;
  if (!isRecord(value.request)) return false;

  return (
    isRecord(value.database) &&
    isRecord(value.http) &&
    isRecord(value.cache) &&
    isRecord(value.logs)
  );
}

export function isUpspectorErrorPayload(
  value: unknown,
): value is UpspectorErrorPayload {
  return (
    isRecord(value) &&
    typeof value.version === 'number' &&
    typeof value.error === 'string'
  );
}

export type UpspectorTakeResult =
  | { payload: UpspectorPayload }
  | { error: UpspectorErrorPayload };

/**
 * Pulls the payload key out of a response envelope.
 *
 * The key is removed from `body` so the rest of the app keeps seeing the exact
 * production envelope shape. A snapshot-failure payload is returned as
 * `{ error }` rather than dropped; anything else under the key is discarded.
 */
export function takeUpspectorPayload(
  body: unknown,
  key: string = DEFAULT_RESPONSE_KEY,
): UpspectorTakeResult | undefined {
  if (!isRecord(body) || !(key in body)) return undefined;

  const value = body[key];
  delete body[key];

  if (isUpspectorPayload(value)) return { payload: value };
  if (isUpspectorErrorPayload(value)) return { error: value };

  return undefined;
}
