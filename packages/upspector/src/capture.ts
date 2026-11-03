/**
 * Lets a server-rendering host know which captures are still in flight, so it
 * can wait for them before serializing what was collected. Both adapters call
 * `beginCapture()` and the returned function once the response is handled; with
 * no tracker registered (the browser) it is a no-op.
 */
export type UpspectorCaptureTracker = () => () => void;

const TRACKER = Symbol.for("@uplide/upspector/capture-tracker");

type TrackerHolder = { [TRACKER]?: UpspectorCaptureTracker };

const noop = () => {};

export function setCaptureTracker(tracker: UpspectorCaptureTracker | null): void {
  (globalThis as TrackerHolder)[TRACKER] = tracker ?? undefined;
}

export function beginCapture(): () => void {
  const tracker = (globalThis as TrackerHolder)[TRACKER];

  return tracker ? tracker() : noop;
}
