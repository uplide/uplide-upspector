import { randomUUID } from "node:crypto";
import type { Session } from "node:inspector/promises";
import type { GCProfiler } from "node:v8";
import { cache } from "react";
import { aggregateSamplingProfile } from "./render-profile.js";
import type {
  UpspectorRenderAllocations,
  UpspectorRenderComponent,
  UpspectorRenderGc,
  UpspectorRenderPass,
} from "@uplide/upspector";

/**
 * Server-side measurement of one RSC render pass: wall time, heap/RSS deltas,
 * GC pressure, per-component windows and — when enabled — stack-attributed
 * allocations from V8's sampling heap profiler.
 *
 * Scoping is React's `cache()`, the same mechanism the app's SSR request
 * collector uses: one store per render pass, so concurrent requests never see
 * each other's numbers.
 */
interface RenderPassStore {
  started: boolean;
  id: string;
  startedAt: string;
  startHr: number;
  heapStart: number;
  rssStart: number;
  externalStart: number;
  heapPeak: number;
  components: UpspectorRenderComponent[];
  holdsProfiler: boolean;
  profiling: boolean;
  skipped: string | undefined;
  snapshot: UpspectorRenderPass | null;
}

const getRenderPassStore = cache<() => RenderPassStore>(() => ({
  started: false,
  id: "",
  startedAt: "",
  startHr: 0,
  heapStart: 0,
  rssStart: 0,
  externalStart: 0,
  heapPeak: 0,
  components: [],
  holdsProfiler: false,
  profiling: false,
  skipped: undefined,
  snapshot: null,
}));

/**
 * `HeapProfiler.startSampling` and `GCProfiler.start` are process-global, so
 * only one render pass may hold them at a time. Concurrent passes measure wall
 * time and heap deltas only.
 */
let profilerHolder: { id: string; at: number } | null = null;
let gcProfiler: GCProfiler | null = null;
let inspectorSession: Session | null = null;

/**
 * A pass that threw before snapshotting never releases the lock. Without a
 * steal window, one failed render would disable profiling for the rest of the
 * process's life.
 */
const PROFILER_STALE_MS = 30_000;

/**
 * Measured on this app: an `/en` render sampled ≈532 KB across 495 nodes at
 * this interval with no observable overhead. Raise it to trade sample
 * resolution for speed.
 */
const SAMPLING_INTERVAL_BYTES = 8192;

/** Guards the RSC payload against a pathological component tree. */
const MAX_RENDER_COMPONENTS = 200;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Stops GC collection and folds the records into the wire shape.
 *
 * `record.cost` is in **microseconds** despite the field's docs — measured:
 * 28 GCs summed to 242 327 over a 515 ms allocation loop.
 */
function collectGc(): UpspectorRenderGc | null {
  const profiler = gcProfiler;
  gcProfiler = null;
  if (!profiler) return null;

  try {
    const { statistics } = profiler.stop();

    return {
      count: statistics.length,
      totalPauseMs: round2(
        statistics.reduce((total, record) => total + record.cost, 0) / 1000,
      ),
      reclaimedBytes: statistics.reduce(
        (total, record) =>
          total +
          Math.max(
            0,
            record.beforeGC.heapStatistics.usedHeapSize -
              record.afterGC.heapStatistics.usedHeapSize,
          ),
        0,
      ),
    };
  } catch {
    return null;
  }
}

/**
 * Stops sampling and disconnects. Never rejects: instrumentation must not be
 * able to fail a page render.
 */
async function releaseSampling(): Promise<UpspectorRenderAllocations | null> {
  const session = inspectorSession;
  inspectorSession = null;
  if (!session) return null;

  try {
    const { profile } = await session.post("HeapProfiler.stopSampling");

    return aggregateSamplingProfile(profile.head);
  } catch {
    return null;
  } finally {
    try {
      session.disconnect();
    } catch {
      // Already gone; nothing to release.
    }
  }
}

/** Releases profilers a pass left running because it threw before snapshotting. */
function abandonProfilers(): void {
  collectGc();
  void releaseSampling();
  profilerHolder = null;
}

/**
 * Starts measuring the current render pass.
 *
 * Synchronous on purpose, and it must be called before the first `await` of the
 * app's outermost layout: Next starts rendering child segments while a parent
 * layout is suspended, so anything awaited first would let the page's own
 * components run unmeasured.
 *
 * `process.getBuiltinModule` instead of `import`: `node:v8` and
 * `node:inspector` are only ever loaded when Upspector is actually on.
 */
