export type * from "@uplide/upspector-protocol";
import type { UpspectorPayload } from "@uplide/upspector-protocol";

declare global {
  interface RequestInit {
    /** `false` leaves this request out of the Upspector entirely. */
    upspector?: boolean;
  }
}

/** Where the captured request was issued from. */
export type UpspectorSource = "csr" | "ssr";

/**
 * A captured body, already serialized. Kept as text rather than a live object
 * so the ring buffer cannot pin large response graphs in memory, and so the
 * SSR slice crosses the RSC boundary unchanged.
 */
export interface UpspectorBody {
  text: string;
  truncated: boolean;
  bytes: number;
}

/** What went over the wire, beside the backend's own payload. */
export interface UpspectorExchange {
  requestHeaders: Record<string, string>;
  query: Record<string, string>;
  requestBody: UpspectorBody | null;
  responseHeaders: Record<string, string>;
  responseBody: UpspectorBody | null;
}

export interface UpspectorEntry {
  id: string;
  source: UpspectorSource;
  method: string;
  url: string;
  statusCode?: number;
  capturedAt: string;
  /** null when the backend could not build its snapshot; see `payloadError`. */
  payload: UpspectorPayload | null;
  /** The backend's own reason for a missing payload. */
  payloadError?: string;
  exchange: UpspectorExchange;
}

/**
 * One server component wrapped with `measureServerComponent()`.
 *
 * `heapDeltaBytes` is heap growth observed across the component's await
 * window, not an isolated allocation count — V8 exposes no per-async-context
 * counter, so concurrent work inflates it.
 */
export interface UpspectorRenderComponent {
  name: string;
  /** ms from render-pass start to this component's invocation. */
  startMs: number;
  durationMs: number;
  /** process.memoryUsage().heapUsed delta across the component's window. */
  heapDeltaBytes: number;
  error?: string;
}

export interface UpspectorAllocationSite {
  functionName: string;
  url: string;
  line: number;
  bytes: number;
  source: "app" | "dependency" | "runtime";
}

export interface UpspectorRenderGc {
  count: number;
  totalPauseMs: number;
  reclaimedBytes: number;
}

export interface UpspectorRenderAllocations {
  sampledBytes: number;
  truncated: boolean;
  sites: UpspectorAllocationSite[];
}

/** One server render pass, measured on the server. */
export interface UpspectorRenderPass {
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
  components: UpspectorRenderComponent[];
  /** null when another pass held the process-global profiler. */
  gc: UpspectorRenderGc | null;
  /** null when profiling was off or skipped. */
  allocations: UpspectorRenderAllocations | null;
  /** Why gc/allocations are null; omitted when both were collected. */
  skipped?: string;
}

/**
 * One `data-insp-path` attribute, as emitted by `code-inspector-plugin` in a
 * development build: `<repo-relative file>:<row>:<col>:<tag>`.
 */
export interface UpspectorInspectFrame {
  file: string;
  line: number;
  column: number;
  tag: string;
}

/** `git blame` / `git log` record for one line or one file. */
export interface UpspectorCommitInfo {
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
export type UpspectorDataCallKind = string;

/**
 * A data-fetching expression found in the file that rendered the element.
 *
 * Static scan, not a data-flow graph: it tells you which calls live in that
 * file, not which one produced the exact node you clicked.
 */
export interface UpspectorDataCall {
  kind: UpspectorDataCallKind;
  /** Source text of the call, trimmed to one line. */
  expression: string;
  line: number;
  /** Endpoint literal extracted from the call, when there is one. */
  endpoint?: string;
}

/** One resolved frame: source, authorship and the data calls around it. */
export interface UpspectorInspectSource extends UpspectorInspectFrame {
  /** First line number of `snippet`. */
  snippetStartLine: number;
  snippet: string[];
  /** Blame of the element's own line; null when the file is untracked. */
  lineCommit: UpspectorCommitInfo | null;
  /** Last commit touching the whole file. */
  fileCommit: UpspectorCommitInfo | null;
  dataCalls: UpspectorDataCall[];
  error?: string;
}

export interface UpspectorInspectResult {
  /** Clicked element first, then its ancestors outwards. */
  frames: UpspectorInspectSource[];
  /** Repo root the server resolved the frames against. */
  repoRoot: string;
}
