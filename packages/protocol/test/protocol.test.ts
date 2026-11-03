import { describe, expect, it } from 'vitest';
import {
  UPSPECTOR_PAYLOAD_VERSION,
  type UpspectorPayload,
  isUpspectorErrorPayload,
  isUpspectorPayload,
  takeUpspectorPayload,
} from '../src/index.js';

const payload: UpspectorPayload = {
  version: UPSPECTOR_PAYLOAD_VERSION,
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
    expect(isUpspectorPayload(payload)).toBe(true);
    expect(isUpspectorPayload({ ...payload, database: undefined })).toBe(false);
    expect(isUpspectorPayload([payload])).toBe(false);
  });

  it('recognises the snapshot-failure payload', () => {
    expect(isUpspectorErrorPayload({ version: 1, error: 'boom' })).toBe(true);
    expect(isUpspectorErrorPayload(payload)).toBe(false);
  });
});

describe('takeUpspectorPayload', () => {
  it('returns the payload and removes the key', () => {
    const body: Record<string, unknown> = { data: 1, upspector: payload };

    expect(takeUpspectorPayload(body)).toEqual({ payload });
    expect(body).toEqual({ data: 1 });
  });

  it('returns the error payload instead of dropping it', () => {
    const error = { version: 1, error: 'upspector snapshot failed: x' };
    const body: Record<string, unknown> = { upspector: error };

    expect(takeUpspectorPayload(body)).toEqual({ error });
    expect('upspector' in body).toBe(false);
  });

  it('honours a custom key and ignores bodies without it', () => {
    const body: Record<string, unknown> = { _dbg: payload };

    expect(takeUpspectorPayload(body, '_dbg')).toEqual({ payload });
    expect(takeUpspectorPayload({ data: 1 })).toBeUndefined();
    expect(takeUpspectorPayload('text')).toBeUndefined();
  });

  it('removes an unrecognised value without returning it', () => {
    const body: Record<string, unknown> = { upspector: { version: 1 } };

    expect(takeUpspectorPayload(body)).toBeUndefined();
    expect('upspector' in body).toBe(false);
  });
});
