import {
  type DebugbarConfig,
  defineDebugbarConfig,
  type ResolvedDebugbarConfig,
} from "@uplide/debugbar";

export { resolveDebugbarEnabled } from "@uplide/debugbar";
export type { DebugbarConfig, ResolvedDebugbarConfig } from "@uplide/debugbar";

export interface NextDebugbarConfig extends Omit<DebugbarConfig, "match"> {
  backend: {
    /** Backend origins the server (and a CORS-enabled browser) calls directly. */
    origins: readonly (string | undefined)[];
    /**
     * Same-origin path the browser reaches the backend through, e.g. an API
     * proxy route. Page and RSC requests never start with it, so they are
     * left alone.
     */
    proxyPath?: string;
  };
}

function originOf(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * One config for both runtimes: pass the same object to `registerDebugbar`
 * (server) and `installDebugbarClient` (browser).
 */
export function defineNextDebugbarConfig({
  backend,
  ...config
}: NextDebugbarConfig): ResolvedDebugbarConfig {
  const origins = new Set(
    backend.origins.flatMap((value) => {
      const origin = value ? originOf(value) : null;
      return origin ? [origin] : [];
    }),
  );
  const proxyPath = backend.proxyPath;

  return defineDebugbarConfig({
    ...config,
    match: (url) => {
      const parsed = new URL(url);
      if (origins.has(parsed.origin)) return true;

      return (
        proxyPath !== undefined &&
        parsed.origin === originOf(globalThis.location?.href ?? "") &&
        parsed.pathname.startsWith(proxyPath)
      );
    },
  });
}
