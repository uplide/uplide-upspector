import { randomUUID } from 'node:crypto';
import { UpspectorCollector } from './collector';
import { runWithUpspector } from './context';
import type {
  UpspectorRequestLike,
  UpspectorResponseLike,
  ResolvedUpspectorOptions,
} from './types';
import { UPSPECTOR_HEADER, UPSPECTOR_PAYLOAD_VERSION } from './types';

export type UpspectorMiddleware = (
  req: UpspectorRequestLike,
  res: UpspectorResponseLike,
  next: (err?: unknown) => void,
) => void;

/**
 * Only envelope objects get the extra key. Arrays, class instances, `Buffer`,
 * strings and every `res.send`/`res.render`/stream path stay untouched, so no
 * "skip transform" knowledge from app code is needed here.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Creates the collector for each request, runs the whole downstream chain
 * inside its AsyncLocalStorage scope, and injects the payload by patching
 * `res.json`.
 *
 * `res.json` is the single injection point because both envelopes funnel
 * through it: `ExpressAdapter.reply()` calls `response.json(body)` for object
 * bodies (success path) and an exception filter calls
 * `response.status(code).json({...})` (error path).
 *
 * Registered with `app.use()` — i.e. before guards and interceptors — so
 * guard-issued queries (permission lookups) are captured; an interceptor-based
 * store would miss them, because Nest runs guards first.
 */
export function createUpspectorMiddleware(
  options: ResolvedUpspectorOptions,
): UpspectorMiddleware {
  return (req, res, next) => {
    if (!options.enabled || options.skip(req)) {
      return next();
    }

    const headers = req.headers ?? {};
    const rawHeader = headers['x-request-id'];
    const incoming = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    const requestId = incoming && incoming.length > 0 ? incoming : randomUUID();

    if (!incoming) {
      // Write it back so the correlation-id interceptor downstream adopts the
      // same id: `upspector.requestId` then always equals the `x-request-id`
      // response header.
      headers['x-request-id'] = requestId;
      req.headers = headers;
    }

    const collector = new UpspectorCollector(options, {
      requestId,
      method: req.method ?? 'UNKNOWN',
      url: req.originalUrl || req.url || '',
      startedAtEpochMs: Date.now(),
      startHr: performance.now(),
    });

    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      try {
        if (isPlainObject(body) && !(options.responseKey in body)) {
          collector.setStatusCode(res.statusCode ?? 200);
          collector.addSpan(
            'serialize',
            collector.handlerEndHr ?? collector.startHr,
          );
          collector.addSpan('total', collector.startHr);
          body[options.responseKey] = collector.snapshot();
          res.setHeader(UPSPECTOR_HEADER, String(UPSPECTOR_PAYLOAD_VERSION));
        }
      } catch (error) {
        // A snapshot bug must never turn a 200 into a 500.
        if (isPlainObject(body)) {
          body[options.responseKey] = {
            version: UPSPECTOR_PAYLOAD_VERSION,
            error: `upspector snapshot failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          };
          res.setHeader(UPSPECTOR_HEADER, String(UPSPECTOR_PAYLOAD_VERSION));
        }
      }

      return originalJson(body);
    };

    return runWithUpspector(collector, () => next());
  };
}
