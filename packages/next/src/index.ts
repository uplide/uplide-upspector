import {
  type UpspectorConfig,
  defineUpspectorConfig,
  type ResolvedUpspectorConfig,
} from "@uplide/upspector";

export { resolveUpspectorEnabled } from "@uplide/upspector";
export type { UpspectorConfig, ResolvedUpspectorConfig } from "@uplide/upspector";

export interface NextUpspectorConfig extends Omit<UpspectorConfig, "match"> {
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
 * One config for both runtimes: pass the same object to `registerUpspector`
 * (server) and `installUpspectorClient` (browser).
 */
export function defineNextUpspectorConfig({
  backend,
  ...config
}: NextUpspectorConfig): ResolvedUpspectorConfig {
  const origins = new Set(
    backend.origins.flatMap((value) => {
      const origin = value ? originOf(value) : null;
      return origin ? [origin] : [];
    }),
  );
  const proxyPath = backend.proxyPath;

  return defineUpspectorConfig({
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
