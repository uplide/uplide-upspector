// Behavioural contract of the integrations that hook third-party objects:
// the Nest logger, ioredis' `sendCommand` funnel, Drizzle sessions, `fetch`
// and axios-shaped clients. Each must be a no-op outside a request scope and
// must not change the wrapped object's observable behaviour.
//
// Run with: `pnpm test`.

import { test } from 'vitest';
import assert from 'node:assert/strict';

import {
  UpspectorCollector,
  UpspectorConsoleLogger,
  installAxiosInstrumentation,
  installFetchInstrumentation,
  instrumentDrizzleDatabase,
  instrumentRedisClient,
  resolveUpspectorOptions,
  runWithUpspector,
} from '../src/index';

interface RedisCommand {
  name?: string;
  args?: unknown[];
}

interface AxiosConfig {
  method?: string;
  url?: string;
  baseURL?: string;
}
type RequestHandler = (config: AxiosConfig) => AxiosConfig;
type ResponseHandler = (response: unknown) => unknown;
type ErrorHandler = (error: unknown) => Promise<unknown>;

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

test('logger mirrors printed lines into the collector', () => {
  const collector = makeCollector();
  const logger = new UpspectorConsoleLogger('Probe');
  const printed: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: string | Uint8Array) => {
    printed.push(String(chunk));
    return true;
  };

  try {
    runWithUpspector(collector, () => {
      logger.log('inside request');
      logger.warn('careful');
    });
    logger.log('outside request');
  } finally {
    process.stdout.write = originalWrite;
  }

  const { logs } = collector.snapshot();

  assert.equal(logs.count, 2);
  assert.deepEqual(
    logs.entries.map((entry) => [entry.level, entry.message, entry.context]),
    [
      ['log', 'inside request', 'Probe'],
      ['warn', 'careful', 'Probe'],
    ],
  );
  // Console output is still produced for all three calls.
  assert.equal(printed.length, 3);
  assert.ok(printed[0].includes('inside request'));
});

test('redis instrumentation times commands and preserves results', async () => {
  const calls: Array<string | undefined> = [];
  const client = {
    sendCommand(command: RedisCommand) {
      calls.push(command.name);
      return Promise.resolve('OK');
    },
  };

  assert.equal(instrumentRedisClient(client), client);

  const collector = makeCollector();
  const result = await runWithUpspector(collector, () =>
    client.sendCommand({ name: 'get', args: ['lot:1', 'ignored'] }),
  );
  await client.sendCommand({ name: 'set', args: ['lot:2'] });

  const { cache } = collector.snapshot();

  assert.equal(result, 'OK');
  assert.deepEqual(calls, ['get', 'set']);
  assert.equal(cache.count, 1);
  assert.equal(cache.operations[0].command, 'get');
  assert.equal(cache.operations[0].key, 'lot:1');
  assert.equal(cache.operations[0].argCount, 2);
  assert.equal(
    JSON.stringify(cache.operations[0]).includes('ignored'),
    false,
    'command arguments beyond the key must never reach the payload',
  );
});

test('redis instrumentation records rejections and rethrows', async () => {
  const client = {
    sendCommand: (_command: RedisCommand) =>
      Promise.reject(new Error('connection lost')),
  };
  instrumentRedisClient(client);

  const collector = makeCollector();

  await assert.rejects(
    runWithUpspector(collector, () => client.sendCommand({ name: 'get' })),
    /connection lost/,
  );

  const { cache } = collector.snapshot();

  assert.equal(cache.count, 1);
  assert.equal(cache.operations[0].error, 'connection lost');
});

test('fetch instrumentation records method, path and status', async () => {
  const seen: string[] = [];
  const holder: { fetch: typeof fetch } = {
    fetch: async (input) => {
      seen.push(String(input));
      return new Response(null, { status: 204 });
    },
  };

  installFetchInstrumentation(holder);
  installFetchInstrumentation(holder); // idempotent

  const collector = makeCollector();
  const response = await runWithUpspector(collector, () =>
    holder.fetch('https://api.test/v1/items?token=secret', { method: 'post' }),
  );
  await holder.fetch('https://api.test/outside');

  const { http } = collector.snapshot();

  assert.equal(response.status, 204);
  assert.equal(seen.length, 2);
  assert.equal(http.count, 1);
  assert.deepEqual(
    { method: http.calls[0].method, url: http.calls[0].url },
    { method: 'POST', url: 'https://api.test/v1/items' },
  );
  assert.equal(http.calls[0].statusCode, 204);
});

