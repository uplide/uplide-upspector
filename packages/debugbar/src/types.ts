export type * from "@uplide/debugbar-protocol";
import type { DebugbarPayload } from "@uplide/debugbar-protocol";

declare global {
  interface RequestInit {
    /** `false` leaves this request out of the debugbar entirely. */
    debugbar?: boolean;
  }
}

/** Where the captured request was issued from. */
export type DebugbarSource = "csr" | "ssr";

/**
 * A captured body, already serialized. Kept as text rather than a live object
 * so the ring buffer cannot pin large response graphs in memory, and so the
 * SSR slice crosses the RSC boundary unchanged.
 */
export interface DebugbarBody {
  text: string;
  truncated: boolean;
  bytes: number;
}

/** What went over the wire, beside the backend's own payload. */
export interface DebugbarExchange {
  requestHeaders: Record<string, string>;
  query: Record<string, string>;
  requestBody: DebugbarBody | null;
  responseHeaders: Record<string, string>;
  responseBody: DebugbarBody | null;
}

export interface DebugbarEntry {
  id: string;
  source: DebugbarSource;
  method: string;
  url: string;
  statusCode?: number;
  capturedAt: string;
  /** null when the backend could not build its snapshot; see `payloadError`. */
  payload: DebugbarPayload | null;
  /** The backend's own reason for a missing payload. */
  payloadError?: string;
  exchange: DebugbarExchange;
}

/**
 * One server component wrapped with `measureServerComponent()`.
 *
 * `heapDeltaBytes` is heap growth observed across the component's await
 * window, not an isolated allocation count — V8 exposes no per-async-context
 * counter, so concurrent work inflates it.
 */
export interface DebugbarRenderComponent {
  name: string;
  /** ms from render-pass start to this component's invocation. */
  startMs: number;
  durationMs: number;
  /** process.memoryUsage().heapUsed delta across the component's window. */
  heapDeltaBytes: number;
  error?: string;
}

export interface DebugbarAllocationSite {
  functionName: string;
  url: string;
  line: number;
  bytes: number;
  source: "app" | "dependency" | "runtime";
}

export interface DebugbarRenderGc {
  count: number;
  totalPauseMs: number;
  reclaimedBytes: number;
}

export interface DebugbarRenderAllocations {
  sampledBytes: number;
  truncated: boolean;
  sites: DebugbarAllocationSite[];
}

/** One server render pass, measured on the server. */
export interface DebugbarRenderPass {
  id: string;
  /** Filled client-side at hydration from window.location.pathname. */
  route: string;
  startedAt: string;
  durationMs: number;
  memory: {
    heapUsedStartBytes: number;
    heapUsedEndBytes: number;
    heapUsedDeltaBytes: number;
    heapPeakBytes: number;
    rssStartBytes: number;
    rssEndBytes: number;
    externalDeltaBytes: number;
  };
  components: DebugbarRenderComponent[];
  /** null when another pass held the process-global profiler. */
  gc: DebugbarRenderGc | null;
  /** null when profiling was off or skipped. */
  allocations: DebugbarRenderAllocations | null;
  /** Why gc/allocations are null; omitted when both were collected. */
  skipped?: string;
}

/**
 * One `data-insp-path` attribute, as emitted by `code-inspector-plugin` in a
 * development build: `<repo-relative file>:<row>:<col>:<tag>`.
 */
export interface DebugbarInspectFrame {
  file: string;
  line: number;
  column: number;
  tag: string;
}

/** `git blame` / `git log` record for one line or one file. */
export interface DebugbarCommitInfo {
  commit: string;
  author: string;
  email: string;
  /** ISO 8601, author time. */
  at: string;
  summary: string;
}

/**
 * Built-in kinds are `http` (fetch/axios calls), `hook` (data hooks such as
 * `useSWR`) and `endpoint`; host-specific resolvers may add their own.
 */
export type DebugbarDataCallKind = string;

/**
 * A data-fetching expression found in the file that rendered the element.
 *
 * Static scan, not a data-flow graph: it tells you which calls live in that
 * file, not which one produced the exact node you clicked.
 */
export interface DebugbarDataCall {
  kind: DebugbarDataCallKind;
  /** Source text of the call, trimmed to one line. */
  expression: string;
  line: number;
  /** Endpoint literal extracted from the call, when there is one. */
  endpoint?: string;
}

/** One resolved frame: source, authorship and the data calls around it. */
export interface DebugbarInspectSource extends DebugbarInspectFrame {
  /** First line number of `snippet`. */
  snippetStartLine: number;
  snippet: string[];
  /** Blame of the element's own line; null when the file is untracked. */
  lineCommit: DebugbarCommitInfo | null;
  /** Last commit touching the whole file. */
  fileCommit: DebugbarCommitInfo | null;
  dataCalls: DebugbarDataCall[];
  error?: string;
}

export interface DebugbarInspectResult {
  /** Clicked element first, then its ancestors outwards. */
  frames: DebugbarInspectSource[];
  /** Repo root the server resolved the frames against. */
  repoRoot: string;
}
