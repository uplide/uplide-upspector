import {
  type DebugbarConfig,
  type DebugbarEntry,
  getDebugbarConfig,
  setCaptureTracker,
  setDebugbarConfig,
} from "@uplide/debugbar";
import { attachDebugbar } from "@uplide/debugbar/axios";
import { installFetchCapture } from "@uplide/debugbar/fetch";
import { DebugbarOverlay, DebugbarSsrHydrator } from "@uplide/debugbar/react";
import type { AxiosInstance } from "axios";
import { beginRenderPass, snapshotRenderPass } from "./server-render.js";
import {
  currentSsrStore,
  getDebugbarSsrStore,
  isSsrCaptureActive,
  publishSsrStore,
  pushSsrEntry,
} from "./ssr-store.js";

export {
  beginRenderPass,
  measureServerComponent,
  snapshotRenderPass,
} from "./server-render.js";

const noop = () => {};

/**
 * Every call is checked against the current render's scope, so route handlers
 * (an API proxy streaming backend responses to the browser) and middleware
 * pass untouched.
 */
const SSR_CAPTURE = {
  source: "ssr",
  inScope: isSsrCaptureActive,
  onEntry: pushSsrEntry,
} as const;

/**
 * Call from `instrumentation.ts` `register()` in the Node.js runtime.
 *
 * `register` runs before Next patches `fetch`, so the wrapper ends up *inside*
 * Next's dedup and Data Cache: it only ever sees real network calls. That
 * position survives for the life of a production server.
 */
export function registerDebugbar(config: DebugbarConfig): void {
  const resolved = setDebugbarConfig(config);
  if (!resolved.enabled) return;

  installFetchCapture(SSR_CAPTURE);
}

/**
 * Call synchronously at the top of the root layout, before its first `await`:
 * Next starts rendering child segments while a parent layout is suspended, so
 * anything awaited first would let the page's own requests go uncaptured.
 *
 * Also re-wraps `fetch` when it was swapped out: Next's dev server restores its
 * original `fetch` after every recompile, dropping the wrapper `register`
 * installed. The re-wrap sits outside Next's patch; a response the inner
 * wrapper already consumed passes it unread, and a replay from Next's caches
 * is recognised by its request id.
 */
export function openDebugbarScope(options: { profile?: boolean } = {}): void {
  if (!getDebugbarConfig().enabled) return;

  installFetchCapture(SSR_CAPTURE);
  getDebugbarSsrStore().active = true;
  publishSsrStore();
  setCaptureTracker(() => {
    const store = currentSsrStore();
    if (!store?.active) return noop;

    let finish = noop;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });

    store.started += 1;
    store.pending.add(pending);
    void pending.finally(() => {
      store.pending.delete(pending);
    });

    return finish;
  });

  beginRenderPass({ profile: options.profile ?? false });
}

/**
 * SSR capture for an axios instance used by server components. Attach it
 * before any interceptor that snapshots response bodies, so the payload key is
 * lifted off first.
 */
export function attachDebugbarServerAxios(api: AxiosInstance): () => void {
  return attachDebugbar(api, {
    source: "ssr",
    inScope: isSsrCaptureActive,
    onEntry: pushSsrEntry,
  });
}

/**
 * How long the render must stay free of new captures before it counts as done.
 * Sibling segments render concurrently with the bar, so "nothing pending" can
 * simply mean the page has not issued its request yet.
 */
const DEFAULT_SETTLE_MS = 50;

/**
 * Awaits every server-side capture of this render pass, including ones that
 * start while waiting, then returns what was collected.
 */
export async function waitForDebugbarSsrEntries(
  settleMs = DEFAULT_SETTLE_MS,
): Promise<DebugbarEntry[]> {
  const store = getDebugbarSsrStore();
  let seen = -1;

  while (store.pending.size > 0 || store.started !== seen) {
    seen = store.started;
    await Promise.allSettled([...store.pending]);
    await new Promise((resolve) => setTimeout(resolve, settleMs));
  }

  return store.entries;
}

/**
 * Hands this render's SSR entries and render measurement to the browser and
 * mounts the overlay. Render it after `children` (inside `<Suspense>` so it
 * streams last) — by then every server component request has finished.
 */
export async function DebugbarRoot({
  nonce,
  settleMs,
}: {
  nonce?: string;
  /** Quiet period that marks the render as done. Default 50 ms. */
  settleMs?: number;
} = {}) {
  if (!getDebugbarConfig().enabled) return null;

  const entries = await waitForDebugbarSsrEntries(settleMs);
  const renderPass = await snapshotRenderPass();

  return (
    <>
      <DebugbarSsrHydrator entries={entries} renderPass={renderPass} />
      <DebugbarOverlay nonce={nonce} />
    </>
  );
}
