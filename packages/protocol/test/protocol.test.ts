import { describe, expect, it } from 'vitest';
import {
  DEBUGBAR_PAYLOAD_VERSION,
  type DebugbarPayload,
  isDebugbarErrorPayload,
  isDebugbarPayload,
  takeDebugbarPayload,
} from '../src/index.js';

const payload: DebugbarPayload = {
  version: DEBUGBAR_PAYLOAD_VERSION,
  requestId: 'req-1',
  startedAt: '2026-11-02T00:00:00.000Z',
  durationMs: 12,
  request: { method: 'GET', url: '/probe' },
  timers: [],
  database: { count: 0, totalMs: 0, truncated: false, duplicates: [], queries: [] },
  http: { count: 0, totalMs: 0, truncated: false, calls: [] },
  cache: { count: 0, totalMs: 0, truncated: false, operations: [] },
  logs: { count: 0, truncated: false, entries: [] },
  memory: { rssBytes: 1, heapUsedBytes: 1, heapUsedDeltaBytes: 0 },
};

describe('guards', () => {
  it('accepts a v1 payload and rejects a partial one', () => {
    expect(isDebugbarPayload(payload)).toBe(true);
    expect(isDebugbarPayload({ ...payload, database: undefined })).toBe(false);
    expect(isDebugbarPayload([payload])).toBe(false);
  });

  it('recognises the snapshot-failure payload', () => {
    expect(isDebugbarErrorPayload({ version: 1, error: 'boom' })).toBe(true);
    expect(isDebugbarErrorPayload(payload)).toBe(false);
  });
});

describe('takeDebugbarPayload', () => {
  it('returns the payload and removes the key', () => {
    const body: Record<string, unknown> = { data: 1, debugbar: payload };

    expect(takeDebugbarPayload(body)).toEqual({ payload });
    expect(body).toEqual({ data: 1 });
  });

  it('returns the error payload instead of dropping it', () => {
    const error = { version: 1, error: 'debugbar snapshot failed: x' };
    const body: Record<string, unknown> = { debugbar: error };

    expect(takeDebugbarPayload(body)).toEqual({ error });
    expect('debugbar' in body).toBe(false);
  });

  it('honours a custom key and ignores bodies without it', () => {
    const body: Record<string, unknown> = { _dbg: payload };

    expect(takeDebugbarPayload(body, '_dbg')).toEqual({ payload });
    expect(takeDebugbarPayload({ data: 1 })).toBeUndefined();
    expect(takeDebugbarPayload('text')).toBeUndefined();
  });

  it('removes an unrecognised value without returning it', () => {
    const body: Record<string, unknown> = { debugbar: { version: 1 } };

    expect(takeDebugbarPayload(body)).toBeUndefined();
    expect('debugbar' in body).toBe(false);
  });
});
