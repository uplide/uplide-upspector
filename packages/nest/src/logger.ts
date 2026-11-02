import { ConsoleLogger, type LogLevel } from '@nestjs/common';
import { getDebugbarCollector } from './context';
import type { DebugbarLogLevel } from './types';

const DEBUGBAR_LOG_LEVELS: Record<string, DebugbarLogLevel> = {
  log: 'log',
  error: 'error',
  warn: 'warn',
  debug: 'debug',
  verbose: 'verbose',
  fatal: 'fatal',
};

/**
 * `ConsoleLogger` that also mirrors each printed line into the active
 * request's collector.
 *
 * Hooks the single `printMessages` funnel rather than the six public level
 * methods: every level routes through it with the context and level already
 * resolved (and only when the level is enabled), so console output stays
 * byte-identical to plain `ConsoleLogger`.
 */
export class DebugbarConsoleLogger extends ConsoleLogger {
  protected printMessages(
    messages: unknown[],
    context?: string,
    logLevel?: LogLevel,
    writeStreamType?: 'stdout' | 'stderr',
    errorStack?: unknown,
  ): void {
    super.printMessages(
      messages,
      context,
      logLevel,
      writeStreamType,
      errorStack,
    );

    const collector = getDebugbarCollector();
    if (!collector) {
      return;
    }

    const level = DEBUGBAR_LOG_LEVELS[logLevel ?? 'log'] ?? 'log';
    for (const message of messages) {
      collector.recordLog({
        level,
        message: typeof message === 'string' ? message : String(message),
        context,
      });
    }
  }
}
