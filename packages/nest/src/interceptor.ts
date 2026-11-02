import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { getDebugbarCollector } from './context';

/**
 * Adds route identity and the handler span. It never touches the payload: the
 * response body is assembled by whatever envelope the host app uses and the
 * middleware's `res.json` patch injects the snapshot.
 */
@Injectable()
export class DebugbarInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const collector = getDebugbarCollector();
    if (!collector) {
      return next.handle();
    }

    // Everything before this interceptor: middleware, guards and the
    // pre-phase of the outer interceptors.
    collector.addSpan('pre-handler', collector.startHr);

    const request = context.switchToHttp().getRequest<{
      route?: { path?: string };
    }>();

    collector.setRoute({
      controller: context.getClass()?.name,
      handler: context.getHandler()?.name,
      route: request?.route?.path,
    });

    const handlerStart = performance.now();

    // `finalize` fires on success and on error, so the handler span exists on
    // 4xx/5xx responses too.
    return next.handle().pipe(
      finalize(() => {
        collector.addSpan('handler', handlerStart);
        collector.handlerEndHr = performance.now();
      }),
    );
  }
}