export function beginRenderPass(options: { profile: boolean }): void {
  const store = getRenderPassStore();
  if (store.started) return;

  const memory = process.memoryUsage();

  store.started = true;
  store.id = randomUUID();
  store.startedAt = new Date().toISOString();
  store.startHr = performance.now();
  store.heapStart = memory.heapUsed;
  store.rssStart = memory.rss;
  store.externalStart = memory.external;
  store.heapPeak = memory.heapUsed;

  const stale =
    profilerHolder !== null &&
    Date.now() - profilerHolder.at > PROFILER_STALE_MS;

  if (profilerHolder !== null && !stale) {
    store.skipped = "another render pass is holding the process profiler";

    return;
  }

  if (stale) abandonProfilers();

  profilerHolder = { id: store.id, at: Date.now() };
  store.holdsProfiler = true;

  // Every profiler interaction degrades to a `skipped` note instead of
  // throwing: instrumentation must never break a page render.
  try {
    const { GCProfiler } = process.getBuiltinModule("node:v8");

    gcProfiler = new GCProfiler();
    gcProfiler.start();
  } catch (error) {
    gcProfiler = null;
    store.skipped = String(error);
  }

  if (!options.profile) return;

  try {
    const { Session } = process.getBuiltinModule("node:inspector/promises");
    const session = new Session();

    session.connect();
    // Not awaited: the inspector processes commands in order, so sampling is
    // armed before this render can allocate anything in bulk — and awaiting
    // here would hand the render to the child segments unmeasured.
    const ignore = () => {};

    session.post("HeapProfiler.enable").catch(ignore);
    session
      .post("HeapProfiler.startSampling", {
        samplingInterval: SAMPLING_INTERVAL_BYTES,
      })
      .catch(ignore);
    inspectorSession = session;
    store.profiling = true;
  } catch (error) {
    inspectorSession = null;
    store.profiling = false;
    store.skipped = String(error);
  }
}

/**
 * Wraps an async server component so its render window shows up in the render
 * tab. A pass-through no-op when no render pass started, which is every request
 * with Upspector off.
 */
export function measureServerComponent<A extends unknown[], R>(
  name: string,
  component: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return async (...args: A): Promise<R> => {
    const store = getRenderPassStore();
    if (!store.started) return component(...args);

    const startHr = performance.now();
    const heapBefore = process.memoryUsage().heapUsed;
    let error: string | undefined;

    try {
      return await component(...args);
    } catch (thrown) {
      error = thrown instanceof Error ? thrown.message : String(thrown);
      throw thrown;
    } finally {
      const heapAfter = process.memoryUsage().heapUsed;

      if (heapAfter > store.heapPeak) store.heapPeak = heapAfter;
      if (store.components.length < MAX_RENDER_COMPONENTS) {
        store.components.push({
          name,
          startMs: round2(startHr - store.startHr),
          durationMs: round2(performance.now() - startHr),
          heapDeltaBytes: heapAfter - heapBefore,
          ...(error === undefined ? {} : { error }),
        });
      }
    }
  };
}

/**
 * Closes the pass and returns what was measured. Idempotent: the second call
 * returns the same snapshot without touching the profilers.
 */
export async function snapshotRenderPass(): Promise<UpspectorRenderPass | null> {
  const store = getRenderPassStore();
  if (!store.started) return null;
  if (store.snapshot) return store.snapshot;

  const durationMs = round2(performance.now() - store.startHr);
  const memory = process.memoryUsage();
  const heapPeak = Math.max(store.heapPeak, memory.heapUsed);

  let gc: UpspectorRenderGc | null = null;
  let allocations: UpspectorRenderAllocations | null = null;

  if (store.holdsProfiler) {
    gc = collectGc();
    allocations = store.profiling ? await releaseSampling() : null;
    if (profilerHolder?.id === store.id) profilerHolder = null;
    store.holdsProfiler = false;
  }

  store.snapshot = {
    id: store.id,
    route: "",
    startedAt: store.startedAt,
    durationMs,
    memory: {
      heapUsedStartBytes: store.heapStart,
      heapUsedEndBytes: memory.heapUsed,
      heapUsedDeltaBytes: memory.heapUsed - store.heapStart,
      heapPeakBytes: heapPeak,
      rssStartBytes: store.rssStart,
      rssEndBytes: memory.rss,
      externalDeltaBytes: memory.external - store.externalStart,
    },
    components: store.components,
    gc,
    allocations,
    ...(store.skipped === undefined ? {} : { skipped: store.skipped }),
  };

  return store.snapshot;
}
