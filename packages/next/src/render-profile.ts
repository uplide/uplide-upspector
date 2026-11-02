import type {
  DebugbarAllocationSite,
  DebugbarRenderAllocations,
} from "@uplide/debugbar";

/**
 * Shape of `HeapProfiler.stopSampling`'s `profile.head` (CDP
 * `HeapProfiler.SamplingHeapProfileNode`), narrowed to what the aggregation
 * needs.
 */
export interface SamplingProfileNode {
  callFrame: { functionName: string; url: string; lineNumber: number };
  selfSize: number;
  children?: SamplingProfileNode[];
}

/** Rows kept in the overlay's allocation table; the rest is summarized away. */
export const MAX_ALLOCATION_SITES = 20;

function classify(url: string): DebugbarAllocationSite["source"] {
  if (url === "" || url.startsWith("node:")) return "runtime";
  if (url.includes("node_modules")) return "dependency";

  return "app";
}

/**
 * Folds V8's sampling heap profile into bytes per call frame.
 *
 * Only `selfSize` is summed: it is the memory allocated *by* that frame, so a
 * parent frame is not credited with its children's allocations and the total
 * stays equal to the sampled bytes.
 */
export function aggregateSamplingProfile(
  head: SamplingProfileNode,
): DebugbarRenderAllocations {
  const groups = new Map<string, DebugbarAllocationSite>();
  const stack: SamplingProfileNode[] = [head];
  let sampledBytes = 0;

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) break;

    if (node.children) stack.push(...node.children);
    if (node.selfSize <= 0) continue;

    const { functionName, url, lineNumber } = node.callFrame;
    const key = `${functionName}|${url}|${lineNumber}`;
    const existing = groups.get(key);

    sampledBytes += node.selfSize;

    if (existing) {
      existing.bytes += node.selfSize;
      continue;
    }

    groups.set(key, {
      functionName: functionName === "" ? "(anonymous)" : functionName,
      url,
      line: lineNumber,
      bytes: node.selfSize,
      source: classify(url),
    });
  }

  const sites = [...groups.values()].sort((a, b) => b.bytes - a.bytes);

  return {
    sampledBytes,
    truncated: sites.length > MAX_ALLOCATION_SITES,
    sites: sites.slice(0, MAX_ALLOCATION_SITES),
  };
}
