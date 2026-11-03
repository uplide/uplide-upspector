import {
  type UpspectorConfig,
  EVENTS_ENDPOINT,
  forwardUpspectorEntries,
  setUpspectorConfig,
} from "@uplide/upspector";
import { installFetchCapture } from "@uplide/upspector/fetch";

/**
 * Call at the top level of `instrumentation-client.ts`, synchronously: only
 * synchronous code there is guaranteed to finish before hydration, so this is
 * what puts the `window.fetch` wrapper in place before the first request.
 *
 * With `mcp` on, captured entries are also forwarded to the `events` endpoint
 * of the Upspector route, for its `mcp` endpoint to hand to an agent.
 *
 * Returns an uninstall function.
 */
export function installUpspectorClient(config: UpspectorConfig): () => void {
  const resolved = setUpspectorConfig(config);
  if (!resolved.enabled) return () => {};

  const uninstall = installFetchCapture({ source: "csr" });
  const stopForwarding = resolved.mcp
    ? forwardUpspectorEntries(EVENTS_ENDPOINT)
    : () => {};

  return () => {
    stopForwarding();
    uninstall();
  };
}
