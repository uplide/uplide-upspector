// The injection contract: the payload rides only on plain-object envelopes,
// and every response that carries it is flagged with the `x-upspector` header.

import { test } from 'vitest';
import assert from 'node:assert/strict';

import {
  createUpspectorMiddleware,
  UPSPECTOR_HEADER,
  UPSPECTOR_PAYLOAD_VERSION,
  isUpspectorErrorPayload,
  isUpspectorPayload,
  resolveUpspectorOptions,
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
  const middleware = createUpspectorMiddleware(
    resolveUpspectorOptions({ enabled: true, ...overrides }),
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

  assert.equal(isUpspectorPayload(sent.upspector), true);
  assert.equal(
    response.headers[UPSPECTOR_HEADER],
    String(UPSPECTOR_PAYLOAD_VERSION),
  );
});

test('arrays and strings stay untouched and unflagged', () => {
  for (const body of [[1, 2], 'text']) {
    const response = run(body);

    assert.deepEqual(response.sent(), body);
    assert.equal(response.headers[UPSPECTOR_HEADER], undefined);
  }
});

test('a custom response key is honoured', () => {
  const sent = run({ data: 1 }, { responseKey: '_dbg' }).sent() as Record<
    string,
    unknown
  >;

  assert.equal(isUpspectorPayload(sent._dbg), true);
  assert.equal('upspector' in sent, false);
});

test('a failing snapshot still flags the response with an error payload', () => {
  const middleware = createUpspectorMiddleware(
    resolveUpspectorOptions({ enabled: true }),
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
  assert.equal(isUpspectorErrorPayload(sent.upspector), true);
  assert.equal(broken.headers[UPSPECTOR_HEADER], String(UPSPECTOR_PAYLOAD_VERSION));
});

test('disabled middleware passes through', () => {
  const response = run({ data: 1 }, { enabled: false });

  assert.deepEqual(response.sent(), { data: 1 });
  assert.equal(response.headers[UPSPECTOR_HEADER], undefined);
});
