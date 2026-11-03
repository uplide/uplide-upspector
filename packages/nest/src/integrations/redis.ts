import { getUpspectorCollector } from '../context';

/**
 * `ioredis` `Command`: `Commander.sendCommand(command, stream?, node?)` is the
 * single funnel every command helper (`get`, `set`, pipelines, Lua scripts)
 * goes through.
 */
interface RedisCommandLike {
  name?: string;
  args?: unknown[];
}

interface RedisClientLike {
  sendCommand(
    command: RedisCommandLike,
    stream?: unknown,
    node?: unknown,
  ): unknown;
}

function isThenable(value: unknown): value is Promise<unknown> {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
    return false;
  }

  return 'then' in value && typeof value.then === 'function';
}

/**
 * Times every command issued through `client`.
 *
 * Mutates and returns the same instance, so existing references stay valid.
 * Only the command name and its *first* argument (the key) are recorded —
 * later arguments hold cached payloads and must never enter the payload.
 */
export function instrumentRedisClient<T extends object>(client: T): T {
  // Boundary cast: ioredis is duck-typed so this package does not depend on it.
  const target = client as unknown as RedisClientLike;
  if (typeof target.sendCommand !== 'function') {
    return client;
  }

  const originalSendCommand = target.sendCommand.bind(target);

  target.sendCommand = (command, stream, node) => {
    const collector = getUpspectorCollector();
    if (!collector) {
      return originalSendCommand(command, stream, node);
    }

    const startHr = performance.now();
    const args = command?.args;
    const entry = {
      command: command?.name ?? 'unknown',
      key: typeof args?.[0] === 'string' ? args[0] : undefined,
      argCount: args?.length ?? 0,
      startHr,
    };

    const record = (error?: unknown) =>
      collector.recordCache({
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
      result = originalSendCommand(command, stream, node);
    } catch (error) {
      record(error);
      throw error;
    }

    if (isThenable(result)) {
      result.then(
        () => record(),
        (error: unknown) => record(error),
      );
      return result;
    }

    record();
    return result;
  };

  return client;
}
