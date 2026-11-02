import { type DynamicModule, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { DebugbarInterceptor } from './interceptor';
import { DEBUGBAR_OPTIONS, resolveDebugbarOptions } from './options';
import type { DebugbarOptions } from './types';

@Module({})
export class NestDebugbarModule {
  /**
   * Registers the resolved options (readable via `app.get(DEBUGBAR_OPTIONS)`)
   * and the route-identity interceptor.
   *
   * The middleware is intentionally *not* registered through
   * `MiddlewareConsumer`: consumers wire it imperatively with
   * `app.use(createDebugbarMiddleware(app.get(DEBUGBAR_OPTIONS)))`, which keeps
   * one source of truth for options and sidesteps Express-5 `forRoutes('*')`
   * path-pattern breakage.
   */
  static forRoot(options: DebugbarOptions): DynamicModule {
    return {
      module: NestDebugbarModule,
      global: true,
      providers: [
        {
          provide: DEBUGBAR_OPTIONS,
          useValue: resolveDebugbarOptions(options),
        },
        {
          provide: APP_INTERCEPTOR,
          useClass: DebugbarInterceptor,
        },
      ],
      exports: [DEBUGBAR_OPTIONS],
    };
  }
}
