import { type DebugbarConfig, setDebugbarConfig } from "@uplide/debugbar";
import { installFetchCapture } from "@uplide/debugbar/fetch";

/**
 * Call at the top level of `instrumentation-client.ts`, synchronously: only
 * synchronous code there is guaranteed to finish before hydration, so this is
 * what puts the `window.fetch` wrapper in place before the first request.
 *
 * Returns an uninstall function.
 */
export function installDebugbarClient(config: DebugbarConfig): () => void {
  const resolved = setDebugbarConfig(config);
  if (!resolved.enabled) return () => {};

  return installFetchCapture({ source: "csr" });
}
