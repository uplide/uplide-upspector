import {
  type UpspectorConfig,
  type UpspectorEntry,
  getUpspectorConfig,
  setCaptureTracker,
  setUpspectorConfig,
} from "@uplide/upspector";
import { attachUpspector } from "@uplide/upspector/axios";
import { installFetchCapture } from "@uplide/upspector/fetch";
import { UpspectorOverlay, UpspectorSsrHydrator } from "@uplide/upspector/react";
import type { AxiosInstance } from "axios";
import { beginRenderPass, snapshotRenderPass } from "./server-render.js";
import {
  currentSsrStore,
  getUpspectorSsrStore,
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
export function registerUpspector(config: UpspectorConfig): void {
  const resolved = setUpspectorConfig(config);
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
export function openUpspectorScope(options: { profile?: boolean } = {}): void {
  if (!getUpspectorConfig().enabled) return;

  installFetchCapture(SSR_CAPTURE);
  getUpspectorSsrStore().active = true;
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
export function attachUpspectorServerAxios(api: AxiosInstance): () => void {
  return attachUpspector(api, {
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
export async function waitForUpspectorSsrEntries(
  settleMs = DEFAULT_SETTLE_MS,
): Promise<UpspectorEntry[]> {
  const store = getUpspectorSsrStore();
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
export async function UpspectorRoot({
  nonce,
  settleMs,
}: {
  nonce?: string;
  /** Quiet period that marks the render as done. Default 50 ms. */
  settleMs?: number;
} = {}) {
  if (!getUpspectorConfig().enabled) return null;

  const entries = await waitForUpspectorSsrEntries(settleMs);
  const renderPass = await snapshotRenderPass();

  return (
    <>
      <UpspectorSsrHydrator entries={entries} renderPass={renderPass} />
      <UpspectorOverlay nonce={nonce} />
    </>
  );
}