test('axios instrumentation covers instances created after install', async () => {
  const makeInstance = () => {
    const requestHandlers: RequestHandler[] = [];
    const responseHandlers: Array<[ResponseHandler, ErrorHandler]> = [];

    return {
      interceptors: {
        request: { use: (fn: RequestHandler) => requestHandlers.push(fn) },
        response: {
          use: (ok: ResponseHandler, err: ErrorHandler) =>
            responseHandlers.push([ok, err]),
        },
      },
      async request(config: AxiosConfig) {
        let current = config;
        for (const handler of requestHandlers) {
          current = handler(current);
        }
        const response = { status: 201, config: current };
        for (const [ok] of responseHandlers) {
          ok(response);
        }
        return response;
      },
      async fail(config: AxiosConfig) {
        let current = config;
        for (const handler of requestHandlers) {
          current = handler(current);
        }
        for (const [, err] of responseHandlers) {
          await err({ message: 'boom', config: current }).catch(() => {});
        }
      },
    };
  };

  const axiosModule = Object.assign(makeInstance(), {
    create: () => makeInstance(),
  });

  installAxiosInstrumentation(axiosModule);
  const created = axiosModule.create();

  const collector = makeCollector();
  await runWithUpspector(collector, async () => {
    await created.request({
      method: 'get',
      url: '/lots?page=2',
      baseURL: 'https://api.test/',
    });
    await axiosModule.fail({ method: 'put', url: 'https://api.test/lots/1' });
  });

  const { http } = collector.snapshot();

  assert.equal(http.count, 2);
  assert.deepEqual(
    http.calls.map((call) => [call.method, call.url, call.statusCode]),
    [
      ['GET', 'https://api.test/lots', 201],
      ['PUT', 'https://api.test/lots/1', undefined],
    ],
  );
  assert.equal(http.calls[1].error, 'boom');
});

interface DrizzleQuery {
  sql: string;
  params?: unknown[];
}

// Drizzle patches the session *class*, so every test declares its own.
function makeDrizzleDatabase<P>(prepared: (query: DrizzleQuery) => P) {
  class FakeSession {
    prepareQuery(query: DrizzleQuery) {
      return prepared(query);
    }
    async transaction<T>(fn: (tx: { session: FakeSession }) => Promise<T>) {
      // Drizzle runs the callback on a fresh session of the same class.
      return fn({ session: new FakeSession() });
    }
  }

  return { session: new FakeSession() };
}

test('drizzle instrumentation times queries, transactions and errors', async () => {
  const db = makeDrizzleDatabase((query) => ({
    async execute() {
      if (query.sql.includes('nope')) {
        throw new Error('column "nope" does not exist');
      }
      return [{ id: 1 }];
    },
  }));

  assert.equal(
    instrumentDrizzleDatabase(db, resolveUpspectorOptions({ enabled: true })),
    db,
  );

  const collector = makeCollector();
  const rows = await runWithUpspector(collector, async () => {
    const result = await db.session
      .prepareQuery({ sql: 'select * from lots where id = $1', params: [1] })
      .execute();
    await db.session.transaction((tx) =>
      tx.session
        .prepareQuery({ sql: 'update lots set name = $1', params: ['a'] })
        .execute(),
    );
    await assert.rejects(
      db.session.prepareQuery({ sql: 'select nope from lots' }).execute(),
      /nope/,
    );
    return result;
  });
  await db.session.prepareQuery({ sql: 'select 1' }).execute();

  const { database } = collector.snapshot();

  assert.deepEqual(rows, [{ id: 1 }]);
  assert.equal(database.count, 3);
  assert.deepEqual(
    database.queries.map((query) => [query.kind, query.inTransaction]),
    [
      ['query', false],
      ['execute', true],
      ['query', false],
    ],
  );
  assert.deepEqual(database.queries[0].params, [1]);
  assert.equal(database.queries[2].error, 'column "nope" does not exist');
});

test('drizzle instrumentation records sqlite delegation once and leaves lazy thenables alone', async () => {
  let thenCalls = 0;
  const db = makeDrizzleDatabase(() => ({
    all: () => [{ id: 1 }],
    get() {
      return this.all()[0];
    },
    run: () => ({ changes: 1 }),
    execute: () => ({
      then(resolve: (value: unknown[]) => void) {
        thenCalls += 1;
        resolve([]);
      },
    }),
  }));
  instrumentDrizzleDatabase(db, resolveUpspectorOptions({ enabled: true }));

  const collector = makeCollector();
  runWithUpspector(collector, () => {
    const prepared = db.session.prepareQuery({ sql: 'select * from lots' });
    assert.deepEqual(prepared.get(), { id: 1 });
    prepared.execute();
  });

  assert.equal(collector.snapshot().database.count, 1);
  assert.equal(thenCalls, 0, 'a lazy QueryPromise must not be executed');
});

test('drizzle instrumentation is a no-op when disabled', () => {
  const db = makeDrizzleDatabase(() => ({ execute: async () => [] }));
  const proto = Object.getPrototypeOf(db.session);
  const original = proto.prepareQuery;

  assert.equal(
    instrumentDrizzleDatabase(db, resolveUpspectorOptions({ enabled: false })),
    db,
  );
  assert.equal(proto.prepareQuery, original);
});
