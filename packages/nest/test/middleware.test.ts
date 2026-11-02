// The injection contract: the payload rides only on plain-object envelopes,
// and every response that carries it is flagged with the `x-debugbar` header.

import { test } from 'vitest';
import assert from 'node:assert/strict';

import {
  createDebugbarMiddleware,
  DEBUGBAR_HEADER,
  DEBUGBAR_PAYLOAD_VERSION,
  isDebugbarErrorPayload,
  isDebugbarPayload,
  resolveDebugbarOptions,
} from '../src/index';

function makeResponse() {
  const headers: Record<string, string> = {};
  let sent: unknown;

  return {
    headers,
    sent: () => sent,
    res: {
      statusCode: 200,
      json(body: unknown) {
        sent = body;
        return body;
      },
      setHeader(name: string, value: string) {
        headers[name] = value;
      },
    },
  };
}

function run(body: unknown, overrides = {}) {
  const middleware = createDebugbarMiddleware(
    resolveDebugbarOptions({ enabled: true, ...overrides }),
  );
  const response = makeResponse();

  middleware({ method: 'GET', url: '/probe', headers: {} }, response.res, () => {
    response.res.json(body);
  });

  return response;
}

test('plain-object envelopes get the payload and the header', () => {
  const response = run({ data: 1 });
  const sent = response.sent() as Record<string, unknown>;

  assert.equal(isDebugbarPayload(sent.debugbar), true);
  assert.equal(
    response.headers[DEBUGBAR_HEADER],
    String(DEBUGBAR_PAYLOAD_VERSION),
  );
});

test('arrays and strings stay untouched and unflagged', () => {
  for (const body of [[1, 2], 'text']) {
    const response = run(body);

    assert.deepEqual(response.sent(), body);
    assert.equal(response.headers[DEBUGBAR_HEADER], undefined);
  }
});

test('a custom response key is honoured', () => {
  const sent = run({ data: 1 }, { responseKey: '_dbg' }).sent() as Record<
    string,
    unknown
  >;

  assert.equal(isDebugbarPayload(sent._dbg), true);
  assert.equal('debugbar' in sent, false);
});

test('a failing snapshot still flags the response with an error payload', () => {
  const middleware = createDebugbarMiddleware(
    resolveDebugbarOptions({ enabled: true }),
  );
  const broken = makeResponse();
  let statusReads = 0;
  // Reading the status is the first step of the snapshot; make it throw.
  const res = {
    ...broken.res,
    get statusCode(): number {
      statusReads += 1;
      throw new Error('status unavailable');
    },
  };

  middleware({ method: 'GET', url: '/probe', headers: {} }, res, () => {
    res.json({ data: 1 });
  });

  const sent = broken.sent() as Record<string, unknown>;
  assert.ok(statusReads > 0);
  assert.equal(isDebugbarErrorPayload(sent.debugbar), true);
  assert.equal(broken.headers[DEBUGBAR_HEADER], String(DEBUGBAR_PAYLOAD_VERSION));
});

test('disabled middleware passes through', () => {
  const response = run({ data: 1 }, { enabled: false });

  assert.deepEqual(response.sent(), { data: 1 });
  assert.equal(response.headers[DEBUGBAR_HEADER], undefined);
});
