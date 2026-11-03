import { AsyncLocalStorage } from 'node:async_hooks';
import { getDebugbarCollector } from '../context';
import { resolveCallSite } from '../sanitize';
import type { DebugbarQueryKind, ResolvedDebugbarOptions } from '../types';

/**
 * Drizzle's `Query`. Declared structurally so this package never imports
 * `drizzle-orm` and stays installable in projects without Drizzle.
 */
interface DrizzleQueryLike {
  sql: string;
  params?: unknown[];
}

type PreparedQueryLike = Record<string, unknown>;

/**
 * The driver session (`NodePgSession`, `MySql2Session`,
 * `BetterSQLiteSession`, ...). Every builder, relational query and raw
 * `db.execute` ends in `prepareQuery`, and every transaction in `transaction`.
 */
interface DrizzleSessionLike {
  prepareQuery(query: DrizzleQueryLike, ...rest: unknown[]): PreparedQueryLike;
  transaction?(fn: (tx: unknown) => unknown, ...rest: unknown[]): unknown;
}

interface DrizzleDatabaseLike {
  session?: DrizzleSessionLike;
  _?: { session?: DrizzleSessionLike };
}

const INSTRUMENTED = Symbol.for('uplide.debugbar.drizzle');

/** Drizzle internals sit between the app frame and the prepared query. */
const CALL_SITE_STACK_LIMIT = 40;

/**
 * SQLite prepared queries expose `run`/`all`/`get`/`values`, and their
 * `execute` is a lazy thenable that calls one of them later — so `execute` is
 * only timed for the Postgres and MySQL shapes.
 */
const SQLITE_METHODS = ['run', 'all', 'get', 'values'] as const;
const DEFAULT_METHODS = ['execute', 'all'] as const;

/** Set while a timed call runs, so a method that delegates to another (`get` → `all`) is recorded once. */
const activeQuery = new AsyncLocalStorage<true>();
/** Set inside a `transaction` callback, which Drizzle runs on a fresh session. */
const activeTransaction = new AsyncLocalStorage<true>();

function classify(sql: string): DebugbarQueryKind {
  const head = sql.trimStart().slice(0, 20).toLowerCase();
  if (head.startsWith('begin') || head.startsWith('start transaction')) {
    return 'begin';
  }
  if (/^(select|with|show|explain|values|pragma)\b/.test(head)) {
    return 'query';
  }
  return 'execute';
}

function timeCall(
  options: ResolvedDebugbarOptions,
  query: DrizzleQueryLike,
  run: () => unknown,
): unknown {
  const collector = getDebugbarCollector();
  if (!collector || activeQuery.getStore()) {
    return run();
  }

  const startHr = performance.now();
  const callSite = options.captureCallSite
    ? resolveCallSite(options.callSiteRoot, new Error().stack)
    : undefined;
  const entry = {
    kind: classify(query.sql),
    sql: query.sql,
    params: query.params,
    startHr,
    inTransaction: activeTransaction.getStore() === true,
    callSite,
  };

  const record = (error?: unknown) =>
    collector.recordQuery({
      ...entry,
      durationMs: performance.now() - startHr,
      error:
        error === undefined
          ? undefined
          : error instanceof Error
            ? error.message
            : String(error),
    });

  let result: unknown;
  try {
    result = activeQuery.run(true, run);
  } catch (error) {
    record(error);
    throw error;
  }

  // Only native promises: Drizzle's `QueryPromise` runs the query on `then`,
  // so subscribing to one would execute it a second time.
  if (result instanceof Promise) {
    return result.then(
      (value) => {
        record();
        return value;
      },
      (error: unknown) => {
        record(error);
        throw error;
      },
    );
  }

  record();
  return result;
}

function wrapPreparedQuery(
  prepared: PreparedQueryLike,
  query: DrizzleQueryLike,
  options: ResolvedDebugbarOptions,
): PreparedQueryLike {
  const methods =
    typeof prepared.run === 'function' ? SQLITE_METHODS : DEFAULT_METHODS;

  for (const name of methods) {
    const original = prepared[name];
    if (typeof original !== 'function') {
      continue;
    }

    prepared[name] = (...args: unknown[]) =>
      timeCall(options, query, () => original.apply(prepared, args));
  }

  return prepared;
}

/**
 * Times every query a Drizzle database runs into the active request's
 * collector: builders, relational queries, `db.execute(sql)` and the
 * `BEGIN`/`COMMIT`/`ROLLBACK`/savepoint statements of `db.transaction`.
 *
 * The session class is the hook because Drizzle opens a *new* session of the
 * same class for every transaction; patching only `db.session` would miss
 * every query inside one. The patch is a pass-through for databases outside a
 * request, so other instances of the same driver are unaffected.
 *
 * Mutates and returns the same instance, so existing references stay valid.
 * Returns the input untouched when disabled.
 */
export function instrumentDrizzleDatabase<T extends object>(
  db: T,
  options: ResolvedDebugbarOptions,
): T {
  if (!options.enabled) {
    return db;
  }

  // Boundary cast: Drizzle is duck-typed so this package does not depend on it.
  const source = db as unknown as DrizzleDatabaseLike;
  const session = source.session ?? source._?.session;
  if (!session || typeof session.prepareQuery !== 'function') {
    return db;
  }

  const proto = Object.getPrototypeOf(session) as DrizzleSessionLike &
    Record<symbol, unknown>;
  if (proto[INSTRUMENTED]) {
    return db;
  }
  proto[INSTRUMENTED] = true;

  if (options.captureCallSite) {
    Error.stackTraceLimit = Math.max(
      Error.stackTraceLimit,
      CALL_SITE_STACK_LIMIT,
    );
  }

  const prepareQuery = proto.prepareQuery;
  proto.prepareQuery = function (
    this: DrizzleSessionLike,
    query: DrizzleQueryLike,
    ...rest: unknown[]
  ) {
    const prepared = prepareQuery.call(this, query, ...rest);
    return wrapPreparedQuery(prepared, query, options);
  };

  const transaction = proto.transaction;
  if (typeof transaction === 'function') {
    proto.transaction = function (
      this: DrizzleSessionLike,
      ...args: [(tx: unknown) => unknown, ...unknown[]]
    ) {
      return activeTransaction.run(true, () => transaction.apply(this, args));
    };
  }

  return db;
}
