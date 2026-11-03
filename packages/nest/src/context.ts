import { AsyncLocalStorage } from 'node:async_hooks';
import type { UpspectorCollector } from './collector';

/**
 * Request-scoped collector store. AsyncLocalStorage rather than a Nest
 * request-scoped provider: the Prisma driver adapter, ioredis, axios and the
 * logger all run outside the DI graph, and the store must survive `await`
 * boundaries — including Prisma `$transaction` callbacks.
 *
 * `getUpspectorCollector()` returning `undefined` is the single mechanism that
 * makes every integration free when the flag is off: no store is ever created,
 * so each wrapper returns after one `getStore()` call.
 */
const storage = new AsyncLocalStorage<UpspectorCollector>();

export function runWithUpspector<T>(
  collector: UpspectorCollector,
  fn: () => T,
): T {
  return storage.run(collector, fn);
}

export function getUpspectorCollector(): UpspectorCollector | undefined {
  return storage.getStore();
}
