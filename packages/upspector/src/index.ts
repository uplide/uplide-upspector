export {
  UPSPECTOR_HEADER,
  UPSPECTOR_PAYLOAD_VERSION,
  DEFAULT_RESPONSE_KEY,
  isUpspectorErrorPayload,
  isUpspectorPayload,
  isRecord,
  takeUpspectorPayload,
} from "@uplide/upspector-protocol";
export { beginCapture, setCaptureTracker } from "./capture.js";
export type { UpspectorCaptureTracker } from "./capture.js";
export {
  DEFAULT_INSPECT_ENDPOINT,
  EVENTS_ENDPOINT,
  defineUpspectorConfig,
  getUpspectorConfig,
  setUpspectorConfig,
} from "./config.js";
export type { UpspectorConfig, ResolvedUpspectorConfig } from "./config.js";
export { reportUpspectorStatus } from "./diagnose.js";
export { forwardUpspectorEntries } from "./forward.js";
export { createEntry, toBody, toHeaders } from "./entry.js";
export type { UpspectorRawExchange } from "./entry.js";
export {
  DEFAULT_CALL_PATTERNS,
  findImportSource,
  isReadableSourcePath,
  matchesEndpoint,
  parseInspectPath,
  scanDataCalls,
} from "./inspect-path.js";
export type { UpspectorCallPattern } from "./inspect-path.js";
export { resolveUpspectorEnabled } from "./is-enabled.js";
export {
  isSensitiveKey,
  isSensitiveValue,
  REDACTED,
  redactJsonText,
  redactUrl,
  shouldRedact,
} from "./redact.js";
export type { UpspectorRedactKey, UpspectorRedactRules } from "./redact.js";
export { pushUpspectorEntry, useUpspectorStore } from "./store.js";
export type { UpspectorStore } from "./store.js";
export type * from "./types.js";
