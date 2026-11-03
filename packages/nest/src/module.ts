import { type DynamicModule, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { UpspectorInterceptor } from './interceptor';
import { UPSPECTOR_OPTIONS, resolveUpspectorOptions } from './options';
import type { UpspectorOptions } from './types';

@Module({})
export class NestUpspectorModule {
  /**
   * Registers the resolved options (readable via `app.get(UPSPECTOR_OPTIONS)`)
   * and the route-identity interceptor.
   *
   * The middleware is intentionally *not* registered through
   * `MiddlewareConsumer`: consumers wire it imperatively with
   * `app.use(createUpspectorMiddleware(app.get(UPSPECTOR_OPTIONS)))`, which keeps
   * one source of truth for options and sidesteps Express-5 `forRoutes('*')`
   * path-pattern breakage.
   */
  static forRoot(options: UpspectorOptions): DynamicModule {
    return {
      module: NestUpspectorModule,
      global: true,
      providers: [
        {
          provide: UPSPECTOR_OPTIONS,
          useValue: resolveUpspectorOptions(options),
        },
        {
          provide: APP_INTERCEPTOR,
          useClass: UpspectorInterceptor,
        },
      ],
      exports: [UPSPECTOR_OPTIONS],
    };
  }
}
