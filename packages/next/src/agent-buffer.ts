import type { UpspectorEntry, UpspectorRenderPass } from "@uplide/upspector";

/**
 * Bigger than the overlay's 50: an agent walks many pages before it asks, and
 * the buffer lives in the dev server, not in a tab that reloads.
 */
const MAX_ENTRIES = 500;
const MAX_RENDER_PASSES = 100;

/** Where a forwarded record was seen: the tab and the page it was on. */
export interface UpspectorPageContext {
  tabId: string;
  pageUrl: string;
}

export interface UpspectorBufferedEntry extends UpspectorPageContext {
  /** Monotonic across entries and render passes; the agent's cursor. */
  seq: number;
  receivedAt: string;
  entry: UpspectorEntry;
}

export interface UpspectorBufferedRenderPass extends UpspectorPageContext {
  seq: number;
  receivedAt: string;
  renderPass: UpspectorRenderPass;
}

export interface UpspectorAgentBuffer {
  seq: number;
  entries: UpspectorBufferedEntry[];
  renderPasses: UpspectorBufferedRenderPass[];
}

/**
 * Pinned on `globalThis`: the events route and the MCP route are separate
 * bundles in `next dev`, and a recompile re-evaluates both modules. Only the
 * process outlives them.
 */
const BUFFER = Symbol.for("@uplide/upspector-next/agent-buffer");

type BufferHolder = { [BUFFER]?: UpspectorAgentBuffer };

export function getAgentBuffer(): UpspectorAgentBuffer {
  return ((globalThis as BufferHolder)[BUFFER] ??= {
    seq: 0,
    entries: [],
    renderPasses: [],
  });
}

/**
 * A tab re-sends what it already sent when an effect runs twice (React strict
 * mode) or a client navigation re-hydrates the same SSR slice, so an entry id
 * is stored once per tab.
 */
export function pushAgentEntry(
  context: UpspectorPageContext,
  entry: UpspectorEntry,
): void {
  const buffer = getAgentBuffer();
  const duplicate = buffer.entries.some(
    (held) => held.tabId === context.tabId && held.entry.id === entry.id,
  );
  if (duplicate) return;

  buffer.seq += 1;
  buffer.entries.push({
    ...context,
    seq: buffer.seq,
    receivedAt: new Date().toISOString(),
    entry,
  });
  if (buffer.entries.length > MAX_ENTRIES) {
    buffer.entries.splice(0, buffer.entries.length - MAX_ENTRIES);
  }
}

export function pushAgentRenderPass(
  context: UpspectorPageContext,
  renderPass: UpspectorRenderPass,
): void {
  const buffer = getAgentBuffer();
  const duplicate = buffer.renderPasses.some(
    (held) =>
      held.tabId === context.tabId && held.renderPass.id === renderPass.id,
  );
  if (duplicate) return;

  buffer.seq += 1;
  buffer.renderPasses.push({
    ...context,
    seq: buffer.seq,
    receivedAt: new Date().toISOString(),
    renderPass,
  });
  if (buffer.renderPasses.length > MAX_RENDER_PASSES) {
    buffer.renderPasses.splice(
      0,
      buffer.renderPasses.length - MAX_RENDER_PASSES,
    );
  }
}

/** Empties the buffer; `seq` keeps counting so old cursors stay meaningful. */
export function clearAgentBuffer(): number {
  const buffer = getAgentBuffer();
  buffer.entries = [];
  buffer.renderPasses = [];

  return buffer.seq;
}
