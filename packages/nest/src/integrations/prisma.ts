import { getUpspectorCollector } from '../context';
import { resolveCallSite } from '../sanitize';
import type { UpspectorQueryKind, ResolvedUpspectorOptions } from '../types';

/**
 * Prisma's `SqlQuery`. Declared structurally so this package never imports
 * `@prisma/*` and stays installable in projects without Prisma.
 */
export interface UpspectorSqlQuery {
  sql: string;
  args?: unknown[];
  argTypes?: unknown[];
}

interface SqlQueryableLike {
  adapterName: string;
  provider: string;
  queryRaw(params: UpspectorSqlQuery): Promise<unknown>;
  executeRaw(params: UpspectorSqlQuery): Promise<unknown>;
}

interface TransactionLike extends SqlQueryableLike {
  options: unknown;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  createSavepoint?(name: string): Promise<void>;
  rollbackToSavepoint?(name: string): Promise<void>;
  releaseSavepoint?(name: string): Promise<void>;
}

interface SqlAdapterLike extends SqlQueryableLike {
  executeScript(script: string): Promise<void>;
  startTransaction(isolationLevel?: string): Promise<TransactionLike>;
  dispose(): Promise<void>;
  getConnectionInfo?(): unknown;
  underlyingDriver?: unknown;
}

export interface UpspectorSqlAdapterFactoryLike {
  adapterName: string;
  provider: string;
  connect(): Promise<SqlAdapterLike>;
  connectToShadowDb?(): Promise<SqlAdapterLike>;
}

/** Prisma internals sit between the app frame and the adapter call. */
const CALL_SITE_STACK_LIMIT = 40;

async function timeQuery<T>(
  options: ResolvedUpspectorOptions,
  kind: UpspectorQueryKind,
  query: UpspectorSqlQuery,
  inTransaction: boolean,
  run: () => Promise<T>,
): Promise<T> {
  const collector = getUpspectorCollector();
  if (!collector) {
    return run();
  }

  const startHr = performance.now();
  const callSite = options.captureCallSite
    ? resolveCallSite(options.callSiteRoot, new Error().stack)
    : undefined;

  try {
    const result = await run();
    collector.recordQuery({
      kind,
      sql: query.sql,
      params: query.args,
      startHr,
      durationMs: performance.now() - startHr,
      inTransaction,
      callSite,
    });
    return result;
  } catch (error) {
    // Recorded here and not in a `finally`, so each call yields exactly one
    // entry.
    collector.recordQuery({
      kind,
      sql: query.sql,
      params: query.args,
      startHr,
      durationMs: performance.now() - startHr,
      inTransaction,
      callSite,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function wrapTransaction(
  transaction: TransactionLike,
  options: ResolvedUpspectorOptions,
): TransactionLike {
  const wrapped: TransactionLike = {
    adapterName: transaction.adapterName,
    provider: transaction.provider,
    options: transaction.options,
    queryRaw: (query) =>
      timeQuery(options, 'query', query, true, () =>
        transaction.queryRaw(query),
      ),
    executeRaw: (query) =>
      timeQuery(options, 'execute', query, true, () =>
        transaction.executeRaw(query),
      ),
    // `COMMIT`/`ROLLBACK` already arrive through `executeRaw`; recording the
    // lifecycle calls as well would double-count them.
    commit: transaction.commit.bind(transaction),
    rollback: transaction.rollback.bind(transaction),
  };

  if (typeof transaction.createSavepoint === 'function') {
    wrapped.createSavepoint = transaction.createSavepoint.bind(transaction);
  }
  if (typeof transaction.rollbackToSavepoint === 'function') {
    wrapped.rollbackToSavepoint =
      transaction.rollbackToSavepoint.bind(transaction);
  }
  if (typeof transaction.releaseSavepoint === 'function') {
    wrapped.releaseSavepoint = transaction.releaseSavepoint.bind(transaction);
  }

  return wrapped;
}

function wrapAdapter(
  adapter: SqlAdapterLike,
  options: ResolvedUpspectorOptions,
): SqlAdapterLike {
  const wrapped: SqlAdapterLike = {
    adapterName: adapter.adapterName,
    provider: adapter.provider,
    queryRaw: (query) =>
      timeQuery(options, 'query', query, false, () => adapter.queryRaw(query)),
    executeRaw: (query) =>
      timeQuery(options, 'execute', query, false, () =>
        adapter.executeRaw(query),
      ),
    executeScript: adapter.executeScript.bind(adapter),
    dispose: adapter.dispose.bind(adapter),
    startTransaction: async (isolationLevel) => {
      const transaction = await timeQuery(
        options,
        'begin',
        { sql: 'BEGIN', args: [] },
        false,
        () => adapter.startTransaction(isolationLevel),
      );
      return wrapTransaction(transaction, options);
    },
  };

  // `bindAdapter` only forwards `getConnectionInfo` when truthy, so an absent
  // method must stay absent instead of becoming a throwing stub.
  const getConnectionInfo = adapter.getConnectionInfo;
  if (typeof getConnectionInfo === 'function') {
    wrapped.getConnectionInfo = getConnectionInfo.bind(adapter);
  }
  if (adapter.underlyingDriver !== undefined) {
    wrapped.underlyingDriver = adapter.underlyingDriver;
  }

  return wrapped;
}

/**
 * Wraps a Prisma driver-adapter factory (e.g. `new PrismaPg({...})`) so every
 * `queryRaw`/`executeRaw` is timed into the active request's collector.
 *
 * The adapter is the hook because Prisma 7 removed `$use`, and `$extends`
 * returns a *new* client object — which would break every `PrismaService`
 * injection and every `PrismaService | Prisma.TransactionClient` union in a
 * consumer. Wrapping the adapter keeps the client class token untouched.
 *
 * Returns the input unchanged when disabled, so production has no wrapper on
 * the hot path.
 */
export function instrumentPrismaDriverAdapter<T extends object>(
  factory: T,
  options: ResolvedUpspectorOptions,
): T {
  if (!options.enabled) {
    return factory;
  }

  if (options.captureCallSite) {
    Error.stackTraceLimit = Math.max(
      Error.stackTraceLimit,
      CALL_SITE_STACK_LIMIT,
    );
  }

  // Boundary cast: the factory is duck-typed on purpose (no `@prisma/*`
  // import), and `bindAdapter`/`bindMigrationAwareSqlAdapterFactory` copy
  // methods by name, so a delegating plain object is a valid substitute.
  const source = factory as unknown as UpspectorSqlAdapterFactoryLike;

  const wrapped: UpspectorSqlAdapterFactoryLike = {
    adapterName: source.adapterName,
    provider: source.provider,
    connect: async () => wrapAdapter(await source.connect(), options),
  };

  const connectToShadowDb = source.connectToShadowDb;
  if (typeof connectToShadowDb === 'function') {
    wrapped.connectToShadowDb = async () =>
      wrapAdapter(await connectToShadowDb.call(source), options);
  }

  return wrapped as unknown as T;
}
