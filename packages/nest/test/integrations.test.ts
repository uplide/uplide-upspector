// Behavioural contract of the integrations that hook third-party objects:
// the Nest logger, ioredis' `sendCommand` funnel, `fetch` and axios-shaped
// clients. Each must be a no-op outside a request scope and must not change
// the wrapped object's observable behaviour.
//
// Run with: `pnpm test`.

import { test } from 'vitest';
import assert from 'node:assert/strict';

import {
  DebugbarCollector,
  DebugbarConsoleLogger,
  installAxiosInstrumentation,
  installFetchInstrumentation,
  instrumentRedisClient,
  resolveDebugbarOptions,
  runWithDebugbar,
} from '../src/index';

function makeCollector(overrides = {}) {
  const options = resolveDebugbarOptions({ enabled: true, ...overrides });

  return new DebugbarCollector(options, {
    requestId: 'test-request',
    method: 'GET',
    url: '/probe',
    startedAtEpochMs: Date.now(),
    startHr: performance.now(),
  });
}

test('logger mirrors printed lines into the collector', () => {
  const collector = makeCollector();
  const logger = new DebugbarConsoleLogger('Probe');
  const printed = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    printed.push(String(chunk));
    return true;
  };

  try {
    runWithDebugbar(collector, () => {
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
  const calls = [];
  const client = {
    sendCommand(command) {
      calls.push(command.name);
      return Promise.resolve('OK');
    },
  };

  assert.equal(instrumentRedisClient(client), client);

  const collector = makeCollector();
  const result = await runWithDebugbar(collector, () =>
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
    sendCommand: () => Promise.reject(new Error('connection lost')),
  };
  instrumentRedisClient(client);

  const collector = makeCollector();

  await assert.rejects(
    runWithDebugbar(collector, () => client.sendCommand({ name: 'get' })),
    /connection lost/,
  );

  const { cache } = collector.snapshot();

  assert.equal(cache.count, 1);
  assert.equal(cache.operations[0].error, 'connection lost');
});

test('fetch instrumentation records method, path and status', async () => {
  const seen = [];
  const holder = {
    fetch: async (input) => {
      seen.push(String(input));
      return { status: 204 };
    },
  };

  installFetchInstrumentation(holder);
  installFetchInstrumentation(holder); // idempotent

  const collector = makeCollector();
  const response = await runWithDebugbar(collector, () =>
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
    const requestHandlers = [];
    const responseHandlers = [];

    return {
      interceptors: {
        request: { use: (fn) => requestHandlers.push(fn) },
        response: { use: (ok, err) => responseHandlers.push([ok, err]) },
      },
      async request(config) {
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
      async fail(config) {
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
  await runWithDebugbar(collector, async () => {
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
