// Behavioural contract of the collector and the parameter sanitizer.

import { test } from 'vitest';
import assert from 'node:assert/strict';

import {
  UpspectorCollector,
  resolveUpspectorOptions,
  sanitizeParamValue,
  truncateText,
} from '../src/index';

function makeCollector(overrides = {}) {
  const options = resolveUpspectorOptions({ enabled: true, ...overrides });

  return new UpspectorCollector(options, {
    requestId: 'test-request',
    method: 'GET',
    url: '/probe',
    startedAtEpochMs: Date.now(),
    startHr: performance.now(),
  });
}

function recordQuery(collector, sql, extra = {}) {
  collector.recordQuery({
    kind: 'query',
    sql,
    params: [],
    startHr: performance.now(),
    durationMs: 1,
    inTransaction: false,
    ...extra,
  });
}

test('query bucket is bounded but keeps counting', () => {
  const collector = makeCollector({ maxQueries: 2 });

  for (let i = 0; i < 5; i += 1) {
    recordQuery(collector, `SELECT ${i}`, { durationMs: 2 });
  }

  const { database } = collector.snapshot();

  assert.equal(database.queries.length, 2);
  assert.equal(database.count, 5);
  assert.equal(database.truncated, true);
  assert.equal(database.totalMs, 10);
});

test('untruncated bucket reports truncated: false', () => {
  const collector = makeCollector();

  recordQuery(collector, 'SELECT 1');

  const { database } = collector.snapshot();

  assert.equal(database.queries.length, 1);
  assert.equal(database.count, 1);
  assert.equal(database.truncated, false);
  assert.deepEqual(database.duplicates, []);
});

test('repeated SQL surfaces as a duplicate group', () => {
  const collector = makeCollector();

  recordQuery(collector, 'SELECT * FROM "User" WHERE id = $1');
  recordQuery(collector, 'SELECT * FROM "User" WHERE id = $1');
  recordQuery(collector, 'SELECT * FROM "User" WHERE id = $1');
  recordQuery(collector, 'SELECT 1');

  const { database } = collector.snapshot();

  assert.deepEqual(database.duplicates, [
    { sql: 'SELECT * FROM "User" WHERE id = $1', count: 3 },
  ]);
});

test('sanitizeParamValue maps every non-JSON primitive Prisma can bind', () => {
  assert.equal(sanitizeParamValue(10n, 256), '10');
  assert.equal(
    sanitizeParamValue(new Date(0), 256),
    '1970-01-01T00:00:00.000Z',
  );
  assert.equal(sanitizeParamValue(Buffer.alloc(3), 256), '<Bytes 3>');
  assert.equal(sanitizeParamValue(undefined, 256), null);
  assert.equal(sanitizeParamValue('x'.repeat(300), 8), 'xxxxxxxx…(300)');
  assert.equal(truncateText('short', 8), 'short');
  assert.deepEqual(sanitizeParamValue({ a: [1n, new Date(0)] }, 256), {
    a: ['1', '1970-01-01T00:00:00.000Z'],
  });
  assert.equal(
    sanitizeParamValue({ a: { b: { c: { d: 1 } } } }, 256).a.b.c,
    '[Object]',
  );
});

test('snapshot with bound params survives JSON.stringify', () => {
  const collector = makeCollector({ paramMaxLength: 8 });

  recordQuery(collector, 'SELECT * FROM "Lot" WHERE id = $1', {
    params: [10n, new Date(0), Buffer.alloc(3), 'x'.repeat(300), undefined],
  });

  const snapshot = collector.snapshot();

  assert.deepEqual(snapshot.database.queries[0].params, [
    '10',
    '1970-01-01T00:00:00.000Z',
    '<Bytes 3>',
    'xxxxxxxx…(300)',
    null,
  ]);
  assert.doesNotThrow(() => JSON.stringify(snapshot));
});

test('includeQueryParams: false omits the params key entirely', () => {
  const collector = makeCollector({ includeQueryParams: false });

  recordQuery(collector, 'SELECT $1', { params: ['secret'] });

  const [entry] = collector.snapshot().database.queries;

  assert.equal('params' in entry, false);
  assert.equal(JSON.stringify(collector.snapshot()).includes('secret'), false);
});

test('custom sanitizeParams hook replaces the built-in one', () => {
  const collector = makeCollector({
    sanitizeParams: (sql, params) => [sql.length, params.length],
  });

  recordQuery(collector, 'SELECT $1', { params: ['secret'] });

  assert.deepEqual(collector.snapshot().database.queries[0].params, [9, 1]);
});

test('snapshot is repeatable and never double-counts', () => {
  const collector = makeCollector();

  recordQuery(collector, 'SELECT 1');
  collector.recordHttp({
    method: 'GET',
    url: 'https://example.test/x',
    statusCode: 200,
    startHr: performance.now(),
    durationMs: 3,
  });
  collector.recordCache({
    command: 'get',
    key: 'k',
    argCount: 1,
    startHr: performance.now(),
    durationMs: 1,
  });
  collector.recordLog({ level: 'warn', message: 'careful', context: 'Probe' });

  const first = collector.snapshot();
  const second = collector.snapshot();

  assert.equal(first.database.count, second.database.count);
  assert.equal(first.http.count, 1);
  assert.equal(second.http.count, 1);
  assert.equal(second.cache.count, 1);
  assert.equal(second.logs.count, 1);
  assert.equal(second.logs.entries[0].context, 'Probe');
  assert.equal(second.version, 1);
});

test('spans are capped and record their offset from request start', () => {
  const collector = makeCollector({ maxSpans: 2 });

  const closeSpan = collector.startSpan('work');
  closeSpan();
  closeSpan(); // idempotent: a double close must not push twice
  collector.addSpan('total', collector.startHr);
  collector.addSpan('dropped', collector.startHr);

  const { timers } = collector.snapshot();

  assert.deepEqual(
    timers.map((span) => span.name),
    ['work', 'total'],
  );
  assert.ok(timers[0].startMs >= 0);
  assert.ok(timers[1].durationMs >= 0);
});

test('cache and http buckets truncate independently', () => {
  const collector = makeCollector({ maxCacheOps: 1, maxHttpCalls: 1 });

  for (let i = 0; i < 3; i += 1) {
    collector.recordCache({
      command: 'get',
      key: `k${i}`,
      argCount: 1,
      startHr: performance.now(),
      durationMs: 1,
    });
    collector.recordHttp({
      method: 'GET',
      url: `https://example.test/${i}`,
      startHr: performance.now(),
      durationMs: 1,
    });
  }

  const snapshot = collector.snapshot();

  assert.equal(snapshot.cache.operations.length, 1);
  assert.equal(snapshot.cache.count, 3);
  assert.equal(snapshot.cache.truncated, true);
  assert.equal(snapshot.http.calls.length, 1);
  assert.equal(snapshot.http.count, 3);
  assert.equal(snapshot.http.truncated, true);
  assert.equal(snapshot.logs.truncated, false);
});

test('route identity and status code land in the payload', () => {
  const collector = makeCollector();

  collector.setRoute({
    controller: 'ProbeController',
    handler: 'probe',
    route: '/probe',
  });
  collector.setStatusCode(418);

  const { request } = collector.snapshot();

  assert.deepEqual(request, {
    method: 'GET',
    url: '/probe',
    route: '/probe',
    controller: 'ProbeController',
    handler: 'probe',
    statusCode: 418,
  });
});
