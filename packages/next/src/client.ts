import {
  type DebugbarConfig,
  forwardDebugbarEntries,
  setDebugbarConfig,
} from "@uplide/debugbar";
import { installFetchCapture } from "@uplide/debugbar/fetch";

/**
 * Call at the top level of `instrumentation-client.ts`, synchronously: only
 * synchronous code there is guaranteed to finish before hydration, so this is
 * what puts the `window.fetch` wrapper in place before the first request.
 *
 * With `eventsEndpoint` set, captured entries are also forwarded there for the
 * MCP route (`@uplide/debugbar-next/mcp`).
 *
 * Returns an uninstall function.
 */
export function installDebugbarClient(config: DebugbarConfig): () => void {
  const resolved = setDebugbarConfig(config);
  if (!resolved.enabled) return () => {};

  const uninstall = installFetchCapture({ source: "csr" });
  const stopForwarding = resolved.eventsEndpoint
    ? forwardDebugbarEntries(resolved.eventsEndpoint)
    : () => {};

  return () => {
    stopForwarding();
    uninstall();
  };
}
