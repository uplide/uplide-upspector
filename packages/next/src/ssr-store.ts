import type { UpspectorEntry } from "@uplide/upspector";
import { cache } from "react";

export interface UpspectorSsrStore {
  /** Set by `openUpspectorScope()`; nothing is captured while false. */
  active: boolean;
  entries: UpspectorEntry[];
  pending: Set<Promise<void>>;
  /** Captures started so far; tells a waiter whether new work arrived. */
  started: number;
}

/**
 * Per-render store. `cache()` scopes it to a single RSC render pass, so two
 * concurrent requests never see each other's queries. Outside a render (route
 * handlers, middleware) it hands out a fresh, inactive store on every call,
 * which is what keeps those requests uncaptured.
 */
export const getUpspectorSsrStore = cache<() => UpspectorSsrStore>(() => ({
  active: false,
  entries: [],
  pending: new Set(),
  started: 0,
}));

/**
 * `instrumentation.ts` is bundled apart from the RSC layer, so the fetch
 * wrapper it installs cannot import this module's `cache()`-scoped store. The
 * RSC side publishes its accessor here when a scope opens, and the wrapper
 * reads it back on every call, inside the render's own async context.
 */
const HOST = Symbol.for("@uplide/upspector-next/ssr-store");

type HostHolder = { [HOST]?: () => UpspectorSsrStore };

export function publishSsrStore(): void {
  (globalThis as HostHolder)[HOST] = getUpspectorSsrStore;
}

export function currentSsrStore(): UpspectorSsrStore | undefined {
  return (globalThis as HostHolder)[HOST]?.();
}

export function isSsrCaptureActive(): boolean {
  return currentSsrStore()?.active ?? false;
}

export function pushSsrEntry(entry: UpspectorEntry): void {
  currentSsrStore()?.entries.push(entry);
}
