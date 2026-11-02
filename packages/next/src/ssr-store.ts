import type { DebugbarEntry } from "@uplide/debugbar";
import { cache } from "react";

export interface DebugbarSsrStore {
  /** Set by `openDebugbarScope()`; nothing is captured while false. */
  active: boolean;
  entries: DebugbarEntry[];
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
export const getDebugbarSsrStore = cache<() => DebugbarSsrStore>(() => ({
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
const HOST = Symbol.for("@uplide/debugbar-next/ssr-store");

type HostHolder = { [HOST]?: () => DebugbarSsrStore };

export function publishSsrStore(): void {
  (globalThis as HostHolder)[HOST] = getDebugbarSsrStore;
}

export function currentSsrStore(): DebugbarSsrStore | undefined {
  return (globalThis as HostHolder)[HOST]?.();
}

export function isSsrCaptureActive(): boolean {
  return currentSsrStore()?.active ?? false;
}

export function pushSsrEntry(entry: DebugbarEntry): void {
  currentSsrStore()?.entries.push(entry);
}
